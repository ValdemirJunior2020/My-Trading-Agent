import { coinbaseConfigured } from './config.js';
import { getCandles, getProduct, listAccounts } from './coinbase.js';
import { publish } from './events.js';
import { runAgent } from './ollama.js';
import { quantStatus, runNautilusSmoke, runRdAgent, runVectorbtValidation } from './quant.js';
import { saveAnalysis } from './db.js';
import { getChallengeSnapshot } from './challenge.js';
import { tryLimitedLiveExecution } from './risk.js';
const MAIN_AGENTS = ['market', 'strategy', 'sentiment', 'portfolio', 'risk', 'critic', 'decision'];
let pipelineState = {
    status: 'idle',
    productId: 'BTC-USD',
    deepResearch: false,
    currentAgent: null,
    completedAgents: [],
    decision: null,
    error: null,
    startedAt: null,
    finishedAt: null
};
export const getPipelineStatus = () => ({ ...pipelineState, completedAgents: [...pipelineState.completedAgents] });
const pct = (a, b) => (b === 0 ? 0 : ((a - b) / b) * 100);
const safe = (value) => JSON.stringify(value).slice(0, 12000);
const agentStep = async (agentId, asset, evidence) => {
    pipelineState = { ...pipelineState, currentAgent: agentId };
    publish('agent_started', { asset }, agentId);
    try {
        const result = (await runAgent(agentId, asset, safe(evidence)));
        saveAnalysis(agentId, asset, safe(evidence), result.output, result.model);
        publish('agent_completed', { asset, output: result.output }, agentId);
        if (MAIN_AGENTS.includes(agentId) && !pipelineState.completedAgents.includes(agentId)) {
            pipelineState = { ...pipelineState, completedAgents: [...pipelineState.completedAgents, agentId] };
        }
        return result;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        publish('agent_failed', { asset, error: message }, agentId);
        throw error;
    }
};
const runFullAgentPipelineInternal = async (options = {}) => {
    const productId = (options.productId || 'BTC-USD').toUpperCase();
    const deepResearch = Boolean(options.deepResearch);
    if (!coinbaseConfigured()) {
        throw new Error('Coinbase is not configured. Add your CDP key to .env before running the real agent pipeline.');
    }
    publish('pipeline_started', { productId, deepResearch }, 'manager');
    const [product, candles, backtestCandles, accounts, engineStatus, challenge] = await Promise.all([
        getProduct(productId),
        getCandles(productId, 'ONE_HOUR', 120),
        getCandles(productId, 'ONE_HOUR', 3000),
        listAccounts(),
        quantStatus(),
        getChallengeSnapshot()
    ]);
    const engines = engineStatus;
    if (candles.length < 40) {
        throw new Error('Only ' + candles.length + ' Coinbase candles were returned; at least 40 are required.');
    }
    const closes = candles.map((c) => c.close);
    const backtestCloses = backtestCandles.map((c) => c.close);
    const backtestTimestamps = backtestCandles.map((c) => c.start);
    const latest = candles.at(-1);
    const previous = candles.at(-2);
    const dayAgo = candles[Math.max(0, candles.length - 25)];
    const weekAgo = candles[Math.max(0, candles.length - 120)];
    const highs = candles.slice(-24).map((c) => c.high);
    const lows = candles.slice(-24).map((c) => c.low);
    const avgVolume = candles.slice(-24).reduce((sum, c) => sum + c.volume, 0) / Math.min(24, candles.length);
    const marketEvidence = {
        source: 'Coinbase Advanced Trade',
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
    };
    const market = await agentStep('market', productId, marketEvidence);
    publish('agent_started', { asset: productId, engine: 'vectorbt' }, 'backtest');
    let vectorbt = { available: false };
    if (engines.vectorbt?.installed) {
        try {
            const initialCash = Number(challenge.startingBalanceUsd) || 100;
            const parameterSets = [
                { fast: 5, slow: 20 },
                { fast: 10, slow: 30 },
                { fast: 20, slow: 50 },
                { fast: 30, slow: 100 }
            ];
            const validation = await runVectorbtValidation({
                prices: backtestCloses,
                timestamps: backtestTimestamps,
                initialCash,
                parameterSets
            });
            vectorbt = {
                available: true,
                candleCount: backtestCandles.length,
                granularity: 'ONE_HOUR',
                initialCash,
                parameterSets,
                ...validation
            };
            publish('agent_completed', { asset: productId, engine: 'vectorbt', result: vectorbt }, 'backtest');
        }
        catch (error) {
            vectorbt = { available: false, error: error instanceof Error ? error.message : String(error) };
            publish('agent_failed', { asset: productId, engine: 'vectorbt', error: vectorbt.error }, 'backtest');
        }
    }
    else {
        publish('agent_failed', { asset: productId, engine: 'vectorbt', error: 'VectorBT not installed.' }, 'backtest');
    }
    let nautilus = { available: false };
    if (engines.nautilusTrader?.installed) {
        try {
            nautilus = { available: true, ...(await runNautilusSmoke()) };
            publish('nautilus_validation_completed', { asset: productId, result: nautilus }, 'backtest');
        }
        catch (error) {
            nautilus = { available: false, error: error instanceof Error ? error.message : String(error) };
        }
    }
    let rdAgent = { available: Boolean(engines.rdAgent?.installed), ran: false };
    if (deepResearch && engines.rdAgent?.installed) {
        publish('agent_started', { asset: productId, engine: 'rdagent' }, 'strategy');
        try {
            rdAgent = { available: true, ran: true, ...(await runRdAgent('fin_factor', 1, 1)) };
            publish('agent_completed', { asset: productId, engine: 'rdagent' }, 'strategy');
        }
        catch (error) {
            rdAgent = { available: true, ran: false, error: error instanceof Error ? error.message : String(error) };
            publish('agent_failed', { asset: productId, engine: 'rdagent', error: rdAgent.error }, 'strategy');
        }
    }
    const strategy = await agentStep('strategy', productId, {
        market: market.output,
        vectorbt,
        nautilus,
        rdAgent
    });
    const sentiment = await agentStep('sentiment', productId, {
        market: market.output,
        note: 'No external news feed is configured. Assess only price/volume context and explicitly flag the absence of news sentiment data.'
    });
    const usdAccount = accounts.find((a) => a.currency === 'USD');
    const baseCurrency = productId.split('-')[0];
    const assetAccount = accounts.find((a) => a.currency === baseCurrency);
    const portfolio = await agentStep('portfolio', productId, {
        market: market.output,
        strategy: strategy.output,
        balances: {
            usd: usdAccount?.availableBalance || null,
            asset: assetAccount?.availableBalance || null
        },
        accountCount: accounts.length,
        challenge
    });
    const risk = await agentStep('risk', productId, {
        market: market.output,
        strategy: strategy.output,
        portfolio: portfolio.output,
        challenge,
        hardLimits: 'The deterministic server risk engine remains authoritative and cannot be overridden by the challenge or AI.'
    });
    const critic = await agentStep('critic', productId, {
        market: market.output,
        strategy: strategy.output,
        sentiment: sentiment.output,
        portfolio: portfolio.output,
        risk: risk.output,
        vectorbt
    });
    const decision = await agentStep('decision', productId, {
        market: market.output,
        strategy: strategy.output,
        sentiment: sentiment.output,
        portfolio: portfolio.output,
        risk: risk.output,
        critic: critic.output,
        quantitativeValidation: { vectorbt, nautilus, rdAgent },
        challenge,
        instruction: 'Return a candidate decision only. Treat the challenge as a goal, never as permission to increase risk. Do not claim an order was placed.'
    });
    // === LIMITED LIVE EXECUTION (Phase 2) ===
    publish('agent_started', { asset: productId, stage: 'candidate-preflight' }, 'paper');
    const candidateDecision = String(decision.output?.decision || 'WAIT');
    const confidence = Number(decision.output?.confidence);
    const paperPreflight = {
        eligible: ['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(candidateDecision),
        decision: candidateDecision,
        note: 'Candidate decision received. Checking limited live execution...'
    };
    publish('agent_completed', { asset: productId, output: paperPreflight }, 'paper');
    publish('agent_started', { asset: productId, stage: 'execution-gate' }, 'execution');
    let executionResult = {
        action: 'NO_AUTOMATIC_ORDER',
        reason: 'Not a candidate decision or auto trading disabled'
    };
    if (['BUY_CANDIDATE', 'SELL_CANDIDATE'].includes(candidateDecision)) {
        executionResult = await tryLimitedLiveExecution({
            productId,
            decision: candidateDecision,
            confidence
        });
    }
    publish('agent_completed', { asset: productId, output: executionResult }, 'execution');
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
        decision: decision.output,
        paperPreflight,
        execution: executionResult,
        quantitative: { vectorbt, nautilus, rdAgent }
    };
    publish('pipeline_completed', { productId, decision: candidateDecision }, 'manager');
    return result;
};
export const runFullAgentPipeline = async (options = {}) => {
    if (pipelineState.status === 'running')
        throw new Error('Agent pipeline is already running.');
    const productId = (options.productId || 'BTC-USD').toUpperCase();
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
    };
    try {
        const result = await runFullAgentPipelineInternal(options);
        const decision = String(result?.decision?.decision || 'WAIT');
        pipelineState = {
            ...pipelineState,
            status: 'completed',
            currentAgent: null,
            decision,
            error: null,
            finishedAt: new Date().toISOString()
        };
        return result;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pipelineState = {
            ...pipelineState,
            status: 'failed',
            currentAgent: null,
            error: message,
            finishedAt: new Date().toISOString()
        };
        publish('pipeline_failed', { productId, error: message }, 'manager');
        throw error;
    }
};
