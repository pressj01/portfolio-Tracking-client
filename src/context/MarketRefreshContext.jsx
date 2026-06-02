import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useProfile, useProfileFetch } from './ProfileContext'
import { clearAllDashboardCache } from '../utils/dashboardCache'

const MarketRefreshContext = createContext(null)

export function useMarketRefresh() {
  const ctx = useContext(MarketRefreshContext)
  if (!ctx) throw new Error('useMarketRefresh must be used within MarketRefreshProvider')
  return ctx
}

function parseJsonResponse(res) {
  return res.json().then(data => {
    if (!res.ok) throw new Error(data?.error || `Refresh failed (${res.status})`)
    return data
  })
}

export default function MarketRefreshProvider({ children }) {
  const pf = useProfileFetch()
  const { profileQueryString } = useProfile()
  const refreshRef = useRef(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [message, setMessage] = useState(null)
  const [lastResult, setLastResult] = useState(null)

  const runMarketRefresh = useCallback((options = {}) => {
    const key = profileQueryString
    if (refreshRef.current?.promise) {
      if (refreshRef.current.key === key) return refreshRef.current.promise
      return refreshRef.current.promise
        .catch(() => null)
        .then(() => runMarketRefresh(options))
    }

    const promise = pf('/api/refresh', { method: 'POST' })
      .then(parseJsonResponse)
      .then(data => {
        setLastResult(data)
        setMessage(data.message || null)
        clearAllDashboardCache()
        return data
      })
      .catch(err => {
        setMessage(err.message || 'Refresh failed.')
        throw err
      })
      .finally(() => {
        if (refreshRef.current?.key === key) {
          refreshRef.current = null
          setIsRefreshing(false)
        }
      })

    refreshRef.current = { key, promise }
    setIsRefreshing(true)
    setMessage(options.statusMessage || 'Updating prices & dividends...')
    return promise
  }, [pf, profileQueryString])

  const waitForMarketRefresh = useCallback(async () => {
    const pending = refreshRef.current?.promise
    if (!pending) return null
    try {
      return await pending
    } catch {
      return null
    }
  }, [])

  const value = useMemo(() => ({
    isRefreshing,
    message,
    lastResult,
    runMarketRefresh,
    waitForMarketRefresh,
  }), [isRefreshing, message, lastResult, runMarketRefresh, waitForMarketRefresh])

  return (
    <MarketRefreshContext.Provider value={value}>
      {children}
    </MarketRefreshContext.Provider>
  )
}
