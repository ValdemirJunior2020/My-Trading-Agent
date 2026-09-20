# My Trading Agent

Local-first crypto AI research and trading workspace with a responsive bilingual Pixel Agent Office, local Node server, SQLite persistence, Ollama agent runtime, Coinbase Advanced Trade server adapter, paper-trading risk engine, live backend events, and Windows one-click launchers.

> Live automatic trading remains OFF by default. The current execution endpoint is paper-only. Coinbase account/product access is server-side and real secrets never enter React.

## Windows - easiest way

1. Download or clone the repository.
2. Double-click `INSTALL.bat`.
3. The installer checks Node.js, npm, Git, Ollama, dependencies, `.env`, and the build **before installing anything**.
4. It skips items already installed and never overwrites an existing `.env`.
5. Double-click `START.bat`.
6. Use `STOP.bat` to stop the local server.
7. Use `UPDATE.bat` to pull, re-check dependencies, and rebuild.

The app opens at `http://127.0.0.1:8787`.

## Client + server

Development:

```bash
npm install
npm run dev
```

Production/local desktop-style run:

```bash
npm run build
npm start
```

The Node server serves the built React client and exposes local `/api/*` routes. Local state is stored in `data/my-trading-agent.db` using Node's built-in SQLite support.

Current backend capabilities include server/Ollama/Coinbase status, persistent emergency stop, Server-Sent Events for the live activity feed, local Ollama agent runs, paper-order risk checks, paper-trade storage, Coinbase account reads, and Coinbase product reads.

## Quant research engines

The Windows installer now sets up a separate local Python environment at `.venv-quant` and installs:

- **VectorBT** for fast strategy backtests and parameter research.
- **NautilusTrader** for deterministic event-driven trading-engine validation.
- **RD-Agent** through WSL/Ubuntu because the upstream RD-Agent project targets Linux.

The Node server exposes local APIs for engine status, VectorBT SMA backtests, NautilusTrader engine validation, RD-Agent health checks, and RD-Agent quant/factor runs. The top bar shows `QUANT 0/3` through `QUANT 3/3` depending on which engines are available.

You can rerun `INSTALL-QUANT-ENGINES.bat` at any time. It reuses the existing environments rather than deleting them.

## Coinbase Advanced Trade

Copy `.env.example` to `.env` and add the dedicated Coinbase CDP API key only on your local machine.

See `docs/COINBASE_SETUP.md`.

Coinbase authentication is generated on the server with short-lived JWTs. The secret is never returned by the API and must never be placed in a `VITE_*` variable.

## Ollama

`START.bat` checks whether Ollama is installed and whether its local service is already running. If Ollama exists but is stopped, it starts it. Set `OLLAMA_MODEL` in `.env` to pin a model, or leave it blank and the server will use the first installed model.

## Netlify / Cloudflare Pages

The repository still supports a static frontend build:

- Build command: `npm run build:client`
- Output directory: `dist`

A static host does **not** run the local trading server. For the full tool, run the server on your PC. For protected remote access, the clean setup is to point a Cloudflare Tunnel at `http://127.0.0.1:8787` and put Cloudflare Access in front of that hostname. Then the client and API stay same-origin and your Coinbase secrets remain on your PC.

## Safety

Defaults in `.env.example`:

```env
TRADING_MODE=paper
COINBASE_LIVE_TRADING_ENABLED=false
AUTO_TRADING_ENABLED=false
MANUAL_APPROVAL_REQUIRED=true
```

The server currently does not expose a live Coinbase order-placement route. Paper orders must pass deterministic risk checks outside Ollama, and the emergency-stop state is persisted locally.
