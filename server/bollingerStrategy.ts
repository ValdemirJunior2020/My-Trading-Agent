import { config } from './config.js'
import { getCandles, getProduct } from './coinbase.js'
import { livePlacedOrders } from './db.js'

type Candle={start:number;low:number;high:number;open:number;close:number;volume:number}

const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0
const std=(xs:number[])=>{
  const m=avg(xs)
  return Math.sqrt(avg(xs.map(x=>(x-m)**2)))
}

const rsi=(closes:number[],period=14)=>{
  if(closes.length<period+1)return null
  let gains=0,losses=0
  for(let i=closes.length-period;i<closes.length;i++){
    const d=closes[i]-closes[i-1]
    if(d>=0)gains+=d
    else losses+=Math.abs(d)
  }
  const ag=gains/period
  const al=losses/period
  if(al===0)return 100
  const rs=ag/al
  return 100-(100/(1+rs))
}

const bandsAt=(closes:number[],endExclusive:number,period=20,mult=2)=>{
  const slice=closes.slice(endExclusive-period,endExclusive)
  if(slice.length<period)return null
  const middle=avg(slice)
  const sd=std(slice)
  return {middle,upper:middle+mult*sd,lower:middle-mult*sd}
}

const botPosition=(productId:string)=>{
  let qty=0,cost=0
  for(const event of livePlacedOrders(5000)){
    const p:any=event.payload||{}
    if(String(p.productId||'').toUpperCase()!==productId.toUpperCase())continue
    const side=String(p.side||'').toUpperCase()
    const preview:any=p.preview||{}
    const fill:any=p.fill||{}
    const price=Number(p.actualFillPrice||fill.filledPrice||preview.est_average_filled_price||0)
    const notional=Number(p.notionalUsd||fill.filledValue||preview.order_total||0)
    const base=Number(p.executedQty||fill.executedQty||preview.base_size||(price>0&&notional>0?notional/price:0))
    if(!(price>0)||!(base>0))continue
    if(side==='BUY'){
      qty+=base
      cost+=notional+Number(preview.commission_total||0)
    }else if(side==='SELL'&&qty>0){
      const sold=Math.min(base,qty)
      const avgCost=qty>0?cost/qty:0
      qty-=sold
      cost=Math.max(0,cost-(avgCost*sold))
    }
  }
  return {qty,avgEntryPrice:qty>0?cost/qty:0}
}

export const evaluateBollingerRsiStrategy=async(productId:string)=>{
  const candles=await getCandles(productId,config.strategyGranularity,80)
  if(candles.length<25)return {action:'NONE',reason:'Not enough candles',productId}

  const closes=candles.map(c=>c.close)
  const latest=candles.at(-1)!
  const previous=candles.at(-2)!
  const latestBands=bandsAt(closes,closes.length,config.bbPeriod,config.bbStdDev)
  const prevBands=bandsAt(closes,closes.length-1,config.bbPeriod,config.bbStdDev)
  const latestRsi=rsi(closes,config.rsiPeriod)
  const product:any=await getProduct(productId)
  const livePrice=Number(product?.price||latest.close)
  const position=botPosition(productId)

  if(!latestBands||!prevBands||latestRsi==null){
    return {action:'NONE',reason:'Indicators unavailable',productId}
  }

  const crossedBelowLower=
    previous.close>=prevBands.lower &&
    latest.close<latestBands.lower

  const oversold=latestRsi<config.rsiOversold

  let stopPrice:number|null=null
  let takeProfitPrice:number|null=null
  let exitReason:string|null=null

  if(position.qty>0&&position.avgEntryPrice>0){
    stopPrice=position.avgEntryPrice*(1-config.fixedStopLossPercent/100)
    takeProfitPrice=latestBands.middle

    if(livePrice>=takeProfitPrice)exitReason='MIDDLE_BAND_TAKE_PROFIT'
    else if(livePrice<=stopPrice)exitReason='STOP_LOSS'
  }

  const action=
    position.qty>0 && exitReason ? 'SELL' :
    position.qty<=0 && crossedBelowLower && oversold ? 'BUY' :
    'NONE'

  return {
    productId,
    action,
    reason:action==='BUY'
      ? 'Close crossed below lower Bollinger Band and RSI is oversold'
      : action==='SELL'
        ? exitReason
        : 'No deterministic entry/exit trigger',
    granularity:config.strategyGranularity,
    close:latest.close,
    livePrice,
    bollinger:{
      period:config.bbPeriod,
      stdDev:config.bbStdDev,
      lower:latestBands.lower,
      middle:latestBands.middle,
      upper:latestBands.upper,
      previousLower:prevBands.lower
    },
    rsi:{period:config.rsiPeriod,value:latestRsi,threshold:config.rsiOversold},
    entry:{crossedBelowLower,oversold},
    position,
    exits:{
      takeProfitPrice,
      stopLossPercent:config.fixedStopLossPercent,
      stopPrice,
      exitReason
    }
  }
}
