import React, { useCallback, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import {
  gradeStock,
  computeSectorStats,
  SCORE_WEIGHTS,
} from '../utils/stockGrading'
import { formatMoney, formatMoneyCompact } from '../utils/money'

const QUESTION_DETAILS = {
  1: [
    'P/E, forward P/E and PEG say how much you pay per dollar of earnings and growth.',
    'P/B and P/S matter most for asset-heavy or unprofitable companies.',
    'Everything is judged against the sector; a cheap utility P/E differs from a cheap tech P/E.',
  ],
  2: [
    'Net, operating and gross margins show how much of each sales dollar becomes profit.',
    'Return on equity / assets shows how efficiently capital is put to work.',
    'Consistently high margins are a sign of a durable competitive advantage.',
  ],
  3: [
    'Revenue growth shows the top line is expanding; earnings growth shows it reaches the bottom line.',
    'Positive trailing EPS confirms the company is actually profitable today.',
    'A history of beating estimates is a quality signal when available.',
  ],
  4: [
    'Debt/equity gauges leverage; lower is safer, though banks and utilities can run high.',
    'Current ratio above ~1.5 means short-term bills are comfortably covered.',
    'For dividend payers, a payout ratio under ~60% leaves room to keep paying through a downturn.',
  ],
  5: [
    'Price above the 50- and 200-day averages is an uptrend; below is a downtrend.',
    'A golden cross, with the 50-day above the 200-day, is a longer-term bullish backdrop.',
  ],
  6: [
    'MACD line above its signal line is bullish momentum; below is bearish.',
    'RSI below 30 is oversold, while above 70 is overbought.',
  ],
  7: [
    'Slow stochastic below 20 is oversold; above 80 is overbought.',
    'The awesome oscillator above zero and rising confirms building bullish momentum.',
  ],
  8: [
    'Rising on-balance volume means buyers are accumulating; falling means distribution.',
    'Buying near the low end of the 52-week range gives a better entry than chasing near highs.',
  ],
}

const toneClass = (tone) => (
  tone === 'pass' || tone === 'warn' || tone === 'fail' ? tone : 'info'
)

const scoreTone = (value) => {
  if (typeof value !== 'number') return 'info'
  if (value >= 70) return 'pass'
  if (value >= 50) return 'warn'
  return 'fail'
}

const fmtMoney = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-'
  const v = Number(n)
  if (Math.abs(v) >= 1e6) return formatMoneyCompact(v, { fallback: '-' })
  return formatMoney(v, { fallback: '-' })
}

function Badge({ tone, children }) {
  return (
    <span className={`stock-check-badge tone-${toneClass(tone)}`}>
      {children}
    </span>
  )
}

function CriterionCard({ criterion }) {
  const c = criterion

  return (
    <article className="stock-check-card stock-check-criterion-card">
      <div className="stock-check-criterion-head">
        <span className="stock-check-criterion-question">{c.question}</span>
        {typeof c.score === 'number' && (
          <span className="stock-check-score-label">{c.score}/100</span>
        )}
        <Badge tone={c.badge}>{c.badge}</Badge>
      </div>

      <div className="stock-check-metrics">
        {c.metrics.map((m, i) => (
          <div className="stock-check-metric" key={i}>
            <span>{m.label}: </span>
            <strong className={`stock-check-metric-value tone-${toneClass(m.badge)}`}>
              {m.value}
            </strong>
          </div>
        ))}
      </div>

      {c.rationale && <p className="stock-check-rationale">{c.rationale}</p>}

      {(QUESTION_DETAILS[c.id] || []).length > 0 && (
        <details className="stock-check-details">
          <summary>What to check</summary>
          <ul>
            {QUESTION_DETAILS[c.id].map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </details>
      )}
    </article>
  )
}

function CompositePill({ label, value }) {
  const v = typeof value === 'number' ? value : null

  return (
    <div className={`stock-check-score-pill tone-${scoreTone(v)}`}>
      <div className="stock-check-score-pill-label">{label}</div>
      <div className="stock-check-score-pill-value">
        {v === null ? 'n/a' : v.toFixed(0)}
        <span> / 100</span>
      </div>
    </div>
  )
}

function SecurityHeader({ metrics, result }) {
  return (
    <section className="stock-check-card stock-check-security-card">
      <div className="stock-check-security-title">
        <h2>{metrics.ticker}</h2>
        <span>{metrics.name}</span>
      </div>

      <div className="stock-check-meta">
        <span><span>Sector: </span><strong>{metrics.sector || 'n/a'}</strong></span>
        <span><span>Industry: </span><strong>{metrics.industry || 'n/a'}</strong></span>
        <span><span>Price: </span><strong>{formatMoney(metrics.price, { fallback: '-' })}</strong></span>
        <span><span>Market cap: </span><strong>{fmtMoney(metrics.market_cap)}</strong></span>
        {metrics.earnings?.next_earnings_date && (
          <span>
            <span>Next earnings: </span>
            <strong>
              {metrics.earnings.next_earnings_date}
              {metrics.earnings.days_to_earnings != null ? ` (${metrics.earnings.days_to_earnings}d)` : ''}
            </strong>
          </span>
        )}
      </div>

      <div className="stock-check-score-grid">
        <CompositePill label="Fundamental" value={result.fundamental.composite} />
        <CompositePill label="Technical" value={result.technical.composite} />
        <CompositePill
          label={`Blended (${Math.round(SCORE_WEIGHTS.fundamental * 100)}/${Math.round(SCORE_WEIGHTS.technical * 100)})`}
          value={result.verdict.combined}
        />
      </div>

      <p className="stock-check-benchmark-note">
        Fundamentals graded {result.benchmarkSource === 'cohort'
          ? 'against your scanned sector cohort'
          : `against the built-in ${metrics.sector || 'default'} sector baseline`}.
      </p>
    </section>
  )
}

function DeepDive() {
  const [inputTicker, setInputTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [metrics, setMetrics] = useState(null)

  const evaluate = useCallback((ticker) => {
    if (!ticker) return
    setLoading(true)
    setError('')
    setMetrics(null)
    fetch(`${API_BASE}/api/stock-evaluate/${encodeURIComponent(ticker)}`, { cache: 'no-store' })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Could not evaluate ticker.')
        setMetrics(payload)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const submit = (e) => {
    e?.preventDefault?.()
    const t = inputTicker.trim().toUpperCase()
    if (t) evaluate(t)
  }

  const result = useMemo(() => (metrics ? gradeStock(metrics) : null), [metrics])

  return (
    <>
      <form className="stock-check-search" onSubmit={submit}>
        <input
          className="stock-check-input stock-check-ticker-input"
          value={inputTicker}
          onChange={e => setInputTicker(e.target.value.toUpperCase())}
          placeholder="e.g. AAPL, MSFT, KO, JPM..."
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>Evaluate</button>
      </form>

      {loading && <div className="cef-loading"><span className="spinner" /> Fetching data from Yahoo Finance...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {result && metrics && (
        <>
          {metrics.is_fund && (
            <div className="stock-check-callout tone-warn">
              {metrics.ticker} is a {metrics.fund_kind || 'fund'}, not an individual stock. Company fundamentals will not apply,
              so the score below reflects mostly chart/technical signals. Use the ETF, Option-Income, or CEF evaluator for funds.
            </div>
          )}

          <SecurityHeader metrics={metrics} result={result} />

          {result.verdict && (
            <div className={`stock-check-verdict tone-${toneClass(result.verdict.tone)}`}>
              <span>Verdict: {result.verdict.label}</span>
              <p>{result.verdict.detail}</p>
            </div>
          )}

          <h3 className="stock-check-section-title">Fundamental analysis</h3>
          <div className="stock-check-card-list">
            {result.fundamental.criteria.map(c => <CriterionCard key={c.id} criterion={c} />)}
          </div>

          <h3 className="stock-check-section-title stock-check-section-title-spaced">Technical analysis</h3>
          <div className="stock-check-card-list">
            {result.technical.criteria.map(c => <CriterionCard key={c.id} criterion={c} />)}
          </div>

          <div className="stock-check-notes">
            <strong>Notes:</strong> Data is fetched live from Yahoo Finance. Fundamentals are scored
            relative to the stock's sector; technicals use standard indicator signals
            (50/200-day trend, MACD, RSI, slow stochastic, awesome oscillator, OBV/volume).
            This is decision support, not investment advice.
          </div>
        </>
      )}
    </>
  )
}

function ScanTab() {
  const [tickersText, setTickersText] = useState('')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [sortKey, setSortKey] = useState('combined')
  const [sortDir, setSortDir] = useState('desc')

  const runScan = useCallback(() => {
    setLoading(true)
    setError('')
    setData(null)

    const body = {}
    const list = tickersText.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    if (list.length) body.tickers = list
    if (source) body.source = source
    if (!list.length && !source) {
      setError('Enter tickers or pick a source.')
      setLoading(false)
      return
    }

    fetch(`${API_BASE}/api/stock-checklist/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Scan failed.')
        setData(payload)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [tickersText, source])

  const rows = useMemo(() => {
    if (!data?.results?.length) return []
    const sectorStats = computeSectorStats(data.results)
    const graded = data.results.map(m => {
      const g = gradeStock(m, { sectorStats })
      return {
        ticker: m.ticker,
        name: m.name,
        sector: m.sector || '-',
        price: m.price,
        pe: m.fundamentals?.trailing_pe ?? null,
        peg: m.fundamentals?.peg_ratio ?? null,
        fund: g.fundamental.composite,
        tech: g.technical.composite,
        combined: g.verdict.combined,
        verdict: g.verdict.label,
        tone: g.verdict.tone,
      }
    })
    const dir = sortDir === 'asc' ? 1 : -1
    const val = (r) => {
      const v = r[sortKey]
      if (typeof v === 'number') return v
      if (v === null || v === undefined) return -Infinity
      return v
    }
    return [...graded].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (typeof av === 'string' || typeof bv === 'string') return dir * String(av).localeCompare(String(bv))
      return dir * (av - bv)
    })
  }, [data, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'ticker' || key === 'sector' || key === 'verdict' ? 'asc' : 'desc')
    }
  }

  const th = (key, label, align = 'right') => (
    <th
      className={`stock-check-sort stock-check-align-${align}${sortKey === key ? ' is-active' : ''}`}
      onClick={() => toggleSort(key)}
    >
      {label}
      {sortKey === key && <span className="stock-check-sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )

  const cell = (v, suffix = '') => (
    v === null || v === undefined || !Number.isFinite(Number(v)) ? '-' : `${Number(v).toFixed(suffix === 'x' ? 2 : 0)}${suffix}`
  )

  return (
    <>
      <div className="stock-check-scan-controls">
        <input
          className="stock-check-input stock-check-scan-input"
          value={tickersText}
          onChange={e => setTickersText(e.target.value)}
          placeholder="Tickers, e.g. AAPL MSFT NVDA KO JPM XOM"
        />
        <select
          className="stock-check-input stock-check-source-select"
          value={source}
          onChange={e => setSource(e.target.value)}
        >
          <option value="">- or pick a source -</option>
          <option value="portfolio">My portfolio</option>
          <option value="watchlist">My watchlist</option>
        </select>
        <button type="button" className="btn btn-primary" onClick={runScan} disabled={loading}>Scan</button>
      </div>

      {loading && <div className="cef-loading"><span className="spinner" /> Scoring stocks - this fetches each ticker live and can take a moment...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && (
        <>
          <div className="stock-check-scan-summary">
            Scored {data.returned} stock(s) of {data.requested} requested. Graded sector-relative within this batch.
            {data.truncated && ` Capped at ${data.scan_limit}.`}
            {data.errors?.length > 0 && ` Could not load: ${data.errors.map(e => e.ticker).join(', ')}.`}
          </div>

          {data.skipped_funds?.length > 0 && (
            <div className="stock-check-callout tone-info">
              <strong>{data.skipped_funds.length} fund{data.skipped_funds.length === 1 ? '' : 's'} skipped</strong>
              {' '}because this checklist grades individual stocks. For these, use the ETF / Option-Income / CEF evaluators:
              <div>{data.skipped_funds.map(f => `${f.ticker} (${f.kind})`).join(', ')}</div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="stock-check-table-wrap">
              <table className="stock-check-table">
                <thead>
                  <tr>
                    {th('ticker', 'Ticker', 'left')}
                    {th('sector', 'Sector', 'left')}
                    {th('price', 'Price')}
                    {th('pe', 'P/E')}
                    {th('peg', 'PEG')}
                    {th('fund', 'Fund.')}
                    {th('tech', 'Tech.')}
                    {th('combined', 'Blended')}
                    {th('verdict', 'Verdict', 'left')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.ticker}>
                      <td><strong className="stock-check-table-ticker">{r.ticker}</strong></td>
                      <td>{r.sector}</td>
                      <td className="stock-check-num">{formatMoney(r.price, { fallback: '-' })}</td>
                      <td className="stock-check-num stock-check-muted">{cell(r.pe, 'x')}</td>
                      <td className="stock-check-num stock-check-muted">{cell(r.peg, 'x')}</td>
                      <td className="stock-check-num">{cell(r.fund)}</td>
                      <td className="stock-check-num">{cell(r.tech)}</td>
                      <td className="stock-check-num stock-check-strong">{cell(r.combined)}</td>
                      <td><Badge tone={r.tone}>{r.verdict}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}

export default function StockBuyingChecklist() {
  const [tab, setTab] = useState('deep')
  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`stock-check-tab${tab === key ? ' is-active' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div className="page cef-page stock-check-page">
      <div className="cef-title-row stock-check-title-row">
        <div>
          <h1>Stock Buying Checklist</h1>
          <p>
            Score a stock on fundamentals (valuation, profitability, growth, balance-sheet health)
            and technicals (trend, MACD, RSI, stochastics, awesome oscillator, volume), then get
            a blended buy verdict.
          </p>
        </div>
      </div>

      <div className="stock-check-tabs" role="tablist" aria-label="Stock checklist mode">
        {tabBtn('deep', 'Deep Dive')}
        {tabBtn('scan', 'Scan a List')}
      </div>

      {tab === 'deep' ? <DeepDive /> : <ScanTab />}
    </div>
  )
}
