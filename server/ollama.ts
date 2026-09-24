import { config } from './config.js'

type OllamaStatus={online:boolean;models:string[];chatModel?:string}

const fetchModels=async():Promise<string[]>=>{
  const response=await fetch(`${config.ollamaBaseUrl}/api/tags`,{signal:AbortSignal.timeout(2500)})
  if(!response.ok) throw new Error(`Ollama tags error ${response.status}`)
  const data=await response.json() as {models?:Array<{name:string}>}
  return (data.models||[]).map(model=>model.name)
}

const isLikelyEmbeddingModel=(name:string)=>/embed|embedding|nomic-embed|bge-|e5-|snowflake-arctic-embed/i.test(name)

const canChat=async(model:string)=>{
  try{
    const response=await fetch(`${config.ollamaBaseUrl}/api/show`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model}),
      signal:AbortSignal.timeout(5000)
    })
    if(!response.ok) return false
    const data=await response.json() as {capabilities?:string[]}
    const caps=data.capabilities||[]
    return caps.length===0?!isLikelyEmbeddingModel(model):caps.includes('completion')
  }catch{return false}
}

const resolveChatModel=async(models:string[])=>{
  if(config.ollamaModel){
    if(await canChat(config.ollamaModel)) return config.ollamaModel
    throw new Error(`OLLAMA_MODEL "${config.ollamaModel}" is not chat-capable. Choose a completion/chat model.`)
  }

  const preferred=models.filter(name=>!isLikelyEmbeddingModel(name))
  for(const model of preferred){
    if(await canChat(model)) return model
  }
  return undefined
}

export const getOllamaStatus=async():Promise<OllamaStatus>=>{
  try{
    const models=await fetchModels()
    const chatModel=await resolveChatModel(models).catch(()=>undefined)
    return {online:true,models,chatModel}
  }catch{return {online:false,models:[]}}
}

const getRequiredChatModel=async()=>{
  const models=await fetchModels()
  const model=await resolveChatModel(models)
  if(!model){
    throw new Error('Ollama is running, but no chat-capable model is installed. Install a model such as qwen3:8b and restart the app.')
  }
  return model
}

const ollamaError=async(response:Response)=>{
  let detail=''
  try{
    const data=await response.json() as {error?:string}
    detail=data.error||''
  }catch{}
  return detail?`Ollama error ${response.status}: ${detail}`:`Ollama error ${response.status}`
}

const roles:Record<string,string>={
  market:'Analyze market structure, trend, momentum, support, resistance, volume and volatility.',
  risk:'Act as a strict risk manager. Return REJECT only for a concrete hard blocker such as invalid exposure, unavailable capital, disabled trading, excessive deterministic risk, or another explicit safety violation. If risk is acceptable but evidence is uncertain, use WAIT rather than REJECT.',
  strategy:'Check whether the setup matches explicit strategy rules. Do not invent missing evidence.',
  sentiment:'Assess sentiment evidence and clearly flag stale, weak, duplicated or unverified information.',
  critic:'Try to disprove the trade thesis. Return REJECT only when you find a decisive invalidation that directly contradicts the setup. If concerns are meaningful but not decisive, use WAIT and explain them.',
  portfolio:'Check concentration, correlation, open exposure, available capital and portfolio-level risk.',
  decision:'Combine the structured reports into one evidence-based candidate classification. Do not favor action or inaction by default.'
}

export const runAgent=async(agentId:string,asset:string,summary:string)=>{
  const model=await getRequiredChatModel()
  const decisionRubric=agentId==='decision' ? `
Decision rubric:
- BUY_CANDIDATE: use only when the combined evidence supports a long setup NOW: market/trend evidence is favorable, strategy evidence is supportive rather than contradictory, risk does not identify a hard blocker, and the critic has not found a decisive invalidation.
- SELL_CANDIDATE: use only when the combined evidence supports reducing/exiting an actually held asset NOW: downside evidence is strong, the portfolio can actually hold the asset, risk does not identify a hard blocker to selling, and the critic has not found a decisive reason to avoid acting.
- WAIT: use when evidence is mixed, timing is unclear, confirmation is still missing, or the setup is neither clearly favorable nor clearly invalid.
- REJECT: use when there is a concrete invalidation or contradiction that makes the setup unsuitable, not merely because evidence is imperfect.
- HOLD: use only when the evidence specifically supports maintaining an existing held position without buying or selling.
Do not use confidence as probability of profit. Confidence means confidence in the classification you selected.
Do not return REJECT just because news sentiment is unavailable. Missing news data alone should be recorded as a limitation and may justify WAIT when it materially affects the decision.
Do not return WAIT merely because trading involves uncertainty; all trading is uncertain.
A candidate classification does not place an order. Deterministic server risk checks remain authoritative after this step.
` : ''

  const system=`You are the My Trading Agent ${agentId} agent. ${roles[agentId]||'Analyze the supplied evidence carefully.'}
Protect capital first and grow it second. Every trade must earn the right to exist.
Never chase losses, never revenge trade, never increase risk to recover a loss, and never claim certainty.
${decisionRubric}
You do not execute trades. Return concise JSON only with keys: status, confidence, summary, risks, decision.
confidence must be a number from 0 to 1.
decision must be one of BUY_CANDIDATE, SELL_CANDIDATE, HOLD, WAIT, REJECT.`

  const response=await fetch(`${config.ollamaBaseUrl}/api/chat`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      stream:false,
      format:'json',
      messages:[
        {role:'system',content:system},
        {role:'user',content:`Asset: ${asset}\nStructured evidence:\n${summary}`}
      ]
    }),
    signal:AbortSignal.timeout(120000)
  })
  if(!response.ok) throw new Error(await ollamaError(response))
  const data=await response.json() as {message?:{content?:string}}
  const raw=data.message?.content||'{}'
  try{return {model,output:JSON.parse(raw)}}catch{return {model,output:{status:'error',summary:raw,decision:'WAIT'}}}
}

export const runToolCopilot=async(message:string,context:unknown,language:'en'|'pt'='en')=>{
  const model=await getRequiredChatModel()

  const system=language==='pt'
    ? `Você é o Tool Copilot do My Trading Agent. Responda em português do Brasil.
Explique de forma clara o que está acontecendo dentro da ferramenta usando apenas o contexto estruturado recebido.
Você pode diagnosticar status, falhas, agentes parados, conexão Coinbase, Ollama, engines quant, eventos recentes e sugerir melhorias concretas.
Não invente dados. Se algo não estiver no contexto, diga que não pode confirmar.
Interprete os estados com cuidado: WAIT e REJECT são resultados seguros válidos de trading, não falhas de configuração. Um preflight de paper com eligible=false é esperado quando a decisão candidata não é BUY_CANDIDATE nem SELL_CANDIDATE. Aprovação manual e execução live desativada são estados de segurança, não erros. Só diga que algo está quebrado quando houver erro/falha real no contexto ou dependência obrigatória ausente. Nunca recomende aumentar capital, afrouxar limites de risco ou desativar controles de segurança apenas para facilitar uma meta do desafio; trate a meta como opcional e sempre subordinada aos controles de risco. Diferencie trades simulados dentro do backtest de ordens paper/live. NO_AUTOMATIC_ORDER não prova que o backtest terminou sem trade simulado aberto. Para Sharpe no VectorBT, não diga que um valor 0 é realmente zero a menos que sharpeComputable seja true; se for false, explique que a métrica estava indisponível/não finita.
Você pode executar somente as ações seguras e allowlisted que aparecerem no contexto em actionResult: atualizar o desafio, atualizar limites de risco permitidos, iniciar os agentes e ligar/desligar o Emergency Stop quando o usuário pediu explicitamente. Explique claramente qualquer ação executada.
Você nunca coloca ordens reais, nunca transfere dinheiro, nunca altera chaves/API secrets, nunca edita .env e nunca ignora limites rígidos de risco.
Não revele segredos, chaves, tokens ou conteúdo de .env.`
    : `You are the My Trading Agent Tool Copilot.
Explain clearly what is happening inside the tool using only the structured context provided.
You can diagnose status, failures, idle agents, Coinbase connectivity, Ollama, quant engines, recent events, and suggest concrete improvements.
Do not invent data. If something is not present in context, say you cannot confirm it.
Interpret states carefully: WAIT and REJECT are valid safe trading outcomes, not setup failures. A paper preflight with eligible=false is expected when the candidate decision is not BUY_CANDIDATE or SELL_CANDIDATE. Manual approval and disabled live execution are safety states, not errors. Only call something broken when the context contains a real error/failure event or missing required dependency. Never recommend increasing capital, loosening risk limits, or disabling safety controls merely to make a challenge target easier to reach; treat challenge targets as optional goals that must yield to risk controls. Distinguish simulated trades inside a backtest from paper/live execution orders. NO_AUTOMATIC_ORDER does not prove a backtest had no open simulated trade. For VectorBT Sharpe, do not claim a reported 0 is truly zero unless sharpeComputable is true; if sharpeComputable is false, explain that the metric was unavailable/non-finite.
You may perform only the safe allowlisted actions shown in context as actionResult: update the challenge, update permitted risk limits, start the agents, and activate/clear Emergency Stop when explicitly requested. Clearly explain any action that was executed.
You never place real orders, transfer money, change API keys/secrets, edit .env, or bypass hard risk controls.
Never reveal secrets, keys, tokens, or .env contents.`

  const response=await fetch(`${config.ollamaBaseUrl}/api/chat`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      stream:false,
      messages:[
        {role:'system',content:system},
        {role:'user',content:`Tool context:\n${JSON.stringify(context)}\n\nUser question:\n${message}`}
      ]
    }),
    signal:AbortSignal.timeout(120000)
  })
  if(!response.ok) throw new Error(await ollamaError(response))
  const data=await response.json() as {message?:{content?:string}}
  return {model,answer:data.message?.content?.trim()||'No response.'}
}


export type CopilotActionPlan=
  | {action:'NONE';reason?:string}
  | {action:'SET_CHALLENGE';startingBalanceUsd?:number;targetBalanceUsd?:number;durationDays?:number}
  | {action:'RUN_AGENTS';deepResearch?:boolean}
  | {action:'EMERGENCY_STOP';active:boolean}
  | {action:'SET_RISK_LIMITS';maxPositionPercent?:number;maxTotalExposurePercent?:number;maxDailyLossPercent?:number}
  | {action:'SET_AUTO_RUN';enabled?:boolean;intervalSeconds?:number;deepResearch?:boolean}

export const runToolCopilotPlanner=async(message:string,context:unknown,language:'en'|'pt'='en'):Promise<CopilotActionPlan>=>{
  const model=await getRequiredChatModel()
  const system=`You are the command planner for My Trading Agent.
Convert the user's request into AT MOST ONE allowed backend action.
Allowed actions:
- NONE
- SET_CHALLENGE with optional startingBalanceUsd, targetBalanceUsd, durationDays
- RUN_AGENTS with optional deepResearch boolean
- EMERGENCY_STOP with active boolean
- SET_RISK_LIMITS with optional maxPositionPercent, maxTotalExposurePercent, maxDailyLossPercent
- SET_AUTO_RUN with optional enabled boolean, intervalSeconds, deepResearch boolean

Rules:
- Never create orders, buy, sell, transfer money, withdraw, deposit, edit API keys, reveal secrets, or alter .env.
- Never bypass hard risk controls.
- Only choose an action when the user clearly asks the tool to change/do something.
- Questions, explanations, status requests, and vague suggestions must use NONE.
- For challenge requests, parse the explicit numbers from the user's message.
- For auto-run requests, parse time units carefully. Examples: every minute = 60 seconds, every 2 minutes = 120 seconds, pause/stop auto agents = enabled false, resume/enable = enabled true.
- Return JSON only, no markdown.`

  const response=await fetch(`${config.ollamaBaseUrl}/api/chat`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      stream:false,
      format:'json',
      messages:[
        {role:'system',content:system},
        {role:'user',content:`Language: ${language}\nContext: ${JSON.stringify(context)}\nUser request: ${message}`}
      ]
    }),
    signal:AbortSignal.timeout(120000)
  })
  if(!response.ok) throw new Error(await ollamaError(response))
  const data=await response.json() as {message?:{content?:string}}
  const raw=data.message?.content||'{}'
  try{
    const parsed=JSON.parse(raw) as CopilotActionPlan
    if(!parsed||typeof parsed!=='object'||!('action' in parsed)) return {action:'NONE'}
    if(!['NONE','SET_CHALLENGE','RUN_AGENTS','EMERGENCY_STOP','SET_RISK_LIMITS','SET_AUTO_RUN'].includes(String(parsed.action))) return {action:'NONE'}
    return parsed
  }catch{return {action:'NONE'}}
}
