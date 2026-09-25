/// <reference types="node" />
import 'dotenv/config'

const bool = (value: string | undefined, fallback = false) => {
  if (value == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  host: process.env.SERVER_HOST || '127.0.0.1',
  port: num(process.env.SERVER_PORT, 8787),
  dataDir: process.env.DATA_DIR || 'data',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || '',
  cdpApiKeyId: process.env.CDP_API_KEY_ID || '',
  cdpApiKeySecret: process.env.CDP_API_KEY_SECRET || '',
  coinbaseApiBaseUrl: process.env.COINBASE_API_BASE_URL || 'https://api.coinbase.com',
  coinbasePortfolioUuid: process.env.COINBASE_PORTFOLIO_UUID || '',
  tradingMode: process.env.TRADING_MODE || 'paper',
  liveTradingEnabled: bool(process.env.COINBASE_LIVE_TRADING_ENABLED, false),
  autoTradingEnabled: bool(process.env.AUTO_TRADING_ENABLED, false),
  manualApprovalRequired: bool(process.env.MANUAL_APPROVAL_REQUIRED, true),
  paperStartingBalanceUsd: num(process.env.PAPER_STARTING_BALANCE_USD, 10000),
  maxPositionPercent: num(process.env.MAX_POSITION_PERCENT, 5),
  maxDailyLossPercent: num(process.env.MAX_DAILY_LOSS_PERCENT, 2),
  maxTotalExposurePercent: num(process.env.MAX_TOTAL_EXPOSURE_PERCENT, 25),
  maxLiveOrderUsd: num(process.env.MAX_LIVE_ORDER_USD, 25),
  minLiveOrderUsd: num(process.env.MIN_LIVE_ORDER_USD, 1),
  autoTradeCooldownSeconds: Math.max(60, num(process.env.AUTO_TRADE_COOLDOWN_SECONDS, 900)),
  autoTradeMinConfidencePercent: Math.max(0, Math.min(100, num(process.env.AUTO_TRADE_MIN_CONFIDENCE_PERCENT, 70))),
  scannerCacheMs: Math.max(5000, num(process.env.SCANNER_CACHE_MS, 15000)),
  strategyGranularity: process.env.STRATEGY_GRANULARITY || 'FIVE_MINUTE',
  bbPeriod: Math.max(5, Math.floor(num(process.env.BB_PERIOD, 20))),
  bbStdDev: Math.max(0.5, num(process.env.BB_STD_DEV, 2)),
  rsiPeriod: Math.max(2, Math.floor(num(process.env.RSI_PERIOD, 14))),
  rsiOversold: Math.max(1, Math.min(50, num(process.env.RSI_OVERSOLD, 35))),
  entryProximityPercent: Math.max(0, Math.min(2, num(process.env.ENTRY_PROXIMITY_PERCENT, 0.25))),
  takeProfitPercent: Math.max(0.2, Math.min(10, num(process.env.TAKE_PROFIT_PERCENT, 1.5))),
  fixedStopLossPercent: 0.8,
  rollingKillSwitchPercent: 3,
  rollingKillSwitchWindowMs: 24 * 60 * 60 * 1000,
  maxSlippagePercent: Math.max(0.01, Math.min(5, num(process.env.MAX_SLIPPAGE_PERCENT, 0.1))),
  watchlist: (process.env.WATCHLIST || 'XRP,BTC,ETH,SOL,LINK')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((s) => (s.includes('-') ? s : s + '-USD'))
}

export const coinbaseConfigured = () =>
  Boolean(
    config.cdpApiKeyId &&
      config.cdpApiKeySecret &&
      !config.cdpApiKeyId.includes('YOUR_') &&
      !config.cdpApiKeySecret.includes('YOUR_PRIVATE_KEY_HERE')
  )

export const coinbaseCredentialShape = () => ({
  configured: coinbaseConfigured(),
  keyNameLooksFull: /^organizations\/[^/]+\/apiKeys\/[^/]+$/.test(config.cdpApiKeyId),
  secretLooksPem:
    /BEGIN (EC |)PRIVATE KEY/.test(config.cdpApiKeySecret.replace(/\\n/g, '\n')) ||
    config.cdpApiKeySecret.startsWith('-----BEGIN PRIVATE KEY-----')
})