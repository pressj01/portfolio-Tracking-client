import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Plot from 'react-plotly.js'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const fmt$ = v => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtShares = v => v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const VIEW_OPTIONS = [
  { value: 'yearly', label: 'Annual' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
]

const MONTHLY_RANGE = [
  { value: 24, label: '2 Years' },
  { value: 36, label: '3 Years' },
  { value: 60, label: '5 Years' },
  { value: 120, label: '10 Years' },
]
const WEEKLY_RANGE = [
  { value: 3, label: '3 Months' },
  { value: 6, label: '6 Months' },
  { value: 12, label: '12 Months' },
  { value: 24, label: '24 Months' },
]
const YEARLY_RANGE = [
  { value: 60, label: '5 Years' },
  { value: 120, label: '10 Years' },
  { value: 240, label: '20 Years' },
]

const YEAR_PRESETS = [
  { l: '1yr', v: 1 }, { l: '3yr', v: 3 }, { l: '5yr', v: 5 },
  { l: '10yr', v: 10 }, { l: '20yr', v: 20 },
]
const MARKET_TYPES = [
  { value: 'bullish', label: 'Bullish' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'bearish', label: 'Bearish' },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Period key ("YYYY" | "YYYY-MM" | "YYYY-Www") → short, readable axis label.
function labelFor(key, view) {
  if (view === 'yearly') return key
  if (view === 'weekly') {
    const [y, w] = key.split('-W')
    return `Wk${Number(w)} '${y.slice(-2)}`
  }
  const [y, m] = key.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${y.slice(-2)}`
}

const DARK_LAYOUT = {
  paper_bgcolor: '#16213e',
  plot_bgcolor: '#16213e',
  font: { color: '#e0e8f5', size: 12 },
  margin: { l: 64, r: 56, t: 50, b: 64 },
}

function StatTile({ label, value, color, sub }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: '#8899aa', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  )
}

export default function ReinvestmentImpact() {
  const pf = useProfileFetch()
  const { selection } = useProfile()

  const [mode, setMode] = useState('historical')   // historical | projection
  const [view, setView] = useState('monthly')
  const [monthsBack, setMonthsBack] = useState(60)
  const [categories, setCategories] = useState([])  // selected category ids (strings)
  const [catOpen, setCatOpen] = useState(false)
  const [scopeTicker, setScopeTicker] = useState('')  // '' = whole portfolio

  // Projection controls
  const [years, setYears] = useState(10)
  const [marketType, setMarketType] = useState('neutral')
  const [reinvestPct, setReinvestPct] = useState(100)
  const [monthlyContribution, setMonthlyContribution] = useState(0)

  const [data, setData] = useState(null)        // historical response
  const [projData, setProjData] = useState(null)  // projection response
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const catRef = useRef(null)
  // Guards against out-of-order responses: switching granularity fires two
  // fetches (old range, then the reset range) — only apply the latest.
  const reqIdRef = useRef(0)

  // Close category dropdown on outside click
  useEffect(() => {
    const handler = e => { if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reset range sensibly when granularity changes
  useEffect(() => {
    if (view === 'monthly') setMonthsBack(60)
    else if (view === 'weekly') setMonthsBack(12)
    else setMonthsBack(120)
  }, [view])

  // Load holdings for the scope dropdown + projection override
  useEffect(() => {
    pf('/api/holdings')
      .then(r => r.json())
      .then(rows => setHoldings((rows || []).filter(r => r.quantity > 0 && r.current_price > 0)))
      .catch(() => setHoldings([]))
  }, [pf, selection])

  // ── Historical fetch ──────────────────────────────────────────────────────
  const fetchHistorical = useCallback(() => {
    const myId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ view, months_back: monthsBack })
    if (categories.length) params.set('category', categories.join(','))
    if (scopeTicker) params.set('ticker', scopeTicker)
    pf(`/api/reinvestment-impact/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (myId !== reqIdRef.current) return  // a newer request superseded this one
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => { if (myId === reqIdRef.current) setError(e.message) })
      .finally(() => { if (myId === reqIdRef.current) setLoading(false) })
  }, [view, monthsBack, categories, scopeTicker, selection, pf])

  // ── Projection fetch (reuse Income Growth engine) ──────────────────────────
  const fetchProjection = useCallback(() => {
    setLoading(true)
    setError(null)
    const override = holdings.map(h => ({
      ticker: h.ticker,
      shares: h.quantity,
      price: h.current_price,
      div_per_share: h.div || 0,
      freq_str: h.div_frequency || 'Q',
      description: (h.description || '').substring(0, 40),
      reinvest: reinvestPct > 0 && (h.reinvest === 'Y' || h.reinvest === true),
    }))
    const payload = { years, market_type: marketType, monthly_contribution: monthlyContribution, reinvest_pct: reinvestPct }
    if (override.length) payload.holdings_override = override
    pf('/api/analytics/income-growth-sim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setProjData(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [holdings, years, marketType, monthlyContribution, reinvestPct, pf])

  useEffect(() => {
    if (mode === 'historical') fetchHistorical()
  }, [mode, fetchHistorical])

  useEffect(() => {
    if (mode === 'projection' && holdings.length) fetchProjection()
  }, [mode, fetchProjection, holdings.length])

  const categoryOptions = data?.categories || []

  // ── Historical chart data ──────────────────────────────────────────────────
  const s = data?.series
  const xText = useMemo(() => (s?.labels || []).map(k => labelFor(k, view)), [s, view])
  // Categorical axis stays readable by thinning tick labels: show ~14 evenly
  // spaced periods (weekly views otherwise cram 50+ labels into the axis).
  const xAxis = useMemo(() => {
    const n = xText.length
    const step = Math.max(1, Math.ceil(n / 14))
    const tickvals = xText.filter((_, i) => i % step === 0)
    return {
      type: 'category', categoryorder: 'array', categoryarray: xText,
      tickmode: 'array', tickvals, ticktext: tickvals,
      tickangle: view === 'monthly' && n <= 14 ? 0 : -45,
      gridcolor: '#1c2a4b',
    }
  }, [xText, view])

  const distTraces = useMemo(() => {
    if (!s) return []
    const colors = (s.payout_source || []).map(src => src === 'actual' ? '#4dff91' : '#38bdf8')
    return [{
      x: xText, y: s.payout, type: 'bar',
      marker: { color: colors },
      hovertemplate: '%{x}<br>$%{y:,.2f}<extra></extra>',
      name: 'Distributions',
    }]
  }, [s, xText])

  const shareTraces = useMemo(() => {
    if (!s) return []
    return [
      {
        x: xText, y: s.drip_shares_added, type: 'bar',
        marker: { color: '#a855f7' }, name: 'Shares added (Δ)',
        hovertemplate: '%{x}<br>+%{y:,.4f} sh<extra></extra>',
      },
      {
        x: xText, y: s.drip_shares_cumulative, type: 'scatter', mode: 'lines',
        line: { color: '#f59e0b', width: 2 }, yaxis: 'y2', name: 'Cumulative shares',
        hovertemplate: '%{x}<br>%{y:,.4f} sh total<extra></extra>',
      },
    ]
  }, [s, xText])

  const decompTraces = useMemo(() => {
    if (!s?.decomp) return []
    const d = s.decomp
    const mk = (y, name, color) => ({
      x: xText, y, type: 'bar', name,
      marker: { color }, hovertemplate: '%{x}<br>$%{y:,.2f}<extra></extra>',
    })
    return [
      mk(d.shares, 'Share growth (DRIP)', '#4dff91'),
      mk(d.rate, 'Distribution rate', '#38bdf8'),
      mk(d.price, 'Price / interaction', '#f59e0b'),
    ]
  }, [s, xText])

  // ── Projection chart data ──────────────────────────────────────────────────
  const projSeries = projData ? (years <= 5 ? projData.monthly_series : projData.annual_series) : []
  const projTraces = useMemo(() => {
    if (!projSeries?.length) return []
    const color = marketType === 'bullish' ? '#4dff91' : marketType === 'bearish' ? '#e05555' : '#f59e0b'
    return [{
      x: projSeries.map(p => p.label),
      y: projSeries.map(p => p.total_income),
      type: 'scatter', mode: 'lines', fill: 'tozeroy',
      fillcolor: color + '22', line: { color, width: 2 },
      hovertemplate: '%{x}<br>$%{y:,.0f}<extra></extra>', name: 'Projected income',
    }]
  }, [projSeries, marketType])

  const rangeOptions = view === 'monthly' ? MONTHLY_RANGE : view === 'weekly' ? WEEKLY_RANGE : YEARLY_RANGE
  const hasData = s && s.labels.length > 0

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '0.25rem' }}>Reinvestment Impact</h1>
      <p style={{ color: '#8899aa', marginTop: 0, marginBottom: '1rem', fontSize: '0.9rem' }}>
        How dividend reinvestment reshapes your payouts — share growth, rate changes, and price effects over time.
      </p>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1rem' }}>
        {['historical', 'projection'].map((m, i) => (
          <button
            key={m}
            className={`btn${mode === m ? ' btn-active' : ' btn-secondary'}`}
            style={{ borderRadius: i === 0 ? '6px 0 0 6px' : '0 6px 6px 0', textTransform: 'capitalize', padding: '0.45rem 1.1rem' }}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="growth-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
        {mode === 'historical' && (
          <>
            <div className="growth-filter-group">
              <label>Granularity</label>
              <div style={{ display: 'flex' }}>
                {VIEW_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`btn btn-sm${view === opt.value ? ' btn-active' : ''}`}
                    style={{ borderRadius: opt.value === 'yearly' ? '4px 0 0 4px' : opt.value === 'weekly' ? '0 4px 4px 0' : '0', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                    onClick={() => setView(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="growth-filter-group">
              <label>Time Range</label>
              <select
                value={monthsBack}
                onChange={e => setMonthsBack(Number(e.target.value))}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: '#0a1929', color: '#c5d0dc', border: '1px solid #1a3a5c', borderRadius: '4px' }}
              >
                {rangeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            {categoryOptions.length > 0 && (
              <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
                <label>Categories</label>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
                  onClick={() => setCatOpen(o => !o)}
                >
                  {categories.length === 0 ? 'All Holdings' : `${categories.length} selected`}
                  <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '▴' : '▾'}</span>
                </button>
                {catOpen && (
                  <div className="growth-cat-dropdown">
                    <label className="growth-cat-option" style={{ borderBottom: '1px solid #0f3460', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                      <input type="checkbox" checked={categories.length === 0} onChange={() => setCategories([])} />
                      <span>All Holdings</span>
                    </label>
                    {categoryOptions.map(c => (
                      <label key={c.id} className="growth-cat-option">
                        <input
                          type="checkbox"
                          checked={categories.includes(String(c.id))}
                          onChange={e => {
                            if (e.target.checked) setCategories(prev => [...prev, String(c.id)])
                            else setCategories(prev => prev.filter(id => id !== String(c.id)))
                          }}
                        />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="growth-filter-group">
              <label>Scope</label>
              <select
                value={scopeTicker}
                onChange={e => setScopeTicker(e.target.value)}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: '#0a1929', color: '#c5d0dc', border: '1px solid #1a3a5c', borderRadius: '4px', minWidth: '160px' }}
              >
                <option value="">Whole Portfolio</option>
                {holdings.map(h => <option key={h.ticker} value={h.ticker}>{h.ticker}</option>)}
              </select>
            </div>
          </>
        )}

        {mode === 'projection' && (
          <>
            <div className="growth-filter-group">
              <label>Horizon</label>
              <div style={{ display: 'flex' }}>
                {YEAR_PRESETS.map((p, i) => (
                  <button
                    key={p.v}
                    className={`btn btn-sm${years === p.v ? ' btn-active' : ''}`}
                    style={{ borderRadius: i === 0 ? '4px 0 0 4px' : i === YEAR_PRESETS.length - 1 ? '0 4px 4px 0' : '0', padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}
                    onClick={() => setYears(p.v)}
                  >
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="growth-filter-group">
              <label>Market</label>
              <select value={marketType} onChange={e => setMarketType(e.target.value)}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: '#0a1929', color: '#c5d0dc', border: '1px solid #1a3a5c', borderRadius: '4px' }}>
                {MARKET_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="growth-filter-group">
              <label>Reinvest %</label>
              <input type="number" min="0" max="100" value={reinvestPct}
                onChange={e => setReinvestPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                style={{ width: '80px', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: '#0a1929', color: '#c5d0dc', border: '1px solid #1a3a5c', borderRadius: '4px' }} />
            </div>
            <div className="growth-filter-group">
              <label>Monthly Add $</label>
              <input type="number" min="0" value={monthlyContribution}
                onChange={e => setMonthlyContribution(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: '110px', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: '#0a1929', color: '#c5d0dc', border: '1px solid #1a3a5c', borderRadius: '4px' }} />
            </div>
          </>
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* ── Historical view ── */}
      {mode === 'historical' && !loading && data && (
        <>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <StatTile label="TOTAL DISTRIBUTIONS" value={fmt$(data.summary.total_payout)} />
            <StatTile label="DRIP SHARES ADDED" value={fmtShares(data.summary.total_drip_shares)} color="#a855f7" />
            <StatTile label="GROWTH FROM DRIP" value={`${data.summary.drip_pct_of_growth}%`} color="#4dff91"
              sub="share of payout change" />
            <StatTile label="ANNUAL RUN-RATE" value={fmt$(data.summary.run_rate)} color="#f59e0b" />
          </div>

          {hasData ? (
            <>
              <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
                <Plot
                  data={distTraces}
                  layout={{ ...DARK_LAYOUT, title: { text: 'Distributions Over Time', x: 0.5 }, height: 380, yaxis: { tickprefix: '$', gridcolor: '#293a5f' }, xaxis: xAxis, showlegend: false }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
                <p style={{ color: '#8899aa', fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
                  <span style={{ color: '#4dff91' }}>■</span> Actual recorded payments&nbsp;&nbsp;
                  <span style={{ color: '#38bdf8' }}>■</span> Reconstructed from price + distribution history
                </p>
                <p style={{ color: '#6a7892', fontSize: '0.72rem', margin: '0.15rem 0 0', fontStyle: 'italic' }}>
                  Reconstruction models your current position reinvested across the window (per-event lot history isn't tracked), hybridized with actual recorded payments where available.
                </p>
              </div>

              <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
                <Plot
                  data={shareTraces}
                  layout={{ ...DARK_LAYOUT, title: { text: 'DRIP Share Growth', x: 0.5 }, height: 360, yaxis: { title: 'Shares added', gridcolor: '#293a5f' }, yaxis2: { title: 'Cumulative', overlaying: 'y', side: 'right', gridcolor: 'rgba(0,0,0,0)' }, xaxis: xAxis, legend: { orientation: 'h', y: -0.2 } }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>

              <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
                <Plot
                  data={decompTraces}
                  layout={{ ...DARK_LAYOUT, title: { text: 'Why Payouts Changed (per-period attribution)', x: 0.5 }, height: 360, barmode: 'relative', yaxis: { tickprefix: '$', gridcolor: '#293a5f' }, xaxis: xAxis, legend: { orientation: 'h', y: -0.2 } }}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>

              {!scopeTicker && data.per_ticker?.length > 0 && (
                <div className="da-chart-panel">
                  <h3 style={{ marginTop: 0 }}>Top Contributors</h3>
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr><th>Ticker</th><th>Description</th><th style={{ textAlign: 'right' }}>Distributions</th><th style={{ textAlign: 'right' }}>DRIP Shares</th><th>Reinvest</th></tr>
                    </thead>
                    <tbody>
                      {data.per_ticker.map(t => (
                        <tr key={t.ticker} style={{ cursor: 'pointer' }} onClick={() => setScopeTicker(t.ticker)}>
                          <td style={{ fontWeight: 600 }}>{t.ticker}</td>
                          <td style={{ color: '#8899aa' }}>{t.description}</td>
                          <td style={{ textAlign: 'right' }}>{fmt$(t.total_payout)}</td>
                          <td style={{ textAlign: 'right', color: '#a855f7' }}>{fmtShares(t.total_drip_shares)}</td>
                          <td>{t.reinvest ? '✓' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#8899aa' }}>
              No reinvestment history available for the selected filters and timeframe.
            </div>
          )}
        </>
      )}

      {/* ── Projection view ── */}
      {mode === 'projection' && !loading && projData && (
        <>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <StatTile label="CURRENT ANNUAL INCOME" value={fmt$(projData.current_annual_income)} />
            <StatTile label={`PROJECTED IN ${years}YR`} value={fmt$(projData.projected_annual_income)} color="#4dff91" />
            <StatTile
              label="GROWTH"
              value={projData.current_annual_income > 0
                ? `+${(((projData.projected_annual_income / projData.current_annual_income) - 1) * 100).toFixed(1)}%`
                : '—'}
              color="#f59e0b"
            />
          </div>
          {projTraces.length > 0 ? (
            <div className="da-chart-panel">
              <Plot
                data={projTraces}
                layout={{ ...DARK_LAYOUT, title: { text: `Projected Income (${marketType}, ${reinvestPct}% reinvested)`, x: 0.5 }, height: 420, yaxis: { tickprefix: '$', gridcolor: '#293a5f' }, xaxis: { gridcolor: '#1c2a4b' }, showlegend: false }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#8899aa' }}>No projection data.</div>
          )}
        </>
      )}
    </div>
  )
}
