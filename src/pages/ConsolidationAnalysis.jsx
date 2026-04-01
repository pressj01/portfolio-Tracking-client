import React, { useState, useEffect, useCallback } from 'react'
import Plot from 'react-plotly.js'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useLocation, Link } from 'react-router-dom'

const SIM_PERIODS = [
  { label: '6mo', value: '6mo' },
  { label: '1yr', value: '1y' },
  { label: '2yr', value: '2y' },
]

const REGIME_PERIODS = [
  { label: '1yr', value: '1y' },
  { label: '2yr', value: '2y' },
  { label: '3yr', value: '3y' },
]

function corrBadgeColor(v) {
  if (v == null) return '#555'
  if (v >= 0.9) return '#2e7d32'
  if (v >= 0.8) return '#f9a825'
  return '#c62828'
}

function pctColor(v) {
  if (v == null) return '#aaa'
  return v >= 0 ? '#4caf50' : '#ef5350'
}

function fmt$(v) {
  if (v == null) return '—'
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(v) {
  if (v == null) return '—'
  return (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%'
}

function fmtNum(v, dec = 2) {
  if (v == null) return '—'
  return Number(v).toFixed(dec)
}

// ─── Tab 1: Overlap Map ────────────────────────────────────────────────────────

function OverlapTab({ pf, holdings, onSimulate }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [threshold, setThreshold] = useState(0.80)

  const analyze = () => {
    setLoading(true)
    setError(null)
    setResult(null)
    pf('/api/consolidation/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setResult(d)
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }

  return (
    <>
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={analyze} disabled={loading}
            style={{ padding: '0.4rem 1.2rem', fontWeight: 600 }}>
            {loading ? 'Analyzing...' : 'Analyze Overlap'}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#aab4be', fontSize: '0.85rem' }}>
            Correlation Threshold:
            <input type="range" min="0.50" max="0.95" step="0.05" value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              style={{ width: 120 }} />
            <span style={{ color: '#7ecfff', fontWeight: 600, minWidth: '2.5rem' }}>{threshold.toFixed(2)}</span>
          </label>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" />
        </div>
      )}

      {result && !loading && (
        <>
          <p style={{ color: '#8899aa', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
            Holdings grouped by price correlation. Tickers in the same cluster move together and may represent
            overlapping exposure. Lower the threshold to catch weaker overlaps. Click a ticker to simulate consolidation.
          </p>
          {/* Summary bar */}
          <div className="card" style={{
            padding: '0.6rem 1rem', marginBottom: '1rem',
            display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap',
          }}>
            <span style={{ color: '#64b5f6', fontWeight: 600 }}>
              {result.clusters?.length || 0} cluster{(result.clusters?.length || 0) !== 1 ? 's' : ''} found
            </span>
            <span style={{ color: '#f9a825', fontWeight: 600 }}>
              {result.clusters?.reduce((s, c) => s + (c.tickers?.length || 0), 0) || 0} tickers in clusters
            </span>
            <span style={{ color: '#4caf50', fontWeight: 600 }}>
              {result.unclustered?.length || 0} tickers unique
            </span>
          </div>

          {/* Cluster cards */}
          {result.clusters?.map((cluster, ci) => (
            <div key={ci} className="card" style={{ padding: '0', marginBottom: '1rem', overflow: 'hidden' }}>
              <div style={{
                padding: '0.6rem 1rem', background: '#0f3460',
                borderBottom: '1px solid #1a4a8a',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ color: '#90caf9', fontWeight: 600 }}>
                  {cluster.underlying || `Cluster ${ci + 1}`}
                  <span style={{ color: '#8899aa', fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                    — {cluster.tickers?.length || 0} tickers
                  </span>
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2a3a4e' }}>
                      <th style={thStyle}>Ticker</th>
                      <th style={thStyle}>Description</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Value</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Monthly Income</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Yield</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Correlation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cluster.tickers?.map((m, mi) => (
                      <tr key={mi} style={{ borderBottom: '1px solid #1a2a3e' }}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: '#7ecfff' }}>
                          <span
                            style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                            title="Simulate selling this ticker"
                            onClick={() => onSimulate(m.ticker)}
                          >
                            {m.ticker}
                          </span>
                        </td>
                        <td style={tdStyle}>{m.description || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt$(m.current_value)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt$(m.monthly_income)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{m.current_yield != null ? fmtPct(m.current_yield) : '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 4,
                            background: corrBadgeColor(m.correlation_to_group), color: '#fff',
                            fontWeight: 600, fontSize: '0.82rem',
                          }}>
                            {m.correlation_to_group != null ? fmtNum(m.correlation_to_group) : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #2a3a4e' }}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#90caf9' }} colSpan={2}>Totals</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#90caf9' }}>
                        {fmt$(cluster.total_value)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#90caf9' }}>
                        {fmt$(cluster.total_monthly_income)}
                      </td>
                      <td style={tdStyle}></td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: '#90caf9' }}>
                        avg {fmtNum(cluster.avg_correlation)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}

          {/* Unclustered tickers */}
          {result.unclustered?.length > 0 && (
            <div className="card" style={{ padding: '0', marginBottom: '1rem', overflow: 'hidden' }}>
              <div style={{
                padding: '0.6rem 1rem', background: '#2a2a3e',
                borderBottom: '1px solid #3a3a5c',
              }}>
                <span style={{ color: '#aaa', fontWeight: 600 }}>
                  Unclustered Tickers
                  <span style={{ fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                    — {result.unclustered.length} tickers
                  </span>
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2a3a4e' }}>
                      <th style={thStyle}>Ticker</th>
                      <th style={thStyle}>Description</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Value</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Monthly Income</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Yield</th>
                      <th style={thStyle}>Nearest Cluster</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>Correlation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unclustered.map((m, mi) => (
                      <tr key={mi} style={{ borderBottom: '1px solid #1a2a3e' }}>
                        <td style={{ ...tdStyle, fontWeight: 600, color: '#7ecfff' }}>{m.ticker}</td>
                        <td style={tdStyle}>{m.description || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt$(m.current_value)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt$(m.monthly_income)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{m.current_yield != null ? fmtPct(m.current_yield) : '—'}</td>
                        <td style={{ ...tdStyle, color: '#90caf9' }}>{m.nearest_cluster || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {m.nearest_correlation != null ? (
                            <span style={{
                              display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: 4,
                              background: corrBadgeColor(m.nearest_correlation), color: '#fff',
                              fontWeight: 600, fontSize: '0.82rem',
                            }}>
                              {fmtNum(m.nearest_correlation)}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

// ─── Tab 2: Consolidation Simulator ────────────────────────────────────────────

function SimulatorTab({ pf, holdings, preselectedSell }) {
  const [sellTicker, setSellTicker] = useState('')
  const [buyTicker, setBuyTicker] = useState('')
  const [period, setPeriod] = useState('1y')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // Apply preselected sell ticker from Overlap tab
  useEffect(() => {
    if (preselectedSell) setSellTicker(preselectedSell)
  }, [preselectedSell])

  const simulate = () => {
    if (!sellTicker || !buyTicker) { setError('Select both Sell and Buy Into tickers.'); return }
    if (sellTicker === buyTicker) { setError('Sell and Buy Into tickers must be different.'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    pf('/api/consolidation/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sell_ticker: sellTicker, buy_ticker: buyTicker, period }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setResult(d)
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }

  // Plotly chart for total return comparison
  useEffect(() => {
    if (!result?.chart || !window.Plotly) return
    const el = document.getElementById('sim-chart')
    if (!el) return

    const traces = result.chart.series.map(s => ({
      x: result.chart.dates,
      y: s.values,
      name: s.label,
      type: 'scatter',
      mode: 'lines',
    }))

    window.Plotly.newPlot(el, traces, {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117',
      plot_bgcolor: '#0e1117',
      title: {
        text: `Total Return Comparison (normalized to 100)`,
        font: { size: 14, color: '#e0e8f5' },
      },
      xaxis: { title: 'Date' },
      yaxis: { title: 'Value (base 100)' },
      legend: { orientation: 'h', y: -0.2 },
      height: 380,
      margin: { l: 60, r: 30, t: 50, b: 60 },
    }, { responsive: true })

    return () => { if (el) window.Plotly.purge(el) }
  }, [result])

  const tickers = holdings.map(h => h.ticker).sort()

  return (
    <>
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ color: '#8899aa', fontSize: '0.85rem' }}>Sell:</label>
          <select value={sellTicker} onChange={e => setSellTicker(e.target.value)} style={selectStyle}>
            <option value="">— Select —</option>
            {tickers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <label style={{ color: '#8899aa', fontSize: '0.85rem' }}>Buy Into:</label>
          <select value={buyTicker} onChange={e => setBuyTicker(e.target.value)} style={selectStyle}>
            <option value="">— Select —</option>
            {tickers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <span style={{ color: '#556677', margin: '0 0.2rem' }}>|</span>

          <span style={{ color: '#8899aa', fontSize: '0.82rem' }}>Period:</span>
          {SIM_PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              style={{
                padding: '0.25rem 0.6rem', borderRadius: 4, cursor: 'pointer',
                border: period === p.value ? '1px solid #64b5f6' : '1px solid #3a3a5c',
                background: period === p.value ? '#1a3a5c' : '#1a1a2e',
                color: period === p.value ? '#64b5f6' : '#8899aa',
                fontSize: '0.82rem', fontWeight: period === p.value ? 600 : 400,
              }}
            >{p.label}</button>
          ))}

          <span style={{ color: '#556677', margin: '0 0.2rem' }}>|</span>

          <button className="btn btn-success" onClick={simulate} disabled={loading || !sellTicker || !buyTicker}
            style={{ padding: '0.4rem 1.2rem', fontWeight: 600 }}>
            {loading ? 'Simulating...' : 'Simulate'}
          </button>
        </div>
      </div>

      <div style={{ background: '#0d1b2a', border: '1px solid #1a3a5c', borderRadius: 6, padding: '0.5rem 1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ color: '#90a4ae', fontSize: '0.8rem' }}>Check how macro conditions affect this trade:</span>
        <Link to="/macro-dashboard" style={{ color: '#64b5f6', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 600 }}>Macro Regime Dashboard →</Link>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" />
        </div>
      )}

      {result && !loading && (
        <>
          <p style={{ color: '#8899aa', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
            What happens if you sell one holding and move the proceeds into another.
            Before = current combined position. After = consolidated into the Buy ticker.
          </p>
          {/* Before vs After cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <CompareCard label="Portfolio Value"
              before={(result.sell?.current_value || 0) + (result.buy?.current_value || 0)}
              after={result.after_consolidation?.new_total_value}
              format="$" />
            <CompareCard label="Monthly Income"
              before={(result.sell?.monthly_income || 0) + (result.buy?.monthly_income || 0)}
              after={result.after_consolidation?.new_monthly_income}
              format="$" />
            <CompareCard label="Yield"
              before={((result.sell?.current_yield || 0) + (result.buy?.current_yield || 0)) / 2}
              after={result.after_consolidation?.new_yield}
              format="yield" />
          </div>

          {/* Income change highlight */}
          {result.after_consolidation?.income_change != null && (
            <div className="card" style={{
              padding: '0.6rem 1rem', marginBottom: '1rem', textAlign: 'center',
              border: `1px solid ${result.after_consolidation.income_change >= 0 ? '#2e7d32' : '#c62828'}`,
            }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: pctColor(result.after_consolidation.income_change) }}>
                Income Change: {result.after_consolidation.income_change >= 0 ? '+' : ''}{fmt$(result.after_consolidation.income_change)}
              </span>
              <span style={{ color: pctColor(result.after_consolidation.income_change_pct), marginLeft: '1rem', fontWeight: 600 }}>
                ({fmtPct(result.after_consolidation.income_change_pct)})
              </span>
            </div>
          )}

          {/* Performance comparison table */}
          {result.performance_comparison && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', overflowX: 'auto' }}>
              <h3 style={{ color: '#90caf9', margin: '0 0 0.2rem', fontSize: '0.95rem' }}>Historical Performance Comparison</h3>
              <p style={{ color: '#8899aa', fontSize: '0.78rem', margin: '0 0 0.5rem' }}>
                How each ticker performed over the selected period. Lower volatility and higher Sharpe ratio = more consistent returns.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a3a4e' }}>
                    <th style={thStyle}>Metric</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{sellTicker} (Sell)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>{buyTicker} (Buy Into)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: 'total_return', label: 'Total Return' },
                    { key: 'price_return', label: 'Price Return' },
                    { key: 'volatility', label: 'Volatility' },
                    { key: 'max_drawdown', label: 'Max Drawdown' },
                    { key: 'sharpe', label: 'Sharpe Ratio' },
                  ].map(({ key, label }) => (
                    <tr key={key} style={{ borderBottom: '1px solid #1a2a3e' }}>
                      <td style={{ ...tdStyle, color: '#aaa' }}>{label}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: pctColor(result.performance_comparison.sell_ticker?.[key]) }}>
                        {key === 'sharpe' ? fmtNum(result.performance_comparison.sell_ticker?.[key]) : fmtPct(result.performance_comparison.sell_ticker?.[key])}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: pctColor(result.performance_comparison.buy_ticker?.[key]) }}>
                        {key === 'sharpe' ? fmtNum(result.performance_comparison.buy_ticker?.[key]) : fmtPct(result.performance_comparison.buy_ticker?.[key])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Plotly chart */}
          {result.history?.dates?.length > 0 && (
            <div className="card" style={{ padding: '0.75rem 1rem' }}>
              <Plot
                data={[
                  { x: result.history.dates, y: result.history.sell_total_return, name: `${sellTicker} Total Return`, type: 'scatter', mode: 'lines', line: { color: '#ef5350' } },
                  { x: result.history.dates, y: result.history.buy_total_return, name: `${buyTicker} Total Return`, type: 'scatter', mode: 'lines', line: { color: '#4caf50' } },
                  { x: result.history.dates, y: result.history.sell_price_return, name: `${sellTicker} Price Only`, type: 'scatter', mode: 'lines', line: { color: '#ef5350', dash: 'dot' } },
                  { x: result.history.dates, y: result.history.buy_price_return, name: `${buyTicker} Price Only`, type: 'scatter', mode: 'lines', line: { color: '#4caf50', dash: 'dot' } },
                ]}
                layout={{
                  title: { text: 'Total Return Comparison', font: { color: '#ccc' } },
                  paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
                  xaxis: { gridcolor: '#2a3a4e', color: '#8899aa' },
                  yaxis: { gridcolor: '#2a3a4e', color: '#8899aa', ticksuffix: '%' },
                  legend: { font: { color: '#aaa' } },
                  margin: { t: 40, b: 40, l: 50, r: 20 },
                  height: 350,
                }}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}

function CompareCard({ label, before, after, format }) {
  const display = (v) => {
    if (v == null) return '—'
    if (format === '$') return fmt$(v)
    if (format === 'yield') return (v * 100).toFixed(2) + '%'
    return fmtPct(v)
  }
  const diffDisplay = (d) => {
    if (d == null) return null
    if (format === '$') return fmt$(d)
    if (format === 'yield') return (d >= 0 ? '+' : '') + (d * 100).toFixed(2) + '%'
    return fmtPct(d)
  }
  const diff = (before != null && after != null) ? after - before : null

  return (
    <div className="card" style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
      <div style={{ color: '#8899aa', fontSize: '0.78rem', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', alignItems: 'baseline' }}>
        <div>
          <div style={{ color: '#aaa', fontSize: '0.72rem' }}>Before</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e0e0e0' }}>{display(before)}</div>
        </div>
        <div style={{ color: '#556677', fontSize: '1.2rem' }}>&rarr;</div>
        <div>
          <div style={{ color: '#aaa', fontSize: '0.72rem' }}>After</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e0e0e0' }}>{display(after)}</div>
        </div>
      </div>
      {diff != null && (
        <div style={{ marginTop: '0.3rem', fontSize: '0.82rem', fontWeight: 600, color: pctColor(diff) }}>
          {diffDisplay(diff)}
        </div>
      )}
    </div>
  )
}

// ─── Tab 3: Market Regime Analysis ─────────────────────────────────────────────

function RegimeTab({ pf, holdings }) {
  const [selected, setSelected] = useState([])
  const [period, setPeriod] = useState('2y')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [showPicker, setShowPicker] = useState(false)

  const toggleTicker = (t) => {
    setSelected(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  const selectAll = () => {
    setSelected(holdings.map(h => h.ticker))
  }

  const clearAll = () => {
    setSelected([])
  }

  const analyze = () => {
    if (selected.length < 1) { setError('Select at least 1 ticker.'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    pf('/api/consolidation/regimes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: selected, period }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }

        // Transform ticker_performance dict into table array
        const table = d.ticker_performance
          ? Object.entries(d.ticker_performance).map(([ticker, regimes]) => ({
              ticker,
              warning: d.data_warnings?.[ticker] || null,
              ...regimes,
            }))
          : null

        // Transform timeline arrays into segment objects
        let timelineSegments = null
        if (d.timeline?.dates?.length) {
          timelineSegments = []
          let cur = { start: d.timeline.dates[0], regime: d.timeline.regime[0] }
          for (let i = 1; i < d.timeline.dates.length; i++) {
            if (d.timeline.regime[i] !== cur.regime) {
              cur.end = d.timeline.dates[i - 1]
              timelineSegments.push(cur)
              cur = { start: d.timeline.dates[i], regime: d.timeline.regime[i] }
            }
          }
          cur.end = d.timeline.dates[d.timeline.dates.length - 1]
          timelineSegments.push(cur)
        }

        // Build bar_chart from ticker_performance
        let bar_chart = null
        if (d.ticker_performance) {
          const tickers = Object.keys(d.ticker_performance)
          const regimes = ['bull', 'bear', 'sideways', 'high_vol']
          const data = {}
          regimes.forEach(r => {
            data[r] = tickers.map(t => d.ticker_performance[t]?.[r]?.total_return ?? null)
          })
          bar_chart = { tickers, regimes, data }
        }

        setResult({ ...d, table, timeline: timelineSegments, bar_chart })
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }

  // Plotly regime timeline
  useEffect(() => {
    if (!result?.timeline || !window.Plotly) return
    const el = document.getElementById('regime-timeline')
    if (!el) return

    const regimeColors = { bull: '#2e7d32', bear: '#c62828', sideways: '#757575' }

    const shapes = result.timeline.map(seg => ({
      type: 'rect',
      xref: 'x', yref: 'paper',
      x0: seg.start, x1: seg.end,
      y0: 0, y1: 1,
      fillcolor: regimeColors[seg.regime] || '#555',
      opacity: 0.6,
      line: { width: 0 },
    }))

    // dummy trace for legend
    const traces = ['bull', 'bear', 'sideways'].map(regime => ({
      x: [null], y: [null],
      type: 'scatter', mode: 'markers',
      marker: { size: 12, color: regimeColors[regime] },
      name: regime.charAt(0).toUpperCase() + regime.slice(1),
      showlegend: true,
    }))

    window.Plotly.newPlot(el, traces, {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117',
      plot_bgcolor: '#0e1117',
      title: { text: 'Market Regime Timeline', font: { size: 14, color: '#e0e8f5' } },
      shapes,
      xaxis: { type: 'date', title: 'Date', range: [result.timeline[0]?.start, result.timeline[result.timeline.length - 1]?.end] },
      yaxis: { visible: false },
      height: 180,
      margin: { l: 40, r: 30, t: 50, b: 50 },
      legend: { orientation: 'h', y: 1.15 },
    }, { responsive: true })

    return () => { if (el) window.Plotly.purge(el) }
  }, [result])

  // Plotly grouped bar chart
  useEffect(() => {
    if (!result?.bar_chart || !window.Plotly) return
    const el = document.getElementById('regime-bar')
    if (!el) return

    const traces = result.bar_chart.regimes.map(regime => ({
      x: result.bar_chart.tickers,
      y: result.bar_chart.data[regime],
      name: regime.charAt(0).toUpperCase() + regime.slice(1),
      type: 'bar',
      marker: {
        color: regime === 'bull' ? '#4caf50' : regime === 'bear' ? '#ef5350'
          : regime === 'sideways' ? '#9e9e9e' : '#ff9800',
      },
    }))

    window.Plotly.newPlot(el, traces, {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117',
      plot_bgcolor: '#0e1117',
      title: { text: 'Total Return by Regime', font: { size: 14, color: '#e0e8f5' } },
      barmode: 'group',
      xaxis: { title: 'Ticker' },
      yaxis: { title: 'Total Return %' },
      height: 400,
      margin: { l: 60, r: 30, t: 50, b: 60 },
      legend: { orientation: 'h', y: -0.2 },
    }, { responsive: true })

    return () => { if (el) window.Plotly.purge(el) }
  }, [result])

  const allTickers = holdings.map(h => h.ticker).sort()

  return (
    <>
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowPicker(p => !p)}
            style={{ padding: '0.35rem 0.8rem' }}>
            {showPicker ? 'Hide Picker' : 'Select Tickers'} ({selected.length})
          </button>
          <button className="btn" onClick={selectAll} style={{ padding: '0.35rem 0.6rem', color: '#8899aa', fontSize: '0.82rem' }}>
            Select All
          </button>
          <button className="btn" onClick={clearAll} style={{ padding: '0.35rem 0.6rem', color: '#8899aa', fontSize: '0.82rem' }}>
            Clear
          </button>

          <span style={{ color: '#556677', margin: '0 0.2rem' }}>|</span>

          <span style={{ color: '#8899aa', fontSize: '0.82rem' }}>Period:</span>
          {REGIME_PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              style={{
                padding: '0.25rem 0.6rem', borderRadius: 4, cursor: 'pointer',
                border: period === p.value ? '1px solid #64b5f6' : '1px solid #3a3a5c',
                background: period === p.value ? '#1a3a5c' : '#1a1a2e',
                color: period === p.value ? '#64b5f6' : '#8899aa',
                fontSize: '0.82rem', fontWeight: period === p.value ? 600 : 400,
              }}
            >{p.label}</button>
          ))}

          <span style={{ color: '#556677', margin: '0 0.2rem' }}>|</span>

          <button className="btn btn-success" onClick={analyze} disabled={loading || selected.length < 1}
            style={{ padding: '0.4rem 1.2rem', fontWeight: 600 }}>
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>

        {/* Ticker picker */}
        {showPicker && (
          <div style={{
            display: 'flex', gap: '0.3rem', flexWrap: 'wrap',
            padding: '0.5rem 0', borderTop: '1px solid #2a3a4e', marginTop: '0.3rem',
          }}>
            {allTickers.map(t => (
              <label key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '0.2rem 0.5rem', borderRadius: 4, cursor: 'pointer',
                background: selected.includes(t) ? '#1a3a5c' : '#1a1a2e',
                border: `1px solid ${selected.includes(t) ? '#64b5f6' : '#3a3a5c'}`,
                fontSize: '0.82rem', color: selected.includes(t) ? '#7ecfff' : '#8899aa',
              }}>
                <input
                  type="checkbox"
                  checked={selected.includes(t)}
                  onChange={() => toggleTicker(t)}
                  style={{ display: 'none' }}
                />
                {t}
              </label>
            ))}
          </div>
        )}

        {/* Selected chips */}
        {selected.length > 0 && !showPicker && (
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {selected.map(t => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '0.2rem 0.5rem', background: '#1a2a3e', border: '1px solid #2a4a6e',
                borderRadius: 4, fontSize: '0.82rem', color: '#7ecfff', fontWeight: 600,
              }}>
                {t}
                <button onClick={() => toggleTicker(t)} style={{
                  background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.9rem', padding: '0 2px', lineHeight: 1,
                }}>&times;</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" />
        </div>
      )}

      <div style={{ background: '#0d1b2a', border: '1px solid #1a3a5c', borderRadius: 6, padding: '0.5rem 1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ color: '#90a4ae', fontSize: '0.8rem' }}>See how macro conditions affect your portfolio:</span>
        <Link to="/macro-dashboard" style={{ color: '#64b5f6', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 600 }}>Macro Regime Dashboard →</Link>
      </div>

      {result && !loading && (
        <>
          {/* Regime timeline */}
          {result.timeline && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
              <p style={{ color: '#8899aa', fontSize: '0.8rem', margin: '0 0 0.3rem' }}>
                Market conditions based on SPY's rolling 3-month return.
                <span style={{ color: '#4caf50', fontWeight: 600 }}> Green</span> = Bull (&gt;5%),
                <span style={{ color: '#ef5350', fontWeight: 600 }}> Red</span> = Bear (&lt;-5%),
                <span style={{ color: '#9e9e9e', fontWeight: 600 }}> Gray</span> = Sideways.
              </p>
              <div id="regime-timeline" />
            </div>
          )}

          {/* Performance table */}
          {result.table && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', overflowX: 'auto' }}>
              <h3 style={{ color: '#90caf9', margin: '0 0 0.2rem', fontSize: '0.95rem' }}>Performance by Regime</h3>
              <p style={{ color: '#8899aa', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
                How each ticker performed during each market condition.
                <strong style={{ color: '#aab' }}> Price</strong> = NAV change,
                <strong style={{ color: '#aab' }}> Income</strong> = dividend return,
                <strong style={{ color: '#aab' }}> Total</strong> = combined,
                <strong style={{ color: '#aab' }}> Max DD</strong> = worst drawdown.
                <span style={{ marginLeft: '0.3rem', padding: '0.1rem 0.4rem', borderRadius: 4, background: '#f9a825', color: '#000', fontSize: '0.7rem', fontWeight: 700 }}>!</span> = limited history.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #2a3a4e' }}>
                    <th style={thStyle} rowSpan={2}>Ticker</th>
                    {['Bull', 'Bear', 'Sideways', 'High Vol'].map(regime => (
                      <th key={regime} style={{ ...thStyle, textAlign: 'center', borderBottom: '1px solid #2a3a4e' }} colSpan={4}>
                        <span style={{
                          color: regime === 'Bull' ? '#4caf50' : regime === 'Bear' ? '#ef5350'
                            : regime === 'High Vol' ? '#ff9800' : '#9e9e9e'
                        }}>{regime}</span>
                      </th>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: '1px solid #2a3a4e' }}>
                    {['Bull', 'Bear', 'Sideways', 'High Vol'].map(regime => (
                      <React.Fragment key={regime}>
                        <th style={{ ...thStyle, textAlign: 'right', fontSize: '0.75rem' }}>Price</th>
                        <th style={{ ...thStyle, textAlign: 'right', fontSize: '0.75rem' }}>Income</th>
                        <th style={{ ...thStyle, textAlign: 'right', fontSize: '0.75rem' }}>Total</th>
                        <th style={{ ...thStyle, textAlign: 'right', fontSize: '0.75rem' }}>Max DD</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.table.map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: '1px solid #1a2a3e' }}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#7ecfff', whiteSpace: 'nowrap' }}>
                        {row.ticker}
                        {row.warning && (
                          <span style={{
                            marginLeft: '0.4rem', padding: '0.1rem 0.4rem', borderRadius: 4,
                            background: '#f9a825', color: '#000', fontSize: '0.7rem', fontWeight: 700,
                          }} title={row.warning}>!</span>
                        )}
                      </td>
                      {['bull', 'bear', 'sideways', 'high_vol'].map(regime => (
                        <React.Fragment key={regime}>
                          <td style={{ ...tdStyle, textAlign: 'right', color: pctColor(row[regime]?.price_return) }}>
                            {fmtPct(row[regime]?.price_return)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: pctColor(row[regime]?.income_return) }}>
                            {fmtPct(row[regime]?.income_return)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: pctColor(row[regime]?.total_return), fontWeight: 600 }}>
                            {fmtPct(row[regime]?.total_return)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: pctColor(row[regime]?.max_dd) }}>
                            {fmtPct(row[regime]?.max_dd)}
                          </td>
                        </React.Fragment>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Grouped bar chart */}
          {result.bar_chart && (
            <div className="card" style={{ padding: '0.75rem 1rem' }}>
              <p style={{ color: '#8899aa', fontSize: '0.8rem', margin: '0 0 0.3rem' }}>
                Visual comparison of total return (price + income) by ticker across market conditions.
                Taller bars = stronger performance in that regime.
              </p>
              <div id="regime-bar" />
            </div>
          )}
        </>
      )}
    </>
  )
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const thStyle = {
  padding: '0.4rem 0.6rem',
  color: '#8899aa',
  fontWeight: 600,
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const tdStyle = {
  padding: '0.4rem 0.6rem',
  color: '#e0e0e0',
}

const selectStyle = {
  padding: '0.35rem 0.6rem',
  background: '#1a1a2e',
  border: '1px solid #3a3a5c',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: '0.85rem',
  minWidth: 120,
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ConsolidationAnalysis() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState('overlap')
  const [holdings, setHoldings] = useState([])
  const [preselectedSell, setPreselectedSell] = useState('')

  // Read URL params for deep-linking (e.g. from Macro Dashboard)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const tab = params.get('tab')
    const sell = params.get('sell')
    if (tab === 'simulator') {
      setActiveTab('simulator')
      if (sell) setPreselectedSell(sell.toUpperCase())
    }
  }, [location.search])

  // Fetch holdings for dropdowns
  useEffect(() => {
    pf('/api/holdings')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setHoldings(data)
        else if (data.holdings) setHoldings(data.holdings)
      })
      .catch(() => {})
  }, [pf, selection])

  // Quick-simulate from Overlap tab: switch to simulator with preselected sell ticker
  const handleSimulate = useCallback((ticker) => {
    setPreselectedSell(ticker)
    setActiveTab('simulator')
  }, [])

  return (
    <div className="page">
      <h1 style={{ marginBottom: '0.3rem' }}>Consolidation Analysis</h1>
      <p style={{ color: '#8899aa', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Identify overlapping holdings, simulate consolidation trades, and analyze performance across market regimes.
      </p>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'overlap' ? 'active' : ''}`}
          onClick={() => setActiveTab('overlap')}>
          Overlap Map
        </button>
        <button className={`tab ${activeTab === 'simulator' ? 'active' : ''}`}
          onClick={() => setActiveTab('simulator')}>
          Consolidation Simulator
        </button>
        <button className={`tab ${activeTab === 'regimes' ? 'active' : ''}`}
          onClick={() => setActiveTab('regimes')}>
          Market Regime Analysis
        </button>
      </div>

      {activeTab === 'overlap' && (
        <OverlapTab pf={pf} holdings={holdings} onSimulate={handleSimulate} />
      )}
      {activeTab === 'simulator' && (
        <SimulatorTab pf={pf} holdings={holdings} preselectedSell={preselectedSell} />
      )}
      {activeTab === 'regimes' && (
        <RegimeTab pf={pf} holdings={holdings} />
      )}
    </div>
  )
}
