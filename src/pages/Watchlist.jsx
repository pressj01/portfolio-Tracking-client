import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'

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

function fmt(v) {
  if (v == null) return '\u2014'
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function WatchlistTickerModal({ ticker, onClose }) {
  const pf = useProfileFetch()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(null)
    pf(`/api/ticker-return-1y/${ticker}`)
      .then(r => {
        if (!r.ok) throw new Error(`Could not load return data for ${ticker}`)
        return r.json()
      })
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticker, pf])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (!data || !window.Plotly) return
    const el = document.getElementById('wl-ticker-chart')
    if (!el) return

    const traces = [
      {
        x: data.dates, y: data.price_return,
        mode: 'lines', name: 'Price Return %',
        line: { color: '#7ecfff', width: 2 },
        hovertemplate: '%{y:.2f}%<extra>Price</extra>',
      },
      {
        x: data.dates, y: data.total_return,
        mode: 'lines', name: 'Total Return %',
        line: { color: '#4dff91', width: 2 },
        fill: 'tonexty', fillcolor: 'rgba(77,255,145,0.08)',
        hovertemplate: '%{y:.2f}%<extra>Total</extra>',
      },
    ]
    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
      title: { text: `${data.ticker} — 1 Year Return`, font: { size: 16, color: '#e0e8f5' } },
      xaxis: { title: '', gridcolor: '#1a2233' },
      yaxis: { title: 'Return %', gridcolor: '#1a2233', ticksuffix: '%' },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 12 } },
      margin: { l: 50, r: 20, t: 60, b: 40 },
      hovermode: 'x unified',
      shapes: [{ type: 'line', x0: data.dates[0], x1: data.dates[data.dates.length - 1], y0: 0, y1: 0, line: { dash: 'dot', color: '#556677', width: 1 } }],
    }
    window.Plotly.newPlot(el, traces, layout, { responsive: true })
    return () => { if (el) window.Plotly.purge(el) }
  }, [data])

  if (!ticker) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
        {error && <div className="alert alert-error">{error}</div>}
        {data && (
          <>
            <h2 style={{ color: '#7ecfff', marginBottom: '0.25rem' }}>{data.ticker} — {data.description}</h2>
            <p style={{ color: '#8899aa', marginBottom: '1rem', fontSize: '0.9rem' }}>
              1 Year Return starting at {fmt(data.start_price)}
            </p>
            <div id="wl-ticker-chart" style={{ height: '400px' }} />
          </>
        )}
      </div>
    </div>
  )
}

export default function Watchlist() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const dialog = useDialog()
  const [watchingList, setWatchingList] = useState([])
  const [analysisData, setAnalysisData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ticker, setTicker] = useState('')
  const [notes, setNotes] = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [modalTicker, setModalTicker] = useState(null)
  const initialLoad = useRef(true)

  const loadAnalysis = useCallback(() => {
    setLoading(true)
    setError(null)
    pf('/api/watchlist/data')
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
  }, [pf, selection])

  const loadWatchingList = useCallback(() => {
    pf('/api/watchlist/watching')
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
    pf('/api/watchlist/watching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: newList }),
    })
  }, [pf])

  const watchingListRef = useRef(watchingList)
  useEffect(() => { watchingListRef.current = watchingList }, [watchingList])

  const addWatching = async () => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    const current = watchingListRef.current
    if (current.some(r => r.ticker === t)) {
      await dialog.alert(t + ' is already in your watching list.')
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
      'rsi_sig', 'macd_sig', 'sma50_sig', 'sma200_sig', 'sharpe', 'sortino', 'one_yr_ret',
      'cov_ratio', 'cov_sig', 'nav_erosion_prob', 'notes']
    const key = cols[sortCol]
    const sigOrder = { BUY: 0, NEUTRAL: 1, SELL: 2 }
    sortedRows.sort((a, b) => {
      let aV = a[key], bV = b[key]
      if (['signal', 'ao_sig', 'rsi_sig', 'macd_sig', 'sma50_sig', 'sma200_sig', 'cov_sig'].includes(key)) {
        aV = sigOrder[aV] ?? 9
        bV = sigOrder[bV] ?? 9
      }
      if (key === 'nav_erosion_prob') {
        const eroOrder = { High: 0, Medium: 1, Low: 2 }
        aV = eroOrder[aV] ?? 9
        bV = eroOrder[bV] ?? 9
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
                {[
                  { label: 'Ticker' },
                  { label: 'Price', tip: 'Current market price' },
                  { label: '1D Chg', tip: '1-day price change percentage' },
                  { label: 'Div Yield', tip: 'Current annual dividend yield' },
                  { label: 'Signal', tip: 'Overall buy/sell signal — majority vote across indicators' },
                  { label: 'AO', tip: 'Awesome Oscillator signal — momentum based on 5/34-period midpoint SMAs' },
                  { label: 'RSI', tip: 'Relative Strength Index signal — overbought >70, oversold <30' },
                  { label: 'MACD', tip: 'Moving Average Convergence Divergence signal' },
                  { label: 'SMA 50', tip: 'Simple Moving Average 50-day — BUY when price is above' },
                  { label: 'SMA 200', tip: 'Simple Moving Average 200-day — BUY when price is above' },
                  { label: 'Sharpe', tip: 'Risk-adjusted return. >1.5 great, >1.0 good, <0.5 poor' },
                  { label: 'Sortino', tip: 'Like Sharpe but only penalizes downside. >2.0 great, >1.5 good' },
                  { label: '1Y Return', tip: 'Total return over the past 12 months' },
                  { label: 'Coverage', tip: 'TTM coverage ratio: (price return + dist yield) / dist yield. >1 = sustainable, <1 = NAV eroding' },
                  { label: 'Cov Signal', tip: 'Coverage signal: BUY (>1 sustainable), SELL (<1 eroding), NEUTRAL (=1)' },
                  { label: 'NAV Erosion', tip: 'Probability of NAV erosion based on coverage ratio: Low (>1), High (<1), Medium (=1)' },
                  { label: 'Notes' },
                ].map((h, i) => (
                  <th key={h.label} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }} title={h.tip || ''}>
                    {h.label}{h.tip ? ' \u24D8' : ''}{arrow(i)}
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
                    <td>
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); setModalTicker(r.ticker) }}
                        style={{ color: '#7ecfff', fontWeight: 600 }}
                      >
                        {r.ticker}
                      </a>
                    </td>
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
                    <td>{a?.cov_ratio != null ? a.cov_ratio.toFixed(4) : '\u2014'}</td>
                    <td><SignalBadge signal={a?.cov_sig} /></td>
                    <td style={{
                      color: a?.nav_erosion_prob === 'Low' ? '#00c853' : a?.nav_erosion_prob === 'High' ? '#d50000' : a?.nav_erosion_prob === 'Medium' ? '#f9a825' : '#888',
                      fontWeight: 600,
                      backgroundColor: a?.nav_erosion_prob === 'Low' ? 'rgba(0,200,83,0.12)' : a?.nav_erosion_prob === 'High' ? 'rgba(213,0,0,0.12)' : a?.nav_erosion_prob === 'Medium' ? 'rgba(249,168,37,0.12)' : 'transparent',
                    }}>{a?.nav_erosion_prob ? `${a.nav_erosion_prob} Probability` : '\u2014'}</td>
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

      {modalTicker && <WatchlistTickerModal ticker={modalTicker} onClose={() => setModalTicker(null)} />}
    </div>
  )
}
