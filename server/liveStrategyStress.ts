import { config } from './config.js'
import { getCandles } from './coinbase.js'
import { getSetting,setSetting } from './db.js'
import { confirmedMeanReversionEntryDecision } from './bollingerStrategy.js'

export type StressCandle={start:number;low:number;high:number;open:number;close:number;volume:number}

type StressTrade={
  side:'BUY'|'SELL'
  time:number
  price:number
  pnlUsd?:number
  pnlPercent?:number
  reason?:'MICRO_NET_PROFIT'|'TRAILING_PROFIT'|'STOP_LOSS'
  entryRsi?:number
  entryCloseVsLowerPct?:number
  entryThreeCandleReturnPct?:number
  crossedBelowLower?:boolean
}

type ScenarioResult={
  productId:string
  start:number
  end:number
  trades:StressTrade[]
  closedTrades:number
  wins:number
  losses:number
  netPnlUsd:number
  stoppedByLossGuard:boolean
  noTrade:boolean
}

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
  const ag=gains/period
  const al=losses/period
  if(al===0)return 100
  return 100-(100/(1+(ag/al)))
}
const lowerBand=(closes:number[],period:number,mult:number)=>{
  if(closes.length<period)return null
  const slice=closes.slice(-period)
  const middle=avg(slice)
  return middle-(mult*std(slice))
}

const buildClosedTenMinuteBars=(fiveMinuteCandles:StressCandle[])=>{
  const buckets=new Map<number,StressCandle[]>()
  for(const candle of fiveMinuteCandles){
    const bucketStart=Math.floor(candle.start/600)*600
    const rows=buckets.get(bucketStart)||[]
    rows.push(candle)
    buckets.set(bucketStart,rows)
  }
  const result:StressCandle[]=[]
  for(const [bucketStart,rows] of [...buckets.entries()].sort((a,b)=>a[0]-b[0])){
    const ordered=rows.sort((a,b)=>a.start-b.start)
    const first=ordered.find(row=>row.start===bucketStart)
    const second=ordered.find(row=>row.start===bucketStart+300)
    if(!first||!second)continue
    result.push({
      start:bucketStart,
      open:first.open,
      high:Math.max(first.high,second.high),
      low:Math.min(first.low,second.low),
      close:second.close,
      volume:first.volume+second.volume
    })
  }
  return result
}

const tenMinuteMacroReady=(history:StressCandle[])=>{
  const bars=buildClosedTenMinuteBars(history)
  if(bars.length<config.macroBollingerPeriod)return false
  const closes=bars.map(row=>row.close)
  const latestClose=closes.at(-1)!
  const middle=avg(closes.slice(-config.macroBollingerPeriod))
  return latestClose>middle
}
const pct=(from:number,to:number)=>from>0?((to-from)/from)*100:0

export const buildStressWindows=(candles:StressCandle[],windowSize=120,step=40)=>{
  const out:StressCandle[][]=[]
  if(candles.length<windowSize)return out
  for(let i=0;i+windowSize<=candles.length;i+=step){
    out.push(candles.slice(i,i+windowSize))
  }
  return out
}

export const simulateLiveStrategyWindow=(productId:string,candles:StressCandle[]):ScenarioResult=>{
  const trades:StressTrade[]=[]
  if(candles.length<Math.max(config.bbPeriod,config.rsiPeriod)+3){
    return {productId,start:candles[0]?.start||0,end:candles.at(-1)?.start||0,trades,closedTrades:0,wins:0,losses:0,netPnlUsd:0,stoppedByLossGuard:false,noTrade:true}
  }

  const feeRate=config.backtestMarketFeeRate
  const orderUsd=config.maxLiveOrderUsd
  let qty=0
  let costBasisUsd=0
  let avgEntryPrice=0
  let fillEntryPrice=0
  let peakPrice=0
  let entryMeta:{rsi:number;closeVsLowerPct:number;threeCandleReturnPct:number;crossedBelowLower:boolean}|null=null
  let wins=0
  let losses=0
  let netPnlUsd=0
  let stoppedByLossGuard=false

  for(let i=Math.max(config.bbPeriod,config.rsiPeriod)+1;i<candles.length;i++){
    const history=candles.slice(0,i+1)
    const closes=history.map(c=>c.close)
    const candle=history.at(-1)!

    if(qty>0&&avgEntryPrice>0){
      peakPrice=Math.max(peakPrice||fillEntryPrice,candle.high)
      const stopPrice=fillEntryPrice*(1-config.fixedStopLossPercent/100)
      const activationNetValue=costBasisUsd*(1+config.trailingActivationNetPercent/100)
      const trailingActivationPrice=activationNetValue/(Math.max(1e-12,qty*(1-feeRate)))
      const trailingActive=peakPrice>=trailingActivationPrice
      const trailingStopPrice=peakPrice*(1-config.trailingDistancePercent/100)

      const stopHit=candle.low<=stopPrice
      const trailingHit=trailingActive&&candle.low<=trailingStopPrice

      // Conservative replay: if both levels were touched inside one 5-minute candle,
      // assume the hard stop happened first because candle ordering is unknown.
      if(stopHit||trailingHit){
        const sellPrice=stopHit?stopPrice:trailingStopPrice
        const sellGross=qty*sellPrice
        const sellFee=sellGross*feeRate
        const netProceeds=sellGross-sellFee
        const pnl=netProceeds-costBasisUsd
        const pnlPercent=costBasisUsd>0?(pnl/costBasisUsd)*100:0
        const reason=stopHit?'STOP_LOSS':microProfitHit?'MICRO_NET_PROFIT':'TRAILING_PROFIT'
        trades.push({
          side:'SELL',time:candle.start,price:sellPrice,pnlUsd:pnl,pnlPercent,reason,
          entryRsi:entryMeta?.rsi,entryCloseVsLowerPct:entryMeta?.closeVsLowerPct,
          entryThreeCandleReturnPct:entryMeta?.threeCandleReturnPct,crossedBelowLower:entryMeta?.crossedBelowLower
        })
        netPnlUsd+=pnl
        if(pnl<0)losses+=1
        else wins+=1
        qty=0
        peakPrice=0
        costBasisUsd=0
        avgEntryPrice=0
        fillEntryPrice=0
        entryMeta=null
      }
      continue
    }

    const prevCloses=closes.slice(0,-1)
    const lower=lowerBand(closes,config.bbPeriod,config.bbStdDev)
    const prevLower=lowerBand(prevCloses,config.bbPeriod,config.bbStdDev)
    const currentRsi=rsi(closes,config.rsiPeriod)
    const previousRsi=rsi(prevCloses,config.rsiPeriod)
    const previousClose=prevCloses.at(-1)
    const previousCandle=candles[i-1]
    if(lower==null||prevLower==null||currentRsi==null||previousRsi==null||previousClose==null||!previousCandle)continue

    const crossedBelowLower=candle.close<lower
    const closeVsLowerPct=((candle.close-lower)/lower)*100
    const lookback=Math.max(0,i-3)
    const threeCandleReturnPct=pct(candles[lookback].close,candle.close)
    const priorVolumes=candles.slice(Math.max(0,i-config.entryVolumeLookbackCandles),i).map(x=>Number(x.volume||0)).filter(v=>v>0)
    const averageVolume=priorVolumes.length===config.entryVolumeLookbackCandles?avg(priorVolumes):0
    const decision=confirmedMeanReversionEntryDecision({
      rsiValue:currentRsi,
      previousRsiValue:previousRsi,
      closeVsLowerPct,
      crossedBelowLower,
      previousClose,
      previousHigh:previousCandle.high,
      previousLower:prevLower,
      currentClose:candle.close,
      currentLower:lower,
      threeCandleReturnPct,
      currentVolume:Number(candle.volume||0),
      averageVolume
    })
    if(!decision.ready||!tenMinuteMacroReady(history))continue

    const buyFee=orderUsd*feeRate
    const filledValue=Math.max(0,orderUsd-buyFee)
    qty=filledValue/candle.close
    costBasisUsd=orderUsd
    avgEntryPrice=costBasisUsd/qty
    fillEntryPrice=candle.close
    entryMeta={rsi:currentRsi,closeVsLowerPct,threeCandleReturnPct,crossedBelowLower}
    trades.push({
      side:'BUY',time:candle.start,price:candle.close,
      entryRsi:currentRsi,entryCloseVsLowerPct:closeVsLowerPct,
      entryThreeCandleReturnPct:threeCandleReturnPct,crossedBelowLower
    })
  }

  const closedTrades=wins+losses
  return {
    productId,
    start:candles[0]?.start||0,
    end:candles.at(-1)?.start||0,
    trades,
    closedTrades,
    wins,
    losses,
    netPnlUsd,
    stoppedByLossGuard:false,
    noTrade:trades.every(t=>t.side!=='BUY')
  }
}

const summarizeLossPatterns=(scenarios:ScenarioResult[])=>{
  const losses=scenarios.flatMap(s=>s.trades.filter(t=>t.side==='SELL'&&t.reason==='STOP_LOSS'))
  const buckets=[
    {id:'RSI_30_TO_35',label:'RSI 30–35',match:(t:StressTrade)=>(t.entryRsi??999)>30&&(t.entryRsi??999)<=35},
    {id:'RSI_UNDER_30',label:'RSI <= 30',match:(t:StressTrade)=>(t.entryRsi??999)<=30},
    {id:'BELOW_BAND',label:'Entry closed below lower Bollinger band',match:(t:StressTrade)=>(t.entryCloseVsLowerPct??999)<0},
    {id:'FAST_DROP_3_CANDLES',label:'Price already fell >1% across prior 3 candles',match:(t:StressTrade)=>(t.entryThreeCandleReturnPct??0)<=-1},
    {id:'CROSS_BELOW',label:'Fresh cross below lower Bollinger band',match:(t:StressTrade)=>Boolean(t.crossedBelowLower)}
  ]
  return buckets
    .map(b=>({id:b.id,label:b.label,losses:losses.filter(b.match).length}))
    .filter(x=>x.losses>0)
    .sort((a,b)=>b.losses-a.losses)
}

export const aggregateStressResults=(scenarios:ScenarioResult[])=>{
  const total=scenarios.length
  const withTrade=scenarios.filter(s=>!s.noTrade)
  const closedTrades=scenarios.reduce((n,s)=>n+s.closedTrades,0)
  const wins=scenarios.reduce((n,s)=>n+s.wins,0)
  const losses=scenarios.reduce((n,s)=>n+s.losses,0)
  const netPnlUsd=scenarios.reduce((n,s)=>n+s.netPnlUsd,0)
  const profitableScenarios=scenarios.filter(s=>s.netPnlUsd>0).length
  const losingScenarios=scenarios.filter(s=>s.netPnlUsd<0).length
  const lossPatterns=summarizeLossPatterns(scenarios)
  return {
    scenarioCount:total,
    scenariosWithTrade:withTrade.length,
    noTradeScenarios:total-withTrade.length,
    profitableScenarios,
    losingScenarios,
    closedTrades,
    wins,
    losses,
    winRatePercent:closedTrades?Number(((wins/closedTrades)*100).toFixed(2)):0,
    netPnlUsd:Number(netPnlUsd.toFixed(4)),
    averagePnlPerClosedTradeUsd:closedTrades?Number((netPnlUsd/closedTrades).toFixed(4)):0,
    lossGuardStops:scenarios.filter(s=>s.stoppedByLossGuard).length,
    lossPatterns,
    caution:losses>0
      ?'Historical replay found losing setups. Use the loss-pattern report to tighten entry filters; this does not guarantee future results.'
      :'No realized losses appeared in this replay, but historical results cannot guarantee future profit.'
  }
}

export const runLiveStrategyStressTest=async(input?:{productIds?:string[];candleLimit?:number})=>{
  const productIds=(input?.productIds?.length?input.productIds:config.watchlist.slice(0,5))
    .map(x=>x.toUpperCase())
    .slice(0,8)
  const candleLimit=Math.max(600,Math.min(3000,Math.floor(Number(input?.candleLimit)||1200)))
  const all:ScenarioResult[]=[]
  const products:any[]=[]

  for(const productId of productIds){
    const candles=await getCandles(productId,config.strategyGranularity,candleLimit)
    const windows=buildStressWindows(candles,120,40)
    const results=windows.map(window=>simulateLiveStrategyWindow(productId,window))
    all.push(...results)
    products.push({
      productId,
      candles:candles.length,
      scenarios:results.length,
      ...aggregateStressResults(results)
    })
  }

  const summary=aggregateStressResults(all)
  const result={
    generatedAt:new Date().toISOString(),
    mode:'HISTORICAL_COINBASE_STRESS_TEST_ONLY',
    usesLiveOrderSubmission:false,
    granularity:config.strategyGranularity,
    candleLimit,
    products,
    ...summary,
    rules:{
      bbPeriod:config.bbPeriod,
      bbStdDev:config.bbStdDev,
      rsiPeriod:config.rsiPeriod,
      rsiStrictlyBelow:config.entryRsiStrictlyBelow,
      macro10mCloseAboveBollingerMiddle:true,
      trailingActivationNetPercent:config.trailingActivationNetPercent,
      trailingDistancePercent:config.trailingDistancePercent,
      stopLossPercent:config.fixedStopLossPercent,
      minNetProfitUsd:config.smallAccountMinNetProfitUsd,
      assumedMarketFeeRatePercent:Number((config.backtestMarketFeeRate*100).toFixed(4)),
      rollingKillSwitchPercent:config.rollingKillSwitchPercent,
      entryConfirmation:'Latest closed 10m candle above Bollinger middle/SMA20; closed 5m close below lower Bollinger; RSI14 <30; 5m volume >=1.5x prior VMA20',
      stopLossBasis:'ACTUAL_FILL_PRICE_NOT_FEE_LOADED_COST_BASIS'
    }
  }
  setSetting('live_strategy_stress_last',JSON.stringify(result))
  return result
}

export const getLatestLiveStrategyStressTest=()=>{
  const raw=getSetting('live_strategy_stress_last','')
  if(!raw)return null
  try{return JSON.parse(raw)}catch{return null}
}
