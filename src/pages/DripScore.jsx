import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { formatMoney } from '../utils/money'

const MAX_TICKERS = 75

// Verdict buckets. Order is the ranking order used for the summary strip.
const BUCKETS = {
  Compounder: { color: 'var(--pos-strong)', hint: 'Yield is at least 8% and Coverage is at least 1.00: total return fully supported the distribution rate.' },
  Grower:     { color: 'var(--pos-2)',      hint: 'Yield is below 8% and Coverage is at least 1.00: healthy growth, but not a high-income holding.' },
  Harvester:  { color: 'var(--ds-amber)',   hint: 'Yield is at least 8% and Coverage is between 0 and 1.00: total return was positive but did not fully support the distributions.' },
  Fading:     { color: 'var(--ds-amber)',   hint: 'Yield is below 8% and Coverage is between 0 and 1.00: low income with only partial return coverage.' },
  // --neg-3, not --neg-strong: the latter is a saturated red that drops to
  // 2.9:1 against the dark surface. --neg-3 reads in both themes.
  Liquidator: { color: 'var(--neg-3)',      hint: 'Yield is at least 8% but Coverage is below 0: the fund had a negative total return while paying distributions.' },
  Broken:     { color: 'var(--neg-3)',      hint: 'Yield is below 8% and Coverage is below 0: negative total return with little income.' },
}

function pct(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—'
  return (v * 100).toFixed(digits) + '%'
}
function signedPct(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—'
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(digits) + '%'
}
function num(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—'
  return Number(v).toFixed(digits)
}
function signClass(v) {
  if (v == null) return ''
  return v > 0 ? 'pct-up' : v < 0 ? 'pct-down' : ''
}
function heatClass(key, value) {
  if (value == null || Number.isNaN(Number(value))) return ''

  if (key === 'drip_score') {
    if (value <= -0.02) return 'ds-heat ds-heat-bad'
    if (value <= 0.02) return 'ds-heat ds-heat-watch'
    return 'ds-heat ds-heat-good'
  }
  if (key === 'coverage') {
    if (value < 0.5) return 'ds-heat ds-heat-bad'
    if (value < 1) return 'ds-heat ds-heat-caution'
    return 'ds-heat ds-heat-good'
  }
  if (key === 're') {
    if (value <= 0.98) return 'ds-heat ds-heat-bad'
    if (value < 1.02) return 'ds-heat ds-heat-watch'
    return 'ds-heat ds-heat-good'
  }
  if (key === 'opportunity') {
    if (value < 50) return 'ds-heat ds-heat-bad'
    if (value < 65) return 'ds-heat ds-heat-caution'
    if (value < 80) return 'ds-heat ds-heat-watch'
    return 'ds-heat ds-heat-good'
  }
  return ''
}
function verdictHeatClass(bucket) {
  if (bucket === 'Compounder' || bucket === 'Grower') return 'ds-heat ds-heat-good'
  if (bucket === 'Harvester' || bucket === 'Fading') return 'ds-heat ds-heat-caution'
  if (bucket === 'Liquidator' || bucket === 'Broken') return 'ds-heat ds-heat-bad'
  return ''
}
function callHeatClass(call) {
  if (call === 'DRIP') return 'ds-heat ds-heat-good'
  if (call === 'Take cash') return 'ds-heat ds-heat-bad'
  if (call === 'Toss-up') return 'ds-heat ds-heat-watch'
  return ''
}
function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function isoYearsAgo(years) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}
function parseTickers(text) {
  const seen = []
  String(text || '')
    .split(/[\s,;]+/)
    .forEach((raw) => {
      const t = raw.trim().toUpperCase()
      if (t && !seen.includes(t)) seen.push(t)
    })
  return seen
}

function TickerList({ tickers, editing, onRemove }) {
  if (!tickers.length) {
    return <div className="ds-ticker-empty">No tickers in this set.</div>
  }

  return (
    <div className="ds-ticker-list" aria-label="Tickers in this set">
      {tickers.map((ticker) => (
        <span className="ds-ticker-pill" key={ticker}>
          {ticker}
          {editing && (
            <button
              type="button"
              className="ds-ticker-remove"
              onClick={() => onRemove(ticker)}
              aria-label={`Remove ${ticker}`}
              title={`Remove ${ticker}`}
            >
              &times;
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

// Columns. `key` doubles as the sort field.
const COLUMNS = [
  { key: 'ticker', label: 'Ticker', sticky: true },
  { key: 'name', label: 'Fund Name', wide: true },
  { key: 'price_appreciation', label: 'Price Appr.', fmt: signedPct, sign: true },
  { key: 'nav_annual', label: 'Price CAGR', fmt: signedPct, sign: true, title: 'Annualized change in split-adjusted market price; this is not official fund NAV.' },
  { key: 'tr_full', label: 'Full DRIP TR', fmt: signedPct, sign: true },
  { key: 'tr_50', label: '50% DRIP TR', fmt: signedPct, sign: true },
  { key: 'tr_none', label: 'No DRIP TR', fmt: signedPct, sign: true },
  { key: 'annual_yield', label: 'Yield / yr', fmt: pct },
  { key: 'covered_yield', label: 'Covered Yield', fmt: pct, title: 'Historical yield supported by the fund’s matched-period total return.' },
  { key: 'coverage', label: 'Coverage', fmt: (v) => num(v, 2), title: '>=1 fully supported by period total return · 0-1 partly offset by price loss · <0 total return was negative' },
  { key: 'drip_score', label: 'DRIP Score', fmt: signedPct, sign: true, title: 'Full DRIP total return minus No DRIP total return.' },
  { key: 're', label: 'RE', fmt: (v) => num(v, 3), title: 'Reinvestment Efficiency: what $1 of distributions became under DRIP vs held as cash.' },
  { key: 'win_rate', label: 'Win Rate', fmt: (v) => pct(v, 0), title: 'Share of eligible daily closing dates where DRIP beat cash.' },
  { key: 'opportunity', label: 'Opportunity', fmt: (v) => num(v, 1), title: '60% price CAGR + 40% covered yield.' },
  { key: 'bucket', label: 'Verdict' },
  { key: 'drip_call', label: 'Call' },
]

function VerdictChip({ bucket }) {
  const meta = BUCKETS[bucket]
  if (!meta) return <span>—</span>
  return (
    <span className="ds-chip" style={{ borderColor: meta.color, color: meta.color }} title={meta.hint}>
      {bucket}
    </span>
  )
}

function CallCell({ row }) {
  const flags = []
  if (row.conflicted) flags.push('conflicted')
  if (row.stable === false) flags.push('unstable')
  return (
    <>
      <span className="ds-call">{row.drip_call}</span>
      {flags.map((f) => (
        <span
          key={f}
          className={`ds-flag ds-flag-${f}`}
          title={f === 'conflicted'
            ? 'The final exit disagrees with most exit dates — this call depends on timing.'
            : 'Win rate is near a coin flip — the signal is weak.'}
        >
          {f}
        </span>
      ))}
    </>
  )
}

function Grid({ rows, sort, onSort, caption, onRowClick }) {
  if (!rows.length) return null
  return (
    <div className="ds-section">
      {caption && <div className="ds-section-cap">{caption}</div>}
      <div
        className="ds-tbl-wrap"
        tabIndex={0}
        aria-label={`${caption || 'Full history'} results table`}
      >
        <table className="sst ds-tbl">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key)}
                  title={c.title || 'Sort'}
                  className={c.sticky ? 'ds-sticky-col' : ''}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className="ds-clickable"
                  onClick={() => onRowClick(r.ticker)}
                  title={`Open the ${r.ticker} distribution schedule`}>
                {COLUMNS.map((c) => {
                  if (c.key === 'bucket') {
                    return <td key={c.key} className={verdictHeatClass(r.bucket)}><VerdictChip bucket={r.bucket} /></td>
                  }
                  if (c.key === 'drip_call') {
                    return <td key={c.key} className={callHeatClass(r.drip_call)}><CallCell row={r} /></td>
                  }
                  if (c.key === 'ticker') {
                    return (
                      <td key={c.key} className="ds-sticky-col ds-ticker">
                        {r.ticker}
                        {r.partial && (
                          <span className="ds-flag ds-flag-partial"
                                title={`Only ${pct(r.coverage_pct, 0)} of the window — history starts ${r.effective_start}.`}>
                            {pct(r.coverage_pct, 0)}
                          </span>
                        )}
                      </td>
                    )
                  }
                  if (c.key === 'name') {
                    return <td key={c.key} className="ds-name" title={r.name || ''}>{r.name || '—'}</td>
                  }
                  const raw = r[c.key]
                  const cellClass = [c.sign ? signClass(raw) : '', heatClass(c.key, raw)]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <td key={c.key} className={cellClass}>
                      {c.fmt ? c.fmt(raw) : (raw ?? '—')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function HeatLegend() {
  return (
    <div className="ds-heat-legend" aria-label="Result color key">
      <span><i className="ds-heat-swatch ds-heat-good" />Favorable</span>
      <span><i className="ds-heat-swatch ds-heat-watch" />Borderline</span>
      <span><i className="ds-heat-swatch ds-heat-caution" />Caution</span>
      <span><i className="ds-heat-swatch ds-heat-bad" />Unfavorable</span>
    </div>
  )
}

function Tile({ label, value, color, sub }) {
  return (
    <div className="ds-tile">
      <div className="ds-tile-val" style={color ? { color } : undefined}>{value}</div>
      <div className="ds-tile-lbl">{label}</div>
      {sub && <div className="ds-tile-sub">{sub}</div>}
    </div>
  )
}

const MODE_LABELS = { full: 'Full DRIP', half: '50% DRIP', none: 'No DRIP' }

function DetailDrawer({ ticker, detail, loading, error, onClose }) {
  // Escape closes; the effect must be declared before any early return.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const s = detail?.summary
  const best = useMemo(() => {
    if (!s?.terminal) return null
    return Object.entries(s.terminal)
      .sort((a, b) => b[1].total_return - a[1].total_return)[0][0]
  }, [s])

  return (
    <div className="ds-drawer-backdrop" onClick={onClose}>
      <div className="ds-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="ds-drawer-head">
          <div>
            <h2 className="ds-drawer-title">{ticker}</h2>
            {s?.name && <div className="ds-drawer-sub">{s.name}</div>}
          </div>
          <button className="ds-btn" onClick={onClose}>Close</button>
        </div>

        {loading && <div className="ds-drawer-body">Loading…</div>}
        {error && <div className="ds-banner ds-banner-error">{error}</div>}

        {s && !loading && (
          <div className="ds-drawer-body">
            <div className="ds-tiles">
              <Tile label="Price" value={formatMoney(s.end_price)}
                    sub={`from ${formatMoney(s.start_price)}`} />
              <Tile label="DRIP Score" value={signedPct(s.drip_score)}
                    color={s.drip_score > 0 ? 'var(--pos-strong)' : 'var(--neg-3)'}
                    sub="Full DRIP TR − No DRIP TR" />
              <Tile label="Reinvestment Efficiency" value={num(s.re, 3)}
                    color={s.re > 1 ? 'var(--pos-strong)' : 'var(--neg-3)'}
                    sub={s.re != null ? `${num(s.re, 2)}× vs holding cash` : ''} />
              <Tile label="Price CAGR" value={signedPct(s.nav_annual)}
                    color={s.nav_annual >= 0 ? 'var(--pos-strong)' : 'var(--neg-3)'} />
              <Tile label="Coverage" value={num(s.coverage, 2)}
                    sub={s.coverage == null ? 'not an income fund'
                      : s.coverage >= 1 ? 'fully supported'
                      : s.coverage >= 0 ? 'partly offset by price loss' : 'negative total return'} />
              <Tile label="Win Rate" value={pct(s.win_rate, 0)}
                    sub={`${s.n_exits ?? 0} exit dates`} />
            </div>

            <div className="ds-modes">
              {['full', 'half', 'none'].map((m) => {
                const t = s.terminal?.[m]
                if (!t) return null
                return (
                  <div key={m} className={`ds-mode${best === m ? ' ds-mode-best' : ''}`}>
                    <div className="ds-mode-name">
                      {MODE_LABELS[m]}{best === m && <span className="ds-mode-tag">best</span>}
                    </div>
                    <div className="ds-mode-total">{formatMoney(t.total)}</div>
                    <div className={`ds-mode-tr ${signClass(t.total_return)}`}>
                      {signedPct(t.total_return)}
                    </div>
                    <div className="ds-mode-split">
                      {formatMoney(t.share_value)} shares
                      {t.cash > 0 && <> · {formatMoney(t.cash)} cash</>}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="ds-section-cap">
              Distribution schedule — {s.distribution_count} payments ({s.frequency})
            </div>
            <div className="ds-tbl-wrap ds-drawer-tbl">
              <table className="sst ds-tbl ds-sched">
                <thead>
                  <tr>
                    <th>Date</th><th>Price</th><th>Dividend</th><th>Current Yield</th>
                    <th>Paid Full</th><th>Reinv. 50%</th><th>Cash No DRIP</th>
                    <th>Shares Full</th><th>Shares 50%</th><th>Shares None</th>
                    <th>Value Full</th><th>Value 50%</th><th>Value None</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.schedule.map((r) => (
                    <tr key={r.date}>
                      <td>{r.date}</td>
                      <td>{formatMoney(r.price)}</td>
                      <td>{formatMoney(r.dividend, { digits: 4 })}</td>
                      <td>{pct(r.current_yield)}</td>
                      <td>{formatMoney(r.payment_full)}</td>
                      <td>{formatMoney(r.payment_half)}</td>
                      <td>{formatMoney(r.payment_none)}</td>
                      <td>{num(r.shares_full, 2)}</td>
                      <td>{num(r.shares_half, 2)}</td>
                      <td>{num(r.shares_none, 2)}</td>
                      <td>{formatMoney(r.value_full)}</td>
                      <td>{formatMoney(r.value_half)}</td>
                      <td>{formatMoney(r.value_none)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!detail.schedule.length && (
              <div className="ds-banner ds-banner-warn">
                No distributions in this window.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DripScore() {
  const pf = useProfileFetch()
  const dialog = useDialog()

  const [sets, setSets] = useState([])
  const [activeSetId, setActiveSetId] = useState('')
  const [savedSetSnapshot, setSavedSetSnapshot] = useState(null)
  const [isEditing, setIsEditing] = useState(true)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [tickerText, setTickerText] = useState('')
  const [startDate, setStartDate] = useState(isoYearsAgo(2))
  const [endDate, setEndDate] = useState(isoToday())
  const [cashRate, setCashRate] = useState(4)
  const [initial, setInitial] = useState(50000)
  const [partialData, setPartialData] = useState('include')

  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [sort, setSort] = useState({ key: 'opportunity', dir: 'desc' })

  const [detailTicker, setDetailTicker] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  const tickers = useMemo(() => parseTickers(tickerText), [tickerText])

  const loadSets = useCallback(() => {
    pf('/api/drip-score/sets')
      .then((r) => r.json())
      .then((d) => setSets(d.sets || []))
      .catch(() => setSets([]))
  }, [pf])

  useEffect(() => { loadSets() }, [loadSets])

  function applySet(s, remember = true) {
    setName(s.name || '')
    setTickerText((s.tickers || []).join(', '))
    if (s.start_date) setStartDate(s.start_date)
    if (s.end_date) setEndDate(s.end_date)
    if (s.cash_rate != null) setCashRate(s.cash_rate * 100)
    if (s.initial_investment != null) setInitial(s.initial_investment)
    if (s.partial_data) setPartialData(s.partial_data)
    if (remember) setSavedSetSnapshot(s)
  }

  function selectSet(id) {
    setActiveSetId(id)
    setSavedSetSnapshot(null)
    setIsEditing(!id)
    setResult(null)
    setError('')
    if (!id) {
      setName('')
      setTickerText('')
      return
    }
    pf(`/api/drip-score/sets/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.set) applySet(d.set)
        // Show the cached run immediately; the user re-runs on demand.
        return pf(`/api/drip-score/sets/${id}/last-run`).then((r) => (r.ok ? r.json() : null))
      })
      .then((run) => { if (run) setResult(run) })
      .catch(() => {})
  }

  function currentBody() {
    return {
      name: name.trim(),
      tickers,
      start_date: startDate,
      end_date: endDate,
      cash_rate: Number(cashRate) / 100,
      initial_investment: Number(initial),
      partial_data: partialData,
    }
  }

  function beginEdit() {
    setError('')
    setIsEditing(true)
  }

  function cancelEdit() {
    // Edit mode governs the saved set's identity and membership. The date,
    // cash-rate, initial amount, and short-history controls remain live run
    // inputs, so Cancel must not undo changes made to those controls.
    if (savedSetSnapshot) {
      setName(savedSetSnapshot.name || '')
      setTickerText((savedSetSnapshot.tickers || []).join(', '))
    }
    setError('')
    setIsEditing(false)
  }

  function removeTicker(ticker) {
    setTickerText((current) => (
      parseTickers(current).filter((item) => item !== ticker).join(', ')
    ))
    setError('')
  }

  async function saveSet(asNew) {
    const body = currentBody()
    if (!body.name) { await dialog.alert('Give the set a name first.'); return }
    if (!body.tickers.length) { await dialog.alert('Add at least one ticker.'); return }
    setSaving(true)
    try {
      const isUpdate = activeSetId && !asNew
      const resp = await pf(
        isUpdate ? `/api/drip-score/sets/${activeSetId}` : '/api/drip-score/sets',
        { method: isUpdate ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body) })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) { await dialog.alert(data.error || 'Save failed.'); return }
      if (data.set) {
        applySet(data.set)
        setActiveSetId(String(data.set.id))
      }
      setIsEditing(false)
      setResult(null)
      loadSets()
    } finally {
      setSaving(false)
    }
  }

  async function deleteSet() {
    if (!activeSetId) return
    if (!(await dialog.confirm(`Delete "${name}"?`))) return
    await pf(`/api/drip-score/sets/${activeSetId}`, { method: 'DELETE' })
    setActiveSetId('')
    setSavedSetSnapshot(null)
    setIsEditing(true)
    setName('')
    setTickerText('')
    setResult(null)
    loadSets()
  }

  async function run() {
    setError('')
    if (!tickers.length) { setError('Add at least one ticker.'); return }
    if (tickers.length > MAX_TICKERS) { setError(`Too many tickers (max ${MAX_TICKERS}).`); return }
    setRunning(true)
    setResult(null)
    try {
      const body = currentBody()
      if (activeSetId) body.set_id = Number(activeSetId)
      const resp = await pf('/api/drip-score/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) setError(data.error || 'Run failed.')
      else setResult(data)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setRunning(false)
    }
  }

  const openDetail = useCallback((ticker) => {
    // Use the window the results were actually produced with, not the form,
    // which the user may have edited since the last run.
    const meta = result?.meta
    if (!meta) return
    setDetailTicker(ticker)
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    const qs = new URLSearchParams({
      ticker,
      start_date: meta.start_date,
      end_date: meta.end_date,
      cash_rate: String(meta.cash_rate),
      initial_investment: String(meta.initial_investment),
    })
    pf(`/api/drip-score/detail?${qs}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Could not load the schedule.')
        return d
      })
      .then(setDetail)
      .catch((e) => setDetailError(String(e?.message || e)))
      .finally(() => setDetailLoading(false))
  }, [pf, result])

  const closeDetail = useCallback(() => {
    setDetailTicker('')
    setDetail(null)
    setDetailError('')
  }, [])

  function toggleSort(key) {
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' }))
  }

  const sortRows = useCallback((list) => {
    const out = [...(list || [])]
    out.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (av == null && bv == null) return 0
      if (av == null) return 1        // nulls always last, regardless of direction
      if (bv == null) return -1
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return out
  }, [sort])

  const fullRows = useMemo(() => sortRows(result?.rows), [result, sortRows])
  const partialRows = useMemo(() => sortRows(result?.partial), [result, sortRows])
  const excluded = result?.excluded || []

  const tally = useMemo(() => {
    const counts = {}
    ;[...(result?.rows || []), ...(result?.partial || [])].forEach((r) => {
      counts[r.bucket] = (counts[r.bucket] || 0) + 1
    })
    return counts
  }, [result])

  return (
    <div className="ds-page">
      <h1 className="ds-title">DRIP Score</h1>
      <p className="ds-sub">
        Replays actual prices and distributions over one common window and asks, per fund:
        reinvest, take the cash, or stay out.
      </p>

      <details className="ds-help">
        <summary>How to use DRIP Score</summary>
        <div className="ds-help-grid">
          <section>
            <h3>Manage a saved set</h3>
            <p>
              Select a set, then click <strong>Edit Tickers</strong>. Remove one ticker with the
              <strong> ×</strong> beside its symbol, or type and paste symbols in the editor.
              Save commits the changes; Cancel discards changes made in edit mode.
            </p>
          </section>
          <section>
            <h3>Compare like with like</h3>
            <p>
              Every fund is replayed over the same dates and starting amount. Funds with
              shorter histories are kept in a separate table so they do not outrank funds
              tested across the full window. Large result tables scroll inside their panel,
              with the column headers pinned at the top.
            </p>
          </section>
          <section>
            <h3>Read the call</h3>
            <p>
              DRIP Score is the full-reinvestment return minus the cash-taking return.
              Coverage compares distributions with total return on a matched-period basis; it
              is a performance proxy, not a tax classification of return of capital. Win Rate
              shows how often DRIP won across eligible daily closing dates.
            </p>
          </section>
          <section className="ds-help-definition-section">
            <h3>Verdict definitions</h3>
            <ul>
              <li><strong>Compounder:</strong> yield at least 8% and Coverage at least 1.00. Total return fully supported the distributions.</li>
              <li><strong>Harvester:</strong> yield at least 8% and Coverage from 0 to below 1.00. Total return was positive, but price loss consumed part of the distributions. This is not a tax or return-of-capital classification.</li>
              <li><strong>Liquidator:</strong> yield at least 8% and Coverage below 0. Total return was negative despite the distributions.</li>
              <li><strong>Grower:</strong> yield below 8% and Coverage at least 1.00. Healthy return coverage, but not a high-income holding.</li>
              <li><strong>Fading:</strong> yield below 8% and Coverage from 0 to below 1.00. Low income with only partial return coverage.</li>
              <li><strong>Broken:</strong> yield below 8% and Coverage below 0. Negative total return with little income.</li>
            </ul>
          </section>
          <section className="ds-help-definition-section">
            <h3>Call and badge definitions</h3>
            <ul>
              <li><strong>DRIP:</strong> RE is 1.02 or higher; reinvested distributions finished at least 2% ahead of cash.</li>
              <li><strong>Take cash:</strong> RE is 0.98 or lower; keeping distributions as cash finished at least 2% ahead.</li>
              <li><strong>Toss-up:</strong> RE is between 0.98 and 1.02; the difference is too small for a directional call.</li>
              <li><strong>N/A:</strong> there was not enough meaningful distribution data to compare reinvestment with cash.</li>
              <li><strong>Conflicted:</strong> the final-date call disagrees with the majority of eligible exit dates.</li>
              <li><strong>Unstable:</strong> the win rate is near 50%, so the result depends heavily on exit timing.</li>
              <li><strong>Cell colors:</strong> green is favorable, yellow is borderline, amber means caution, and red is unfavorable. Colors grade DRIP Score, Coverage, RE, Opportunity, Verdict, and Call; the displayed values remain authoritative.</li>
            </ul>
          </section>
        </div>
      </details>

      <div className="ds-panel">
        <div className="ds-row">
          <label className="ds-field ds-field-wide">
            <span>Saved set</span>
            <select
              value={activeSetId}
              onChange={(e) => selectSet(e.target.value)}
              disabled={saving}
            >
              <option value="">— New set —</option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.ticker_count})</option>
              ))}
            </select>
          </label>
          <label className="ds-field ds-field-wide">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly payers"
              disabled={Boolean(activeSetId) && !isEditing}
            />
          </label>
          <div className="ds-btns">
            {activeSetId && !isEditing ? (
              <>
                <button className="ds-btn ds-btn-primary" onClick={beginEdit}>Edit Tickers</button>
                <button className="ds-btn ds-btn-danger" onClick={deleteSet}>Delete</button>
              </>
            ) : (
              <>
                <button className="ds-btn ds-btn-primary" onClick={() => saveSet(false)} disabled={saving}>
                  {saving ? 'Saving…' : activeSetId ? 'Save' : 'Create'}
                </button>
                {activeSetId && (
                  <>
                    <button className="ds-btn" onClick={() => saveSet(true)} disabled={saving}>Save As</button>
                    <button className="ds-btn" onClick={cancelEdit} disabled={saving}>Cancel</button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="ds-field ds-field-block">
          <span>
            Tickers <em>({tickers.length}/{MAX_TICKERS})</em>
            {activeSetId && !isEditing && (
              <small className="ds-edit-hint">Click Edit Tickers to add or remove symbols.</small>
            )}
          </span>
          <TickerList tickers={tickers} editing={isEditing} onRemove={removeTicker} />
          {isEditing && (
            <textarea
              rows={2}
              value={tickerText}
              onChange={(e) => setTickerText(e.target.value)}
              aria-label="Edit ticker symbols"
              placeholder="AAPW, CONY, MSTY, GDXY, DGRO — commas, spaces or newlines"
            />
          )}
        </div>

        <div className="ds-row">
          <label className="ds-field">
            <span>Start</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="ds-field">
            <span>End</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <label className="ds-field">
            <span title="What the cash you did NOT reinvest would have earned.">Cash rate %</span>
            <input type="number" step="0.25" min="0" max="100"
                   value={cashRate} onChange={(e) => setCashRate(e.target.value)} />
          </label>
          <label className="ds-field">
            <span>Initial</span>
            <input type="number" step="1000" min="1"
                   value={initial} onChange={(e) => setInitial(e.target.value)} />
          </label>
          <label className="ds-field ds-field-wide">
            <span>Short history</span>
            <select
              value={partialData}
              onChange={(e) => setPartialData(e.target.value)}
            >
              <option value="include">Include, ranked separately</option>
              <option value="exclude">Exclude from results</option>
            </select>
          </label>
          <div className="ds-btns">
            <button
              className="ds-btn ds-btn-primary"
              onClick={run}
              disabled={running || (Boolean(activeSetId) && isEditing)}
              title={activeSetId && isEditing ? 'Save or cancel your edits before running.' : ''}
            >
              {running ? 'Running…' : 'Run'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="ds-banner ds-banner-error">{error}</div>}

      {result && (
        <>
          <div className="ds-meta">
            <span>
              {result.meta.start_date} → {result.meta.end_date} ({num(result.meta.years, 2)} yrs)
            </span>
            <span>cash {pct(result.meta.cash_rate, 2)}</span>
            <span>{formatMoney(result.meta.initial_investment, { zeroIfInvalid: true })} start</span>
            {result.run_at && <span className="ds-cached">cached {result.run_at}</span>}
          </div>

          {Object.keys(tally).length > 0 && (
            <div className="ds-tally">
              {Object.entries(BUCKETS)
                .filter(([b]) => tally[b])
                .map(([b, meta]) => (
                  <span key={b} className="ds-tally-item" style={{ color: meta.color }} title={meta.hint}>
                    <strong>{tally[b]}</strong> {b}
                  </span>
                ))}
            </div>
          )}

          {excluded.length > 0 && (
            <div className="ds-banner ds-banner-warn">
              <strong>No data for this window:</strong>{' '}
              {excluded.map((e) => `${e.ticker} (${e.reason})`).join(' · ')}
            </div>
          )}

          {partialRows.length > 0 && (
            <div className="ds-banner ds-banner-info">
              <strong>Short history:</strong>{' '}
              {partialRows.map((r) => `${r.ticker} from ${r.effective_start}`).join(' · ')}
              {' — ranked separately below, since a partial window is not comparable.'}
            </div>
          )}

          {(fullRows.length > 0 || partialRows.length > 0) && <HeatLegend />}

          <Grid rows={fullRows} sort={sort} onSort={toggleSort} onRowClick={openDetail} />
          <Grid rows={partialRows} sort={sort} onSort={toggleSort} onRowClick={openDetail}
                caption="Partial history — not comparable with the rows above" />

          {!fullRows.length && !partialRows.length && (
            <div className="ds-banner ds-banner-warn">No tickers had usable data for this window.</div>
          )}

          <p className="ds-note">
            DRIP vs cash is tax-neutral: distributions are taxed whether or not you reinvest,
            so no tax model is needed here. The cash-rate yield is itself taxable, which is a
            second-order effect this screen does not model.
          </p>
        </>
      )}

      {detailTicker && (
        <DetailDrawer
          ticker={detailTicker}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
        />
      )}
    </div>
  )
}
