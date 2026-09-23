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
  const endNow=Math.floor(Date.now()/1000)
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
  const requested=Math.max(20,Math.min(3000,Math.floor(limit)))
  const rows:Array<{start:number;low:number;high:number;open:number;close:number;volume:number}>=[]
  let remaining=requested
  let windowEnd=endNow

  while(remaining>0){
    const batch=Math.min(300,remaining)
    const windowStart=windowEnd-(seconds*batch)
    const path=`/api/v3/brokerage/products/${encodeURIComponent(productId)}/candles?start=${windowStart}&end=${windowEnd}&granularity=${encodeURIComponent(granularity)}&limit=${batch}`
    const data=await request('GET',path) as {candles?:Array<{start:string;low:string;high:string;open:string;close:string;volume:string}>}
    const parsed=(data.candles||[])
      .map(c=>({start:Number(c.start),low:Number(c.low),high:Number(c.high),open:Number(c.open),close:Number(c.close),volume:Number(c.volume)}))
      .filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.close)&&c.close>0)
    rows.push(...parsed)
    if(parsed.length===0) break
    remaining-=batch
    windowEnd=windowStart
  }

  const deduped=new Map<number,{start:number;low:number;high:number;open:number;close:number;volume:number}>()
  for(const row of rows) deduped.set(row.start,row)
  return [...deduped.values()].sort((a,b)=>a.start-b.start).slice(-requested)
}


export const getProductBook=async(productId:string,limit=10)=>{
  const bounded=Math.max(1,Math.min(50,Math.floor(limit)))
  const data=await request('GET',`/api/v3/brokerage/product_book?product_id=${encodeURIComponent(productId)}&limit=${bounded}`) as {
    pricebook?:{product_id?:string;bids?:Array<{price:string;size:string}>;asks?:Array<{price:string;size:string}>;time?:string}
  }
  const book=data.pricebook||{}
  return {
    productId:book.product_id||productId,
    time:book.time||null,
    bids:(book.bids||[]).slice(0,bounded).map(x=>({price:Number(x.price),size:Number(x.size)})).filter(x=>Number.isFinite(x.price)&&Number.isFinite(x.size)),
    asks:(book.asks||[]).slice(0,bounded).map(x=>({price:Number(x.price),size:Number(x.size)})).filter(x=>Number.isFinite(x.price)&&Number.isFinite(x.size))
  }
}

export const getMarketTrades=async(productId:string,limit=12)=>{
  const bounded=Math.max(1,Math.min(100,Math.floor(limit)))
  const data=await request('GET',`/api/v3/brokerage/products/${encodeURIComponent(productId)}/ticker?limit=${bounded}`) as {
    trades?:Array<{trade_id?:string;product_id?:string;price?:string;size?:string;time?:string;side?:string}>
  }
  return (data.trades||[]).slice(0,bounded).map((x,i)=>({
    id:x.trade_id||String(i),
    productId:x.product_id||productId,
    price:Number(x.price),
    size:Number(x.size),
    time:x.time||null,
    side:String(x.side||'').toUpperCase()
  })).filter(x=>Number.isFinite(x.price)&&Number.isFinite(x.size))
}
