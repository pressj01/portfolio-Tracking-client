import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import Plot from '../components/ThemedPlot'
import {
  GRADING_PREFERENCES_EVENT,
  loadGradingPreferences,
} from '../utils/gradingPreferences'

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

function SafetyBadge({ risk, score }) {
  if (!risk || risk === '—') return <span>{'\u2014'}</span>
  const text = score != null ? `${Math.round(Number(score))} / ${risk}` : risk
  const cls = String(risk).toLowerCase().replace(/\s+/g, '-')
  return <span className={`safety-badge safety-${cls}`}>{text}</span>
}

function pctCls(s) {
  if (!s) return ''
  if (s[0] === '+') return 'pct-up'
  if (s[0] === '-') return 'pct-down'
  return ''
}

const signalHelpItems = settings => [
  {
    label: 'AO',
    text: `Awesome Oscillator compares 5-day and 34-day midpoint averages. BUY means AO is above +${settings.thresholds.aoZeroBuffer} and rising; SELL means it is below -${settings.thresholds.aoZeroBuffer} and falling. Vote weight: ${settings.weights.ao}.`,
  },
  {
    label: 'RSI',
    text: `RSI uses a 14-day relative strength reading. Below ${settings.thresholds.rsiBuyBelow} is BUY, above ${settings.thresholds.rsiSellAbove} is SELL, and the middle range is NEUTRAL. Vote weight: ${settings.weights.rsi}.`,
  },
  {
    label: 'MACD',
    text: `MACD uses the standard 12/26/9 setup. BUY means the MACD line is above its signal line; SELL means it is below. Vote weight: ${settings.weights.macd}.`,
  },
  {
    label: 'SMA 50',
    text: `BUY when price is more than ${settings.thresholds.smaBufferPct}% above the 50-day moving average, SELL when more than ${settings.thresholds.smaBufferPct}% below it, otherwise NEUTRAL. Vote weight: ${settings.weights.sma50}.`,
  },
  {
    label: 'SMA 200',
    text: `The same ${settings.thresholds.smaBufferPct}% band is applied to the 200-day moving average. This is the longer-term trend vote. Vote weight: ${settings.weights.sma200}.`,
  },
  {
    label: 'NAV',
    text: `Only used for NAV-erosion candidates. BUY at a ratio ≤${settings.thresholds.navBuyMaxRatio}, NEUTRAL through ${settings.thresholds.navSellAboveRatio}, and SELL above it or after a price decline of ${settings.thresholds.navHardDeclinePct}%+. Vote weight: ${settings.weights.nav}.`,
  },
]

export default function BuySellSignals() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [rows, setRows] = useState([])
  const [figData, setFigData] = useState(null)
  const [figLayout, setFigLayout] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [timestamp, setTimestamp] = useState(null)
  const [preferences, setPreferences] = useState(loadGradingPreferences)
  const formula = preferences.signals

  useEffect(() => {
    const refresh = event => setPreferences(event.detail || loadGradingPreferences())
    window.addEventListener(GRADING_PREFERENCES_EVENT, refresh)
    return () => window.removeEventListener(GRADING_PREFERENCES_EVENT, refresh)
  }, [])

  const loadData = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      ao_zero_buffer: formula.thresholds.aoZeroBuffer,
      rsi_buy_below: formula.thresholds.rsiBuyBelow,
      rsi_sell_above: formula.thresholds.rsiSellAbove,
      sma_buffer_pct: formula.thresholds.smaBufferPct,
      majority_pct: formula.thresholds.majorityPct,
      nav_buy_max_ratio: formula.thresholds.navBuyMaxRatio,
      nav_sell_above_ratio: formula.thresholds.navSellAboveRatio,
      nav_hard_decline_pct: formula.thresholds.navHardDeclinePct,
      weight_ao: formula.weights.ao,
      weight_rsi: formula.weights.rsi,
      weight_macd: formula.weights.macd,
      weight_sma50: formula.weights.sma50,
      weight_sma200: formula.weights.sma200,
      weight_nav: formula.weights.nav,
    })
    pf(`/api/buy-sell-signals?${params}`)
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
  }, [pf, selection, formula])

  useEffect(() => { loadData() }, [loadData])

  const counts = useMemo(() => {
    const c = { BUY: 0, SELL: 0, NEUTRAL: 0 }
    rows.forEach(r => { c[r.signal] = (c[r.signal] || 0) + 1 })
    return c
  }, [rows])

  // Sorting
  const colKeys = ['ticker', 'desc', 'ctype', 'source', 'sig_order', 'ao_sig_ord', 'ao_val_num', 'ao_dir',
    'rsi_sig_ord', 'macd_sig_ord', 'sma50_sig_ord', 'sma200_sig_ord', 'sharpe_val_num', 'sortino_val_num',
    'cov_ratio_num', 'cov_sig_ord', 'nav_erosion', 'div_safety_score', 'div_cut_risk', 'pv_num']

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

  const headers = [
    { label: 'Ticker' },
    { label: 'Name' },
    { label: 'Type' },
    { label: 'Source', tip: 'Where the ticker originates (Portfolio or Watchlist)' },
    { label: 'Overall', tip: `Weighted vote across AO, RSI, MACD, SMA50, SMA200, and eligible NAV Signal; one side must exceed ${formula.thresholds.majorityPct}% of active weight` },
    { label: 'AO', tip: 'Awesome Oscillator signal — momentum based on 5/34-period midpoint SMAs' },
    { label: 'AO Value', tip: 'Raw Awesome Oscillator value' },
    { label: 'AO Dir', tip: 'Awesome Oscillator direction (rising or falling)' },
    { label: 'RSI', tip: `Relative Strength Index signal — SELL above ${formula.thresholds.rsiSellAbove}, BUY below ${formula.thresholds.rsiBuyBelow}` },
    { label: 'MACD', tip: 'Moving Average Convergence Divergence signal' },
    { label: 'SMA 50', tip: `Simple Moving Average 50-day with a ±${formula.thresholds.smaBufferPct}% neutral band` },
    { label: 'SMA 200', tip: `Simple Moving Average 200-day with a ±${formula.thresholds.smaBufferPct}% neutral band` },
    { label: 'Sharpe', tip: 'Risk-adjusted return. >1.5 great, >1.0 good, <0.5 poor' },
    { label: 'Sortino', tip: 'Like Sharpe but only penalizes downside. >2.0 great, >1.5 good' },
    { label: 'NAV Ratio', tip: 'NAV erosion ratio: fund price decline / TTM distribution yield, only when benchmark is flat or up. Lagging a rising benchmark is not erosion.' },
    { label: 'NAV Signal', tip: `BUY at ratio ≤${formula.thresholds.navBuyMaxRatio}; SELL above ${formula.thresholds.navSellAboveRatio} or after a ${formula.thresholds.navHardDeclinePct}%+ price decline; otherwise NEUTRAL.` },
    { label: 'NAV Erosion', tip: `High above ratio ${formula.thresholds.navSellAboveRatio} or after the hard-decline override; Medium above ${formula.thresholds.navBuyMaxRatio}; Low at or below ${formula.thresholds.navBuyMaxRatio}.` },
    { label: 'Div Safety', tip: 'Dividend safety score and cut-risk level for portfolio holdings' },
    { label: 'Cut Risk', tip: 'Flags portfolio holdings with elevated or high dividend cut risk' },
    { label: 'Portfolio Value', tip: 'Current market value of this position in portfolio' },
  ]

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
        <span style={{ color: 'var(--pos-strong)', fontWeight: 600 }}>&#9632; BUY</span>&nbsp;
        <span style={{ color: 'var(--neg-strong)', fontWeight: 600 }}>&#9632; SELL</span>&nbsp;
        <span style={{ color: 'var(--warning)', fontWeight: 600 }}>&#9632; NEUTRAL</span>
        &nbsp;&middot;&nbsp; Overall signal = weighted vote; BUY or SELL must exceed {formula.thresholds.majorityPct}% of active weight
      </p>

      <details className="bss-help">
        <summary>How the signals are created</summary>
        <div className="bss-help-grid">
          {signalHelpItems(formula).map(item => (
            <div className="bss-help-item" key={item.label}>
              <strong>{item.label}</strong>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
        <p className="bss-help-note">
          Growth stocks, ordinary equities, broad-market ETFs, and dividend-growth funds do not need a separate dashboard.
          Their Overall score is driven by the technical votes; the NAV erosion vote is skipped unless the holding matches an
          income-fund structure where destructive NAV decay is plausible.
        </p>
        <p className="bss-help-note"><Link to="/settings#grading-formulas">View or change these thresholds and vote weights in Settings.</Link></p>
      </details>

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
            <div className="wl-count-num" style={{ color: 'var(--p-ccc)' }}>{rows.length}</div>
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
            <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--p-666)' }}>&nbsp;&mdash; click any column header to sort</span>
          </h2>
          <div className="sst-wrap" style={{ maxHeight: 560 }}>
            <table className="sst" id="bss-tbl">
              <thead>
                <tr>
                  {headers.map((h, i) => {
                    const cls = i === 0 ? 'col-tick' : i === 1 ? 'col-name' : ([4, 5, 8, 9, 10, 11, 12, 14, 17, 19].includes(i) ? 'grp-left' : '')
                    return (
                      <th key={h.label} className={cls} onClick={() => handleSort(i)} style={{ cursor: 'pointer' }} title={h.tip || ''}>
                        {h.label}{h.tip ? ' \u24D8' : ''}{arrow(i)}
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
                    <td className="grp-left">{r.cov_ratio}</td>
                    <td><Sig signal={r.cov_sig} /></td>
                    <td style={{
                      color: r.nav_erosion === 'Low' ? 'var(--pos-strong)' : r.nav_erosion === 'High' ? 'var(--neg-strong)' : r.nav_erosion === 'Medium' ? 'var(--warning)' : 'var(--p-888)',
                      fontWeight: 600,
                      backgroundColor: r.nav_erosion === 'Low' ? 'rgba(0,200,83,0.12)' : r.nav_erosion === 'High' ? 'rgba(213,0,0,0.12)' : r.nav_erosion === 'Medium' ? 'rgba(249,168,37,0.12)' : 'transparent',
                    }}>{r.nav_erosion}</td>
                    <td className="grp-left" title={r.div_risk_reasons?.join('; ') || ''}>
                      <SafetyBadge risk={r.div_safety_risk} score={r.div_safety_score} />
                    </td>
                    <td>
                      {r.source === 'Portfolio'
                        ? <span className={`cut-risk ${r.div_cut_risk ? 'cut-risk-yes' : 'cut-risk-no'}`}>{r.div_cut_risk ? 'Yes' : 'No'}</span>
                        : '\u2014'}
                    </td>
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

