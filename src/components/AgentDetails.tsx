import { useEffect,useState } from 'react'
import type { Agent,AgentStatus } from '../types'
import { api,type PipelineStatus,type SystemStatus } from '../lib/api'
import { PixelPerson } from './PixelPerson'

interface Props { agent:Agent; t:(key:string)=>string }

export function AgentDetails({agent,t}:Props){
  const [pipeline,setPipeline]=useState<PipelineStatus|null>(null)
  const [system,setSystem]=useState<SystemStatus|null>(null)

  useEffect(()=>{
    let active=true
    const refresh=()=>{
      api.getPipelineStatus().then(status=>{
        if(active)setPipeline(status)
      }).catch(()=>{})
      api.getStatus().then(status=>{
        if(active)setSystem(status)
      }).catch(()=>{})
    }

    refresh()
    const poll=window.setInterval(refresh,1500)
    const stream=new EventSource(api.eventUrl,{withCredentials:true})
    stream.addEventListener('agent',refresh)

    return()=>{
      active=false
      window.clearInterval(poll)
      stream.removeEventListener('agent',refresh)
      stream.close()
    }
  },[])

  const isLossGuard=agent.id==='loss_guard'
  const lossGuard=system?.safety?.lossGuard
  const pipelineRunning=pipeline?.status==='running'
  const isCurrent=pipelineRunning&&pipeline?.currentAgent===agent.id
  const isCompleted=Boolean(pipeline?.completedAgents?.includes(agent.id))
  const liveStatus:AgentStatus=isLossGuard
    ? (lossGuard?.active?'approved':'waiting')
    : isCurrent
      ? (agent.id==='critic'?'reviewing':'working')
      : pipelineRunning
        ? 'waiting'
        : 'idle'

  const currentTask=isLossGuard
    ? (lossGuard?.active?'GLOBAL STOP ACTIVE — all live BUY and SELL execution blocked':'Waiting for any realized loss')
    : isCurrent
      ? 'Processing live pipeline step'
      : pipelineRunning
        ? 'Waiting for current pipeline step'
        : 'Waiting for agent pipeline'

  const lastCompleted=isLossGuard
    ? (lossGuard?.active
        ? 'Stopped trading after '+String(lossGuard.productId||'a trade')+' lost 

  const reasoning=isLossGuard
    ? (lossGuard?.active
        ? 'A realized losing SELL was detected. This dedicated safety agent latched the global emergency stop. Nothing can execute live until you manually reset the stop.'
        : 'This dedicated safety agent watches realized SELL results. The first realized loss immediately activates the global emergency stop.')
    : isCurrent
      ? 'This agent is actively processing the live backend pipeline.'
      : pipelineRunning
        ? 'Another agent is currently processing the live backend pipeline.'
        : 'No agent pipeline is running right now.'

  const startedAt=isLossGuard
    ? (lossGuard?.triggeredAt?new Date(lossGuard.triggeredAt).toLocaleTimeString():'Armed now')
    : pipeline?.startedAt
      ? new Date(pipeline.startedAt).toLocaleTimeString()
      : '—'

  return <section className="panel details-panel">
    <header className="mini-heading">
      <h3>{t('agentDetails')}</h3>
      <span className={`status-badge ${liveStatus} ${isLossGuard?'loss-guard-status':''}`}>{t(liveStatus)}</span>
    </header>
    <div className="agent-details-grid">
      <div className="agent-avatar"><PixelPerson status={liveStatus}/></div>
      <dl>
        <div><dt>{t('currentTask')}</dt><dd>{currentTask}</dd></div>
        <div><dt>Asset</dt><dd>{isLossGuard?(lossGuard?.productId||agent.asset):(pipeline?.productId||agent.asset)}</dd></div>
        <div><dt>{t('lastCompleted')}</dt><dd>{lastCompleted}</dd></div>
        <div className="wide"><dt>{t('reasoning')}</dt><dd>{reasoning}</dd></div>
        <div><dt>{t('timeStarted')}</dt><dd>{startedAt}</dd></div>
        <div><dt>{t('ollamaProcessing')}</dt><dd>{isLossGuard?t('no'):(isCurrent?t('yes'):t('no'))}</dd></div>
      </dl>
    </div>
  </section>
}
+Math.abs(Number(lossGuard.lossUsd||0)).toFixed(2)
        : 'Armed — no new realized loss since last reset')
    : isCompleted
      ? 'Completed in current pipeline'
      : pipeline?.status==='completed'
        ? 'Pipeline completed'
        : 'No current completed step'

  const reasoning=isCurrent
    ? 'This agent is actively processing the live backend pipeline.'
    : pipelineRunning
      ? 'Another agent is currently processing the live backend pipeline.'
      : 'No agent pipeline is running right now.'

  const startedAt=pipeline?.startedAt
    ? new Date(pipeline.startedAt).toLocaleTimeString()
    : '—'

  return <section className="panel details-panel">
    <header className="mini-heading">
      <h3>{t('agentDetails')}</h3>
      <span className={`status-badge ${liveStatus}`}>{t(liveStatus)}</span>
    </header>
    <div className="agent-details-grid">
      <div className="agent-avatar"><PixelPerson status={liveStatus}/></div>
      <dl>
        <div><dt>{t('currentTask')}</dt><dd>{currentTask}</dd></div>
        <div><dt>Asset</dt><dd>{pipeline?.productId||agent.asset}</dd></div>
        <div><dt>{t('lastCompleted')}</dt><dd>{lastCompleted}</dd></div>
        <div className="wide"><dt>{t('reasoning')}</dt><dd>{reasoning}</dd></div>
        <div><dt>{t('timeStarted')}</dt><dd>{startedAt}</dd></div>
        <div><dt>{t('ollamaProcessing')}</dt><dd>{isCurrent?t('yes'):t('no')}</dd></div>
      </dl>
    </div>
  </section>
}
