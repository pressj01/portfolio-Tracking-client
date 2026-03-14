import React, { useState, useEffect, useCallback } from 'react'

const PERIODS = [
  { label: '3mo', value: '3mo' },
  { label: '6mo', value: '6mo' },
  { label: '1yr', value: '1y' },
  { label: '2yr', value: '2y' },
  { label: '5yr', value: '5y' },
  { label: 'Max', value: 'max' },
]

function corrColor(v) {
  if (v == null) return '#1a1a2e'
  // -1 (red) → 0 (yellow/neutral) → +1 (green)
  const clamped = Math.max(-1, Math.min(1, v))
  if (clamped >= 0) {
    // 0→1: dark → green
    const t = clamped
    const r = Math.round(26 * (1 - t) + 46 * t)
    const g = Math.round(26 * (1 - t) + 125 * t)
    const b = Math.round(46 * (1 - t) + 50 * t)
    return `rgb(${r},${g},${b})`
  } else {
    // -1→0: red → dark
    const t = 1 + clamped  // 0 at -1, 1 at 0
    const r = Math.round(198 * (1 - t) + 26 * t)
    const g = Math.round(40 * (1 - t) + 26 * t)
    const b = Math.round(40 * (1 - t) + 46 * t)
    return `rgb(${r},${g},${b})`
  }
}

function corrTextColor(v) {
  if (v == null) return '#555'
  const abs = Math.abs(v)
  return abs > 0.5 ? '#fff' : '#ccc'
}

export default function Correlation() {
  const [tickers, setTickers] = useState([])
  const [input, setInput] = useState('')
  const [period, setPeriod] = useState('1y')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const addTicker = useCallback(() => {
    const t = input.trim().toUpperCase()
    if (t && !tickers.includes(t)) {
      setTickers(prev => [...prev, t])
    }
    setInput('')
  }, [input, tickers])

  const removeTicker = (t) => setTickers(prev => prev.filter(x => x !== t))
  const clearAll = () => { setTickers([]); setResult(null); setError(null) }

  const runCorrelation = () => {
    if (tickers.length < 2) { setError('Enter at least 2 tickers.'); return }
    setError(null); setResult(null); setLoading(true)
    fetch('/api/correlation/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, period }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setResult(d)
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }

  // Render Plotly heatmap when result changes
  useEffect(() => {
    if (!result || !window.Plotly) return
    const el = document.getElementById('corr-heatmap')
    if (!el) return

    const { tickers: t, matrix } = result
    // Reverse for Plotly (bottom-to-top y-axis)
    const reversedTickers = [...t].reverse()
    const reversedMatrix = [...matrix].reverse()

    const textVals = reversedMatrix.map(row =>
      row.map(v => v != null ? v.toFixed(2) : '')
    )

    window.Plotly.newPlot(el, [{
      z: reversedMatrix,
      x: t,
      y: reversedTickers,
      type: 'heatmap',
      colorscale: [
        [0, '#c62828'],
        [0.25, '#e05555'],
        [0.5, '#f9a825'],
        [0.75, '#4caf50'],
        [1, '#2e7d32'],
      ],
      zmin: -1, zmax: 1,
      text: textVals,
      texttemplate: '%{text}',
      hovertemplate: '%{x} vs %{y}: %{z:.3f}<extra></extra>',
      colorbar: {
        title: 'Correlation',
        tickvals: [-1, -0.5, 0, 0.5, 1],
        ticktext: ['-1.0', '-0.5', '0.0', '0.5', '1.0'],
      },
    }], {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117',
      plot_bgcolor: '#0e1117',
      title: {
        text: `Correlation Matrix — ${PERIODS.find(p => p.value === result.period)?.label || result.period} (${result.data_points} trading days)`,
        font: { size: 15, color: '#e0e8f5' },
      },
      xaxis: { side: 'bottom', tickangle: -45 },
      yaxis: {},
      height: Math.max(450, t.length * 40 + 120),
      margin: { l: 80, r: 80, t: 60, b: 80 },
    }, { responsive: true })

    return () => { if (el) window.Plotly.purge(el) }
  }, [result])

  return (
    <div className="page">
      <h1 style={{ marginBottom: '0.3rem' }}>Correlation Matrix</h1>
      <p style={{ color: '#8899aa', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Analyze how tickers move relative to each other. Values near 1.0 (green) move together,
        near -1.0 (red) move inversely, near 0 are uncorrelated.
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
            maxLength={10} placeholder="e.g. SPY"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addTicker() }}
          />
          <button className="btn btn-primary" onClick={addTicker} style={{ padding: '0.35rem 0.8rem' }}>Add</button>

          <span style={{ color: '#556677', margin: '0 0.3rem' }}>|</span>

          <span style={{ color: '#8899aa', fontSize: '0.82rem', marginRight: '0.3rem' }}>Period:</span>
          {PERIODS.map(p => (
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

          <span style={{ color: '#556677', margin: '0 0.3rem' }}>|</span>

          <button className="btn btn-success" onClick={runCorrelation} disabled={loading || tickers.length < 2}
            style={{ padding: '0.35rem 1rem', fontWeight: 600 }}>
            {loading ? 'Loading...' : 'Run'}
          </button>
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

      {/* Error */}
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" />
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Missing tickers warning */}
          {result.missing?.length > 0 && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              No data found for: {result.missing.join(', ')}
            </div>
          )}

          {/* Correlation Table */}
          <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', overflowX: 'auto' }}>
            <h3 style={{ color: '#90caf9', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
              Correlation Table — {PERIODS.find(p => p.value === result.period)?.label || result.period}
              <span style={{ color: '#556677', fontWeight: 400, fontSize: '0.82rem', marginLeft: '0.5rem' }}>
                ({result.data_points} trading days)
              </span>
            </h3>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem', width: 'auto' }}>
              <thead>
                <tr>
                  <th style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid #2a3a4e', color: '#8899aa' }}></th>
                  {result.tickers.map(t => (
                    <th key={t} style={{
                      padding: '0.4rem 0.6rem', borderBottom: '1px solid #2a3a4e',
                      color: '#7ecfff', fontWeight: 600, textAlign: 'center', minWidth: 55,
                    }}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.tickers.map((rowT, i) => (
                  <tr key={rowT}>
                    <td style={{
                      padding: '0.4rem 0.6rem', fontWeight: 600, color: '#7ecfff',
                      borderRight: '1px solid #2a3a4e', whiteSpace: 'nowrap',
                    }}>{rowT}</td>
                    {result.matrix[i].map((v, j) => {
                      const isDiag = i === j
                      return (
                        <td key={j} style={{
                          padding: '0.4rem 0.6rem', textAlign: 'center',
                          background: isDiag ? '#2a3a4e' : corrColor(v),
                          color: isDiag ? '#aaa' : corrTextColor(v),
                          fontWeight: isDiag ? 400 : (Math.abs(v || 0) > 0.7 ? 600 : 400),
                          border: '1px solid #1a1a2e',
                        }}>
                          {v != null ? v.toFixed(2) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Plotly Heatmap */}
          <div className="card" style={{ padding: '0.75rem 1rem' }}>
            <div id="corr-heatmap" />
          </div>
        </>
      )}
    </div>
  )
}
