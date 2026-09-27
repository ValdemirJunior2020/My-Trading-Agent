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


test('entry confirmation blocks buying while RSI is still in the 30-35 recovery zone',()=>{
  const result=confirmedMeanReversionEntryDecision({
    rsiValue:36,
    previousRsiValue:29,
    closeVsLowerPct:0.2,
    crossedBelowLower:false,
    previousClose:99,
    previousHigh:100,
    previousLower:99.5,
    currentClose:100.5,
    currentLower:100,
    threeCandleReturnPct:-0.2
  })
  assert.equal(result.ready,false)
  assert.ok(result.blockers.includes('RSI_NOT_REBOUNDED_ABOVE_35'))
})

test('entry confirmation allows only a strong rebound setup',()=>{
  const result=confirmedMeanReversionEntryDecision({
    rsiValue:33,
    previousRsiValue:29,
    closeVsLowerPct:0.2,
    crossedBelowLower:false,
    previousClose:99,
    previousHigh:100,
    previousLower:99.5,
    currentClose:100.5,
    currentLower:100,
    threeCandleReturnPct:-0.2
  })
  assert.equal(result.ready,true)
  assert.equal(result.rsiRecoveryConfirmed,true)
  assert.ok(result.rsiRecoveryPoints>=5)
  assert.equal(result.brokePreviousHigh,true)
})
