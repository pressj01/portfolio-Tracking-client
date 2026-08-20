import { addCustomRangeParams } from './performancePeriods.js'

const inflight = new Map()
const cache = new Map()
const epochListeners = new Set()
let epoch = 0

export function trackerChartsSearchParams({
  period,
  start,
  end,
  categories,
  subcategories,
} = {}) {
  const params = new URLSearchParams({ period: period || '1y' })
  addCustomRangeParams(params, period, start, end)
  if (categories?.length) params.set('category', categories.join(','))
  if (subcategories?.length) params.set('subcategory', subcategories.join(','))
  return params
}

export function trackerChartsCacheKey(profileQueryString, params) {
  return `${profileQueryString || ''}::${String(params)}`
}

export function peekTrackerCharts(key) {
  return cache.get(key) ?? null
}

export function getTrackerChartsEpoch() {
  return epoch
}

export function subscribeTrackerChartsEpoch(listener) {
  epochListeners.add(listener)
  return () => epochListeners.delete(listener)
}

export function invalidateSharedTrackerCharts() {
  epoch += 1
  inflight.clear()
  cache.clear()
  epochListeners.forEach(listener => listener(epoch))
}

export function loadTrackerCharts(pf, profileQueryString, params) {
  const key = trackerChartsCacheKey(profileQueryString, params)
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  if (inflight.has(key)) return inflight.get(key)

  const request = Promise.resolve()
    .then(() => pf(`/api/total-return/charts?${params}`))
    .then(async (res) => {
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
      if (data.error) throw new Error(data.error)
      cache.set(key, data)
      return data
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key)
    })

  inflight.set(key, request)
  return request
}
