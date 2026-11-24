import {test} from 'node:test';import assert from 'node:assert/strict';import {calculate} from './risk.mjs';
test('position and risk caps',()=>{const r=calculate({entry:20,stop:19.5,target:21,capital:1000});assert.equal(r.shares,5);assert.equal(r.loss,2.5);assert.equal(r.cost,100);assert.equal(r.ok,true)});
test('loss exhausted',()=>assert.equal(calculate({entry:20,stop:19,target:23,remainingLoss:0}).ok,false));
test('invalid and penny stock',()=>{assert.equal(calculate({entry:4,stop:3,target:8}).ok,false);assert.equal(calculate({entry:20,stop:21,target:25}).ok,false)});
test('reward and fees',()=>assert.equal(calculate({entry:20,stop:19.5,target:21,fees:0.25}).ok,false));
