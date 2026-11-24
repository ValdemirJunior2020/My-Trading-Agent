import {ema} from './market.mjs';
// Experimental historical-only strategy; no brokerage order interface.
export function replay(bars,{budget=100,maxTrade=50,maxLoss=2,maxTrades=2}={}){
 if(!Array.isArray(bars)||bars.length<23)throw Error('Need at least 23 completed candles');
 if(bars.some((b,i)=>![b.time,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0||(i>0&&b.time-bars[i-1].time!==300000)))throw Error('Invalid or missing candles');
 if(![budget,maxTrade,maxLoss].every(x=>Number.isFinite(x)&&x>0)||maxTrade>budget||!Number.isInteger(maxTrades)||maxTrades<1||maxTrades>10)throw Error('Invalid replay limits');
 let balance=budget,position=null,pending=null;const trades=[],signals=[];const friction=.001;
 function exit(b,price,reason){const p=position,fill=price*(1-friction),pnl=(fill-p.entry)*p.qty;balance+=pnl;trades.push({...p,exit:fill,exitTime:b.time,pnl,reason});position=null}
 for(let i=0;i<bars.length;i++){const b=bars[i],last=i===bars.length-1;
 if(pending){const entry=b.open*(1+friction),risk=entry-pending.stop*(1-friction),remaining=maxLoss+(balance-budget);const qty=risk>0?Math.floor(Math.min(maxTrade/entry,balance/entry,remaining/risk)):0;if(qty>0&&entry>pending.stop&&entry<pending.target&&!last){position={entry,qty,stop:pending.stop,target:pending.target,entryTime:b.time,signalTime:pending.time}}pending=null}
 if(position){if(b.open<=position.stop)exit(b,b.open,'Gap below stop');else if(b.low<=position.stop)exit(b,position.stop,'Stop (stop first if both touched)');else if(b.high>=position.target)exit(b,position.target,'Target');else if(last)exit(b,b.close,'End of historical window')}
 if(i<21||last||position||trades.length>=maxTrades||balance<=budget-maxLoss)continue;
 const prior=bars.slice(i-20,i),res=Math.max(...prior.map(x=>x.high)),avg=prior.reduce((s,x)=>s+x.volume,0)/20,closes=bars.slice(0,i+1).map(x=>x.close);
 if(avg>0&&b.close>res&&b.volume>=avg*1.5&&ema(closes,9)>ema(closes,21)){const stop=res,target=b.close+2*(b.close-stop);pending={stop,target,time:b.time+300000};signals.push({time:pending.time,close:b.close,stop,target})}
 }
 return {starting:budget,ending:balance,pnl:balance-budget,trades,signals,barCount:bars.length,assumptions:'Whole shares; 0.1% modeled friction per side; signal at close, next bar entry; stop first on ambiguous bars; no historical bid/ask; gap losses can exceed planned loss.'}
}
