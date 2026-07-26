const monthIndex = (key) => {
  const [year, month] = String(key || '').split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null
  return year * 12 + month
}

const median = (values) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const explicitPeriodLabel = (frequency) => {
  const value = String(frequency || '').trim().toLowerCase()
  if (['w', 'weekly', '52', 'm', 'monthly', '12'].includes(value)) return 'Monthly'
  if (['q', 'quarterly', '4'].includes(value)) return 'Quarterly'
  if (['sa', 'semiannual', 'semi-annually', 'semiannually', 'semi-annual', '2'].includes(value)) return 'Semiannual'
  if (['a', 'annual', 'annually', 'yearly', '1'].includes(value)) return 'Annual'
  return null
}

export const distributionPeriodsPerYear = (periodLabel) => ({
  Monthly: 12,
  Quarterly: 4,
  Semiannual: 2,
  Annual: 1,
}[periodLabel] || null)

export const distributionYieldPeriodLabel = (monthKeys = [], frequency = null) => {
  const explicit = explicitPeriodLabel(frequency)
  if (explicit) return explicit

  const indexes = [...new Set(monthKeys)]
    .map(monthIndex)
    .filter(value => value != null)
    .sort((a, b) => a - b)

  // A single payment contains no cadence information. Calling it monthly also
  // makes the annual-yield view multiply it by 12, which materially overstates
  // newly launched quarterly funds.
  if (indexes.length < 2) return 'Distribution'

  const intervals = indexes
    .slice(1)
    .map((value, idx) => value - indexes[idx])
    .filter(value => value > 0 && value <= 12)
    .slice(-8)

  if (!intervals.length) return 'Distribution'

  const quarterlyIntervals = intervals.filter(value => value >= 2 && value <= 4).length
  const quarterlyShare = quarterlyIntervals / intervals.length
  const medianInterval = median(intervals)
  if (medianInterval >= 2.5 && quarterlyShare >= 0.6) return 'Quarterly'
  if (medianInterval >= 5 && medianInterval <= 7) return 'Semiannual'
  if (medianInterval >= 10) return 'Annual'
  return 'Monthly'
}
