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

const sameCalloutPoint = (left, right) => Boolean(left && right && left.date === right.date)

const calloutLabelWidth = (label, value) => {
  const amount = Number.isFinite(value)
    ? Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value)
  return `${label}: $${amount}`.length * 6.8 + 12
}

const calloutSpansOverlap = (timeA, widthA, timeB, widthB, start, end, plotWidth) => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !(plotWidth > 0)) return false
  const box = (time, width) => {
    const x = ((time - start) / (end - start)) * plotWidth
    return time <= (start + end) / 2 ? [x, x + width] : [x - width, x]
  }
  const [leftA, rightA] = box(timeA, widthA)
  const [leftB, rightB] = box(timeB, widthB)
  return leftA < rightB + 8 && leftB < rightA + 8
}

// High, low, and the latest recorded value for the dashboard portfolio chart.
// The latest value is "current" only when that point is inside the visible
// range, so a zoom into older history does not label an off-screen point.
export const navHistoryCallouts = (points = [], {
  start = -Infinity,
  end = Infinity,
  dateTime,
  plotWidth = 0,
} = {}) => {
  const timeOf = dateTime || (value => new Date(`${value}T00:00:00`).getTime())
  const visible = points.filter((point) => {
    const time = timeOf(point.date)
    return Number.isFinite(time) && time >= start && time <= end
  })
  if (!visible.length) return []

  const high = visible.reduce((best, point) => point.value > best.value ? point : best)
  const low = visible.reduce((best, point) => point.value < best.value ? point : best)
  const latest = points[points.length - 1]
  const current = visible.find(point => point.date === latest?.date) || null
  const highIsCurrent = sameCalloutPoint(high, current)
  const lowIsCurrent = sameCalloutPoint(low, current)
  const currentIsHigh = Boolean(current) && current.value === high.value
  const currentIsLow = Boolean(current) && current.value === low.value
  const currentLabel = currentIsHigh && currentIsLow
    ? 'Current is the high and the low'
    : currentIsHigh
      ? 'Current is the high'
      : currentIsLow
        ? 'Current is the low'
        : 'Current'

  if (high.value === low.value) {
    const callouts = [{
      role: 'flat',
      label: highIsCurrent || lowIsCurrent ? currentLabel : 'High / Low',
      point: high,
      offset: -28,
    }]
    if (current && !highIsCurrent && !lowIsCurrent) {
      callouts.push({ role: 'current', label: currentLabel, point: current, offset: -28 })
    }
    return callouts
  }

  const highLabel = highIsCurrent ? currentLabel : 'High'
  const lowLabel = lowIsCurrent ? currentLabel : 'Low'
  const callouts = [
    { role: 'high', label: highLabel, point: high, offset: -28 },
    { role: 'low', label: lowLabel, point: low, offset: 28 },
  ]
  if (current && !highIsCurrent && !lowIsCurrent) {
    const valueSpan = Math.max(high.value - low.value, 1)
    const sameBand = (value) => Math.abs(current.value - value) <= valueSpan * 0.18
    const currentWidth = calloutLabelWidth(currentLabel, current.value)
    const coversHigh = sameBand(high.value) && calloutSpansOverlap(
      timeOf(current.date), currentWidth,
      timeOf(high.date), calloutLabelWidth(highLabel, high.value),
      start, end, plotWidth,
    )
    const coversLow = sameBand(low.value) && calloutSpansOverlap(
      timeOf(current.date), currentWidth,
      timeOf(low.date), calloutLabelWidth(lowLabel, low.value),
      start, end, plotWidth,
    )
    // Keep Current above the latest point unless that box would cover High.
    let offset = -28
    if (coversHigh && !coversLow) offset = 28
    else if (coversHigh && coversLow) offset = -52
    callouts.push({ role: 'current', label: currentLabel, point: current, offset })
  }
  return callouts
}

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
