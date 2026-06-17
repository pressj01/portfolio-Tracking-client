import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'

// Shared "Scan a List" tab for the fund evaluators (Option-Income / ETF / CEF).
// Mirrors the Stock Buying Checklist scanner: it pulls tickers from the user's
// holdings + watchlist (and, for CEFs, the CEF Connect universe), keeps only the
// funds that match this scanner's type (the backend gates this), then grades each
// one client-side with the same grader the single-ticker deep dive uses — so the
// composite, verdict, and the bundled risk-adjusted-ratio criterion all match.

const LABEL_STYLE = { color: 'var(--text-dim)', fontSize: '0.78rem', display: 'block', marginBottom: 3 }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const fmtNum = (v, d = 2) => (num(v) === null ? '—' : num(v).toFixed(d))
const fmtPct = (v, d = 2) => (num(v) === null ? '—' : `${num(v).toFixed(d)}%`)
const fmtPrice = (v) => (num(v) === null ? '—' : `$${num(v).toFixed(2)}`)

// Columns shared by all three scanners. `extraColumns` lets each evaluator add a
// type-specific column (NAV trend, expense ratio, discount, …) before the ratios.
const RATIO_COLUMNS = [
  { key: 'sharpe', label: 'Sharpe', fmt: (r) => fmtNum(r.sharpe) },
  { key: 'sortino', label: 'Sortino', fmt: (r) => fmtNum(r.sortino) },
  { key: 'calmar', label: 'Calmar', fmt: (r) => fmtNum(r.calmar) },
  { key: 'omega', label: 'Omega', fmt: (r) => fmtNum(r.omega) },
  { key: 'ulcer', label: 'Ulcer', fmt: (r) => fmtNum(r.ulcer) },
]

export default function FundScanTab({
  endpoint,            // e.g. '/api/option-income/scan'
  kindLabel,           // e.g. 'option-income ETFs'
  gradeFund,           // (fund, peers, thresholds) => { criteria, composite }
  verdictFromComposite,
  thresholds,
  extraColumns = [],   // [{ key, label, fmt(row) }]
  allowCefUniverse = false,
}) {
  const [tickersText, setTickersText] = useState('')
  const [useHoldings, setUseHoldings] = useState(true)
  const [useWatchlist, setUseWatchlist] = useState(true)
  const [useCefUniverse, setUseCefUniverse] = useState(false)
  const [cefCategory, setCefCategory] = useState('')
  const [cefStrategy, setCefStrategy] = useState('')
  const [cefMeta, setCefMeta] = useState(null)          // { categories, strategies }
  const [cefMetaLoading, setCefMetaLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [sortKey, setSortKey] = useState('composite')
  const [sortDir, setSortDir] = useState('desc')

  const scanningUniverse = allowCefUniverse && useCefUniverse

  // Lazily load the CEF category/strategy lists the first time the user opts
  // into a universe scan, so we don't pull the full CEF pricing feed otherwise.
  useEffect(() => {
    if (!allowCefUniverse || !useCefUniverse || cefMeta || cefMetaLoading) return
    setCefMetaLoading(true)
    fetch(`${API_BASE}/api/closed-cef/pricing`, { cache: 'no-store' })
      .then(r => r.json())
      .then(p => setCefMeta({ categories: p.categories || [], strategies: p.strategies || [] }))
      .catch(() => setCefMeta({ categories: [], strategies: [] }))
      .finally(() => setCefMetaLoading(false))
  }, [allowCefUniverse, useCefUniverse, cefMeta, cefMetaLoading])

  const runScan = useCallback(() => {
    const list = tickersText.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean)
    const sources = []
    // A universe scan is mutually exclusive with holdings/watchlist: it is a
    // browse-the-whole-category operation, not a check-what-I-own one. When the
    // universe box is on, only the universe (a single category/strategy slice)
    // is scanned so the result isn't a mix of your funds and the broad market.
    if (scanningUniverse) {
      sources.push('cef_universe')
    } else {
      if (useHoldings) sources.push('portfolio')
      if (useWatchlist) sources.push('watchlist')
    }
    if (!list.length && !sources.length) {
      setError('Pick at least one source (holdings / watchlist) or paste tickers.')
      return
    }
    // The CEF universe has hundreds of funds — require a category or strategy
    // filter so the scan covers a focused slice instead of an arbitrary first-N.
    if (scanningUniverse && !cefCategory && !cefStrategy) {
      setError('The CEF universe is too large to scan at once — pick a category and/or strategy to narrow it.')
      return
    }
    setLoading(true); setError(''); setData(null)
    fetch(`${API_BASE}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: list, sources, cef_category: cefCategory, cef_strategy: cefStrategy }),
    })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Scan failed.')
        setData(payload)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [tickersText, useHoldings, useWatchlist, scanningUniverse, cefCategory, cefStrategy, endpoint])

  const rows = useMemo(() => {
    if (!data?.results?.length) return []
    const peers = data.results
    const graded = data.results.map(fund => {
      const g = gradeFund(fund, peers, thresholds)
      const v = verdictFromComposite(g.composite, g.criteria)
      const rr = fund.risk_ratios || {}
      return {
        ticker: fund.ticker,
        name: fund.name || fund.ticker,
        price: fund.price,
        yield: num(fund.yield_pct) ?? num(fund.dividend_yield),
        composite: typeof g.composite === 'number' ? g.composite : null,
        verdict: v.label, tone: v.tone,
        // type-specific raw fields (extra columns read straight off the row)
        expense_ratio: fund.expense_ratio,
        price_cagr: fund.price_cagr,
        total_cagr: fund.total_cagr,
        premium_discount: fund.premium_discount,
        // risk ratios
        riskScore: typeof rr.composite === 'number' ? rr.composite : null,
        sharpe: rr.sharpe, sortino: rr.sortino, calmar: rr.calmar,
        omega: rr.omega, ulcer: rr.ulcer_index,
        sufficient: rr.sufficient !== false && typeof rr.composite === 'number',
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
  }, [data, sortKey, sortDir, thresholds, gradeFund, verdictFromComposite])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'ticker' || key === 'name' || key === 'verdict' ? 'asc' : 'desc') }
  }

  const columns = [
    { key: 'ticker', label: 'Ticker', align: 'left', fmt: (r) => r.ticker },
    { key: 'name', label: 'Name', align: 'left', fmt: (r) => r.name },
    { key: 'yield', label: 'Yield', fmt: (r) => fmtPct(r.yield) },
    ...extraColumns,
    { key: 'composite', label: 'Composite', fmt: (r) => fmtNum(r.composite, 1) },
    { key: 'riskScore', label: 'Risk', fmt: (r) => fmtNum(r.riskScore, 0) },
    ...RATIO_COLUMNS,
    { key: 'verdict', label: 'Verdict', align: 'left', fmt: (r) => r.verdict },
  ]

  const th = (col) => (
    <th key={col.key} onClick={() => toggleSort(col.key)} style={{
      cursor: 'pointer', textAlign: col.align || 'right', padding: '0.5rem 0.6rem',
      color: sortKey === col.key ? 'var(--teal-2)' : 'var(--text-dim-2)', whiteSpace: 'nowrap', userSelect: 'none',
    }}>
      {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )

  const cb = (checked, set, label, disabled = false) => (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.9rem',
      color: disabled ? 'var(--p-5b6b86)' : 'var(--p-b8c8e0)', cursor: disabled ? 'not-allowed' : 'pointer',
    }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => set(e.target.checked)} />
      {label}
    </label>
  )

  return (
    <>
      <div className="stock-check-scan-controls">
        <input
          value={tickersText}
          onChange={e => setTickersText(e.target.value)}
          placeholder="Optional: paste extra tickers (space/comma separated)"
          className="stock-check-input stock-check-scan-input"
        />
        <button type="button" className="btn btn-primary" onClick={runScan} disabled={loading}>Scan</button>
      </div>
      <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        {cb(useHoldings, setUseHoldings, 'My holdings', scanningUniverse)}
        {cb(useWatchlist, setUseWatchlist, 'My watchlist', scanningUniverse)}
        {allowCefUniverse && cb(useCefUniverse, setUseCefUniverse, 'Entire CEF universe')}
      </div>

      {allowCefUniverse && useCefUniverse && (
        <div style={{
          display: 'flex', gap: '0.9rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem',
          padding: '0.85rem 1rem', background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6,
        }}>
          <div>
            <label style={LABEL_STYLE}>CEF category</label>
            <select value={cefCategory} onChange={e => setCefCategory(e.target.value)} className="stock-check-input stock-check-source-select" disabled={cefMetaLoading}>
              <option value="">All categories</option>
              {(cefMeta?.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {(cefMeta?.strategies || []).length > 0 && (
            <div>
              <label style={LABEL_STYLE}>CEF strategy</label>
              <select value={cefStrategy} onChange={e => setCefStrategy(e.target.value)} className="stock-check-input stock-check-source-select" disabled={cefMetaLoading}>
                <option value="">All strategies</option>
                {cefMeta.strategies.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 240, color: 'var(--p-8aa0c8)', fontSize: '0.82rem', lineHeight: 1.5 }}>
            {cefMetaLoading
              ? 'Loading CEF categories…'
              : 'The CEF universe has hundreds of funds. Pick a category to scan a focused slice — results are still capped at the scan limit, so a very large category (e.g. Municipal Bond) shows the first batch.'}
          </div>
        </div>
      )}

      {loading && <div className="cef-loading"><span className="spinner" /> Scanning — fetches each fund's live data and price history; this can take a moment...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && (
        <>
          <div style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            Scored {data.returned} {kindLabel} of {data.requested} scanned. Graded peer-relative within this batch; the
            risk column bundles Sharpe / Sortino / Calmar / Omega / Ulcer into one 0–100 score.
            {data.truncated && ` Capped at ${data.scan_limit}.`}
            {data.errors?.length > 0 && ` Couldn't load: ${data.errors.map(e => e.ticker).join(', ')}.`}
          </div>

          {data.skipped?.length > 0 && (
            <div style={{ background: 'var(--p-1f2e52)', border: '1px solid var(--p-2a3e6b)', borderRadius: 6, padding: '0.6rem 0.9rem', marginBottom: '0.75rem', color: 'var(--p-b8c8e0)', fontSize: '0.85rem', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--p-ffd76a)' }}>{data.skipped.length} skipped</strong>
              {' '}— this scanner only evaluates {kindLabel}. These are a different fund type; use the suggested evaluator:
              <div style={{ marginTop: '0.4rem', color: 'var(--p-cfd8e3)' }}>
                {data.skipped.map(f => `${f.ticker} (${f.kind}${f.suggestion ? ` → ${f.suggestion}` : ''})`).join(', ')}
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="stock-check-table-wrap">
              <table className="stock-check-table">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--p-243356)', background: 'var(--p-0f1e3b)' }}>
                    {columns.map(th)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    return (
                      <tr key={r.ticker} style={{ borderBottom: '1px solid var(--p-1c2a48)' }}>
                        {columns.map(c => {
                          if (c.key === 'ticker') {
                            return <td key={c.key} style={{ padding: '0.5rem 0.6rem' }}><strong style={{ color: 'var(--teal-2)' }}>{r.ticker}</strong></td>
                          }
                          if (c.key === 'verdict') {
                            return <td key={c.key} style={{ padding: '0.5rem 0.6rem' }}><span className={`stock-check-badge tone-${r.tone}`}>{r.verdict}</span></td>
                          }
                          if (c.key === 'name') {
                            return <td key={c.key} style={{ padding: '0.5rem 0.6rem', color: 'var(--p-b8c8e0)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                          }
                          const isStrong = c.key === 'composite'
                          return (
                            <td key={c.key} style={{
                              padding: '0.5rem 0.6rem', textAlign: c.align || 'right',
                              color: 'var(--p-e6edf7)', fontWeight: isStrong ? 700 : 400,
                            }}>{c.fmt(r)}</td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.returned === 0 && data.skipped?.length === 0 && (
            <div style={{ background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6, padding: '1rem', color: 'var(--p-b8c8e0)' }}>
              No {kindLabel} found in the selected sources.
            </div>
          )}
        </>
      )}
    </>
  )
}

export { fmtPct, fmtPrice }
