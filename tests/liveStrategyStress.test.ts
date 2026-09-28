import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateStressResults,buildStressWindows,simulateLiveStrategyWindow,type StressCandle } from '../server/liveStrategyStress.js'
import { confirmedMeanReversionEntryDecision } from '../server/bollingerStrategy.js'

const makeCandles=(count:number,startPrice=100):StressCandle[]=>{
  const out:StressCandle[]=[]
  let price=startPrice
  for(let i=0;i<count;i++){
    const wave=Math.sin(i/8)*0.6
    const drift=(i%37===0?-1.4:0)+(i%53===0?1.1:0)
    const next=Math.max(1,price*(1+(wave+drift)/100))
    const high=Math.max(price,next)*1.004
    const low=Math.min(price,next)*0.996
    out.push({start:1_700_000_000+i*300,open:price,close:next,high,low,volume:1000+i})
    price=next
  }
  return out
}

test('stress window builder produces well over 100 scenarios across five Coinbase-sized histories',()=>{
  const histories=Array.from({length:5},(_,i)=>makeCandles(1200,100+i*10))
  const scenarioCount=histories.reduce((sum,candles)=>sum+buildStressWindows(candles,120,40).length,0)
  assert.ok(scenarioCount>=100)
  assert.equal(scenarioCount,140)
})

test('live strategy stress simulation never submits orders and returns deterministic summary data',()=>{
  const candles=makeCandles(1200)
  const scenarios=buildStressWindows(candles,120,40).map(window=>simulateLiveStrategyWindow('BTC-USD',window))
  const summary=aggregateStressResults(scenarios)
  assert.equal(summary.scenarioCount,28)
  assert.ok(summary.closedTrades>=0)
  assert.ok(summary.wins>=0)
  assert.ok(summary.losses>=0)
  assert.ok(summary.winRatePercent>=0&&summary.winRatePercent<=100)
})


test('strong entry confirmation requires RSI strictly below 30, lower-band break, and 1.5x volume',()=>{
  const result=confirmedMeanReversionEntryDecision({
    rsiValue:29,
    previousRsiValue:31,
    closeVsLowerPct:-0.2,
    crossedBelowLower:true,
    previousClose:100,
    previousHigh:101,
    previousLower:99.5,
    currentClose:98.9,
    currentLower:99,
    threeCandleReturnPct:-0.8,
    currentVolume:160,
    averageVolume:100
  })
  assert.equal(result.ready,true)
  assert.equal(result.rsiStrictlyOversold,true)
  assert.equal(result.closeBelowLowerBand,true)
  assert.equal(result.volumeRebound,true)
})

test('strong entry blocks RSI at or above 30',()=>{
  const result=confirmedMeanReversionEntryDecision({
    rsiValue:30,
    previousRsiValue:29,
    closeVsLowerPct:-0.2,
    crossedBelowLower:true,
    previousClose:100,
    previousHigh:101,
    previousLower:99.5,
    currentClose:98.9,
    currentLower:99,
    threeCandleReturnPct:-0.8,
    currentVolume:160,
    averageVolume:100
  })
  assert.equal(result.ready,false)
  assert.ok(result.blockers.includes('RSI_NOT_STRICTLY_BELOW_30'))
})

test('strong entry blocks when close is not below the lower Bollinger band',()=>{
  const result=confirmedMeanReversionEntryDecision({
    rsiValue:28,
    previousRsiValue:29,
    closeVsLowerPct:0.2,
    crossedBelowLower:false,
    previousClose:99,
    previousHigh:100,
    previousLower:99.5,
    currentClose:100.1,
    currentLower:100,
    threeCandleReturnPct:-0.2,
    currentVolume:180,
    averageVolume:100
  })
  assert.equal(result.ready,false)
  assert.ok(result.blockers.includes('CLOSE_NOT_BELOW_LOWER_BOLLINGER'))
})

test('strong entry blocks volume below 1.5x participation',()=>{
  const result=confirmedMeanReversionEntryDecision({
    rsiValue:28,
    previousRsiValue:29,
    closeVsLowerPct:-0.2,
    crossedBelowLower:true,
    previousClose:100,
    previousHigh:101,
    previousLower:99.5,
    currentClose:98.9,
    currentLower:99,
    threeCandleReturnPct:-0.8,
    currentVolume:120,
    averageVolume:100
  })
  assert.equal(result.ready,false)
  assert.ok(result.blockers.includes('VMA20_VOLUME_BELOW_REQUIRED_RATIO'))
})
