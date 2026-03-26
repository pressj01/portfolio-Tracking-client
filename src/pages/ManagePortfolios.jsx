import { useState, useEffect, useCallback } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { API_BASE } from '../config'

export default function ManagePortfolios() {
  const { profiles, refreshProfiles, refreshAggregateConfig, aggregateConfig, aggregateName, isAggregate, setProfileId } = useProfile()
  const dialog = useDialog()
  const [summary, setSummary] = useState([])
  const [ownerImportUsed, setOwnerImportUsed] = useState(false)
  const [aggMembers, setAggMembers] = useState([])
  const [aggNameInput, setAggNameInput] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

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

  useEffect(() => {
    setAggMembers(aggregateConfig)
  }, [aggregateConfig])

  useEffect(() => {
    setAggNameInput(aggregateName)
  }, [aggregateName])

  const createPortfolio = async () => {
    const name = await dialog.prompt('Enter portfolio name:')
    if (!name) return
    const res = await fetch(`${API_BASE}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      await refreshProfiles()
      loadSummary()
    }
  }

  const startRename = (p) => {
    setEditingId(p.id)
    setEditName(p.name)
  }

  const saveRename = async (id) => {
    if (!editName.trim()) { setEditingId(null); return }
    const res = await fetch(`${API_BASE}/api/profiles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    })
    if (res.ok) {
      await refreshProfiles()
      loadSummary()
    }
    setEditingId(null)
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

  const toggleAggMember = (id) => {
    setAggMembers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const saveAggregateConfig = async () => {
    if (!aggNameInput.trim()) {
      await dialog.alert('Please enter a name for the aggregate portfolio.')
      return
    }
    const res = await fetch(`${API_BASE}/api/aggregate-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_ids: aggMembers, name: aggNameInput.trim() }),
    })
    if (res.ok) {
      await refreshAggregateConfig()
      await dialog.alert('Aggregate configuration saved.')
    }
  }

  const deleteAggregateConfig = async () => {
    const ok = await dialog.confirm('Delete the aggregate portfolio configuration? You can recreate it at any time.')
    if (!ok) return
    const res = await fetch(`${API_BASE}/api/aggregate-config`, { method: 'DELETE' })
    if (res.ok) {
      await refreshAggregateConfig()
      if (isAggregate) setProfileId('1')
    }
  }

  const [reconciling, setReconciling] = useState(false)

  const toggleIncludeInOwner = async (p) => {
    const newVal = !p.include_in_owner
    const res = await fetch(`${API_BASE}/api/profiles/${p.id}/include-in-owner`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ include: newVal }),
    })
    if (res.ok) loadSummary()
  }

  const reconcileOwner = async () => {
    const included = summary.filter(p => p.id !== 1 && p.include_in_owner)
    if (included.length === 0) {
      await dialog.alert('No sub-portfolios are marked "Include in Owner". Check the box for each portfolio you want included.')
      return
    }
    const ok = await dialog.confirm(
      `Reconcile Owner against ${included.length} sub-portfolio(s)?\n\nThis will update Owner holdings to match the combined totals of: ${included.map(p => p.name).join(', ')}.`
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
      if (!res.ok) throw new Error(data.error || 'Reconciliation failed')
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
            <th style={{ textAlign: 'center' }} title="Include this portfolio in Owner reconciliation and aggregate">Include</th>
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
                  <input
                    className="dialog-input"
                    style={{ width: '200px', padding: '0.2rem 0.5rem' }}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(p.id); if (e.key === 'Escape') setEditingId(null) }}
                    onBlur={() => saveRename(p.id)}
                    autoFocus
                  />
                ) : (
                  <span
                    style={{ cursor: 'pointer', borderBottom: '1px dashed #64b5f6' }}
                    onClick={() => startRename(p)}
                    title="Click to rename"
                  >
                    {p.name}
                  </span>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>
                {p.id === 1 ? (
                  <input type="checkbox" checked disabled title="Owner is always included" />
                ) : (
                  <input
                    type="checkbox"
                    checked={!!p.include_in_owner}
                    onChange={() => toggleIncludeInOwner(p)}
                    title="Include in Owner reconciliation and aggregate"
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

      {profiles.length > 1 && (
        <>
          <h3 style={{ marginBottom: '1rem' }}>
            Aggregate Configuration{aggregateConfig.length > 0 ? `: ${aggregateName}` : ''}
          </h3>
          <p style={{ color: '#aaa', marginBottom: '1rem', fontSize: '0.9rem' }}>
            {aggregateConfig.length > 0
              ? 'Edit the name, members, or delete the aggregate portfolio.'
              : 'Create an aggregate portfolio to view combined data from multiple portfolios.'}
          </p>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem', color: '#ccc' }}>Aggregate Name</label>
            <input
              className="dialog-input"
              style={{ width: '300px', padding: '0.4rem 0.5rem' }}
              value={aggNameInput}
              onChange={(e) => setAggNameInput(e.target.value)}
              placeholder="Aggregate"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {profiles.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={aggMembers.includes(p.id)}
                  onChange={() => toggleAggMember(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-primary" onClick={saveAggregateConfig}>
              {aggregateConfig.length > 0 ? 'Save Aggregate Config' : 'Create Aggregate'}
            </button>
            {aggregateConfig.length > 0 && (
              <button className="btn btn-danger" onClick={deleteAggregateConfig}>Delete Aggregate</button>
            )}
          </div>

          {ownerImportUsed && (
            <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #333' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Reconcile Owner</h3>
              <p style={{ color: '#aaa', marginBottom: '1rem', fontSize: '0.9rem' }}>
                Compare Owner (profile 1) against the combined totals of portfolios with "Include" checked above.
                Only checked portfolios will be included. Missing tickers will be added;
                tickers no longer in any included sub-portfolio will be removed.
              </p>
              <button
                className="btn btn-primary"
                onClick={reconcileOwner}
                disabled={reconciling}
              >
                {reconciling ? <><span className="spinner" /> Reconciling...</> : 'Reconcile Owner'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
