import React, { useState, useEffect, useRef, useMemo } from 'react'
import { API_BASE } from '../config'

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

export default function DividendAnalysis() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [categories, setCategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    const handler = (e) => { if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (categories.length) params.set('category', categories.join(','))
    fetch(`${API_BASE}/api/dividend-analysis/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [categories])

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
    { key: 'ticker', label: 'Ticker' },
    { key: 'description', label: 'Description' },
    { key: 'category_name', label: 'Category' },
    { key: 'ytd_divs', label: 'YTD Divs', fmt: fmt },
    { key: 'total_divs_received', label: 'Total Divs', fmt: fmt },
    { key: 'paid_for_itself', label: 'Paid For Itself', fmt: v => fmtPctRaw(v != null ? v * 100 : null) },
    { key: 'dividend_paid', label: 'Div Paid', fmt: fmt },
    { key: 'estim_payment_per_year', label: 'Est. Annual', fmt: fmt },
    { key: 'approx_monthly_income', label: 'Est. Monthly', fmt: fmt },
    { key: 'annual_yield_on_cost', label: 'Yield on Cost', fmt: fmtPct },
    { key: 'current_annual_yield', label: 'Current Yield', fmt: fmtPct },
    { key: 'gain_or_loss', label: 'Gain / Loss', fmt: fmt },
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

          {/* Charts */}
          <div className="da-chart-grid">
            {data.charts.annual_income && <div className="da-chart-panel"><div id="da-chart-annual-income" className="da-chart-div" /></div>}
            {data.charts.projected_monthly && <div className="da-chart-panel"><div id="da-chart-projected-monthly" className="da-chart-div" /></div>}
            {data.charts.monthly_received && <div className="da-chart-panel"><div id="da-chart-monthly-received" className="da-chart-div" /></div>}
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
                    <th key={col.key} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => handleSort(col.key)}>
                      {col.label}
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
                        const isNum = typeof val === 'number'
                        let display = col.fmt ? col.fmt(val) : (val ?? '')
                        let style = isNum ? { textAlign: 'right' } : {}

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
