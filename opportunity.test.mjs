import {test} from 'node:test';import assert from 'node:assert/strict';import {consolidation,evaluate,rank} from './opportunity.mjs';
const now=Date.now(),bars=Array.from({length:12},(_,i)=>({time:now-(12-i)*300000,open:20,close:20.01,high:20.04,low:19.99,volume:i<8?100:50}));const row={ticker:'PINS',status:'WATCHING',bars,metrics:{ema9:20,ema21:20,vwap:20,rsi:50,relativeBarVolume:.5,spread:.001,price:20,resistance:20.04}};
test('sideways and declining volume',()=>{assert.equal(consolidation(bars,20).sideways,true);assert.equal(evaluate(row,{quoteTime:now},{consolidationMinutes:20},null,now).status,'MOVE ON')});
test('stale data never becomes consolidation',()=>assert.equal(evaluate(row,{quoteTime:now-100000},{},null,now).status,'INSUFFICIENT DATA'));
test('false breakout is wait',()=>assert.equal(evaluate({...row,status:'FALSE BREAKOUT'},{quoteTime:now},{},null,now).status,'WAIT'));
test('ranking moves missing data below valid scores',()=>assert.deepEqual(rank([{ticker:'A',rankScore:null},{ticker:'B',rankScore:30},{ticker:'C',rankScore:60}]).map(x=>x.ticker),['C','B','A']));
test('breakout cannot buy without account and independent evidence',()=>assert.notEqual(evaluate({...row,status:'BREAKOUT DETECTED',bars:bars.map((b,i)=>({...b,volume:100+i*10}))},{quoteTime:now},{},null,now).status,'BUY CANDIDATE'));
