import { useCallback, useEffect, useRef, useState } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { addCustomRangeParams } from './performancePeriods'

const cache = new Map()
const EVENT = 'nav-assessment-updated'

export async function readNavJson(response) {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'NAV assessment could not be loaded.')
  if (data.error) throw new Error(data.error)
  return data
}

export function invalidateNavAssessment() {
  cache.clear()
  window.dispatchEvent(new Event(EVENT))
}

function load(pf, key, query) {
  const existing = cache.get(key)
  if (existing && Date.now() - existing.created < 60000) return existing.promise
  const promise = pf(`/api/nav-assessment?${query}`).then(readNavJson).then(data => {
    if (!Array.isArray(data.results) || !data.summary || !data.overall) throw new Error('The assessment response is incomplete. Please refresh the assessment.')
    return data
  })
  const entry = { created: Date.now(), promise }
  cache.set(key, entry)
  promise.catch(() => { if (cache.get(key) === entry) cache.delete(key) })
  return promise
}

export function useNavAssessment(windowKey = '1Y', { enabled = true } = {}) {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({})
  const serial = useRef(0)
  const query = typeof windowKey === 'string'
    ? new URLSearchParams({ window: windowKey }).toString()
    : addCustomRangeParams(new URLSearchParams({ period: windowKey.period }), windowKey.period, windowKey.start, windowKey.end).toString()
  const key = `v6:${selection}:${query}:${revision}:${enabled}`
  useEffect(() => {
    const onUpdate = () => setRevision(value => value + 1)
    window.addEventListener(EVENT, onUpdate)
    return () => window.removeEventListener(EVENT, onUpdate)
  }, [])
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    const request = ++serial.current
    load(pf, `v6:${selection}:${query}`, query)
      .then(data => { if (active && serial.current === request) setState({ key, data }) })
      .catch(error => { if (active && serial.current === request) setState({ key, error: error.message }) })
    return () => { active = false }
  }, [pf, key, selection, query, enabled])
  const refresh = useCallback(() => invalidateNavAssessment(), [])
  const current = enabled && state.key === key ? state : {}
  return { data: current.data || null, error: current.error || null, loading: enabled && !current.data && !current.error, refresh, selection }
}

export const navPercent = value => value == null ? '—' : `${(Number(value) * 100).toFixed(2)}%`
export const navMoney = value => value == null ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
export const NAV_STATUS = {
  declined: 'NAV declined', preserved: 'Capital preserved', within_precision: 'Within source precision',
  unconfirmed: 'Unconfirmed', not_applicable: 'Not applicable', liquidated: 'Liquidated',
}
