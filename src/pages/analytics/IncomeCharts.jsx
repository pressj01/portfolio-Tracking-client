import React, { useState, useEffect } from 'react'

export default function IncomeCharts({ tickers, result, period }) {
  const [calendarData, setCalendarData] = useState(null)
  const [yieldData, setYieldData] = useState(null)
  const [navData, setNavData] = useState(null)
  const [navTicker, setNavTicker] = useState('')
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [yieldLoading, setYieldLoading] = useState(false)
  const [navLoading, setNavLoading] = useState(false)

  // Fetch income calendar
  useEffect(() => {
    if (!tickers?.length) return
    setCalendarLoading(true)
    fetch('/api/analytics/income-calendar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    }).then(r => r.json()).then(setCalendarData).catch(() => {}).finally(() => setCalendarLoading(false))
  }, [tickers])

  // Fetch yield trend
  useEffect(() => {
    if (!tickers?.length) return
    setYieldLoading(true)
    fetch('/api/analytics/yield-trend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, period: '2y' }),
    }).then(r => r.json()).then(setYieldData).catch(() => {}).finally(() => setYieldLoading(false))
  }, [tickers])

  // Fetch NAV erosion chart data
  useEffect(() => {
    if (!navTicker) return
    setNavLoading(true)
    fetch('/api/analytics/nav-erosion-chart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: [navTicker], period: '2y' }),
    }).then(r => r.json()).then(setNavData).catch(() => {}).finally(() => setNavLoading(false))
  }, [navTicker])

  // Set default NAV ticker
  useEffect(() => { if (tickers?.length && !navTicker) setNavTicker(tickers[0]) }, [tickers, navTicker])

  // Render sector breakdown donut charts
  useEffect(() => {
    if (!result?.sector_breakdown || !window.Plotly) return
    const base = { paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117' }
    const colors = ['#64b5f6', '#4caf50', '#ffb74d', '#ef5350', '#ab47bc', '#26c6da', '#ff7043', '#66bb6a', '#5c6bc0', '#8d6e63', '#78909c', '#ffa726']

    const sectorEl = document.getElementById('income-sector-pie')
    if (sectorEl && result.sector_breakdown.by_sector?.length) {
      const d = result.sector_breakdown.by_sector
      window.Plotly.newPlot(sectorEl, [{
        labels: d.map(s => s.label), values: d.map(s => s.value),
        type: 'pie', hole: 0.45, marker: { colors },
        textinfo: 'label+percent', textfont: { size: 11, color: '#e0e8f5' },
        hovertemplate: '%{label}: %{value:.1f}%<extra></extra>',
      }], {
        ...base, title: { text: 'By Sector', font: { size: 14, color: '#e0e8f5' } },
        height: 380, margin: { t: 50, b: 20, l: 20, r: 20 },
        showlegend: true, legend: { font: { color: '#8899aa', size: 10 }, orientation: 'h', y: -0.05 },
      }, { responsive: true })
    }

    const typeEl = document.getElementById('income-type-pie')
    if (typeEl && result.sector_breakdown.by_type?.length) {
      const d = result.sector_breakdown.by_type
      window.Plotly.newPlot(typeEl, [{
        labels: d.map(s => s.label), values: d.map(s => s.value),
        type: 'pie', hole: 0.45, marker: { colors: colors.slice(3) },
        textinfo: 'label+percent', textfont: { size: 11, color: '#e0e8f5' },
        hovertemplate: '%{label}: %{value:.1f}%<extra></extra>',
      }], {
        ...base, title: { text: 'By Asset Type', font: { size: 14, color: '#e0e8f5' } },
        height: 380, margin: { t: 50, b: 20, l: 20, r: 20 },
        showlegend: true, legend: { font: { color: '#8899aa', size: 10 }, orientation: 'h', y: -0.05 },
      }, { responsive: true })
    }

    return () => {
      if (sectorEl) window.Plotly.purge(sectorEl)
      if (typeEl) window.Plotly.purge(typeEl)
    }
  }, [result?.sector_breakdown])

  // Render income calendar stacked bar
  useEffect(() => {
    if (!calendarData || !window.Plotly) return
    const el = document.getElementById('income-calendar-chart')
    if (!el) return
    const colors = ['#64b5f6', '#4caf50', '#ffb74d', '#ef5350', '#ab47bc', '#26c6da', '#ff7043', '#66bb6a', '#5c6bc0', '#8d6e63', '#78909c', '#ffa726',
      '#29b6f6', '#9ccc65', '#ffd54f', '#e57373', '#ce93d8', '#4dd0e1', '#ff8a65', '#81c784']
    const traces = (calendarData.tickers || []).map((t, i) => ({
      x: calendarData.months, y: t.amounts, name: t.ticker, type: 'bar',
      marker: { color: colors[i % colors.length] },
      hovertemplate: `${t.ticker}: $%{y:,.0f}<extra></extra>`,
    }))
    window.Plotly.newPlot(el, traces, {
      paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
      barmode: 'stack',
      title: { text: 'Income Calendar — Monthly Distribution', font: { size: 14, color: '#e0e8f5' } },
      xaxis: { color: '#8899aa' }, yaxis: { title: { text: 'Monthly Income ($)', font: { size: 12, color: '#e0e8f5' } }, gridcolor: '#1a2a3e', color: '#8899aa' },
      height: 400, margin: { l: 70, r: 30, t: 50, b: 40 },
      showlegend: true, legend: { font: { color: '#8899aa', size: 10 }, orientation: 'h', y: -0.15 },
    }, { responsive: true })
    return () => window.Plotly.purge(el)
  }, [calendarData])

  // Render yield trend
  useEffect(() => {
    if (!yieldData?.series?.length || !window.Plotly) return
    const el = document.getElementById('income-yield-trend')
    if (!el) return
    const colors = ['#64b5f6', '#4caf50', '#ffb74d', '#ef5350', '#ab47bc', '#26c6da', '#ff7043', '#66bb6a']
    const traces = yieldData.series.map((s, i) => ({
      x: s.dates, y: s.values, name: s.ticker, type: 'scatter', mode: 'lines',
      line: { color: colors[i % colors.length], width: 2 },
      hovertemplate: `${s.ticker}: %{y:.2f}%<extra></extra>`,
    }))
    window.Plotly.newPlot(el, traces, {
      paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
      title: { text: 'Trailing 12-Month Yield Trend', font: { size: 14, color: '#e0e8f5' } },
      xaxis: { gridcolor: '#1a2a3e', color: '#8899aa' },
      yaxis: { title: { text: 'TTM Yield (%)', font: { size: 12, color: '#e0e8f5' } }, gridcolor: '#1a2a3e', color: '#8899aa' },
      height: 400, margin: { l: 70, r: 30, t: 50, b: 40 },
      showlegend: true, legend: { font: { color: '#8899aa' } },
    }, { responsive: true })
    return () => window.Plotly.purge(el)
  }, [yieldData])

  // Render NAV erosion chart
  useEffect(() => {
    if (!navData?.series?.length || !window.Plotly) return
    const el = document.getElementById('income-nav-erosion')
    if (!el) return
    const s = navData.series[0]
    const traces = [
      { x: s.dates, y: s.prices, name: 'Price', type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 2 }, yaxis: 'y' },
      { x: s.dates, y: s.cum_dividends, name: 'Cumulative Distributions', type: 'scatter', mode: 'lines',
        fill: 'tozeroy', fillcolor: 'rgba(76,175,80,0.15)', line: { color: '#4caf50', width: 2 }, yaxis: 'y2' },
    ]
    if (s.total_return_line) {
      traces.push({ x: s.dates, y: s.total_return_line, name: 'Total Return', type: 'scatter', mode: 'lines',
        line: { color: '#64b5f6', width: 2, dash: 'dot' }, yaxis: 'y' })
    }
    window.Plotly.newPlot(el, traces, {
      paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
      title: { text: `NAV Erosion — ${navTicker}`, font: { size: 14, color: '#e0e8f5' } },
      xaxis: { gridcolor: '#1a2a3e', color: '#8899aa' },
      yaxis: { title: { text: 'Price ($)', font: { size: 12, color: '#ef5350' } }, gridcolor: '#1a2a3e', color: '#ef5350', side: 'left' },
      yaxis2: { title: { text: 'Cumul. Distributions ($)', font: { size: 12, color: '#4caf50' } }, color: '#4caf50', overlaying: 'y', side: 'right' },
      height: 420, margin: { l: 70, r: 70, t: 50, b: 40 },
      showlegend: true, legend: { font: { color: '#8899aa' } },
    }, { responsive: true })
    return () => window.Plotly.purge(el)
  }, [navData, navTicker])

  return (
    <>
      {/* Sector Breakdown */}
      {result?.sector_breakdown && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div className="card" style={{ padding: '0.75rem 1rem' }}><div id="income-sector-pie" /></div>
          <div className="card" style={{ padding: '0.75rem 1rem' }}><div id="income-type-pie" /></div>
        </div>
      )}
      {!result?.sector_breakdown && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem', color: '#8899aa', fontSize: '0.85rem' }}>
          Sector breakdown data not available. Run analysis to load.
        </div>
      )}

      {/* Income Calendar */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        {calendarLoading ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#8899aa' }}><span className="spinner" /> Loading income calendar...</div>
        ) : calendarData?.tickers?.length ? (
          <div id="income-calendar-chart" />
        ) : (
          <div style={{ color: '#8899aa', fontSize: '0.85rem', padding: '0.5rem' }}>No income calendar data available for selected tickers.</div>
        )}
      </div>

      {/* Yield Trend */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        {yieldLoading ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#8899aa' }}><span className="spinner" /> Loading yield trends...</div>
        ) : yieldData?.series?.length ? (
          <div id="income-yield-trend" />
        ) : (
          <div style={{ color: '#8899aa', fontSize: '0.85rem', padding: '0.5rem' }}>No yield trend data available.</div>
        )}
      </div>

      {/* NAV Erosion Visualizer */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span style={{ color: '#e0e8f5', fontWeight: 600, fontSize: '0.85rem' }}>NAV Erosion Visualizer</span>
          <select
            value={navTicker} onChange={e => setNavTicker(e.target.value)}
            style={{ background: '#1a1a2e', border: '1px solid #3a3a5c', borderRadius: 4, color: '#e0e0e0', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
          >
            {(tickers || []).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {navLoading ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#8899aa' }}><span className="spinner" /> Loading NAV data...</div>
        ) : navData?.series?.length ? (
          <div id="income-nav-erosion" />
        ) : (
          <div style={{ color: '#8899aa', fontSize: '0.85rem', padding: '0.5rem' }}>Select a ticker to view NAV erosion analysis.</div>
        )}
      </div>
    </>
  )
}
