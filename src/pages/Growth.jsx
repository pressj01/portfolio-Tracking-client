import React, { useState, useEffect, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme, hoverLastPoint } from '../utils/chartTheme'
import {
  MIN_PERFORMANCE_DATE,
  PERFORMANCE_PERIODS,
  PERFORMANCE_RANGE_NOTE,
  addCustomRangeParams,
  customRangeError,
  formatAccountingCoverage,
  formatPerformanceChartRange,
  formatPerformanceRange,
  readSharedPerformanceRange,
  todayInputValue,
  writeSharedPerformanceRange,
} from '../utils/performancePeriods'

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function MetricCard({ label, value, sub, range }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '—'}</div>
      {sub && <div className="summary-sub">{sub}</div>}
      {range && <div className="summary-sub">Range: {range}</div>}
    </div>
  )
}

const fmtPct = v => v != null ? `${Number(v).toFixed(2)}%` : '—'
const fmtSignedPct = v => v != null ? `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '—'

// Both index charts are normalized to 100 at the start of the period, so the
// benchmark's return over the window is simply its last plotted value minus 100.
// That keeps the tile and the line it summarizes in exact agreement.
function lastIndexReturn(series) {
  const values = series?.values
  if (!Array.isArray(values)) return null
  for (let i = values.length - 1; i >= 0; i--) {
    const v = Number(values[i])
    if (values[i] != null && Number.isFinite(v)) return v - 100
  }
  return null
}

// Portfolio return large, benchmark comparison on the sub-line, so neither
// number needs a trip to the chart.
function ReturnCard({ label, value, benchLabel, benchValue, range }) {
  const diff = value != null && benchValue != null ? value - benchValue : null
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value" style={{ color: (value ?? 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
        {fmtPct(value)}
      </div>
      <div className="summary-sub">
        {benchValue != null
          ? <>{benchLabel} {fmtPct(benchValue)} &middot; <span style={{ color: (diff ?? 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtSignedPct(diff)} vs {benchLabel}</span></>
          : `No ${benchLabel} data for this range`}
      </div>
      {range && <div className="summary-sub">Range: {range}</div>}
    </div>
  )
}

export default function Growth() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const { isDark } = useTheme()
  const [initialCustomDates] = useState(() => readSharedPerformanceRange())
  const [period, setPeriod] = useState(initialCustomDates.period)
  const [customStart, setCustomStart] = useState(initialCustomDates.start)
  const [customEnd, setCustomEnd] = useState(initialCustomDates.end)
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
    writeSharedPerformanceRange(period, customStart, customEnd)
  }, [period, customStart, customEnd])

  const rangeError = customRangeError(period, customStart, customEnd)
  const cardRange = data
    ? formatPerformanceRange(data.actual_start_date, data.actual_end_date)
    : ''

  useEffect(() => {
    if (rangeError) {
      setData(null)
      setLoading(false)
      setError(rangeError)
      return undefined
    }
    const controller = new AbortController()
    let active = true

    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ period, benchmark })
    addCustomRangeParams(params, period, customStart, customEnd)
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
  }, [period, customStart, customEnd, rangeError, benchmark, categories, subcategories, selection, pf])

  useEffect(() => {
    if (!data || !window.Plotly) return
    const Plotly = window.Plotly
    const ct = chartTheme(isDark)
    const chartRange = formatPerformanceChartRange(
      data.requested_start_date,
      data.requested_end_date,
      data.actual_start_date,
      data.actual_end_date,
    )
    const withChartRange = title => chartRange ? `${title}<br><sup>${chartRange}</sup>` : title
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
    // The two index charts open with their unified hover box pinned to the last
    // date so the latest values read without a mouse. Guarded because the plot
    // is purged on cleanup while newPlot's promise may still be in flight.
    let cancelled = false
    const popLastReadout = (el) => { if (!cancelled) hoverLastPoint(el) }

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
        title: { text: withChartRange('Transaction-Aware Price Return Index'), font: { size: 14, color: ct.title } },
        margin: { l: 50, r: 20, t: 70, b: 40 },
        hovermode: 'x unified',
        legend: { orientation: 'h', y: -0.15, xanchor: 'center', x: 0.5, font: { size: 11 } },
        xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
        yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, title: 'Indexed (100)' },
      }, { responsive: true }).then(() => popLastReadout(priceEl))
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
        title: { text: withChartRange('Transaction-Aware Total Return Index (Dividends Reinvested)'), font: { size: 14, color: ct.title } },
        margin: { l: 50, r: 20, t: 70, b: 40 },
        hovermode: 'x unified',
        legend: { orientation: 'h', y: -0.15, xanchor: 'center', x: 0.5, font: { size: 11 } },
        xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
        yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, title: 'Indexed (100)' },
      }, { responsive: true }).then(() => popLastReadout(totalEl))
    }

    // ── Performance by ticker (grouped horizontal bars) ──
    const barEl = document.getElementById('growth-bar-chart')
    if (barEl && data.ticker_returns.length) {
      ids.push('growth-bar-chart')
      const tickers = data.ticker_returns.map(r => r.ticker).reverse()
      const traces = [{
        y: tickers,
        x: data.ticker_returns.map(r => r.return_pct).reverse(),
        name: data.period_label, type: 'bar', orientation: 'h',
        marker: {
          color: data.ticker_returns
            .map(r => (r.return_pct ?? 0) >= 0 ? '#4dff91' : '#ff6b6b')
            .reverse(),
        },
        hovertemplate: `%{x:.1f}%<extra>${data.period_label}</extra>`,
      }]
      Plotly.newPlot(barEl, traces, {
        ...layoutBase,
        title: { text: withChartRange(`Performance by Ticker — ${data.period_label}`), font: { size: 14, color: ct.title } },
        xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, title: 'Return %', ticksuffix: '%' },
        yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, automargin: true },
        legend: { orientation: 'h', y: -0.08, xanchor: 'center', x: 0.5, font: { size: 11 } },
        margin: { l: 80, r: 20, t: 70, b: 60 },
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
        title: { text: withChartRange('Performance Heatmap'), font: { size: 14, color: ct.title } },
        yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, automargin: true },
        xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
        margin: { l: 80, r: 20, t: 70, b: 40 },
        height: Math.max(400, data.heatmap.tickers.length * 28 + 100),
      }, { responsive: true })
    }

    return () => {
      cancelled = true
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
          <label>Shared Performance Date Range</label>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {PERFORMANCE_PERIODS.map(option => (
              <button
                key={option.key}
                className={`tab${period === option.key ? ' active' : ''}`}
                onClick={() => setPeriod(option.key)}
                style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem' }}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="tr-note perf-range-note">{PERFORMANCE_RANGE_NOTE}</p>
        </div>
        {period === 'custom' && (
          <div className="g2-custom-range" role="group" aria-label="Custom date range">
            <label>
              <span>Start date</span>
              <input
                type="date"
                value={customStart}
                min={MIN_PERFORMANCE_DATE}
                max={customEnd || todayInputValue()}
                onChange={e => setCustomStart(e.target.value)}
              />
            </label>
            <label>
              <span>End date</span>
              <input
                type="date"
                value={customEnd}
                min={customStart || MIN_PERFORMANCE_DATE}
                max={todayInputValue()}
                onChange={e => setCustomEnd(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          <p className="tr-note" style={{ marginTop: 0 }}>
            <strong>{data.period_label}:</strong>{' '}
            {formatPerformanceRange(data.actual_start_date, data.actual_end_date)}
            {data.requested_start_date && data.actual_start_date !== data.requested_start_date
              ? ` (requested from ${formatPerformanceRange(data.requested_start_date, data.requested_end_date)})`
              : ''}
            . The period and category filters apply to every metric and chart below.
            {formatAccountingCoverage(data.portfolio_metrics)
              ? ` ${formatAccountingCoverage(data.portfolio_metrics)}`
              : ''}
          </p>
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            <strong>Tracker performance standard:</strong> the portfolio cards, both return indexes, and
            ticker bars use the same transaction-aware calculation as the Total Return Dashboard. With
            the same account, date range, and holdings scope, <strong>Total Return %</strong> here matches
            Total Return and Portfolio Growth 2&apos;s <strong>Tracker Total Return %</strong>. Buys and sells
            change portfolio weights; they are not counted as gains or losses. The index starts at 100,
            so its final value minus 100 is the displayed return percentage.
            {' '}The selected range is remembered across all five tracking screens, including Gains &amp; Losses.
          </div>
          {/* Metrics strip */}
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <div className="summary-card summary-card-grade">
              <div className="summary-label">Portfolio Grade</div>
              <div className="summary-value">
                {data.grade?.overall ? <GradeBadge grade={data.grade.overall} large /> : '—'}
              </div>
              {data.grade?.score != null && (
                <div className="summary-sub">Score: {data.grade.score}</div>
              )}
              {cardRange && <div className="summary-sub">Range: {cardRange}</div>}
            </div>
            <ReturnCard
              label="Tracker Total Return %"
              value={data.portfolio_metrics?.total_return_pct}
              benchLabel={data.benchmark_ticker}
              benchValue={lastIndexReturn(data.benchmark_total)}
              range={cardRange}
            />
            <ReturnCard
              label="Price Return %"
              value={data.portfolio_metrics?.price_return_pct}
              benchLabel={data.benchmark_ticker}
              benchValue={lastIndexReturn(data.benchmark_price)}
              range={cardRange}
            />
            <MetricCard label="Portfolio Sharpe" value={data.grade?.sharpe} range={cardRange} />
            <MetricCard label="Portfolio Sortino" value={data.grade?.sortino} range={cardRange} />
            <MetricCard label={`${data.benchmark_ticker} Sharpe`} value={data.benchmark_metrics?.sharpe} range={cardRange} />
            <MetricCard label={`${data.benchmark_ticker} Sortino`} value={data.benchmark_metrics?.sortino} range={cardRange} />
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
