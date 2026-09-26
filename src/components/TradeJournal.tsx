import { useEffect,useMemo,useRef,useState } from 'react'
import { api } from '../lib/api'

interface Props {language:'en'|'pt'}
type JournalFilter='ALL'|'ORDER PLACED'|'REJECTED'|'WAIT'|'BLOCKED'|'FAILED'

const money=(value:unknown)=>{
  const n=Number(value)
  return Number.isFinite(n)&&n>0?'$'+n.toFixed(2):'—'
}

const normalizeConfidence=(value:unknown)=>{
  const n=Number(value)
  if(!Number.isFinite(n))return null
  return n<=1?n*100:n
}

const journalStatus=(event:any)=>{
  const type=String(event?.type||'')
  const p=event?.payload||{}
  const decision=String(p.decision||'').toUpperCase()
  const reason=String(p.reason||p.error||'').toLowerCase()

  if(type==='live_order_placed'||p.executed===true)return 'ORDER PLACED'
  if(type==='live_order_failed')return 'ORDER FAILED'
  if(type==='live_order_preview_rejected')return 'COINBASE PREVIEW FAILED'
  if(type==='live_order_rejected')return reason.includes('risk')?'BLOCKED BY RISK':'ORDER BLOCKED'
  if(type==='live_order_preview_approved')return 'PREVIEW OK'
  if(type==='capital_rotation_plan')return p.rotationReady?'ROTATION READY':'FUNDING NEEDED'
  if(type==='capital_rotation_plan_failed')return 'ROTATION CHECK FAILED'

  if(type==='live_execution_cycle'){
    if(p.attempted===false)return 'WAIT'
    if(decision==='REJECT')return 'REJECTED BY AGENTS'
    if(decision==='WAIT'||decision==='HOLD'||!decision)return 'WAIT'
    if(p.attempted===true&&!p.executed){
      if(reason.includes('preview'))return 'COINBASE PREVIEW FAILED'
      if(reason.includes('risk')||reason.includes('daily loss')||reason.includes('exposure')||reason.includes('position'))return 'BLOCKED BY RISK'
      return 'ORDER BLOCKED'
    }
    return 'NO TRADE'
  }

  return type.replace(/_/g,' ').toUpperCase()
}

const statusGroup=(status:string):JournalFilter=>{
  if(status==='ORDER PLACED')return 'ORDER PLACED'
  if(status==='REJECTED BY AGENTS')return 'REJECTED'
  if(status==='WAIT'||status==='NO TRADE')return 'WAIT'
  if(status.includes('BLOCKED')||status.includes('PREVIEW')||status==='FUNDING NEEDED'||status==='ROTATION READY'||status==='ROTATION CHECK FAILED')return 'BLOCKED'
  if(status.includes('FAILED'))return 'FAILED'
  return 'ALL'
}

const JOURNAL_CACHE_KEY='mta-live-trade-history-v1'
const JOURNAL_TYPES=new Set([
  'live_order_placed',
  'live_order_failed',
  'live_order_rejected',
  'live_order_preview_rejected',
  'live_order_preview_approved',
  'live_execution_cycle',
  'capital_rotation_plan',
  'capital_rotation_plan_failed'
])

const readCachedHistory=()=>{
  try{
    const raw=localStorage.getItem(JOURNAL_CACHE_KEY)
    const parsed=raw?JSON.parse(raw):[]
    return Array.isArray(parsed)?parsed.slice(0,300):[]
  }catch{return []}
}

const writeCachedHistory=(events:any[])=>{
  try{localStorage.setItem(JOURNAL_CACHE_KEY,JSON.stringify(events.slice(0,300)))}catch{}
}

const statusClass=(status:string)=>{
  if(status==='ORDER PLACED')return 'placed'
  if(status==='REJECTED BY AGENTS')return 'rejected'
  if(status==='WAIT'||status==='NO TRADE')return 'wait'
  if(status.includes('BLOCKED'))return 'blocked'
  if(status.includes('PREVIEW'))return 'preview-failed'
  if(status==='ROTATION READY')return 'placed'
  if(status==='FUNDING NEEDED')return 'wait'
  if(status==='ROTATION CHECK FAILED')return 'failed'
  if(status.includes('FAILED'))return 'failed'
  return 'neutral'
}

export function TradeJournal({language}:Props){
  const [events,setEvents]=useState<any[]>(()=>readCachedHistory())
  const [loading,setLoading]=useState(()=>readCachedHistory().length===0)
  const [refreshing,setRefreshing]=useState(false)
  const [refreshNotice,setRefreshNotice]=useState('')
  const [clearing,setClearing]=useState(false)
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null)
  const [loadError,setLoadError]=useState('')
  const [restoring,setRestoring]=useState(false)
  const [filter,setFilter]=useState<JournalFilter>('ALL')
  const [search,setSearch]=useState('')
  const [assetFilter,setAssetFilter]=useState('ALL')
  const [sortOrder,setSortOrder]=useState<'newest'|'oldest'>('newest')
  const [page,setPage]=useState(1)
  const pageSize=25
  const loadInFlight=useRef(false)
  const pt=language==='pt'

  const applyHistory=(nextEvents:any[])=>{
    const clean=(nextEvents||[]).slice(0,300)
    setEvents(clean)
    writeCachedHistory(clean)
    setLastUpdated(new Date())
    setLoading(false)
    setLoadError('')
  }

  const mergeLiveEvent=(row:any)=>{
    if(!row||!JOURNAL_TYPES.has(String(row.type||'')))return
    setEvents(previous=>{
      const next=[row,...previous.filter(item=>Number(item?.id)!==Number(row?.id))].slice(0,300)
      writeCachedHistory(next)
      return next
    })
    setLastUpdated(new Date())
    setLoading(false)
  }

  const load=async(manual=false)=>{
    if(loadInFlight.current)return
    loadInFlight.current=true
    if(manual){
      setRefreshing(true)
      setRefreshNotice('')
    }
    try{
      const result=await api.getLiveHistory(300)
      const nextEvents=result.events||[]
      applyHistory(nextEvents)
      if(manual){
        setRefreshNotice(pt
          ? `✓ Atualizado agora • ${nextEvents.length} registros`
          : `✓ Updated now • ${nextEvents.length} records`)
        window.setTimeout(()=>setRefreshNotice(''),2200)
      }
    }catch(e){
      const message=e instanceof Error?e.message:String(e)
      if(events.length===0)setLoadError(message)
    }finally{
      loadInFlight.current=false
      setLoading(false)
      setRefreshing(false)
    }
  }

  const restoreHistory=async()=>{
    setRestoring(true)
    setLoadError('')
    try{
      await api.restoreLiveHistory()
      await load(true)
    }catch(e){
      setLoadError(e instanceof Error?e.message:String(e))
    }finally{
      setRestoring(false)
    }
  }

  const clearHistory=async()=>{
    const ok=window.confirm(pt
      ? 'Limpar somente o histórico exibido? Isso NÃO apaga ordens ou saldos da Coinbase.'
      : 'Clear only the displayed trading history? This does NOT delete Coinbase orders or balances.')
    if(!ok)return
    setClearing(true)
    try{
      await api.clearLiveHistory()
      setEvents([])
      writeCachedHistory([])
      setLastUpdated(new Date())
    }finally{
      setClearing(false)
    }
  }

  useEffect(()=>{
    // Backup HTTP load. The live stream below is the primary source.
    void load()

    const stream=new EventSource(api.eventUrl)

    const onReady=(event:any)=>{
      try{
        const data=JSON.parse(event.data||'{}')
        if(Array.isArray(data.history))applyHistory(data.history)
      }catch{}
    }

    const onAgentEvent=(event:any)=>{
      try{
        mergeLiveEvent(JSON.parse(event.data))
      }catch{}
    }

    stream.addEventListener('ready',onReady)
    stream.addEventListener('agent',onAgentEvent)

    // Slow backup only; no more constant full-history refetches.
    const id=setInterval(()=>void load(),15000)

    return()=>{
      clearInterval(id)
      stream.removeEventListener('ready',onReady)
      stream.removeEventListener('agent',onAgentEvent)
      stream.close()
    }
  },[])

  const assets=useMemo(()=>[...new Set(events
    .map(event=>String(event?.payload?.productId||event?.payload?.buyProductId||'').toUpperCase())
    .filter(Boolean)
  )].sort(),[events])

  const rows=useMemo(()=>{
    const q=search.trim().toLowerCase()
    const filtered=events.filter(event=>{
      const status=journalStatus(event)
      if(filter!=='ALL'&&statusGroup(status)!==filter)return false
      const p=event?.payload||{}
      const coin=String(p.productId||p.buyProductId||'').toUpperCase()
      if(assetFilter!=='ALL'&&coin!==assetFilter)return false
      if(q){
        const haystack=[
          coin,
          status,
          p.side,
          p.orderId,
          p.reason,
          p.error,
          event.type
        ].map(value=>String(value||'').toLowerCase()).join(' ')
        if(!haystack.includes(q))return false
      }
      return true
    })
    return filtered.sort((a,b)=>{
      const delta=new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime()
      return sortOrder==='oldest'?delta:-delta
    })
  },[events,filter,assetFilter,search,sortOrder])

  useEffect(()=>{setPage(1)},[filter,assetFilter,search,sortOrder])

  const totalPages=Math.max(1,Math.ceil(rows.length/pageSize))
  const currentPage=Math.min(page,totalPages)
  const pagedRows=rows.slice((currentPage-1)*pageSize,currentPage*pageSize)

  const placed=events.filter(e=>journalStatus(e)==='ORDER PLACED').length
  const blocked=events.filter(e=>statusGroup(journalStatus(e))==='BLOCKED').length
  const failed=events.filter(e=>statusGroup(journalStatus(e))==='FAILED').length
  const cycles=events.filter(e=>e.type==='live_execution_cycle').length

  const filters:JournalFilter[]=['ALL','ORDER PLACED','REJECTED','WAIT','BLOCKED','FAILED']

  return <main className="journal-page">
    <section className="panel journal-panel">
      <div className="journal-heading">
        <div>
          <div className="journal-title-line">
            <span className="eyebrow">REAL-TIME EXECUTION ANALYTICS</span>
            <span className="journal-live-badge"><i/> LIVE</span>
          </div>
          <h1>{pt?'Fila de Execução':'Execution Queue'} <span className="journal-title-muted">• {pt?'Histórico em tempo real':'Real-time Analytics'}</span></h1>
          <p>{pt?'Ordens reais, decisões, bloqueios e contexto da estratégia em uma única visão.':'Real orders, decisions, blocks, and strategy context in one live view.'}</p>
        </div>
        <div className="journal-actions">
          <div className="journal-updated">
            {refreshNotice || (lastUpdated
              ? (pt?'Atualizado ':'Updated ')+lastUpdated.toLocaleTimeString()+' • '+events.length+(pt?' registros':' records')
              : '')}
          </div>
          <button
            className="journal-refresh"
            disabled={refreshing||clearing}
            onClick={()=>void load(true)}
            title={pt?'Buscar o histórico mais recente agora':'Fetch the newest trading history now'}
          >
            {refreshing
              ? (pt?'↻ Atualizando...':'↻ Refreshing...')
              : refreshNotice
                ? (pt?'✓ Atualizado':'✓ Updated')
                : (pt?'↻ Atualizar agora':'↻ Refresh now')}
          </button>
          <button className="journal-refresh" disabled={refreshing||clearing||restoring} onClick={()=>void restoreHistory()}>{restoring?(pt?'Restaurando...':'Restoring...'):(pt?'Restaurar histórico':'Restore History')}</button>
          <button className="journal-clear" disabled={refreshing||clearing||restoring} onClick={()=>void clearHistory()}>{clearing?(pt?'Limpando...':'Clearing...'):(pt?'Limpar histórico':'Clear History')}</button>
        </div>
      </div>

      <div className="journal-stats">
        <div><small>{pt?'Ordens colocadas':'Orders placed'}</small><strong>{placed}</strong></div>
        <div><small>{pt?'Bloqueadas':'Blocked'}</small><strong>{blocked}</strong></div>
        <div><small>{pt?'Falhas':'Failed'}</small><strong>{failed}</strong></div>
        <div><small>{pt?'Ciclos analisados':'Agent cycles'}</small><strong>{cycles}</strong></div>
      </div>

      <div className="journal-toolbar">
        <label className="journal-search">
          <span>⌕</span>
          <input
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder={pt?'Buscar ativo, status, ordem...':'Search asset, status, order...'}
          />
        </label>
        <select value={sortOrder} onChange={e=>setSortOrder(e.target.value as 'newest'|'oldest')}>
          <option value="newest">{pt?'Mais recentes':'Newest first'}</option>
          <option value="oldest">{pt?'Mais antigos':'Oldest first'}</option>
        </select>
        <select value={assetFilter} onChange={e=>setAssetFilter(e.target.value)}>
          <option value="ALL">{pt?'Todos os ativos':'All assets'}</option>
          {assets.map(asset=><option key={asset} value={asset}>{asset}</option>)}
        </select>
        <div className="journal-result-count">{rows.length} {pt?'resultados':'results'}</div>
      </div>

      <div className="journal-filters">
        {filters.map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}
      </div>

      {loadError?<div className="portfolio-error">{pt?'Erro ao carregar histórico: ':'History load error: '}{loadError}</div>:null}

      <div className="journal-table-wrap">
        <div className="journal-table journal-header">
          <span>{pt?'Hora':'Time'}</span><span>{pt?'Status':'Status'}</span><span>{pt?'Ativo':'Asset'}</span><span>{pt?'Lado':'Side'}</span><span>{pt?'Valor':'Amount'}</span><span>Transaction ID</span><span>{pt?'Contexto da estratégia':'Strategy Context'}</span>
        </div>
        {loading?<div className="journal-empty">{pt?'Carregando...':'Loading...'}</div>:rows.length===0?<div className="journal-empty">{pt?'Nenhum evento nesta categoria ainda.':'No events in this category yet.'}</div>:pagedRows.map(event=>{
          const p=event.payload||{}
          const status=journalStatus(event)
          const confidence=normalizeConfidence(p.confidence)
          const decision=String(p.decision||'').toUpperCase()
          const rotationDetail=event.type==='capital_rotation_plan'
            ? 'Need $'+Number(p.fundingRequiredUsd||0).toFixed(2)+
              ' • XRP sell candidate: '+(p.xrpSellCandidate?'YES':'NO')+
              ' • Suggested XRP sale: $'+Number(p.suggestedSellUsd||0).toFixed(2)+
              ' • Approval required'
            : ''
          const ds=p.deterministicStrategy||{}
          const strategyDetail=event.type==='live_execution_cycle' && p.attempted===false && ds
            ? [
                Number.isFinite(Number(ds.closeVsLowerPct))
                  ? ('Close ' + (Number(ds.closeVsLowerPct)>=0?'+':'') + Number(ds.closeVsLowerPct).toFixed(2) + '% vs lower BB')
                  : '',
                Number.isFinite(Number(ds.rsi))
                  ? ('RSI ' + Number(ds.rsi).toFixed(1) + ' / needs < ' + Number(ds.rsiThreshold||30).toFixed(0))
                  : '',
                ds.crossedBelowLower===true?'BB cross YES':'BB cross NO',
                ds.nearLowerBand===true?'Near lower BB YES':'Near lower BB NO',
                ds.oversold===true?'RSI oversold YES':'RSI oversold NO',
                ds.positionAlreadyOpen===true&&ds.rawEntrySignal===true
                  ? 'VALID BUY SETUP • existing bot lot already open'
                  : ds.positionAlreadyOpen===true
                    ? 'Existing bot lot open • monitoring for exit'
                    : String(ds.reason||'No deterministic entry trigger')
              ].filter(Boolean).join(' • ')
            : ''
          const generatedDetail=[
            decision?('Decision: '+decision):'',
            confidence!=null?('Confidence: '+confidence.toFixed(0)+'%'):'',
            p.attempted===false?'No execution attempted':''
          ].filter(Boolean).join(' • ')
          const detail=String(rotationDetail||strategyDetail||p.reason||p.error||p.preview?.warning?.join?.(', ')||generatedDetail||'—')
          const orderId=String(p.orderId||p.orderResult?.success_response?.order_id||'—')
          const displayCoin=String(p.productId||p.buyProductId||'—')
          const displaySide=event.type==='capital_rotation_plan'?'ROTATE':String(p.side||'—')
          const displayAmount=event.type==='capital_rotation_plan'?money(p.suggestedSellUsd):money(p.notionalUsd)
          return <div className="journal-table journal-row" key={event.id}>
            <span className="journal-time">
              <b>{new Date(event.createdAt).toLocaleDateString([], {month:'short',day:'2-digit'})}</b>
              <small>{new Date(event.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small>
            </span>
            <span><b className={'journal-status '+statusClass(status)}><i/>{status}</b></span>
            <span className="journal-asset"><b>{displayCoin.split('-')[0]}</b><small>{displayCoin}</small></span>
            <span><b className={'journal-side-pill '+(displaySide==='SELL'?'sell':displaySide==='BUY'?'buy':'neutral')}>{displaySide}</b></span>
            <span className="journal-amount">{displayAmount}</span>
            <span className="journal-order-id" title={orderId}>{orderId==='—'?'—':orderId.slice(0,8)+'…'+orderId.slice(-4)}</span>
            <span className="journal-detail journal-context" title={detail}>{detail}</span>
          </div>
        })}
      </div>

      <div className="journal-pagination">
        <span>{pt?'Página':'Page'} {currentPage} / {totalPages}</span>
        <div>
          <button onClick={()=>setPage(1)} disabled={currentPage===1}>«</button>
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={currentPage===1}>‹</button>
          <b>{currentPage}</b>
          <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={currentPage===totalPages}>›</button>
          <button onClick={()=>setPage(totalPages)} disabled={currentPage===totalPages}>»</button>
        </div>
      </div>
    </section>
  </main>
}
