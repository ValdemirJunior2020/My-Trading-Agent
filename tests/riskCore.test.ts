import test from 'node:test'
import assert from 'node:assert/strict'
import { assessCapitalPreservationBuy,assessDailyRealizedLoss,assessEmergencyExecutionGate,assessExposureLimits,assessProfitFirstEntryEconomics,assessSellMinimum,calculateRealizedSellMetrics,shouldClearLegacyLossHaltEmergency } from '../server/riskCore.js'

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


test('manual approval blocks automatic live execution',()=>{
  const result=assessEmergencyExecutionGate({
    emergencyStop:false,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:true,
    manualApprovalRequired:true
  })
  assert.equal(result.approved,false)
  assert.match(result.reasons.join(' '),/manual approval/i)
})


test('protective SELL can be below the bot BUY dollar minimum when Coinbase base size is valid',()=>{
  const result=assessSellMinimum({
    baseSize:6.379658,
    baseMin:0.000001,
    baseMax:1000000
  })
  assert.equal(result.approved,true)
})

test('SELL still blocks when Coinbase base minimum is not met',()=>{
  const result=assessSellMinimum({
    baseSize:0.05,
    baseMin:0.1,
    baseMax:1000000
  })
  assert.equal(result.approved,false)
})


test('profit-first entry allows economics similar to the successful net-profit setup',()=>{
  const result=assessProfitFirstEntryEconomics({
    buyNotionalUsd:10,
    buyCommissionUsd:0.09,
    takeProfitPercent:1.5,
    maxSlippagePercent:0.1,
    maxRequiredGrossProfitPercent:4
  })
  assert.equal(result.approved,true)
  assert.equal(Number(result.requiredGrossProfitPercent.toFixed(2)),3.4)
})

test('profit-first entry rejects excessive fee economics',()=>{
  const result=assessProfitFirstEntryEconomics({
    buyNotionalUsd:10,
    buyCommissionUsd:0.15,
    takeProfitPercent:1.5,
    maxSlippagePercent:0.1,
    maxRequiredGrossProfitPercent:4
  })
  assert.equal(result.approved,false)
  assert.ok(result.requiredGrossProfitPercent>4)
})


test('capital preservation blocks another BUY after any realized loss',()=>{
  const result=assessCapitalPreservationBuy({
    enabled:true,
    realizedPnlTodayUsd:-0.01,
    realizedLossTodayUsd:0.01,
    openBotPositions:0
  })
  assert.equal(result.approved,false)
  assert.match(result.reasons.join(' '),/realized bot loss/i)
})

test('capital preservation allows BUY only with no loss and no open bot position',()=>{
  const clear=assessCapitalPreservationBuy({
    enabled:true,
    realizedPnlTodayUsd:0,
    realizedLossTodayUsd:0,
    openBotPositions:0
  })
  const openPosition=assessCapitalPreservationBuy({
    enabled:true,
    realizedPnlTodayUsd:0,
    realizedLossTodayUsd:0,
    openBotPositions:1
  })
  assert.equal(clear.approved,true)
  assert.equal(openPosition.approved,false)
})


test('loss halt allows SELL exits while still blocking BUY execution',()=>{
  const sell=assessEmergencyExecutionGate({
    emergencyStop:true,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:true,
    lossHaltActive:true,
    protectiveExit:true,
    emergencyStopReason:'LOSS_HALT'
  })
  const buy=assessEmergencyExecutionGate({
    emergencyStop:true,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:true,
    lossHaltActive:true,
    protectiveExit:false,
    emergencyStopReason:'LOSS_HALT'
  })
  assert.equal(sell.approved,true)
  assert.equal(sell.lossHaltExitAllowed,true)
  assert.equal(buy.approved,false)
})

test('manual emergency stop still blocks SELL exits',()=>{
  const result=assessEmergencyExecutionGate({
    emergencyStop:true,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:true,
    lossHaltActive:true,
    protectiveExit:true,
    emergencyStopReason:'MANUAL'
  })
  assert.equal(result.approved,false)
})


test('loss halt model keeps SELL gate open when global emergency is off',()=>{
  const result=assessEmergencyExecutionGate({
    emergencyStop:false,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:true,
    lossHaltActive:true,
    protectiveExit:true,
    emergencyStopReason:''
  })
  assert.equal(result.approved,true)
})


test('loss halt exit bypass ignores stale non-manual stop reason',()=>{
  const result=assessEmergencyExecutionGate({
    emergencyStop:true,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:true,
    lossHaltActive:true,
    protectiveExit:true,
    emergencyStopReason:'LOSS_HALT'
  })
  assert.equal(result.approved,true)
})

test('manual emergency reason still blocks sell exits even during loss halt',()=>{
  const result=assessEmergencyExecutionGate({
    emergencyStop:true,
    tradingMode:'live',
    liveTradingEnabled:true,
    autoTradingEnabled:true,
    lossHaltActive:true,
    protectiveExit:true,
    emergencyStopReason:'MANUAL'
  })
  assert.equal(result.approved,false)
})


test('stale MANUAL reason older than loss halt is cleared',()=>{
  assert.equal(shouldClearLegacyLossHaltEmergency({
    emergencyStop:true,
    lossHaltActive:true,
    emergencyStopReason:'MANUAL',
    lossHaltTriggeredAt:'2026-09-27T00:20:00.000Z',
    latestManualEmergencyAt:'2026-09-27T00:10:00.000Z'
  }),true)
})

test('newer real MANUAL emergency stop is preserved',()=>{
  assert.equal(shouldClearLegacyLossHaltEmergency({
    emergencyStop:true,
    lossHaltActive:true,
    emergencyStopReason:'MANUAL',
    lossHaltTriggeredAt:'2026-09-27T00:20:00.000Z',
    latestManualEmergencyAt:'2026-09-27T00:25:00.000Z'
  }),false)
})
