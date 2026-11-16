import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { formatMoney, formatMoneyDelta } from '../utils/money'
import LotSortHeader from '../components/LotSortHeader'
import { nextLotSort, sortLotRows } from '../utils/lotTableSort'

const fmt = (v) => formatMoney(v)
const fmtSigned = (v) => {
  return formatMoneyDelta(v)
}
const fmtPct = (v) => v != null ? `${(Number(v) * 100).toFixed(2)}%` : '—'
const fmtPctDelta = (v) => {
  if (v == null) return null
  const n = Number(v) * 100
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)} pts`
}
const fmtShares = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 })
const fmtDate = (s) => s ? String(s).slice(0, 10) : '—'

function MetricCard({ label, value, sub, color }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value" style={color ? { color } : undefined}>{value ?? '—'}</div>
      {sub && <div className="summary-sub">{sub}</div>}
    </div>
  )
}

function WashBadge({ status, clearsOn }) {
  if (status === 'clear') {
    return <span style={{ background: 'rgba(77,255,145,0.15)', color: 'var(--pos)', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem' }}>Clear</span>
  }
  if (status === 'partial') {
    return (
      <span title={clearsOn ? `Some lots are blocked until ${clearsOn}` : 'Some lots are blocked'} style={{ background: 'rgba(255,184,108,0.15)', color: 'var(--p-ffb86c)', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem' }}>
        Partly blocked
      </span>
    )
  }
  return (
    <span title={clearsOn ? `Clears on ${clearsOn}` : ''} style={{ background: 'rgba(255,107,107,0.15)', color: 'var(--neg)', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem' }}>
      Wash sale{clearsOn ? ` → ${clearsOn}` : ''}
    </span>
  )
}

function TermPill({ term }) {
  const isLong = term === 'long'
  return (
    <span style={{
      background: isLong ? 'rgba(123,140,255,0.15)' : 'rgba(255,184,108,0.15)',
      color: isLong ? 'var(--p-7b8cff)' : 'var(--p-ffb86c)',
      padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
    }}>
      {term === 'long' ? 'LT' : term === 'short' ? 'ST' : term === 'mixed' ? 'Mixed' : '?'}
    </span>
  )
}

function ReplacementBox({ ticker }) {
  const pf = useProfileFetch()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let stale = false
    setLoading(true)
    pf(`/api/tax-loss/replacements?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { if (!stale) { setData(d); setErr(d.error || null) } })
      .catch(e => { if (!stale) setErr(e.message) })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [ticker])

  if (loading) return <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Loading suggestions...</div>
  if (err) return <div style={{ color: 'var(--neg)', fontSize: '0.85rem' }}>{err}</div>
  if (!data?.suggestions?.length) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No close replacement candidates found for this holding's type and income profile.</div>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {data.suggestions.map(s => (
        <div key={s.ticker} style={{
          background: 'rgba(123,140,255,0.08)', border: '1px solid rgba(123,140,255,0.3)',
          padding: '0.55rem 0.75rem', borderRadius: 4, fontSize: '0.85rem', maxWidth: 360,
        }}>
          <div>
            <strong style={{ color: 'var(--p-7b8cff)' }}>{s.ticker}</strong>
            {s.type && <span style={{ color: 'var(--text-dim)', marginLeft: '0.5rem' }}>{s.type}</span>}
            {s.yield != null && <span style={{ color: 'var(--p-2efdb5)', marginLeft: '0.5rem' }}>{fmtPct(s.yield)}</span>}
            {fmtPctDelta(s.yield_delta) && <span style={{ color: 'var(--accent-2)', marginLeft: '0.4rem' }}>({fmtPctDelta(s.yield_delta)})</span>}
          </div>
          {s.name && <div style={{ color: 'var(--p-c0cdd8)', marginTop: 3 }}>{s.name}</div>}
          <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>{s.category}</div>
          {s.match_reasons?.length > 0 && (
            <div style={{ color: 'var(--accent-2)', marginTop: 4, fontSize: '0.78rem' }}>{s.match_reasons.join(' | ')}</div>
          )}
          {s.warnings?.length > 0 && (
            <div style={{ color: 'var(--p-ffb86c)', marginTop: 4, fontSize: '0.78rem' }}>{s.warnings.join(' | ')}</div>
          )}
        </div>
      ))}
    </div>
  )
}

const PREFS_KEY = 'taxLossHarvest.viewPrefs.v1'
const DEFAULT_PREFS = { groupBy: 'lot', showReplacements: true, hideBlocked: false }

// View choices are a per-device convenience; the page works without them.
const loadPrefs = () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) || 'null')
    return saved && typeof saved === 'object' ? { ...DEFAULT_PREFS, ...saved } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}
const savePrefs = prefs => {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
}

const RIGHT = { textAlign: 'right' }
const CENTER = { textAlign: 'center' }
const washSortValue = row => `${row.wash_status === 'clear' ? '0' : row.wash_status === 'partial' ? '1' : '2'} ${row.wash_clears_on || ''}`

// Sort values follow what each cell shows. `align` is the header/cell style.
const LOT_COLUMNS = [
  { key: 'expand', label: '', sortable: false },
  { key: 'ticker', label: 'Ticker', type: 'string' },
  { key: 'account_name', label: 'Account', type: 'string', accountOnly: true, value: row => row.account_name || '' },
  { key: 'buy_date', label: 'Buy Date', type: 'date' },
  { key: 'open_shares', label: 'Shares', type: 'number', align: RIGHT },
  { key: 'cost_per_share', label: 'Cost/sh', type: 'number', align: RIGHT },
  { key: 'current_price', label: 'Current', type: 'number', align: RIGHT },
  { key: 'unrealized_loss', label: 'Unrealized Loss', type: 'number', align: RIGHT },
  { key: 'term', label: 'Term', type: 'string', align: CENTER },
  { key: 'wash', label: 'Wash', type: 'string', value: washSortValue },
  { key: 'est_tax_saved', label: 'Tax Saved', type: 'number', align: RIGHT },
  { key: 'plan', label: '', sortable: false },
]

const HOLDING_COLUMNS = [
  { key: 'expand', label: '', sortable: false },
  { key: 'ticker', label: 'Ticker', type: 'string' },
  { key: 'lot_count', label: 'Lots', type: 'number', align: RIGHT, tip: 'Losing lots still held in this holding.' },
  { key: 'buy_date', label: 'First Buy', type: 'date', tip: 'Oldest losing lot.' },
  { key: 'open_shares', label: 'Shares', type: 'number', align: RIGHT },
  { key: 'cost_per_share', label: 'Avg Cost/sh', type: 'number', align: RIGHT, tip: 'Share-weighted cost of the losing lots.' },
  { key: 'current_price', label: 'Current', type: 'number', align: RIGHT },
  { key: 'unrealized_loss', label: 'Unrealized Loss', type: 'number', align: RIGHT },
  { key: 'term', label: 'Term', type: 'string', align: CENTER },
  { key: 'wash', label: 'Wash', type: 'string', value: washSortValue },
  { key: 'est_tax_saved', label: 'Tax Saved', type: 'number', align: RIGHT },
]

const PLAN_COLUMNS = [
  { key: 'ticker', label: 'Ticker', type: 'string' },
  { key: 'shares', label: 'Shares', type: 'number', align: RIGHT },
  { key: 'est_loss', label: 'Est. Loss', type: 'number', align: RIGHT },
  { key: 'est_tax_saved', label: 'Est. Tax Saved', type: 'number', align: RIGHT },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'created_at', label: 'Created', type: 'date' },
  { key: 'remove', label: '', sortable: false },
]

const DEFAULT_SORT = { key: 'unrealized_loss', direction: 'asc' } // biggest loss first

// One row per holding: its losing lots added up.
function groupByHolding(lots) {
  const byTicker = new Map()
  lots.forEach(lot => {
    if (!byTicker.has(lot.ticker)) byTicker.set(lot.ticker, [])
    byTicker.get(lot.ticker).push(lot)
  })
  return Array.from(byTicker.entries()).map(([ticker, rows]) => {
    const sum = key => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0)
    const shares = sum('open_shares')
    const cost = rows.reduce((total, row) => total + (Number(row.open_shares) || 0) * (Number(row.cost_per_share) || 0), 0)
    const terms = new Set(rows.map(row => row.term))
    const blocked = rows.filter(row => row.wash_status !== 'clear')
    const clearsOn = blocked.map(row => row.wash_clears_on).filter(Boolean).sort().pop() || null
    return {
      ticker,
      lots: rows,
      lot_count: rows.length,
      buy_date: rows.map(row => row.buy_date).filter(Boolean).sort()[0] || null,
      open_shares: shares,
      cost_per_share: shares > 0 ? cost / shares : null,
      current_price: rows[0].current_price,
      unrealized_loss: sum('unrealized_loss'),
      est_tax_saved: sum('est_tax_saved'),
      term: terms.size === 1 ? [...terms][0] : 'mixed',
      wash_status: blocked.length === 0 ? 'clear' : blocked.length === rows.length ? 'blocked' : 'partial',
      wash_clears_on: clearsOn,
      has_drip_lot: rows.some(row => row.is_drip_lot),
    }
  })
}

function ReplacementHelp() {
  return (
    <details style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '0.6rem', maxWidth: '62rem' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--accent-2)' }}>How are replacements picked?</summary>
      <div style={{ marginTop: '0.4rem', lineHeight: 1.5 }}>
        Candidates come from your own categories and swap list, from scanner funds sharing the holding's
        strategy, category or industry, and from the ETF issuer listings. Each one is scored on: the same kind of
        security (fund, closed-end fund, stock, REIT, BDC, preferred); the same category, strategy, sector or
        industry; shared traits such as option income, covered calls or fixed income; how close its yield is to the
        holding's; and the same payout frequency. For a holding yielding 4% or more, a candidate must be an income
        fund itself or pay at least half that yield. Tickers you already hold, and funds that track the same index
        (substantially identical), are always left out. The reasons under each ticker show what matched; a
        suggestion is a starting point for your own research, not a recommendation.
      </div>
    </details>
  )
}

function BlockingTransactions({ row }) {
  if (row.wash_status === 'clear' || !row.wash_offenders?.length) return null
  return (
    <div>
      <h4 style={{ color: 'var(--neg)', marginBottom: '0.4rem', fontSize: '0.95rem' }}>Blocking transactions (wash-sale window)</h4>
      <ul style={{ paddingLeft: '1.2rem', color: 'var(--p-c0cdd8)', fontSize: '0.85rem', margin: 0 }}>
        {row.wash_offenders.map(o => (
          <li key={o.txn_id}>
            {fmtDate(o.date)} — bought {fmtShares(o.shares)} shares
            {o.is_drip && <span style={{ marginLeft: 6, color: 'var(--p-ffb86c)' }}>(DRIP)</span>}
            <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{o.account_name || `account ${o.profile_id}`}</span>
          </li>
        ))}
      </ul>
      {row.wash_clears_on && <p style={{ marginTop: '0.5rem', color: 'var(--p-ffb86c)', fontSize: '0.85rem' }}>
        Window clears on <strong>{row.wash_clears_on}</strong>.
      </p>}
    </div>
  )
}

function Replacements({ ticker, show }) {
  if (!show) return null
  return (
    <div style={{ marginBottom: '0.8rem' }}>
      <h4 style={{ color: 'var(--accent-2)', marginBottom: '0.4rem', fontSize: '0.95rem' }}>Replacement candidates (similar type and income profile)</h4>
      <ReplacementHelp />
      <ReplacementBox ticker={ticker} />
    </div>
  )
}

function PlanButton({ row, onPlan }) {
  return (
    <button
      className="btn btn-primary"
      disabled={row.wash_status !== 'clear'}
      title={row.wash_status !== 'clear' ? 'Blocked by the wash-sale window' : 'Track this lot as a planned harvest'}
      onClick={(e) => { e.stopPropagation(); onPlan(row) }}
      style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
    >Plan</button>
  )
}

function lotCells(row, columns, onPlan) {
  return columns.map(col => {
    switch (col.key) {
      case 'ticker':
        return <td key={col.key}><strong>{row.ticker}</strong>{row.is_drip_lot && <span title="DRIP lot" style={{ marginLeft: 6, color: 'var(--p-ffb86c)', fontSize: '0.7rem' }}>DRIP</span>}</td>
      case 'account_name': return <td key={col.key}>{row.account_name || '—'}</td>
      case 'buy_date': return <td key={col.key}>{fmtDate(row.buy_date)}</td>
      case 'open_shares': return <td key={col.key} style={RIGHT}>{fmtShares(row.open_shares)}</td>
      case 'cost_per_share': return <td key={col.key} style={RIGHT}>{fmt(row.cost_per_share)}</td>
      case 'current_price': return <td key={col.key} style={RIGHT}>{fmt(row.current_price)}</td>
      case 'unrealized_loss': return <td key={col.key} style={{ ...RIGHT, color: 'var(--neg)', fontWeight: 600 }}>{fmtSigned(row.unrealized_loss)}</td>
      case 'term': return <td key={col.key} style={CENTER}><TermPill term={row.term} /></td>
      case 'wash': return <td key={col.key}><WashBadge status={row.wash_status} clearsOn={row.wash_clears_on} /></td>
      case 'est_tax_saved': return <td key={col.key} style={{ ...RIGHT, color: 'var(--p-2efdb5)' }}>{fmt(row.est_tax_saved)}</td>
      case 'plan': return <td key={col.key}><PlanButton row={row} onPlan={onPlan} /></td>
      default: return <td key={col.key} />
    }
  })
}

function CandidateRow({ row, columns, expanded, onToggle, onPlan, showReplacements }) {
  const blocked = row.wash_status !== 'clear' && row.wash_offenders?.length > 0
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ width: 24 }}>{expanded ? '▼' : '▶'}</td>
        {lotCells(row, columns.slice(1), onPlan)}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length} style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem 1.5rem' }}>
            <Replacements ticker={row.ticker} show={showReplacements} />
            <BlockingTransactions row={row} />
            {!showReplacements && !blocked && (
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                No wash-sale conflicts for this lot. Turn on “Show replacement candidates” to see alternatives.
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// The lots under an expanded holding. Its own sort, so re-sorting the holdings
// above does not reshuffle a list the user is reading.
function HoldingLots({ lots, showAccount, onPlan }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const columns = useMemo(
    () => LOT_COLUMNS.filter(col => col.key !== 'expand' && col.key !== 'ticker' && (!col.accountOnly || showAccount)),
    [showAccount],
  )
  const rows = useMemo(() => sortLotRows(lots, sort, columns), [lots, sort, columns])
  return (
    <table className="data-table tlh-nested-table" style={{ width: '100%', marginBottom: '0.9rem' }}>
      <thead>
        <tr>
          {columns.map(col => (
            <LotSortHeader key={col.key} column={col} sort={sort} style={col.align}
              onSort={key => setSort(current => nextLotSort(current, key))} />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(lot => <tr key={lot.txn_id}>{lotCells(lot, columns, onPlan)}</tr>)}
      </tbody>
    </table>
  )
}

function HoldingRow({ group, expanded, onToggle, onPlan, showReplacements, showAccount }) {
  // Wash-sale conflicts are per ticker, so the lot blocked the longest shows them all.
  const blockedLot = group.lots
    .filter(lot => lot.wash_status !== 'clear')
    .sort((a, b) => (b.wash_offenders?.length || 0) - (a.wash_offenders?.length || 0))[0]
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ width: 24 }}>{expanded ? '▼' : '▶'}</td>
        <td><strong>{group.ticker}</strong></td>
        <td style={RIGHT}>{group.lot_count}</td>
        <td>{fmtDate(group.buy_date)}</td>
        <td style={RIGHT}>{fmtShares(group.open_shares)}</td>
        <td style={RIGHT}>{fmt(group.cost_per_share)}</td>
        <td style={RIGHT}>{fmt(group.current_price)}</td>
        <td style={{ ...RIGHT, color: 'var(--neg)', fontWeight: 600 }}>{fmtSigned(group.unrealized_loss)}</td>
        <td style={CENTER}><TermPill term={group.term} /></td>
        <td><WashBadge status={group.wash_status} clearsOn={group.wash_clears_on} /></td>
        <td style={{ ...RIGHT, color: 'var(--p-2efdb5)' }}>{fmt(group.est_tax_saved)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={HOLDING_COLUMNS.length} style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem 1.5rem' }}>
            <h4 style={{ color: 'var(--accent-2)', marginBottom: '0.4rem', fontSize: '0.95rem' }}>
              {group.lot_count} losing lot{group.lot_count === 1 ? '' : 's'} in {group.ticker}
            </h4>
            <HoldingLots lots={group.lots} showAccount={showAccount} onPlan={onPlan} />
            <Replacements ticker={group.ticker} show={showReplacements} />
            {blockedLot && <BlockingTransactions row={blockedLot} />}
          </td>
        </tr>
      )}
    </>
  )
}

export default function TaxLossHarvest() {
  const pf = useProfileFetch()
  const { selection } = useProfile()

  const [data, setData] = useState(null)
  const [summary, setSummary] = useState(null)
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [tab, setTab] = useState('candidates')
  const [prefs, setPrefs] = useState(loadPrefs)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [planSort, setPlanSort] = useState({ key: 'created_at', direction: 'desc' })
  const [actionStatus, setActionStatus] = useState(null)

  const { groupBy, showReplacements, hideBlocked } = prefs
  const updatePrefs = change => setPrefs(current => {
    const next = { ...current, ...change }
    savePrefs(next)
    return next
  })

  const loadAll = () => {
    setLoading(true)
    setError(null)
    Promise.all([
      pf('/api/tax-loss/candidates').then(r => r.json()),
      pf('/api/tax-loss/summary').then(r => r.json()),
      pf('/api/tax-loss/plan').then(r => r.json()),
    ])
      .then(([cands, sum, planRes]) => {
        if (cands.error) throw new Error(cands.error)
        if (sum.error) throw new Error(sum.error)
        setData(cands)
        setSummary(sum)
        setPlans(planRes.plans || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [selection])

  const handlePlan = async (row) => {
    setActionStatus(null)
    try {
      const res = await pf('/api/tax-loss/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: row.ticker,
          buy_txn_id: row.txn_id,
          shares: row.open_shares,
          est_loss: row.unrealized_loss,
          est_tax_saved: row.est_tax_saved,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to plan harvest')
      setActionStatus({ type: 'success', msg: `Planned harvest for ${row.ticker}` })
      loadAll()
    } catch (e) {
      setActionStatus({ type: 'error', msg: e.message })
    }
  }

  const handleDeletePlan = async (id) => {
    setActionStatus(null)
    try {
      const res = await pf(`/api/tax-loss/plan/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove plan')
      setActionStatus({ type: 'success', msg: 'Plan removed' })
      loadAll()
    } catch (e) {
      setActionStatus({ type: 'error', msg: e.message })
    }
  }

  const candidates = useMemo(() => data?.candidates || [], [data])
  const filtered = useMemo(
    () => hideBlocked ? candidates.filter(c => c.wash_status === 'clear') : candidates,
    [candidates, hideBlocked],
  )
  // The Account column only earns its place when the view spans accounts.
  const showAccount = useMemo(
    () => new Set(candidates.map(c => c.profile_id)).size > 1,
    [candidates],
  )
  const lotColumns = useMemo(
    () => LOT_COLUMNS.filter(col => !col.accountOnly || showAccount),
    [showAccount],
  )
  const byHolding = groupBy === 'holding'
  const columns = byHolding ? HOLDING_COLUMNS : lotColumns
  // A column that only one of the two views has falls back to the default order.
  const activeSort = columns.some(col => col.key === sort.key) ? sort : DEFAULT_SORT
  const lotRows = useMemo(
    () => (byHolding ? [] : sortLotRows(filtered, activeSort, lotColumns)),
    [byHolding, filtered, activeSort, lotColumns],
  )
  const holdingRows = useMemo(
    () => (byHolding ? sortLotRows(groupByHolding(filtered), activeSort, HOLDING_COLUMNS) : []),
    [byHolding, filtered, activeSort],
  )
  const sortedPlans = useMemo(() => sortLotRows(plans, planSort, PLAN_COLUMNS), [plans, planSort])
  const holdingCount = useMemo(() => new Set(candidates.map(c => c.ticker)).size, [candidates])

  const setGroupBy = value => {
    setExpandedId(null)
    updatePrefs({ groupBy: value })
  }
  const toggleExpanded = id => setExpandedId(current => (current === id ? null : id))

  const ytd = Number(summary?.ytd_realized || 0)
  const netAfter = Number(summary?.net_after_harvest || 0)

  return (
    <div className="page">
      <h1>Tax-Loss Harvest</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
        Per-lot loss candidates from your current holdings, with wash-sale checks and replacement suggestions.
        Tax savings are estimates only — set your marginal rates in <Link to="/settings" style={{ color: 'var(--accent-2)' }}>Settings</Link>.
      </p>

      {actionStatus && (
        <div className={`alert alert-${actionStatus.type === 'success' ? 'success' : 'error'}`} style={{ marginBottom: '1rem' }}>
          {actionStatus.msg}
        </div>
      )}

      {loading && <div className="ac-loading"><span className="spinner" /> Loading...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {summary && !loading && (
        <>
          <div className="summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            <MetricCard
              label="Harvestable Loss"
              value={fmtSigned(summary.harvestable_loss)}
              sub={`${summary.candidate_count} candidate lot(s) in ${holdingCount} holding${holdingCount === 1 ? '' : 's'}`}
              color="#ff6b6b"
            />
            <MetricCard
              label="YTD Realized"
              value={fmtSigned(ytd)}
              sub={`${summary.ytd_sell_count} sells in ${summary.year}`}
              color={ytd >= 0 ? '#4dff91' : '#ff6b6b'}
            />
            <MetricCard
              label="Net After Harvest"
              value={fmtSigned(netAfter)}
              sub="Realized + harvestable"
              color={netAfter >= 0 ? '#4dff91' : '#ff6b6b'}
            />
            <MetricCard
              label="Est. Tax Saved"
              value={fmt(summary.est_tax_saved)}
              sub={`ST ${fmtPct(summary.rates?.short)} / LT ${fmtPct(summary.rates?.long)}`}
              color="#2EFDB5"
            />
            <MetricCard
              label="Blocked by Wash Sale"
              value={fmtSigned(summary.blocked_loss)}
              sub="Will clear after wash window"
              color="#FFB86C"
            />
          </div>

          <div className="ac-filter-row" role="tablist" style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              className={`tr-pbtn${tab === 'candidates' ? ' tr-pbtn-active' : ''}`}
              onClick={() => setTab('candidates')}
            >
              Candidates ({candidates.length})
            </button>
            <button
              type="button"
              className={`tr-pbtn${tab === 'planned' ? ' tr-pbtn-active' : ''}`}
              onClick={() => setTab('planned')}
            >
              Planned ({plans.filter(p => p.status === 'planned').length})
            </button>
          </div>

          {tab === 'candidates' && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1.25rem', color: 'var(--p-c0cdd8)', marginBottom: '0.6rem' }}>
                <div className="ac-filter-row" role="group" aria-label="Show candidates by" style={{ margin: 0 }}>
                  <button type="button" aria-pressed={!byHolding}
                    className={`tr-pbtn${!byHolding ? ' tr-pbtn-active' : ''}`}
                    title="One row per purchase lot"
                    onClick={() => setGroupBy('lot')}>
                    By lot
                  </button>
                  <button type="button" aria-pressed={byHolding}
                    className={`tr-pbtn${byHolding ? ' tr-pbtn-active' : ''}`}
                    title="One row per holding, with its lots behind the arrow"
                    onClick={() => setGroupBy('holding')}>
                    By holding
                  </button>
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={hideBlocked} onChange={e => updatePrefs({ hideBlocked: e.target.checked })} />
                  Hide wash-sale-blocked lots
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                  title="Replacement ideas appear when you open a row">
                  <input type="checkbox" checked={showReplacements} onChange={e => updatePrefs({ showReplacements: e.target.checked })} />
                  Show replacement candidates
                </label>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                  {byHolding
                    ? `${holdingRows.length} holding${holdingRows.length === 1 ? '' : 's'}, ${filtered.length} lot${filtered.length === 1 ? '' : 's'}`
                    : `${filtered.length} lot${filtered.length === 1 ? '' : 's'}`}
                  {' · click a column heading to sort'}
                </span>
              </div>
              {filtered.length === 0 ? (
                <div className="card ac-empty">No tax-loss candidates available.</div>
              ) : (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        {columns.map(col => (
                          <LotSortHeader key={col.key} column={col} sort={activeSort} style={col.align}
                            onSort={key => setSort(nextLotSort(activeSort, key))} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byHolding
                        ? holdingRows.map(group => (
                          <HoldingRow
                            key={group.ticker}
                            group={group}
                            expanded={expandedId === group.ticker}
                            onToggle={() => toggleExpanded(group.ticker)}
                            onPlan={handlePlan}
                            showReplacements={showReplacements}
                            showAccount={showAccount}
                          />
                        ))
                        : lotRows.map(row => (
                          <CandidateRow
                            key={row.txn_id}
                            row={row}
                            columns={lotColumns}
                            expanded={expandedId === row.txn_id}
                            onToggle={() => toggleExpanded(row.txn_id)}
                            onPlan={handlePlan}
                            showReplacements={showReplacements}
                          />
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'planned' && (
            <>
              {plans.length === 0 ? (
                <div className="card ac-empty">No planned harvests yet. Plan a candidate to track it here.</div>
              ) : (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        {PLAN_COLUMNS.map(col => (
                          <LotSortHeader key={col.key} column={col} sort={planSort} style={col.align}
                            onSort={key => setPlanSort(current => nextLotSort(current, key))} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPlans.map(p => (
                        <tr key={p.id}>
                          <td><strong>{p.ticker}</strong></td>
                          <td style={{ textAlign: 'right' }}>{fmtShares(p.shares)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--neg)' }}>{fmtSigned(p.est_loss)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--p-2efdb5)' }}>{fmt(p.est_tax_saved)}</td>
                          <td>{p.status}</td>
                          <td>{fmtDate(p.created_at)}</td>
                          <td>
                            <button
                              className="btn btn-secondary"
                              onClick={() => handleDeletePlan(p.id)}
                              style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
                            >Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-dim)', maxWidth: '60rem' }}>
            <strong>Disclaimer:</strong> This tool is informational only. Wash-sale rules across accounts, IRA-related wash issues,
            and "substantially identical" interpretations may vary. Confirm any harvest with a tax professional before trading.
          </p>
        </>
      )}
    </div>
  )
}
