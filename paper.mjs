import {calculate} from './risk.mjs';
import {sessionCommand,entryRules,summary} from './session.mjs';
export const initial=()=>({balance:100,position:null,trades:[],events:[],stopped:false});
export function day(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))}
export function report(s,now=new Date()){const d=day(now),trades=s.trades.filter(t=>day(t.closed)===d),pnl=trades.reduce((a,t)=>a+t.pnl,0);return {day:d,balance:s.balance,realized:pnl,trades:trades.length,winRate:trades.length?trades.filter(t=>t.pnl>0).length/trades.length:0,largestLoss:Math.min(0,...trades.map(t=>t.pnl)),position:s.position,stopped:s.stopped,session:summary(s,d)}}
export function apply(s,a,now=new Date()){
 const time=now.toISOString(),d=day(now);const log=(type,details)=>s.events.push({time,type,...details});
 if(typeof a.type==='string'&&a.type.startsWith('session-')){sessionCommand(s,a,d);log(a.type,{status:s.session.status,config:s.session.config});return}
 if(a.type==='stop'||a.type==='resume'){if(s.session){if(a.type==='stop')sessionCommand(s,{type:'session-stop'},d);else throw Error('Use daily session START to resume')}else s.stopped=a.type==='stop';log(a.type,{});return}
 if(a.type==='note'){log('lesson',{note:String(a.note||'').slice(0,2000)});return}
 if(a.type==='close'){
  if(!s.position||!Number.isFinite(a.price)||a.price<=0)throw Error('Open position and valid hypothetical exit required');
  const p=s.position,pnl=p.shares*(a.price-p.entry)-p.fees;const t={...p,exit:a.price,closed:time,closedDay:d,pnl,reason:String(a.reason||'manual exit').slice(0,500)};s.balance+=pnl;s.trades.push(t);s.position=null;log('paper_close',t);return
 }
 if(a.type!=='open')throw Error('Unknown action');
 if(s.stopped||s.position)throw Error('Stopped or position already open');
 const todays=s.trades.filter(t=>day(t.opened)===d),loss=todays.reduce((x,t)=>x+Math.max(0,-t.pnl),0);
 if(todays.length>=2||loss>=5)throw Error('Daily limit reached');
 // Manual practice is intentionally not classified as verified market research.
 if(a.asset!=='stock-etf'||!/^[A-Z][A-Z0-9.]{0,9}$/.test(a.ticker||''))throw Error('Confirm stock/ETF and valid ticker');
 const limits=entryRules(s,a,d);const r=calculate({entry:a.entry,stop:a.stop,target:a.target,capital:limits?.capital??s.balance,remainingLoss:Math.min(5-loss,limits?.remainingLoss??5),fees:a.fees||0});if(!r.ok||r.ratio<(limits?.minRatio??2))throw Error('Risk check failed: '+r.reason);
 s.position={ticker:a.ticker,entry:a.entry,stop:a.stop,target:a.target,shares:r.shares,fees:a.fees||0,opened:time,openedDay:d,source:'MANUAL HYPOTHETICAL',reason:String(a.reason||'').slice(0,500)};log('paper_open',s.position)
}
