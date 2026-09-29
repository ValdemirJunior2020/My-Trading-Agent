import { config } from './config.js'
import { advanceProfitRecyclePool,assessAlreadyProfitableSell,assessCapitalPreservationBuy,assessDailyRealizedLoss,assessEmergencyExecutionGate,assessExposureLimits,calculateRealizedSellMetrics,shouldClearLegacyLossHaltEmergency } from './riskCore.js'
import { getSetting, setSetting, livePlacedOrders, addEquitySnapshot, pruneEquitySnapshots, equitySnapshotsSince, recentEvents } from './db.js'
import { createMarketOrder, listAccounts, getProduct, previewMarketOrder, waitForOrderFill, listOpenOrders, cancelOrders } from './coinbase.js'
import { getChallengeSnapshot } from './challenge.js'
import { publish } from './events.js'

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
  // Production sizing is intentionally fixed here so stale saved UI settings
  // cannot silently re-enable the old 5% / 25% limits.
  maxPositionPercent: config.maxPositionPercent,
  maxTotalExposurePercent: config.maxTotalExposurePercent,
  maxDailyLossPercent: storedNumber('risk_max_daily_loss_percent', config.maxDailyLossPercent)
})


const getProfitRecycleState=()=>{
  const baselineUsd=Math.max(0,storedNumber('profit_recycle_baseline_usd',0))
  const lockedUsd=Math.max(0,storedNumber('profit_recycle_locked_usd',0))
  return {
    baselineUsd,
    lockedUsd,
    thresholdUsd:baselineUsd>0?baselineUsd*2:0
  }
}

const recordProfitableSellForRecyclePool=(input:{
  productId:string
  realizedNetProceedsUsd:number
  realizedNetProfitUsd:number
})=>{
  if(!(Number(input.realizedNetProfitUsd)>0)||!(Number(input.realizedNetProceedsUsd)>0)){
    return getProfitRecycleState()
  }

  const current=getProfitRecycleState()
  const next=advanceProfitRecyclePool({
    baselineUsd:current.baselineUsd,
    lockedUsd:current.lockedUsd,
    profitableSellNetProceedsUsd:Number(input.realizedNetProceedsUsd),
    multiplier:2
  })

  setSetting('profit_recycle_baseline_usd',String(next.baselineUsd))
  setSetting('profit_recycle_locked_usd',String(next.lockedUsd))

  publish(next.doubled?'profit_recycle_pool_unlocked':'profit_recycle_pool_locked',{
    productId:input.productId,
    realizedNetProceedsUsd:Number(input.realizedNetProceedsUsd),
    realizedNetProfitUsd:Number(input.realizedNetProfitUsd),
    baselineUsd:next.baselineUsd,
    lockedUsd:next.lockedUsd,
    unlockedUsd:next.unlockedUsd,
    thresholdUsd:next.thresholdUsd,
    rule:'PROFITABLE_SELL_PROCEEDS_STAY_LOCKED_UNTIL_RECYCLE_POOL_DOUBLES'
  },'risk')

  return next
}

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

export const triggerUnrealizedPriceLossPause=(input:{
  productId:string
  livePrice:number
  stopPrice:number
  estimatedNetProfitUsd:number
})=>{
  const alreadyPaused=getSetting('loss_halt_active','false')==='true'
  if(!alreadyPaused){
    const triggeredAt=new Date().toISOString()
    setSetting('loss_halt_active','true')
    setSetting('loss_halt_triggered_at',triggeredAt)
    setSetting('loss_halt_product',input.productId)
    setSetting('loss_halt_amount_usd',String(input.estimatedNetProfitUsd))
    setSetting('loss_halt_reason','UNREALIZED_PRICE_STOP')
    publish('unrealized_price_loss_pause',{
      ...input,
      triggeredAt,
      behavior:'NEW_BUYS_PAUSED_NO_LOSS_SELL_EXISTING_POSITIONS_WAIT_FOR_PROFIT'
    },'risk')
  }
  return {
    paused:true,
    productId:input.productId,
    reason:'UNREALIZED_PRICE_STOP',
    alreadyPaused
  }
}

export const initializeSingleLossStopModel=()=>{
  if(getSetting('single_loss_stop_model_v4_initialized','false')==='true')return false

  const singleLossLocked=getSetting('single_loss_kill_switch_locked','false')==='true'
  const rollingLocked=getSetting('rolling_kill_switch_locked','false')==='true'
  const hadLossHalt=getSetting('loss_halt_active','false')==='true'
  const hadEmergency=emergencyStopActive()
  const previousReason=getSetting('emergency_stop_reason','')

  // Only clear stale legacy stop state when no current production kill switch
  // is latched. Never auto-clear a real single-loss or rolling-equity lock.
  if(!singleLossLocked&&!rollingLocked){
    setSetting('loss_halt_active','false')
    setSetting('loss_halt_triggered_at','')
    setSetting('loss_halt_product','')
    setSetting('loss_halt_amount_usd','')
    if(!['MANUAL'].includes(previousReason.toUpperCase())){
      setSetting('emergency_stop','false')
      setSetting('emergency_stop_reason','')
    }
  }

  if(singleLossLocked&&!rollingLocked&&['SINGLE_REALIZED_LOSS','LOSS_GUARD'].includes(previousReason.toUpperCase())){
    setSetting('loss_guard_active','true')
    setSetting('loss_halt_active','true')
    setSetting('emergency_stop','false')
    setSetting('emergency_stop_reason','')
    publish('single_loss_stop_model_migrated',{
      mode:'ENTRY_PAUSE_ONLY',
      message:'Converted legacy first-loss full emergency into BUY pause with existing-position exits still active.'
    },'risk')
  }

  setSetting('single_loss_stop_model_v4_initialized','true')
  publish('single_loss_stop_model_initialized',{
    preservedSingleLossLock:singleLossLocked,
    preservedRollingLock:rollingLocked,
    clearedLegacyLossHalt:!singleLossLocked&&!rollingLocked&&hadLossHalt,
    previousEmergencyStopReason:previousReason||null,
    behavior:'FIRST realized losing SELL pauses new BUYs, keeps existing-position exits active, does not liquidate other positions, and requires manual reset.'
  },'risk')
  return true
}

export const migrateLegacyLossHaltEmergencyStop=()=>{
  const lossHaltActive=getSetting('loss_halt_active','false')==='true'
  const lossHaltTriggeredAt=getSetting('loss_halt_triggered_at','')
  const emergencyStopReason=getSetting('emergency_stop_reason','').toUpperCase()
  if(lossHaltActive&&['LOSS_GUARD','SINGLE_REALIZED_LOSS'].includes(emergencyStopReason)){
    setSetting('emergency_stop','false')
    setSetting('emergency_stop_reason','')
    publish('legacy_loss_halt_emergency_migrated',{
      lossHaltTriggeredAt:lossHaltTriggeredAt||null,
      previousEmergencyStopReason:emergencyStopReason,
      latestManualEmergencyAt:null,
      message:'Converted legacy full-stop loss guard into BUY pause; profitable SELL exits remain enabled.'
    },'risk')
    return true
  }
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
  const locked=getSetting('rolling_kill_switch_locked','false')==='true'
  if(!raw)return {
    blocked:locked,
    paused:locked,
    locked,
    drawdownPercent:0,
    limitPercent:config.rollingKillSwitchPercent,
    rollingWindowHours:24,
    requiresManualReset:locked,
    protectiveSellsAllowed:true
  }
  try{
    const parsed=JSON.parse(raw)
    return {...parsed,blocked:locked||Boolean(parsed.blocked),paused:locked||Boolean(parsed.paused),locked,requiresManualReset:locked}
  }catch{
    return {
      blocked:locked,
      paused:locked,
      locked,
      drawdownPercent:0,
      limitPercent:config.rollingKillSwitchPercent,
      rollingWindowHours:24,
      requiresManualReset:locked,
      protectiveSellsAllowed:true
    }
  }
}

const currentBotInventoryForEmergency=()=>{
  const inventory=new Map<string,{qty:number,costUsd:number}>()
  for(const event of livePlacedOrders(5000)){
    const p:any=event.payload||{}
    const productId=String(p.productId||'').toUpperCase()
    if(!productId)continue
    const side=String(p.side||'').toUpperCase()
    const fill:any=p.fill||{}
    const preview:any=p.preview||{}
    const price=Number(p.actualFillPrice||fill.filledPrice||preview.est_average_filled_price||0)
    const notional=Number(p.notionalUsd||fill.filledValue||preview.order_total||0)
    const qty=Number(p.executedQty||fill.executedQty||preview.base_size||(price>0&&notional>0?notional/price:0))
    if(!(qty>0))continue
    const row=inventory.get(productId)||{qty:0,costUsd:0}
    if(side==='BUY'){
      row.qty+=qty
      row.costUsd+=Math.max(0,notional)
    }else if(side==='SELL'&&row.qty>0){
      const sold=Math.min(qty,row.qty)
      const unitCost=row.qty>0?row.costUsd/row.qty:0
      row.qty=Math.max(0,row.qty-sold)
      row.costUsd=Math.max(0,row.costUsd-(unitCost*sold))
    }
    inventory.set(productId,row)
  }
  return [...inventory.entries()]
    .filter(([,row])=>row.qty>1e-12)
    .map(([productId,row])=>({productId,qty:row.qty,costUsd:row.costUsd}))
}

const liquidateBotInventoryForEmergency=async(
  executionSource:'ROLLING_24H_KILL_SWITCH'|'SINGLE_LOSS_KILL_SWITCH'
)=>{
  // HARD SAFETY RULE: risk events may pause new BUYs, but they must never
  // force-sell a bot position at a loss. Positions are held until the normal
  // live/current-price + Coinbase-preview profit gates approve a green exit.
  const positions=currentBotInventoryForEmergency()
  const results=positions.map(position=>({
    productId:position.productId,
    executed:false,
    reason:'HOLD_PROFIT_ONLY_NO_FORCED_LIQUIDATION',
    executionSource,
    qty:position.qty,
    costUsd:position.costUsd
  }))
  if(results.length){
    publish('profit_only_emergency_hold',{
      executionSource,
      positions:results,
      rule:'NO_AUTOMATED_RED_SELLS'
    },'risk')
  }
  return results
}

let lastRollingEquitySnapshotAt=0

const triggerSingleLossEmergency=async(input:{
  productId:string
  realizedNetProfitUsd:number
  realizedNetProfitPercent:number|null
})=>{
  if(!(Number(input.realizedNetProfitUsd)<0))return null
  if(getSetting('single_loss_kill_switch_locked','false')==='true')return {
    locked:true,
    reason:'SINGLE_REALIZED_LOSS',
    mode:'ENTRY_PAUSE_ONLY'
  }

  const triggeredAt=new Date().toISOString()
  setSetting('single_loss_kill_switch_locked','true')
  setSetting('single_loss_kill_switch_triggered_at',triggeredAt)
  setSetting('single_loss_kill_switch_product',input.productId)
  setSetting('single_loss_kill_switch_loss_usd',String(input.realizedNetProfitUsd))
  setSetting('single_loss_kill_switch_loss_percent',String(input.realizedNetProfitPercent??0))
  setSetting('loss_guard_active','true')
  setSetting('loss_halt_active','true')
  setSetting('loss_halt_triggered_at',triggeredAt)
  setSetting('loss_halt_product',input.productId)
  setSetting('loss_halt_amount_usd',String(input.realizedNetProfitUsd))

  // A first realized loss pauses entries only. Existing positions remain under
  // normal profit management. The rolling 3%/24h guard is a separate portfolio-level
  // BUY pause and does not force liquidation at a loss.
  if(['SINGLE_REALIZED_LOSS','LOSS_GUARD'].includes(getSetting('emergency_stop_reason','').toUpperCase())){
    setSetting('emergency_stop','false')
    setSetting('emergency_stop_reason','')
  }

  publish('single_loss_kill_switch_triggered',{
    timestampIso:triggeredAt,
    productId:input.productId,
    realizedNetProfitUsd:input.realizedNetProfitUsd,
    realizedNetProfitPercent:input.realizedNetProfitPercent,
    mode:'ENTRY_PAUSE_ONLY',
    entryBehavior:'NEW_BUYS_BLOCKED',
    exitBehavior:'EXISTING_POSITIONS_CONTINUE_NORMAL_PROTECTIVE_AND_PROFIT_EXITS',
    liquidationResults:[],
    resetBehavior:'MANUAL_RESET_REQUIRED'
  },'loss_guard')

  return {
    locked:true,
    reason:'SINGLE_REALIZED_LOSS',
    mode:'ENTRY_PAUSE_ONLY',
    liquidationResults:[]
  }
}

export const resetRollingKillSwitchLock=()=>{
  const resetAt=new Date().toISOString()
  setSetting('rolling_kill_switch_locked','false')
  setSetting('rolling_risk_pause','false')
  setSetting('rolling_risk_pause_started_at','')
  setSetting('rolling_risk_recovery_since','')
  setSetting('rolling_kill_switch_reset_at',resetAt)
  const previousReason=getSetting('emergency_stop_reason','')
  if(previousReason==='ROLLING_24H_DRAWDOWN'){
    setSetting('emergency_stop','false')
    setSetting('emergency_stop_reason','')
  }
  publish('rolling_kill_switch_manual_reset',{
    timestampIso:resetAt,
    monotonicNs:process.hrtime.bigint().toString(),
    message:'Rolling 24-hour kill switch manually reset.'
  },'risk')
  return getRollingRiskState()
}

export const checkRollingEquityKillSwitch=async(currentPortfolioUsd:number)=>{
  const now=Date.now()
  const equity=Number(currentPortfolioUsd)
  const cutoff=new Date(now-config.rollingKillSwitchWindowMs).toISOString()

  pruneEquitySnapshots(cutoff)

  if(equity>0&&(now-lastRollingEquitySnapshotAt>=10000||equitySnapshotsSince(cutoff).length===0)){
    addEquitySnapshot(equity,new Date(now).toISOString())
    lastRollingEquitySnapshotAt=now
  }

  const snapshots=equitySnapshotsSince(cutoff)
  const peakEquityUsd=snapshots.length
    ?Math.max(...snapshots.map(x=>x.equityUsd),equity)
    :equity
  const drawdownPercent=peakEquityUsd>0
    ?Math.max(0,((peakEquityUsd-equity)/peakEquityUsd)*100)
    :0
  const thresholdBreached=drawdownPercent>=config.rollingKillSwitchPercent
  let locked=getSetting('rolling_kill_switch_locked','false')==='true'
  let canceledOrderIds:string[]=[]
  let liquidationResults:any[]=[]

  if(thresholdBreached&&!locked){
    locked=true
    setSetting('rolling_kill_switch_locked','true')
    setSetting('rolling_risk_pause','true')
    setSetting('rolling_risk_pause_started_at',new Date(now).toISOString())

    // The rolling drawdown guard no longer force-sells positions. It pauses
    // new entries and lets existing positions wait for a fee-aware profitable
    // exit. This honors the global no-automatic-loss-sell rule.
    if(getSetting('emergency_stop_reason','')==='ROLLING_24H_DRAWDOWN'){
      setSetting('emergency_stop','false')
      setSetting('emergency_stop_reason','')
    }

    publish('rolling_kill_switch_triggered',{
      timestampIso:new Date().toISOString(),
      monotonicNs:process.hrtime.bigint().toString(),
      mode:'ENTRY_PAUSE_NO_LOSS_LIQUIDATION',
      currentEquityUsd:equity,
      peakEquityUsd,
      drawdownPercent,
      limitPercent:config.rollingKillSwitchPercent,
      rollingWindowHours:24,
      canceledOrderIds:[],
      liquidationResults:[],
      entryBehavior:'ALL_NEW_ENTRIES_BLOCKED',
      exitBehavior:'ONLY_FEE_AWARE_PROFITABLE_EXITS_ALLOWED',
      resetBehavior:'MANUAL_RESET_REQUIRED'
    },'risk')
  }

  const state={
    blocked:locked,
    paused:locked,
    locked,
    thresholdBreached,
    currentEquityUsd:equity,
    peakEquityUsd:Number(peakEquityUsd.toFixed(2)),
    drawdownPercent:Number(drawdownPercent.toFixed(4)),
    limitPercent:config.rollingKillSwitchPercent,
    rollingWindowHours:24,
    requiresManualReset:locked,
    newBuysBlocked:locked,
    protectiveSellsAllowed:true,
    pauseStartedAt:getSetting('rolling_risk_pause_started_at','')||null,
    resetAt:getSetting('rolling_kill_switch_reset_at','')||null,
    snapshotCount:snapshots.length,
    canceledOrderIds,
    liquidationResults
  }
  setSetting('rolling_risk_last_state',JSON.stringify(state))
  return state
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
    const requestedNotional=Number(p.notionalUsd||preview.order_total||0)
    const qty=Number(
      p.executedQty||fill.executedQty||preview.base_size||
      (price>0&&requestedNotional>0?requestedNotional/price:0)
    )
    const filledValue=Number(
      fill.filledValue||
      (price>0&&qty>0?price*qty:0)||
      requestedNotional
    )
    const fee=Number(fill.totalFees||preview.commission_total||0)
    if(!(price>0)||!(qty>0))continue

    const row=inventory.get(productId)||{qty:0,costUsd:0}
    if(side==='BUY'){
      row.qty+=qty
      row.costUsd+=filledValue+fee
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
    // Coinbase rounding can leave tiny residual base quantities after a SELL.
    // Do not count sub-minimum dust as an open bot position or exposure.
    .filter(([,row])=>row.qty>1e-12&&row.costUsd+1e-9>=config.minLiveOrderUsd)
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
    const fill:any = p.fill || {}
    const price = Number(p.actualFillPrice || fill.filledPrice || preview.est_average_filled_price || 0)
    const requestedNotional = Number(p.notionalUsd || preview.order_total || 0)
    const baseQty = Number(
      p.executedQty || fill.executedQty || preview.base_size ||
      (price > 0 && requestedNotional > 0 ? requestedNotional / price : 0)
    )
    const filledValue = Number(
      fill.filledValue ||
      (price > 0 && baseQty > 0 ? price * baseQty : 0) ||
      requestedNotional
    )
    const commission = Number(fill.totalFees || preview.commission_total || 0)

    if (!(baseQty > 0) || !(price > 0)) continue

    const row = inventory.get(productId) || {qty:0,costUsd:0}

    if (side === 'BUY') {
      row.qty += baseQty
      row.costUsd += filledValue + commission
      inventory.set(productId,row)
      continue
    }

    if (side === 'SELL' && row.qty > 0) {
      const qtySold = Math.min(baseQty,row.qty)
      const avgCost = row.qty > 0 ? row.costUsd / row.qty : 0
      const allocatedCost = avgCost * qtySold
      const grossProceeds = baseQty>0 ? filledValue*(qtySold/baseQty) : price*qtySold
      const proceeds = grossProceeds - commission
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
    basisNote: 'Bot PnL is reconstructed from Coinbase actual fills and fees, with preview values only as fallback.'
  }
}

export const evaluateLiveOrder = (input: LiveOrderPreflightInput) => {
  const reasons: string[] = []
  const limits = getRuntimeRiskLimits()
  const {
    productId, side, notionalUsd, totalPortfolioUsd, availableUsd, currentAssetUsd
  } = input
  const availableAssetUsd = Number(input.availableAssetUsd ?? currentAssetUsd)
  const maxPositionUsd = Math.max(
    totalPortfolioUsd * (limits.maxPositionPercent / 100),
    Math.max(0,Number(config.maxTotalExposureUsd||100)-Number(config.adaptiveReserveUsd||20))
  )
  const maxExposureUsd = Math.min(
    totalPortfolioUsd * (limits.maxTotalExposurePercent / 100),
    Number(config.maxTotalExposureUsd||100)
  )
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

  // Daily telemetry remains informational; the production first-loss kill switch is enforced at realized SELL execution.
  // Production execution authority is the deterministic strategy plus the
  // latched 3% rolling 24-hour account-equity kill switch.

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
  requiredNetProfitUsd?: number
  requestedBuyUsd?: number
  executionSource?: string
}) => {
  if (!['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(opts.decision)) {
    return { executed: false, reason: 'Decision is not BUY_CANDIDATE or SELL_CANDIDATE' }
  }

  const side = opts.decision === 'BUY_CANDIDATE' ? 'BUY' : 'SELL'
  const executionSource=String(opts.executionSource||'UNKNOWN').toUpperCase()
  if(side==='BUY'&&executionSource!=='MEAN_REVERSION'){
    return {
      executed:false,
      reason:'Automated BUY rejected: production execution is deterministic and only the MEAN_REVERSION engine may open positions.',
      executionSource
    }
  }
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
  if(rollingKillSwitch.blocked&&side==='BUY'){
    return {
      executed:false,
      reason:'Rolling 24-hour 3% guard is locked. New BUYs are paused until manual reset; profitable SELL exits remain allowed.',
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
  const recycleState=getProfitRecycleState()
  const buyableUsdAfterRecycleLock=Math.max(0,availableUsd-recycleState.lockedUsd)
  const availableBase = balanceValue(baseAccount?.availableBalance)
  const heldBase = balanceValue(baseAccount?.hold)
  const currentAssetUsd = (availableBase + heldBase) * price
  const availableAssetUsd = availableBase * price

  const limits = getRuntimeRiskLimits()
  const maxFromPercent = Math.max(
    totalPortfolioUsd * (limits.maxPositionPercent / 100),
    Math.max(0,Number(config.maxTotalExposureUsd||100)-Number(config.adaptiveReserveUsd||20))
  )
  const hardCap = config.maxLiveOrderUsd
  const maxExposureUsd = Math.min(
    totalPortfolioUsd * (limits.maxTotalExposurePercent / 100),
    Number(config.maxTotalExposureUsd||100)
  )
  const botExposure=getOpenBotExposureSummary()
  const productAlreadyOpen=botExposure.positions.some(row=>row.productId===productId)

  let notionalUsd = 0
  let baseSize: number | undefined
  let quoteSizeUsd: number | undefined

  if (side === 'BUY') {
    const quoteMin=Math.max(0,Number(productInfo?.quote_min_size||0))
    const quoteMax=Number(productInfo?.quote_max_size||Infinity)
    const quoteIncrement=Number(productInfo?.quote_increment||0.01)
    const buyStepUsd=Math.max(0.01,Number(config.buyStepUsd||5))
    const strategyTargetUsd=Math.max(
      buyStepUsd,
      Math.floor((Number(config.targetBuyUsd||10)+1e-9)/buyStepUsd)*buyStepUsd
    )
    const requestedBuyUsd=Number(opts.requestedBuyUsd||strategyTargetUsd)
    const remainingExposureUsd=Math.max(0,maxExposureUsd-botExposure.totalBotExposureUsd)
    const reserveUsd=Math.max(0,Number(config.adaptiveReserveUsd||20))
    const spendableAdaptiveUsd=Math.max(0,remainingExposureUsd-reserveUsd)
    const maxAdaptiveBuyUsd=spendableAdaptiveUsd
    const minimumNeededUsd=Math.max(strategyTargetUsd,quoteMin)
    const adaptiveTargetUsd=Math.min(
      Math.max(requestedBuyUsd>0?requestedBuyUsd:strategyTargetUsd,minimumNeededUsd),
      maxAdaptiveBuyUsd
    )
    const rawAffordableUsd=Math.min(
      buyableUsdAfterRecycleLock,
      adaptiveTargetUsd,
      maxFromPercent,
      remainingExposureUsd,
      quoteMax
    )
    const steppedUsd=Math.floor((rawAffordableUsd+1e-9)/buyStepUsd)*buyStepUsd

    if(productAlreadyOpen){
      return {
        executed:false,
        reason:'This product already has an open bot-managed position. The bot will not stack another BUY on the same coin.',
        productId,
        openBotPositions:botExposure.openBotPositions
      }
    }

    if(steppedUsd+1e-8<quoteMin||!(steppedUsd>0)){
      const blocker=
        availableUsd+1e-8<buyStepUsd
          ?'INSUFFICIENT_AVAILABLE_USD'
          :buyableUsdAfterRecycleLock+1e-8<buyStepUsd
            ?'PROFIT_RECYCLE_POOL_LOCKED_UNTIL_DOUBLE'
            :maxFromPercent+1e-8<buyStepUsd
            ?'POSITION_CAP_BELOW_BUY_STEP'
            :remainingExposureUsd+1e-8<buyStepUsd
              ?'REMAINING_EXPOSURE_BELOW_BUY_STEP'
              :quoteMin>steppedUsd+1e-8
                ?'COINBASE_MINIMUM_ABOVE_AFFORDABLE_SIZE'
                :'NO_EXECUTABLE_BUY_SIZE'
      return {
        executed:false,
        reason:blocker,
        availableUsd,
        buyableUsdAfterRecycleLock,
        profitRecycleBaselineUsd:recycleState.baselineUsd,
        profitRecycleLockedUsd:recycleState.lockedUsd,
        profitRecycleThresholdUsd:recycleState.thresholdUsd,
        requestedBuyUsd,
        rawAffordableUsd,
        steppedUsd,
        buyStepUsd,
        quoteMin,
        quoteMax,
        maxPositionUsd:maxFromPercent,
        remainingExposureUsd,
        totalBotExposureUsd:botExposure.totalBotExposureUsd,
        totalPortfolioUsd
      }
    }

    quoteSizeUsd=floorToIncrement(steppedUsd,quoteIncrement)
    if(quoteSizeUsd+1e-8<quoteMin||!(quoteSizeUsd>0)){
      return {
        executed:false,
        reason:'Coinbase quote increment cannot produce an executable dynamic buy size.',
        availableUsd,
        steppedUsd,
        quoteSizeUsd,
        quoteIncrement,
        quoteMin
      }
    }

    notionalUsd=quoteSizeUsd
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
    if(side==='SELL'){
      const currentProfitGate=assessAlreadyProfitableSell({
        currentLivePrice:price,
        feeLoadedEntryPrice:Number(opts.avgEntryPrice||0)
      })
      if(!currentProfitGate.approved){
        const reason=currentProfitGate.reason
        publish('live_order_rejected',{
          productId,
          side,
          notionalUsd,
          currentLivePrice:price,
          feeLoadedEntryPrice:Number(opts.avgEntryPrice||0),
          reason,
          rule:'SELL_ONLY_WHEN_ALREADY_PROFITABLE_NOW'
        },'risk')
        return {
          executed:false,
          reason,
          preflight,
          currentLivePrice:price,
          feeLoadedEntryPrice:Number(opts.avgEntryPrice||0)
        }
      }
    }

    const preview = await previewMarketOrder({ productId, side, quoteSizeUsd, baseSize })
    const previewErrors = Array.isArray(preview.errs) ? preview.errs.filter(Boolean) : []
    if (previewErrors.length > 0 || !preview.preview_id) {
      const reason = previewErrors.length > 0 ? previewErrors.join(', ') : 'Coinbase preview did not return a preview_id'
      publish('live_order_preview_rejected', { productId, side, notionalUsd, preview, reason }, 'risk')
      return { executed: false, reason, preflight, preview }
    }

    const estimatedFillPrice = Number(preview.est_average_filled_price || 0)

    const requiredNetProfitUsd=
      side==='SELL'
        ?Math.max(config.smallAccountMinNetProfitUsd,Number(opts.requiredNetProfitUsd||0))
        :Number(opts.requiredNetProfitUsd||0)

    if(side==='SELL'&&requiredNetProfitUsd>0){
      const previewCommission=Number(preview.commission_total||0)
      const previewQty=Number(baseSize||0)
      const feeLoadedEntry=Number(opts.avgEntryPrice||0)
      const previewNetProceeds=(estimatedFillPrice*previewQty)-previewCommission
      const previewCostBasis=feeLoadedEntry*previewQty
      const previewNetProfitUsd=previewNetProceeds-previewCostBasis

      if(!(estimatedFillPrice>0)||!(previewQty>0)||!(feeLoadedEntry>0)||previewNetProfitUsd+1e-9<requiredNetProfitUsd){
        const reason='HOLD: current Coinbase SELL preview net profit $'
          +(Number.isFinite(previewNetProfitUsd)?previewNetProfitUsd.toFixed(4):'0.0000')
          +' is below required $'+requiredNetProfitUsd.toFixed(4)
          +' after estimated Coinbase fee.'

        publish('live_order_preview_rejected',{
          productId,side,notionalUsd,preview,estimatedFillPrice,
          previewCommission,previewQty,previewCostBasis,
          previewNetProceeds,previewNetProfitUsd,requiredNetProfitUsd,reason
        },'risk')

        return {executed:false,reason,preflight,preview,previewNetProfitUsd,requiredNetProfitUsd}
      }
    }

    // Production entry/exit math is deterministic. Legacy static take-profit
    // economics gates are intentionally bypassed because this strategy has no
    // fixed take-profit; it uses an 8% net trailing activation milestone.
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

    // Re-check the global stop immediately before sending the real order.
    // This closes the gap where another trade could realize a loss after this
    // preview passed but before this order reached Coinbase.
    const finalExecutionGate=assessEmergencyExecutionGate({
      emergencyStop:emergencyStopActive(),
      tradingMode:config.tradingMode,
      liveTradingEnabled:config.liveTradingEnabled,
      autoTradingEnabled:config.autoTradingEnabled,
      manualApprovalRequired:config.manualApprovalRequired,
      lossHaltActive:getSetting('loss_halt_active','false')==='true',
      protectiveExit:side==='SELL',
      emergencyStopReason:getSetting('emergency_stop_reason','')
    })
    if(!finalExecutionGate.approved){
      const reason=finalExecutionGate.reasons[0]||'Global execution stop is active'
      publish('live_order_rejected',{productId,side,notionalUsd,reasons:finalExecutionGate.reasons,reason},'risk')
      return {executed:false,reason,reasons:finalExecutionGate.reasons,preflight,preview}
    }

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

    if(side==='SELL'&&Number(realizedNetProfitUsd)>0){
      recordProfitableSellForRecyclePool({
        productId,
        realizedNetProceedsUsd:Number(realizedNetProceedsUsd),
        realizedNetProfitUsd:Number(realizedNetProfitUsd)
      })
    }

    if(side==='SELL'&&Number(realizedNetProfitUsd)<0){
      await triggerSingleLossEmergency({
        productId,
        realizedNetProfitUsd:Number(realizedNetProfitUsd),
        realizedNetProfitPercent:Number.isFinite(Number(realizedNetProfitPercent))
          ?Number(realizedNetProfitPercent)
          :null
      })
    }

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
