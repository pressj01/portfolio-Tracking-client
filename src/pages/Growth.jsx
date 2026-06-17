import React, { useState, useEffect, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'

const PERIODS = ['1y', '5y', 'max']
const PERIOD_LABELS = { '1y': '1Y', '5y': '5Y', 'max': 'Max' }

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function MetricCard({ label, value }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '—'}</div>
    </div>
  )
}

export default function Growth() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const { isDark } = useTheme()
  const [period, setPeriod] = useState('1y')
  const [benchmark, setBenchmark] = useState('SPY')
  const [benchInput, setBenchInput] = useState('SPY')
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ period, benchmark })
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    pf(`/api/growth/data?${params}`, { signal: controller.signal })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(d.detail || d.error || `Request failed (${r.status})`)
        }
        return d
      })
      .then(d => {
        if (!active) return
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => {
        if (!active || e.name === 'AbortError') return
        setData(null)
        setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [period, benchmark, categories, subcategories, selection, pf])

  useEffect(() => {
    if (!data || !window.Plotly) return
    const Plotly = window.Plotly
    const ct = chartTheme(isDark)
    const layoutBase = {
      template: ct.template,
      paper_bgcolor: ct.paper,
      plot_bgcolor: ct.plot,
      font: { color: ct.font },
      hoverlabel: {
        bgcolor: ct.surface,
        bordercolor: ct.grid,
        font: { color: ct.title },
      },
    }
    const ids = []

    // ── Price-only chart ──
    const priceEl = document.getElementById('growth-price-chart')
    if (priceEl) {
      ids.push('growth-price-chart')
      const traces = [
        { x: data.portfolio_price.dates, y: data.portfolio_price.values, name: 'Portfolio', line: { color: '#7ecfff', width: 2 }, hovertemplate: '%{y:.1f}<extra>Portfolio</extra>' },
      ]
      if (data.benchmark_price.dates.length) {
        traces.push({ x: data.benchmark_price.dates, y: data.benchmark_price.values, name: data.benchmark_ticker, line: { color: '#ff9800', width: 2, dash: 'dot' }, hovertemplate: '%{y:.1f}<extra>' + data.benchmark_ticker + '</extra>' })
      }
      Plotly.newPlot(priceEl, traces, {
        ...layoutBase, height: 380,
        title: { text: 'Portfolio Value (Price Only)', font: { size: 14, color: ct.title } },
        margin: { l: 50, r: 20, t: 50, b: 40 },
        hovermode: 'x unified',
        legend: { orientation: 'h', y: -0.15, xanchor: 'center', x: 0.5, font: { size: 11 } },
        xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
        yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, title: 'Indexed (100)' },
      }, { responsive: true })
    }

    // ── Total return chart ──
    const totalEl = document.getElementById('growth-total-chart')
    if (totalEl) {
      ids.push('growth-total-chart')
      const traces = [
        { x: data.portfolio_total.dates, y: data.portfolio_total.values, name: 'Portfolio', line: { color: '#4dff91', width: 2 }, hovertemplate: '%{y:.1f}<extra>Portfolio</extra>' },
      ]
      if (data.benchmark_total.dates.length) {
        traces.push({ x: data.benchmark_total.dates, y: data.benchmark_total.values, name: data.benchmark_ticker, line: { color: '#ff9800', width: 2, dash: 'dot' }, hovertemplate: '%{y:.1f}<extra>' + data.benchmark_ticker + '</extra>' })
      }
      Plotly.newPlot(totalEl, traces, {
        ...layoutBase, height: 380,
        title: { text: 'Total Return (incl. Dividends)', font: { size: 14, color: ct.title } },
        margin: { l: 50, r: 20, t: 50, b: 40 },
        hovermode: 'x unified',
        legend: { orientation: 'h', y: -0.15, xanchor: 'center', x: 0.5, font: { size: 11 } },
        xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
        yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, title: 'Indexed (100)' },
      }, { responsive: true })
    }

    // ── Performance by ticker (grouped horizontal bars) ──
    const barEl = document.getElementById('growth-bar-chart')
    if (barEl && data.ticker_returns.length) {
      ids.push('growth-bar-chart')
      const periods = ['1M', '3M', '6M', 'YTD', '1Y']
      const colors = { '1M': '#7ecfff', '3M': '#64b5f6', '6M': '#42a5f5', 'YTD': '#4dff91', '1Y': '#ffd700' }
      const tickers = data.ticker_returns.map(r => r.ticker).reverse()
      const traces = periods.map(p => ({
        y: tickers,
        x: data.ticker_returns.map(r => r[p]).reverse(),
        name: p, type: 'bar', orientation: 'h',
        marker: { color: colors[p] },
        hovertemplate: '%{x:.1f}%<extra>' + p + '</extra>',
      }))
      Plotly.newPlot(barEl, traces, {
        ...layoutBase,
        barmode: 'group',
        title: { text: 'Performance by Ticker', font: { size: 14, color: ct.title } },
        xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, title: 'Return %', ticksuffix: '%' },
        yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, automargin: true },
        legend: { orientation: 'h', y: -0.08, xanchor: 'center', x: 0.5, font: { size: 11 } },
        margin: { l: 80, r: 20, t: 50, b: 60 },
        height: Math.max(400, tickers.length * 30 + 120),
      }, { responsive: true })
    }

    // ── Performance heatmap ──
    const heatEl = document.getElementById('growth-heatmap')
    if (heatEl && data.heatmap.tickers.length) {
      ids.push('growth-heatmap')
      const z = data.heatmap.values
      const textVals = z.map(row => row.map(v => v != null ? Number(v).toFixed(1) + '%' : ''))
      Plotly.newPlot(heatEl, [{
        z, x: data.heatmap.windows, y: data.heatmap.tickers,
        type: 'heatmap',
        colorscale: [[0, '#c62828'], [0.5, ct.plot], [1, '#2e7d32']],
        zmid: 0,
        text: textVals, texttemplate: '%{text}',
        hovertemplate: '%{y} %{x}: %{z:.1f}%<extra></extra>',
        colorbar: { title: '%', ticksuffix: '%' },
      }], {
        ...layoutBase, showlegend: false,
        title: { text: 'Performance Heatmap', font: { size: 14, color: ct.title } },
        yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, automargin: true },
        xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
        margin: { l: 80, r: 20, t: 50, b: 40 },
        height: Math.max(400, data.heatmap.tickers.length * 28 + 100),
      }, { responsive: true })
    }

    return () => {
      ids.forEach(id => {
        const el = document.getElementById(id)
        if (el) Plotly.purge(el)
      })
    }
  }, [data, isDark])

  const handleBenchGo = () => {
    const val = benchInput.trim().toUpperCase()
    if (val && val !== benchmark) setBenchmark(val)
  }

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '1rem' }}>Growth & Performance</h1>

      {/* Filters */}
      <div className="growth-filters">
        {/* Category filter — only show when categories are defined */}
        {(data?.categories?.length > 0) && (
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
            <label>Categories</label>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
              onClick={() => setCatOpen(o => !o)}
            >
              {categories.length === 0 && subcategories.length === 0
                ? 'All Holdings'
                : `${categories.length + subcategories.length} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {catOpen && (
              <div className="growth-cat-dropdown">
                <label className="growth-cat-option" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                  <input
                    type="checkbox"
                    checked={categories.length === 0 && subcategories.length === 0}
                    onChange={() => { setCategories([]); setSubcategories([]) }}
                  />
                  <span>All Holdings</span>
                </label>
                {data.categories.map(c => {
                  const catChecked = categories.includes(String(c.id))
                  const subs = c.subcategories || []
                  return (
                    <React.Fragment key={c.id}>
                      <label className="growth-cat-option">
                        <input
                          type="checkbox"
                          checked={catChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              // Selecting the whole category supersedes any of its
                              // sub-category selections, so clear those.
                              const subIds = subs.map(s => String(s.id))
                              setCategories(prev => [...prev, String(c.id)])
                              setSubcategories(prev => prev.filter(id => !subIds.includes(id)))
                            } else {
                              setCategories(prev => prev.filter(id => id !== String(c.id)))
                            }
                          }}
                        />
                        <span>{c.name}</span>
                      </label>
                      {subs.map(s => (
                        <label
                          key={s.id}
                          className="growth-cat-option"
                          style={{ paddingLeft: '1.4rem', opacity: catChecked ? 0.5 : 1 }}
                        >
                          <input
                            type="checkbox"
                            disabled={catChecked}
                            checked={catChecked || subcategories.includes(String(s.id))}
                            onChange={e => {
                              if (e.target.checked) {
                                setSubcategories(prev => [...prev, String(s.id)])
                              } else {
                                setSubcategories(prev => prev.filter(id => id !== String(s.id)))
                              }
                            }}
                          />
                          <span>{s.name}</span>
                        </label>
                      ))}
                    </React.Fragment>
                  )
                })}
              </div>
            )}
          </div>
        )}
        <div className="growth-filter-group">
          <label>Benchmark</label>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            <input
              value={benchInput}
              onChange={e => setBenchInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleBenchGo()}
              style={{ width: '80px' }}
            />
            <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={handleBenchGo}>Go</button>
          </div>
        </div>
        <div className="growth-filter-group">
          <label>Period</label>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {PERIODS.map(p => (
              <button
                key={p}
                className={`tab${period === p ? ' active' : ''}`}
                onClick={() => setPeriod(p)}
                style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem' }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          {/* Metrics strip */}
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <div className="summary-card summary-card-grade">
              <div className="summary-label">Portfolio Grade</div>
              <div className="summary-value">
                {data.grade?.overall ? <GradeBadge grade={data.grade.overall} large /> : '—'}
              </div>
              {data.grade?.score != null && <div className="summary-sub">Score: {data.grade.score}</div>}
            </div>
            <MetricCard label="Portfolio Sharpe" value={data.grade?.sharpe} />
            <MetricCard label="Portfolio Sortino" value={data.grade?.sortino} />
            <MetricCard label={`${data.benchmark_ticker} Sharpe`} value={data.benchmark_metrics?.sharpe} />
            <MetricCard label={`${data.benchmark_ticker} Sortino`} value={data.benchmark_metrics?.sortino} />
          </div>

          {/* Each chart in its own block-level container */}
          <div className="growth-charts-row">
            <div className="growth-chart-box" id="growth-price-chart" />
            <div className="growth-chart-box" id="growth-total-chart" />
          </div>

          <div id="growth-bar-chart" style={{ marginBottom: '1rem' }} />
          <div id="growth-heatmap" style={{ marginBottom: '1rem' }} />
        </>
      )}
    </div>
  )
}
