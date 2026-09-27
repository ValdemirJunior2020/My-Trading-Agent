import type { IncomingMessage,ServerResponse } from 'node:http'
import { config,coinbaseConfigured,coinbaseCredentialShape } from '../config.js'
import { listPaperTrades,openPaperTrade,recentEvents,saveAnalysis,setSetting,liveTradeHistory,clearLiveTradeHistory,restoreLiveTradeHistory,latestLiveOrderEvent,realizedProfitHistory } from '../db.js'
import { attachEventStream,publish } from '../events.js'
import { getOllamaStatus,runAgent,runToolCopilot,runToolCopilotPlanner } from '../ollama.js'
import { getCandles,getMarketTrades,getProduct,getProductBook,listAccounts,listSpotUsdProducts } from '../coinbase.js'
import { emergencyStopActive,evaluateLiveOrder,evaluatePaperOrder,getDailyEquityGuard,getRuntimeRiskLimits,migrateLegacyLossHaltEmergencyStop,saveRuntimeRiskLimits,getRollingRiskState,type PaperOrderRequest } from '../risk.js'
import { quantStatus,runNautilusSmoke,runRdAgent,runVectorbtSma } from '../quant.js'
import { getPipelineStatus,runFullAgentPipeline } from '../pipeline.js'
import { getChallengeSnapshot,getTradingChallenge,saveTradingChallenge } from '../challenge.js'
import { getAutoRunSettings,saveAutoRunSettings } from '../autorun.js'
import { scanCryptoMarket } from '../scanner.js'
import { getMeanReversionEngineStatus } from '../meanReversionEngine.js'

const json=(res:ServerResponse,status:number,body:unknown)=>{
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  })
  res.end(JSON.stringify(body))
}

const readJson=async(req:IncomingMessage)=>{
  const chunks:Buffer[]=[]
  let size=0
  for await(const chunk of req){
    const b=Buffer.from(chunk)
    size+=b.length
    if(size>1000000)throw new Error('Request body too large.')
    chunks.push(b)
  }
  return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}
}

const statusPayload=async(startedAt:string)=>{
  migrateLegacyLossHaltEmergencyStop()
  const [ollama,engines]=await Promise.all([getOllamaStatus(),quantStatus()])
  return {
    server:{online:true,version:'0.6.1',startedAt},
    ollama,
    coinbase:{configured:coinbaseConfigured()},
    engines,
    autoAgents:getAutoRunSettings(),
    meanReversion:getMeanReversionEngineStatus(),
    safety:{
      emergencyStop:emergencyStopActive(),
      lossHaltActive:getSetting('loss_halt_active','false')==='true',
      rollingRisk:getRollingRiskState(),
      mode:config.tradingMode,
      liveTradingEnabled:config.liveTradingEnabled,
      automaticTradingEnabled:config.autoTradingEnabled,
      manualApprovalRequired:config.manualApprovalRequired
    }
  }
}

export const handleApiRequest=async(
  req:IncomingMessage,
  res:ServerResponse,
  url:URL,
  startedAt:string
)=>{
  const path=url.pathname
  if(path==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,startedAt})
  if(path==='/api/status'&&req.method==='GET')return json(res,200,await statusPayload(startedAt))
  if(path==='/api/events'&&req.method==='GET')return attachEventStream(res)
  if(path==='/api/events/recent'&&req.method==='GET')return json(res,200,{events:recentEvents(30)})
  if(path==='/api/live/history'&&req.method==='GET'){const limit=Math.max(1,Math.min(1000,Number(url.searchParams.get('limit'))||200));return json(res,200,{events:liveTradeHistory(limit)})}
  if(path==='/api/live/latest-order'&&req.method==='GET')return json(res,200,{event:latestLiveOrderEvent()})
  if(path==='/api/live/profits'&&req.method==='GET')return json(res,200,realizedProfitHistory())
  if(path==='/api/live/history'&&req.method==='DELETE'){const result=clearLiveTradeHistory();return json(res,200,{ok:true,...result})}
  if(path==='/api/live/history/restore'&&req.method==='POST'){const result=restoreLiveTradeHistory();return json(res,200,{ok:true,...result})}
  if(path==='/api/paper/orders'&&req.method==='GET')return json(res,200,{orders:listPaperTrades()})
  if(path==='/api/emergency-stop'&&req.method==='POST'){const body=await readJson(req) as {active?:boolean};const active=Boolean(body.active);setSetting('emergency_stop',String(active));setSetting('emergency_stop_reason',active?'MANUAL':'');const event=publish(active?'emergency_stop_activated':'emergency_stop_cleared',{active},'manager');return json(res,200,{ok:true,active,event})}
  if(path==='/api/paper/orders'&&req.method==='POST'){const body=await readJson(req) as PaperOrderRequest;const order:PaperOrderRequest={productId:String(body.productId||'').toUpperCase(),side:String(body.side||'').toUpperCase() as 'BUY'|'SELL',size:Number(body.size),price:Number(body.price)};const risk=evaluatePaperOrder(order);if(!risk.approved){publish('paper_order_rejected',{order,risk},'risk');return json(res,422,{ok:false,risk})}const trade=openPaperTrade(order.productId,order.side,order.size,order.price);publish('paper_order_opened',{trade,risk},'paper');return json(res,201,{ok:true,trade,risk})}
  if(path==='/api/agents/run'&&req.method==='POST'){const body=await readJson(req) as {agentId?:string;asset?:string;summary?:string};const agentId=String(body.agentId||''),asset=String(body.asset||'UNKNOWN'),summary=String(body.summary||'');if(!agentId||!summary)return json(res,400,{error:'agentId and summary are required.'});publish('agent_started',{asset},agentId);const result=await runAgent(agentId,asset,summary);saveAnalysis(agentId,asset,summary,result.output,result.model);publish('agent_completed',{asset,output:result.output},agentId);return json(res,200,result)}
  if(path==='/api/agents/pipeline/status'&&req.method==='GET')return json(res,200,getPipelineStatus())
  if(path==='/api/scanner'&&req.method==='GET')return json(res,200,await scanCryptoMarket())
  if(path==='/api/strategy/mean-reversion/status'&&req.method==='GET')return json(res,200,getMeanReversionEngineStatus())
  if(path==='/api/agents/auto-run'&&req.method==='GET')return json(res,200,getAutoRunSettings())
  if(path==='/api/agents/auto-run'&&req.method==='POST'){
    const body=await readJson(req) as {enabled?:boolean;intervalSeconds?:number;deepResearch?:boolean}
    const settings=saveAutoRunSettings(body)
    return json(res,200,{ok:true,settings})
  }
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
    const [system,events,challenge,pipeline]=await Promise.all([statusPayload(startedAt),Promise.resolve(recentEvents(20)),getChallengeSnapshot(),Promise.resolve(getPipelineStatus())])
    const context={system,events,challenge,pipeline,riskLimits:getRuntimeRiskLimits(),backtestConfig:{marketCandles:120,backtestCandles:3000,granularity:'ONE_HOUR',initialCashSource:'challenge.startingBalanceUsd',validation:['buy-and-hold benchmark','70/30 out-of-sample','walk-forward folds','realized vs open PnL'],parameterSets:[{fast:5,slow:20},{fast:10,slow:30},{fast:20,slow:50},{fast:30,slow:100}]}}
    const plan=await runToolCopilotPlanner(message,context,language)
    let actionResult:any=null

    if(plan.action==='SET_CHALLENGE'){
      const next=saveTradingChallenge({
        startingBalanceUsd:plan.startingBalanceUsd,
        targetBalanceUsd:plan.targetBalanceUsd,
        durationDays:plan.durationDays,
        enabled:true,
        startedAt:new Date().toISOString()
      })
      actionResult={action:'SET_CHALLENGE',challenge:next}
      publish('challenge_updated',{challenge:next},'manager')
    }else if(plan.action==='SET_RISK_LIMITS'){
      const limits=saveRuntimeRiskLimits({
        maxPositionPercent:plan.maxPositionPercent,
        maxTotalExposurePercent:plan.maxTotalExposurePercent,
        maxDailyLossPercent:plan.maxDailyLossPercent
      })
      actionResult={action:'SET_RISK_LIMITS',limits}
      publish('risk_limits_updated',{limits},'risk')
    }else if(plan.action==='EMERGENCY_STOP'){
      setSetting('emergency_stop',String(Boolean(plan.active)))
      setSetting('emergency_stop_reason',plan.active?'MANUAL':'')
      actionResult={action:'EMERGENCY_STOP',active:Boolean(plan.active)}
      publish(plan.active?'emergency_stop_activated':'emergency_stop_cleared',{active:Boolean(plan.active)},'manager')
    }else if(plan.action==='SET_AUTO_RUN'){
      const settings=saveAutoRunSettings({enabled:plan.enabled,intervalSeconds:plan.intervalSeconds,deepResearch:plan.deepResearch})
      actionResult={action:'SET_AUTO_RUN',settings}
    }else if(plan.action==='RUN_AGENTS'){
      const current=getPipelineStatus()
      if(current.status==='running'){
        actionResult={action:'RUN_AGENTS',started:false,reason:'Pipeline already running.'}
      }else{
        void runFullAgentPipeline({productId:'BTC-USD',deepResearch:Boolean(plan.deepResearch)}).catch(error=>console.error('[copilot pipeline]',error))
        actionResult={action:'RUN_AGENTS',started:true,deepResearch:Boolean(plan.deepResearch)}
      }
    }

    const refreshedChallenge=await getChallengeSnapshot()
    const responseContext={...context,challenge:refreshedChallenge,actionPlan:plan,actionResult}
    const result=await runToolCopilot(message,responseContext,language)
    publish('copilot_answered',{language,question:message.slice(0,180),action:plan.action},'manager')
    return json(res,200,{ok:true,...result,action:actionResult})
  }
  if(path==='/api/challenge'&&req.method==='GET')return json(res,200,await getChallengeSnapshot())
  if(path==='/api/challenge'&&req.method==='POST'){
    const body=await readJson(req) as {enabled?:boolean;startingBalanceUsd?:number;targetBalanceUsd?:number;durationDays?:number;restart?:boolean}
    const next=saveTradingChallenge({
      enabled:body.enabled,
      startingBalanceUsd:body.startingBalanceUsd,
      targetBalanceUsd:body.targetBalanceUsd,
      durationDays:body.durationDays,
      startedAt:body.restart?new Date().toISOString():getTradingChallenge().startedAt
    })
    publish('challenge_updated',{challenge:next},'manager')
    return json(res,200,{ok:true,challenge:await getChallengeSnapshot()})
  }
  if(path==='/api/risk/settings'&&req.method==='GET')return json(res,200,getRuntimeRiskLimits())
  if(path==='/api/risk/settings'&&req.method==='POST'){
    const body=await readJson(req) as {maxPositionPercent?:number;maxTotalExposurePercent?:number;maxDailyLossPercent?:number}
    const limits=saveRuntimeRiskLimits(body)
    publish('risk_limits_updated',{limits},'risk')
    return json(res,200,{ok:true,limits})
  }
  if(path==='/api/live/readiness'&&req.method==='GET'){
    if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'})
    const portfolio=await getChallengeSnapshot()
    const rawPortfolioUsd=portfolio.currentPortfolioUsd
    const totalPortfolioUsd=Number(rawPortfolioUsd)
    const portfolioAvailable=Number.isFinite(totalPortfolioUsd)&&totalPortfolioUsd>0
    const daily=portfolioAvailable?getDailyEquityGuard(totalPortfolioUsd):null
    const rollingRisk=getRollingRiskState()
    const hardStopped=emergencyStopActive()
    const lossHaltActive=getSetting('loss_halt_active','false')==='true'
    const entryPaused=Boolean(rollingRisk?.paused)
    return json(res,200,{
      ok:true,
      configured:true,
      liveTradingEnabled:config.liveTradingEnabled,
      automaticTradingEnabled:config.autoTradingEnabled,
      manualApprovalRequired:config.manualApprovalRequired,
      emergencyStop:hardStopped,
      lossHaltActive,
      autoSafePause:entryPaused,
      rollingRiskGuard:rollingRisk,
      currentPortfolioUsd:portfolioAvailable?totalPortfolioUsd:null,
      portfolioAvailable,
      portfolioSource:portfolio.portfolioSource||'unavailable',
      portfolioStale:Boolean(portfolio.portfolioStale),
      portfolioUpdatedAt:portfolio.portfolioUpdatedAt||null,
      portfolioError:portfolio.portfolioError||null,
      accountCount:Number(portfolio.accountCount||0),
      dailyLossGuard:daily,
      riskLimits:getRuntimeRiskLimits(),
      liveOrderLimits:{maxLiveOrderUsd:config.maxLiveOrderUsd,minLiveOrderUsd:config.minLiveOrderUsd,cooldownSeconds:config.autoTradeCooldownSeconds,minConfidencePercent:config.autoTradeMinConfidencePercent},
      readyForLive:Boolean(String(config.tradingMode).toLowerCase()==='live'&&config.liveTradingEnabled&&!hardStopped&&portfolioAvailable&&!(daily?.blocked)),
      readyForAutoLive:Boolean(String(config.tradingMode).toLowerCase()==='live'&&config.liveTradingEnabled&&config.autoTradingEnabled&&!hardStopped&&!lossHaltActive&&!entryPaused&&portfolioAvailable&&!(daily?.blocked)),
      readyForProtectiveExits:Boolean(String(config.tradingMode).toLowerCase()==='live'&&config.liveTradingEnabled&&!hardStopped&&portfolioAvailable),
      readyForManualLive:Boolean(String(config.tradingMode).toLowerCase()==='live'&&config.liveTradingEnabled&&!config.autoTradingEnabled&&config.manualApprovalRequired&&!hardStopped&&portfolioAvailable&&!(daily?.blocked))
    })
  }
  if(path==='/api/live/preflight'&&req.method==='POST'){
    if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'})
    const body=await readJson(req) as {productId?:string;side?:string;notionalUsd?:number}
    const productId=String(body.productId||'BTC-USD').toUpperCase()
    const side=String(body.side||'BUY').toUpperCase() as 'BUY'|'SELL'
    const notionalUsd=Number(body.notionalUsd)
    const [accounts,portfolio,product]=await Promise.all([listAccounts(),getChallengeSnapshot(),getProduct(productId)])
    const totalPortfolioUsd=Number(portfolio.currentPortfolioUsd||0)
    const price=Number((product as any)?.price||0)
    const baseCurrency=productId.split('-')[0]
    const balanceValue=(balance:any)=>Number(balance?.value??balance??0)||0
    const usdAccount=accounts.find((a:any)=>String(a.currency).toUpperCase()==='USD')
    const baseAccount=accounts.find((a:any)=>String(a.currency).toUpperCase()===baseCurrency)
    const availableUsd=balanceValue(usdAccount?.availableBalance)
    const availableBase=balanceValue(baseAccount?.availableBalance)
    const baseAmount=availableBase+balanceValue(baseAccount?.hold)
    const currentAssetUsd=Number.isFinite(price)?baseAmount*price:0
    const availableAssetUsd=Number.isFinite(price)?availableBase*price:0
    const preflight=evaluateLiveOrder({productId,side,notionalUsd,totalPortfolioUsd,availableUsd,currentAssetUsd,availableAssetUsd})
    publish(preflight.approved?'live_preflight_approved':'live_preflight_rejected',{preflight},'risk')
    return json(res,preflight.approved?200:422,{ok:preflight.approved,preflight})
  }
  if(path==='/api/quant/status'&&req.method==='GET')return json(res,200,await quantStatus())
  if(path==='/api/quant/vectorbt/sma'&&req.method==='POST'){const body=await readJson(req);const result=await runVectorbtSma(body);publish('vectorbt_backtest_completed',{result},'strategy');return json(res,200,{ok:true,result})}
  if(path==='/api/quant/nautilus/smoke'&&req.method==='POST'){const result=await runNautilusSmoke();publish('nautilus_engine_ready',{result},'backtest');return json(res,200,{ok:true,result})}
  if(path==='/api/quant/rdagent/health'&&req.method==='GET'){const result=await runRdAgent('health');return json(res,200,{ok:true,result})}
  if(path==='/api/quant/rdagent/run'&&req.method==='POST'){const body=await readJson(req) as {command?:string;stepN?:number;loopN?:number};const command=String(body.command||'fin_quant');if(!['fin_quant','fin_factor','health','info'].includes(command))return json(res,400,{error:'Invalid RD-Agent command.'});const stepN=Math.max(1,Math.min(5,Number(body.stepN)||1)),loopN=Math.max(1,Math.min(5,Number(body.loopN)||1));const result=await runRdAgent(command as 'fin_quant'|'fin_factor'|'health'|'info',stepN,loopN);publish('rdagent_run_completed',{command,stepN,loopN},'strategy');return json(res,200,{ok:true,result})}
  if(path==='/api/coinbase/status'&&req.method==='GET')return json(res,200,{configured:coinbaseConfigured(),portfolioUuid:config.coinbasePortfolioUuid||null})
  if(path==='/api/coinbase/diagnostics'&&req.method==='GET')return json(res,200,coinbaseCredentialShape())
  if(path==='/api/coinbase/accounts'&&req.method==='GET'){if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'});return json(res,200,{accounts:await listAccounts()})}
  if(path==='/api/coinbase/portfolio-allocation'&&req.method==='GET'){
    if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'})

    // Portfolio gets priority over scanner work and uses only two Coinbase calls:
    // one account snapshot + one USD spot-product snapshot.
    const [accounts,products]=await Promise.all([
      listAccounts(50),
      listSpotUsdProducts(500,50)
    ])

    const balanceValue=(balance:any)=>Number(balance?.value??balance??0)||0
    const cashCurrencies=new Set(['USD','USDC'])
    const priceByCurrency=new Map<string,number>()
    for(const product of products as any[]){
      const baseCurrency=String(product.baseCurrency||'').toUpperCase()
      const price=Number(product.price||0)
      if(baseCurrency&&price>0)priceByCurrency.set(baseCurrency,price)
    }

    const rows:any[]=[]
    for(const account of accounts as any[]){
      const currency=String(account.currency||'').toUpperCase()
      const available=balanceValue(account.availableBalance)
      const hold=balanceValue(account.hold)
      const units=available+hold
      if(!currency||!(units>0))continue

      if(cashCurrencies.has(currency)){
        rows.push({
          currency,
          productId:null,
          units,
          available,
          hold,
          priceUsd:1,
          valueUsd:units,
          type:'cash'
        })
        continue
      }

      const priceUsd=Number(priceByCurrency.get(currency)||0)
      rows.push({
        currency,
        productId:currency+'-USD',
        units,
        available,
        hold,
        priceUsd:priceUsd>0?priceUsd:null,
        valueUsd:priceUsd>0?units*priceUsd:null,
        type:'crypto'
      })
    }

    const totalUsd=rows.reduce((sum,row)=>sum+(Number.isFinite(Number(row.valueUsd))?Number(row.valueUsd):0),0)
    const cashUsd=rows.filter(r=>r.type==='cash').reduce((sum,r)=>sum+Number(r.valueUsd||0),0)
    const cryptoUsd=rows.filter(r=>r.type==='crypto').reduce((sum,r)=>sum+(Number.isFinite(Number(r.valueUsd))?Number(r.valueUsd):0),0)
    rows.sort((a,b)=>Number(b.valueUsd||0)-Number(a.valueUsd||0))

    return json(res,200,{
      totalUsd:Number(totalUsd.toFixed(2)),
      cashUsd:Number(cashUsd.toFixed(2)),
      cryptoUsd:Number(cryptoUsd.toFixed(2)),
      holdings:rows.map(row=>({
        ...row,
        valueUsd:Number.isFinite(Number(row.valueUsd))?Number(Number(row.valueUsd).toFixed(2)):null,
        allocationPercent:totalUsd>0&&Number.isFinite(Number(row.valueUsd))
          ?Number(((Number(row.valueUsd)/totalUsd)*100).toFixed(2))
          :0
      })),
      accountCount:accounts.length,
      updatedAt:new Date().toISOString()
    })
  }
  if(path.startsWith('/api/coinbase/product/')&&req.method==='GET'){if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'});const productId=decodeURIComponent(path.split('/').pop()||'BTC-USD').toUpperCase();return json(res,200,{product:await getProduct(productId)})}
  if(path.startsWith('/api/coinbase/candles/')&&req.method==='GET'){if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'});const productId=decodeURIComponent(path.split('/').pop()||'BTC-USD').toUpperCase();const limit=Math.max(20,Math.min(300,Number(url.searchParams.get('limit'))||60));return json(res,200,{candles:await getCandles(productId,'ONE_HOUR',limit)})}
  if(path.startsWith('/api/coinbase/order-book/')&&req.method==='GET'){if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'});const productId=decodeURIComponent(path.split('/').pop()||'BTC-USD').toUpperCase();return json(res,200,{book:await getProductBook(productId,8)})}
  if(path.startsWith('/api/coinbase/trades/')&&req.method==='GET'){if(!coinbaseConfigured())return json(res,503,{error:'Coinbase credentials are not configured.'});const productId=decodeURIComponent(path.split('/').pop()||'BTC-USD').toUpperCase();return json(res,200,{trades:await getMarketTrades(productId,12)})}
  if(path.startsWith('/api/'))return json(res,404,{error:'API route not found.'})

}
