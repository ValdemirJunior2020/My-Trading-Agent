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
  if(
    input.side==='BUY' &&
    !input.productAlreadyOpen &&
    projectedOpenBotPositions>input.maxOpenBotPositions
  ){
    reasons.push('Maximum number of open bot positions has been reached.')
  }

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
})=>{
  const reasons:string[]=[]
  if(input.emergencyStop)reasons.push('Emergency stop is active')
  if(String(input.tradingMode).toLowerCase()!=='live')reasons.push('TRADING_MODE is not live')
  if(!input.liveTradingEnabled||!input.autoTradingEnabled)reasons.push('Live or auto trading is disabled in .env')
  if(input.manualApprovalRequired)reasons.push('Manual approval is required; automatic live execution is blocked')
  return {approved:reasons.length===0,reasons}
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
