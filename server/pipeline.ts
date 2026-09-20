import { coinbaseConfigured } from './config.js'
import { getCandles,getProduct,listAccounts } from './coinbase.js'
import { publish } from './events.js'
import { runAgent } from './ollama.js'
import { quantStatus,runNautilusSmoke,runRdAgent,runVectorbtSma } from './quant.js'
import { saveAnalysis } from './db.js'

type AgentResult={model:string;output:any}
type PipelineOptions={productId?:string;deepResearch?:boolean}

const pct=(a:number,b:number)=>b===0?0:((a-b)/b)*100
const safe=(value:unknown)=>JSON.stringify(value).slice(0,12000)

const agentStep=async(agentId:string,asset:string,evidence:unknown)=>{
  publish('agent_started',{asset},agentId)
  try{
    const result=await runAgent(agentId,asset,safe(evidence)) as AgentResult
    saveAnalysis(agentId,asset,safe(evidence),result.output,result.model)
    publish('agent_completed',{asset,output:result.output},agentId)
    return result
  }catch(error){
    const message=error instanceof Error?error.message:String(error)
    publish('agent_failed',{asset,error:message},agentId)
    throw error
  }
}

export const runFullAgentPipeline=async(options:PipelineOptions={})=>{
  const productId=(options.productId||'BTC-USD').toUpperCase()
  const deepResearch=Boolean(options.deepResearch)
  if(!coinbaseConfigured()) throw new Error('Coinbase is not configured. Add your CDP key to .env before running the real agent pipeline.')

  publish('pipeline_started',{productId,deepResearch},'manager')

  const [product,candles,accounts,engines]=await Promise.all([
    getProduct(productId),
    getCandles(productId,'ONE_HOUR',120),
    listAccounts(),
    quantStatus()
  ])

  if(candles.length<40) throw new Error('Only '+candles.length+' Coinbase candles were returned; at least 40 are required.')

  const closes=candles.map(c=>c.close)
  const latest=candles.at(-1)!
  const previous=candles.at(-2)!
  const dayAgo=candles[Math.max(0,candles.length-25)]
  const weekAgo=candles[Math.max(0,candles.length-120)]
  const highs=candles.slice(-24).map(c=>c.high)
  const lows=candles.slice(-24).map(c=>c.low)
  const avgVolume=candles.slice(-24).reduce((sum,c)=>sum+c.volume,0)/Math.min(24,candles.length)
  const marketEvidence={
    source:'Coinbase Advanced Trade',
    productId,
    latestPrice:latest.close,
    change1hPercent:pct(latest.close,previous.close),
    change24hPercent:pct(latest.close,dayAgo.close),
    changeWindowPercent:pct(latest.close,weekAgo.close),
    high24h:Math.max(...highs),
    low24h:Math.min(...lows),
    latestVolume:latest.volume,
    average24hVolume:avgVolume,
    candleCount:candles.length,
    product
  }

  const market=await agentStep('market',productId,marketEvidence)

  publish('agent_started',{asset:productId,engine:'vectorbt'},'backtest')
  let vectorbt:any={available:false}
  if(engines.vectorbt?.installed){
    try{
      vectorbt={available:true,...await runVectorbtSma({prices:closes,fast:10,slow:30,initialCash:10000})}
      publish('agent_completed',{asset:productId,engine:'vectorbt',result:vectorbt},'backtest')
    }catch(error){
      vectorbt={available:false,error:error instanceof Error?error.message:String(error)}
      publish('agent_failed',{asset:productId,engine:'vectorbt',error:vectorbt.error},'backtest')
    }
  }else{
    publish('agent_failed',{asset:productId,engine:'vectorbt',error:'VectorBT not installed.'},'backtest')
  }

  let nautilus:any={available:false}
  if(engines.nautilusTrader?.installed){
    try{
      nautilus={available:true,...await runNautilusSmoke()}
      publish('nautilus_validation_completed',{asset:productId,result:nautilus},'backtest')
    }catch(error){
      nautilus={available:false,error:error instanceof Error?error.message:String(error)}
    }
  }

  let rdAgent:any={available:Boolean(engines.rdAgent?.installed),ran:false}
  if(deepResearch&&engines.rdAgent?.installed){
    publish('agent_started',{asset:productId,engine:'rdagent'},'strategy')
    try{
      rdAgent={available:true,ran:true,...await runRdAgent('fin_factor',1,1)}
      publish('agent_completed',{asset:productId,engine:'rdagent'},'strategy')
    }catch(error){
      rdAgent={available:true,ran:false,error:error instanceof Error?error.message:String(error)}
      publish('agent_failed',{asset:productId,engine:'rdagent',error:rdAgent.error},'strategy')
    }
  }

  const strategy=await agentStep('strategy',productId,{market:market.output,vectorbt,nautilus,rdAgent})

  const sentiment=await agentStep('sentiment',productId,{
    market:market.output,
    note:'No external news feed is configured. Assess only price/volume context and explicitly flag the absence of news sentiment data.'
  })

  const usdAccount=accounts.find((a:any)=>a.currency==='USD')
  const baseCurrency=productId.split('-')[0]
  const assetAccount=accounts.find((a:any)=>a.currency===baseCurrency)
  const portfolio=await agentStep('portfolio',productId,{
    market:market.output,
    strategy:strategy.output,
    balances:{usd:usdAccount?.availableBalance||null,asset:assetAccount?.availableBalance||null},
    accountCount:accounts.length
  })

  const risk=await agentStep('risk',productId,{
    market:market.output,
    strategy:strategy.output,
    portfolio:portfolio.output,
    hardLimits:'The deterministic server risk engine remains authoritative and cannot be overridden by AI.'
  })

  const critic=await agentStep('critic',productId,{
    market:market.output,
    strategy:strategy.output,
    sentiment:sentiment.output,
    portfolio:portfolio.output,
    risk:risk.output,
    vectorbt
  })

  const decision=await agentStep('decision',productId,{
    market:market.output,
    strategy:strategy.output,
    sentiment:sentiment.output,
    portfolio:portfolio.output,
    risk:risk.output,
    critic:critic.output,
    quantitativeValidation:{vectorbt,nautilus,rdAgent},
    instruction:'Return a candidate decision only. Do not claim an order was placed.'
  })

  const result={
    productId,
    generatedAt:new Date().toISOString(),
    source:'Coinbase Advanced Trade',
    deepResearch,
    market:market.output,
    strategy:strategy.output,
    sentiment:sentiment.output,
    portfolio:portfolio.output,
    risk:risk.output,
    critic:critic.output,
    decision:decision.output,
    quantitative:{vectorbt,nautilus,rdAgent}
  }

  publish('pipeline_completed',{productId,decision:decision.output?.decision||'WAIT'},'manager')
  return result
}
