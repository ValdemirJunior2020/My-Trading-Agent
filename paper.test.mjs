import {test} from 'node:test';import assert from 'node:assert/strict';import {initial,apply,report} from './paper.mjs';
const a={type:'open',ticker:'TEST',asset:'stock-etf',entry:20,stop:19.5,target:21};const now=new Date('2026-11-24T15:00:00Z');
test('paper open, close, daily cap',()=>{const s=initial();apply(s,a,now);assert.throws(()=>apply(s,a,now));apply(s,{type:'close',price:19.5},now);apply(s,a,now);apply(s,{type:'close',price:19.5},now);assert.equal(report(s,now).trades,2);assert.throws(()=>apply(s,a,now));assert.ok(s.events.length===4)});
test('stop blocks opens, closes allowed',()=>{const s=initial();apply(s,a,now);apply(s,{type:'stop'},now);apply(s,{type:'close',price:21},now);assert.throws(()=>apply(s,a,now))});
