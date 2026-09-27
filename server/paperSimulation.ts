import { config } from './config.js'
import { getCandles } from './coinbase.js'
import { smallAccountEntryDecision } from './bollingerStrategy.js'

type Candle={start:number;low:number;high:number;open:number;close:number;volume:number}

const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0
const std=(xs:number[])=>{
  const m=avg(xs)
  return Math.sqrt(avg(xs.map(x=>(x-m)**2)))
}
const rsi=(closes:number[],period:number)=>{
  if(closes.length<period+1)return null
  let gains=0,losses=0
  for(let i=closes.length-period;i<closes.length;i++){
    const d=closes[i]-closes[i-1]
    if(d>=0)gains+=d
    else losses+=Math.abs(d)
  }
  const ag=gains/period,al=losses/period
  if(al===0)return 100
  return 100-(100/(1+(ag/al)))
}
const lowerBand=(closes:number[],period:number,mult:number)=>{
  if(closes.length<period)return null
  const slice=closes.slice(-period)
  const middle=avg(slice),sd=std(slice)
  return middle-(mult*sd)
}

export const simulatePaper1000FromCandles=(candles:Candle[],startingBalanceUsd=1000)=>{
  const feeRate=config.backtestMarketFeeRate
  const maxPositionUsd=startingBalanceUsd*(config.maxPositionPercent/100)
  const orderUsd=Math.max(1,Math.min(config.smallAccountMaxBuyUsd,maxPositionUsd))
  let cash=startingBalanceUsd
  let qty=0
  let entryUnitCost=0
  let peak=startingBalanceUsd
  let maxDrawdownPercent=0
  let wins=0,losses=0
  const trades:any[]=[]

  for(let i=Math.max(config.bbPeriod,config.rsiPeriod)+1;i<candles.length;i++){
    const history=candles.slice(0,i+1)
    const closes=history.map(c=>c.close)
    const candle=history.at(-1)!
    const prevCloses=closes.slice(0,-1)
    const lower=lowerBand(closes,config.bbPeriod,config.bbStdDev)
    const prevLower=lowerBand(prevCloses,config.bbPeriod,config.bbStdDev)
    const currentRsi=rsi(closes,config.rsiPeriod)
    const previousClose=prevCloses.at(-1)
    if(lower==null||prevLower==null||currentRsi==null||previousClose==null)continue

    if(qty>0){
      const grossValue=qty*candle.close
      const sellFee=grossValue*feeRate
      const netValue=grossValue-sellFee
      const costBasis=qty*entryUnitCost
      const pnl=netValue-costBasis
      const pnlPct=costBasis>0?(pnl/costBasis)*100:0
      const grossMovePct=((candle.close-entryUnitCost)/entryUnitCost)*100
      const stopHit=grossMovePct<=-config.fixedStopLossPercent
      const takeProfitHit=pnlPct>=config.takeProfitPercent && pnl>=config.smallAccountMinNetProfitUsd

      if(stopHit||takeProfitHit){
        cash+=netValue
        trades.push({side:'SELL',time:candle.start,price:candle.close,pnlUsd:pnl,pnlPercent:pnlPct,reason:stopHit?'STOP_LOSS':'TAKE_PROFIT'})
        if(pnl>=0)wins+=1
        else losses+=1
        qty=0
        entryUnitCost=0
      }
    }else{
      const crossedBelowLower=previousClose>=prevLower&&candle.close<lower
      const closeVsLowerPct=((candle.close-lower)/lower)*100
      const decision=smallAccountEntryDecision({rsiValue:currentRsi,closeVsLowerPct,crossedBelowLower})
      if(decision.ready&&cash>=orderUsd){
        const buyFee=orderUsd*feeRate
        const spend=orderUsd
        const assetValue=Math.max(0,spend-buyFee)
        qty=assetValue/candle.close
        entryUnitCost=spend/qty
        cash-=spend
        trades.push({side:'BUY',time:candle.start,price:candle.close,notionalUsd:spend,rsi:currentRsi,closeVsLowerPct})
      }
    }

    const equity=cash+(qty*candle.close)
    peak=Math.max(peak,equity)
    const dd=peak>0?((peak-equity)/peak)*100:0
    maxDrawdownPercent=Math.max(maxDrawdownPercent,dd)
  }

  const lastPrice=candles.at(-1)?.close||0
  const endingBalanceUsd=cash+(qty*lastPrice)
  const netProfitUsd=endingBalanceUsd-startingBalanceUsd
  const closed=wins+losses
  return {
    startingBalanceUsd,
    endingBalanceUsd:Number(endingBalanceUsd.toFixed(2)),
    netProfitUsd:Number(netProfitUsd.toFixed(2)),
    netProfitPercent:Number(((netProfitUsd/startingBalanceUsd)*100).toFixed(2)),
    wins,losses,closedTrades:closed,
    winRatePercent:closed?Number(((wins/closed)*100).toFixed(1)):0,
    maxDrawdownPercent:Number(maxDrawdownPercent.toFixed(2)),
    openPosition:qty>0,
    orderUsd:Number(orderUsd.toFixed(2)),
    feeRatePercent:Number((feeRate*100).toFixed(3)),
    candles:candles.length,
    rules:{
      rsiOversold:config.rsiOversold,
      takeProfitPercent:config.takeProfitPercent,
      stopLossPercent:config.fixedStopLossPercent,
      minNetProfitUsd:config.smallAccountMinNetProfitUsd
    },
    trades
  }
}

export const runPaper1000Simulation=async(productId:string,startingBalanceUsd=1000,candleLimit=1000)=>{
  const safeStart=Math.max(100,Math.min(100000,Number(startingBalanceUsd)||1000))
  const safeLimit=Math.max(120,Math.min(3000,Math.floor(Number(candleLimit)||1000)))
  const candles=await getCandles(productId.toUpperCase(),config.strategyGranularity,safeLimit)
  return {
    productId:productId.toUpperCase(),
    granularity:config.strategyGranularity,
    simulation:'PAPER_ONLY_NO_LIVE_ORDERS',
    ...simulatePaper1000FromCandles(candles,safeStart)
  }
}
