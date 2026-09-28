export type ExposureAssessmentInput={
  side:'BUY'|'SELL'
  notionalUsd:number
  currentAssetUsd:number
  totalBotExposureUsd:number
  openBotPositions:number
  productAlreadyOpen:boolean
  maxPositionUsd:number
  maxTotalExposureUsd:number
  maxOpenBotPositions:number
}

export const assessExposureLimits=(input:ExposureAssessmentInput)=>{
  const projectedAssetExposureUsd=input.side==='BUY'
    ? input.currentAssetUsd+input.notionalUsd
    : Math.max(0,input.currentAssetUsd-input.notionalUsd)

  const projectedTotalBotExposureUsd=input.side==='BUY'
    ? input.totalBotExposureUsd+input.notionalUsd
    : Math.max(0,input.totalBotExposureUsd-input.notionalUsd)

  const projectedOpenBotPositions=input.side==='BUY'&&!input.productAlreadyOpen
    ? input.openBotPositions+1
    : input.openBotPositions

  const reasons:string[]=[]

  if(input.side==='BUY'&&projectedAssetExposureUsd>input.maxPositionUsd+1e-8){
    reasons.push('Projected asset exposure exceeds the live position cap.')
  }
  if(input.side==='BUY'&&projectedTotalBotExposureUsd>input.maxTotalExposureUsd+1e-8){
    reasons.push('Projected total bot exposure exceeds the live portfolio exposure cap.')
  }
  // No global position-count gate in production. Multiple different coins may
  // be open at once; cash, per-asset exposure, total exposure, and emergency
  // protection remain the limiting controls.

  return {
    approved:reasons.length===0,
    reasons,
    projectedAssetExposureUsd,
    projectedTotalBotExposureUsd,
    projectedOpenBotPositions
  }
}


export const calculateRealizedSellMetrics=(input:{
  avgEntryPrice:number
  executedQty:number
  actualFillPrice:number
  sellCommission:number
})=>{
  const avgEntryPrice=Number(input.avgEntryPrice)
  const executedQty=Number(input.executedQty)
  const actualFillPrice=Number(input.actualFillPrice)
  const sellCommission=Math.max(0,Number(input.sellCommission)||0)

  const sellCostBasisUsd=
    avgEntryPrice>0&&executedQty>0
      ?avgEntryPrice*executedQty
      :0

  const realizedNetProceedsUsd=
    actualFillPrice>0&&executedQty>0
      ?(actualFillPrice*executedQty)-sellCommission
      :0

  const realizedNetProfitUsd=
    sellCostBasisUsd>0
      ?realizedNetProceedsUsd-sellCostBasisUsd
      :null

  const realizedNetProfitPercent=
    realizedNetProfitUsd!=null&&sellCostBasisUsd>0
      ?(realizedNetProfitUsd/sellCostBasisUsd)*100
      :null

  return {
    sellCostBasisUsd,
    realizedNetProceedsUsd,
    realizedNetProfitUsd,
    realizedNetProfitPercent
  }
}

export const assessDailyRealizedLoss=(input:{
  startEquityUsd:number
  realizedLossUsd:number
  maxDailyLossPercent:number
})=>{
  const startEquityUsd=Number(input.startEquityUsd)
  const realizedLossUsd=Math.max(0,Number(input.realizedLossUsd)||0)
  const limitPercent=Math.max(0,Number(input.maxDailyLossPercent)||0)
  const botLossPercent=
    startEquityUsd>0
      ?(realizedLossUsd/startEquityUsd)*100
      :0
  return {
    botLossPercent,
    limitPercent,
    blocked:botLossPercent>=limitPercent
  }
}

export const assessEmergencyExecutionGate=(input:{
  emergencyStop:boolean
  tradingMode:string
  liveTradingEnabled:boolean
  autoTradingEnabled:boolean
  manualApprovalRequired?:boolean
  lossHaltActive?:boolean
  protectiveExit?:boolean
  emergencyStopReason?:string
})=>{
  const reasons:string[]=[]
  const stopReason=String(input.emergencyStopReason||'').toUpperCase()
  const lossHaltExitAllowed=
    Boolean(input.lossHaltActive) &&
    Boolean(input.protectiveExit) &&
    (stopReason===''||stopReason==='LOSS_HALT')

  if(input.emergencyStop&&!lossHaltExitAllowed)reasons.push('Emergency stop is active')
  if(input.lossHaltActive&&!input.protectiveExit){
    reasons.push('First-loss entry pause is active; new BUYs are blocked until manual reset')
  }
  if(String(input.tradingMode).toLowerCase()!=='live')reasons.push('TRADING_MODE is not live')
  if(!input.liveTradingEnabled||!input.autoTradingEnabled)reasons.push('Live or auto trading is disabled in .env')
  if(input.manualApprovalRequired)reasons.push('Manual approval is required; automatic live execution is blocked')
  return {approved:reasons.length===0,reasons,lossHaltExitAllowed}
}


export const assessSellMinimum=(input:{
  baseSize:number
  baseMin:number
  baseMax:number
})=>{
  const baseSize=Number(input.baseSize)
  const baseMin=Math.max(0,Number(input.baseMin)||0)
  const baseMax=Number(input.baseMax)
  const approved=
    baseSize>0 &&
    baseSize+1e-12>=baseMin &&
    (!Number.isFinite(baseMax)||baseSize<=baseMax+1e-12)
  return {approved,baseSize,baseMin,baseMax}
}


export const assessProfitFirstEntryEconomics=(input:{
  buyNotionalUsd:number
  buyCommissionUsd:number
  takeProfitPercent:number
  maxSlippagePercent:number
  maxRequiredGrossProfitPercent:number
})=>{
  const buyNotionalUsd=Math.max(0,Number(input.buyNotionalUsd)||0)
  const buyCommissionUsd=Math.max(0,Number(input.buyCommissionUsd)||0)
  const takeProfitPercent=Math.max(0,Number(input.takeProfitPercent)||0)
  const maxSlippagePercent=Math.max(0,Number(input.maxSlippagePercent)||0)
  const maxRequiredGrossProfitPercent=Math.max(0,Number(input.maxRequiredGrossProfitPercent)||0)

  const buyFeePercent=buyNotionalUsd>0?(buyCommissionUsd/buyNotionalUsd)*100:0
  const assumedSellFeePercent=buyFeePercent
  const requiredGrossProfitPercent=
    takeProfitPercent+
    buyFeePercent+
    assumedSellFeePercent+
    maxSlippagePercent

  return {
    approved:
      buyNotionalUsd>0 &&
      requiredGrossProfitPercent<=maxRequiredGrossProfitPercent+1e-8,
    buyFeePercent,
    assumedSellFeePercent,
    takeProfitPercent,
    maxSlippagePercent,
    requiredGrossProfitPercent,
    maxRequiredGrossProfitPercent
  }
}


export const assessCapitalPreservationBuy=(input:{
  enabled:boolean
  realizedPnlTodayUsd:number
  realizedLossTodayUsd:number
  openBotPositions:number
})=>{
  const reasons:string[]=[]
  if(input.enabled){
    if(Number(input.realizedLossTodayUsd)>0||Number(input.realizedPnlTodayUsd)<0){
      reasons.push('Capital preservation lock: a realized bot loss already occurred today.')
    }
    // Multiple different bot positions are allowed. Capital preservation no
    // longer turns "another open coin" into a blanket BUY rejection.
  }
  return {approved:reasons.length===0,reasons}
}


export const shouldClearLegacyLossHaltEmergency=(input:{
  emergencyStop:boolean
  lossHaltActive:boolean
  emergencyStopReason?:string
  lossHaltTriggeredAt?:string
  latestManualEmergencyAt?:string
})=>{
  if(!input.emergencyStop||!input.lossHaltActive)return false
  const reason=String(input.emergencyStopReason||'').toUpperCase()
  if(reason==='LOSS_GUARD')return false
  if(reason!=='MANUAL')return true

  const lossAt=new Date(String(input.lossHaltTriggeredAt||'')).getTime()
  const manualAt=new Date(String(input.latestManualEmergencyAt||'')).getTime()

  // A MANUAL reason is considered stale when there is no confirmed manual
  // stop after the loss-halt event.
  if(!Number.isFinite(manualAt))return true
  if(!Number.isFinite(lossAt))return false
  return manualAt<=lossAt
}
