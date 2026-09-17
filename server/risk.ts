import { config } from './config.js'
import { getSetting, openPaperNotional } from './db.js'
export interface PaperOrderRequest {productId:string;side:'BUY'|'SELL';size:number;price:number}
export const emergencyStopActive=()=>getSetting('emergency_stop','false')==='true'
export const evaluatePaperOrder=(order:PaperOrderRequest)=>{
  const reasons:string[]=[]
  const notional=order.size*order.price
  const maxPositionUsd=config.paperStartingBalanceUsd*(config.maxPositionPercent/100)
  const maxExposureUsd=config.paperStartingBalanceUsd*(config.maxTotalExposurePercent/100)
  const currentExposure=openPaperNotional()
  if(emergencyStopActive()) reasons.push('Emergency stop is active.')
  if(!order.productId||!/^[A-Z0-9]+-[A-Z0-9]+$/.test(order.productId)) reasons.push('Invalid product ID.')
  if(!['BUY','SELL'].includes(order.side)) reasons.push('Invalid side.')
  if(!(order.size>0)||!(order.price>0)) reasons.push('Size and price must be positive.')
  if(notional>maxPositionUsd) reasons.push(`Position notional exceeds the hard ${config.maxPositionPercent}% paper-capital limit.`)
  if(currentExposure+notional>maxExposureUsd) reasons.push(`Total paper exposure would exceed ${config.maxTotalExposurePercent}%.`)
  return {approved:reasons.length===0,reasons,notional,currentExposure,maxPositionUsd,maxExposureUsd}
}
