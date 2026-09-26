import { useEffect,useMemo,useState } from 'react'
import { api,type PipelineStatus,type SystemStatus } from '../lib/api'
import { MarketChart } from './MarketChart'

interface Props {t:(key:string)=>string;system:SystemStatus|null}
type Candle={start:number;low:number;high:number;open:number;close:number;volume:number}
type BookLevel={price:number;size:number}
type MarketTrade={id:string;price:number;size:number;time:string|null;side:string}
type WatchRow={symbol:string;price:number|null;change:number|null}

const WATCHLIST=['BTC-USD','ETH-USD','SOL-USD','ADA-USD','DOGE-USD']
const money=(n:number,digits=2)=>Number(n).toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits})
const pctText=(n:number|null)=>n==null?'—':`${n>=0?'+':''}${n.toFixed(2)}%`
const avg=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0

const TERMINAL_CACHE_KEY='mta-terminal-last-good-v1'
const readTerminalCache=()=>{
 try{
  const raw=localStorage.getItem(TERMINAL_CACHE_KEY)
  return raw?JSON.parse(raw):null
 }catch{return null}
}

export function TradingTerminal({t,system}:Props){
 const cached=readTerminalCache()
 const [live,setLive]=useState<any|null>(cached?.live||null)
 const [candles,setCandles]=useState<Candle[]>(Array.isArray(cached?.candles)?cached.candles:[])
 const [book,setBook]=useState<{bids:BookLevel[];asks:BookLevel[]}|null>(cached?.book||null)
 const [trades,setTrades]=useState<MarketTrade[]>(Array.isArray(cached?.trades)?cached.trades:[])
 const [watch,setWatch]=useState<WatchRow[]>(Array.isArray(cached?.watch)?cached.watch:[])
 const [pipeline,setPipeline]=useState<PipelineStatus|null>(null)

 useEffect(()=>{
  if(!system?.coinbase.configured)return
  let active=true
  let watchTick=0

  const persist=(next:any)=>{
   try{localStorage.setItem(TERMINAL_CACHE_KEY,JSON.stringify(next))}catch{}
  }

  const load=async()=>{
   const snapshot:any={
    live,
    candles,
    book,
    trades,
    watch
   }

   // Load the important BTC widgets first, one at a time, so the dashboard
   // does not burst Coinbase with many simultaneous requests.
   try{
    const result=await api.getProduct('BTC-USD')
    if(active&&result?.product){snapshot.live=result.product;setLive(result.product)}
   }catch{}
   try{
    const result=await api.getCandles('BTC-USD',60)
    if(active&&Array.isArray(result?.candles)){snapshot.candles=result.candles;setCandles(result.candles)}
   }catch{}
   try{
    const result=await api.getOrderBook('BTC-USD')
    if(active&&result?.book){snapshot.book=result.book;setBook(result.book)}
   }catch{}
   try{
    const result=await api.getMarketTrades('BTC-USD')
    if(active&&Array.isArray(result?.trades)){snapshot.trades=result.trades;setTrades(result.trades)}
   }catch{}
   try{
    const result=await api.getPipelineStatus()
    if(active)setPipeline(result)
   }catch{}

   // Watchlist is lower priority. Refresh it only once per minute and
   // sequentially so it cannot starve live-trading/risk requests.
   watchTick+=1
   if(watchTick===1||watchTick%4===0){
    const nextWatch:WatchRow[]=[]
    for(const symbol of WATCHLIST){
      try{
        const result=await api.getProduct(symbol)
        const product=result?.product
        nextWatch.push({
          symbol,
          price:product?.price!=null?Number(product.price):null,
          change:product?.price_percentage_change_24h!=null?Number(product.price_percentage_change_24h):null
        })
      }catch{
        const previous=snapshot.watch?.find?.((row:WatchRow)=>row.symbol===symbol)
        if(previous)nextWatch.push(previous)
      }
    }
    if(active&&nextWatch.length){snapshot.watch=nextWatch;setWatch(nextWatch)}
   }

   if(active)persist(snapshot)
  }

  void load()
  const id=setInterval(()=>void load(),15000)
  return()=>{active=false;clearInterval(id)}
 },[system?.coinbase.configured])

 const latestCandle=candles.length?candles[candles.length-1]:null
 const currentPrice=live?.price!=null?Number(live.price):(latestCandle?.close??null)
 const price=currentPrice==null?'—':money(currentPrice,2)
 const change=live?.price_percentage_change_24h!=null?Number(live.price_percentage_change_24h):null
 const last24=candles.slice(-24)
 const high24=last24.length?Math.max(...last24.map(c=>c.high)):null
 const low24=last24.length?Math.min(...last24.map(c=>c.low)):null
 const closes=candles.map(c=>c.close)
 const ma20=closes.length>=20?avg(closes.slice(-20)):null
 const ma50=closes.length>=50?avg(closes.slice(-50)):null
 const bestAsk=book?.asks?.[0]
 const bestBid=book?.bids?.[0]
 const spread=bestAsk&&bestBid?bestAsk.price-bestBid.price:null
 const spreadPct=spread!=null&&currentPrice?spread/currentPrice*100:null

 const trend=ma20!=null&&ma50!=null?(ma20>=ma50?t('bullish'):'Bearish'):'—'
 const momentum=ma20!=null&&currentPrice!=null?(currentPrice>=ma20?t('positive'):'Negative'):'—'
 const volatility=useMemo(()=>{
  if(!last24.length||currentPrice==null)return '—'
  const range=(Math.max(...last24.map(c=>c.high))-Math.min(...last24.map(c=>c.low)))/currentPrice*100
  return range<2?'Low':range<5?t('moderate'):'High'
 },[last24,currentPrice,t])
 const liquidity=spreadPct==null?'—':spreadPct<0.03?t('high'):spreadPct<0.10?t('moderate'):'Low'
 const decision=pipeline?.decision||'WAIT'

 return <section className="panel terminal-panel"><header className="terminal-top"><div><span className="eyebrow">BTC / USD • {live?t('coinbaseLive'):t('demoData')}</span><div className="price-line"><h2>${price}</h2><span>{pctText(change)}</span></div></div><div className="terminal-stats"><span><small>24H HIGH</small>{high24==null?'—':money(high24)}</span><span><small>24H LOW</small>{low24==null?'—':money(low24)}</span><span><small>VOLUME</small>{live?.volume_24h?Number(live.volume_24h).toLocaleString(undefined,{maximumFractionDigits:2}):'—'}</span></div></header>
 <div className="timeframes"><button>1m</button><button>5m</button><button>15m</button><button className="active">1h</button><button>4h</button><button>1D</button></div><div className="chart-wrap"><MarketChart candles={candles}/><div className="chart-float"><span>MA20 {ma20==null?'—':money(ma20,0)}</span><span>MA50 {ma50==null?'—':money(ma50,0)}</span></div></div>
 <div className="terminal-grid">
  <div className="terminal-card order-card"><h3>{t('orderBook')} <small>BTC-USD • LIVE</small></h3><div className="book-cols"><span>PRICE</span><span>SIZE</span><span>TOTAL USD</span></div>
   {(book?.asks||[]).slice(0,3).reverse().map((level,i)=><div className="book-row ask" key={'a'+i}><span>{money(level.price)}</span><span>{level.size.toFixed(6)}</span><span>{money(level.price*level.size)}</span></div>)}
   <div className="mid-price">{price} {change!=null&&change>=0?'↑':'↓'}</div>
   {(book?.bids||[]).slice(0,3).map((level,i)=><div className="book-row bid" key={'b'+i}><span>{money(level.price)}</span><span>{level.size.toFixed(6)}</span><span>{money(level.price*level.size)}</span></div>)}
  </div>
  <div className="terminal-card trades-card"><h3>{t('recentTrades')} <small>LIVE</small></h3>{trades.slice(0,6).map((trade,i)=><div className={`trade-row ${trade.side==='SELL'?'sell':'buy'}`} key={trade.id||i}><span>{money(trade.price)}</span><span>{trade.size.toFixed(6)}</span><small>{trade.time?new Date(trade.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}</small></div>)}</div>
  <div className="terminal-card risk-card"><h3>{t('riskSummary')}</h3>{[[t('trend'),trend],[t('momentum'),momentum],[t('volatility'),volatility],[t('liquidity'),liquidity],['Spread',spreadPct==null?'—':spreadPct.toFixed(4)+'%']].map(([a,b])=><div className="risk-row" key={a}><span>{a}</span><strong>{b}</strong></div>)}<div className="decision-chip">{t('aiDecision')}: {decision}</div></div>
  <div className="terminal-card watch-card"><h3>{t('watchlist')} <small>COINBASE LIVE</small></h3>{watch.map(row=><div className="watch-row" key={row.symbol}><strong>{row.symbol}</strong><span>{row.price==null?'—':money(row.price,row.price<1?4:2)}</span><em className={(row.change??0)<0?'neg':''}>{pctText(row.change)}</em></div>)}</div>
 </div></section>
}
