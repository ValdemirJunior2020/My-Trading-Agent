import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync=promisify(execFile)
const pythonPath=join(process.cwd(),'.venv-quant','Scripts','python.exe')
const bridgePath=join(process.cwd(),'quant','bridge.py')
const rdScriptWindows=join(process.cwd(),'quant','run-rdagent-wsl.sh')

const parseBridge=(stdout:string)=>{
  const line=stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)||''
  const parsed=JSON.parse(line)
  if(!parsed.ok) throw new Error(parsed.error||'Quant engine failed.')
  return parsed.result
}

export const nativeQuantStatus=async()=>{
  if(!existsSync(pythonPath)||!existsSync(bridgePath)){
    return {
      available:false,
      vectorbt:{installed:false},
      nautilusTrader:{installed:false},
      python:null
    }
  }
  try{
    const {stdout}=await execFileAsync(pythonPath,[bridgePath,'status'],{timeout:15000,windowsHide:true})
    return {available:true,...parseBridge(stdout)}
  }catch(error){
    return {available:false,error:error instanceof Error?error.message:String(error)}
  }
}

const wslPath=async(windowsPath:string)=>{
  const {stdout}=await execFileAsync('wsl.exe',['wslpath','-a',windowsPath],{timeout:5000,windowsHide:true})
  return stdout.trim()
}

export const rdAgentStatus=async()=>{
  try{
    const script=await wslPath(rdScriptWindows)
    await execFileAsync('wsl.exe',['-e','bash','-lc',`test -x "$HOME/.my-trading-agent-rdagent/.venv/bin/rdagent" && test -f "${script}"`],{timeout:5000,windowsHide:true})
    return {installed:true,transport:'wsl'}
  }catch(error){
    return {installed:false,transport:'wsl',error:error instanceof Error?error.message:String(error)}
  }
}

export const quantStatus=async()=>{
  const [native,rdAgent]=await Promise.all([nativeQuantStatus(),rdAgentStatus()])
  return {...native,rdAgent}
}

export const runVectorbtSma=async(payload:unknown)=>{
  if(!existsSync(pythonPath)) throw new Error('Quant environment is not installed. Run INSTALL-QUANT-ENGINES.bat.')
  const child=spawn(pythonPath,[bridgePath,'vectorbt-sma'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  const output:string[]=[]
  const errors:string[]=[]
  child.stdout.on('data',chunk=>output.push(String(chunk)))
  child.stderr.on('data',chunk=>errors.push(String(chunk)))
  child.stdin.end(JSON.stringify(payload))
  const code=await new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('VectorBT timed out.'))},120000)
    child.on('error',err=>{clearTimeout(timer);reject(err)})
    child.on('close',value=>{clearTimeout(timer);resolve(value??1)})
  })
  if(code!==0) throw new Error(errors.join('').trim()||output.join('').trim()||'VectorBT failed.')
  return parseBridge(output.join(''))
}

export const runNautilusSmoke=async()=>{
  if(!existsSync(pythonPath)) throw new Error('Quant environment is not installed. Run INSTALL-QUANT-ENGINES.bat.')
  const {stdout,stderr}=await execFileAsync(pythonPath,[bridgePath,'nautilus-smoke'],{timeout:30000,windowsHide:true})
  if(stderr?.trim()) console.warn('[nautilus]',stderr.trim())
  return parseBridge(stdout)
}

export const runRdAgent=async(command:'health'|'info'|'fin_quant'|'fin_factor',stepN=1,loopN=1)=>{
  const script=await wslPath(rdScriptWindows)
  const safeCommand=command.replace(/[^a-z_]/g,'')
  const extra=(command==='fin_quant'||command==='fin_factor')?' '+Math.max(1,Math.floor(stepN))+' '+Math.max(1,Math.floor(loopN)):''
  const shell="tr -d '\\r' < '"+script+"' > /tmp/mta-run-rdagent.sh && chmod +x /tmp/mta-run-rdagent.sh && bash /tmp/mta-run-rdagent.sh "+safeCommand+extra
  const {stdout,stderr}=await execFileAsync('wsl.exe',['-e','bash','-lc',shell],{timeout:command==='health'||command==='info'?120000:3600000,windowsHide:true,maxBuffer:10*1024*1024})
  return {command,stdout:stdout.trim(),stderr:stderr.trim()}
}
