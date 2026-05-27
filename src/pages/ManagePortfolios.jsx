import { useState, useEffect, useCallback } from 'react'
import { useProfile } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { API_BASE } from '../config'
import { clearDashboardCacheForSelection } from '../utils/dashboardCache'

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

  const deletePortfolio = async (p) => {
    if (p.id === 1) {
      await dialog.alert('Cannot delete the default portfolio.')
      return
    }
    const ok = await dialog.confirm(`Delete portfolio "${p.name}" and all its data? This cannot be undone.`)
    if (!ok) return
    const res = await fetch(`${API_BASE}/api/profiles/${p.id}`, { method: 'DELETE' })
    if (res.ok) {
      await refreshProfiles()
      await refreshAggregates()
      loadSummary()
    }
  }

  const clearPortfolioData = async (p) => {
    const ok = await dialog.confirm(`Clear all data for "${p.name}"? The portfolio will remain but all holdings, dividends, and tracking data will be removed. This cannot be undone.`)
    if (!ok) return
    const res = await fetch(`${API_BASE}/api/profiles/${p.id}/clear`, { method: 'POST' })
    if (res.ok) {
      loadSummary()
      await dialog.alert(`All data cleared for "${p.name}". You can now reimport.`)
    }
  }

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

  const fmt = (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2>Manage Portfolios</h2>
        <button className="btn btn-primary" onClick={createPortfolio}>+ New Portfolio</button>
      </div>

      <table className="holdings-table" style={{ marginBottom: '2rem' }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Broker Source</th>
            <th style={{ textAlign: 'center' }} title="Include this portfolio in the Owner aggregate">Owner</th>
            <th style={{ textAlign: 'right' }}>Holdings</th>
            <th style={{ textAlign: 'right' }}>Total Value</th>
            <th style={{ textAlign: 'right' }}>Created</th>
            <th style={{ textAlign: 'center' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {summary.map(p => (
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
                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderBottom: '1px dashed #64b5f6' }}
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
                  title="Broker used for import safety checks"
                >
                  {BROKER_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </td>
              <td style={{ textAlign: 'center' }}>
                {p.id === 1 ? (
                  <input type="checkbox" checked disabled title="Owner is always included" />
                ) : (
                  <input
                    type="checkbox"
                    checked={!!p.include_in_owner}
                    onChange={() => toggleIncludeInOwner(p)}
                    title="Include in Owner aggregate"
                  />
                )}
              </td>
              <td style={{ textAlign: 'right' }}>{p.holdings_count}</td>
              <td style={{ textAlign: 'right' }}>{fmt(p.total_value)}</td>
              <td style={{ textAlign: 'right' }}>{p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</td>
              <td style={{ textAlign: 'center' }}>
                <button className="btn btn-sm" onClick={() => setProfileId(String(p.id))} title="Switch to this portfolio">Select</button>
                {p.holdings_count > 0 && (
                  <button className="btn btn-sm" style={{ marginLeft: '0.5rem', borderColor: '#f0ad4e', color: '#f0ad4e' }} onClick={() => clearPortfolioData(p)} title="Clear all data (keep portfolio)">Clear</button>
                )}
                {p.id !== 1 && (
                  <button className="btn btn-sm btn-danger" style={{ marginLeft: '0.5rem' }} onClick={() => deletePortfolio(p)}>Delete</button>
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
      <p style={{ color: '#aaa', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Define one or more virtual portfolios that combine selected real portfolios. Each aggregate appears in the portfolio selector.
      </p>

      {profiles.length <= 1 ? (
        <p style={{ color: '#888', fontStyle: 'italic' }}>Add at least one additional portfolio to use aggregates.</p>
      ) : aggregates.length === 0 ? (
        <p style={{ color: '#888', fontStyle: 'italic' }}>No aggregates yet. Click "+ Add Aggregate" to create one.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {aggregates.map(agg => (
            <div key={agg.id} style={{ border: '1px solid #333', borderRadius: '6px', padding: '0.75rem 1rem' }}>
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
                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '1.05rem', borderBottom: '1px dashed #64b5f6' }}
                    onClick={() => startRenameAggregate(agg)}
                    title="Click to rename"
                  >
                    {agg.name}
                    <span style={{ fontSize: '0.75rem', opacity: 0.7 }} aria-hidden="true">✎</span>
                  </span>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-sm" onClick={() => setAggregateSelection(agg.id)} title="View this aggregate">Select</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteAggregate(agg)}>Delete</button>
                </div>
              </div>
              <div style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
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
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {ownerImportUsed && (
        <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #333' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Sync Owner</h3>
          <p style={{ color: '#aaa', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Update Owner (profile 1) to match the combined totals of a chosen source set. Missing tickers are added; tickers no longer in the source are removed.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.9rem', color: '#ccc' }}>Source:</label>
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
