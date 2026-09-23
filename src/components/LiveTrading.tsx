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
  const blocked = !readiness?.readyForManualLive
  const plainSignal = blocked
    ? 'BLOCKED'
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

  const readinessItems = useMemo(
    () => [
      [pt ? 'Coinbase conectado' : 'Coinbase connected', Boolean(readiness?.configured)],
      [pt ? 'Modo live habilitado' : 'Live mode enabled', Boolean(readiness?.liveTradingEnabled)],
      [pt ? 'Trading automático desligado' : 'Automatic trading off', readiness?.automaticTradingEnabled === false],
      [pt ? 'Aprovação manual obrigatória' : 'Manual approval required', Boolean(readiness?.manualApprovalRequired)],
      [pt ? 'Emergency stop desligado' : 'Emergency stop off', readiness?.emergencyStop === false],
      [pt ? 'Limite diário disponível' : 'Daily loss guard clear', readiness?.dailyLossGuard?.blocked === false]
    ],
    [readiness, pt]
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
            <h1>
              {pt
                ? 'A ferramenta faz os cálculos por você'
                : 'The tool handles the trading mechanics for you'}
            </h1>
            <p>
              {pt
                ? 'Ela só prepara uma ordem quando os agentes geram um candidato válido.'
                : 'It only prepares a trade when the agents produce a valid candidate.'}
            </p>
          </div>
          <span className={readiness?.readyForManualLive ? 'live-ready-badge ok' : 'live-ready-badge'}>
            {readiness?.readyForManualLive ? (pt ? 'PRONTO' : 'READY') : pt ? 'BLOQUEADO' : 'LOCKED'}
          </span>
        </div>

        <div className="live-readiness-grid">
          {readinessItems.map(([label, ok]) => (
            <div className="live-check" key={String(label)}>
              <span className={ok ? 'check-dot ok' : 'check-dot'}>{ok ? '✓' : '×'}</span>
              <div>
                <strong>{label}</strong>
                <small>{ok ? 'OK' : pt ? 'Necessário' : 'Required'}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="live-stats">
          <div>
            <small>{pt ? 'Portfólio atual' : 'Current portfolio'}</small>
            <strong>
              {readiness?.currentPortfolioUsd != null
                ? '$' + Number(readiness.currentPortfolioUsd).toFixed(2)
                : '—'}
            </strong>
          </div>
          <div>
            <small>{pt ? 'Limite por posição' : 'Max position'}</small>
            <strong>
              {readiness?.riskLimits?.maxPositionPercent != null
                ? readiness.riskLimits.maxPositionPercent + '%'
                : '—'}
            </strong>
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
          className={`simple-trade-signal ${
            plainSignal === 'BUY NOW'
              ? 'buy'
              : plainSignal === 'SELL NOW'
                ? 'sell'
                : plainSignal === 'BLOCKED'
                  ? 'blocked'
                  : 'wait'
          }`}
        >
          <small>{pt ? 'O que fazer agora' : 'What to do now'}</small>
          <strong>{plainSignal}</strong>
          <p>
            {plainSignal === 'BUY NOW'
              ? pt
                ? 'Os agentes encontraram um candidato de compra e os controles atuais permitem preparar a ordem.'
                : 'The agents found a buy candidate and the current controls allow the trade to be prepared.'
              : plainSignal === 'SELL NOW'
                ? pt
                  ? 'Os agentes encontraram um candidato de venda e os controles atuais permitem preparar a ordem.'
                  : 'The agents found a sell candidate and the current controls allow the trade to be prepared.'
                : plainSignal === 'BLOCKED'
                  ? pt
                    ? 'Um controle de segurança está bloqueando qualquer ordem real agora.'
                    : 'A safety control is blocking any real trade right now.'
                  : pt
                    ? 'Os agentes não encontraram uma entrada válida agora.'
                    : 'The agents do not have a valid entry right now.'}
          </p>
        </div>

        <div className="scanner-panel">
          <div className="scanner-head">
            <div>
              <span className="eyebrow">MULTI-CRYPTO SCANNER</span>
              <h2>
                {pt
                  ? 'A ferramenta está comparando várias criptos'
                  : 'The tool is comparing multiple cryptos'}
              </h2>
            </div>
            <strong>{scanner?.scanned != null ? scanner.scanned + ' scanned' : '—'}</strong>
          </div>
          <div className="scanner-sides">
            {scannerBuy ? (
              <div className="scanner-best">
                <small>{pt ? 'Melhor compra agora' : 'Best buy candidate'}</small>
                <strong>{scannerBuy.productId + ' — BUY NOW'}</strong>
                <span>
                  {'Score ' +
                    Number(scannerBuy.score || 0).toFixed(0) +
                    '/100 • 24h ' +
                    Number(scannerBuy.change24hPercent || 0).toFixed(2) +
                    '%'}
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
                <small>{pt ? 'Melhor venda agora' : 'Best sell candidate'}</small>
                <strong>{scannerSell.productId + ' — SELL NOW'}</strong>
                <span>
                  {'Score ' +
                    Number(scannerSell.score || 0).toFixed(0) +
                    '/100 • 24h ' +
                    Number(scannerSell.change24hPercent || 0).toFixed(2) +
                    '%'}
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
                <span>{'Score ' + Number(row.score || 0).toFixed(0)}</span>
                <span>{Number(row.change24hPercent || 0).toFixed(2) + '% 24h'}</span>
                <em>{row.buyCandidate ? 'BUY' : row.sellCandidate ? 'SELL' : 'WAIT'}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="guided-trade-card">
          {side ? (
            <>
              <div>
                <small>{pt ? 'A ferramenta calculou' : 'Tool calculated'}</small>
                <strong>
                  {side + ' ' + pipelineProduct + ' • $' + guidedAmount.toFixed(2)}
                </strong>
                <p>
                  {pt
                    ? 'Esse valor fica dentro do seu limite atual por posição.'
                    : 'This amount stays within your current per-position limit.'}
                </p>
              </div>
              <button
                className="preflight-btn"
                onClick={() => void runGuidedPreflight()}
                disabled={busy || loading || !readiness?.readyForManualLive}
              >
                {busy
                  ? pt
                    ? 'VALIDANDO...'
                    : 'CHECKING...'
                  : pt
                    ? 'VALIDAR ORDEM'
                    : 'CHECK TRADE'}
              </button>
            </>
          ) : (
            <div className="guided-wait">
              <strong>
                {pt ? 'Nenhuma ordem será preparada agora' : 'No trade will be prepared now'}
              </strong>
              <p>
                {pt
                  ? 'Os agentes ainda estão em WAIT/REJECT. A ferramenta não vai forçar uma compra ou venda.'
                  : 'The agents are still at WAIT/REJECT. The tool will not force a buy or sell.'}
              </p>
            </div>
          )}
        </div>

        {preflight ? (
          <div
            className={
              preflight?.preflight?.approved ? 'preflight-result ok' : 'preflight-result'
            }
          >
            <strong>
              {preflight?.preflight?.approved
                ? pt
                  ? 'PREFLIGHT APROVADO'
                  : 'PREFLIGHT APPROVED'
                : pt
                  ? 'PREFLIGHT BLOQUEADO'
                  : 'PREFLIGHT BLOCKED'}
            </strong>
            {preflight?.preflight ? (
              <>
                <p>
                  {(pt ? 'Ordem preparada: ' : 'Prepared trade: ') +
                    preflight.preflight.side +
                    ' ' +
                    preflight.preflight.productId +
                    ' • $' +
                    Number(preflight.preflight.notionalUsd || 0).toFixed(2)}
                </p>
                {preflight.preflight.reasons?.length ? (
                  <ul>
                    {preflight.preflight.reasons.map((x: string) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {pt
                      ? 'Todos os checks passaram. Nenhum dinheiro foi movido ainda.'
                      : 'All checks passed. No money has moved yet.'}
                  </p>
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
            {pt
              ? 'A ferramenta pode preparar tudo automaticamente, mas uma ordem real ainda exige a etapa final de aprovação.'
              : 'The tool can prepare everything automatically, but a real order still requires the final approval step.'}
          </span>
        </div>
      </section>
    </main>
  )
}