import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'

interface Props {
  language: 'en' | 'pt'
}

type CandidateSide = 'BUY' | 'SELL' | null

export function LiveTrading({ language }: Props) {
  const [readiness, setReadiness] = useState<any | null>(null)
  const [pipeline, setPipeline] = useState<any | null>(null)
  const [scanner, setScanner] = useState<any | null>(null)
  const [preflight, setPreflight] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const pt = language === 'pt'

  const load = async () => {
    setLoading(true)
    try {
      const [ready, pipe, scan] = await Promise.all([
        api.getLiveReadiness(),
        api.getPipelineStatus(),
        api.getScanner()
      ])
      setReadiness(ready)
      setPipeline(pipe)
      setScanner(scan)
    } catch (error) {
      setReadiness({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 5000)
    return () => clearInterval(id)
  }, [])

  const candidate = String(pipeline?.decision || 'WAIT')
  const pipelineRunning = pipeline?.status === 'running'
  const pipelineProduct = String(
    pipeline?.productId || scanner?.bestBuy?.productId || scanner?.bestSell?.productId || 'BTC-USD'
  )
  const scannerBuy = scanner?.bestBuy || null
  const scannerSell = scanner?.bestSell || null
  const side: CandidateSide = candidate === 'BUY_CANDIDATE' ? 'BUY' : candidate === 'SELL_CANDIDATE' ? 'SELL' : null

  const hardBlocked = !readiness?.readyForLive
  const autoSafePause = Boolean(readiness?.autoSafePause)
  const rollingGuard = readiness?.rollingRiskGuard || null
  const dailyGuard = readiness?.dailyLossGuard || null
  const botLossPercent = Number(dailyGuard?.botLossPercent ?? dailyGuard?.lossPercent ?? 0)
  const marketDrawdownPercent = Number(dailyGuard?.marketDrawdownPercent ?? 0)

  const plainSignal = hardBlocked
    ? 'BLOCKED'
    : autoSafePause
      ? 'AUTO SAFE PAUSE'
      : pipelineRunning
        ? 'ANALYZING ' + pipelineProduct
        : candidate === 'BUY_CANDIDATE'
          ? 'BUY NOW'
          : candidate === 'SELL_CANDIDATE'
            ? 'SELL NOW'
            : 'DO NOT BUY / WAIT'

  const maxPositionUsd =
    readiness?.currentPortfolioUsd != null && readiness?.riskLimits?.maxPositionPercent != null
      ? Number(readiness.currentPortfolioUsd) * (Number(readiness.riskLimits.maxPositionPercent) / 100)
      : 0
  const guidedAmount = maxPositionUsd > 0 ? Math.max(1, Math.min(5, maxPositionUsd)) : 0

  const readinessItems = useMemo(() => [
    { label: pt ? 'Coinbase conectado' : 'Coinbase connected', ok: Boolean(readiness?.configured), detail: 'OK' },
    { label: pt ? 'Modo live habilitado' : 'Live mode enabled', ok: Boolean(readiness?.liveTradingEnabled), detail: 'OK' },
    { label: pt ? 'Trading automático habilitado' : 'Automatic trading enabled', ok: Boolean(readiness?.automaticTradingEnabled), detail: 'OK' },
    { label: pt ? 'Emergency stop desligado' : 'Emergency stop off', ok: readiness?.emergencyStop === false, detail: readiness?.emergencyStop ? 'STOPPED' : 'OK' },
    { label: pt ? 'Perda do bot abaixo do limite' : 'Bot loss guard clear', ok: dailyGuard?.blocked === false, detail: (botLossPercent.toFixed(2) + '%') },
    {
      label: pt ? 'Proteção automática 24h' : '24h automatic protection',
      ok: !autoSafePause,
      detail: autoSafePause
        ? (pt ? 'PAUSA SEGURA • compras pausadas • saídas ativas' : 'SAFE PAUSE • buys paused • exits active')
        : (pt ? 'ATIVO • monitorando' : 'ACTIVE • monitoring')
    }
  ], [readiness, pt, dailyGuard, botLossPercent, autoSafePause])

  const runGuidedPreflight = async () => {
    if (!side || !(guidedAmount > 0) || autoSafePause) return
    setBusy(true)
    setPreflight(null)
    try {
      setPreflight(await api.livePreflight({
        productId: pipelineProduct,
        side,
        notionalUsd: Number(guidedAmount.toFixed(2))
      }))
    } catch (error: any) {
      setPreflight({ ok: false, error: error?.message || String(error) })
    } finally {
      setBusy(false)
      void load()
    }
  }

  const signalClass = plainSignal === 'BUY NOW'
    ? 'buy'
    : plainSignal === 'SELL NOW'
      ? 'sell'
      : plainSignal === 'BLOCKED' || plainSignal === 'AUTO SAFE PAUSE'
        ? 'blocked'
        : 'wait'

  return (
    <main className="live-page">
      <section className="panel live-panel">
        <div className="live-heading">
          <div>
            <span className="eyebrow">GUIDED LIVE TRADING</span>
            <h1>{pt ? 'A ferramenta protege e executa automaticamente' : 'The tool protects and executes automatically'}</h1>
            <p>{pt ? 'Você acompanha; o sistema monitora entradas, saídas e segurança.' : 'You monitor; the system handles entries, exits, and safety.'}</p>
          </div>
          <span className={readiness?.readyForLive && !autoSafePause ? 'live-ready-badge ok' : 'live-ready-badge'}>
            {hardBlocked
              ? (pt ? 'BLOQUEADO' : 'LOCKED')
              : autoSafePause
                ? (pt ? 'PAUSA SEGURA AUTO' : 'AUTO SAFE PAUSE')
                : readiness?.readyForAutoLive
                  ? (pt ? 'AUTO LIVE PRONTO' : 'AUTO LIVE READY')
                  : (pt ? 'LIVE PRONTO' : 'LIVE READY')}
          </span>
        </div>

        <div className="live-readiness-grid">
          {readinessItems.map((item) => (
            <div className="live-check" key={item.label}>
              <span className={item.ok ? 'check-dot ok' : 'check-dot'}>{item.ok ? '✓' : '×'}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </div>
          ))}
        </div>

        {rollingGuard ? (
          <div className={autoSafePause ? 'daily-guard-detail blocked' : 'daily-guard-detail'}>
            <div>
              <small>{pt ? 'Pico 24h' : '24h peak'}</small>
              <strong>{'$' + Number(rollingGuard.peakEquityUsd || 0).toFixed(2)}</strong>
            </div>
            <div>
              <small>{pt ? 'Equidade atual' : 'Current equity'}</small>
              <strong>{'$' + Number(rollingGuard.currentEquityUsd || readiness?.currentPortfolioUsd || 0).toFixed(2)}</strong>
            </div>
            <div>
              <small>{pt ? 'Drawdown 24h' : '24h drawdown'}</small>
              <strong>{Number(rollingGuard.drawdownPercent || 0).toFixed(2) + '%'}</strong>
            </div>
            <div>
              <small>{pt ? 'Limite auto safe' : 'Auto-safe limit'}</small>
              <strong>{Number(rollingGuard.limitPercent || 3).toFixed(2) + '%'}</strong>
            </div>
          </div>
        ) : null}

        {autoSafePause ? (
          <div className="market-drawdown-warning">
            <strong>AUTO SAFE PAUSE</strong>
            <span>{pt ? 'Novas compras pausadas automaticamente.' : 'New buys are paused automatically.'}</span>
            <small>{pt ? 'Stop-loss e take-profit continuam ativos. O bot volta sozinho após 30 minutos estáveis abaixo do limite.' : 'Stop-loss and take-profit remain active. The bot resumes automatically after 30 stable minutes below the limit.'}</small>
          </div>
        ) : null}

        {dailyGuard ? (
          <>
            <div className={dailyGuard.blocked ? 'daily-guard-detail blocked' : 'daily-guard-detail'}>
              <div><small>{pt ? 'P/L realizado pelo bot hoje' : 'Bot realized P/L today'}</small><strong>{'$' + Number(dailyGuard.realizedBotPnlUsd || 0).toFixed(2)}</strong></div>
              <div><small>{pt ? 'Perda realizada do bot' : 'Bot realized loss'}</small><strong>{'$' + Number(dailyGuard.realizedBotLossUsd || 0).toFixed(2)}</strong></div>
              <div><small>{pt ? 'Perda do bot %' : 'Bot loss %'}</small><strong>{botLossPercent.toFixed(2) + '%'}</strong></div>
              <div><small>{pt ? 'Limite diário do bot' : 'Bot daily limit'}</small><strong>{Number(dailyGuard.limitPercent || 0).toFixed(2) + '%'}</strong></div>
            </div>
            <div className="market-drawdown-warning">
              <strong>{pt ? 'Movimento do mercado' : 'Market drawdown'}</strong>
              <span>{'$' + Number(dailyGuard.startEquityUsd || 0).toFixed(2) + ' → $' + Number(dailyGuard.currentEquityUsd || 0).toFixed(2) + ' • ' + marketDrawdownPercent.toFixed(2) + '%'}</span>
              <small>{pt ? 'Esse movimento sozinho não bloqueia o bot.' : 'This market movement alone does not lock the bot.'}</small>
            </div>
          </>
        ) : null}

        <div className="live-stats">
          <div><small>{pt ? 'Portfólio atual' : 'Current portfolio'}</small><strong>{readiness?.currentPortfolioUsd != null ? '$' + Number(readiness.currentPortfolioUsd).toFixed(2) : '—'}</strong></div>
          <div><small>{pt ? 'Limite por posição' : 'Max position'}</small><strong>{readiness?.riskLimits?.maxPositionPercent != null ? readiness.riskLimits.maxPositionPercent + '%' : '—'}</strong></div>
          <div><small>{pt ? 'Decisão dos agentes' : 'Agent decision'}</small><strong>{candidate}</strong></div>
          <div><small>{pt ? 'Sinal simples' : 'Simple signal'}</small><strong>{plainSignal}</strong></div>
        </div>

        <div className={'simple-trade-signal ' + signalClass}>
          <small>{pt ? 'Status agora' : 'Status now'}</small>
          <strong>{plainSignal}</strong>
          <p>
            {hardBlocked
              ? (pt ? 'O Emergency Stop manual está bloqueando ordens reais.' : 'The manual Emergency Stop is blocking real orders.')
              : autoSafePause
                ? (pt ? 'Compras pausadas; saídas de proteção continuam ativas.' : 'Buys paused; protective exits remain active.')
                : pipelineRunning
                  ? (pt ? 'Os agentes estão analisando ' + pipelineProduct + '.' : 'The agents are analyzing ' + pipelineProduct + '.')
                  : (pt ? 'O sistema continua monitorando automaticamente.' : 'The system continues monitoring automatically.')}
          </p>
        </div>

        <div className="scanner-panel">
          <div className="scanner-head">
            <div>
              <span className="eyebrow">MULTI-CRYPTO SCANNER</span>
              <h2>{pt ? 'Oportunidades de curto prazo com liquidez' : 'Short-term opportunities with liquidity checks'}</h2>
            </div>
            <strong>{scanner?.scanned != null ? scanner.scanned + ' scanned' : '—'}</strong>
          </div>
          <div className="scanner-sides">
            <div className={scannerBuy ? 'scanner-best' : 'scanner-best wait'}>
              <small>{pt ? 'Melhor compra' : 'Best buy'}</small>
              <strong>{scannerBuy ? scannerBuy.productId + ' — BUY' : (pt ? 'NENHUMA COMPRA AGORA' : 'NO BUY RIGHT NOW')}</strong>
              {scannerBuy ? <span>{'Opportunity ' + Number(scannerBuy.buyScore || 0).toFixed(0) + '/100'}</span> : null}
            </div>
            <div className={scannerSell ? 'scanner-best sell' : 'scanner-best wait'}>
              <small>{pt ? 'Melhor venda' : 'Best sell'}</small>
              <strong>{scannerSell ? scannerSell.productId + ' — SELL' : (pt ? 'NENHUMA VENDA AGORA' : 'NO SELL RIGHT NOW')}</strong>
              {scannerSell ? <span>{'Opportunity ' + Number(scannerSell.sellScore || 0).toFixed(0) + '/100'}</span> : null}
            </div>
          </div>
          <div className="scanner-table">
            {(scanner?.results || []).slice(0, 6).map((row: any) => (
              <div key={row.productId}>
                <strong>{row.productId}</strong>
                <span>{'Buy ' + Number(row.buyScore || 0).toFixed(0)}</span>
                <span>{'Sell ' + Number(row.sellScore || 0).toFixed(0)}</span>
                <em>{row.buyCandidate ? 'BUY' : row.sellCandidate ? 'SELL' : 'WAIT'}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="guided-trade-card">
          {pipelineRunning ? (
            <div className="guided-wait"><strong>{pt ? 'Agentes analisando' : 'Agents analyzing'}</strong><p>{pipelineProduct}</p></div>
          ) : side ? (
            <>
              <div>
                <small>{pt ? 'Pré-checagem manual opcional' : 'Optional manual preflight'}</small>
                <strong>{side + ' ' + pipelineProduct + ' • $' + guidedAmount.toFixed(2)}</strong>
              </div>
              <button className="preflight-btn" onClick={() => void runGuidedPreflight()} disabled={busy || loading || hardBlocked || autoSafePause}>
                {busy ? (pt ? 'VALIDANDO...' : 'CHECKING...') : (pt ? 'VALIDAR ORDEM' : 'CHECK TRADE')}
              </button>
            </>
          ) : (
            <div className="guided-wait"><strong>{pt ? 'Nenhuma ordem manual necessária' : 'No manual order needed'}</strong><p>{pt ? 'O bot continua monitorando sozinho.' : 'The bot keeps monitoring automatically.'}</p></div>
          )}
        </div>

        {preflight ? (
          <div className={preflight?.preflight?.approved ? 'preflight-result ok' : 'preflight-result'}>
            <strong>{preflight?.preflight?.approved ? (pt ? 'PREFLIGHT APROVADO' : 'PREFLIGHT APPROVED') : (pt ? 'PREFLIGHT BLOQUEADO' : 'PREFLIGHT BLOCKED')}</strong>
            <p>{preflight?.error || preflight?.preflight?.reasons?.join('; ') || (pt ? 'Todos os checks passaram.' : 'All checks passed.')}</p>
          </div>
        ) : null}

        <div className="live-warning">
          <strong>{pt ? 'Automação' : 'Automation'}</strong>
          <span>
            {autoSafePause
              ? (pt ? 'Proteção automática ativa: compras pausadas, saídas continuam.' : 'Automatic protection active: buys paused, exits continue.')
              : readiness?.readyForAutoLive
                ? (pt ? 'AUTO LIVE ativo. Você pode apenas acompanhar.' : 'AUTO LIVE active. You can simply monitor it.')
                : (pt ? 'AUTO LIVE não está pronto.' : 'AUTO LIVE is not ready.')}
          </span>
        </div>
      </section>
    </main>
  )
}
