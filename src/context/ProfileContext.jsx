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

export default function ProfileProvider({ children }) {
  const [profiles, setProfiles] = useState([])
  const [selection, setSelection] = useState(() => {
    return localStorage.getItem('portfolio_selectedProfileId') || '1'
  })
  const [aggregateConfig, setAggregateConfig] = useState([])
  const [aggregateName, setAggregateName] = useState('Aggregate')

  const isAggregate = selection === 'aggregate'
  const profileId = isAggregate ? null : parseInt(selection, 10)

  const profileQueryString = useMemo(() => {
    return isAggregate ? 'aggregate=true' : `profile_id=${profileId}`
  }, [isAggregate, profileId])

  const currentProfileName = useMemo(() => {
    if (isAggregate) return aggregateName
    const p = profiles.find(p => p.id === profileId)
    return p ? p.name : 'Portfolio'
  }, [isAggregate, aggregateName, profileId, profiles])

  const refreshProfiles = useCallback(() => {
    return fetch(`${API_BASE}/api/profiles`)
      .then(r => r.json())
      .then(data => {
        setProfiles(data)
        return data
      })
      .catch(() => [])
  }, [])

  const refreshAggregateConfig = useCallback(() => {
    return fetch(`${API_BASE}/api/aggregate-config`)
      .then(r => r.json())
      .then(data => {
        setAggregateConfig(data.member_ids || [])
        setAggregateName(data.name || 'Aggregate')
        return data.member_ids || []
      })
      .catch(() => [])
  }, [])

  const setProfileId = useCallback((id) => {
    const val = String(id)
    setSelection(val)
    localStorage.setItem('portfolio_selectedProfileId', val)
  }, [])

  useEffect(() => {
    refreshProfiles()
    refreshAggregateConfig()
  }, [refreshProfiles, refreshAggregateConfig])

  // If the selected profile was deleted, reset to 1
  useEffect(() => {
    if (!isAggregate && profiles.length > 0 && !profiles.find(p => p.id === profileId)) {
      setProfileId('1')
    }
  }, [profiles, profileId, isAggregate, setProfileId])

  // If aggregate is deleted while selected, reset to 1
  useEffect(() => {
    if (isAggregate && aggregateConfig.length === 0) {
      setProfileId('1')
    }
  }, [isAggregate, aggregateConfig, setProfileId])

  const value = useMemo(() => ({
    profileId,
    profiles,
    isAggregate,
    aggregateConfig,
    aggregateName,
    selection,
    profileQueryString,
    currentProfileName,
    setProfileId,
    refreshProfiles,
    refreshAggregateConfig,
  }), [profileId, profiles, isAggregate, aggregateConfig, aggregateName, selection, profileQueryString, currentProfileName, setProfileId, refreshProfiles, refreshAggregateConfig])

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  )
}
