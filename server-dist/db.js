import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(join(config.dataDir, 'my-trading-agent.db'));
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
`);
export const setSetting = (key, value) => {
    db.prepare(`
    INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, value, new Date().toISOString());
};
export const getSetting = (key, fallback = '') => {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row?.value ?? fallback;
};
export const addEvent = (type, payload, agentId) => {
    const createdAt = new Date().toISOString();
    const result = db.prepare('INSERT INTO agent_events (type,agent_id,payload,created_at) VALUES (?,?,?,?)')
        .run(type, agentId ?? null, JSON.stringify(payload), createdAt);
    return { id: Number(result.lastInsertRowid), type, agentId, payload, createdAt };
};
export const recentEvents = (limit = 30) => {
    const rows = db.prepare('SELECT * FROM agent_events ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map(row => ({ id: row.id, type: row.type, agentId: row.agent_id, payload: JSON.parse(row.payload), createdAt: row.created_at }));
};
export const saveAnalysis = (agentId, asset, inputSummary, output, model) => {
    db.prepare('INSERT INTO agent_analysis (agent_id,asset,input_summary,output_json,model,created_at) VALUES (?,?,?,?,?,?)')
        .run(agentId, asset, inputSummary, JSON.stringify(output), model, new Date().toISOString());
};
export const openPaperTrade = (productId, side, size, price) => {
    const notional = size * price, openedAt = new Date().toISOString();
    const result = db.prepare('INSERT INTO paper_trades (product_id,side,size,price,notional,status,opened_at) VALUES (?,?,?,?,?,?,?)')
        .run(productId, side, size, price, notional, 'OPEN', openedAt);
    return { id: Number(result.lastInsertRowid), productId, side, size, price, notional, status: 'OPEN', openedAt };
};
export const listPaperTrades = () => db.prepare('SELECT * FROM paper_trades ORDER BY id DESC LIMIT 100').all();
export const openPaperNotional = () => {
    const row = db.prepare("SELECT COALESCE(SUM(notional),0) total FROM paper_trades WHERE status='OPEN'").get();
    return Number(row.total || 0);
};
