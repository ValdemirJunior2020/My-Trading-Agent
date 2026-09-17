import { config } from './config.js'
export const getOllamaStatus=async()=>{
  try{
    const response=await fetch(`${config.ollamaBaseUrl}/api/tags`,{signal:AbortSignal.timeout(2500)})
    if(!response.ok) throw new Error()
    const data=await response.json() as {models?:Array<{name:string}>}
    return {online:true,models:(data.models||[]).map(model=>model.name)}
  }catch{return {online:false,models:[] as string[]}}
}
const roles:Record<string,string>={
  market:'Analyze market structure, trend, momentum, support, resistance, volume and volatility.',
  risk:'Act as a strict risk manager. Prefer blocking a weak trade over allowing avoidable risk.',
  strategy:'Check whether the setup matches explicit strategy rules. Do not invent missing evidence.',
  sentiment:'Assess sentiment evidence and clearly flag stale, weak, duplicated or unverified information.',
  critic:'Try to disprove the trade thesis. Search for failure modes, bad assumptions and asymmetric downside.',
  portfolio:'Check concentration, correlation, open exposure, available capital and portfolio-level risk.',
  decision:'Combine structured reports. WAIT is a successful decision when evidence is incomplete.'
}
export const runAgent=async(agentId:string,asset:string,summary:string)=>{
  const status=await getOllamaStatus()
  if(!status.online) throw new Error('Ollama is offline.')
  const model=config.ollamaModel||status.models[0]
  if(!model) throw new Error('No Ollama model is installed.')
  const system=`You are the My Trading Agent ${agentId} agent. ${roles[agentId]||'Analyze the supplied evidence carefully.'}
Protect capital first and grow it second. Every trade must earn the right to exist.
Never chase losses, never revenge trade, never increase risk to recover a loss, and never claim certainty.
You do not execute trades. Return concise JSON only with keys: status, confidence, summary, risks, decision.
decision must be one of BUY_CANDIDATE, SELL_CANDIDATE, HOLD, WAIT, REJECT.`
  const response=await fetch(`${config.ollamaBaseUrl}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    model,stream:false,format:'json',messages:[{role:'system',content:system},{role:'user',content:`Asset: ${asset}\nStructured evidence:\n${summary}`}]
  }),signal:AbortSignal.timeout(120000)})
  if(!response.ok) throw new Error(`Ollama error ${response.status}`)
  const data=await response.json() as {message?:{content?:string}}
  const raw=data.message?.content||'{}'
  try{return {model,output:JSON.parse(raw)}}catch{return {model,output:{status:'error',summary:raw,decision:'WAIT'}}}
}
