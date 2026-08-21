import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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

  // Automatic end-of-day NAV capture. Once the regular session has closed on a
  // trading day, record the official closing NAV (overwriting any intraday
  // value taken earlier that day). Fires on mount -- so a close is caught up the
  // next time the app opens even if it was shut at 4pm -- and every 10 minutes
  // while the app stays open. All gating (trading day / past close / already
  // captured) is server-side, so this is a cheap no-op until the actual close.
  useEffect(() => {
    let cancelled = false
    const attempt = () => {
      pf('/api/nav/auto-capture', { method: 'POST' })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (cancelled || !data?.captured) return
          clearAllDashboardCache()
          setMessage('Recorded end-of-day NAV.')
          window.dispatchEvent(new CustomEvent('nav-auto-captured', { detail: data }))
        })
        .catch(() => {})
    }
    attempt()
    const id = setInterval(attempt, 10 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [pf])

  // Daily IV Rank collector. Scans only record ATM IV for the names they
  // price, and generic scans used to hard-cap at 40 symbols, so rank never
  // warmed up. Poll until today's universe is collected.
  useEffect(() => {
    let cancelled = false
    let running = false
    const controller = new AbortController()
    const collect = async () => {
      if (cancelled || running) return
      running = true
      let remaining = null
      try {
        while (!cancelled) {
          const options = { method: 'POST', signal: controller.signal }
          if (remaining) {
            options.headers = { 'Content-Type': 'application/json' }
            options.body = JSON.stringify({ tickers: remaining })
          }
          const res = await pf('/api/iv-rank/collect', options)
          const data = res.ok ? await res.json() : null
          if (cancelled || !data || data.skipped || data.done) return
          remaining = Array.isArray(data.remaining) ? data.remaining : []
          if (remaining.length === 0) return
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      } catch {
        // A later interval retries transient Yahoo/backend failures.
      } finally {
        running = false
      }
    }
    collect()
    const id = setInterval(collect, 10 * 60 * 1000)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(id)
    }
  }, [pf])

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
