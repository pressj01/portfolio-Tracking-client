import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import Plot from '../components/ThemedPlot'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'
import { NAV_BENCHMARK_CHOICES } from '../utils/navBenchmarks'
import { todayInputValue } from '../utils/performancePeriods'

function fmt$(v) {
  return formatMoney(v)
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
function fmtRate(v) {
  return v == null ? '\u2014' : fmtPct(Number(v) * 100)
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
  return severity === 'High' ? 'High Benchmark-Gated Coverage' : severity === 'Medium' ? 'Moderate Benchmark-Gated Coverage' : 'Low Benchmark-Gated Coverage'
}

function shareGapPct(deficit, breakevenShares) {
  return breakevenShares ? (deficit / breakevenShares) * 100 : 0
}

function shareGapKind(deficit) {
  if (deficit > 0) return 'needed'
  if (deficit < 0) return 'extra'
  return 'at break-even'
}

function StatTile({ label, value, color, subtext, explanation }) {
  return (
    <div
      className="ne-stat-tile"
      title={explanation || undefined}
      aria-label={explanation ? `${label}: ${explanation}` : undefined}
      style={explanation ? { cursor: 'help' } : undefined}
    >
      <div className="ne-stat-val" style={{ color }}>{value}</div>
      <div className="ne-stat-lbl">
        {label}{explanation && <span aria-hidden="true" style={{ marginLeft: 4, opacity: 0.8 }}>ⓘ</span>}
      </div>
      {subtext && <div className="ne-stat-lbl" style={{ marginTop: 1 }}>{subtext}</div>}
    </div>
  )
}

export default function NavErosion() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const { isDark } = useTheme()
  const [searchParams] = useSearchParams()
  const requestedTicker = (searchParams.get('ticker') || '').trim().toUpperCase()
  const [ticker, setTicker] = useState(requestedTicker)
  const [benchmark, setBenchmark] = useState(() => (searchParams.get('benchmark') || '').trim().toUpperCase())
  const [amount, setAmount] = useState(() => searchParams.get('amount') || '10000')
  const [startDate, setStartDate] = useState(() => searchParams.get('start') || '2023-01-01')
  const [endDate, setEndDate] = useState(() => searchParams.get('end') || todayInputValue())
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
  const autoRunTickerRef = useRef('')

  const runBacktest = useCallback(() => {
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
    if (benchmark.trim()) params.set('benchmark', benchmark.trim().toUpperCase())

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
  }, [amount, benchmark, endDate, pf, reinvest, startDate, ticker])

  useEffect(() => {
    if (!requestedTicker || autoRunTickerRef.current === requestedTicker) return
    autoRunTickerRef.current = requestedTicker
    runBacktest()
  }, [requestedTicker, runBacktest])

  // Sorting
  const colKeys = ['date', 'price', 'price_delta_pct', 'benchmark_price', 'benchmark_delta_pct', 'div_per_share', 'total_dist',
    'reinvested', 'shares_bought', 'total_shares', 'portfolio_val', 'breakeven_sh', 'shares_deficit',
    'raw_nav_erosion_rate', 'distribution_rate_on_starting_nav', 'accounting_total_return_rate', 'coverage_ratio']

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

  const headers = ['Date', 'Price', 'Monthly \u0394%', 'Benchmark', 'Bench \u0394%', 'Div / Share', 'Total Dist',
    'Reinvested', 'Shares Bought', 'Total Shares', 'Portfolio Value', 'Break-Even Shares', 'Shares Needed / Extra To Breakeven',
    'Raw e', 'Dist d', 'Total Return r', 'Confirmed Coverage']

  const s = summary || {}
  const totalSeverity = s.nav_erosion_severity || navSeverityFromRatio(s.total_coverage)
  const totalSeverityColor = navSeverityColor(totalSeverity)
  const overallSeverity = s.overall_nav_erosion_severity || null
  const overallSeverityColor = navSeverityColor(overallSeverity)
  const finalRow = rows.length ? rows[rows.length - 1] : null
  const finalGapPct = finalRow ? shareGapPct(s.final_deficit || 0, finalRow.breakeven_sh || 0) : 0

  return (
    <div className="ne-page">
      <h1 style={{ marginBottom: '0.3rem' }}>Benchmark-Adjusted Price Erosion Back-Tester</h1>
      <p className="ne-desc">
        This tool confirms erosion only when the fund price falls during a month in which its underlying benchmark is flat or rising.
        It uses market closing prices as a price-based NAV proxy; it does not use issuer-published NAV.
        Cash distributions that are not reinvested are included in Ending Wealth and Investor Total Return.
        <br />
        <span style={{ color: 'var(--accent-bright)' }}>Blue line</span> = fund share price &nbsp;&middot;&nbsp;
        <span style={{ color: '#ffb74d' }}>Orange dotted</span> = benchmark normalized to the fund&apos;s starting price &nbsp;&middot;&nbsp;
        <span style={{ color: 'var(--pos-bright)' }}>Green line</span> = portfolio value &nbsp;&middot;&nbsp;
        <span style={{ color: 'var(--p-888)' }}>Dashed gray</span> = initial investment (break-even)
        <br /><br />
        <strong style={{ color: 'var(--p-ccc)' }}>Shares Needed / Extra To Breakeven</strong> compares your shares held to break-even shares
        (Initial Investment &divide; Current Price).
        <span style={{ color: 'var(--neg-3)', fontWeight: 600 }}> Red needed</span> means you are short that many shares.
        <span style={{ color: 'var(--pos-strong)', fontWeight: 600 }}> Green extra</span> means you have that many shares above break-even.
        The percent is the gap as a share of break-even shares.
        <br /><br />
        <strong style={{ color: 'var(--p-ccc)' }}>Confirmed erosion</strong> and severity use only qualifying months.
        They do not determine whether the fund is a raw NAV eroder; positive Raw e does that without reference to any benchmark.
        The share deficit remains visible as a separate capital-only measure and does not override the benchmark result.
        <br /><br />
        <strong style={{ color: 'var(--p-ccc)' }}>Raw NAV erosion</strong> uses no benchmark gate:
        {' '}e = d − r = (NAV₀ − NAVₜ) ÷ NAV₀. Distribution rate d and accounting total return r use the
        same selected window and the same starting NAV, so positive e means the payout exceeded strategy earnings.
        The Overall Verdict then gives bounded credit for recovery measured only from unadjusted share-price returns
        on benchmark up days. Distributions and total return are excluded from that recovery test.
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
          <label className="ne-label">Benchmark (optional)</label>
          <input
            className="ne-input"
            style={{ width: 130, textTransform: 'uppercase' }}
            placeholder="Auto"
            maxLength={40}
            list="ne-benchmark-choices"
            value={benchmark}
            onChange={e => setBenchmark(e.target.value.toUpperCase())}
            title="Leave blank for the automatic underlying benchmark, or enter a ticker such as HODL. A symbol with no price history falls back to the automatic one."
          />
          <datalist id="ne-benchmark-choices">
            {NAV_BENCHMARK_CHOICES.map(b => <option key={b} value={b} />)}
          </datalist>
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
            Reinvest %: <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>{reinvest}%</span>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <input
              type="range"
              min="0"
              max="100"
              value={reinvest}
              step="1"
              style={{ flex: 1, accentColor: 'var(--accent-bright)' }}
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
          {s.overall_nav_erosion_score != null && (
            <div
              className="ne-stat-tile"
              title="Primary historical verdict, not a forecast. Share-price recovery on benchmark up days can reduce the raw-loss warning by up to 75%, but cannot reduce benchmark-confirmed coverage or relative drag. Distributions are excluded from recovery. Low is 0–25, Moderate is above 25–75, and High is above 75."
              aria-label={`Overall verdict: ${overallSeverity} NAV erosion risk, score ${Number(s.overall_nav_erosion_score).toFixed(1)} out of 100.`}
              style={{
                border: `3px solid ${overallSeverityColor}`,
                borderRadius: 8,
                background: overallSeverity === 'High' ? 'rgba(224,85,85,0.18)' : overallSeverity === 'Medium' ? 'rgba(255,179,0,0.16)' : 'rgba(0,200,83,0.14)',
                cursor: 'help',
                flex: '1 1 260px',
              }}
            >
              <div className="ne-stat-val" style={{ color: overallSeverityColor, fontSize: '1.05rem', lineHeight: 1.25 }}>
                {`${String(overallSeverity || 'Unknown').toUpperCase()} NAV EROSION RISK`}
              </div>
              <div className="ne-stat-lbl">Overall Verdict ⓘ</div>
              <div className="ne-stat-lbl" style={{ marginTop: 1 }}>
                {`${Number(s.overall_nav_erosion_score).toFixed(1)} / 100 · price recovery ${s.up_market_recovery_score != null ? Number(s.up_market_recovery_score).toFixed(1) : '—'}`}
              </div>
            </div>
          )}
          <StatTile
            label="Benchmark"
            value={s.benchmark || '\u2014'}
            color="#ffb74d"
            subtext={s.actual_start && s.actual_end ? `${s.actual_start} to ${s.actual_end}` : null}
            explanation="The underlying market used only to decide whether a fund-price decline is benchmark-confirmed. The symbol itself is not good or bad; it should closely match the fund's actual exposure."
          />
          <StatTile
            label="Benchmark Return"
            value={fmtPct(s.benchmark_return_pct || 0)}
            color={s.benchmark_return_pct < 0 ? '#e05555' : '#00c853'}
            explanation="The benchmark's price change over the selected window. Positive is a rising market and negative is a falling market. This is context, not a score for the fund."
          />
          <StatTile
            label="Fund Price Change"
            value={fmtPct(s.price_chg_pct || 0)}
            color={s.price_chg_pct < 0 ? '#e05555' : '#00c853'}
            explanation="The fund's unadjusted share-price change, excluding distributions. Positive is favorable for principal; negative means the share price fell. Use accounting total return r to include distributions."
          />
          <StatTile
            label="Raw NAV Erosion (e)"
            value={fmtRate(s.raw_nav_erosion_rate)}
            color={s.raw_nav_erosion_rate > 0 ? '#e05555' : '#00c853'}
            subtext={s.raw_nav_erosion_rate > 0 ? 'NAV ERODER — benchmark independent' : s.raw_nav_erosion_rate < 0 ? 'NAV rose — no raw erosion' : 'NAV flat'}
            explanation="Raw principal change with no benchmark gate. Negative is good because NAV rose; 0% means NAV was flat; positive is erosion because NAV fell. Positive e means distributions exceeded accounting total return over this window."
          />
          <StatTile
            label="Distribution Rate (d)"
            value={fmtRate(s.distribution_rate_on_starting_nav)}
            color="#7ecfff"
            subtext="distributions ÷ NAV₀"
            explanation="Cash distributions per share divided by starting NAV. Higher means more cash was paid, but is not automatically better: compare d with r. If d is greater than r, e is positive and NAV fell."
          />
          <StatTile
            label="Accounting Total Return (r)"
            value={fmtRate(s.accounting_total_return_rate)}
            color={s.accounting_total_return_rate < 0 ? '#e05555' : '#00c853'}
            subtext="e = d − r"
            explanation="Fund price change plus distributions, divided by starting NAV. Higher is better; positive means the strategy earned a positive total return. For the entire payout to be covered without NAV loss, r must be at least d, which makes e zero or negative."
          />
          <div
            className="ne-stat-tile"
            title="Yes means at least one month had the fund price fall while its benchmark was flat or rising. No is preferable, but No does not prove that raw NAV rose—the benchmark gate can excuse market-wide declines."
            aria-label="Benchmark-Confirmed Erosion: Yes means at least one qualifying fund-specific down month. No is preferable, but the raw NAV result must still be checked."
            style={{ cursor: 'help' }}
          >
            <div className="ne-stat-val">
              {s.has_erosion
                ? <span style={{ color: 'var(--neg-3)', fontWeight: 700 }}>Yes</span>
                : <span style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>No</span>}
            </div>
            <div className="ne-stat-lbl">Benchmark-Confirmed Erosion <span aria-hidden="true" style={{ opacity: 0.8 }}>ⓘ</span></div>
            <div className="ne-stat-lbl" style={{ marginTop: 1 }}>{s.confirmed_erosion_months || 0} qualifying month(s)</div>
          </div>
          <StatTile
            label="Confirmed Erosion Ratio"
            value={s.total_coverage != null ? s.total_coverage.toFixed(4) : '\u2014'}
            color={totalSeverityColor}
            explanation="Benchmark-confirmed price-loss dollars per share divided by distributions per share over the same window. Lower is better: 0 is best, 0–0.25 is Low, above 0.25–0.75 is Moderate, and above 0.75 is High."
          />
          {s.total_coverage != null && (
            <div className="ne-stat-tile" title="Benchmark-gated coverage only. Low means few price losses passed the benchmark gate; it does not mean the fund preserved NAV. Positive Raw e still makes the fund a NAV eroder regardless of this result." aria-label={`Coverage severity: ${navSeverityText(totalSeverity)}. This does not override the raw NAV erosion result.`} style={{
              border: `2px solid ${totalSeverityColor}`,
              borderRadius: '8px',
              background: totalSeverity === 'High' ? 'rgba(224,85,85,0.12)' : totalSeverity === 'Medium' ? 'rgba(255,179,0,0.12)' : 'rgba(0,200,83,0.12)',
              cursor: 'help',
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
          <StatTile
            label={`Relative Drag vs ${s.benchmark || 'Benchmark'}`}
            value={fmtPct(-(s.relative_drag_pct || 0))}
            color={s.relative_drag_pct > 0 ? '#e05555' : '#00c853'}
            explanation="Fund price return minus benchmark price return. 0% means the fund kept pace with or beat the benchmark; a more negative number means worse underperformance. Distributions are not included in this comparison."
          />
          <StatTile
            label="Up-Market Price Recovery"
            value={s.up_market_recovery_score != null ? `${Number(s.up_market_recovery_score).toFixed(1)} / 100` : '—'}
            color={s.up_market_recovery_score == null ? '#666' : s.up_market_recovery_score >= 75 ? '#00c853' : s.up_market_recovery_score >= 40 ? '#ffb300' : '#e05555'}
            subtext={s.up_market_capture_pct != null ? `${Number(s.up_market_capture_pct).toFixed(1)}% capture · ${s.up_market_observations || 0} up days` : 'insufficient benchmark up days'}
            explanation="Compares the fund's average unadjusted share-price return with the benchmark's average price return on benchmark up days. Distributions and total return are excluded. Higher is better; 100% capture with at least 20 up days earns full recovery credit."
          />
          <StatTile label="Total Distributions" value={fmt$(s.total_dist || 0)} color="#7ecfff" explanation="All cash distributions generated by the simulated shares. More cash is not automatically better because a high payout can coexist with NAV loss; read it with e and investor total return." />
          <StatTile label="Shares Purchased" value={fmt4(s.total_shares_bought || 0)} color="#7ecfff" explanation="Additional shares bought with reinvested distributions. Higher reflects more DRIP activity, not necessarily better fund performance." />
          <StatTile label="Total Reinvested" value={fmt$(s.total_reinvested || 0)} color="#7ecfff" explanation="Distribution cash used to buy more shares. This is not a new contribution. Whether reinvestment helped is reflected in ending wealth and investor total return." />
          <StatTile label="Cash Taken" value={fmt$(s.cash_taken || 0)} color="#7ecfff" explanation="Distributions received as cash instead of reinvested. Higher means more spendable cash, but it is not a performance score; ending wealth includes this amount." />
          <StatTile label="Ending Shares Value" value={fmt$(s.final_value || 0)} color="#00e89a" explanation="Market value of all ending shares, including shares bought through reinvestment. Above the initial investment is favorable for share capital, but this excludes cash distributions taken." />
          <StatTile label="Ending Wealth" value={fmt$(s.ending_wealth || 0)} color="#00e89a" subtext="shares value + cash taken" explanation="Ending shares value plus distributions taken as cash. Compare this with the initial investment: higher is better, above the initial amount is a gain, and below it is a loss." />
          <StatTile label="Investor Total Return" value={fmtPct(s.total_return_pct || 0)} color={s.total_return_pct < 0 ? '#e05555' : '#00c853'} explanation="Percentage gain or loss on the initial investment after including ending shares and cash distributions. Positive is good, 0% is break-even, and negative is a loss. This is the most complete investor outcome on the screen." />
          <StatTile
            label={s.final_deficit > 0 ? 'Final Shares Needed' : s.final_deficit < 0 ? 'Final Extra Shares' : 'Final Share Gap'}
            value={`${fmtAbs4(s.final_deficit || 0)} (${fmtAbsPct(finalGapPct)})`}
            color={s.final_deficit > 0 ? '#e05555' : s.final_deficit < 0 ? '#00c853' : '#7ecfff'}
            subtext={s.final_deficit > 0 ? 'capital-only gap; cash excluded' : s.final_deficit < 0 ? 'above capital break-even' : 'at capital break-even'}
            explanation="Break-even shares minus shares actually held at the ending price. Needed/red is unfavorable for share capital; Extra/green is favorable. This deliberately excludes cash taken, so it is not the same as total return."
          />
        </div>
      )}

      {/* Chart */}
      {figData && figLayout && !loading && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Plot
            data={figData}
            layout={themedPlotlyLayout({ ...figLayout, autosize: true }, isDark)}
            useResizeHandler
            style={{ width: '100%', height: 420 }}
            config={{ responsive: true }}
          />
        </div>
      )}

      {/* Confirmed Erosion Ratio Chart */}
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
                  hovertemplate: '<b>%{x}</b><br>Confirmed Coverage: %{y:.4f}<br>Lower is better: ≤0.25 Low, ≤0.75 Moderate, >0.75 High<extra></extra>',
                  name: 'Confirmed Erosion Ratio',
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
              layout={themedPlotlyLayout({
                title: `${ticker.trim().toUpperCase()} — Monthly Confirmed Erosion Ratio`,
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
                yaxis: { title: 'Confirmed Erosion Ratio', zeroline: true },
                hovermode: 'x unified',
                shapes: [{
                  type: 'rect',
                  xref: 'paper', yref: 'paper',
                  x0: 0, x1: 1, y0: 0, y1: 1,
                  fillcolor: 'rgba(0,0,0,0)',
                  line: { width: 0 },
                }],
              }, isDark)}
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
            <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--p-666)' }}>&nbsp;&mdash; click any header to sort</span>
          </h2>
          <div className="ne-tbl-outer">
            <table className="sst" id="ne-tbl">
              <thead>
                <tr>
                  {headers.map((h, i) => {
                    const cls = i === 0 ? 'ne-date-col' : ([3, 5, 9, 11].includes(i) ? 'grp-left' : '')
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
                  const benchPctCls = r.benchmark_delta_pct < 0 ? 'pct-down' : (r.benchmark_delta_pct > 0 ? 'pct-up' : '')
                  const defCls = r.shares_deficit > 0 ? 'ne-deficit' : 'ne-surplus'
                  const gapPct = shareGapPct(r.shares_deficit, r.breakeven_sh)
                  const gapKind = shareGapKind(r.shares_deficit)
                  return (
                    <tr key={r.date}>
                      <td className="ne-date-col"><strong>{r.date}</strong></td>
                      <td>{fmt$(r.price)}</td>
                      <td className={pctCls}>{fmtPct(r.price_delta_pct)}</td>
                      <td className="grp-left">{r.benchmark_price != null ? fmt$(r.benchmark_price) : '\u2014'}</td>
                      <td className={benchPctCls}>{r.benchmark_delta_pct != null ? fmtPct(r.benchmark_delta_pct) : '\u2014'}</td>
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
                      <td title="Raw e has no benchmark gate. Negative is favorable because NAV rose; 0% is flat; positive is erosion." style={{ color: r.raw_nav_erosion_rate > 0 ? 'var(--neg-3)' : 'var(--pos-strong)', cursor: 'help' }}>{fmtRate(r.raw_nav_erosion_rate)}</td>
                      <td title="Distribution rate d is cash paid divided by the month's starting price. Higher means more cash, but is not automatically better when d exceeds r." style={{ cursor: 'help' }}>{fmtRate(r.distribution_rate_on_starting_nav)}</td>
                      <td title="Accounting return r includes price change and distributions. Higher is better; r at least equal to d means no raw NAV erosion." style={{ color: r.accounting_total_return_rate < 0 ? 'var(--neg-3)' : 'var(--pos-strong)', cursor: 'help' }}>{fmtRate(r.accounting_total_return_rate)}</td>
                      <td title="Benchmark-confirmed price loss divided by that month's distribution. Lower is better: 0–0.25 Low, above 0.25–0.75 Moderate, above 0.75 High." style={{ color: r.coverage_ratio == null ? 'var(--p-666)' : navSeverityColor(navSeverityFromRatio(r.coverage_ratio)), fontWeight: r.coverage_ratio != null ? 600 : 400, cursor: 'help' }}>
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

