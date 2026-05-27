const CACHE_PREFIX = 'portfolio_dashboard_v13_'

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
