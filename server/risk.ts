import { config } from './config.js'
import { assessCapitalPreservationBuy,assessDailyRealizedLoss,assessEmergencyExecutionGate,assessExposureLimits,assessProfitFirstEntryEconomics,calculateRealizedSellMetrics,shouldClearLegacyLossHaltEmergency } from './riskCore.js'
import { getSetting, openPaperNotional, setSetting, livePlacedOrders, addEquitySnapshot, pruneEquitySnapshots, equitySnapshotsSince, recentEvents } from './db.js'
import { createMarketOrder, listAccounts, getProduct, previewMarketOrder, waitForOrderFill, listOpenOrders, cancelOrders } from './coinbase.js'
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
export const rollingRiskPauseActive = () => getSetting('rolling_risk_pause', 'false') === 'true'

export const migrateLegacyLossHaltEmergencyStop=()=>{
  const lossHaltActive=getSetting('loss_halt_active','false')==='true'
  const lossHaltTriggeredAt=getSetting('loss_halt_triggered_at','')
  const emergencyStopReason=getSetting('emergency_stop_reason','').toUpperCase()
  const latestManualEmergency=recentEvents(500)
    .find((event:any)=>String(event.type)==='emergency_stop_activated'&&String(event.agentId||'')==='manager')
  const latestManualEmergencyAt=String(latestManualEmergency?.createdAt||'')

  const shouldClear=shouldClearLegacyLossHaltEmergency({
    emergencyStop:emergencyStopActive(),
    lossHaltActive,
    emergencyStopReason,
    lossHaltTriggeredAt,
    latestManualEmergencyAt
  })

  if(shouldClear){
    setSetting('emergency_stop','false')
    setSetting('emergency_stop_reason','')
    publish('legacy_loss_halt_emergency_migrated',{
      lossHaltTriggeredAt:lossHaltTriggeredAt||null,
      previousEmergencyStopReason:emergencyStopReason||null,
      latestManualEmergencyAt:latestManualEmergencyAt||null,
      message:'Cleared stale global emergency flag; loss halt remains active for new BUYs while SELL exits stay enabled.'
    },'risk')
    return true
  }

  return false
}

export const getRollingRiskState=()=>{
  const raw=getSetting('rolling_risk_last_state','')
  if(!raw)return {paused:rollingRiskPauseActive(),drawdownPercent:0,limitPercent:config.rollingKillSwitchPercent,rollingWindowHours:24}
  try{return JSON.parse(raw)}catch{return {paused:rollingRiskPauseActive(),drawdownPercent:0,limitPercent:config.rollingKillSwitchPercent,rollingWindowHours:24}}
}

const migrateLegacyRollingEmergencyStop=()=>{
  if(!emergencyStopActive())return
  if(getSetting('rolling_pause_migration_done','false')==='true')return

  const relevant=recentEvents(120).find((event:any)=>
    ['rolling_kill_switch_triggered','emergency_stop_activated','emergency_stop_cleared'].includes(String(event.type))
  )

  if(relevant?.type==='rolling_kill_switch_triggered'){
    setSetting('emergency_stop','false')
    setSetting('rolling_risk_pause','true')
    setSetting('rolling_pause_migration_done','true')
    publish('legacy_rolling_stop_migrated',{
      message:'Converted old rolling kill-switch emergency stop into AUTO SAFE PAUSE so protective SELL exits remain available.'
    },'risk')
  }
}

let lastRollingEquitySnapshotAt=0

export const checkRollingEquityKillSwitch=async(currentPortfolioUsd:number)=>{
  const now=Date.now()
  const equity=Number(currentPortfolioUsd)
  const cutoff=new Date(now-config.rollingKillSwitchWindowMs).toISOString()

  pruneEquitySnapshots(cutoff)

  if(equity>0 && (now-lastRollingEquitySnapshotAt>=10000 || equitySnapshotsSince(cutoff).length===0)){
    addEquitySnapshot(equity,new Date(now).toISOString())
    lastRollingEquitySnapshotAt=now
  }

  const snapshots=equitySnapshotsSince(cutoff)
  const peakEquityUsd=snapshots.length
    ? Math.max(...snapshots.map(x=>x.equityUsd),equity)
    : equity
  const drawdownPercent=peakEquityUsd>0
    ? Math.max(0,((peakEquityUsd-equity)/peakEquityUsd)*100)
    : 0
  migrateLegacyRollingEmergencyStop()

  const thresholdBreached=drawdownPercent>=config.rollingKillSwitchPercent
  let paused=rollingRiskPauseActive()
  const recoveryStableMs=30*60*1000
  let canceledOrderIds:string[]=[]

  if(thresholdBreached){
    const wasPaused=paused
    paused=true
    setSetting('rolling_risk_pause','true')
    setSetting('rolling_risk_recovery_since','')

    if(!wasPaused){
      setSetting('rolling_risk_pause_started_at',new Date(now).toISOString())
      try{
        const openOrders=await listOpenOrders()
        const ids=openOrders.map((o:any)=>String(o.order_id||'')).filter(Boolean)
        if(ids.length){
          await cancelOrders(ids)
          canceledOrderIds=ids
        }
      }catch(error){
        publish('rolling_kill_switch_cancel_failed',{
          error:error instanceof Error?error.message:String(error)
        },'risk')
      }

      publish('rolling_kill_switch_triggered',{
        mode:'AUTO_SAFE_PAUSE',
        currentEquityUsd:equity,
        peakEquityUsd,
        drawdownPercent,
        limitPercent:config.rollingKillSwitchPercent,
        rollingWindowHours:24,
        canceledOrderIds,
        entryBehavior:'NEW_BUYS_BLOCKED',
        exitBehavior:'PROTECTIVE_SELLS_ALLOWED'
      },'risk')
    }
  }else if(paused){
    let recoverySince=Number(getSetting('rolling_risk_recovery_since','0'))||0
    if(!recoverySince){
      recoverySince=now
      setSetting('rolling_risk_recovery_since',String(recoverySince))
      publish('rolling_safe_recovery_started',{
        drawdownPercent,
        requiredStableMinutes:30
      },'risk')
    }

    if(now-recoverySince>=recoveryStableMs){
      paused=false
      setSetting('rolling_risk_pause','false')
      setSetting('rolling_risk_recovery_since','')
      publish('rolling_safe_pause_cleared',{
        drawdownPercent,
        stableMinutes:30,
        message:'AUTO SAFE PAUSE cleared automatically. New entries may resume.'
      },'risk')
    }
  }

  const state={
    blocked:paused,
    paused,
    thresholdBreached,
    currentEquityUsd:equity,
    peakEquityUsd:Number(peakEquityUsd.toFixed(2)),
    drawdownPercent:Number(drawdownPercent.toFixed(4)),
    limitPercent:config.rollingKillSwitchPercent,
    rollingWindowHours:24,
    recoveryStableMinutes:30,
    recoverySince:getSetting('rolling_risk_recovery_since','')||null,
    pauseStartedAt:getSetting('rolling_risk_pause_started_at','')||null,
    newBuysBlocked:paused,
    protectiveSellsAllowed:true,
    snapshotCount:snapshots.length,
    canceledOrderIds
  }
  setSetting('rolling_risk_last_state',JSON.stringify(state))
  return state
}

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

export const getOpenBotExposureSummary=()=>{
  const inventory=new Map<string,{qty:number,costUsd:number}>()

  for(const event of livePlacedOrders(5000)){
    const p:any=event.payload||{}
    const productId=String(p.productId||'').toUpperCase()
    if(!productId)continue

    const side=String(p.side||'').toUpperCase()
    const preview:any=p.preview||{}
    const fill:any=p.fill||{}
    const price=Number(p.actualFillPrice||fill.filledPrice||preview.est_average_filled_price||0)
    const notional=Number(p.notionalUsd||fill.filledValue||preview.order_total||0)
    const fee=Number(fill.totalFees||preview.commission_total||0)
    const qty=Number(p.executedQty||fill.executedQty||preview.base_size||(price>0&&notional>0?notional/price:0))
    if(!(price>0)||!(qty>0))continue

    const row=inventory.get(productId)||{qty:0,costUsd:0}
    if(side==='BUY'){
      row.qty+=qty
      row.costUsd+=notional+fee
      inventory.set(productId,row)
      continue
    }

    if(side==='SELL'&&row.qty>0){
      const sold=Math.min(qty,row.qty)
      const avgCost=row.qty>0?row.costUsd/row.qty:0
      const allocatedCost=avgCost*sold
      row.qty=Math.max(0,row.qty-sold)
      row.costUsd=Math.max(0,row.costUsd-allocatedCost)
      inventory.set(productId,row)
    }
  }

  const positions=[...inventory.entries()]
    .filter(([,row])=>row.qty>1e-12&&row.costUsd>0)
    .map(([productId,row])=>({productId,qty:row.qty,costUsd:row.costUsd}))

  return {
    positions,
    openBotPositions:positions.length,
    totalBotExposureUsd:positions.reduce((sum,row)=>sum+row.costUsd,0)
  }
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

  const marketDrawdownPercent =
    startEquity > 0 ? Math.max(0, ((startEquity - currentPortfolioUsd) / startEquity) * 100) : 0

  // Bot-trade loss guard:
  // Rebuild an approximate weighted-average cost basis only from orders this bot placed.
  // Market movement on pre-existing holdings does not trigger the hard daily lock.
  const inventory = new Map<string,{qty:number,costUsd:number}>()
  let realizedPnlTodayUsd = 0
  let realizedLossTodayUsd = 0
  let closedBotTradesToday = 0

  for (const event of livePlacedOrders(2000)) {
    const p:any = event.payload || {}
    const productId = String(p.productId || '').toUpperCase()
    if (!productId) continue

    const side = String(p.side || '').toUpperCase()
    const preview:any = p.preview || {}
    const price = Number(preview.est_average_filled_price || 0)
    const notional = Number(p.notionalUsd || preview.order_total || 0)
    const commission = Number(preview.commission_total || 0)
    const baseQty = Number(
      preview.base_size ||
      (price > 0 && notional > 0 ? notional / price : 0)
    )

    if (!(baseQty > 0) || !(price > 0)) continue

    const row = inventory.get(productId) || {qty:0,costUsd:0}

    if (side === 'BUY') {
      row.qty += baseQty
      row.costUsd += notional + commission
      inventory.set(productId,row)
      continue
    }

    if (side === 'SELL' && row.qty > 0) {
      const qtySold = Math.min(baseQty,row.qty)
      const avgCost = row.qty > 0 ? row.costUsd / row.qty : 0
      const allocatedCost = avgCost * qtySold
      const proceeds = (price * qtySold) - commission
      const pnl = proceeds - allocatedCost

      const eventDate = new Date(event.createdAt).toLocaleDateString('en-CA')
      if (eventDate === today) {
        realizedPnlTodayUsd += pnl
        if (pnl < 0) realizedLossTodayUsd += Math.abs(pnl)
        closedBotTradesToday += 1
      }

      row.qty -= qtySold
      row.costUsd = Math.max(0,row.costUsd - allocatedCost)
      inventory.set(productId,row)
    }
  }

  const dailyLoss=assessDailyRealizedLoss({
    startEquityUsd:startEquity,
    realizedLossUsd:realizedLossTodayUsd,
    maxDailyLossPercent:limits.maxDailyLossPercent
  })

  return {
    date: today,
    startEquityUsd: Number(startEquity.toFixed(2)),
    currentEquityUsd: Number(currentPortfolioUsd.toFixed(2)),
    marketDrawdownPercent: Number(marketDrawdownPercent.toFixed(4)),
    realizedBotPnlUsd: Number(realizedPnlTodayUsd.toFixed(4)),
    realizedBotLossUsd: Number(realizedLossTodayUsd.toFixed(4)),
    botLossPercent: Number(dailyLoss.botLossPercent.toFixed(4)),
    lossPercent: Number(dailyLoss.botLossPercent.toFixed(4)),
    closedBotTradesToday,
    limitPercent: dailyLoss.limitPercent,
    blocked: dailyLoss.blocked,
    mode: 'BOT_REALIZED_LOSS',
    marketDrawdownBlocksTrading: false,
    basisNote: 'Bot PnL uses Coinbase preview fill estimates until fill reconciliation is added.'
  }
}

export const evaluateLiveOrder = (input: LiveOrderPreflightInput) => {
  const reasons: string[] = []
  const limits = getRuntimeRiskLimits()
  const {
    productId, side, notionalUsd, totalPortfolioUsd, availableUsd, currentAssetUsd
  } = input
  const availableAssetUsd = Number(input.availableAssetUsd ?? currentAssetUsd)
  const normalMaxPositionUsd = totalPortfolioUsd * (limits.maxPositionPercent / 100)
  const smallAccountOverrideUsd = config.smallAccountMode
    ? Math.min(config.smallAccountMaxBuyUsd, totalPortfolioUsd * 0.10)
    : 0
  const maxPositionUsd = Math.max(normalMaxPositionUsd, smallAccountOverrideUsd)
  const maxExposureUsd = totalPortfolioUsd * (limits.maxTotalExposurePercent / 100)
  const daily = getDailyEquityGuard(totalPortfolioUsd)
  const botExposure=getOpenBotExposureSummary()
  const productAlreadyOpen=botExposure.positions.some(row=>row.productId===productId.toUpperCase())
  const exposure=assessExposureLimits({
    side,
    notionalUsd,
    currentAssetUsd,
    totalBotExposureUsd:botExposure.totalBotExposureUsd,
    openBotPositions:botExposure.openBotPositions,
    productAlreadyOpen,
    maxPositionUsd,
    maxTotalExposureUsd:maxExposureUsd,
    maxOpenBotPositions:config.maxOpenBotPositions
  })

  if (emergencyStopActive()) reasons.push('Emergency stop is active.')
  if (String(config.tradingMode).toLowerCase() !== 'live') reasons.push('TRADING_MODE is not live.')
  if (!config.liveTradingEnabled) reasons.push('Live trading is disabled in .env.')
  if (!productId || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(productId)) reasons.push('Invalid product ID.')
  if (!['BUY', 'SELL'].includes(side)) reasons.push('Invalid side.')
  if (!(notionalUsd > 0)) reasons.push('Order notional must be positive.')
  if (!(totalPortfolioUsd > 0)) reasons.push('Live portfolio value is unavailable.')
  if (side === 'BUY' && notionalUsd > availableUsd + 1e-8) reasons.push('Insufficient available USD for this buy.')
  if (side === 'SELL' && notionalUsd > availableAssetUsd + 1e-8) reasons.push('Insufficient available asset balance for this sell.')
  reasons.push(...exposure.reasons)

  if(side==='BUY'){
    if(getSetting('loss_halt_active','false')==='true'){
      reasons.push('Loss halt is active: new BUY entries are blocked until manually reset.')
    }

    const capitalGuard=assessCapitalPreservationBuy({
      enabled:config.capitalPreservationMode,
      realizedPnlTodayUsd:Number(daily.realizedBotPnlUsd||0),
      realizedLossTodayUsd:Number(daily.realizedBotLossUsd||0),
      openBotPositions:botExposure.openBotPositions
    })
    reasons.push(...capitalGuard.reasons)
  }

  if (daily.blocked) reasons.push('Bot realized-loss guard is active at ' + daily.botLossPercent.toFixed(2) + '% loss.')

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
    projectedExposureUsd: exposure.projectedAssetExposureUsd,
    projectedTotalBotExposureUsd: exposure.projectedTotalBotExposureUsd,
    totalBotExposureUsd:botExposure.totalBotExposureUsd,
    openBotPositions:botExposure.openBotPositions,
    projectedOpenBotPositions:exposure.projectedOpenBotPositions,
    maxOpenBotPositions:config.maxOpenBotPositions,
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

const ceilToIncrement = (value: number, increment: unknown) => {
  const step = Number(increment)
  if (!(step > 0) || !Number.isFinite(value)) return value
  const ceiled = Math.ceil((value - Number.EPSILON) / step) * step
  return Number(ceiled.toFixed(Math.min(12, decimalsFromIncrement(increment))))
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
  triggerPrice?: number
  baseSizeOverride?: number
  exitReason?: string
  avgEntryPrice?: number
  sourceLotOrderId?: string
  requiredNetProfitPercent?: number
  executionSource?: string
}) => {
  if (!['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(opts.decision)) {
    return { executed: false, reason: 'Decision is not BUY_CANDIDATE or SELL_CANDIDATE' }
  }

  const side = opts.decision === 'BUY_CANDIDATE' ? 'BUY' : 'SELL'
  const lossHaltActive=getSetting('loss_halt_active','false')==='true'
  let emergencyStopReason=getSetting('emergency_stop_reason','')

  if(migrateLegacyLossHaltEmergencyStop()) emergencyStopReason=''

  const executionGate=assessEmergencyExecutionGate({
    emergencyStop:emergencyStopActive(),
    tradingMode:config.tradingMode,
    liveTradingEnabled:config.liveTradingEnabled,
    autoTradingEnabled:config.autoTradingEnabled,
    manualApprovalRequired:config.manualApprovalRequired,
    lossHaltActive,
    protectiveExit:side==='SELL',
    emergencyStopReason
  })
  if(!executionGate.approved){
    return {executed:false,reason:executionGate.reasons[0],reasons:executionGate.reasons}
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

  const productId = opts.productId.toUpperCase()
  const cooldown = cooldownRemainingSeconds(productId)
  if (side === 'BUY' && cooldown > 0) {
    return { executed: false, reason: 'Live-trade cooldown is active for new BUY entries', cooldownRemainingSeconds: cooldown }
  }

  const [accounts, portfolio, product] = await Promise.all([
    listAccounts(),
    getChallengeSnapshot(),
    getProduct(productId)
  ])

  const productInfo: any = product
  const totalPortfolioUsd = Number(portfolio.currentPortfolioUsd || 0)
  const price = Number(productInfo?.price || 0)
  const triggerPrice = Number(opts.triggerPrice || 0)
  const slippageReferencePrice = triggerPrice > 0 ? triggerPrice : price

  if (!(totalPortfolioUsd > 0) || !(price > 0)) {
    return { executed: false, reason: 'Missing portfolio value or product price' }
  }

  const rollingKillSwitch=await checkRollingEquityKillSwitch(totalPortfolioUsd)
  if(side==='BUY' && rollingKillSwitch.blocked){
    return {
      executed:false,
      reason:'AUTO SAFE PAUSE is active: new BUY entries are temporarily blocked while protective SELL exits remain enabled',
      rollingKillSwitch
    }
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
  const botExposure=getOpenBotExposureSummary()
  const productAlreadyOpen=botExposure.positions.some(row=>row.productId===productId)

  if(side==='BUY'&&!productAlreadyOpen&&botExposure.openBotPositions>=config.maxOpenBotPositions){
    return {
      executed:false,
      reason:'Maximum number of open bot positions has been reached',
      openBotPositions:botExposure.openBotPositions,
      maxOpenBotPositions:config.maxOpenBotPositions,
      totalBotExposureUsd:botExposure.totalBotExposureUsd
    }
  }

  let notionalUsd = 0
  let baseSize: number | undefined
  let quoteSizeUsd: number | undefined

  if (side === 'BUY') {
    const maxPositionUsd=Math.max(
      maxFromPercent,
      config.smallAccountMode
        ? Math.min(config.smallAccountMaxBuyUsd,totalPortfolioUsd*0.10)
        : 0
    )
    const remainingPositionUsd=Math.max(0,maxPositionUsd-currentAssetUsd)
    const remainingTotalExposureUsd=Math.max(0,maxExposureUsd-botExposure.totalBotExposureUsd)
    const quoteMin = Math.max(config.minLiveOrderUsd, Number(productInfo?.quote_min_size || 0))
    const quoteMax = Number(productInfo?.quote_max_size || Infinity)

    // Market BUYs use quote_size in USD, so an expensive coin such as ETH/BTC
    // is purchased fractionally. Never require the price of one whole coin.
    const smallAccountRiskCapUsd = config.smallAccountMode
      ? Math.max(
          maxFromPercent,
          Math.min(config.smallAccountMaxBuyUsd, totalPortfolioUsd * 0.10)
        )
      : maxFromPercent

    const safeMaxBuyUsd = Math.min(
      smallAccountRiskCapUsd,
      hardCap,
      remainingPositionUsd,
      remainingTotalExposureUsd,
      availableUsd,
      quoteMax
    )

    if (!(safeMaxBuyUsd > 0)) {
      return {
        executed:false,
        reason:'No spendable USD is available inside the current risk limits',
        productId,
        side,
        availableUsd,
        maxFromPercent,
        hardCap,
        remainingTotalExposureUsd
      }
    }

    if (safeMaxBuyUsd + 1e-8 < quoteMin) {
      return {
        executed:false,
        reason:'Safe fractional BUY amount is below Coinbase minimum',
        productId,
        side,
        availableUsd,
        safeMaxBuyUsd,
        coinbaseMinimumUsd:quoteMin,
        maxFromPercent,
        hardCap,
        remainingTotalExposureUsd,
        note:'Coin price is not the required order size; Coinbase market BUYs use fractional quote-size USD.'
      }
    }

    const quoteIncrement = productInfo?.quote_increment || 0.01
    const minExecutableQuoteUsd = ceilToIncrement(quoteMin, quoteIncrement)

    quoteSizeUsd = floorToIncrement(safeMaxBuyUsd, quoteIncrement)

    // If flooring an exactly-$10 style cap produces $9.99 because of the
    // exchange increment, snap up to the smallest valid Coinbase amount,
    // but only when that amount still fits every safety cap.
    if (
      quoteSizeUsd + 1e-8 < minExecutableQuoteUsd &&
      minExecutableQuoteUsd <= safeMaxBuyUsd + 1e-8 &&
      minExecutableQuoteUsd <= quoteMax + 1e-8
    ) {
      quoteSizeUsd = minExecutableQuoteUsd
    }

    if (quoteSizeUsd > quoteMax) quoteSizeUsd = floorToIncrement(quoteMax, quoteIncrement)

    if (!(quoteSizeUsd > 0) || quoteSizeUsd + 1e-8 < minExecutableQuoteUsd) {
      return {
        executed:false,
        reason:'Rounded fractional BUY amount fell below Coinbase minimum',
        quoteSizeUsd,
        coinbaseMinimumUsd:quoteMin,
        minimumExecutableUsd:minExecutableQuoteUsd,
        availableUsd,
        safeMaxBuyUsd
      }
    }

    notionalUsd = quoteSizeUsd
  } else {
    const baseIncrement = productInfo?.base_increment || 0.00000001
    const baseMin = Number(productInfo?.base_min_size || 0)
    const baseMax = Number(productInfo?.base_max_size || Infinity)
    // SELL exits must not inherit our BUY-side dollar minimum.
    // Use Coinbase's base minimum and let the live preview be the final exchange gate.
    const minBaseRequired = baseMin
    const minExecutableBase = ceilToIncrement(minBaseRequired, baseIncrement)
    const requestedBase = Number(opts.baseSizeOverride || 0)
    const targetNotional = Math.min(hardCap, availableAssetUsd)
    const targetBase = requestedBase > 0
      ? Math.min(availableBase, requestedBase, baseMax)
      : Math.min(
          availableBase,
          targetNotional / price,
          baseMax
        )

    baseSize = floorToIncrement(targetBase, baseIncrement)

    if (baseSize < minExecutableBase && availableBase >= minExecutableBase && minExecutableBase <= baseMax) {
      baseSize = minExecutableBase
    }

    notionalUsd = baseSize * price
    const minimumNotionalUsd = minExecutableBase * price

    if (
      !(baseSize > 0) ||
      baseSize < minExecutableBase ||
      baseSize > baseMax
    ) {
      return {
        executed: false,
        reason: 'Available holding cannot meet Coinbase SELL size minimum',
        baseSize,
        baseMin,
        minExecutableBase,
        minimumNotionalUsd,
        availableBase,
        availableAssetUsd,
        hardCap
      }
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

    const estimatedFillPrice = Number(preview.est_average_filled_price || 0)

    if(side==='BUY'){
      const buyCommissionUsd=Number(preview.commission_total||0)
      const buyNotionalForFee=Math.max(
        Number(preview.quote_size||0),
        Number(notionalUsd||0)
      )
      const entryEconomics=assessProfitFirstEntryEconomics({
        buyNotionalUsd:buyNotionalForFee,
        buyCommissionUsd,
        takeProfitPercent:config.takeProfitPercent,
        maxSlippagePercent:config.maxSlippagePercent,
        maxRequiredGrossProfitPercent:config.maxRequiredGrossProfitPercent
      })

      if(!entryEconomics.approved){
        const reason=
          'BUY blocked: fees make the required gross move too large for the profit-first setup'
        publish('live_order_preview_rejected',{
          productId,
          side,
          notionalUsd,
          preview,
          reason,
          entryEconomics
        },'risk')
        return {
          executed:false,
          reason,
          preflight,
          preview,
          entryEconomics
        }
      }
    }

    if (
      side === 'SELL' &&
      String(opts.exitReason || '').includes('TAKE_PROFIT')
    ) {
      const sellCommission = Number(preview.commission_total || 0)
      const avgEntryPrice = Number(opts.avgEntryPrice || 0)
      const sellQty = Number(baseSize || 0)
      const requiredNetProfitPercent = Math.max(
        config.takeProfitPercent,
        Number(opts.requiredNetProfitPercent || 0)
      )
      if (avgEntryPrice > 0 && sellQty > 0 && estimatedFillPrice > 0) {
        const costBasisUsd = avgEntryPrice * sellQty
        const estimatedNetProceedsUsd = (estimatedFillPrice * sellQty) - sellCommission
        const estimatedNetProfitUsd = estimatedNetProceedsUsd - costBasisUsd
        const estimatedNetProfitPercent = costBasisUsd > 0
          ? (estimatedNetProfitUsd / costBasisUsd) * 100
          : 0
        const requiredNetProfitUsd = Math.max(
          config.smallAccountMinNetProfitUsd,
          costBasisUsd * (requiredNetProfitPercent / 100)
        )
        if (
          estimatedNetProfitUsd + 1e-8 < requiredNetProfitUsd ||
          estimatedNetProfitPercent + 1e-8 < requiredNetProfitPercent
        ) {
          return {
            executed: false,
            reason: 'Take-profit preview is below the required net profit after fees',
            preflight,
            preview,
            estimatedNetProfitUsd,
            estimatedNetProfitPercent,
            requiredNetProfitUsd,
            requiredNetProfitPercent,
            costBasisUsd,
            estimatedNetProceedsUsd
          }
        }
      }
    }

    const adverseSlippagePercent =
      estimatedFillPrice > 0 && slippageReferencePrice > 0
        ? side === 'BUY'
          ? Math.max(0, ((estimatedFillPrice - slippageReferencePrice) / slippageReferencePrice) * 100)
          : Math.max(0, ((slippageReferencePrice - estimatedFillPrice) / slippageReferencePrice) * 100)
        : 0

    if (adverseSlippagePercent > config.maxSlippagePercent) {
      const reason =
        'Preview slippage ' + adverseSlippagePercent.toFixed(3) +
        '% exceeds max ' + config.maxSlippagePercent.toFixed(3) + '%'
      publish('live_order_preview_rejected', {
        productId,
        side,
        notionalUsd,
        preview,
        referencePrice: slippageReferencePrice,
        estimatedFillPrice,
        adverseSlippagePercent,
        maxSlippagePercent: config.maxSlippagePercent,
        reason
      }, 'risk')
      return { executed: false, reason, preflight, preview, adverseSlippagePercent }
    }

    publish('live_order_preview_approved', {
      productId,
      side,
      notionalUsd,
      commissionTotal: preview.commission_total || null,
      estimatedFillPrice: preview.est_average_filled_price || null,
      adverseSlippagePercent,
      maxSlippagePercent: config.maxSlippagePercent,
      warnings: preview.warning || []
    }, 'execution')

    const orderResult = await createMarketOrder({
      productId,
      side,
      quoteSizeUsd,
      baseSize,
      previewId: preview.preview_id
    })

    const orderId=String(orderResult.success_response?.order_id||'')
    const fill=await waitForOrderFill(orderId,10000)
    const placedAt = new Date().toISOString()
    const actualFillPrice=Number(fill.filledPrice||0)
    const actualSlippagePercent =
      actualFillPrice>0 && slippageReferencePrice>0
        ? side==='BUY'
          ? Math.max(0,((actualFillPrice-slippageReferencePrice)/slippageReferencePrice)*100)
          : Math.max(0,((slippageReferencePrice-actualFillPrice)/slippageReferencePrice)*100)
        : 0

    const executedQty=Number(fill.executedQty||baseSize||0)
    const sellCommission=side==='SELL'?Number(preview.commission_total||0):0
    const realizedSell=calculateRealizedSellMetrics({
      avgEntryPrice:side==='SELL'?Number(opts.avgEntryPrice||0):0,
      executedQty,
      actualFillPrice:side==='SELL'?actualFillPrice:0,
      sellCommission
    })
    const sellCostBasisUsd=realizedSell.sellCostBasisUsd
    const realizedNetProceedsUsd=realizedSell.realizedNetProceedsUsd
    const realizedNetProfitUsd=realizedSell.realizedNetProfitUsd
    const realizedNetProfitPercent=realizedSell.realizedNetProfitPercent

    setSetting('live_last_order_at_' + productId, placedAt)
    setSetting('live_last_order_id_' + productId, orderId)

    if(
      side==='SELL' &&
      realizedNetProfitUsd!=null &&
      Number.isFinite(realizedNetProfitUsd) &&
      realizedNetProfitUsd<0
    ){
      setSetting('loss_halt_active','true')
      setSetting('loss_halt_triggered_at',placedAt)
      setSetting('loss_halt_product',productId)
      setSetting('loss_halt_amount_usd',String(realizedNetProfitUsd))

      let canceledOrderIds:string[]=[]
      try{
        const openOrders=await listOpenOrders()
        const ids=openOrders.map((o:any)=>String(o.order_id||'')).filter(Boolean)
        if(ids.length){
          await cancelOrders(ids)
          canceledOrderIds=ids
        }
      }catch(error){
        publish('loss_halt_cancel_failed',{
          productId,
          error:error instanceof Error?error.message:String(error)
        },'risk')
      }

      publish('loss_halt_triggered',{
        productId,
        realizedNetProfitUsd,
        realizedNetProfitPercent,
        message:'ANY realized loss blocks new BUYs while existing positions may still SELL to exit.',
        canceledOrderIds
      },'risk')
    }

    publish('live_order_placed', {
      productId,
      side,
      notionalUsd,
      orderId,
      placedAt,
      preview,
      fill,
      actualFillPrice,
      executedQty:fill.executedQty,
      actualSlippagePercent,
      sourceLotOrderId:opts.sourceLotOrderId||null,
      exitReason:opts.exitReason||null,
      executionSource:opts.executionSource||'UNKNOWN',
      realizedNetProfitUsd,
      realizedNetProfitPercent,
      realizedNetProceedsUsd:side==='SELL'?realizedNetProceedsUsd:null,
      sellCostBasisUsd:side==='SELL'?sellCostBasisUsd:null
    }, 'execution')

    return {
      executed: true,
      productId,
      side,
      notionalUsd,
      quoteSizeUsd,
      baseSize,
      confidencePercent,
      orderId,
      orderResult,
      preview,
      fill,
      actualFillPrice,
      executedQty:fill.executedQty,
      actualSlippagePercent,
      preflight
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publish('live_order_failed', { productId, side, notionalUsd, error: message }, 'execution')
    return { executed: false, reason: message, preflight }
  }
}
