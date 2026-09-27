import { randomUUID } from 'node:crypto'
import { createServer,type ServerResponse } from 'node:http'
import { existsSync,readFileSync,rmSync,statSync,writeFileSync } from 'node:fs'
import { extname,join,normalize,resolve,sep } from 'node:path'
import { config,coinbaseConfigured } from './config.js'
import { getAutoRunSettings,startAutoRun,stopAutoRun } from './autorun.js'
import { startMeanReversionEngine,stopMeanReversionEngine } from './meanReversionEngine.js'
import { handleApiRequest } from './routes/api.js'
import { log,serverLogFile } from './logger.js'
import { initializeSingleLossStopModel,migrateLegacyLossHaltEmergencyStop } from './risk.js'

const distDir=resolve(process.cwd(),'dist')
const pidFile=join(config.dataDir,'server.pid')
const startedAt=new Date().toISOString()

const json=(res:ServerResponse,status:number,body:unknown)=>{
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  })
  res.end(JSON.stringify(body))
}

const mime:Record<string,string>={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.ico':'image/x-icon',
  '.webp':'image/webp',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg'
}

const serveStatic=(pathname:string,res:ServerResponse)=>{
  if(!existsSync(distDir))return false

  let file=join(distDir,'index.html')
  if(pathname!=='/'){
    const decoded=decodeURIComponent(pathname)
    const relative=normalize(decoded).replace(/^[/\\]+/,'')
    const candidate=resolve(distDir,relative)
    const insideDist=candidate===distDir||candidate.startsWith(distDir+sep)
    if(insideDist&&existsSync(candidate)&&statSync(candidate).isFile())file=candidate
  }

  if(!existsSync(file)||!statSync(file).isFile())return false

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

const server=createServer(async(req,res)=>{
  const requestId=randomUUID()
  const requestStarted=Date.now()
  const method=String(req.method||'GET')
  const rawUrl=String(req.url||'/')
  res.setHeader('X-Request-Id',requestId)

  res.once('finish',()=>{
    if(!rawUrl.startsWith('/api/'))return
    const path=rawUrl.split('?')[0]
    const durationMs=Date.now()-requestStarted
    const shouldLog=method!=='GET'||res.statusCode>=400||durationMs>=2000
    if(!shouldLog)return

    const details={
      requestId,
      method,
      path,
      statusCode:res.statusCode,
      durationMs
    }

    if(res.statusCode>=400)log.warn('http_request',details)
    else log.info('http_request',details)
  })

  try{
    const url=new URL(rawUrl,`http://${req.headers.host||'localhost'}`)
    const path=url.pathname

    if(path.startsWith('/api/')){
      await handleApiRequest(req,res,url,startedAt)
      return
    }

    if(serveStatic(path,res))return
    return json(res,404,{error:'Frontend build not found. Run npm run build.'})
  }catch(error){
    const message=error instanceof Error?error.message:'Unknown server error'
    log.error('http_request_failed',{
      requestId,
      method,
      path:rawUrl.split('?')[0],
      durationMs:Date.now()-requestStarted,
      error:message
    })
    if(!res.headersSent)json(res,500,{error:message,requestId})
    else res.end()
  }
})

server.listen(config.port,config.host,()=>{
  writeFileSync(pidFile,String(process.pid),'utf8')
  initializeSingleLossStopModel()
  migrateLegacyLossHaltEmergencyStop()
  log.info('server_started',{
    host:config.host,
    port:config.port,
    mode:config.tradingMode,
    coinbaseConfigured:coinbaseConfigured(),
    liveExecution:config.liveTradingEnabled,
    autoAgents:getAutoRunSettings().enabled,
    autoAgentIntervalSeconds:getAutoRunSettings().intervalSeconds,
    logFile:serverLogFile
  })
  startAutoRun()
  setTimeout(()=>void startMeanReversionEngine(),15000)
})

const shutdown=()=>{
  log.info('server_stopping')
  stopAutoRun()
  stopMeanReversionEngine()
  try{if(existsSync(pidFile))rmSync(pidFile)}catch{}
  server.close(()=>process.exit(0))
}

process.on('SIGINT',shutdown)
process.on('SIGTERM',shutdown)
