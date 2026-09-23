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
