import React, { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE } from '../config'

function SignalBadge({ signal }) {
  if (!signal || signal === '\u2014') return <span>{'\u2014'}</span>
  const cls = { BUY: 'sig-BUY', SELL: 'sig-SELL', NEUTRAL: 'sig-NEUTRAL' }
  return <span className={`sig ${cls[signal] || ''}`}>{signal}</span>
}

function fmtPct(v) {
  if (v == null) return '\u2014'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

function pctClass(v) {
  if (v == null) return ''
  return v >= 0 ? 'pct-up' : 'pct-down'
}

export default function Watchlist() {
  const [watchingList, setWatchingList] = useState([])
  const [analysisData, setAnalysisData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ticker, setTicker] = useState('')
  const [notes, setNotes] = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const initialLoad = useRef(true)

  const loadAnalysis = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/watchlist/data`)
      .then(r => r.json())
      .then(data => {
        setLoading(false)
        if (data.error) setError(data.error)
        setAnalysisData(data)
      })
      .catch(err => {
        setLoading(false)
        setError('Error loading analysis: ' + err)
      })
  }, [])

  const loadWatchingList = useCallback(() => {
    fetch(`${API_BASE}/api/watchlist/watching`)
      .then(r => r.json())
      .then(data => {
        setWatchingList(data.rows || [])
        if (data.rows && data.rows.length > 0) loadAnalysis()
      })
      .catch(() => {})
  }, [loadAnalysis])

  useEffect(() => { loadWatchingList() }, [loadWatchingList])

  const saveList = useCallback((newList) => {
    setWatchingList(newList)
    fetch(`${API_BASE}/api/watchlist/watching`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: newList }),
    })
  }, [])

  const watchingListRef = useRef(watchingList)
  useEffect(() => { watchingListRef.current = watchingList }, [watchingList])

  const addWatching = () => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    const current = watchingListRef.current
    if (current.some(r => r.ticker === t)) {
      alert(t + ' is already in your watching list.')
      return
    }
    const newList = [...current, { ticker: t, notes: notes.trim() }]
    saveList(newList)
    setTicker('')
    setNotes('')
    // Re-run analysis to include new ticker
    setTimeout(loadAnalysis, 300)
  }

  const removeWatching = (t) => {
    saveList(watchingListRef.current.filter(r => r.ticker !== t))
  }

  const getAnalysis = (tkr) => {
    if (!analysisData) return null
    const rows = analysisData.watching || []
    return rows.find(r => r.ticker === tkr) || null
  }

  // Build display rows
  const displayRows = watchingList.map(r => ({
    ...r,
    ...(getAnalysis(r.ticker) || {}),
  }))

  // Sorting
  const sortedRows = [...displayRows]
  if (sortCol !== null) {
    const cols = ['ticker', 'price', 'change_1d', 'div_yield', 'signal', 'ao_sig',
      'rsi_sig', 'macd_sig', 'sma50_sig', 'sma200_sig', 'sharpe', 'sortino', 'one_yr_ret', 'nav_erosion', 'notes']
    const key = cols[sortCol]
    const sigOrder = { BUY: 0, NEUTRAL: 1, SELL: 2 }
    sortedRows.sort((a, b) => {
      let aV = a[key], bV = b[key]
      if (['signal', 'ao_sig', 'rsi_sig', 'macd_sig', 'sma50_sig', 'sma200_sig'].includes(key)) {
        aV = sigOrder[aV] ?? 9
        bV = sigOrder[bV] ?? 9
      }
      if (key === 'nav_erosion') {
        aV = aV ? 1 : 0
        bV = bV ? 1 : 0
      }
      if (aV == null) aV = ''
      if (bV == null) bV = ''
      if (typeof aV === 'number' && typeof bV === 'number')
        return sortAsc ? aV - bV : bV - aV
      return sortAsc ? String(aV).localeCompare(String(bV)) : String(bV).localeCompare(String(aV))
    })
  }

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const arrow = (col) => sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  const counts = analysisData?.counts || null

  return (
    <div className="wl-page">
      <h1 style={{ marginBottom: '0.5rem' }}>Watchlist</h1>

      {/* Add form */}
      <div className="wl-form-row">
        <div>
          <label className="wl-label">Ticker</label>
          <input
            className="wl-input"
            style={{ width: 100, textTransform: 'uppercase' }}
            placeholder="e.g. SCHD"
            value={ticker}
            onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && addWatching()}
          />
        </div>
        <div>
          <label className="wl-label">Notes (optional)</label>
          <input
            className="wl-input"
            style={{ width: 220 }}
            placeholder="Why interested?"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addWatching()}
          />
        </div>
        <button className="wl-btn-add" onClick={addWatching}>+ Add</button>
      </div>

      {/* Counts */}
      {counts && (
        <div className="wl-counts">
          <div className="wl-count-box wl-count-buy">
            <div className="wl-count-num">{counts.BUY || 0}</div>
            <div className="wl-count-lbl">BUY</div>
          </div>
          <div className="wl-count-box wl-count-sell">
            <div className="wl-count-num">{counts.SELL || 0}</div>
            <div className="wl-count-lbl">SELL</div>
          </div>
          <div className="wl-count-box wl-count-neut">
            <div className="wl-count-num">{counts.NEUTRAL || 0}</div>
            <div className="wl-count-lbl">NEUTRAL</div>
          </div>
        </div>
      )}

      {/* Spinner */}
      {loading && (
        <div className="wl-spinner">
          <div className="wl-spin-circle" />
          <p>Fetching price data &amp; calculating indicators&hellip;</p>
        </div>
      )}

      {/* Error */}
      {error && <div className="wl-error">{error}</div>}

      {/* Empty state */}
      {watchingList.length === 0 && !loading && (
        <div className="wl-empty">No tickers in your watching list yet. Add one above to get started.</div>
      )}

      {/* Table */}
      {watchingList.length > 0 && !loading && (
        <div className="sst-wrap">
          <table className="sst">
            <thead>
              <tr>
                {['Ticker', 'Price', '1D Chg', 'Div Yield', 'Signal', 'AO', 'RSI', 'MACD',
                  'SMA 50', 'SMA 200', 'Sharpe', 'Sortino', '1Y Return', 'NAV Erosion', 'Notes'].map((h, i) => (
                  <th key={h} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }}>
                    {h}{arrow(i)}
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => {
                const a = analysisData ? getAnalysis(r.ticker) : null
                return (
                  <tr key={r.ticker}>
                    <td><strong>{r.ticker}</strong></td>
                    <td>{a?.price != null ? `$${a.price.toFixed(2)}` : '\u2014'}</td>
                    <td className={pctClass(a?.change_1d)}>{a?.change_1d != null ? fmtPct(a.change_1d) : '\u2014'}</td>
                    <td>{a?.div_yield != null ? a.div_yield.toFixed(2) + '%' : '\u2014'}</td>
                    <td><SignalBadge signal={a?.signal} /></td>
                    <td><SignalBadge signal={a?.ao_sig} /></td>
                    <td>
                      <SignalBadge signal={a?.rsi_sig} />
                      {a?.rsi_val != null && <span style={{ color: '#888', fontSize: '0.75rem', marginLeft: 4 }}>{a.rsi_val}</span>}
                    </td>
                    <td><SignalBadge signal={a?.macd_sig} /></td>
                    <td>
                      <SignalBadge signal={a?.sma50_sig} />
                      {a?.sma50_pct != null && <span style={{ color: '#888', fontSize: '0.75rem', marginLeft: 4 }}>{fmtPct(a.sma50_pct)}</span>}
                    </td>
                    <td>
                      <SignalBadge signal={a?.sma200_sig} />
                      {a?.sma200_pct != null && <span style={{ color: '#888', fontSize: '0.75rem', marginLeft: 4 }}>{fmtPct(a.sma200_pct)}</span>}
                    </td>
                    <td>{a?.sharpe != null ? a.sharpe.toFixed(2) : '\u2014'}</td>
                    <td>{a?.sortino != null ? a.sortino.toFixed(2) : '\u2014'}</td>
                    <td className={pctClass(a?.one_yr_ret)}>{a?.one_yr_ret != null ? fmtPct(a.one_yr_ret) : '\u2014'}</td>
                    <td>
                      {a ? (a.nav_erosion
                        ? <span className="erosion-flag">YES</span>
                        : <span style={{ color: '#4dff91' }}>NO</span>)
                        : '\u2014'}
                    </td>
                    <td>{r.notes || ''}</td>
                    <td>
                      <button className="btn-del" onClick={() => removeWatching(r.ticker)}>Remove</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
