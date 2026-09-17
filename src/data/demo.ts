import type { Agent } from '../types'

export const agents: Agent[] = [
  { id:'market', icon:'⌁', nameKey:'marketAnalyst', roomKey:'marketRoom', taskKey:'analyzeBtc', asset:'BTC-USD', status:'working', detailKey:'marketDetail', lastKey:'lastMarket', startedAt:'14:28:17', ollama:true, gridArea:'market' },
  { id:'risk', icon:'◇', nameKey:'riskManager', roomKey:'riskRoom', taskKey:'checkSize', asset:'BTC-USD', status:'working', detailKey:'riskDetail', lastKey:'lastRisk', startedAt:'14:29:02', ollama:false, gridArea:'risk' },
  { id:'strategy', icon:'⌬', nameKey:'strategyResearcher', roomKey:'strategyRoom', taskKey:'testIdea', asset:'BTC-USD', status:'working', detailKey:'strategyDetail', lastKey:'lastStrategy', startedAt:'14:29:24', ollama:true, gridArea:'strategy' },
  { id:'sentiment', icon:'◉', nameKey:'sentimentAnalyst', roomKey:'sentimentRoom', taskKey:'scanSentiment', asset:'MARKET', status:'working', detailKey:'sentimentDetail', lastKey:'lastSentiment', startedAt:'14:28:43', ollama:true, gridArea:'sentiment' },
  { id:'critic', icon:'⚑', nameKey:'tradeCritic', roomKey:'criticRoom', taskKey:'reviewTrade', asset:'BTC-USD', status:'reviewing', detailKey:'criticDetail', lastKey:'lastCritic', startedAt:'14:32:14', ollama:true, gridArea:'critic' },
  { id:'manager', icon:'▣', nameKey:'agentManager', roomKey:'managerRoom', taskKey:'systemNormal', asset:'SYSTEM', status:'working', detailKey:'managerDetail', lastKey:'lastManager', startedAt:'14:26:00', ollama:false, gridArea:'manager' },
  { id:'backtest', icon:'↻', nameKey:'backtestingLab', roomKey:'backtestingRoom', taskKey:'runBacktest', asset:'BTC-USD', status:'working', detailKey:'backtestDetail', lastKey:'lastBacktest', startedAt:'14:31:02', ollama:false, gridArea:'backtest' },
  { id:'portfolio', icon:'▤', nameKey:'portfolioManager', roomKey:'portfolioRoom', taskKey:'checkExposure', asset:'PORTFOLIO', status:'working', detailKey:'portfolioDetail', lastKey:'lastPortfolio', startedAt:'14:30:57', ollama:true, gridArea:'portfolio' },
  { id:'paper', icon:'◫', nameKey:'paperTrader', roomKey:'paperRoom', taskKey:'simulateExecution', asset:'ETH-USD', status:'approved', detailKey:'paperDetail', lastKey:'lastPaper', startedAt:'14:31:20', ollama:false, gridArea:'paper' },
  { id:'decision', icon:'★', nameKey:'finalDecisionAgent', roomKey:'decisionRoom', taskKey:'compareReports', asset:'BTC-USD', status:'waiting', detailKey:'decisionDetail', lastKey:'lastDecision', startedAt:'14:31:33', ollama:true, gridArea:'decision' },
  { id:'execution', icon:'⇄', nameKey:'executionAgent', roomKey:'executionRoom', taskKey:'readyOrders', asset:'PAPER', status:'idle', detailKey:'executionDetail', lastKey:'lastExecution', startedAt:'14:25:11', ollama:false, gridArea:'execution' }
]

export const watchlist = [
  ['BTC-USD', '67,432.18', '+1.94%'], ['ETH-USD', '3,248.71', '+2.59%'], ['SOL-USD', '156.32', '+3.45%'], ['BNB-USD', '597.14', '-0.54%'], ['ADA-USD', '0.4721', '+1.81%']
]

export const activities = [
  ['14:32:18', 'Execution Agent', 'Paper order book updated', 'ok'],
  ['14:32:14', 'Trade Critic', 'Reviewing BTC trade proposal', 'warn'],
  ['14:31:52', 'Backtesting Lab', 'Strategy test completed — 68.4%', 'ok'],
  ['14:31:33', 'Final Decision', 'WAIT on BTC-USD', 'warn'],
  ['14:31:20', 'Paper Trader', 'ETH paper trade opened', 'ok'],
  ['14:30:57', 'Risk Manager', 'Position size within hard limits', 'ok']
]
