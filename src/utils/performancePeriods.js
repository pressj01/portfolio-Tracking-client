export const PERFORMANCE_PERIODS = [
  { key: '7d', label: '7D' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: '5y', label: '5Y' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
]

const SHARED_PERFORMANCE_RANGE_KEY = 'portfolio_shared_performance_range_v1'
const VALID_PERFORMANCE_PERIODS = new Set(PERFORMANCE_PERIODS.map(option => option.key))

export const dateInputValue = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const defaultCustomDates = () => {
  const end = new Date()
  const start = new Date(end)
  start.setFullYear(start.getFullYear() - 1)
  return { start: dateInputValue(start), end: dateInputValue(end) }
}

export const readSharedPerformanceRange = () => {
  const fallback = { period: '1y', ...defaultCustomDates() }
  if (typeof window === 'undefined') return fallback
  try {
    const saved = JSON.parse(window.localStorage.getItem(SHARED_PERFORMANCE_RANGE_KEY) || '{}')
    return {
      period: VALID_PERFORMANCE_PERIODS.has(saved.period) ? saved.period : fallback.period,
      start: /^\d{4}-\d{2}-\d{2}$/.test(saved.start || '') ? saved.start : fallback.start,
      end: /^\d{4}-\d{2}-\d{2}$/.test(saved.end || '') ? saved.end : fallback.end,
    }
  } catch {
    return fallback
  }
}

export const writeSharedPerformanceRange = (period, start, end) => {
  if (typeof window === 'undefined' || !VALID_PERFORMANCE_PERIODS.has(period)) return
  if (period === 'custom' && (!start || !end || start > end)) return
  try {
    window.localStorage.setItem(
      SHARED_PERFORMANCE_RANGE_KEY,
      JSON.stringify({ period, start, end }),
    )
  } catch {
    // Best effort: private browsing or storage policy can disable localStorage.
  }
}

export const formatPerformanceDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`
}

export const formatPerformanceRange = (start, end) => {
  const startLabel = formatPerformanceDate(start)
  const endLabel = formatPerformanceDate(end)
  return startLabel && endLabel ? `${startLabel}–${endLabel}` : ''
}

export const addCustomRangeParams = (params, period, start, end) => {
  if (period === 'custom') {
    params.set('start_date', start)
    params.set('end_date', end)
  }
  return params
}
