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
const ANALYSIS_COOLDOWN_MS=10*60*1000

const analysisKey=(productId:string)=>'auto_last_analyzed_'+productId.toUpperCase().replace(/[^A-Z0-9]/g,'_')
const lastAnalyzedAt=(productId:string)=>Number(getSetting(analysisKey(productId),'0'))||0
const recentlyAnalyzed=(productId:string)=>Date.now()-lastAnalyzedAt(productId)<ANALYSIS_COOLDOWN_MS
const markAnalyzed=(productId:string)=>setSetting(analysisKey(productId),String(Date.now()))
const LAST_SELECTED_KEY='auto_last_selected_product'
const lastSelectedProduct=()=>getSetting(LAST_SELECTED_KEY,'').toUpperCase()
const isSameAsLast=(productId:string)=>productId.toUpperCase()===lastSelectedProduct()
const selectable=(productId:string)=>!recentlyAnalyzed(productId)&&!isSameAsLast(productId)

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

const accountSnapshot = async () => {
  const accounts = await listAccounts()
  const held = new Map<string, number>()
  let availableCashUsd = 0

  for (const account of accounts) {
    const currency = String(account.currency || '').toUpperCase()
    const available = balanceValue(account.availableBalance)
    const hold = balanceValue(account.hold)

    if (currency === 'USD' || currency === 'USDC') {
      availableCashUsd += available
      continue
    }

    if (!currency || currency === 'USDT') continue

    const amount = available + hold
    if (!(amount > 0)) continue

    const productId = currency + '-USD'
    try {
      const product: any = await getProduct(productId)
      const price = Number(product?.price || 0)
      const usdValue = amount * price
      if (Number.isFinite(usdValue) && usdValue > 0) held.set(productId, usdValue)
    } catch {}
  }

  return { held, availableCashUsd }
}

const chooseAutoProduct = async () => {
  const scan = await scanCryptoMarket()
  const { held, availableCashUsd } = await accountSnapshot()
  const lastProduct = lastSelectedProduct()
  const hasUsableCash = availableCashUsd >= Math.max(config.minLiveOrderUsd, 1)

  // A held sell-risk still gets priority, but it must be a material holding and
  // it cannot bypass rotation/cooldown anymore.
  const heldSell = [...scan.results]
    .filter((row: any) =>
      row.sellCandidate &&
      Number(held.get(row.productId) || 0) >= 5 &&
      selectable(row.productId)
    )
    .sort((a: any, b: any) => b.sellScore - a.sellScore)[0]
  if (heldSell) {
    return {
      productId: heldSell.productId,
      scan,
      reason: 'HELD_SELL_CANDIDATE_ROTATED',
      heldUsd: Number(held.get(heldSell.productId) || 0),
      availableCashUsd,
      previousProductId: lastProduct || null
    }
  }

  // When spendable USD is available, analyze the strongest fresh BUY candidate first.
  const freshBuy = [...scan.results]
    .filter((row: any) =>
      hasUsableCash &&
      row.buyCandidate &&
      selectable(row.productId)
    )
    .sort((a: any, b: any) => b.buyScore - a.buyScore)[0]

  if (freshBuy) {
    return {
      productId: freshBuy.productId,
      scan,
      reason: 'CASH_READY_BUY_CANDIDATE',
      heldUsd: Number(held.get(freshBuy.productId) || 0),
      availableCashUsd,
      previousProductId: lastProduct || null
    }
  }

  // Only keep XRP as a focus asset when there is still a material XRP holding.
  const xrpHeldUsd = Number(held.get('XRP-USD') || 0)
  const xrp = scan.results.find((row: any) => row.productId === 'XRP-USD')
  if (xrp && xrpHeldUsd >= 5 && selectable('XRP-USD')) {
    return {
      productId: 'XRP-USD',
      scan,
      reason: 'XRP_HELD_FOCUS_ROTATION',
      heldUsd: xrpHeldUsd,
      availableCashUsd,
      previousProductId: lastProduct || null
    }
  }

  // Otherwise rotate through the strongest fresh setup. With cash available,
  // prefer long-side strength and skip unheld sell-only setups.
  const freshMarket = [...scan.results]
    .filter((row: any) =>
      selectable(row.productId) &&
      (!hasUsableCash || !row.sellCandidate || Number(held.get(row.productId) || 0) >= 5)
    )
    .sort((a: any, b: any) =>
      hasUsableCash
        ? Number(b.buyScore || 0) - Number(a.buyScore || 0)
        : Math.max(b.buyScore || 0, b.sellScore || 0) - Math.max(a.buyScore || 0, a.sellScore || 0)
    )[0]
  if (freshMarket) {
    return {
      productId: freshMarket.productId,
      scan,
      reason: hasUsableCash ? 'CASH_READY_MARKET_ROTATION' : 'MARKET_ROTATION',
      heldUsd: Number(held.get(freshMarket.productId) || 0),
      availableCashUsd,
      previousProductId: lastProduct || null
    }
  }

  // If all assets are cooling down, pick the least recently analyzed asset,
  // but never immediately repeat the previous coin when another coin exists.
  const nonRepeat = [...scan.results].filter((row:any)=>!isSameAsLast(row.productId))
  const oldestPool = nonRepeat.length ? nonRepeat : [...scan.results]
  const oldest = oldestPool
    .sort((a: any, b: any) => lastAnalyzedAt(a.productId) - lastAnalyzedAt(b.productId))[0]

  if (oldest) {
    return {
      productId: oldest.productId,
      scan,
      reason: 'COOLDOWN_EXHAUSTED_OLDEST',
      heldUsd: Number(held.get(oldest.productId) || 0),
      availableCashUsd,
      previousProductId: lastProduct || null
    }
  }

  const fallback = config.watchlist.find(p=>p!==lastProduct) || 'XRP-USD'
  return {
    productId: fallback,
    scan,
    reason: 'WATCHLIST_FALLBACK',
    heldUsd: Number(held.get(fallback) || 0),
    availableCashUsd,
    previousProductId: lastProduct || null
  }
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
    selection = { productId: config.watchlist[0] || 'XRP-USD', scan: null as any, reason: 'SCAN_FAILED_FALLBACK', heldUsd: 0, availableCashUsd: 0, previousProductId: lastSelectedProduct() || null }
  }

  lastAttemptAt = Date.now()
  markAnalyzed(selection.productId)
  setSetting(LAST_SELECTED_KEY,selection.productId)
  publish('auto_agents_cycle_started', {
    intervalSeconds: settings.intervalSeconds,
    deepResearch: settings.deepResearch,
    productId: selection.productId,
    selectionReason: selection.reason,
    previousProductId: selection.previousProductId || null,
    heldUsd: selection.heldUsd || 0,
    availableCashUsd: selection.availableCashUsd || 0
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
