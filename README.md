# My Trading Agent

Local-first crypto AI research and trading workspace. This first frontend phase implements the responsive Trading Agent Pixel Office, professional terminal preview, agent inspector, emergency-stop UI, and persistent English/Portuguese language switching.

> Current screen data is explicitly **DEMO / SIMULATION**. No live orders are sent and no exchange credentials are used by this frontend.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Coinbase Advanced Trade

Copy `.env.example` to a local `.env` only when the backend Coinbase connection is implemented. The template includes the current CDP API key variables, Coinbase REST/WebSocket endpoints, optional portfolio UUID, Ollama settings, and safe trading defaults.

See `docs/COINBASE_SETUP.md` for the Coinbase credential and security setup.

**Never put the Coinbase API secret in a `VITE_*` variable, React code, Netlify Pages, or Cloudflare Pages.** Coinbase credentials belong only in the server-side/local backend.

## Netlify

The repository includes `netlify.toml`.

- Build command: `npm run build`
- Publish directory: `dist`

## Cloudflare Pages

Use:

- Build command: `npm run build`
- Build output directory: `dist`

`public/_redirects` and `public/_headers` are copied into the production build and work with Cloudflare Pages static assets.

## Safety

Live automatic trading is not implemented in this phase. The frontend follows the base architecture rule that hard risk checks live outside the LLM and live trading must be opt-in.

The default environment template keeps paper mode enabled, live Coinbase execution disabled, automatic trading disabled, and manual approval required.
