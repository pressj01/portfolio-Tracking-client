export const NAV_HISTORY_INTERVALS = [
  { value: 'daily', label: 'Daily', title: 'Show every recorded trading-day value' },
  { value: 'weekly', label: 'Weekly', title: 'Show the last recorded value in each calendar week' },
  { value: 'monthly', label: 'Monthly', title: 'Show the last recorded value in each calendar month' },
]

const isoDateParts = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null
  return { date, iso: `${match[1]}-${match[2]}-${match[3]}` }
}

const intervalKey = (value, interval) => {
  const parsed = isoDateParts(value)
  if (!parsed) return null
  if (interval === 'monthly') return parsed.iso.slice(0, 7)
  if (interval === 'weekly') {
    const monday = new Date(parsed.date)
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
    return monday.toISOString().slice(0, 10)
  }
  return parsed.iso
}

export const isNavHistoryInterval = value => NAV_HISTORY_INTERVALS.some(option => option.value === value)

export const resampleNavHistory = (points = [], interval = 'daily') => {
  const validPoints = points
    .map((point, index) => ({ point, index, date: isoDateParts(point?.date)?.iso || null }))
    .filter(item => item.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)

  if (interval === 'daily') return validPoints.map(item => item.point)

  const lastByPeriod = new Map()
  validPoints.forEach((item) => {
    const key = intervalKey(item.date, interval)
    if (key) lastByPeriod.set(key, item.point)
  })
  return [...lastByPeriod.values()]
}
