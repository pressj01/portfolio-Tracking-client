import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import {
  matchingMenuPreset,
  normalizeHiddenIds,
  normalizeMenuOrder,
  normalizePreset,
} from '../navigation/menuConfig'

const MenuOrderContext = createContext(null)

export function useMenuOrder() {
  const context = useContext(MenuOrderContext)
  if (!context) throw new Error('useMenuOrder must be used within MenuOrderProvider')
  return context
}

function applyPreferences(body, fallbackOrder, fallbackHidden, fallbackPreset) {
  return {
    order: normalizeMenuOrder(body?.order ?? fallbackOrder),
    hidden: normalizeHiddenIds(body?.hidden ?? fallbackHidden),
    preset: normalizePreset(body?.preset === undefined ? fallbackPreset : body.preset),
  }
}

export default function MenuOrderProvider({ children }) {
  const [menuOrder, setMenuOrder] = useState(() => normalizeMenuOrder({}))
  const [hiddenIds, setHiddenIds] = useState([])
  const [preset, setPreset] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    fetch(`${API_BASE}/api/menu-order`)
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'Could not load the saved menu order.')
        return body
      })
      .then(body => {
        if (cancelled) return
        const next = applyPreferences(body, {}, [], null)
        setMenuOrder(next.order)
        setHiddenIds(next.hidden)
        setPreset(next.preset)
      })
      .catch(error => {
        if (!cancelled) setLoadError(error.message || 'Could not load the saved menu order.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  const saveMenuPreferences = useCallback(async (next = {}) => {
    const order = normalizeMenuOrder(next.order ?? menuOrder)
    const hidden = normalizeHiddenIds(next.hidden ?? hiddenIds)
    const nextPreset = next.preset === undefined
      ? matchingMenuPreset(hidden)
      : normalizePreset(next.preset)
    const response = await fetch(`${API_BASE}/api/menu-order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order, hidden, preset: nextPreset }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || 'Could not save the menu.')
    const saved = applyPreferences(body, order, hidden, nextPreset)
    setMenuOrder(saved.order)
    setHiddenIds(saved.hidden)
    setPreset(saved.preset)
    setLoadError('')
    return saved
  }, [hiddenIds, menuOrder])

  const saveMenuOrder = useCallback(async nextOrder => {
    const saved = await saveMenuPreferences({ order: nextOrder, hidden: hiddenIds })
    return saved.order
  }, [hiddenIds, saveMenuPreferences])

  const unhidePage = useCallback(async id => {
    const hidden = hiddenIds.filter(itemId => itemId !== id)
    return saveMenuPreferences({ order: menuOrder, hidden, preset: matchingMenuPreset(hidden) })
  }, [hiddenIds, menuOrder, saveMenuPreferences])

  const value = useMemo(() => ({
    menuOrder,
    hiddenIds,
    preset,
    loading,
    loadError,
    saveMenuPreferences,
    saveMenuOrder,
    unhidePage,
  }), [hiddenIds, loadError, loading, menuOrder, preset, saveMenuOrder, saveMenuPreferences, unhidePage])

  return (
    <MenuOrderContext.Provider value={value}>
      {children}
    </MenuOrderContext.Provider>
  )
}
