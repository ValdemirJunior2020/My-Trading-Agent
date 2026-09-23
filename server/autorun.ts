import { coinbaseConfigured } from './config.js'
import { getProduct,listAccounts } from './coinbase.js'
import { getSetting,setSetting } from './db.js'
import { publish } from './events.js'
import { getOllamaStatus } from './ollama.js'
import { getPipelineStatus,runFullAgentPipeline } from './pipeline.js'

export interface AutoRunSettings {
  enabled:boolean
  intervalSeconds:number
  deepResearch:boolean
}

const boolSetting=(key:string,fallback:boolean)=>{
  const raw=getSetting(key,String(fallback)).toLowerCase()
  return ['1','true','yes','on'].includes(raw)
}

const numSetting=(key:string,fallback:number)=>{
  const value=Number(getSetting(key,String(fallback)))
  return Number.isFinite(value)?value:fallback
}

export const getAutoRunSettings=():AutoRunSettings=>({
  enabled:boolSetting('auto_agents_enabled',true),
  intervalSeconds:Math.max(15,Math.min(3600,Math.floor(numSetting('auto_agents_interval_seconds',60)))),
  deepResearch:boolSetting('auto_agents_deep_research',false)
})

export const saveAutoRunSettings=(input:Partial<AutoRunSettings>)=>{
  const current=getAutoRunSettings()
  const next:AutoRunSettings={
    enabled:input.enabled??current.enabled,
    intervalSeconds:Math.max(15,Math.min(3600,Math.floor(Number(input.intervalSeconds??current.intervalSeconds)))),
    deepResearch:input.deepResearch??current.deepResearch
  }
  setSetting('auto_agents_enabled',String(next.enabled))
  setSetting('auto_agents_interval_seconds',String(next.intervalSeconds))
  setSetting('auto_agents_deep_research',String(next.deepResearch))
  publish('auto_agents_settings_updated',next,'manager')
  return next
}

let timer:NodeJS.Timeout|null=null
let lastAttemptAt=0

const shouldRunNow=()=>{
  const state=getPipelineStatus()
  if(state.status==='running') return false
  const settings=getAutoRunSettings()
  if(!settings.enabled) return false
  const reference=state.finishedAt?new Date(state.finishedAt).getTime():lastAttemptAt
  if(!reference) return true
  return Date.now()-reference>=settings.intervalSeconds*1000
}

const balanceValue=(balance:any)=>Number(balance?.value??balance??0)||0

const pickAutoProduct=async()=>{
  const accounts=await listAccounts()
  let best:{productId:string;usdValue:number}|null=null
  for(const account of accounts){
    const currency=String(account.currency||'').toUpperCase()
    if(!currency||['USD','USDC','USDT'].includes(currency)) continue
    const amount=balanceValue(account.availableBalance)+balanceValue(account.hold)
    if(!(amount>0)) continue
    try{
      const product:any=await getProduct(currency+'-USD')
      const price=Number(product?.price||0)
      const usdValue=amount*price
      if(Number.isFinite(usdValue)&&usdValue>0&&(!best||usdValue>best.usdValue)){
        best={productId:currency+'-USD',usdValue}
      }
    }catch{}
  }
  return best?.productId||'BTC-USD'
}

const tick=async()=>{
  if(!shouldRunNow()) return
  if(!coinbaseConfigured()) return
  try{
    const ollama=await getOllamaStatus()
    if(!ollama.online||!ollama.chatModel) return
  }catch{return}

  const settings=getAutoRunSettings()
  const productId=await pickAutoProduct()
  lastAttemptAt=Date.now()
  publish('auto_agents_cycle_started',{intervalSeconds:settings.intervalSeconds,deepResearch:settings.deepResearch,productId},'manager')
  void runFullAgentPipeline({productId,deepResearch:settings.deepResearch}).catch(error=>{
    const message=error instanceof Error?error.message:String(error)
    publish('auto_agents_cycle_failed',{error:message},'manager')
  })
}

export const startAutoRun=()=>{
  if(timer) return
  void tick()
  timer=setInterval(()=>void tick(),5000)
}

export const stopAutoRun=()=>{
  if(timer){clearInterval(timer);timer=null}
}
