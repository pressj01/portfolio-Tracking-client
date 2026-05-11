import React, { useState, useMemo } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import Plot from 'react-plotly.js'

function fmt$(v) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmt4(v) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtAbs4(v) {
  return Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}
function fmtAbsPct(v) {
  return Math.abs(v).toFixed(2) + '%'
}
function navSeverityFromRatio(v) {
  if (v == null) return null
  return v > 0.75 ? 'High' : v > 0.25 ? 'Medium' : 'Low'
}
function navSeverityColor(severity) {
  return severity === 'High' ? '#e05555' : severity === 'Medium' ? '#ffb300' : severity === 'Low' ? '#00c853' : '#666'
}
function navSeverityText(severity) {
  return severity === 'High' ? 'High Benchmark-Adjusted NAV Erosion' : severity === 'Medium' ? 'Moderate Benchmark-Adjusted NAV Erosion' : 'Low Benchmark-Adjusted NAV Erosion'
}

function shareGapPct(deficit, breakevenShares) {
  return breakevenShares ? (deficit / breakevenShares) * 100 : 0
}

function shareGapKind(deficit) {
  if (deficit > 0) return 'needed'
  if (deficit < 0) return 'extra'
  return 'at break-even'
}

function StatTile({ label, value, color, subtext }) {
  return (
    <div className="ne-stat-tile">
      <div className="ne-stat-val" style={{ color }}>{value}</div>
      <div className="ne-stat-lbl">{label}</div>
      {subtext && <div className="ne-stat-lbl" style={{ marginTop: 1 }}>{subtext}</div>}
    </div>
  )
}

export default function NavErosion() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [ticker, setTicker] = useState('')
  const [amount, setAmount] = useState('10000')
  const [startDate, setStartDate] = useState('2015-01-01')
  const [endDate, setEndDate] = useState('2025-12-31')
  const [reinvest, setReinvest] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [figData, setFigData] = useState(null)
  const [figLayout, setFigLayout] = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)

  const runBacktest = () => {
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    setError(null)
    setWarning(null)
    setRows([])
    setSummary(null)
    setFigData(null)
    setFigLayout(null)

    const params = new URLSearchParams({
      ticker: sym, amount, start: startDate, end: endDate, reinvest: String(reinvest)
    })

    pf('/api/nav-erosion/data?' + params.toString())
      .then(r => r.json())
      .then(data => {
        setLoading(false)
        if (data.error) { setError(data.error); return }
        if (data.warning) setWarning(data.warning)
        setRows(data.rows || [])
        setSummary(data.summary || null)
        if (data.fig_json) {
          try {
            const fig = JSON.parse(data.fig_json)
            setFigData(fig.data)
            setFigLayout(fig.layout)
          } catch { /* ignore */ }
        }
      })
      .catch(err => {
        setLoading(false)
        setError('Request failed: ' + err.message)
      })
  }

  // Sorting
  const colKeys = ['date', 'price', 'price_delta_pct', 'div_per_share', 'total_dist',
    'reinvested', 'shares_bought', 'total_shares', 'portfolio_val', 'breakeven_sh', 'shares_deficit', 'coverage_ratio']

  const sorted = useMemo(() => {
    const arr = [...rows]
    if (sortCol !== null) {
      const key = colKeys[sortCol]
      arr.sort((a, b) => {
        const aV = a[key] ?? '', bV = b[key] ?? ''
        if (typeof aV === 'number' && typeof bV === 'number')
          return sortAsc ? aV - bV : bV - aV
        return sortAsc ? String(aV).localeCompare(String(bV)) : String(bV).localeCompare(String(aV))
      })
    }
    return arr
  }, [rows, sortCol, sortAsc])

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }
  const arrow = (col) => sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  const headers = ['Date', 'Price', 'Price \u0394%', 'Div / Share', 'Total Dist',
    'Reinvested', 'Shares Bought', 'Total Shares', 'Portfolio Value', 'Break-Even Shares', 'Shares Needed / Extra To Breakeven', 'NAV Ratio']

  const s = summary || {}
  const totalSeverity = s.nav_erosion_severity || navSeverityFromRatio(s.total_coverage)
  const totalSeverityColor = navSeverityColor(totalSeverity)
  const finalRow = rows.length ? rows[rows.length - 1] : null
  const finalGapPct = finalRow ? shareGapPct(s.final_deficit || 0, finalRow.breakeven_sh || 0) : 0

  return (
    <div className="ne-page">
      <h1 style={{ marginBottom: '0.3rem' }}>NAV Erosion Back-Tester</h1>
      <p className="ne-desc">
        High-yield ETFs often pay large distributions while the share price slowly declines.
        This tool shows month-by-month how many extra shares you need to reinvest to preserve
        your original portfolio value — and what happens at any chosen reinvestment level (0–100%).
        <br />
        <span style={{ color: '#7ecfff' }}>Blue line</span> = share price &nbsp;&middot;&nbsp;
        <span style={{ color: '#00e89a' }}>Green line</span> = portfolio value &nbsp;&middot;&nbsp;
        <span style={{ color: '#888' }}>Dashed gray</span> = initial investment (break-even)
        <br /><br />
        <strong style={{ color: '#ccc' }}>Shares Needed / Extra To Breakeven</strong> compares your shares held to break-even shares
        (Initial Investment &divide; Current Price).
        <span style={{ color: '#e05555', fontWeight: 600 }}> Red needed</span> means you are short that many shares.
        <span style={{ color: '#00c853', fontWeight: 600 }}> Green extra</span> means you have that many shares above break-even.
        The percent is the gap as a share of break-even shares.
        <br /><br />
        <strong style={{ color: '#ccc' }}>Severity</strong> uses the benchmark-adjusted NAV ratio, but is forced
        <span style={{ color: '#e05555', fontWeight: 600 }}> High</span> when price falls 50%+ or the final
        share deficit is 5%+ of break-even shares.
      </p>

      {/* Input form */}
      <div className="ne-form">
        <div className="ne-field">
          <label className="ne-label">Ticker</label>
          <input
            className="ne-input"
            style={{ width: 90, textTransform: 'uppercase' }}
            placeholder="e.g. JEPI"
            maxLength={10}
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && runBacktest()}
          />
        </div>
        <div className="ne-field">
          <label className="ne-label">Initial Investment ($)</label>
          <input
            className="ne-input"
            type="number"
            min="1"
            step="100"
            style={{ width: 130 }}
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </div>
        <div className="ne-field">
          <label className="ne-label">Start Date</label>
          <input
            className="ne-input"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div className="ne-field">
          <label className="ne-label">End Date</label>
          <input
            className="ne-input"
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>
        <div className="ne-field" style={{ minWidth: 180 }}>
          <label className="ne-label">
            Reinvest %: <span style={{ color: '#7ecfff', fontWeight: 700 }}>{reinvest}%</span>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <input
              type="range"
              min="0"
              max="100"
              value={reinvest}
              step="1"
              style={{ flex: 1, accentColor: '#7ecfff' }}
              onChange={e => setReinvest(Number(e.target.value))}
            />
            <input
              className="ne-input"
              type="number"
              min="0"
              max="100"
              step="1"
              style={{ width: 64, textAlign: 'center' }}
              value={reinvest}
              onChange={e => setReinvest(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            />
          </div>
        </div>
        <button className="ne-run-btn" onClick={runBacktest} disabled={loading}>
          Run Backtest
        </button>
      </div>

      {/* Spinner */}
      {loading && (
        <div className="wl-spinner">
          <div className="wl-spin-circle" />
          <p>Fetching price data &amp; calculating&hellip;</p>
        </div>
      )}

      {/* Error */}
      {error && <div className="wl-error">{error}</div>}

      {/* Warning */}
      {warning && (
        <div className="ne-warning">&#9888;&nbsp;{warning}</div>
      )}

      {/* Summary strip */}
      {summary && !loading && (
        <div className="ne-summary">
          <StatTile label="Total Distributions" value={fmt$(s.total_dist || 0)} color="#7ecfff" />
          <StatTile label="Shares Purchased" value={fmt4(s.total_shares_bought || 0)} color="#7ecfff" />
          <StatTile label="Total Reinvested" value={fmt$(s.total_reinvested || 0)} color="#7ecfff" />
          <StatTile label="Final Portfolio Value" value={fmt$(s.final_value || 0)} color="#00e89a" />
          <StatTile label="Price Change" value={fmtPct(s.price_chg_pct || 0)} color={s.price_chg_pct < 0 ? '#e05555' : '#00c853'} />
          <div className="ne-stat-tile">
            <div className="ne-stat-val">
              {s.has_erosion
                ? <span style={{ color: '#e05555', fontWeight: 700 }}>Yes</span>
                : <span style={{ color: '#00c853', fontWeight: 700 }}>No</span>}
            </div>
            <div className="ne-stat-lbl">NAV Erosion</div>
          </div>
          <StatTile
            label={s.final_deficit > 0 ? 'Final Shares Needed' : s.final_deficit < 0 ? 'Final Extra Shares' : 'Final Share Gap'}
            value={`${fmtAbs4(s.final_deficit || 0)} (${fmtAbsPct(finalGapPct)})`}
            color={s.final_deficit > 0 ? '#e05555' : s.final_deficit < 0 ? '#00c853' : '#7ecfff'}
            subtext={s.final_deficit > 0 ? 'short of break-even' : s.final_deficit < 0 ? 'above break-even' : 'at break-even'}
          />
          <StatTile
            label="Total NAV Erosion Ratio"
            value={s.total_coverage != null ? s.total_coverage.toFixed(4) : '\u2014'}
            color={totalSeverityColor}
          />
          {s.total_coverage != null && (
            <div className="ne-stat-tile" style={{
              border: `2px solid ${totalSeverityColor}`,
              borderRadius: '8px',
              background: totalSeverity === 'High' ? 'rgba(224,85,85,0.12)' : totalSeverity === 'Medium' ? 'rgba(255,179,0,0.12)' : 'rgba(0,200,83,0.12)',
            }}>
              <div className="ne-stat-val" style={{
                color: totalSeverityColor,
                fontSize: '0.85rem',
                lineHeight: 1.3,
              }}>
                {navSeverityText(totalSeverity)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      {figData && figLayout && !loading && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Plot
            data={figData}
            layout={{ ...figLayout, autosize: true }}
            useResizeHandler
            style={{ width: '100%', height: 420 }}
            config={{ responsive: true }}
          />
        </div>
      )}

      {/* NAV Erosion Ratio Chart */}
      {rows.length > 0 && !loading && (() => {
        const covRows = rows.filter(r => r.coverage_ratio != null)
        if (covRows.length === 0) return null
        const dates = covRows.map(r => r.date)
        const values = covRows.map(r => r.coverage_ratio)
        const colors = values.map(v => v > 0.75 ? '#e05555' : v > 0.25 ? '#ffb300' : '#00c853')
        return (
          <div style={{ marginBottom: '1.5rem' }}>
            <Plot
              data={[
                {
                  x: dates,
                  y: values,
                  type: 'scatter',
                  mode: 'lines+markers',
                  line: { color: '#7ecfff', width: 2 },
                  marker: { color: colors, size: 6 },
                  hovertemplate: '<b>%{x}</b><br>NAV Erosion Ratio: %{y:.4f}<extra></extra>',
                  name: 'NAV Erosion Ratio',
                },
                {
                  x: [dates[0], dates[dates.length - 1]],
                  y: [0.75, 0.75],
                  type: 'scatter',
                  mode: 'lines',
                  line: { color: '#ffffff', width: 2, dash: 'dash' },
                  hoverinfo: 'skip',
                  name: 'High Threshold (0.75)',
                },
              ]}
              layout={{
                title: `${ticker.trim().toUpperCase()} — Monthly NAV Erosion Ratio`,
                template: 'plotly_dark',
                margin: { t: 50, l: 60, r: 30, b: 50 },
                height: 320,
                autosize: true,
                legend: { orientation: 'h', y: 1.08, x: 0 },
                hoverlabel: {
                  bgcolor: '#111124',
                  bordercolor: '#3a3a5c',
                  font: { color: '#e0e0e0', size: 13 },
                },
                yaxis: { title: 'NAV Erosion Ratio', zeroline: true },
                hovermode: 'x unified',
                shapes: [{
                  type: 'rect',
                  xref: 'paper', yref: 'paper',
                  x0: 0, x1: 1, y0: 0, y1: 1,
                  fillcolor: 'rgba(0,0,0,0)',
                  line: { width: 0 },
                }],
              }}
              useResizeHandler
              style={{ width: '100%', height: 320 }}
              config={{ responsive: true }}
            />
          </div>
        )
      })()}

      {/* Monthly detail table */}
      {rows.length > 0 && !loading && (
        <>
          <h2 className="ne-table-title">
            Monthly Detail
            <span style={{ fontWeight: 400, fontSize: '0.75rem', color: '#666' }}>&nbsp;&mdash; click any header to sort</span>
          </h2>
          <div className="ne-tbl-outer">
            <table className="sst" id="ne-tbl">
              <thead>
                <tr>
                  {headers.map((h, i) => {
                    const cls = i === 0 ? 'ne-date-col' : ([3, 7, 9].includes(i) ? 'grp-left' : '')
                    return (
                      <th key={h} className={cls} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }}>
                        {h}{arrow(i)}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const pctCls = r.price_delta_pct < 0 ? 'pct-down' : (r.price_delta_pct > 0 ? 'pct-up' : '')
                  const defCls = r.shares_deficit > 0 ? 'ne-deficit' : 'ne-surplus'
                  const gapPct = shareGapPct(r.shares_deficit, r.breakeven_sh)
                  const gapKind = shareGapKind(r.shares_deficit)
                  return (
                    <tr key={r.date}>
                      <td className="ne-date-col"><strong>{r.date}</strong></td>
                      <td>{fmt$(r.price)}</td>
                      <td className={pctCls}>{fmtPct(r.price_delta_pct)}</td>
                      <td className="grp-left">{r.div_per_share > 0 ? fmt$(r.div_per_share) : '\u2014'}</td>
                      <td>{fmt$(r.total_dist)}</td>
                      <td>{fmt$(r.reinvested)}</td>
                      <td>{fmt4(r.shares_bought)}</td>
                      <td className="grp-left">{fmt4(r.total_shares)}</td>
                      <td>{fmt$(r.portfolio_val)}</td>
                      <td className="grp-left">{fmt4(r.breakeven_sh)}</td>
                      <td
                        className={defCls}
                        title={`Break-even shares minus total shares held: ${fmt4(r.shares_deficit)} (${fmtPct(gapPct)})`}
                      >
                        {fmtAbs4(r.shares_deficit)} {gapKind} <span style={{ opacity: 0.8 }}>({fmtAbsPct(gapPct)})</span>
                      </td>
                      <td style={{ color: r.coverage_ratio == null ? '#666' : navSeverityColor(navSeverityFromRatio(r.coverage_ratio)), fontWeight: r.coverage_ratio != null ? 600 : 400 }}>
                        {r.coverage_ratio != null ? r.coverage_ratio.toFixed(4) : '\u2014'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
