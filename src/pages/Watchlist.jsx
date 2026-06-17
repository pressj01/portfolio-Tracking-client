import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'

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
  return formatMoney(v)
}

function YieldCell({ ticker, computed, override, overridden, onSave }) {
  const [editing, setEditing] = useState(false)
  const initial = (override ?? '').toString()
  const [draft, setDraft] = useState(initial)
  const inputRef = useRef(null)

  useEffect(() => { setDraft((override ?? '').toString()) }, [override])
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== ((override ?? '').toString())) onSave(ticker, draft)
  }

  const cancel = () => {
    setDraft((override ?? '').toString())
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="wl-input"
        type="number"
        step="0.01"
        min="0"
        placeholder="blank = auto"
        style={{ width: 80, padding: '0.2rem 0.35rem', fontSize: '0.85rem' }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
      />
    )
  }

  const display = computed != null ? computed.toFixed(2) + '%' : '—'
  return (
    <span
      onClick={() => setEditing(true)}
      title={overridden ? 'Manual override (click to edit)' : 'Click to override yield'}
      style={{
        display: 'inline-block',
        minWidth: 60,
        padding: '0.15rem 0.3rem',
        cursor: 'text',
        color: overridden ? 'var(--p-ffb74d)' : 'inherit',
        fontWeight: overridden ? 600 : 'inherit',
        borderRadius: 3,
      }}
    >
      {display}{overridden ? ' *' : ''}
    </span>
  )
}

function NotesCell({ ticker, value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onSave(ticker, draft)
  }

  const cancel = () => {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="wl-input"
        style={{ width: '100%', minWidth: 160, padding: '0.25rem 0.4rem', fontSize: '0.85rem' }}
        value={draft}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title="Click to edit notes"
      style={{
        display: 'inline-block',
        minHeight: '1.2em',
        minWidth: 140,
        padding: '0.15rem 0.3rem',
        cursor: 'text',
        color: value ? 'inherit' : 'var(--p-5a6878)',
        fontStyle: value ? 'normal' : 'italic',
        borderRadius: 3,
      }}
    >
      {value || 'Click to add note'}
    </span>
  )
}

function NavCell({ row, analysis, onSave }) {
  const scope = row.nav_erosion_scope || analysis?.nav_erosion_scope || 'auto'
  const benchmarkOverride = row.nav_benchmark_override || analysis?.nav_benchmark_override || ''
  const benchmarkUsed = analysis?.benchmark || row.benchmark || ''
  const benchmarkInvalid = benchmarkOverride && (analysis?.benchmark_valid === false || row.benchmark_valid === false)
  const navTested = analysis?.nav_tested ?? row.nav_tested
  const navLabel = scope === 'test' ? 'Test' : scope === 'skip' ? 'Skip' : 'Auto'
  const benchmarkLabel = benchmarkOverride || benchmarkUsed
  const title = scope === 'skip'
    ? 'Skipped by user override'
    : benchmarkInvalid
      ? `${benchmarkOverride} is not returning benchmark price history`
      : scope === 'test'
        ? `Forced NAV test${benchmarkOverride || benchmarkUsed ? ` vs ${benchmarkOverride || benchmarkUsed}` : ''}`
        : navTested
          ? `Auto-tested${benchmarkOverride || benchmarkUsed ? ` vs ${benchmarkOverride || benchmarkUsed}` : ''}`
          : 'Auto: not tested by current NAV erosion rules'

  const saveScope = (nextScope) => onSave(row.ticker, nextScope, benchmarkOverride)
  const saveBenchmark = (value) => onSave(row.ticker, scope, value)

  return (
    <td
      style={{
        color: analysis?.nav_erosion_prob === 'Low' ? 'var(--pos-strong)' : analysis?.nav_erosion_prob === 'High' ? 'var(--neg-strong)' : analysis?.nav_erosion_prob === 'Medium' ? 'var(--warning)' : 'var(--p-888)',
        fontWeight: 600,
        backgroundColor: analysis?.nav_erosion_prob === 'Low' ? 'rgba(0,200,83,0.12)' : analysis?.nav_erosion_prob === 'High' ? 'rgba(213,0,0,0.12)' : analysis?.nav_erosion_prob === 'Medium' ? 'rgba(249,168,37,0.12)' : 'transparent',
        minWidth: 128,
      }}
      title={title}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{analysis?.nav_erosion_prob ? `${analysis.nav_erosion_prob} Probability` : '\u2014'}</span>
        <select
          aria-label={`${row.ticker} NAV erosion testing`}
          value={scope}
          onChange={e => saveScope(e.target.value)}
          title={title}
          style={{
            width: 48,
            height: 21,
            border: '1px solid var(--p-294b73)',
            borderRadius: 4,
            background: 'var(--p-0f1c36)',
            color: scope === 'test' ? 'var(--accent-bright)' : scope === 'skip' ? 'var(--warning-money)' : 'var(--p-9aa8bd)',
            fontSize: '0.62rem',
            padding: '0 2px',
          }}
        >
          <option value="auto">Auto</option>
          <option value="test">Test</option>
          <option value="skip">Skip</option>
        </select>
      </div>
      <input
        aria-label={`${row.ticker} NAV benchmark override`}
        value={benchmarkOverride}
        placeholder={benchmarkUsed || 'bench'}
        onChange={e => onSave(row.ticker, scope, e.target.value.toUpperCase(), true)}
        onBlur={e => saveBenchmark(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        title="Optional benchmark override, e.g. QQQ, GLD, BTC-USD, or BTC-USD+GLD"
        style={{
          width: 86,
          marginTop: 3,
          border: benchmarkInvalid ? '1px solid var(--neg-strong)' : '1px solid var(--p-203a5f)',
          borderRadius: 4,
          background: 'var(--p-0d1830)',
          color: benchmarkInvalid ? 'var(--p-ffb3b3)' : benchmarkOverride ? 'var(--p-d7e8ff)' : 'var(--p-7d8799)',
          fontSize: '0.62rem',
          padding: '2px 4px',
        }}
      />
      <div style={{ fontSize: '0.58rem', color: 'var(--p-7d8799)', lineHeight: 1.1 }}>
        {navLabel}{benchmarkLabel ? ` vs ${benchmarkLabel}` : ''}
      </div>
    </td>
  )
}

function WatchlistTickerModal({ ticker, onClose }) {
  const pf = useProfileFetch()
  const { isDark } = useTheme()
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
    const ct = chartTheme(isDark)

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
      template: ct.template,
      paper_bgcolor: ct.paper, plot_bgcolor: ct.plot,
      font: { color: ct.font },
      title: { text: `${data.ticker} — 1 Year Return`, font: { size: 16, color: ct.title } },
      xaxis: { title: '', gridcolor: ct.grid, zerolinecolor: ct.zeroline },
      yaxis: { title: 'Return %', gridcolor: ct.grid, zerolinecolor: ct.zeroline, ticksuffix: '%' },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 12 } },
      margin: { l: 50, r: 20, t: 60, b: 40 },
      hovermode: 'x unified',
      shapes: [{ type: 'line', x0: data.dates[0], x1: data.dates[data.dates.length - 1], y0: 0, y1: 0, line: { dash: 'dot', color: ct.zeroline, width: 1 } }],
    }
    window.Plotly.newPlot(el, traces, layout, { responsive: true })
    return () => { if (el) window.Plotly.purge(el) }
  }, [data, isDark])

  if (!ticker) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
        {error && <div className="alert alert-error">{error}</div>}
        {data && (
          <>
            <h2 style={{ color: 'var(--accent-bright)', marginBottom: '0.25rem' }}>{data.ticker} — {data.description}</h2>
            <p style={{ color: 'var(--text-dim)', marginBottom: '1rem', fontSize: '0.9rem' }}>
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
  const watchingListRef = useRef(watchingList)
  const saveQueueRef = useRef(Promise.resolve())

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

  const cleanWatchlistRows = (rows) => rows.map(r => ({
    ticker: r.ticker,
    notes: r.notes || '',
    div_yield_override: r.div_yield_override ?? null,
    nav_erosion_scope: r.nav_erosion_scope || 'auto',
    nav_benchmark_override: r.nav_benchmark_override || '',
  }))

  const saveList = useCallback((newList, options = {}) => {
    watchingListRef.current = newList
    setWatchingList(newList)
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(() => pf('/api/watchlist/watching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: cleanWatchlistRows(newList),
        preserve_notes: !!options.preserveNotes,
      }),
    }))
    return saveQueueRef.current
  }, [pf])

  useEffect(() => { watchingListRef.current = watchingList }, [watchingList])

  const addWatching = async () => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    const current = watchingListRef.current
    const trimmedNotes = notes.trim()
    const existingIdx = current.findIndex(r => r.ticker === t)
    if (existingIdx !== -1) {
      // Already in list — update notes instead of erroring out
      if (!trimmedNotes) {
        await dialog.alert(t + ' is already in your watching list. Type notes in the Notes field to update them, or click the Notes cell in the table.')
        return
      }
      const newList = current.map((r, i) => i === existingIdx ? { ...r, notes: trimmedNotes } : r)
      saveList(newList)
      setTicker('')
      setNotes('')
      return
    }
    const newList = [...current, { ticker: t, notes: trimmedNotes }]
    saveList(newList)
    setTicker('')
    setNotes('')
    // Re-run analysis to include new ticker
    setTimeout(loadAnalysis, 300)
  }

  const updateNotes = (t, newNotes) => {
    const current = watchingListRef.current
    const trimmed = (newNotes || '').slice(0, 500)
    const idx = current.findIndex(r => r.ticker === t)
    if (idx === -1) return
    if ((current[idx].notes || '') === trimmed) return
    const newList = current.map((r, i) => i === idx ? { ...r, notes: trimmed } : r)
    saveList(newList)
  }

  const updateYieldOverride = (t, newValue) => {
    const current = watchingListRef.current
    const idx = current.findIndex(r => r.ticker === t)
    if (idx === -1) return
    const trimmed = (newValue ?? '').toString().trim()
    let parsed = null
    if (trimmed !== '') {
      const n = Number(trimmed)
      if (Number.isFinite(n)) parsed = n
      else return
    }
    const prev = current[idx].div_yield_override
    const prevNorm = (prev === undefined || prev === null) ? null : Number(prev)
    if (prevNorm === parsed) return
    const newList = current.map((r, i) => i === idx ? { ...r, div_yield_override: parsed } : r)
    saveList(newList, { preserveNotes: true })
    setTimeout(loadAnalysis, 200)
  }

  const updateNavSettings = (t, scope, benchmark, localOnly = false) => {
    const current = watchingListRef.current
    const idx = current.findIndex(r => r.ticker === t)
    if (idx === -1) return
    const nextScope = ['auto', 'test', 'skip'].includes(scope) ? scope : 'auto'
    const nextBenchmark = (benchmark || '').trim().toUpperCase()
    const prevScope = current[idx].nav_erosion_scope || 'auto'
    const prevBenchmark = current[idx].nav_benchmark_override || ''
    if (prevScope === nextScope && prevBenchmark === nextBenchmark && !current[idx]._nav_dirty) return

    const newList = current.map((r, i) => i === idx ? {
      ...r,
      nav_erosion_scope: nextScope,
      nav_benchmark_override: nextBenchmark,
      _nav_dirty: localOnly,
    } : r)
    if (localOnly) {
      watchingListRef.current = newList
      setWatchingList(newList)
      return
    }
    saveList(newList, { preserveNotes: true })
    setTimeout(loadAnalysis, 200)
  }

  const removeWatching = (t) => {
    saveList(watchingListRef.current.filter(r => r.ticker !== t), { preserveNotes: true })
  }

  const getAnalysis = (tkr) => {
    if (!analysisData) return null
    const rows = analysisData.watching || []
    return rows.find(r => r.ticker === tkr) || null
  }

  // Build display rows — spread analysis first so user-edited fields
  // (notes, div_yield_override) from watchingList always win over any
  // stale copies the analysis endpoint may return.
  const displayRows = watchingList.map(r => ({
    ...(getAnalysis(r.ticker) || {}),
    ...r,
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
                  { label: 'Div Yield', tip: 'Current annual dividend yield. Click the cell to override (e.g. for high-yield ETFs where yfinance is stale).' },
                  { label: 'Signal', tip: 'Overall buy/sell signal — majority vote across indicators' },
                  { label: 'AO', tip: 'Awesome Oscillator signal — momentum based on 5/34-period midpoint SMAs' },
                  { label: 'RSI', tip: 'Relative Strength Index signal — overbought >70, oversold <30' },
                  { label: 'MACD', tip: 'Moving Average Convergence Divergence signal' },
                  { label: 'SMA 50', tip: 'Simple Moving Average 50-day — BUY when price is above' },
                  { label: 'SMA 200', tip: 'Simple Moving Average 200-day — BUY when price is above' },
                  { label: 'Sharpe', tip: 'Risk-adjusted return. >1.5 great, >1.0 good, <0.5 poor' },
                  { label: 'Sortino', tip: 'Like Sharpe but only penalizes downside. >2.0 great, >1.5 good' },
                  { label: '1Y Return', tip: 'Total return over the past 12 months' },
                  { label: 'NAV Ratio', tip: 'NAV erosion ratio: fund price decline / TTM distribution yield, only when benchmark is flat or up. Lagging a rising benchmark is not erosion.' },
                  { label: 'NAV Signal', tip: 'Signal from NAV Ratio: BUY <= 0.25, NEUTRAL <= 0.75, SELL > 0.75' },
                  { label: 'NAV Erosion', tip: 'Derived from NAV Ratio. Use Auto/Test/Skip and optional benchmark override to control watchlist NAV testing.' },
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
                        style={{ color: 'var(--accent-bright)', fontWeight: 600 }}
                      >
                        {r.ticker}
                      </a>
                    </td>
                    <td>{formatMoney(a?.price)}</td>
                    <td className={pctClass(a?.change_1d)}>{a?.change_1d != null ? fmtPct(a.change_1d) : '\u2014'}</td>
                    <td>
                      <YieldCell
                        ticker={r.ticker}
                        computed={a?.div_yield}
                        override={r.div_yield_override}
                        overridden={a?.div_yield_overridden}
                        onSave={updateYieldOverride}
                      />
                    </td>
                    <td><SignalBadge signal={a?.signal} /></td>
                    <td><SignalBadge signal={a?.ao_sig} /></td>
                    <td>
                      <SignalBadge signal={a?.rsi_sig} />
                      {a?.rsi_val != null && <span style={{ color: 'var(--p-888)', fontSize: '0.75rem', marginLeft: 4 }}>{a.rsi_val}</span>}
                    </td>
                    <td><SignalBadge signal={a?.macd_sig} /></td>
                    <td>
                      <SignalBadge signal={a?.sma50_sig} />
                      {a?.sma50_pct != null && <span style={{ color: 'var(--p-888)', fontSize: '0.75rem', marginLeft: 4 }}>{fmtPct(a.sma50_pct)}</span>}
                    </td>
                    <td>
                      <SignalBadge signal={a?.sma200_sig} />
                      {a?.sma200_pct != null && <span style={{ color: 'var(--p-888)', fontSize: '0.75rem', marginLeft: 4 }}>{fmtPct(a.sma200_pct)}</span>}
                    </td>
                    <td>{a?.sharpe != null ? a.sharpe.toFixed(2) : '\u2014'}</td>
                    <td>{a?.sortino != null ? a.sortino.toFixed(2) : '\u2014'}</td>
                    <td className={pctClass(a?.one_yr_ret)}>{a?.one_yr_ret != null ? fmtPct(a.one_yr_ret) : '\u2014'}</td>
                    <td>{a?.cov_ratio != null ? a.cov_ratio.toFixed(4) : '\u2014'}</td>
                    <td><SignalBadge signal={a?.cov_sig} /></td>
                    <NavCell row={r} analysis={a} onSave={updateNavSettings} />
                    <td style={{ minWidth: 180 }}>
                      <NotesCell
                        ticker={r.ticker}
                        value={r.notes || ''}
                        onSave={updateNotes}
                      />
                    </td>
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
