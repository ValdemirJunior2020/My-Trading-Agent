import { useEffect,useMemo,useState } from 'react'
import { activities as demoActivities } from '../data/demo'
import { api } from '../lib/api'

interface Props {t:(key:string)=>string;backendOnline:boolean}

export function BottomPanels({t,backendOnline}:Props){
 const [liveEvents,setLiveEvents]=useState<any[]>([])

 useEffect(()=>{
  if(!backendOnline)return
  api.getRecentEvents().then(r=>setLiveEvents(r.events.slice(0,30))).catch(()=>{})
  const es=new EventSource(api.eventUrl,{withCredentials:true})
  es.addEventListener('agent',(event:any)=>{
   try{
    const row=JSON.parse(event.data)
    setLiveEvents(prev=>[row,...prev].slice(0,30))
   }catch{}
  })
  return()=>es.close()
 },[backendOnline])

 const rows=(liveEvents.length?liveEvents.slice(0,6).map(event=>[
  new Date(event.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
  event.agentId||'System',
  String(event.type).replace(/_/g,' '),
  String(event.type).includes('failed')||String(event.type).includes('rejected')||String(event.type).includes('emergency')?'warn':'ok'
 ]):demoActivities) as any[]

 const latestVectorbt=useMemo(()=>liveEvents.find(event=>event.agentId==='backtest'&&event.payload?.engine==='vectorbt'&&event.payload?.result)?.payload?.result,[liveEvents])
 const latestPipeline=useMemo(()=>liveEvents.find(event=>event.type==='pipeline_completed')?.payload,[liveEvents])
 const completedAgents=useMemo(()=>new Set(liveEvents.filter(event=>event.type==='agent_completed').map(event=>event.agentId)),[liveEvents])
 const flowKeys=['data','analysis','signal','risk','backtesting','paperTrade','approval']
 const doneCount=Math.min(7,latestPipeline?7:Math.max(1,completedAgents.size))

 return <div className="bottom-panels">
  <section className="panel compact-panel">
   <header className="mini-heading"><h3>{t('activity')}</h3><span>● {backendOnline?t('liveBackend'):'DEMO'}</span></header>
   <div className="activity-list">{rows.map(([time,agent,event,status]:any,i:number)=><div className="activity-row" key={String(time)+String(agent)+i}><i className={status==='ok'?'ok':'warn'}/><time>{time}</time><strong>{agent}</strong><span>{event}</span></div>)}</div>
  </section>

  <section className="panel compact-panel">
   <header className="mini-heading"><h3>{t('decisionFlow')}</h3><span>{latestPipeline?('BTC-USD • '+latestPipeline.decision):'WAITING FOR RUN'}</span></header>
   <div className="flow">{flowKeys.map((k,i)=><div className={'flow-step '+(i<doneCount?'done':'')} key={k}><b>{i<doneCount?'✓':'○'}</b><span>{t(k)}</span></div>)}</div>
   <div className="paper-summary">
    <div><small>Pipeline</small><strong>{latestPipeline?.decision||'NOT RUN'}</strong></div>
    <div><small>Agents</small><strong>{completedAgents.size}/7</strong></div>
    <div><small>Backend</small><strong>{backendOnline?'LIVE':'OFFLINE'}</strong></div>
   </div>
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
