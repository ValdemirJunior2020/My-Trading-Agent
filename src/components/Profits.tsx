import { useEffect,useRef,useState } from 'react'
import { api } from '../lib/api'

interface Props {language:'en'|'pt'}

const usd=(value:unknown)=>{
  const n=Number(value)
  return Number.isFinite(n)?'$'+Math.abs(n).toFixed(2):'—'
}

export function Profits({language}:Props){
  const [data,setData]=useState<any|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const loadInFlight=useRef(false)
  const pt=language==='pt'

  const load=async()=>{
    if(loadInFlight.current)return
    loadInFlight.current=true
    setLoading(true)
    try{
      setData(await api.getProfits())
      setError('')
    }catch(e){
      const message=e instanceof Error?e.message:String(e)
      setError(
        /timed out|timeout/i.test(message)
          ?(pt?'O histórico de lucros demorou para responder. Tente atualizar novamente.':'Profit history took too long to respond. Please refresh again.')
          :message
      )
    }finally{
      loadInFlight.current=false
      setLoading(false)
    }
  }

  useEffect(()=>{
    void load()
    const id=setInterval(()=>void load(),15000)
    return()=>clearInterval(id)
  },[])

  const trades=data?.trades||[]
  const net=Number(data?.totalNetProfitUsd||0)
  const made=Number(data?.profitOnlyUsd||0)
  const soldLower=Number(data?.soldLowerUsd||0)

  return <main className="profits-page">
    <section className="panel profits-panel">
      <div className="profits-heading">
        <div>
          <span className="eyebrow">REAL MONEY RESULTS</span>
          <h1>{pt?'Lucros':'Profits'}</h1>
          <p>{pt?'Somente trades que já foram vendidos contam aqui.':'Only trades that were actually sold count here.'}</p>
        </div>
        <button className="portfolio-refresh" disabled={loading} onClick={()=>void load()}>
          {loading?(pt?'Atualizando...':'Refreshing...'):(pt?'Atualizar':'Refresh')}
        </button>
      </div>

      {error?<div className="portfolio-error">{error}</div>:null}

      <div className="profits-summary">
        <div className={net>=0?'good':'bad'}>
          <small>{pt?'Resultado total após vendas':'Profit kept after sold trades'}</small>
          <strong>{net>=0?'+':'-'}{usd(net)}</strong>
          <span>{pt?'Já realizado, depois das taxas':'Already completed, after fees'}</span>
        </div>
        <div>
          <small>{pt?'Lucro das vendas vencedoras':'Profit from winning sales'}</small>
          <strong className="profit-good">+{usd(made)}</strong>
          <span>{Number(data?.profitableTrades||0)} {pt?'vendas com lucro':'profitable sales'}</span>
        </div>
        <div>
          <small>{pt?'Vendido abaixo do custo':'Sold lower than bought'}</small>
          <strong className={soldLower>0?'profit-bad':''}>{soldLower>0?'-':'$'}{soldLower>0?usd(soldLower):'0.00'}</strong>
          <span>{pt?'Só aparece depois que realmente vende':'Only counts after an actual sale'}</span>
        </div>
      </div>

      <div className="profits-table-wrap">
        <div className="profits-table profits-head">
          <span>{pt?'Data':'Date'}</span>
          <span>{pt?'Moeda':'Coin'}</span>
          <span>{pt?'Comprado por':'Bought for'}</span>
          <span>{pt?'Vendido por':'Sold for'}</span>
          <span>{pt?'Resultado':'Result'}</span>
        </div>
        {trades.map((trade:any)=>{
          const p=Number(trade.profitUsd||0)
          const pct=Number(trade.profitPercent||0)
          return <div className="profits-table profits-row" key={trade.id}>
            <span>{new Date(trade.createdAt).toLocaleString()}</span>
            <span><b>{String(trade.productId||'—').replace('-USD','')}</b></span>
            <span>{usd(trade.boughtForUsd)}</span>
            <span>{usd(trade.soldForUsd)}</span>
            <span className={p>=0?'profit-good':'profit-bad'}>
              <b>{p>=0?'+':'-'}{usd(p)}</b>
              <small>{pct>=0?'+':''}{pct.toFixed(2)}% {pt?'após taxas':'after fees'}</small>
            </span>
          </div>
        })}
        {!loading&&!error&&trades.length===0?<div className="portfolio-empty">{pt?'Nenhuma venda concluída com resultado calculado ainda.':'No completed sold trades with calculated results yet.'}</div>:null}
      </div>

      <div className="portfolio-note">
        {pt?'Moedas que ainda estão abertas e esperando subir não são chamadas de perda aqui.':'Open coins that are still waiting to go up are not called a loss here.'}
      </div>
    </section>
  </main>
}
