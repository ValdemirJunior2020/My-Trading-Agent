# Coinbase Advanced Trade setup

My Trading Agent uses server-side Coinbase Developer Platform (CDP) Secret API Keys and short-lived JWT authentication for Advanced Trade.

## What to create in Coinbase

Create a **dedicated Secret API Key** for My Trading Agent and scope it as tightly as possible to the intended Coinbase account or Advanced Trade portfolio.

Coinbase currently supports both **Ed25519** and **ECDSA** keys for direct Advanced Trade API calls. Ed25519 is the recommended default for new keys. ECDSA remains supported and is required by some older Coinbase SDKs. My Trading Agent uses the current CDP JWT helper for direct API calls, so either current key type can be used.

Copy the values Coinbase gives you into your local `.env`:

```env
CDP_API_KEY_ID=organizations/YOUR_ORG_ID/apiKeys/YOUR_KEY_ID
CDP_API_KEY_SECRET=PASTE_THE_SECRET_EXACTLY_AS_COINBASE_GIVES_IT
COINBASE_PORTFOLIO_UUID=
```

If Coinbase gives you a multi-line ECDSA PEM secret, preserve its line breaks. In a one-line `.env` value you can use escaped `\n` line breaks. If Coinbase gives you an Ed25519 secret value, paste that value exactly as issued.

Do not save generated JWTs in `.env`. The backend creates a new short-lived JWT for each authenticated Coinbase request.

## Endpoints used by the project

```env
COINBASE_API_BASE_URL=https://api.coinbase.com
COINBASE_WS_MARKET_URL=wss://advanced-trade-ws.coinbase.com
COINBASE_WS_USER_URL=wss://advanced-trade-ws-user.coinbase.com
```

The current server uses authenticated REST access for Coinbase account and product reads. The WebSocket variables are already reserved for the later real-time market/user stream layer.

## Permissions

Use a dedicated key for this tool. Start with the minimum permissions needed for read-only account/market analysis.

Do **not** give the bot transfer or withdrawal permissions. My Trading Agent does not need withdrawal access to analyze markets, backtest, paper trade, or place normal Advanced Trade orders later.

Live order placement is intentionally not exposed by the current server. The default project mode remains paper trading.

## Security rules

- Never put `CDP_API_KEY_SECRET` in React.
- Never create a `VITE_CDP_API_KEY_SECRET` variable.
- Never put Coinbase private credentials into Netlify Pages or Cloudflare Pages frontend environment variables.
- Keep the real key only in the local server `.env` or a protected server-side secret store.
- Keep `.env` out of Git.
- Never print the secret or generated JWT into logs.
- Keep `COINBASE_LIVE_TRADING_ENABLED=false` until live execution is deliberately added and tested.
- Keep `AUTO_TRADING_ENABLED=false` by default.
- Keep the deterministic risk engine able to reject an order regardless of what Ollama recommends.

## What you do not need

You do not need an old Coinbase Pro-style API passphrase for Advanced Trade CDP authentication.

You also do not need `CDP_WALLET_SECRET` for normal Advanced Trade brokerage access. That belongs to separate CDP wallet/onchain workflows.

## Server/client separation

The React client only receives safe status and filtered account/product data from the local Node server. The Coinbase secret never leaves the server process.

For remote access, prefer putting a Cloudflare Tunnel and Cloudflare Access in front of the local server rather than moving Coinbase secrets to a static host.
