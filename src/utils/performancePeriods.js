// Every period ends at the most recent close. `hint` is the hover help on each
// button and must keep describing what the backend actually resolves in
// _resolve_total_return_period; returns use the final close on or before the
// selected start, which is the baseline rather than the first day of gain.
export const PERFORMANCE_PERIODS = [
  {
    key: '1d',
    label: '1D',
    hint: 'The move since the previous close. Resolved as the last two trading sessions, so it skips weekends and holidays instead of counting back one calendar day.',
  },
  {
    key: '7d',
    label: '7D',
    hint: 'Exactly 7 calendar days back — the same weekday as today. Calendar days, not trading days, so it spans 5–6 closes.',
  },
  {
    key: '1m',
    label: '1M',
    hint: 'One calendar month back on the same day of the month (clamped to the last day in shorter months).',
  },
  {
    key: '3m',
    label: '3M',
    hint: 'Three calendar months back on the same day of the month (clamped to the last day in shorter months).',
  },
  {
    key: '6m',
    label: '6M',
    hint: 'Six calendar months back on the same day of the month (clamped to the last day in shorter months).',
  },
  {
    key: 'ytd',
    label: 'YTD',
    hint: "January 1 of this year. The baseline is the final market close on or before January 1, so the first trading session's move is included.",
  },
  {
    key: '1y',
    label: '1Y',
    hint: 'One calendar year back on the same month and day (Feb 29 falls back to Feb 28).',
  },
  {
    key: '5y',
    label: '5Y',
    hint: 'Five calendar years back on the same month and day (Feb 29 falls back to Feb 28).',
  },
  {
    key: 'all',
    label: 'All',
    hint: "The portfolio's own first recorded trade, purchase, or import — never a benchmark's older quote history.",
  },
  {
    key: 'custom',
    label: 'Custom',
    hint: 'The start and end dates you enter, both inclusive.',
  },
]

// One line under the button row on every performance screen. The per-button
// detail lives in `hint`.
export const PERFORMANCE_RANGE_NOTE = (
  'Each preset sets the start and ends at the most recent close; Custom uses both inclusive dates you enter. '
  + 'Return is measured from the market close on or before the start date, so weekends and holidays use the prior close. '
  + 'Hover a button for the exact start it resolves to.'
)

const SHARED_PERFORMANCE_RANGE_KEY = 'portfolio_shared_performance_range_v1'
const VALID_PERFORMANCE_PERIODS = new Set(PERFORMANCE_PERIODS.map(option => option.key))

// A date input reports a value on every keystroke, so typing "2026" into the
// year segment emits 0002, then 0020, then 0202 before it ever emits 2026.
// Those partial years are well-formed ISO dates, so a format check waves them
// through and the API gets asked for two millennia of history. Anything before
// this floor is a year still being typed, not a range anyone chose.
export const MIN_PERFORMANCE_DATE = '1970-01-01'

export const isCompletePerformanceDate = (value) => {
  const text = String(value || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && text >= MIN_PERFORMANCE_DATE
}

export const dateInputValue = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Read live rather than captured at mount, so a session left open past midnight
// does not keep offering yesterday as the newest selectable date.
export const todayInputValue = () => dateInputValue(new Date())

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
    // A stored date that is now in the future would reload as the chosen range
    // and fail on every visit, with no way to clear it from the UI. Ranges
    // saved before today's close age into this the moment the day rolls over,
    // so the fallback has to be applied on read, not only on write.
    const latest = dateInputValue(new Date())
    const usable = (value) => isCompletePerformanceDate(value) && value <= latest
    return {
      period: VALID_PERFORMANCE_PERIODS.has(saved.period) ? saved.period : fallback.period,
      start: usable(saved.start) ? saved.start : fallback.start,
      end: usable(saved.end) ? saved.end : fallback.end,
    }
  } catch {
    return fallback
  }
}

// Every mounted performance screen that wants to follow the shared range. One
// screen at a time was enough while the range was only read at mount, but split
// view mounts two at once: without a broadcast the second pane keeps whatever
// range it read when it opened, which is the exact drift that made comparing in
// two app windows useless.
const rangeListeners = new Set()

// The screen that made the change already has these values in its own state,
// and echoing them back would fight the user mid-keystroke — a half-typed date
// is not stored, so the echo would carry the *previous* date and overwrite what
// is being typed. Each subscriber gets an id so it can be skipped.
let nextListenerId = 1
export const nextPerformanceRangeListenerId = () => `perf-range-${nextListenerId++}`

export const subscribeSharedPerformanceRange = (listener) => {
  rangeListeners.add(listener)
  return () => rangeListeners.delete(listener)
}

export const writeSharedPerformanceRange = (period, start, end, originId = null) => {
  if (typeof window === 'undefined' || !VALID_PERFORMANCE_PERIODS.has(period)) return
  try {
    // A half-typed date must never reach storage: it would outlive the keystroke
    // that produced it and reload as the chosen range on every performance
    // screen. Keep the last complete pair, but still record the picked period.
    const previous = readSharedPerformanceRange()
    const usable = (
      isCompletePerformanceDate(start)
      && isCompletePerformanceDate(end)
      && start <= end
      // A future end date is rejected by the API, so persisting one strands
      // Custom in a permanent error on every screen and every restart.
      && end <= todayInputValue()
    )
    const stored = {
      period,
      start: usable ? start : previous.start,
      end: usable ? end : previous.end,
    }
    window.localStorage.setItem(SHARED_PERFORMANCE_RANGE_KEY, JSON.stringify(stored))
    rangeListeners.forEach(listener => {
      if (listener.id !== originId) listener.onChange(stored)
    })
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

export const formatAccountingCoverage = (metrics) => {
  if (!metrics) return ''
  const parts = []
  const splitTransactions = Number(metrics.split_adjusted_transactions || 0)
  const splitPositions = Number(metrics.split_adjusted_positions || 0)
  const inferredClosings = Number(metrics.inferred_closing_positions || 0)
  const missingSymbols = Array.isArray(metrics.missing_market_symbols)
    ? metrics.missing_market_symbols.filter(Boolean)
    : []

  if (splitTransactions > 0) {
    parts.push(
      `${splitTransactions} historical trade${splitTransactions === 1 ? '' : 's'} across ${splitPositions} position${splitPositions === 1 ? '' : 's'} ${splitTransactions === 1 ? 'was' : 'were'} normalized for stock splits.`,
    )
  }
  if (inferredClosings > 0) {
    parts.push(
      `${inferredClosings} residual historical position${inferredClosings === 1 ? '' : 's'} ${inferredClosings === 1 ? 'was' : 'were'} closed against the current broker share snapshot.`,
    )
  }
  if (missingSymbols.length > 0) {
    parts.push(
      `Market history is unavailable for ${missingSymbols.join(', ')}; ${missingSymbols.length === 1 ? 'that symbol is' : 'those symbols are'} excluded from Tracker Return.`,
    )
  }
  return parts.join(' ')
}

export const formatPerformanceChartRange = (
  requestedStart,
  requestedEnd,
  actualStart,
  actualEnd,
) => {
  const selectedStartValue = requestedStart || actualStart
  const selectedEndValue = requestedEnd || actualEnd
  const selectedStart = formatPerformanceDate(selectedStartValue)
  const selectedEnd = formatPerformanceDate(selectedEndValue)
  if (!selectedStart || !selectedEnd) return ''

  const selectedLabel = `From ${selectedStart} to ${selectedEnd}`
  const actualStartLabel = formatPerformanceDate(actualStart)
  const actualEndLabel = formatPerformanceDate(actualEnd)
  if (
    !actualStartLabel
    || !actualEndLabel
    || (actualStart === selectedStartValue && actualEnd === selectedEndValue)
  ) {
    return selectedLabel
  }
  return `${selectedLabel} · market observations ${actualStartLabel} to ${actualEndLabel}`
}

// Single gate for the custom range, shared by every performance screen so a
// keystroke that is not yet a date can never reach the API.
export const customRangeError = (period, start, end) => {
  if (period !== 'custom') return null
  if (!start || !end) return 'Choose both a custom start date and end date.'
  if (!isCompletePerformanceDate(start) || !isCompletePerformanceDate(end)) {
    return `Enter dates on or after ${formatPerformanceDate(MIN_PERFORMANCE_DATE)}.`
  }
  if (start > end) return 'Custom start date must be on or before the end date.'
  // `max` on a date input only marks the value invalid — it still reaches
  // onChange and still gets sent. Catching the future end here keeps the page
  // from asking for a close that does not exist yet, and keeps the wording the
  // same as the API's own rejection.
  const today = todayInputValue()
  if (end > today) {
    return `Custom end date cannot be in the future — the latest close is ${formatPerformanceDate(today)}.`
  }
  return null
}

export const addCustomRangeParams = (params, period, start, end) => {
  if (period === 'custom') {
    params.set('start_date', start)
    params.set('end_date', end)
  }
  return params
}
