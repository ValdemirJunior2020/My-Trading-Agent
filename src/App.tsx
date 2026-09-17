import { useEffect, useMemo, useState } from 'react'
import './index.css'
import type { Language } from './types'
import { dictionaries } from './i18n/translations'
import { agents } from './data/demo'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { PixelOffice } from './components/PixelOffice'
import { TradingTerminal } from './components/TradingTerminal'
import { AgentDetails } from './components/AgentDetails'
import { BottomPanels } from './components/BottomPanels'

export default function App(){
  const [language,setLanguage]=useState<Language>(()=>localStorage.getItem('mta-language')==='pt'?'pt':'en')
  const [selected,setSelected]=useState(agents[0])
  const [page,setPage]=useState('agentOffice')
  const [emergency,setEmergency]=useState(false)
  const t=useMemo(()=> (key:string)=>dictionaries[language][key] ?? key,[language])
  useEffect(()=>{localStorage.setItem('mta-language',language);document.documentElement.lang=language==='pt'?'pt-BR':'en'},[language])
  const toggleLanguage=()=>setLanguage(v=>v==='en'?'pt':'en')

  return <div className={`app ${emergency?'emergency-mode':''}`}>
    <Sidebar t={t} page={page} setPage={setPage}/>
    <div className="workspace"><TopBar t={t} emergency={emergency} onEmergency={()=>setEmergency(v=>!v)} onLanguage={toggleLanguage}/>
      {page==='agentOffice'||page==='dashboard'?<main className="dashboard-shell">
        <div className="hero-grid"><PixelOffice t={t} selected={selected} onSelect={setSelected}/><TradingTerminal t={t}/></div>
        <div className="detail-row"><AgentDetails agent={selected} t={t}/><BottomPanels t={t}/></div>
        <div className="mobile-hint">{t('mobileHint')}</div>
      </main>:<main className="planned-page"><div className="panel planned-card"><span>{t('planned')}</span><h1>{t(page)}</h1><p>{language==='pt'?'Esta área está preparada na arquitetura, mas ainda não está implementada. Nada aqui finge ser um recurso real.':'This area is reserved in the architecture but is not implemented yet. Nothing here pretends to be a finished feature.'}</p><button onClick={()=>setPage('agentOffice')}>{t('agentOffice')} →</button></div></main>}
      <footer className="footer"><span><i className="live-dot"/>{t('systemsOperational')}</span><span>Local AI • Local Data • Risk First</span></footer>
    </div>
  </div>
}
