import { useCallback, useEffect, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import { performancePeriodUnavailableReason } from './performancePeriods'

/**
 * Grays out the shared date-range presets the active portfolio is too young
 * for, on every screen that shows the Shared Performance Date Range buttons.
 *
 * Returns `(periodKey) => reason | null`. The reason is the button's tooltip;
 * null means the preset can be picked. Until the first-trade date loads (or
 * when it cannot be read) nothing is blocked.
 */
export default function usePerformancePeriodAvailability() {
  const pf = useProfileFetch()
  // Keyed by the fetch so a profile switch never grays buttons with the
  // previous portfolio's first trade.
  const [loaded, setLoaded] = useState({ pf: null, inceptionDate: null })

  useEffect(() => {
    let stale = false
    pf('/api/performance/inception')
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (!stale) setLoaded({ pf, inceptionDate: data?.inception_date || null }) })
      .catch(() => { if (!stale) setLoaded({ pf, inceptionDate: null }) })
    return () => { stale = true }
  }, [pf])

  const inceptionDate = loaded.pf === pf ? loaded.inceptionDate : null
  return useCallback(
    period => performancePeriodUnavailableReason(period, inceptionDate),
    [inceptionDate],
  )
}
