import { config } from './config.js'
import { getSetting, openPaperNotional, setSetting } from './db.js'
import { createMarketOrder, listAccounts, getProduct, previewMarketOrder } from './coinbase.js'
import { getChallengeSnapshot } from './challenge.js'
import { publish } from './events.js'

export interface PaperOrderRequest {
  productId: string
  side: 'BUY' | 'SELL'
  size: number
  price: number
}

export interface RuntimeRiskLimits {
  maxPositionPercent: number
  maxTotalExposurePercent: number
  maxDailyLossPercent: number
}

const storedNumber = (key: string, fallback: number) => {
  const value = Number(getSetting(key, String(fallback)))
  return Number.isFinite(value) ? value : fallback
}

export const getRuntimeRiskLimits = (): RuntimeRiskLimits => ({
  maxPositionPercent: storedNumber('risk_max_position_percent', config.maxPositionPercent),
  maxTotalExposurePercent: storedNumber('risk_max_total_exposure_percent', config.maxTotalExposurePercent),
  maxDailyLossPercent: storedNumber('risk_max_daily_loss_percent', config.maxDailyLossPercent)
})

export const saveRuntimeRiskLimits = (input: Partial<RuntimeRiskLimits>) => {
  const current = getRuntimeRiskLimits()
  const next = {
    maxPositionPercent: Math.max(0.1, Math.min(20, Number(input.maxPositionPercent ?? current.maxPositionPercent))),
    maxTotalExposurePercent: Math.max(1, Math.min(50, Number(input.maxTotalExposurePercent ?? current.maxTotalExposurePercent))),
    maxDailyLossPercent: Math.max(0.1, Math.min(10, Number(input.maxDailyLossPercent ?? current.maxDailyLossPercent)))
  }
  if (next.maxPositionPercent > next.maxTotalExposurePercent) next.maxPositionPercent = next.maxTotalExposurePercent
  setSetting('risk_max_position_percent', String(next.maxPositionPercent))
  setSetting('risk_max_total_exposure_percent', String(next.maxTotalExposurePercent))
  setSetting('risk_max_daily_loss_percent', String(next.maxDailyLossPercent))
  return next
}

export const emergencyStopActive = () => getSetting('emergency_stop', 'false') === 'true'

export const evaluatePaperOrder = (order: PaperOrderRequest) => {
  const reasons: string[] = []
  const limits = getRuntimeRiskLimits()
  const notional = order.size * order.price
  const maxPositionUsd = config.paperStartingBalanceUsd * (limits.maxPositionPercent / 100)
  const maxExposureUsd = config.paperStartingBalanceUsd * (limits.maxTotalExposurePercent / 100)
  const currentExposure = openPaperNotional()
  if (emergencyStopActive()) reasons.push('Emergency stop is active.')
  if (!order.productId || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(order.productId)) reasons.push('Invalid product ID.')
  if (!['BUY', 'SELL'].includes(order.side)) reasons.push('Invalid side.')
  if (!(order.size > 0) || !(order.price > 0)) reasons.push('Size and price must be positive.')
  if (notional > maxPositionUsd) reasons.push('Position notional exceeds the hard ' + limits.maxPositionPercent + '% paper-capital limit.')
  if (currentExposure + notional > maxExposureUsd) reasons.push('Total paper exposure would exceed ' + limits.maxTotalExposurePercent + '%.')
  return { approved: reasons.length === 0, reasons, notional, currentExposure, maxPositionUsd, maxExposureUsd, limits }
}

export interface LiveOrderPreflightInput {
  productId: string
  side: 'BUY' | 'SELL'
  notionalUsd: number
  totalPortfolioUsd: number
  availableUsd: number
  currentAssetUsd: number
  availableAssetUsd?: number
}

export const getDailyEquityGuard = (currentPortfolioUsd: number) => {
  const limits = getRuntimeRiskLimits()
  const today = new Date().toLocaleDateString('en-CA')
  const storedDate = getSetting('live_daily_equity_date', '')
  let startEquity = Number(getSetting('live_daily_equity_start_usd', '0'))
  if (storedDate !== today || !(startEquity > 0)) {
    startEquity = currentPortfolioUsd
    setSetting('live_daily_equity_date', today)
    setSetting('live_daily_equity_start_usd', String(currentPortfolioUsd))
  }
  const lossPercent = startEquity > 0 ? Math.max(0, ((startEquity - currentPortfolioUsd) / startEquity) * 100) : 0
  return {
    date: today,
    startEquityUsd: Number(startEquity.toFixed(2)),
    currentEquityUsd: Number(currentPortfolioUsd.toFixed(2)),
    lossPercent: Number(lossPercent.toFixed(4)),
    limitPercent: limits.maxDailyLossPercent,
    blocked: lossPercent >= limits.maxDailyLossPercent
  }
}

export const evaluateLiveOrder = (input: LiveOrderPreflightInput) => {
  const reasons: string[] = []
  const limits = getRuntimeRiskLimits()
  const {
    productId, side, notionalUsd, totalPortfolioUsd, availableUsd, currentAssetUsd
  } = input
  const availableAssetUsd = Number(input.availableAssetUsd ?? currentAssetUsd)
  const maxPositionUsd = totalPortfolioUsd * (limits.maxPositionPercent / 100)
  const maxExposureUsd = totalPortfolioUsd * (limits.maxTotalExposurePercent / 100)
  const daily = getDailyEquityGuard(totalPortfolioUsd)

  if (emergencyStopActive()) reasons.push('Emergency stop is active.')
  if (String(config.tradingMode).toLowerCase() !== 'live') reasons.push('TRADING_MODE is not live.')
  if (!config.liveTradingEnabled) reasons.push('Live trading is disabled in .env.')
  if (!productId || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(productId)) reasons.push('Invalid product ID.')
  if (!['BUY', 'SELL'].includes(side)) reasons.push('Invalid side.')
  if (!(notionalUsd > 0)) reasons.push('Order notional must be positive.')
  if (!(totalPortfolioUsd > 0)) reasons.push('Live portfolio value is unavailable.')
  if (notionalUsd > maxPositionUsd + 1e-8) reasons.push('Order exceeds the hard ' + limits.maxPositionPercent + '% live position cap.')
  if (side === 'BUY' && notionalUsd > availableUsd + 1e-8) reasons.push('Insufficient available USD for this buy.')
  if (side === 'SELL' && notionalUsd > availableAssetUsd + 1e-8) reasons.push('Insufficient available asset balance for this sell.')
  const projectedExposure = side === 'BUY' ? currentAssetUsd + notionalUsd : Math.max(0, currentAssetUsd - notionalUsd)
  if (projectedExposure > maxExposureUsd + 1e-8) reasons.push('Projected asset exposure exceeds ' + limits.maxTotalExposurePercent + '% of the live portfolio.')
  if (daily.blocked) reasons.push('Daily loss guard is active at ' + daily.lossPercent.toFixed(2) + '% loss.')

  return {
    approved: reasons.length === 0,
    reasons,
    productId,
    side,
    notionalUsd,
    totalPortfolioUsd,
    availableUsd,
    currentAssetUsd,
    availableAssetUsd,
    projectedExposureUsd: projectedExposure,
    maxPositionUsd,
    maxExposureUsd,
    daily,
    limits,
    manualApprovalRequired: config.manualApprovalRequired,
    automaticTradingEnabled: config.autoTradingEnabled,
    liveTradingEnabled: config.liveTradingEnabled,
    tradingMode: config.tradingMode
  }
}

const decimalsFromIncrement = (increment: unknown) => {
  const raw = String(increment ?? '')
  if (!raw.includes('.')) return 0
  return raw.replace(/0+$/, '').split('.')[1]?.length || 0
}

const floorToIncrement = (value: number, increment: unknown) => {
  const step = Number(increment)
  if (!(step > 0) || !Number.isFinite(value)) return value
  const floored = Math.floor((value + Number.EPSILON) / step) * step
  return Number(floored.toFixed(Math.min(12, decimalsFromIncrement(increment))))
}

const normalizedConfidencePercent = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return NaN
  return n >= 0 && n <= 1 ? n * 100 : n
}

const cooldownRemainingSeconds = (productId: string) => {
  const raw = getSetting('live_last_order_at_' + productId, '')
  if (!raw) return 0
  const at = new Date(raw).getTime()
  if (!Number.isFinite(at)) return 0
  const elapsed = (Date.now() - at) / 1000
  return Math.max(0, Math.ceil(config.autoTradeCooldownSeconds - elapsed))
}

export const tryLimitedLiveExecution = async (opts: {
  productId: string
  decision: string
  confidence?: number
}) => {
  if (String(config.tradingMode).toLowerCase() !== 'live') {
    return { executed: false, reason: 'TRADING_MODE is not live' }
  }
  if (!config.liveTradingEnabled || !config.autoTradingEnabled) {
    return { executed: false, reason: 'Live or auto trading is disabled in .env' }
  }
  if (emergencyStopActive()) {
    return { executed: false, reason: 'Emergency stop is active' }
  }
  if (!['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(opts.decision)) {
    return { executed: false, reason: 'Decision is not BUY_CANDIDATE or SELL_CANDIDATE' }
  }

  const confidencePercent = normalizedConfidencePercent(opts.confidence)
  if (!Number.isFinite(confidencePercent) || confidencePercent < config.autoTradeMinConfidencePercent) {
    return {
      executed: false,
      reason: 'Candidate confidence is below the automatic live-trade threshold',
      confidencePercent: Number.isFinite(confidencePercent) ? confidencePercent : null,
      requiredConfidencePercent: config.autoTradeMinConfidencePercent
    }
  }

  const side = opts.decision === 'BUY_CANDIDATE' ? 'BUY' : 'SELL'
  const productId = opts.productId.toUpperCase()
  const cooldown = cooldownRemainingSeconds(productId)
  if (cooldown > 0) {
    return { executed: false, reason: 'Live-trade cooldown is active', cooldownRemainingSeconds: cooldown }
  }

  const [accounts, portfolio, product] = await Promise.all([
    listAccounts(),
    getChallengeSnapshot(),
    getProduct(productId)
  ])

  const productInfo: any = product
  const totalPortfolioUsd = Number(portfolio.currentPortfolioUsd || 0)
  const price = Number(productInfo?.price || 0)

  if (!(totalPortfolioUsd > 0) || !(price > 0)) {
    return { executed: false, reason: 'Missing portfolio value or product price' }
  }
  if (productInfo?.trading_disabled === true || productInfo?.is_disabled === true || productInfo?.cancel_only === true || productInfo?.limit_only === true) {
    return { executed: false, reason: 'Coinbase product is not available for market trading right now' }
  }

  const balanceValue = (b: any) => Number(b?.value ?? b ?? 0) || 0
  const baseCurrency = productId.split('-')[0]
  const usdAccount = accounts.find((a: any) => String(a.currency).toUpperCase() === 'USD')
  const baseAccount = accounts.find((a: any) => String(a.currency).toUpperCase() === baseCurrency)

  const availableUsd = balanceValue(usdAccount?.availableBalance)
  const availableBase = balanceValue(baseAccount?.availableBalance)
  const heldBase = balanceValue(baseAccount?.hold)
  const currentAssetUsd = (availableBase + heldBase) * price
  const availableAssetUsd = availableBase * price

  const limits = getRuntimeRiskLimits()
  const maxFromPercent = totalPortfolioUsd * (limits.maxPositionPercent / 100)
  const hardCap = config.maxLiveOrderUsd
  const maxExposureUsd = totalPortfolioUsd * (limits.maxTotalExposurePercent / 100)

  let notionalUsd = 0
  let baseSize: number | undefined
  let quoteSizeUsd: number | undefined

  if (side === 'BUY') {
    const remainingExposure = Math.max(0, maxExposureUsd - currentAssetUsd)
    const desiredBeforeCash = Math.min(maxFromPercent, hardCap, remainingExposure)
    const quoteMin = Math.max(config.minLiveOrderUsd, Number(productInfo?.quote_min_size || 0))
    const fundingRequiredUsd = Math.max(0, desiredBeforeCash - availableUsd)

    if (fundingRequiredUsd > 0.01 && desiredBeforeCash >= quoteMin) {
      return {
        executed: false,
        reason: 'Insufficient available USD for target BUY size',
        productId,
        side,
        availableUsd,
        desiredNotionalUsd: desiredBeforeCash,
        fundingRequiredUsd,
        quoteMin
      }
    }

    const raw = Math.min(desiredBeforeCash, availableUsd)
    quoteSizeUsd = floorToIncrement(raw, productInfo?.quote_increment || 0.01)
    const quoteMax = Number(productInfo?.quote_max_size || Infinity)
    if (!(quoteSizeUsd > 0) || quoteSizeUsd < quoteMin) {
      return { executed: false, reason: 'Calculated BUY size is below the configured/Coinbase minimum', quoteSizeUsd, quoteMin, availableUsd, desiredNotionalUsd: desiredBeforeCash }
    }
    if (quoteSizeUsd > quoteMax) quoteSizeUsd = floorToIncrement(quoteMax, productInfo?.quote_increment || 0.01)
    notionalUsd = quoteSizeUsd
  } else {
    const rawNotional = Math.min(maxFromPercent, hardCap, availableAssetUsd)
    const rawBase = Math.min(
      availableBase,
      rawNotional / price,
      Number(productInfo?.base_max_size || Infinity)
    )
    baseSize = floorToIncrement(rawBase, productInfo?.base_increment || 0.00000001)
    const baseMin = Number(productInfo?.base_min_size || 0)
    notionalUsd = baseSize * price
    if (!(baseSize > 0) || baseSize < baseMin || notionalUsd < config.minLiveOrderUsd) {
      return { executed: false, reason: 'Calculated SELL size is below the configured/Coinbase minimum', baseSize, baseMin, notionalUsd }
    }
  }

  const preflight = evaluateLiveOrder({
    productId,
    side,
    notionalUsd,
    totalPortfolioUsd,
    availableUsd,
    currentAssetUsd,
    availableAssetUsd
  })

  if (!preflight.approved) {
    publish('live_order_rejected', { productId, side, notionalUsd, reasons: preflight.reasons }, 'risk')
    return { executed: false, reason: preflight.reasons.join('; '), preflight }
  }

  try {
    const preview = await previewMarketOrder({ productId, side, quoteSizeUsd, baseSize })
    const previewErrors = Array.isArray(preview.errs) ? preview.errs.filter(Boolean) : []
    if (previewErrors.length > 0 || !preview.preview_id) {
      const reason = previewErrors.length > 0 ? previewErrors.join(', ') : 'Coinbase preview did not return a preview_id'
      publish('live_order_preview_rejected', { productId, side, notionalUsd, preview, reason }, 'risk')
      return { executed: false, reason, preflight, preview }
    }

    publish('live_order_preview_approved', {
      productId,
      side,
      notionalUsd,
      commissionTotal: preview.commission_total || null,
      estimatedFillPrice: preview.est_average_filled_price || null,
      warnings: preview.warning || []
    }, 'execution')

    const orderResult = await createMarketOrder({
      productId,
      side,
      quoteSizeUsd,
      baseSize,
      previewId: preview.preview_id
    })

    const placedAt = new Date().toISOString()
    setSetting('live_last_order_at_' + productId, placedAt)
    setSetting('live_last_order_id_' + productId, String(orderResult.success_response?.order_id || ''))

    publish('live_order_placed', {
      productId,
      side,
      notionalUsd,
      orderId: orderResult.success_response?.order_id || null,
      placedAt,
      preview
    }, 'execution')

    return {
      executed: true,
      productId,
      side,
      notionalUsd,
      quoteSizeUsd,
      baseSize,
      confidencePercent,
      orderId: orderResult.success_response?.order_id || null,
      orderResult,
      preview,
      preflight
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publish('live_order_failed', { productId, side, notionalUsd, error: message }, 'execution')
    return { executed: false, reason: message, preflight }
  }
}
