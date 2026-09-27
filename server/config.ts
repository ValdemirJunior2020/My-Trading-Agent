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

export const PRODUCTION_STRATEGY = Object.freeze({
  buyStepUsd: 5,
  targetBuyPercent: 10,
  maxPerProductPercent: 10,
  maxTotalExposurePercent: 100,
  maxConcurrentPositions: 999,
  hardStopLossPercent: 0.8,
  minimumNetProfitUsd: 0.10,
  trailingActivationNetPercent: 8,
  trailingDistancePercent: 1.5,
  maxEntrySlippagePercent: 0.1,
  macroTimeframeMinutes: 10,
  macroBollingerPeriod: 20,
  entryRsiStrictlyBelow: 30,
  volumeLookbackCandles: 20,
  minimumVolumeRatio: 1.5,
  rollingKillSwitchPercent: 3,
  rollingKillSwitchWindowHours: 24
})

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
  tradingMode: process.env.TRADING_MODE || 'disabled',
  liveTradingEnabled: bool(process.env.COINBASE_LIVE_TRADING_ENABLED, false),
  autoTradingEnabled: bool(process.env.AUTO_TRADING_ENABLED, false),
  manualApprovalRequired: bool(process.env.MANUAL_APPROVAL_REQUIRED, true),
  maxPositionPercent: PRODUCTION_STRATEGY.maxPerProductPercent,
  maxDailyLossPercent: num(process.env.MAX_DAILY_LOSS_PERCENT, 2),
  maxTotalExposurePercent: PRODUCTION_STRATEGY.maxTotalExposurePercent,
  maxOpenBotPositions: PRODUCTION_STRATEGY.maxConcurrentPositions,
  targetBuyPercent: PRODUCTION_STRATEGY.targetBuyPercent,
  buyStepUsd: PRODUCTION_STRATEGY.buyStepUsd,
  // Dynamic sizing uses available cash + runtime exposure limits.
  // This legacy field is retained as a very high compatibility ceiling only.
  maxLiveOrderUsd: 1_000_000,
  minLiveOrderUsd: num(process.env.MIN_LIVE_ORDER_USD, 1),
  autoTradeCooldownSeconds: Math.max(60, num(process.env.AUTO_TRADE_COOLDOWN_SECONDS, 900)),
  autoTradeMinConfidencePercent: Math.max(0, Math.min(100, num(process.env.AUTO_TRADE_MIN_CONFIDENCE_PERCENT, 70))),
  scannerCacheMs: Math.max(5000, num(process.env.SCANNER_CACHE_MS, 15000)),
  backtestMarketFeeRate: Math.max(0, Math.min(0.05, num(process.env.BACKTEST_MARKET_FEE_RATE, 0.006))),
  strategyGranularity: process.env.STRATEGY_GRANULARITY || 'FIVE_MINUTE',
  bbPeriod: Math.max(5, Math.floor(num(process.env.BB_PERIOD, 20))),
  bbStdDev: Math.max(0.5, num(process.env.BB_STD_DEV, 2)),
  rsiPeriod: Math.max(2, Math.floor(num(process.env.RSI_PERIOD, 14))),
  rsiOversold: Math.max(1, Math.min(50, num(process.env.RSI_OVERSOLD, 35))),
  entryProximityPercent: Math.max(0, Math.min(2, num(process.env.ENTRY_PROXIMITY_PERCENT, 0.25))),
  smallAccountMode: bool(process.env.SMALL_ACCOUNT_MODE, true),
  capitalPreservationMode: bool(process.env.CAPITAL_PRESERVATION_MODE, true),
  smallAccountStrongRsi: Math.max(1, Math.min(35, num(process.env.SMALL_ACCOUNT_STRONG_RSI, 30))),
  smallAccountStrongProximityPercent: Math.max(0.1, Math.min(2, num(process.env.SMALL_ACCOUNT_STRONG_PROXIMITY_PERCENT, 0.9))),
  smallAccountNormalProximityPercent: Math.max(0.1, Math.min(1.5, num(process.env.SMALL_ACCOUNT_NORMAL_PROXIMITY_PERCENT, 0.4))),
  smallAccountMinDollarVolume24h: Math.max(1_000_000, num(process.env.SMALL_ACCOUNT_MIN_DOLLAR_VOLUME_24H, 10_000_000)),
  smallAccountMaxBuyUsd: 1_000_000,
  smallAccountMinNetProfitUsd: PRODUCTION_STRATEGY.minimumNetProfitUsd,
  takeProfitPercent: Math.max(0.2, Math.min(10, num(process.env.TAKE_PROFIT_PERCENT, 1.5))),
  maxRequiredGrossProfitPercent: Math.max(1, Math.min(10, num(process.env.MAX_REQUIRED_GROSS_PROFIT_PERCENT, 4))),
  fixedStopLossPercent: PRODUCTION_STRATEGY.hardStopLossPercent,
  trailingActivationNetPercent: PRODUCTION_STRATEGY.trailingActivationNetPercent,
  trailingDistancePercent: PRODUCTION_STRATEGY.trailingDistancePercent,
  entryRsiStrictlyBelow: PRODUCTION_STRATEGY.entryRsiStrictlyBelow,
  entryVolumeLookbackCandles: PRODUCTION_STRATEGY.volumeLookbackCandles,
  entryMinimumVolumeRatio: PRODUCTION_STRATEGY.minimumVolumeRatio,
  macroTimeframeMinutes: PRODUCTION_STRATEGY.macroTimeframeMinutes,
  macroBollingerPeriod: PRODUCTION_STRATEGY.macroBollingerPeriod,
  rollingKillSwitchPercent: PRODUCTION_STRATEGY.rollingKillSwitchPercent,
  rollingKillSwitchWindowMs: PRODUCTION_STRATEGY.rollingKillSwitchWindowHours * 60 * 60 * 1000,
  maxSlippagePercent: PRODUCTION_STRATEGY.maxEntrySlippagePercent,
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