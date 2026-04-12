import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useProfileFetch } from '../context/ProfileContext'

const DAILY_PERIODS = ['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y']
const WEEKLY_PERIODS = ['1y', '2y', '3y', '5y', '10y', 'max']
const DEFAULT_DAILY = '1y'
const DEFAULT_WEEKLY = '5y'

function fmt(v, dec = 2) {
  if (v == null) return '\u2014'
  return Number(v).toFixed(dec)
}

function ScannerChartModal({ ticker, timeframe, period, onClose }) {
  const pf = useProfileFetch()
  const [figData, setFigData] = useState(null)
  const [figLayout, setFigLayout] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(null)
    pf(`/api/scanner/chart/${ticker}?timeframe=${timeframe}&period=${period}`)
      .then(r => {
        if (!r.ok) throw new Error(`Could not load chart for ${ticker}`)
        return r.json()
      })
      .then(d => {
        if (d.error) throw new Error(d.error)
        setFigData(d.fig_data)
        setFigLayout(d.fig_layout)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticker, timeframe, period, pf])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (!figData || !figLayout || !window.Plotly) return
    const el = document.getElementById('scanner-chart')
    if (!el) return
    window.Plotly.newPlot(el, figData, { ...figLayout, autosize: true }, { responsive: true })
    return () => { if (el) window.Plotly.purge(el) }
  }, [figData, figLayout])

  if (!ticker) return null

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '950px', background: '#0e1117' }}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
        {error && <div className="alert alert-error">{error}</div>}
        {figData && <div id="scanner-chart" style={{ height: '520px' }} />}
      </div>
    </div>
  )
}

export default function TechnicalScanner() {
  const pf = useProfileFetch()
  const [tickers, setTickers] = useState([])
  const [input, setInput] = useState('')
  const [timeframe, setTimeframe] = useState('daily')
  const [period, setPeriod] = useState(DEFAULT_DAILY)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [modalTicker, setModalTicker] = useState(null)
  const [showHelp, setShowHelp] = useState(true)
  const [smaPct, setSmaPct] = useState(() => Number(localStorage.getItem('scanner-sma-pct')) || 5)
  const [stochMin, setStochMin] = useState(() => Number(localStorage.getItem('scanner-stoch-min')) || 19)
  const [stochMax, setStochMax] = useState(() => Number(localStorage.getItem('scanner-stoch-max')) || 21)
  const initialLoad = useRef(true)

  // Load saved tickers on mount
  useEffect(() => {
    pf('/api/scanner/tickers')
      .then(r => r.json())
      .then(d => { if (d.rows) setTickers(d.rows.map(r => r.ticker)) })
      .catch(() => {})
  }, [pf])

  // Save tickers to backend
  const saveTickers = useCallback((list) => {
    setTickers(list)
    pf('/api/scanner/tickers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: list.map(t => ({ ticker: t })) }),
    }).catch(() => {})
  }, [pf])

  const addTicker = useCallback(() => {
    const t = input.trim().toUpperCase()
    if (!t || tickers.includes(t)) { setInput(''); return }
    saveTickers([...tickers, t])
    setInput('')
  }, [input, tickers, saveTickers])

  const removeTicker = useCallback((t) => {
    saveTickers(tickers.filter(x => x !== t))
  }, [tickers, saveTickers])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTicker() }
  }

  // Switch timeframe resets period to default
  const switchTimeframe = (tf) => {
    setTimeframe(tf)
    setPeriod(tf === 'daily' ? DEFAULT_DAILY : DEFAULT_WEEKLY)
  }

  const hasScanned = useRef(false)

  const runScan = useCallback(() => {
    if (!tickers.length) return
    hasScanned.current = true
    setLoading(true)
    setError(null)
    localStorage.setItem('scanner-sma-pct', smaPct)
    localStorage.setItem('scanner-stoch-min', stochMin)
    localStorage.setItem('scanner-stoch-max', stochMax)
    pf(`/api/scanner/scan?timeframe=${timeframe}&period=${period}&sma_pct=${smaPct}&stoch_min=${stochMin}&stoch_max=${stochMax}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        setRows(d.rows || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf, tickers, timeframe, period, smaPct, stochMin, stochMax])

  // Auto-rerun scan when timeframe or period changes (after first manual scan)
  useEffect(() => {
    if (hasScanned.current && tickers.length) runScan()
  }, [timeframe, period]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sort logic
  const toggleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const sortedRows = React.useMemo(() => {
    if (!sortCol) return rows
    return [...rows].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? av - bv : bv - av
    })
  }, [rows, sortCol, sortAsc])

  const arrow = (col) => sortCol === col ? (sortAsc ? ' \u25B4' : ' \u25BE') : ''

  const periods = timeframe === 'daily' ? DAILY_PERIODS : WEEKLY_PERIODS

  return (
    <div className="page-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
        <h1 style={{ margin: 0, color: '#7ecfff' }}>Technical Scanner</h1>
        <button className="btn btn-xs btn-outline" onClick={() => setShowHelp(h => !h)}>
          {showHelp ? 'Hide Help' : 'Help'}
        </button>
      </div>

      {showHelp && (
        <div className="help-box" style={{ marginBottom: '1rem', padding: '1rem', background: '#111124',
          border: '1px solid #2a2a4e', borderRadius: '6px', fontSize: '0.88rem', color: '#b0bec5' }}>
          <p style={{ margin: '0 0 0.5rem' }}><strong>Scan Conditions (all must be true for BUY):</strong></p>
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            <li>50 SMA at or above the 175 SMA</li>
            <li>Price within {smaPct}% above or below the 175 SMA</li>
            <li>Slow Stochastic %K (14,3) between {stochMin} and {stochMax}</li>
          </ul>
          <p style={{ margin: '0.5rem 0 0' }}>Click a ticker in the results to view its chart with indicators.</p>
        </div>
      )}

      {/* Ticker input */}
      <div className="scanner-controls">
        <input
          type="text"
          placeholder="Add ticker..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ width: '120px', padding: '0.35rem 0.5rem', background: '#111124',
            border: '1px solid #3a3a5c', borderRadius: '4px', color: '#e0e8f5', fontSize: '0.88rem' }}
        />
        <button className="btn btn-xs btn-primary" onClick={addTicker}>Add</button>
      </div>

      {/* Ticker chips */}
      {tickers.length > 0 && (
        <div className="scanner-chip-list">
          {tickers.map(t => (
            <span key={t} className="scanner-chip">
              {t}
              <button onClick={() => removeTicker(t)} title="Remove">&times;</button>
            </span>
          ))}
        </div>
      )}

      {/* Condition settings */}
      <div className="scanner-controls" style={{ fontSize: '0.85rem' }}>
        <label style={{ color: '#8899aa' }}>SMA Proximity:
          <input type="number" min="1" max="50" step="1" value={smaPct}
            onChange={(e) => setSmaPct(Number(e.target.value) || 5)}
            style={{ width: '50px', marginLeft: '0.4rem', padding: '0.25rem 0.4rem', background: '#111124',
              border: '1px solid #3a3a5c', borderRadius: '4px', color: '#e0e8f5', fontSize: '0.85rem', textAlign: 'center' }}
          />%
        </label>
        <label style={{ color: '#8899aa' }}>Stochastic %K:
          <input type="number" min="0" max="100" step="1" value={stochMin}
            onChange={(e) => setStochMin(Number(e.target.value) || 0)}
            style={{ width: '50px', marginLeft: '0.4rem', padding: '0.25rem 0.4rem', background: '#111124',
              border: '1px solid #3a3a5c', borderRadius: '4px', color: '#e0e8f5', fontSize: '0.85rem', textAlign: 'center' }}
          />
          <span style={{ margin: '0 0.3rem' }}>to</span>
          <input type="number" min="0" max="100" step="1" value={stochMax}
            onChange={(e) => setStochMax(Number(e.target.value) || 100)}
            style={{ width: '50px', padding: '0.25rem 0.4rem', background: '#111124',
              border: '1px solid #3a3a5c', borderRadius: '4px', color: '#e0e8f5', fontSize: '0.85rem', textAlign: 'center' }}
          />
        </label>
      </div>

      {/* Timeframe + period + scan */}
      <div className="scanner-controls">
        <div className="scanner-tf-toggle">
          <button className={timeframe === 'daily' ? 'active' : ''} onClick={() => switchTimeframe('daily')}>Daily</button>
          <button className={timeframe === 'weekly' ? 'active' : ''} onClick={() => switchTimeframe('weekly')}>Weekly</button>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          style={{ padding: '0.35rem 0.5rem', background: '#111124',
            border: '1px solid #3a3a5c', borderRadius: '4px', color: '#e0e8f5', fontSize: '0.85rem' }}
        >
          {periods.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading || !tickers.length}>
          {loading ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Results table */}
      {rows.length > 0 && (
        <div className="sst-wrap" style={{ maxHeight: '560px' }}>
          <table className="sst">
            <thead>
              <tr>
                <th onClick={() => toggleSort('ticker')} style={{ cursor: 'pointer' }}>Ticker{arrow('ticker')}</th>
                <th onClick={() => toggleSort('price')} style={{ cursor: 'pointer', textAlign: 'right' }}>Price{arrow('price')}</th>
                <th onClick={() => toggleSort('sma_50')} style={{ cursor: 'pointer', textAlign: 'right' }}>50 SMA{arrow('sma_50')}</th>
                <th onClick={() => toggleSort('sma_175')} style={{ cursor: 'pointer', textAlign: 'right' }}>175 SMA{arrow('sma_175')}</th>
                <th onClick={() => toggleSort('slow_k')} style={{ cursor: 'pointer', textAlign: 'right' }}>Slow %K{arrow('slow_k')}</th>
                <th onClick={() => toggleSort('slow_d')} style={{ cursor: 'pointer', textAlign: 'right' }}>Slow %D{arrow('slow_d')}</th>
                <th onClick={() => toggleSort('buy_signal')} style={{ cursor: 'pointer', textAlign: 'center' }}>Signal{arrow('buy_signal')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr key={r.ticker}>
                  <td>
                    <a href="#" onClick={(e) => { e.preventDefault(); setModalTicker(r.ticker) }}
                       style={{ color: '#7ecfff', textDecoration: 'none', fontWeight: 600 }}>
                      {r.ticker}
                    </a>
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.price)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.sma_50)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.sma_175)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.slow_k)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.slow_d)}</td>
                  <td style={{ textAlign: 'center' }}>
                    {r.buy_signal ? <span className="sig sig-BUY">BUY</span> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length === 0 && tickers.length > 0 && (
        <p style={{ color: '#8899aa', textAlign: 'center', marginTop: '2rem' }}>
          Click "Run Scan" to analyze your tickers.
        </p>
      )}

      {tickers.length === 0 && (
        <p style={{ color: '#8899aa', textAlign: 'center', marginTop: '2rem' }}>
          Add tickers above to get started.
        </p>
      )}

      {modalTicker && (
        <ScannerChartModal
          ticker={modalTicker}
          timeframe={timeframe}
          period={period}
          onClose={() => setModalTicker(null)}
        />
      )}
    </div>
  )
}
