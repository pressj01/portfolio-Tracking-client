import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { API_BASE } from '../config'
import { clearAggregateDashboardCache } from '../utils/dashboardCache'

const ProfileContext = createContext(null)

export function useProfile() {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used within ProfileProvider')
  return ctx
}

export function useProfileFetch() {
  const { profileQueryString } = useProfile()
  return useCallback((path, options) => {
    const sep = path.includes('?') ? '&' : '?'
    return fetch(`${API_BASE}${path}${sep}${profileQueryString}`, options)
  }, [profileQueryString])
}

// Selection encoding:
//   profile:  `p:<id>` (legacy bare integers and 'aggregate' still readable)
//   aggregate: `a:<id>`
function parseSelection(raw) {
  if (!raw) return { kind: 'profile', id: 1 }
  if (raw === 'aggregate') return { kind: 'aggregate-legacy' }
  if (raw.startsWith('a:')) {
    const id = parseInt(raw.slice(2), 10)
    return { kind: 'aggregate', id: Number.isFinite(id) ? id : null }
  }
  if (raw.startsWith('p:')) {
    const id = parseInt(raw.slice(2), 10)
    return { kind: 'profile', id: Number.isFinite(id) ? id : 1 }
  }
  const id = parseInt(raw, 10)
  return { kind: 'profile', id: Number.isFinite(id) ? id : 1 }
}

function encodeSelection(rawSelection) {
  if (typeof rawSelection === 'string' && (rawSelection.startsWith('p:') || rawSelection.startsWith('a:'))) {
    return rawSelection
  }
  if (rawSelection === 'aggregate') return 'aggregate'
  return `p:${rawSelection}`
}

function resolveSelection(parsed, aggregates) {
  if (parsed.kind === 'aggregate-legacy') {
    if (aggregates.length > 0) return { kind: 'aggregate', id: aggregates[0].id }
    return { kind: 'profile', id: 1 }
  }
  if (parsed.kind === 'aggregate' && parsed.id != null) {
    if (!aggregates.some(a => a.id === parsed.id)) {
      return { kind: 'profile', id: 1 }
    }
  }
  return parsed
}

function viewFromResolved(resolved, profiles, aggregates, basisMode, selection) {
  const isAggregate = resolved.kind === 'aggregate'
  const aggregateId = isAggregate ? resolved.id : null
  const profileId = isAggregate ? null : resolved.id
  const basis = `basis_mode=${basisMode}`
  const profileQueryString = isAggregate
    ? `aggregate_id=${aggregateId}&${basis}`
    : `profile_id=${profileId}&${basis}`
  const activeAggregate = isAggregate
    ? (aggregates.find(a => a.id === aggregateId) || null)
    : null
  const currentProfileName = isAggregate
    ? (activeAggregate ? activeAggregate.name : 'Aggregate')
    : (profiles.find(p => p.id === profileId)?.name || 'Portfolio')
  return {
    selection,
    isAggregate,
    aggregateId,
    profileId,
    profileQueryString,
    activeAggregate,
    currentProfileName,
  }
}

/**
 * Override the selected portfolio for a subtree without changing the window's
 * navbar account. Split View uses this so each pane can show a different
 * account while still sharing basis mode and the performance date range.
 */
export function ProfileScope({ selection: scopedSelection, onSelectionChange, children }) {
  const parent = useProfile()
  const selection = scopedSelection || parent.selection
  const parsed = useMemo(() => parseSelection(selection), [selection])
  const resolved = useMemo(
    () => resolveSelection(parsed, parent.aggregates),
    [parsed, parent.aggregates],
  )
  const view = useMemo(
    () => viewFromResolved(
      resolved, parent.profiles, parent.aggregates, parent.basisMode, selection,
    ),
    [resolved, parent.profiles, parent.aggregates, parent.basisMode, selection],
  )

  const setProfileId = useCallback((rawSelection) => {
    const val = encodeSelection(rawSelection)
    if (onSelectionChange) onSelectionChange(val)
    else parent.setProfileId(val)
  }, [onSelectionChange, parent])

  const setAggregateSelection = useCallback((aggId) => {
    setProfileId(`a:${aggId}`)
  }, [setProfileId])

  const value = useMemo(() => ({
    ...parent,
    ...view,
    setProfileId,
    setAggregateSelection,
  }), [parent, view, setProfileId, setAggregateSelection])

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  )
}

export default function ProfileProvider({ children }) {
  const [profiles, setProfiles] = useState([])
  const [aggregates, setAggregates] = useState([]) // [{id, name, member_ids}]
  const [selection, setSelection] = useState(() => {
    return localStorage.getItem('portfolio_selectedProfileId') || 'p:1'
  })
  const [basisMode, setBasisModeState] = useState(() => {
    return localStorage.getItem('portfolio_basisMode') || 'original'
  })

  const parsed = useMemo(() => parseSelection(selection), [selection])
  const resolvedSelection = useMemo(
    () => resolveSelection(parsed, aggregates),
    [parsed, aggregates],
  )
  const {
    isAggregate,
    aggregateId,
    profileId,
    profileQueryString,
    activeAggregate,
    currentProfileName,
  } = useMemo(
    () => viewFromResolved(resolvedSelection, profiles, aggregates, basisMode, selection),
    [resolvedSelection, profiles, aggregates, basisMode, selection],
  )

  // Compatibility: components reading legacy `aggregateConfig`/`aggregateName`
  // get the currently-selected aggregate's data, or the first aggregate.
  const legacyAggregate = useMemo(() => {
    if (activeAggregate) return activeAggregate
    return aggregates[0] || null
  }, [activeAggregate, aggregates])
  const aggregateConfig = legacyAggregate ? legacyAggregate.member_ids : []
  const aggregateName = legacyAggregate ? legacyAggregate.name : 'Aggregate'

  const refreshProfiles = useCallback(() => {
    return fetch(`${API_BASE}/api/profiles`)
      .then(r => r.json())
      .then(data => {
        setProfiles(data)
        return data
      })
      .catch(() => [])
  }, [])

  const refreshAggregates = useCallback(() => {
    return fetch(`${API_BASE}/api/aggregates`)
      .then(r => r.json())
      .then(data => {
        const list = data.aggregates || []
        setAggregates(list)
        clearAggregateDashboardCache()
        return list
      })
      .catch(() => [])
  }, [])

  // Back-compat alias for callers still named refreshAggregateConfig
  const refreshAggregateConfig = refreshAggregates

  const setProfileId = useCallback((rawSelection) => {
    const val = encodeSelection(rawSelection)
    setSelection(val)
    localStorage.setItem('portfolio_selectedProfileId', val)
  }, [])

  const setAggregateSelection = useCallback((aggId) => {
    const val = `a:${aggId}`
    setSelection(val)
    localStorage.setItem('portfolio_selectedProfileId', val)
  }, [])

  const setBasisMode = useCallback((mode) => {
    const val = mode === 'broker_adjusted' ? 'broker_adjusted' : 'original'
    setBasisModeState(val)
    localStorage.setItem('portfolio_basisMode', val)
  }, [])

  useEffect(() => {
    refreshProfiles()
    refreshAggregates()
  }, [refreshProfiles, refreshAggregates])

  // If the selected profile was deleted, reset to 1
  useEffect(() => {
    if (!isAggregate && profiles.length > 0 && !profiles.find(p => p.id === profileId)) {
      setProfileId('1')
    }
  }, [profiles, profileId, isAggregate, setProfileId])

  const value = useMemo(() => ({
    profileId,
    profiles,
    aggregates,
    aggregateId,
    activeAggregate,
    isAggregate,
    aggregateConfig,
    aggregateName,
    selection,
    basisMode,
    profileQueryString,
    currentProfileName,
    setProfileId,
    setAggregateSelection,
    setBasisMode,
    refreshProfiles,
    refreshAggregates,
    refreshAggregateConfig,
  }), [profileId, profiles, aggregates, aggregateId, activeAggregate, isAggregate, aggregateConfig, aggregateName, selection, basisMode, profileQueryString, currentProfileName, setProfileId, setAggregateSelection, setBasisMode, refreshProfiles, refreshAggregates, refreshAggregateConfig])

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  )
}
