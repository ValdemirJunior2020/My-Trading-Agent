import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { config, coinbaseConfigured } from './config.js'
const apiUrl=new URL(config.coinbaseApiBaseUrl)
const host=apiUrl.host
const request=async(method:string,path:string,body?:unknown)=>{
  if(!coinbaseConfigured()) throw new Error('Coinbase credentials are not configured.')
  const requestUrl=new URL(`${config.coinbaseApiBaseUrl}${path}`)
  const signingPath=requestUrl.pathname
  const token=await generateJwt({apiKeyId:config.cdpApiKeyId,apiKeySecret:config.cdpApiKeySecret.replace(/\\n/g,'\n'),requestMethod:method,requestHost:host,requestPath:signingPath,expiresIn:120})
  const response=await fetch(requestUrl,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
  const text=await response.text()
  let data:unknown
  try{data=JSON.parse(text)}catch{data={message:text}}
  if(!response.ok) throw new Error(`Coinbase ${response.status}: ${text.slice(0,240)}`)
  return data
}
export const listAccounts=async()=>{
  const data=await request('GET','/api/v3/brokerage/accounts') as {accounts?:Array<any>}
  return (data.accounts||[]).map(account=>({uuid:account.uuid,name:account.name,currency:account.currency,availableBalance:account.available_balance,hold:account.hold,default:account.default,active:account.active}))
}
export const getProduct=async(productId:string)=>request('GET',`/api/v3/brokerage/products/${encodeURIComponent(productId)}`)


export const getCandles=async(productId:string,granularity='ONE_HOUR',limit=120)=>{
  const end=Math.floor(Date.now()/1000)
  const secondsByGranularity:Record<string,number>={
    ONE_MINUTE:60,
    FIVE_MINUTE:300,
    FIFTEEN_MINUTE:900,
    THIRTY_MINUTE:1800,
    ONE_HOUR:3600,
    TWO_HOUR:7200,
    SIX_HOUR:21600,
    ONE_DAY:86400
  }
  const seconds=secondsByGranularity[granularity]||3600
  const bounded=Math.max(20,Math.min(300,Math.floor(limit)))
  const start=end-(seconds*bounded)
  const path=`/api/v3/brokerage/products/${encodeURIComponent(productId)}/candles?start=${start}&end=${end}&granularity=${encodeURIComponent(granularity)}&limit=${bounded}`
  const data=await request('GET',path) as {candles?:Array<{start:string;low:string;high:string;open:string;close:string;volume:string}>}
  return (data.candles||[])
    .map(c=>({start:Number(c.start),low:Number(c.low),high:Number(c.high),open:Number(c.open),close:Number(c.close),volume:Number(c.volume)}))
    .filter(c=>Number.isFinite(c.close)&&c.close>0)
    .sort((a,b)=>a.start-b.start)
}
