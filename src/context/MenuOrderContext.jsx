import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import { normalizeMenuOrder } from '../navigation/menuConfig'

const MenuOrderContext = createContext(null)

export function useMenuOrder() {
  const context = useContext(MenuOrderContext)
  if (!context) throw new Error('useMenuOrder must be used within MenuOrderProvider')
  return context
}

export default function MenuOrderProvider({ children }) {
  const [menuOrder, setMenuOrder] = useState(() => normalizeMenuOrder({}))
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
        if (!cancelled) setMenuOrder(normalizeMenuOrder(body.order))
      })
      .catch(error => {
        if (!cancelled) setLoadError(error.message || 'Could not load the saved menu order.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  const saveMenuOrder = useCallback(async nextOrder => {
    const normalized = normalizeMenuOrder(nextOrder)
    const response = await fetch(`${API_BASE}/api/menu-order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: normalized }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || 'Could not save the menu order.')
    const saved = normalizeMenuOrder(body.order || normalized)
    setMenuOrder(saved)
    setLoadError('')
    return saved
  }, [])

  const value = useMemo(() => ({
    menuOrder,
    loading,
    loadError,
    saveMenuOrder,
  }), [menuOrder, loading, loadError, saveMenuOrder])

  return (
    <MenuOrderContext.Provider value={value}>
      {children}
    </MenuOrderContext.Provider>
  )
}
