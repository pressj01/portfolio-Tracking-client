import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDialog } from './DialogProvider'
import { formatMoney } from '../utils/money'

// Deposits, withdrawals and share transfers are what the Dashboard's Account
// Alpha subtracts from the account's recorded value. Broker imports supply
// them automatically; this modal lets the user add what an import missed and
// mark periods whose money movements are complete (including "none").

const KIND_OPTIONS = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'transfer_in', label: 'Shares transferred in' },
  { value: 'transfer_out', label: 'Shares transferred out' },
]

const SOURCE_LABELS = {
  manual: 'Entered here',
  portfolio_export: 'App export',
}

const todayIso = () => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

const sourceLabel = (source) => SOURCE_LABELS[source] || (source ? String(source).replace(/_/g, ' ') : 'Import')

const TYPE_LABELS = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  SECURITY_TRANSFER_IN: 'Shares in',
  SECURITY_TRANSFER_OUT: 'Shares out',
  TAX_WITHHOLDING: 'Tax withheld',
}

const inputStyle = {
  padding: '0.4rem 0.55rem', borderRadius: 4, border: '1px solid var(--border)',
  background: 'var(--surface-inset)', color: 'var(--text)', fontSize: '0.82rem',
}
const labelStyle = { display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.72rem', color: 'var(--text-dim-2)' }
const sectionTitle = {
  color: 'var(--text-dim-2)', fontSize: '0.8rem', letterSpacing: '0.04em', textTransform: 'uppercase',
  margin: '1rem 0 0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem',
}
const thStyle = { padding: '5px 8px', textAlign: 'left', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface-inset)' }
const tdStyle = { padding: '4px 8px', borderBottom: '1px solid var(--grid-line)', verticalAlign: 'top' }

export default function AccountActivityManager({ pf, onClose }) {
  const dialog = useDialog()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ kind: 'deposit', date: todayIso(), amount: '', ticker: '', quantity: '', price: '', note: '' })
  const [period, setPeriod] = useState({ start_date: '', end_date: todayIso() })

  const load = useCallback(async () => {
    try {
      const res = await pf('/api/account-activity')
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`)
      setData(payload)
      setError(null)
    } catch (err) {
      setError(err.message || 'Could not load account activity.')
    }
  }, [pf])

  useEffect(() => { load() }, [load])

  const send = async (url, options) => {
    const res = await pf(url, { headers: { 'Content-Type': 'application/json' }, ...options })
    const payload = await res.json().catch(() => ({}))
    return { res, payload }
  }

  const isShares = form.kind === 'transfer_in' || form.kind === 'transfer_out'

  const addEntry = async (allowDuplicate = false) => {
    setBusy(true)
    setError(null)
    try {
      const body = { ...form, allow_duplicate: allowDuplicate }
      const { res, payload } = await send('/api/account-activity', { method: 'POST', body: JSON.stringify(body) })
      if (res.status === 409 && payload.duplicate && !allowDuplicate) {
        const again = await dialog.confirm(
          'An identical entry on that date is already recorded, possibly from a broker import. '
          + 'Adding it again counts the money twice. Add another anyway?',
        )
        if (again) await addEntry(true)
        return
      }
      if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`)
      setForm(prev => ({ ...prev, amount: '', quantity: '', price: '', note: '' }))
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeEntry = async (row) => {
    const what = row.ticker ? `${row.quantity} ${row.ticker}` : formatMoney(row.base_amount ?? row.amount)
    if (!await dialog.confirm(`Remove the ${TYPE_LABELS[row.activity_type] || row.activity_type} of ${what} on ${row.activity_date}?`)) return
    setBusy(true)
    const { res, payload } = await send(`/api/account-activity/${row.id}`, { method: 'DELETE' })
    if (!res.ok) setError(payload.error || 'Could not remove that record.')
    await load()
    setBusy(false)
  }

  const addPeriod = async () => {
    setBusy(true)
    setError(null)
    const { res, payload } = await send('/api/account-activity/coverage', { method: 'POST', body: JSON.stringify(period) })
    if (!res.ok) setError(payload.error || 'Could not mark that period.')
    else setPeriod(prev => ({ ...prev, start_date: '' }))
    await load()
    setBusy(false)
  }

  const removePeriod = async (row) => {
    if (!await dialog.confirm(`Stop treating ${row.start_date} to ${row.end_date} as a complete record?`)) return
    setBusy(true)
    const { res, payload } = await send(`/api/account-activity/coverage/${row.id}`, { method: 'DELETE' })
    if (!res.ok) setError(payload.error || 'Could not remove that period.')
    await load()
    setBusy(false)
  }

  const editable = Boolean(data?.editable)
  const showAccount = useMemo(
    () => new Set((data?.flows || []).map(row => row.profile_id)).size > 1
      || new Set((data?.covered_runs || []).map(row => row.profile_id)).size > 1,
    [data],
  )
  const flows = data?.flows || []
  const shownFlows = flows.slice(0, 400)

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        className="card"
        role="dialog"
        aria-modal="true"
        aria-label="Deposits and withdrawals"
        style={{ width: 980, maxWidth: '95vw', maxHeight: '90vh', margin: 0, overflow: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Deposits &amp; Withdrawals</h2>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', lineHeight: 1.5, margin: '0 0 0.5rem' }}>
          The Dashboard&apos;s <strong>Account Alpha</strong> separates money you added or took out from what the
          account earned. Broker transaction imports fill this list automatically. Add anything an import missed,
          and mark a period complete once every deposit and withdrawal in it is here, including a stretch where
          no money moved at all. Account Alpha is measured only inside completed periods.
        </p>

        {data && !editable && data.reason && (
          <div className="alert alert-info" style={{ margin: '0.5rem 0' }}>{data.reason}</div>
        )}
        {error && <div className="alert alert-error" style={{ margin: '0.5rem 0' }}>{error}</div>}
        {!data && !error && <p style={{ color: 'var(--text-dim)' }}><span className="spinner" /> Loading…</p>}

        {data && (
          <>
            <h3 style={sectionTitle}>Periods with a complete record</h3>
            {data.covered_runs.length === 0 ? (
              <p style={{ color: 'var(--warning-money)', fontSize: '0.82rem', margin: '0 0 0.5rem' }}>
                None yet, so Account Alpha cannot be shown. Import a full broker transaction history or mark a period below.
              </p>
            ) : (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', margin: '0 0 0.5rem' }}>
                {data.covered_runs.map(run => (
                  `${showAccount ? `${run.profile_name}: ` : ''}${run.start_date} to ${run.end_date}`
                )).join(' · ')}
              </p>
            )}
            {data.coverage.length > 0 && (
              <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', marginBottom: '0.5rem' }}>
                <thead>
                  <tr>
                    {showAccount && <th style={thStyle}>Account</th>}
                    <th style={thStyle}>From</th>
                    <th style={thStyle}>To</th>
                    <th style={thStyle}>Source</th>
                    {editable && <th style={thStyle} aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {data.coverage.map(row => (
                    <tr key={row.id}>
                      {showAccount && <td style={tdStyle}>{row.profile_name}</td>}
                      <td style={tdStyle}>{row.start_date}</td>
                      <td style={tdStyle}>{row.end_date}</td>
                      <td style={tdStyle}>{sourceLabel(row.source_format)}</td>
                      {editable && (
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <button className="btn btn-secondary" style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }} disabled={busy} onClick={() => removePeriod(row)}>
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {editable && (
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={labelStyle}>
                  From
                  <input type="date" style={inputStyle} value={period.start_date} max={period.end_date || todayIso()}
                    onChange={e => setPeriod(prev => ({ ...prev, start_date: e.target.value }))} />
                </label>
                <label style={labelStyle}>
                  To
                  <input type="date" style={inputStyle} value={period.end_date} max={todayIso()}
                    onChange={e => setPeriod(prev => ({ ...prev, end_date: e.target.value }))} />
                </label>
                <button className="btn btn-secondary" disabled={busy || !period.start_date || !period.end_date} onClick={addPeriod}>
                  Mark period complete
                </button>
              </div>
            )}

            {editable && (
              <>
                <h3 style={sectionTitle}>Add a deposit, withdrawal, or share transfer</h3>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label style={labelStyle}>
                    Type
                    <select style={inputStyle} value={form.kind} onChange={e => setForm(prev => ({ ...prev, kind: e.target.value }))}>
                      {KIND_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </label>
                  <label style={labelStyle}>
                    Date
                    <input type="date" style={inputStyle} value={form.date} max={todayIso()}
                      onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} />
                  </label>
                  {isShares ? (
                    <>
                      <label style={labelStyle}>
                        Ticker
                        <input style={{ ...inputStyle, width: 90 }} value={form.ticker}
                          onChange={e => setForm(prev => ({ ...prev, ticker: e.target.value.toUpperCase() }))} />
                      </label>
                      <label style={labelStyle}>
                        Shares
                        <input type="number" min="0" step="any" style={{ ...inputStyle, width: 100 }} value={form.quantity}
                          onChange={e => setForm(prev => ({ ...prev, quantity: e.target.value }))} />
                      </label>
                      <label style={labelStyle} title="Leave blank to value the shares at that day's market close.">
                        Price (optional, USD)
                        <input type="number" min="0" step="any" style={{ ...inputStyle, width: 110 }} value={form.price}
                          onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))} />
                      </label>
                    </>
                  ) : (
                    <label style={labelStyle}>
                      Amount (USD)
                      <input type="number" min="0" step="0.01" style={{ ...inputStyle, width: 120 }} value={form.amount}
                        onChange={e => setForm(prev => ({ ...prev, amount: e.target.value }))} />
                    </label>
                  )}
                  <label style={{ ...labelStyle, flex: '1 1 180px' }}>
                    Note (optional)
                    <input style={inputStyle} value={form.note} maxLength={200}
                      onChange={e => setForm(prev => ({ ...prev, note: e.target.value }))} />
                  </label>
                  <button
                    className="btn btn-success"
                    disabled={busy || !form.date || (isShares ? !(form.ticker && Number(form.quantity) > 0) : !(Number(form.amount) > 0))}
                    onClick={() => addEntry(false)}
                  >
                    Add
                  </button>
                </div>
              </>
            )}

            <h3 style={sectionTitle}>Recorded money and share movements</h3>
            {flows.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>Nothing recorded yet.</p>
            ) : (
              <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Date</th>
                      {showAccount && <th style={thStyle}>Account</th>}
                      <th style={thStyle}>Type</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                      <th style={thStyle}>Description</th>
                      <th style={thStyle}>Counted</th>
                      <th style={thStyle}>Source</th>
                      {editable && <th style={thStyle} aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {shownFlows.map(row => {
                      const counted = row.performance_treatment === 'EXTERNAL_FLOW'
                      const money = row.base_amount ?? row.amount
                      return (
                        <tr key={row.id} style={counted ? undefined : { color: 'var(--text-dim-2)' }}>
                          <td style={tdStyle}>{row.activity_date}</td>
                          {showAccount && <td style={tdStyle}>{row.profile_name}</td>}
                          <td style={tdStyle}>{TYPE_LABELS[row.activity_type] || row.raw_type || row.activity_type}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: counted && money != null ? (money >= 0 ? 'var(--pos)' : 'var(--neg)') : undefined }}>
                            {money != null
                              ? formatMoney(money)
                              : `${row.direction === 'OUT' ? '−' : '+'}${Number(row.quantity || 0).toLocaleString()} ${row.ticker || ''}`}
                          </td>
                          <td style={tdStyle}>{row.description || row.raw_type || ''}</td>
                          <td style={tdStyle} title={counted ? undefined : 'Ambiguous broker row; Account Alpha treats it as ordinary account activity, not money in or out.'}>
                            {counted ? 'Yes' : 'No (unclear)'}
                          </td>
                          <td style={tdStyle}>{sourceLabel(row.source_format)}</td>
                          {editable && (
                            <td style={{ ...tdStyle, textAlign: 'right' }}>
                              <button className="btn btn-secondary" style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }} disabled={busy} onClick={() => removeEntry(row)}>
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {flows.length > shownFlows.length && (
              <p style={{ color: 'var(--text-dim-2)', fontSize: '0.75rem' }}>
                Showing the latest {shownFlows.length} of {flows.length} records.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
