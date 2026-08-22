import { useMemo, useState } from 'react'
import { useMenuOrder } from '../context/MenuOrderContext'
import {
  MENU_ORDER_SCOPES,
  MENU_PRESETS,
  isMenuIdProtected,
  matchingMenuPreset,
  normalizeHiddenIds,
  normalizeMenuOrder,
} from '../navigation/menuConfig'
import { paletteShortcutLabel } from '../utils/commandPalette'

const serializePrefs = (order, hidden) => JSON.stringify({
  order: normalizeMenuOrder(order),
  hidden: normalizeHiddenIds(hidden),
})

export default function MenuControl() {
  const menuOrderState = useMenuOrder()

  if (menuOrderState.loading) {
    return (
      <div className="page menu-control-page">
        <h1>Menu Control</h1>
        <div className="card menu-control-loading">Loading saved menu…</div>
      </div>
    )
  }

  return <MenuControlEditor {...menuOrderState} />
}

function MenuControlEditor({ menuOrder, hiddenIds, loadError, saveMenuPreferences }) {
  const [selectedScopeId, setSelectedScopeId] = useState(MENU_ORDER_SCOPES[0].id)
  const [draftOrder, setDraftOrder] = useState(() => normalizeMenuOrder(menuOrder))
  const [draftHidden, setDraftHidden] = useState(() => normalizeHiddenIds(hiddenIds))
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  const selectedScope = MENU_ORDER_SCOPES.find(scope => scope.id === selectedScopeId)
    || MENU_ORDER_SCOPES[0]
  const itemById = useMemo(
    () => new Map(selectedScope.items.map(item => [item.id, item])),
    [selectedScope],
  )
  const orderedIds = draftOrder[selectedScope.id] || []
  const hiddenSet = useMemo(() => new Set(draftHidden), [draftHidden])
  const dirty = serializePrefs(draftOrder, draftHidden) !== serializePrefs(menuOrder, hiddenIds)
  const activePreset = matchingMenuPreset(draftHidden)
  const shortcut = paletteShortcutLabel()
  const hiddenInScope = orderedIds.filter(id => hiddenSet.has(id)).length

  const moveItem = (fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= orderedIds.length) return
    setDraftOrder(current => {
      const nextIds = [...(current[selectedScope.id] || [])]
      const [moved] = nextIds.splice(fromIndex, 1)
      nextIds.splice(toIndex, 0, moved)
      return { ...current, [selectedScope.id]: nextIds }
    })
    setStatus(null)
  }

  const handleDrop = (event, toIndex) => {
    event.preventDefault()
    if (draggedIndex != null) moveItem(draggedIndex, toIndex)
    setDraggedIndex(null)
  }

  const toggleHidden = (id) => {
    if (isMenuIdProtected(id)) return
    setDraftHidden(current => (
      current.includes(id) ? current.filter(itemId => itemId !== id) : [...current, id]
    ))
    setStatus(null)
  }

  const applyPreset = (presetId) => {
    if (!presetId) {
      setDraftHidden([])
    } else {
      const preset = MENU_PRESETS.find(item => item.id === presetId)
      setDraftHidden(preset ? [...preset.hidden] : [])
    }
    setStatus({
      type: 'info',
      message: 'Preset applied in the editor. Select Save Changes to update the navigation.',
    })
  }

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const saved = await saveMenuPreferences({
        order: draftOrder,
        hidden: draftHidden,
        preset: matchingMenuPreset(draftHidden),
      })
      setDraftOrder(saved.order)
      setDraftHidden(saved.hidden)
      setStatus({ type: 'success', message: 'Menu saved. The navigation has been updated.' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not save the menu.' })
    } finally {
      setSaving(false)
    }
  }

  const restoreDefaults = () => {
    setDraftOrder(normalizeMenuOrder({}))
    setDraftHidden([])
    setStatus({ type: 'info', message: 'Built-in order and visibility restored in the editor. Select Save Changes to apply it.' })
  }

  const discardChanges = () => {
    setDraftOrder(normalizeMenuOrder(menuOrder))
    setDraftHidden(normalizeHiddenIds(hiddenIds))
    setStatus(null)
  }

  return (
    <div className="page menu-control-page">
      <div className="menu-control-heading">
        <div>
          <h1>Menu Control</h1>
          <p>
            Reorder pages, hide ones you do not use, or apply a role preset.
            Hidden pages stay reachable from the command palette ({shortcut}).
            Select Save Changes to update the navigation.
          </p>
        </div>
        <div className="menu-control-actions">
          <button className="btn btn-secondary" type="button" onClick={restoreDefaults} disabled={saving}>
            Restore Defaults
          </button>
          <button className="btn btn-secondary" type="button" onClick={discardChanges} disabled={saving || !dirty}>
            Discard Changes
          </button>
          <button className="btn btn-primary" type="button" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="alert alert-error" role="alert">
          {loadError} The built-in menu is being shown.
        </div>
      )}
      {status && (
        <div className={`alert alert-${status.type}`} role="status" aria-live="polite">
          {status.message}
        </div>
      )}

      <section className="card menu-control-presets" aria-label="Role presets">
        <div>
          <h2>Role preset</h2>
          <p>Starts from a bundled hide list. You can still show or hide individual pages after applying one.</p>
        </div>
        <div className="menu-control-preset-buttons">
          <button
            type="button"
            className={!activePreset ? 'active' : ''}
            onClick={() => applyPreset(null)}
          >
            Show all
          </button>
          {MENU_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className={activePreset === preset.id ? 'active' : ''}
              title={preset.description}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {activePreset && (
          <p className="menu-control-preset-note">
            {MENU_PRESETS.find(preset => preset.id === activePreset)?.description}
          </p>
        )}
      </section>

      <div className="menu-control-layout">
        <aside className="card menu-control-sections" aria-label="Menu sections">
          <h2>Menus</h2>
          {MENU_ORDER_SCOPES.map(scope => {
            const hiddenCount = (draftOrder[scope.id] || []).filter(id => hiddenSet.has(id)).length
            return (
              <button
                key={scope.id}
                type="button"
                className={scope.id === selectedScope.id ? 'active' : ''}
                onClick={() => {
                  setSelectedScopeId(scope.id)
                  setDraggedIndex(null)
                }}
              >
                <span>{scope.label}</span>
                {hiddenCount > 0 && <span className="menu-control-hidden-count">{hiddenCount} hidden</span>}
              </button>
            )
          })}
        </aside>

        <section className="card menu-control-editor">
          <div className="menu-control-editor-heading">
            <div>
              <h2>{selectedScope.label}</h2>
              <p>{selectedScope.description} Hidden pages stay in this list so you can show them again.</p>
            </div>
            <span>
              {orderedIds.length} {orderedIds.length === 1 ? 'item' : 'items'}
              {hiddenInScope ? ` · ${hiddenInScope} hidden` : ''}
            </span>
          </div>

          <ol className="menu-order-list">
            {orderedIds.map((id, index) => {
              const item = itemById.get(id)
              if (!item) return null
              const hidden = hiddenSet.has(id)
              const protectedId = isMenuIdProtected(id)
              const hideTitle = protectedId
                ? 'This page always stays in the menu'
                : hidden
                  ? `Show ${item.label} in the menu`
                  : `Hide ${item.label} from the menu`
              return (
                <li
                  key={id}
                  draggable
                  className={`${draggedIndex === index ? 'dragging' : ''}${hidden ? ' is-hidden' : ''}`}
                  onDragStart={event => {
                    setDraggedIndex(index)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', id)
                  }}
                  onDragOver={event => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={event => handleDrop(event, index)}
                  onDragEnd={() => setDraggedIndex(null)}
                >
                  <span className="menu-order-position" aria-hidden="true">{index + 1}</span>
                  <span className="menu-order-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
                  <span className="menu-order-label">
                    {item.label}
                    {hidden && <span className="menu-order-hidden-tag">Hidden</span>}
                  </span>
                  <div className="menu-order-buttons">
                    <button
                      type="button"
                      className={`menu-order-visibility${hidden ? ' is-on' : ''}`}
                      onClick={() => toggleHidden(id)}
                      disabled={protectedId}
                      aria-pressed={hidden}
                      aria-label={hideTitle}
                      title={hideTitle}
                    >
                      {hidden ? 'Show' : 'Hide'}
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${item.label} up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(index, index + 1)}
                      disabled={index === orderedIds.length - 1}
                      aria-label={`Move ${item.label} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      </div>
    </div>
  )
}
