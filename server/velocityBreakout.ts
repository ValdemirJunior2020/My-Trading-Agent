import { config } from './config.js'
import { getCandles,getProduct } from './coinbase.js'

type Candle={start:number;low:number;high:number;open:number;close:number;volume:number}

const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0
const std=(xs:number[])=>{
  const m=avg(xs)
  return Math.sqrt(avg(xs.map(x=>(x-m)**2)))
}
const upperBand=(closes:number[],period:number,mult:number)=>{
  const slice=closes.slice(-period)
  if(slice.length<period)return null
  const middle=avg(slice)
  return middle+(mult*std(slice))
}
const nyDate=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'})

export const NEXT_WEEK_BREAKOUT={
  startDate:'2026-09-28',
  endDate:'2026-10-04',
  priceMinUsd:0.50,
  priceMaxUsd:2.00,
  discovery24hVs7dRatio:2.0,
  min24hChangePercent:8,
  max24hChangePercent:18,
  volume20Ratio:2.5,
  hardStopPercent:2.0,
  trailingActivateNetPercent:4.0,
  trailingDistancePercent:2.5,
  minimumTrailingExitNetPercent:1.0,
  requestedAllocationUsd:200
} as const

export const nextWeekBreakoutActive=()=>{
  const d=nyDate()
  return d>=NEXT_WEEK_BREAKOUT.startDate&&d<=NEXT_WEEK_BREAKOUT.endDate
}

type Discovery={
  productId:string
  price:number
  change24hPercent:number
  volume24h:number
  avgDailyVolume7d:number
  volume24hVs7dRatio:number
  discoveryReady:boolean
  checkedAt:string
}
const discoveryCache=new Map<string,{at:number;value:Discovery}>()

export const getBreakoutDiscovery=async(productId:string):Promise<Discovery>=>{
  const key=productId.toUpperCase()
  const cached=discoveryCache.get(key)
  if(cached&&Date.now()-cached.at<5*60*1000)return cached.value

  const [candles,product]=await Promise.all([
    getCandles(key,'ONE_HOUR',192),
    getProduct(key)
  ])
  if(candles.length<168)throw new Error('Need at least 7 days of hourly candles for breakout discovery.')

  const last24=candles.slice(-24)
  const prior7Days=candles.slice(-168)
  const volume24h=last24.reduce((sum,c)=>sum+Number(c.volume||0),0)
  const total7d=prior7Days.reduce((sum,c)=>sum+Number(c.volume||0),0)
  const avgDailyVolume7d=total7d/7
  const volume24hVs7dRatio=avgDailyVolume7d>0?volume24h/avgDailyVolume7d:0
  const latest=last24.at(-1)!
  const dayAgo=last24[0]
  const change24hPercent=dayAgo?.close>0?((latest.close-dayAgo.close)/dayAgo.close)*100:0
  const price=Number((product as any)?.price||latest.close)
  const discoveryReady=
    price>=NEXT_WEEK_BREAKOUT.priceMinUsd&&
    price<=NEXT_WEEK_BREAKOUT.priceMaxUsd&&
    change24hPercent>=NEXT_WEEK_BREAKOUT.min24hChangePercent&&
    change24hPercent<=NEXT_WEEK_BREAKOUT.max24hChangePercent&&
    volume24hVs7dRatio>=NEXT_WEEK_BREAKOUT.discovery24hVs7dRatio

  const value={
    productId:key,
    price,
    change24hPercent,
    volume24h,
    avgDailyVolume7d,
    volume24hVs7dRatio,
    discoveryReady,
    checkedAt:new Date().toISOString()
  }
  discoveryCache.set(key,{at:Date.now(),value})
  return value
}

export const evaluateBreakoutConfirmation=async(productId:string,closed:Candle[])=>{
  if(closed.length<21)return {ready:false,reason:'NOT_ENOUGH_5M_CANDLES'}
  const current=closed.at(-1)!
  const previous=closed.at(-2)!
  const closes=closed.map(c=>c.close)
  const currentUpper=upperBand(closes,20,2)
  const previousUpper=upperBand(closes.slice(0,-1),20,2)
  if(currentUpper==null||previousUpper==null)return {ready:false,reason:'UPPER_BB_UNAVAILABLE'}

  const priorVolumes=closed.slice(-21,-1).map(c=>Number(c.volume||0)).filter(v=>v>0)
  const avgVolume20=avg(priorVolumes)
  const volumeRatio20=avgVolume20>0?Number(current.volume||0)/avgVolume20:0
  const crossedAboveUpper=previous.close<=previousUpper&&current.close>currentUpper
  const discovery=await getBreakoutDiscovery(productId)

  return {
    ready:Boolean(discovery.discoveryReady&&crossedAboveUpper&&volumeRatio20>=NEXT_WEEK_BREAKOUT.volume20Ratio),
    productId:productId.toUpperCase(),
    price:current.close,
    discovery,
    crossedAboveUpper,
    currentUpper,
    previousUpper,
    currentVolume:Number(current.volume||0),
    avgVolume20,
    volumeRatio20,
    rules:NEXT_WEEK_BREAKOUT
  }
}

export const breakoutTrailingActivationPrice=(feeLoadedEntryPrice:number)=>{
  const fee=config.backtestMarketFeeRate
  return feeLoadedEntryPrice*(1+NEXT_WEEK_BREAKOUT.trailingActivateNetPercent/100)/Math.max(1e-12,1-fee)
}

export const breakoutHardStopPrice=(fillEntryPrice:number)=>
  fillEntryPrice*(1-NEXT_WEEK_BREAKOUT.hardStopPercent/100)

export const breakoutTrailingStopPrice=(peakPrice:number)=>
  peakPrice*(1-NEXT_WEEK_BREAKOUT.trailingDistancePercent/100)
