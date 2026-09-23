import { useEffect,useMemo,useState } from 'react'
import { api } from '../lib/api'

interface Props {language:'en'|'pt'}
type Side='BUY'|'SELL'

export function LiveTrading({language}:Props){
 const [readiness,setReadiness]=useState<any|null>(null)
 const [loading,setLoading]=useState(true)
 const [side,setSide]=useState<Side>('BUY')
 const [notional,setNotional]=useState('5')
 const [preflight,setPreflight]=useState<any|null>(null)
 const [busy,setBusy]=useState(false)
 const pt=language==='pt'

 const refresh=async()=>{
  setLoading(true)
  try{setReadiness(await api.getLiveReadiness())}catch(error){setReadiness({error:error instanceof Error?error.message:String(error)})}
  finally{setLoading(false)}
 }

 useEffect(()=>{void refresh()},[])

 const readinessItems=useMemo(()=>[
  [pt?'Coinbase conectado':'Coinbase connected',Boolean(readiness?.configured)],
  [pt?'Modo live habilitado':'Live mode enabled',Boolean(readiness?.liveTradingEnabled)],
  [pt?'Trading automático desligado':'Automatic trading off',readiness?.automaticTradingEnabled===false],
  [pt?'Aprovação manual obrigatória':'Manual approval required',Boolean(readiness?.manualApprovalRequired)],
  [pt?'Emergency stop desligado':'Emergency stop off',readiness?.emergencyStop===false],
  [pt?'Limite diário disponível':'Daily loss guard clear',readiness?.dailyLossGuard?.blocked===false]
 ],[readiness,pt])

 const runPreflight=async()=>{
  setBusy(true);setPreflight(null)
  try{setPreflight(await api.livePreflight({productId:'BTC-USD',side,notionalUsd:Number(notional)}))}
  catch(error:any){setPreflight({ok:false,error:error?.message||String(error)})}
  finally{setBusy(false);void refresh()}
 }

 return <main className="live-page">
  <section className="panel live-panel">
   <div className="live-heading">
    <div><span className="eyebrow">MANUAL LIVE TRADING</span><h1>{pt?'Trading real com aprovação manual':'Real trading with manual approval'}</h1><p>{pt?'Nenhuma ordem real é enviada nesta tela. Primeiro validamos tudo.':'No real order is sent from this screen. Everything is validated first.'}</p></div>
    <span className={readiness?.readyForManualLive?'live-ready-badge ok':'live-ready-badge'}>{readiness?.readyForManualLive?(pt?'PRONTO PARA PREFLIGHT':'READY FOR PREFLIGHT'):(pt?'BLOQUEADO':'LOCKED')}</span>
   </div>

   <div className="live-readiness-grid">
    {readinessItems.map(([label,ok])=><div className="live-check" key={String(label)}><span className={ok?'check-dot ok':'check-dot'}>{ok?'✓':'×'}</span><div><strong>{label}</strong><small>{ok?'OK':(pt?'Necessário':'Required')}</small></div></div>)}
   </div>

   <div className="live-stats">
    <div><small>{pt?'Portfólio atual':'Current portfolio'}</small><strong>{readiness?.currentPortfolioUsd!=null?'$'+Number(readiness.currentPortfolioUsd).toFixed(2):'—'}</strong></div>
    <div><small>{pt?'Limite por posição':'Max position'}</small><strong>{readiness?.riskLimits?.maxPositionPercent!=null?readiness.riskLimits.maxPositionPercent+'%':'—'}</strong></div>
    <div><small>{pt?'Exposição máxima':'Max exposure'}</small><strong>{readiness?.riskLimits?.maxTotalExposurePercent!=null?readiness.riskLimits.maxTotalExposurePercent+'%':'—'}</strong></div>
    <div><small>{pt?'Perda diária máxima':'Daily loss limit'}</small><strong>{readiness?.riskLimits?.maxDailyLossPercent!=null?readiness.riskLimits.maxDailyLossPercent+'%':'—'}</strong></div>
   </div>

   <div className="live-ticket">
    <div className="live-side-toggle">
     <button className={side==='BUY'?'active buy':''} onClick={()=>setSide('BUY')}>BUY</button>
     <button className={side==='SELL'?'active sell':''} onClick={()=>setSide('SELL')}>SELL</button>
    </div>
    <label><span>{pt?'Valor em USD para testar':'USD amount to test'}</span><input value={notional} onChange={e=>setNotional(e.target.value.replace(/[^0-9.]/g,''))} inputMode="decimal"/></label>
    <button className="preflight-btn" onClick={()=>void runPreflight()} disabled={busy||loading||!(Number(notional)>0)}>{busy?(pt?'VALIDANDO...':'CHECKING...'):(pt?'EXECUTAR PREFLIGHT':'RUN PREFLIGHT')}</button>
   </div>

   {preflight?<div className={preflight?.preflight?.approved?'preflight-result ok':'preflight-result'}>
    <strong>{preflight?.preflight?.approved?(pt?'PREFLIGHT APROVADO':'PREFLIGHT APPROVED'):(pt?'PREFLIGHT BLOQUEADO':'PREFLIGHT BLOCKED')}</strong>
    {preflight?.preflight?<><p>{(pt?'Valor: $':'Amount: $')+Number(preflight.preflight.notionalUsd||0).toFixed(2)+' • '+preflight.preflight.side+' BTC-USD'}</p>
    <p>{(pt?'Limite máximo da posição: $':'Max position cap: $')+Number(preflight.preflight.maxPositionUsd||0).toFixed(2)}</p>
    {preflight.preflight.reasons?.length?<ul>{preflight.preflight.reasons.map((x:string)=><li key={x}>{x}</li>)}</ul>:<p>{pt?'Todos os checks obrigatórios passaram. A ordem ainda NÃO foi enviada.':'All required checks passed. The order has still NOT been sent.'}</p>}</>:<p>{preflight.error||'Preflight failed.'}</p>}
   </div>:null}

   <div className="live-warning"><strong>{pt?'Importante':'Important'}</strong><span>{pt?'Esta fase somente valida. O botão final de enviar ordem real será adicionado somente depois que a permissão de trading da chave Coinbase for confirmada e o fluxo de aprovação estiver testado.':'This phase validates only. The final real-order submit button will be added only after the Coinbase key trading permission is confirmed and the approval flow is tested.'}</span></div>
  </section>
 </main>
}
