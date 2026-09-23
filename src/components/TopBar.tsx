import { useEffect,useMemo,useState } from 'react'
import { api,type PipelineStatus,type SystemStatus } from '../lib/api'

interface Props {t:(key:string)=>string;emergency:boolean;onEmergency:()=>void;onLanguage:()=>void;system:SystemStatus|null}

const friendlyAgent=(id:string|null)=>{
 if(!id)return ''
 const names:Record<string,string>={
  manager:'Manager',
  market:'Market Analyst',
  strategy:'Strategy Researcher',
  sentiment:'Sentiment Analyst',
  portfolio:'Portfolio Manager',
  risk:'Risk Manager',
  critic:'Trade Critic',
  decision:'Final Decision',
  paper:'Paper Trader',
  execution:'Execution Agent',
  backtest:'Backtesting Lab'
 }
 return names[id]||id
}

export function TopBar({t,emergency,onEmergency,onLanguage,system}:Props){
 const ollama=system?.ollama.online
 const quantCount=[system?.engines?.vectorbt?.installed,system?.engines?.nautilusTrader?.installed,system?.engines?.rdAgent?.installed].filter(Boolean).length
 const rdReady=Boolean(system?.engines?.rdAgent?.installed)
 const [pipeline,setPipeline]=useState<PipelineStatus|null>(null)
 const [launching,setLaunching]=useState(false)

 useEffect(()=>{
  let active=true
  const load=()=>api.getPipelineStatus().then(value=>{if(active)setPipeline(value)}).catch(()=>{})
  load()
  const id=setInterval(load,1200)
  return()=>{active=false;clearInterval(id)}
 },[])

 const running=pipeline?.status==='running'||launching
 const runAgents=async(deepResearch=false)=>{
  if(running)return
  setLaunching(true)
  try{
   await api.runPipeline({productId:'BTC-USD',deepResearch})
  }catch{}
  finally{
   setLaunching(false)
   api.getPipelineStatus().then(setPipeline).catch(()=>{})
  }
 }

 const runLabel=useMemo(()=>{
  if(running){
   const current=friendlyAgent(pipeline?.currentAgent||null)
   return current?'RUNNING: '+current:'RUNNING...'
  }
  if(pipeline?.status==='failed')return 'AGENTS: FAILED'
  if(pipeline?.status==='completed')return 'AGENTS: '+(pipeline.decision||'DONE')
  return '▶ RUN AGENTS'
 },[running,pipeline])

 const title=pipeline?.status==='failed'
  ?(pipeline.error||'Pipeline failed')
  :pipeline?.status==='completed'
    ?('Completed • '+(pipeline.decision||'DONE'))
    :'Run the complete agent pipeline'

 return <header className="topbar">
  <div className="top-chips">
   <div className="status-chip"><b>{system?'●':'○'}</b><span><strong>{system?t('serverConnected'):t('serverOffline')}</strong><small>{system?('v'+system.server.version):t('startBatHint')}</small></span></div>
   <div className="status-chip"><b>{ollama?'◎':'○'}</b><span><strong>{ollama?t('ollamaConnected'):t('ollamaOffline')}</strong><small>{system?.ollama.chatModel||system?.ollama.models?.[0]||'local'}</small></span></div>
   <div className="status-chip paper"><b>◫</b><span><strong>{t('paperTrading')}</strong><small>{system?.safety.mode||t('simulatedExecution')}</small></span></div>
   <div className="simulation-chip">QUANT {quantCount}/3</div>
   <div className="simulation-chip">AUTO {system?.autoAgents?.enabled?'ON':'OFF'}{system?.autoAgents?.enabled?' • '+system.autoAgents.intervalSeconds+'s':''}</div>
   <div className="simulation-chip">{system?.coinbase.configured?t('coinbaseReady'):t('simulation')}</div>
  </div>
  <div className="top-actions">
   <button className="language-btn" onClick={()=>void runAgents(false)} disabled={running||!system?.coinbase.configured||!ollama} title={title}>{runLabel}</button>
   <button className="language-btn" onClick={()=>void runAgents(true)} disabled={running||!system?.coinbase.configured||!ollama||!rdReady} title={rdReady?'Run pipeline with RD-Agent factor research':'Install RD-Agent to enable deep research'}>◆ DEEP RESEARCH</button>
   <button className="language-btn" onClick={onLanguage}>🌐 {t('language')}</button>
   <button className={'emergency-btn '+(emergency?'is-active':'')} onClick={onEmergency}>⚠ {emergency?t('emergencyActive'):t('emergencyStop')}</button>
  </div>
 </header>
}
