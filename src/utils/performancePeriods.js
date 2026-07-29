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
