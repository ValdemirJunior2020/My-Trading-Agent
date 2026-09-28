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
  const [autoRun,setAutoRun]=useState<any>(null)
  const [risk,setRisk]=useState<any>(null)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [analysis,setAnalysis]=useState<any>(null)
  const [backtest,setBacktest]=useState<any>(null)
  const [stressTest,setStressTest]=useState<any|null>(null)
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
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }

  useEffect(()=>{void loadCore()},[page])
  useEffect(()=>{if(['markets','charts','backtesting'].includes(page))void loadMarket()},[page,product])
  useEffect(()=>{if(page==='backtesting'){api.getLiveStressTest().then(r=>setStressTest(r.result||null)).catch(()=>{})}},[page])
  useEffect(()=>{if(page==='scanner'){setBusy(true);api.getScanner().then(setScanner).catch(e=>setError(String(e))).finally(()=>setBusy(false))}},[page])

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

  const runStressTest=async()=>{
    setBusy(true);setError('')
    try{
      const response=await api.runLiveStressTest({candleLimit:1200})
      setStressTest(response.result)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
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

  if(page==='scanner')return <PageShell title="Scanner" subtitle={pt?'Compras podem vir do mercado; vendas são avaliadas somente nas moedas que você realmente possui na Coinbase.':'Buys may come from the market; sells are evaluated only for coins you actually hold on Coinbase.'}>
    <div className="tool-toolbar"><button onClick={()=>{setBusy(true);api.getScanner().then(setScanner).finally(()=>setBusy(false))}}>{busy?'Scanning...':'Scan Now'}</button></div>
    {error&&<div className="tool-error">{error}</div>}
    <div className="tool-table"><div className="tool-table-head"><span>Coin</span><span>Buy</span><span>Sell (Owned)</span><span>6h</span><span>24h</span><span>Signal</span></div>{(scanner?.results||[]).slice(0,30).map((r:any)=><div key={r.productId}><strong>{r.productId}</strong><span>{Number(r.buyScore||0).toFixed(0)}</span><span>{Number(r.sellScore||0).toFixed(0)}</span><span>{fmtPct(r.change6hPercent)}</span><span>{fmtPct(r.change24hPercent)}</span><em>{r.buyCandidate?'BUY':r.sellCandidate?'SELL':'WAIT'}</em></div>)}</div>
  </PageShell>

  if(page==='strategies')return <PageShell title={pt?'Estratégias':'Strategies'} subtitle={pt?'Estratégias e regras que o pipeline realmente utiliza.':'Strategies and rules actually used by the pipeline.'}>
    <div className="tool-card-grid">
      <article><h3>Production Rule Set</h3><p>Target ~10% of portfolio per good setup, rounded down to $5 steps • multiple different coins allowed within cash/exposure limits • no same-coin stacking • fee-aware exit once net proceeds exceed full cost by at least $0.10 • 0.80% fill-based hard stop • first realized loss = pause new BUYs; existing positions keep normal exits • 3%/24h account kill switch.</p></article>
      <article><h3>Dual-Timeframe Entry</h3><p>Closed 5m macro close &gt; Bollinger middle/SMA20 • same closed 5m entry close &lt; lower Bollinger • RSI14 &lt;30 • volume ≥1.5× VMA20.</p></article>
      <article><h3>Deterministic Execution</h3><p>0.10% max entry slippage. AI may scan and ingest data, but it cannot approve, reject, or modify live entry/exit math.</p></article>
      <article><h3>Rolling Kill Switch</h3><p>3% rolling 24h equity drawdown cancels open orders, liquidates bot-managed positions, blocks trading, and requires manual reset.</p></article>
    </div>
    <div className="tool-json">{pipeline?JSON.stringify(pipeline,null,2):'Pipeline status unavailable.'}</div>
  </PageShell>

  if(page==='backtesting')return <PageShell title={pt?'Teste de Estresse Real':'Live Strategy Stress Test'} subtitle={pt?'Mais de 100 cenários históricos usando candles reais da Coinbase e as mesmas regras RSI/Bollinger, lucro, stop e Loss Guard. Nenhuma ordem é enviada.':'100+ historical scenarios using Coinbase candles and the same RSI/Bollinger, profit, stop and Loss Guard rules. No order is submitted.'}>
    <div className="stress-test-card">
      <div><span className="eyebrow">{pt?'AUDITORIA AUTOMÁTICA':'AUTOMATIC AUDIT'}</span><h3>{pt?'100+ cenários antes de confiar no modo real':'100+ scenarios before trusting live mode'}</h3><p>{pt?'O servidor roda esta auditoria sozinho ao iniciar. Você também pode rodar novamente aqui.':'The server runs this audit automatically after startup. You can also rerun it here.'}</p></div>
      <button className="tool-primary" disabled={busy} onClick={()=>void runStressTest()}>{busy?(pt?'Testando...':'Testing...'):(pt?'▶ Rodar 100+ testes':'▶ Run 100+ tests')}</button>
    </div>
    {stressTest&&<div className="stress-results">
      <div className="tool-stats">
        <div><small>{pt?'Cenários':'Scenarios'}</small><strong>{stressTest.scenarioCount}</strong></div>
        <div><small>{pt?'Trades fechados':'Closed Trades'}</small><strong>{stressTest.closedTrades}</strong></div>
        <div><small>{pt?'Vitórias':'Wins'}</small><strong className="sim-profit">{stressTest.wins}</strong></div>
        <div><small>{pt?'Perdas':'Losses'}</small><strong className={Number(stressTest.losses)>0?'sim-loss':'sim-profit'}>{stressTest.losses}</strong></div>
        <div><small>{pt?'Taxa de acerto':'Win Rate'}</small><strong>{Number(stressTest.winRatePercent||0).toFixed(1)}%</strong></div>
        <div><small>{pt?'Loss Guard acionaria':'Loss Guard Stops'}</small><strong>{stressTest.lossGuardStops}</strong></div>
      </div>
      {Array.isArray(stressTest.lossPatterns)&&stressTest.lossPatterns.length>0&&<div className="stress-patterns"><h3>{pt?'Padrões das perdas encontradas':'Loss patterns found'}</h3>{stressTest.lossPatterns.map((p:any)=><div key={p.id}><strong>{p.label}</strong><span>{p.losses} {pt?'perdas':'losses'}</span></div>)}</div>}
      <div className="tool-json">{JSON.stringify({generatedAt:stressTest.generatedAt,products:stressTest.products?.map((p:any)=>({productId:p.productId,scenarios:p.scenarios,wins:p.wins,losses:p.losses,winRatePercent:p.winRatePercent})),rules:stressTest.rules,caution:stressTest.caution},null,2)}</div>
    </div>}
    <div className="stress-divider"><span>{pt?'TESTE QUANT ADICIONAL':'ADDITIONAL QUANT TEST'}</span></div>
    {marketSelector}<button className="tool-primary" disabled={busy||candles.length<40} onClick={()=>void runBacktest()}>{busy?'Running...':'Run SMA 10/30 Backtest'}</button>
    {error&&<div className="tool-error">{error}</div>}{backtest&&<div className="tool-json">{JSON.stringify(backtest,null,2)}</div>}
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
