import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

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

const fmt = v => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const fmtPct = v => v != null ? `${(Number(v) * 100).toFixed(2)}%` : '—'
const fmtPctRaw = v => v != null ? `${Number(v).toFixed(2)}%` : '—'

const METRIC_OPTIONS = [
  { value: 'yield_pct', label: 'Yield (%)' },
  { value: 'annual_payout', label: 'Annual payout ($)' },
]
const GROUP_OPTIONS = [
  { value: 'holdings', label: 'Holdings' },
  { value: 'categories', label: 'Categories' },
]

function YieldPayoutChart({ rows }) {
  const chartRef = useRef(null)
  const [metric, setMetric] = useState('yield_pct')
  const [group, setGroup] = useState('holdings')
  const [metricOpen, setMetricOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const metricRef = useRef(null)
  const groupRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (metricRef.current && !metricRef.current.contains(e.target)) setMetricOpen(false)
      if (groupRef.current && !groupRef.current.contains(e.target)) setGroupOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const chartData = useMemo(() => {
    if (!rows?.length) return null

    const groupKey = {
      holdings: 'ticker',
      categories: 'category_name',
    }[group]

    // Aggregate by group
    const grouped = {}
    rows.forEach(r => {
      const key = r[groupKey] || 'Other'
      if (!grouped[key]) grouped[key] = { yield_sum: 0, yield_count: 0, annual_payout: 0, value: 0 }
      const yld = (r.current_annual_yield || 0) * 100  // decimal to pct
      grouped[key].yield_sum += yld
      grouped[key].yield_count += 1
      grouped[key].annual_payout += (r.estim_payment_per_year || 0)
      grouped[key].value += (r.current_value || 0)
    })

    // Build arrays
    let entries = Object.entries(grouped).map(([label, d]) => ({
      label,
      yield_pct: group === 'holdings' ? (rows.find(r => r.ticker === label)?.current_annual_yield || 0) * 100 : (d.yield_count > 0 ? d.yield_sum / d.yield_count : 0),
      annual_payout: d.annual_payout,
      value: d.value,
    }))

    // Sort descending by selected metric
    const sortKey = metric === 'yield_pct' ? 'yield_pct' : 'annual_payout'
    entries.sort((a, b) => b[sortKey] - a[sortKey])

    return {
      labels: entries.map(e => e.label),
      primary: entries.map(e => e[metric === 'yield_pct' ? 'yield_pct' : 'annual_payout']),
      secondary: entries.map(e => e[metric === 'yield_pct' ? 'annual_payout' : 'value']),
      primaryLabel: metric === 'yield_pct' ? 'Yield (%)' : 'Annual Payout ($)',
      secondaryLabel: metric === 'yield_pct' ? 'Annual Payout ($)' : 'Portfolio Value ($)',
    }
  }, [rows, metric, group])

  useEffect(() => {
    if (!chartData || !chartRef.current || !window.Plotly) return
    const el = chartRef.current

    const traces = [
      {
        x: chartData.labels,
        y: chartData.primary,
        type: 'bar',
        name: chartData.primaryLabel,
        marker: { color: '#38bdf8' },
        text: chartData.primary.map(v => metric === 'yield_pct' ? `${v.toFixed(1)}%` : `$${v.toLocaleString(undefined, {maximumFractionDigits: 0})}`),
        textposition: 'none',
        hovertemplate: metric === 'yield_pct' ? '%{x}: %{y:.2f}%<extra></extra>' : '%{x}: $%{y:,.0f}<extra></extra>',
      },
      {
        x: chartData.labels,
        y: chartData.secondary,
        type: 'scatter',
        mode: 'markers',
        name: chartData.secondaryLabel,
        marker: { color: '#a855f7', size: 7, symbol: 'line-ew-open', line: { width: 2, color: '#a855f7' } },
        yaxis: 'y2',
        hovertemplate: '%{x}: $%{y:,.0f}<extra></extra>',
      },
    ]

    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#1a1f2e',
      plot_bgcolor: 'rgba(255,255,255,0.03)',
      font: { color: '#e0e8f5' },
      margin: { t: 10, b: chartData.labels.length > 15 ? 120 : 80, l: 60, r: 60 },
      xaxis: {
        tickangle: chartData.labels.length > 10 ? -45 : 0,
        tickfont: { size: chartData.labels.length > 30 ? 9 : 11 },
        gridcolor: '#1a2233',
      },
      yaxis: {
        title: chartData.primaryLabel,
        titlefont: { color: '#38bdf8', size: 12 },
        tickfont: { color: '#38bdf8' },
        gridcolor: '#1a2233',
        ticksuffix: metric === 'yield_pct' ? '%' : '',
        tickprefix: metric === 'annual_payout' ? '$' : '',
        separatethousands: true,
      },
      yaxis2: {
        title: chartData.secondaryLabel,
        titlefont: { color: '#a855f7', size: 12 },
        tickfont: { color: '#a855f7' },
        overlaying: 'y',
        side: 'right',
        showgrid: false,
        tickprefix: '$',
        separatethousands: true,
      },
      legend: { orientation: 'h', y: 1.12, x: 0.5, xanchor: 'center' },
      bargap: 0.15,
    }

    window.Plotly.newPlot(el, traces, layout, { responsive: true })
    return () => window.Plotly.purge(el)
  }, [chartData, metric])

  if (!rows?.length) return null

  const metricLabel = METRIC_OPTIONS.find(o => o.value === metric)?.label
  const groupLabel = GROUP_OPTIONS.find(o => o.value === group)?.label

  const dropdownStyle = {
    position: 'relative', display: 'inline-block',
  }
  const btnStyle = {
    background: 'transparent', border: '1px solid #334155', color: '#e0e8f5',
    padding: '0.3rem 0.7rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem',
    minWidth: '130px', textAlign: 'left',
  }
  const menuStyle = {
    position: 'absolute', top: '100%', right: 0, zIndex: 20,
    background: '#1e293b', border: '1px solid #334155', borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)', minWidth: '140px',
  }
  const itemStyle = (active) => ({
    padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem',
    color: active ? '#38bdf8' : '#e0e8f5',
    background: active ? 'rgba(56,189,248,0.1)' : 'transparent',
  })

  return (
    <div className="da-chart-panel" style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem 0.25rem' }}>
        <div style={{ fontSize: '1rem', fontWeight: 600, color: '#e0e8f5' }}>
          Yield/Payout <span style={{ fontSize: '0.75rem', color: '#8899aa', cursor: 'help' }} title="Compare yield and payout across your portfolio grouped by different dimensions">&#9432;</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div ref={metricRef} style={dropdownStyle}>
            <button style={btnStyle} onClick={() => { setMetricOpen(o => !o); setGroupOpen(false) }}>
              {metricLabel} <span style={{ float: 'right', marginLeft: '0.5rem', fontSize: '0.7em' }}>&#9662;</span>
            </button>
            {metricOpen && (
              <div style={menuStyle}>
                {METRIC_OPTIONS.map(o => (
                  <div key={o.value} style={itemStyle(o.value === metric)}
                    onMouseEnter={e => e.target.style.background = 'rgba(56,189,248,0.15)'}
                    onMouseLeave={e => e.target.style.background = o.value === metric ? 'rgba(56,189,248,0.1)' : 'transparent'}
                    onClick={() => { setMetric(o.value); setMetricOpen(false) }}>
                    {o.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div ref={groupRef} style={dropdownStyle}>
            <button style={btnStyle} onClick={() => { setGroupOpen(o => !o); setMetricOpen(false) }}>
              {groupLabel} <span style={{ float: 'right', marginLeft: '0.5rem', fontSize: '0.7em' }}>&#9662;</span>
            </button>
            {groupOpen && (
              <div style={menuStyle}>
                {GROUP_OPTIONS.map(o => (
                  <div key={o.value} style={itemStyle(o.value === group)}
                    onMouseEnter={e => e.target.style.background = 'rgba(56,189,248,0.15)'}
                    onMouseLeave={e => e.target.style.background = o.value === group ? 'rgba(56,189,248,0.1)' : 'transparent'}
                    onClick={() => { setGroup(o.value); setGroupOpen(false) }}>
                    {o.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div ref={chartRef} style={{ width: '100%', height: '400px' }} />
    </div>
  )
}

export default function DividendAnalysis() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [categories, setCategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [recalcMsg, setRecalcMsg] = useState(null)
  const [recalcing, setRecalcing] = useState(false)

  useEffect(() => {
    const handler = (e) => { if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchData = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (categories.length) params.set('category', categories.join(','))
    pf(`/api/dividend-analysis/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [categories, selection, pf])

  useEffect(() => { fetchData() }, [fetchData])

  const handleRecalcPayouts = async () => {
    setRecalcing(true)
    setRecalcMsg(null)
    try {
      const res = await pf('/api/payouts/monthly/recalculate', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setRecalcMsg(d.message)
      fetchData()
    } catch (e) {
      setRecalcMsg(`Error: ${e.message}`)
    } finally {
      setRecalcing(false)
    }
  }

  useEffect(() => {
    if (!data || !window.Plotly) return
    const Plotly = window.Plotly
    const cfg = { responsive: true }
    const ids = []

    const chartMap = {
      annual_income: 'da-chart-annual-income',
      projected_monthly: 'da-chart-projected-monthly',
      monthly_received: 'da-chart-monthly-received',
      total_divs_ticker: 'da-chart-total-divs-ticker',
      paid_for_itself: 'da-chart-paid-for-itself',
      by_type: 'da-chart-by-type',
    }

    Object.entries(chartMap).forEach(([key, elId]) => {
      const el = document.getElementById(elId)
      if (!el || !data.charts[key]) return
      ids.push(elId)
      const fig = JSON.parse(data.charts[key])
      Plotly.newPlot(el, fig.data, fig.layout, cfg)
    })

    return () => {
      ids.forEach(id => {
        const el = document.getElementById(id)
        if (el) Plotly.purge(el)
      })
    }
  }, [data])

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(a => !a)
    } else {
      setSortCol(col)
      // Default descending for numeric columns
      const numCols = ['ytd_divs', 'total_divs_received', 'paid_for_itself', 'dividend_paid', 'estim_payment_per_year', 'approx_monthly_income', 'annual_yield_on_cost', 'current_annual_yield', 'gain_or_loss']
      setSortAsc(!numCols.includes(col))
    }
  }

  const sortedRows = useMemo(() => {
    if (!data?.rows) return []
    if (!sortCol) return data.rows
    const rows = [...data.rows]
    rows.sort((a, b) => {
      let av = a[sortCol] ?? ''
      let bv = b[sortCol] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortAsc ? av - bv : bv - av
      }
      av = String(av).toLowerCase()
      bv = String(bv).toLowerCase()
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return rows
  }, [data, sortCol, sortAsc])

  const sortIcon = (col) => {
    if (sortCol !== col) return ' \u21C5'
    return sortAsc ? ' \u25B2' : ' \u25BC'
  }

  const columns = [
    { key: 'ticker', label: 'Ticker', width: '5%' },
    { key: 'description', label: 'Description', width: '20%' },
    { key: 'category_name', label: 'Category', tip: 'Investment category', width: '7%' },
    { key: 'ytd_divs', label: 'YTD Divs', fmt: fmt, align: 'right', tip: 'Year-to-date dividends received' },
    { key: 'total_divs_received', label: 'Total Divs', fmt: fmt, align: 'right', tip: 'Total dividends received since purchase' },
    { key: 'paid_for_itself', label: 'Paid For Itself', fmt: v => fmtPctRaw(v != null ? v * 100 : null), align: 'right', tip: 'Percentage of original cost recovered through dividends' },
    { key: 'dividend_paid', label: 'Div Paid', fmt: fmt, align: 'right', tip: 'Last dividend amount paid per share' },
    { key: 'estim_payment_per_year', label: 'Est. Annual', fmt: fmt, align: 'right', tip: 'Estimated annual dividend income' },
    { key: 'approx_monthly_income', label: 'Est. Monthly', fmt: fmt, align: 'right', tip: 'Estimated monthly dividend income' },
    { key: 'annual_yield_on_cost', label: 'Yield on Cost', fmt: fmtPct, align: 'right', tip: 'Annual dividend yield based on your cost basis' },
    { key: 'current_annual_yield', label: 'Current Yield', fmt: fmtPct, align: 'right', tip: 'Current annual dividend yield based on market price' },
    { key: 'gain_or_loss', label: 'Gain / Loss', fmt: fmt, align: 'right', tip: 'Unrealized gain or loss in dollar amount' },
  ]

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '1rem' }}>Dividend Analysis</h1>

      {/* Category filter — only show when categories are defined */}
      {(data?.categories?.length > 0) && (
        <div className="growth-filters">
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
            <label>Categories</label>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
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
                        if (e.target.checked) {
                          setCategories(prev => [...prev, String(c.id)])
                        } else {
                          setCategories(prev => prev.filter(id => id !== String(c.id)))
                        }
                      }}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          {/* Summary strip */}
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <div className="summary-card summary-card-grade">
              <div className="summary-label">Portfolio Grade</div>
              <div className="summary-value">
                {data.grade?.overall ? <GradeBadge grade={data.grade.overall} large /> : '—'}
              </div>
              {data.grade?.score != null && <div className="summary-sub">Score: {data.grade.score}</div>}
            </div>
            <MetricCard label="Sharpe Ratio" value={data.grade?.sharpe} />
            <MetricCard label="Sortino Ratio" value={data.grade?.sortino} />
            <MetricCard label="Total Divs YTD" value={fmt(data.totals?.ytd_divs)} />
            <MetricCard label="Total Divs Received" value={fmt(data.totals?.total_divs_received)} />
            <MetricCard label="Est. Monthly Income" value={fmt(data.totals?.approx_monthly_income)} />
            <MetricCard label={`Actual Income (${data.totals?.current_month_label || 'This Month'})`} value={fmt(data.totals?.actual_monthly_income)} />
            <MetricCard label="Est. Annual Income" value={fmt(data.totals?.estim_payment_per_year)} />
          </div>

          {/* Yield/Payout interactive chart */}
          <div className="da-chart-grid">
            <YieldPayoutChart rows={data.rows} />
          </div>

          {/* Charts */}
          <div className="da-chart-grid">
            {data.charts.annual_income && <div className="da-chart-panel"><div id="da-chart-annual-income" className="da-chart-div" /></div>}
            {data.charts.projected_monthly && <div className="da-chart-panel"><div id="da-chart-projected-monthly" className="da-chart-div" /></div>}
            {data.charts.monthly_received && <div className="da-chart-panel">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
                <button className="btn btn-sm" onClick={handleRecalcPayouts} disabled={recalcing}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>
                  {recalcing ? 'Recalculating...' : 'Recalculate from Holdings'}
                </button>
              </div>
              {recalcMsg && <div style={{ fontSize: '0.8rem', color: '#7ecfff', marginBottom: '0.25rem' }}>{recalcMsg}</div>}
              <div id="da-chart-monthly-received" className="da-chart-div" />
            </div>}
            {data.charts.total_divs_ticker && <div className="da-chart-panel"><div id="da-chart-total-divs-ticker" className="da-chart-div" /></div>}
            {data.charts.paid_for_itself && <div className="da-chart-panel"><div id="da-chart-paid-for-itself" className="da-chart-div" /></div>}
            {data.charts.by_type && <div className="da-chart-panel"><div id="da-chart-by-type" className="da-chart-div" style={{ height: '420px' }} /></div>}
          </div>

          {/* Data table */}
          <p style={{ color: '#8899aa', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Click any column header to sort. Click again to reverse.</p>
          <div className="sticky-table-wrap" style={{ maxHeight: '70vh' }}>
            <table>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={col.key} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: col.align || 'left', width: col.width || undefined }} onClick={() => handleSort(col.key)} title={col.tip || ''}>
                      {col.label}{col.tip ? ' \u24D8' : ''}
                      <span style={{ fontSize: '0.7em', marginLeft: '4px', color: sortCol === col.key ? '#7ecfff' : '#8899aa' }}>
                        {sortIcon(col.key)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(row => {
                  const paidPct = (row.paid_for_itself || 0) * 100
                  return (
                    <tr key={row.ticker} style={paidPct >= 100 ? { background: 'rgba(77,255,145,0.05)' } : {}}>
                      {columns.map(col => {
                        const val = row[col.key]
                        let display = col.fmt ? col.fmt(val) : (val ?? '')
                        let style = col.align ? { textAlign: col.align } : {}

                        if (col.key === 'ticker') display = <strong>{val}</strong>
                        if (col.key === 'total_divs_received') display = <strong>{fmt(val)}</strong>
                        if (col.key === 'paid_for_itself') {
                          const color = paidPct >= 100 ? '#4dff91' : paidPct >= 50 ? '#ffd700' : undefined
                          style = { textAlign: 'right', color, fontWeight: paidPct >= 100 ? 'bold' : undefined }
                        }
                        if (col.key === 'gain_or_loss') {
                          style = { textAlign: 'right', color: (val || 0) >= 0 ? '#4dff91' : '#ff6b6b' }
                        }

                        return <td key={col.key} style={style}>{display}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
              {data.totals && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid #0f3460', background: '#16213e' }}>
                    <td colSpan={3}><strong>Totals</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.ytd_divs)}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.total_divs_received)}</strong></td>
                    <td></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.dividend_paid)}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.estim_payment_per_year)}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmt(data.totals.approx_monthly_income)}</strong></td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  )
}
