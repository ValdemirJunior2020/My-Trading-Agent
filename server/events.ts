import type { ServerResponse } from 'node:http'
import { addEvent } from './db.js'
const clients=new Set<ServerResponse>()
export const attachEventStream=(res:ServerResponse)=>{
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'})
  res.write('event: ready\ndata: {"ok":true}\n\n')
  clients.add(res)
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000)
  res.on('close',()=>{clearInterval(heartbeat);clients.delete(res)})
}
export const publish=(type:string,payload:unknown,agentId?:string)=>{
  const event=addEvent(type,payload,agentId), data=JSON.stringify(event)
  for(const client of clients) client.write(`event: agent\ndata: ${data}\n\n`)
  return event
}
