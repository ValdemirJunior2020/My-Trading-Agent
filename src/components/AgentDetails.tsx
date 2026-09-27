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
      api.getPipelineStatus().then(status=>{if(active)setPipeline(status)}).catch(()=>{})
      api.getStatus().then(status=>{if(active)setSystem(status)}).catch(()=>{})
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
  const safety:any=system?.safety||{}
  const rollingRisk:any=safety.rollingRisk||{}
  const deterministicRunning=Boolean((system as any)?.meanReversion?.running)
  const rollingLocked=Boolean(rollingRisk.locked||rollingRisk.blocked)
  const pipelineRunning=pipeline?.status==='running'
  const isCurrent=pipelineRunning&&pipeline?.currentAgent===agent.id
  const isCompleted=Boolean(pipeline?.completedAgents?.includes(agent.id))

  const liveStatus:AgentStatus=isLossGuard
    ? (rollingLocked?'approved':'waiting')
    : isCurrent
      ? (agent.id==='critic'?'reviewing':'working')
      : pipelineRunning
        ? 'waiting'
        : 'idle'

  const currentTask=isLossGuard
    ? (rollingLocked
        ? '3% / 24h EMERGENCY LOCKDOWN ACTIVE'
        : 'Monitoring rolling 24-hour account equity')
    : isCurrent
      ? 'Processing optional AI analysis'
      : pipelineRunning
        ? 'Optional AI pipeline running in background'
        : deterministicRunning
          ? 'Deterministic strategy monitoring live market'
          : 'Waiting for live strategy engine'

  const lastCompleted=isLossGuard
    ? (rollingLocked
        ? 'Kill switch triggered — manual reset required'
        : '24h equity protection armed')
    : isCompleted
      ? 'Completed optional AI analysis'
      : pipeline?.status==='completed'
        ? 'Optional AI pipeline completed'
        : deterministicRunning
          ? 'Live deterministic engine is active'
          : 'No current completed step'

  const reasoning=isLossGuard
    ? (rollingLocked
        ? 'Rolling account equity reached the 3% drawdown limit. Open orders are canceled, bot-managed positions are liquidated, and automated trading remains locked until manual reset.'
        : 'This safety monitor tracks rolling 24-hour account equity. It triggers only when drawdown reaches 3%, then performs the full manual-reset lockdown.')
    : isCurrent
      ? 'This AI agent is analyzing in the background. It cannot approve, reject, modify, or override deterministic live trades.'
      : pipelineRunning
        ? 'Another optional AI agent is analyzing in the background. Live execution continues to be controlled only by deterministic strategy and risk rules.'
        : deterministicRunning
          ? 'No AI approval is required. The live engine is evaluating closed 10m/5m candles, Bollinger Bands, RSI, volume, position availability, slippage, exits, and the rolling equity kill switch.'
          : 'The deterministic live strategy engine is not currently reporting as running.'

  const startedAt=isLossGuard
    ? (rollingRisk?.pauseStartedAt?new Date(rollingRisk.pauseStartedAt).toLocaleTimeString():(rollingLocked?'Locked':'Monitoring now'))
    : isCurrent&&pipeline?.startedAt
      ? new Date(pipeline.startedAt).toLocaleTimeString()
      : deterministicRunning
        ? 'Live now'
        : '-'


  return <section className="panel details-panel">
    <header className="mini-heading">
      <h3>{t('agentDetails')}</h3>
      <span className={`status-badge ${liveStatus} ${isLossGuard?'loss-guard-status':''}`}>{t(liveStatus)}</span>
    </header>
    <div className="agent-details-grid">
      <div className="agent-avatar"><PixelPerson status={liveStatus}/></div>
      <dl>
        <div><dt>{t('currentTask')}</dt><dd>{currentTask}</dd></div>
        <div><dt>Asset</dt><dd>{isLossGuard?'ACCOUNT EQUITY':(pipeline?.productId||agent.asset)}</dd></div>
        <div><dt>{t('lastCompleted')}</dt><dd>{lastCompleted}</dd></div>
        <div className="wide"><dt>{t('reasoning')}</dt><dd>{reasoning}</dd></div>
        <div><dt>{t('timeStarted')}</dt><dd>{startedAt}</dd></div>
        <div><dt>{t('ollamaProcessing')}</dt><dd>{isLossGuard?t('no'):(isCurrent?t('yes'):t('no'))}</dd></div>
      </dl>
    </div>
  </section>
}
