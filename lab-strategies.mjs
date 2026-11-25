// Experimental deterministic rules, using only verified completed bars.
export const strategies=Object.freeze(['breakout','momentum','pullback','reversal','volume','hybrid']);
export function signalFor(id,r){if(!r?.metrics||!r.bars?.length||['AVOID','INSUFFICIENT DATA','FALSE BREAKOUT'].includes(r.status))return null;const m=r.metrics,b=r.bars.at(-1),prev=r.bars.at(-2);if(!prev)return null;const up=m.ema9>m.ema21,green=b.close>b.open;const rules={
breakout:r.status==='BREAKOUT DETECTED',
momentum:up&&green&&b.close>prev.close&&m.rsi>=55&&m.rsi<=78&&m.relativeBarVolume>=1.2&&b.close>m.vwap,
pullback:up&&green&&b.low<=m.ema9&&b.close>m.ema9&&b.close>prev.close&&m.rsi>=45&&m.rsi<=70,
reversal:green&&prev.close<m.vwap&&b.close>m.vwap&&m.rsi>=40&&m.rsi<=65&&m.relativeBarVolume>=1.3,
volume:green&&b.close>prev.high&&m.relativeBarVolume>=2&&b.close>m.vwap,
};rules.hybrid=Object.values(rules).filter(Boolean).length>=2;if(!rules[id])return null;return {stop:id==='breakout'?m.resistance:Math.min(b.low,prev.low),reason:'Experimental '+id+' signal from completed bars'};}
