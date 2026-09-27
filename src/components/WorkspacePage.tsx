import { useEffect,useMemo,useState } from 'react'
import { api,type SystemStatus } from '../lib/api'

interface Props {page:string;language:'en'|'pt';system:SystemStatus|null}

const fmtMoney=(v:unknown,d=2)=>{
  const n=Number(v)
  return Number.isFinite(n)?'$'+n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):'—'
}
const fmtPct=(v:unknown)=>{
  const n=Number(v)
  return Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(2)+'%':'—'
}

const PageShell=({title,subtitle,children}:{title:string;subtitle:string;children:any})=>
  <main className="tool-page"><section className="panel tool-panel"><div className="tool-heading"><div><span className="eyebrow">LIVE TOOL</span><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</section></main>

export function WorkspacePage({page,language,system}:Props){
  const pt=language==='pt'
  const [product,setProduct]=useState('XRP-USD')
  const [productData,setProductData]=useState<any>(null)
  const [candles,setCandles]=useState<any[]>([])
  const [scanner,setScanner]=useState<any>(null)
  const [events,setEvents]=useState<any[]>([])
  const [pipeline,setPipeline]=useState<any>(null)
  const [paper,setPaper]=useState<any[]>([])
  const [autoRun,setAutoRun]=useState<any>(null)
  const [risk,setRisk]=useState<any>(null)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [analysis,setAnalysis]=useState<any>(null)
  const [backtest,setBacktest]=useState<any>(null)
  const [paperSide,setPaperSide]=useState<'BUY'|'SELL'>('BUY')
  const [paperSize,setPaperSize]=useState('1')
  const [paperPrice,setPaperPrice]=useState('')
  const [paperSimulation,setPaperSimulation]=useState<any|null>(null)
  const [paperSimBalance,setPaperSimBalance]=useState('1000')
  const [error,setError]=useState('')

  const loadCore=async()=>{
    setError('')
    try{
      const tasks:any[]=[
        api.getRecentEvents().then(r=>setEvents(r.events||[])).catch(()=>{}),
        api.getPipelineStatus().then(setPipeline).catch(()=>{}),
        api.getAutoRun().then(setAutoRun).catch(()=>{}),
        api.getRiskSettings().then(setRisk).catch(()=>{})
      ]
      await Promise.all(tasks)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }

  const loadMarket=async()=>{
    setBusy(true);setError('')
    try{
      const [p,c]=await Promise.all([api.getProduct(product),api.getCandles(product,120)])
      setProductData(p.product);setCandles(c.candles||[])
      if(p.product?.price)setPaperPrice(String(p.product.price))
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }

  useEffect(()=>{void loadCore()},[page])
  useEffect(()=>{if(['markets','charts','backtesting','paperTrading'].includes(page))void loadMarket()},[page,product])
  useEffect(()=>{if(page==='scanner'){setBusy(true);api.getScanner().then(setScanner).catch(e=>setError(String(e))).finally(()=>setBusy(false))}},[page])
  useEffect(()=>{if(page==='paperTrading'){api.getPaperOrders().then(r=>setPaper(r.orders||[])).catch(()=>{})}},[page])

  const chartPoints=useMemo(()=>{
    if(!candles.length)return ''
    const closes=candles.map(c=>Number(c.close)).filter(Number.isFinite)
    const min=Math.min(...closes),max=Math.max(...closes),range=max-min||1
    return closes.map((v,i)=>`${(i/(closes.length-1||1))*100},${100-((v-min)/range)*100}`).join(' ')
  },[candles])

  const runAi=async()=>{
    if(!message.trim())return
    setBusy(true);setError('')
    try{setAnalysis(await api.runAgent({agentId:'market',asset:product,summary:message.trim()}))}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }

  const runBacktest=async()=>{
    if(candles.length<40)return
    setBusy(true);setError('')
    try{
      const prices=candles.map(c=>Number(c.close)).filter(Number.isFinite)
      setBacktest(await api.vectorbtSma({prices,fast:10,slow:30,initialCash:100}))
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }

  const sendPaper=async()=>{
    setBusy(true);setError('')
    try{
      await api.paperOrder({productId:product,side:paperSide,size:Number(paperSize),price:Number(paperPrice)})
      const r=await api.getPaperOrders();setPaper(r.orders||[])
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }

  const runPaperSimulation=async()=>{
    setBusy(true);setError('');setPaperSimulation(null)
    try{
      setPaperSimulation(await api.paperSimulate({
        productId:product,
        startingBalanceUsd:Number(paperSimBalance)||1000,
        candleLimit:1000
      }))
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }

  const saveSettings=async()=>{
    setBusy(true);setError('')
    try{
      if(autoRun)await api.setAutoRun(autoRun)
      if(risk)await api.setRiskSettings(risk)
      await loadCore()
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }

  const marketSelector=<div className="tool-toolbar"><input value={product} onChange={e=>setProduct(e.target.value.toUpperCase())}/><button onClick={()=>void loadMarket()} disabled={busy}>{busy?'Loading...':'Refresh'}</button></div>

  if(page==='markets')return <PageShell title={pt?'Mercados':'Markets'} subtitle={pt?'Dados reais do produto Coinbase.':'Live Coinbase product data.'}>
    {marketSelector}{error&&<div className="tool-error">{error}</div>}
    <div className="tool-stats"><div><small>Product</small><strong>{product}</strong></div><div><small>Price</small><strong>{fmtMoney(productData?.price,Number(productData?.price)<1?4:2)}</strong></div><div><small>24h</small><strong>{fmtPct(productData?.price_percentage_change_24h)}</strong></div><div><small>Volume 24h</small><strong>{Number(productData?.volume_24h||0).toLocaleString()}</strong></div></div>
    <div className="tool-json">{productData?JSON.stringify({status:productData.status,trading_disabled:productData.trading_disabled,base_increment:productData.base_increment,quote_increment:productData.quote_increment},null,2):'Loading market...'}</div>
  </PageShell>

  if(page==='charts')return <PageShell title={pt?'Gráficos':'Charts'} subtitle={pt?'120 candles horários reais do Coinbase.':'120 real hourly Coinbase candles.'}>
    {marketSelector}{error&&<div className="tool-error">{error}</div>}
    <div className="tool-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={chartPoints}/></svg></div>
    <div className="tool-stats"><div><small>Candles</small><strong>{candles.length}</strong></div><div><small>Last</small><strong>{fmtMoney(candles[candles.length-1]?.close,4)}</strong></div><div><small>High</small><strong>{fmtMoney(Math.max(0,...candles.map(c=>Number(c.high)||0)),4)}</strong></div><div><small>Low</small><strong>{fmtMoney(candles.length?Math.min(...candles.map(c=>Number(c.low)||Infinity)):0,4)}</strong></div></div>
  </PageShell>

  if(page==='aiAnalyst')return <PageShell title={pt?'Analista IA':'AI Analyst'} subtitle={pt?'Execute o agente local Ollama em qualquer ativo.':'Run your local Ollama market agent on any asset.'}>
    <div className="tool-toolbar"><input value={product} onChange={e=>setProduct(e.target.value.toUpperCase())}/></div>
    <textarea className="tool-textarea" value={message} onChange={e=>setMessage(e.target.value)} placeholder={pt?'Digite o que deseja analisar...':'Describe what you want analyzed...'}/>
    <button className="tool-primary" disabled={busy||!message.trim()} onClick={()=>void runAi()}>{busy?'Analyzing...':'Run AI Analysis'}</button>
    {error&&<div className="tool-error">{error}</div>}{analysis&&<div className="tool-json">{JSON.stringify(analysis.output||analysis,null,2)}</div>}
  </PageShell>

  if(page==='scanner')return <PageShell title="Scanner" subtitle={pt?'Scanner real de oportunidades de curto prazo.':'Real short-term opportunity scanner.'}>
    <div className="tool-toolbar"><button onClick={()=>{setBusy(true);api.getScanner().then(setScanner).finally(()=>setBusy(false))}}>{busy?'Scanning...':'Scan Now'}</button></div>
    {error&&<div className="tool-error">{error}</div>}
    <div className="tool-table"><div className="tool-table-head"><span>Coin</span><span>Buy</span><span>Sell</span><span>6h</span><span>24h</span><span>Signal</span></div>{(scanner?.results||[]).slice(0,30).map((r:any)=><div key={r.productId}><strong>{r.productId}</strong><span>{Number(r.buyScore||0).toFixed(0)}</span><span>{Number(r.sellScore||0).toFixed(0)}</span><span>{fmtPct(r.change6hPercent)}</span><span>{fmtPct(r.change24hPercent)}</span><em>{r.buyCandidate?'BUY':r.sellCandidate?'SELL':'WAIT'}</em></div>)}</div>
  </PageShell>

  if(page==='strategies')return <PageShell title={pt?'Estratégias':'Strategies'} subtitle={pt?'Estratégias e regras que o pipeline realmente utiliza.':'Strategies and rules actually used by the pipeline.'}>
    <div className="tool-card-grid">
      <article><h3>Short-Term Opportunity Scanner</h3><p>Momentum 6h/24h, volume acceleration, volatility quality, liquidity/spread and breakout proximity.</p></article>
      <article><h3>SMA Validation</h3><p>VectorBT tests 5/20, 10/30, 20/50 and 30/100 moving-average parameter sets.</p></article>
      <article><h3>Risk Gate</h3><p>Position cap, total exposure, daily-loss guard, confidence threshold and Coinbase preview remain authoritative.</p></article>
      <article><h3>Decision Pipeline</h3><p>Market → Strategy → Sentiment → Portfolio → Risk → Critic → Final Decision.</p></article>
    </div>
    <div className="tool-json">{pipeline?JSON.stringify(pipeline,null,2):'Pipeline status unavailable.'}</div>
  </PageShell>

  if(page==='backtesting')return <PageShell title="Backtesting" subtitle={pt?'Teste VectorBT com candles reais do Coinbase.':'Run VectorBT against real Coinbase candles.'}>
    {marketSelector}<button className="tool-primary" disabled={busy||candles.length<40} onClick={()=>void runBacktest()}>{busy?'Running...':'Run SMA 10/30 Backtest'}</button>
    {error&&<div className="tool-error">{error}</div>}{backtest&&<div className="tool-json">{JSON.stringify(backtest,null,2)}</div>}
  </PageShell>

  if(page==='paperTrading')return <PageShell title={pt?'Paper Trading':'Paper Trading'} subtitle={pt?'Simule $1.000 com as regras atuais usando somente dados da Coinbase. Nenhuma ordem real é enviada.':'Simulate $1,000 with the current rules using Coinbase data only. No live order is sent.'}>
    {marketSelector}
    <div className="paper-sim-card">
      <div>
        <span className="eyebrow">{pt?'LABORATÓRIO SEGURO':'SAFE LAB'}</span>
        <h3>{pt?'Simulação Paper de $1.000':'$1,000 Paper Simulation'}</h3>
        <p>{pt?'Usa RSI + Bollinger + take profit + stop loss atuais em 1.000 candles de 5 minutos. Coinbase continua sendo a única fonte de mercado.':'Uses the current RSI + Bollinger + take-profit + stop-loss rules across 1,000 five-minute candles. Coinbase remains the only market source.'}</p>
      </div>
      <div className="paper-sim-actions">
        <label><span>{pt?'Capital simulado':'Simulated capital'}</span><input type="number" min="100" step="100" value={paperSimBalance} onChange={e=>setPaperSimBalance(e.target.value)}/></label>
        <button className="tool-primary" disabled={busy} onClick={()=>void runPaperSimulation()}>{busy?(pt?'Simulando...':'Simulating...'):(pt?'▶ Testar $1.000':'▶ Test $1,000')}</button>
      </div>
    </div>
    {paperSimulation&&<div className="paper-sim-results">
      <div className="tool-stats">
        <div><small>{pt?'Início':'Start'}</small><strong>{fmtMoney(paperSimulation.startingBalanceUsd)}</strong></div>
        <div><small>{pt?'Final':'End'}</small><strong>{fmtMoney(paperSimulation.endingBalanceUsd)}</strong></div>
        <div><small>{pt?'Lucro / Perda':'Profit / Loss'}</small><strong className={Number(paperSimulation.netProfitUsd)>=0?'sim-profit':'sim-loss'}>{Number(paperSimulation.netProfitUsd)>=0?'+':''}{fmtMoney(paperSimulation.netProfitUsd)}</strong></div>
        <div><small>{pt?'Retorno':'Return'}</small><strong>{fmtPct(paperSimulation.netProfitPercent)}</strong></div>
        <div><small>{pt?'Trades fechados':'Closed Trades'}</small><strong>{paperSimulation.closedTrades}</strong></div>
        <div><small>{pt?'Taxa de acerto':'Win Rate'}</small><strong>{Number(paperSimulation.winRatePercent||0).toFixed(1)}%</strong></div>
        <div><small>{pt?'Drawdown máximo':'Max Drawdown'}</small><strong>{Number(paperSimulation.maxDrawdownPercent||0).toFixed(2)}%</strong></div>
        <div><small>{pt?'Tamanho por compra':'Buy Size'}</small><strong>{fmtMoney(paperSimulation.orderUsd)}</strong></div>
      </div>
      <div className="tool-json">{JSON.stringify({productId:paperSimulation.productId,mode:paperSimulation.simulation,candles:paperSimulation.candles,wins:paperSimulation.wins,losses:paperSimulation.losses,openPosition:paperSimulation.openPosition,feeRatePercent:paperSimulation.feeRatePercent,rules:paperSimulation.rules},null,2)}</div>
    </div>}
    <div className="paper-manual-divider"><span>{pt?'ORDENS PAPER MANUAIS':'MANUAL PAPER ORDERS'}</span></div>
    <div className="paper-form"><select value={paperSide} onChange={e=>setPaperSide(e.target.value as 'BUY'|'SELL')}><option>BUY</option><option>SELL</option></select><input value={paperSize} onChange={e=>setPaperSize(e.target.value)} placeholder="Size"/><input value={paperPrice} onChange={e=>setPaperPrice(e.target.value)} placeholder="Price"/><button onClick={()=>void sendPaper()} disabled={busy}>Place Paper Order</button></div>
    {error&&<div className="tool-error">{error}</div>}<div className="tool-table"><div className="tool-table-head"><span>Coin</span><span>Side</span><span>Size</span><span>Price</span><span>Status</span><span>P/L</span></div>{paper.slice(0,50).map((r:any)=><div key={r.id}><strong>{r.product_id}</strong><span>{r.side}</span><span>{r.size}</span><span>{fmtMoney(r.price,4)}</span><em>{r.status}</em><span>{r.pnl==null?'—':fmtMoney(r.pnl)}</span></div>)}</div>
  </PageShell>

  if(page==='alerts')return <PageShell title={pt?'Alertas':'Alerts'} subtitle={pt?'Eventos recentes de risco, execução e falhas.':'Recent risk, execution and failure events.'}>
    <div className="tool-toolbar"><button onClick={()=>void loadCore()}>Refresh</button></div>
    <div className="alert-list">{events.filter(e=>/failed|rejected|stop|risk|order|rotation/i.test(e.type)).slice(0,50).map(e=><div key={e.id}><strong>{e.type.replace(/_/g,' ').toUpperCase()}</strong><span>{new Date(e.createdAt).toLocaleString()}</span><p>{String(e.payload?.reason||e.payload?.error||e.payload?.productId||'Event recorded')}</p></div>)}</div>
  </PageShell>

  if(page==='exchangeConnections')return <PageShell title={pt?'Conexões de Exchange':'Exchange Connections'} subtitle={pt?'Estado real das conexões externas.':'Real external connection status.'}>
    <div className="connection-grid"><div><b className={system?.coinbase.configured?'ok-dot':'bad-dot'}/><strong>Coinbase</strong><span>{system?.coinbase.configured?'Configured':'Not configured'}</span></div><div><b className={system?.server.online?'ok-dot':'bad-dot'}/><strong>Local Server</strong><span>{system?.server.online?'Connected':'Offline'}</span></div><div><b className={system?.ollama.online?'ok-dot':'bad-dot'}/><strong>Ollama</strong><span>{system?.ollama.online?'Connected':'Offline'}</span></div></div>
  </PageShell>

  if(page==='ollamaModels')return <PageShell title={pt?'Modelos Ollama':'Ollama Models'} subtitle={pt?'Modelos detectados no Ollama local.':'Models detected from your local Ollama.'}>
    <div className="tool-stats"><div><small>Status</small><strong>{system?.ollama.online?'ONLINE':'OFFLINE'}</strong></div><div><small>Chat model</small><strong>{system?.ollama.chatModel||'—'}</strong></div><div><small>Models</small><strong>{system?.ollama.models?.length||0}</strong></div></div>
    <div className="model-list">{(system?.ollama.models||[]).map(m=><div key={m}><strong>{m}</strong><span>{m===system?.ollama.chatModel?'ACTIVE CHAT MODEL':'Installed'}</span></div>)}</div>
  </PageShell>

  if(page==='settings')return <PageShell title={pt?'Configurações':'Settings'} subtitle={pt?'Controles reais de auto-run e risco.':'Real auto-run and risk controls.'}>
    <div className="settings-grid">
      <label><span>Auto agents</span><input type="checkbox" checked={Boolean(autoRun?.enabled)} onChange={e=>setAutoRun({...autoRun,enabled:e.target.checked})}/></label>
      <label><span>Interval seconds</span><input type="number" value={autoRun?.intervalSeconds??60} onChange={e=>setAutoRun({...autoRun,intervalSeconds:Number(e.target.value)})}/></label>
      <label><span>Deep research</span><input type="checkbox" checked={Boolean(autoRun?.deepResearch)} onChange={e=>setAutoRun({...autoRun,deepResearch:e.target.checked})}/></label>
      <label><span>Max position %</span><input type="number" value={risk?.maxPositionPercent??5} onChange={e=>setRisk({...risk,maxPositionPercent:Number(e.target.value)})}/></label>
      <label><span>Max exposure %</span><input type="number" value={risk?.maxTotalExposurePercent??25} onChange={e=>setRisk({...risk,maxTotalExposurePercent:Number(e.target.value)})}/></label>
      <label><span>Daily loss %</span><input type="number" value={risk?.maxDailyLossPercent??2} onChange={e=>setRisk({...risk,maxDailyLossPercent:Number(e.target.value)})}/></label>
    </div>
    <button className="tool-primary" disabled={busy} onClick={()=>void saveSettings()}>{busy?'Saving...':'Save Settings'}</button>{error&&<div className="tool-error">{error}</div>}
  </PageShell>

  return <PageShell title={page} subtitle="Page is connected."><div className="tool-json">{JSON.stringify({page},null,2)}</div></PageShell>
}
