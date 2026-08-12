import { useEffect, useRef, useState } from 'react'
import {
  EMPTY_LAYOUT,
  moveKey,
  normalizeLayout,
  parseLayout,
  resolveColumns,
  sameLayout,
} from './columnLayout.js'

// Impure by nature, so it is only ever called from a lazy useState initializer
// or an event handler — never from render.
const readStored = (storageKey, migrate) => {
  if (typeof window === 'undefined') return null
  try {
    return parseLayout(window.localStorage.getItem(storageKey), migrate)
  } catch {
    return null
  }
}

// An empty layout means "every column, in definition order". A screen whose
// out-of-the-box view hides part of the list passes `defaultLayout` instead,
// either as a layout or as a function of the full key list.
const resolveDefaultLayout = (defaultLayout, allKeys) => {
  const resolved = typeof defaultLayout === 'function' ? defaultLayout(allKeys) : defaultLayout
  return normalizeLayout(resolved) || EMPTY_LAYOUT
}

/**
 * Per-table column visibility and drag-and-drop ordering, persisted per screen.
 *
 * Pass the column definitions and a storage key; render `activeColumns` instead
 * of the raw list, spread `dragHandlers(key)` onto each header cell, and hand
 * the whole return value to <ColumnCustomizer /> for the picker panel.
 */
export function useColumnLayout({
  storageKey,
  columns,
  keyField = 'key',
  lockedKeys,
  migrate,
  defaultLayout,
}) {
  const allKeys = columns.map(col => col?.[keyField])
  // Resolved once, from the first render's column list: the defaults describe
  // the screen, not whatever data happens to be loaded.
  const [defaults] = useState(() => resolveDefaultLayout(defaultLayout, allKeys))
  const [layout, setLayout] = useState(() => readStored(storageKey, migrate) || defaults)
  const [dragKey, setDragKey] = useState(null)
  const [dropKey, setDropKey] = useState(null)

  const locked = new Set(lockedKeys || [])
  const { ordered, visible, hiddenKeys } = resolveColumns(columns, layout, {
    keyField,
    lockedKeys: lockedKeys || [],
  })
  const orderedKeys = ordered.map(col => col?.[keyField])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout))
    } catch {
      // Quota or a storage-less environment. Persistence is a convenience; the
      // table still renders from the layout held in state.
    }
  }, [storageKey, layout])

  // Keep two windows of the app on the same machine in step. The storage event
  // updates a window that is already open; re-reading on focus covers one that
  // was suspended while another window changed the layout.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const apply = (raw) => {
      const next = parseLayout(raw, migrate) || defaults
      setLayout(prev => (sameLayout(prev, next) ? prev : next))
    }
    const handleStorage = (event) => {
      if (event.storageArea !== window.localStorage || event.key !== storageKey) return
      apply(event.newValue)
    }
    const handleFocus = () => {
      try {
        apply(window.localStorage.getItem(storageKey))
      } catch {
        // Ignore — the in-memory layout stays authoritative.
      }
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', handleFocus)
    }
    // `migrate` is a module-level helper at every call site, and `defaults` is
    // resolved once and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const moveColumn = (fromKey, toKey) => {
    const next = moveKey(orderedKeys, fromKey, toKey)
    if (next === orderedKeys) return
    setLayout(prev => ({ ...prev, order: next }))
  }

  const moveColumnBy = (key, delta) => {
    const index = orderedKeys.indexOf(key)
    const target = index + delta
    if (index < 0 || target < 0 || target >= orderedKeys.length) return
    moveColumn(key, orderedKeys[target])
  }

  const toggleColumn = (key) => {
    if (locked.has(key)) return
    setLayout(prev => {
      const hidden = new Set(prev.hidden)
      if (hidden.has(key)) hidden.delete(key)
      else hidden.add(key)
      return { ...prev, hidden: [...hidden] }
    })
  }

  const showAllColumns = () => {
    setLayout(prev => (prev.hidden.length ? { ...prev, hidden: [] } : prev))
  }

  const resetLayout = () => {
    setLayout(prev => (sameLayout(prev, defaults) ? prev : defaults))
  }

  // A preset names the columns it wants visible, in the order it wants them.
  // Locked columns survive a preset that forgets to list them.
  const applyPreset = (keys) => {
    const wanted = [...new Set(keys)].filter(key => allKeys.includes(key))
    const missingLocked = allKeys.filter(key => locked.has(key) && !wanted.includes(key))
    const shown = [...missingLocked, ...wanted]
    const hidden = allKeys.filter(key => !shown.includes(key))
    setLayout({ order: [...shown, ...hidden], hidden })
  }

  // The only legitimate ref here: the drag source is written and read inside
  // drag events, never during render.
  const dragKeyRef = useRef(null)
  const dragHandlers = (key) => ({
    draggable: true,
    onDragStart: (event) => {
      dragKeyRef.current = key
      setDragKey(key)
      event.dataTransfer.effectAllowed = 'move'
      try {
        // Firefox refuses to start a drag when no payload is set.
        event.dataTransfer.setData('text/plain', key)
      } catch {
        // Some engines lock dataTransfer during dragstart; the ref is the real
        // source of truth for the drop.
      }
    },
    onDragOver: (event) => {
      if (!dragKeyRef.current || dragKeyRef.current === key) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropKey(current => (current === key ? current : key))
    },
    onDragLeave: () => setDropKey(current => (current === key ? null : current)),
    onDrop: (event) => {
      event.preventDefault()
      event.stopPropagation()
      moveColumn(dragKeyRef.current, key)
      dragKeyRef.current = null
      setDragKey(null)
      setDropKey(null)
    },
    onDragEnd: () => {
      dragKeyRef.current = null
      setDragKey(null)
      setDropKey(null)
    },
  })

  const dragClass = (key, base) => {
    const classes = [base]
    if (dragKey === key) classes.push('col-drag-source')
    else if (dropKey === key && dragKey) classes.push('col-drag-target')
    return classes.filter(Boolean).join(' ') || undefined
  }

  return {
    columns: ordered,
    activeColumns: visible,
    keyField,
    hiddenCount: hiddenKeys.size,
    isHidden: key => hiddenKeys.has(key),
    isLocked: key => locked.has(key),
    toggleColumn,
    moveColumn,
    moveColumnBy,
    showAllColumns,
    resetLayout,
    applyPreset,
    dragHandlers,
    dragClass,
    dragKey,
    dropKey,
  }
}
