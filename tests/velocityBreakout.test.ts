import test from 'node:test'
import assert from 'node:assert/strict'
import { NEXT_WEEK_BREAKOUT,breakoutHardStopPrice,breakoutTrailingActivationPrice,breakoutTrailingStopPrice } from '../server/velocityBreakout.js'
import { config } from '../server/config.js'

test('temporary breakout window is limited to the requested week',()=>{
  assert.equal(NEXT_WEEK_BREAKOUT.startDate,'2026-09-28')
  assert.equal(NEXT_WEEK_BREAKOUT.endDate,'2026-10-04')
})

test('breakout hard stop uses a 2 percent gross boundary',()=>{
  assert.equal(Number(breakoutHardStopPrice(100).toFixed(4)),98)
})

test('trailing activation represents about 4 percent net after the modeled exit fee',()=>{
  const costPerUnit=100
  const activation=breakoutTrailingActivationPrice(costPerUnit)
  const netExit=activation*(1-config.backtestMarketFeeRate)
  const netReturn=((netExit-costPerUnit)/costPerUnit)*100
  assert.ok(Math.abs(netReturn-4)<0.0001)
})

test('2.5 percent trail follows the observed peak',()=>{
  assert.equal(Number(breakoutTrailingStopPrice(120).toFixed(4)),117)
})

test('requested 200 dollar allocation remains only a strategy request',()=>{
  assert.equal(NEXT_WEEK_BREAKOUT.requestedAllocationUsd,200)
})
