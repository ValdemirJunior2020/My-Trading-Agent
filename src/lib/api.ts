export interface PipelineStatus {
  status:'idle'|'running'|'completed'|'failed'
  productId:string
  deepResearch:boolean
  currentAgent:string|null
  completedAgents:string[]
  decision:string|null
  error:string|null
  startedAt:string|null
  finishedAt:string|null
}

export interface SystemStatus {
  server:{online:boolean;version:string;startedAt:string}
  ollama:{online:boolean;models:string[];chatModel?:string}
  coinbase:{configured:boolean}
  engines:{available?:boolean;vectorbt?:{installed?:boolean;version?:string};nautilusTrader?:{installed?:boolean;version?:string};rdAgent?:{installed?:boolean;transport?:string};python?:string|null}
  autoAgents:{enabled:boolean;intervalSeconds:number;deepResearch:boolean}
  safety:{emergencyStop:boolean;mode:string;liveTradingEnabled:boolean;automaticTradingEnabled:boolean;manualApprovalRequired:boolean}
}
const base=(import.meta.env.VITE_API_BASE_URL||'').replace(/\/$/,'')
const request=async<T>(path:string,init?:RequestInit):Promise<T>=>{
  const response=await fetch(`${base}${path}`,{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})},credentials:'include'})
  if(!response.ok){let message=`HTTP ${response.status}`;try{const data=await response.json();message=data.error||message}catch{}throw new Error(message)}
  return response.json()
}
export const api={
  getStatus:()=>request<SystemStatus>('/api/status'),
  setEmergency:(active:boolean)=>request<{ok:boolean;active:boolean}>('/api/emergency-stop',{method:'POST',body:JSON.stringify({active})}),
  getProduct:(productId:string)=>request<{product:any}>(`/api/coinbase/product/${encodeURIComponent(productId)}`),
  getCandles:(productId:string,limit=60)=>request<{candles:any[]}>(`/api/coinbase/candles/${encodeURIComponent(productId)}?limit=${limit}`),
  getOrderBook:(productId:string)=>request<{book:any}>(`/api/coinbase/order-book/${encodeURIComponent(productId)}`),
  getMarketTrades:(productId:string)=>request<{trades:any[]}>(`/api/coinbase/trades/${encodeURIComponent(productId)}`),
  getRecentEvents:()=>request<{events:any[]}>('/api/events/recent'),
  getLiveHistory:(limit=200)=>request<{events:any[]}>(`/api/live/history?limit=${limit}&_=${Date.now()}`),
  clearLiveHistory:()=>request<{ok:boolean;deleted:number}>('/api/live/history',{method:'DELETE'}),
  getPortfolioAllocation:()=>request<any>('/api/coinbase/portfolio-allocation'),
  getPaperOrders:()=>request<{orders:any[]}>('/api/paper/orders'),
  paperOrder:(body:{productId:string;side:'BUY'|'SELL';size:number;price:number})=>request('/api/paper/orders',{method:'POST',body:JSON.stringify(body)}),
  runAgent:(body:{agentId:string;asset:string;summary:string})=>request('/api/agents/run',{method:'POST',body:JSON.stringify(body)}),
  runPipeline:(body:{productId?:string;deepResearch?:boolean})=>request<{ok:boolean;result:any}>('/api/agents/pipeline',{method:'POST',body:JSON.stringify(body)}),
  getPipelineStatus:()=>request<PipelineStatus>('/api/agents/pipeline/status'),
  getScanner:()=>request<any>('/api/scanner'),
  getAutoRun:()=>request<{enabled:boolean;intervalSeconds:number;deepResearch:boolean}>('/api/agents/auto-run'),
  setAutoRun:(body:{enabled?:boolean;intervalSeconds?:number;deepResearch?:boolean})=>request('/api/agents/auto-run',{method:'POST',body:JSON.stringify(body)}),
  quantStatus:()=>request('/api/quant/status'),
  vectorbtSma:(body:{prices:number[];fast?:number;slow?:number;initialCash?:number})=>request('/api/quant/vectorbt/sma',{method:'POST',body:JSON.stringify(body)}),
  nautilusSmoke:()=>request('/api/quant/nautilus/smoke',{method:'POST',body:'{}'}),
  rdAgentHealth:()=>request('/api/quant/rdagent/health'),
  rdAgentRun:(body:{command:'fin_quant'|'fin_factor'|'health'|'info';stepN?:number;loopN?:number})=>request('/api/quant/rdagent/run',{method:'POST',body:JSON.stringify(body)}),
  copilotChat:(body:{message:string;language:'en'|'pt'})=>request<{ok:boolean;model:string;answer:string;action?:any}>('/api/copilot/chat',{method:'POST',body:JSON.stringify(body)}),
  getChallenge:()=>request<any>('/api/challenge'),
  setChallenge:(body:{enabled?:boolean;startingBalanceUsd?:number;targetBalanceUsd?:number;durationDays?:number;restart?:boolean})=>request<any>('/api/challenge',{method:'POST',body:JSON.stringify(body)}),
  getRiskSettings:()=>request<any>('/api/risk/settings'),
  getLiveReadiness:()=>request<any>('/api/live/readiness'),
  livePreflight:(body:{productId:string;side:'BUY'|'SELL';notionalUsd:number})=>request<any>('/api/live/preflight',{method:'POST',body:JSON.stringify(body)}),
  setRiskSettings:(body:{maxPositionPercent?:number;maxTotalExposurePercent?:number;maxDailyLossPercent?:number})=>request<any>('/api/risk/settings',{method:'POST',body:JSON.stringify(body)}),
  eventUrl:`${base}/api/events`
}
