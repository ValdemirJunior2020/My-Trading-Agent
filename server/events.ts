import type { ServerResponse } from 'node:http'
import { addEvent,liveTradeHistory } from './db.js'
import { log } from './logger.js'
const clients=new Set<ServerResponse>()
export const attachEventStream=(res:ServerResponse)=>{
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'})
  const snapshot={ok:true,history:liveTradeHistory(300)}
  res.write('event: ready\ndata: '+JSON.stringify(snapshot)+'\n\n')
  clients.add(res)
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000)
  res.on('close',()=>{clearInterval(heartbeat);clients.delete(res)})
}
const shouldStructuredLog=(type:string)=>
  type.startsWith('live_') ||
  type.startsWith('pipeline_') ||
  type.startsWith('mean_reversion_') ||
  type.startsWith('rolling_') ||
  type.startsWith('emergency_') ||
  type==='hybrid_decision_resolved'

export const publish=(type:string,payload:unknown,agentId?:string)=>{
  const event=addEvent(type,payload,agentId)
  const data=JSON.stringify(event)

  if(shouldStructuredLog(type)){
    log.info('agent_event',{
      eventId:event.id,
      type,
      agentId:agentId||null,
      payload
    })
  }

  for(const client of clients) client.write(`event: agent\ndata: ${data}\n\n`)
  return event
}
