import test from 'node:test'
import assert from 'node:assert/strict'
import { assessDailyRealizedLoss,assessEmergencyExecutionGate,assessExposureLimits,calculateRealizedSellMetrics } from '../server/riskCore.js'

test('blocks a BUY that would exceed total bot exposure',()=>{
  const result=assessExposureLimits({
    side:'BUY',
    notionalUsd:10,
    currentAssetUsd:0,
    totalBotExposureUsd:20,
    openBotPositions:2,
    productAlreadyOpen:false,
    maxPositionUsd:15,
    maxTotalExposureUsd:25,
    maxOpenBotPositions:8
  })
  assert.equal(result.approved,false)
  assert.match(result.reasons.join(' '),/total bot exposure/i)
})

test('blocks a new BUY after max open positions is reached',()=>{
  const result=assessExposureLimits({
    side:'BUY',
    notionalUsd:5,
    currentAssetUsd:0,
    totalBotExposureUsd:20,
    openBotPositions:8,
    productAlreadyOpen:false,
    maxPositionUsd:10,
    maxTotalExposureUsd:100,
    maxOpenBotPositions:8
  })
  assert.equal(result.approved,false)
  assert.match(result.reasons.join(' '),/maximum number of open bot positions/i)
})

test('does not add another position count for an existing coin',()=>{
  const result=assessExposureLimits({
    side:'BUY',
    notionalUsd:2,
    currentAssetUsd:5,
    totalBotExposureUsd:20,
    openBotPositions:8,
    productAlreadyOpen:true,
    maxPositionUsd:10,
    maxTotalExposureUsd:100,
    maxOpenBotPositions:8
  })
  assert.equal(result.approved,true)
  assert.equal(result.projectedOpenBotPositions,8)
})

test('SELL is never blocked by entry exposure limits',()=>{
  const result=assessExposureLimits({
    side:'SELL',
    notionalUsd:10,
    currentAssetUsd:10,
    totalBotExposureUsd:80,
    openBotPositions:8,
    productAlreadyOpen:true,
    maxPositionUsd:5,
    maxTotalExposureUsd:25,
    maxOpenBotPositions:8
  })
  assert.equal(result.approved,true)
  assert.equal(result.projectedAssetExposureUsd,0)
})


test('calculates exact-lot SELL profit after sell fee',()=>{
  const result=calculateRealizedSellMetrics({
    avgEntryPrice:10.05,
    executedQty:1,
    actualFillPrice:10.30,
    sellCommission:0.05
  })
  assert.equal(Number(result.sellCostBasisUsd.toFixed(2)),10.05)
  assert.equal(Number(result.realizedNetProceedsUsd.toFixed(2)),10.25)
  assert.equal(Number((result.realizedNetProfitUsd??0).toFixed(2)),0.20)
  assert.equal(Number((result.realizedNetProfitPercent??0).toFixed(4)),Number(((0.20/10.05)*100).toFixed(4)))
})

test('partial SELL uses only the exact sold lot quantity for cost basis',()=>{
  const result=calculateRealizedSellMetrics({
    avgEntryPrice:20.10,
    executedQty:0.25,
    actualFillPrice:20.60,
    sellCommission:0.02
  })
  assert.equal(Number(result.sellCostBasisUsd.toFixed(3)),5.025)
  assert.equal(Number(result.realizedNetProceedsUsd.toFixed(2)),5.13)
  assert.equal(Number((result.realizedNetProfitUsd??0).toFixed(3)),0.105)
})

test('daily realized loss guard blocks at the configured threshold',()=>{
  const below=assessDailyRealizedLoss({
    startEquityUsd:1000,
    realizedLossUsd:19.99,
    maxDailyLossPercent:2
  })
  const atLimit=assessDailyRealizedLoss({
    startEquityUsd:1000,
    realizedLossUsd:20,
    maxDailyLossPercent:2
  })
  assert.equal(below.blocked,false)
  assert.equal(atLimit.blocked,true)
  assert.equal(Number(atLimit.botLossPercent.toFixed(2)),2)
})

test('emergency stop blocks live execution before any order path',()=>{
  const result=assessEmergencyExecutionGate({
    emergencyStop:true,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:true
  })
  assert.equal(result.approved,false)
  assert.match(result.reasons.join(' '),/emergency stop/i)
})

test('execution gate also rejects disabled live or auto trading',()=>{
  const result=assessEmergencyExecutionGate({
    emergencyStop:false,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:false
  })
  assert.equal(result.approved,false)
  assert.match(result.reasons.join(' '),/disabled/i)
})
