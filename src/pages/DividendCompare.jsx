import React, { useState, useEffect, useMemo } from 'react'
import { API_BASE } from '../config'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const fmt = (v) => v == null ? '—' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v) => v == null ? '—' : (Number(v) * 100).toFixed(2) + '%'
const fmt4 = (v) => v == null ? '—' : '$' + Number(v).toFixed(4)

function DivTable({ rows, showQty, sortCol, sortAsc, onSort, title }) {
  const sorted = useMemo(() => {
    if (!sortCol) return rows
    return [...rows].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      if (av == null) av = sortAsc ? Infinity : -Infinity
      if (bv == null) bv = sortAsc ? Infinity : -Infinity
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? av - bv : bv - av
    })
  }, [rows, sortCol, sortAsc])

  const SortHeader = ({ col, children, align, tip }) => (
    <th
      onClick={() => onSort(col)}
      style={{ cursor: 'pointer', textAlign: align || 'left', userSelect: 'none' }}
      title={tip || ''}
    >
      {children} {sortCol === col ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  const na = (entry, field) => {
    if (entry.error && entry[field] == null) return <span style={{ color: '#666', fontSize: '0.75rem' }}>N/A</span>
    return null
  }

  // Totals for holdings
  const totals = useMemo(() => {
    if (!showQty) return null
    return {
      ttm_income: rows.reduce((s, r) => s + (r.ttm_income || 0), 0),
      forward_income: rows.reduce((s, r) => s + (r.forward_income || 0), 0),
    }
  }, [rows, showQty])

  return (
    <div className="holdings-table-wrap" style={{ marginBottom: '1.5rem' }}>
      {title && <h2 style={{ color: '#90caf9', padding: '0.75rem 1rem 0', margin: 0 }}>{title}</h2>}
      <table className="holdings-table">
        <thead>
          <tr>
            <SortHeader col="ticker">Ticker</SortHeader>
            <SortHeader col="description" tip="Security name">Description</SortHeader>
            <SortHeader col="div_frequency" align="center" tip="Dividend frequency">Freq</SortHeader>
            <SortHeader col="current_price" align="right">Price</SortHeader>
            {showQty && <SortHeader col="quantity" align="right">Qty</SortHeader>}
            <SortHeader col="forward_annual_dividend" align="right" tip="Forward annual dividend per share (projected by yfinance)">Fwd Ann. Div/Sh</SortHeader>
            <SortHeader col="forward_dividend_yield" align="right" tip="Forward annual dividend yield (forward div ÷ price)">Fwd Ann. Yield</SortHeader>
            {showQty && <SortHeader col="forward_income" align="right" tip="Estimated annual income based on forward dividend rate (div × qty)">Fwd Ann. Income</SortHeader>}
            <SortHeader col="ttm_dividend" align="right" tip="Trailing 12-month total dividends per share (sum of actual payments over past year)">TTM Div/Sh</SortHeader>
            <SortHeader col="ttm_dividend_yield" align="right" tip="Trailing 12-month dividend yield (TTM div ÷ price)">TTM Ann. Yield</SortHeader>
            {showQty && <SortHeader col="ttm_income" align="right" tip="Actual income received per share over the trailing 12 months × quantity">TTM Ann. Income</SortHeader>}
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.ticker}>
              <td style={{ color: '#7ecfff', fontWeight: 600 }}>{r.ticker}</td>
              <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
              <td style={{ textAlign: 'center' }}>{r.div_frequency || '—'}</td>
              <td style={{ textAlign: 'right' }}>{fmt(r.current_price)}</td>
              {showQty && <td style={{ textAlign: 'right' }}>{r.quantity != null ? (Number.isInteger(r.quantity) ? r.quantity : parseFloat(r.quantity.toFixed(3))) : '—'}</td>}
              <td style={{ textAlign: 'right', color: r.forward_annual_dividend != null ? '#4dff91' : undefined }}>
                {na(r, 'forward_annual_dividend') || fmt4(r.forward_annual_dividend)}
              </td>
              <td style={{ textAlign: 'right', color: r.forward_dividend_yield != null ? '#4dff91' : undefined }}>
                {na(r, 'forward_dividend_yield') || pct(r.forward_dividend_yield)}
              </td>
              {showQty && (
                <td style={{ textAlign: 'right', color: r.forward_income != null ? '#4dff91' : undefined }}>
                  {na(r, 'forward_income') || fmt(r.forward_income)}
                </td>
              )}
              <td style={{ textAlign: 'right', color: r.ttm_dividend != null ? '#7ecfff' : undefined }}>
                {na(r, 'ttm_dividend') || fmt4(r.ttm_dividend)}
              </td>
              <td style={{ textAlign: 'right', color: r.ttm_dividend_yield != null ? '#7ecfff' : undefined }}>
                {na(r, 'ttm_dividend_yield') || pct(r.ttm_dividend_yield)}
              </td>
              {showQty && (
                <td style={{ textAlign: 'right', color: r.ttm_income != null ? '#7ecfff' : undefined }}>
                  {na(r, 'ttm_income') || fmt(r.ttm_income)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid #0f3460' }}>
              <td colSpan={showQty ? 7 : 6} style={{ textAlign: 'right' }}>Totals</td>
              {showQty && <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.forward_income)}</td>}
              <td colSpan={2} />
              {showQty && <td style={{ textAlign: 'right', color: '#7ecfff' }}>{fmt(totals.ttm_income)}</td>}
            </tr>
          </tfoot>
        )}
      </table>
      {rows.length === 0 && (
        <p style={{ color: '#8899aa', textAlign: 'center', padding: '1rem' }}>No data to display.</p>
      )}
    </div>
  )
}

export default function DividendCompare() {
  const pf = useProfileFetch()
  const { selection, currentProfileName } = useProfile()
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [holdingSortCol, setHoldingSortCol] = useState(null)
  const [holdingSortAsc, setHoldingSortAsc] = useState(true)

  const [lookupInput, setLookupInput] = useState('')
  const [lookupResults, setLookupResults] = useState([])
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupSortCol, setLookupSortCol] = useState(null)
  const [lookupSortAsc, setLookupSortAsc] = useState(true)

  useEffect(() => {
    let stale = false
    setLoading(true)
    pf('/api/dividend-compare/holdings')
      .then(r => r.json())
      .then(data => { if (!stale) { setHoldings(data); setLoading(false) } })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [pf, selection])

  const handleHoldingSort = (col) => {
    setHoldingSortAsc(prev => holdingSortCol === col ? !prev : (typeof holdings[0]?.[col] === 'string'))
    setHoldingSortCol(col)
  }

  const handleLookupSort = (col) => {
    setLookupSortAsc(prev => lookupSortCol === col ? !prev : (typeof lookupResults[0]?.[col] === 'string'))
    setLookupSortCol(col)
  }

  const handleLookup = () => {
    const tickers = lookupInput
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0)
    if (tickers.length === 0) return

    setLookupLoading(true)
    fetch(`${API_BASE}/api/dividend-compare/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    })
      .then(r => r.json())
      .then(data => {
        setLookupResults(prev => {
          const existing = new Map(prev.map(r => [r.ticker, r]))
          data.forEach(r => existing.set(r.ticker, r))
          return [...existing.values()]
        })
        setLookupLoading(false)
      })
      .catch(() => setLookupLoading(false))
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLookup()
  }

  const clearLookup = () => {
    setLookupResults([])
    setLookupInput('')
  }

  if (loading) {
    return <div className="page" style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
  }

  return (
    <div className="page">
      <h1>Dividend Compare — Forward vs TTM</h1>
      <p style={{ color: '#8899aa', fontSize: '0.85rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
        {currentProfileName} — {holdings.length} holding{holdings.length !== 1 ? 's' : ''}
      </p>

      <DivTable
        rows={holdings}
        showQty
        sortCol={holdingSortCol}
        sortAsc={holdingSortAsc}
        onSort={handleHoldingSort}
        title="Portfolio Holdings"
      />

      {/* Ticker Lookup Section */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
        <h2 style={{ color: '#90caf9', margin: '0 0 0.75rem' }}>Look Up Tickers</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            placeholder="Enter tickers separated by commas or spaces (e.g. SCHD, VIG, JEPI)"
            style={{ flex: 1, minWidth: '300px' }}
          />
          <button className="btn btn-primary" onClick={handleLookup} disabled={lookupLoading}>
            {lookupLoading ? 'Looking up...' : 'Look Up'}
          </button>
          {lookupResults.length > 0 && (
            <button className="btn btn-secondary" onClick={clearLookup}>Clear</button>
          )}
        </div>
      </div>

      {lookupResults.length > 0 && (
        <DivTable
          rows={lookupResults}
          showQty={false}
          sortCol={lookupSortCol}
          sortAsc={lookupSortAsc}
          onSort={handleLookupSort}
          title="Lookup Results"
        />
      )}
    </div>
  )
}
