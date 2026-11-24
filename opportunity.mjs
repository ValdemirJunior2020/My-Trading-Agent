import {calculate} from './risk.mjs';
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
export function consolidation(bars,minutes=20){const n=Math.ceil(minutes/5),recent=bars.slice(-n),prior=bars.slice(-2*n,-n);if(recent.length<n||prior.length<n)return null;const mean=a=>a.reduce((s,b)=>s+b.volume,0)/a.length;const high=Math.max(...recent.map(b=>b.high)),low=Math.min(...recent.map(b=>b.low)),first=recent[0].open,last=recent.at(-1).close;const range=(high-low)/first,drift=Math.abs(last-first)/first,volumeRatio=mean(prior)>0?mean(recent)/mean(prior):null;return {minutes:n*5,range,drift,volumeRatio,sideways:range<=.006&&drift<=.0025&&volumeRatio!==null&&volumeRatio<=.85}}
export function evaluate(row,raw,config={},account=null,now=Date.now()){
 if(row.status==='INSUFFICIENT DATA'||!row.metrics||!row.bars?.length||!Number.isFinite(raw?.quoteTime)||now-raw.quoteTime>90000||raw.quoteTime>now)return {...row,status:'INSUFFICIENT DATA',rankScore:null};
 const m=row.metrics,b=row.bars,last=b.at(-1),c=consolidation(b,config.consolidationMinutes??20);
 const momentum=clamp(50+1000*(m.ema9/m.ema21-1)+20*(last.close/m.vwap-1)*100+10*(m.relativeBarVolume-1));
 const risk=clamp(10000*m.spread+Math.max(0,m.rsi-70)*2+(c?.sideways?15:0));
 const pct=Number.isFinite(raw.previousClose)&&raw.previousClose>0?(m.price/raw.previousClose-1)*100:null;
 const next=m.resistance;let status='WAIT',reason=row.reason,plan=null;
 if(row.status==='AVOID'){status='AVOID'}
 else if(account?.position?.ticker===row.ticker){status='HOLD';reason='Existing simulated position; review its exit rules. No additional entry.'}
 else if(row.status==='FALSE BREAKOUT'){reason='Price crossed resistance but closed below it; buying strength was not maintained.'}
 else if(c?.sideways){status='MOVE ON';reason='Narrow price movement and declining volume for '+c.minutes+' minutes; keep checking in background.'}
 else if(row.status==='BREAKOUT DETECTED'){reason='Breakout evidence exists, but a verified target, market context and risk check are required.';
 // Candidate requires independent upstream evidence; never infer missing values.
 const entry=raw.ask,stop=m.resistance,target=raw.verifiedTarget;
 const validAccount=account&&account.stopped===false&&!account.position&&Number.isFinite(account.balance)&&Number.isInteger(account.tradesToday)&&account.tradesToday<2&&Number.isFinite(account.remainingLoss)&&account.remainingLoss>0;
 if(validAccount&&raw.assetVerified===true&&raw.marketTrendVerified==='up'&&Number.isFinite(target)&&target>entry&&entry>stop&&m.spread<=.002&&m.rsi<=75&&m.price>=5){const sizing=calculate({entry,stop,target,capital:account.balance,remainingLoss:account.remainingLoss,fees:0});if(sizing.ok){status='BUY CANDIDATE';reason='Completed breakout, volume, trend, spread and planned risk checks passed.';plan={entry,stop,target,...sizing}}else{reason='Breakout rejected by position or reward/risk limit: '+sizing.reason}}
 }
 const rankScore=clamp(momentum-risk*.5+(status==='BUY CANDIDATE'?15:0)-(status==='MOVE ON'?40:0)-(status==='AVOID'?80:0));
 return {...row,status,pattern:row.status,reason,consolidation:c,momentumScore:momentum,riskScore:risk,rankScore,dailyChange:pct,nextEvaluation:next,plan,invalidation:status==='BUY CANDIDATE'?'Price falls below breakout level or data/risk checks fail.':'Fresh candle fails confirmation or data becomes stale.'};
}
export function rank(rows){return [...rows].sort((a,b)=>(b.rankScore??-1)-(a.rankScore??-1)||a.ticker.localeCompare(b.ticker))}
