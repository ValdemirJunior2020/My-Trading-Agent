import { useEffect,useState } from 'react'
import { api } from '../lib/api'

interface Props {language:'en'|'pt'}

const usd=(value:unknown)=>{
  const n=Number(value)
  return Number.isFinite(n)?'$'+n.toFixed(2):'—'
}

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
  const progress=challenge.progressPercent==null?0:Number(challenge.progressPercent)
  const soldProfit=Number(challenge.soldProfitUsd||0)
  const pt=language==='pt'

  return <section className="panel challenge-panel">
    <header className="mini-heading">
      <h3>{pt?'Seu Dinheiro Agora':'Your Money Now'}</h3>
      <span>{challenge.enabled?'LIVE':'PAUSED'}</span>
    </header>

    <div className="challenge-grid money-breakdown-grid">
      <div>
        <small>{pt?'Total da carteira':'Total Portfolio'}</small>
        <strong>{usd(challenge.currentPortfolioUsd)}</strong>
      </div>
      <div>
        <small>{pt?'Dinheiro disponível':'Cash Available'}</small>
        <strong>{usd(challenge.cashAvailableUsd)}</strong>
      </div>
      <div>
        <small>{pt?'Dinheiro em moedas abertas':'Money in Open Coins'}</small>
        <strong>{usd(challenge.openCoinsUsd)}</strong>
      </div>
      <div className={soldProfit>=0?'money-profit':'money-loss'}>
        <small>{pt?'Lucro de vendas concluídas':'Sold Profit'}</small>
        <strong>{soldProfit>=0?'+':''}{usd(soldProfit)}</strong>
      </div>
      <div>
        <small>{pt?'Dias restantes':'Days Remaining'}</small>
        <strong>{challenge.daysRemaining}</strong>
      </div>
    </div>

    <div className="challenge-progress"><span style={{width:Math.max(0,Math.min(100,progress))+'%'}}/></div>
    <p>
      {pt
        ?'Total = dinheiro disponível + valor atual das moedas abertas. O lucro vendido já está dentro do total; ele aparece separado só para mostrar de onde veio.'
        :'Total = Cash Available + current value of Open Coins. Sold Profit is already included in the total after the sale; it is shown separately so you can see where it came from.'}
    </p>
    <p>
      {pt?'Meta':'Goal'}: {'$'}{Number(challenge.startingBalanceUsd).toFixed(0)} → {'$'}{Number(challenge.targetBalanceUsd).toFixed(0)} • {pt?'Progresso':'Progress'}: {progress.toFixed(1)}%
    </p>
  </section>
}
