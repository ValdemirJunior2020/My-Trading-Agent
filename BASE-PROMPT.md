# My Trading Agent — Base Build Prompt

Build the **base foundation** for a local AI crypto trading and research platform called **My Trading Agent**.

This is only the base architecture. Do not overbuild it yet. I will later provide several open-source GitHub repositories that I want reviewed and selectively integrated into this project. The project must therefore be modular, clean, and easy to extend without rebuilding the whole application.

## Main goal

Create a local-first crypto AI agent platform using **Ollama** for AI reasoning and **Coinbase Advanced Trade API** as the first exchange connection.

The application should eventually be able to monitor markets, analyze opportunities, manage risk, backtest strategies, paper trade, propose trades, and later support carefully controlled live trading.

Do not use paid AI APIs. The AI layer must use local Ollama models.

## Tech stack

Use:

- React
- TypeScript
- Vite
- Tailwind CSS
- Node.js with TypeScript
- SQLite
- Ollama local API
- Coinbase Advanced Trade API
- WebSockets when useful for real-time updates
- TradingView Lightweight Charts or another free open-source chart library

The project must run locally on Windows.

Create a structure that can later support `install.bat` and `start.bat` so the whole platform can eventually be started with one click.

## Important development rule

I will add more repositories later.

Do **not** build this project in a way that makes future integrations difficult.

Use modular folders and clear interfaces for:

- agents
- exchange adapters
- market data providers
- strategies
- indicators
- risk rules
- backtesting engines
- paper trading engines
- news and sentiment providers
- visualizations
- external repository integrations

Create an `integrations/` area specifically for future open-source projects.

Before integrating any future repository:

1. Inspect it first.
2. Identify what it does well.
3. Check its license and dependencies.
4. Check for duplicated functionality.
5. Reuse only the useful pieces.
6. Do not blindly merge entire repositories.
7. Keep the original My Trading Agent architecture stable.
8. Never delete working functionality just to integrate another repo.

## Coinbase

Coinbase Advanced Trade API is the first exchange.

Keep Coinbase isolated behind an exchange adapter.

Create a standard exchange interface so other exchanges can be added later without rewriting the application.

The exchange interface should eventually support functions such as:

- get accounts
- get balances
- get products
- get ticker
- get candles
- get order book
- get open orders
- get order history
- place market order
- place limit order
- place stop order when supported
- cancel order
- get fees
- get portfolio holdings

Do not invent Coinbase API endpoints. Use the official Coinbase API specification when implementing the adapter.

## Ollama

Ollama is the local AI runtime.

The user must be able to choose which installed Ollama model to use.

Do not hard-code one model.

Possible models may include Qwen, DeepSeek-R1 variants, Llama, or other Ollama-compatible models.

Normal application code should calculate indicators, risk, balances, P/L, position sizing, and other deterministic values.

Do not make the LLM calculate everything from raw market data.

Ollama should receive clean structured summaries and perform higher-level reasoning.

## Multi-agent design

Create the base architecture for separate specialized agents.

Initial agents:

### Market Analyst
Analyzes market structure, trend, momentum, technical indicators, support, resistance, volume, and volatility.

### Risk Manager
Checks trade size, account exposure, maximum loss, volatility, stop distance, and hard risk limits.

### Sentiment Analyst
Reviews available news and sentiment information from free sources added later.

### Strategy Analyst
Checks whether a market setup matches enabled trading strategies.

### Trade Critic
Actively looks for reasons a proposed trade may be wrong.

### Portfolio Manager
Looks at total portfolio exposure, concentration, correlation, open positions, and available capital.

### Final Decision Agent
Receives structured reports from the other agents and produces a final recommendation such as BUY, SELL, HOLD, or WAIT.

The agents should communicate using structured JSON rather than unstructured text whenever possible.

## Hard safety layer

The AI must never be the final authority over account safety.

Create a normal-code Risk Engine outside Ollama.

The Risk Engine must be able to reject a trade even when every AI agent wants the trade.

Future hard limits should include:

- maximum trade size
- maximum portfolio percentage per position
- maximum daily loss
- maximum weekly loss
- maximum open positions
- maximum exposure per asset
- maximum total exposure
- cooldown after losses
- maximum drawdown protection
- emergency stop

Live automatic trading must be OFF by default.

The base should support these future modes:

- Analysis Only
- Paper Trading
- Manual Approval Trading
- Automatic Trading

Automatic Trading must require explicit user activation later.

## Pixel Agent Office

I want a visual experience inspired by my **QA Tool Pixel Office** project.

I will provide the QA Tool Pixel Office repository/code as a visual reference.

The trading application should eventually include a **Trading Agent Pixel Office** where I can visually see my AI agents working.

The visual office should feel like a small pixel-art operations center.

Each AI agent should have its own area or workstation, for example:

- Market Analysis Room
- Risk Management Room
- Strategy Lab
- Sentiment Desk
- Trade Critic Desk
- Portfolio Room
- Final Decision Room
- Coinbase / Execution Desk
- Backtesting Lab
- Paper Trading Area
- Manager / Control Room

Pixel characters should visually represent the real agents.

When an agent is working, the UI should show what that agent is actually doing.

Examples:

- `Market Analyst — Analyzing BTC-USD`
- `Risk Manager — Checking position size`
- `Trade Critic — Reviewing proposed BTC trade`
- `Portfolio Manager — Checking portfolio exposure`
- `Final Decision Agent — Comparing agent reports`
- `Execution Agent — Waiting for manual approval`

Agents may visually move between rooms or change workstation/status depending on their current task.

Clicking an agent should open a small panel showing:

- agent name
- current task
- asset being analyzed
- current status
- last completed task
- latest short reasoning summary
- time task started
- whether Ollama is currently processing

Use statuses such as:

- Idle
- Working
- Waiting
- Reviewing
- Approved
- Rejected
- Error
- Offline

The Pixel Office must eventually use **real backend agent events**, not fake random animation.

A temporary demo/simulation mode is acceptable during development, but it must be clearly labeled as simulation and must never pretend simulated activity is real.

Build the Pixel Office as its own reusable frontend module so I can improve or replace its visual design later without touching the trading logic.

## Agent event system

Design a central event system so backend agents can publish status updates.

Example event shape:

```json
{
  "agentId": "risk-manager",
  "status": "working",
  "task": "Checking BTC-USD position size",
  "asset": "BTC-USD",
  "startedAt": "2026-09-16T19:00:00Z",
  "details": "Validating account risk and stop distance"
}
```

The Pixel Office, activity log, dashboard, and notifications should all be able to consume these events.

Use WebSockets or Server-Sent Events when appropriate.

## Base dashboard

Prepare the architecture for these future sections:

- Dashboard
- Markets
- Charts
- AI Analyst
- Agent Office
- Scanner
- Portfolio
- Strategies
- Backtesting
- Paper Trading
- Live Trading
- Trade Journal
- Alerts
- Exchange Connections
- Ollama Models
- Settings

Do not create fake finished features. If a section is not implemented yet, clearly mark it as planned or unavailable.

## Data and memory

Use SQLite locally.

Prepare for tables/modules such as:

- settings
- exchange accounts
- watchlists
- strategies
- strategy versions
- market snapshots
- agent events
- agent analysis
- backtests
- paper trades
- live trades
- positions
- orders
- portfolio snapshots
- trade reviews
- alerts
- risk events
- audit logs

AI memory should remain local.

## Security

Never hard-code API keys.

Use `.env` for secrets.

Provide `.env.example` when the application is built.

Never expose Coinbase secrets to the frontend.

Never send Coinbase credentials to Ollama.

Never print API secrets in logs.

Never commit secrets to GitHub.

Do not delete or overwrite an existing `.env` file.

Do not delete or modify `.git` metadata.

## Auditability

Every important action should eventually be recorded locally.

Examples:

- agent started analysis
- AI proposed trade
- Risk Engine rejected trade
- user approved trade
- order submitted
- Coinbase confirmed order
- order failed
- emergency stop activated

The AI must not be able to erase the audit history.

## Failure behavior

If the application is uncertain about account state, exchange state, price freshness, or risk state:

**DO NOT TRADE.**

The system should fail safely if:

- Coinbase is unavailable
- internet disconnects
- Ollama stops
- market data becomes stale
- SQLite is temporarily unavailable
- frontend closes
- backend restarts

## Base project philosophy

Keep the base simple, modular, local-first, and easy to understand.

Do not prematurely build every possible strategy.

Do not create a giant monolithic file.

Do not tightly couple the UI to Coinbase or Ollama.

Do not tightly couple the Pixel Office to trading logic.

Build clean interfaces so future open-source repositories can be integrated piece by piece.

The goal of this first phase is to create a strong foundation that I can expand as I research and provide more repositories.

When future repositories are provided, analyze them first and tell me exactly what should be integrated, replaced, ignored, or adapted before changing the project.