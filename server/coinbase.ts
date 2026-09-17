import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { config, coinbaseConfigured } from './config.js'
const apiUrl=new URL(config.coinbaseApiBaseUrl)
const host=apiUrl.host
const request=async(method:string,path:string,body?:unknown)=>{
  if(!coinbaseConfigured()) throw new Error('Coinbase credentials are not configured.')
  const token=await generateJwt({apiKeyId:config.cdpApiKeyId,apiKeySecret:config.cdpApiKeySecret.replace(/\\n/g,'\n'),requestMethod:method,requestHost:host,requestPath:path,expiresIn:120})
  const response=await fetch(`${config.coinbaseApiBaseUrl}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)})
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
