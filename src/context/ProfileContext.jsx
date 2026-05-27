import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { API_BASE } from '../config'

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

  // Resolve legacy 'aggregate' selection once aggregates are loaded
  const resolvedSelection = useMemo(() => {
    if (parsed.kind === 'aggregate-legacy') {
      if (aggregates.length > 0) return { kind: 'aggregate', id: aggregates[0].id }
      return { kind: 'profile', id: 1 }
    }
    if (parsed.kind === 'aggregate' && parsed.id != null) {
      if (!aggregates.some(a => a.id === parsed.id)) {
        // Aggregate was deleted — fall back
        return { kind: 'profile', id: 1 }
      }
    }
    return parsed
  }, [parsed, aggregates])

  const isAggregate = resolvedSelection.kind === 'aggregate'
  const aggregateId = isAggregate ? resolvedSelection.id : null
  const profileId = isAggregate ? null : resolvedSelection.id

  const profileQueryString = useMemo(() => {
    const basis = `basis_mode=${basisMode}`
    return isAggregate ? `aggregate_id=${aggregateId}&${basis}` : `profile_id=${profileId}&${basis}`
  }, [isAggregate, aggregateId, profileId, basisMode])

  const activeAggregate = useMemo(() => {
    if (!isAggregate) return null
    return aggregates.find(a => a.id === aggregateId) || null
  }, [isAggregate, aggregateId, aggregates])

  const currentProfileName = useMemo(() => {
    if (isAggregate) return activeAggregate ? activeAggregate.name : 'Aggregate'
    const p = profiles.find(p => p.id === profileId)
    return p ? p.name : 'Portfolio'
  }, [isAggregate, activeAggregate, profileId, profiles])

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
        return list
      })
      .catch(() => [])
  }, [])

  // Back-compat alias for callers still named refreshAggregateConfig
  const refreshAggregateConfig = refreshAggregates

  const setProfileId = useCallback((rawSelection) => {
    let val
    if (typeof rawSelection === 'string' && (rawSelection.startsWith('p:') || rawSelection.startsWith('a:'))) {
      val = rawSelection
    } else if (rawSelection === 'aggregate') {
      val = 'aggregate' // legacy, will be resolved
    } else {
      val = `p:${rawSelection}`
    }
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
