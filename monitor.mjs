import {readFile,writeFile,rename,mkdir,appendFile} from 'node:fs/promises';
import {defaults,analyze,explain} from './market.mjs';
export async function createMonitor({provider=null}={}){
 const dir=new URL('./data/',import.meta.url);await mkdir(dir,{recursive:true});const settingsFile=new URL('monitor-settings.json',dir);let config=structuredClone(defaults);
 try{config=JSON.parse(await readFile(settingsFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 let enabled=false,busy=false,controller=null,timer=null,generation=0;let snapshot={status:'STOPPED',rows:[],next:null,activity:'Not started',config};const seen=new Map();
 const log=async event=>appendFile(new URL('market-events.jsonl',dir),JSON.stringify({time:new Date().toISOString(),...event})+'\n');
 function publish(status,activity,rows=[]){snapshot={status,activity,rows,next:null,config}}
 async function tick(){if(!enabled||busy)return;busy=true;const g=generation;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
 try{if(!provider){publish('INSUFFICIENT DATA','Robinhood adapter not verified',config.symbols.map(ticker=>({ticker,status:'INSUFFICIENT DATA',reason:'No verified connection'})));return}
 publish('CHECKING','Checking verified exchange session');const session=await provider.session(controller.signal);if(!session?.verified||!session.open){publish('SUSPENDED','Exchange session closed or unverified');return}
 const rows=[];for(const ticker of config.symbols){if(!enabled||g!==generation)return;publish('CHECKING','Analyzing '+ticker,rows.slice());const raw=await provider.snapshot(ticker,controller.signal);const result=analyze(raw);rows.push({ticker,...result})}
 if(rows.some(r=>r.status==='INSUFFICIENT DATA')){publish('INSUFFICIENT DATA','Incomplete or stale feed',rows);return}
 rows.sort((a,b)=>b.score-a.score);const commentary=await explain(rows.map(({ticker,status,reason,metrics})=>({ticker,status,reason,metrics})),controller.signal);
 if(!enabled||g!==generation)return;publish('RESEARCH','Validated snapshots; AI commentary is unverified interpretation',rows);snapshot.commentary=commentary;
 for(const row of rows){const key=row.status+'|'+row.reason;if(seen.get(row.ticker)!==key){await log({type:'signal-change',ticker:row.ticker,status:row.status,reason:row.reason,metrics:row.metrics,dataTime:row.time});seen.set(row.ticker,key)}}
 }catch{if(enabled&&g===generation){publish('SUSPENDED','Market data or Ollama unavailable');await log({type:'connection-error'}).catch(()=>{})}}
 finally{clearTimeout(timeout);busy=false;if(enabled){snapshot.next=new Date(Date.now()+config.seconds*1000).toISOString();timer=setTimeout(tick,config.seconds*1000)}}
 }
 return {get:()=>snapshot,async command(a){if(a.type==='stop'||a.type==='emergency'){enabled=false;generation++;clearTimeout(timer);controller?.abort();publish('STOPPED','Monitoring stopped');await log({type:a.type});return}
 if(a.type==='settings'){if(!Array.isArray(a.symbols)||a.symbols.length<1||a.symbols.length>20||a.symbols.some(x=>typeof x!=='string'||!/^[A-Z][A-Z0-9.]{0,9}$/.test(x))||!Number.isInteger(a.seconds)||a.seconds<60||a.seconds>300)throw Error('Use 1–20 valid symbols and 60–300 seconds');if(enabled||busy)throw Error('Stop monitoring before changing settings');config={symbols:[...new Set(a.symbols)],seconds:a.seconds};const tmp=new URL('monitor-settings.tmp',dir);await writeFile(tmp,JSON.stringify(config));await rename(tmp,settingsFile);publish('STOPPED','Settings saved');return}
 if(a.type==='start'){if(enabled||busy)return;enabled=true;await log({type:'start'});void tick();return}throw Error('Unknown monitor command')}}
}
