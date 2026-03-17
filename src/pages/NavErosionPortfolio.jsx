import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { API_BASE } from '../config'

const MAX_ROWS = 80

function fmt$(v) {
  return '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + parseFloat(v).toFixed(2) + '%'
}

function StatTile({ label, value, color, sub }) {
  return (
    <div className="nep-stat-tile">
      <div className="nep-stat-val" style={{ color }}>{value}</div>
      <div className="nep-stat-lbl">{label}</div>
      {sub && <div className="nep-stat-sub">{sub}</div>}
    </div>
  )
}

export default function NavErosionPortfolio() {
  const [startDate, setStartDate] = useState('2015-01-01')
  const [endDate, setEndDate] = useState('2025-12-31')
  const [gridRows, setGridRows] = useState([{ ticker: '', amount: '', reinvest_pct: '' }])
  const [savedList, setSavedList] = useState([])
  const [selectedSaved, setSelectedSaved] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)
  const [savedMsg, setSavedMsg] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState(false)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  // Save backtest form
  const [btFormOpen, setBtFormOpen] = useState(false)
  const [btName, setBtName] = useState('')
  const [btOverwrite, setBtOverwrite] = useState(true)
  const [btError, setBtError] = useState(null)

  // Load saved list and ETF list on mount
  const loadSavedList = useCallback(() => {
    fetch(`${API_BASE}/api/nav-erosion-portfolio/saved`)
      .then(r => r.json())
      .then(d => setSavedList(d.saved || []))
      .catch(() => {})
  }, [])

  const loadEtfList = useCallback(() => {
    fetch(`${API_BASE}/api/nav-erosion-portfolio/list`)
      .then(r => r.json())
      .then(d => {
        if (d.rows && d.rows.length > 0) {
          setGridRows(d.rows.map(r => ({
            ticker: r.ticker, amount: String(r.amount), reinvest_pct: String(r.reinvest_pct)
          })))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => { loadSavedList(); loadEtfList() }, [loadSavedList, loadEtfList])

  const updateRow = (idx, field, value) => {
    setGridRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const removeRow = (idx) => {
    setGridRows(prev => prev.filter((_, i) => i !== idx))
  }

  const addRow = () => {
    if (gridRows.length >= MAX_ROWS) return
    setGridRows(prev => [...prev, { ticker: '', amount: '', reinvest_pct: '' }])
  }

  const clearGrid = () => {
    setGridRows([{ ticker: '', amount: '', reinvest_pct: '' }])
    // Also clear the persisted list
    fetch(`${API_BASE}/api/nav-erosion-portfolio/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [] }),
    })
  }

  // Filter out empty rows (no ticker entered)
  const collectRows = (src) => src
    .map(r => ({ ticker: r.ticker.trim().toUpperCase(), amount: parseFloat(r.amount) || 0, reinvest_pct: parseFloat(r.reinvest_pct) || 0 }))
    .filter(r => r.ticker)

  const saveList = useCallback(() => {
    const rows = collectRows(gridRows)
    return fetch(`${API_BASE}/api/nav-erosion-portfolio/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return false }
        setSavedMsg(true)
        setTimeout(() => setSavedMsg(false), 2500)
        return true
      })
  }, [gridRows])

  const loadSaved = () => {
    if (!selectedSaved) return
    fetch(`${API_BASE}/api/nav-erosion-portfolio/saved/` + selectedSaved)
      .then(r => r.json())
      .then(d => {
        if (d.error) { alert(d.error); return }
        if (d.start) setStartDate(d.start)
        if (d.end) setEndDate(d.end)
        const rows = (d.rows || []).map(r => ({
          ticker: r.ticker || '', amount: String(r.amount || ''), reinvest_pct: String(r.reinvest_pct || '')
        }))
        setGridRows(rows.length > 0 ? rows : [{ ticker: '', amount: '', reinvest_pct: '' }])
        setResults(null)
      })
      .catch(err => alert('Load failed: ' + err.message))
  }

  const deleteSaved = () => {
    if (!selectedSaved) return
    const sel = savedList.find(s => String(s.id) === selectedSaved)
    if (!confirm('Delete saved backtest "' + (sel?.name || '') + '"?')) return
    fetch(`${API_BASE}/api/nav-erosion-portfolio/saved/` + selectedSaved, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => {
        if (d.error) { alert(d.error); return }
        setDeleteMsg(true)
        setTimeout(() => setDeleteMsg(false), 2000)
        setSelectedSaved('')
        loadSavedList()
      })
  }

  const showSaveBtForm = () => {
    const sel = savedList.find(s => String(s.id) === selectedSaved)
    setBtName(sel ? sel.name : '')
    setBtOverwrite(!!selectedSaved)
    setBtError(null)
    setBtFormOpen(true)
  }

  const confirmSaveBt = () => {
    const name = btName.trim()
    if (!name) { setBtError('Please enter a name.'); return }
    const rows = collectRows(gridRows)
    const overwrite = btOverwrite && !!selectedSaved
    const url = overwrite ? `${API_BASE}/api/nav-erosion-portfolio/saved/${selectedSaved}` : `${API_BASE}/api/nav-erosion-portfolio/saved`
    const method = overwrite ? 'PUT' : 'POST'

    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, start: startDate, end: endDate, rows }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setBtError(d.error); return }
        const savedId = overwrite ? selectedSaved : String(d.id)
        setBtFormOpen(false)
        setBtName('')
        loadSavedList()
        setTimeout(() => setSelectedSaved(savedId), 300)
      })
      .catch(err => setBtError('Save failed: ' + err.message))
  }

  const runBacktest = () => {
    setError(null)
    setResults(null)
    setLoading(true)

    const rows = collectRows(gridRows)

    // Save list first, then run
    fetch(`${API_BASE}/api/nav-erosion-portfolio/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    }).then(() => {
      fetch(`${API_BASE}/api/nav-erosion-portfolio/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startDate, end: endDate, rows }),
      })
        .then(r => r.json())
        .then(data => {
          setLoading(false)
          if (data.error) { setError(data.error); return }
          setResults(data.results || [])
        })
        .catch(err => {
          setLoading(false)
          setError('Request failed: ' + err.message)
        })
    })
  }

  // Sorting results
  const colKeys = ['ticker', 'amount', 'reinvest_pct', 'start_price', 'end_price',
    'price_delta_pct', 'total_dist', 'total_reinvested', 'final_value',
    'gain_loss_dollar', 'gain_loss_pct', 'total_return_dollar', 'total_return_pct',
    'has_erosion', 'final_deficit', 'warning']

  const sortedResults = useMemo(() => {
    if (!results) return []
    const arr = [...results]
    if (sortCol !== null) {
      const key = colKeys[sortCol]
      arr.sort((a, b) => {
        let aV = a[key] ?? '', bV = b[key] ?? ''
        if (key === 'has_erosion') { aV = aV ? 1 : 0; bV = bV ? 1 : 0 }
        if (typeof aV === 'number' && typeof bV === 'number')
          return sortAsc ? aV - bV : bV - aV
        return sortAsc ? String(aV).localeCompare(String(bV)) : String(bV).localeCompare(String(aV))
      })
    }
    return arr
  }, [results, sortCol, sortAsc])

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }
  const arrow = (col) => sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  // Summary
  const summary = useMemo(() => {
    if (!results || results.length === 0) return null
    let totAmount = 0, totDist = 0, totReinv = 0, totFinal = 0, totGL = 0, totTR = 0
    let erosionCount = 0, validCount = 0, errorCount = 0
    let best = null, worst = null
    results.forEach(r => {
      if (r.error && !r.start_price) { errorCount++; return }
      validCount++
      totAmount += r.amount || 0
      totDist += r.total_dist || 0
      totReinv += r.total_reinvested || 0
      totFinal += r.final_value || 0
      totGL += r.gain_loss_dollar || 0
      totTR += r.total_return_dollar || 0
      if (r.has_erosion) erosionCount++
      if (best === null || r.total_return_pct > best.total_return_pct) best = r
      if (worst === null || r.total_return_pct < worst.total_return_pct) worst = r
    })
    const totGLPct = totAmount > 0 ? totGL / totAmount * 100 : 0
    return {
      totAmount, totDist, totReinv, totFinal, totGL, totTR, totGLPct,
      erosionCount, validCount, errorCount, best, worst,
    }
  }, [results])

  const headers = ['Ticker', 'Amount', 'Reinvest %', 'Start Price', 'End Price',
    'Price \u0394%', 'Total Distributions', 'Total Reinvested', 'Final Value',
    'Gain/Loss $', 'Gain/Loss %', 'Total Return $', 'Total Return %',
    'NAV Erosion', 'Shares Deficit', 'Note']

  return (
    <div className="nep-page">
      <h1 style={{ marginBottom: '0.3rem' }}>NAV Erosion Portfolio Screener</h1>
      <p className="ne-desc">
        Compare up to {MAX_ROWS} ETFs side-by-side using the same NAV erosion calculation. Each ETF can have
        its own starting dollar amount and reinvestment percentage. Your list is saved to the database
        and will persist between sessions.
        <br />
        <span style={{ color: '#e05555', fontWeight: 600 }}>NAV Erosion = Yes</span> means the ETF's share-price
        decline has outpaced distributions — you'd need more shares than you hold to recover your principal
        at the ending price.
      </p>

      {/* Global date inputs */}
      <div className="ne-form" style={{ marginBottom: '1rem' }}>
        <div className="ne-field">
          <label className="ne-label">Start Date</label>
          <input className="ne-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="ne-field">
          <label className="ne-label">End Date</label>
          <input className="ne-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {/* Saved Backtests panel */}
      <div className="nep-saved-panel">
        <span className="nep-saved-label">Saved Backtests:</span>
        <select className="nep-saved-select" value={selectedSaved} onChange={e => setSelectedSaved(e.target.value)}>
          <option value="">— no saved backtests —</option>
          {savedList.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}  ({s.start_date || '?'} → {s.end_date || '?'})  [{s.created_at}]
            </option>
          ))}
        </select>
        <button className="nep-btn" onClick={loadSaved}>Load</button>
        <button className="nep-btn nep-btn-del" onClick={deleteSaved}>Delete</button>
        {deleteMsg && <span style={{ color: '#00c853', fontSize: '0.78rem' }}>Deleted</span>}
      </div>

      {/* ETF input grid */}
      <div className="nep-grid-panel">
        <div style={{ overflowX: 'auto' }}>
          <table className="nep-grid-tbl">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', width: 120 }}>Ticker</th>
                <th style={{ textAlign: 'right', width: 180 }}>Initial Investment ($)</th>
                <th style={{ textAlign: 'right', width: 220 }}>% of Divs to Reinvest</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {gridRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input
                      className="ne-input"
                      style={{ width: 90, textTransform: 'uppercase' }}
                      maxLength={10}
                      placeholder="e.g. JEPI"
                      value={r.ticker}
                      onChange={e => updateRow(i, 'ticker', e.target.value.toUpperCase())}
                    />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input
                      className="ne-input"
                      type="number"
                      min="1"
                      step="100"
                      style={{ width: 120, textAlign: 'right' }}
                      placeholder="e.g. 10000"
                      value={r.amount}
                      onChange={e => updateRow(i, 'amount', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem' }}>
                    <input
                      className="ne-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      style={{ width: 220, textAlign: 'right' }}
                      placeholder="0 = cash, 100 = full DRIP"
                      value={r.reinvest_pct}
                      onChange={e => updateRow(i, 'reinvest_pct', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem', textAlign: 'center' }}>
                    <button className="nep-row-del" title="Remove" onClick={() => removeRow(i)}>&times;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Action buttons */}
        <div className="nep-actions">
          <button className="nep-btn" onClick={addRow} disabled={gridRows.length >= MAX_ROWS}>+ Add ETF</button>
          <button className="nep-btn" onClick={clearGrid}>Clear</button>
          <button className="nep-btn" onClick={saveList}>Save List</button>
          <button className="nep-btn nep-btn-purple" onClick={showSaveBtForm}>Save Backtest&hellip;</button>
          <button className="ne-run-btn" onClick={runBacktest} disabled={loading}>Run Backtest</button>
          {savedMsg && <span style={{ color: '#00c853', fontSize: '0.82rem' }}>Saved</span>}
          <span style={{ color: '#555', fontSize: '0.78rem', marginLeft: 'auto' }}>
            {gridRows.length} / {MAX_ROWS} ETFs
          </span>
        </div>

        {/* Save backtest form */}
        {btFormOpen && (
          <div className="nep-bt-form">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.78rem', color: '#a78bfa', whiteSpace: 'nowrap' }}>Backtest name:</label>
              <input
                className="ne-input"
                style={{ flex: 1, minWidth: 220, borderColor: '#a78bfa' }}
                maxLength={200}
                placeholder="e.g. High-yield vs SPY 2020-2025"
                value={btName}
                onChange={e => setBtName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmSaveBt()
                  if (e.key === 'Escape') setBtFormOpen(false)
                }}
                autoFocus
              />
              <button className="nep-btn nep-btn-purple" style={{ fontWeight: 600 }} onClick={confirmSaveBt}>Save</button>
              <button className="nep-btn" onClick={() => setBtFormOpen(false)}>Cancel</button>
            </div>
            {selectedSaved && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.3rem' }}>
                <input
                  type="checkbox"
                  checked={btOverwrite}
                  onChange={e => setBtOverwrite(e.target.checked)}
                  style={{ accentColor: '#a78bfa', width: 14, height: 14, cursor: 'pointer' }}
                  id="nep-bt-overwrite"
                />
                <label htmlFor="nep-bt-overwrite" style={{ fontSize: '0.78rem', color: '#aaa', cursor: 'pointer' }}>
                  Overwrite selected backtest (uncheck to save as new)
                </label>
              </div>
            )}
            {btError && <span style={{ color: '#e05555', fontSize: '0.78rem' }}>{btError}</span>}
          </div>
        )}
      </div>

      {/* Spinner */}
      {loading && (
        <div className="wl-spinner">
          <div className="wl-spin-circle" />
          <p>Fetching price data &amp; calculating&hellip;</p>
        </div>
      )}

      {/* Error */}
      {error && <div className="wl-error">{error}</div>}

      {/* Results */}
      {results && !loading && (
        <div style={{ marginTop: '0.6rem' }}>
          <h2 style={{ marginTop: 0, marginBottom: '0.7rem', fontSize: '1rem', color: '#ccc' }}>Results</h2>

          {/* Summary strip */}
          {summary && (
            <div className="nep-summary">
              <StatTile label="Total Invested" value={fmt$(summary.totAmount)} color="#7ecfff" />
              <StatTile label="Total Final Value" value={fmt$(summary.totFinal)} color="#7ecfff" />
              <StatTile label="Total Gain / Loss" value={fmt$(summary.totGL)} color={summary.totGL >= 0 ? '#00c853' : '#e05555'} />
              <StatTile label="Portfolio Return" value={fmtPct(summary.totGLPct)} color={summary.totGLPct >= 0 ? '#00c853' : '#e05555'} />
              <StatTile label="Total Distributions" value={fmt$(summary.totDist)} color="#7ecfff" />
              <StatTile label="Total Reinvested" value={fmt$(summary.totReinv)} color="#7ecfff" />
              <StatTile
                label="NAV Erosion"
                value={summary.erosionCount + ' of ' + summary.validCount}
                color={summary.erosionCount > 0 ? '#e05555' : '#00c853'}
                sub="funds showing erosion"
              />
              {summary.best && (
                <StatTile
                  label="Best Performer"
                  value={<span style={{ color: '#00c853', fontWeight: 700 }}>{summary.best.ticker}</span>}
                  color="#00c853"
                  sub={fmtPct(summary.best.total_return_pct || 0)}
                />
              )}
              {summary.worst && (
                <StatTile
                  label="Worst Performer"
                  value={<span style={{ color: '#e05555', fontWeight: 700 }}>{summary.worst.ticker}</span>}
                  color="#e05555"
                  sub={fmtPct(summary.worst.total_return_pct || 0)}
                />
              )}
              {summary.errorCount > 0 && (
                <StatTile label="No Data" value={summary.errorCount + ' ticker' + (summary.errorCount > 1 ? 's' : '')} color="#f9a825" sub="check Note column" />
              )}
            </div>
          )}

          <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', color: '#666', fontWeight: 400 }}>
            Detail &mdash; click any header to sort
          </h3>

          <div className="nep-tbl-wrap">
            <table className="sst" id="nep-tbl">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={h} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }}>
                      {h}{arrow(i)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r, idx) => {
                  if (r.error && !r.start_price) {
                    return (
                      <tr key={idx}>
                        <td><strong>{r.ticker}</strong></td>
                        <td>{fmt$(r.amount || 0)}</td>
                        <td>{(r.reinvest_pct || 0)}%</td>
                        <td colSpan={12} style={{ textAlign: 'left', color: '#e05555' }}>{r.error}</td>
                        <td></td>
                      </tr>
                    )
                  }
                  const pCls = r.price_delta_pct < 0 ? 'pct-down' : (r.price_delta_pct > 0 ? 'pct-up' : '')
                  const glCls = r.gain_loss_dollar < 0 ? 'pct-down' : 'pct-up'
                  const glPCls = r.gain_loss_pct < 0 ? 'pct-down' : 'pct-up'
                  const trCls = (r.total_return_dollar || 0) < 0 ? 'pct-down' : 'pct-up'
                  const trPCls = (r.total_return_pct || 0) < 0 ? 'pct-down' : 'pct-up'
                  const defCls = r.final_deficit > 0 ? 'ne-deficit' : 'ne-surplus'
                  return (
                    <tr key={idx}>
                      <td><strong>{r.ticker}</strong></td>
                      <td>{fmt$(r.amount)}</td>
                      <td>{r.reinvest_pct}%</td>
                      <td>{fmt$(r.start_price)}</td>
                      <td>{fmt$(r.end_price)}</td>
                      <td className={pCls}>{fmtPct(r.price_delta_pct)}</td>
                      <td>{fmt$(r.total_dist)}</td>
                      <td>{fmt$(r.total_reinvested)}</td>
                      <td>{fmt$(r.final_value)}</td>
                      <td className={glCls}>{fmt$(r.gain_loss_dollar)}</td>
                      <td className={glPCls}>{fmtPct(r.gain_loss_pct)}</td>
                      <td className={trCls}>{fmt$(r.total_return_dollar || 0)}</td>
                      <td className={trPCls}>{fmtPct(r.total_return_pct || 0)}</td>
                      <td>
                        {r.has_erosion
                          ? <span style={{ color: '#e05555', fontWeight: 700 }}>Yes</span>
                          : <span style={{ color: '#00c853', fontWeight: 700 }}>No</span>}
                      </td>
                      <td className={defCls}>{parseFloat(r.final_deficit).toFixed(4)}</td>
                      <td style={{ textAlign: 'left', fontSize: '0.78rem', color: '#aaa' }}>
                        {r.warning
                          ? <span title={r.warning} style={{ cursor: 'help' }}>&#9888; {r.warning.substring(0, 40)}{r.warning.length > 40 ? '\u2026' : ''}</span>
                          : <span style={{ color: '#555' }}>{'\u2014'}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {summary && (
                <tfoot>
                  <tr>
                    <td><strong>TOTAL</strong></td>
                    <td>{fmt$(summary.totAmount)}</td>
                    <td></td><td></td><td></td><td></td>
                    <td>{fmt$(summary.totDist)}</td>
                    <td>{fmt$(summary.totReinv)}</td>
                    <td>{fmt$(summary.totFinal)}</td>
                    <td className={summary.totGL >= 0 ? 'pct-up' : 'pct-down'}>{fmt$(summary.totGL)}</td>
                    <td></td>
                    <td className={summary.totTR >= 0 ? 'pct-up' : 'pct-down'}>{fmt$(summary.totTR)}</td>
                    <td></td><td></td><td></td><td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
