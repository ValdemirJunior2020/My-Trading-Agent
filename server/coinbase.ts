import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { config, coinbaseConfigured } from './config.js'
import { randomUUID } from 'node:crypto'
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

export const previewMarketOrder = async (params: {
  productId: string
  side: 'BUY' | 'SELL'
  quoteSizeUsd?: number
  baseSize?: number
}) => {
  const { productId, side, quoteSizeUsd, baseSize } = params
  if (side === 'BUY' && !(quoteSizeUsd && quoteSizeUsd > 0)) throw new Error('BUY preview requires positive quoteSizeUsd')
  if (side === 'SELL' && !(baseSize && baseSize > 0)) throw new Error('SELL preview requires positive baseSize')

  const order_configuration =
    side === 'BUY'
      ? { market_market_ioc: { quote_size: String(quoteSizeUsd) } }
      : { market_market_ioc: { base_size: String(baseSize) } }

  return request('POST', '/api/v3/brokerage/orders/preview', {
    product_id: productId.toUpperCase(),
    side,
    order_configuration
  }) as Promise<{
    order_total?: string
    commission_total?: string
    errs?: string[]
    warning?: string[]
    quote_size?: string
    base_size?: string
    slippage?: string
    preview_id?: string
    est_average_filled_price?: string
  }>
}

export const createMarketOrder = async (params: {
  productId: string
  side: 'BUY' | 'SELL'
  quoteSizeUsd?: number
  baseSize?: number
  previewId?: string
}) => {
  const { productId, side, quoteSizeUsd, baseSize, previewId } = params

  if (side === 'BUY' && !(quoteSizeUsd && quoteSizeUsd > 0)) {
    throw new Error('BUY requires positive quoteSizeUsd')
  }
  if (side === 'SELL' && !(baseSize && baseSize > 0)) {
    throw new Error('SELL requires positive baseSize')
  }

  const order_configuration =
    side === 'BUY'
      ? { market_market_ioc: { quote_size: String(quoteSizeUsd) } }
      : { market_market_ioc: { base_size: String(baseSize) } }

  const body = {
    client_order_id: randomUUID(),
    product_id: productId.toUpperCase(),
    side,
    order_configuration,
    ...(previewId ? { preview_id: previewId } : {})
  }

  const result = await request('POST', '/api/v3/brokerage/orders', body) as {
    success?: boolean
    success_response?: { order_id?: string; product_id?: string; side?: string; client_order_id?: string }
    error_response?: { error?: string; message?: string; error_details?: string; new_order_failure_reason?: string }
    order_configuration?: unknown
  }

  if (result.success !== true || !result.success_response?.order_id) {
    const detail = result.error_response?.error_details || result.error_response?.message || result.error_response?.error || 'Coinbase did not confirm order creation.'
    throw new Error(detail)
  }

  return result
}


export const listSpotUsdProducts=async(limit=250)=>{
  const bounded=Math.max(20,Math.min(500,Math.floor(limit)))
  const data=await request('GET',`/api/v3/brokerage/products?limit=${bounded}&product_type=SPOT`) as {
    products?:Array<any>
  }
  return (data.products||[])
    .filter((p:any)=>{
      const productId=String(p.product_id||'').toUpperCase()
      const quote=String(p.quote_currency_id||p.quote_currency||'').toUpperCase()
      const isUsd=productId.endsWith('-USD')||quote==='USD'
      return isUsd&&
        String(p.product_type||'SPOT').toUpperCase()==='SPOT'&&
        !Boolean(p.trading_disabled)&&
        !Boolean(p.is_disabled)&&
        !Boolean(p.cancel_only)&&
        !Boolean(p.limit_only)
    })
    .map((p:any)=>({
      productId:String(p.product_id||'').toUpperCase(),
      price:Number(p.price||0),
      volume24h:Number(p.volume_24h||0),
      priceChange24hPercent:Number(p.price_percentage_change_24h||0),
      baseCurrency:String(p.base_currency_id||p.base_currency||'').toUpperCase(),
      quoteCurrency:String(p.quote_currency_id||p.quote_currency||'USD').toUpperCase()
    }))
    .filter((p:any)=>p.productId&&Number.isFinite(p.price)&&p.price>0)
}


export const getOrder=async(orderId:string)=>{
  const data=await request('GET',`/api/v3/brokerage/orders/historical/${encodeURIComponent(orderId)}`) as {order?:any}
  return data.order||null
}

export const waitForOrderFill=async(orderId:string,timeoutMs=10000)=>{
  const deadline=Date.now()+Math.max(1000,timeoutMs)
  let last:any=null
  while(Date.now()<deadline){
    last=await getOrder(orderId)
    const averageFilledPrice=Number(last?.average_filled_price||0)
    const filledSize=Number(last?.filled_size||0)
    const completion=Number(last?.completion_percentage||0)
    const settled=Boolean(last?.settled)
    if(averageFilledPrice>0&&filledSize>0&&(settled||completion>=100)){
      return {
        orderId,
        productId:String(last?.product_id||''),
        side:String(last?.side||'').toUpperCase(),
        filledPrice:averageFilledPrice,
        executedQty:filledSize,
        filledValue:Number(last?.filled_value||0),
        totalFees:Number(last?.total_fees||0),
        settled,
        status:String(last?.status||''),
        timestamp:Date.now(),
        raw:last
      }
    }
    await new Promise(resolve=>setTimeout(resolve,350))
  }
  const averageFilledPrice=Number(last?.average_filled_price||0)
  const filledSize=Number(last?.filled_size||0)
  if(averageFilledPrice>0&&filledSize>0){
    return {
      orderId,
      productId:String(last?.product_id||''),
      side:String(last?.side||'').toUpperCase(),
      filledPrice:averageFilledPrice,
      executedQty:filledSize,
      filledValue:Number(last?.filled_value||0),
      totalFees:Number(last?.total_fees||0),
      settled:Boolean(last?.settled),
      status:String(last?.status||''),
      timestamp:Date.now(),
      raw:last
    }
  }
  throw new Error('Coinbase order was accepted but an actual fill price was not available before timeout.')
}

export const listOpenOrders=async()=>{
  const data=await request('GET','/api/v3/brokerage/orders/historical/batch?order_status=OPEN&limit=250') as {orders?:Array<any>}
  return data.orders||[]
}

export const cancelOrders=async(orderIds:string[])=>{
  const ids=[...new Set(orderIds.map(String).filter(Boolean))]
  if(!ids.length)return {results:[]}
  return request('POST','/api/v3/brokerage/orders/batch_cancel',{order_ids:ids}) as Promise<any>
}
