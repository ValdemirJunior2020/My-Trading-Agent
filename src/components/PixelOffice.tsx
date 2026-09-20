import { useEffect,useMemo,useState } from 'react'
import { agents } from '../data/demo'
import { api } from '../lib/api'
import type { Agent,AgentStatus } from '../types'
import { PixelPerson } from './PixelPerson'

interface Props { t:(key:string)=>string; selected:Agent; onSelect:(agent:Agent)=>void }
type RuntimeState={status:AgentStatus;task?:string}

const stateFromEvent=(event:any):RuntimeState|undefined=>{
  if(!event?.agentId)return
  const type=String(event.type||'')
  if(type==='agent_started'||type==='pipeline_started')return {status:'working',task:type.replace(/_/g,' ')}
  if(type==='agent_completed'||type==='pipeline_completed'||type==='nautilus_validation_completed')return {status:'approved',task:type.replace(/_/g,' ')}
  if(type==='agent_failed'||type.includes('rejected')||type.includes('emergency'))return {status:'waiting',task:type.replace(/_/g,' ')}
  return {status:'reviewing',task:type.replace(/_/g,' ')}
}

export function PixelOffice({ t, selected, onSelect }: Props) {
  const [runtime,setRuntime]=useState<Record<string,RuntimeState>>({})

  useEffect(()=>{
    let alive=true
    api.getRecentEvents().then(({events})=>{
      if(!alive)return
      const next:Record<string,RuntimeState>={}
      for(const event of [...events].reverse()){
        const state=stateFromEvent(event)
        if(state&&event.agentId)next[event.agentId]=state
      }
      setRuntime(next)
    }).catch(()=>{})

    const es=new EventSource(api.eventUrl,{withCredentials:true})
    es.addEventListener('agent',(raw:any)=>{
      try{
        const event=JSON.parse(raw.data)
        const state=stateFromEvent(event)
        if(state&&event.agentId)setRuntime(prev=>({...prev,[event.agentId]:state}))
      }catch{}
    })
    return()=>{alive=false;es.close()}
  },[])

  const rendered=useMemo(()=>agents.map(agent=>({...agent,status:runtime[agent.id]?.status||agent.status})),[runtime])
  const active=rendered.filter(agent=>agent.status==='working'||agent.status==='reviewing').length

  return <section className="panel office-panel">
    <header className="panel-heading office-heading">
      <div><span className="eyebrow">◫ PIXEL OPS</span><h2>{t('officeTitle')}</h2><p>{t('clickAgent')}</p></div>
      <div className="office-live"><span className="live-dot"/>{active}/{agents.length} {t('activeAgents')}</div>
    </header>
    <div className="office-stage">
      <div className="office-grid">
        {rendered.map(agent=>{
          const liveTask=runtime[agent.id]?.task
          return <button key={agent.id} className={'agent-room room-'+agent.gridArea+' '+(selected.id===agent.id?'is-selected':'')} onClick={()=>onSelect(agent)}>
            <span className="room-title">{t(agent.roomKey)}</span>
            <div className="room-scene">
              <div className="pixel-desk"><span/><span/><span/></div>
              <PixelPerson status={agent.status}/>
              <div className="room-props"><i/><i/><i/></div>
            </div>
            <div className="agent-bubble"><strong>{agent.icon} {t(agent.nameKey)}</strong><span><i className={'status-dot '+agent.status}/>{liveTask||t(agent.taskKey)}</span></div>
          </button>
        })}
      </div>
      <div className="office-motto"><strong>MY TRADING AGENT</strong><span>{t('makeMoneyRule')}</span></div>
    </div>
  </section>
}
