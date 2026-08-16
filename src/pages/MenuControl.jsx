import { useMemo, useState } from 'react'
import { useMenuOrder } from '../context/MenuOrderContext'
import {
  MENU_ORDER_SCOPES,
  normalizeMenuOrder,
} from '../navigation/menuConfig'

const serializeOrder = order => JSON.stringify(normalizeMenuOrder(order))

export default function MenuControl() {
  const menuOrderState = useMenuOrder()

  if (menuOrderState.loading) {
    return (
      <div className="page menu-control-page">
        <h1>Menu Control</h1>
        <div className="card menu-control-loading">Loading saved order…</div>
      </div>
    )
  }

  return <MenuControlEditor {...menuOrderState} />
}

function MenuControlEditor({ menuOrder, loadError, saveMenuOrder }) {
  const [selectedScopeId, setSelectedScopeId] = useState(MENU_ORDER_SCOPES[0].id)
  const [draftOrder, setDraftOrder] = useState(() => normalizeMenuOrder(menuOrder))
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
  const dirty = serializeOrder(draftOrder) !== serializeOrder(menuOrder)

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

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const saved = await saveMenuOrder(draftOrder)
      setDraftOrder(saved)
      setStatus({ type: 'success', message: 'Menu order saved. The navigation has been updated.' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Could not save the menu order.' })
    } finally {
      setSaving(false)
    }
  }

  const restoreDefaults = () => {
    setDraftOrder(normalizeMenuOrder({}))
    setStatus({ type: 'info', message: 'Built-in order restored in the editor. Select Save Changes to apply it.' })
  }

  const discardChanges = () => {
    setDraftOrder(normalizeMenuOrder(menuOrder))
    setStatus(null)
  }

  return (
    <div className="page menu-control-page">
      <div className="menu-control-heading">
        <div>
          <h1>Menu Control</h1>
          <p>
            Choose a menu, then drag its items into position or use the arrow buttons.
            Items stay in their current menu so every page remains easy to find.
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
          {loadError} The built-in order is being shown.
        </div>
      )}
      {status && (
        <div className={`alert alert-${status.type}`} role="status" aria-live="polite">
          {status.message}
        </div>
      )}

      <div className="menu-control-layout">
        <aside className="card menu-control-sections" aria-label="Menu sections">
          <h2>Menus</h2>
          {MENU_ORDER_SCOPES.map(scope => (
            <button
              key={scope.id}
              type="button"
              className={scope.id === selectedScope.id ? 'active' : ''}
              onClick={() => {
                setSelectedScopeId(scope.id)
                setDraggedIndex(null)
              }}
            >
              {scope.label}
            </button>
          ))}
        </aside>

        <section className="card menu-control-editor">
          <div className="menu-control-editor-heading">
            <div>
              <h2>{selectedScope.label}</h2>
              <p>{selectedScope.description}</p>
            </div>
            <span>{orderedIds.length} {orderedIds.length === 1 ? 'item' : 'items'}</span>
          </div>

          <ol className="menu-order-list">
              {orderedIds.map((id, index) => {
                const item = itemById.get(id)
                if (!item) return null
                return (
                  <li
                    key={id}
                    draggable
                    className={draggedIndex === index ? 'dragging' : ''}
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
                    <span className="menu-order-label">{item.label}</span>
                    <div className="menu-order-buttons">
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
