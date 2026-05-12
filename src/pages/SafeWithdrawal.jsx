import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const fmt = v => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u2014'
const fmtDate = v => v || '\u2014'
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v))

function MetricCard({ label, value, valueColor }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value" style={valueColor ? { color: valueColor } : undefined}>{value ?? '\u2014'}</div>
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
  const [pct, setPct] = useState(8)
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
    const monthlyNotReinvested = r.monthly_income_not_reinvested || 0
    const hasDividend = monthlyDiv > 0
    const cashIncomeRatio = hasDividend ? clamp(monthlyNotReinvested / monthlyDiv) : 0
    const cashCost = cost * cashIncomeRatio
    const yieldOnCost = cost > 0 ? ((r.estim_payment_per_year || 0) / cost) * 100 : 0
    const sustainable = hasDividend && yieldOnCost >= pct
    const rate = pct / 100
    return {
      ticker: r.ticker,
      category: r.category || r.classification_type || '',
      frequency: r.div_frequency || '',
      purchase_date: r.purchase_date || '',
      price_paid: r.price_paid || 0,
      current_price: r.current_price || 0,
      quantity: r.quantity || 0,
      est_monthly_div: monthlyDiv,
      monthly_not_reinvested: monthlyNotReinvested,
      monthly_reinvested: Math.max(0, monthlyDiv - monthlyNotReinvested),
      cost,
      cash_cost_after_drip: cashCost,
      annual_div: r.estim_payment_per_year || 0,
      yield_on_cost: yieldOnCost,
      current_yield: (r.current_annual_yield || 0) * 100,
      w8_weekly: hasDividend ? cashCost * rate / 52 : 0,
      w8_monthly: hasDividend ? cashCost * rate / 12 : 0,
      w8_annually: hasDividend ? cashCost * rate : 0,
      status: !hasDividend ? 'No Distribution' : !sustainable ? 'Distribution rate too low' : '',
    }
  }), [rows, pct])

  const categoryList = useMemo(() => {
    const names = [...new Set(allComputed.map(r => r.category).filter(Boolean))].sort()
    return names
  }, [allComputed])

  const computed = useMemo(() => {
    if (selCats.length === 0) return allComputed
    return allComputed.filter(r => selCats.includes(r.category))
  }, [allComputed, selCats])

  const totals = useMemo(() => {
    const totalCost = computed.reduce((s, r) => s + r.cost, 0)
    const totalAnnualDiv = computed.reduce((s, r) => s + r.annual_div, 0)
    const totalMonthlyDiv = computed.reduce((s, r) => s + r.est_monthly_div, 0)
    const totalMonthlyDrip = computed.reduce((s, r) => s + r.monthly_reinvested, 0)
    const hasDrip = totalMonthlyDrip > 0.005
    const freeCashMonthly = hasDrip
      ? Math.max(0, totalMonthlyDiv - totalMonthlyDrip)
      : totalMonthlyDiv
    const freeCashWeekly = freeCashMonthly * 12 / 52
    const freeCashAnnually = freeCashMonthly * 12
    const w8Weekly = computed.reduce((s, r) => s + r.w8_weekly, 0)
    const w8Monthly = computed.reduce((s, r) => s + r.w8_monthly, 0)
    const w8Annually = computed.reduce((s, r) => s + r.w8_annually, 0)
    const cashRemainingWeekly = Math.max(0, freeCashWeekly - w8Weekly)
    const cashRemainingMonthly = Math.max(0, freeCashMonthly - w8Monthly)
    const cashRemainingAnnually = Math.max(0, freeCashAnnually - w8Annually)
    return {
      has_drip: hasDrip,
      est_monthly_div: totalMonthlyDiv,
      drip_monthly: totalMonthlyDrip,
      w8_weekly: w8Weekly,
      w8_monthly: w8Monthly,
      w8_annually: w8Annually,
      free_cash_weekly: freeCashWeekly,
      free_cash_monthly: freeCashMonthly,
      free_cash_annually: freeCashAnnually,
      cash_remaining_weekly: cashRemainingWeekly,
      cash_remaining_monthly: cashRemainingMonthly,
      cash_remaining_annually: cashRemainingAnnually,
      no_cash_left_weekly: freeCashWeekly > 0 && freeCashWeekly - w8Weekly <= 0,
      no_cash_left_monthly: freeCashMonthly > 0 && freeCashMonthly - w8Monthly <= 0,
      no_cash_left_annually: freeCashAnnually > 0 && freeCashAnnually - w8Annually <= 0,
      no_cash_left: freeCashMonthly > 0 && freeCashMonthly - w8Monthly <= 0,
      break_even_pct: totalCost > 0 ? (totalAnnualDiv / totalCost) * 100 : 0,
    }
  }, [computed, pct])

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
    { key: 'w8_weekly',      label: `${pct}% Cost / Week`,  fmt, align: 'right' },
    { key: 'w8_monthly',     label: `${pct}% Cost / Month`, fmt, align: 'right' },
    { key: 'w8_annually',    label: `${pct}% Cost / Year`,  fmt, align: 'right' },
    { key: 'status',         label: 'Status', fmt: v => v || '', color: v => v ? '#ff6b6b' : undefined },
  ]

  const arrow = key => sortCol === key ? (sortAsc ? ' \u25B4' : ' \u25BE') : ''

  return (
    <div className="page">
      <h1>Safe Withdrawal Amount</h1>
      <p style={{ color: '#8899aa', marginTop: '-1rem', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
        Estimates dividend cash left after DRIP and a {pct}% withdrawal target based on purchase cost.
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
              <div className="growth-filter-group">
                <label>Percent of Cost</label>
                <select className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                  value={pct} onChange={e => setPct(Number(e.target.value))}>
                  {Array.from({ length: 30 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}%</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="summary-strip">
            <MetricCard label={totals.has_drip ? 'Monthly Dividend Estimate Before DRIP' : 'Monthly Dividend Estimate'} value={fmt(totals.est_monthly_div)} />
            {totals.has_drip && (
              <MetricCard label="Monthly Dividends Reinvested by DRIP" value={fmt(totals.drip_monthly)} />
            )}
            <MetricCard label={totals.has_drip ? 'Yearly Cash Available After DRIP Before Withdrawal' : 'Yearly Cash Available Before Withdrawal'} value={fmt(totals.free_cash_annually)} />
            <MetricCard label={totals.has_drip ? 'Monthly Cash Available After DRIP Before Withdrawal' : 'Monthly Cash Available Before Withdrawal'} value={fmt(totals.free_cash_monthly)} />
            <MetricCard label={totals.has_drip ? 'Weekly Cash Available After DRIP Before Withdrawal' : 'Weekly Cash Available Before Withdrawal'} value={fmt(totals.free_cash_weekly)} />
            <MetricCard label={`${pct}% of Cost Withdrawn Yearly`} value={fmt(totals.w8_annually)} />
            <MetricCard label={`${pct}% of Cost Withdrawn Monthly`} value={fmt(totals.w8_monthly)} />
            <MetricCard label={`${pct}% of Cost Withdrawn Weekly`} value={fmt(totals.w8_weekly)} />
            <MetricCard label={totals.has_drip ? 'Yearly Cash Left After DRIP and Withdrawal' : 'Yearly Cash Left After Withdrawal'} value={fmt(totals.cash_remaining_annually)} valueColor={totals.no_cash_left_annually ? '#ff6b6b' : undefined} />
            <MetricCard label={totals.has_drip ? 'Monthly Cash Left After DRIP and Withdrawal' : 'Monthly Cash Left After Withdrawal'} value={fmt(totals.cash_remaining_monthly)} valueColor={totals.no_cash_left_monthly ? '#ff6b6b' : undefined} />
            <MetricCard label={totals.has_drip ? 'Weekly Cash Left After DRIP and Withdrawal' : 'Weekly Cash Left After Withdrawal'} value={fmt(totals.cash_remaining_weekly)} valueColor={totals.no_cash_left_weekly ? '#ff6b6b' : undefined} />
            {totals.no_cash_left && (
              <MetricCard label="Cash Status" value="No more cash left to withdraw" valueColor="#ff6b6b" />
            )}
            <MetricCard label="Break-even % (Portfolio YoC)"
              value={`${totals.break_even_pct.toFixed(2)}%`}
              valueColor={pct > totals.break_even_pct ? '#ff6b6b' : '#4ade80'} />
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
