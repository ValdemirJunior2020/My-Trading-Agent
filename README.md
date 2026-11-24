# NEXUS TRADING AI — THE LION

Local, simulation-only stock research workstation. No brokerage API, order execution, transfers, credentials or account access. No dependencies; Node.js 20+.

Run `npm test`, then `npm start`. Open http://127.0.0.1:8788. On Windows, double-click START.bat.

The initial version is a manual-input risk calculator and paper journal. It does not claim live market data, verified catalysts, automatic market scanning or Robinhood connectivity. Until a verified read-only feed and exchange calendar are implemented, all market evaluations are INSUFFICIENT DATA. Hypothetical calculations are educational only. Journal data stays in browser local storage; no actual account balances are collected.

Risk defaults: $100 maximum position, $5 daily planned loss, one position, two trades, 2:1 minimum reward/risk, $2.50 per-trade planned risk. Long stocks/ETFs only; no options, shorts, leverage, penny stocks, averaging down or revenge trading. Use settled funds only. Real execution is intentionally absent. Stop button disables calculations until manually resumed. $50 aspiration is not a trading requirement. Actual fills and losses may differ from estimates.

Future work: verified read-only market feed, completed 5-minute candle indicators and exchange calendar, catalyst validation, persistent simulated fills with enforceable position/trade limits, deduplicated alerts and daily reports. Do not enable live execution. No cloud deployment configured.
