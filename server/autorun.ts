import { config, coinbaseConfigured } from './config.js'
import { getProduct, listAccounts } from './coinbase.js'
import { scanCryptoMarket } from './scanner.js'
import { getSetting, setSetting } from './db.js'
import { publish } from './events.js'
import { getOllamaStatus } from './ollama.js'
import { getPipelineStatus, runFullAgentPipeline } from './pipeline.js'

export interface AutoRunSettings {
  enabled: boolean
  intervalSeconds: number
  deepResearch: boolean
}

const boolSetting = (key: string, fallback: boolean) => {
  const raw = getSetting(key, String(fallback)).toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

const numSetting = (key: string, fallback: number) => {
  const value = Number(getSetting(key, String(fallback)))
  return Number.isFinite(value) ? value : fallback
}

export const getAutoRunSettings = (): AutoRunSettings => ({
  enabled: boolSetting('auto_agents_enabled', true),
  intervalSeconds: Math.max(15, Math.min(3600, Math.floor(numSetting('auto_agents_interval_seconds', 60)))),
  deepResearch: boolSetting('auto_agents_deep_research', false)
})

export const saveAutoRunSettings = (input: Partial<AutoRunSettings>) => {
  const current = getAutoRunSettings()
  const next: AutoRunSettings = {
    enabled: input.enabled ?? current.enabled,
    intervalSeconds: Math.max(15, Math.min(3600, Math.floor(Number(input.intervalSeconds ?? current.intervalSeconds)))),
    deepResearch: input.deepResearch ?? current.deepResearch
  }
  setSetting('auto_agents_enabled', String(next.enabled))
  setSetting('auto_agents_interval_seconds', String(next.intervalSeconds))
  setSetting('auto_agents_deep_research', String(next.deepResearch))
  publish('auto_agents_settings_updated', next, 'manager')
  return next
}

let timer: NodeJS.Timeout | null = null
let lastAttemptAt = 0

const shouldRunNow = () => {
  const state = getPipelineStatus()
  if (state.status === 'running') return false
  const settings = getAutoRunSettings()
  if (!settings.enabled) return false
  const reference = state.finishedAt ? new Date(state.finishedAt).getTime() : lastAttemptAt
  if (!reference) return true
  return Date.now() - reference >= settings.intervalSeconds * 1000
}

const balanceValue = (balance: any) => Number(balance?.value ?? balance ?? 0) || 0

const pickAutoProduct = async () => {
  const accounts = await listAccounts()
  const watchlist = config.watchlist || ['XRP-USD', 'BTC-USD', 'ETH-USD', 'SOL-USD', 'LINK-USD']

  // 1. Prefer the largest holding that is in the watchlist (XRP first for you)
  let bestHolding: { productId: string; usdValue: number } | null = null
  for (const account of accounts) {
    const currency = String(account.currency || '').toUpperCase()
    if (!currency || ['USD', 'USDC', 'USDT'].includes(currency)) continue
    const productId = currency + '-USD'
    if (!watchlist.includes(productId)) continue

    const amount = balanceValue(account.availableBalance) + balanceValue(account.hold)
    if (!(amount > 0)) continue

    try {
      const product: any = await getProduct(productId)
      const price = Number(product?.price || 0)
      const usdValue = amount * price
      if (Number.isFinite(usdValue) && usdValue > 0 && (!bestHolding || usdValue > bestHolding.usdValue)) {
        bestHolding = { productId, usdValue }
      }
    } catch {}
  }

  if (bestHolding) return bestHolding.productId

  // 2. Try scanner best (prefer if in watchlist, but allow strong outside candidates)
  try {
    const scan = await scanCryptoMarket()
    if (scan.best?.productId && watchlist.includes(scan.best.productId)) {
      return scan.best.productId
    }
    if (scan.best?.productId) return scan.best.productId
  } catch {}

  // 3. Fallback to first watchlist item (XRP-USD)
  return watchlist[0] || 'XRP-USD'
}

const tick = async () => {
  if (!shouldRunNow()) return
  if (!coinbaseConfigured()) return
  try {
    const ollama = await getOllamaStatus()
    if (!ollama.online || !ollama.chatModel) return
  } catch {
    return
  }

  const settings = getAutoRunSettings()
  let productId = await pickAutoProduct()

  try {
    const scan = await scanCryptoMarket()
    // Prefer scanner best if available, but pickAutoProduct already considered it
    if (scan.best?.productId) {
      const watchlist = config.watchlist || []
      // If we don't hold anything and scanner found something, use it
      if (!productId || productId === (watchlist[0] || 'XRP-USD')) {
        productId = scan.best.productId
      }
    }
    publish('crypto_scanner_completed', {
      scanned: scan.scanned,
      best: scan.best,
      top: scan.results.slice(0, 5)
    }, 'strategy')
  } catch (error) {
    publish('crypto_scanner_failed', {
      error: error instanceof Error ? error.message : String(error)
    }, 'strategy')
  }

  lastAttemptAt = Date.now()
  publish('auto_agents_cycle_started', {
    intervalSeconds: settings.intervalSeconds,
    deepResearch: settings.deepResearch,
    productId
  }, 'manager')

  void runFullAgentPipeline({ productId, deepResearch: settings.deepResearch }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    publish('auto_agents_cycle_failed', { error: message }, 'manager')
  })
}

export const startAutoRun = () => {
  if (timer) return
  void tick()
  timer = setInterval(() => void tick(), 5000)
}

export const stopAutoRun = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}