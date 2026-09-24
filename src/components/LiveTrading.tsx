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
    pipeline?.productId ||
      scanner?.bestBuy?.productId ||
      scanner?.bestSell?.productId ||
      'BTC-USD'
  )

  const scannerBuy = scanner?.bestBuy || null
  const scannerSell = scanner?.bestSell || null

  const side: CandidateSide =
    candidate === 'BUY_CANDIDATE' ? 'BUY' : candidate === 'SELL_CANDIDATE' ? 'SELL' : null

  const hardBlocked = !readiness?.readyForLive
  const autoSafePause = Boolean(readiness?.autoSafePause)
  const rollingGuard = readiness?.rollingRiskGuard || null

  const plainSignal = hardBlocked
    ? 'BLOCKED'
    : autoSafePause
      ? 'AUTO SAFE PAUSE'
    : pipelineRunning
      ? 'ANALYZING ' + pipelineProduct + ' — WAIT FOR FINAL DECISION'
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
  const dailyGuard = readiness?.dailyLossGuard || null
  const botLossPercent = Number(dailyGuard?.botLossPercent ?? dailyGuard?.lossPercent ?? 0)
  const marketDrawdownPercent = Number(dailyGuard?.marketDrawdownPercent ?? 0)

  const dailyGuardDetail = dailyGuard
    ? dailyGuard.blocked
      ? (pt
          ? 'BLOQUEADO • perda realizada do bot ' + botLossPercent.toFixed(2) + '% / limite ' + Number(dailyGuard.limitPercent || 0).toFixed(2) + '%'
          : 'BLOCKED • bot realized loss ' + botLossPercent.toFixed(2) + '% / limit ' + Number(dailyGuard.limitPercent || 0).toFixed(2) + '%')
      : (pt
          ? 'OK • perda realizada do bot ' + botLossPercent.toFixed(2) + '% / limite ' + Number(dailyGuard.limitPercent || 0).toFixed(2) + '%'
          : 'OK • bot realized loss ' + botLossPercent.toFixed(2) + '% / limit ' + Number(dailyGuard.limitPercent || 0).toFixed(2) + '%')
    : (pt ? 'Sem dados' : 'No data')

  const readinessItems = useMemo(
    () => [
      { label: pt ? 'Coinbase conectado' : 'Coinbase connected', ok: Boolean(readiness?.configured), detail: 'OK' },
      { label: pt ? 'Modo live habilitado' : 'Live mode enabled', ok: Boolean(readiness?.liveTradingEnabled), detail: 'OK' },
      { label: pt ? 'Trading automático habilitado' : 'Automatic trading enabled', ok: Boolean(readiness?.automaticTradingEnabled), detail: 'OK' },
      { label: pt ? 'Modo de execução' : 'Execution mode', ok: Boolean(readiness?.automaticTradingEnabled || readiness?.manualApprovalRequired), detail: 'OK' },
      { label: pt ? 'Emergency stop desligado' : 'Emergency stop off', ok: readiness?.emergencyStop === false, detail: 'OK' },
      { label: pt ? 'Perda do bot abaixo do limite' : 'Bot loss guard clear', ok: dailyGuard?.blocked === false, detail: dailyGuardDetail },
      {
        label: pt ? 'Proteção automática 24h' : '24h automatic protection',
        ok: !autoSafePause,
        detail: autoSafePause
          ? (pt ? 'PAUSA SEGURA • novas compras pausadas • vendas protetoras ativas' : 'SAFE PAUSE • new buys paused • protective sells active')
          : (pt ? 'ATIVO • monitorando automaticamente' : 'ACTIVE • monitoring automatically')
      }
    ],
    [readiness, pt, dailyGuard, dailyGuardDetail, autoSafePause]
  )

  const runGuidedPreflight = async () => {
    if (!side || !(guidedAmount > 0)) return
    setBusy(true)
    setPreflight(null)
    try {
      setPreflight(
        await api.livePreflight({
          productId: pipelineProduct,
          side,
          notionalUsd: Number(guidedAmount.toFixed(2))
        })
      )
    } catch (error: any) {
      setPreflight({ ok: false, error: error?.message || String(error) })
    } finally {
      setBusy(false)
      void load()
    }
  }

  return (
    <main className="live-page">
      <section className="panel live-panel">
        <div className="live-heading">
          <div>
            <span className="eyebrow">GUIDED LIVE TRADING</span>
            <h1>{pt ? 'A ferramenta faz os cálculos por você' : 'The tool handles the trading mechanics for you'}</h1>
            <p>{pt ? 'Ela só prepara uma ordem quando os agentes geram um candidato válido.' : 'It only prepares a trade when the agents produce a valid candidate.'}</p>
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
            <div className="live-check" key={String(item.label)}>
              <span className={item.ok ? 'check-dot ok' : 'check-dot'}>{item.ok ? '✓' : '×'}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </div>
          ))}
        </div>

        {rollingGuard ? (
          <div className={autoSafePause ? 'market-drawdown-warning' : 'daily-guard-detail'}>
            <div>
              <small>{pt ? 'Pico 24h' : '24h peak'}</small>
              <strong>{'            <div className={dailyGuard.blocked ? 'daily-guard-detail blocked' : 'daily-guard-detail'}>
              <div>
                <small>{pt ? 'P/L realizado pelo bot hoje' : 'Bot realized P/L today'}</small>
                <strong>{'$' + Number(dailyGuard.realizedBotPnlUsd || 0).toFixed(2)}</strong>
              </div>
              <div>
                <small>{pt ? 'Perda realizada do bot' : 'Bot realized loss'}</small>
                <strong>{'$' + Number(dailyGuard.realizedBotLossUsd || 0).toFixed(2)}</strong>
              </div>
              <div>
                <small>{pt ? 'Perda do bot %' : 'Bot loss %'}</small>
                <strong>{botLossPercent.toFixed(2) + '%'}</strong>
              </div>
              <div>
                <small>{pt ? 'Limite diário do bot' : 'Bot daily limit'}</small>
                <strong>{Number(dailyGuard.limitPercent || 0).toFixed(2) + '%'}</strong>
              </div>
            </div>

            <div className="market-drawdown-warning">
              <strong>{pt ? 'Movimento do mercado' : 'Market drawdown'}</strong>
              <span>
                {(pt ? 'Portfólio: ' : 'Portfolio: ') +
                  '$' + Number(dailyGuard.startEquityUsd || 0).toFixed(2) +
                  ' → $' + Number(dailyGuard.currentEquityUsd || 0).toFixed(2) +
                  ' • ' + marketDrawdownPercent.toFixed(2) + '%'}
              </span>
              <small>{pt ? 'Esse movimento do mercado não bloqueia mais o bot.' : 'This market movement no longer locks the bot.'}</small>
            </div>
          </>
        ) : null}

        <div className="live-stats">
          <div>
            <small>{pt ? 'Portfólio atual' : 'Current portfolio'}</small>
            <strong>{readiness?.currentPortfolioUsd != null ? '$' + Number(readiness.currentPortfolioUsd).toFixed(2) : '—'}</strong>
          </div>
          <div>
            <small>{pt ? 'Limite por posição' : 'Max position'}</small>
            <strong>{readiness?.riskLimits?.maxPositionPercent != null ? readiness.riskLimits.maxPositionPercent + '%' : '—'}</strong>
          </div>
          <div>
            <small>{pt ? 'Decisão dos agentes' : 'Agent decision'}</small>
            <strong>{candidate}</strong>
          </div>
          <div>
            <small>{pt ? 'Sinal simples' : 'Simple signal'}</small>
            <strong>{plainSignal}</strong>
          </div>
        </div>

        <div
          className={
            'simple-trade-signal ' +
            (plainSignal === 'BUY NOW'
              ? 'buy'
              : plainSignal === 'SELL NOW'
                ? 'sell'
                : plainSignal === 'BLOCKED' || plainSignal === 'AUTO SAFE PAUSE'
                  ? 'blocked'
                  : 'wait')
          }
        >
          <small>{pt ? 'O que fazer agora' : 'What to do now'}</small>
          <strong>{plainSignal}</strong>
          <p>
            {pipelineRunning && !hardBlocked && !autoSafePause
              ? (pt
                  ? 'Os agentes ainda estão analisando ' + pipelineProduct + '. Aguarde a decisão final.'
                  : 'The agents are still analyzing ' + pipelineProduct + '. Wait for the final decision.')
              : plainSignal === 'BLOCKED'
                ? (pt ? 'O Emergency Stop manual está bloqueando ordens reais.' : 'The manual Emergency Stop is blocking real orders.')
                : plainSignal === 'AUTO SAFE PAUSE'
                  ? (pt ? 'Novas compras estão pausadas automaticamente; vendas de proteção continuam ativas e o bot volta sozinho quando estiver seguro.' : 'New buys are automatically paused; protective sells remain active and the bot resumes itself when safe.')
                : plainSignal === 'BUY NOW'
                  ? (pt ? 'Os agentes encontraram um candidato de compra.' : 'The agents found a buy candidate.')
                  : plainSignal === 'SELL NOW'
                    ? (pt ? 'Os agentes encontraram um candidato de venda.' : 'The agents found a sell candidate.')
                    : (pt ? 'Os agentes não encontraram uma entrada válida agora.' : 'The agents do not have a valid entry right now.')}
          </p>
        </div>

        <div className="scanner-panel">
          <div className="scanner-head">
            <div>
              <span className="eyebrow">MULTI-CRYPTO SCANNER</span>
              <h2>{pt ? 'Comparando oportunidades percentuais de curto prazo com liquidez' : 'Comparing short-term percentage opportunities with liquidity checks'}</h2>
            </div>
            <strong>{scanner?.scanned != null ? scanner.scanned + ' scanned' : '—'}</strong>
          </div>

          <div className="scanner-sides">
            {scannerBuy ? (
              <div className="scanner-best">
                <small>{pt ? 'Melhor oportunidade de compra' : 'Best short-term buy opportunity'}</small>
                <strong>{scannerBuy.productId + ' — BUY NOW'}</strong>
                <span>
                  {'Opportunity ' + Number(scannerBuy.buyScore ?? scannerBuy.score ?? 0).toFixed(0) +
                    '/100 • 6h ' + Number(scannerBuy.change6hPercent || 0).toFixed(2) +
                    '% • 24h ' + Number(scannerBuy.change24hPercent || 0).toFixed(2) +
                    '%' + (scannerBuy.spreadBps != null ? ' • spread ' + Number(scannerBuy.spreadBps).toFixed(1) + ' bps' : '')}
                </span>
              </div>
            ) : (
              <div className="scanner-best wait">
                <small>{pt ? 'Compra' : 'Buy'}</small>
                <strong>{pt ? 'NENHUMA BOA COMPRA AGORA' : 'NO GOOD BUY RIGHT NOW'}</strong>
              </div>
            )}

            {scannerSell ? (
              <div className="scanner-best sell">
                <small>{pt ? 'Melhor oportunidade de venda' : 'Best short-term sell opportunity'}</small>
                <strong>{scannerSell.productId + ' — SELL NOW'}</strong>
                <span>
                  {'Opportunity ' + Number(scannerSell.sellScore ?? scannerSell.score ?? 0).toFixed(0) +
                    '/100 • 6h ' + Number(scannerSell.change6hPercent || 0).toFixed(2) +
                    '% • 24h ' + Number(scannerSell.change24hPercent || 0).toFixed(2) +
                    '%' + (scannerSell.spreadBps != null ? ' • spread ' + Number(scannerSell.spreadBps).toFixed(1) + ' bps' : '')}
                </span>
              </div>
            ) : (
              <div className="scanner-best wait">
                <small>{pt ? 'Venda' : 'Sell'}</small>
                <strong>{pt ? 'NENHUMA VENDA FORTE AGORA' : 'NO STRONG SELL RIGHT NOW'}</strong>
              </div>
            )}
          </div>

          <div className="scanner-table">
            {(scanner?.results || []).slice(0, 6).map((row: any) => (
              <div key={row.productId}>
                <strong>{row.productId}</strong>
                <span>{'Opp ' + Number(row.buyCandidate ? row.buyScore : row.sellCandidate ? row.sellScore : Math.max(row.buyScore || 0, row.sellScore || 0, row.score || 0)).toFixed(0)}</span>
                <span>{Number(row.change6hPercent || 0).toFixed(2) + '% 6h • ' + Number(row.change24hPercent || 0).toFixed(2) + '% 24h'}</span>
                <em>{row.buyCandidate ? 'BUY' : row.sellCandidate ? 'SELL' : 'WAIT'}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="guided-trade-card">
          {pipelineRunning ? (
            <div className="guided-wait">
              <strong>{pt ? 'Analisando ' + pipelineProduct : 'Analyzing ' + pipelineProduct}</strong>
              <p>{pt ? 'O pipeline ainda não terminou. Nenhuma ordem deve ser preparada até a decisão final.' : 'The pipeline has not finished yet. No order should be prepared until the final decision.'}</p>
            </div>
          ) : side ? (
            <>
              <div>
                <small>{pt ? 'A ferramenta calculou' : 'Tool calculated'}</small>
                <strong>{side + ' ' + pipelineProduct + ' • $' + guidedAmount.toFixed(2)}</strong>
                <p>{pt ? 'Esse valor fica dentro do seu limite atual por posição.' : 'This amount stays within your current per-position limit.'}</p>
              </div>
              <button className="preflight-btn" onClick={() => void runGuidedPreflight()} disabled={busy || loading || !readiness?.readyForLive}>
                {busy ? (pt ? 'VALIDANDO...' : 'CHECKING...') : (pt ? 'VALIDAR ORDEM' : 'CHECK TRADE')}
              </button>
            </>
          ) : (
            <div className="guided-wait">
              <strong>{pt ? 'Nenhuma ordem será preparada agora' : 'No trade will be prepared now'}</strong>
              <p>{pt ? 'Os agentes ainda estão em WAIT/REJECT.' : 'The agents are still at WAIT/REJECT.'}</p>
            </div>
          )}
        </div>

        {preflight ? (
          <div className={preflight?.preflight?.approved ? 'preflight-result ok' : 'preflight-result'}>
            <strong>{preflight?.preflight?.approved ? (pt ? 'PREFLIGHT APROVADO' : 'PREFLIGHT APPROVED') : (pt ? 'PREFLIGHT BLOQUEADO' : 'PREFLIGHT BLOCKED')}</strong>
            {preflight?.preflight ? (
              <>
                <p>{(pt ? 'Ordem preparada: ' : 'Prepared trade: ') + preflight.preflight.side + ' ' + preflight.preflight.productId + ' • $' + Number(preflight.preflight.notionalUsd || 0).toFixed(2)}</p>
                {preflight.preflight.reasons?.length ? (
                  <ul>{preflight.preflight.reasons.map((x: string) => <li key={x}>{x}</li>)}</ul>
                ) : (
                  <p>{pt ? 'Todos os checks passaram. Nenhum dinheiro foi movido ainda.' : 'All checks passed. No money has moved yet.'}</p>
                )}
              </>
            ) : (
              <p>{preflight.error || 'Preflight failed.'}</p>
            )}
          </div>
        ) : null}

        <div className="live-warning">
          <strong>{pt ? 'Importante' : 'Important'}</strong>
          <span>
            {readiness?.readyForAutoLive
              ? (pt
                  ? 'AUTO LIVE está habilitado. Ordens candidatas ainda passam pelos limites de risco, preview da Coinbase, limite de confiança e cooldown antes de serem enviadas.'
                  : 'AUTO LIVE is enabled. Candidate orders still pass risk limits, Coinbase preview, the confidence threshold, and cooldown before submission.')
              : (pt
                  ? 'O modo live está disponível, mas a execução automática não está ativa.'
                  : 'Live mode is available, but automatic execution is not active.')}
          </span>
        </div>
      </section>
    </main>
  )
}
 + Number(rollingGuard.peakEquityUsd || 0).toFixed(2)}</strong>
            </div>
            <div>
              <small>{pt ? 'Equidade atual' : 'Current equity'}</small>
              <strong>{'            <div className={dailyGuard.blocked ? 'daily-guard-detail blocked' : 'daily-guard-detail'}>
              <div>
                <small>{pt ? 'P/L realizado pelo bot hoje' : 'Bot realized P/L today'}</small>
                <strong>{'$' + Number(dailyGuard.realizedBotPnlUsd || 0).toFixed(2)}</strong>
              </div>
              <div>
                <small>{pt ? 'Perda realizada do bot' : 'Bot realized loss'}</small>
                <strong>{'$' + Number(dailyGuard.realizedBotLossUsd || 0).toFixed(2)}</strong>
              </div>
              <div>
                <small>{pt ? 'Perda do bot %' : 'Bot loss %'}</small>
                <strong>{botLossPercent.toFixed(2) + '%'}</strong>
              </div>
              <div>
                <small>{pt ? 'Limite diário do bot' : 'Bot daily limit'}</small>
                <strong>{Number(dailyGuard.limitPercent || 0).toFixed(2) + '%'}</strong>
              </div>
            </div>

            <div className="market-drawdown-warning">
              <strong>{pt ? 'Movimento do mercado' : 'Market drawdown'}</strong>
              <span>
                {(pt ? 'Portfólio: ' : 'Portfolio: ') +
                  '$' + Number(dailyGuard.startEquityUsd || 0).toFixed(2) +
                  ' → $' + Number(dailyGuard.currentEquityUsd || 0).toFixed(2) +
                  ' • ' + marketDrawdownPercent.toFixed(2) + '%'}
              </span>
              <small>{pt ? 'Esse movimento do mercado não bloqueia mais o bot.' : 'This market movement no longer locks the bot.'}</small>
            </div>
          </>
        ) : null}

        <div className="live-stats">
          <div>
            <small>{pt ? 'Portfólio atual' : 'Current portfolio'}</small>
            <strong>{readiness?.currentPortfolioUsd != null ? '$' + Number(readiness.currentPortfolioUsd).toFixed(2) : '—'}</strong>
          </div>
          <div>
            <small>{pt ? 'Limite por posição' : 'Max position'}</small>
            <strong>{readiness?.riskLimits?.maxPositionPercent != null ? readiness.riskLimits.maxPositionPercent + '%' : '—'}</strong>
          </div>
          <div>
            <small>{pt ? 'Decisão dos agentes' : 'Agent decision'}</small>
            <strong>{candidate}</strong>
          </div>
          <div>
            <small>{pt ? 'Sinal simples' : 'Simple signal'}</small>
            <strong>{plainSignal}</strong>
          </div>
        </div>

        <div
          className={
            'simple-trade-signal ' +
            (plainSignal === 'BUY NOW'
              ? 'buy'
              : plainSignal === 'SELL NOW'
                ? 'sell'
                : plainSignal === 'BLOCKED'
                  ? 'blocked'
                  : 'wait')
          }
        >
          <small>{pt ? 'O que fazer agora' : 'What to do now'}</small>
          <strong>{plainSignal}</strong>
          <p>
            {pipelineRunning && !hardBlocked && !autoSafePause
              ? (pt
                  ? 'Os agentes ainda estão analisando ' + pipelineProduct + '. Aguarde a decisão final.'
                  : 'The agents are still analyzing ' + pipelineProduct + '. Wait for the final decision.')
              : plainSignal === 'BLOCKED'
                ? (pt ? 'Um controle de segurança está bloqueando qualquer ordem real agora.' : 'A safety control is blocking any real trade right now.')
                : plainSignal === 'BUY NOW'
                  ? (pt ? 'Os agentes encontraram um candidato de compra.' : 'The agents found a buy candidate.')
                  : plainSignal === 'SELL NOW'
                    ? (pt ? 'Os agentes encontraram um candidato de venda.' : 'The agents found a sell candidate.')
                    : (pt ? 'Os agentes não encontraram uma entrada válida agora.' : 'The agents do not have a valid entry right now.')}
          </p>
        </div>

        <div className="scanner-panel">
          <div className="scanner-head">
            <div>
              <span className="eyebrow">MULTI-CRYPTO SCANNER</span>
              <h2>{pt ? 'Comparando oportunidades percentuais de curto prazo com liquidez' : 'Comparing short-term percentage opportunities with liquidity checks'}</h2>
            </div>
            <strong>{scanner?.scanned != null ? scanner.scanned + ' scanned' : '—'}</strong>
          </div>

          <div className="scanner-sides">
            {scannerBuy ? (
              <div className="scanner-best">
                <small>{pt ? 'Melhor oportunidade de compra' : 'Best short-term buy opportunity'}</small>
                <strong>{scannerBuy.productId + ' — BUY NOW'}</strong>
                <span>
                  {'Opportunity ' + Number(scannerBuy.buyScore ?? scannerBuy.score ?? 0).toFixed(0) +
                    '/100 • 6h ' + Number(scannerBuy.change6hPercent || 0).toFixed(2) +
                    '% • 24h ' + Number(scannerBuy.change24hPercent || 0).toFixed(2) +
                    '%' + (scannerBuy.spreadBps != null ? ' • spread ' + Number(scannerBuy.spreadBps).toFixed(1) + ' bps' : '')}
                </span>
              </div>
            ) : (
              <div className="scanner-best wait">
                <small>{pt ? 'Compra' : 'Buy'}</small>
                <strong>{pt ? 'NENHUMA BOA COMPRA AGORA' : 'NO GOOD BUY RIGHT NOW'}</strong>
              </div>
            )}

            {scannerSell ? (
              <div className="scanner-best sell">
                <small>{pt ? 'Melhor oportunidade de venda' : 'Best short-term sell opportunity'}</small>
                <strong>{scannerSell.productId + ' — SELL NOW'}</strong>
                <span>
                  {'Opportunity ' + Number(scannerSell.sellScore ?? scannerSell.score ?? 0).toFixed(0) +
                    '/100 • 6h ' + Number(scannerSell.change6hPercent || 0).toFixed(2) +
                    '% • 24h ' + Number(scannerSell.change24hPercent || 0).toFixed(2) +
                    '%' + (scannerSell.spreadBps != null ? ' • spread ' + Number(scannerSell.spreadBps).toFixed(1) + ' bps' : '')}
                </span>
              </div>
            ) : (
              <div className="scanner-best wait">
                <small>{pt ? 'Venda' : 'Sell'}</small>
                <strong>{pt ? 'NENHUMA VENDA FORTE AGORA' : 'NO STRONG SELL RIGHT NOW'}</strong>
              </div>
            )}
          </div>

          <div className="scanner-table">
            {(scanner?.results || []).slice(0, 6).map((row: any) => (
              <div key={row.productId}>
                <strong>{row.productId}</strong>
                <span>{'Opp ' + Number(row.buyCandidate ? row.buyScore : row.sellCandidate ? row.sellScore : Math.max(row.buyScore || 0, row.sellScore || 0, row.score || 0)).toFixed(0)}</span>
                <span>{Number(row.change6hPercent || 0).toFixed(2) + '% 6h • ' + Number(row.change24hPercent || 0).toFixed(2) + '% 24h'}</span>
                <em>{row.buyCandidate ? 'BUY' : row.sellCandidate ? 'SELL' : 'WAIT'}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="guided-trade-card">
          {pipelineRunning ? (
            <div className="guided-wait">
              <strong>{pt ? 'Analisando ' + pipelineProduct : 'Analyzing ' + pipelineProduct}</strong>
              <p>{pt ? 'O pipeline ainda não terminou. Nenhuma ordem deve ser preparada até a decisão final.' : 'The pipeline has not finished yet. No order should be prepared until the final decision.'}</p>
            </div>
          ) : side ? (
            <>
              <div>
                <small>{pt ? 'A ferramenta calculou' : 'Tool calculated'}</small>
                <strong>{side + ' ' + pipelineProduct + ' • $' + guidedAmount.toFixed(2)}</strong>
                <p>{pt ? 'Esse valor fica dentro do seu limite atual por posição.' : 'This amount stays within your current per-position limit.'}</p>
              </div>
              <button className="preflight-btn" onClick={() => void runGuidedPreflight()} disabled={busy || loading || !readiness?.readyForLive}>
                {busy ? (pt ? 'VALIDANDO...' : 'CHECKING...') : (pt ? 'VALIDAR ORDEM' : 'CHECK TRADE')}
              </button>
            </>
          ) : (
            <div className="guided-wait">
              <strong>{pt ? 'Nenhuma ordem será preparada agora' : 'No trade will be prepared now'}</strong>
              <p>{pt ? 'Os agentes ainda estão em WAIT/REJECT.' : 'The agents are still at WAIT/REJECT.'}</p>
            </div>
          )}
        </div>

        {preflight ? (
          <div className={preflight?.preflight?.approved ? 'preflight-result ok' : 'preflight-result'}>
            <strong>{preflight?.preflight?.approved ? (pt ? 'PREFLIGHT APROVADO' : 'PREFLIGHT APPROVED') : (pt ? 'PREFLIGHT BLOQUEADO' : 'PREFLIGHT BLOCKED')}</strong>
            {preflight?.preflight ? (
              <>
                <p>{(pt ? 'Ordem preparada: ' : 'Prepared trade: ') + preflight.preflight.side + ' ' + preflight.preflight.productId + ' • $' + Number(preflight.preflight.notionalUsd || 0).toFixed(2)}</p>
                {preflight.preflight.reasons?.length ? (
                  <ul>{preflight.preflight.reasons.map((x: string) => <li key={x}>{x}</li>)}</ul>
                ) : (
                  <p>{pt ? 'Todos os checks passaram. Nenhum dinheiro foi movido ainda.' : 'All checks passed. No money has moved yet.'}</p>
                )}
              </>
            ) : (
              <p>{preflight.error || 'Preflight failed.'}</p>
            )}
          </div>
        ) : null}

        <div className="live-warning">
          <strong>{pt ? 'Importante' : 'Important'}</strong>
          <span>
            {readiness?.readyForAutoLive
              ? (pt
                  ? 'AUTO LIVE está habilitado. Ordens candidatas ainda passam pelos limites de risco, preview da Coinbase, limite de confiança e cooldown antes de serem enviadas.'
                  : 'AUTO LIVE is enabled. Candidate orders still pass risk limits, Coinbase preview, the confidence threshold, and cooldown before submission.')
              : (pt
                  ? 'O modo live está disponível, mas a execução automática não está ativa.'
                  : 'Live mode is available, but automatic execution is not active.')}
          </span>
        </div>
      </section>
    </main>
  )
}
 + Number(rollingGuard.currentEquityUsd || readiness?.currentPortfolioUsd || 0).toFixed(2)}</strong>
            </div>
            <div>
              <small>{pt ? 'Drawdown 24h' : '24h drawdown'}</small>
              <strong>{Number(rollingGuard.drawdownPercent || 0).toFixed(2) + '%'}</strong>
            </div>
            <div>
              <small>{pt ? 'Limite auto safe' : 'Auto-safe limit'}</small>
              <strong>{Number(rollingGuard.limitPercent || 3).toFixed(2) + '%'}</strong>
            </div>
            <small>
              {autoSafePause
                ? (pt
                    ? 'AUTO SAFE PAUSE: novas compras estão pausadas. Stop-loss e take-profit continuam ativos. O bot volta sozinho após 30 minutos estáveis abaixo do limite.'
                    : 'AUTO SAFE PAUSE: new buys are paused. Stop-loss and take-profit remain active. The bot resumes automatically after 30 stable minutes below the limit.')
                : (pt
                    ? 'Proteção automática monitorando continuamente.'
                    : 'Automatic protection is continuously monitoring.')}
            </small>
          </div>
        ) : null}

        {dailyGuard ? (
          <>
            <div className={dailyGuard.blocked ? 'daily-guard-detail blocked' : 'daily-guard-detail'}>
              <div>
                <small>{pt ? 'P/L realizado pelo bot hoje' : 'Bot realized P/L today'}</small>
                <strong>{'$' + Number(dailyGuard.realizedBotPnlUsd || 0).toFixed(2)}</strong>
              </div>
              <div>
                <small>{pt ? 'Perda realizada do bot' : 'Bot realized loss'}</small>
                <strong>{'$' + Number(dailyGuard.realizedBotLossUsd || 0).toFixed(2)}</strong>
              </div>
              <div>
                <small>{pt ? 'Perda do bot %' : 'Bot loss %'}</small>
                <strong>{botLossPercent.toFixed(2) + '%'}</strong>
              </div>
              <div>
                <small>{pt ? 'Limite diário do bot' : 'Bot daily limit'}</small>
                <strong>{Number(dailyGuard.limitPercent || 0).toFixed(2) + '%'}</strong>
              </div>
            </div>

            <div className="market-drawdown-warning">
              <strong>{pt ? 'Movimento do mercado' : 'Market drawdown'}</strong>
              <span>
                {(pt ? 'Portfólio: ' : 'Portfolio: ') +
                  '$' + Number(dailyGuard.startEquityUsd || 0).toFixed(2) +
                  ' → $' + Number(dailyGuard.currentEquityUsd || 0).toFixed(2) +
                  ' • ' + marketDrawdownPercent.toFixed(2) + '%'}
              </span>
              <small>{pt ? 'Esse movimento do mercado não bloqueia mais o bot.' : 'This market movement no longer locks the bot.'}</small>
            </div>
          </>
        ) : null}

        <div className="live-stats">
          <div>
            <small>{pt ? 'Portfólio atual' : 'Current portfolio'}</small>
            <strong>{readiness?.currentPortfolioUsd != null ? '$' + Number(readiness.currentPortfolioUsd).toFixed(2) : '—'}</strong>
          </div>
          <div>
            <small>{pt ? 'Limite por posição' : 'Max position'}</small>
            <strong>{readiness?.riskLimits?.maxPositionPercent != null ? readiness.riskLimits.maxPositionPercent + '%' : '—'}</strong>
          </div>
          <div>
            <small>{pt ? 'Decisão dos agentes' : 'Agent decision'}</small>
            <strong>{candidate}</strong>
          </div>
          <div>
            <small>{pt ? 'Sinal simples' : 'Simple signal'}</small>
            <strong>{plainSignal}</strong>
          </div>
        </div>

        <div
          className={
            'simple-trade-signal ' +
            (plainSignal === 'BUY NOW'
              ? 'buy'
              : plainSignal === 'SELL NOW'
                ? 'sell'
                : plainSignal === 'BLOCKED'
                  ? 'blocked'
                  : 'wait')
          }
        >
          <small>{pt ? 'O que fazer agora' : 'What to do now'}</small>
          <strong>{plainSignal}</strong>
          <p>
            {pipelineRunning && !hardBlocked && !autoSafePause
              ? (pt
                  ? 'Os agentes ainda estão analisando ' + pipelineProduct + '. Aguarde a decisão final.'
                  : 'The agents are still analyzing ' + pipelineProduct + '. Wait for the final decision.')
              : plainSignal === 'BLOCKED'
                ? (pt ? 'Um controle de segurança está bloqueando qualquer ordem real agora.' : 'A safety control is blocking any real trade right now.')
                : plainSignal === 'BUY NOW'
                  ? (pt ? 'Os agentes encontraram um candidato de compra.' : 'The agents found a buy candidate.')
                  : plainSignal === 'SELL NOW'
                    ? (pt ? 'Os agentes encontraram um candidato de venda.' : 'The agents found a sell candidate.')
                    : (pt ? 'Os agentes não encontraram uma entrada válida agora.' : 'The agents do not have a valid entry right now.')}
          </p>
        </div>

        <div className="scanner-panel">
          <div className="scanner-head">
            <div>
              <span className="eyebrow">MULTI-CRYPTO SCANNER</span>
              <h2>{pt ? 'Comparando oportunidades percentuais de curto prazo com liquidez' : 'Comparing short-term percentage opportunities with liquidity checks'}</h2>
            </div>
            <strong>{scanner?.scanned != null ? scanner.scanned + ' scanned' : '—'}</strong>
          </div>

          <div className="scanner-sides">
            {scannerBuy ? (
              <div className="scanner-best">
                <small>{pt ? 'Melhor oportunidade de compra' : 'Best short-term buy opportunity'}</small>
                <strong>{scannerBuy.productId + ' — BUY NOW'}</strong>
                <span>
                  {'Opportunity ' + Number(scannerBuy.buyScore ?? scannerBuy.score ?? 0).toFixed(0) +
                    '/100 • 6h ' + Number(scannerBuy.change6hPercent || 0).toFixed(2) +
                    '% • 24h ' + Number(scannerBuy.change24hPercent || 0).toFixed(2) +
                    '%' + (scannerBuy.spreadBps != null ? ' • spread ' + Number(scannerBuy.spreadBps).toFixed(1) + ' bps' : '')}
                </span>
              </div>
            ) : (
              <div className="scanner-best wait">
                <small>{pt ? 'Compra' : 'Buy'}</small>
                <strong>{pt ? 'NENHUMA BOA COMPRA AGORA' : 'NO GOOD BUY RIGHT NOW'}</strong>
              </div>
            )}

            {scannerSell ? (
              <div className="scanner-best sell">
                <small>{pt ? 'Melhor oportunidade de venda' : 'Best short-term sell opportunity'}</small>
                <strong>{scannerSell.productId + ' — SELL NOW'}</strong>
                <span>
                  {'Opportunity ' + Number(scannerSell.sellScore ?? scannerSell.score ?? 0).toFixed(0) +
                    '/100 • 6h ' + Number(scannerSell.change6hPercent || 0).toFixed(2) +
                    '% • 24h ' + Number(scannerSell.change24hPercent || 0).toFixed(2) +
                    '%' + (scannerSell.spreadBps != null ? ' • spread ' + Number(scannerSell.spreadBps).toFixed(1) + ' bps' : '')}
                </span>
              </div>
            ) : (
              <div className="scanner-best wait">
                <small>{pt ? 'Venda' : 'Sell'}</small>
                <strong>{pt ? 'NENHUMA VENDA FORTE AGORA' : 'NO STRONG SELL RIGHT NOW'}</strong>
              </div>
            )}
          </div>

          <div className="scanner-table">
            {(scanner?.results || []).slice(0, 6).map((row: any) => (
              <div key={row.productId}>
                <strong>{row.productId}</strong>
                <span>{'Opp ' + Number(row.buyCandidate ? row.buyScore : row.sellCandidate ? row.sellScore : Math.max(row.buyScore || 0, row.sellScore || 0, row.score || 0)).toFixed(0)}</span>
                <span>{Number(row.change6hPercent || 0).toFixed(2) + '% 6h • ' + Number(row.change24hPercent || 0).toFixed(2) + '% 24h'}</span>
                <em>{row.buyCandidate ? 'BUY' : row.sellCandidate ? 'SELL' : 'WAIT'}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="guided-trade-card">
          {pipelineRunning ? (
            <div className="guided-wait">
              <strong>{pt ? 'Analisando ' + pipelineProduct : 'Analyzing ' + pipelineProduct}</strong>
              <p>{pt ? 'O pipeline ainda não terminou. Nenhuma ordem deve ser preparada até a decisão final.' : 'The pipeline has not finished yet. No order should be prepared until the final decision.'}</p>
            </div>
          ) : side ? (
            <>
              <div>
                <small>{pt ? 'A ferramenta calculou' : 'Tool calculated'}</small>
                <strong>{side + ' ' + pipelineProduct + ' • $' + guidedAmount.toFixed(2)}</strong>
                <p>{pt ? 'Esse valor fica dentro do seu limite atual por posição.' : 'This amount stays within your current per-position limit.'}</p>
              </div>
              <button className="preflight-btn" onClick={() => void runGuidedPreflight()} disabled={busy || loading || !readiness?.readyForLive}>
                {busy ? (pt ? 'VALIDANDO...' : 'CHECKING...') : (pt ? 'VALIDAR ORDEM' : 'CHECK TRADE')}
              </button>
            </>
          ) : (
            <div className="guided-wait">
              <strong>{pt ? 'Nenhuma ordem será preparada agora' : 'No trade will be prepared now'}</strong>
              <p>{pt ? 'Os agentes ainda estão em WAIT/REJECT.' : 'The agents are still at WAIT/REJECT.'}</p>
            </div>
          )}
        </div>

        {preflight ? (
          <div className={preflight?.preflight?.approved ? 'preflight-result ok' : 'preflight-result'}>
            <strong>{preflight?.preflight?.approved ? (pt ? 'PREFLIGHT APROVADO' : 'PREFLIGHT APPROVED') : (pt ? 'PREFLIGHT BLOQUEADO' : 'PREFLIGHT BLOCKED')}</strong>
            {preflight?.preflight ? (
              <>
                <p>{(pt ? 'Ordem preparada: ' : 'Prepared trade: ') + preflight.preflight.side + ' ' + preflight.preflight.productId + ' • $' + Number(preflight.preflight.notionalUsd || 0).toFixed(2)}</p>
                {preflight.preflight.reasons?.length ? (
                  <ul>{preflight.preflight.reasons.map((x: string) => <li key={x}>{x}</li>)}</ul>
                ) : (
                  <p>{pt ? 'Todos os checks passaram. Nenhum dinheiro foi movido ainda.' : 'All checks passed. No money has moved yet.'}</p>
                )}
              </>
            ) : (
              <p>{preflight.error || 'Preflight failed.'}</p>
            )}
          </div>
        ) : null}

        <div className="live-warning">
          <strong>{pt ? 'Importante' : 'Important'}</strong>
          <span>
            {readiness?.readyForAutoLive
              ? (pt
                  ? 'AUTO LIVE está habilitado. Ordens candidatas ainda passam pelos limites de risco, preview da Coinbase, limite de confiança e cooldown antes de serem enviadas.'
                  : 'AUTO LIVE is enabled. Candidate orders still pass risk limits, Coinbase preview, the confidence threshold, and cooldown before submission.')
              : (pt
                  ? 'O modo live está disponível, mas a execução automática não está ativa.'
                  : 'Live mode is available, but automatic execution is not active.')}
          </span>
        </div>
      </section>
    </main>
  )
}
