# Coinbase Advanced Trade setup

My Trading Agent uses the current Coinbase Advanced Trade authentication model based on Coinbase Developer Platform (CDP) API keys.

## What you need from Coinbase

Create a dedicated CDP API key for this trading project and keep it scoped as tightly as possible to the intended Advanced Trade portfolio.

Copy these values into your local `.env` file:

```env
CDP_API_KEY_ID=organizations/YOUR_ORG_ID/apiKeys/YOUR_KEY_ID
CDP_API_KEY_SECRET="-----BEGIN EC PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END EC PRIVATE KEY-----\n"
COINBASE_PORTFOLIO_UUID=
```

The API key ID may be a full resource path such as `organizations/{orgId}/apiKeys/{keyId}`. The API key secret must be copied exactly as Coinbase provides it. Current Coinbase authentication tools support current CDP key formats, including ECDSA/ES256 private-key secrets.

Advanced Trade API requests use short-lived JWT authentication generated from the CDP API key and secret. The application should generate those tokens on the backend. Do not manually save a JWT in `.env`.

## Endpoints

The project template uses:

```env
COINBASE_API_BASE_URL=https://api.coinbase.com
COINBASE_WS_MARKET_URL=wss://advanced-trade-ws.coinbase.com
COINBASE_WS_USER_URL=wss://advanced-trade-ws-user.coinbase.com
```

The market WebSocket is for real-time market data. The user WebSocket is for authenticated account/order events.

## Permissions

Use a dedicated Coinbase key for My Trading Agent. Start with the minimum access needed for account/market analysis. Only grant trading capability when the live-trading backend is intentionally implemented and tested.

Do not give the trading bot transfer or withdrawal access just because it is available. My Trading Agent does not need withdrawal capability to analyze markets, paper trade, or place ordinary Advanced Trade orders.

If you use a separate Advanced Trade portfolio, Coinbase recommends a dedicated API key scoped to that portfolio.

## Security rules

- Never put `CDP_API_KEY_SECRET` in React code.
- Never create a variable such as `VITE_CDP_API_KEY_SECRET`. Any `VITE_` variable can be exposed to the browser bundle.
- Do not place Coinbase private credentials in Netlify or Cloudflare Pages for the static frontend.
- Keep real credentials only in the local backend `.env`, or later in a protected server-side secret store.
- Keep `.env` out of Git. The repository already ignores it.
- Never print the secret, private key, or generated JWT to logs.
- Keep `COINBASE_LIVE_TRADING_ENABLED=false` until live trading is deliberately activated.
- Keep `AUTO_TRADING_ENABLED=false` by default.
- Keep the deterministic risk engine able to reject every order, regardless of what Ollama recommends.

## What you do NOT need for Advanced Trade

You do not need an old Coinbase Pro/Exchange-style API passphrase for the current Advanced Trade/CDP authentication flow.

You also do not need `CDP_WALLET_SECRET` for normal Coinbase Advanced Trade brokerage access. That secret belongs to separate CDP wallet/onchain SDK workflows and should not be added unless the project later intentionally uses those features.

## Current development mode

The current frontend is still a demo/simulation interface. Coinbase credentials should not be entered into the frontend yet. The next backend phase will load these server-only variables and expose only safe, filtered data to the UI.
