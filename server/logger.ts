import { appendFileSync,mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'

mkdirSync(config.dataDir,{recursive:true})
const logFile=join(config.dataDir,'server.jsonl')

type Level='info'|'warn'|'error'

const write=(level:Level,event:string,details:Record<string,unknown>={})=>{
  const row={
    ts:new Date().toISOString(),
    level,
    event,
    ...details
  }
  const line=JSON.stringify(row)
  if(level==='error')console.error(line)
  else if(level==='warn')console.warn(line)
  else console.log(line)
  try{appendFileSync(logFile,line+'\n','utf8')}catch{}
}

export const log={
  info:(event:string,details:Record<string,unknown>={})=>write('info',event,details),
  warn:(event:string,details:Record<string,unknown>={})=>write('warn',event,details),
  error:(event:string,details:Record<string,unknown>={})=>write('error',event,details)
}

export const serverLogFile=logFile
