import {trailingProfit} from './profit-protection.mjs';
import {signalFor} from './lab-strategies.mjs';
import {positions,setPositions,invested,reservedRisk} from './portfolio.mjs';
import {fractionalSize} from './research-universe.mjs';
import {analyze} from './market.mjs';
import {guardReason,regimeFor,frictionFor} from './guard.mjs';
import {regularSession} from './robinhood-data.mjs';
export function clock(now){return new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now))}
export function fresh(q,now){return q&&[q.quoteTime,q.bidTime,q.askTime].every(t=>Number.isFinite(t)&&t<=now&&now-t<=90000)&&[q.bid,q.ask,q.price].every(v=>Number.isFinite(v)&&v>0)&&q.ask>=q.bid}
export function automaticStep(s,{now=Date.now(),quotes={},snapshots={},symbols=[],strategy='breakout'}={}){
 const a=s.automation,x=s.session;if(!a?.armed||!x||x.config.mode!=='automatic')return false;
 const c=x.config,session=regularSession(now),date=session.date,hh=clock(now),time=new Date(now).toISOString();let changed=false;
 const event=(type,details={})=>{s.events.push({time,type,...details});changed=true};
 const status=(v,reason)=>{if(a.status!==v||a.reason!==reason){a.status=v;a.reason=reason;event('auto-status',{status:v,reason})}};
 const list=positions(s);if(list.some(p=>p.source!=='AUTO PAPER')){status('BLOCKED','Existing manual position');return changed}
 if(list.length){
  if(!session.open){status('HOLD','Market closed; positions retained, exits await verified quotes');return changed}
  let allFresh=true;for(const p of list){const q=quotes[p.ticker];if(!fresh(q,now)){allFresh=false;continue}p.mark={price:q.bid*(1-p.friction),time:Math.min(q.quoteTime,q.bidTime,q.askTime)};changed=true}
  const equity=s.balance+list.reduce((n,p)=>n+(p.mark?.price-p.entry)*p.shares,0);if(allFresh&&Number.isFinite(equity))a.peak=Math.max(a.peak??s.balance,equity);
  const drawdown=allFresh&&Number.isFinite(equity)&&a.peak>0&&(a.peak-equity)/a.peak>=.05;
  const cutoff=['2026-11-27','2026-12-24'].includes(date)?'12:55':'15:55',atEnd=hh>=c.end||hh>=cutoff;
  const remaining=[];for(const p of list){const q=quotes[p.ticker];if(!fresh(q,now)){remaining.push(p);continue}const mark=p.mark.price,pnl=(mark-p.entry)*p.shares-(p.fees||0);
   const trail=c.trailingProfit===true&&trailingProfit(p,pnl,{activation:c.earlyProfit||1});
   const exit=a.exitRequested?'Manual stop request':mark<=p.stop?'Stop loss':drawdown?'Drawdown exit':mark>=p.target?'Profit target':trail?'Trailing profit exit':!c.trailingProfit&&c.earlyProfit>0&&pnl>=c.earlyProfit?'Early profit':atEnd&&c.closeAtEnd&&(!c.holdLosers||pnl>=0)?'Session end':null;
   if(!exit){remaining.push(p);continue}s.balance+=pnl;s.trades.push({...p,entryReason:p.reason,exit:mark,closed:time,closedDay:date,pnl,reason:exit});event('auto-paper-close',{ticker:p.ticker,pnl,reason:exit});if(pnl<0)a.cooldownUntil=now+1800000;
  }setPositions(s,remaining);if(drawdown){a.exitRequested=true}
  if(a.exitRequested){if(!remaining.length){a.armed=false;a.exitRequested=false;status('STOPPED','Exit request completed')}else status('EXIT WAIT','Awaiting remaining verified exit quotes');return true}
  if(!allFresh){status('EXIT WAIT','Missing fresh position quote; new entries blocked');return changed}
  if(remaining.length>=c.maxPositions){status('HOLD','Monitoring all virtual positions');return changed}
 }
 if(a.exitRequested){a.armed=false;a.exitRequested=false;status('STOPPED','Stopped');return true}
 if(!session.verified||!session.open||hh<c.start||hh>=c.end){status('WAITING','Outside verified trading hours');return changed}
 if(a.day!==date){a.day=date;a.startBalance=s.balance;a.peak=Math.max(s.balance,a.peak??s.balance);a.lastSignal={};event('auto-day',{date})}
 const closed=s.trades.filter(t=>t.closedDay===date),opened=[...s.trades,...positions(s)].filter(t=>t.openedDay===date),grossLoss=closed.reduce((n,t)=>n+Math.max(0,-t.pnl),0),net=closed.reduce((n,t)=>n+t.pnl,0);let consecutive=0;for(const t of [...closed].reverse()){if(t.pnl>=0)break;consecutive++}
 const block=guardReason({balance:s.balance,peak:a.peak,budget:a.startBalance,grossLoss,consecutive,cooldownUntil:a.cooldownUntil||0,time:now,maxLoss:c.maxLoss});
 if(block||opened.length>=c.maxTrades||(c.stopAtGoal&&c.objective>0&&net>=c.objective)){status('GUARDED',block||'Daily trade or objective limit');return changed}
 // Do not open in the last five minutes before configured or exchange close.
 const minutes=Number(hh.slice(0,2))*60+Number(hh.slice(3)),endMinutes=Math.min(Number(c.end.slice(0,2))*60+Number(c.end.slice(3)),['2026-11-27','2026-12-24'].includes(date)?780:960);
 if(minutes>=endMinutes-5){status('WAITING','Entry cutoff');return changed}
 const rejected={},candidates=[];const reject=k=>{rejected[k]=(rejected[k]||0)+1};for(const ticker of symbols){if(c.excluded.includes(ticker)||(c.allowed.length&&!c.allowed.includes(ticker))){reject('Excluded');continue}if(positions(s).some(p=>p.ticker===ticker)){reject('Already held');continue}const q=snapshots[ticker];if(!fresh(q,now)){reject('Missing or stale quote');continue}const r=analyze(q,now);const signal=signalFor(strategy,r);if(!signal){reject(r.status);continue}if(regimeFor(r.bars)==='HIGH VOLATILITY'){reject('High volatility');continue}if(r.metrics.spread>c.maxSpread/100){reject('Spread too wide');continue}const last=r.bars.at(-1);if(a.lastSignal?.[ticker]===last.time){reject('Already evaluated signal');continue}
 const friction=frictionFor(r.bars),entry=q.ask*(1+friction),stop=signal.stop*(1-friction),risk=entry-stop;if(!(risk>0)||entry<5){reject('Invalid entry or stop');continue}const target=entry+c.minRatio*risk;const remain=Math.min(c.maxLoss-grossLoss-reservedRisk(s),c.budget<=100?2.5:5,a.peak*.05-(a.peak-s.balance)-reservedRisk(s));const shares=fractionalSize({entry,risk,capital:Math.min(c.maxTrade,c.budget-invested(s),s.balance-invested(s)),remaining:remain});if(!shares){reject('Allocation or risk limit');continue}candidates.push({ticker,entry,stop,target,shares,friction,last,r,signal});}
 a.scan={time,checked:symbols.length,rejected,qualified:candidates.length};changed=true;
 candidates.sort((a,b)=>b.r.score-a.r.score||a.ticker.localeCompare(b.ticker));for(const {ticker,entry,stop,target,shares,friction,last,r,signal} of candidates){
 if(positions(s).length>=c.maxPositions||opened.length+positions(s).filter(p=>p.opened===time).length>=c.maxTrades)break;const capital=Math.min(c.maxTrade,c.budget-invested(s),s.balance-invested(s)),remaining=Math.min(c.maxLoss-grossLoss-reservedRisk(s),c.budget<=100?2.5:5,a.peak*.05-(a.peak-s.balance)-reservedRisk(s));const qty=fractionalSize({entry,risk:entry-stop,capital,remaining});if(!qty)continue;a.lastSignal??={};a.lastSignal[ticker]=last.time;setPositions(s,[...positions(s),{ticker,entry,stop,target,shares:qty,fees:0,friction,opened:time,openedDay:date,source:'AUTO PAPER',reason:signal.reason+'; modeled target',strategy,signalTime:last.time}]);event('auto-paper-open',{ticker,entry,stop,target,shares:qty,metrics:r.metrics});
 }
 status(positions(s).length?'HOLD':'SCANNING',positions(s).length?'Monitoring '+positions(s).length+' virtual positions':'No qualifying experimental setup');return changed
}
export function configureAutomation(s,c){if(s.position)throw Error('Close virtual position before changing settings');const prior=s.automation||{};s.automation={armed:c.mode==='automatic',status:c.mode==='automatic'?'WAITING':'STOPPED',reason:'Saved configuration',day:prior.day??null,startBalance:prior.startBalance, lastSignal:prior.lastSignal||{},peak:prior.peak??s.balance,cooldownUntil:prior.cooldownUntil||0,lastTrainingDay:prior.lastTrainingDay,autoTrain:c.autoTrain===true};s.stopped=true}
