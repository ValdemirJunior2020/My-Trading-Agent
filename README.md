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
