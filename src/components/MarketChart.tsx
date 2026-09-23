interface Candle {open:number;high:number;low:number;close:number}
interface Props {candles:Candle[]}

export function MarketChart({candles}:Props){
 const data=candles.slice(-24)
 if(data.length<2)return <div className="chart-empty">Waiting for live Coinbase candles…</div>
 const width=480,height=160,pad=10
 const high=Math.max(...data.map(c=>c.high))
 const low=Math.min(...data.map(c=>c.low))
 const range=Math.max(1e-9,high-low)
 const y=(v:number)=>pad+(high-v)/range*(height-pad*2)
 const step=(width-pad*2)/Math.max(1,data.length-1)
 return <svg className="market-chart" viewBox="0 0 480 160" role="img" aria-label="Live BTC USD candlestick chart from Coinbase">
   {[30,60,90,120,150].map(v=><line key={v} x1="0" y1={v} x2="480" y2={v} className="grid-line"/>)}
   {data.map((c,i)=>{
     const x=pad+i*step
     const open=y(c.open),close=y(c.close),hi=y(c.high),lo=y(c.low)
     const up=c.close>=c.open
     const top=Math.min(open,close)
     const body=Math.max(2,Math.abs(close-open))
     return <g key={i} className={up?'candle up':'candle down'}>
       <line x1={x} y1={hi} x2={x} y2={lo}/>
       <rect x={x-4} y={top} width="8" height={body} rx="1"/>
     </g>
   })}
 </svg>
}
