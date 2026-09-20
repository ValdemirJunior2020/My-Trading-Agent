import { useState } from 'react'
import { api,type SystemStatus } from '../lib/api'

interface Props {t:(key:string)=>string;emergency:boolean;onEmergency:()=>void;onLanguage:()=>void;system:SystemStatus|null}

export function TopBar({t,emergency,onEmergency,onLanguage,system}:Props){
 const ollama=system?.ollama.online
 const quantCount=[system?.engines?.vectorbt?.installed,system?.engines?.nautilusTrader?.installed,system?.engines?.rdAgent?.installed].filter(Boolean).length
 const [running,setRunning]=useState(false)
 const [message,setMessage]=useState('')

 const runAgents=async()=>{
  if(running)return
  setRunning(true);setMessage('')
  try{
   const result=await api.runPipeline({productId:'BTC-USD',deepResearch:false})
   const decision=result.result?.decision?.decision||'DONE'
   setMessage(decision)
  }catch(error){
   setMessage(error instanceof Error?error.message:'Pipeline failed')
  }finally{setRunning(false)}
 }

 const runLabel=running?'RUNNING…':message?('AGENTS: '+message):'▶ RUN AGENTS'

 return <header className="topbar">
  <div className="top-chips">
   <div className="status-chip"><b>{system?'●':'○'}</b><span><strong>{system?t('serverConnected'):t('serverOffline')}</strong><small>{system?('v'+system.server.version):t('startBatHint')}</small></span></div>
   <div className="status-chip"><b>{ollama?'◎':'○'}</b><span><strong>{ollama?t('ollamaConnected'):t('ollamaOffline')}</strong><small>{system?.ollama.chatModel||system?.ollama.models?.[0]||'local'}</small></span></div>
   <div className="status-chip paper"><b>◫</b><span><strong>{t('paperTrading')}</strong><small>{system?.safety.mode||t('simulatedExecution')}</small></span></div>
   <div className="simulation-chip">QUANT {quantCount}/3</div>
   <div className="simulation-chip">{system?.coinbase.configured?t('coinbaseReady'):t('simulation')}</div>
  </div>
  <div className="top-actions">
   <button className="language-btn" onClick={runAgents} disabled={running||!system?.coinbase.configured||!ollama} title={message||'Run the complete agent pipeline'}>{runLabel}</button>
   <button className="language-btn" onClick={onLanguage}>🌐 {t('language')}</button>
   <button className={'emergency-btn '+(emergency?'is-active':'')} onClick={onEmergency}>⚠ {emergency?t('emergencyActive'):t('emergencyStop')}</button>
  </div>
 </header>
}
