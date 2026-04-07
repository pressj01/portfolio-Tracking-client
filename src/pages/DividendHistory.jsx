import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const fmt = v => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'

const VIEW_OPTIONS = [
  { value: 'yearly', label: 'Yearly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
]

const MONTHLY_RANGE = [
  { value: 12, label: '1 Year' },
  { value: 24, label: '2 Years' },
  { value: 36, label: '3 Years' },
  { value: 60, label: '5 Years' },
]

const WEEKLY_RANGE = [
  { value: 1, label: '1 Month' },
  { value: 3, label: '3 Months' },
  { value: 6, label: '6 Months' },
  { value: 12, label: '12 Months' },
]

export default function DividendHistory() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [view, setView] = useState('monthly')
  const [monthsBack, setMonthsBack] = useState(12)
  const [categories, setCategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const [showCumulative, setShowCumulative] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const catRef = useRef(null)
  const chartRef = useRef(null)

  // Close category dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reset range when view changes
  useEffect(() => {
    if (view === 'monthly') setMonthsBack(12)
    else if (view === 'weekly') setMonthsBack(6)
  }, [view])

  const fetchData = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ view, months_back: monthsBack })
    if (categories.length) params.set('category', categories.join(','))
    pf(`/api/dividend-history/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [view, monthsBack, categories, selection, pf])

  useEffect(() => { fetchData() }, [fetchData])

  // Render chart with Plotly
  useEffect(() => {
    if (!data || !window.Plotly || !chartRef.current) return
    const Plotly = window.Plotly
    const { labels, values, cumulative } = data.series

    const traces = []

    if (view === 'yearly') {
      // Bar chart for yearly
      traces.push({
        x: labels,
        y: values,
        type: 'bar',
        marker: { color: '#a855f7' },
        text: values.map(v => `$${v.toLocaleString()}`),
        textposition: 'outside',
        hovertemplate: '<b>%{x}</b><br>$%{y:,.2f}<extra></extra>',
        name: 'Annual Dividends',
      })
    } else {
      // Area chart for monthly/weekly
      traces.push({
        x: labels,
        y: values,
        type: 'scatter',
        mode: 'lines',
        fill: 'tozeroy',
        fillcolor: 'rgba(56, 189, 248, 0.15)',
        line: { color: '#38bdf8', width: 2 },
        hovertemplate: '<b>%{x}</b><br>$%{y:,.2f}<extra></extra>',
        name: view === 'monthly' ? 'Monthly Dividends' : 'Weekly Dividends',
      })

      // Moving average (3-period for monthly, not for weekly with few points)
      if (view === 'monthly' && values.length >= 6) {
        const window = 3
        const ma = values.map((_, i) => {
          if (i < window - 1) return null
          const slice = values.slice(i - window + 1, i + 1)
          return slice.reduce((a, b) => a + b, 0) / window
        })
        traces.push({
          x: labels,
          y: ma,
          type: 'scatter',
          mode: 'lines',
          line: { color: '#4dff91', width: 2, dash: 'dot' },
          hovertemplate: '<b>%{x}</b><br>3-Mo Avg: $%{y:,.2f}<extra></extra>',
          name: '3-Mo Average',
          connectgaps: true,
        })
      }
    }

    // Cumulative overlay
    if (showCumulative && cumulative.length > 0) {
      traces.push({
        x: labels,
        y: cumulative,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#f59e0b', width: 2 },
        yaxis: 'y2',
        hovertemplate: '<b>%{x}</b><br>Cumulative: $%{y:,.2f}<extra></extra>',
        name: 'Cumulative',
      })
    }

    const viewLabel = view === 'yearly' ? 'Annual' : view === 'monthly' ? 'Monthly' : 'Weekly'
    const layout = {
      title: `${viewLabel} Dividend Income`,
      xaxis: { type: 'category', categoryorder: 'array', categoryarray: labels },
      yaxis: { title: 'Amount ($)', rangemode: 'tozero' },
      margin: { t: 50, b: 60, l: 70, r: showCumulative ? 70 : 20 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: '#c5d0dc' },
      showlegend: traces.length > 1,
      legend: { orientation: 'h', y: -0.15 },
      xaxis_gridcolor: 'rgba(255,255,255,0.05)',
      yaxis_gridcolor: 'rgba(255,255,255,0.08)',
    }

    if (showCumulative) {
      layout.yaxis2 = {
        title: 'Cumulative ($)',
        overlaying: 'y',
        side: 'right',
        rangemode: 'tozero',
        gridcolor: 'rgba(0,0,0,0)',
      }
    }

    Plotly.newPlot(chartRef.current, traces, layout, { responsive: true })

    return () => { if (chartRef.current) Plotly.purge(chartRef.current) }
  }, [data, view, showCumulative])

  const rangeOptions = view === 'monthly' ? MONTHLY_RANGE : view === 'weekly' ? WEEKLY_RANGE : null

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '1rem' }}>Dividend History</h1>

      {/* Controls row */}
      <div className="growth-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
        {/* View toggle */}
        <div className="growth-filter-group">
          <label>View</label>
          <div style={{ display: 'flex', gap: '0' }}>
            {VIEW_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`btn btn-sm${view === opt.value ? ' btn-active' : ''}`}
                style={{
                  borderRadius: opt.value === 'yearly' ? '4px 0 0 4px' : opt.value === 'weekly' ? '0 4px 4px 0' : '0',
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.85rem',
                }}
                onClick={() => setView(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time range (monthly/weekly only) */}
        {rangeOptions && (
          <div className="growth-filter-group">
            <label>Time Range</label>
            <select
              value={monthsBack}
              onChange={e => setMonthsBack(Number(e.target.value))}
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: '#0a1929', color: '#c5d0dc', border: '1px solid #1a3a5c', borderRadius: '4px' }}
            >
              {rangeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Category filter */}
        {data?.categories?.length > 0 && (
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
            <label>Categories</label>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
              onClick={() => setCatOpen(o => !o)}
            >
              {categories.length === 0 ? 'All Holdings' : `${categories.length} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {catOpen && (
              <div className="growth-cat-dropdown">
                <label className="growth-cat-option" style={{ borderBottom: '1px solid #0f3460', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                  <input type="checkbox" checked={categories.length === 0} onChange={() => setCategories([])} />
                  <span>All Holdings</span>
                </label>
                {data.categories.map(c => (
                  <label key={c.id} className="growth-cat-option">
                    <input
                      type="checkbox"
                      checked={categories.includes(String(c.id))}
                      onChange={e => {
                        if (e.target.checked) setCategories(prev => [...prev, String(c.id)])
                        else setCategories(prev => prev.filter(id => id !== String(c.id)))
                      }}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Cumulative toggle */}
        <div className="growth-filter-group">
          <label>&nbsp;</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem', color: '#c5d0dc' }}>
            <input type="checkbox" checked={showCumulative} onChange={e => setShowCumulative(e.target.checked)} />
            Show Cumulative
          </label>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          {/* Summary strip */}
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <div className="summary-card">
              <div className="summary-label">TOTAL</div>
              <div className="summary-value">{fmt(data.summary.total)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">AVERAGE</div>
              <div className="summary-value">{fmt(data.summary.average)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">MIN</div>
              <div className="summary-value">{fmt(data.summary.min)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">MAX</div>
              <div className="summary-value">{fmt(data.summary.max)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">GROWTH</div>
              <div className="summary-value" style={{ color: data.summary.trend_pct >= 0 ? '#4dff91' : '#ff6b6b' }}>
                {data.summary.trend_pct >= 0 ? '+' : ''}{data.summary.trend_pct}%
              </div>
            </div>
          </div>

          {/* Chart */}
          {data.series.labels.length > 0 ? (
            <div className="da-chart-panel">
              <div ref={chartRef} style={{ width: '100%', height: '500px' }} />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#8899aa' }}>
              No dividend data available for the selected timeframe.
            </div>
          )}

          {categories.length > 0 && view === 'weekly' && (
            <p style={{ color: '#8899aa', fontSize: '0.8rem', marginTop: '0.5rem', fontStyle: 'italic' }}>
              Note: Weekly values are estimated proportionally when filtering by category.
            </p>
          )}
        </>
      )}
    </div>
  )
}
