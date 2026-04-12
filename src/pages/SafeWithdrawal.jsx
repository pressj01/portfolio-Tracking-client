import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const fmt = v => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u2014'
const fmtDate = v => v || '\u2014'

function MetricCard({ label, value }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '\u2014'}</div>
    </div>
  )
}

export default function SafeWithdrawal() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(false)
  const [selCats, setSelCats] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = e => { if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    pf('/api/holdings')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setRows(data)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [selection])

  const allComputed = useMemo(() => rows.map(r => {
    const cost = r.purchase_value || 0
    const monthlyDiv = r.approx_monthly_income || 0
    const hasDividend = monthlyDiv > 0
    const yieldOnCost = cost > 0 ? ((r.estim_payment_per_year || 0) / cost) * 100 : 0
    const sustainable = hasDividend && yieldOnCost >= 8
    return {
      ticker: r.ticker,
      category: r.category || r.classification_type || '',
      frequency: r.div_frequency || '',
      purchase_date: r.purchase_date || '',
      price_paid: r.price_paid || 0,
      current_price: r.current_price || 0,
      quantity: r.quantity || 0,
      est_monthly_div: monthlyDiv,
      yield_on_cost: yieldOnCost,
      current_yield: (r.current_annual_yield || 0) * 100,
      w8_weekly: hasDividend ? cost * 0.08 / 52 : 0,
      w8_monthly: hasDividend ? cost * 0.08 / 12 : 0,
      w8_annually: hasDividend ? cost * 0.08 : 0,
      status: !hasDividend ? 'No Distribution' : !sustainable ? 'Distribution rate too low' : '',
    }
  }), [rows])

  const categoryList = useMemo(() => {
    const names = [...new Set(allComputed.map(r => r.category).filter(Boolean))].sort()
    return names
  }, [allComputed])

  const computed = useMemo(() => {
    if (selCats.length === 0) return allComputed
    return allComputed.filter(r => selCats.includes(r.category))
  }, [allComputed, selCats])

  const totals = useMemo(() => ({
    est_monthly_div: computed.reduce((s, r) => s + r.est_monthly_div, 0),
    w8_weekly: computed.reduce((s, r) => s + r.w8_weekly, 0),
    w8_monthly: computed.reduce((s, r) => s + r.w8_monthly, 0),
    w8_annually: computed.reduce((s, r) => s + r.w8_annually, 0),
  }), [computed])

  const handleSort = key => {
    if (sortCol === key) setSortAsc(a => !a)
    else { setSortCol(key); setSortAsc(true) }
  }

  const sorted = useMemo(() => {
    if (!sortCol) return computed
    return [...computed].sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol]
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      if (va < vb) return sortAsc ? -1 : 1
      if (va > vb) return sortAsc ? 1 : -1
      return 0
    })
  }, [computed, sortCol, sortAsc])

  const columns = [
    { key: 'ticker',         label: 'Ticker' },
    { key: 'category',       label: 'Category' },
    { key: 'frequency',      label: 'Frequency' },
    { key: 'purchase_date',  label: 'Purchase Date', fmt: fmtDate },
    { key: 'price_paid',     label: 'Purchase Price', fmt, align: 'right' },
    { key: 'current_price',  label: 'Current Price',  fmt, align: 'right' },
    { key: 'quantity',       label: 'Quantity',      fmt: v => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }), align: 'right' },
    { key: 'est_monthly_div',label: 'Est Monthly Div', fmt, align: 'right' },
    { key: 'yield_on_cost',  label: 'Yield on Cost',  fmt: v => `${Number(v).toFixed(2)}%`, align: 'right' },
    { key: 'current_yield',  label: 'Current Yield',  fmt: v => `${Number(v).toFixed(2)}%`, align: 'right' },
    { key: 'w8_weekly',      label: '8% Cost / Week',  fmt, align: 'right' },
    { key: 'w8_monthly',     label: '8% Cost / Month', fmt, align: 'right' },
    { key: 'w8_annually',    label: '8% Cost / Year',  fmt, align: 'right' },
    { key: 'status',         label: 'Status', fmt: v => v || '', color: v => v ? '#ff6b6b' : undefined },
  ]

  const arrow = key => sortCol === key ? (sortAsc ? ' \u25B4' : ' \u25BE') : ''

  return (
    <div className="page">
      <h1>Safe Withdrawal Amount</h1>
      <p style={{ color: '#8899aa', marginTop: '-1rem', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
        Estimates safe spending from dividends using 8% of purchase cost as a benchmark.
      </p>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}

      {!loading && !error && (
        <>
          {categoryList.length > 0 && (
            <div className="growth-filters" style={{ marginBottom: '1rem' }}>
              <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
                <label>Categories</label>
                <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
                  onClick={() => setCatOpen(o => !o)}>
                  {selCats.length === 0 ? 'All Holdings' : `${selCats.length} selected`}
                  <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '\u25B4' : '\u25BE'}</span>
                </button>
                {catOpen && (
                  <div className="growth-cat-dropdown">
                    <label className="growth-cat-option" style={{ borderBottom: '1px solid #0f3460', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                      <input type="checkbox" checked={selCats.length === 0} onChange={() => setSelCats([])} />
                      <span>All Holdings</span>
                    </label>
                    {categoryList.map(name => (
                      <label key={name} className="growth-cat-option">
                        <input type="checkbox" checked={selCats.includes(name)}
                          onChange={e => {
                            if (e.target.checked) setSelCats(prev => [...prev, name])
                            else setSelCats(prev => prev.filter(c => c !== name))
                          }} />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="summary-strip">
            <MetricCard label="8% of Cost / Week" value={fmt(totals.w8_weekly)} />
            <MetricCard label="8% of Cost / Month" value={fmt(totals.w8_monthly)} />
            <MetricCard label="8% of Cost / Year" value={fmt(totals.w8_annually)} />
            <MetricCard label="Est Monthly Dividends" value={fmt(totals.est_monthly_div)} />
          </div>

          <div className="sticky-table-wrap" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={col.key}
                        style={col.align ? { textAlign: col.align } : undefined}
                        onClick={() => handleSort(col.key)}>
                      {col.label}{arrow(col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr key={row.ticker + i}>
                    {columns.map(col => {
                      const val = row[col.key]
                      const style = {}
                      if (col.align) style.textAlign = col.align
                      if (col.color) { const c = col.color(val); if (c) style.color = c }
                      return (
                        <td key={col.key} style={Object.keys(style).length ? style : undefined}>
                          {col.fmt ? col.fmt(val) : val}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, background: '#0f3460' }}>
                  <td colSpan={7} style={{ textAlign: 'right' }}>Totals</td>
                  <td style={{ textAlign: 'right' }}>{fmt(totals.est_monthly_div)}</td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: 'right' }}>{fmt(totals.w8_weekly)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(totals.w8_monthly)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(totals.w8_annually)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
