import { config, coinbaseConfigured } from './config.js'
import { getCandles, getProduct, listAccounts } from './coinbase.js'
import { publish } from './events.js'
import { runAgent } from './ollama.js'
import { quantStatus, runNautilusSmoke, runRdAgent, runVectorbtValidation } from './quant.js'
import { saveAnalysis } from './db.js'
import { getChallengeSnapshot } from './challenge.js'
import { tryLimitedLiveExecution } from './risk.js'
import { scanCryptoMarket } from './scanner.js'
import { evaluateBollingerRsiStrategy } from './bollingerStrategy.js'

type AgentResult = { model: string; output: any }
type PipelineOptions = { productId?: string; deepResearch?: boolean }
type PipelineState = {
  status: 'idle' | 'running' | 'completed' | 'failed'
  productId: string
  deepResearch: boolean
  currentAgent: string | null
  completedAgents: string[]
  decision: string | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

const MAIN_AGENTS = ['market', 'strategy', 'sentiment', 'portfolio', 'risk', 'critic', 'decision']
let pipelineState: PipelineState = {
  status: 'idle',
  productId: 'BTC-USD',
  deepResearch: false,
  currentAgent: null,
  completedAgents: [],
  decision: null,
  error: null,
  startedAt: null,
  finishedAt: null
}

export const getPipelineStatus = () => ({ ...pipelineState, completedAgents: [...pipelineState.completedAgents] })

const pct = (a: number, b: number) => (b === 0 ? 0 : ((a - b) / b) * 100)
const safe = (value: unknown) => JSON.stringify(value).slice(0, 12000)

const agentStep = async (agentId: string, asset: string, evidence: unknown) => {
  pipelineState = { ...pipelineState, currentAgent: agentId }
  publish('agent_started', { asset }, agentId)
  try {
    const result = (await runAgent(agentId, asset, safe(evidence))) as AgentResult
    saveAnalysis(agentId, asset, safe(evidence), result.output, result.model)
    publish('agent_completed', { asset, output: result.output }, agentId)
    if (MAIN_AGENTS.includes(agentId) && !pipelineState.completedAgents.includes(agentId)) {
      pipelineState = { ...pipelineState, completedAgents: [...pipelineState.completedAgents, agentId] }
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publish('agent_failed', { asset, error: message }, agentId)
    throw error
  }
}

const runFullAgentPipelineInternal = async (options: PipelineOptions = {}) => {
  const productId = (options.productId || 'BTC-USD').toUpperCase()
  const deepResearch = Boolean(options.deepResearch)
  if (!coinbaseConfigured()) {
    throw new Error('Coinbase is not configured. Add your CDP key to .env before running the real agent pipeline.')
  }

  publish('pipeline_started', { productId, deepResearch }, 'manager')

  const [product, candles, backtestCandles, accounts, engineStatus, challenge] = await Promise.all([
    getProduct(productId),
    getCandles(productId, 'ONE_HOUR', 120),
    getCandles(productId, 'ONE_HOUR', 3000),
    listAccounts(),
    quantStatus(),
    getChallengeSnapshot()
  ])
  const engines: any = engineStatus

  if (candles.length < 40) {
    throw new Error('Only ' + candles.length + ' Coinbase candles were returned; at least 40 are required.')
  }

  const closes = candles.map((c) => c.close)
  const backtestCloses = backtestCandles.map((c) => c.close)
  const backtestTimestamps = backtestCandles.map((c) => c.start)
  const latest = candles.at(-1)!
  const previous = candles.at(-2)!
  const dayAgo = candles[Math.max(0, candles.length - 25)]
  const weekAgo = candles[Math.max(0, candles.length - 120)]
  const highs = candles.slice(-24).map((c) => c.high)
  const lows = candles.slice(-24).map((c) => c.low)
  const avgVolume = candles.slice(-24).reduce((sum, c) => sum + c.volume, 0) / Math.min(24, candles.length)

  const [scanSnapshot, deterministicStrategy] = await Promise.all([
    scanCryptoMarket([productId]),
    evaluateBollingerRsiStrategy(productId)
  ])
  const technicalSignal = scanSnapshot.results.find((row:any)=>row.productId===productId) || null
  publish('deterministic_strategy_evaluated', deterministicStrategy, 'strategy')

  const marketEvidence = {
    source: 'Coinbase Advanced Trade',
    technicalSignal,
    deterministicStrategy,
    productId,
    latestPrice: latest.close,
    change1hPercent: pct(latest.close, previous.close),
    change24hPercent: pct(latest.close, dayAgo.close),
    changeWindowPercent: pct(latest.close, weekAgo.close),
    high24h: Math.max(...highs),
    low24h: Math.min(...lows),
    latestVolume: latest.volume,
    average24hVolume: avgVolume,
    candleCount: candles.length,
    product,
    challenge
  }

  const market = await agentStep('market', productId, marketEvidence)

  publish('agent_started', { asset: productId, engine: 'vectorbt' }, 'backtest')
  let vectorbt: any = { available: false }
  if (engines.vectorbt?.installed) {
    try {
      const initialCash = Number(challenge.startingBalanceUsd) || 100
      const parameterSets = [
        { fast: 5, slow: 20 },
        { fast: 10, slow: 30 },
        { fast: 20, slow: 50 },
        { fast: 30, slow: 100 }
      ]
      const validation = await runVectorbtValidation({
        prices: backtestCloses,
        timestamps: backtestTimestamps,
        initialCash,
        parameterSets
      })
      vectorbt = {
        available: true,
        candleCount: backtestCandles.length,
        granularity: 'ONE_HOUR',
        initialCash,
        parameterSets,
        ...validation
      }
      publish('agent_completed', { asset: productId, engine: 'vectorbt', result: vectorbt }, 'backtest')
    } catch (error) {
      vectorbt = { available: false, error: error instanceof Error ? error.message : String(error) }
      publish('agent_failed', { asset: productId, engine: 'vectorbt', error: vectorbt.error }, 'backtest')
    }
  } else {
    publish('agent_failed', { asset: productId, engine: 'vectorbt', error: 'VectorBT not installed.' }, 'backtest')
  }

  let nautilus: any = { available: false }
  if (engines.nautilusTrader?.installed) {
    try {
      nautilus = { available: true, ...(await runNautilusSmoke()) }
      publish('nautilus_validation_completed', { asset: productId, result: nautilus }, 'backtest')
    } catch (error) {
      nautilus = { available: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  let rdAgent: any = { available: Boolean(engines.rdAgent?.installed), ran: false }
  if (deepResearch && engines.rdAgent?.installed) {
    publish('agent_started', { asset: productId, engine: 'rdagent' }, 'strategy')
    try {
      rdAgent = { available: true, ran: true, ...(await runRdAgent('fin_factor', 1, 1)) }
      publish('agent_completed', { asset: productId, engine: 'rdagent' }, 'strategy')
    } catch (error) {
      rdAgent = { available: true, ran: false, error: error instanceof Error ? error.message : String(error) }
      publish('agent_failed', { asset: productId, engine: 'rdagent', error: rdAgent.error }, 'strategy')
    }
  }

  const strategy = await agentStep('strategy', productId, {
    market: market.output,
    technicalSignal,
    deterministicStrategy,
    vectorbt,
    nautilus,
    rdAgent
  })

  const sentiment = await agentStep('sentiment', productId, {
    market: market.output,
    note: 'No external news feed is configured. Assess only price/volume context and explicitly flag the absence of news sentiment data.'
  })

  const usdAccount = accounts.find((a: any) => a.currency === 'USD')
  const baseCurrency = productId.split('-')[0]
  const assetAccount = accounts.find((a: any) => a.currency === baseCurrency)
  const portfolio = await agentStep('portfolio', productId, {
    market: market.output,
    strategy: strategy.output,
    balances: {
      usd: usdAccount?.availableBalance || null,
      asset: assetAccount?.availableBalance || null
    },
    accountCount: accounts.length,
    challenge
  })

  const risk = await agentStep('risk', productId, {
    market: market.output,
    strategy: strategy.output,
    technicalSignal,
    deterministicStrategy,
    portfolio: portfolio.output,
    challenge,
    hardLimits: 'The deterministic server risk engine remains authoritative and cannot be overridden by the challenge or AI.'
  })

  const critic = await agentStep('critic', productId, {
    market: market.output,
    strategy: strategy.output,
    technicalSignal,
    deterministicStrategy,
    sentiment: sentiment.output,
    portfolio: portfolio.output,
    risk: risk.output,
    vectorbt
  })

  const agentDecisions = [
    market.output?.decision,
    strategy.output?.decision,
    sentiment.output?.decision,
    portfolio.output?.decision,
    risk.output?.decision,
    critic.output?.decision
  ].map((x:any)=>String(x||'WAIT').toUpperCase())

  const buyVotes = agentDecisions.filter((x:string)=>x==='BUY_CANDIDATE').length
  const sellVotes = agentDecisions.filter((x:string)=>x==='SELL_CANDIDATE').length
  const rejectVotes = agentDecisions.filter((x:string)=>x==='REJECT').length
  const riskReject = String(risk.output?.decision||'').toUpperCase()==='REJECT'
  const criticReject = String(critic.output?.decision||'').toUpperCase()==='REJECT'

  const deterministicConsensus = {
    scannerBuyCandidate:Boolean(technicalSignal?.buyCandidate),
    scannerSellCandidate:Boolean(technicalSignal?.sellCandidate),
    scannerBuyScore:Number(technicalSignal?.buyScore||0),
    scannerSellScore:Number(technicalSignal?.sellScore||0),
    buyVotes,
    sellVotes,
    rejectVotes,
    riskReject,
    criticReject,
    buyEligible:Boolean(technicalSignal?.buyCandidate && !riskReject && !criticReject),
    sellEligible:Boolean(technicalSignal?.sellCandidate && !riskReject && !criticReject)
  }

  const decision = await agentStep('decision', productId, {
    market: market.output,
    technicalSignal,
    deterministicStrategy,
    deterministicConsensus,
    strategy: strategy.output,
    sentiment: sentiment.output,
    portfolio: portfolio.output,
    risk: risk.output,
    critic: critic.output,
    quantitativeValidation: { vectorbt, nautilus, rdAgent },
    challenge,
    instruction: [
      'Return one evidence-based classification using the decision rubric.',
      'Do not default to WAIT or REJECT merely because trading is uncertain.',
      'Use BUY_CANDIDATE when deterministicConsensus.buyEligible is true unless you identify a concrete hard invalidation in risk or critic evidence.',
      'Use SELL_CANDIDATE when deterministicConsensus.sellEligible is true and the asset is actually held unless you identify a concrete hard invalidation in risk or critic evidence.',
      'Use WAIT for genuinely mixed or incomplete timing evidence.',
      'Use REJECT only for a concrete invalidation or contradiction.',
      'Treat the challenge as a goal, never as permission to increase risk.',
      'Do not claim an order was placed; deterministic server checks decide whether any candidate may proceed.'
    ].join(' ')
  })

  const rawDecision = String(decision.output?.decision || 'WAIT').toUpperCase()
  const strategyAction = String((deterministicStrategy as any)?.action || 'NONE').toUpperCase()

  let resolvedDecisionOutput:any = {
    ...decision.output,
    decision:'WAIT',
    confidence:Number(decision.output?.confidence||0),
    summary:'AI agents completed analysis; no deterministic Bollinger/RSI trade trigger is active.',
    aiDecision:rawDecision,
    resolutionSource:'BOLLINGER_RSI_ATR_RULES'
  }

  if(strategyAction==='BUY'){
    resolvedDecisionOutput={
      ...decision.output,
      decision:'BUY_CANDIDATE',
      confidence:0.99,
      summary:'Deterministic BUY: RSI is oversold and price is at or near the lower Bollinger Band.',
      aiDecision:rawDecision,
      resolutionSource:'BOLLINGER_RSI_ATR_RULES',
      deterministicStrategy
    }
  }else if(strategyAction==='SELL'){
    resolvedDecisionOutput={
      ...decision.output,
      decision:'SELL_CANDIDATE',
      confidence:0.99,
      summary:'Deterministic SELL: automatic take-profit or stop-loss exit rule triggered.',
      aiDecision:rawDecision,
      resolutionSource:'BOLLINGER_RSI_ATR_RULES',
      deterministicStrategy
    }
  }

  publish('hybrid_decision_resolved',{
    productId,
    deterministicAction:strategyAction,
    finalDecision:resolvedDecisionOutput.decision,
    aiDecision:rawDecision,
    deterministicStrategy
  },'decision')

  // === LIMITED LIVE EXECUTION (Phase 2) ===
  publish('agent_started', { asset: productId, stage: 'candidate-preflight' }, 'paper')
  const candidateDecision = String(resolvedDecisionOutput?.decision || 'WAIT')
  const confidence = Number(resolvedDecisionOutput?.confidence)

  const paperPreflight = {
    eligible: ['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(candidateDecision),
    decision: candidateDecision,
    note: 'Candidate decision received. Checking limited live execution...'
  }
  publish('agent_completed', { asset: productId, output: paperPreflight }, 'paper')

  publish('agent_started', { asset: productId, stage: 'execution-gate' }, 'execution')

  let executionResult: any = {
    action: 'NO_AUTOMATIC_ORDER',
    reason: 'Not a candidate decision or auto trading disabled'
  }

  if (['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(candidateDecision)) {
    executionResult = await tryLimitedLiveExecution({
      productId,
      decision: candidateDecision,
      confidence
    })
  }

  if (
    candidateDecision === 'BUY_CANDIDATE' &&
    !executionResult?.executed &&
    Number(executionResult?.fundingRequiredUsd || 0) > 0
  ) {
    try {
      const [scan, freshAccounts, xrpProduct] = await Promise.all([
        scanCryptoMarket(),
        listAccounts(),
        getProduct('XRP-USD')
      ])
      const xrpSignal = scan.results.find((row:any)=>row.productId==='XRP-USD')
      const balanceValue=(b:any)=>Number(b?.value??b??0)||0
      const xrpAccount=freshAccounts.find((a:any)=>String(a.currency).toUpperCase()==='XRP')
      const xrpPrice=Number((xrpProduct as any)?.price||0)
      const availableXrp=balanceValue(xrpAccount?.availableBalance)
      const xrpAvailableUsd=availableXrp*xrpPrice
      const fundingRequiredUsd=Number(executionResult.fundingRequiredUsd||0)
      const rotationReady=Boolean(
        xrpSignal?.sellCandidate &&
        xrpAvailableUsd>=fundingRequiredUsd &&
        fundingRequiredUsd>0
      )

      publish('capital_rotation_plan', {
        buyProductId: productId,
        sourceProductId: 'XRP-USD',
        fundingRequiredUsd,
        desiredBuyNotionalUsd: Number(executionResult?.desiredNotionalUsd||0),
        availableUsd: Number(executionResult?.availableUsd||0),
        xrpSellCandidate: Boolean(xrpSignal?.sellCandidate),
        xrpSellScore: Number(xrpSignal?.sellScore||0),
        xrpAvailableUsd,
        suggestedSellUsd: Math.min(fundingRequiredUsd,xrpAvailableUsd),
        rotationReady,
        requiresApproval: true,
        reason: rotationReady
          ? 'XRP independently qualifies as a sell candidate and can cover the BUY funding gap.'
          : 'Funding gap detected, but XRP does not independently qualify for rotation or cannot cover the gap.'
      }, 'portfolio')
    } catch (error) {
      publish('capital_rotation_plan_failed', {
        buyProductId: productId,
        error: error instanceof Error ? error.message : String(error)
      }, 'portfolio')
    }
  }

  publish('agent_completed', { asset: productId, output: executionResult }, 'execution')

  const executionAttempted = ['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(candidateDecision)
  const executionSide = candidateDecision === 'BUY_CANDIDATE' ? 'BUY' : candidateDecision === 'SELL_CANDIDATE' ? 'SELL' : null

  const strategyEntry:any = (deterministicStrategy as any)?.entry || {}
  const strategyBands:any = (deterministicStrategy as any)?.bollinger || {}
  const strategyRsi:any = (deterministicStrategy as any)?.rsi || {}
  const strategyClose = Number((deterministicStrategy as any)?.close || 0)
  const strategyLower = Number(strategyBands?.lower || 0)
  const strategyMiddle = Number(strategyBands?.middle || 0)
  const strategyRsiValue = Number(strategyRsi?.value)
  const strategyRsiThreshold = Number(strategyRsi?.threshold || 35)
  const closeVsLowerPct =
    strategyClose > 0 && strategyLower > 0
      ? ((strategyClose - strategyLower) / strategyLower) * 100
      : null

  const deterministicWaitReason = !executionAttempted
    ? [
        strategyClose > 0 && strategyLower > 0
          ? ('Close ' + (closeVsLowerPct! >= 0 ? '+' : '') + closeVsLowerPct!.toFixed(2) + '% vs lower BB')
          : '',
        Number.isFinite(strategyRsiValue)
          ? ('RSI ' + strategyRsiValue.toFixed(1) + ' / needs < ' + strategyRsiThreshold.toFixed(0))
          : '',
        strategyEntry?.crossedBelowLower === true ? 'BB cross YES' : 'BB cross NO',
        strategyEntry?.nearLowerBand === true
          ? 'Near lower BB YES'
          : 'Near lower BB NO',
        strategyEntry?.oversold === true ? 'RSI oversold YES' : 'RSI oversold NO',
        'No deterministic entry trigger'
      ].filter(Boolean).join(' • ')
    : ''

  publish('live_execution_cycle', {
    productId,
    side: executionSide,
    decision: candidateDecision,
    confidence: Number.isFinite(confidence) ? confidence : null,
    attempted: executionAttempted,
    executed: Boolean(executionResult?.executed),
    action: executionResult?.action || (executionAttempted ? 'ATTEMPTED' : 'NO_TRADE'),
    reason: executionAttempted
      ? [
          executionResult?.reason || 'Execution gate completed.',
          executionResult?.safeMaxBuyUsd != null ? ('Safe max 
    deterministicStrategy: {
      action: (deterministicStrategy as any)?.action || 'NONE',
      reason: (deterministicStrategy as any)?.reason || null,
      close: strategyClose || null,
      bollingerLower: strategyLower || null,
      bollingerMiddle: strategyMiddle || null,
      rsi: Number.isFinite(strategyRsiValue) ? strategyRsiValue : null,
      rsiThreshold: strategyRsiThreshold,
      crossedBelowLower: Boolean(strategyEntry?.crossedBelowLower),
      nearLowerBand: Boolean(strategyEntry?.nearLowerBand),
      proximityThresholdPercent: Number(strategyEntry?.proximityThresholdPercent ?? 0.25),
      oversold: Boolean(strategyEntry?.oversold),
      closeVsLowerPct
    },
    orderId: executionResult?.orderId || null,
    notionalUsd: executionResult?.notionalUsd || null
  }, 'execution')

  const result = {
    productId,
    generatedAt: new Date().toISOString(),
    source: 'Coinbase Advanced Trade',
    deepResearch,
    market: market.output,
    strategy: strategy.output,
    sentiment: sentiment.output,
    portfolio: portfolio.output,
    risk: risk.output,
    critic: critic.output,
    decision: resolvedDecisionOutput,
    rawDecision: decision.output,
    deterministicConsensus,
    technicalSignal,
    deterministicStrategy,
    paperPreflight,
    execution: executionResult,
    quantitative: { vectorbt, nautilus, rdAgent }
  }

  publish('pipeline_completed', { productId, decision: candidateDecision }, 'manager')
  return result
}

export const runFullAgentPipeline = async (options: PipelineOptions = {}) => {
  if (pipelineState.status === 'running') throw new Error('Agent pipeline is already running.')
  const productId = (options.productId || 'BTC-USD').toUpperCase()
  pipelineState = {
    status: 'running',
    productId,
    deepResearch: Boolean(options.deepResearch),
    currentAgent: 'manager',
    completedAgents: [],
    decision: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  }
  try {
    const result = await runFullAgentPipelineInternal(options)
    const decision = String(result?.decision?.decision || 'WAIT')
    pipelineState = {
      ...pipelineState,
      status: 'completed',
      currentAgent: null,
      decision,
      error: null,
      finishedAt: new Date().toISOString()
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pipelineState = {
      ...pipelineState,
      status: 'failed',
      currentAgent: null,
      error: message,
      finishedAt: new Date().toISOString()
    }
    publish('pipeline_failed', { productId, error: message }, 'manager')
    throw error
  }
}
 + Number(executionResult.safeMaxBuyUsd).toFixed(2)) : '',
          executionResult?.coinbaseMinimumUsd != null ? ('Coinbase min 
    deterministicStrategy: {
      action: (deterministicStrategy as any)?.action || 'NONE',
      reason: (deterministicStrategy as any)?.reason || null,
      close: strategyClose || null,
      bollingerLower: strategyLower || null,
      bollingerMiddle: strategyMiddle || null,
      rsi: Number.isFinite(strategyRsiValue) ? strategyRsiValue : null,
      rsiThreshold: strategyRsiThreshold,
      crossedBelowLower: Boolean(strategyEntry?.crossedBelowLower),
      nearLowerBand: Boolean(strategyEntry?.nearLowerBand),
      proximityThresholdPercent: Number(strategyEntry?.proximityThresholdPercent ?? 0.25),
      oversold: Boolean(strategyEntry?.oversold),
      closeVsLowerPct
    },
    orderId: executionResult?.orderId || null,
    notionalUsd: executionResult?.notionalUsd || null
  }, 'execution')

  const result = {
    productId,
    generatedAt: new Date().toISOString(),
    source: 'Coinbase Advanced Trade',
    deepResearch,
    market: market.output,
    strategy: strategy.output,
    sentiment: sentiment.output,
    portfolio: portfolio.output,
    risk: risk.output,
    critic: critic.output,
    decision: resolvedDecisionOutput,
    rawDecision: decision.output,
    deterministicConsensus,
    technicalSignal,
    deterministicStrategy,
    paperPreflight,
    execution: executionResult,
    quantitative: { vectorbt, nautilus, rdAgent }
  }

  publish('pipeline_completed', { productId, decision: candidateDecision }, 'manager')
  return result
}

export const runFullAgentPipeline = async (options: PipelineOptions = {}) => {
  if (pipelineState.status === 'running') throw new Error('Agent pipeline is already running.')
  const productId = (options.productId || 'BTC-USD').toUpperCase()
  pipelineState = {
    status: 'running',
    productId,
    deepResearch: Boolean(options.deepResearch),
    currentAgent: 'manager',
    completedAgents: [],
    decision: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  }
  try {
    const result = await runFullAgentPipelineInternal(options)
    const decision = String(result?.decision?.decision || 'WAIT')
    pipelineState = {
      ...pipelineState,
      status: 'completed',
      currentAgent: null,
      decision,
      error: null,
      finishedAt: new Date().toISOString()
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pipelineState = {
      ...pipelineState,
      status: 'failed',
      currentAgent: null,
      error: message,
      finishedAt: new Date().toISOString()
    }
    publish('pipeline_failed', { productId, error: message }, 'manager')
    throw error
  }
}
 + Number(executionResult.coinbaseMinimumUsd).toFixed(2)) : '',
          executionResult?.availableUsd != null ? ('Cash 
    deterministicStrategy: {
      action: (deterministicStrategy as any)?.action || 'NONE',
      reason: (deterministicStrategy as any)?.reason || null,
      close: strategyClose || null,
      bollingerLower: strategyLower || null,
      bollingerMiddle: strategyMiddle || null,
      rsi: Number.isFinite(strategyRsiValue) ? strategyRsiValue : null,
      rsiThreshold: strategyRsiThreshold,
      crossedBelowLower: Boolean(strategyEntry?.crossedBelowLower),
      nearLowerBand: Boolean(strategyEntry?.nearLowerBand),
      proximityThresholdPercent: Number(strategyEntry?.proximityThresholdPercent ?? 0.25),
      oversold: Boolean(strategyEntry?.oversold),
      closeVsLowerPct
    },
    orderId: executionResult?.orderId || null,
    notionalUsd: executionResult?.notionalUsd || null
  }, 'execution')

  const result = {
    productId,
    generatedAt: new Date().toISOString(),
    source: 'Coinbase Advanced Trade',
    deepResearch,
    market: market.output,
    strategy: strategy.output,
    sentiment: sentiment.output,
    portfolio: portfolio.output,
    risk: risk.output,
    critic: critic.output,
    decision: resolvedDecisionOutput,
    rawDecision: decision.output,
    deterministicConsensus,
    technicalSignal,
    deterministicStrategy,
    paperPreflight,
    execution: executionResult,
    quantitative: { vectorbt, nautilus, rdAgent }
  }

  publish('pipeline_completed', { productId, decision: candidateDecision }, 'manager')
  return result
}

export const runFullAgentPipeline = async (options: PipelineOptions = {}) => {
  if (pipelineState.status === 'running') throw new Error('Agent pipeline is already running.')
  const productId = (options.productId || 'BTC-USD').toUpperCase()
  pipelineState = {
    status: 'running',
    productId,
    deepResearch: Boolean(options.deepResearch),
    currentAgent: 'manager',
    completedAgents: [],
    decision: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  }
  try {
    const result = await runFullAgentPipelineInternal(options)
    const decision = String(result?.decision?.decision || 'WAIT')
    pipelineState = {
      ...pipelineState,
      status: 'completed',
      currentAgent: null,
      decision,
      error: null,
      finishedAt: new Date().toISOString()
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pipelineState = {
      ...pipelineState,
      status: 'failed',
      currentAgent: null,
      error: message,
      finishedAt: new Date().toISOString()
    }
    publish('pipeline_failed', { productId, error: message }, 'manager')
    throw error
  }
}
 + Number(executionResult.availableUsd).toFixed(2)) : ''
        ].filter(Boolean).join(' • ')
      : deterministicWaitReason,
    deterministicStrategy: {
      action: (deterministicStrategy as any)?.action || 'NONE',
      reason: (deterministicStrategy as any)?.reason || null,
      close: strategyClose || null,
      bollingerLower: strategyLower || null,
      bollingerMiddle: strategyMiddle || null,
      rsi: Number.isFinite(strategyRsiValue) ? strategyRsiValue : null,
      rsiThreshold: strategyRsiThreshold,
      crossedBelowLower: Boolean(strategyEntry?.crossedBelowLower),
      nearLowerBand: Boolean(strategyEntry?.nearLowerBand),
      proximityThresholdPercent: Number(strategyEntry?.proximityThresholdPercent ?? 0.25),
      oversold: Boolean(strategyEntry?.oversold),
      closeVsLowerPct
    },
    orderId: executionResult?.orderId || null,
    notionalUsd: executionResult?.notionalUsd || null
  }, 'execution')

  const result = {
    productId,
    generatedAt: new Date().toISOString(),
    source: 'Coinbase Advanced Trade',
    deepResearch,
    market: market.output,
    strategy: strategy.output,
    sentiment: sentiment.output,
    portfolio: portfolio.output,
    risk: risk.output,
    critic: critic.output,
    decision: resolvedDecisionOutput,
    rawDecision: decision.output,
    deterministicConsensus,
    technicalSignal,
    deterministicStrategy,
    paperPreflight,
    execution: executionResult,
    quantitative: { vectorbt, nautilus, rdAgent }
  }

  publish('pipeline_completed', { productId, decision: candidateDecision }, 'manager')
  return result
}

export const runFullAgentPipeline = async (options: PipelineOptions = {}) => {
  if (pipelineState.status === 'running') throw new Error('Agent pipeline is already running.')
  const productId = (options.productId || 'BTC-USD').toUpperCase()
  pipelineState = {
    status: 'running',
    productId,
    deepResearch: Boolean(options.deepResearch),
    currentAgent: 'manager',
    completedAgents: [],
    decision: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  }
  try {
    const result = await runFullAgentPipelineInternal(options)
    const decision = String(result?.decision?.decision || 'WAIT')
    pipelineState = {
      ...pipelineState,
      status: 'completed',
      currentAgent: null,
      decision,
      error: null,
      finishedAt: new Date().toISOString()
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pipelineState = {
      ...pipelineState,
      status: 'failed',
      currentAgent: null,
      error: message,
      finishedAt: new Date().toISOString()
    }
    publish('pipeline_failed', { productId, error: message }, 'manager')
    throw error
  }
}
