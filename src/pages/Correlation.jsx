import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'

const PERIODS = [
  { label: '3mo', value: '3mo' },
  { label: '6mo', value: '6mo' },
  { label: '1yr', value: '1y' },
  { label: '2yr', value: '2y' },
  { label: '5yr', value: '5y' },
  { label: 'Max', value: 'max' },
]

function corrColor(v) {
  if (v == null) return '#1a1a2e'
  // -1 (red) → 0 (yellow/neutral) → +1 (green)
  const clamped = Math.max(-1, Math.min(1, v))
  if (clamped >= 0) {
    // 0→1: dark → green
    const t = clamped
    const r = Math.round(26 * (1 - t) + 46 * t)
    const g = Math.round(26 * (1 - t) + 125 * t)
    const b = Math.round(46 * (1 - t) + 50 * t)
    return `rgb(${r},${g},${b})`
  } else {
    // -1→0: red → dark
    const t = 1 + clamped  // 0 at -1, 1 at 0
    const r = Math.round(198 * (1 - t) + 26 * t)
    const g = Math.round(40 * (1 - t) + 26 * t)
    const b = Math.round(40 * (1 - t) + 46 * t)
    return `rgb(${r},${g},${b})`
  }
}

function corrTextColor(v) {
  if (v == null) return '#555'
  const abs = Math.abs(v)
  return abs > 0.5 ? '#fff' : '#ccc'
}

// Plain-language reading of one cell, for the hover. Bands match the Help
// page (under 0.7 still diversifies, 0.9+ is close to the same asset twice)
// and use the value as displayed, so a cell showing 0.70 reads "Strongly".
function corrReading(v, same) {
  if (same) return { label: 'Same series', meaning: 'Anything moves perfectly with itself.' }
  if (v == null) {
    return { label: 'Not measured', meaning: 'Too few trading days in common to measure.' }
  }
  const r = Math.round(v * 100) / 100
  const a = Math.abs(r)
  const inverse = r < 0
  if (a < 0.2) return { label: 'Not correlated', meaning: 'Their daily moves are unrelated.' }
  if (a < 0.4) {
    return inverse
      ? { label: 'Weakly inversely correlated', meaning: 'They lean slightly toward moving in opposite directions.' }
      : { label: 'Weakly correlated', meaning: 'They mostly move independently.' }
  }
  if (a < 0.7) {
    return inverse
      ? { label: 'Somewhat inversely correlated', meaning: 'They often move in opposite directions.' }
      : { label: 'Somewhat correlated', meaning: 'They often move together, but not always.' }
  }
  if (a < 0.9) {
    return inverse
      ? { label: 'Strongly inversely correlated', meaning: 'They usually move in opposite directions.' }
      : { label: 'Strongly correlated', meaning: 'They usually move together.' }
  }
  return inverse
    ? { label: 'Very strongly inversely correlated', meaning: 'They almost always move in opposite directions.' }
    : { label: 'Very strongly correlated', meaning: 'They move almost in lockstep, close to holding the same thing twice.' }
}

// Hover card for a table cell. Portaled to <body> so a Split View pane's
// layout cannot offset its fixed position; theme variables live on <html>.
function CorrCellTip({ tip }) {
  const width = 280
  const left = tip.x + 14 + width > window.innerWidth ? tip.x - 14 - width : tip.x + 14
  const top = Math.min(tip.y + 14, window.innerHeight - 110)
  const reading = corrReading(tip.v, tip.same)
  return createPortal(
    <div role="tooltip" style={{
      position: 'fixed', left: Math.max(8, left), top, width, zIndex: 2000, pointerEvents: 'none',
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
      padding: '0.45rem 0.6rem', fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.45,
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
    }}>
      <div style={{ fontWeight: 600 }}>{tip.a} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>vs</span> {tip.b}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: corrColor(tip.v), flex: 'none' }} />
        <strong>{tip.v != null ? tip.v.toFixed(2) : '—'}</strong>
        <span>· {reading.label}</span>
      </div>
      <div style={{ color: 'var(--text-dim)' }}>{reading.meaning}</div>
    </div>,
    document.body,
  )
}

export default function Correlation() {
  const pf = useProfileFetch()
  const { profiles, aggregates } = useProfile()
  const { isDark } = useTheme()
  const [tickers, setTickers] = useState([])
  // Saved portfolios, each a whole-portfolio row plus (with `holdings`) a row
  // per holding: [{ key, kind, id, name, holdings }]
  const [portfolios, setPortfolios] = useState([])
  const [input, setInput] = useState('')
  const [period, setPeriod] = useState('1y')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  // Hovered table cell: { a, b, v, same, x, y }
  const [tip, setTip] = useState(null)
  // A ref, not an id lookup: Split View can mount this page in both panes, and
  // an id lookup returns the other pane's element.
  const heatmapRef = useRef(null)

  const addTicker = useCallback(() => {
    const t = input.trim().toUpperCase()
    if (t && !tickers.includes(t)) {
      setTickers(prev => [...prev, t])
    }
    setInput('')
  }, [input, tickers])

  const removeTicker = (t) => setTickers(prev => prev.filter(x => x !== t))
  const clearAll = () => { setTickers([]); setPortfolios([]); setResult(null); setError(null); setTip(null) }

  const portfolioOptions = [
    ...profiles.filter(p => !p.hidden_from_selector).map(p => ({
      key: `p:${p.id}`, kind: 'profile', id: p.id,
      name: p.name, label: `${p.name}${p.is_user_owned ? '' : ' [Test / non-owned]'}`,
    })),
    ...aggregates.filter(a => !a.hidden_from_selector).map(a => ({
      key: `a:${a.id}`, kind: 'aggregate', id: a.id, name: a.name, label: a.name,
    })),
  ].filter(o => !portfolios.some(p => p.key === o.key))

  const addPortfolio = (key) => {
    const opt = portfolioOptions.find(o => o.key === key)
    if (opt) setPortfolios(prev => [...prev, { key: opt.key, kind: opt.kind, id: opt.id, name: opt.name, holdings: true }])
  }
  const removePortfolio = (key) => setPortfolios(prev => prev.filter(p => p.key !== key))
  const togglePortfolioHoldings = (key) => setPortfolios(prev => prev.map(p => (
    p.key === key ? { ...p, holdings: !p.holdings } : p
  )))

  const seriesCount = tickers.length + portfolios.length
  // A portfolio with its holdings is a whole matrix on its own.
  const canRun = seriesCount >= 2 || portfolios.some(p => p.holdings)

  const runCorrelation = () => {
    if (!canRun) { setError('Add at least 2 tickers or portfolios.'); return }
    setError(null); setResult(null); setTip(null); setLoading(true)
    pf('/api/correlation/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers,
        portfolios: portfolios.map(p => ({ kind: p.kind, id: p.id, holdings: p.holdings })),
        period,
      }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setResult(d)
      })
      .catch(e => setError('Request failed: ' + e.message))
      .finally(() => setLoading(false))
  }

  // Render Plotly heatmap when result changes
  useEffect(() => {
    if (!result || !window.Plotly) return
    const el = heatmapRef.current
    if (!el) return
    const ct = chartTheme(isDark)

    const { tickers: t, matrix } = result
    // Reverse for Plotly (bottom-to-top y-axis)
    const reversedTickers = [...t].reverse()
    const reversedMatrix = [...matrix].reverse()

    // A portfolio with its holdings can run past the 50 typed tickers the
    // cell labels were sized for; beyond that the numbers are hover-only and
    // rows get shorter.
    const dense = t.length > 50
    const textVals = reversedMatrix.map(row =>
      row.map(v => v != null && !dense ? v.toFixed(2) : '')
    )
    // Same reading as the table hover. Pre-formatted here: Plotly 3 number
    // formats in a hovertemplate are not reliable.
    const hoverVals = reversedMatrix.map((row, ri) => row.map((v, j) => {
      const reading = corrReading(v, t.length - 1 - ri === j)
      return `${v != null ? v.toFixed(2) : '—'} · ${reading.label}<br>${reading.meaning}`
    }))

    // On a tall heatmap the bottom axis is far below the first rows, so the
    // column names are repeated along the top. Plotly only labels an axis
    // that has a trace, hence the invisible copy on a top axis that matches
    // the bottom one; it goes first so the real heatmap draws over it.
    const labelTop = t.length > 12
    // Plotly skips every other name once columns get narrow; a label on
    // every row and column is the point here, so they get smaller (and
    // vertical) instead.
    const crowded = t.length > 30
    const categoryTicks = { tickmode: 'linear', dtick: 1, ...(crowded ? { tickfont: { size: 10 } } : {}) }
    const topLabelTrace = {
      z: reversedMatrix, x: t, y: reversedTickers, xaxis: 'x2',
      type: 'heatmap', zmin: -1, zmax: 1, opacity: 0, showscale: false, hoverinfo: 'skip',
    }

    window.Plotly.newPlot(el, [...(labelTop ? [topLabelTrace] : []), {
      z: reversedMatrix,
      x: t,
      y: reversedTickers,
      type: 'heatmap',
      colorscale: [
        [0, '#c62828'],
        [0.25, '#e05555'],
        [0.5, '#f9a825'],
        [0.75, '#4caf50'],
        [1, '#2e7d32'],
      ],
      zmin: -1, zmax: 1,
      text: textVals,
      texttemplate: '%{text}',
      customdata: hoverVals,
      hovertemplate: '<b>%{y} vs %{x}</b><br>%{customdata}<extra></extra>',
      colorbar: {
        title: 'Correlation',
        tickvals: [-1, -0.5, 0, 0.5, 1],
        ticktext: ['-1.0', '-0.5', '0.0', '0.5', '1.0'],
      },
    }], {
      template: ct.template,
      paper_bgcolor: ct.paper,
      plot_bgcolor: ct.plot,
      font: { color: ct.font },
      // The title is the card heading above the chart: inside the plot it
      // landed on the top column names.
      // automargin: portfolio names are longer than the 80px a ticker needs.
      xaxis: { side: 'bottom', automargin: true, ...categoryTicks, tickangle: crowded ? -90 : -45 },
      ...(labelTop ? {
        xaxis2: {
          side: 'top', overlaying: 'x', matches: 'x', automargin: true,
          ...categoryTicks, tickangle: crowded ? -90 : -45,
        },
      } : {}),
      yaxis: { automargin: true, ...categoryTicks },
      height: Math.max(450, t.length * (dense ? 18 : 40) + 120),
      margin: { l: 80, r: 80, t: 20, b: 80 },
    }, { responsive: true })

    return () => { if (el) window.Plotly.purge(el) }
  }, [result, isDark])

  const portfolioSeries = useMemo(
    () => (result?.series || []).filter(s => s.kind === 'portfolio'),
    [result],
  )
  const portfolioLabels = useMemo(() => new Set(portfolioSeries.map(s => s.label)), [portfolioSeries])
  const seriesTitle = useCallback((label) => {
    const s = (result?.series || []).find(x => x.label === label)
    if (s?.kind === 'holding') return `${s.weight_pct ?? '?'}% of ${s.portfolio}`
    if (s?.kind === 'portfolio') return 'Whole portfolio: current holdings at today\'s value weights'
    return undefined
  }, [result])

  // One handler on the table instead of one per cell (a portfolio with its
  // holdings can be 100 x 100 cells).
  const onTableHover = useCallback((e) => {
    const cell = e.target.closest('td[data-i]')
    if (!cell || !result) { setTip(null); return }
    const i = Number(cell.dataset.i)
    const j = Number(cell.dataset.j)
    setTip({
      a: result.tickers[i], b: result.tickers[j], v: result.matrix[i][j],
      same: i === j, x: e.clientX, y: e.clientY,
    })
  }, [result])
  const hideTip = useCallback(() => setTip(null), [])

  // Frozen panes, as in Excel. The page scrolls the window (the app header is
  // pinned there), so the header row is its own strip pinned under the app
  // header; a header inside a scroll box would leave the screen with the box.
  // The body scrolls sideways under it with the name column frozen, and the
  // two follow each other's scrollLeft. The strip carries the sideways
  // scrollbar so it is reachable from any row.
  const headScrollRef = useRef(null)
  const bodyScrollRef = useRef(null)
  const syncFromHead = useCallback(() => {
    const head = headScrollRef.current
    const body = bodyScrollRef.current
    if (head && body && body.scrollLeft !== head.scrollLeft) body.scrollLeft = head.scrollLeft
  }, [])
  const syncFromBody = useCallback(() => {
    const head = headScrollRef.current
    const body = bodyScrollRef.current
    if (head && body && head.scrollLeft !== body.scrollLeft) head.scrollLeft = body.scrollLeft
  }, [])

  // Memoized so moving the mouse redraws only the hover card, not every cell.
  const correlationTable = useMemo(() => {
    if (!result) return null
    const headBg = 'var(--border)'
    // The strip and the body are separate tables, so both use the same fixed
    // column widths. Estimated from label length at this font (0.82rem bold);
    // a long portfolio name wraps in its column header and is cut short with
    // an ellipsis in the name column (its hover shows it in full).
    const charPx = 8.6
    const colWidths = result.tickers.map(t => Math.min(110, Math.max(60, Math.ceil(t.length * charPx) + 22)))
    const longest = Math.max(...result.tickers.map(t => t.length))
    const nameWidth = Math.min(230, Math.max(70, Math.ceil(longest * charPx) + 26))
    const tableStyle = {
      tableLayout: 'fixed', width: nameWidth + colWidths.reduce((a, b) => a + b, 0),
      borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.82rem',
    }
    const cols = (
      <colgroup>
        <col style={{ width: nameWidth }} />
        {colWidths.map((w, j) => <col key={j} style={{ width: w }} />)}
      </colgroup>
    )
    return (
      <>
        <div
          ref={headScrollRef}
          onScroll={syncFromHead}
          style={{
            position: 'sticky', top: 'var(--app-header-height)', zIndex: 4,
            overflowX: 'auto', scrollbarWidth: 'thin', background: 'var(--surface)',
          }}
        >
          <table style={tableStyle}>
            {cols}
            <thead>
              <tr>
                <th style={{
                  padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--p-2a3a4e)', color: 'var(--text-dim)',
                  position: 'sticky', top: 0, left: 0, zIndex: 2, background: headBg,
                }}></th>
                {result.tickers.map(t => (
                  <th key={t} title={seriesTitle(t)} style={{
                    padding: '0.4rem 0.3rem', borderBottom: '1px solid var(--p-2a3a4e)',
                    color: portfolioLabels.has(t) ? 'var(--purple)' : 'var(--accent-bright)',
                    fontWeight: 600, textAlign: 'center', whiteSpace: 'normal',
                    overflowWrap: 'anywhere', lineHeight: 1.2,
                    position: 'static', background: headBg,
                  }}>{t}</th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div
          ref={bodyScrollRef}
          onScroll={syncFromBody}
          style={{ overflowX: 'auto', scrollbarWidth: 'none' }}
        >
          <table onMouseMove={onTableHover} onMouseLeave={hideTip} style={tableStyle}>
            {cols}
            <tbody>
              {result.tickers.map((rowT, i) => (
                <tr key={rowT}>
                  <td title={seriesTitle(rowT) || rowT} style={{
                    padding: '0.4rem 0.6rem', fontWeight: 600,
                    color: portfolioLabels.has(rowT) ? 'var(--purple)' : 'var(--accent-bright)',
                    borderRight: '1px solid var(--p-2a3a4e)', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface)',
                  }}>{rowT}</td>
                  {result.matrix[i].map((v, j) => {
                    const isDiag = i === j
                    return (
                      <td key={j} data-i={i} data-j={j} style={{
                        padding: '0.4rem 0.3rem', textAlign: 'center', cursor: 'default',
                        background: isDiag ? 'var(--p-2a3a4e)' : corrColor(v),
                        color: isDiag ? 'var(--p-aaa)' : corrTextColor(v),
                        fontWeight: isDiag ? 400 : (Math.abs(v || 0) > 0.7 ? 600 : 400),
                        // Right and bottom only: separate borders (which sticky
                        // cells need) would otherwise double every gap.
                        borderRight: '1px solid var(--bg)', borderBottom: '1px solid var(--bg)',
                      }}>
                        {v != null ? v.toFixed(2) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }, [result, portfolioLabels, seriesTitle, onTableHover, hideTip, syncFromHead, syncFromBody])

  return (
    <div className="page">
      <h1 style={{ marginBottom: '0.3rem' }}>Correlation Matrix</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Analyze how tickers and your portfolios move relative to each other. Values near 1.0 (green) move together,
        near -1.0 (red) move inversely, near 0 are uncorrelated.
      </p>

      {/* Controls */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <input
            style={{
              width: 100, textTransform: 'uppercase', padding: '0.35rem 0.5rem',
              background: 'var(--bg)', border: '1px solid var(--p-3a3a5c)', borderRadius: 4,
              color: 'var(--text)', fontSize: '0.9rem',
            }}
            maxLength={10} placeholder="e.g. SPY"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addTicker() }}
          />
          <button className="btn btn-primary" onClick={addTicker} style={{ padding: '0.35rem 0.8rem' }}>Add</button>

          <select
            value=""
            onChange={e => addPortfolio(e.target.value)}
            disabled={portfolioOptions.length === 0}
            title="Add a saved portfolio as one series: its current holdings weighted by today's market value"
            style={{
              padding: '0.35rem 0.5rem', background: 'var(--bg)', border: '1px solid var(--p-3a3a5c)',
              borderRadius: 4, color: 'var(--text)', fontSize: '0.85rem', maxWidth: 220,
            }}
          >
            <option value="">
              {portfolioOptions.length === 0 && portfolios.length > 0 ? 'All portfolios added' : '+ Add portfolio…'}
            </option>
            {portfolioOptions.filter(o => o.kind === 'profile').map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
            {portfolioOptions.some(o => o.kind === 'aggregate') && (
              <optgroup label="Aggregates">
                {portfolioOptions.filter(o => o.kind === 'aggregate').map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </optgroup>
            )}
          </select>

          <span style={{ color: 'var(--p-556677)', margin: '0 0.3rem' }}>|</span>

          <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginRight: '0.3rem' }}>Period:</span>
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              style={{
                padding: '0.25rem 0.6rem', borderRadius: 4, cursor: 'pointer',
                border: period === p.value ? '1px solid var(--accent)' : '1px solid var(--p-3a3a5c)',
                background: period === p.value ? 'var(--p-1a3a5c)' : 'var(--bg)',
                color: period === p.value ? 'var(--accent)' : 'var(--text-dim)',
                fontSize: '0.82rem', fontWeight: period === p.value ? 600 : 400,
              }}
            >{p.label}</button>
          ))}

          <span style={{ color: 'var(--p-556677)', margin: '0 0.3rem' }}>|</span>

          <button className="btn btn-success" onClick={runCorrelation} disabled={loading || !canRun}
            style={{ padding: '0.35rem 1rem', fontWeight: 600 }}>
            {loading ? 'Loading...' : 'Run'}
          </button>
          <button className="btn" onClick={clearAll} style={{ padding: '0.35rem 0.6rem', color: 'var(--text-dim)' }}>Clear</button>
        </div>

        {/* Portfolio and ticker chips */}
        {seriesCount > 0 && (
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {portfolios.map(p => (
              <span key={p.key} title={p.kind === 'aggregate' ? 'Aggregate portfolio' : 'Portfolio'} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '0.2rem 0.5rem', background: 'var(--p-1a2a3e)', border: '1px solid var(--purple)',
                borderRadius: 4, fontSize: '0.82rem', color: 'var(--purple)', fontWeight: 600,
              }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.85 }}>
                  {p.kind === 'aggregate' ? 'Aggregate' : 'Portfolio'}
                </span>
                {p.name}
                <label
                  title="On: each holding gets its own row, plus one row for the whole portfolio. Off: just the whole-portfolio row."
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4,
                    fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-dim)', cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox" checked={p.holdings}
                    onChange={() => togglePortfolioHoldings(p.key)}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  holdings
                </label>
                <button onClick={() => removePortfolio(p.key)} style={{
                  background: 'none', border: 'none', color: 'var(--neg)', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.9rem', padding: '0 2px', lineHeight: 1,
                }}>&times;</button>
              </span>
            ))}
            {tickers.map(t => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '0.2rem 0.5rem', background: 'var(--p-1a2a3e)', border: '1px solid var(--p-2a4a6e)',
                borderRadius: 4, fontSize: '0.82rem', color: 'var(--accent-bright)', fontWeight: 600,
              }}>
                {t}
                <button onClick={() => removeTicker(t)} style={{
                  background: 'none', border: 'none', color: 'var(--neg)', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.9rem', padding: '0 2px', lineHeight: 1,
                }}>&times;</button>
              </span>
            ))}
            <span style={{ color: 'var(--p-556677)', fontSize: '0.78rem', alignSelf: 'center' }}>
              {tickers.length} ticker{tickers.length !== 1 ? 's' : ''}
              {portfolios.length > 0 && ` · ${portfolios.length} portfolio${portfolios.length !== 1 ? 's' : ''}`}
              {!canRun && ' · add one more ticker or portfolio to compare'}
            </span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" />
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Missing tickers warning */}
          {result.missing?.length > 0 && (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              No data found for: {result.missing.join(', ')}
            </div>
          )}

          {/* Correlation Table */}
          <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
            <h3 style={{ color: 'var(--accent-2)', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
              Correlation Table — {PERIODS.find(p => p.value === result.period)?.label || result.period}
              <span style={{ color: 'var(--p-556677)', fontWeight: 400, fontSize: '0.82rem', marginLeft: '0.5rem' }}>
                ({result.data_points} trading days)
              </span>
            </h3>
            {correlationTable}
            {tip && <CorrCellTip tip={tip} />}
            {portfolioSeries.length > 0 && (
              <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '0.6rem', lineHeight: 1.5 }}>
                <div>
                  <span style={{ color: 'var(--purple)', fontWeight: 600 }}>Portfolio</span> rows use each
                  portfolio's current holdings weighted by today's market value (cash excluded), the same basket
                  the Analytics page grades. Hover a holding's name for its weight.
                </div>
                {portfolioSeries.map(s => (
                  <div key={s.label}>
                    {s.label}: {s.holdings_priced} of {s.holdings_total} holding{s.holdings_total !== 1 ? 's' : ''} priced
                    {s.value_coverage_pct != null && ` (${s.value_coverage_pct}% of value)`}
                    {s.unpriced?.length > 0 && ` — no price data for ${s.unpriced.join(', ')}`}
                    {s.short_history?.length > 0 && ` — in the portfolio row, but under 30 days of prices to show alone: ${s.short_history.join(', ')}`}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Plotly Heatmap */}
          <div className="card" style={{ padding: '0.75rem 1rem' }}>
            <h3 style={{ color: 'var(--accent-2)', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
              Correlation Matrix — {PERIODS.find(p => p.value === result.period)?.label || result.period}
              <span style={{ color: 'var(--p-556677)', fontWeight: 400, fontSize: '0.82rem', marginLeft: '0.5rem' }}>
                ({result.data_points} trading days)
              </span>
            </h3>
            <div ref={heatmapRef} id="corr-heatmap" />
          </div>
        </>
      )}
    </div>
  )
}
