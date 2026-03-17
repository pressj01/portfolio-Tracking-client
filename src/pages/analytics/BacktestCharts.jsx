import React, { useState, useEffect } from 'react'

export default function BacktestCharts({ tickers, result, period }) {
  const [backtestData, setBacktestData] = useState(null)
  const [rollingData, setRollingData] = useState(null)
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [rollingLoading, setRollingLoading] = useState(false)
  const [rollingWindow, setRollingWindow] = useState(126)

  // Fetch backtest
  useEffect(() => {
    if (!tickers?.length) return
    setBacktestLoading(true)
    fetch('/api/analytics/backtest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, period }),
    }).then(r => r.json()).then(setBacktestData).catch(() => {}).finally(() => setBacktestLoading(false))
  }, [tickers, period])

  // Fetch rolling metrics
  useEffect(() => {
    if (!tickers?.length) return
    setRollingLoading(true)
    fetch('/api/analytics/rolling-metrics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, period: '2y', window: rollingWindow }),
    }).then(r => r.json()).then(setRollingData).catch(() => {}).finally(() => setRollingLoading(false))
  }, [tickers, rollingWindow])

  const colors = ['#64b5f6', '#4caf50', '#ffb74d', '#ef5350', '#ab47bc', '#26c6da', '#ff7043', '#66bb6a', '#5c6bc0', '#8d6e63']
  const base = { paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117' }

  // Render backtest chart
  useEffect(() => {
    if (!backtestData?.series?.length || !window.Plotly) return
    const el = document.getElementById('backtest-growth')
    if (!el) return
    const traces = backtestData.series.map((s, i) => ({
      x: backtestData.dates, y: s.values, name: s.ticker, type: 'scatter', mode: 'lines',
      line: { color: colors[i % colors.length], width: 2 },
      hovertemplate: `${s.ticker}: $%{y:,.0f}<extra></extra>`,
    }))
    window.Plotly.newPlot(el, traces, {
      ...base,
      title: { text: 'Growth of $10,000', font: { size: 14, color: '#e0e8f5' } },
      xaxis: { gridcolor: '#1a2a3e', color: '#8899aa' },
      yaxis: { title: { text: 'Value ($)', font: { size: 12, color: '#e0e8f5' } }, gridcolor: '#1a2a3e', color: '#8899aa' },
      height: 420, margin: { l: 70, r: 30, t: 50, b: 40 },
      showlegend: true, legend: { font: { color: '#8899aa' } },
    }, { responsive: true })
    return () => window.Plotly.purge(el)
  }, [backtestData])

  // Render risk contribution bar chart
  useEffect(() => {
    if (!result?.risk_contribution?.length || !window.Plotly) return
    const el = document.getElementById('backtest-risk-contrib')
    if (!el) return
    const rc = result.risk_contribution
    const weights = result.metrics || []
    const weightMap = {}
    weights.forEach(m => { weightMap[m.ticker] = m.weight })
    const sorted = [...rc].sort((a, b) => b.pct - a.pct)

    window.Plotly.newPlot(el, [{
      y: sorted.map(r => r.ticker), x: sorted.map(r => r.pct), type: 'bar', orientation: 'h',
      marker: { color: sorted.map(r => (r.pct > (weightMap[r.ticker] || 0)) ? '#ef5350' : '#4caf50') },
      hovertemplate: '%{y}: %{x:.1f}% of risk<extra></extra>',
    }], {
      ...base,
      title: { text: 'Risk Contribution by Holding', font: { size: 14, color: '#e0e8f5' } },
      xaxis: { title: { text: '% of Portfolio Risk', font: { size: 12, color: '#e0e8f5' } }, gridcolor: '#1a2a3e', color: '#8899aa' },
      yaxis: { autorange: 'reversed', color: '#8899aa' },
      height: Math.max(300, rc.length * 30 + 100), margin: { l: 80, r: 30, t: 50, b: 50 },
    }, { responsive: true })
    return () => window.Plotly.purge(el)
  }, [result?.risk_contribution, result?.metrics])

  // Render rolling Sharpe/Sortino
  useEffect(() => {
    if (!rollingData || !window.Plotly) return

    const sharpeEl = document.getElementById('backtest-rolling-sharpe')
    if (sharpeEl && rollingData.sharpe?.length) {
      const traces = rollingData.sharpe.map((s, i) => ({
        x: rollingData.dates, y: s.values, name: s.ticker, type: 'scatter', mode: 'lines',
        line: { color: colors[i % colors.length], width: 2 },
        hovertemplate: `${s.ticker}: %{y:.2f}<extra></extra>`,
      }))
      window.Plotly.newPlot(sharpeEl, traces, {
        ...base,
        title: { text: `Rolling Sharpe Ratio (${rollingWindow}-day)`, font: { size: 14, color: '#e0e8f5' } },
        xaxis: { gridcolor: '#1a2a3e', color: '#8899aa' },
        yaxis: { title: { text: 'Sharpe Ratio', font: { size: 12, color: '#e0e8f5' } }, gridcolor: '#1a2a3e', color: '#8899aa' },
        height: 380, margin: { l: 60, r: 30, t: 50, b: 40 },
        showlegend: true, legend: { font: { color: '#8899aa' } },
        shapes: [{ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 1, y1: 1, line: { color: '#4caf50', width: 1, dash: 'dot' } }],
      }, { responsive: true })
    }

    const sortinoEl = document.getElementById('backtest-rolling-sortino')
    if (sortinoEl && rollingData.sortino?.length) {
      const traces = rollingData.sortino.map((s, i) => ({
        x: rollingData.dates, y: s.values, name: s.ticker, type: 'scatter', mode: 'lines',
        line: { color: colors[i % colors.length], width: 2 },
        hovertemplate: `${s.ticker}: %{y:.2f}<extra></extra>`,
      }))
      window.Plotly.newPlot(sortinoEl, traces, {
        ...base,
        title: { text: `Rolling Sortino Ratio (${rollingWindow}-day)`, font: { size: 14, color: '#e0e8f5' } },
        xaxis: { gridcolor: '#1a2a3e', color: '#8899aa' },
        yaxis: { title: { text: 'Sortino Ratio', font: { size: 12, color: '#e0e8f5' } }, gridcolor: '#1a2a3e', color: '#8899aa' },
        height: 380, margin: { l: 60, r: 30, t: 50, b: 40 },
        showlegend: true, legend: { font: { color: '#8899aa' } },
        shapes: [{ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 1.5, y1: 1.5, line: { color: '#4caf50', width: 1, dash: 'dot' } }],
      }, { responsive: true })
    }

    return () => {
      if (sharpeEl) window.Plotly.purge(sharpeEl)
      if (sortinoEl) window.Plotly.purge(sortinoEl)
    }
  }, [rollingData, rollingWindow])

  return (
    <>
      {/* Growth of $10K */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        {backtestLoading ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#8899aa' }}><span className="spinner" /> Loading backtest...</div>
        ) : backtestData?.series?.length ? (
          <div id="backtest-growth" />
        ) : (
          <div style={{ color: '#8899aa', fontSize: '0.85rem', padding: '0.5rem' }}>No backtest data available.</div>
        )}
      </div>

      {/* Risk Contribution */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        {result?.risk_contribution?.length ? (
          <div id="backtest-risk-contrib" />
        ) : (
          <div style={{ color: '#8899aa', fontSize: '0.85rem', padding: '0.5rem' }}>
            Risk contribution requires 2+ tickers with portfolio weights. Run analysis with your portfolio loaded.
          </div>
        )}
      </div>

      {/* Rolling Sharpe / Sortino */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span style={{ color: '#e0e8f5', fontWeight: 600, fontSize: '0.85rem' }}>Rolling Risk Metrics</span>
          {[{ label: '3M', val: 63 }, { label: '6M', val: 126 }, { label: '12M', val: 252 }].map(w => (
            <button key={w.val} onClick={() => setRollingWindow(w.val)} style={{
              padding: '0.25rem 0.6rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem',
              border: rollingWindow === w.val ? '1px solid #64b5f6' : '1px solid #3a3a5c',
              background: rollingWindow === w.val ? '#1a3a5c' : '#1a1a2e',
              color: rollingWindow === w.val ? '#64b5f6' : '#8899aa',
            }}>{w.label}</button>
          ))}
        </div>
        {rollingLoading ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#8899aa' }}><span className="spinner" /> Loading rolling metrics...</div>
        ) : rollingData?.sharpe?.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div id="backtest-rolling-sharpe" />
            <div id="backtest-rolling-sortino" />
          </div>
        ) : (
          <div style={{ color: '#8899aa', fontSize: '0.85rem', padding: '0.5rem' }}>No rolling metrics data available.</div>
        )}
      </div>
    </>
  )
}
