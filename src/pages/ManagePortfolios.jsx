import { useState, useEffect, useCallback } from 'react'
import { useProfile } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { API_BASE } from '../config'
import { clearDashboardCacheForSelection } from '../utils/dashboardCache'
import { formatMoney } from '../utils/money'

const BROKER_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'schwab', label: 'Charles Schwab' },
  { value: 'etrade', label: 'E*TRADE' },
  { value: 'fidelity', label: 'Fidelity' },
  { value: 'robinhood', label: 'Robinhood' },
  { value: 'shear_group', label: 'Shear Group' },
  { value: 'snowball', label: 'Snowball' },
  { value: 'other', label: 'Other / Manual' },
]

export default function ManagePortfolios() {
  const {
    profiles,
    refreshProfiles,
    refreshAggregates,
    aggregates,
    isAggregate,
    aggregateId,
    profileId,
    setProfileId,
    setAggregateSelection,
  } = useProfile()
  const dialog = useDialog()
  const [summary, setSummary] = useState([])
  const [ownerImportUsed, setOwnerImportUsed] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editBrokerSource, setEditBrokerSource] = useState('')
  const [editingAggId, setEditingAggId] = useState(null)
  const [editAggName, setEditAggName] = useState('')
  const [reconcileAggId, setReconcileAggId] = useState('owner') // 'owner' = use include_in_owner; else aggregate id
  const [reconciling, setReconciling] = useState(false)
  const [busyAction, setBusyAction] = useState(null)
  const [selectorPreferenceError, setSelectorPreferenceError] = useState('')

  const loadSummary = useCallback(() => {
    fetch(`${API_BASE}/api/profiles/summary`)
      .then(r => r.json())
      .then(data => {
        setSummary(data.profiles || [])
        setOwnerImportUsed(data.owner_import_used || false)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const createPortfolio = async () => {
    const name = await dialog.prompt('Enter portfolio name:')
    if (!name) return
    const res = await fetch(`${API_BASE}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, broker_source: '' }),
    })
    if (res.ok) {
      await refreshProfiles()
      loadSummary()
    }
  }

  const startRename = (p) => {
    setEditingId(p.id)
    setEditName(p.name)
    setEditBrokerSource(p.broker_source || '')
  }

  const saveRename = async (id) => {
    if (!editName.trim()) { setEditingId(null); return }
    const res = await fetch(`${API_BASE}/api/profiles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim(), broker_source: editBrokerSource }),
    })
    if (res.ok) {
      await refreshProfiles()
      loadSummary()
    }
    setEditingId(null)
  }

  const saveBrokerSource = async (p, brokerSource) => {
    const res = await fetch(`${API_BASE}/api/profiles/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: p.name, broker_source: brokerSource }),
    })
    if (res.ok) {
      await refreshProfiles()
      loadSummary()
    }
  }

  // Clear, Reset, and Delete all run through one warned flow: read back exactly
  // what the action would remove, show it, then require the name typed. The
  // server re-checks the name, so nothing here can fire on a stray click.
  const ACTIONS = {
    clear: {
      verb: 'Clear',
      headline: (name, n) => `CLEAR ${n} holdings record(s) for "${name}"?`,
      empty: (name) => `"${name}" has no holdings data to clear.`,
      request: (p) => ({ url: `${API_BASE}/api/profiles/${p.id}/clear`, method: 'POST' }),
    },
    reset: {
      verb: 'Reset',
      headline: (name, n) => `PERMANENTLY DELETE all ${n} position and transaction record(s) for "${name}"?`,
      empty: (name) => `"${name}" has no positions or transactions to delete. It is already ready to import.`,
      request: (p) => ({ url: `${API_BASE}/api/profiles/${p.id}/reset`, method: 'POST' }),
    },
    delete: {
      verb: 'Delete',
      headline: (name, n) => `PERMANENTLY DELETE the portfolio "${name}" and all ${n} of its record(s)?`,
      empty: (name) => `Delete the empty portfolio "${name}"?`,
      request: (p) => ({ url: `${API_BASE}/api/profiles/${p.id}`, method: 'DELETE' }),
    },
  }

  const runDestructiveAction = async (p, scope) => {
    const action = ACTIONS[scope]
    if (scope === 'delete' && p.id === 1) {
      await dialog.alert('Cannot delete the default portfolio. Use Clear or Reset to empty it instead.')
      return
    }
    setBusyAction(`${p.id}:${scope}`)
    try {
      const previewRes = await fetch(`${API_BASE}/api/profiles/${p.id}/data-preview?scope=${scope}`)
      const preview = await previewRes.json()
      if (!previewRes.ok) {
        await dialog.alert(preview.error || `Could not read "${p.name}" before running ${action.verb}.`)
        return
      }
      // Nothing to remove: Clear/Reset are pointless, but an empty portfolio is
      // still worth deleting, so only that one carries on to the warning.
      if (!preview.total && scope !== 'delete') {
        await dialog.alert(action.empty(p.name))
        return
      }

      const s = preview.summary || {}
      const lines = [
        ['Positions', s.positions],
        ['Transactions', s.transactions],
        ['Option trades', s.option_trades],
        ['Dividend payments', s.dividend_payments],
        ['Other linked records', s.other_records],
      ].filter(([, n]) => n > 0).map(([label, n]) => `  • ${label}: ${n}`)

      const kept = preview.preserved || []
      const warning = [
        action.headline(p.name, preview.total),
        '',
        ...(lines.length ? ['This removes:', ...lines, ''] : []),
        ...(kept.length ? ['Kept: ' + kept.join('; ') + '.', ''] : []),
        ...(preview.removes_portfolio
          ? ['The portfolio itself is removed from the selector and from any aggregates.', '']
          : []),
        'A database backup is saved first — you can restore it from the Import page.',
        'Other portfolios are not touched.',
      ].join('\n')

      if (!(await dialog.confirm(warning))) return

      const typed = await dialog.prompt(`Last check. Type the portfolio name exactly to ${action.verb.toLowerCase()} it: ${p.name}`)
      if (typed === null) return
      if (String(typed).trim() !== p.name.trim()) {
        await dialog.alert('Name did not match. Nothing was changed.')
        return
      }

      const { url, method } = action.request(p)
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_name: p.name }),
      })
      const data = await res.json()
      if (!res.ok) {
        await dialog.alert(data.error || `${action.verb} failed.`)
        return
      }
      clearDashboardCacheForSelection(`p:${p.id}`)
      loadSummary()
      await refreshProfiles()
      if (scope === 'delete') await refreshAggregates()
      await dialog.alert(
        `${data.message}${data.backup ? `\n\nBackup saved: ${data.backup}` : ''}`
      )
    } catch (e) {
      await dialog.alert(`${action.verb} failed: ${e.message}`)
    } finally {
      setBusyAction(null)
    }
  }

  const clearPortfolioData = (p) => runDestructiveAction(p, 'clear')
  const resetPortfolio = (p) => runDestructiveAction(p, 'reset')
  const deletePortfolio = (p) => runDestructiveAction(p, 'delete')

  const toggleIncludeInOwner = async (p) => {
    const newVal = !p.include_in_owner
    const res = await fetch(`${API_BASE}/api/profiles/${p.id}/include-in-owner`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ include: newVal }),
    })
    if (res.ok) {
      clearDashboardCacheForSelection('p:1')
      loadSummary()
    }
  }

  const saveSelectorPreference = async (path, options, fallbackMessage) => {
    try {
      const res = await fetch(`${API_BASE}${path}`, options)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSelectorPreferenceError(data.error || `${fallbackMessage} (HTTP ${res.status})`)
        return false
      }
      setSelectorPreferenceError('')
      return true
    } catch (error) {
      setSelectorPreferenceError(`${fallbackMessage}: ${error.message}`)
      return false
    }
  }

  const saveAccountOwnership = async (p, isUserOwned) => {
    const res = await fetch(`${API_BASE}/api/profiles/${p.id}/ownership`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_user_owned: isUserOwned }),
    })
    if (res.ok) {
      clearDashboardCacheForSelection('p:1')
      await refreshProfiles()
      loadSummary()
    }
  }

  const toggleProfileSelectorVisibility = async (p) => {
    const nextVisible = !!p.hidden_from_selector
    const saved = await saveSelectorPreference(`/api/profiles/${p.id}/selector-visibility`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible: nextVisible }),
    }, `Could not update ${p.name} selector visibility`)
    if (saved) {
      await refreshProfiles()
      loadSummary()
      if (!isAggregate && profileId === p.id && !nextVisible) setProfileId('1')
    }
  }

  const moveProfile = async (profileIdToMove, direction) => {
    const orderedIds = profiles.map(p => p.id)
    const index = orderedIds.indexOf(profileIdToMove)
    const target = index + direction
    if (index < 0 || target < 0 || target >= orderedIds.length) return
    ;[orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]]
    const saved = await saveSelectorPreference('/api/profiles/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: orderedIds }),
    }, 'Could not save the portfolio order')
    if (saved) {
      await refreshProfiles()
      loadSummary()
    }
  }

  // ── Aggregate CRUD ────────────────────────────────────────────────────
  const createAggregate = async () => {
    const name = await dialog.prompt('Name for the new aggregate:')
    if (!name || !name.trim()) return
    const res = await fetch(`${API_BASE}/api/aggregates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), member_ids: [] }),
    })
    if (res.ok) await refreshAggregates()
  }

  const startRenameAggregate = (agg) => {
    setEditingAggId(agg.id)
    setEditAggName(agg.name)
  }

  const saveAggregateName = async (aggId) => {
    if (!editAggName.trim()) { setEditingAggId(null); return }
    const res = await fetch(`${API_BASE}/api/aggregates/${aggId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editAggName.trim() }),
    })
    if (res.ok) await refreshAggregates()
    setEditingAggId(null)
  }

  const deleteAggregate = async (agg) => {
    const ok = await dialog.confirm(`Delete aggregate "${agg.name}"? Member portfolios are not affected.`)
    if (!ok) return
    const res = await fetch(`${API_BASE}/api/aggregates/${agg.id}`, { method: 'DELETE' })
    if (res.ok) {
      await refreshAggregates()
      if (isAggregate && aggregateId === agg.id) setProfileId('1')
    }
  }

  const toggleAggMember = async (agg, profileId) => {
    const isMember = agg.member_ids.includes(profileId)
    const nextMembers = isMember
      ? agg.member_ids.filter(id => id !== profileId)
      : [...agg.member_ids, profileId]
    const res = await fetch(`${API_BASE}/api/aggregates/${agg.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_ids: nextMembers }),
    })
    if (res.ok) await refreshAggregates()
  }

  const toggleAggregateSelectorVisibility = async (agg) => {
    const nextHidden = !agg.hidden_from_selector
    const saved = await saveSelectorPreference(`/api/aggregates/${agg.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden_from_selector: nextHidden }),
    }, `Could not update ${agg.name} selector visibility`)
    if (saved) {
      await refreshAggregates()
      if (isAggregate && aggregateId === agg.id && nextHidden) setProfileId('1')
    }
  }

  const moveAggregate = async (aggregateIdToMove, direction) => {
    const orderedIds = aggregates.map(agg => agg.id)
    const index = orderedIds.indexOf(aggregateIdToMove)
    const target = index + direction
    if (index < 0 || target < 0 || target >= orderedIds.length) return
    ;[orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]]
    const saved = await saveSelectorPreference('/api/aggregates/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: orderedIds }),
    }, 'Could not save the aggregate order')
    if (saved) await refreshAggregates()
  }

  // ── Owner reconciliation ─────────────────────────────────────────────
  const reconcileOwner = async () => {
    let included, label
    if (reconcileAggId === 'owner') {
      included = summary.filter(p => p.id !== 1 && p.include_in_owner)
      label = `${included.length} sub-portfolio(s) marked "Owner"`
    } else {
      const agg = aggregates.find(a => a.id === Number(reconcileAggId))
      if (!agg) {
        await dialog.alert('Selected aggregate no longer exists.')
        return
      }
      const memberSet = new Set(agg.member_ids)
      included = summary.filter(p => p.id !== 1 && memberSet.has(p.id))
      label = `aggregate "${agg.name}"`
    }
    if (included.length === 0) {
      await dialog.alert('No source portfolios found. Pick a different source or mark portfolios under "Owner".')
      return
    }
    const ok = await dialog.confirm(
      `Sync Owner from ${label}?\n\nThis will update Owner holdings to match the combined totals of: ${included.map(p => p.name).join(', ')}.`
    )
    if (!ok) return

    setReconciling(true)
    try {
      const sourceIds = included.map(p => p.id)
      const res = await fetch(`${API_BASE}/api/profiles/reconcile-owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_ids: sourceIds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      clearDashboardCacheForSelection('p:1')
      await dialog.alert(data.message)
      loadSummary()
    } catch (e) {
      await dialog.alert(`Error: ${e.message}`)
    } finally {
      setReconciling(false)
    }
  }

  const fmt = (v) => formatMoney(v, { zeroIfInvalid: true })

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2>Manage Portfolios</h2>
        <button className="btn btn-primary" onClick={createPortfolio}>+ New Portfolio</button>
      </div>

      <p style={{ color: 'var(--p-aaa)', marginTop: 0, marginBottom: '1rem', fontSize: '0.9rem' }}>
        Use <strong>Account Type</strong> to identify test or non-user-owned data. Optimization stays scoped to the active account; test/non-owned accounts are also kept out of Owner.
      </p>

      <div
        style={{
          border: '1px solid var(--p-333)', borderRadius: '6px', padding: '0.75rem 1rem',
          marginBottom: '1.25rem', fontSize: '0.9rem', color: 'var(--p-aaa)',
        }}
      >
        <strong style={{ color: 'var(--text)' }}>The three Actions that remove data</strong>
        <ul style={{ margin: '0.5rem 0 0.5rem 1.1rem', padding: 0, lineHeight: 1.6 }}>
          <li>
            <strong style={{ color: 'var(--p-f0ad4e)' }}>Clear</strong> — empties the holdings
            and the tracking derived from them. <em>Keeps</em> the portfolio and its transaction
            history. Use it to reload positions from a fresh broker export.
          </li>
          <li>
            <strong style={{ color: 'var(--p-f0ad4e)' }}>Reset</strong> — empties the holdings
            <em> and</em> the transaction history, dividend payments, and option trades.
            <em> Keeps</em> the portfolio, its NAV history, categories, and saved plans. Use it to
            start an import over from scratch.
          </li>
          <li>
            <strong style={{ color: 'var(--p-ef9a9a)' }}>Delete</strong> — removes the portfolio
            itself along with everything it holds. It disappears from the portfolio selector and
            from any aggregates. Owner cannot be deleted.
          </li>
        </ul>
        All three take a database backup first (restore it from the Import page), warn you with
        the exact record counts, and require you to type the portfolio name before anything is
        removed. Other portfolios are never touched.
      </div>

      {selectorPreferenceError && <div className="alert alert-error">{selectorPreferenceError}</div>}

      <table className="holdings-table" style={{ marginBottom: '2rem' }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Broker Source</th>
            <th>Account Type</th>
            <th style={{ textAlign: 'center' }} title="Show this portfolio in the navbar portfolio selector">Show</th>
            <th style={{ textAlign: 'center' }} title="Include this portfolio in the Owner aggregate">Owner</th>
            <th style={{ textAlign: 'right' }}>Holdings</th>
            <th style={{ textAlign: 'right' }}>Total Value</th>
            <th style={{ textAlign: 'right' }}>Created</th>
            <th style={{ textAlign: 'center' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((p, index) => (
            <tr key={p.id}>
              <td>
                {editingId === p.id ? (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="dialog-input"
                      style={{ width: '200px', padding: '0.2rem 0.5rem' }}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(p.id); if (e.key === 'Escape') setEditingId(null) }}
                      autoFocus
                    />
                    <button className="btn btn-sm" onClick={() => saveRename(p.id)}>Save</button>
                    <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <span
                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderBottom: '1px dashed var(--accent)' }}
                    onClick={() => startRename(p)}
                    title="Click to rename"
                  >
                    {p.name}
                    <span style={{ fontSize: '0.75rem', opacity: 0.7 }} aria-hidden="true">✎</span>
                  </span>
                )}
              </td>
              <td>
                <select
                  value={editingId === p.id ? editBrokerSource : (p.broker_source || '')}
                  onChange={(e) => {
                    if (editingId === p.id) {
                      setEditBrokerSource(e.target.value)
                    } else {
                      saveBrokerSource(p, e.target.value)
                    }
                  }}
                  style={{ width: '150px' }}
                  title="Matching broker imports are authorized by this source, regardless of the portfolio name"
                >
                  {BROKER_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  value={p.is_user_owned ? 'owned' : 'test'}
                  disabled={p.id === 1}
                  onChange={(e) => saveAccountOwnership(p, e.target.value === 'owned')}
                  style={{ width: '150px' }}
                  title={p.id === 1 ? 'Owner is always user-owned' : 'Classify this portfolio without deleting its data'}
                  aria-label={`Account type for ${p.name}`}
                >
                  <option value="owned">User-owned</option>
                  <option value="test">Test / non-owned</option>
                </select>
              </td>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={!p.hidden_from_selector}
                  disabled={p.id === 1}
                  onChange={() => toggleProfileSelectorVisibility(p)}
                  title={p.id === 1 ? 'Owner always remains visible in the portfolio selector' : 'Show this portfolio in the portfolio selector'}
                  aria-label={`Show ${p.name} in the portfolio selector`}
                />
              </td>
              <td style={{ textAlign: 'center' }}>
                {p.id === 1 ? (
                  <input type="checkbox" checked disabled title="Owner is always included" />
                ) : (
                  <input
                    type="checkbox"
                    checked={!!p.include_in_owner}
                    disabled={!p.is_user_owned}
                    onChange={() => toggleIncludeInOwner(p)}
                    title={p.is_user_owned ? 'Include in Owner aggregate' : 'Test / non-owned accounts cannot be included in Owner'}
                  />
                )}
              </td>
              <td style={{ textAlign: 'right' }}>{p.holdings_count}</td>
              <td style={{ textAlign: 'right' }}>{fmt(p.total_value)}</td>
              <td style={{ textAlign: 'right' }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</td>
              <td style={{ textAlign: 'center' }}>
                <button className="btn btn-sm" onClick={() => moveProfile(p.id, -1)} disabled={index === 0} title="Move portfolio up" aria-label={`Move ${p.name} up`}>↑</button>
                <button className="btn btn-sm" style={{ marginLeft: '0.3rem' }} onClick={() => moveProfile(p.id, 1)} disabled={index === summary.length - 1} title="Move portfolio down" aria-label={`Move ${p.name} down`}>↓</button>
                <button className="btn btn-sm" onClick={() => setProfileId(String(p.id))} title="Switch to this portfolio">Select</button>
                {p.holdings_count > 0 && (
                  <button
                    className="btn btn-sm"
                    style={{ marginLeft: '0.5rem', borderColor: 'var(--p-f0ad4e)', color: 'var(--p-f0ad4e)' }}
                    onClick={() => clearPortfolioData(p)}
                    disabled={busyAction === `${p.id}:clear`}
                    title="Empty the holdings but keep the portfolio and its transaction history"
                  >
                    {busyAction === `${p.id}:clear` ? 'Clearing…' : 'Clear'}
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  style={{ marginLeft: '0.5rem', borderColor: 'var(--p-f0ad4e)', color: 'var(--p-f0ad4e)' }}
                  onClick={() => resetPortfolio(p)}
                  disabled={busyAction === `${p.id}:reset`}
                  title="Empty the holdings AND the transaction history, keeping the portfolio, so you can import it again from scratch"
                >
                  {busyAction === `${p.id}:reset` ? 'Resetting…' : 'Reset'}
                </button>
                {p.id !== 1 && (
                  <button
                    className="btn btn-sm btn-danger"
                    style={{ marginLeft: '0.5rem' }}
                    onClick={() => deletePortfolio(p)}
                    disabled={busyAction === `${p.id}:delete`}
                    title="Remove the portfolio itself along with all of its data — it disappears from the selector and from any aggregates"
                  >
                    {busyAction === `${p.id}:delete` ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Aggregates section ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Aggregates</h3>
        <button className="btn btn-primary btn-sm" onClick={createAggregate}>+ Add Aggregate</button>
      </div>
      <p style={{ color: 'var(--p-aaa)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Define one or more virtual portfolios that combine selected real portfolios. Use the controls below to order them or hide one from the portfolio selector.
      </p>

      {profiles.length <= 1 ? (
        <p style={{ color: 'var(--p-888)', fontStyle: 'italic' }}>Add at least one additional portfolio to use aggregates.</p>
      ) : aggregates.length === 0 ? (
        <p style={{ color: 'var(--p-888)', fontStyle: 'italic' }}>No aggregates yet. Click "+ Add Aggregate" to create one.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {aggregates.map((agg, index) => (
            <div key={agg.id} style={{ border: '1px solid var(--p-333)', borderRadius: '6px', padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem' }}>
                {editingAggId === agg.id ? (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      className="dialog-input"
                      style={{ width: '240px', padding: '0.3rem 0.5rem' }}
                      value={editAggName}
                      onChange={(e) => setEditAggName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveAggregateName(agg.id); if (e.key === 'Escape') setEditingAggId(null) }}
                      autoFocus
                    />
                    <button className="btn btn-sm" onClick={() => saveAggregateName(agg.id)}>Save</button>
                    <button className="btn btn-sm" onClick={() => setEditingAggId(null)}>Cancel</button>
                  </div>
                ) : (
                  <span
                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '1.05rem', borderBottom: '1px dashed var(--accent)' }}
                    onClick={() => startRenameAggregate(agg)}
                    title="Click to rename"
                  >
                    {agg.name}
                    <span style={{ fontSize: '0.75rem', opacity: 0.7 }} aria-hidden="true">✎</span>
                  </span>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--p-aaa)', cursor: 'pointer' }} title="Show this aggregate in the portfolio selector">
                    <input type="checkbox" checked={!agg.hidden_from_selector} onChange={() => toggleAggregateSelectorVisibility(agg)} />
                    Show
                  </label>
                  <button className="btn btn-sm" onClick={() => moveAggregate(agg.id, -1)} disabled={index === 0} title="Move aggregate up" aria-label={`Move ${agg.name} up`}>↑</button>
                  <button className="btn btn-sm" onClick={() => moveAggregate(agg.id, 1)} disabled={index === aggregates.length - 1} title="Move aggregate down" aria-label={`Move ${agg.name} down`}>↓</button>
                  <button className="btn btn-sm" onClick={() => setAggregateSelection(agg.id)} title="View this aggregate">Select</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteAggregate(agg)}>Delete</button>
                </div>
              </div>
              <div style={{ color: 'var(--p-aaa)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                Members ({agg.member_ids.length} of {summary.filter(p => p.id !== 1).length}):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem' }}>
                {summary.filter(p => p.id !== 1).map(p => (
                  <label key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={agg.member_ids.includes(p.id)}
                      onChange={() => toggleAggMember(agg, p.id)}
                    />
                    {p.name}{p.is_user_owned ? '' : ' (test / non-owned)'}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {ownerImportUsed && (
        <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--p-333)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Sync Owner</h3>
          <p style={{ color: 'var(--p-aaa)', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Update Owner (profile 1) to match the combined totals of a chosen source set. Missing tickers are added; tickers no longer in the source are removed.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.9rem', color: 'var(--p-ccc)' }}>Source:</label>
            <select
              value={reconcileAggId}
              onChange={(e) => setReconcileAggId(e.target.value)}
              style={{ minWidth: '240px' }}
            >
              <option value="owner">Portfolios marked "Owner" above</option>
              {aggregates.map(agg => (
                <option key={agg.id} value={agg.id}>Aggregate: {agg.name}</option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={reconcileOwner}
            disabled={reconciling}
          >
            {reconciling ? <><span className="spinner" /> Syncing...</> : 'Sync Owner'}
          </button>
        </div>
      )}
    </div>
  )
}
