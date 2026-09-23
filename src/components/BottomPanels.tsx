import { useEffect,useMemo,useState } from 'react'
import { api,type PipelineStatus } from '../lib/api'

interface Props {t:(key:string)=>string;backendOnline:boolean}

export function BottomPanels({t,backendOnline}:Props){
 const [liveEvents,setLiveEvents]=useState<any[]>([])
 const [pipeline,setPipeline]=useState<PipelineStatus|null>(null)

 useEffect(()=>{
  if(!backendOnline)return
  let active=true
  const refresh=()=>{
   Promise.all([api.getRecentEvents(),api.getPipelineStatus()]).then(([eventResult,status])=>{
    if(!active)return
    setLiveEvents(eventResult.events.slice(0,30))
    setPipeline(status)
   }).catch(()=>{})
  }
  refresh()
  const poll=setInterval(refresh,1500)
  const es=new EventSource(api.eventUrl,{withCredentials:true})
  es.addEventListener('agent',(event:any)=>{
   try{
    const row=JSON.parse(event.data)
    setLiveEvents(prev=>[row,...prev].slice(0,30))
   }catch{}
  })
  return()=>{active=false;clearInterval(poll);es.close()}
 },[backendOnline])

 const rows=liveEvents.slice(0,6).map(event=>[
  new Date(event.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
  event.agentId||'System',
  String(event.type).replace(/_/g,' '),
  String(event.type).includes('failed')||String(event.type).includes('rejected')||String(event.type).includes('emergency')?'warn':'ok'
 ]) as any[]

 const latestVectorbt=useMemo(()=>liveEvents.find(event=>event.agentId==='backtest'&&event.payload?.engine==='vectorbt'&&event.payload?.result)?.payload?.result,[liveEvents])
 const completedCount=pipeline?.completedAgents.length||0
 const doneCount=Math.min(7,pipeline?.status==='completed'?7:completedCount)
 const flowKeys=['data','analysis','signal','risk','backtesting','paperTrade','approval']
 const statusLabel=pipeline?.status==='running'
  ?('RUNNING • '+(pipeline.currentAgent||'manager'))
  :pipeline?.status==='completed'
   ?('COMPLETED • '+(pipeline.decision||'DONE'))
   :pipeline?.status==='failed'
    ?'FAILED'
    :'WAITING FOR RUN'

 return <div className="bottom-panels">
  <section className="panel compact-panel">
   <header className="mini-heading"><h3>{t('activity')}</h3><span>● {backendOnline?t('liveBackend'):'OFFLINE'}</span></header>
   <div className="activity-list">
    {rows.length?rows.map(([time,agent,event,status]:any,i:number)=><div className="activity-row" key={String(time)+String(agent)+i}><i className={status==='ok'?'ok':'warn'}/><time>{time}</time><strong>{agent}</strong><span>{event}</span></div>):<div className="activity-row"><i/><time>--:--</time><strong>System</strong><span>No live events yet</span></div>}
   </div>
  </section>

  <section className="panel compact-panel">
   <header className="mini-heading"><h3>{t('decisionFlow')}</h3><span>{statusLabel}</span></header>
   <div className="flow">{flowKeys.map((k,i)=><div className={'flow-step '+(i<doneCount?'done':'')} key={k}><b>{i<doneCount?'✓':'○'}</b><span>{t(k)}</span></div>)}</div>
   <div className="paper-summary">
    <div><small>Pipeline</small><strong>{pipeline?.status==='completed'?(pipeline.decision||'DONE'):pipeline?.status?.toUpperCase()||'IDLE'}</strong></div>
    <div><small>Agents</small><strong>{completedCount}/7</strong></div>
    <div><small>Current</small><strong>{pipeline?.currentAgent||'—'}</strong></div>
   </div>
   {pipeline?.status==='failed'&&<div className="decision-chip">ERROR: {pipeline.error||'Unknown pipeline error'}</div>}
  </section>

  <section className="panel compact-panel">
   <header className="mini-heading"><h3>{t('backtestResults')}</h3><span>{latestVectorbt?'VECTORBT LIVE':'NO RUN YET'}</span></header>
   <div className="backtest-table">
    <div><strong>SMA 10/30</strong><span>Return</span><em>{latestVectorbt?Number(latestVectorbt.totalReturnPercent||0).toFixed(2)+'%':'—'}</em></div>
    <div><strong>Win Rate</strong><span>Trades {latestVectorbt?.totalTrades??'—'}</span><em>{latestVectorbt?Number(latestVectorbt.winRatePercent||0).toFixed(2)+'%':'—'}</em></div>
    <div><strong>Max Drawdown</strong><span>Sharpe {latestVectorbt?Number(latestVectorbt.sharpeRatio||0).toFixed(2):'—'}</span><em>{latestVectorbt?Number(latestVectorbt.maxDrawdownPercent||0).toFixed(2)+'%':'—'}</em></div>
   </div>
  </section>
 </div>
}
