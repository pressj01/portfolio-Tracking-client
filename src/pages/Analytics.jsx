import React, { useState, useEffect, useCallback } from 'react'

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

export default function Analytics() {
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

  // Load portfolio tickers on mount
  useEffect(() => {
    fetch('/api/holdings')
      .then(r => r.json())
      .then(d => {
        const t = (d.holdings || d || []).map(h => h.ticker).filter(Boolean)
        setPortfolioTickers([...new Set(t)])
      })
      .catch(() => {})
  }, [])

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
    fetch('/api/analytics/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setResult(d)
        setMode(runMode || mode)
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

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(false) }
  }

  // Plotly charts
  useEffect(() => {
    if (!result || !window.Plotly) return

    // Risk vs Return scatter
    const scatterEl = document.getElementById('analytics-scatter')
    if (scatterEl && result.metrics?.length > 0) {
      const m = result.metrics
      window.Plotly.newPlot(scatterEl, [{
        x: m.map(d => d.annual_vol),
        y: m.map(d => d.annual_ret),
        text: m.map(d => d.ticker),
        mode: 'markers',
        marker: {
          size: m.map(d => Math.max(8, (d.weight || 1) * 1.5)),
          color: m.map(d => d.annual_ret >= 0 ? '#4caf50' : '#ef5350'),
          line: { color: '#1a1a2e', width: 1 },
        },
        hovertemplate: '%{text}<br>Vol: %{x:.1f}%<br>Return: %{y:.1f}%<extra></extra>',
        type: 'scatter',
      }], {
        template: 'plotly_dark',
        paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
        title: { text: 'Risk vs Return', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { title: { text: 'Risk — Annualized Volatility (%)', font: { size: 14, color: '#e0e8f5' }, standoff: 15 }, gridcolor: '#1a2a3e' },
        yaxis: { title: { text: 'Return — Annualized Return (%)', font: { size: 14, color: '#e0e8f5' }, standoff: 15 }, gridcolor: '#1a2a3e' },
        height: 420, margin: { l: 80, r: 30, t: 50, b: 60 },
      }, { responsive: true })
    }

    // Correlation heatmap
    const heatEl = document.getElementById('analytics-heatmap')
    if (heatEl && result.correlation) {
      const { labels, matrix } = result.correlation
      const reversed = [...labels].reverse()
      const rMatrix = [...matrix].reverse()
      window.Plotly.newPlot(heatEl, [{
        z: rMatrix, x: labels, y: reversed,
        type: 'heatmap',
        colorscale: [[0, '#c62828'], [0.25, '#e05555'], [0.5, '#f9a825'], [0.75, '#4caf50'], [1, '#2e7d32']],
        zmin: -1, zmax: 1,
        text: rMatrix.map(row => row.map(v => v != null ? v.toFixed(2) : '')),
        texttemplate: '%{text}',
        hovertemplate: '%{x} vs %{y}: %{z:.3f}<extra></extra>',
        colorbar: { title: 'Corr', tickvals: [-1, -0.5, 0, 0.5, 1] },
      }], {
        template: 'plotly_dark',
        paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
        title: { text: 'Correlation Heatmap', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { side: 'bottom', tickangle: -45 },
        height: Math.max(350, labels.length * 40 + 100),
        margin: { l: 80, r: 60, t: 50, b: 80 },
      }, { responsive: true })
    }

    // Drawdown chart
    const ddEl = document.getElementById('analytics-drawdown')
    if (ddEl && result.drawdown_series) {
      const { dates, values } = result.drawdown_series
      window.Plotly.newPlot(ddEl, [{
        x: dates, y: values,
        type: 'scatter', mode: 'lines',
        fill: 'tozeroy',
        fillcolor: 'rgba(239,83,80,0.2)',
        line: { color: '#ef5350', width: 1.5 },
        hovertemplate: '%{x}<br>Drawdown: %{y:.1f}%<extra></extra>',
      }], {
        template: 'plotly_dark',
        paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
        title: { text: 'Portfolio Drawdown', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { gridcolor: '#1a2a3e' },
        xaxis: { title: { text: 'Date', font: { size: 14, color: '#e0e8f5' }, standoff: 15 }, gridcolor: '#1a2a3e' },
        yaxis: { title: { text: 'Drawdown (%)', font: { size: 14, color: '#e0e8f5' }, standoff: 15 }, gridcolor: '#1a2a3e' },
        height: 320, margin: { l: 80, r: 30, t: 50, b: 60 },
      }, { responsive: true })
    }

    // Optimization charts
    const frontEl = document.getElementById('analytics-frontier')
    if (frontEl && result.optimization?.frontier) {
      const { frontier, optimal_point, current_point } = result.optimization
      const traces = [{
        x: frontier.map(p => p.vol), y: frontier.map(p => p.ret),
        type: 'scatter', mode: 'lines', name: 'Efficient Frontier',
        line: { color: '#64b5f6', width: 2 },
      }]
      if (optimal_point) traces.push({
        x: [optimal_point.vol], y: [optimal_point.ret],
        type: 'scatter', mode: 'markers+text', name: 'Optimal',
        text: ['Optimal'], textposition: 'top right',
        textfont: { color: '#4dff91' },
        marker: { size: 14, color: '#4dff91', symbol: 'star' },
      })
      if (current_point) traces.push({
        x: [current_point.vol], y: [current_point.ret],
        type: 'scatter', mode: 'markers+text', name: 'Current',
        text: ['Current'], textposition: 'bottom left',
        textfont: { color: '#ffb74d' },
        marker: { size: 12, color: '#ffb74d', symbol: 'diamond' },
      })
      window.Plotly.newPlot(frontEl, traces, {
        template: 'plotly_dark',
        paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
        title: { text: 'Efficient Frontier', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { title: { text: 'Risk — Volatility (%)', font: { size: 14, color: '#e0e8f5' }, standoff: 15 }, gridcolor: '#1a2a3e' },
        yaxis: { title: { text: 'Return — Expected Return (%)', font: { size: 14, color: '#e0e8f5' }, standoff: 15 }, gridcolor: '#1a2a3e' },
        height: 420, margin: { l: 80, r: 30, t: 50, b: 60 },
        showlegend: true, legend: { font: { color: '#8899aa' } },
      }, { responsive: true })
    }

    const incScatterEl = document.getElementById('analytics-income-scatter')
    if (incScatterEl && result.optimization?.scatter) {
      const sc = result.optimization.scatter
      window.Plotly.newPlot(incScatterEl, [{
        x: sc.map(d => d.vol_pct), y: sc.map(d => d.yield_pct),
        text: sc.map(d => d.ticker), mode: 'markers',
        marker: {
          size: sc.map(d => d.sharpe != null ? Math.max(8, d.sharpe * 8) : 10),
          color: sc.map(d => d.is_optimal ? '#4caf50' : '#555'),
          line: { color: '#1a1a2e', width: 1 },
        },
        hovertemplate: '%{text}<br>Vol: %{x:.1f}%<br>Yield: %{y:.2f}%<extra></extra>',
        type: 'scatter',
      }], {
        template: 'plotly_dark',
        paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
        title: { text: 'Yield vs Risk', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { title: { text: 'Risk — Volatility (%)', font: { size: 14, color: '#e0e8f5' }, standoff: 15 }, gridcolor: '#1a2a3e' },
        yaxis: { title: { text: 'Yield — Dividend Yield (%)', font: { size: 14, color: '#e0e8f5' }, standoff: 15 }, gridcolor: '#1a2a3e' },
        height: 420, margin: { l: 80, r: 30, t: 50, b: 60 },
      }, { responsive: true })
    }

    return () => {
      [scatterEl, heatEl, ddEl, frontEl, incScatterEl].forEach(el => {
        if (el) window.Plotly.purge(el)
      })
    }
  }, [result])

  const pm = result?.portfolio_metrics || {}
  const grade = pm.grade || {}

  return (
    <div className="page">
      <h1 style={{ marginBottom: '0.3rem' }}>Portfolio Analytics</h1>
      <p style={{ color: '#8899aa', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Risk-adjusted metrics, portfolio grading, correlation analysis, and optimization.
      </p>

      {/* Controls */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <input
            style={{
              width: 100, textTransform: 'uppercase', padding: '0.35rem 0.5rem',
              background: '#1a1a2e', border: '1px solid #3a3a5c', borderRadius: 4,
              color: '#e0e0e0', fontSize: '0.9rem',
            }}
            maxLength={10} placeholder="Ticker"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addTicker() }}
          />
          <button className="btn btn-primary" onClick={addTicker} style={{ padding: '0.35rem 0.8rem' }}>Add</button>
          <button className="btn" onClick={loadPortfolio} style={{ padding: '0.35rem 0.8rem', color: '#90caf9' }}>
            Load Portfolio ({portfolioTickers.length})
          </button>

          <span style={{ color: '#556677', margin: '0 0.2rem' }}>|</span>

          <span style={{ color: '#8899aa', fontSize: '0.82rem' }}>Bench:</span>
          <input
            style={{
              width: 55, textTransform: 'uppercase', padding: '0.35rem 0.4rem',
              background: '#1a1a2e', border: '1px solid #3a3a5c', borderRadius: 4,
              color: '#e0e0e0', fontSize: '0.82rem', textAlign: 'center',
            }}
            maxLength={6} value={benchmark}
            onChange={e => setBenchmark(e.target.value.toUpperCase())}
          />

          <span style={{ color: '#556677', margin: '0 0.2rem' }}>|</span>

          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)} style={{
              padding: '0.25rem 0.5rem', borderRadius: 4, cursor: 'pointer',
              border: period === p.value ? '1px solid #64b5f6' : '1px solid #3a3a5c',
              background: period === p.value ? '#1a3a5c' : '#1a1a2e',
              color: period === p.value ? '#64b5f6' : '#8899aa',
              fontSize: '0.78rem', fontWeight: period === p.value ? 600 : 400,
            }}>{p.label}</button>
          ))}
        </div>

        {/* Suggested ETFs based on portfolio type */}
        {result?.suggested_growth && result.suggested_growth.filter(t => !tickers.includes(t)).length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span style={{ color: '#64b5f6', fontSize: '0.78rem', fontWeight: 600 }}>Suggested Growth ETFs:</span>
            {result.suggested_growth.filter(t => !tickers.includes(t)).map(t => (
              <button key={t} onClick={() => { if (!tickers.includes(t)) setTickers(prev => [...prev, t]) }}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: '#1a2a3e', border: '1px solid #3a5a8c',
                         borderRadius: 12, color: '#64b5f6', cursor: 'pointer' }}>{t}</button>
            ))}
            <button onClick={() => { const add = result.suggested_growth.filter(t => !tickers.includes(t)); setTickers(prev => [...new Set([...prev, ...add])]) }}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', background: '#1a3a5c', border: '1px solid #3a5a8c',
                       borderRadius: 12, color: '#90caf9', cursor: 'pointer', fontWeight: 600 }}>Add All</button>
          </div>
        )}
        {result?.suggested_income && result.suggested_income.filter(t => !tickers.includes(t)).length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span style={{ color: '#66bb6a', fontSize: '0.78rem', fontWeight: 600 }}>Suggested Income ETFs:</span>
            {result.suggested_income.filter(t => !tickers.includes(t)).map(t => (
              <button key={t} onClick={() => { if (!tickers.includes(t)) setTickers(prev => [...prev, t]) }}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: '#1a2e1e', border: '1px solid #2a5a3c',
                         borderRadius: 12, color: '#66bb6a', cursor: 'pointer' }}>{t}</button>
            ))}
            <button onClick={() => { const add = result.suggested_income.filter(t => !tickers.includes(t)); setTickers(prev => [...new Set([...prev, ...add])]) }}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', background: '#1a3a2e', border: '1px solid #2a5a3c',
                       borderRadius: 12, color: '#81c784', cursor: 'pointer', fontWeight: 600 }}>Add All</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <button className="btn btn-success" onClick={() => runAnalysis('metrics')} disabled={loading || tickers.length < 1}
            style={{ padding: '0.35rem 1rem', fontWeight: 600 }}>
            {loading ? 'Loading...' : 'Analyze'}
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_returns')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: '#64b5f6', background: '#1a2a3e', border: '1px solid #3a5a8c' }}>
            Optimize Returns
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_income')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: '#66bb6a', background: '#1a2e1e', border: '1px solid #2a5a3c' }}>
            Optimize Income
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_balanced')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: '#ffb74d', background: '#2e2517', border: '1px solid #5a4a2c' }}>
            Balanced
          </button>
          {mode === 'optimize_balanced' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ color: '#66bb6a', fontSize: '0.72rem' }}>Safety</span>
              <input type="range" min="0" max="100" value={balance}
                onChange={e => setBalance(Number(e.target.value))}
                style={{ width: 90 }} />
              <span style={{ color: '#ffb74d', fontSize: '0.72rem' }}>Income</span>
              <span style={{ color: '#8899aa', fontSize: '0.72rem', marginLeft: 4 }}>({balance}%)</span>
            </span>
          )}
          <button className="btn" onClick={clearAll} style={{ padding: '0.35rem 0.6rem', color: '#8899aa' }}>Clear</button>
        </div>

        {/* Ticker chips */}
        {tickers.length > 0 && (
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {tickers.map(t => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '0.2rem 0.5rem', background: '#1a2a3e', border: '1px solid #2a4a6e',
                borderRadius: 4, fontSize: '0.82rem', color: '#7ecfff', fontWeight: 600,
              }}>
                {t}
                <button onClick={() => removeTicker(t)} style={{
                  background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.9rem', padding: '0 2px', lineHeight: 1,
                }}>&times;</button>
              </span>
            ))}
            <span style={{ color: '#556677', fontSize: '0.78rem', alignSelf: 'center' }}>
              {tickers.length} ticker{tickers.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" />
          <div style={{ color: '#8899aa', marginTop: '0.5rem', fontSize: '0.85rem' }}>Fetching data & calculating metrics...</div>
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
                  <div style={{ fontSize: '0.82rem', color: '#8899aa', marginBottom: '0.3rem' }}>Portfolio Grade</div>
                  <GradeBadge grade={grade.overall} large />
                  <div style={{ fontSize: '0.85rem', color: '#8899aa', marginTop: '0.3rem' }}>
                    Score: {grade.score}
                  </div>
                </div>

                {/* Grade breakdown bars */}
                <div style={{ flex: 1, minWidth: 250 }}>
                  <div style={{ fontSize: '0.82rem', color: '#8899aa', marginBottom: '0.5rem' }}>Grade Breakdown</div>
                  {(grade.breakdown || []).map((b, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span style={{ width: 130, fontSize: '0.78rem', color: '#90a4ae', textAlign: 'right' }}>
                        {b.category} ({b.weight}%)
                      </span>
                      <div style={{ flex: 1, background: '#1a1a2e', borderRadius: 4, height: 16, position: 'relative' }}>
                        <div style={{
                          width: `${Math.max(b.score, 2)}%`, height: '100%', borderRadius: 4,
                          background: b.score >= 80 ? '#4caf50' : b.score >= 60 ? '#ffb74d' : '#ef5350',
                        }} />
                        <span style={{
                          position: 'absolute', right: 4, top: 0, fontSize: '0.7rem',
                          color: '#e0e8f5', lineHeight: '16px',
                        }}>{b.grade} ({b.score})</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Quick stats */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 160 }}>
                  <div style={{ fontSize: '0.82rem', color: '#8899aa', marginBottom: '0.2rem' }}>Quick Stats</div>
                  <Stat label="Holdings" value={pm.n_holdings} />
                  <Stat label="Effective N" value={pm.effective_n?.toFixed(1)} />
                  <Stat label="Max Drawdown" value={pm.max_drawdown != null ? (pm.max_drawdown * 100).toFixed(1) + '%' : '—'} color="#ef5350" />
                  <Stat label="Top Holding" value={pm.top_weight != null ? pm.top_weight + '%' : '—'} />
                  <Stat label="Ulcer Index" value={pm.ulcer_index?.toFixed(2)} color={metricColor(pm.ulcer_index, [3, 7, 12], true)} />
                  <Stat label="Est. Annual Income" value={pm.est_annual_income != null ? '$' + pm.est_annual_income.toLocaleString() : '—'} color="#66bb6a" />
                </div>
              </div>
            </div>
          )}

          {/* Metrics Table */}
          {sortedMetrics.length > 0 && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', overflowX: 'auto' }}>
              <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                Per-Ticker Metrics
                <span style={{ color: '#556677', fontWeight: 400, fontSize: '0.82rem', marginLeft: '0.5rem' }}>
                  ({PERIODS.find(p => p.value === period)?.label || period})
                </span>
              </h3>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
                <thead>
                  <tr>
                    {[
                      { key: 'ticker', label: 'Ticker' },
                      { key: 'grade', label: 'Grade' },
                      { key: 'score', label: 'Score' },
                      { key: 'weight', label: 'Wt %' },
                      { key: 'ulcer_index', label: 'Ulcer' },
                      { key: 'sharpe', label: 'Sharpe' },
                      { key: 'sortino', label: 'Sortino' },
                      { key: 'calmar', label: 'Calmar' },
                      { key: 'omega', label: 'Omega' },
                      { key: 'max_drawdown', label: 'Max DD' },
                      { key: 'up_capture', label: 'Up Cap' },
                      { key: 'down_capture', label: 'Dn Cap' },
                      { key: 'annual_ret', label: 'Ann Ret' },
                      { key: 'annual_total_ret', label: 'Tot Ret' },
                      { key: 'annual_vol', label: 'Ann Vol' },
                    ].map(col => (
                      <th key={col.key} onClick={() => handleSort(col.key)} style={{
                        padding: '0.4rem 0.5rem', borderBottom: '1px solid #2a3a4e',
                        color: sortCol === col.key ? '#64b5f6' : '#8899aa',
                        cursor: 'pointer', whiteSpace: 'nowrap', textAlign: col.key === 'ticker' ? 'left' : 'right',
                        fontSize: '0.78rem',
                      }}>
                        {col.label} {sortCol === col.key ? (sortAsc ? '\u25B4' : '\u25BE') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Portfolio row */}
                  {pm.sharpe != null && (
                    <tr style={{ background: '#0a1628', fontWeight: 600 }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#90caf9' }}>PORTFOLIO</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}><GradeBadge grade={grade.overall} /></td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#e0e8f5' }}>{grade.score}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>100</td>
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
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#ef5350' }}>
                        {pm.max_drawdown != null ? (pm.max_drawdown * 100).toFixed(1) + '%' : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>
                        {pm.up_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.down_capture, [80, 90, 100], true) }}>
                        {pm.down_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }} colSpan={3}></td>
                    </tr>
                  )}
                  {sortedMetrics.map(m => (
                    <tr key={m.ticker} style={{ borderBottom: '1px solid #1a2a3e' }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#7ecfff', fontWeight: 600 }}>{m.ticker}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}><GradeBadge grade={m.grade} /></td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#e0e8f5' }}>{m.score}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>{m.weight?.toFixed(1)}</td>
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
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#ef5350' }}>
                        {m.max_drawdown != null ? m.max_drawdown.toFixed(1) + '%' : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>
                        {m.up_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.down_capture, [80, 90, 100], true) }}>
                        {m.down_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: m.annual_ret >= 0 ? '#4dff91' : '#ff6b6b' }}>
                        {m.annual_ret?.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: m.annual_total_ret >= 0 ? '#4dff91' : '#ff6b6b' }}>
                        {m.annual_total_ret?.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>
                        {m.annual_vol?.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Optimization results */}
          {result.optimization && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
              <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
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
                      <span style={{ color: '#8899aa' }}>{k.replace(/_/g, ' ')}: </span>
                      <span style={{ color: '#e0e8f5', fontWeight: 600 }}>
                        {typeof v === 'number' ? (k.includes('income') ? '$' + v.toLocaleString() : v.toFixed(2) + (k.includes('pct') || k.includes('yield') || k.includes('return') || k.includes('vol') || k.includes('dd') ? '%' : '')) : v}
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
                        <tr key={w.ticker} style={{ borderBottom: '1px solid #1a2a3e' }}>
                          <td style={{ padding: '0.35rem 0.5rem', color: '#7ecfff', fontWeight: 600 }}>{w.ticker}</td>
                          <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>{w.current_pct.toFixed(1)}</td>
                          <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: '#e0e8f5', fontWeight: 600 }}>{w.optimal_pct.toFixed(1)}</td>
                          {w.yield_pct != null && (
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: '#4dff91' }}>{w.yield_pct.toFixed(2)}</td>
                          )}
                          <td style={{
                            padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 600,
                            color: change > 0.5 ? '#4dff91' : change < -0.5 ? '#ff6b6b' : '#8899aa',
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
                    const sign = diff >= 0 ? '+$' : '-$'
                    return <span style={{ color }}>{sign}{Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                  }
                  return <span style={{ color }}>{diff > 0 ? '+' : ''}{fmt(diff)}</span>
                }
                const fmtPct = v => (v * 100).toFixed(1) + '%'
                const fmtDollar = v => '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                const fmtNum = v => v.toFixed(2)
                const metricRow = (label, bv, av, fmt, isDollar = false) => (
                  <tr key={label} style={{ borderBottom: '1px solid #1a2a3e' }}>
                    <td style={{ padding: '0.3rem 0.5rem', color: '#8899aa', fontSize: '0.78rem' }}>{label}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#e0e8f5', fontWeight: 600 }}>{bv != null ? (isDollar ? '$' + Math.abs(bv).toLocaleString(undefined, {maximumFractionDigits: 0}) : fmt(bv)) : '—'}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#e0e8f5', fontWeight: 600 }}>{av != null ? (isDollar ? '$' + Math.abs(av).toLocaleString(undefined, {maximumFractionDigits: 0}) : fmt(av)) : '—'}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{delta(bv, av, fmt, isDollar)}</td>
                  </tr>
                )
                return (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#e0e8f5', fontWeight: 600, marginBottom: '0.4rem' }}>Impact Analysis — Before vs After</div>
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
                        <tr style={{ borderBottom: '1px solid #1a2a3e' }}>
                          <td style={{ padding: '0.3rem 0.5rem', color: '#8899aa', fontSize: '0.78rem' }}>Grade</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#e0e8f5', fontWeight: 700, fontSize: '0.9rem' }}>{b.grade} ({b.score})</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 700, fontSize: '0.9rem',
                            color: a.score > b.score ? '#4dff91' : a.score < b.score ? '#ff6b6b' : '#e0e8f5' }}>{a.grade} ({a.score})</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right',
                            color: a.score > b.score ? '#4dff91' : a.score < b.score ? '#ff6b6b' : '#8899aa' }}>
                            {a.score !== b.score ? (a.score > b.score ? '+' : '') + (a.score - b.score).toFixed(1) : '—'}
                          </td>
                        </tr>
                        {metricRow('Monthly Income', b.monthly_income, a.monthly_income, fmtDollar, true)}
                        {metricRow('Annual Income', b.annual_income, a.annual_income, fmtDollar, true)}
                        {metricRow('Sharpe Ratio', b.sharpe, a.sharpe, fmtNum)}
                        {metricRow('Sortino Ratio', b.sortino, a.sortino, fmtNum)}
                        {metricRow('Omega Ratio', b.omega, a.omega, fmtNum)}
                        {metricRow('Calmar Ratio', b.calmar, a.calmar, fmtNum)}
                        {metricRow('Ulcer Index', b.ulcer_index, a.ulcer_index, fmtNum)}
                        {metricRow('Max Drawdown', b.max_drawdown, a.max_drawdown, fmtPct)}
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
                return (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.85rem', color: '#e0e8f5', fontWeight: 600, marginBottom: '0.4rem' }}>Recommended Changes</div>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem', fontSize: '0.78rem' }}>
                      {rs.num_sells > 0 && <span style={{ color: '#ff6b6b' }}>{rs.num_sells} Sell{rs.num_sells > 1 ? 's' : ''} totaling ${rs.total_sell?.toLocaleString()}</span>}
                      {rs.num_buys > 0 && <span style={{ color: '#4dff91' }}>{rs.num_buys} Buy{rs.num_buys > 1 ? 's' : ''} totaling ${rs.total_buy?.toLocaleString()}</span>}
                      {rs.num_holds > 0 && <span style={{ color: '#8899aa' }}>{rs.num_holds} Hold{rs.num_holds > 1 ? 's' : ''}</span>}
                    </div>
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Action</th>
                          <th style={thStyle}>Ticker</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>$ Change</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>~Shares</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>NAV Chg</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Current %</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Target %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map(w => (
                          <tr key={w.ticker} style={{ borderBottom: '1px solid #1a2a3e' }}>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              <span style={{
                                display: 'inline-block', padding: '1px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                                color: actionColor[w.action], background: actionBg[w.action],
                              }}>{w.action}</span>
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: '#7ecfff', fontWeight: 600 }}>{w.ticker}</td>
                            <td style={{
                              padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 600,
                              color: w.action === 'BUY' ? '#4dff91' : w.action === 'SELL' ? '#ff6b6b' : '#8899aa',
                            }}>
                              {w.dollar_change != null ? (w.dollar_change >= 0 ? '+$' : '-$') + Math.abs(w.dollar_change).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'}
                            </td>
                            <td style={{
                              padding: '0.35rem 0.5rem', textAlign: 'right',
                              color: w.action === 'BUY' ? '#4dff91' : w.action === 'SELL' ? '#ff6b6b' : '#8899aa',
                            }}>
                              {w.shares_change > 0 ? '+' : ''}{w.shares_change ?? '—'}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>
                              ${w.current_price?.toFixed(2) ?? '—'}
                            </td>
                            <td style={{
                              padding: '0.35rem 0.5rem', textAlign: 'right', fontSize: '0.75rem',
                              color: (w.nav_change_pct ?? 0) >= 0 ? '#4dff91' : '#ff6b6b',
                            }}>
                              {w.nav_change_pct != null ? (w.nav_change_pct >= 0 ? '+' : '') + w.nav_change_pct.toFixed(1) + '%' : '—'}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: '#8899aa' }}>{w.current_pct.toFixed(1)}</td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: '#e0e8f5', fontWeight: 600 }}>{w.optimal_pct.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })()}

              {/* Optimization charts */}
              <div id="analytics-frontier" />
              <div id="analytics-income-scatter" />
            </div>
          )}

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: result.correlation ? '1fr 1fr' : '1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div className="card" style={{ padding: '0.75rem 1rem' }}>
              <div id="analytics-scatter" />
            </div>
            {result.correlation && (
              <div className="card" style={{ padding: '0.75rem 1rem' }}>
                <div id="analytics-heatmap" />
              </div>
            )}
          </div>

          {result.drawdown_series && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
              <div id="analytics-drawdown" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
      <span style={{ color: '#8899aa' }}>{label}</span>
      <span style={{ color: color || '#e0e8f5', fontWeight: 600 }}>{value ?? '—'}</span>
    </div>
  )
}

const thStyle = {
  padding: '0.4rem 0.5rem', borderBottom: '1px solid #2a3a4e',
  color: '#8899aa', fontSize: '0.78rem', textAlign: 'left',
}
