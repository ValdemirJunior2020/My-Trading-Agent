import { config } from './config.js'
import { getSetting, openPaperNotional,setSetting } from './db.js'

export interface PaperOrderRequest {productId:string;side:'BUY'|'SELL';size:number;price:number}
export interface RuntimeRiskLimits {maxPositionPercent:number;maxTotalExposurePercent:number;maxDailyLossPercent:number}

const storedNumber=(key:string,fallback:number)=>{
  const value=Number(getSetting(key,String(fallback)))
  return Number.isFinite(value)?value:fallback
}

export const getRuntimeRiskLimits=():RuntimeRiskLimits=>({
  maxPositionPercent:storedNumber('risk_max_position_percent',config.maxPositionPercent),
  maxTotalExposurePercent:storedNumber('risk_max_total_exposure_percent',config.maxTotalExposurePercent),
  maxDailyLossPercent:storedNumber('risk_max_daily_loss_percent',config.maxDailyLossPercent)
})

export const saveRuntimeRiskLimits=(input:Partial<RuntimeRiskLimits>)=>{
  const current=getRuntimeRiskLimits()
  const next={
    maxPositionPercent:Math.max(0.1,Math.min(20,Number(input.maxPositionPercent??current.maxPositionPercent))),
    maxTotalExposurePercent:Math.max(1,Math.min(50,Number(input.maxTotalExposurePercent??current.maxTotalExposurePercent))),
    maxDailyLossPercent:Math.max(0.1,Math.min(10,Number(input.maxDailyLossPercent??current.maxDailyLossPercent)))
  }
  if(next.maxPositionPercent>next.maxTotalExposurePercent) next.maxPositionPercent=next.maxTotalExposurePercent
  setSetting('risk_max_position_percent',String(next.maxPositionPercent))
  setSetting('risk_max_total_exposure_percent',String(next.maxTotalExposurePercent))
  setSetting('risk_max_daily_loss_percent',String(next.maxDailyLossPercent))
  return next
}

export const emergencyStopActive=()=>getSetting('emergency_stop','false')==='true'

export const evaluatePaperOrder=(order:PaperOrderRequest)=>{
  const reasons:string[]=[]
  const limits=getRuntimeRiskLimits()
  const notional=order.size*order.price
  const maxPositionUsd=config.paperStartingBalanceUsd*(limits.maxPositionPercent/100)
  const maxExposureUsd=config.paperStartingBalanceUsd*(limits.maxTotalExposurePercent/100)
  const currentExposure=openPaperNotional()
  if(emergencyStopActive()) reasons.push('Emergency stop is active.')
  if(!order.productId||!/^[A-Z0-9]+-[A-Z0-9]+$/.test(order.productId)) reasons.push('Invalid product ID.')
  if(!['BUY','SELL'].includes(order.side)) reasons.push('Invalid side.')
  if(!(order.size>0)||!(order.price>0)) reasons.push('Size and price must be positive.')
  if(notional>maxPositionUsd) reasons.push('Position notional exceeds the hard '+limits.maxPositionPercent+'% paper-capital limit.')
  if(currentExposure+notional>maxExposureUsd) reasons.push('Total paper exposure would exceed '+limits.maxTotalExposurePercent+'%.')
  return {approved:reasons.length===0,reasons,notional,currentExposure,maxPositionUsd,maxExposureUsd,limits}
}


export interface LiveOrderPreflightInput {
  productId:string
  side:'BUY'|'SELL'
  notionalUsd:number
  totalPortfolioUsd:number
  availableUsd:number
  currentAssetUsd:number
}

export const getDailyEquityGuard=(currentPortfolioUsd:number)=>{
  const limits=getRuntimeRiskLimits()
  const today=new Date().toISOString().slice(0,10)
  const storedDate=getSetting('live_daily_equity_date','')
  let startEquity=Number(getSetting('live_daily_equity_start_usd','0'))
  if(storedDate!==today||!(startEquity>0)){
    startEquity=currentPortfolioUsd
    setSetting('live_daily_equity_date',today)
    setSetting('live_daily_equity_start_usd',String(currentPortfolioUsd))
  }
  const lossPercent=startEquity>0?Math.max(0,((startEquity-currentPortfolioUsd)/startEquity)*100):0
  return {
    date:today,
    startEquityUsd:Number(startEquity.toFixed(2)),
    currentEquityUsd:Number(currentPortfolioUsd.toFixed(2)),
    lossPercent:Number(lossPercent.toFixed(4)),
    limitPercent:limits.maxDailyLossPercent,
    blocked:lossPercent>=limits.maxDailyLossPercent
  }
}

export const evaluateLiveOrder=(input:LiveOrderPreflightInput)=>{
  const reasons:string[]=[]
  const limits=getRuntimeRiskLimits()
  const {
    productId,side,notionalUsd,totalPortfolioUsd,availableUsd,currentAssetUsd
  }=input
  const maxPositionUsd=totalPortfolioUsd*(limits.maxPositionPercent/100)
  const maxExposureUsd=totalPortfolioUsd*(limits.maxTotalExposurePercent/100)
  const daily=getDailyEquityGuard(totalPortfolioUsd)

  if(emergencyStopActive()) reasons.push('Emergency stop is active.')
  if(!config.liveTradingEnabled) reasons.push('Live trading is disabled in .env.')
  if(config.autoTradingEnabled) reasons.push('Automatic trading must remain disabled for manual live mode.')
  if(!config.manualApprovalRequired) reasons.push('Manual approval must be required for live mode.')
  if(!productId||!/^[A-Z0-9]+-[A-Z0-9]+$/.test(productId)) reasons.push('Invalid product ID.')
  if(!['BUY','SELL'].includes(side)) reasons.push('Invalid side.')
  if(!(notionalUsd>0)) reasons.push('Order notional must be positive.')
  if(!(totalPortfolioUsd>0)) reasons.push('Live portfolio value is unavailable.')
  if(notionalUsd>maxPositionUsd) reasons.push('Order exceeds the hard '+limits.maxPositionPercent+'% live position cap.')
  if(side==='BUY'&&notionalUsd>availableUsd) reasons.push('Insufficient available USD for this buy.')
  if(side==='SELL'&&notionalUsd>currentAssetUsd) reasons.push('Insufficient asset value for this sell.')
  const projectedExposure=side==='BUY'?currentAssetUsd+notionalUsd:Math.max(0,currentAssetUsd-notionalUsd)
  if(projectedExposure>maxExposureUsd) reasons.push('Projected asset exposure exceeds '+limits.maxTotalExposurePercent+'% of the live portfolio.')
  if(daily.blocked) reasons.push('Daily loss guard is active at '+daily.lossPercent.toFixed(2)+'% loss.')

  return {
    approved:reasons.length===0,
    reasons,
    productId,
    side,
    notionalUsd,
    totalPortfolioUsd,
    availableUsd,
    currentAssetUsd,
    projectedExposureUsd:projectedExposure,
    maxPositionUsd,
    maxExposureUsd,
    daily,
    limits,
    manualApprovalRequired:config.manualApprovalRequired,
    automaticTradingEnabled:config.autoTradingEnabled,
    liveTradingEnabled:config.liveTradingEnabled
  }
}
