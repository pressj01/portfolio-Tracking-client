import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'

const MAX_ROWS = 80

function fmt$(v) {
  return '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + parseFloat(v).toFixed(2) + '%'
}
function fmtAbs4(v) {
  return Math.abs(parseFloat(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}
function fmtAbsPct(v) {
  return Math.abs(parseFloat(v || 0)).toFixed(2) + '%'
}
function shareGapPct(deficit, amount, endPrice) {
  const breakevenShares = endPrice > 0 ? amount / endPrice : 0
  return breakevenShares ? (deficit / breakevenShares) * 100 : 0
}
function shareGapKind(deficit) {
  if (deficit > 0) return 'needed'
  if (deficit < 0) return 'extra'
  return 'at breakeven'
}
function navSeverityFromRatio(v) {
  if (v == null) return null
  return v > 0.75 ? 'High' : v > 0.25 ? 'Medium' : 'Low'
}
function navSeverityColor(severity) {
  return severity === 'High' ? '#e05555' : severity === 'Medium' ? '#ffb300' : severity === 'Low' ? '#00c853' : '#666'
}
function navSeverityText(severity, portfolio = false) {
  const scope = portfolio ? 'Portfolio NAV Erosion' : 'NAV Erosion'
  return severity === 'High' ? `High Benchmark-Adjusted ${scope}` : severity === 'Medium' ? `Moderate Benchmark-Adjusted ${scope}` : `Low Benchmark-Adjusted ${scope}`
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
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const dialog = useDialog()
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

  // Load saved backtests on mount/profile changes.
  const loadSavedList = useCallback(() => {
    pf('/api/nav-erosion-portfolio/saved')
      .then(r => r.json())
      .then(d => setSavedList(d.saved || []))
      .catch(() => {})
  }, [pf])

  const loadSavedEtfList = useCallback(() => {
    return pf('/api/nav-erosion-portfolio/list')
      .then(r => r.json())
      .then(d => {
        if (d.rows && d.rows.length > 0) {
          const rows = d.rows.map(r => ({
            ticker: r.ticker, amount: String(r.amount), reinvest_pct: String(r.reinvest_pct)
          }))
          setGridRows(rows)
          return rows
        }
        return null
      })
      .catch(() => null)
  }, [pf])

  useEffect(() => { loadSavedList() }, [loadSavedList, selection])

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
    pf('/api/nav-erosion-portfolio/list', {
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
    return pf('/api/nav-erosion-portfolio/list', {
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

  const loadSaved = async () => {
    if (!selectedSaved) return
    try {
      const r = await pf('/api/nav-erosion-portfolio/saved/' + selectedSaved)
      const d = await r.json()
      if (d.error) { await dialog.alert(d.error); return }
      if (d.start) setStartDate(d.start)
      if (d.end) setEndDate(d.end)
      const rows = (d.rows || []).map(r => ({
        ticker: r.ticker || '', amount: String(r.amount || ''), reinvest_pct: String(r.reinvest_pct || '')
      }))
      setGridRows(rows.length > 0 ? rows : [{ ticker: '', amount: '', reinvest_pct: '' }])
      setResults(null)
    } catch (err) {
      await dialog.alert('Load failed: ' + err.message)
    }
  }

  const deleteSaved = async () => {
    if (!selectedSaved) return
    const sel = savedList.find(s => String(s.id) === selectedSaved)
    if (!await dialog.confirm('Delete saved backtest "' + (sel?.name || '') + '"?')) return
    const r = await pf('/api/nav-erosion-portfolio/saved/' + selectedSaved, { method: 'DELETE' })
    const d = await r.json()
    if (d.error) { await dialog.alert(d.error); return }
    setDeleteMsg(true)
    setTimeout(() => setDeleteMsg(false), 2000)
    setSelectedSaved('')
    loadSavedList()
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
    const url = overwrite ? `/api/nav-erosion-portfolio/saved/${selectedSaved}` : `/api/nav-erosion-portfolio/saved`
    const method = overwrite ? 'PUT' : 'POST'

    pf(url, {
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

  const runBacktestForRows = useCallback((rowsForRun, { persist = true } = {}) => {
    setError(null)
    setResults(null)
    setLoading(true)

    const rows = collectRows(rowsForRun)
    if (!rows.length) {
      setLoading(false)
      setError('No ETFs provided.')
      return
    }

    const savePromise = persist ? pf('/api/nav-erosion-portfolio/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    }) : Promise.resolve()

    savePromise.then(() => {
      pf('/api/nav-erosion-portfolio/data', {
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
  }, [pf, startDate, endDate])

  const runBacktest = () => {
    runBacktestForRows(gridRows)
  }

  useEffect(() => {
    let cancelled = false

    // On open: silently upsert the live portfolio into a single "My Current
    // Portfolio" saved backtest and load it into the grid. We do NOT auto-run
    // the backtest — the user runs it on demand from the Saved Backtests list.
    const loadCurrentPortfolio = async () => {
      try {
        const r = await pf('/api/nav-erosion-portfolio/save-current', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start: startDate, end: endDate }),
        })
        const d = await r.json()
        if (cancelled) return
        const currentRows = (d.rows || []).map(r => ({
          ticker: r.ticker || '',
          amount: String(r.amount || ''),
          reinvest_pct: String(r.reinvest_pct || ''),
        }))

        if (currentRows.length > 0) {
          setGridRows(currentRows)
          setResults(null)
          loadSavedList()
          if (d.id != null) setSelectedSaved(String(d.id))
          return
        }

        const savedRows = await loadSavedEtfList()
        if (cancelled || !savedRows || savedRows.length === 0) {
          setGridRows([{ ticker: '', amount: '', reinvest_pct: '' }])
        }
      } catch (err) {
        if (!cancelled) {
          await loadSavedEtfList()
        }
      }
    }

    loadCurrentPortfolio()
    return () => { cancelled = true }
  }, [pf, selection])

  // Sorting results
  const colKeys = ['ticker', 'amount', 'reinvest_pct', 'start_price', 'end_price',
    'price_delta_pct', 'total_dist', 'total_reinvested', 'final_value',
    'gain_loss_dollar', 'gain_loss_pct', 'total_return_dollar', 'total_return_pct',
    'has_erosion', 'final_deficit', 'coverage_ratio', 'warning']

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
    let covWeightedSum = 0, covWeightTotal = 0
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
      if (r.coverage_ratio != null) {
        covWeightedSum += r.coverage_ratio * (r.amount || 0)
        covWeightTotal += r.amount || 0
      }
      if (best === null || r.total_return_pct > best.total_return_pct) best = r
      if (worst === null || r.total_return_pct < worst.total_return_pct) worst = r
    })
    const totGLPct = totAmount > 0 ? totGL / totAmount * 100 : 0
    const aggCoverage = covWeightTotal > 0 ? covWeightedSum / covWeightTotal : null
    const aggSeverity = navSeverityFromRatio(aggCoverage)
    return {
      totAmount, totDist, totReinv, totFinal, totGL, totTR, totGLPct,
      erosionCount, validCount, errorCount, best, worst, aggCoverage, aggSeverity,
    }
  }, [results])

  const headers = ['Ticker', 'Amount', 'Reinvest %', 'Start Price', 'End Price',
    'Price \u0394%', 'Total Distributions', 'Total Reinvested', 'Final Value',
    'Gain/Loss $', 'Gain/Loss %', 'Total Return $', 'Total Return %',
    'NAV Erosion', 'Shares Needed / Extra To Breakeven', 'NAV Ratio', 'Note']

  return (
    <div className="nep-page">
      <h1 style={{ marginBottom: '0.3rem' }}>NAV Erosion Portfolio Screener</h1>
      <p className="ne-desc">
        Compare up to {MAX_ROWS} ETFs side-by-side using the same NAV erosion calculation. Each ETF can have
        its own starting dollar amount and reinvestment percentage. Your list is saved to the database
        and will persist between sessions.
        <br />
        <span style={{ color: 'var(--neg-3)', fontWeight: 600 }}>NAV Erosion = Yes</span> means the ETF's share-price
        decline has outpaced distributions — you'd need more shares than you hold to recover your principal
        at the ending price.
        <br />
        <span style={{ color: 'var(--neg-3)', fontWeight: 600 }}>Red needed</span> means shares still needed to breakeven.
        <span style={{ color: 'var(--pos-strong)', fontWeight: 600 }}> Green extra</span> means shares above breakeven.
        The percent is the gap as a share of break-even shares.
      </p>

      {/* Collapsed-by-default help: how the numbers are computed */}
      <details className="nep-help">
        <summary>How NAV erosion &amp; total return are computed</summary>
        <div className="nep-help-body">
          <section>
            <h4>NAV Erosion (Yes / No)</h4>
            <p>
              This is a share-count break-even test. For each ETF we buy{' '}
              <em>starting shares = your dollar amount ÷ the first available month's price</em>. Each month
              the fund's distributions are paid per share; the reinvest % you set is used to buy more shares
              at that month's price (the rest is treated as cash). At the end we compute{' '}
              <em>break-even shares = your dollar amount ÷ the ending price</em> — the number of shares you
              would need at the closing price to be worth your original principal.
            </p>
            <p>
              <strong style={{ color: 'var(--neg-3)' }}>NAV Erosion = Yes</strong> when the shares you actually
              accumulated (including everything reinvested) are <em>fewer</em> than those break-even shares —
              the share-price decline outran the distributions. The{' '}
              <strong>Shares Needed / Extra To Breakeven</strong> column shows that gap, and its percent is
              the gap as a share of break-even shares.
            </p>
          </section>

          <section>
            <h4>NAV Ratio (benchmark-adjusted severity)</h4>
            <p>
              The <strong>NAV Ratio</strong> column measures destructive price decay relative to the income
              the fund actually pays, and it is gated by the market so a broad sell-off is not mistaken for
              structural erosion:
            </p>
            <p className="nep-formula">
              NAV Ratio = fund&apos;s own price decline ÷ trailing-12-month distribution yield
            </p>
            <ul>
              <li>
                The price decline only counts when the fund&apos;s best-fit benchmark (a market index) was{' '}
                <em>flat or up</em> over the same window. If the whole market fell, the drop is treated as
                market beta, not NAV erosion, and the numerator is 0.
              </li>
              <li>Distribution yield is the trailing-12-month distributions per share ÷ the ending price.</li>
              <li>
                <strong>Lower is better.</strong> ≤ 0.25 = Low, 0.25–0.75 = Moderate, &gt; 0.75 = High.
                A fund is also forced to <strong>High</strong> if its price fell ≥ 50% or you would need
                ≥ 5% more shares to break even.
              </li>
            </ul>
            <p>
              The <strong>Portfolio NAV Erosion Ratio</strong> tile is the dollar-weighted average of each
              fund&apos;s ratio across the holdings that have one.
            </p>
          </section>

          <section>
            <h4>Total Return vs. Gain / Loss</h4>
            <p>
              <strong>Final Value</strong> = the shares you accumulated × the ending price.
            </p>
            <p className="nep-formula">
              Total Return $ = Final Value + cash distributions taken − amount invested
              <br />
              Total Return % = Total Return $ ÷ amount invested
            </p>
            <p>
              &quot;Cash distributions taken&quot; is the portion of distributions you did{' '}
              <em>not</em> reinvest. <strong>Gain / Loss $</strong> is narrower — just Final Value − amount invested — so it
              reflects only the position&apos;s value and excludes any cash you pocketed. Total Return therefore
              exceeds Gain / Loss by exactly the cash distributions taken.
            </p>
          </section>

          <p className="nep-help-note">
            Prices come from unadjusted historical data with distributions applied explicitly, and the
            backtest steps month by month. If a fund has no data back to your start date, results begin from
            its earliest available month (flagged in the Note column).
          </p>
        </div>
      </details>

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
        {deleteMsg && <span style={{ color: 'var(--pos-strong)', fontSize: '0.78rem' }}>Deleted</span>}
      </div>

      {/* ETF input grid */}
      <div className="nep-grid-panel">
        <div style={{ color: 'var(--p-aaa)', fontSize: '0.78rem', marginBottom: '0.55rem', lineHeight: 1.5 }}>
          Each row is one ETF. The two number boxes are the starting dollars assigned to that ETF and the
          percent of its distributions to reinvest during the backtest.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="nep-grid-tbl" style={{ width: 'auto', minWidth: 640 }}>
            <colgroup>
              <col style={{ width: 140 }} />
              <col style={{ width: 210 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>ETF Ticker</th>
                <th style={{ textAlign: 'left' }}>Starting Dollars ($)</th>
                <th style={{ textAlign: 'left' }}>Dividends Reinvested (%)</th>
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
                      placeholder="Ticker"
                      title="ETF ticker to include in this portfolio NAV erosion backtest"
                      aria-label="ETF ticker"
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
                      placeholder="10000"
                      title="Starting investment amount for this ETF in the backtest"
                      aria-label="Starting dollars for this ETF"
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
                      style={{ width: 120, textAlign: 'right' }}
                      placeholder="0-100"
                      title="Percent of this ETF's distributions to reinvest. 0 keeps distributions as cash; 100 reinvests all distributions."
                      aria-label="Percent of dividends reinvested"
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
          {savedMsg && <span style={{ color: 'var(--pos-strong)', fontSize: '0.82rem' }}>Saved</span>}
          <span style={{ color: 'var(--p-555)', fontSize: '0.78rem', marginLeft: 'auto' }}>
            {gridRows.length} / {MAX_ROWS} ETFs
          </span>
        </div>

        {/* Save backtest form */}
        {btFormOpen && (
          <div className="nep-bt-form">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--purple)', whiteSpace: 'nowrap' }}>Backtest name:</label>
              <input
                className="ne-input"
                style={{ flex: 1, minWidth: 220, borderColor: 'var(--purple)' }}
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
                  style={{ accentColor: 'var(--purple)', width: 14, height: 14, cursor: 'pointer' }}
                  id="nep-bt-overwrite"
                />
                <label htmlFor="nep-bt-overwrite" style={{ fontSize: '0.78rem', color: 'var(--p-aaa)', cursor: 'pointer' }}>
                  Overwrite selected backtest (uncheck to save as new)
                </label>
              </div>
            )}
            {btError && <span style={{ color: 'var(--neg-3)', fontSize: '0.78rem' }}>{btError}</span>}
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
          <h2 style={{ marginTop: 0, marginBottom: '0.7rem', fontSize: '1rem', color: 'var(--p-ccc)' }}>Results</h2>

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
              <StatTile
                label="Portfolio NAV Erosion Ratio"
                value={summary.aggCoverage != null ? summary.aggCoverage.toFixed(4) : '\u2014'}
                color={navSeverityColor(summary.aggSeverity)}
                sub="dollar-weighted avg"
              />
              {summary.aggCoverage != null && (
                <div className="nep-stat-tile" style={{
                  border: `2px solid ${navSeverityColor(summary.aggSeverity)}`,
                  borderRadius: '8px',
                  background: summary.aggSeverity === 'High' ? 'rgba(224,85,85,0.12)' : summary.aggSeverity === 'Medium' ? 'rgba(255,179,0,0.12)' : 'rgba(0,200,83,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flex: '1 1 190px',
                }}>
                  <div className="nep-stat-val" style={{
                    color: navSeverityColor(summary.aggSeverity),
                    fontSize: '0.85rem',
                    lineHeight: 1.3,
                    textAlign: 'center',
                    whiteSpace: 'normal',
                    overflow: 'visible',
                    textOverflow: 'clip',
                  }}>
                    {navSeverityText(summary.aggSeverity, true)}
                  </div>
                </div>
              )}
              {summary.best && (
                <StatTile
                  label="Best Performer"
                  value={<span style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>{summary.best.ticker}</span>}
                  color="#00c853"
                  sub={fmtPct(summary.best.total_return_pct || 0)}
                />
              )}
              {summary.worst && (
                <StatTile
                  label="Worst Performer"
                  value={<span style={{ color: 'var(--neg-3)', fontWeight: 700 }}>{summary.worst.ticker}</span>}
                  color="#e05555"
                  sub={fmtPct(summary.worst.total_return_pct || 0)}
                />
              )}
              {summary.errorCount > 0 && (
                <StatTile label="No Data" value={summary.errorCount + ' ticker' + (summary.errorCount > 1 ? 's' : '')} color="#f9a825" sub="check Note column" />
              )}
            </div>
          )}

          <h3 style={{ margin: '0 0 0.4rem', fontSize: '0.85rem', color: 'var(--p-666)', fontWeight: 400 }}>
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
                        <td colSpan={13} style={{ textAlign: 'left', color: 'var(--neg-3)' }}>{r.error}</td>
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
                  const gapPct = shareGapPct(r.final_deficit || 0, r.amount || 0, r.end_price || 0)
                  const gapKind = shareGapKind(r.final_deficit || 0)
                  const navSeverity = r.nav_erosion_severity || navSeverityFromRatio(r.coverage_ratio)
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
                          ? <span style={{ color: 'var(--neg-3)', fontWeight: 700 }}>Yes</span>
                          : <span style={{ color: 'var(--pos-strong)', fontWeight: 700 }}>No</span>}
                      </td>
                      <td
                        className={defCls}
                        title={`Break-even shares minus total shares held: ${parseFloat(r.final_deficit || 0).toFixed(4)} (${fmtPct(gapPct)})`}
                      >
                        {fmtAbs4(r.final_deficit)} {gapKind} <span style={{ opacity: 0.8 }}>({fmtAbsPct(gapPct)})</span>
                      </td>
                      <td style={{ color: r.coverage_ratio == null ? 'var(--p-666)' : navSeverityColor(navSeverity), fontWeight: r.coverage_ratio != null ? 600 : 400 }}>
                        {r.coverage_ratio != null ? r.coverage_ratio.toFixed(4) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'left', fontSize: '0.78rem', color: 'var(--p-aaa)' }}>
                        {r.warning
                          ? <span title={r.warning} style={{ cursor: 'help' }}>&#9888; {r.warning.substring(0, 40)}{r.warning.length > 40 ? '\u2026' : ''}</span>
                          : <span style={{ color: 'var(--p-555)' }}>{'\u2014'}</span>}
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
                    <td></td><td></td>
                    <td style={{ color: navSeverityColor(summary.aggSeverity), fontWeight: 600 }}>
                      {summary.aggCoverage != null ? summary.aggCoverage.toFixed(4) : '\u2014'}
                    </td>
                    <td></td>
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
