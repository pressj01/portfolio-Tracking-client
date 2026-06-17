import React, { useEffect, useMemo, useState } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { formatMoney, formatMoneyDelta } from '../utils/money'

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
      {term === 'long' ? 'LT' : term === 'short' ? 'ST' : '?'}
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

function CandidateRow({ row, expanded, onToggle, onPlan }) {
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td style={{ width: 24 }}>{expanded ? '▼' : '▶'}</td>
        <td><strong>{row.ticker}</strong>{row.is_drip_lot && <span title="DRIP lot" style={{ marginLeft: 6, color: 'var(--p-ffb86c)', fontSize: '0.7rem' }}>DRIP</span>}</td>
        <td>{fmtDate(row.buy_date)}</td>
        <td style={{ textAlign: 'right' }}>{fmtShares(row.open_shares)}</td>
        <td style={{ textAlign: 'right' }}>{fmt(row.cost_per_share)}</td>
        <td style={{ textAlign: 'right' }}>{fmt(row.current_price)}</td>
        <td style={{ textAlign: 'right', color: 'var(--neg)', fontWeight: 600 }}>{fmtSigned(row.unrealized_loss)}</td>
        <td style={{ textAlign: 'center' }}><TermPill term={row.term} /></td>
        <td><WashBadge status={row.wash_status} clearsOn={row.wash_clears_on} /></td>
        <td style={{ textAlign: 'right', color: 'var(--p-2efdb5)' }}>{fmt(row.est_tax_saved)}</td>
        <td>
          <button
            className="btn btn-primary"
            disabled={row.wash_status !== 'clear'}
            onClick={(e) => { e.stopPropagation(); onPlan(row) }}
            style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}
          >Plan</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={11} style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem 1.5rem' }}>
            <div style={{ marginBottom: '0.8rem' }}>
              <h4 style={{ color: 'var(--accent-2)', marginBottom: '0.4rem', fontSize: '0.95rem' }}>Replacement candidates (similar type and income profile)</h4>
              <ReplacementBox ticker={row.ticker} />
            </div>
            {row.wash_status !== 'clear' && row.wash_offenders?.length > 0 && (
              <div>
                <h4 style={{ color: 'var(--neg)', marginBottom: '0.4rem', fontSize: '0.95rem' }}>Blocking transactions (wash-sale window)</h4>
                <ul style={{ paddingLeft: '1.2rem', color: 'var(--p-c0cdd8)', fontSize: '0.85rem', margin: 0 }}>
                  {row.wash_offenders.map(o => (
                    <li key={o.txn_id}>
                      {fmtDate(o.date)} — bought {fmtShares(o.shares)} shares
                      {o.is_drip && <span style={{ marginLeft: 6, color: 'var(--p-ffb86c)' }}>(DRIP)</span>}
                      <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>txn #{o.txn_id}, profile {o.profile_id}</span>
                    </li>
                  ))}
                </ul>
                {row.wash_clears_on && <p style={{ marginTop: '0.5rem', color: 'var(--p-ffb86c)', fontSize: '0.85rem' }}>
                  Window clears on <strong>{row.wash_clears_on}</strong>.
                </p>}
              </div>
            )}
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
  const [hideBlocked, setHideBlocked] = useState(false)
  const [actionStatus, setActionStatus] = useState(null)

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

  const candidates = data?.candidates || []
  const filtered = useMemo(
    () => hideBlocked ? candidates.filter(c => c.wash_status === 'clear') : candidates,
    [candidates, hideBlocked],
  )

  const ytd = Number(summary?.ytd_realized || 0)
  const netAfter = Number(summary?.net_after_harvest || 0)

  return (
    <div className="page">
      <h1>Tax-Loss Harvest</h1>
      <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
        Per-lot loss candidates from your current holdings, with wash-sale checks and replacement suggestions.
        Tax savings are estimates only — set your marginal rates in <a href="/settings" style={{ color: 'var(--accent-2)' }}>Settings</a>.
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
              sub={`${summary.candidate_count} candidate lot(s)`}
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
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--p-c0cdd8)', marginBottom: '0.5rem' }}>
                <input type="checkbox" checked={hideBlocked} onChange={e => setHideBlocked(e.target.checked)} />
                Hide wash-sale-blocked lots
              </label>
              {filtered.length === 0 ? (
                <div className="card ac-empty">No tax-loss candidates available.</div>
              ) : (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th />
                        <th>Ticker</th>
                        <th>Buy Date</th>
                        <th style={{ textAlign: 'right' }}>Shares</th>
                        <th style={{ textAlign: 'right' }}>Cost/sh</th>
                        <th style={{ textAlign: 'right' }}>Current</th>
                        <th style={{ textAlign: 'right' }}>Unrealized Loss</th>
                        <th style={{ textAlign: 'center' }}>Term</th>
                        <th>Wash</th>
                        <th style={{ textAlign: 'right' }}>Tax Saved</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(row => (
                        <CandidateRow
                          key={row.txn_id}
                          row={row}
                          expanded={expandedId === row.txn_id}
                          onToggle={() => setExpandedId(expandedId === row.txn_id ? null : row.txn_id)}
                          onPlan={handlePlan}
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
                        <th>Ticker</th>
                        <th style={{ textAlign: 'right' }}>Shares</th>
                        <th style={{ textAlign: 'right' }}>Est. Loss</th>
                        <th style={{ textAlign: 'right' }}>Est. Tax Saved</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map(p => (
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
