import { config, coinbaseConfigured } from './config.js'
import { getCandles, getProduct, listAccounts } from './coinbase.js'
import { publish } from './events.js'
import { scanCryptoMarket } from './scanner.js'
import { tryLimitedLiveExecution, checkRollingEquityKillSwitch, getRuntimeRiskLimits } from './risk.js'
import { getChallengeSnapshot } from './challenge.js'
import { getBotManagedPosition, smallAccountEntryDecision } from './bollingerStrategy.js'
import { getPipelineStatus, runFullAgentPipeline } from './pipeline.js'

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

const refreshPosition=(productId:string,state:ProductState,force=false)=>{
  if(!force&&Date.now()-state.lastPositionRefreshAt<5000)return state.position
  state.position=getBotManagedPosition(productId)
  state.lastPositionRefreshAt=Date.now()
  return state.position
}

const smallAccountBuyIsExecutable=async(productId:string)=>{
  if(!config.smallAccountMode)return {ok:true}
  try{
    const [product,accounts,snapshot]=await Promise.all([
      getProduct(productId),
      listAccounts(),
      getChallengeSnapshot()
    ])
    const limits=getRuntimeRiskLimits()
    const totalPortfolioUsd=Number(snapshot.currentPortfolioUsd||0)
    const usdAccount=(accounts as any[]).find((a:any)=>String(a.currency||'').toUpperCase()==='USD')
    const availableUsd=Number(usdAccount?.availableBalance?.value??usdAccount?.availableBalance??0)||0
    const quoteMin=Math.max(config.minLiveOrderUsd,Number((product as any)?.quote_min_size||0))
    const quoteIncrement=Number((product as any)?.quote_increment||0.01)
    const minExecutableQuoteUsd=quoteIncrement>0
      ? Math.ceil((quoteMin-Number.EPSILON)/quoteIncrement)*quoteIncrement
      : quoteMin
    const normalRiskSizedBuyUsd=
      totalPortfolioUsd>0?totalPortfolioUsd*(limits.maxPositionPercent/100):0
    const smallAccountOverrideUsd=
      totalPortfolioUsd>0?Math.min(config.smallAccountMaxBuyUsd,totalPortfolioUsd*0.10):0
    const safeMaxBuyUsd=Math.min(
      availableUsd,
      config.maxLiveOrderUsd,
      Math.max(normalRiskSizedBuyUsd,smallAccountOverrideUsd)
    )
    return {
      ok:safeMaxBuyUsd+1e-8>=minExecutableQuoteUsd,
      quoteMin,
      minExecutableQuoteUsd,
      safeMaxBuyUsd,
      availableUsd,
      totalPortfolioUsd
    }
  }catch(error){
    return {ok:false,error:error instanceof Error?error.message:String(error)}
  }
}

const runAgentsForSignal=(productId:string)=>{
  const status=getPipelineStatus()
  if(status.status==='running')return
  void runFullAgentPipeline({productId,deepResearch:false}).catch(error=>{
    publish('signal_agent_pipeline_failed',{
      productId,
      error:error instanceof Error?error.message:String(error)
    },'manager')
  })
}

const handleClosedCandle=async(productId:string,candle:Candle)=>{
  const state=states.get(productId)
  if(!state)return

  appendClosed(state,candle)
  const closes=state.closed.map(x=>x.close)
  if(closes.length<Math.max(config.bbPeriod+1,config.rsiPeriod+1))return

  const currentLower=lowerBand(closes)
  const previousCloses=closes.slice(0,-1)
  const previousLower=lowerBand(previousCloses)
  const currentRsi=rsi(closes)
  const previousClose=previousCloses.at(-1)

  if(currentLower==null||previousLower==null||currentRsi==null||previousClose==null)return

  const crossedBelow=
    previousClose>=previousLower &&
    candle.close<currentLower
  const closeVsLowerPct=currentLower>0
    ? ((candle.close-currentLower)/currentLower)*100
    : Infinity
  const entryDecision=smallAccountEntryDecision({
    rsiValue:currentRsi,
    closeVsLowerPct,
    crossedBelowLower:crossedBelow
  })
  const oversold=entryDecision.oversold
  const position=refreshPosition(productId,state,true)

  publish('mean_reversion_candle_closed',{
    productId,
    candleStart:candle.start,
    candleClose:candle.close,
    bollingerLower:currentLower,
    bollingerMiddle:avg(closes.slice(-config.bbPeriod)),
    closeVsLowerPct,
    proximityThresholdPercent:entryDecision.proximityThresholdPercent,
    mode:entryDecision.mode,
    rsi:currentRsi,
    crossedBelowLowerBand:crossedBelow,
    nearLowerBand:entryDecision.nearLowerBand,
    rsiOversold:oversold,
    positionOpen:position.qty>0
  },'strategy')

  if(position.qty>0||!entryDecision.ready)return

  const executable=await smallAccountBuyIsExecutable(productId)
  if(!executable.ok){
    publish('mean_reversion_buy_skipped',{
      productId,
      reason:'SMALL_ACCOUNT_MINIMUM_DOES_NOT_FIT',
      ...executable
    },'strategy')
    return
  }

  publish('mean_reversion_buy_signal',{
    productId,
    triggerPrice:candle.close,
    candleStart:candle.start,
    lowerBand:currentLower,
    rsi:currentRsi,
    rules:{
      candleClosed:true,
      mode:entryDecision.mode,
      closeBelowLowerBand:crossedBelow,
      nearLowerBand:entryDecision.nearLowerBand,
      proximityThresholdPercent:entryDecision.proximityThresholdPercent,
      rsiThreshold:config.rsiOversold
    }
  },'strategy')

  runAgentsForSignal(productId)

  const lock='BUY:'+productId
  if(executionLocks.has(lock))return
  executionLocks.add(lock)
  try{
    const result=await tryLimitedLiveExecution({
      productId,
      decision:'BUY_CANDIDATE',
      confidence:1,
      triggerPrice:candle.close
    })
    publish('mean_reversion_entry_result',{productId,result},'execution')
    if(result?.executed){
      state.position={
        qty:Number(result.executedQty||0),
        avgEntryPrice:Number(result.actualFillPrice||0)
      }
      state.lastPositionRefreshAt=Date.now()
      publish('mean_reversion_position_opened',{
        productId,
        orderId:result.orderId,
        entryPrice:state.position.avgEntryPrice,
        quantity:state.position.qty,
        hardStopPrice:state.position.avgEntryPrice*(1-config.fixedStopLossPercent/100),
        stopLossPercent:config.fixedStopLossPercent
      },'execution')
    }
  }finally{
    executionLocks.delete(lock)
  }
}

const handleTicker=async(productId:string,price:number)=>{
  if(!(price>0))return
  const state=states.get(productId)
  if(!state)return

  const position=refreshPosition(productId,state)
  if(!(position.qty>0)||!(position.avgEntryPrice>0))return

  const closes=state.closed.map(x=>x.close)
  const middle=middleBandWithLivePrice(closes,price)
  if(middle==null)return

  const stopPrice=position.avgEntryPrice*(1-config.fixedStopLossPercent/100)
  const fixedTakeProfitPrice=position.avgEntryPrice*(1+config.takeProfitPercent/100)
  const takeProfit=config.smallAccountMode
    ? price>=fixedTakeProfitPrice
    : price>=middle
  const stopLoss=price<=stopPrice
  if(!takeProfit&&!stopLoss)return

  const reason=stopLoss
    ? 'STOP_LOSS'
    : config.smallAccountMode
      ? 'SMALL_ACCOUNT_FIXED_TAKE_PROFIT'
      : 'MIDDLE_BAND_TAKE_PROFIT'
  const lock='SELL:'+productId
  if(executionLocks.has(lock))return
  executionLocks.add(lock)

  publish('mean_reversion_exit_signal',{
    productId,
    reason,
    livePrice:price,
    entryPrice:position.avgEntryPrice,
    quantity:position.qty,
    middleBand:middle,
    fixedTakeProfitPrice,
    takeProfitPercent:config.takeProfitPercent,
    stopPrice,
    stopLossPercent:config.fixedStopLossPercent
  },'strategy')

  runAgentsForSignal(productId)

  try{
    const result=await tryLimitedLiveExecution({
      productId,
      decision:'SELL_CANDIDATE',
      confidence:1,
      triggerPrice:price,
      baseSizeOverride:position.qty,
      exitReason:reason,
      avgEntryPrice:position.avgEntryPrice
    })
    publish('mean_reversion_exit_result',{productId,reason,result},'execution')
    if(result?.executed){
      state.position={qty:0,avgEntryPrice:0}
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
      for(const candle of list){
        if(!state.current){
          state.current=candle
          continue
        }
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

  states.set(productId,{
    closed,
    current:null,
    position:getBotManagedPosition(productId),
    lastPositionRefreshAt:Date.now()
  })
}

const seedUniverse=async()=>{
  const scan=await scanCryptoMarket()
  const universe:string[] = Array.isArray(scan.universe) ? scan.universe.map((x:any)=>String(x).toUpperCase()) : []
  products=[...new Set<string>(universe)].slice(0,28)

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
          publish(safePause?'mean_reversion_auto_safe_pause':'mean_reversion_auto_safe_resumed',{
            guard,
            streamRemainsActive:true,
            newBuysBlocked:safePause,
            protectiveSellsAllowed:true
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
      rsiOversold:config.rsiOversold,
      smallAccountMode:config.smallAccountMode,
      smallAccountStrongRsi:config.smallAccountStrongRsi,
      smallAccountStrongProximityPercent:config.smallAccountStrongProximityPercent,
      smallAccountNormalProximityPercent:config.smallAccountNormalProximityPercent,
      stopLossPercent:config.fixedStopLossPercent,
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
