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

export const distributionYieldPeriodLabel = (monthKeys = []) => {
  const indexes = [...new Set(monthKeys)]
    .map(monthIndex)
    .filter(value => value != null)
    .sort((a, b) => a - b)

  if (indexes.length < 2) return 'Monthly'

  const intervals = indexes
    .slice(1)
    .map((value, idx) => value - indexes[idx])
    .filter(value => value > 0 && value <= 12)
    .slice(-8)

  if (!intervals.length) return 'Monthly'

  const quarterlyIntervals = intervals.filter(value => value >= 2 && value <= 4).length
  const quarterlyShare = quarterlyIntervals / intervals.length
  return median(intervals) >= 2.5 && quarterlyShare >= 0.6 ? 'Quarterly' : 'Monthly'
}
