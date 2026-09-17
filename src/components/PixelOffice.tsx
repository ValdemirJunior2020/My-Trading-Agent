import { agents } from '../data/demo'
import type { Agent } from '../types'
import { PixelPerson } from './PixelPerson'

interface Props { t:(key:string)=>string; selected:Agent; onSelect:(agent:Agent)=>void }

export function PixelOffice({ t, selected, onSelect }: Props) {
  return <section className="panel office-panel">
    <header className="panel-heading office-heading">
      <div><span className="eyebrow">◫ PIXEL OPS</span><h2>{t('officeTitle')}</h2><p>{t('clickAgent')}</p></div>
      <div className="office-live"><span className="live-dot"/>{agents.filter(a=>a.status!=='idle').length}/{agents.length} {t('activeAgents')}</div>
    </header>
    <div className="office-stage">
      <div className="office-grid">
        {agents.map(agent => <button key={agent.id} className={`agent-room room-${agent.gridArea} ${selected.id===agent.id?'is-selected':''}`} onClick={()=>onSelect(agent)}>
          <span className="room-title">{t(agent.roomKey)}</span>
          <div className="room-scene">
            <div className="pixel-desk"><span/><span/><span/></div>
            <PixelPerson status={agent.status}/>
            <div className="room-props"><i/><i/><i/></div>
          </div>
          <div className="agent-bubble"><strong>{agent.icon} {t(agent.nameKey)}</strong><span><i className={`status-dot ${agent.status}`}/>{t(agent.taskKey)}</span></div>
        </button>)}
      </div>
      <div className="office-motto"><strong>MY TRADING AGENT</strong><span>{t('makeMoneyRule')}</span></div>
    </div>
  </section>
}
