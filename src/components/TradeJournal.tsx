import { useEffect,useMemo,useState } from 'react'
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
  const [events,setEvents]=useState<any[]>([])
  const [loading,setLoading]=useState(true)
  const [refreshing,setRefreshing]=useState(false)
  const [clearing,setClearing]=useState(false)
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null)
  const [filter,setFilter]=useState<JournalFilter>('ALL')
  const pt=language==='pt'

  const load=async(manual=false)=>{
    if(manual)setRefreshing(true)
    try{
      const result=await api.getLiveHistory(300)
      setEvents(result.events||[])
      setLastUpdated(new Date())
    }finally{
      setLoading(false)
      setRefreshing(false)
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
      setLastUpdated(new Date())
    }finally{
      setClearing(false)
    }
  }

  useEffect(()=>{
    void load()
    const id=setInterval(()=>void load(),5000)
    return()=>clearInterval(id)
  },[])

  const rows=useMemo(()=>events.filter(event=>{
    if(filter==='ALL')return true
    return statusGroup(journalStatus(event))===filter
  }),[events,filter])

  const placed=events.filter(e=>journalStatus(e)==='ORDER PLACED').length
  const blocked=events.filter(e=>statusGroup(journalStatus(e))==='BLOCKED').length
  const failed=events.filter(e=>statusGroup(journalStatus(e))==='FAILED').length
  const cycles=events.filter(e=>e.type==='live_execution_cycle').length

  const filters:JournalFilter[]=['ALL','ORDER PLACED','REJECTED','WAIT','BLOCKED','FAILED']

  return <main className="journal-page">
    <section className="panel journal-panel">
      <div className="journal-heading">
        <div>
          <span className="eyebrow">REAL TRADE HISTORY</span>
          <h1>{pt?'Histórico de Trading':'Trading History'}</h1>
          <p>{pt?'Cada linha mostra claramente o que os agentes decidiram e se uma ordem real chegou ao Coinbase.':'Each row clearly shows what the agents decided and whether a real order reached Coinbase.'}</p>
        </div>
        <div className="journal-actions">
          <div className="journal-updated">{lastUpdated?(pt?'Atualizado ':'Updated ')+lastUpdated.toLocaleTimeString():''}</div>
          <button className="journal-refresh" disabled={refreshing||clearing} onClick={()=>void load(true)}>{refreshing?(pt?'Atualizando...':'Refreshing...'):(pt?'Atualizar':'Refresh')}</button>
          <button className="journal-clear" disabled={refreshing||clearing} onClick={()=>void clearHistory()}>{clearing?(pt?'Limpando...':'Clearing...'):(pt?'Limpar histórico':'Clear History')}</button>
        </div>
      </div>

      <div className="journal-stats">
        <div><small>{pt?'Ordens colocadas':'Orders placed'}</small><strong>{placed}</strong></div>
        <div><small>{pt?'Bloqueadas':'Blocked'}</small><strong>{blocked}</strong></div>
        <div><small>{pt?'Falhas':'Failed'}</small><strong>{failed}</strong></div>
        <div><small>{pt?'Ciclos analisados':'Agent cycles'}</small><strong>{cycles}</strong></div>
      </div>

      <div className="journal-filters">
        {filters.map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}
      </div>

      <div className="journal-table-wrap">
        <div className="journal-table journal-header">
          <span>{pt?'Hora':'Time'}</span><span>{pt?'Resultado':'Result'}</span><span>{pt?'Moeda':'Coin'}</span><span>{pt?'Lado':'Side'}</span><span>{pt?'Valor':'Amount'}</span><span>Coinbase ID</span><span>{pt?'Detalhe':'Detail'}</span>
        </div>
        {loading?<div className="journal-empty">{pt?'Carregando...':'Loading...'}</div>:rows.length===0?<div className="journal-empty">{pt?'Nenhum evento nesta categoria ainda.':'No events in this category yet.'}</div>:rows.map(event=>{
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
                ds.oversold===true?'RSI oversold YES':'RSI oversold NO',
                'No deterministic entry trigger'
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
            <span>{new Date(event.createdAt).toLocaleString()}</span>
            <span><b className={'journal-status '+statusClass(status)}>{status}</b></span>
            <span>{displayCoin}</span>
            <span className={displaySide==='SELL'?'sell-text':displaySide==='BUY'?'buy-text':''}>{displaySide}</span>
            <span>{displayAmount}</span>
            <span className="journal-order-id" title={orderId}>{orderId}</span>
            <span className="journal-detail" title={detail}>{detail}</span>
          </div>
        })}
      </div>
    </section>
  </main>
}
