import { useCallback, useState } from 'react'
import { useProfile } from '../context/ProfileContext'

// Scan results live in component state, so leaving a scanner — to look at a trade
// on the risk graph, say — used to throw them away and force a re-scan. This
// parks the last result set per scanner so coming back restores it.
//
// sessionStorage, not localStorage: a scan is a snapshot of live option quotes
// and has no business outliving the app session.
const PREFIX = 'scanResults:'
// Option quotes move. Past this the snapshot is dropped rather than shown, so a
// scanner opened hours later starts clean instead of quietly serving stale prices.
const MAX_AGE_MS = 2 * 60 * 60 * 1000

// Reads the external store and expires the snapshot. Impure by nature, so it is
// only ever called from a lazy useState initializer — never from render.
function readSnapshot(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - Number(parsed?.cached_at || 0) > MAX_AGE_MS) {
      sessionStorage.removeItem(key)
      return null
    }
    return parsed?.results || null
  } catch {
    return null
  }
}

/**
 * Cache one scanner's last results for the current profile.
 *
 * Returns `[cached, save]` — read `cached` in the results useState initializers,
 * call `save` with the same shape once a scan succeeds. `cached` is resolved once
 * on mount, which is exactly when the scanner needs it to seed its state.
 */
export function useScanCache(name) {
  const { profileQueryString } = useProfile()
  // Results depend on the selected profile (holdings and watchlist universes), so
  // a snapshot must never be restored under a different one.
  const key = `${PREFIX}${name}:${profileQueryString}`

  const [cached] = useState(() => readSnapshot(key))

  const save = useCallback(results => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ cached_at: Date.now(), results }))
    } catch {
      // Quota or a storage-less environment. Caching is an optimisation, never a
      // requirement — the scan still rendered.
    }
  }, [key])

  return [cached, save]
}
