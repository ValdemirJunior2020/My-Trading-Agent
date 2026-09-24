import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'

mkdirSync(config.dataDir, { recursive: true })
const db = new DatabaseSync(join(config.dataDir, 'my-trading-agent.db'))

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  agent_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  output_json TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  side TEXT NOT NULL,
  size REAL NOT NULL,
  price REAL NOT NULL,
  notional REAL NOT NULL,
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  close_price REAL,
  pnl REAL
);
CREATE TABLE IF NOT EXISTS equity_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equity_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_equity_snapshots_created_at ON equity_snapshots(created_at);
`)

export const setSetting = (key: string, value: string) => {
  db.prepare(`
    INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, value, new Date().toISOString())
}
export const getSetting = (key: string, fallback = ''): string => {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value?: string } | undefined
  return row?.value ?? fallback
}
export const addEvent = (type: string, payload: unknown, agentId?: string) => {
  const createdAt = new Date().toISOString()
  const result = db.prepare('INSERT INTO agent_events (type,agent_id,payload,created_at) VALUES (?,?,?,?)')
    .run(type, agentId ?? null, JSON.stringify(payload), createdAt)
  return { id: Number(result.lastInsertRowid), type, agentId, payload, createdAt }
}
export const recentEvents = (limit = 30) => {
  const rows = db.prepare('SELECT * FROM agent_events ORDER BY id DESC LIMIT ?').all(limit) as Array<any>
  return rows.map(row => ({ id:row.id,type:row.type,agentId:row.agent_id,payload:JSON.parse(row.payload),createdAt:row.created_at }))
}
export const saveAnalysis = (agentId:string,asset:string,inputSummary:string,output:unknown,model:string) => {
  db.prepare('INSERT INTO agent_analysis (agent_id,asset,input_summary,output_json,model,created_at) VALUES (?,?,?,?,?,?)')
    .run(agentId,asset,inputSummary,JSON.stringify(output),model,new Date().toISOString())
}
export const openPaperTrade = (productId:string,side:string,size:number,price:number) => {
  const notional=size*price, openedAt=new Date().toISOString()
  const result=db.prepare('INSERT INTO paper_trades (product_id,side,size,price,notional,status,opened_at) VALUES (?,?,?,?,?,?,?)')
    .run(productId,side,size,price,notional,'OPEN',openedAt)
  return {id:Number(result.lastInsertRowid),productId,side,size,price,notional,status:'OPEN',openedAt}
}
export const listPaperTrades=()=>db.prepare('SELECT * FROM paper_trades ORDER BY id DESC LIMIT 100').all()
export const openPaperNotional=():number=>{
  const row=db.prepare("SELECT COALESCE(SUM(notional),0) total FROM paper_trades WHERE status='OPEN'").get() as {total:number}
  return Number(row.total||0)
}


export const liveTradeHistory=(limit=200)=>{
  const bounded=Math.max(1,Math.min(1000,Math.floor(limit)))
  const rows=db.prepare(`
    SELECT * FROM agent_events
    WHERE type IN (
      'live_order_placed',
      'live_order_failed',
      'live_order_rejected',
      'live_order_preview_rejected',
      'live_order_preview_approved',
      'live_execution_cycle',
      'capital_rotation_plan',
      'capital_rotation_plan_failed'
    )
    ORDER BY id DESC
    LIMIT ?
  `).all(bounded) as Array<any>
  return rows.map(row=>({
    id:row.id,
    type:row.type,
    agentId:row.agent_id,
    payload:JSON.parse(row.payload),
    createdAt:row.created_at
  }))
}


export const clearLiveTradeHistory=()=>{
  const result=db.prepare(`
    DELETE FROM agent_events
    WHERE type IN (
      'live_order_placed',
      'live_order_failed',
      'live_order_rejected',
      'live_order_preview_rejected',
      'live_order_preview_approved',
      'live_execution_cycle'
    )
  `).run()
  return {deleted:Number(result.changes||0)}
}


export const livePlacedOrders=(limit=2000)=>{
  const bounded=Math.max(1,Math.min(5000,Math.floor(limit)))
  const rows=db.prepare(`
    SELECT * FROM agent_events
    WHERE type='live_order_placed'
    ORDER BY id ASC
    LIMIT ?
  `).all(bounded) as Array<any>
  return rows.map(row=>({
    id:row.id,
    type:row.type,
    agentId:row.agent_id,
    payload:JSON.parse(row.payload),
    createdAt:row.created_at
  }))
}


export const addEquitySnapshot=(equityUsd:number,createdAt=new Date().toISOString())=>{
  const value=Number(equityUsd)
  if(!Number.isFinite(value)||value<=0) throw new Error('Equity snapshot must be positive.')
  const result=db.prepare('INSERT INTO equity_snapshots (equity_usd,created_at) VALUES (?,?)').run(value,createdAt)
  return {id:Number(result.lastInsertRowid),equityUsd:value,createdAt}
}

export const pruneEquitySnapshots=(beforeIso:string)=>{
  const result=db.prepare('DELETE FROM equity_snapshots WHERE created_at < ?').run(beforeIso)
  return Number(result.changes||0)
}

export const equitySnapshotsSince=(sinceIso:string)=>{
  const rows=db.prepare('SELECT id,equity_usd,created_at FROM equity_snapshots WHERE created_at >= ? ORDER BY created_at ASC').all(sinceIso) as Array<any>
  return rows.map(row=>({id:Number(row.id),equityUsd:Number(row.equity_usd),createdAt:String(row.created_at)}))
}
