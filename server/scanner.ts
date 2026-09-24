import { getCandles,getProduct,getProductBook,listSpotUsdProducts } from './coinbase.js'
import { config } from './config.js'

export const SCAN_PRODUCTS=[
  'XRP-USD','BTC-USD','ETH-USD','SOL-USD','LINK-USD','ADA-USD','DOGE-USD',
  'AVAX-USD','LTC-USD','BCH-USD','DOT-USD','UNI-USD','XLM-USD','AAVE-USD',
  'NEAR-USD','HBAR-USD','SUI-USD','SHIB-USD','PEPE-USD','ATOM-USD','ICP-USD'
]

const PRIORITY_PRODUCTS=['XRP-USD','BTC-USD','ETH-USD','SOL-USD','LINK-USD']
const EXCLUDED_BASES=new Set(['USD','USDC','USDT','DAI','PYUSD'])

const discoverScanUniverse=async()=>{
  try{
    const products=await listSpotUsdProducts(300)
    const ranked=products
      .filter((p:any)=>!EXCLUDED_BASES.has(String(p.baseCurrency||p.productId.split('-')[0]).toUpperCase()))
      .map((p:any)=>({...p,notional24h:Number(p.price||0)*Number(p.volume24h||0)}))
      .filter((p:any)=>Number.isFinite(p.notional24h)&&p.notional24h>0)
      .sort((a:any,b:any)=>b.notional24h-a.notional24h)

    const dynamic=ranked.slice(0,24).map((p:any)=>p.productId)
    return [...new Set([...PRIORITY_PRODUCTS,...config.watchlist,...dynamic])].slice(0,28)
  }catch{
    return [...new Set([...PRIORITY_PRODUCTS,...config.watchlist,...SCAN_PRODUCTS])]
  }
}

const avg=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0
const pct=(a:number,b:number)=>b===0?0:((a-b)/b)*100
const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n))

export interface ScanResult{
  productId:string
  price:number
  change1hPercent:number
  change6hPercent:number
  change24hPercent:number
  sma20:number
  sma50:number
  volatility24hPercent:number
  volumeRatio:number
  dollarVolume24h:number
  spreadBps:number|null
  breakoutDistancePercent:number
  buyScore:number
  sellScore:number
  score:number
  buyCandidate:boolean
  sellCandidate:boolean
  reasons:string[]
}

let cachedScan:any=null
let cachedAt=0
let cachedKey=''
const inFlightScans=new Map<string,Promise<any>>()

const spreadBpsFromBook=(book:any)=>{
  const bid=Number(book?.bids?.[0]?.price||0)
  const ask=Number(book?.asks?.[0]?.price||0)
  if(!(bid>0)||!(ask>0)||ask<bid)return null
  const mid=(bid+ask)/2
  return mid>0?((ask-bid)/mid)*10000:null
}

export const scanCryptoMarket=async(products?:string[])=>{
  const universe=products&&products.length?products:await discoverScanUniverse()
  const key=universe.join('|')
  if(cachedScan&&cachedKey===key&&Date.now()-cachedAt<config.scannerCacheMs) return cachedScan

  const existing=inFlightScans.get(key)
  if(existing) return existing

  const work=(async()=>{
    const preliminary:ScanResult[]=[]

  for(const productId of universe){
    try{
      const [candles,product]=await Promise.all([
        getCandles(productId,'ONE_HOUR',60),
        getProduct(productId)
      ])
      if(candles.length<50) continue

      const closes=candles.map(c=>c.close)
      const latest=candles[candles.length-1]
      const previous=candles[candles.length-2]
      const sixHoursAgo=candles[Math.max(0,candles.length-7)]
      const dayAgo=candles[Math.max(0,candles.length-25)]
      const sma20=avg(closes.slice(-20))
      const sma50=avg(closes.slice(-50))
      const returns=candles.slice(-24).map((c,i,a)=>i===0?0:pct(c.close,a[i-1].close))
      const meanReturn=avg(returns)
      const variance=avg(returns.map(x=>(x-meanReturn)**2))
      const volatility24hPercent=Math.sqrt(variance)
      const recentVolume=avg(candles.slice(-6).map(c=>c.volume))
      const baselineVolume=avg(candles.slice(-24).map(c=>c.volume))
      const volumeRatio=baselineVolume>0?recentVolume/baselineVolume:1
      const dollarVolume24h=candles.slice(-24).reduce((sum,c)=>sum+(c.volume*c.close),0)
      const change1hPercent=pct(latest.close,previous.close)
      const change6hPercent=pct(latest.close,sixHoursAgo.close)
      const change24hPercent=pct(latest.close,dayAgo.close)
      const high24h=Math.max(...candles.slice(-24).map(c=>c.high))
      const breakoutDistancePercent=high24h>0?pct(latest.close,high24h):0

      let buyScore=50
      let sellScore=50
      const reasons:string[]=[]

      // Trend quality
      if(latest.close>sma20){buyScore+=8;sellScore-=8;reasons.push('above SMA20')}
      else{buyScore-=8;sellScore+=8;reasons.push('below SMA20')}

      if(sma20>sma50){buyScore+=12;sellScore-=12;reasons.push('SMA20 above SMA50')}
      else{buyScore-=12;sellScore+=12;reasons.push('SMA20 below SMA50')}

      // Short-term percentage opportunity: 6h gets more weight than 24h.
      if(change6hPercent>0){buyScore+=Math.min(14,change6hPercent*2.2);sellScore-=Math.min(10,change6hPercent*1.5)}
      else{sellScore+=Math.min(14,Math.abs(change6hPercent)*2.2);buyScore-=Math.min(10,Math.abs(change6hPercent)*1.5)}

      if(change24hPercent>0){buyScore+=Math.min(10,change24hPercent*.9);sellScore-=Math.min(8,change24hPercent*.7)}
      else{sellScore+=Math.min(10,Math.abs(change24hPercent)*.9);buyScore-=Math.min(8,Math.abs(change24hPercent)*.7)}

      // Volume acceleration confirms that the move has participation.
      if(volumeRatio>=1.6){buyScore+=12;sellScore+=12;reasons.push('strong volume acceleration')}
      else if(volumeRatio>=1.2){buyScore+=7;sellScore+=7;reasons.push('volume acceleration')}
      else if(volumeRatio<0.65){buyScore-=8;sellScore-=8;reasons.push('weak volume')}

      // Reward useful volatility but punish chaotic/extreme conditions.
      if(volatility24hPercent>=0.45&&volatility24hPercent<=2.5){
        buyScore+=7;sellScore+=7;reasons.push('useful short-term volatility')
      }else if(volatility24hPercent>4){
        buyScore-=14;sellScore-=14;reasons.push('excessive volatility')
      }else if(volatility24hPercent<0.18){
        buyScore-=7;sellScore-=7;reasons.push('low movement')
      }

      // Breakout proximity without chasing huge extensions.
      if(breakoutDistancePercent>=-1.2&&breakoutDistancePercent<=0&&change6hPercent>0){
        buyScore+=8;reasons.push('near 24h breakout')
      }
      if(change1hPercent>4){buyScore-=8;reasons.push('1h move may be extended')}
      if(change1hPercent<-4){sellScore-=8;reasons.push('1h sell move may be extended')}

      // Dollar-volume proxy removes thin pairs from short-term rankings.
      if(dollarVolume24h>=50_000_000){buyScore+=8;sellScore+=8}
      else if(dollarVolume24h>=10_000_000){buyScore+=4;sellScore+=4}
      else if(dollarVolume24h<1_000_000){buyScore-=18;sellScore-=18;reasons.push('thin 24h dollar volume')}

      preliminary.push({
        productId,
        price:Number((product as any)?.price||latest.close),
        change1hPercent,
        change6hPercent,
        change24hPercent,
        sma20,
        sma50,
        volatility24hPercent,
        volumeRatio,
        dollarVolume24h,
        spreadBps:null,
        breakoutDistancePercent,
        buyScore:clamp(buyScore),
        sellScore:clamp(sellScore),
        score:clamp(buyScore),
        buyCandidate:false,
        sellCandidate:false,
        reasons
      })
    }catch{}
  }

  // Check live spread only for the strongest technical candidates.
  const bookTargets=[...preliminary]
    .sort((a,b)=>Math.max(b.buyScore,b.sellScore)-Math.max(a.buyScore,a.sellScore))
    .slice(0,10)

  await Promise.all(bookTargets.map(async row=>{
    try{
      const book=await getProductBook(row.productId,1)
      row.spreadBps=spreadBpsFromBook(book)
      if(row.spreadBps!=null){
        if(row.spreadBps<=8){row.buyScore+=7;row.sellScore+=7;row.reasons.push('tight spread')}
        else if(row.spreadBps<=20){row.buyScore+=3;row.sellScore+=3}
        else if(row.spreadBps>50){row.buyScore-=20;row.sellScore-=20;row.reasons.push('wide spread')}
        else if(row.spreadBps>30){row.buyScore-=10;row.sellScore-=10;row.reasons.push('elevated spread')}
      }
      row.buyScore=clamp(row.buyScore)
      row.sellScore=clamp(row.sellScore)
      row.score=row.buyScore
    }catch{}
  }))

  for(const row of preliminary){
    const liquidEnough=row.dollarVolume24h>=1_000_000&&(row.spreadBps==null||row.spreadBps<=50)
    row.buyCandidate=
      liquidEnough&&
      row.buyScore>=76&&
      row.change6hPercent>0&&
      row.change24hPercent>-3&&
      row.price>row.sma20

    row.sellCandidate=
      liquidEnough&&
      row.sellScore>=76&&
      row.change6hPercent<0&&
      row.change24hPercent<0&&
      row.price<row.sma20
  }

  preliminary.sort((a,b)=>b.buyScore-a.buyScore)
  const bestBuy=preliminary.find(x=>x.buyCandidate)||null
  const bestSell=[...preliminary].sort((a,b)=>b.sellScore-a.sellScore).find(x=>x.sellCandidate)||null

  const result={
    generatedAt:new Date().toISOString(),
    scanned:preliminary.length,
    universe,
    strategy:'SHORT_TERM_PERCENTAGE_OPPORTUNITY',
    best:bestBuy,
    bestBuy,
    bestSell,
    results:preliminary
  }

    cachedScan=result
    cachedAt=Date.now()
    cachedKey=key
    return result
  })()

  inFlightScans.set(key,work)
  try{
    return await work
  }finally{
    if(inFlightScans.get(key)===work) inFlightScans.delete(key)
  }
}
