import React, { useEffect, useRef } from 'react'

export default function RiskReturnCharts({ result }) {
  const rendered = useRef(false)

  useEffect(() => {
    if (!result || !window.Plotly) return
    rendered.current = true
    const Plotly = window.Plotly
    const base = { template: 'plotly_dark', paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117' }
    const axFont = { size: 14, color: '#e0e8f5' }
    const grid = '#1a2a3e'

    // Risk vs Return scatter
    const scatterEl = document.getElementById('analytics-scatter')
    if (scatterEl && result.metrics?.length > 0) {
      const m = result.metrics
      Plotly.newPlot(scatterEl, [{
        x: m.map(d => d.annual_vol), y: m.map(d => d.annual_ret),
        text: m.map(d => d.ticker), mode: 'markers',
        marker: {
          size: m.map(d => Math.max(8, (d.weight || 1) * 1.5)),
          color: m.map(d => d.annual_ret >= 0 ? '#4caf50' : '#ef5350'),
          line: { color: '#1a1a2e', width: 1 },
        },
        hovertemplate: '%{text}<br>Vol: %{x:.1f}%<br>Return: %{y:.1f}%<extra></extra>',
        type: 'scatter',
      }], {
        ...base,
        title: { text: 'Risk vs Return', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { title: { text: 'Risk — Annualized Volatility (%)', font: axFont, standoff: 15 }, gridcolor: grid },
        yaxis: { title: { text: 'Return — Annualized Return (%)', font: axFont, standoff: 15 }, gridcolor: grid },
        height: 420, margin: { l: 80, r: 30, t: 50, b: 60 },
      }, { responsive: true })
    }

    // Correlation heatmap
    const heatEl = document.getElementById('analytics-heatmap')
    if (heatEl && result.correlation) {
      const { labels, matrix } = result.correlation
      const reversed = [...labels].reverse()
      const rMatrix = [...matrix].reverse()
      Plotly.newPlot(heatEl, [{
        z: rMatrix, x: labels, y: reversed, type: 'heatmap',
        colorscale: [[0, '#c62828'], [0.25, '#e05555'], [0.5, '#f9a825'], [0.75, '#4caf50'], [1, '#2e7d32']],
        zmin: -1, zmax: 1,
        text: rMatrix.map(row => row.map(v => v != null ? v.toFixed(2) : '')),
        texttemplate: '%{text}',
        hovertemplate: '%{x} vs %{y}: %{z:.3f}<extra></extra>',
        colorbar: { title: 'Corr', tickvals: [-1, -0.5, 0, 0.5, 1] },
      }], {
        ...base,
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
      Plotly.newPlot(ddEl, [{
        x: dates, y: values, type: 'scatter', mode: 'lines',
        fill: 'tozeroy', fillcolor: 'rgba(239,83,80,0.2)',
        line: { color: '#ef5350', width: 1.5 },
        hovertemplate: '%{x}<br>Drawdown: %{y:.1f}%<extra></extra>',
      }], {
        ...base,
        title: { text: 'Portfolio Drawdown', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { title: { text: 'Date', font: axFont, standoff: 15 }, gridcolor: grid },
        yaxis: { title: { text: 'Drawdown (%)', font: axFont, standoff: 15 }, gridcolor: grid },
        height: 320, margin: { l: 80, r: 30, t: 50, b: 60 },
      }, { responsive: true })
    }

    // Efficient Frontier
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
      Plotly.newPlot(frontEl, traces, {
        ...base,
        title: { text: 'Efficient Frontier', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { title: { text: 'Risk — Volatility (%)', font: axFont, standoff: 15 }, gridcolor: grid },
        yaxis: { title: { text: 'Return — Expected Return (%)', font: axFont, standoff: 15 }, gridcolor: grid },
        height: 420, margin: { l: 80, r: 30, t: 50, b: 60 },
        showlegend: true, legend: { font: { color: '#8899aa' } },
      }, { responsive: true })
    }

    // Yield vs Risk scatter
    const incScatterEl = document.getElementById('analytics-income-scatter')
    if (incScatterEl && result.optimization?.scatter) {
      const sc = result.optimization.scatter
      Plotly.newPlot(incScatterEl, [{
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
        ...base,
        title: { text: 'Yield vs Risk', font: { size: 14, color: '#e0e8f5' } },
        xaxis: { title: { text: 'Risk — Volatility (%)', font: axFont, standoff: 15 }, gridcolor: grid },
        yaxis: { title: { text: 'Yield — Dividend Yield (%)', font: axFont, standoff: 15 }, gridcolor: grid },
        height: 420, margin: { l: 80, r: 30, t: 50, b: 60 },
      }, { responsive: true })
    }

    return () => {
      ;[scatterEl, heatEl, ddEl, frontEl, incScatterEl].forEach(el => {
        if (el) window.Plotly.purge(el)
      })
    }
  }, [result])

  if (!result) return null

  return (
    <>
      {/* Optimization charts */}
      {result.optimization && (
        <>
          <div id="analytics-frontier" />
          <div id="analytics-income-scatter" style={{ marginTop: '1rem' }} />
        </>
      )}

      {/* Main charts grid */}
      <div style={{ display: 'grid', gridTemplateColumns: result.correlation ? '1fr 1fr' : '1fr', gap: '1rem', marginTop: '1rem' }}>
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
        <div className="card" style={{ padding: '0.75rem 1rem', marginTop: '1rem' }}>
          <div id="analytics-drawdown" />
        </div>
      )}
    </>
  )
}
