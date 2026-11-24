export function chartData(row){
 if(!row||row.status==='INSUFFICIENT DATA'||!Array.isArray(row.bars)||!row.bars.length)return null;
 const bars=row.bars.slice(-60);
 if(bars.some(b=>![b.time,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0))return null;
 const levels=[['Support',row.metrics?.support],['Resistance',row.metrics?.resistance],['VWAP (supplied bars)',row.metrics?.vwap]].filter(([,p])=>Number.isFinite(p)&&p>0);
 let min=Math.min(...bars.map(b=>b.low),...levels.map(x=>x[1])),max=Math.max(...bars.map(b=>b.high),...levels.map(x=>x[1]));const pad=Math.max((max-min)*.08,.01);min-=pad;max+=pad;
 return {bars,levels,min,max,volumeMax:Math.max(1,...bars.map(b=>b.volume))};
}
const NS='http://www.w3.org/2000/svg';
function node(tag,attrs={},text){const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;return e}
const usd=n=>'$'+n.toFixed(2);
const clock=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(t));
export function renderChart(row,position){
 const wrap=document.createElement('div');wrap.className='lion-chart';const data=chartData(row);
 if(!data){wrap.textContent='Chart unavailable — waiting for verified Robinhood five-minute candles.';return wrap}
 const {bars,levels,volumeMax}=data;let {min,max}=data;
 if(position?.ticker===row.ticker){for(const [label,p] of [['Paper entry',position.entry],['Paper stop',position.stop],['Paper target',position.target]])if(Number.isFinite(p)&&p>0){levels.push([label,p]);min=Math.min(min,p);max=Math.max(max,p)}}
 const svg=node('svg',{viewBox:'0 0 760 340',role:'img','aria-label':row.ticker+' completed five-minute candlesticks and volume'});wrap.append(svg);const left=16,right=650,top=16,bottom=235,volBottom=310;
 const step=(right-left)/bars.length,x=i=>left+(i+.5)*step,y=p=>top+(max-p)/(max-min)*(bottom-top),w=Math.max(2,step*.62);
 for(let i=0;i<=4;i++){const p=min+(max-min)*i/4;svg.append(node('line',{x1:left,x2:right,y1:y(p),y2:y(p),stroke:'#354455'}),node('text',{x:right+6,y:y(p)+4,fill:'#a9b7ca','font-size':11},usd(p)))}
 const palette={'Support':'#54bfa4','Resistance':'#f0b65f','VWAP (supplied bars)':'#85aaff','Paper entry':'#f5f5f5','Paper stop':'#ff8585','Paper target':'#7ee787'};
 for(const [label,p] of levels){const line=node('line',{x1:left,x2:right,y1:y(p),y2:y(p),stroke:palette[label],'stroke-dasharray':'5 4'});line.append(node('title',{},label+' '+usd(p)));svg.append(line)}
 const readout=document.createElement('p');readout.className='chart-readout';readout.textContent='Hover or focus a candle for price and volume.';
 bars.forEach((b,i)=>{const color=b.close>=b.open?'#32c77b':'#f66b68',g=node('g',{tabindex:0,role:'img'}),description=clock(b.time)+' ET | Open '+usd(b.open)+' | High '+usd(b.high)+' | Low '+usd(b.low)+' | Close '+usd(b.close)+' | Volume '+b.volume.toLocaleString();g.setAttribute('aria-label',description);g.append(node('title',{},description),node('line',{x1:x(i),x2:x(i),y1:y(b.high),y2:y(b.low),stroke:color}),node('rect',{x:x(i)-w/2,y:y(Math.max(b.open,b.close)),width:w,height:Math.max(1,Math.abs(y(b.open)-y(b.close))),fill:color}),node('rect',{x:x(i)-w/2,y:volBottom-b.volume/volumeMax*57,width:w,height:b.volume/volumeMax*57,fill:color,opacity:.65}));g.addEventListener('pointerenter',()=>readout.textContent=description);g.addEventListener('focus',()=>readout.textContent=description);svg.append(g)});
 for(const i of [...new Set([0,Math.floor((bars.length-1)/2),bars.length-1])])svg.append(node('text',{x:x(i),y:329,'text-anchor':i===0?'start':i===bars.length-1?'end':'middle',fill:'#a9b7ca','font-size':11},clock(bars[i].time)));
 wrap.append(readout);const legend=document.createElement('div');legend.className='chart-legend';for(const [label,p] of levels){const item=document.createElement('span');item.textContent=label+': '+usd(p);legend.append(item)}wrap.append(legend);return wrap;
}
