import { createServer,type IncomingMessage,type ServerResponse } from 'node:http'
import { existsSync,readFileSync,rmSync,statSync,writeFileSync } from 'node:fs'
import { extname,join,normalize,resolve,sep } from 'node:path'
import { config,coinbaseConfigured } from './config.js'
import { listPaperTrades,openPaperTrade,recentEvents,saveAnalysis,setSetting } from './db.js'
import { attachEventStream,publish } from './events.js'
import { getOllamaStatus,runAgent,runToolCopilot } from './ollama.js'
import { getProduct,listAccounts } from './coinbase.js'
import { emergencyStopActive,evaluatePaperOrder,type PaperOrderRequest } from './risk.js'
import { quantStatus,runNautilusSmoke,runRdAgent,runVectorbtSma } from './quant.js'
import { runFullAgentPipeline } from './pipeline.js'

const distDir=resolve(process.cwd(),'dist'), pidFile=join(config.dataDir,'server.pid'), startedAt=new Date().toISOString()
const json=(res:ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(body))}
const readJson=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>1000000)throw new Error('Request body too large.');chunks.push(b)}return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}}
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'}

const serveStatic=(pathname:string,res:ServerResponse)=>{
  if(!existsSync(distDir)) return false

  let file=join(distDir,'index.html')

  if(pathname!=='/'){
    const decoded=decodeURIComponent(pathname)
    const relative=normalize(decoded).replace(/^[/\\]+/,'')
    const candidate=resolve(distDir,relative)
    const insideDist=candidate===distDir||candidate.startsWith(distDir+sep)
    if(insideDist&&existsSync(candidate)&&statSync(candidate).isFile()) file=candidate
  }

  if(!existsSync(file)||!statSync(file).isFile()) return false

  res.writeHead(200,{
    'Content-Type':mime[extname(file).toLowerCase()]||'application/octet-stream',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'X-Frame-Options':'SAMEORIGIN',
    'Cache-Control':extname(file).toLowerCase()==='.html'?'no-cache':'public, max-age=3600'
  })
  res.end(readFileSync(file))
  return true
}

const statusPayload=async()=>{const [ollama,engines]=await Promise.all([getOllamaStatus(),quantStatus()]);return {server:{online:true,version:'0.3.0',startedAt},ollama,coinbase:{configured:coinbaseConfigured()},engines,safety:{emergencyStop:emergencyStopActive(),mode:config.tradingMode,liveTradingEnabled:config.liveTradingEnabled,automaticTradingEnabled:config.autoTradingEnabled,manualApprovalRequired:config.manualApprovalRequired}}}

const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),path=url.pathname
  if(path==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,startedAt})
  if(path==='/api/status'&&req.method==='GET')return json(res,200,await statusPayload())
  if(path==='/api/events'&&req.method==='GET')return attachEventStream(res)
  if(path==='/api/events/recent'&&req.method==='GET')return json(res,200,{events:recentEvents(30)})
  if(path==='/api/paper/orders'&&req.method==='GET')return json(res,200,{orders:listPaperTrades()})
  if(path==='/api/emergency-stop'&&req.method==='POST'){const body=await readJson(req) as {active?:boolean};const active=Boolean(body.active);setSetting('emergency_stop',String(active));const event=publish(active?'emergency_stop_activated':'emergency_stop_cleared',{active},'manager');return json(res,200,{ok:true,active,event})}
  if(path==='/api/paper/orders'&&req.method==='POST'){const body=await readJson(req) as PaperOrderRequest;const order:PaperOrderRequest={productId:String(body.productId||'').toUpperCase(),side:String(body.side||'').toUpperCase() as 'BUY'|'SELL',size:Number(body.size),price:Number(body.price)};const risk=evaluatePaperOrder(order);if(!risk.approved){publish('paper_order_rejected',{order,risk},'risk');return json(res,422,{ok:false,risk})}const trade=openPaperTrade(order.productId,order.side,order.size,order.price);publish('paper_order_opened',{trade,risk},'paper');return json(res,201,{ok:true,trade,risk})}
  if(path==='/api/agents/run'&&req.method==='POST'){const body=await readJson(req) as {agentId?:string;asset?:string;summary?:string};const agentId=String(body.agentId||''),asset=String(body.asset||'UNKNOWN'),summary=String(body.summary||'');if(!agentId||!summary)return json(res,400,{error:'agentId and summary are required.'});publish('agent_started',{asset},agentId);const result=await runAgent(agentId,asset,summary);saveAnalysis(agentId,asset,summary,result.output,result.model);publish('agent_completed',{asset,output:result.output},agentId);return json(res,200,result)}
  if(path==='/api/agents/pipeline'&&req.method==='POST'){
    const body=await readJson(req) as {productId?:string;deepResearch?:boolean}
    const result=await runFullAgentPipeline({productId:String(body.productId||'BTC-USD'),deepResearch:Boolean(body.deepResearch)})
    return json(res,200,{ok:true,result})
  }
  if(path==='/api/copilot/chat'&&req.method==='POST'){
    const body=await readJson(req) as {message?:string;language?:'en'|'pt'}
    const message=String(body.message||'').trim().slice(0,4000)
    const language=body.language==='pt'?'pt':'en'
    if(!message)return json(res,400,{error:'message is required.'})
    const [system,events]=await Promise.all([statusPayload(),Promise.resolve(recentEvents(20))])
    const context={system,events}
    const result=await runToolCopilot(message,context,language)
    publish('copilot_answered',{language,question:message.slice(0,180)},'manager')
    return json(res,200,{ok:true,...result})
  }
  if(path==='/api/quant/status'&&req.method==='GET')return json(res,200,await quantStatus())
  if(path==='/api/quant/vectorbt/sma'&&req.method==='POST'){const body=await readJson(req);const result=await runVectorbtSma(body);publish('vectorbt_backtest_completed',{result},'strategy');return json(res,200,{ok:true,result})}
  if(path==='/api/quant/nautilus/smoke'&&req.method==='POST'){const result=await runNautilusSmoke();publish('nautilus_engine_ready',{result},'backtest');return json(res,200,{ok:true,result})}
  if(path==='/api/quant/rdagent/health'&&req.method==='GET'){const result=await runRdAgent('health');return json(res,200,{ok:true,result})}
  if(path==='/api/quant/rdagent/run'&&req.method==='POST'){const body=await readJson(req) as {command?:string;stepN?:number;loopN?:number};const command=String(body.command||'fin_quant');if(!['fin_quant','fin_factor','health','info'].includes(command))return json(res,400,{error:'Invalid RD-Agent command.'});const stepN=Math.max(1,Math.min(5,Number(body.stepN)||1)),loopN=Math.max(1,Math.min(5,Number(body.loopN)||1));const result=await runRdAgent(command as 'fin_quant'|'fin_factor'|'health'|'info',stepN,loopN);publish('rdagent_run_completed',{command,stepN,loopN},'strategy');return json(res,200,{ok:true,result})}
  if(path==='/api/coinbase/status'&&req.method==='GET')return json(res,200,{configured:coinbaseConfigured(),portfolioUuid:config.coinbasePortfolioUuid||null})
  if(path==='/api/coinbase/accounts'&&req.method==='GET'){if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'});return json(res,200,{accounts:await listAccounts()})}
  if(path.startsWith('/api/coinbase/product/')&&req.method==='GET'){if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'});const productId=decodeURIComponent(path.split('/').pop()||'BTC-USD').toUpperCase();return json(res,200,{product:await getProduct(productId)})}
  if(path.startsWith('/api/'))return json(res,404,{error:'API route not found.'})
  if(serveStatic(path,res))return
  return json(res,404,{error:'Frontend build not found. Run npm run build.'})
 }catch(error){const message=error instanceof Error?error.message:'Unknown server error';console.error('[server]',message);if(!res.headersSent)json(res,500,{error:message});else res.end()}
})

server.listen(config.port,config.host,()=>{writeFileSync(pidFile,String(process.pid),'utf8');console.log(`My Trading Agent running at http://${config.host}:${config.port}`);console.log(`Mode: ${config.tradingMode} | Coinbase configured: ${coinbaseConfigured()} | Live execution: ${config.liveTradingEnabled}`)})

const shutdown=()=>{try{if(existsSync(pidFile))rmSync(pidFile)}catch{}server.close(()=>process.exit(0))}
process.on('SIGINT',shutdown)
process.on('SIGTERM',shutdown)
