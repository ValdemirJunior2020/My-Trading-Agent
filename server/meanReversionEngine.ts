import { config, coinbaseConfigured } from './config.js'
import { getCandles, getProduct, listAccounts } from './coinbase.js'
import { publish } from './events.js'
import { scanCryptoMarket } from './scanner.js'
import { researchCryptoCandidates } from './marketResearch.js'
import { tryLimitedLiveExecution, checkRollingEquityKillSwitch, emergencyStopActive, getOpenBotExposureSummary, triggerUnrealizedPriceLossPause } from './risk.js'
import { getChallengeSnapshot } from './challenge.js'
import { confirmedMeanReversionEntryDecision, getBotManagedLots, getBotManagedPosition } from './bollingerStrategy.js'
import { NEXT_WEEK_BREAKOUT,breakoutHardStopPrice,breakoutTrailingActivationPrice,breakoutTrailingStopPrice,evaluateBreakoutConfirmation,nextWeekBreakoutActive } from './velocityBreakout.js'

type Candle={
  start:number
  low:number
  high:number
  open:number
  close:number
  volume:number
}

type ProductState={
  closed:Candle[]
  current:Candle|null
  position:{qty:number;avgEntryPrice:number}
  lastPositionRefreshAt:number
}

const WS_URL='wss://advanced-trade-ws.coinbase.com'
const FIVE_MINUTE_SECONDS=300
const MAX_HISTORY=100
const states=new Map<string,ProductState>()
const executionLocks=new Set<string>()
const exitAttemptAt=new Map<string,number>()
const breakoutPeaks=new Map<string,number>()
const meanReversionPeaks=new Map<string,number>()
const lastHandledClosedStart=new Map<string,number>()
const researchPriorityProducts=new Set<string>()
let researchPrioritySource:'OLLAMA'|'LIQUIDITY_FALLBACK'='LIQUIDITY_FALLBACK'

let ws:WebSocket|null=null
let reconnectTimer:NodeJS.Timeout|null=null
let safetyTimer:NodeJS.Timeout|null=null
let running=false
let safePause=false
let reconnectAttempt=0
let products:string[]=[]

const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0
const std=(xs:number[])=>{
  const m=avg(xs)
  return Math.sqrt(avg(xs.map(x=>(x-m)**2)))
}

const lowerBand=(closes:number[])=>{
  const slice=closes.slice(-config.bbPeriod)
  if(slice.length<config.bbPeriod)return null
  const middle=avg(slice)
  return middle-(config.bbStdDev*std(slice))
}

const middleBandWithLivePrice=(closes:number[],livePrice:number)=>{
  const needed=Math.max(0,config.bbPeriod-1)
  const basis=closes.slice(-needed)
  if(basis.length<needed)return null
  return avg([...basis,livePrice])
}

const rsi=(closes:number[])=>{
  const period=config.rsiPeriod
  if(closes.length<period+1)return null
  let gains=0
  let losses=0
  for(let i=closes.length-period;i<closes.length;i++){
    const delta=closes[i]-closes[i-1]
    if(delta>0)gains+=delta
    else if(delta<0)losses+=Math.abs(delta)
  }
  const averageGain=gains/period
  const averageLoss=losses/period
  if(averageLoss===0)return 100
  const rs=averageGain/averageLoss
  return 100-(100/(1+rs))
}

const normalizeCandle=(raw:any):Candle|null=>{
  const start=Number(raw?.start)
  const open=Number(raw?.open)
  const high=Number(raw?.high)
  const low=Number(raw?.low)
  const close=Number(raw?.close)
  const volume=Number(raw?.volume||0)
  if(!Number.isFinite(start)||!Number.isFinite(close)||!(close>0))return null
  return {start,open,high,low,close,volume}
}

const appendClosed=(state:ProductState,candle:Candle)=>{
  const map=new Map<number,Candle>()
  for(const row of state.closed)map.set(row.start,row)
  map.set(candle.start,candle)
  state.closed=[...map.values()].sort((a,b)=>a.start-b.start).slice(-MAX_HISTORY)
}

const fiveMinuteMacroContext=(fiveMinuteCandles:Candle[])=>{
  const bars=[...fiveMinuteCandles].sort((a,b)=>a.start-b.start)
  if(bars.length<config.macroBollingerPeriod)return {
    ready:false,
    reason:'NOT_ENOUGH_CLOSED_5M_BARS',
    candleCount:bars.length,
    latestClose:null,
    middleBand:null
  }
  const closes=bars.map(row=>row.close)
  const latestClose=closes.at(-1)!
  const middleBand=avg(closes.slice(-config.macroBollingerPeriod))
  return {
    ready:latestClose>middleBand,
    reason:latestClose>middleBand?'ABOVE_5M_BOLLINGER_MIDDLE':'NOT_ABOVE_5M_BOLLINGER_MIDDLE',
    candleCount:bars.length,
    latestClose,
    middleBand,
    latestStart:bars.at(-1)!.start
  }
}

const refreshPosition=(productId:string,state:ProductState,force=false)=>{
  if(!force&&Date.now()-state.lastPositionRefreshAt<5000)return state.position
  state.position=getBotManagedPosition(productId)
  state.lastPositionRefreshAt=Date.now()
  return state.position
}

const smallAccountBuyIsExecutable=async(productId:string)=>{
  try{
    const [product,accounts]=await Promise.all([
      getProduct(productId),
      listAccounts()
    ])
    const usdAccount=(accounts as any[]).find((a:any)=>String(a.currency||'').toUpperCase()==='USD')
    const availableUsd=Number(usdAccount?.availableBalance?.value??usdAccount?.availableBalance??0)||0
    const quoteMin=Math.max(config.minLiveOrderUsd,Number((product as any)?.quote_min_size||0))
    const quoteMax=Number((product as any)?.quote_max_size||Infinity)
    const step=Math.max(0.01,Number(config.buyStepUsd||5))
    const affordable=Math.floor((Math.min(availableUsd,quoteMax)+1e-9)/step)*step
    const requestedUsd=Number(affordable.toFixed(2))

    return {
      ok:requestedUsd+1e-8>=quoteMin&&requestedUsd>0,
      requestedUsd,
      availableUsd,
      quoteMin,
      quoteMax,
      buyStepUsd:step
    }
  }catch(error){
    return {ok:false,error:error instanceof Error?error.message:String(error)}
  }
}

const handleClosedCandle=async(productId:string,candle:Candle)=>{
  if(emergencyStopActive())return
  const state=states.get(productId)
  if(!state)return

  const lastHandled=Number(lastHandledClosedStart.get(productId)||0)
  if(candle.start<=lastHandled)return
  // Claim the candle before any async work so duplicate websocket snapshots or
  // overlapping callbacks cannot evaluate the same closed 5m candle twice.
  lastHandledClosedStart.set(productId,candle.start)

  appendClosed(state,candle)

  if(nextWeekBreakoutActive()){
    try{
      const breakout=await evaluateBreakoutConfirmation(productId,state.closed)
      publish('next_week_breakout_candle',{
        productId,
        candleStart:candle.start,
        candleClose:candle.close,
        ready:Boolean(breakout.ready),
        crossedAboveUpper:Boolean(breakout.crossedAboveUpper),
        volumeRatio20:Number(breakout.volumeRatio20||0),
        discovery:breakout.discovery||null,
        executionMode:'ADVISORY_ONLY',
        rules:NEXT_WEEK_BREAKOUT
      },'strategy')
    }catch(error){
      publish('next_week_breakout_scan_failed',{
        productId,
        error:error instanceof Error?error.message:String(error)
      },'strategy')
    }
  }

  const closes=state.closed.map(x=>x.close)
  if(closes.length<Math.max(config.bbPeriod+1,config.rsiPeriod+1,config.macroBollingerPeriod*2))return

  const currentLower=lowerBand(closes)
  const previousCloses=closes.slice(0,-1)
  const previousLower=lowerBand(previousCloses)
  const currentRsi=rsi(closes)
  const previousRsi=rsi(previousCloses)
  const previousClose=previousCloses.at(-1)
  const previousCandle=state.closed.at(-2)

  if(currentLower==null||previousLower==null||currentRsi==null||previousRsi==null||previousClose==null||!previousCandle)return

  const closeBelowLowerBand=candle.close<currentLower
  const closeVsLowerPct=currentLower>0
    ? ((candle.close-currentLower)/currentLower)*100
    : Infinity
  const threeLookbackClose=closes.at(-4)??previousClose
  const threeCandleReturnPct=threeLookbackClose>0?((candle.close-threeLookbackClose)/threeLookbackClose)*100:0
  const priorVolumes=state.closed
    .slice(-(config.entryVolumeLookbackCandles+1),-1)
    .map(x=>Number(x.volume||0))
    .filter(v=>v>0)
  const averageVolume=priorVolumes.length===config.entryVolumeLookbackCandles?avg(priorVolumes):0

  const entryDecision=confirmedMeanReversionEntryDecision({
    rsiValue:currentRsi,
    previousRsiValue:previousRsi,
    closeVsLowerPct,
    crossedBelowLower:closeBelowLowerBand,
    previousClose,
    previousHigh:previousCandle.high,
    previousLower,
    currentClose:candle.close,
    currentLower,
    threeCandleReturnPct,
    currentVolume:Number(candle.volume||0),
    averageVolume
  })
  const macro=fiveMinuteMacroContext(state.closed)
  const position=refreshPosition(productId,state,true)
  const globalExposure=getOpenBotExposureSummary()
  const openBotProductIds=globalExposure.positions.map(row=>row.productId)

  const macroMiddle=Number(macro.middleBand||0)
  const macroExtensionPercent=macroMiddle>0
    ?((candle.close-macroMiddle)/macroMiddle)*100
    :Infinity
  const researchPriority=researchPriorityProducts.has(productId)
  const activeCapitalPrioritySource=researchPriority?researchPrioritySource:null

  const strongEntryReady=Boolean(
    entryDecision.ready&&
    macro.ready&&
    position.qty<=0
  )

  const activeCapitalReady=Boolean(
    !strongEntryReady&&
    researchPriority&&
    macro.ready&&
    position.qty<=0&&
    currentRsi>=config.activeCapitalRsiMin&&
    currentRsi<=config.activeCapitalRsiMax&&
    entryDecision.volumeRatio>=config.activeCapitalMinimumVolumeRatio&&
    macroExtensionPercent<=config.activeCapitalMaxMacroExtensionPercent
  )

  const deterministicReady=Boolean(strongEntryReady||activeCapitalReady)
  const entryMode=strongEntryReady
    ?'STRONG_ENTRY'
    :activeCapitalReady
      ?'ACTIVE_CAPITAL'
      :'WAIT'

  publish('mean_reversion_candle_closed',{
    productId,
    timestampIso:new Date().toISOString(),
    monotonicNs:process.hrtime.bigint().toString(),
    candleStart:candle.start,
    candleClose:candle.close,
    bollingerLower:currentLower,
    bollingerMiddle:avg(closes.slice(-config.bbPeriod)),
    closeBelowLowerBand,
    rsi:currentRsi,
    rsiThresholdExclusive:config.entryRsiStrictlyBelow,
    positionOpen:position.qty>0,
    openBotProductIds,
    globalOpenBotPositions:globalExposure.openBotPositions,
    currentVolume:Number(candle.volume||0),
    averageVolume20:averageVolume,
    volumeRatio:entryDecision.volumeRatio,
    minimumVolumeRatio:config.entryMinimumVolumeRatio,
    macro5m:macro,
    macroExtensionPercent,
    researchPriority,
    activeCapitalPrioritySource,
    strongEntryReady,
    activeCapitalReady,
    entryMode,
    deterministicReady,
    entryBlockers:deterministicReady
      ?[]
      :[
          ...entryDecision.blockers,
          ...(macro.ready?[]:['FIVE_MINUTE_MACRO_FILTER_BLOCKED']),
          ...(researchPriority?[]:['NOT_IN_OLLAMA_RESEARCH_PRIORITY']),
          ...(currentRsi>=config.activeCapitalRsiMin?[]:['ACTIVE_CAPITAL_RSI_TOO_LOW']),
          ...(currentRsi<=config.activeCapitalRsiMax?[]:['ACTIVE_CAPITAL_RSI_TOO_HIGH']),
          ...(entryDecision.volumeRatio>=config.activeCapitalMinimumVolumeRatio?[]:['ACTIVE_CAPITAL_VOLUME_TOO_LOW']),
          ...(macroExtensionPercent<=config.activeCapitalMaxMacroExtensionPercent?[]:['ACTIVE_CAPITAL_TOO_EXTENDED_ABOVE_SMA20']),
          ...(position.qty>0?['PRODUCT_ALREADY_HAS_OPEN_BOT_POSITION']:[])
        ]
  },'strategy')

  if(!deterministicReady)return

  const executable=await smallAccountBuyIsExecutable(productId)
  if(!executable.ok){
    publish('mean_reversion_buy_skipped',{
      productId,
      timestampIso:new Date().toISOString(),
      monotonicNs:process.hrtime.bigint().toString(),
      reason:'NO_AFFORDABLE_COINBASE_BUY_SIZE',
      ...executable
    },'strategy')
    return
  }

  publish('mean_reversion_buy_signal',{
    productId,
    timestampIso:new Date().toISOString(),
    monotonicNs:process.hrtime.bigint().toString(),
    triggerPrice:candle.close,
    candleStart:candle.start,
    lowerBand:currentLower,
    rsi:currentRsi,
    volumeRatio:entryDecision.volumeRatio,
    macro5m:macro,
    entryMode,
    researchPriority,
    activeCapitalPrioritySource,
    macroExtensionPercent,
    rules:entryMode==='STRONG_ENTRY'
      ?{
          macro5mCloseAboveBollingerMiddle:true,
          fiveMinuteCloseStrictlyBelowLowerBand:true,
          currentRsiStrictlyBelow:config.entryRsiStrictlyBelow,
          minimumVolumeRatio:config.entryMinimumVolumeRatio,
          volumeLookbackCandles:config.entryVolumeLookbackCandles,
          requestedBuyUsd:executable.requestedUsd,
          buyStepUsd:config.buyStepUsd,
          maxEntrySlippagePercent:config.maxSlippagePercent
        }
      :{
          mode:'ACTIVE_CAPITAL',
          ollamaResearchPriority:true,
          macro5mCloseAboveBollingerMiddle:true,
          rsiMin:config.activeCapitalRsiMin,
          rsiMax:config.activeCapitalRsiMax,
          minimumVolumeRatio:config.activeCapitalMinimumVolumeRatio,
          maximumMacroExtensionPercent:config.activeCapitalMaxMacroExtensionPercent,
          requestedBuyUsd:executable.requestedUsd,
          buyStepUsd:config.buyStepUsd,
          maxEntrySlippagePercent:config.maxSlippagePercent
        }
  },'strategy')

  // Serialize BUY execution across all products. This prevents simultaneous
  // signals from sizing against the same pre-order cash/exposure snapshot.
  const lock='BUY:GLOBAL'
  if(executionLocks.has(lock))return
  executionLocks.add(lock)
  try{
    const result=await tryLimitedLiveExecution({
      productId,
      decision:'BUY_CANDIDATE',
      confidence:1,
      triggerPrice:candle.close,
      requestedBuyUsd:executable.requestedUsd,
      executionSource:'MEAN_REVERSION'
    })
    publish('mean_reversion_entry_result',{
      productId,
      timestampIso:new Date().toISOString(),
      monotonicNs:process.hrtime.bigint().toString(),
      result
    },'execution')
    if(result?.executed){
      state.position={
        qty:Number(result.executedQty||0),
        avgEntryPrice:Number(result.actualFillPrice||0)
      }
      state.lastPositionRefreshAt=Date.now()
      publish('mean_reversion_position_opened',{
        productId,
        timestampIso:new Date().toISOString(),
        monotonicNs:process.hrtime.bigint().toString(),
        orderId:result.orderId,
        entryPrice:state.position.avgEntryPrice,
        quantity:state.position.qty,
        hardStopPrice:state.position.avgEntryPrice*(1-config.fixedStopLossPercent/100),
        stopLossPercent:config.fixedStopLossPercent,
        strategyControl:'DETERMINISTIC_SERVER_ONLY'
      },'execution')
    }
  }finally{
    executionLocks.delete(lock)
  }
}

const handleTicker=async(productId:string,price:number)=>{
  if(emergencyStopActive())return
  if(!(price>0))return
  const state=states.get(productId)
  if(!state)return

  const lots=getBotManagedLots(productId)
  if(!lots.length)return

  const breakoutLot=lots.find(lot=>String(lot.executionSource||'')==='NEXT_WEEK_BREAKOUT')
  if(breakoutLot){
    const key=productId+':'+breakoutLot.orderId
    const previousPeak=Number(breakoutPeaks.get(key)||breakoutLot.fillEntryPrice||price)
    const peak=Math.max(previousPeak,price)
    breakoutPeaks.set(key,peak)

    const hardStop=breakoutHardStopPrice(breakoutLot.fillEntryPrice||breakoutLot.avgEntryPrice)
    const activation=breakoutTrailingActivationPrice(breakoutLot.avgEntryPrice)
    const trailingActive=peak>=activation
    const trailingStop=breakoutTrailingStopPrice(peak)
    const hardStopHit=price<=hardStop
    const trailingHit=trailingActive&&price<=trailingStop

    if(hardStopHit||trailingHit){
      const estimatedBreakoutNetProceeds=price*breakoutLot.qty*(1-config.backtestMarketFeeRate)
      const estimatedBreakoutNetProfitUsd=estimatedBreakoutNetProceeds-breakoutLot.costUsd
      const breakoutProfitReady=estimatedBreakoutNetProfitUsd+1e-9>=config.smallAccountMinNetProfitUsd

      if(hardStopHit&&!breakoutProfitReady){
        triggerUnrealizedPriceLossPause({
          productId,
          livePrice:price,
          stopPrice:hardStop,
          estimatedNetProfitUsd:estimatedBreakoutNetProfitUsd
        })
        return
      }
      if(!breakoutProfitReady)return

      const reason='BREAKOUT_TRAILING_PROFIT'
      const exitKey=key+':'+reason
      const lastAttempt=Number(exitAttemptAt.get(exitKey)||0)
      if(Date.now()-lastAttempt<2000)return
      const lock='SELL:'+productId
      if(executionLocks.has(lock))return
      exitAttemptAt.set(exitKey,Date.now())
      executionLocks.add(lock)
      publish('next_week_breakout_exit_signal',{
        productId,
        sourceLotOrderId:breakoutLot.orderId,
        reason,
        livePrice:price,
        fillEntryPrice:breakoutLot.fillEntryPrice,
        feeLoadedEntryPrice:breakoutLot.avgEntryPrice,
        peakPrice:peak,
        activationPrice:activation,
        trailingStopPrice:trailingStop,
        hardStopPrice:hardStop
      },'strategy')
      try{
        const result=await tryLimitedLiveExecution({
          productId,
          decision:'SELL_CANDIDATE',
          confidence:1,
          triggerPrice:price,
          baseSizeOverride:breakoutLot.qty,
          exitReason:reason,
          avgEntryPrice:breakoutLot.avgEntryPrice,
          sourceLotOrderId:breakoutLot.orderId,
          requiredNetProfitPercent:NEXT_WEEK_BREAKOUT.minimumTrailingExitNetPercent,
          requiredNetProfitUsd:config.smallAccountMinNetProfitUsd,
          executionSource:'NEXT_WEEK_BREAKOUT'
        })
        publish('next_week_breakout_exit_result',{productId,reason,result},'execution')
        if(result?.executed){
          breakoutPeaks.delete(key)
          state.position=getBotManagedPosition(productId)
          state.lastPositionRefreshAt=Date.now()
        }
      }finally{
        executionLocks.delete(lock)
      }
    }
    return
  }

  const closes=state.closed.map(x=>x.close)
  const middle=middleBandWithLivePrice(closes,price)
  if(middle==null)return

  const targetLot=
    lots.find(lot=>String(lot.executionSource||'')==='MEAN_REVERSION')||
    lots.find(lot=>String(lot.executionSource||'')!=='NEXT_WEEK_BREAKOUT')
  if(!targetLot)return

  const key=productId+':'+targetLot.orderId
  const previousPeak=Number(meanReversionPeaks.get(key)||targetLot.fillEntryPrice||targetLot.avgEntryPrice||price)
  const peak=Math.max(previousPeak,price)
  meanReversionPeaks.set(key,peak)

  const stopEntryPrice=targetLot.fillEntryPrice||targetLot.avgEntryPrice
  const stopPrice=stopEntryPrice*(1-config.fixedStopLossPercent/100)
  const activationPrice=
    targetLot.avgEntryPrice*(1+config.trailingActivationNetPercent/100)/
    Math.max(1e-12,1-config.backtestMarketFeeRate)
  const trailingActive=peak>=activationPrice
  const trailingStopPrice=peak*(1-config.trailingDistancePercent/100)
  const stopLoss=price<=stopPrice
  const trailingHit=trailingActive&&price<=trailingStopPrice

  const estimatedSellGrossUsd=price*targetLot.qty
  const estimatedSellFeeUsd=estimatedSellGrossUsd*config.backtestMarketFeeRate
  const estimatedNetProceedsUsd=estimatedSellGrossUsd-estimatedSellFeeUsd
  const estimatedNetProfitUsd=estimatedNetProceedsUsd-targetLot.costUsd
  const microProfitReady=
    estimatedNetProfitUsd+1e-9>=config.smallAccountMinNetProfitUsd

  // A price-stop breach while net-negative pauses NEW BUYs but never sells
  // this position at a loss. Existing positions remain monitored until a
  // fee-aware profitable exit is available.
  if(stopLoss&&!microProfitReady){
    triggerUnrealizedPriceLossPause({
      productId,
      livePrice:price,
      stopPrice,
      estimatedNetProfitUsd
    })
    return
  }

  // Normal strategy exits are profit-only.
  if(!microProfitReady)return

  const reason=trailingHit?'TRAILING_PROFIT':'MICRO_NET_PROFIT'
  const exitKey=key+':'+reason
  const retryMs=30000
  const lastAttempt=Number(exitAttemptAt.get(exitKey)||0)
  if(Date.now()-lastAttempt<retryMs)return

  const lock='SELL:'+productId
  if(executionLocks.has(lock))return
  exitAttemptAt.set(exitKey,Date.now())
  executionLocks.add(lock)

  publish('mean_reversion_exit_signal',{
    productId,
    sourceLotOrderId:targetLot.orderId,
    reason,
    livePrice:price,
    entryPrice:targetLot.avgEntryPrice,
    fillEntryPrice:stopEntryPrice,
    quantity:targetLot.qty,
    lotCostUsd:targetLot.costUsd,
    middleBand:middle,
    peakPrice:peak,
    trailingActive,
    trailingActivationPrice:activationPrice,
    trailingActivationNetPercent:config.trailingActivationNetPercent,
    trailingStopPrice,
    trailingDistancePercent:config.trailingDistancePercent,
    estimatedSellGrossUsd,
    estimatedSellFeeUsd,
    estimatedNetProceedsUsd,
    estimatedNetProfitUsd,
    minimumNetProfitUsd:config.smallAccountMinNetProfitUsd,
    microProfitReady,
    stopPrice,
    stopLossPercent:config.fixedStopLossPercent
  },'strategy')

  try{
    // SELL exits are deterministic and safety/risk controlled.
    // Profit exits are fee-aware: the live Coinbase preview must still show
    // at least the configured net-dollar profit before the order is sent.
    const confidence=1

    const result=await tryLimitedLiveExecution({
      productId,
      decision:'SELL_CANDIDATE',
      confidence,
      triggerPrice:price,
      baseSizeOverride:targetLot.qty,
      exitReason:reason,
      avgEntryPrice:targetLot.avgEntryPrice,
      sourceLotOrderId:targetLot.orderId,
      requiredNetProfitPercent:0,
      requiredNetProfitUsd:config.smallAccountMinNetProfitUsd,
      executionSource:'MEAN_REVERSION'
    })
    publish('mean_reversion_exit_result',{
      productId,
      sourceLotOrderId:targetLot.orderId,
      reason,
      result
    },'execution')
    if(result?.executed){
      meanReversionPeaks.delete(key)
      state.position=getBotManagedPosition(productId)
      state.lastPositionRefreshAt=Date.now()
    }
  }finally{
    executionLocks.delete(lock)
  }
}
const processCandlePayload=(data:any)=>{
  const events=Array.isArray(data?.events)?data.events:[]
  for(const event of events){
    const rows=Array.isArray(event?.candles)?event.candles:[]
    const grouped=new Map<string,Candle[]>()
    for(const raw of rows){
      const productId=String(raw?.product_id||raw?.productId||'').toUpperCase()
      const candle=normalizeCandle(raw)
      if(!productId||!candle||!states.has(productId))continue
      const list=grouped.get(productId)||[]
      list.push(candle)
      grouped.set(productId,list)
    }

    for(const [productId,list] of grouped){
      list.sort((a,b)=>a.start-b.start)
      const state=states.get(productId)!

      // Coinbase sends a multi-candle snapshot immediately after subscribing.
      // Warm the local history from that snapshot, but never replay old candles
      // through live BUY/SELL signal handling.
      if(!state.current){
        const latest=list.at(-1)
        if(!latest)continue
        for(const historical of list.slice(0,-1))appendClosed(state,historical)
        state.current=latest
        continue
      }

      for(const candle of list){
        if(candle.start<state.current.start)continue
        if(candle.start===state.current.start){
          state.current=candle
          continue
        }
        if(candle.start>state.current.start){
          const finished=state.current
          state.current=candle
          void handleClosedCandle(productId,finished)
        }
      }
    }
  }
}

const processTickerPayload=(data:any)=>{
  const events=Array.isArray(data?.events)?data.events:[]
  for(const event of events){
    const rows=Array.isArray(event?.tickers)?event.tickers:[]
    for(const raw of rows){
      const productId=String(raw?.product_id||raw?.productId||'').toUpperCase()
      const price=Number(raw?.price)
      if(productId&&states.has(productId)&&price>0){
        void handleTicker(productId,price)
      }
    }
  }
}

const scheduleReconnect=()=>{
  if(!running||reconnectTimer)return
  const delay=Math.min(30000,1000*(2**Math.min(reconnectAttempt,5)))
  reconnectAttempt+=1
  reconnectTimer=setTimeout(()=>{
    reconnectTimer=null
    connect()
  },delay)
}

const connect=()=>{
  if(!running||!products.length)return

  try{
    ws=new WebSocket(WS_URL)

    ws.onopen=()=>{
      reconnectAttempt=0
      publish('coinbase_strategy_stream_connected',{products:products.length},'strategy')
      ws?.send(JSON.stringify({type:'subscribe',channel:'candles',product_ids:products}))
      ws?.send(JSON.stringify({type:'subscribe',channel:'ticker',product_ids:products}))
      ws?.send(JSON.stringify({type:'subscribe',channel:'heartbeats'}))
    }

    ws.onmessage=(event)=>{
      try{
        const raw=typeof event.data==='string'?event.data:String(event.data)
        const data=JSON.parse(raw)
        const channel=String(data?.channel||'')
        if(channel==='candles')processCandlePayload(data)
        else if(channel==='ticker')processTickerPayload(data)
      }catch(error){
        publish('coinbase_strategy_stream_message_error',{
          error:error instanceof Error?error.message:String(error)
        },'strategy')
      }
    }

    ws.onerror=()=>{
      publish('coinbase_strategy_stream_error',{error:'WebSocket connection error'},'strategy')
    }

    ws.onclose=(event)=>{
      publish('coinbase_strategy_stream_closed',{
        code:event.code,
        reason:event.reason
      },'strategy')
      ws=null
      scheduleReconnect()
    }
  }catch(error){
    publish('coinbase_strategy_stream_error',{
      error:error instanceof Error?error.message:String(error)
    },'strategy')
    scheduleReconnect()
  }
}

const seedProduct=async(productId:string)=>{
  const nowBucket=Math.floor(Date.now()/1000/FIVE_MINUTE_SECONDS)*FIVE_MINUTE_SECONDS
  const candles=await getCandles(productId,'FIVE_MINUTE',80)
  const closed=candles
    .filter(c=>c.start<nowBucket)
    .sort((a,b)=>a.start-b.start)
    .slice(-MAX_HISTORY)

  // Seed the watermark from REST history so process restarts do not replay the
  // most recent already-closed candle when the websocket snapshot arrives.
  lastHandledClosedStart.set(productId,Number(closed.at(-1)?.start||0))

  states.set(productId,{
    closed,
    current:null,
    position:getBotManagedPosition(productId),
    lastPositionRefreshAt:Date.now()
  })
}

const seedUniverse=async()=>{
  const scan=await scanCryptoMarket()
  const rows:any[]=Array.isArray(scan.results)?scan.results:[]
  const liquidRows=rows.filter((row:any)=>{
    const dollarVolume24h=Number(row?.dollarVolume24h||0)
    const spreadBps=row?.spreadBps==null?null:Number(row.spreadBps)
    return dollarVolume24h>=config.smallAccountMinDollarVolume24h
      &&(spreadBps==null||spreadBps<=50)
  })
  const liquidUniverse=liquidRows.map((row:any)=>String(row.productId||'').toUpperCase()).filter(Boolean)
  const fallbackUniverse:string[]=Array.isArray(scan.universe)
    ?scan.universe.map((x:any)=>String(x).toUpperCase())
    :[]
  const openBotProducts=getOpenBotExposureSummary().positions.map(row=>row.productId)
  const discovered=(rows.length?liquidUniverse:fallbackUniverse).slice(0,60)

  // Research is advisory prioritization only. Ollama sees recent public
  // headlines from multiple sources and may reorder valid Coinbase candidates,
  // but it cannot invent symbols or authorize execution.
  const research=await researchCryptoCandidates(discovered)
  const researchOrder=research.rankedProductIds.length
    ?research.rankedProductIds
    :discovered

  researchPriorityProducts.clear()
  researchPrioritySource=research.status==='ok'?'OLLAMA':'LIQUIDITY_FALLBACK'
  for(const productId of researchOrder.slice(0,config.activeCapitalResearchTopN)){
    researchPriorityProducts.add(productId)
  }

  publish('market_research_ranked',{
    status:research.status,
    marketSentiment:research.marketSentiment,
    sourceCount:research.sourceCount,
    sources:research.sources,
    itemCount:research.itemCount,
    model:research.model||null,
    reason:research.reason||null,
    topCandidates:researchOrder.slice(0,12),
    activeCapitalPriorityCount:researchPriorityProducts.size,
    activeCapitalPrioritySource:researchPrioritySource
  },'research')

  // Always keep current bot-managed holdings in the stream so exits are never
  // dropped just because a coin falls out of the current liquidity/news ranking.
  products=[...new Set<string>([...openBotProducts,...researchOrder,...discovered])].slice(0,60)

  for(let i=0;i<products.length;i+=4){
    const batch=products.slice(i,i+4)
    await Promise.all(batch.map(async productId=>{
      try{
        await seedProduct(productId)
      }catch(error){
        publish('mean_reversion_seed_failed',{
          productId,
          error:error instanceof Error?error.message:String(error)
        },'strategy')
      }
    }))
  }
}

const startSafetyTimer=()=>{
  if(safetyTimer)clearInterval(safetyTimer)
  safetyTimer=setInterval(()=>{
    void (async()=>{
      try{
        const snapshot=await getChallengeSnapshot()
        const equity=Number(snapshot.currentPortfolioUsd||0)
        if(!(equity>0))return
        const guard=await checkRollingEquityKillSwitch(equity)
        const nextSafePause=Boolean(guard.blocked)

        if(nextSafePause!==safePause){
          safePause=nextSafePause
          publish(safePause?'mean_reversion_rolling_kill_locked':'mean_reversion_rolling_kill_cleared',{
            guard,
            streamRemainsActive:true,
            allAutomatedTradingBlocked:safePause,
            protectiveSellsAllowed:false,
            manualResetRequired:safePause
          },'risk')
        }
      }catch(error){
        publish('rolling_equity_monitor_failed',{
          error:error instanceof Error?error.message:String(error)
        },'risk')
      }
    })()
  },10000)
}

export const startMeanReversionEngine=async()=>{
  if(running)return
  running=true
  safePause=false

  if(!coinbaseConfigured()){
    publish('mean_reversion_engine_disabled',{reason:'Coinbase is not configured'},'strategy')
    return
  }

  try{
    await seedUniverse()
    publish('mean_reversion_engine_ready',{
      products,
      candleInterval:'5m',
      bollingerPeriod:config.bbPeriod,
      bollingerStdDev:config.bbStdDev,
      rsiPeriod:config.rsiPeriod,
      rsiStrictlyBelow:config.entryRsiStrictlyBelow,
      macroTimeframeMinutes:config.macroTimeframeMinutes,
      macroBollingerPeriod:config.macroBollingerPeriod,
      stopLossPercent:config.fixedStopLossPercent,
      trailingActivationNetPercent:config.trailingActivationNetPercent,
      trailingDistancePercent:config.trailingDistancePercent,
      minimumVolumeRatio:config.entryMinimumVolumeRatio,
      concurrentPositionPolicy:'MULTIPLE_DIFFERENT_PRODUCTS_ALLOWED',
      buyStepUsd:config.buyStepUsd,
      maxSlippagePercent:config.maxSlippagePercent,
      rollingKillSwitchPercent:config.rollingKillSwitchPercent
    },'strategy')
    startSafetyTimer()
    connect()
  }catch(error){
    running=false
    publish('mean_reversion_engine_failed',{
      error:error instanceof Error?error.message:String(error)
    },'strategy')
  }
}

export const stopMeanReversionEngine=()=>{
  running=false
  if(reconnectTimer){
    clearTimeout(reconnectTimer)
    reconnectTimer=null
  }
  if(safetyTimer){
    clearInterval(safetyTimer)
    safetyTimer=null
  }
  try{ws?.close()}catch{}
  ws=null
}

export const getMeanReversionEngineStatus=()=>({
  running,
  halted:false,
  safePause,
  connected:ws?.readyState===WebSocket.OPEN,
  products,
  monitoredProducts:states.size,
  lockedExecutions:[...executionLocks]
})
