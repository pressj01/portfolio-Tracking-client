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
        mode: 'markers+text',
        textposition: 'top center',
        textfont: { color: '#e0e8f5', size: 11 },
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
        xaxis: { title: 'Annualized Volatility (%)', gridcolor: '#1a2a3e' },
        yaxis: { title: 'Annualized Return (%)', gridcolor: '#1a2a3e' },
        height: 400, margin: { l: 60, r: 30, t: 50, b: 50 },
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
        yaxis: { title: 'Drawdown (%)', gridcolor: '#1a2a3e' },
        height: 300, margin: { l: 60, r: 30, t: 50, b: 40 },
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
        xaxis: { title: 'Volatility (%)', gridcolor: '#1a2a3e' },
        yaxis: { title: 'Return (%)', gridcolor: '#1a2a3e' },
        height: 400, margin: { l: 60, r: 30, t: 50, b: 50 },
        showlegend: true, legend: { font: { color: '#8899aa' } },
      }, { responsive: true })
    }

    const incScatterEl = document.getElementById('analytics-income-scatter')
    if (incScatterEl && result.optimization?.scatter) {
      const sc = result.optimization.scatter
      window.Plotly.newPlot(incScatterEl, [{
        x: sc.map(d => d.vol_pct), y: sc.map(d => d.yield_pct),
        text: sc.map(d => d.ticker), mode: 'markers+text',
        textposition: 'top center', textfont: { color: '#e0e8f5', size: 10 },
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
        xaxis: { title: 'Volatility (%)', gridcolor: '#1a2a3e' },
        yaxis: { title: 'Dividend Yield (%)', gridcolor: '#1a2a3e' },
        height: 400, margin: { l: 60, r: 30, t: 50, b: 50 },
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

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <button className="btn btn-success" onClick={() => runAnalysis('metrics')} disabled={loading || tickers.length < 1}
            style={{ padding: '0.35rem 1rem', fontWeight: 600 }}>
            {loading ? 'Loading...' : 'Analyze'}
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_returns')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: '#64b5f6', border: '1px solid #3a5a8c' }}>
            Optimize Returns
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_income')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: '#4dff91', border: '1px solid #2a5a3c' }}>
            Optimize Income
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_balanced')} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 0.8rem', color: '#ffb74d', border: '1px solid #5a4a2c' }}>
            Balanced
          </button>
          {mode === 'optimize_balanced' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ color: '#8899aa', fontSize: '0.78rem' }}>Balance:</span>
              <input type="range" min="0" max="100" value={balance}
                onChange={e => setBalance(Number(e.target.value))}
                style={{ width: 80 }} />
              <span style={{ color: '#ffb74d', fontSize: '0.78rem', width: 30 }}>{balance}%</span>
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
                  <Stat label="Est. Annual Income" value={pm.est_annual_income != null ? '$' + pm.est_annual_income.toLocaleString() : '—'} color="#4dff91" />
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
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }} colSpan={2}></td>
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
                {mode === 'optimize_returns' && ' — Max Sharpe'}
                {mode === 'optimize_income' && ' — Max Income'}
                {mode === 'optimize_balanced' && ` — Balanced (${result.optimization.summary?.balance || balance}%)`}
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
