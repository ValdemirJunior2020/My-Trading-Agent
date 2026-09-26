import test from 'node:test'
import assert from 'node:assert/strict'
import { assessExposureLimits } from '../server/riskCore.js'

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
