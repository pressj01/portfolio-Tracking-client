import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { formatMoney } from '../utils/money'
import { withSignalFormula } from '../utils/gradingPreferences'
import LotSortHeader from '../components/LotSortHeader'
import {
  GROUP_ORDER_MODES,
  buildSubcategoryTree,
  indentedName,
  moveId,
  nextSort,
  normalizeGroupOrder,
  normalizeSort,
  orderGroups,
  readStoredJson,
  rollUpCategoryTree,
  sharePct,
  sortRows,
  subtreeIds,
  writeStoredJson,
} from '../utils/categoryHierarchy'

const GROUP_ORDER_STORAGE_KEY = 'categories.groupOrder'
const POSITION_SORT_STORAGE_KEY = 'categories.positionSort'

function CategoryModal({ category, onSave, onCancel, targetBaseTotal = 0 }) {
  const [name, setName] = useState(category?.name || '')
  const [target, setTarget] = useState(category?.target_pct ?? '')
  const targetValue = target === '' ? 0 : Number(target)
  const cleanTargetValue = Number.isFinite(targetValue) ? targetValue : 0
  const projectedTotal = targetBaseTotal + cleanTargetValue
  const remaining = 100 - projectedTotal
  const totalColor = projectedTotal > 100 ? '#ff6b6b' : Math.abs(projectedTotal - 100) <= 0.05 ? '#00e89a' : '#ffc107'

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
            <div style={{ marginTop: '0.55rem', border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6, padding: '0.6rem 0.7rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-dim-2)', fontSize: '0.8rem' }}>Total after save</span>
                <strong style={{ color: totalColor }}>{projectedTotal.toFixed(1)}% / 100%</strong>
              </div>
              <div style={{ marginTop: '0.25rem', color: remaining < 0 ? 'var(--p-ffb3b3)' : 'var(--text-muted)', fontSize: '0.78rem' }}>
                {remaining < 0
                  ? `${Math.abs(remaining).toFixed(1)}% over target`
                  : `${remaining.toFixed(1)}% remaining`}
              </div>
            </div>
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

// Columns of the holdings table inside a category / sub-category card. Every
// one but the sub-category picker and the remove button sorts on click.
// pct_l0, pct_l1, … are the shares of each sub-category level above a holding
// (sub-categories nest to any depth).
const POSITION_SORT_KEYS = [
  'ticker', 'description', 'value', 'income', 'freq', 'pct_portfolio', 'pct_category',
  ...Array.from({ length: 20 }, (_, i) => `pct_l${i}`),
]
const POSITION_TEXT_KEYS = ['ticker', 'description', 'freq']
const DEFAULT_POSITION_SORT = { key: 'ticker', direction: 'asc' }
const positionValue = t => Number(t.current_value) || 0
const POSITION_ACCESSORS = {
  ticker: t => t.ticker,
  description: t => t.description || null,
  value: positionValue,
  income: t => Number(t.monthly_income) || 0,
  freq: t => (t.weekly ? 'Weekly' : (t.div_frequency || null)),
  // Within one table every share has the same denominator, so the share
  // columns sort exactly like Value; they are still sortable so any header
  // can be clicked. (The per-level pct_l* keys are added per table.)
  pct_portfolio: positionValue,
  pct_category: positionValue,
}

const fmtShare = (part, whole) => {
  const pct = sharePct(part, whole)
  return pct == null ? '—' : `${pct.toFixed(1)}%`
}

// shareLevels: one "% of" column per level above the holdings — Portfolio,
// the category, then each sub-category down to the one they sit in. Each is
// { key, name, total, tip }.
function TickerTable({ tickers, shareLevels, sort, onSort, onUnassign, fmt, moveTargets = null, onMove = null }) {
  const showMove = moveTargets && moveTargets.length > 0 && onMove
  // The share headers sit on two lines ("% of" over the level) so the table
  // fits beside the Unallocated panel.
  const twoLine = (top, bottom) => (
    <span className="cat-th-two-line">{top}<br /><span className="cat-th-level">{bottom}</span></span>
  )
  const columns = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'description', label: 'Description' },
    { key: 'value', label: 'Value', align: 'right', tip: 'Current market value.' },
    { key: 'income', label: 'Income/mo', display: twoLine('Income', '/mo'), align: 'right', tip: 'Projected monthly income from the shares held now.' },
    { key: 'freq', label: 'Freq', align: 'right', tip: 'How often it pays.' },
    ...shareLevels.map(level => ({
      key: level.key,
      label: `% of ${level.name}`,
      display: twoLine('% of', level.name),
      align: 'right',
      tip: level.tip,
    })),
  ]
  const accessors = { ...POSITION_ACCESSORS }
  shareLevels.forEach(level => { accessors[level.key] = positionValue })
  const rows = sortRows(tickers, sort, accessors)
  // Scrolls sideways inside its card on a narrow window instead of spilling
  // under the Unallocated panel beside it.
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
    <table className="cat-positions-table" style={{ width: '100%', fontSize: '0.82rem' }}>
      <thead>
        <tr>
          {columns.map(column => (
            <LotSortHeader
              key={column.key}
              column={column}
              sort={sort}
              onSort={onSort}
              style={column.align ? { textAlign: column.align } : undefined}
            />
          ))}
          {showMove && <th style={{ textAlign: 'right' }}>Sub-category</th>}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(t => (
          <tr key={t.ticker}>
            <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{t.ticker}</td>
            <td title={t.description || undefined} style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '-'}</td>
            <td style={{ textAlign: 'right' }}>{fmt(t.current_value)}</td>
            <td style={{ textAlign: 'right' }}>{Number(t.monthly_income) > 0 ? fmt(t.monthly_income) : '-'}</td>
            <td style={{ textAlign: 'right', color: t.weekly ? 'var(--pos-bright)' : 'var(--text-dim-2)' }}>{t.weekly ? 'Weekly' : (t.div_frequency || '-')}</td>
            {shareLevels.map(level => (
              <td key={level.key} style={{ textAlign: 'right' }}>{fmtShare(t.current_value, level.total)}</td>
            ))}
            {showMove && (
              <td style={{ textAlign: 'right' }}>
                <select
                  value={t.subcategory_id ?? ''}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); onMove(t.ticker, e.target.value === '' ? null : Number(e.target.value)) }}
                  style={{ maxWidth: 150, fontSize: '0.78rem', padding: '0.15rem 0.3rem', background: 'var(--bg)', color: 'var(--p-cfd8dc)', border: '1px solid var(--border)', borderRadius: 4 }}
                >
                  <option value="">— no sub-category —</option>
                  {moveTargets.map(s => (
                    <option key={s.id} value={s.id}>{indentedName(s)}</option>
                  ))}
                </select>
              </td>
            )}
            <td style={{ textAlign: 'right' }}>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--p-ef9a9a)', cursor: 'pointer', fontSize: '1rem', padding: '0 0.3rem' }}
                title="Remove from category"
                onClick={(e) => { e.stopPropagation(); onUnassign([t.ticker]) }}
              >&times;</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

// subModal: { categoryId, categoryName, parentId, parentName, pathLabel,
// siblings, sub? }. parentName is the category or the sub-category this one
// sits in; its target is a % of that parent.
function SubcategoryModal({ subModal, onSave, onCancel }) {
  const [name, setName] = useState(subModal?.sub?.name || '')
  const [target, setTarget] = useState(subModal?.sub?.target_pct ?? '')
  // A sub-category's target is a % of its parent, and siblings should sum to
  // 100% of that parent. Base = siblings' targets (excluding this one).
  const parentName = subModal?.parentName || subModal?.categoryName
  const siblings = subModal?.siblings || []
  const targetBaseTotal = siblings
    .filter(s => !subModal?.sub || s.id !== subModal.sub.id)
    .reduce((sum, s) => sum + (Number(s.target_pct) || 0), 0)
  const targetValue = target === '' ? 0 : Number(target)
  const cleanTargetValue = Number.isFinite(targetValue) ? targetValue : 0
  const projectedTotal = targetBaseTotal + cleanTargetValue
  const remaining = 100 - projectedTotal
  const totalColor = projectedTotal > 100 ? '#ff6b6b' : Math.abs(projectedTotal - 100) <= 0.05 ? '#00e89a' : '#ffc107'

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), target_pct: target !== '' ? parseFloat(target) : null })
  }
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onCancel}>&times;</button>
        <h2>{subModal?.sub ? 'Edit Sub-category' : 'New Sub-category'}</h2>
        <p style={{ color: 'var(--text-dim-2)', marginTop: '-0.4rem', marginBottom: '0.9rem', fontSize: '0.85rem' }}>
          Inside <strong style={{ color: 'var(--accent-bright)' }}>{subModal?.pathLabel || subModal?.categoryName}</strong>
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required maxLength={100} style={{ width: '100%' }} autoFocus placeholder="e.g. Gold" />
          </div>
          <div className="form-group">
            <label>Target Allocation % (of {parentName})</label>
            <input type="number" step="0.1" min="0" max="100" value={target} onChange={e => setTarget(e.target.value)} placeholder="Optional" style={{ width: '100%' }} />
            <div style={{ marginTop: '0.55rem', border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6, padding: '0.6rem 0.7rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-dim-2)', fontSize: '0.8rem' }}>{parentName} total after save</span>
                <strong style={{ color: totalColor }}>{projectedTotal.toFixed(1)}% / 100%</strong>
              </div>
              <div style={{ marginTop: '0.25rem', color: remaining < 0 ? 'var(--p-ffb3b3)' : 'var(--text-muted)', fontSize: '0.78rem' }}>
                {remaining < 0
                  ? `${Math.abs(remaining).toFixed(1)}% over ${parentName}'s target`
                  : `${remaining.toFixed(1)}% remaining in ${parentName}`}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button type="submit" className="btn btn-success">{subModal?.sub ? 'Save' : 'Create'}</button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const norm = (s) => String(s || '').trim().toLowerCase()

// Move up / Move down for one category or sub-category card. Only active in
// "My order"; in the other orders the list is sorted, so a move would be lost.
function MoveButtons({ name, index, count, enabled, onMove }) {
  const blocked = 'Choose “My order” in Order by to move this by hand.'
  return (
    <span className="cat-move" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="cat-move-btn"
        disabled={!enabled || index <= 0}
        onClick={() => onMove(-1)}
        title={enabled ? `Move ${name} up` : blocked}
        aria-label={`Move ${name} up`}
      >▲</button>
      <button
        type="button"
        className="cat-move-btn"
        disabled={!enabled || index >= count - 1}
        onClick={() => onMove(1)}
        title={enabled ? `Move ${name} down` : blocked}
        aria-label={`Move ${name} down`}
      >▼</button>
    </span>
  )
}
// A sub-category's identity across accounts is its path of names:
// "category›sub›nested sub", compared case-insensitively.
const pathKey = (parts) => parts.map(norm).join('›')
const subPathParts = (catName, node) => [catName, ...(node.path || []).map(p => p.name), node.name]
const ROW_BTN = { padding: '0.2rem 0.5rem', fontSize: '0.75rem' }
const SUB_ROW_BTN = { padding: '0.1rem 0.4rem', fontSize: '0.7rem' }

// Copying is additive by design, so an existing category always wins. Replacing
// one with this account's version is a deliberate two-step: delete it there first.
const REPLACE_HINT = 'To use this account’s version instead, delete the category in that account first, then copy again.'

function CopyCategoriesModal({ pf, categories, sourceName, onCancel, onDone }) {
  const [accounts, setAccounts] = useState(null) // null while loading
  const [loadError, setLoadError] = useState(null)
  const [pickedCats, setPickedCats] = useState(() => new Set(categories.map(c => c.id)))
  const [pickedAccts, setPickedAccts] = useState(() => new Set())
  const [includeSubs, setIncludeSubs] = useState(true)
  const [includeTargets, setIncludeTargets] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    pf('/api/categories/copy-targets')
      .then(async r => {
        // A failed request must not read as "you have no other accounts".
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        if (!live) return
        if (!Array.isArray(d?.accounts)) throw new Error('bad payload')
        setAccounts(d.accounts)
      })
      .catch(() => { if (live) { setAccounts([]); setLoadError('Could not load the other accounts.') } })
    return () => { live = false }
  }, [pf])

  const toggle = (setter) => (id) => setter(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const toggleCat = toggle(setPickedCats)
  const toggleAcct = toggle(setPickedAccts)

  const chosenCats = categories.filter(c => pickedCats.has(c.id))
  const chosenAccts = (accounts || []).filter(a => pickedAccts.has(a.id))

  // What each selected account is missing, so the button never promises work it
  // will not do. Matches the backend: same-named categories are skipped whole,
  // and only missing sub-categories are added underneath them.
  const missingFor = (acct) => {
    const have = new Set((acct.category_names || []).map(norm))
    const haveSubs = new Set((acct.subcategory_keys || []).map(k => pathKey(String(k).split('›'))))
    let cats = 0, subs = 0, skipped = 0
    chosenCats.forEach(c => {
      have.has(norm(c.name)) ? skipped++ : cats++
      if (includeSubs) {
        buildSubcategoryTree(c.subcategories).ordered.forEach(node => {
          if (!haveSubs.has(pathKey(subPathParts(c.name, node)))) subs++
        })
      }
    })
    return { cats, subs, skipped }
  }

  const totals = chosenAccts.reduce((acc, a) => {
    const m = missingFor(a)
    return { cats: acc.cats + m.cats, subs: acc.subs + m.subs, skipped: acc.skipped + m.skipped }
  }, { cats: 0, subs: 0, skipped: 0 })

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
  // Every picked account already has everything picked — copying would be a no-op.
  const nothingToDo = chosenCats.length > 0 && chosenAccts.length > 0 && totals.cats === 0 && totals.subs === 0
  const canSubmit = !busy && chosenCats.length > 0 && chosenAccts.length > 0 && !nothingToDo

  const handleCopy = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await pf('/api/categories/copy-to-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_ids: [...pickedCats],
          target_profile_ids: [...pickedAccts],
          include_subcategories: includeSubs,
          include_targets: includeTargets,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || 'Could not copy the categories.')
        return
      }
      const note = body.categories_skipped > 0 ? `\n\n${REPLACE_HINT}` : ''
      onDone((body.message || 'Categories copied.') + note)
    } catch (e) {
      setError(e.message || 'Could not copy the categories.')
    } finally {
      setBusy(false)
    }
  }

  const paneStyle = {
    border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6,
    maxHeight: 260, overflowY: 'auto', padding: '0.4rem 0.5rem',
  }
  const rowStyle = { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.22rem 0', fontSize: '0.85rem' }
  const headStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }
  const labelStyle = { color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }
  const linkStyle = { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.76rem', padding: 0 }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" style={{ maxWidth: 780 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onCancel}>&times;</button>
        <h2 style={{ marginBottom: '0.35rem' }}>Copy Categories to Accounts</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem', fontSize: '0.85rem' }}>
          Copies the category structure from <strong style={{ color: 'var(--accent-bright)' }}>{sourceName || 'this account'}</strong>.
          No holdings are assigned — you still assign tickers inside each account. Categories that already
          exist there are left exactly as they are.
        </p>

        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px', minWidth: 260 }}>
            <div style={headStyle}>
              <span style={labelStyle}>Categories to copy</span>
              <button style={linkStyle} onClick={() => setPickedCats(
                pickedCats.size === categories.length ? new Set() : new Set(categories.map(c => c.id))
              )}>
                {pickedCats.size === categories.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div style={paneStyle}>
              {categories.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem', padding: '0.4rem 0' }}>
                  This account has no categories yet.
                </div>
              )}
              {categories.map(c => (
                <div key={c.id}>
                  <label style={{ ...rowStyle, cursor: 'pointer' }}>
                    <input type="checkbox" checked={pickedCats.has(c.id)} onChange={() => toggleCat(c.id)} />
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    {c.target_pct != null && (
                      <span style={{ color: 'var(--text-dim-2)', fontSize: '0.74rem' }}>
                        target {Number(c.target_pct).toFixed(1)}%
                      </span>
                    )}
                  </label>
                  {includeSubs && buildSubcategoryTree(c.subcategories).ordered.map(s => (
                    <div key={s.id} style={{
                      ...rowStyle, paddingLeft: `${1.7 + s.depth}rem`, fontSize: '0.78rem',
                      color: pickedCats.has(c.id) ? 'var(--text-muted)' : 'var(--text-dim-2)',
                    }}>
                      <span>&rsaquo; {s.name}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: '1 1 300px', minWidth: 260 }}>
            <div style={headStyle}>
              <span style={labelStyle}>Copy into accounts</span>
              {accounts?.length > 0 && (
                <button style={linkStyle} onClick={() => setPickedAccts(
                  pickedAccts.size === accounts.length ? new Set() : new Set(accounts.map(a => a.id))
                )}>
                  {pickedAccts.size === accounts.length ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>
            <div style={paneStyle}>
              {accounts === null && <div style={{ padding: '0.6rem 0', textAlign: 'center' }}><span className="spinner" /></div>}
              {loadError && <div style={{ color: 'var(--neg)', fontSize: '0.84rem', padding: '0.4rem 0' }}>{loadError}</div>}
              {accounts?.length === 0 && !loadError && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem', padding: '0.4rem 0' }}>
                  There are no other accounts to copy into.
                </div>
              )}
              {(accounts || []).map(a => {
                const m = missingFor(a)
                return (
                  <label key={a.id} style={{ ...rowStyle, cursor: 'pointer', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                      <input type="checkbox" checked={pickedAccts.has(a.id)} onChange={() => toggleAcct(a.id)} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
                    </span>
                    {chosenCats.length > 0 && (
                      <span style={{ fontSize: '0.74rem', whiteSpace: 'nowrap', display: 'flex', gap: '0.4rem' }}>
                        {m.cats > 0 && <span style={{ color: 'var(--amber)' }}>+{m.cats} new</span>}
                        {m.cats > 0 && m.skipped > 0 && <span style={{ color: 'var(--text-dim-2)' }}>·</span>}
                        {m.skipped > 0 && (
                          <span style={{ color: 'var(--text-dim-2)' }}>
                            {m.cats > 0 ? `${m.skipped} already there` : `already has all ${m.skipped}`}
                          </span>
                        )}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', margin: '0.9rem 0 0.6rem' }}>
          <label style={{ ...rowStyle, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeSubs} onChange={e => setIncludeSubs(e.target.checked)} />
            Include sub-categories
          </label>
          <label style={{ ...rowStyle, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeTargets} onChange={e => setIncludeTargets(e.target.checked)} />
            <span>
              Include target %
              <span style={{ color: 'var(--text-dim-2)', fontSize: '0.75rem' }}>
                {' '}— off means new categories arrive with no target
              </span>
            </span>
          </label>
        </div>

        <div style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 6, padding: '0.6rem 0.7rem', fontSize: '0.84rem' }}>
          {chosenCats.length === 0 || chosenAccts.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>Pick at least one category and one account.</span>
          ) : nothingToDo ? (
            <>
              <div style={{ color: 'var(--pos-bright)', fontWeight: 600 }}>
                {plural(chosenAccts.length, 'account', 'accounts')} already {chosenAccts.length === 1 ? 'has' : 'have'} every category you picked — nothing to copy.
              </div>
              <div style={{ color: 'var(--text-muted)', marginTop: '0.3rem' }}>{REPLACE_HINT}</div>
            </>
          ) : (
            <>
              <div style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>
                Creates {plural(totals.cats, 'category', 'categories')}
                {includeSubs && ` and ${plural(totals.subs, 'sub-category', 'sub-categories')}`}
                {' '}across {plural(chosenAccts.length, 'account', 'accounts')}.
              </div>
              {totals.skipped > 0 && (
                <div style={{ color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  {plural(totals.skipped, 'category', 'categories')} already {totals.skipped === 1 ? 'exists' : 'exist'} in {chosenAccts.length === 1 ? 'that account' : 'those accounts'} and will be skipped —
                  {totals.skipped === 1 ? ' it keeps its' : ' they keep their'} own target %, sub-categories and holdings. Nothing is overwritten or removed. {REPLACE_HINT}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <button className="btn btn-success" onClick={handleCopy} disabled={!canSubmit}>
            {busy ? 'Copying…' : 'Copy Categories'}
          </button>
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function QualityDetailsModal({ row, onClose, fmt, fmtPct }) {
  if (!row) return null
  const tickers = row.quality?.tickers || []
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 820 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2 style={{ marginBottom: '0.35rem' }}>{row.name} Quality Details</h2>
        <p style={{ color: 'var(--text-dim-2)', marginBottom: '1rem' }}>
          Score {row.quality.score} {row.quality.label} based on the suggested {fmtPct(row.suggested_pct)} allocation.
        </p>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.86rem' }}>
          Confirmed NAV risk means the ticker has a high benchmark-adjusted NAV ratio. NAV-monitor tickers are products the app keeps an eye on for NAV erosion, but they are not scored as high NAV risk unless that ratio is above the high-risk threshold.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
          {(row.quality.reasons || []).map(reason => (
            <span key={reason} style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', borderRadius: 4, padding: '0.25rem 0.45rem', fontSize: '0.78rem', fontWeight: 700 }}>
              {reason}
            </span>
          ))}
        </div>
        {tickers.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No individual ticker is driving a quality flag at this suggested allocation.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="pb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Ticker</th>
                  <th style={{ textAlign: 'left' }}>Drivers</th>
                  <th>Portfolio</th>
                  <th>Category</th>
                  <th>Income Share</th>
                  <th>Yield</th>
                  <th>Gain/Loss</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {tickers.map(ticker => (
                  <tr key={ticker.ticker}>
                    <td style={{ textAlign: 'left', fontWeight: 700, color: 'var(--accent-bright)' }}>{ticker.ticker}</td>
                    <td style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{ticker.drivers.join('; ')}</td>
                    <td>{fmtPct(ticker.portfolio_pct)}</td>
                    <td>{fmtPct(ticker.category_pct)}</td>
                    <td>{fmtPct(ticker.income_share_pct)}</td>
                    <td>{fmtPct(ticker.yield_pct)}</td>
                    <td style={{ color: ticker.gain_loss_pct < -10 ? 'var(--neg)' : 'var(--text-muted)' }}>{fmtPct(ticker.gain_loss_pct)}</td>
                    <td>{fmt(ticker.current_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
    <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--border)', marginBottom: '1rem' }}>
      {categories.map((c, i) => {
        const pct = c.actual_pct
        if (pct <= 0) return null
        return (
          <div key={c.id} title={`${c.name}: ${pct.toFixed(1)}%`} style={{
            width: `${pct}%`, background: colors[i % colors.length],
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.65rem', fontWeight: 700, color: 'var(--bg)', overflow: 'hidden', whiteSpace: 'nowrap',
          }}>
            {pct > 5 ? `${c.name} ${pct.toFixed(1)}%` : ''}
          </div>
        )
      })}
      {unPct > 0 && (
        <div title={`Unallocated: ${unPct.toFixed(1)}%`} style={{
          width: `${unPct}%`, background: 'var(--secondary-solid)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.65rem', color: 'var(--p-ccc)', overflow: 'hidden',
        }}>
          {unPct > 5 ? `Unallocated ${unPct.toFixed(1)}%` : ''}
        </div>
      )}
    </div>
  )
}

function OwnerTargetReference({ reference, fmt, fmtPct }) {
  if (!reference?.is_owner || !reference.profiles?.length) return null

  const accounts = reference.profiles || []
  const rows = reference.rows || []
  const accountsWithTargets = accounts.filter(account => account.has_targets).length
  const targetCoverageValue = accounts
    .filter(account => account.has_targets)
    .reduce((sum, account) => sum + Number(account.total_value || 0), 0)

  return (
    <div className="card owner-target-reference">
      <div className="owner-target-header">
        <div>
          <h2>Subaccount Target Reference</h2>
          <div className="owner-target-meta">
            <span>{accounts.length} included accounts</span>
            <span>{accountsWithTargets} with targets</span>
            <span>{fmt(targetCoverageValue)} targeted value</span>
            {reference.weighted_total_pct != null && (
              <span>Guide total {fmtPct(reference.weighted_total_pct)}</span>
            )}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="alert alert-info" style={{ margin: 0 }}>
          Included subaccounts do not have category targets set yet.
        </div>
      ) : (
        <div className="pb-table-wrap" style={{ marginBottom: 0 }}>
          <table className="pb-table owner-target-table">
            <thead>
              <tr>
                <th>Category</th>
                {accounts.map(account => (
                  <th key={account.id}>
                    <span>{account.name}</span>
                    <small>{fmt(account.total_value)}</small>
                  </th>
                ))}
                <th>
                  <span>Weighted Owner Guide</span>
                  <small>by account value</small>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  {accounts.map(account => {
                    const target = row.targets?.[account.id]
                    return (
                      <td key={account.id} className={target == null ? 'owner-target-empty' : ''}>
                        {target == null ? '-' : fmtPct(target)}
                      </td>
                    )
                  })}
                  <td className="owner-target-guide">
                    {row.weighted_guide_pct == null ? '-' : fmtPct(row.weighted_guide_pct)}
                    {row.missing_profile_ids?.length > 0 && (
                      <small title="One or more included accounts do not have a target for this category">
                        partial
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ConstraintSlider({ label, value, min, max, step = 1, unit = '%', prefix = '', onChange, help, numeric = false }) {
  const display = `${prefix}${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: step < 1 ? 1 : 0 })}${unit}`
  const handleChange = (e) => onChange(Number(e.target.value))
  const handleNumberChange = (e) => {
    const next = Math.max(min, Number(e.target.value || 0))
    onChange(next)
  }
  return (
    <label className="cat-constraint">
      <span className="cat-constraint-top">
        <span>{label}</span>
        {numeric ? (
          <span className="cat-constraint-number-wrap">
            {prefix && <span>{prefix}</span>}
            <input
              type="number"
              min={min}
              step={step}
              value={value}
              onChange={handleNumberChange}
              onClick={e => e.stopPropagation()}
            />
            {unit && <span>{unit}</span>}
          </span>
        ) : (
          <strong>{display}</strong>
        )}
      </span>
      <input
        type="range"
        min={min}
        max={Math.max(max, Number(value || 0))}
        step={step}
        value={Math.min(Number(value || 0), Math.max(max, Number(value || 0)))}
        onInput={handleChange}
        onChange={handleChange}
      />
      {help && <span className="cat-constraint-help">{help}</span>}
    </label>
  )
}

function enrichCategoryData(categoryData, holdings = [], navCoverage = null) {
  const activeHoldings = holdings.filter(h => Number(h.quantity || 0) > 0)
  const holdingMap = Object.fromEntries(activeHoldings.map(h => [String(h.ticker || '').toUpperCase(), h]))
  const navCoverageMap = Object.fromEntries((navCoverage?.results || []).map(row => [
    String(row.ticker || '').toUpperCase(),
    row,
  ]))
  const totalValue = Number(categoryData.total_value || 0) || activeHoldings.reduce((s, h) => s + Number(h.current_value || 0), 0)
  const totalMonthlyIncome = activeHoldings.reduce((s, h) => s + Number(h.approx_monthly_income || 0), 0)
  const totalAnnualIncome = activeHoldings.reduce((s, h) => s + Number(h.estim_payment_per_year || 0), 0) || totalMonthlyIncome * 12
  const isWeekly = (freq) => ['W', '52', 'WEEKLY'].includes(String(freq || '').trim().toUpperCase())
  const weeklyValue = activeHoldings.reduce((s, h) => s + (isWeekly(h.div_frequency) ? Number(h.current_value || 0) : 0), 0)
  const weeklyIncome = activeHoldings.reduce((s, h) => s + (isWeekly(h.div_frequency) ? Number(h.approx_monthly_income || 0) : 0), 0)

  const enrichTicker = (tickerRow) => {
    const key = String(tickerRow.ticker || '').toUpperCase()
    const holding = holdingMap[key] || {}
    const value = Number(tickerRow.current_value ?? holding.current_value ?? 0)
    const monthlyIncome = Number(tickerRow.monthly_income ?? holding.approx_monthly_income ?? 0)
    const freq = tickerRow.div_frequency ?? holding.div_frequency
    const navMeta = navCoverageMap[key] || {}
    const navCoverageRatio = Number(navMeta.coverage_ratio)
    const hasNavCoverageRatio = Number.isFinite(navCoverageRatio)
    const navScope = String(tickerRow.nav_erosion_scope ?? holding.nav_erosion_scope ?? 'auto').trim().toLowerCase()
    const navCandidate = Boolean(tickerRow.nav_risk) || navScope === 'test' || Boolean(navMeta.nav_tested)
    return {
      ...tickerRow,
      classification_type: tickerRow.classification_type ?? holding.classification_type,
      current_value: value,
      monthly_income: monthlyIncome,
      current_yield: value > 0 ? monthlyIncome * 12 / value * 100 : 0,
      div_frequency: freq,
      weekly: tickerRow.weekly ?? isWeekly(freq),
      nav_erosion_scope: tickerRow.nav_erosion_scope ?? holding.nav_erosion_scope,
      nav_candidate: navCandidate,
      nav_coverage_ratio: hasNavCoverageRatio ? navCoverageRatio : null,
      nav_tested: Boolean(navMeta.nav_tested),
      nav_benchmark: navMeta.benchmark,
      nav_risk: hasNavCoverageRatio && navCoverageRatio > 0.75,
      gain_or_loss_percentage: Number(tickerRow.gain_or_loss_percentage ?? holding.gain_or_loss_percentage ?? 0),
    }
  }

  const categories = (categoryData.categories || []).map(cat => {
    const tickers = (cat.tickers || []).map(enrichTicker)
    const catValue = tickers.reduce((s, t) => s + Number(t.current_value || 0), 0)
    const catMonthlyIncome = tickers.reduce((s, t) => s + Number(t.monthly_income || 0), 0)
    const catWeeklyValue = tickers.reduce((s, t) => s + (t.weekly ? Number(t.current_value || 0) : 0), 0)
    const catWeeklyIncome = tickers.reduce((s, t) => s + (t.weekly ? Number(t.monthly_income || 0) : 0), 0)
    const catNavRiskValue = tickers.reduce((s, t) => s + (t.nav_risk ? Number(t.current_value || 0) : 0), 0)
    const largestHoldingPct = catValue > 0 ? Math.max(0, ...tickers.map(t => Number(t.current_value || 0))) / catValue * 100 : 0
    const incomeConcentrationPct = catMonthlyIncome > 0 ? Math.max(0, ...tickers.map(t => Number(t.monthly_income || 0))) / catMonthlyIncome * 100 : 0
    const weightedGainLoss = catValue > 0
      ? tickers.reduce((s, t) => s + Number(t.gain_or_loss_percentage || 0) * Number(t.current_value || 0), 0) / catValue
      : 0
    // Sub-categories stay a flat list (tree order, with parent_id); the page
    // rolls holdings up the tree when it renders, so a move shows at once.
    return {
      ...cat,
      tickers,
      subcategories: cat.subcategories || [],
      actual_value: catValue || Number(cat.actual_value || 0),
      actual_pct: totalValue ? (catValue || Number(cat.actual_value || 0)) / totalValue * 100 : 0,
      monthly_income: catMonthlyIncome,
      current_yield: catValue > 0 ? catMonthlyIncome * 12 / catValue * 100 : 0,
      weekly_value: catWeeklyValue,
      weekly_income: catWeeklyIncome,
      weekly_value_pct: catValue > 0 ? catWeeklyValue / catValue * 100 : 0,
      nav_risk_value_pct: catValue > 0 ? catNavRiskValue / catValue * 100 : 0,
      nav_risk_count: tickers.filter(t => t.nav_risk).length,
      largest_holding_pct: largestHoldingPct,
      income_concentration_pct: incomeConcentrationPct,
      weighted_gain_loss_pct: weightedGainLoss,
    }
  })

  const assigned = new Set(categories.flatMap(cat => cat.tickers.map(t => String(t.ticker || '').toUpperCase())))
  const unallocatedFromHoldings = activeHoldings
    .filter(h => !assigned.has(String(h.ticker || '').toUpperCase()))
    .map(h => enrichTicker({ ticker: h.ticker, description: h.description, current_value: h.current_value }))
  const unallocated = (categoryData.unallocated || []).length
    ? categoryData.unallocated.map(enrichTicker)
    : unallocatedFromHoldings

  return {
    ...categoryData,
    categories,
    unallocated,
    total_value: totalValue,
    monthly_income: totalMonthlyIncome,
    portfolio_yield: totalValue > 0 ? totalAnnualIncome / totalValue * 100 : 0,
    weekly_value: weeklyValue,
    weekly_income: weeklyIncome,
    weekly_value_pct: totalValue > 0 ? weeklyValue / totalValue * 100 : 0,
  }
}

export default function Categories() {
  const pf = useProfileFetch()
  const { selection, profileId, isAggregate, currentProfileName, profiles } = useProfile()
  const dialog = useDialog()
  const navigate = useNavigate()
  const [data, setData] = useState({ categories: [], unallocated: [], total_value: 0 })
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  // Open sub-category rows (any depth), and the one click-to-assign targets.
  const [expandedSubIds, setExpandedSubIds] = useState(() => new Set())
  const [activeSubId, setActiveSubId] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editCat, setEditCat] = useState(null)
  const [subModal, setSubModal] = useState(null) // see SubcategoryModal
  const [selectedUnalloc, setSelectedUnalloc] = useState(new Set())
  const [error, setError] = useState(null)
  const [assistantMode, setAssistantMode] = useState('balanced')
  const [qualityDetail, setQualityDetail] = useState(null)
  const [constraints, setConstraints] = useState({
    minimumMonthlyIncome: 0,
    maxCategoryPct: 35,
    maxHighYieldCategoryPct: 18,
    maxAllowedDrift: 8,
    minimumAnchorAllocation: 30,
    incomeGrowthPriority: 50,
  })
  const [constraintsSeeded, setConstraintsSeeded] = useState(false)
  const [incomeFloorTouched, setIncomeFloorTouched] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  // A new category sorts to the bottom, well below the fold on this page, so
  // creating one changed nothing on screen and read as "nothing happened yet".
  const [pendingFocusName, setPendingFocusName] = useState(null)
  const [flashId, setFlashId] = useState(null)
  const catRefs = useRef({})
  const reloadSeq = useRef(0)
  // How the category / sub-category cards are listed, and how the holdings
  // inside them are sorted. Both are remembered per viewer.
  const [groupOrder, setGroupOrder] = useState(() => normalizeGroupOrder(readStoredJson(GROUP_ORDER_STORAGE_KEY, null)))
  const [positionSort, setPositionSort] = useState(() => normalizeSort(
    readStoredJson(POSITION_SORT_STORAGE_KEY, null),
    POSITION_SORT_KEYS,
    DEFAULT_POSITION_SORT,
  ))
  // Order saves run one after another, so two quick clicks can't land on the
  // server in the wrong order and leave the older order saved.
  const orderSaveChain = useRef(Promise.resolve())
  const isOwnerProfile = !isAggregate && Number(profileId) === 1
  // "Copy to Accounts" only makes sense when there is somewhere else to copy into.
  const hasOtherAccounts = (profiles?.length || 0) > 1

  // /api/holdings and /api/portfolio-coverage are per-ticker market data costing
  // tens of seconds, and no category edit can change them. Cache them per
  // selection so a create/delete/assign only waits on /api/categories/data.
  const marketCache = useRef({ selection: null, holdings: [], navCoverage: null })

  const reload = useCallback(async ({ refreshMarketData = true } = {}) => {
    const seq = reloadSeq.current + 1
    reloadSeq.current = seq
    if (isAggregate) {
      setData({ categories: [], unallocated: [], total_value: 0, _selection: selection })
      setError(null)
      setLoading(false)
      return
    }
    const cached = marketCache.current
    const useCache = !refreshMarketData && cached.selection === selection
    try {
      const [catRes, holdingsRes, navCoverageRes, ownerTargetRefRes] = await Promise.all([
        pf('/api/categories/data'),
        useCache ? null : pf('/api/holdings').catch(() => null),
        useCache ? null : pf(withSignalFormula('/api/portfolio-coverage')).catch(() => null),
        isOwnerProfile ? pf('/api/categories/owner-target-reference').catch(() => null) : Promise.resolve(null),
      ])
      const d = await catRes.json()
      const holdings = useCache
        ? cached.holdings
        : (holdingsRes ? await holdingsRes.json() : [])
      const navCoverage = useCache
        ? cached.navCoverage
        : (navCoverageRes ? await navCoverageRes.json() : null)
      const ownerTargetReference = ownerTargetRefRes ? await ownerTargetRefRes.json() : null
      if (seq !== reloadSeq.current) return
      const safeHoldings = Array.isArray(holdings) ? holdings : []
      if (!useCache) marketCache.current = { selection, holdings: safeHoldings, navCoverage }
      setData({
        ...enrichCategoryData(d, safeHoldings, navCoverage),
        owner_target_reference: ownerTargetReference,
        _selection: selection,
      })
      setError(null)
    } catch (e) {
      if (seq === reloadSeq.current) setError('Failed to load categories')
    } finally {
      if (seq === reloadSeq.current) setLoading(false)
    }
  }, [pf, selection, isOwnerProfile, isAggregate])

  useEffect(() => { reload() }, [reload, selection])

  // Bring a freshly created category into view and flash it, so the create is
  // visible even though it sorts to the bottom of a long page.
  useEffect(() => {
    if (!pendingFocusName) return
    const created = data.categories.find(c => norm(c.name) === norm(pendingFocusName))
    if (!created) return
    setPendingFocusName(null)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    catRefs.current[created.id]?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
    })
    setFlashId(created.id)
    const timer = setTimeout(() => setFlashId(null), 2000)
    return () => clearTimeout(timer)
  }, [data.categories, pendingFocusName])

  useEffect(() => {
    setConstraintsSeeded(false)
    setIncomeFloorTouched(false)
  }, [selection])

  useEffect(() => {
    if (data._selection !== selection || constraintsSeeded || incomeFloorTouched || !data.monthly_income) return
    setConstraints(prev => ({
      ...prev,
      minimumMonthlyIncome: Math.floor(Number(data.monthly_income || 0)),
    }))
    setConstraintsSeeded(true)
  }, [constraintsSeeded, incomeFloorTouched, data.monthly_income, data._selection, selection])

  const fmt = (v) => formatMoney(v, { fallback: '-' })
  const fmtPct = (v) => Number(v || 0).toFixed(1) + '%'
  const setConstraint = (key, value) => {
    if (key === 'minimumMonthlyIncome') {
      setIncomeFloorTouched(true)
      setConstraintsSeeded(true)
    }
    setConstraints(prev => ({ ...prev, [key]: value }))
  }
  const incomeSliderMax = Math.max(
    500,
    Math.ceil(Number(data.monthly_income || 0) * 2 / 50) * 50,
    Math.ceil(Number(constraints.minimumMonthlyIncome || 0) * 1.5 / 50) * 50,
  )

  const handleCreate = () => { setEditCat(null); setShowModal(true) }
  const handleEdit = (cat) => { setEditCat(cat); setShowModal(true) }

  // These writes used to ignore the response, so a rejected save or delete was
  // indistinguishable from one that succeeded and changed nothing.
  const mutate = async (path, options) => {
    const res = await pf(path, options)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Request failed (${res.status})`)
    }
    return res
  }

  const changeGroupOrder = (mode) => {
    const next = normalizeGroupOrder(mode)
    setGroupOrder(next)
    writeStoredJson(GROUP_ORDER_STORAGE_KEY, next)
  }

  const sortPositions = (key) => {
    setPositionSort(prev => {
      const next = nextSort(prev, key, { textKeys: POSITION_TEXT_KEYS })
      writeStoredJson(POSITION_SORT_STORAGE_KEY, next)
      return next
    })
  }

  // Shows the new order at once, then saves it. A failed save says so and
  // reloads, so the screen never shows an order the server doesn't have.
  const saveOrder = (path, order) => {
    const run = orderSaveChain.current.then(() => mutate(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    }))
    orderSaveChain.current = run.catch(() => {})
    return run.catch(async (e) => {
      setError(e.message || 'Could not save the new order.')
      await reload({ refreshMarketData: false })
    })
  }

  const handleMoveCategory = (catId, delta) => {
    const order = moveId(data.categories.map(c => c.id), catId, delta)
    if (!order) return
    setError(null)
    setData(prev => {
      const byId = new Map(prev.categories.map(c => [c.id, c]))
      return { ...prev, categories: order.map(id => byId.get(id)).filter(Boolean) }
    })
    saveOrder('/api/categories/reorder', order)
  }

  // Moves a sub-category among its siblings (same parent).
  const handleMoveSub = (catId, node, delta) => {
    const tree = catTrees.get(catId)
    if (!tree) return
    const siblings = node.parent_id == null
      ? tree.roots
      : (tree.byId.get(String(node.parent_id))?.children || [])
    const order = moveId(siblings.map(s => s.id), node.id, delta)
    if (!order) return
    const rank = new Map(order.map((id, i) => [String(id), i]))
    setError(null)
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => (c.id !== catId ? c : {
        ...c,
        subcategories: (c.subcategories || []).map(s => (
          rank.has(String(s.id)) ? { ...s, sort_order: rank.get(String(s.id)) } : s
        )),
      })),
    }))
    saveOrder(`/api/categories/${catId}/subcategories/reorder`, order)
  }

  const handleSave = async ({ name, target_pct }) => {
    if (isAggregate) {
      setError('Select an individual account before editing categories.')
      return
    }
    setError(null)
    if (target_pct != null) {
      const otherTotal = data.categories
        .filter(c => !editCat || c.id !== editCat.id)
        .reduce((s, c) => s + (Number(c.target_pct) || 0), 0)
      if (otherTotal + target_pct > 100) {
        setError(`Target allocation would total ${(otherTotal + target_pct).toFixed(1)}% — cannot exceed 100%. Available: ${(100 - otherTotal).toFixed(1)}%`)
        return
      }
    }
    try {
      if (editCat) {
        await mutate(`/api/categories/${editCat.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_pct }),
        })
      } else {
        await mutate('/api/categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_pct }),
        })
      }
      setShowModal(false)
      if (!editCat) setPendingFocusName(name)
      await reload({ refreshMarketData: false })
    } catch (e) { setError(e.message || 'Could not save the category.') }
  }

  const handleDelete = async (cat) => {
    if (isAggregate) {
      setError('Select an individual account before editing categories.')
      return
    }
    const subCount = (cat.subcategories || []).length
    const detail = subCount > 0
      ? ` Its ${subCount} sub-${subCount === 1 ? 'category' : 'categories'} are removed too, and its ${cat.tickers.length} holdings become unallocated.`
      : ` Its ${cat.tickers.length} holdings become unallocated.`
    if (!await dialog.confirm(`Delete category "${cat.name}"?${detail}`)) return
    setError(null)
    try {
      await mutate(`/api/categories/${cat.id}`, { method: 'DELETE' })
    } catch (e) {
      setError(e.message || 'Could not delete the category.')
      return
    }
    if (expandedId === cat.id) setExpandedId(null)
    await reload({ refreshMarketData: false })
  }

  const handleAssign = async (tickers, categoryId, subcategoryId = null) => {
    if (isAggregate) {
      setError('Select an individual account before assigning categories.')
      return
    }
    await pf('/api/categories/assign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId, subcategory_id: subcategoryId, tickers }),
    })
    setSelectedUnalloc(new Set())
    await reload({ refreshMarketData: false })
  }

  const handleSaveSub = async ({ name, target_pct }) => {
    if (isAggregate) {
      setError('Select an individual account before editing sub-categories.')
      return
    }
    if (!subModal) return
    setError(null)
    if (target_pct != null) {
      const otherTotal = (subModal.siblings || [])
        .filter(s => !subModal.sub || s.id !== subModal.sub.id)
        .reduce((sum, s) => sum + (Number(s.target_pct) || 0), 0)
      if (otherTotal + target_pct > 100) {
        const parentName = subModal.parentName || subModal.categoryName
        setError(`Sub-category targets in ${parentName} would total ${(otherTotal + target_pct).toFixed(1)}% — cannot exceed 100% of ${parentName}. Available: ${(100 - otherTotal).toFixed(1)}%`)
        return
      }
    }
    try {
      if (subModal.sub) {
        await mutate(`/api/subcategories/${subModal.sub.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_pct }),
        })
      } else {
        await mutate(`/api/categories/${subModal.categoryId}/subcategories`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, target_pct, parent_id: subModal.parentId ?? null }),
        })
        // Open the parent so the new sub-category is visible straight away.
        if (subModal.parentId != null) {
          setExpandedSubIds(prev => new Set(prev).add(subModal.parentId))
        }
      }
      setSubModal(null)
      await reload({ refreshMarketData: false })
    } catch (e) { setError(e.message || 'Could not save the sub-category.') }
  }

  const handleCopied = async (message) => {
    setShowCopyModal(false)
    setError(null)
    await dialog.alert(message)
  }

  const handleDeleteSub = async (cat, node) => {
    if (isAggregate) {
      setError('Select an individual account before editing sub-categories.')
      return
    }
    const branch = subtreeIds(node)
    const nested = branch.size - 1
    const holdings = (node.all || []).length
    const parentName = node.path?.length ? node.path[node.path.length - 1].name : cat.name
    const parts = [`Delete sub-category "${node.name}"?`]
    if (nested > 0) parts.push(`The ${nested} sub-${nested === 1 ? 'category' : 'categories'} inside it ${nested === 1 ? 'is' : 'are'} deleted too.`)
    parts.push(holdings > 0
      ? `Its ${holdings} holding${holdings === 1 ? '' : 's'} move${holdings === 1 ? 's' : ''} up to ${parentName}.`
      : 'It has no holdings.')
    if (!await dialog.confirm(parts.join(' '))) return
    setError(null)
    try {
      await mutate(`/api/subcategories/${node.id}`, { method: 'DELETE' })
    } catch (e) {
      setError(e.message || 'Could not delete the sub-category.')
      return
    }
    setExpandedSubIds(prev => new Set([...prev].filter(id => !branch.has(String(id)))))
    if (activeSubId != null && branch.has(String(activeSubId))) setActiveSubId(node.parent_id ?? null)
    await reload({ refreshMarketData: false })
  }

  const handleUnassign = async (tickers) => {
    if (isAggregate) {
      setError('Select an individual account before assigning categories.')
      return
    }
    await pf('/api/categories/unassign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    })
    await reload({ refreshMarketData: false })
  }

  const toggleUnalloc = (ticker) => {
    setSelectedUnalloc(prev => {
      const next = new Set(prev)
      next.has(ticker) ? next.delete(ticker) : next.add(ticker)
      return next
    })
  }

  // Each category's sub-categories as a tree, with holdings rolled up every
  // level (value and projected income per branch).
  const catTrees = useMemo(
    () => new Map(data.categories.map(c => [c.id, rollUpCategoryTree(c.subcategories, c.tickers)])),
    [data.categories],
  )
  const subPathLabel = (cat, node) => [cat.name, ...(node.path || []).map(p => p.name), node.name].join(' › ')

  // Opening a sub-category makes it the click-to-assign target; closing one
  // closes everything inside it too.
  const toggleSub = (node) => {
    if (expandedSubIds.has(node.id)) {
      const branch = subtreeIds(node)
      setExpandedSubIds(prev => new Set([...prev].filter(id => !branch.has(String(id)))))
      if (activeSubId != null && branch.has(String(activeSubId))) {
        setActiveSubId(node.parent_id != null && expandedSubIds.has(node.parent_id) ? node.parent_id : null)
      }
    } else {
      setExpandedSubIds(prev => new Set(prev).add(node.id))
      setActiveSubId(node.id)
    }
  }

  // The currently targeted bucket for click-to-assign: the active open
  // sub-category (any depth), otherwise the open category itself.
  const expandedCat = data.categories.find(c => c.id === expandedId)
  const assignTarget = (() => {
    if (!expandedCat) return null
    const node = activeSubId != null ? catTrees.get(expandedCat.id)?.byId.get(String(activeSubId)) : null
    if (node) return { categoryId: expandedCat.id, subId: node.id, label: subPathLabel(expandedCat, node) }
    return { categoryId: expandedCat.id, subId: null, label: `${expandedCat.name} (no sub-category)` }
  })()

  // Flat list of valid assignment targets for the bulk-assign buttons.
  const assignmentTargets = data.categories.flatMap(cat => {
    const nodes = catTrees.get(cat.id)?.ordered || []
    return [
      { categoryId: cat.id, subId: null, label: nodes.length ? `${cat.name} (no sub-category)` : cat.name },
      ...nodes.map(n => ({ categoryId: cat.id, subId: n.id, label: subPathLabel(cat, n) })),
    ]
  })

  const tableBase = { sort: positionSort, onSort: sortPositions, onUnassign: handleUnassign, fmt }

  // "% of" columns for a holdings table: Portfolio, the category, then each
  // sub-category down to the one the holdings sit in.
  const shareLevelsFor = (cat, nodes) => [
    { key: 'pct_portfolio', name: 'Portfolio', total: data.total_value, tip: 'Share of the whole portfolio value.' },
    { key: 'pct_category', name: cat.name, total: cat.actual_value, tip: `Share of the ${cat.name} category.` },
    ...nodes.map((n, i) => ({ key: `pct_l${i}`, name: n.name, total: n.value, tip: `Share of the ${n.name} sub-category.` })),
  ]

  const branchOrder = nodes => orderGroups(nodes, groupOrder, { valueKey: 'value', incomeKey: 'income' })

  // One sub-category row, at any depth: its labeled share of the portfolio,
  // of the category and of every sub-category above it, plus value and
  // projected income for its whole branch. Open, it lists the sub-categories
  // inside it and the holdings sitting directly in it.
  const renderSubNode = (cat, tree, node, siblings, index) => {
    const isOpen = expandedSubIds.has(node.id)
    const isActive = isOpen && activeSubId === node.id
    const children = branchOrder(node.children)
    const ancestors = node.path || []
    const parent = ancestors.length ? ancestors[ancestors.length - 1] : null
    const parentName = parent ? parent.name : cat.name
    const incomeShare = sharePct(node.income, parent ? parent.income : cat.monthly_income)
    const portfolioPct = sharePct(node.value, data.total_value)
    const upperShares = [
      { key: `c${cat.id}`, label: cat.name, pct: sharePct(node.value, cat.actual_value) },
      ...ancestors.map(a => ({ key: `s${a.id}`, label: a.name, pct: sharePct(node.value, a.value) })),
    ].filter(x => x.pct != null)
    const pathNodes = [...ancestors, node]
    const moveHere = (ticker, subId) => handleAssign([ticker], cat.id, subId)
    const holdingsTable = (
      <TickerTable
        {...tableBase}
        tickers={node.direct}
        shareLevels={shareLevelsFor(cat, pathNodes)}
        moveTargets={tree.ordered}
        onMove={moveHere}
      />
    )
    return (
      <div key={node.id} style={{ border: isActive ? '1px solid var(--primary)' : '1px solid var(--border)', borderRadius: 6, background: 'var(--p-161b2e)' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem 0.65rem' }}
          onClick={() => toggleSub(node)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
            <MoveButtons
              name={node.name}
              index={index}
              count={siblings.length}
              enabled={groupOrder === 'custom'}
              onMove={(delta) => handleMoveSub(cat.id, node, delta)}
            />
            <span style={{ fontSize: '0.72rem', opacity: 0.5 }}>{isOpen ? '▼' : '▶'}</span>
            <strong style={{ fontSize: '0.92rem', color: 'var(--p-cfd8dc)' }}>{node.name}</strong>
            <span
              title={`${node.all.length} holding${node.all.length === 1 ? '' : 's'} in ${node.name}, including the sub-categories inside it`}
              style={{ background: 'var(--border)', padding: '0.1rem 0.45rem', borderRadius: 10, fontSize: '0.7rem', color: 'var(--accent-bright)' }}
            >{node.all.length}</span>
            {children.length > 0 && (
              <span style={{ background: 'var(--p-1a2c4e)', padding: '0.1rem 0.45rem', borderRadius: 10, fontSize: '0.68rem', color: 'var(--p-bb86fc)' }}>
                {children.length} sub
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '0.3rem 1rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--p-bb86fc)' }}>
              {portfolioPct == null ? '—' : `${portfolioPct.toFixed(1)}%`} <span className="cat-share-label">of portfolio</span>
            </span>
            {upperShares.map(x => (
              <span key={x.key} style={{ fontSize: '0.78rem', color: 'var(--text-dim-2)' }}>{x.pct.toFixed(1)}% of {x.label}</span>
            ))}
            {node.target_pct != null && (
              <span style={{ fontSize: '0.78rem', color: 'var(--accent-2)' }}>Target {Number(node.target_pct).toFixed(1)}% of {parentName}</span>
            )}
            <span style={{ fontSize: '0.82rem', color: 'var(--text-dim-2)' }}>{fmt(node.value)}</span>
            <span
              style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}
              title={`Projected monthly income from ${node.name}${incomeShare != null ? `: ${incomeShare.toFixed(1)}% of ${parentName}'s income` : ''}.`}
            >
              {fmt(node.income)}<span className="cat-share-label">/mo income</span>
            </span>
            <div style={{ display: 'flex', gap: '0.35rem' }} onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-secondary"
                style={SUB_ROW_BTN}
                title={`Add a sub-category inside ${node.name}`}
                onClick={() => setSubModal({
                  categoryId: cat.id, categoryName: cat.name,
                  parentId: node.id, parentName: node.name, pathLabel: subPathLabel(cat, node),
                  siblings: node.children,
                })}
              >+ Sub</button>
              <button
                className="btn btn-secondary"
                style={SUB_ROW_BTN}
                title={`Rename ${node.name} or change its target`}
                onClick={() => setSubModal({
                  categoryId: cat.id, categoryName: cat.name,
                  parentId: node.parent_id, parentName, pathLabel: parent ? subPathLabel(cat, parent) : cat.name,
                  sub: node, siblings,
                })}
              >Edit</button>
              <button className="btn btn-danger" style={SUB_ROW_BTN} title={`Delete sub-category ${node.name}`} onClick={() => handleDeleteSub(cat, node)}>Delete</button>
            </div>
          </div>
        </div>
        {isOpen && (
          <div style={{ padding: '0 0.65rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {children.map((child, i) => renderSubNode(cat, tree, child, children, i))}
            {children.length > 0 && node.direct.length > 0 && (
              <div style={{ border: '1px dashed var(--secondary-solid)', borderRadius: 6, padding: '0.5rem 0.65rem', background: 'rgba(69,90,100,0.08)' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim-2)', marginBottom: '0.35rem', fontWeight: 700 }}>
                  Directly in {node.name} ({node.direct.length}) — not in a sub-category inside it
                </div>
                {holdingsTable}
              </div>
            )}
            {children.length === 0 && (node.direct.length === 0 ? (
              <p style={{ color: 'var(--pos-bright)', fontSize: '0.8rem', fontStyle: 'italic', margin: '0.25rem 0' }}>
                Click a ticker on the right to assign it here, or use + Sub to add a sub-category inside it.
              </p>
            ) : holdingsTable)}
          </div>
        )}
      </div>
    )
  }

  const handleUnallocClick = (ticker) => {
    if (assignTarget) {
      handleAssign([ticker], assignTarget.categoryId, assignTarget.subId)
    } else {
      toggleUnalloc(ticker)
    }
  }

  const applySuggestedTargets = async (openWizard = false) => {
    if (!targetAssistant?.rows?.length) return
    const ok = await dialog.confirm(openWizard
      ? 'Save these suggested category targets, then open Rebalance Wizard to build the trade list?'
      : 'Save these suggested percentages as your category targets?')
    if (!ok) return
    setError(null)
    try {
      for (const row of targetAssistant.rows) {
        await pf(`/api/categories/${row.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_pct: Number(row.suggested_pct.toFixed(1)) }),
        })
      }
      await reload({ refreshMarketData: false })
      if (openWizard) {
        try {
          sessionStorage.setItem('categoryTargetAssistantHandoff', JSON.stringify({
            min_monthly_income: Number(constraints.minimumMonthlyIncome || 0),
            rebalance_strategy: assistantMode === 'preserve_income'
              ? 'match_targets_preserve_income'
              : 'maximize_income_reduce_drift',
          }))
        } catch {
          // Non-critical: navigation still works if session storage is unavailable.
        }
        navigate('/rebalance-wizard')
      }
    } catch (e) {
      setError(e.message || 'Could not save the suggested category targets.')
    }
  }

  const allocatedCount = data.categories.reduce((s, c) => s + c.tickers.length, 0)
  const totalCount = allocatedCount + data.unallocated.length
  const allocatedValue = data.categories.reduce((s, c) => s + c.actual_value, 0)
  const allocatedPct = data.total_value ? (allocatedValue / data.total_value * 100) : 0
  const totalTargetPct = data.categories.reduce((s, c) => s + (Number(c.target_pct) || 0), 0)
  const targetRemainingPct = 100 - totalTargetPct
  const targetTotalColor = totalTargetPct > 100 ? '#ff6b6b' : Math.abs(totalTargetPct - 100) <= 0.05 ? '#00e89a' : '#ffc107'
  const targetComparisonRows = data.categories
    .filter(c => c.target_pct != null)
    .map(c => ({
      id: c.id,
      name: c.name,
      actual: Number(c.actual_pct || 0),
      target: Number(c.target_pct || 0),
      drift: Number(c.actual_pct || 0) - Number(c.target_pct || 0),
    }))

  const targetAssistant = useMemo(() => {
    const cats = data.categories.filter(c => Number(c.actual_value || 0) > 0)
    if (!cats.length || !data.total_value) return null

    const existingTargetsValid = Math.abs(totalTargetPct - 100) <= 0.2
    const hasPortfolioIncomeData = data.monthly_income != null || data.portfolio_yield != null
    const currentMonthly = hasPortfolioIncomeData ? Number(data.monthly_income || 0) : null
    const portfolioYield = hasPortfolioIncomeData
      ? Number(data.portfolio_yield || 0) || (data.total_value ? Number(currentMonthly || 0) * 12 / data.total_value * 100 : 0)
      : null
    const hasPortfolioWeeklyData = data.weekly_value_pct != null || data.weekly_value != null
    const avgWeekly = hasPortfolioWeeklyData
      ? Number(data.weekly_value_pct ?? (data.total_value ? Number(data.weekly_value || 0) / data.total_value * 100 : 0))
      : null
    const suspiciousYield = Math.max(25, Number(portfolioYield || 0) * 2)
    const incomeFloor = Math.max(0, Number(constraints.minimumMonthlyIncome || 0))
    const maxCategoryPct = Math.max(1, Number(constraints.maxCategoryPct || 100))
    const maxHighYieldCategoryPct = Math.max(1, Number(constraints.maxHighYieldCategoryPct || 100))
    const maxAllowedDrift = Math.max(0, Number(constraints.maxAllowedDrift || 0))
    const minimumAnchorAllocation = Math.max(0, Number(constraints.minimumAnchorAllocation || 0))
    const incomeGrowthPriority = Math.max(0, Math.min(100, Number(constraints.incomeGrowthPriority || 0)))
    const modeConfigs = {
      balanced: { label: 'Balanced', income: 0.22, weekly: -0.04, current: 0.45 },
      preserve_income: { label: 'Preserve income', income: 0.42, weekly: -0.02, current: 0.25 },
      reduce_drift: { label: 'Reduce target drift', income: 0.08, weekly: -0.02, current: 0.75 },
    }
    const isAnchor = (cat) => /anchor/i.test(cat.name || '')
    const categoryMonthlyIncome = (cat) => {
      const direct = Number(cat.monthly_income)
      if (Number.isFinite(direct) && direct > 0) return direct
      return (cat.tickers || []).reduce((sum, ticker) => (
        sum + Number(ticker.monthly_income ?? ticker.approx_monthly_income ?? 0)
      ), 0)
    }
    const categoryYield = (cat) => {
      const direct = Number(cat.current_yield)
      if (Number.isFinite(direct) && direct > 0) return direct
      const value = Number(cat.actual_value || 0)
      const monthly = categoryMonthlyIncome(cat)
      return value > 0 && monthly > 0 ? monthly * 12 / value * 100 : 0
    }
    const isHighYield = (cat) => /juicer|high.?yield|yield/i.test(cat.name || '') || categoryYield(cat) > suspiciousYield

    const normalizeWithCaps = (items) => {
      const rows = items.map(item => {
        const actual = Number(item.actual_pct || 0)
        const highYieldCap = isHighYield(item) ? maxHighYieldCategoryPct : maxCategoryPct
        const cap = Math.min(maxCategoryPct, highYieldCap, actual + maxAllowedDrift || 100)
        const floor = Math.max(0, actual - maxAllowedDrift)
        return {
          ...item,
          suggested_pct_raw: Math.max(floor, Math.min(cap, item.suggested_pct_raw)),
          cap,
          floor,
        }
      })

      for (let pass = 0; pass < 8; pass += 1) {
        const total = rows.reduce((s, r) => s + r.suggested_pct_raw, 0)
        const delta = 100 - total
        if (Math.abs(delta) < 0.01) break
        const adjustable = rows.filter(r => delta > 0 ? r.suggested_pct_raw < r.cap - 0.01 : r.suggested_pct_raw > r.floor + 0.01)
        if (!adjustable.length) break
        const room = adjustable.reduce((s, r) => s + (delta > 0 ? r.cap - r.suggested_pct_raw : r.suggested_pct_raw - r.floor), 0) || 1
        adjustable.forEach(row => {
          const capacity = delta > 0 ? row.cap - row.suggested_pct_raw : row.suggested_pct_raw - row.floor
          const move = Math.min(Math.abs(delta) * capacity / room, capacity)
          row.suggested_pct_raw += delta > 0 ? move : -move
        })
      }
      return rows
    }

    const qualityTickerRows = (cat, allocationPct = Number(cat.actual_pct || 0)) => {
      const categoryValue = Number(cat.actual_value || 0)
      return (cat.tickers || []).map(ticker => {
        const currentValue = Number(ticker.current_value || 0)
        const categoryPct = categoryValue > 0 ? currentValue / categoryValue * 100 : 0
        const portfolioPct = allocationPct * categoryPct / 100
        const monthlyIncome = Number(ticker.monthly_income ?? ticker.approx_monthly_income ?? 0)
        const incomeSharePct = currentMonthly > 0 ? monthlyIncome / currentMonthly * 100 : 0
        const yieldPct = currentValue > 0 ? monthlyIncome * 12 / currentValue * 100 : Number(ticker.current_yield || 0)
        const gainLossPct = Number(ticker.gain_or_loss_percentage || 0)
        const navCoverageRatio = Number(ticker.nav_coverage_ratio)
        const drivers = []
        if (ticker.nav_risk) drivers.push(Number.isFinite(navCoverageRatio) ? `${ticker.ticker} high NAV ratio ${navCoverageRatio.toFixed(2)}` : `${ticker.ticker} high NAV erosion`)
        else if (ticker.nav_candidate) drivers.push(Number.isFinite(navCoverageRatio) ? `${ticker.ticker} NAV monitor, ratio ${navCoverageRatio.toFixed(2)}` : `${ticker.ticker} NAV monitor, ratio unavailable`)
        if (ticker.weekly) drivers.push('weekly payer')
        if (portfolioPct > 12) drivers.push('large portfolio position')
        if (incomeSharePct > 12) drivers.push('large income source')
        if (yieldPct > suspiciousYield) drivers.push('high-yield reliance')
        if (gainLossPct < -10) drivers.push('weak recent return')
        return {
          ticker: ticker.ticker,
          current_value: currentValue,
          category_pct: categoryPct,
          portfolio_pct: portfolioPct,
          income_share_pct: incomeSharePct,
          yield_pct: yieldPct,
          gain_loss_pct: gainLossPct,
          nav_coverage_ratio: Number.isFinite(navCoverageRatio) ? navCoverageRatio : null,
          drivers,
        }
      })
        .filter(ticker => ticker.drivers.length)
        .sort((a, b) => b.drivers.length - a.drivers.length || b.portfolio_pct - a.portfolio_pct)
    }

    const qualityFor = (cat, allocationPct = Number(cat.actual_pct || 0)) => {
      const y = categoryYield(cat)
      const nav = Number(cat.nav_risk_value_pct || 0)
      const largest = Number(cat.largest_holding_pct || 0)
      const incomeConc = Number(cat.income_concentration_pct || 0)
      const weekly = Number(cat.weekly_value_pct || 0)
      const gain = Number(cat.weighted_gain_loss_pct || 0)
      const portfolioNav = allocationPct * nav / 100
      const portfolioLargest = allocationPct * largest / 100
      const categoryIncomeShare = currentMonthly > 0 ? categoryMonthlyIncome(cat) / currentMonthly * 100 : 0
      const portfolioIncomeConcentration = categoryIncomeShare * incomeConc / 100
      const portfolioWeekly = allocationPct * weekly / 100
      let score = 82
      if (portfolioYield != null && y >= portfolioYield * 0.8 && y <= suspiciousYield) score += 6
      if (y > suspiciousYield) score -= 12
      if (portfolioNav > 15) score -= 14
      else if (portfolioNav > 8) score -= 8
      else if (portfolioNav > 4) score -= 4
      if (portfolioLargest > 20) score -= 10
      else if (portfolioLargest > 12) score -= 5
      if (portfolioIncomeConcentration > 20) score -= 10
      else if (portfolioIncomeConcentration > 12) score -= 5
      if (portfolioWeekly > 20) score -= 8
      else if (portfolioWeekly > 12) score -= 4
      if (gain > 10) score += 5
      else if (gain < -10) score -= 5
      score = Math.max(0, Math.min(100, Math.round(score)))
      const reasons = []
      if (y > suspiciousYield) reasons.push('high-yield reliance')
      if (portfolioNav > 4) reasons.push(`NAV-risk ${portfolioNav.toFixed(1)}% of portfolio`)
      if (portfolioLargest > 12) reasons.push(`largest holding ${portfolioLargest.toFixed(1)}% of portfolio`)
      if (portfolioIncomeConcentration > 12) reasons.push(`largest income source ${portfolioIncomeConcentration.toFixed(1)}% of income`)
      if (portfolioWeekly > 12) reasons.push(`weekly payers ${portfolioWeekly.toFixed(1)}% of portfolio`)
      if (gain < -10) reasons.push('weak recent return')
      if (!reasons.length) reasons.push('balanced portfolio impact')
      return {
        score,
        label: score >= 78 ? 'Strong' : score >= 60 ? 'Watch' : 'Risky',
        reasons,
        tickers: qualityTickerRows(cat, allocationPct),
      }
    }

    const buildPlan = (modeKey) => {
      const mode = modeConfigs[modeKey] || modeConfigs.balanced
      const raw = cats.map(cat => {
      const actual = Number(cat.actual_pct || 0)
      const existing = Number(cat.target_pct ?? actual)
      const base = existingTargetsValid ? (existing * (1 - mode.current) + actual * mode.current) : actual
      const incomeEdge = portfolioYield == null ? 0 : categoryYield(cat) - portfolioYield
      const weeklyEdge = avgWeekly == null ? 0 : Number(cat.weekly_value_pct || 0) - avgWeekly
      const incomeTilt = mode.income * (0.5 + incomeGrowthPriority / 50)
      const riskTrim = Number(cat.nav_risk_value_pct || 0) > 25 || Number(cat.income_concentration_pct || 0) > 35 ? (100 - incomeGrowthPriority) / 50 : 0
      const adjustment = Math.max(-6, Math.min(6, incomeEdge * incomeTilt + weeklyEdge * mode.weekly - riskTrim))
      return { ...cat, suggested_pct_raw: Math.max(0, base + adjustment) }
      })

      let constrained = normalizeWithCaps(raw)
      const anchorRows = constrained.filter(isAnchor)
      const anchorTotal = anchorRows.reduce((s, r) => s + r.suggested_pct_raw, 0)
      if (anchorRows.length && anchorTotal < minimumAnchorAllocation) {
        const need = minimumAnchorAllocation - anchorTotal
        const donors = constrained.filter(r => !isAnchor(r) && r.suggested_pct_raw > r.floor + 0.01)
        const donorRoom = donors.reduce((s, r) => s + r.suggested_pct_raw - r.floor, 0) || 1
        donors.forEach(row => {
          const move = Math.min(need * (row.suggested_pct_raw - row.floor) / donorRoom, row.suggested_pct_raw - row.floor)
          row.suggested_pct_raw -= move
        })
        const anchorRoom = anchorRows.reduce((s, r) => s + r.cap - r.suggested_pct_raw, 0) || 1
        anchorRows.forEach(row => {
          const move = Math.min(need * (row.cap - row.suggested_pct_raw) / anchorRoom, row.cap - row.suggested_pct_raw)
          row.suggested_pct_raw += move
        })
        constrained = normalizeWithCaps(constrained)
      }

      const rows = constrained.map(cat => {
      const suggested = cat.suggested_pct_raw
      const projectedValue = data.total_value * suggested / 100
      const yieldForProjection = categoryYield(cat)
      const hasIncomeProjection = yieldForProjection > 0
      const projectedMonthly = hasIncomeProjection ? projectedValue * yieldForProjection / 100 / 12 : null
      const hasWeeklyProjection = Number.isFinite(Number(cat.weekly_value_pct))
      const projectedWeeklyPct = hasWeeklyProjection ? suggested * Number(cat.weekly_value_pct || 0) / 100 : null
      const currentOrTarget = Number(cat.target_pct ?? cat.actual_pct ?? 0)
      const delta = suggested - currentOrTarget
      const reasons = []
      if (isAnchor(cat) && suggested > currentOrTarget + 0.2) reasons.push('improves income stability and supports the minimum anchor allocation')
      if (isHighYield(cat) && suggested < currentOrTarget - 0.2) reasons.push('reduces high-yield concentration and NAV risk')
      if (Number(cat.income_concentration_pct || 0) > 35) reasons.push('lowers income concentration')
      if (Number(cat.nav_risk_value_pct || 0) > 25) reasons.push('contains NAV-risk exposure')
      if (Math.abs(suggested - Number(cat.actual_pct || 0)) >= maxAllowedDrift - 0.05) reasons.push('respects the allowed drift limit')
      if (suggested >= maxCategoryPct - 0.05) reasons.push('held at the max category limit')
      if (isHighYield(cat) && suggested >= maxHighYieldCategoryPct - 0.05) reasons.push('held at the high-yield category limit')
      if (!reasons.length && delta > 0.2) reasons.push('adds to better income-adjusted category balance')
      if (!reasons.length && delta < -0.2) reasons.push('trims category drift while preserving income targets')
      if (!reasons.length) reasons.push('keeps allocation steady within the current constraints')
      return {
        ...cat,
        current_yield: yieldForProjection,
        suggested_pct: suggested,
        drift_dollars: (suggested - Number(cat.actual_pct || 0)) / 100 * data.total_value,
        projected_monthly_income: projectedMonthly,
        has_income_projection: hasIncomeProjection,
        has_weekly_projection: hasWeeklyProjection,
        projected_weekly_pct: projectedWeeklyPct,
        quality: qualityFor(cat, suggested),
        rationale: reasons.slice(0, 2).join('; ') + '.',
      }
      })

      const hasIncomeProjectionData = rows.some(r => r.has_income_projection)
      const projectedMonthly = hasIncomeProjectionData
        ? rows.reduce((s, r) => s + Number(r.projected_monthly_income || 0), 0)
        : null
      const hasWeeklyProjectionData = rows.some(r => r.has_weekly_projection)
      const projectedWeeklyPct = hasWeeklyProjectionData
        ? rows.reduce((s, r) => s + Number(r.projected_weekly_pct || 0), 0)
        : null
      const incomeShortfall = projectedMonthly == null ? 0 : Math.max(0, incomeFloor - projectedMonthly)
      const incomeFloorBreached = projectedMonthly != null && incomeShortfall > 0.01
      const requiredYield = data.total_value ? incomeFloor * 12 / data.total_value * 100 : 0
      const replacementAmount = rows.reduce((s, r) => s + Math.abs(r.drift_dollars), 0) || data.total_value
      const yieldNeededOnReplacements = replacementAmount > 0 ? incomeShortfall * 12 / replacementAmount * 100 : 0
      const avgQuality = rows.length ? rows.reduce((s, r) => s + Number(r.quality?.score || 0), 0) / rows.length : 0
      const totalMove = rows.reduce((s, r) => s + Math.abs(r.drift_dollars), 0)
      return {
        mode: modeKey,
        label: mode.label,
      rows,
      currentMonthly,
      projectedMonthly,
      incomeDelta: projectedMonthly == null || currentMonthly == null ? null : projectedMonthly - currentMonthly,
      incomeFloor,
      incomeShortfall,
      incomeFloorBreached,
      hasIncomeProjectionData,
      hasWeeklyProjectionData,
      requiredYield,
      suspiciousYield,
      yieldNeededOnReplacements,
      needsHighYieldReplacement: incomeFloorBreached && requiredYield > projectedMonthly * 12 / data.total_value * 100,
      currentYield: portfolioYield,
      projectedYield: data.total_value && projectedMonthly != null ? projectedMonthly * 12 / data.total_value * 100 : null,
      currentWeeklyPct: avgWeekly,
      projectedWeeklyPct,
        avgQuality,
        totalMove,
      constraintsApplied: {
        maxCategoryPct,
        maxHighYieldCategoryPct,
        maxAllowedDrift,
        minimumAnchorAllocation,
        incomeGrowthPriority,
      },
    }
    }

    const mixes = Object.keys(modeConfigs).map(buildPlan)
    const selected = mixes.find(mix => mix.mode === assistantMode) || mixes[0]
    return { ...selected, mixes }
  }, [data, assistantMode, totalTargetPct, constraints])

  const assistantRowsById = useMemo(() => {
    const rows = targetAssistant?.rows || []
    return Object.fromEntries(rows.map(row => [row.id, row]))
  }, [targetAssistant])

  const orderedCategories = useMemo(
    () => orderGroups(data.categories, groupOrder),
    [data.categories, groupOrder],
  )

  const barColor = (cat) => {
    if (cat.target_pct == null) return '#7ecfff'
    const diff = Math.abs(cat.actual_pct - cat.target_pct)
    if (diff <= 3) return '#00e89a'
    if (diff <= 8) return '#ffc107'
    return '#ff6b6b'
  }

  if (loading) return <div className="page" style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>

  if (isAggregate) {
    return (
      <div className="page">
        <h1>Categories</h1>
        <div className="card" style={{ padding: '1rem', maxWidth: 760 }}>
          <h2 style={{ marginTop: 0 }}>Select an individual account</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>
            Categories and sub-categories are edited per account. You are viewing {currentProfileName || 'an aggregate portfolio'}, so assignments are locked here to avoid writing changes to the wrong account.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1>Categories</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {hasOtherAccounts && data.categories.length > 0 && (
            <button className="btn btn-secondary" onClick={() => setShowCopyModal(true)} title="Copy these categories into other accounts. Holdings are not assigned.">
              Copy to Accounts…
            </button>
          )}
          <button className="btn btn-success" onClick={handleCreate}>+ New Category</button>
        </div>
      </div>

      {showCopyModal && (
        <CopyCategoriesModal
          pf={pf}
          categories={data.categories}
          sourceName={currentProfileName}
          onCancel={() => setShowCopyModal(false)}
          onDone={handleCopied}
        />
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {/* Summary strip */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Allocated</span>
            <div style={{ fontWeight: 700, color: 'var(--accent-bright)' }}>{allocatedCount} / {totalCount} holdings</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Allocated Value</span>
            <div style={{ fontWeight: 700, color: 'var(--accent-bright)' }}>{fmt(allocatedValue)} ({allocatedPct.toFixed(1)}%)</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Total Value</span>
            <div style={{ fontWeight: 700, color: 'var(--accent-bright)' }}>{fmt(data.total_value)}</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Monthly Income</span>
            <div style={{ fontWeight: 700, color: 'var(--accent-bright)' }}>
              {data.monthly_income == null ? 'Unavailable' : fmt(data.monthly_income)}
              {' '}
              ({data.portfolio_yield == null ? 'yield unavailable' : `${fmtPct(data.portfolio_yield)} yield`})
            </div>
          </div>
          <div>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Weekly Exposure</span>
            <div style={{ fontWeight: 700, color: 'var(--accent-bright)' }}>
              {data.weekly_value_pct == null ? 'Unavailable' : `${fmtPct(data.weekly_value_pct)} value`}
            </div>
          </div>
          <div>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Target Allocation</span>
            <div style={{ fontWeight: 700, color: totalTargetPct > 100 ? 'var(--neg)' : totalTargetPct === 100 ? 'var(--pos-bright)' : 'var(--amber)' }}>
              {totalTargetPct.toFixed(1)}% / 100%
            </div>
          </div>
        </div>
        <AllocationBar categories={data.categories} totalValue={data.total_value} />
      </div>

      <OwnerTargetReference
        reference={data.owner_target_reference}
        fmt={fmt}
        fmtPct={fmtPct}
      />

      {targetAssistant && (
        <div className="card" style={{ padding: '1rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Target Assistant</h2>
              <p style={{ color: 'var(--text-dim-2)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                Use this to set target weights before rebalancing. Suggestions start with your current allocation, then adjust for income, concentration, weekly-payer exposure, NAV-risk flags, and the limits you set.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={assistantMode} onChange={e => setAssistantMode(e.target.value)}>
                <option value="balanced">Balanced</option>
                <option value="preserve_income">Preserve income</option>
                <option value="reduce_drift">Reduce target drift</option>
              </select>
              <button className="btn btn-success" onClick={() => applySuggestedTargets(false)}>Save Targets</button>
              <button className="btn btn-primary" onClick={() => applySuggestedTargets(true)}>Save & Build Trades</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.65rem', marginBottom: '0.85rem' }}>
            {targetAssistant.mixes.map(mix => (
              <button
                key={mix.mode}
                onClick={() => setAssistantMode(mix.mode)}
                className={assistantMode === mix.mode ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ textAlign: 'left', padding: '0.7rem 0.8rem', height: 'auto' }}
              >
                <div style={{ fontWeight: 800, marginBottom: 4 }}>{mix.label}</div>
                <div style={{ color: 'var(--p-cfd8dc)', fontSize: '0.78rem' }}>
                  Income: {mix.projectedMonthly == null ? 'Unavailable' : fmt(mix.projectedMonthly)}
                </div>
                <div style={{ color: mix.incomeFloorBreached ? 'var(--p-ffb74d)' : 'var(--p-cfd8dc)', fontSize: '0.78rem' }}>
                  Income floor: {mix.incomeFloorBreached ? `Short ${fmt(mix.incomeShortfall)}` : 'Met'}
                </div>
                <div style={{ color: 'var(--p-cfd8dc)', fontSize: '0.78rem' }}>
                  Quality: {mix.avgQuality.toFixed(0)} | Moves: {fmt(mix.totalMove)}
                </div>
              </button>
            ))}
          </div>

          <div className="cat-assistant-grid">
            <div className="cat-suggestion-panel">
              <div className="cat-panel-title">Suggested Targets</div>
              <div className="cat-suggestion-list">
                {targetAssistant.rows.map(row => (
                  <div key={row.id} className="cat-suggestion-row">
                    <div className="cat-suggestion-main">
                      <strong>{row.name}: {fmtPct(row.target_pct ?? row.actual_pct)} {'->'} {fmtPct(row.suggested_pct)}</strong>
                      <span style={{ color: row.suggested_pct >= Number(row.target_pct ?? row.actual_pct ?? 0) ? 'var(--pos-bright)' : 'var(--neg)' }}>
                        {row.suggested_pct >= Number(row.target_pct ?? row.actual_pct ?? 0) ? '+' : ''}{(row.suggested_pct - Number(row.target_pct ?? row.actual_pct ?? 0)).toFixed(1)} pts
                      </span>
                    </div>
                    <p>{row.rationale}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="cat-constraints-panel">
              <div className="cat-panel-title">Limits Used For Suggestions</div>
              <ConstraintSlider
                label="Minimum acceptable monthly income"
                value={constraints.minimumMonthlyIncome}
                min={0}
                max={incomeSliderMax}
                step={1}
                prefix="$"
                unit=""
                onChange={v => setConstraint('minimumMonthlyIncome', v)}
                help="The assistant tries to keep projected income at or above this amount. Lower it only if you are comfortable giving up monthly income to improve allocation balance."
                numeric
              />
              <ConstraintSlider
                label="Max category"
                value={constraints.maxCategoryPct}
                min={5}
                max={60}
                onChange={v => setConstraint('maxCategoryPct', v)}
                help="Prevents any one category from becoming too large in the suggested target mix."
              />
              <ConstraintSlider
                label="Max high-yield category"
                value={constraints.maxHighYieldCategoryPct}
                min={5}
                max={40}
                onChange={v => setConstraint('maxHighYieldCategoryPct', v)}
                help="Applies a tighter cap to categories that are yield-heavy or behave like high-yield buckets."
              />
              <ConstraintSlider
                label="Max allowed drift"
                value={constraints.maxAllowedDrift}
                min={1}
                max={20}
                onChange={v => setConstraint('maxAllowedDrift', v)}
                help="Controls how far the assistant can move a category away from where it is today."
              />
              <ConstraintSlider
                label="Minimum anchor allocation"
                value={constraints.minimumAnchorAllocation}
                min={0}
                max={70}
                onChange={v => setConstraint('minimumAnchorAllocation', v)}
                help="Keeps a minimum allocation in categories with Anchor in the name, when those categories exist."
              />
              <ConstraintSlider
                label="Income growth priority"
                value={constraints.incomeGrowthPriority}
                min={0}
                max={100}
                onChange={v => setConstraint('incomeGrowthPriority', v)}
                help="Higher values favor income-producing categories; lower values favor balance and risk control."
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Projected Income</span>
              <div style={{ fontWeight: 700, color: targetAssistant.projectedMonthly == null ? 'var(--amber)' : targetAssistant.incomeDelta >= -0.01 ? 'var(--pos-bright)' : 'var(--neg)' }}>
                {targetAssistant.projectedMonthly == null
                  ? 'Unavailable'
                  : `${fmt(targetAssistant.projectedMonthly)} / mo (${targetAssistant.incomeDelta == null ? 'current income unavailable' : `${targetAssistant.incomeDelta >= 0 ? '+' : '-'}${fmt(Math.abs(targetAssistant.incomeDelta))}`})`}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Minimum Income Target</span>
              <div style={{ fontWeight: 700, color: targetAssistant.incomeFloorBreached ? 'var(--neg)' : 'var(--pos-bright)' }}>
                {fmt(targetAssistant.incomeFloor)} / mo
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Projected Yield</span>
              <div style={{ fontWeight: 700, color: 'var(--accent-bright)' }}>
                {targetAssistant.currentYield == null ? 'Unavailable' : fmtPct(targetAssistant.currentYield)} {'->'} {targetAssistant.projectedYield == null ? 'Unavailable' : fmtPct(targetAssistant.projectedYield)}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Weekly Exposure</span>
              <div style={{ fontWeight: 700, color: 'var(--accent-bright)' }}>
                {targetAssistant.currentWeeklyPct == null ? 'Unavailable' : fmtPct(targetAssistant.currentWeeklyPct)}
                {' -> '}
                {targetAssistant.projectedWeeklyPct == null ? 'Unavailable' : fmtPct(targetAssistant.projectedWeeklyPct)}
              </div>
            </div>
          </div>

          {targetAssistant.incomeFloorBreached && (
            <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
              This target mix is projected to miss your monthly income target by {fmt(targetAssistant.incomeShortfall)}.
              You can lower the income target, choose a more income-focused mix, or let Rebalance Wizard look for higher-yield replacement buys. Required portfolio yield is {fmtPct(targetAssistant.requiredYield)}
              {targetAssistant.yieldNeededOnReplacements > 0 ? `, and the dollars being moved would need roughly +${fmtPct(targetAssistant.yieldNeededOnReplacements)} of extra yield.` : '.'}
            </div>
          )}

          {!targetAssistant.hasIncomeProjectionData && targetAssistant.incomeFloor > 0 && (
            <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
              Income check unavailable: this view does not have enough category yield or ticker income data to test the {fmt(targetAssistant.incomeFloor)} monthly target. The Rebalance Wizard will run the stricter income check before exports.
            </div>
          )}

          {!targetAssistant.hasWeeklyProjectionData && (
            <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
              Weekly-payer check unavailable: this view does not have enough payout-frequency data to estimate projected weekly exposure.
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table className="pb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Category</th>
                  <th>Current</th>
                  <th>Target</th>
                  <th>Suggested</th>
                  <th>Yield</th>
                  <th>Weekly</th>
                  <th>Quality</th>
                  <th>To Suggested</th>
                  <th style={{ textAlign: 'left' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {targetAssistant.rows.map(row => (
                  <tr key={row.id}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>{row.name}</td>
                    <td>{fmtPct(row.actual_pct)}</td>
                    <td>{row.target_pct == null ? '-' : fmtPct(row.target_pct)}</td>
                    <td style={{ color: 'var(--pos-bright)', fontWeight: 700 }}>{fmtPct(row.suggested_pct)}</td>
                    <td>{fmtPct(row.current_yield)}</td>
                    <td>{fmtPct(row.weekly_value_pct)}</td>
                    <td title={row.quality.reasons.join(', ')} style={{ color: row.quality.score >= 78 ? 'var(--pos-bright)' : row.quality.score >= 60 ? 'var(--amber)' : 'var(--neg)', fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', minWidth: 340, maxWidth: 380 }}>
                      <button
                        type="button"
                        onClick={() => setQualityDetail(row)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: 'inherit',
                          cursor: 'pointer',
                          font: 'inherit',
                          fontWeight: 700,
                          textAlign: 'center',
                          width: '100%',
                        }}
                      >
                        <div>{row.quality.score} {row.quality.label}</div>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', fontWeight: 600, marginTop: 2, lineHeight: 1.3, whiteSpace: 'normal' }}>
                          {row.quality.reasons.slice(0, 2).join('; ')}
                        </div>
                      </button>
                    </td>
                    <td style={{ color: row.drift_dollars >= 0 ? 'var(--pos-bright)' : 'var(--neg)', fontWeight: 700 }}>
                      {row.drift_dollars >= 0 ? '+' : '-'}{fmt(Math.abs(row.drift_dollars))}
                    </td>
                    <td style={{ textAlign: 'left', color: 'var(--text-muted)', whiteSpace: 'normal', minWidth: 240 }}>{row.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', marginTop: '1.5rem' }}>

        {/* Left: Category cards */}
        <div style={{ flex: '1 1 70%', minWidth: 0 }}>
          {data.categories.length === 0 && (
            <div className="card"><p style={{ color: 'var(--text-dim-2)' }}>No categories yet. Create one or import holdings to auto-generate.</p></div>
          )}
          {data.categories.length > 0 && (
            <div className="cat-list-toolbar">
              <label>
                Order by
                <select value={groupOrder} onChange={(e) => changeGroupOrder(e.target.value)}>
                  {GROUP_ORDER_MODES.map(mode => <option key={mode.key} value={mode.key}>{mode.label}</option>)}
                </select>
              </label>
              <span>
                {groupOrder === 'custom'
                  ? 'Use ▲ ▼ to move a category, or a sub-category within its category.'
                  : 'Applies to categories and sub-categories. Choose My order to move them by hand.'}
                {' '}Click a column header to sort the holdings.
              </span>
            </div>
          )}
          {orderedCategories.map((cat, catIndex) => {
            const expanded = expandedId === cat.id
            const assistantRow = assistantRowsById[cat.id]
            const catIncomeShare = sharePct(cat.monthly_income, data.monthly_income)
            return (
              <div
                key={cat.id}
                ref={el => { catRefs.current[cat.id] = el }}
                className="card"
                style={{
                  marginBottom: '0.75rem',
                  border: flashId === cat.id
                    ? '1px solid var(--pos-bright)'
                    : expanded ? '1px solid var(--primary)' : undefined,
                  boxShadow: flashId === cat.id ? '0 0 0 3px rgba(0, 232, 154, 0.25)' : undefined,
                  transition: 'box-shadow 0.4s, border-color 0.4s',
                }}
              >
                {/* Header */}
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  onClick={() => { setExpandedSubIds(new Set()); setActiveSubId(null); setExpandedId(expanded ? null : cat.id) }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                    <MoveButtons
                      name={cat.name}
                      index={catIndex}
                      count={orderedCategories.length}
                      enabled={groupOrder === 'custom'}
                      onMove={(delta) => handleMoveCategory(cat.id, delta)}
                    />
                    <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>{expanded ? '\u25BC' : '\u25B6'}</span>
                    <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{cat.name}</h2>
                    <span style={{ background: 'var(--border)', padding: '0.15rem 0.5rem', borderRadius: 10, fontSize: '0.75rem', color: 'var(--accent-bright)' }}>
                      {cat.tickers.length}
                    </span>
                    {(cat.subcategories || []).length > 0 && (
                      <span style={{ background: 'var(--p-1a2c4e)', padding: '0.15rem 0.5rem', borderRadius: 10, fontSize: '0.72rem', color: 'var(--p-bb86fc)' }}>
                        {cat.subcategories.length} sub
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '0.4rem 1.25rem' }}>
                    {cat.target_pct != null && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Target: {cat.target_pct.toFixed(1)}%</span>
                    )}
                    {assistantRow?.quality && (
                      <button
                        type="button"
                        title={assistantRow.quality.reasons.join(', ')}
                        onClick={(e) => { e.stopPropagation(); setQualityDetail(assistantRow) }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: '0.8rem',
                          color: assistantRow.quality.score >= 78 ? 'var(--pos-bright)' : assistantRow.quality.score >= 60 ? 'var(--amber)' : 'var(--neg)',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Quality: {assistantRow.quality.score}
                      </button>
                    )}
                    <span style={{ fontWeight: 700, color: barColor(cat), fontSize: '0.95rem' }} title={`${cat.name} is ${cat.actual_pct.toFixed(1)}% of the whole portfolio value.`}>
                      {cat.actual_pct.toFixed(1)}% <span className="cat-share-label">of portfolio</span>
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-dim-2)' }}>{fmt(cat.actual_value)}</span>
                    <span
                      style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                      title={`Projected monthly income from ${cat.name}${catIncomeShare != null ? `: ${catIncomeShare.toFixed(1)}% of the portfolio's income` : ''}.`}
                    >
                      {fmt(cat.monthly_income)}<span className="cat-share-label">/mo income</span>
                    </span>
                    <div style={{ display: 'flex', gap: '0.35rem' }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-primary" style={ROW_BTN} title={`Rename ${cat.name} or change its target`} onClick={() => handleEdit(cat)}>Edit</button>
                      <button className="btn btn-danger" style={ROW_BTN} title={`Delete ${cat.name}`} onClick={() => handleDelete(cat)}>Delete</button>
                    </div>
                  </div>
                </div>

                {/* Allocation bar */}
                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg)', marginTop: '0.5rem', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(cat.actual_pct, 100)}%`, background: barColor(cat), borderRadius: 3, transition: 'width 0.3s' }} />
                </div>

                {/* Expanded: sub-categories (nested to any depth) and/or ticker list */}
                {expanded && (() => {
                  const tree = catTrees.get(cat.id)
                  const roots = branchOrder(tree?.roots || [])
                  const hasSubs = roots.length > 0
                  return (
                    <div style={{ marginTop: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <button
                          className="btn btn-secondary"
                          style={ROW_BTN}
                          onClick={() => setSubModal({
                            categoryId: cat.id, categoryName: cat.name,
                            parentId: null, parentName: cat.name, pathLabel: cat.name,
                            siblings: tree?.roots || [],
                          })}
                        >+ Sub-category</button>
                        {!hasSubs && cat.tickers.length > 0 && (
                          <button className="btn btn-secondary" style={ROW_BTN}
                            onClick={() => handleUnassign(cat.tickers.map(t => t.ticker))}>
                            Unassign All
                          </button>
                        )}
                      </div>

                      {hasSubs ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {roots.map((node, i) => renderSubNode(cat, tree, node, roots, i))}
                          {tree.unassigned.length > 0 && (
                            <div style={{ border: '1px dashed var(--secondary-solid)', borderRadius: 6, padding: '0.5rem 0.65rem', background: 'rgba(69,90,100,0.08)' }}>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-dim-2)', marginBottom: '0.35rem', fontWeight: 700 }}>
                                Not in a sub-category ({tree.unassigned.length}) — use the dropdown to choose one
                              </div>
                              <TickerTable
                                {...tableBase}
                                tickers={tree.unassigned}
                                shareLevels={shareLevelsFor(cat, [])}
                                moveTargets={tree.ordered}
                                onMove={(ticker, subId) => handleAssign([ticker], cat.id, subId)}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        cat.tickers.length === 0 ? (
                          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                            Click a ticker on the right to assign it here, or add a sub-category to organize holdings.
                          </p>
                        ) : (
                          <TickerTable {...tableBase} tickers={cat.tickers} shareLevels={shareLevelsFor(cat, [])} />
                        )
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>

        {/* Right: Unallocated assets */}
        <div style={{ flex: '0 0 28%', position: 'sticky', top: 'calc(var(--app-header-height) + 1rem)' }}>
          <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.45rem' }}>
              <h2 style={{ fontSize: '1rem', margin: 0 }}>Target Allocation</h2>
              <strong style={{ color: targetTotalColor, fontSize: '1rem' }}>{totalTargetPct.toFixed(1)}%</strong>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--bg)', overflow: 'hidden', border: '1px solid var(--border)', marginBottom: '0.45rem' }}>
              <div style={{ height: '100%', width: `${Math.min(totalTargetPct, 100)}%`, background: targetTotalColor, transition: 'width 0.2s' }} />
            </div>
            <div style={{ color: targetRemainingPct < 0 ? 'var(--p-ffb3b3)' : 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 700 }}>
              {targetRemainingPct < 0
                ? `${Math.abs(targetRemainingPct).toFixed(1)}% over target`
                : `${targetRemainingPct.toFixed(1)}% remaining`}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.75rem', paddingTop: '0.65rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 3.4rem 3.4rem 3.5rem', gap: '0.35rem', color: 'var(--p-78909c)', fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                <span>Category</span>
                <span style={{ textAlign: 'right' }}>Actual</span>
                <span style={{ textAlign: 'right' }}>Target</span>
                <span style={{ textAlign: 'right' }}>Drift</span>
              </div>
              {targetComparisonRows.length === 0 ? (
                <div style={{ color: 'var(--text-dim-2)', fontSize: '0.78rem' }}>No targets set yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: '0.28rem' }}>
                  {targetComparisonRows.map(row => {
                    const driftColor = Math.abs(row.drift) <= 3 ? '#00e89a' : Math.abs(row.drift) <= 8 ? '#ffc107' : '#ff6b6b'
                    return (
                      <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 3.4rem 3.4rem 3.5rem', gap: '0.35rem', alignItems: 'center', fontSize: '0.76rem' }}>
                        <span title={row.name} style={{ color: 'var(--p-d8e6f3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>{row.name}</span>
                        <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>{row.actual.toFixed(1)}%</span>
                        <span style={{ color: 'var(--accent-2)', textAlign: 'right' }}>{row.target.toFixed(1)}%</span>
                        <span style={{ color: driftColor, textAlign: 'right', fontWeight: 800 }}>
                          {row.drift >= 0 ? '+' : ''}{row.drift.toFixed(1)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="card">
            <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
              Unallocated Assets
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: '0.5rem' }}>({data.unallocated.length})</span>
            </h2>

            {assignTarget ? (
              <p style={{ fontSize: '0.78rem', color: 'var(--pos-bright)', marginBottom: '0.5rem' }}>
                Click a ticker to assign to <strong>{assignTarget.label}</strong>
              </p>
            ) : null}

            {data.unallocated.length === 0 ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>All tickers are allocated!</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                    onClick={() => setSelectedUnalloc(new Set(data.unallocated.map(t => t.ticker)))}
                  >Select all</button>
                  <span style={{ color: 'var(--secondary-solid)' }}>|</span>
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                    onClick={() => setSelectedUnalloc(new Set())}
                  >Deselect</button>
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
                          border: selected ? '1px solid var(--primary)' : '1px solid var(--border)',
                          background: selected ? 'rgba(25, 118, 210, 0.2)' : 'var(--bg)',
                          color: selected ? 'var(--accent-2)' : 'var(--accent-bright)',
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

                {!assignTarget && selectedUnalloc.size > 0 && assignmentTargets.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-dim-2)', display: 'block', marginBottom: '0.3rem' }}>
                      Assign {selectedUnalloc.size} selected to:
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {assignmentTargets.map(target => (
                        <button
                          key={`${target.categoryId}-${target.subId ?? 'root'}`}
                          className="btn btn-primary"
                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => handleAssign([...selectedUnalloc], target.categoryId, target.subId)}
                        >
                          {target.label}
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
          targetBaseTotal={data.categories
            .filter(c => !editCat || c.id !== editCat.id)
            .reduce((s, c) => s + (Number(c.target_pct) || 0), 0)}
          onSave={handleSave}
          onCancel={() => setShowModal(false)}
        />
      )}

      {subModal && (
        <SubcategoryModal
          subModal={subModal}
          onSave={handleSaveSub}
          onCancel={() => setSubModal(null)}
        />
      )}

      {qualityDetail && (
        <QualityDetailsModal
          row={qualityDetail}
          onClose={() => setQualityDetail(null)}
          fmt={fmt}
          fmtPct={fmtPct}
        />
      )}
    </div>
  )
}
