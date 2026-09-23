import { useEffect,useMemo,useState } from 'react'
import { api } from '../lib/api'

interface Props {language:'en'|'pt'}

const money=(value:unknown)=>{
  const n=Number(value)
  return Number.isFinite(n)?'$'+n.toFixed(2):'—'
}

const statusFor=(type:string)=>{
  if(type==='live_order_placed')return 'PLACED'
  if(type==='live_order_failed')return 'FAILED'
  if(type==='live_order_rejected'||type==='live_order_preview_rejected')return 'BLOCKED'
  if(type==='live_order_preview_approved')return 'PREVIEW OK'
  if(type==='live_execution_cycle')return 'NO TRADE'
  return type
}

export function TradeJournal({language}:Props){
  const [events,setEvents]=useState<any[]>([])
  const [loading,setLoading]=useState(true)
  const [filter,setFilter]=useState<'ALL'|'PLACED'|'NO TRADE'|'BLOCKED'|'FAILED'>('ALL')
  const pt=language==='pt'

  const load=async()=>{
    try{
      const result=await api.getLiveHistory(300)
      setEvents(result.events||[])
    }finally{setLoading(false)}
  }

  useEffect(()=>{
    void load()
    const id=setInterval(()=>void load(),5000)
    return()=>clearInterval(id)
  },[])

  const rows=useMemo(()=>events.filter(event=>{
    const status=statusFor(String(event.type))
    if(filter==='NO TRADE') return event.type==='live_execution_cycle' && !event.payload?.executed
    return filter==='ALL'||status===filter
  }),[events,filter])

  const placed=events.filter(e=>e.type==='live_order_placed').length
  const blocked=events.filter(e=>e.type==='live_order_rejected'||e.type==='live_order_preview_rejected').length
  const failed=events.filter(e=>e.type==='live_order_failed').length
  const cycles=events.filter(e=>e.type==='live_execution_cycle').length

  return <main className="journal-page">
    <section className="panel journal-panel">
      <div className="journal-heading">
        <div><span className="eyebrow">REAL TRADE HISTORY</span><h1>{pt?'Histórico de Trading':'Trading History'}</h1><p>{pt?'Cada ciclo dos agentes aparece aqui, incluindo WAIT, bloqueios, tentativas e ordens reais.':'Every agent cycle appears here, including WAIT, blocks, attempts, and real orders.'}</p></div>
        <button className="journal-refresh" onClick={()=>void load()}>{pt?'Atualizar':'Refresh'}</button>
      </div>

      <div className="journal-stats">
        <div><small>{pt?'Ordens colocadas':'Orders placed'}</small><strong>{placed}</strong></div>
        <div><small>{pt?'Bloqueadas':'Blocked'}</small><strong>{blocked}</strong></div>
        <div><small>{pt?'Falhas':'Failed'}</small><strong>{failed}</strong></div>
        <div><small>{pt?'Ciclos analisados':'Agent cycles'}</small><strong>{cycles}</strong></div>
      </div>

      <div className="journal-filters">
        {(['ALL','PLACED','NO TRADE','BLOCKED','FAILED'] as const).map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x}</button>)}
      </div>

      <div className="journal-table-wrap">
        <div className="journal-table journal-header">
          <span>{pt?'Hora':'Time'}</span><span>{pt?'Status':'Status'}</span><span>{pt?'Moeda':'Coin'}</span><span>{pt?'Lado':'Side'}</span><span>{pt?'Valor':'Amount'}</span><span>Coinbase ID</span><span>{pt?'Detalhe':'Detail'}</span>
        </div>
        {loading?<div className="journal-empty">{pt?'Carregando...':'Loading...'}</div>:rows.length===0?<div className="journal-empty">{pt?'Nenhum ciclo de trading registrado ainda.':'No trading cycles recorded yet.'}</div>:rows.map(event=>{
          const p=event.payload||{}
          const status=statusFor(String(event.type))
          const detail=String(p.reason||p.error||p.preview?.warning?.join?.(', ')||(p.decision?'Final decision: '+p.decision:''))
          const orderId=String(p.orderId||p.orderResult?.success_response?.order_id||'—')
          const displayStatus=event.type==='live_execution_cycle' ? (p.executed?'PLACED':p.attempted?'ATTEMPT':'NO TRADE') : status
          return <div className="journal-table journal-row" key={event.id}>
            <span>{new Date(event.createdAt).toLocaleString()}</span>
            <span><b className={'journal-status '+displayStatus.toLowerCase().replace(' ','-')}>{displayStatus}</b></span>
            <span>{String(p.productId||'—')}</span>
            <span className={String(p.side)==='SELL'?'sell-text':String(p.side)==='BUY'?'buy-text':''}>{String(p.side||'—')}</span>
            <span>{money(p.notionalUsd)}</span>
            <span className="journal-order-id" title={orderId}>{orderId}</span>
            <span className="journal-detail" title={detail}>{detail||'—'}</span>
          </div>
        })}
      </div>
    </section>
  </main>
}
