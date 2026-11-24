import {test} from 'node:test';import assert from 'node:assert/strict';import {chartData} from './chart.mjs';
test('never fabricate chart on missing data',()=>{assert.equal(chartData({status:'INSUFFICIENT DATA',bars:[]}),null);assert.equal(chartData({status:'WAIT'}),null)});
test('chart scales valid candles and levels',()=>{const d=chartData({status:'WAIT',bars:[{time:100,open:20,high:21,low:19,close:20.5,volume:100}],metrics:{support:18,resistance:22}});assert.equal(d.bars.length,1);assert.ok(d.min<18&&d.max>22);assert.equal(d.volumeMax,100)});
test('reject malformed candle',()=>assert.equal(chartData({status:'WAIT',bars:[{time:100,open:20,high:19,low:18,close:20,volume:100}]}),null));
