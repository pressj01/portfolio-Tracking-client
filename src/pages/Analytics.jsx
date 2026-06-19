import React, { useState, useEffect, useCallback } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import Plot from '../components/ThemedPlot'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import RiskReturnCharts from './analytics/RiskReturnCharts'
import IncomeCharts from './analytics/IncomeCharts'
import BacktestCharts from './analytics/BacktestCharts'
import ToolsPanel from './analytics/ToolsPanel'
import { formatMoney, formatMoneyDelta, formatMoneyWhole, getCurrencyLabel } from '../utils/money'

const PERIODS = [
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: 'YTD', value: 'ytd' },
  { label: '1Y', value: '1y' },
  { label: '2Y', value: '2y' },
  { label: '5Y', value: '5y' },
  { label: 'Max', value: 'max' },
]

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function metricColor(val, thresholds, lowerBetter = false) {
  if (val == null) return '#8899aa'
  const [a, b, c] = thresholds
  if (lowerBetter) return val <= a ? '#4dff91' : val <= b ? '#7ecfff' : val <= c ? '#ffb74d' : '#ff6b6b'
  return val >= a ? '#4dff91' : val >= b ? '#7ecfff' : val >= c ? '#ffb74d' : '#ff6b6b'
}
const navSeverityFromRatio = (v) => v == null ? null : v > 0.75 ? 'High' : v > 0.25 ? 'Medium' : 'Low'
const navSeverityColor = (severity) => severity === 'High' ? '#ff6b6b' : severity === 'Medium' ? '#ffb300' : severity === 'Low' ? '#4dff91' : '#8899aa'
const navSeverityBg = (severity) => severity === 'High' ? 'rgba(255,107,107,0.12)' : severity === 'Medium' ? 'rgba(255,179,0,0.12)' : 'rgba(77,255,145,0.12)'
const navSeverityText = (severity) => severity === 'High' ? 'High Benchmark-Adjusted NAV Erosion' : severity === 'Medium' ? 'Moderate Benchmark-Adjusted NAV Erosion' : 'Low Benchmark-Adjusted NAV Erosion'

export default function Analytics() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const { isDark } = useTheme()
  const dialog = useDialog()
  const [tickers, setTickers] = useState([])
  const [input, setInput] = useState('')
  const [benchmark, setBenchmark] = useState('SPY')
  const [period, setPeriod] = useState('1y')
  const [mode, setMode] = useState('metrics')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [portfolioTickers, setPortfolioTickers] = useState([])
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [balance, setBalance] = useState(50)
  const [snapshots, setSnapshots] = useState([])
  const [chartTab, setChartTab] = useState('risk')
  const [portfolioCoverage, setPortfolioCoverage] = useState(null)
  const [portfolioCoverageSeverity, setPortfolioCoverageSeverity] = useState(null)
  const [tickerCoverage, setTickerCoverage] = useState({})
  const [tickerCoverageSeverity, setTickerCoverageSeverity] = useState({})

  // Load portfolio tickers on mount
  useEffect(() => {
    pf('/api/holdings')
      .then(r => r.json())
      .then(d => {
        const t = (d.holdings || d || []).map(h => h.ticker).filter(Boolean)
        setPortfolioTickers([...new Set(t)])
      })
      .catch(() => {})
  }, [pf, selection])

  const addTicker = useCallback(() => {
    const t = input.trim().toUpperCase()
    if (t && !tickers.includes(t)) setTickers(prev => [...prev, t])
    setInput('')
  }, [input, tickers])

  const removeTicker = (t) => setTickers(prev => prev.filter(x => x !== t))

  const loadPortfolio = () => {
    if (portfolioTickers.length > 0) {
      setTickers([...new Set([...tickers, ...portfolioTickers])])
    }
  }

  const clearAll = () => { setTickers([]); setResult(null); setError(null) }

  const runAnalysis = (runMode) => {
    if (tickers.length < 1) { setError('Enter at least 1 ticker.'); return }
    setError(null); setResult(null); setLoading(true)
    const body = { tickers, benchmark, period, mode: runMode || mode }
    if (runMode === 'optimize_balanced') body.balance = balance / 100
    pf('/api/analytics/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setResult(d)
        setMode(runMode || mode)
        // Extract coverage from analytics response
        if (d.coverage) {
          if (d.coverage.aggregate_coverage != null) setPortfolioCoverage(d.coverage.aggregate_coverage)
          setPortfolioCoverageSeverity(d.coverage.aggregate_severity ?? null)
          const map = {}
          const severityMap = {}
          if (d.coverage.results) d.coverage.results.forEach(r => {
            if (r.coverage_ratio != null) map[r.ticker] = r.coverage_ratio
            if (r.nav_erosion_severity) severityMap[r.ticker] = r.nav_erosion_severity
          })
          setTickerCoverage(map)
          setTickerCoverageSeverity(severityMap)
        }
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }

  // Sort metrics table
  const sortedMetrics = React.useMemo(() => {
    if (!result?.metrics) return []
    if (!sortCol) return result.metrics
    return [...result.metrics].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sortAsc ? av - bv : bv - av
    })
  }, [result, sortCol, sortAsc])
  const portfolioNavSeverity = portfolioCoverageSeverity || navSeverityFromRatio(portfolioCoverage)
  const portfolioNavColor = navSeverityColor(portfolioNavSeverity)

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(false) }
  }


  const pm = result?.portfolio_metrics || {}
  const grade = pm.grade || {}

  return (
    <div className="page">
      <h1 style={{ marginBottom: '0.3rem' }}>Portfolio Analytics</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Risk-adjusted metrics, portfolio grading, correlation analysis, and optimization.
      </p>

      {/* Controls */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <input
            style={{
              width: 100, textTransform: 'uppercase', padding: '0.35rem 0.5rem',
              background: 'var(--bg)', border: '1px solid var(--p-3a3a5c)', borderRadius: 4,
              color: 'var(--text)', fontSize: '0.9rem',
            }}
            maxLength={10} placeholder="Ticker"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addTicker() }}
          />
          <button className="btn btn-primary" onClick={addTicker} style={{ padding: '0.35rem 0.8rem' }}>Add</button>
          <button className="btn" onClick={loadPortfolio} style={{ padding: '0.35rem 0.8rem', color: 'var(--accent-2)' }}>
            Load Portfolio ({portfolioTickers.length})
          </button>

          <span style={{ color: 'var(--p-556677)', margin: '0 0.2rem' }}>|</span>

          <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>Bench:</span>
          <input
            style={{
              width: 55, textTransform: 'uppercase', padding: '0.35rem 0.4rem',
              background: 'var(--bg)', border: '1px solid var(--p-3a3a5c)', borderRadius: 4,
              color: 'var(--text)', fontSize: '0.82rem', textAlign: 'center',
            }}
            maxLength={6} value={benchmark}
            onChange={e => setBenchmark(e.target.value.toUpperCase())}
          />

          <span style={{ color: 'var(--p-556677)', margin: '0 0.2rem' }}>|</span>

          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)} style={{
              padding: '0.25rem 0.5rem', borderRadius: 4, cursor: 'pointer',
              border: period === p.value ? '1px solid var(--accent)' : '1px solid var(--p-3a3a5c)',
              background: period === p.value ? 'var(--p-1a3a5c)' : 'var(--bg)',
              color: period === p.value ? 'var(--accent)' : 'var(--text-dim)',
              fontSize: '0.78rem', fontWeight: period === p.value ? 600 : 400,
            }}>{p.label}</button>
          ))}
        </div>

        {/* Suggested ETFs based on portfolio type */}
        {result?.suggested_growth && result.suggested_growth.filter(t => !tickers.includes(t)).length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600 }}>Suggested Growth ETFs:</span>
            {result.suggested_growth.filter(t => !tickers.includes(t)).map(t => (
              <button key={t} onClick={() => { if (!tickers.includes(t)) setTickers(prev => [...prev, t]) }}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'var(--p-1a2a3e)', border: '1px solid var(--p-3a5a8c)',
                         borderRadius: 12, color: 'var(--accent)', cursor: 'pointer' }}>{t}</button>
            ))}
            <button onClick={() => { const add = result.suggested_growth.filter(t => !tickers.includes(t)); setTickers(prev => [...new Set([...prev, ...add])]) }}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', background: 'var(--p-1a3a5c)', border: '1px solid var(--p-3a5a8c)',
                       borderRadius: 12, color: 'var(--accent-2)', cursor: 'pointer', fontWeight: 600 }}>Add All</button>
          </div>
        )}
        {result?.suggested_income && result.suggested_income.filter(t => !tickers.includes(t)).length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--pos-muted)', fontSize: '0.78rem', fontWeight: 600 }}>Suggested Income ETFs:</span>
            {result.suggested_income.filter(t => !tickers.includes(t)).map(t => (
              <button key={t} onClick={() => { if (!tickers.includes(t)) setTickers(prev => [...prev, t]) }}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'var(--p-1a2e1e)', border: '1px solid var(--p-2a5a3c)',
                         borderRadius: 12, color: 'var(--pos-muted)', cursor: 'pointer' }}>{t}</button>
            ))}
            <button onClick={() => { const add = result.suggested_income.filter(t => !tickers.includes(t)); setTickers(prev => [...new Set([...prev, ...add])]) }}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', background: 'var(--p-1a3a2e)', border: '1px solid var(--p-2a5a3c)',
                       borderRadius: 12, color: 'var(--p-81c784)', cursor: 'pointer', fontWeight: 600 }}>Add All</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <button className="btn btn-success" onClick={() => runAnalysis('metrics')} disabled={loading || tickers.length < 1}
            style={{ padding: '0.35rem 1rem', fontWeight: 600 }}>
            {loading ? 'Loading...' : 'Analyze'}
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_returns')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: 'var(--accent)', background: 'var(--p-1a2a3e)', border: '1px solid var(--p-3a5a8c)' }}>
            Optimize Returns
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_income')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: 'var(--pos-muted)', background: 'var(--p-1a2e1e)', border: '1px solid var(--p-2a5a3c)' }}>
            Optimize Income
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_balanced')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: 'var(--p-ffb74d)', background: 'var(--p-2e2517)', border: '1px solid var(--p-5a4a2c)' }}>
            Balanced
          </button>
          {mode === 'optimize_balanced' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ color: 'var(--pos-muted)', fontSize: '0.72rem' }}>Safety</span>
              <input type="range" min="0" max="100" value={balance}
                onChange={e => setBalance(Number(e.target.value))}
                style={{ width: 90 }} />
              <span style={{ color: 'var(--p-ffb74d)', fontSize: '0.72rem' }}>Income</span>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginLeft: 4 }}>({balance}%)</span>
            </span>
          )}
          <button className="btn" onClick={clearAll} style={{ padding: '0.35rem 0.6rem', color: 'var(--text-dim)' }}>Clear</button>
        </div>

        {/* Ticker chips */}
        {tickers.length > 0 && (
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {tickers.map(t => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '0.2rem 0.5rem', background: 'var(--p-1a2a3e)', border: '1px solid var(--p-2a4a6e)',
                borderRadius: 4, fontSize: '0.82rem', color: 'var(--accent-bright)', fontWeight: 600,
              }}>
                {t}
                <button onClick={() => removeTicker(t)} style={{
                  background: 'none', border: 'none', color: 'var(--neg)', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.9rem', padding: '0 2px', lineHeight: 1,
                }}>&times;</button>
              </span>
            ))}
            <span style={{ color: 'var(--p-556677)', fontSize: '0.78rem', alignSelf: 'center' }}>
              {tickers.length} ticker{tickers.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" />
          <div style={{ color: 'var(--text-dim)', marginTop: '0.5rem', fontSize: '0.85rem' }}>Fetching data & calculating metrics...</div>
        </div>
      )}

      {result && !loading && (
        <>
          {/* Portfolio Grade + Quick Stats */}
          {grade.overall && (
            <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {/* Grade badge */}
                <div style={{ textAlign: 'center', minWidth: 120 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '0.3rem' }}>Portfolio Grade</div>
                  <GradeBadge grade={grade.overall} large />
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                    Score: {grade.score}
                  </div>
                </div>

                {/* Grade breakdown bars */}
                <div style={{ flex: 1, minWidth: 250 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>Grade Breakdown</div>
                  {(grade.breakdown || []).map((b, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span style={{ width: 130, fontSize: '0.78rem', color: 'var(--text-dim-2)', textAlign: 'right' }}>
                        {b.category} ({b.weight}%)
                      </span>
                      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 4, height: 16, position: 'relative' }}>
                        <div style={{
                          width: `${Math.max(b.score, 2)}%`, height: '100%', borderRadius: 4,
                          background: b.score >= 80 ? 'var(--p-4caf50)' : b.score >= 60 ? 'var(--p-ffb74d)' : 'var(--neg-2)',
                        }} />
                        <span style={{
                          position: 'absolute', right: 4, top: 0, fontSize: '0.7rem',
                          color: 'var(--text-strong)', lineHeight: '16px',
                        }}>{b.grade} ({b.score})</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Quick stats */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 160 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Quick Stats</div>
                  <Stat label="Holdings" value={pm.n_holdings} />
                  <Stat label="Effective N" value={pm.effective_n?.toFixed(1)} />
                  <Stat label="Max Drawdown" value={pm.max_drawdown != null ? (pm.max_drawdown * 100).toFixed(1) + '%' : '—'} color="#ef5350" />
                  <Stat label="Top Holding" value={pm.top_weight != null ? pm.top_weight + '%' : '—'} />
                  <Stat label="Ulcer Index" value={pm.ulcer_index?.toFixed(2)} color={metricColor(pm.ulcer_index, [3, 7, 12], true)} />
                  <Stat label="Est. Annual Income" value={formatMoneyWhole(pm.est_annual_income)} color="#66bb6a" />
                </div>

                {/* NAV Erosion Ratio */}
                {portfolioCoverage != null && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 140, alignItems: 'center' }}>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>NAV Erosion Ratio</div>
                    <div style={{
                      fontSize: '1.6rem', fontWeight: 700,
                      color: portfolioNavColor,
                    }}>
                      {portfolioCoverage.toFixed(4)}
                    </div>
                    <div style={{
                      padding: '0.3rem 0.7rem', borderRadius: 6,
                      border: `2px solid ${portfolioNavColor}`,
                      background: navSeverityBg(portfolioNavSeverity),
                      fontSize: '0.78rem', fontWeight: 600, textAlign: 'center',
                      color: portfolioNavColor,
                    }}>
                      {navSeverityText(portfolioNavSeverity)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* NAV Erosion Ratio Chart */}
          {sortedMetrics.length > 0 && Object.keys(tickerCoverage).length > 0 && (() => {
            const covTickers = sortedMetrics.filter(m => tickerCoverage[m.ticker] != null)
            if (covTickers.length === 0) return null
            const sorted = [...covTickers].sort((a, b) => (tickerCoverage[b.ticker] || 0) - (tickerCoverage[a.ticker] || 0))
            const tks = sorted.map(m => m.ticker)
            const rawVals = sorted.map(m => tickerCoverage[m.ticker])
            const CAP = 5
            const ZERO_MARKER = 0.04
            const visualVals = rawVals.map(v => v === 0 ? ZERO_MARKER : Math.min(v, CAP))
            const colors = sorted.map(m => navSeverityColor(tickerCoverageSeverity[m.ticker] || navSeverityFromRatio(tickerCoverage[m.ticker])))
            const textLabels = rawVals.map(v => v > CAP ? v.toFixed(1) : v === 0 ? '0.0000' : '')
            const yMax = Math.max(...rawVals, 0.75, ZERO_MARKER)
            return (
              <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                <Plot
                  data={[
                    {
                      x: tks, y: visualVals, type: 'bar',
                      marker: { color: colors },
                      text: textLabels,
                      textposition: 'outside',
                      textfont: { color: '#4dff91', size: 10 },
                      customdata: rawVals,
                      showlegend: false,
                      hovertemplate: '<b>%{x}</b><br>NAV Erosion Ratio: %{customdata:.4f}<extra></extra>',
                    },
                    {
                      x: [tks[0], tks[tks.length - 1]], y: [0.75, 0.75],
                      type: 'scatter', mode: 'lines',
                      line: { color: '#ffffff', width: 2, dash: 'dash' },
                      hoverinfo: 'skip', name: 'High threshold (0.75)',
                    },
                    // Color key: legend-only swatches explaining the bar colors.
                    { x: [null], y: [null], type: 'bar', name: 'Low erosion', marker: { color: '#4dff91' } },
                    { x: [null], y: [null], type: 'bar', name: 'Medium erosion', marker: { color: '#ffb300' } },
                    { x: [null], y: [null], type: 'bar', name: 'High erosion', marker: { color: '#ff6b6b' } },
                  ]}
                  layout={themedPlotlyLayout({
                    title: { text: 'Per-Ticker NAV Erosion Ratio', font: { color: '#e0e8f5', size: 14 } },
                    template: 'plotly_dark',
                    paper_bgcolor: '#111124',
                    plot_bgcolor: '#111124',
                    font: { color: '#e0e8f5' },
                    margin: { t: 40, l: 50, r: 20, b: 70 },
                    height: 300, autosize: true,
                    showlegend: true,
                    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.12, font: { color: '#b8c7d9', size: 10 } },
                    xaxis: {
                      title: { text: 'Ticker', font: { color: '#e0e8f5' }, standoff: 10 },
                      color: '#b8c7d9',
                      gridcolor: '#1a2a3e',
                      zerolinecolor: '#2a3a4e',
                    },
                    yaxis: {
                      title: { text: 'NAV Erosion Ratio', font: { color: '#e0e8f5' } },
                      color: '#b8c7d9',
                      gridcolor: '#1a2a3e',
                      zeroline: true,
                      zerolinecolor: '#2a3a4e',
                      range: [Math.min(...rawVals, 0) - 0.05, Math.min(Math.max(yMax + 0.25, 1), CAP + 0.5)],
                    },
                    hoverlabel: { bgcolor: '#111124', bordercolor: '#3a3a5c', font: { color: '#e0e0e0', size: 13 } },
                  }, isDark)}
                  useResizeHandler
                  style={{ width: '100%', height: 300 }}
                  config={{ responsive: true }}
                />
              </div>
            )
          })()}

          {/* Metrics Table */}
          {sortedMetrics.length > 0 && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--accent-2)', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                Per-Ticker Metrics
                <span style={{ color: 'var(--p-556677)', fontWeight: 400, fontSize: '0.82rem', marginLeft: '0.5rem' }}>
                  ({PERIODS.find(p => p.value === period)?.label || period})
                </span>
              </h3>

              {/* Data window — scores are a deterministic function of this window,
                  so the same window always reproduces the same scores. */}
              {result.data_window && (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                  Data window: <span style={{ color: 'var(--text-strong)' }}>{result.data_window.start} → {result.data_window.end}</span>
                  {' '}({result.data_window.trading_days} trading days, benchmark {result.data_window.benchmark}).
                  <span title="Scores are deterministic for a given window. They shift only as the trailing window moves to a new day or the latest intraday bar updates."> Re-running on the same window reproduces identical scores. {'ⓘ'}</span>
                  {pm.grade_window_days != null && pm.grade_window_days !== result.data_window.trading_days && (
                    <span> Portfolio grade computed on the {pm.grade_window_days}-day window all holdings share.</span>
                  )}
                  {pm.grade_excluded?.length > 0 && (
                    <span style={{ color: 'var(--p-ffb74d)' }}> Excluded from the portfolio grade for insufficient history: {pm.grade_excluded.join(', ')}.</span>
                  )}
                </div>
              )}

              {/* Hidden explanation: what the Score means, how it's computed, why it matters */}
              <details style={{ marginBottom: '0.75rem', borderLeft: '3px solid var(--accent-2)', background: 'var(--p-0a1628)', borderRadius: '4px', padding: '0.5rem 0.75rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--accent-2)', fontWeight: 600, fontSize: '0.85rem' }}>
                  How is the Score computed? {'ⓘ'}
                </summary>
                <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
                  <p style={{ margin: '0 0 0.6rem' }}>
                    <strong style={{ color: 'var(--text-strong)' }}>What it is.</strong> A single <strong>risk-adjusted quality score from 0 to 100</strong> (higher is better),
                    mapped to a letter grade. It is computed over the selected lookback period from daily returns and is purely
                    backward-looking — it rewards consistent risk-adjusted returns and penalizes deep, prolonged drawdowns.
                    It is <em>not</em> a return forecast or a buy/sell signal.
                  </p>

                  <p style={{ margin: '0 0 0.4rem' }}>
                    <strong style={{ color: 'var(--text-strong)' }}>How it's computed.</strong> Each component metric is scored 0–100 against
                    fixed thresholds, then combined as a <strong>weighted average</strong> (only metrics with enough data — ≥30 days — are
                    included, and the weights renormalize over whatever is available). Higher-is-better metrics score 100 at/above their
                    "excellent" threshold; lower-is-better metrics score 100 at/below it; values in between are linearly interpolated.
                  </p>

                  <div style={{ overflowX: 'auto', margin: '0.5rem 0' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', width: '100%' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)' }}>Metric</th>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Ticker wt</th>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Portfolio wt</th>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)' }}>Direction</th>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)' }}>Thresholds (exc / good / fair / poor)</th>
                        </tr>
                      </thead>
                      <tbody style={{ color: 'var(--text-strong)' }}>
                        {[
                          ['Ulcer Index', '25%', '20%', 'lower', '3 / 7 / 12 / 20'],
                          ['Calmar Ratio', '20%', '20%', 'higher', '1.5 / 1.0 / 0.5 / 0.2'],
                          ['Omega Ratio', '15%', '15%', 'higher', '2.0 / 1.5 / 1.2 / 1.0'],
                          ['Sortino Ratio', '15%', '12%', 'higher', '2.0 / 1.5 / 1.0 / 0.5'],
                          ['Sharpe Ratio', '10%', '8%', 'higher', '1.5 / 1.0 / 0.5 / 0.0'],
                          ['Max Drawdown %', '10%', '10%', 'lower', '10 / 20 / 30 / 40'],
                          ['Downside Capture', '5%', '5%', 'lower', '80 / 90 / 100 / 120'],
                          ['Diversification (eff. N)', '—', '10%', 'higher', '20 / 12 / 6 / 3'],
                        ].map(([metric, tw, pw, dir, thr]) => (
                          <tr key={metric} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                            <td style={{ padding: '0.25rem 0.5rem' }}>{metric}</td>
                            <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>{tw}</td>
                            <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>{pw}</td>
                            <td style={{ padding: '0.25rem 0.5rem', color: 'var(--text-dim)' }}>{dir} is better</td>
                            <td style={{ padding: '0.25rem 0.5rem', color: 'var(--text-dim)' }}>{thr}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.74rem' }}>
                    The portfolio row uses the same metrics on the blended portfolio return stream and adds a
                    <strong> Diversification</strong> term (based on the effective number of holdings). Stale, delisted, or
                    flat-lined price series are treated as un-gradeable and score 0 rather than being rewarded for zero volatility.
                  </p>

                  {/* Worked example using ULTY */}
                  <div style={{ margin: '0.5rem 0 0.75rem', padding: '0.5rem 0.75rem', background: 'var(--p-0b0b1c)', borderRadius: '4px', border: '1px solid var(--p-2a3a4e)' }}>
                    <p style={{ margin: '0 0 0.4rem' }}>
                      <strong style={{ color: 'var(--text-strong)' }}>Worked example — ULTY (per-ticker).</strong> Each raw metric is
                      first mapped to a 0–100 sub-score, then multiplied by its weight. For example, ULTY's Ulcer Index of 12.56 lands
                      in the fair-to-poor band (12–20), so it scores <code>40 + 20 × (20 − 12.56) / (20 − 12) = 58.6</code>; its Sortino
                      of 0.10 is below the "poor" floor of 0.5, so it scores <code>40 × 0.10 / 0.5 = 8.0</code>.
                    </p>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', width: '100%' }}>
                        <thead>
                          <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)' }}>Metric</th>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>ULTY value</th>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Sub-score</th>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Weight</th>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Contribution</th>
                          </tr>
                        </thead>
                        <tbody style={{ color: 'var(--text-strong)' }}>
                          {[
                            ['Ulcer Index', '12.56', '58.6', '25%', '14.65'],
                            ['Calmar Ratio', '0.18', '36.0', '20%', '7.20'],
                            ['Omega Ratio', '1.05', '45.0', '15%', '6.75'],
                            ['Sortino Ratio', '0.10', '8.0', '15%', '1.20'],
                            ['Sharpe Ratio', '0.07', '42.8', '10%', '4.28'],
                            ['Max Drawdown', '24.2%', '71.6', '10%', '7.16'],
                            ['Downside Capture', '161', '26.3', '5%', '1.32'],
                          ].map(([metric, val, sub, wt, contrib]) => (
                            <tr key={metric} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                              <td style={{ padding: '0.25rem 0.5rem' }}>{metric}</td>
                              <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{val}</td>
                              <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>{sub}</td>
                              <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{wt}</td>
                              <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>{contrib}</td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 700 }}>
                            <td style={{ padding: '0.3rem 0.5rem' }} colSpan={4}>Total = weighted average (weights sum to 100%)</td>
                            <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--neg-2)' }}>42.5 → F</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: 'var(--p-556677)' }}>
                      Summing the contributions gives 42.56, which rounds to the <strong>42.5</strong> shown in the table — a grade of
                      <strong> F</strong>. (Minor differences from a hand calculation come from the engine using full-precision metric
                      values rather than the 2-decimal figures displayed.)
                    </p>
                  </div>

                  <p style={{ margin: '0 0 0.4rem' }}>
                    <strong style={{ color: 'var(--text-strong)' }}>Letter grades.</strong> A+ ≥97 · A ≥93 · A- ≥90 · B+ ≥87 · B ≥83 ·
                    B- ≥80 · C+ ≥77 · C ≥73 · C- ≥70 · D+ ≥67 · D ≥63 · D- ≥60 · F &lt;60.
                  </p>

                  <p style={{ margin: 0 }}>
                    <strong style={{ color: 'var(--text-strong)' }}>Significance.</strong> Because Ulcer Index + Calmar together
                    carry ~45% of the weight, the score is deliberately <strong>drawdown-focused</strong> — it favours capital
                    preservation and steady income over raw upside. A high-yield fund can still grade poorly if it gets there with
                    severe drawdowns or high downside capture (see ULTY above). Use it to compare holdings on risk-adjusted terms,
                    not to predict future returns.
                  </p>
                </div>
              </details>

              <div style={{ maxHeight: '600px', overflow: 'auto', borderRadius: '4px' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
                <thead>
                  <tr>
                    {[
                      { key: 'ticker', label: 'Ticker' },
                      { key: 'grade', label: 'Grade' },
                      { key: 'score', label: 'Score' },
                      { key: 'weight', label: 'Wt %' },
                      { key: 'ulcer_index', label: 'Ulcer', tip: 'Drawdown severity & duration. <3 great, <5 good, >10 poor' },
                      { key: 'sharpe', label: 'Sharpe', tip: 'Risk-adjusted return. >1.5 great, >1.0 good, <0.5 poor' },
                      { key: 'sortino', label: 'Sortino', tip: 'Like Sharpe but only penalizes downside. >2.0 great, >1.5 good' },
                      { key: 'calmar', label: 'Calmar', tip: 'Return vs max drawdown. >2.0 great, >1.0 good' },
                      { key: 'omega', label: 'Omega', tip: 'Gains vs losses ratio. >2.0 great, >1.5 good' },
                      { key: 'max_drawdown', label: 'Max DD', tip: 'Largest peak-to-trough decline. Closer to 0% is better' },
                      { key: 'up_capture', label: 'Up Cap', tip: '% of benchmark gains captured. >100% = outperforming in up markets' },
                      { key: 'down_capture', label: 'Dn Cap', tip: '% of benchmark losses captured. <100% = less downside than benchmark' },
                      { key: 'annual_ret', label: 'Ann Ret', tip: 'Price return annualized (excludes dividends)' },
                      { key: 'annual_total_ret', label: 'Tot Ret', tip: 'Price return + dividend yield annualized' },
                      { key: 'annual_vol', label: 'Ann Vol', tip: 'Annualized standard deviation. Lower = less volatile' },
                      { key: '_coverage', label: 'NAV', tip: 'NAV severity uses the benchmark-adjusted ratio, and is forced High for a 50%+ price decline or a 5%+ ending share deficit.' },
                    ].map(col => (
                      <th key={col.key} onClick={() => handleSort(col.key)} title={col.tip || ''} style={{
                        padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)',
                        color: sortCol === col.key ? 'var(--accent)' : 'var(--text-dim)',
                        cursor: 'pointer', whiteSpace: 'nowrap', textAlign: col.key === 'ticker' ? 'left' : 'right',
                        fontSize: '0.78rem',
                        position: 'sticky', top: 0, zIndex: 3, background: 'var(--p-0b0b1c)',
                      }}>
                        {col.label}{col.tip ? ' \u24D8' : ''} {sortCol === col.key ? (sortAsc ? '\u25B4' : '\u25BE') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Portfolio row */}
                  {pm.sharpe != null && (
                    <tr style={{ background: 'var(--p-0a1628)', fontWeight: 600 }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: 'var(--accent-2)' }}>PORTFOLIO</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}><GradeBadge grade={grade.overall} /></td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)' }}>{grade.score}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>100</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.ulcer_index, [3, 7, 12], true) }}>
                        {pm.ulcer_index?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.sharpe, [1.5, 1.0, 0.5]) }}>
                        {pm.sharpe?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.sortino, [2.0, 1.5, 1.0]) }}>
                        {pm.sortino?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.calmar, [1.5, 1.0, 0.5]) }}>
                        {pm.calmar?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.omega, [2.0, 1.5, 1.2]) }}>
                        {pm.omega?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--neg-2)' }}>
                        {pm.max_drawdown != null ? (pm.max_drawdown * 100).toFixed(1) + '%' : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>
                        {pm.up_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.down_capture, [80, 90, 100], true) }}>
                        {pm.down_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }} colSpan={3}></td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 600, color: portfolioCoverage == null ? 'var(--p-556)' : portfolioNavColor }}>
                        {portfolioCoverage != null ? portfolioCoverage.toFixed(2) : '—'}
                      </td>
                    </tr>
                  )}
                  {sortedMetrics.map(m => (
                    <tr key={m.ticker} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: 'var(--accent-bright)', fontWeight: 600 }}>{m.ticker}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}><GradeBadge grade={m.grade} /></td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)' }}>{m.score}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{m.weight?.toFixed(1)}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.ulcer_index, [3, 7, 12], true) }}>
                        {m.ulcer_index?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.sharpe, [1.5, 1.0, 0.5]) }}>
                        {m.sharpe?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.sortino, [2.0, 1.5, 1.0]) }}>
                        {m.sortino?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.calmar, [1.5, 1.0, 0.5]) }}>
                        {m.calmar?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.omega, [2.0, 1.5, 1.2]) }}>
                        {m.omega?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--neg-2)' }}>
                        {m.max_drawdown != null ? m.max_drawdown.toFixed(1) + '%' : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>
                        {m.up_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.down_capture, [80, 90, 100], true) }}>
                        {m.down_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: m.annual_ret >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {m.annual_ret?.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: m.annual_total_ret >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {m.annual_total_ret?.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>
                        {m.annual_vol?.toFixed(1)}%
                      </td>
                      {(() => {
                        const cov = tickerCoverage[m.ticker]
                        const severity = tickerCoverageSeverity[m.ticker] || navSeverityFromRatio(cov)
                        return (
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 600, color: cov == null ? 'var(--p-556)' : navSeverityColor(severity) }}>
                            {cov != null ? cov.toFixed(2) : '—'}
                          </td>
                        )
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Optimization results */}
          {result.optimization && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--accent-2)', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                Optimization Results
                {mode === 'optimize_returns' && ' — Max Returns (Sharpe + Sortino)'}
                {mode === 'optimize_income' && ' — Max Income (Omega, Calmar, Ulcer, Sortino)'}
                {mode === 'optimize_balanced' && ` — Balanced (${result.optimization.summary?.balance || balance}%) — Income vs Safety (Omega, Calmar, Ulcer, Sortino)`}
              </h3>

              {/* Summary stats */}
              {result.optimization.summary && (
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {Object.entries(result.optimization.summary).map(([k, v]) => (
                    <div key={k} style={{ fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--text-dim)' }}>{k.replace(/_/g, ' ')}: </span>
                      <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
                        {typeof v === 'number' ? (k.includes('income') ? formatMoneyWhole(v) : v.toFixed(2) + (k.includes('pct') || k.includes('yield') || k.includes('return') || k.includes('vol') || k.includes('dd') ? '%' : '')) : v}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Weights table */}
              {result.optimization.weights && (
                <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%', marginBottom: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Ticker</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Current %</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Optimal %</th>
                      {result.optimization.weights[0]?.yield_pct != null && (
                        <th style={{ ...thStyle, textAlign: 'right' }}>Yield %</th>
                      )}
                      <th style={{ ...thStyle, textAlign: 'right' }}>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.optimization.weights.map(w => {
                      const change = w.optimal_pct - w.current_pct
                      return (
                        <tr key={w.ticker} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                          <td style={{ padding: '0.35rem 0.5rem', color: 'var(--accent-bright)', fontWeight: 600 }}>{w.ticker}</td>
                          <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{w.current_pct.toFixed(1)}</td>
                          <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{w.optimal_pct.toFixed(1)}</td>
                          {w.yield_pct != null && (
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--pos)' }}>{w.yield_pct.toFixed(2)}</td>
                          )}
                          <td style={{
                            padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 600,
                            color: change > 0.5 ? 'var(--pos)' : change < -0.5 ? 'var(--neg)' : 'var(--text-dim)',
                          }}>
                            {change > 0 ? '+' : ''}{change.toFixed(1)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* Before / After Comparison */}
              {result.optimization.comparison && (() => {
                const c = result.optimization.comparison
                const b = c.before, a = c.after
                const delta = (v1, v2, fmt, isDollar = false) => {
                  if (v1 == null || v2 == null) return '—'
                  const diff = v2 - v1
                  const color = diff > 0.01 ? '#4dff91' : diff < -0.01 ? '#ff6b6b' : '#8899aa'
                  if (isDollar) {
                    return <span style={{ color }}>{formatMoneyDelta(diff, { digits: 0 })}</span>
                  }
                  return <span style={{ color }}>{diff > 0 ? '+' : ''}{fmt(diff)}</span>
                }
                const fmtPct = v => (v * 100).toFixed(1) + '%'
                const fmtDollar = v => formatMoneyWhole(v, { absolute: true })
                const fmtNum = v => v.toFixed(2)
                const metricRow = (label, bv, av, fmt, isDollar = false, tip = '') => (
                  <tr key={label} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                    <td title={tip} style={{ padding: '0.3rem 0.5rem', color: 'var(--text-dim)', fontSize: '0.78rem', cursor: tip ? 'help' : 'default' }}>{label}{tip ? ' \u24D8' : ''}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{bv != null ? (isDollar ? formatMoneyWhole(bv, { absolute: true }) : fmt(bv)) : '—'}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{av != null ? (isDollar ? formatMoneyWhole(av, { absolute: true }) : fmt(av)) : '—'}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{delta(bv, av, fmt, isDollar)}</td>
                  </tr>
                )
                return (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-strong)', fontWeight: 600, marginBottom: '0.4rem' }}>Impact Analysis — Before vs After</div>
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%', marginBottom: '0.5rem' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Metric</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Current</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>After</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                          <td style={{ padding: '0.3rem 0.5rem', color: 'var(--text-dim)', fontSize: '0.78rem' }}>Grade</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 700, fontSize: '0.9rem' }}>{b.grade} ({b.score})</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 700, fontSize: '0.9rem',
                            color: a.score > b.score ? 'var(--pos)' : a.score < b.score ? 'var(--neg)' : 'var(--text-strong)' }}>{a.grade} ({a.score})</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right',
                            color: a.score > b.score ? 'var(--pos)' : a.score < b.score ? 'var(--neg)' : 'var(--text-dim)' }}>
                            {a.score !== b.score ? (a.score > b.score ? '+' : '') + (a.score - b.score).toFixed(1) : '—'}
                          </td>
                        </tr>
                        {metricRow('Monthly Income', b.monthly_income, a.monthly_income, fmtDollar, true)}
                        {metricRow('Annual Income', b.annual_income, a.annual_income, fmtDollar, true)}
                        {metricRow('Sharpe Ratio', b.sharpe, a.sharpe, fmtNum, false, 'Risk-adjusted return. >1.5 great, >1.0 good, <0.5 poor')}
                        {metricRow('Sortino Ratio', b.sortino, a.sortino, fmtNum, false, 'Like Sharpe but only penalizes downside. >2.0 great, >1.5 good')}
                        {metricRow('Omega Ratio', b.omega, a.omega, fmtNum, false, 'Gains vs losses ratio. >2.0 great, >1.5 good')}
                        {metricRow('Calmar Ratio', b.calmar, a.calmar, fmtNum, false, 'Return vs max drawdown. >2.0 great, >1.0 good')}
                        {metricRow('Ulcer Index', b.ulcer_index, a.ulcer_index, fmtNum, false, 'Drawdown severity & duration. <3 great, <5 good, >10 poor')}
                        {metricRow('Max Drawdown', b.max_drawdown, a.max_drawdown, fmtPct, false, 'Largest peak-to-trough decline. Closer to 0% is better')}
                        {(b.coverage != null || a.coverage != null) && (() => {
                          const covColor = (v) => navSeverityColor(navSeverityFromRatio(v))
                          const covDelta = b.coverage != null && a.coverage != null ? a.coverage - b.coverage : null
                          return (
                            <tr style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                              <td title="NAV severity uses the benchmark-adjusted ratio, and is forced High for a 50%+ price decline or a 5%+ ending share deficit." style={{ padding: '0.3rem 0.5rem', color: 'var(--text-dim)', fontSize: '0.78rem', cursor: 'help' }}>NAV Erosion Ratio ⓘ</td>
                              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: covColor(b.coverage), fontWeight: 600 }}>{b.coverage != null ? b.coverage.toFixed(4) : '—'}</td>
                              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: covColor(a.coverage), fontWeight: 600 }}>{a.coverage != null ? a.coverage.toFixed(4) : '—'}</td>
                              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: covDelta == null ? 'var(--text-dim)' : covDelta < -0.01 ? 'var(--pos)' : covDelta > 0.01 ? 'var(--neg)' : 'var(--text-dim)', fontWeight: 600 }}>
                                {covDelta != null ? (covDelta > 0 ? '+' : '') + covDelta.toFixed(4) : '—'}
                              </td>
                            </tr>
                          )
                        })()}
                      </tbody>
                    </table>
                  </div>
                )
              })()}

              {/* Recommended Changes */}
              {result.optimization.weights?.[0]?.action && (() => {
                const sorted = [...result.optimization.weights].sort((a, b) => {
                  const pri = { SELL: 0, BUY: 1, HOLD: 2 }
                  if (pri[a.action] !== pri[b.action]) return pri[a.action] - pri[b.action]
                  return Math.abs(b.dollar_change) - Math.abs(a.dollar_change)
                })
                const rs = result.optimization.rebalance_summary || {}
                const actionColor = { BUY: '#4dff91', SELL: '#ff6b6b', HOLD: '#8899aa' }
                const actionBg = { BUY: 'rgba(77,255,145,0.12)', SELL: 'rgba(255,107,107,0.12)', HOLD: 'rgba(136,153,170,0.08)' }
                // Quick action summary
                const comp = result.optimization.comparison
                const incomeChange = comp ? (comp.after.annual_income - comp.before.annual_income) : null
                const summaryParts = []
                if (rs.num_sells > 0) summaryParts.push(`Sell ${rs.num_sells} holding${rs.num_sells > 1 ? 's' : ''}`)
                if (rs.num_buys > 0) summaryParts.push(`buy ${rs.num_buys} holding${rs.num_buys > 1 ? 's' : ''}`)
                const summaryText = summaryParts.join(', ')
                const incomeSuffix = incomeChange != null ? ` \u2014 net income ${formatMoneyDelta(incomeChange, { digits: 0 })}/yr` : ''

                // CSV export
                const exportCsv = () => {
                  const modeLabel = mode === 'optimize_returns' ? 'Optimize Returns' : mode === 'optimize_income' ? 'Optimize Income' : `Balanced (${balance}%)`
                  const header = `# ${modeLabel} - ${new Date().toLocaleDateString()}\n`
                  const cols = 'Action,Ticker,USD Change,~Shares,USD Price,NAV Chg %,Current %,Target %\n'
                  const rows = sorted.map(w =>
                    `${w.action},${w.ticker},${w.dollar_change},${w.shares_change},${w.current_price?.toFixed(2) ?? ''},${w.nav_change_pct?.toFixed(1) ?? ''},${w.current_pct.toFixed(1)},${w.optimal_pct.toFixed(1)}`
                  ).join('\n')
                  const blob = new Blob([header + cols + rows], { type: 'text/csv' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = `optimization-${mode}-${new Date().toISOString().slice(0,10)}.csv`
                  a.click(); URL.revokeObjectURL(url)
                }

                return (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-strong)', fontWeight: 600 }}>Recommended Changes</span>
                      <button onClick={exportCsv} style={{
                        background: 'none', border: '1px solid var(--p-3a5a8c)', borderRadius: 4, color: 'var(--accent-bright)',
                        fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer',
                      }}>Export CSV</button>
                      {result.optimization.comparison && (
                        <button onClick={async () => {
                          const label = await dialog.prompt('Snapshot label:', `${mode === 'optimize_balanced' ? `Balanced ${balance}%` : mode === 'optimize_income' ? 'Income' : 'Returns'}`)
                          if (label) setSnapshots(prev => [...prev.slice(-2), { label, mode, balance, optimization: result.optimization, portfolio_metrics: result.portfolio_metrics }])
                        }} style={{
                          background: 'none', border: '1px solid var(--p-3a5a3c)', borderRadius: 4, color: 'var(--pos-muted)',
                          fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer',
                        }}>Save Snapshot</button>
                      )}
                    </div>
                    {summaryText && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontStyle: 'italic' }}>
                        {summaryText}
                        <span style={{ color: incomeChange >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{incomeSuffix}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem', fontSize: '0.78rem' }}>
                      {rs.num_sells > 0 && <span style={{ color: 'var(--neg)' }}>{rs.num_sells} Sell{rs.num_sells > 1 ? 's' : ''} totaling {formatMoneyWhole(rs.total_sell)}</span>}
                      {rs.num_buys > 0 && <span style={{ color: 'var(--pos)' }}>{rs.num_buys} Buy{rs.num_buys > 1 ? 's' : ''} totaling {formatMoneyWhole(rs.total_buy)}</span>}
                      {rs.num_holds > 0 && <span style={{ color: 'var(--text-dim)' }}>{rs.num_holds} Hold{rs.num_holds > 1 ? 's' : ''}</span>}
                    </div>
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Action</th>
                          <th style={thStyle}>Ticker</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Change ({getCurrencyLabel()})</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>~Shares</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>NAV Chg</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Current %</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Target %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map(w => (
                          <tr key={w.ticker} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              <span style={{
                                display: 'inline-block', padding: '1px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                                color: actionColor[w.action], background: actionBg[w.action],
                              }}>{w.action}</span>
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: 'var(--accent-bright)', fontWeight: 600 }}>{w.ticker}</td>
                            <td style={{
                              padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 600,
                              color: w.action === 'BUY' ? 'var(--pos)' : w.action === 'SELL' ? 'var(--neg)' : 'var(--text-dim)',
                            }}>
                              {formatMoneyDelta(w.dollar_change, { digits: 0 })}
                            </td>
                            <td style={{
                              padding: '0.35rem 0.5rem', textAlign: 'right',
                              color: w.action === 'BUY' ? 'var(--pos)' : w.action === 'SELL' ? 'var(--neg)' : 'var(--text-dim)',
                            }}>
                              {w.shares_change > 0 ? '+' : ''}{w.shares_change ?? '—'}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>
                              {formatMoney(w.current_price)}
                            </td>
                            <td style={{
                              padding: '0.35rem 0.5rem', textAlign: 'right', fontSize: '0.75rem',
                              color: (w.nav_change_pct ?? 0) >= 0 ? 'var(--pos)' : 'var(--neg)',
                            }}>
                              {w.nav_change_pct != null ? (w.nav_change_pct >= 0 ? '+' : '') + w.nav_change_pct.toFixed(1) + '%' : '—'}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{w.current_pct.toFixed(1)}</td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{w.optimal_pct.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })()}

              {/* Scenario Comparison */}
              {snapshots.length >= 2 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-strong)', fontWeight: 600 }}>Compare Scenarios</span>
                    <button onClick={() => setSnapshots([])} style={{
                      background: 'none', border: '1px solid var(--p-3a3a5c)', borderRadius: 4, color: 'var(--text-dim)',
                      fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer',
                    }}>Clear All</button>
                  </div>
                  <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Metric</th>
                        {snapshots.map((s, i) => <th key={i} style={{ ...thStyle, textAlign: 'right' }}>{s.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: 'Grade', get: s => { const c = s.optimization.comparison; return c ? `${c.after.grade} (${c.after.score})` : '—' } },
                        { label: 'Annual Income', get: s => { const c = s.optimization.comparison; return c ? formatMoneyWhole(c.after.annual_income) : '—' } },
                        { label: 'Sharpe', get: s => s.optimization.comparison?.after.sharpe?.toFixed(2) ?? '—' },
                        { label: 'Sortino', get: s => s.optimization.comparison?.after.sortino?.toFixed(2) ?? '—' },
                        { label: 'Omega', get: s => s.optimization.comparison?.after.omega?.toFixed(2) ?? '—' },
                        { label: 'Calmar', get: s => s.optimization.comparison?.after.calmar?.toFixed(2) ?? '—' },
                        { label: 'Ulcer Index', get: s => s.optimization.comparison?.after.ulcer_index?.toFixed(2) ?? '—' },
                        { label: 'Max Drawdown', get: s => { const v = s.optimization.comparison?.after.max_drawdown; return v != null ? (v * 100).toFixed(1) + '%' : '—' } },
                        { label: 'Buys', get: s => { const r = s.optimization.rebalance_summary; return r ? `${r.num_buys} (${formatMoneyWhole(r.total_buy)})` : '—' } },
                        { label: 'Sells', get: s => { const r = s.optimization.rebalance_summary; return r ? `${r.num_sells} (${formatMoneyWhole(r.total_sell)})` : '—' } },
                      ].map(row => (
                        <tr key={row.label} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                          <td style={{ padding: '0.3rem 0.5rem', color: 'var(--text-dim)', fontSize: '0.78rem' }}>{row.label}</td>
                          {snapshots.map((s, i) => (
                            <td key={i} style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)' }}>{row.get(s)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          )}

        </>
      )}

      {/* Chart Tabs — always visible when tickers exist */}
      {tickers.length > 0 && !loading && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
            {[
              { key: 'risk', label: 'Risk & Returns' },
              { key: 'income', label: 'Income & Allocation' },
              { key: 'backtest', label: 'Backtesting' },
              { key: 'tools', label: 'Tools' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setChartTab(t.key)}
                style={{
                  padding: '0.45rem 1.1rem', borderRadius: 4, cursor: 'pointer',
                  border: chartTab === t.key ? '1px solid var(--accent)' : '1px solid var(--p-3a3a5c)',
                  background: chartTab === t.key ? 'var(--p-1a3a5c)' : 'var(--bg)',
                  color: chartTab === t.key ? 'var(--accent)' : 'var(--text-dim)',
                  fontSize: '0.85rem', fontWeight: chartTab === t.key ? 600 : 400,
                }}
              >{t.label}</button>
            ))}
          </div>

          {chartTab === 'risk' && <RiskReturnCharts result={result} />}
          {chartTab === 'income' && <IncomeCharts tickers={tickers} result={result} period={period} />}
          {chartTab === 'backtest' && <BacktestCharts tickers={tickers} result={result} period={period} />}
          {chartTab === 'tools' && <ToolsPanel tickers={tickers} result={result} onAddTicker={t => { if (!tickers.includes(t)) setTickers(prev => [...prev, t]) }} />}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ color: color || 'var(--text-strong)', fontWeight: 600 }}>{value ?? '—'}</span>
    </div>
  )
}

const thStyle = {
  padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)',
  color: 'var(--text-dim)', fontSize: '0.78rem', textAlign: 'left',
}

