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

const heldProducts = async () => {
  const accounts = await listAccounts()
  const held = new Map<string, number>()
  for (const account of accounts) {
    const currency = String(account.currency || '').toUpperCase()
    if (!currency || ['USD', 'USDC', 'USDT'].includes(currency)) continue
    const amount = balanceValue(account.availableBalance) + balanceValue(account.hold)
    if (!(amount > 0)) continue
    const productId = currency + '-USD'
    try {
      const product: any = await getProduct(productId)
      const price = Number(product?.price || 0)
      const usdValue = amount * price
      if (Number.isFinite(usdValue) && usdValue > 0) held.set(productId, usdValue)
    } catch {}
  }
  return held
}

const chooseAutoProduct = async () => {
  const scan = await scanCryptoMarket()
  const held = await heldProducts()

  // Protect existing holdings first: if something we actually own has a strong sell signal,
  // analyze that position before looking for a new buy.
  const heldSell = [...scan.results]
    .filter((row: any) => row.sellCandidate && held.has(row.productId))
    .sort((a: any, b: any) => a.score - b.score)[0]
  if (heldSell) return { productId: heldSell.productId, scan, reason: 'HELD_SELL_CANDIDATE' }

  // Otherwise analyze the strongest scanner buy candidate.
  if (scan.bestBuy?.productId) {
    return { productId: scan.bestBuy.productId, scan, reason: 'BEST_BUY_CANDIDATE' }
  }

  // No market candidate: keep monitoring the largest held watchlist asset.
  const watchlist = config.watchlist || []
  const heldWatchlist = [...held.entries()]
    .filter(([productId]) => watchlist.includes(productId))
    .sort((a, b) => b[1] - a[1])[0]
  if (heldWatchlist) return { productId: heldWatchlist[0], scan, reason: 'MONITOR_LARGEST_HOLDING' }

  const largestHolding = [...held.entries()].sort((a, b) => b[1] - a[1])[0]
  if (largestHolding) return { productId: largestHolding[0], scan, reason: 'MONITOR_LARGEST_HOLDING' }

  return { productId: watchlist[0] || 'XRP-USD', scan, reason: 'WATCHLIST_FALLBACK' }
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
  let selection: Awaited<ReturnType<typeof chooseAutoProduct>>

  try {
    selection = await chooseAutoProduct()
    publish('crypto_scanner_completed', {
      scanned: selection.scan.scanned,
      bestBuy: selection.scan.bestBuy,
      bestSell: selection.scan.bestSell,
      selectedProductId: selection.productId,
      selectionReason: selection.reason,
      top: selection.scan.results.slice(0, 5)
    }, 'strategy')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publish('crypto_scanner_failed', { error: message }, 'strategy')
    selection = { productId: config.watchlist[0] || 'XRP-USD', scan: null as any, reason: 'SCAN_FAILED_FALLBACK' }
  }

  lastAttemptAt = Date.now()
  publish('auto_agents_cycle_started', {
    intervalSeconds: settings.intervalSeconds,
    deepResearch: settings.deepResearch,
    productId: selection.productId,
    selectionReason: selection.reason
  }, 'manager')

  void runFullAgentPipeline({
    productId: selection.productId,
    deepResearch: settings.deepResearch
  }).catch((error) => {
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
