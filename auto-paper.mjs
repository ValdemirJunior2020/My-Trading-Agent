import {fractionalSize} from './research-universe.mjs';
import {analyze} from './market.mjs';
import {guardReason,regimeFor,frictionFor} from './guard.mjs';
import {regularSession} from './robinhood-data.mjs';
export function clock(now){return new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now))}
export function fresh(q,now){return q&&[q.quoteTime,q.bidTime,q.askTime].every(t=>Number.isFinite(t)&&t<=now&&now-t<=90000)&&[q.bid,q.ask,q.price].every(v=>Number.isFinite(v)&&v>0)&&q.ask>=q.bid}
export function automaticStep(s,{now=Date.now(),quotes={},snapshots={},symbols=[]}={}){
 const a=s.automation,x=s.session;if(!a?.armed||!x||x.config.mode!=='automatic')return false;
 const c=x.config,session=regularSession(now),date=session.date,hh=clock(now),time=new Date(now).toISOString();let changed=false;
 const event=(type,details={})=>{s.events.push({time,type,...details});changed=true};
 const status=(v,reason)=>{if(a.status!==v||a.reason!==reason){a.status=v;a.reason=reason;event('auto-status',{status:v,reason})}};
 if(s.position?.source==='AUTO PAPER'){
 const p=s.position,q=quotes[p.ticker];if(!fresh(q,now)){status('EXIT WAIT','No fresh exit quote; virtual position remains open');return changed}
 const mark=q.bid*(1-p.friction),equity=s.balance+(mark-p.entry)*p.shares,peak=Math.max(a.peak??s.balance,equity);if(peak!==a.peak){a.peak=peak;changed=true}
 const cutoff=['2026-11-27','2026-12-24'].includes(date)?'12:55':'15:55';const end=hh>=c.end||hh>=cutoff||!session.open||date!==p.openedDay;
 const exit=mark<=p.stop?'Stop loss':mark>=p.target?'Profit target':(peak-equity)/peak>=.05?'Drawdown exit':end&&c.closeAtEnd?'Session end':a.exitRequested?'Manual stop request':null;
 if(exit){const pnl=(mark-p.entry)*p.shares;s.balance+=pnl;s.trades.push({...p,exit:mark,closed:time,closedDay:date,pnl,reason:exit});s.position=null;event('auto-paper-close',{ticker:p.ticker,pnl,reason:exit});if(pnl<0)a.cooldownUntil=now+1800000;if(a.exitRequested){a.armed=false;a.exitRequested=false;status('STOPPED','Exit request completed')}return true}
 status('HOLD','Monitoring virtual position');return changed
 }
 if(s.position){status('BLOCKED','Existing manual position');return changed}
 if(a.exitRequested){a.armed=false;a.exitRequested=false;status('STOPPED','Stopped');return true}
 if(!session.verified||!session.open||hh<c.start||hh>=c.end){status('WAITING','Outside verified trading hours');return changed}
 if(a.day!==date){a.day=date;a.startBalance=s.balance;a.peak=s.balance;a.cooldownUntil=0;a.lastSignal={};event('auto-day',{date})}
 const closed=s.trades.filter(t=>t.closedDay===date),opened=s.trades.filter(t=>t.openedDay===date),grossLoss=closed.reduce((n,t)=>n+Math.max(0,-t.pnl),0),net=closed.reduce((n,t)=>n+t.pnl,0);let consecutive=0;for(const t of [...closed].reverse()){if(t.pnl>=0)break;consecutive++}
 const block=guardReason({balance:s.balance,peak:a.peak,budget:a.startBalance,grossLoss,consecutive,cooldownUntil:a.cooldownUntil||0,time:now,maxLoss:c.maxLoss});
 if(block||opened.length>=c.maxTrades||(c.stopAtGoal&&c.objective>0&&net>=c.objective)){status('GUARDED',block||'Daily trade or objective limit');return changed}
 // Do not open in the last five minutes before configured or exchange close.
 const minutes=Number(hh.slice(0,2))*60+Number(hh.slice(3)),endMinutes=Math.min(Number(c.end.slice(0,2))*60+Number(c.end.slice(3)),['2026-11-27','2026-12-24'].includes(date)?780:960);
 if(minutes>=endMinutes-5){status('WAITING','Entry cutoff');return changed}
 const rejected={},candidates=[];const reject=k=>{rejected[k]=(rejected[k]||0)+1};for(const ticker of symbols){if(c.excluded.includes(ticker)||(c.allowed.length&&!c.allowed.includes(ticker))){reject('Excluded');continue}const q=snapshots[ticker];if(!fresh(q,now)){reject('Missing or stale quote');continue}const r=analyze(q,now);if(r.status!=='BREAKOUT DETECTED'){reject(r.status);continue}if(regimeFor(r.bars)==='HIGH VOLATILITY'){reject('High volatility');continue}if(r.metrics.spread>c.maxSpread/100){reject('Spread too wide');continue}const last=r.bars.at(-1);if(a.lastSignal?.[ticker]===last.time){reject('Already evaluated signal');continue}
 const friction=frictionFor(r.bars),entry=q.ask*(1+friction),stop=r.metrics.resistance*(1-friction),risk=entry-stop;if(!(risk>0)||entry<5){reject('Invalid entry or stop');continue}const target=entry+c.minRatio*risk;const remain=Math.min(c.maxLoss-grossLoss,c.maxLoss+net,2.5,a.peak*.05-(a.peak-s.balance));const shares=fractionalSize({entry,risk,capital:Math.min(c.maxTrade,c.budget,s.balance),remaining:remain});if(!shares){reject('Allocation or risk limit');continue}candidates.push({ticker,entry,stop,target,shares,friction,last,r});}
 a.scan={time,checked:symbols.length,rejected,qualified:candidates.length};changed=true;
 candidates.sort((a,b)=>b.r.score-a.r.score||a.ticker.localeCompare(b.ticker));for(const {ticker,entry,stop,target,shares,friction,last,r} of candidates){
 a.lastSignal??={};a.lastSignal[ticker]=last.time;s.position={ticker,entry,stop,target,shares,fees:0,friction,opened:time,openedDay:date,source:'AUTO PAPER',reason:'Experimental completed-bar breakout; modeled target',signalTime:last.time};event('auto-paper-open',{ticker,entry,stop,target,shares,metrics:r.metrics});status('HOLD','Virtual entry opened');return true
 }
 status('SCANNING','No qualifying experimental setup');return changed
}
export function configureAutomation(s,c){if(s.position)throw Error('Close virtual position before changing settings');const prior=s.automation||{};s.automation={armed:c.mode==='automatic',status:c.mode==='automatic'?'WAITING':'STOPPED',reason:'Saved configuration',day:prior.day??null,startBalance:prior.startBalance, lastSignal:prior.lastSignal||{},peak:prior.peak??s.balance,cooldownUntil:prior.cooldownUntil||0,lastTrainingDay:prior.lastTrainingDay,autoTrain:c.autoTrain===true};s.stopped=true}
