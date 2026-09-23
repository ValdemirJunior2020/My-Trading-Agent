import { useEffect,useState } from 'react'
import { api } from '../lib/api'

interface Props {language:'en'|'pt'}

export function TradingChallenge({language}:Props){
  const [challenge,setChallenge]=useState<any|null>(null)
  useEffect(()=>{
    let active=true
    const load=()=>api.getChallenge().then(value=>{if(active)setChallenge(value)}).catch(()=>{})
    load()
    const id=setInterval(load,10000)
    return()=>{active=false;clearInterval(id)}
  },[])

  if(!challenge)return null
  const current=challenge.currentPortfolioUsd==null?'—':('$'+Number(challenge.currentPortfolioUsd).toFixed(2))
  const progress=challenge.progressPercent==null?0:Number(challenge.progressPercent)
  const title=language==='pt'?'Desafio de Trading':'Trading Challenge'
  const goal=language==='pt'?'Meta':'Goal'
  const balance=language==='pt'?'Saldo atual':'Current balance'
  const days=language==='pt'?'Dias restantes':'Days remaining'
  const note=language==='pt'?'A meta nunca substitui os limites de risco.':'The goal never overrides risk limits.'

  return <section className="panel challenge-panel">
    <header className="mini-heading"><h3>{title}</h3><span>{challenge.enabled?'ACTIVE':'PAUSED'}</span></header>
    <div className="challenge-grid">
      <div><small>{goal}</small><strong>${Number(challenge.startingBalanceUsd).toFixed(0)} → ${Number(challenge.targetBalanceUsd).toFixed(0)}</strong></div>
      <div><small>{balance}</small><strong>{current}</strong></div>
      <div><small>{days}</small><strong>{challenge.daysRemaining}</strong></div>
      <div><small>Progress</small><strong>{progress.toFixed(1)}%</strong></div>
    </div>
    <div className="challenge-progress"><span style={{width:Math.max(0,Math.min(100,progress))+'%'}}/></div>
    <p>{note} Required gain: {Number(challenge.requiredGainPercent).toFixed(1)}%.</p>
  </section>
}
