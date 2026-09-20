import { FormEvent,useMemo,useState } from 'react'
import type { Language } from '../types'
import { api } from '../lib/api'

interface Message {role:'user'|'assistant';text:string}
interface Props {language:Language}

export function ToolCopilot({language}:Props){
  const [open,setOpen]=useState(false)
  const [input,setInput]=useState('')
  const [busy,setBusy]=useState(false)
  const [messages,setMessages]=useState<Message[]>([])
  const labels=useMemo(()=>language==='pt'?{
    title:'Tool Copilot',
    subtitle:'Pergunte o que está acontecendo',
    placeholder:'Ex: o que está errado agora?',
    send:'Enviar',
    thinking:'Analisando...',
    hello:'Posso explicar o que está acontecendo, checar conexões e dizer o que a ferramenta ainda precisa melhorar.',
    quick:['O que está acontecendo agora?','A ferramenta precisa de alguma coisa?','Quais engines estão offline?','O que devo melhorar primeiro?']
  }:{
    title:'Tool Copilot',
    subtitle:'Ask what is happening',
    placeholder:'Example: what is wrong right now?',
    send:'Send',
    thinking:'Analyzing...',
    hello:'I can explain what is happening, check connections, and tell you what the tool still needs to improve.',
    quick:['What is happening right now?','Does the tool need anything?','Which engines are offline?','What should I improve first?']
  },[language])

  const ask=async(text:string)=>{
    const question=text.trim()
    if(!question||busy)return
    setMessages(prev=>[...prev,{role:'user',text:question}])
    setInput('')
    setBusy(true)
    try{
      const result=await api.copilotChat({message:question,language})
      setMessages(prev=>[...prev,{role:'assistant',text:result.answer}])
    }catch(error){
      const detail=error instanceof Error?error.message:String(error)
      const answer=language==='pt'?'Não consegui responder: '+detail:'I could not answer: '+detail
      setMessages(prev=>[...prev,{role:'assistant',text:answer}])
    }finally{setBusy(false)}
  }

  const submit=(event:FormEvent)=>{event.preventDefault();void ask(input)}

  return <>
    <button className="copilot-fab" onClick={()=>setOpen(v=>!v)} aria-label={labels.title}>✦</button>
    {open&&<aside className="copilot-panel">
      <header><div><strong>{labels.title}</strong><small>{labels.subtitle}</small></div><button onClick={()=>setOpen(false)}>×</button></header>
      <div className="copilot-messages">
        {messages.length===0&&<div className="copilot-message assistant">{labels.hello}</div>}
        {messages.map((message,index)=><div className={'copilot-message '+message.role} key={index}>{message.text}</div>)}
        {busy&&<div className="copilot-message assistant">{labels.thinking}</div>}
      </div>
      <div className="copilot-quick">{labels.quick.map(q=><button key={q} onClick={()=>void ask(q)} disabled={busy}>{q}</button>)}</div>
      <form onSubmit={submit}><textarea value={input} onChange={e=>setInput(e.target.value)} placeholder={labels.placeholder} rows={3}/><button disabled={busy||!input.trim()}>{labels.send}</button></form>
    </aside>}
  </>
}
