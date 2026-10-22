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
    if (!Array.isArray(data.results) || !data.summary || !data.overall || !data.verdict) throw new Error('The assessment response is incomplete. Please refresh the assessment.')
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
  const base = `v9:${selection}:${query}`
  const key = `${base}:${revision}:${enabled}`
  useEffect(() => {
    const onUpdate = () => setRevision(value => value + 1)
    window.addEventListener(EVENT, onUpdate)
    return () => window.removeEventListener(EVENT, onUpdate)
  }, [])
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    const request = ++serial.current
    load(pf, base, query)
      .then(data => { if (active && serial.current === request) setState({ key, base, data }) })
      .catch(error => { if (active && serial.current === request) setState({ key, base, error: error.message }) })
    return () => { active = false }
  }, [pf, key, base, query, enabled])
  const refresh = useCallback(() => invalidateNavAssessment(), [])
  // After a setting change the same account and range reload; keep showing
  // the previous result meanwhile instead of blanking every NAV cell.
  const current = !enabled ? {} : state.key === key ? state : state.base === base && state.data ? { data: state.data, stale: true } : {}
  return {
    data: current.data || null, error: current.error || null,
    loading: enabled && (current.stale || (!current.data && !current.error)), refresh, selection,
  }
}

// "Does this fund sell call options?" — asked only when the app could not
// tell from the reviewed list, the fund's holdings or its name.
export const STRATEGY_ANSWER_OPTIONS = [
  ['', 'Not sure'],
  ['calls', 'Yes, sells calls'],
  ['none', 'No options'],
  ['puts', 'Sells puts only'],
  ['both', 'Sells calls and puts'],
]

export const strategyInQuestion = meta => ['unverified', 'manual'].includes(meta?.guidance?.strategy_source)

export async function saveStrategyAnswer(pf, ticker, answer) {
  const response = await pf(`/api/nav-assessment/strategy/${encodeURIComponent(ticker)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: answer || null }),
  })
  await readNavJson(response)
  invalidateNavAssessment()
}

// The choice shows at once. The assessment takes seconds to recompute, and
// showing only the server's answer until then made clicks look ignored.
// A pending choice is kept only while the server still reports the answer it
// was made against; once the refreshed answer arrives, that wins.
export function useStrategyAnswer(ticker, saved) {
  const pf = useProfileFetch()
  const savedValue = saved || ''
  const [pending, setPending] = useState(null)
  const [error, setError] = useState('')
  const latest = useRef(0)
  const choose = useCallback(value => {
    const request = ++latest.current
    setPending({ value, base: savedValue })
    setError('')
    saveStrategyAnswer(pf, ticker, value).catch(err => {
      if (latest.current !== request) return
      setPending(null)
      setError(err.message || 'The answer could not be saved.')
    })
  }, [pf, ticker, savedValue])
  const value = pending && pending.base === savedValue ? pending.value : savedValue
  return { value, choose, error }
}

export const navPercent = value => value == null ? '—' : `${(Number(value) * 100).toFixed(2)}%`
export const navMoney = value => value == null ? '—' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
export const NAV_STATUS = {
  declined: 'NAV declined', preserved: 'Capital preserved', within_precision: 'Within source precision',
  unconfirmed: 'Unconfirmed', not_applicable: 'Not applicable', liquidated: 'Liquidated',
}
export const navProbability = value => value == null || Number.isNaN(Number(value)) ? '—' : `${Math.round(Number(value))}%`
