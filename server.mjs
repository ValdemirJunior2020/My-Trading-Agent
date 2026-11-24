import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {initial,apply,report,day} from './paper.mjs';
import {createMonitor} from './monitor.mjs';
import {createProvider} from './robinhood-data.mjs';
let provider=null;
if(process.argv.includes('--robinhood')){try{const {connectRobinhood,marketCall}=await import('./robinhood.mjs');const client=await connectRobinhood();provider=createProvider((name,args,signal)=>{if(signal?.aborted)throw Error('Stopped');return marketCall(client,name,args)});console.log('Robinhood market session authenticated. No account or order tools enabled.')}catch{console.error('Robinhood authentication failed; starting offline.')}} 
const monitor=await createMonitor({provider});
const dir=new URL('./data/',import.meta.url),file=new URL('paper.json',dir),tmp=new URL('paper.tmp',dir);await mkdir(dir,{recursive:true});let state;
try{state=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;state=initial()}
for(const t of state.trades){t.openedDay??=day(t.opened);t.closedDay??=day(t.closed)}
let queue=Promise.resolve();const routes={'/':['index.html','text/html'],'/app.mjs':['app.mjs','text/javascript'],'/risk.mjs':['risk.mjs','text/javascript'],'/style.css':['style.css','text/css'],'/paper-ui.mjs':['paper-ui.mjs','text/javascript'],'/monitor-ui.mjs':['monitor-ui.mjs','text/javascript'],'/decision-help.mjs':['decision-help.mjs','text/javascript'],'/chart.mjs':['chart.mjs','text/javascript'],'/session-ui.mjs':['session-ui.mjs','text/javascript']};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
const server=http.createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:8790'&&req.headers.host!=='localhost:8790')return json(res,403,{error:'Local host only'});
 if(req.url==='/api/monitor'&&req.method==='GET')return json(res,200,monitor.get());
 if(req.url==='/api/monitor'&&req.method==='POST'){
 if(!['http://127.0.0.1:8790','http://localhost:8790'].includes(req.headers.origin)||req.headers['content-type']!=='application/json')return json(res,403,{error:'Local origin required'});
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)throw Error('Request too large')}const a=JSON.parse(body);await monitor.command(a);if(a.type==='emergency'){const task=queue.then(async()=>{const next=structuredClone(state);apply(next,{type:next.session?'session-emergency':'stop'});await writeFile(tmp,JSON.stringify(next,null,2));await rename(tmp,file);state=next});queue=task.catch(()=>{});await task}return json(res,200,monitor.get())}catch(e){return json(res,400,{error:e.message})}
 }
 if(req.url==='/api/paper'&&req.method==='GET')return json(res,200,{state,report:report(state)});
 if(req.url==='/api/paper'&&req.method==='POST'){
  if(!['http://127.0.0.1:8790','http://localhost:8790'].includes(req.headers.origin)||req.headers['content-type']!=='application/json')return json(res,403,{error:'Local origin required'});
  try{let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)throw Error('Request too large')}const action=JSON.parse(body);
  const task=queue.then(async()=>{const next=structuredClone(state);try{apply(next,action)}catch(e){next.events.push({time:new Date().toISOString(),type:'rejected',action:action.type,reason:e.message});await writeFile(tmp,JSON.stringify(next,null,2));await rename(tmp,file);state=next;throw e}await writeFile(tmp,JSON.stringify(next,null,2));await rename(tmp,file);state=next});queue=task.catch(()=>{});await task;return json(res,200,{state,report:report(state)})}catch(e){return json(res,400,{error:e.message})}
 }
 const route=routes[new URL(req.url,'http://127.0.0.1:8790').pathname];if(req.method!=='GET'||!route){res.writeHead(404);return res.end('Not found')}
 try{const data=await readFile(new URL(route[0],import.meta.url));res.writeHead(200,{'Content-Type':route[1]+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; object-src 'none'; frame-ancestors 'none'"});res.end(data)}catch{res.writeHead(500);res.end('Unavailable')}
});server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port 8790 already occupied. Close the previous THE LION instance.':e.message);process.exitCode=1});server.listen(8790,'127.0.0.1',()=>console.log('THE LION: http://127.0.0.1:8790'));
