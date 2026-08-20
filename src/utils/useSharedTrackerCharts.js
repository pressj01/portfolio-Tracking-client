import { useEffect, useMemo, useState } from 'react'
import {
  getTrackerChartsEpoch,
  loadTrackerCharts,
  peekTrackerCharts,
  subscribeTrackerChartsEpoch,
  trackerChartsCacheKey,
  trackerChartsSearchParams,
} from './sharedTrackerCharts'

export default function useSharedTrackerCharts({
  pf,
  profileQueryString,
  period,
  start,
  end,
  categories,
  subcategories,
  enabled = true,
}) {
  const params = useMemo(
    () => trackerChartsSearchParams({ period, start, end, categories, subcategories }),
    [period, start, end, categories, subcategories],
  )
  const key = trackerChartsCacheKey(profileQueryString, params)
  const [epoch, setEpoch] = useState(getTrackerChartsEpoch)
  const [data, setData] = useState(() => (enabled ? peekTrackerCharts(key) : null))
  const [loading, setLoading] = useState(() => enabled && !peekTrackerCharts(key))
  const [error, setError] = useState(null)

  useEffect(() => subscribeTrackerChartsEpoch(setEpoch), [])

  useEffect(() => {
    if (!enabled) {
      setData(null)
      setLoading(false)
      setError(null)
      return undefined
    }
    const cached = peekTrackerCharts(key)
    if (cached) {
      setData(cached)
      setLoading(false)
      setError(null)
      return undefined
    }
    let active = true
    setLoading(true)
    setError(null)
    loadTrackerCharts(pf, profileQueryString, params)
      .then(result => { if (active) setData(result) })
      .catch(err => {
        if (!active) return
        setData(null)
        setError(err.message || String(err))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [enabled, epoch, key, pf, profileQueryString, params])

  return { data, loading, error }
}
