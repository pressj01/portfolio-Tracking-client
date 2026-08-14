// Bumped whenever the cached payload shape changes, which retires old entries.
// Dashboard.jsx must build its key from dashboardCacheKey() rather than
// repeating the literal: when it moved to v17 on its own, every clear helper
// here kept filtering for v16 and silently matched nothing, so an edit on the
// Manage Holdings screen never actually dropped the Dashboard's cached copy.
export const CACHE_PREFIX = 'portfolio_dashboard_v18_'

export function dashboardCacheKey(selection, basisMode) {
  return `${CACHE_PREFIX}${selection}_${basisMode}`
}

const DASHBOARD_CACHE_TTL_MS = 60 * 60 * 1000

export function readDashboardCache(key) {
  try {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached?.ts || Date.now() - cached.ts > DASHBOARD_CACHE_TTL_MS) {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
      return null
    }
    return cached.data || null
  } catch {
    return null
  }
}

export function writeDashboardCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // best-effort
  }
}

export function clearAggregateDashboardCache() {
  try {
    const prefix = `${CACHE_PREFIX}a:`
    const toRemove = Object.keys(localStorage).filter(k => k.startsWith(prefix))
    toRemove.forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k) })
  } catch {
    // best-effort
  }
}

// Clear cache for a specific selection (e.g. 'p:1' for Owner, 'a:5' for an aggregate).
export function clearDashboardCacheForSelection(selectionKey) {
  if (!selectionKey) return
  try {
    const prefix = `${CACHE_PREFIX}${selectionKey}`
    const toRemove = Object.keys(localStorage).filter(k => k.startsWith(prefix))
    toRemove.forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k) })
  } catch {
    // best-effort
  }
}

export function clearAllDashboardCache() {
  try {
    const stores = [localStorage, sessionStorage]
    stores.forEach(store => {
      Object.keys(store)
        .filter(k => k.startsWith(CACHE_PREFIX))
        .forEach(k => store.removeItem(k))
    })
  } catch {
    // best-effort
  }
}
