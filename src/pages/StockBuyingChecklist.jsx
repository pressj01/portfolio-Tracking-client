import React, { useCallback, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import {
  gradeStock,
  computeSectorStats,
  SCORE_WEIGHTS,
} from '../utils/stockGrading'

const QUESTION_DETAILS = {
  1: [
    'P/E, forward P/E and PEG say how much you pay per dollar of earnings (and growth).',
    'P/B and P/S matter most for asset-heavy or unprofitable companies.',
    'Everything is judged against the sector — a "cheap" utility P/E differs from a "cheap" tech P/E.',
  ],
  2: [
    'Net, operating and gross margins show how much of each sales dollar becomes profit.',
    'Return on equity / assets shows how efficiently capital is put to work.',
    'Consistently high margins are a sign of a durable competitive advantage.',
  ],
  3: [
    'Revenue growth shows the top line is expanding; earnings growth shows it reaches the bottom line.',
    'Positive trailing EPS confirms the company is actually profitable today.',
    'A history of beating estimates is a quality signal (when available).',
  ],
  4: [
    'Debt/equity gauges leverage — lower is safer, though norms vary by sector (banks, utilities run high).',
    'Current ratio above ~1.5 means short-term bills are comfortably covered.',
    'For dividend payers, a payout ratio under ~60% leaves room to keep paying through a downturn.',
  ],
  5: [
    'Price above the 50- and 200-day averages is an uptrend; below is a downtrend.',
    'A "golden cross" (50-day above 200-day) is a longer-term bullish backdrop.',
  ],
  6: [
    'MACD line above its signal line is bullish momentum; below is bearish.',
    'RSI below 30 is oversold (potential entry); above 70 is overbought (stretched).',
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

const badgeStyle = (badge) => {
  const base = {
    display: 'inline-block', padding: '0.2rem 0.55rem', borderRadius: 4,
    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
  }
  if (badge === 'pass') return { ...base, background: '#0f4e2e', color: '#7be5a8', border: '1px solid #1d8a52' }
  if (badge === 'warn') return { ...base, background: '#5a4a14', color: '#ffd76a', border: '1px solid #a3812a' }
  if (badge === 'fail') return { ...base, background: '#5a1a1a', color: '#ff8a8a', border: '1px solid #a83232' }
  return { ...base, background: '#1f2e52', color: '#8aa0c8', border: '1px solid #2a3e6b' }
}

const fmtMoney = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-'
  const v = Number(n)
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toFixed(2)}`
}

const toneColors = (tone) => (
  tone === 'pass' ? { bg: '#0f4e2e', border: '#1d8a52', fg: '#7be5a8' }
    : tone === 'warn' ? { bg: '#5a4a14', border: '#a3812a', fg: '#ffd76a' }
    : tone === 'fail' ? { bg: '#5a1a1a', border: '#a83232', fg: '#ff8a8a' }
    : { bg: '#1f2e52', border: '#2a3e6b', fg: '#8aa0c8' }
)

function CriterionCard({ criterion }) {
  const c = criterion
  return (
    <div style={{ background: '#1a2744', border: '1px solid #243356', borderRadius: 8 }}>
      <div style={{ padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ flex: 1, color: '#e6edf7', fontWeight: 600 }}>{c.question}</span>
          {typeof c.score === 'number' && (
            <span style={{ color: '#90a4ae', fontSize: '0.82rem' }}>{c.score}/100</span>
          )}
          <span style={badgeStyle(c.badge)}>{c.badge}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.2rem', color: '#b8c8e0' }}>
          {c.metrics.map((m, i) => (
            <div key={i} style={{ fontSize: '0.88rem' }}>
              <span style={{ color: '#90a4ae' }}>{m.label}: </span>
              <strong style={{ color: m.badge === 'fail' ? '#ff8a8a' : m.badge === 'pass' ? '#7be5a8' : '#e6edf7' }}>{m.value}</strong>
            </div>
          ))}
        </div>
        {c.rationale && (
          <div style={{ color: '#cfd8e3', fontSize: '0.9rem', lineHeight: 1.5 }}>{c.rationale}</div>
        )}
        {(QUESTION_DETAILS[c.id] || []).length > 0 && (
          <details style={{ color: '#90a4ae', fontSize: '0.85rem' }}>
            <summary style={{ cursor: 'pointer', color: '#58c4d8' }}>What to check</summary>
            <ul style={{ margin: '0.4rem 0 0.2rem 1rem' }}>
              {QUESTION_DETAILS[c.id].map((d, i) => <li key={i} style={{ margin: '0.2rem 0' }}>{d}</li>)}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function CompositePill({ label, value }) {
  const v = typeof value === 'number' ? value : null
  const tone = v === null ? 'info' : v >= 70 ? 'pass' : v >= 50 ? 'warn' : 'fail'
  const col = toneColors(tone)
  return (
    <div style={{ background: '#0f1e3b', border: '1px solid #1c2e52', borderRadius: 6, padding: '0.6rem 0.9rem' }}>
      <div style={{ color: '#90a4ae', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ color: col.fg, fontSize: '1.4rem', fontWeight: 800 }}>
        {v === null ? 'n/a' : v.toFixed(0)}<span style={{ color: '#5b6b86', fontSize: '0.9rem', fontWeight: 400 }}> / 100</span>
      </div>
    </div>
  )
}

function DeepDive() {
  const [inputTicker, setInputTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [metrics, setMetrics] = useState(null)

  const evaluate = useCallback((ticker) => {
    if (!ticker) return
    setLoading(true); setError(''); setMetrics(null)
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
      <form onSubmit={submit} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0 0 1rem', maxWidth: 520 }}>
        <input
          value={inputTicker}
          onChange={e => setInputTicker(e.target.value.toUpperCase())}
          placeholder="e.g. AAPL, MSFT, KO, JPM..."
          style={{
            flex: 1, background: '#0d1b33', border: '1px solid #1a3a5c', borderRadius: 4,
            color: '#e0e8f5', padding: '0.5rem 0.7rem', fontSize: '0.95rem', textTransform: 'uppercase',
          }}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>Evaluate</button>
      </form>

      {loading && <div className="cef-loading"><span className="spinner" /> Fetching data from Yahoo Finance...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {result && metrics && (
        <>
          {metrics.is_fund && (
            <div style={{ background: '#5a4a14', border: '1px solid #a3812a', borderRadius: 6, padding: '0.7rem 1rem', marginBottom: '1rem', color: '#ffd76a', fontSize: '0.9rem' }}>
              {metrics.ticker} is a {metrics.fund_kind || 'fund'}, not an individual stock. Company fundamentals won't apply,
              so the score below reflects mostly chart/technical signals — use the ETF, Option-Income, or CEF evaluator for funds.
            </div>
          )}

          <div style={{ background: '#1a2744', border: '1px solid #243356', borderRadius: 8, padding: '1rem 1.2rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', alignItems: 'baseline' }}>
              <h2 style={{ margin: 0, color: '#e6edf7' }}>{metrics.ticker}</h2>
              <span style={{ color: '#b8c8e0', fontSize: '1rem' }}>{metrics.name}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.5rem', marginTop: '0.6rem', color: '#b8c8e0', fontSize: '0.9rem' }}>
              <span><span style={{ color: '#90a4ae' }}>Sector: </span><strong style={{ color: '#e6edf7' }}>{metrics.sector || 'n/a'}</strong></span>
              <span><span style={{ color: '#90a4ae' }}>Industry: </span><strong style={{ color: '#e6edf7' }}>{metrics.industry || 'n/a'}</strong></span>
              <span><span style={{ color: '#90a4ae' }}>Price: </span><strong style={{ color: '#e6edf7' }}>{metrics.price != null ? `$${Number(metrics.price).toFixed(2)}` : '-'}</strong></span>
              <span><span style={{ color: '#90a4ae' }}>Market cap: </span><strong style={{ color: '#e6edf7' }}>{fmtMoney(metrics.market_cap)}</strong></span>
              {metrics.earnings?.next_earnings_date && (
                <span><span style={{ color: '#90a4ae' }}>Next earnings: </span><strong style={{ color: '#e6edf7' }}>{metrics.earnings.next_earnings_date}{metrics.earnings.days_to_earnings != null ? ` (${metrics.earnings.days_to_earnings}d)` : ''}</strong></span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.7rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
              <CompositePill label="Fundamental" value={result.fundamental.composite} />
              <CompositePill label="Technical" value={result.technical.composite} />
              <CompositePill label={`Blended (${Math.round(SCORE_WEIGHTS.fundamental * 100)}/${Math.round(SCORE_WEIGHTS.technical * 100)})`} value={result.verdict.combined} />
            </div>
            <div style={{ color: '#90a4ae', fontSize: '0.82rem', marginTop: '0.6rem' }}>
              Fundamentals graded {result.benchmarkSource === 'cohort' ? 'against your scanned sector cohort' : `against the built-in ${metrics.sector || 'default'} sector baseline`}.
            </div>
          </div>

          {result.verdict && (() => {
            const col = toneColors(result.verdict.tone)
            return (
              <div style={{ marginBottom: '1.25rem', padding: '1rem 1.2rem', borderRadius: 8, background: col.bg, border: `1px solid ${col.border}`, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem 1rem' }}>
                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: col.fg }}>Verdict: {result.verdict.label}</span>
                <span style={{ color: '#e6edf7', fontSize: '0.92rem', flex: 1, minWidth: 260 }}>{result.verdict.detail}</span>
              </div>
            )
          })()}

          <h3 style={{ color: '#58c4d8', margin: '0 0 0.6rem' }}>Fundamental analysis</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.fundamental.criteria.map(c => <CriterionCard key={c.id} criterion={c} />)}
          </div>

          <h3 style={{ color: '#58c4d8', margin: '1.4rem 0 0.6rem' }}>Technical analysis</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.technical.criteria.map(c => <CriterionCard key={c.id} criterion={c} />)}
          </div>

          <div style={{ marginTop: '1.5rem', padding: '0.8rem 1rem', background: '#0f1e3b', border: '1px solid #1c2e52', borderRadius: 6, color: '#90a4ae', fontSize: '0.84rem', lineHeight: 1.55 }}>
            <strong style={{ color: '#58c4d8' }}>Notes:</strong> Data is fetched live from Yahoo Finance.
            Fundamentals are scored relative to the stock's sector; technicals use standard
            indicator signals (50/200-day trend, MACD, RSI, slow stochastic, awesome oscillator, OBV/volume).
            This is decision support, not investment advice.
          </div>
        </>
      )}
    </>
  )
}

const SCAN_INPUT_STYLE = {
  flex: 1, background: '#0d1b33', border: '1px solid #1a3a5c', borderRadius: 4,
  color: '#e0e8f5', padding: '0.5rem 0.7rem', fontSize: '0.95rem',
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
    setLoading(true); setError(''); setData(null)
    const body = {}
    const list = tickersText.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    if (list.length) body.tickers = list
    if (source) body.source = source
    if (!list.length && !source) { setError('Enter tickers or pick a source.'); setLoading(false); return }
    fetch(`${API_BASE}/api/stock-checklist/scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
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
        ticker: m.ticker, name: m.name, sector: m.sector || '—',
        price: m.price,
        pe: m.fundamentals?.trailing_pe ?? null,
        peg: m.fundamentals?.peg_ratio ?? null,
        fund: g.fundamental.composite, tech: g.technical.composite,
        combined: g.verdict.combined, verdict: g.verdict.label, tone: g.verdict.tone,
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
      const av = val(a), bv = val(b)
      if (typeof av === 'string' || typeof bv === 'string') return dir * String(av).localeCompare(String(bv))
      return dir * (av - bv)
    })
  }, [data, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'ticker' || key === 'sector' ? 'asc' : 'desc') }
  }

  const th = (key, label, align = 'right') => (
    <th onClick={() => toggleSort(key)} style={{ cursor: 'pointer', textAlign: align, padding: '0.5rem 0.6rem', color: sortKey === key ? '#58c4d8' : '#90a4ae', whiteSpace: 'nowrap', userSelect: 'none' }}>
      {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )

  const cell = (v, suffix = '') => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(suffix === '×' ? 2 : 0)}${suffix}`)

  return (
    <>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <input
          value={tickersText}
          onChange={e => setTickersText(e.target.value)}
          placeholder="Tickers, e.g. AAPL MSFT NVDA KO JPM XOM"
          style={{ ...SCAN_INPUT_STYLE, minWidth: 320 }}
        />
        <select value={source} onChange={e => setSource(e.target.value)} style={{ ...SCAN_INPUT_STYLE, flex: '0 0 auto', textTransform: 'none' }}>
          <option value="">— or pick a source —</option>
          <option value="portfolio">My portfolio</option>
          <option value="watchlist">My watchlist</option>
        </select>
        <button type="button" className="btn btn-primary" onClick={runScan} disabled={loading}>Scan</button>
      </div>

      {loading && <div className="cef-loading"><span className="spinner" /> Scoring stocks — this fetches each ticker live and can take a moment...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && (
        <>
          <div style={{ color: '#90a4ae', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            Scored {data.returned} stock(s) of {data.requested} requested. Graded sector-relative within this batch.
            {data.truncated && ` Capped at ${data.scan_limit}.`}
            {data.errors?.length > 0 && ` Couldn't load: ${data.errors.map(e => e.ticker).join(', ')}.`}
          </div>
          {data.skipped_funds?.length > 0 && (
            <div style={{ background: '#1f2e52', border: '1px solid #2a3e6b', borderRadius: 6, padding: '0.6rem 0.9rem', marginBottom: '0.75rem', color: '#b8c8e0', fontSize: '0.85rem', lineHeight: 1.5 }}>
              <strong style={{ color: '#ffd76a' }}>{data.skipped_funds.length} fund{data.skipped_funds.length === 1 ? '' : 's'} skipped</strong>
              {' '}— this checklist grades individual stocks. For these, use the ETF / Option-Income / CEF evaluators:
              <div style={{ marginTop: '0.4rem', color: '#cfd8e3' }}>
                {data.skipped_funds.map(f => `${f.ticker} (${f.kind})`).join(', ')}
              </div>
            </div>
          )}
          {rows.length > 0 && (
            <div style={{ overflowX: 'auto', background: '#1a2744', border: '1px solid #243356', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #243356', background: '#0f1e3b' }}>
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
                  {rows.map(r => {
                    const col = toneColors(r.tone)
                    return (
                      <tr key={r.ticker} style={{ borderBottom: '1px solid #1c2a48' }}>
                        <td style={{ padding: '0.5rem 0.6rem' }}><strong style={{ color: '#58c4d8' }}>{r.ticker}</strong></td>
                        <td style={{ padding: '0.5rem 0.6rem', color: '#b8c8e0' }}>{r.sector}</td>
                        <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: '#e6edf7' }}>{r.price != null ? `$${Number(r.price).toFixed(2)}` : '—'}</td>
                        <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: '#b8c8e0' }}>{cell(r.pe, '×')}</td>
                        <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: '#b8c8e0' }}>{cell(r.peg, '×')}</td>
                        <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: '#e6edf7' }}>{cell(r.fund)}</td>
                        <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: '#e6edf7' }}>{cell(r.tech)}</td>
                        <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: '#e6edf7', fontWeight: 700 }}>{cell(r.combined)}</td>
                        <td style={{ padding: '0.5rem 0.6rem' }}><span style={{ ...badgeStyle(r.tone), color: col.fg }}>{r.verdict}</span></td>
                      </tr>
                    )
                  })}
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
      style={{
        background: tab === key ? '#1d3a6b' : 'transparent',
        border: '1px solid #2a3e6b', borderRadius: 4, color: tab === key ? '#e6edf7' : '#8aa0c8',
        padding: '0.4rem 0.9rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
      }}
    >{label}</button>
  )

  return (
    <div className="page cef-page">
      <div className="cef-title-row">
        <div>
          <h1>Stock Buying Checklist</h1>
          <p>
            Score a stock on fundamentals (valuation, profitability, growth, balance-sheet health —
            judged relative to its sector) and technicals (trend, MACD, RSI, stochastics, awesome
            oscillator, volume), then get a blended buy verdict.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.1rem' }}>
        {tabBtn('deep', 'Deep Dive')}
        {tabBtn('scan', 'Scan a List')}
      </div>

      {tab === 'deep' ? <DeepDive /> : <ScanTab />}
    </div>
  )
}
