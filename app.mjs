import {calculate} from './risk.mjs';
const $=id=>document.getElementById(id);
let stopped=localStorage.getItem('lion-stopped')==='true';
function sync(){ $('toggle').textContent=stopped?'Resume calculator':'STOP';$('calc').querySelectorAll('input,button').forEach(x=>x.disabled=stopped);if(stopped)$('result').textContent='STOPPED — no new calculations.'; }
$('toggle').onclick=()=>{stopped=!stopped;localStorage.setItem('lion-stopped',String(stopped));sync()};sync();
$('calc').onsubmit=e=>{e.preventDefault();if(stopped)return;const v=id=>Number($(id).value);const r=calculate({entry:v('entry'),stop:v('stop'),target:v('target'),fees:v('fees'),remainingLoss:v('remainingLoss')});$('result').textContent=$('ticker').value.toUpperCase()+' — INSUFFICIENT DATA (no verified feed)\n'+r.reason+(r.shares?'\nShares: '+r.shares+'\nPosition: $'+r.cost.toFixed(2)+'\nPlanned loss: $'+r.loss.toFixed(2)+'\nEstimated profit: $'+r.profit.toFixed(2)+'\nReward/risk: '+r.ratio.toFixed(2)+':1':'')+'\nNot a trade proposal. Slippage and gaps may increase loss.'};
let notes=[];try{notes=JSON.parse(localStorage.getItem('lion-notes')||'[]');if(!Array.isArray(notes))notes=[]}catch{}
function render(){ $('notes').replaceChildren();for(const n of notes.slice().reverse()){const p=document.createElement('p');p.textContent=n.date+' — '+n.text;$('notes').append(p)} }render();
$('journal').onsubmit=e=>{e.preventDefault();notes.push({date:new Date().toISOString(),text:$('note').value});localStorage.setItem('lion-notes',JSON.stringify(notes));$('note').value='';render()};
