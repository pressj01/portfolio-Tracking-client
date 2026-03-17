import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { API_BASE } from '../config'
import Plot from 'react-plotly.js'

function Sig({ signal }) {
  if (!signal) return <span>{'\u2014'}</span>
  const cls = { BUY: 'sig-BUY', SELL: 'sig-SELL', NEUTRAL: 'sig-NEUTRAL' }
  return <span className={`sig ${cls[signal] || ''}`}>{signal}</span>
}

function AoDir({ dir }) {
  if (dir === 'Rising') return <span className="ao-up">Rising &uarr;</span>
  if (dir === 'Falling') return <span className="ao-down">Falling &darr;</span>
  if (dir === 'Flat') return <span className="ao-flat">Flat &rarr;</span>
  return <span className="ao-flat">{'\u2014'}</span>
}

function SrcBadge({ source }) {
  if (source === 'Portfolio') return <span className="src-p">Portfolio</span>
  if (source === 'Sectors') return <span className="src-s">Sectors</span>
  return <span className="src-w">Watchlist</span>
}

function pctCls(s) {
  if (!s) return ''
  if (s[0] === '+') return 'pct-up'
  if (s[0] === '-') return 'pct-down'
  return ''
}

export default function BuySellSignals() {
  const [rows, setRows] = useState([])
  const [figData, setFigData] = useState(null)
  const [figLayout, setFigLayout] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [timestamp, setTimestamp] = useState(null)

  const loadData = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/buy-sell-signals`)
      .then(r => r.json())
      .then(data => {
        setLoading(false)
        if (data.error) setError(data.error)
        setRows(data.table_rows || [])
        setTimestamp(new Date().toLocaleTimeString())
        if (data.fig_json) {
          try {
            const fig = JSON.parse(data.fig_json)
            setFigData(fig.data)
            setFigLayout(fig.layout)
          } catch { /* ignore */ }
        }
      })
      .catch(err => {
        setLoading(false)
        setError('Failed to load data: ' + err.message)
      })
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const counts = useMemo(() => {
    const c = { BUY: 0, SELL: 0, NEUTRAL: 0 }
    rows.forEach(r => { c[r.signal] = (c[r.signal] || 0) + 1 })
    return c
  }, [rows])

  // Sorting
  const colKeys = ['ticker', 'desc', 'ctype', 'source', 'sig_order', 'ao_sig_ord', 'ao_val_num', 'ao_dir',
    'rsi_sig_ord', 'macd_sig_ord', 'sma50_sig_ord', 'sma200_sig_ord', 'sharpe_val_num', 'sortino_val_num', 'pv_num']

  const sorted = useMemo(() => {
    const arr = [...rows]
    if (sortCol !== null) {
      const key = colKeys[sortCol]
      arr.sort((a, b) => {
        let aV = a[key] ?? '', bV = b[key] ?? ''
        if (typeof aV === 'number' && typeof bV === 'number')
          return sortAsc ? aV - bV : bV - aV
        aV = String(aV); bV = String(bV)
        const aN = parseFloat(aV), bN = parseFloat(bV)
        if (!isNaN(aN) && !isNaN(bN)) return sortAsc ? aN - bN : bN - aN
        return sortAsc ? aV.localeCompare(bV) : bV.localeCompare(aV)
      })
    }
    return arr
  }, [rows, sortCol, sortAsc])

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }
  const arrow = (col) => sortCol === col ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  const headers = ['Ticker', 'Name', 'Type', 'Source', 'Overall', 'AO', 'AO Value', 'AO Dir',
    'RSI', 'MACD', 'SMA 50', 'SMA 200', 'Sharpe', 'Sortino', 'Portfolio $']

  return (
    <div className="bss-page">
      <div className="bss-header">
        <h1 style={{ margin: 0 }}>Buy / Sell Signal Dashboard</h1>
        {!loading && (
          <button className="bss-refresh-btn" onClick={loadData}>
            &#8635; Refresh
          </button>
        )}
        {timestamp && <span className="bss-timestamp">Updated: {timestamp}</span>}
      </div>
      <p className="bss-legend">
        <span style={{ color: '#00c853', fontWeight: 600 }}>&#9632; BUY</span>&nbsp;
        <span style={{ color: '#d50000', fontWeight: 600 }}>&#9632; SELL</span>&nbsp;
        <span style={{ color: '#f9a825', fontWeight: 600 }}>&#9632; NEUTRAL</span>
        &nbsp;&middot;&nbsp; Overall signal = majority vote across AO, RSI, MACD, SMA50, SMA200
      </p>

      {/* Counts */}
      {rows.length > 0 && (
        <div className="bss-counts">
          <div className="wl-count-box wl-count-buy">
            <div className="wl-count-num">{counts.BUY}</div>
            <div className="wl-count-lbl">BUY</div>
          </div>
          <div className="wl-count-box wl-count-sell">
            <div className="wl-count-num">{counts.SELL}</div>
            <div className="wl-count-lbl">SELL</div>
          </div>
          <div className="wl-count-box wl-count-neut">
            <div className="wl-count-num">{counts.NEUTRAL}</div>
            <div className="wl-count-lbl">NEUTRAL</div>
          </div>
          <div className="bss-count-total">
            <div className="wl-count-num" style={{ color: '#ccc' }}>{rows.length}</div>
            <div className="wl-count-lbl">TOTAL</div>
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

      {error && <div className="wl-error">{error}</div>}

      {/* Treemap */}
      {figData && figLayout && !loading && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Plot
            data={figData}
            layout={{ ...figLayout, autosize: true }}
            useResizeHandler
            style={{ width: '100%', height: 720 }}
            config={{ responsive: true }}
          />
        </div>
      )}

      {/* Signal Table */}
      {rows.length > 0 && !loading && (
        <>
          <h2 className="bss-table-title">
            Signal Detail Table
            <span style={{ fontWeight: 400, fontSize: '0.75rem', color: '#666' }}>&nbsp;&mdash; click any column header to sort</span>
          </h2>
          <div className="sst-wrap" style={{ maxHeight: 560 }}>
            <table className="sst" id="bss-tbl">
              <thead>
                <tr>
                  {headers.map((h, i) => {
                    const cls = i === 0 ? 'col-tick' : i === 1 ? 'col-name' : ([4, 5, 8, 9, 10, 11, 12, 14].includes(i) ? 'grp-left' : '')
                    return (
                      <th key={h} className={cls} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }}>
                        {h}{arrow(i)}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.ticker}>
                    <td className="col-tick"><strong>{r.ticker}</strong></td>
                    <td className="col-name" title={r.desc}>
                      {r.desc && r.desc.length > 34 ? r.desc.slice(0, 34) + '\u2026' : r.desc}
                    </td>
                    <td>{r.ctype}</td>
                    <td><SrcBadge source={r.source} /></td>
                    <td className="grp-left"><Sig signal={r.signal} /></td>
                    <td className="grp-left"><Sig signal={r.ao_sig} /></td>
                    <td>{r.ao_value}</td>
                    <td><AoDir dir={r.ao_dir} /></td>
                    <td className="grp-left">
                      <Sig signal={r.rsi_sig} />
                      <span className="ind-val">{r.rsi_value}</span>
                    </td>
                    <td className="grp-left"><Sig signal={r.macd_sig} /></td>
                    <td className="grp-left">
                      <Sig signal={r.sma50_sig} />
                      <span className={`ind-val ${pctCls(r.sma50_pct)}`}>{r.sma50_pct}</span>
                    </td>
                    <td className="grp-left">
                      <Sig signal={r.sma200_sig} />
                      <span className={`ind-val ${pctCls(r.sma200_pct)}`}>{r.sma200_pct}</span>
                    </td>
                    <td className="grp-left">{r.sharpe_val}</td>
                    <td>{r.sortino_val}</td>
                    <td className="grp-left">{r.pv_fmt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
