import React, { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'

function CategoryModal({ category, onSave, onCancel }) {
  const [name, setName] = useState(category?.name || '')
  const [target, setTarget] = useState(category?.target_pct ?? '')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), target_pct: target !== '' ? parseFloat(target) : null })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onCancel}>&times;</button>
        <h2>{category ? 'Edit Category' : 'New Category'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required maxLength={100} style={{ width: '100%' }} autoFocus />
          </div>
          <div className="form-group">
            <label>Target Allocation %</label>
            <input type="number" step="0.1" min="0" max="100" value={target} onChange={e => setTarget(e.target.value)} placeholder="Optional" style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="submit" className="btn btn-success">{category ? 'Update' : 'Create'}</button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AllocationBar({ categories, totalValue }) {
  if (!totalValue) return null
  const colors = ['#7ecfff', '#00e89a', '#ffc107', '#ff6b6b', '#bb86fc', '#ff8a65', '#4dd0e1', '#aed581', '#f48fb1', '#90a4ae']
  const allocated = categories.reduce((s, c) => s + c.actual_value, 0)
  const unPct = ((totalValue - allocated) / totalValue * 100)
  return (
    <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', background: '#1a1a2e', border: '1px solid #0f3460', marginBottom: '1rem' }}>
      {categories.map((c, i) => {
        const pct = c.actual_pct
        if (pct <= 0) return null
        return (
          <div key={c.id} title={`${c.name}: ${pct.toFixed(1)}%`} style={{
            width: `${pct}%`, background: colors[i % colors.length],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.65rem', fontWeight: 700, color: '#1a1a2e', overflow: 'hidden', whiteSpace: 'nowrap',
          }}>
            {pct > 5 ? `${c.name} ${pct.toFixed(1)}%` : ''}
          </div>
        )
      })}
      {unPct > 0 && (
        <div title={`Unallocated: ${unPct.toFixed(1)}%`} style={{
          width: `${unPct}%`, background: '#455a64',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.65rem', color: '#ccc', overflow: 'hidden',
        }}>
          {unPct > 5 ? `Unallocated ${unPct.toFixed(1)}%` : ''}
        </div>
      )}
    </div>
  )
}

export default function Categories() {
  const [data, setData] = useState({ categories: [], unallocated: [], total_value: 0 })
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editCat, setEditCat] = useState(null)
  const [selectedUnalloc, setSelectedUnalloc] = useState(new Set())
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/categories/data`)
      const d = await res.json()
      setData(d)
    } catch (e) {
      setError('Failed to load categories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const fmt = (v) => v != null ? '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'

  const handleCreate = () => { setEditCat(null); setShowModal(true) }
  const handleEdit = (cat) => { setEditCat(cat); setShowModal(true) }

  const handleSave = async ({ name, target_pct }) => {
    setError(null)
    try {
      if (editCat) {
        await fetch(`${API_BASE}/api/categories/${editCat.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_pct }),
        })
      } else {
        await fetch(`${API_BASE}/api/categories`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_pct }),
        })
      }
      setShowModal(false)
      reload()
    } catch (e) { setError(e.message) }
  }

  const handleDelete = async (cat) => {
    if (!confirm(`Delete category "${cat.name}"? Tickers will become unallocated.`)) return
    await fetch(`${API_BASE}/api/categories/${cat.id}`, { method: 'DELETE' })
    if (expandedId === cat.id) setExpandedId(null)
    reload()
  }

  const handleAssign = async (tickers, categoryId) => {
    await fetch(`${API_BASE}/api/categories/assign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId, tickers }),
    })
    setSelectedUnalloc(new Set())
    reload()
  }

  const handleUnassign = async (tickers) => {
    await fetch(`${API_BASE}/api/categories/unassign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    })
    reload()
  }

  const toggleUnalloc = (ticker) => {
    setSelectedUnalloc(prev => {
      const next = new Set(prev)
      next.has(ticker) ? next.delete(ticker) : next.add(ticker)
      return next
    })
  }

  const handleUnallocClick = (ticker) => {
    if (expandedId) {
      handleAssign([ticker], expandedId)
    } else {
      toggleUnalloc(ticker)
    }
  }

  const allocatedCount = data.categories.reduce((s, c) => s + c.tickers.length, 0)
  const totalCount = allocatedCount + data.unallocated.length
  const allocatedValue = data.categories.reduce((s, c) => s + c.actual_value, 0)
  const allocatedPct = data.total_value ? (allocatedValue / data.total_value * 100) : 0

  const barColor = (cat) => {
    if (cat.target_pct == null) return '#7ecfff'
    const diff = Math.abs(cat.actual_pct - cat.target_pct)
    if (diff <= 3) return '#00e89a'
    if (diff <= 8) return '#ffc107'
    return '#ff6b6b'
  }

  if (loading) return <div className="page" style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Categories</h1>
        <button className="btn btn-success" onClick={handleCreate}>+ New Category</button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Summary strip */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Allocated</span>
            <div style={{ fontWeight: 700, color: '#7ecfff' }}>{allocatedCount} / {totalCount} holdings</div>
          </div>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Allocated Value</span>
            <div style={{ fontWeight: 700, color: '#7ecfff' }}>{fmt(allocatedValue)} ({allocatedPct.toFixed(1)}%)</div>
          </div>
          <div>
            <span style={{ color: '#8899aa', fontSize: '0.75rem' }}>Total Value</span>
            <div style={{ fontWeight: 700, color: '#7ecfff' }}>{fmt(data.total_value)}</div>
          </div>
        </div>
        <AllocationBar categories={data.categories} totalValue={data.total_value} />
      </div>

      {/* Two-panel layout */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

        {/* Left: Category cards */}
        <div style={{ flex: '1 1 70%', minWidth: 0 }}>
          {data.categories.length === 0 && (
            <div className="card"><p style={{ color: '#90a4ae' }}>No categories yet. Create one or import holdings to auto-generate.</p></div>
          )}
          {data.categories.map(cat => {
            const expanded = expandedId === cat.id
            return (
              <div key={cat.id} className="card" style={{ marginBottom: '0.75rem', border: expanded ? '1px solid #1976d2' : undefined }}>
                {/* Header */}
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  onClick={() => setExpandedId(expanded ? null : cat.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                    <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{expanded ? '\u25BC' : '\u25B6'}</span>
                    <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{cat.name}</h2>
                    <span style={{ background: '#0f3460', padding: '0.15rem 0.5rem', borderRadius: 10, fontSize: '0.75rem', color: '#7ecfff' }}>
                      {cat.tickers.length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                    {cat.target_pct != null && (
                      <span style={{ fontSize: '0.8rem', color: '#8899aa' }}>Target: {cat.target_pct.toFixed(1)}%</span>
                    )}
                    <span style={{ fontWeight: 700, color: barColor(cat), fontSize: '0.95rem' }}>
                      {cat.actual_pct.toFixed(1)}%
                    </span>
                    <span style={{ fontSize: '0.85rem', color: '#90a4ae' }}>{fmt(cat.actual_value)}</span>
                  </div>
                </div>

                {/* Allocation bar */}
                <div style={{ height: 6, borderRadius: 3, background: '#1a1a2e', marginTop: '0.5rem', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(cat.actual_pct, 100)}%`, background: barColor(cat), borderRadius: 3, transition: 'width 0.3s' }} />
                </div>

                {/* Expanded: ticker list */}
                {expanded && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <button className="btn btn-primary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); handleEdit(cat) }}>Edit</button>
                      <button className="btn btn-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); handleDelete(cat) }}>Delete</button>
                      {cat.tickers.length > 0 && (
                        <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={(e) => { e.stopPropagation(); handleUnassign(cat.tickers.map(t => t.ticker)) }}>
                          Unassign All
                        </button>
                      )}
                    </div>
                    {cat.tickers.length === 0 ? (
                      <p style={{ color: '#8899aa', fontSize: '0.85rem', fontStyle: 'italic' }}>
                        {expandedId === cat.id ? 'Click a ticker on the right to assign it here' : 'No tickers assigned'}
                      </p>
                    ) : (
                      <table style={{ width: '100%', fontSize: '0.82rem' }}>
                        <thead>
                          <tr>
                            <th>Ticker</th>
                            <th>Description</th>
                            <th style={{ textAlign: 'right' }}>Value</th>
                            <th style={{ textAlign: 'right' }}>% of Category</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat.tickers.map(t => (
                            <tr key={t.ticker}>
                              <td style={{ fontWeight: 600, color: '#64b5f6' }}>{t.ticker}</td>
                              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '-'}</td>
                              <td style={{ textAlign: 'right' }}>{fmt(t.current_value)}</td>
                              <td style={{ textAlign: 'right' }}>{cat.actual_value ? (t.current_value / cat.actual_value * 100).toFixed(1) + '%' : '-'}</td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  style={{ background: 'none', border: 'none', color: '#ef9a9a', cursor: 'pointer', fontSize: '1rem', padding: '0 0.3rem' }}
                                  title="Unassign"
                                  onClick={(e) => { e.stopPropagation(); handleUnassign([t.ticker]) }}
                                >&times;</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Right: Unallocated assets */}
        <div style={{ flex: '0 0 28%', position: 'sticky', top: '1rem' }}>
          <div className="card">
            <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
              Unallocated Assets
              <span style={{ fontSize: '0.8rem', color: '#8899aa', marginLeft: '0.5rem' }}>({data.unallocated.length})</span>
            </h2>

            {expandedId && (
              <p style={{ fontSize: '0.78rem', color: '#00e89a', marginBottom: '0.5rem' }}>
                Click a ticker to assign to the selected category
              </p>
            )}

            {data.unallocated.length === 0 ? (
              <p style={{ color: '#8899aa', fontSize: '0.85rem' }}>All tickers are allocated!</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#64b5f6', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                    onClick={() => setSelectedUnalloc(new Set(data.unallocated.map(t => t.ticker)))}
                  >Select all</button>
                  <span style={{ color: '#455a64' }}>|</span>
                  <button
                    style={{ background: 'none', border: 'none', color: '#64b5f6', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                    onClick={() => setSelectedUnalloc(new Set())}
                  >Clear</button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: '55vh', overflow: 'auto' }}>
                  {data.unallocated.map(t => {
                    const selected = selectedUnalloc.has(t.ticker)
                    return (
                      <button
                        key={t.ticker}
                        onClick={() => handleUnallocClick(t.ticker)}
                        title={`${t.description || t.ticker} — ${fmt(t.current_value)}`}
                        style={{
                          padding: '0.25rem 0.6rem',
                          borderRadius: 14,
                          border: selected ? '1px solid #1976d2' : '1px solid #0f3460',
                          background: selected ? 'rgba(25, 118, 210, 0.2)' : '#1a1a2e',
                          color: selected ? '#90caf9' : '#7ecfff',
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                          transition: 'all 0.15s',
                        }}
                      >
                        {t.ticker}
                      </button>
                    )
                  })}
                </div>

                {!expandedId && selectedUnalloc.size > 0 && data.categories.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ fontSize: '0.8rem', color: '#90a4ae', display: 'block', marginBottom: '0.3rem' }}>
                      Assign {selectedUnalloc.size} selected to:
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {data.categories.map(cat => (
                        <button
                          key={cat.id}
                          className="btn btn-primary"
                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => handleAssign([...selectedUnalloc], cat.id)}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <CategoryModal
          category={editCat}
          onSave={handleSave}
          onCancel={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
