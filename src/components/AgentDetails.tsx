import type { Agent } from '../types'
import { PixelPerson } from './PixelPerson'

interface Props { agent:Agent; t:(key:string)=>string }
export function AgentDetails({agent,t}:Props){
  return <section className="panel details-panel">
    <header className="mini-heading"><h3>{t('agentDetails')}</h3><span className={`status-badge ${agent.status}`}>{t(agent.status)}</span></header>
    <div className="agent-details-grid">
      <div className="agent-avatar"><PixelPerson status={agent.status}/></div>
      <dl>
        <div><dt>{t('currentTask')}</dt><dd>{t(agent.taskKey)}</dd></div>
        <div><dt>Asset</dt><dd>{agent.asset}</dd></div>
        <div><dt>{t('lastCompleted')}</dt><dd>{t(agent.lastKey)}</dd></div>
        <div className="wide"><dt>{t('reasoning')}</dt><dd>{t(agent.detailKey)}</dd></div>
        <div><dt>{t('timeStarted')}</dt><dd>{agent.startedAt}</dd></div>
        <div><dt>{t('ollamaProcessing')}</dt><dd>{agent.ollama ? t('yes') : t('no')}</dd></div>
      </dl>
    </div>
  </section>
}
