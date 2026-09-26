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
CREATE INDEX IF NOT EXISTS idx_agent_events_type_id ON agent_events(type,id);
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
  const hiddenBeforeId=Math.max(0,Number(getSetting('live_history_hidden_before_id','0'))||0)
  const rows=db.prepare(`
    SELECT * FROM agent_events
    WHERE id > ?
      AND type IN (
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
  `).all(hiddenBeforeId,bounded) as Array<any>

  const placedRows=db.prepare(`
    SELECT payload
    FROM agent_events
    WHERE type='live_order_placed'
    ORDER BY id ASC
  `).all() as Array<any>

  const buysByOrderId=new Map<string,any>()
  for(const placedRow of placedRows){
    try{
      const payload=JSON.parse(placedRow.payload)
      if(String(payload?.side||'').toUpperCase()!=='BUY')continue
      const orderId=String(payload?.orderId||'')
      if(orderId)buysByOrderId.set(orderId,payload)
    }catch{}
  }

  return rows.map(row=>{
    const payload=JSON.parse(row.payload)

    if(
      row.type==='live_order_placed' &&
      String(payload?.side||'').toUpperCase()==='SELL' &&
      payload?.realizedNetProfitUsd==null &&
      payload?.sourceLotOrderId
    ){
      const buy=buysByOrderId.get(String(payload.sourceLotOrderId))
      const sellPrice=Number(payload.actualFillPrice||payload.preview?.est_average_filled_price||0)
      const sellQty=Number(payload.executedQty||payload.preview?.base_size||0)
      const sellFee=Number(payload.preview?.commission_total||0)
      const buyPrice=Number(buy?.actualFillPrice||buy?.preview?.est_average_filled_price||0)
      const buyQty=Number(buy?.executedQty||buy?.preview?.base_size||0)
      const buyFee=Number(buy?.preview?.commission_total||0)

      if(buy && sellPrice>0 && sellQty>0 && buyPrice>0 && buyQty>0){
        const buyUnitCost=((buyPrice*buyQty)+buyFee)/buyQty
        const costBasis=buyUnitCost*sellQty
        const netProceeds=(sellPrice*sellQty)-sellFee
        const netProfit=netProceeds-costBasis
        payload.realizedNetProfitUsd=netProfit
        payload.realizedNetProfitPercent=costBasis>0?(netProfit/costBasis)*100:0
        payload.realizedNetProceedsUsd=netProceeds
        payload.sellCostBasisUsd=costBasis
      }
    }

    return {
      id:row.id,
      type:row.type,
      agentId:row.agent_id,
      payload,
      createdAt:row.created_at
    }
  })
}


export const realizedProfitHistory=()=>{
  const placedRows=db.prepare(`
    SELECT * FROM agent_events
    WHERE type='live_order_placed'
    ORDER BY id ASC
  `).all() as Array<any>

  const buysByOrderId=new Map<string,any>()
  const parsed=placedRows.map(row=>({
    id:Number(row.id),
    type:String(row.type),
    agentId:String(row.agent_id||''),
    payload:JSON.parse(row.payload),
    createdAt:String(row.created_at)
  }))

  for(const row of parsed){
    const payload=row.payload||{}
    if(String(payload.side||'').toUpperCase()!=='BUY')continue
    const orderId=String(payload.orderId||'')
    if(orderId)buysByOrderId.set(orderId,payload)
  }

  const trades:any[]=[]
  for(const row of parsed){
    const payload={...(row.payload||{})}
    if(String(payload.side||'').toUpperCase()!=='SELL')continue

    const sourceLotOrderId=String(payload.sourceLotOrderId||'')
    const buy=sourceLotOrderId?buysByOrderId.get(sourceLotOrderId):null

    let costBasis=Number(payload.sellCostBasisUsd)
    let netProceeds=Number(payload.realizedNetProceedsUsd)
    let netProfit=Number(payload.realizedNetProfitUsd)
    let netProfitPercent=Number(payload.realizedNetProfitPercent)

    if((!Number.isFinite(netProfit)||!Number.isFinite(netProfitPercent))&&buy){
      const sellPrice=Number(payload.actualFillPrice||payload.preview?.est_average_filled_price||0)
      const sellQty=Number(payload.executedQty||payload.preview?.base_size||0)
      const sellFee=Number(payload.preview?.commission_total||0)
      const buyPrice=Number(buy.actualFillPrice||buy.preview?.est_average_filled_price||0)
      const buyQty=Number(buy.executedQty||buy.preview?.base_size||0)
      const buyFee=Number(buy.preview?.commission_total||0)

      if(sellPrice>0&&sellQty>0&&buyPrice>0&&buyQty>0){
        const buyUnitCost=((buyPrice*buyQty)+buyFee)/buyQty
        costBasis=buyUnitCost*sellQty
        netProceeds=(sellPrice*sellQty)-sellFee
        netProfit=netProceeds-costBasis
        netProfitPercent=costBasis>0?(netProfit/costBasis)*100:0
      }
    }

    if(!Number.isFinite(netProfit)||!Number.isFinite(netProfitPercent))continue

    trades.push({
      id:row.id,
      productId:String(payload.productId||''),
      sourceLotOrderId,
      sellOrderId:String(payload.orderId||''),
      boughtForUsd:Number.isFinite(costBasis)?costBasis:null,
      soldForUsd:Number.isFinite(netProceeds)?netProceeds:null,
      profitUsd:netProfit,
      profitPercent:netProfitPercent,
      exitReason:String(payload.exitReason||''),
      createdAt:row.createdAt
    })
  }

  const totalNetProfitUsd=trades.reduce((sum,row)=>sum+Number(row.profitUsd||0),0)
  const profitOnlyUsd=trades.filter(row=>Number(row.profitUsd)>0).reduce((sum,row)=>sum+Number(row.profitUsd||0),0)
  const soldLowerUsd=Math.abs(trades.filter(row=>Number(row.profitUsd)<0).reduce((sum,row)=>sum+Number(row.profitUsd||0),0))

  return {
    totalNetProfitUsd,
    profitOnlyUsd,
    soldLowerUsd,
    completedTrades:trades.length,
    profitableTrades:trades.filter(row=>Number(row.profitUsd)>0).length,
    trades:trades.sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())
  }
}

export const restoreLiveTradeHistory=()=>{
  setSetting('live_history_hidden_before_id','0')
  const row=db.prepare(`
    SELECT COUNT(*) AS count
    FROM agent_events
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
  `).get() as {count:number}
  return {restored:Number(row?.count||0)}
}

export const clearLiveTradeHistory=()=>{
  // Clear only the journal VIEW. Do not delete execution events because
  // live_order_placed events are also used to reconstruct bot-managed positions.
  const row=db.prepare(`
    SELECT COALESCE(MAX(id),0) AS max_id, COUNT(*) AS count
    FROM agent_events
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
  `).get() as {max_id:number;count:number}

  const maxId=Math.max(0,Number(row?.max_id||0))
  setSetting('live_history_hidden_before_id',String(maxId))
  return {deleted:0,hidden:Number(row?.count||0)}
}


export const latestLiveOrderEvent=()=>{
  const row=db.prepare(`
    SELECT * FROM agent_events
    WHERE type IN (
      'live_order_placed',
      'live_order_failed',
      'live_order_rejected',
      'live_order_preview_rejected'
    )
    ORDER BY id DESC
    LIMIT 1
  `).get() as any
  if(!row)return null
  return {
    id:row.id,
    type:row.type,
    agentId:row.agent_id,
    payload:JSON.parse(row.payload),
    createdAt:row.created_at
  }
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
