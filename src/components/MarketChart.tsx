const candles = [
  [14,115,132,106,124],[34,108,128,98,112],[54,102,120,92,108],[74,96,112,86,101],[94,90,106,78,96],[114,84,100,72,88],[134,78,94,66,81],[154,82,99,74,91],[174,73,89,62,79],[194,66,83,58,72],[214,60,76,48,65],[234,54,70,42,58],[254,49,65,36,54],[274,55,70,46,63],[294,44,61,34,55],[314,37,54,28,42],[334,30,48,23,38],[354,35,54,27,48],[374,27,44,18,35],[394,21,40,14,29],[414,29,48,22,42],[434,23,43,15,31],[454,18,36,10,25]
]
export function MarketChart(){
 return <svg className="market-chart" viewBox="0 0 480 160" role="img" aria-label="Demo BTC USD candlestick chart">
   <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#16e7a4" stopOpacity=".2"/><stop offset="1" stopColor="#16e7a4" stopOpacity="0"/></linearGradient></defs>
   {[30,60,90,120,150].map(y=><line key={y} x1="0" y1={y} x2="480" y2={y} className="grid-line"/>)}
   <path d="M0 126 C70 105 120 112 165 89 S260 71 300 58 S370 24 475 31 L475 160 L0 160 Z" fill="url(#area)"/>
   <path d="M0 126 C70 105 120 112 165 89 S260 71 300 58 S370 24 475 31" className="trend-line"/>
   {candles.map(([x,open,high,low,close])=>{const up=close<open; const top=Math.min(open,close); const h=Math.max(4,Math.abs(close-open)); return <g key={x} className={up?'candle up':'candle down'}><line x1={x} y1={high} x2={x} y2={low}/><rect x={x-4} y={top} width="8" height={h} rx="1"/></g>})}
 </svg>
}
