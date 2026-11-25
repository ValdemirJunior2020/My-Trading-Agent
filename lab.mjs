import {strategies} from './lab-strategies.mjs';
import {initial} from './paper.mjs';
import {defaults} from './session.mjs';
import {automaticStep,configureAutomation} from './auto-paper.mjs';
import {positions,invested} from './portfolio.mjs';
import {positionView} from './position-view.mjs';
export function createLab(){return {enabled:false,accounts:Object.fromEntries(strategies.map(id=>{const s=initial();s.balance=500;s.session={config:{...defaults(),budget:500,objective:50,maxLoss:10,maxTrade:83,maxTrades:12,maxPositions:6,earlyProfit:1,trailingProfit:true,holdLosers:true,mode:'automatic'}};configureAutomation(s,s.session.config);return [id,s]}))}}
export function upgradeLab(lab){for(const s of Object.values(lab.accounts)){s.session.config.trailingProfit??=true}return lab}
export function autoStartLab(lab){if(lab.autoStart===false)return false;if(lab.autoStart===true)return false;lab.autoStart=true;if(!lab.enabled&&!Object.values(lab.accounts).some(s=>s.automation.exitRequested))labCommand(lab,'start');return true}
export function labStep(lab,input){let changed=false;if(!lab.enabled)return false;for(const id of strategies)if(automaticStep(lab.accounts[id],{...input,strategy:id}))changed=true;return changed}
export function labReport(lab,now=Date.now()){return {enabled:lab.enabled,autoStart:lab.autoStart===true,accounts:strategies.map(id=>{const s=lab.accounts[id],open=positions(s).map(position=>positionView({position},now)),pnl=s.trades.reduce((n,t)=>n+t.pnl,0),unrealized=open.every(p=>Number.isFinite(p.unrealized))?open.reduce((n,p)=>n+p.unrealized,0):null;return {id,balance:s.balance,realized:pnl,unrealized,equity:unrealized===null?null:s.balance+unrealized,cash:s.balance-invested(s),open,trades:s.trades.length,wins:s.trades.filter(t=>t.pnl>0).length,trailingProfit:s.session.config.trailingProfit===true,maxDrawdown:drawdown(s.trades),status:s.automation.status,reason:s.automation.reason,scan:s.automation.scan,last:s.trades.at(-1)||null}}).sort((a,b)=>b.realized-a.realized)}}
export function labCommand(lab,type){if(type==='start'){lab.autoStart=true;lab.enabled=true;for(const s of Object.values(lab.accounts)){if(s.automation.exitRequested)throw Error('Wait for pending exits');s.automation.armed=true}}else if(type==='stop'){lab.autoStart=false;for(const s of Object.values(lab.accounts)){s.automation.exitRequested=positions(s).length>0;s.automation.armed=s.automation.exitRequested}lab.enabled=Object.values(lab.accounts).some(s=>s.automation.armed)}else throw Error('Unknown lab action')}

function drawdown(trades){let equity=500,peak=500,worst=0;for(const t of trades){equity+=t.pnl;peak=Math.max(peak,equity);worst=Math.max(worst,peak-equity)}return worst}
