export const defaults={symbols:['SPY','QQQ','AAPL','AMD','NVDA','PINS'],seconds:60};
export function ema(xs,n){if(xs.length<n)return null;let v=xs.slice(0,n).reduce((a,b)=>a+b,0)/n;for(const x of xs.slice(n))v+=(x-v)*2/(n+1);return v}
export function rsi(xs,n=14){if(xs.length<=n)return null;let g=0,l=0;for(let i=1;i<=n;i++){let d=xs[i]-xs[i-1];g+=Math.max(d,0)/n;l+=Math.max(-d,0)/n}for(let i=n+1;i<xs.length;i++){let d=xs[i]-xs[i-1];g=(g*(n-1)+Math.max(d,0))/n;l=(l*(n-1)+Math.max(-d,0))/n}return l===0?(g===0?50:100):100-100/(1+g/l)}
export function analyze(s,now=Date.now()){
 const fail=reason=>({status:'INSUFFICIENT DATA',reason});
 if(!s||s.source!=='robinhood'||s.delayed!==false||s.sessionVerified!==true)return fail('Unverified source, latency or exchange session');
 if(!Number.isFinite(s.quoteTime)||now-s.quoteTime>90000||s.quoteTime>now||![s.bid,s.ask,s.price].every(x=>Number.isFinite(x)&&x>0)||s.ask<s.bid)return fail('Invalid or stale quote');
 if(!Array.isArray(s.bars)||s.bars.length<22)return fail('Need 22 completed five-minute bars');
 const b=s.bars.filter(x=>x.time+300000<=now).sort((a,b)=>a.time-b.time);
 if(b.length<22||now-(b.at(-1).time+300000)>390000)return fail('Missing recent completed candles');
 if(b.some((x,i)=>![x.time,x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite)||x.low<=0||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close)||x.volume<0||(i&&x.time-b[i-1].time!==300000)))return fail('Invalid or noncontinuous candles');
 const c=b.map(x=>x.close),last=b.at(-1),prior=b.slice(-21,-1),vol=prior.reduce((a,x)=>a+x.volume,0)/prior.length;
 const total=b.reduce((a,x)=>a+x.volume,0);if(!total||!vol)return fail('Missing volume');
 const m={ema9:ema(c,9),ema21:ema(c,21),rsi:rsi(c),vwap:b.reduce((a,x)=>a+(x.high+x.low+x.close)/3*x.volume,0)/total,relativeBarVolume:last.volume/vol,support:Math.min(...prior.map(x=>x.low)),resistance:Math.max(...prior.map(x=>x.high)),spread:(s.ask-s.bid)/((s.ask+s.bid)/2),price:s.price};
 // Research classifications only; no trade proposals until additional evidence is verified.
 let status='WATCHING',reason='Review completed candle trend';
 if(m.spread>.005||s.price<5){status='AVOID';reason='Wide spread or low price'}
 else if(last.high>m.resistance&&last.close<m.resistance){status='FALSE BREAKOUT';reason='Candle failed to hold prior resistance'}
 else if(last.close>m.resistance&&m.relativeBarVolume>=1.5&&m.ema9>m.ema21){status='BREAKOUT DETECTED';reason='Close above prior resistance with elevated bar volume; confirmation required'}
 else if(m.ema9<m.ema21||last.close<m.vwap){status='WAIT';reason='Weakening trend or below supplied-bar VWAP'}
 return {status,reason,metrics:m,time:new Date(s.quoteTime).toISOString(),bars:b.slice(-60),score:(m.ema9/m.ema21-1)*100+m.relativeBarVolume-m.spread*100};
}
export async function explain(snapshot,signal){const r=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3:8b',stream:false,think:false,prompt:'Summarize the supplied research metrics for a beginner in two sentences. Do not add facts, prices, news, predictions or orders. Status is fixed by backend. '+JSON.stringify(snapshot),options:{num_predict:150,temperature:0}}),signal});if(!r.ok)throw Error('Ollama unavailable');const j=await r.json();if(typeof j.response!=='string'||!j.response.trim())throw Error('Empty Ollama response');return j.response.slice(0,800)}
