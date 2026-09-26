import { useEffect,useRef,useState } from 'react'
import { api } from '../lib/api'

interface Props {language:'en'|'pt'}

const usd=(value:unknown)=>{
  const n=Number(value)
  return Number.isFinite(n)?'$'+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—'
}

const units=(value:unknown)=>{
  const n=Number(value)
  if(!Number.isFinite(n))return '—'
  if(Math.abs(n)>=1000)return n.toLocaleString(undefined,{maximumFractionDigits:2})
  if(Math.abs(n)>=1)return n.toLocaleString(undefined,{maximumFractionDigits:6})
  return n.toLocaleString(undefined,{maximumFractionDigits:10})
}

export function MyPortfolio({language}:Props){
  const [data,setData]=useState<any|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null)
  const loadInFlight=useRef(false)
  const pt=language==='pt'

  const load=async()=>{
    if(loadInFlight.current)return
    loadInFlight.current=true
    setLoading(true)
    try{
      setData(await api.getPortfolioAllocation())
      setLastUpdated(new Date())
      setError('')
    }catch(e){
      setError(e instanceof Error?e.message:String(e))
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

  const holdings=data?.holdings||[]

  return <main className="portfolio-page">
    <section className="panel portfolio-panel">
      <div className="portfolio-heading">
        <div>
          <span className="eyebrow">COINBASE PORTFOLIO</span>
          <h1>{pt?'Meu Portfólio':'My Portfolio'}</h1>
          <p>{pt?'Veja onde seu dinheiro está investido agora na Coinbase.':'See where your money is currently held in Coinbase.'}</p>
        </div>
        <button className="portfolio-refresh" disabled={loading} onClick={()=>void load()}>
          {loading?(pt?'Atualizando...':'Refreshing...'):(pt?'Atualizar':'Refresh')}
        </button>
      </div>

      {error?<div className="portfolio-error">{error}</div>:null}
      {!error&&lastUpdated?<div className="portfolio-note">{(pt?'Atualizado ':'Updated ')+lastUpdated.toLocaleTimeString()}</div>:null}

      <div className="portfolio-summary">
        <div><small>{pt?'Total Coinbase':'Coinbase total'}</small><strong>{loading&&!data?'—':usd(data?.totalUsd)}</strong></div>
        <div><small>{pt?'Dinheiro disponível':'Cash / stable cash'}</small><strong>{loading&&!data?'—':usd(data?.cashUsd)}</strong></div>
        <div><small>{pt?'Investido em cripto':'Invested in crypto'}</small><strong>{loading&&!data?'—':usd(data?.cryptoUsd)}</strong></div>
        <div><small>{pt?'Posições':'Holdings'}</small><strong>{holdings.length}</strong></div>
      </div>

      <div className="portfolio-allocation">
        {holdings.map((h:any)=><div className="allocation-row" key={h.currency}>
          <div className="allocation-top">
            <div><strong>{h.currency}</strong><small>{h.type==='cash'?(pt?'Dinheiro':'Cash'):h.productId}</small></div>
            <div className="allocation-value"><strong>{usd(h.valueUsd)}</strong><small>{Number(h.allocationPercent||0).toFixed(2)}%</small></div>
          </div>
          <div className="allocation-bar"><span style={{width:Math.max(0,Math.min(100,Number(h.allocationPercent||0)))+'%'}}/></div>
          <div className="allocation-meta">
            <span>{pt?'Quantidade':'Units'}: <b>{units(h.units)}</b></span>
            <span>{pt?'Preço atual':'Current price'}: <b>{usd(h.priceUsd)}</b></span>
            <span>{pt?'Disponível':'Available'}: <b>{units(h.available)}</b></span>
            {Number(h.hold||0)>0?<span>{pt?'Em hold':'On hold'}: <b>{units(h.hold)}</b></span>:null}
          </div>
        </div>)}
        {!loading&&holdings.length===0?<div className="portfolio-empty">{pt?'Nenhum saldo Coinbase encontrado.':'No Coinbase balances found.'}</div>:null}
      </div>

      <div className="portfolio-note">
        {pt?'Valores usam os saldos atuais da Coinbase e os preços USD atuais. Custo médio e lucro/prejuízo não são mostrados aqui.':'Values use current Coinbase balances and current USD prices. Cost basis and profit/loss are not shown here.'}
      </div>
    </section>
  </main>
}
