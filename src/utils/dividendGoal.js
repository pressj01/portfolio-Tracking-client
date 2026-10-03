// Goal tracking for the Dividend Calculator: turn a year-by-year projection
// into "does this reach the target, and when", plus the axis math the goal
// chart needs. Kept free of React and money formatting so it can be unit tested.

// Purchasing power of a future amount, expressed in today's dollars.
export function todaysDollars(values, years, inflationPct) {
  const rate = (Number(inflationPct) || 0) / 100
  if (!Array.isArray(values)) return []
  return values.map((value, index) => {
    const year = Number(years?.[index] ?? index) || 0
    const n = Number(value) || 0
    return rate > -1 ? n / Math.pow(1 + rate, year) : n
  })
}

// status:
//   none    - no target entered
//   reached - the series is at or above the target in the final year
//   lapsed  - it touched the target along the way but ends below it (a fund
//             whose price erodes can cross a portfolio target and fall back)
//   missed  - it never gets there inside the projection
export function evaluateGoal({ years, values, target } = {}) {
  const series = Array.isArray(values) ? values.map(v => Number(v) || 0) : []
  const goal = Number(target)
  const finalValue = series.length ? series[series.length - 1] : 0
  const finalYear = series.length ? Number(years?.[series.length - 1] ?? series.length - 1) : 0
  if (!Number.isFinite(goal) || goal <= 0 || !series.length) {
    return { status: 'none', target: 0, yearReached: null, finalValue, finalYear, gap: 0, progressPct: 0 }
  }

  const reachedIndex = series.findIndex(value => value >= goal)
  const yearReached = reachedIndex >= 0 ? Number(years?.[reachedIndex] ?? reachedIndex) : null
  const status = finalValue >= goal ? 'reached' : (reachedIndex >= 0 ? 'lapsed' : 'missed')
  return {
    status,
    target: goal,
    yearReached,
    finalValue,
    finalYear,
    // Positive when the final year clears the target, negative when it is short.
    gap: finalValue - goal,
    progressPct: Math.max(0, (finalValue / goal) * 100),
  }
}

// A 1 / 2 / 2.5 / 5 step so axis labels land on round numbers.
export function niceStep(span, targetTicks = 5) {
  const size = Number(span)
  if (!Number.isFinite(size) || size <= 0) return 1
  const raw = size / Math.max(1, targetTicks)
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const residual = raw / magnitude
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10
  return nice * magnitude
}

// Top of the axis: the first round step at or above the largest value shown.
export function niceCeiling(maxValue, targetTicks = 5) {
  const max = Number(maxValue)
  if (!Number.isFinite(max) || max <= 0) return 1
  const step = niceStep(max, targetTicks)
  return Math.ceil(max / step - 1e-9) * step
}

// Ticks for an axis that currently tops out at `max`. `max` need not be round:
// the goal chart animates its scale, so mid-animation frames ask for ticks
// against an in-between maximum.
export function axisTicks(max, targetTicks = 5) {
  const top = Number(max)
  if (!Number.isFinite(top) || top <= 0) return { step: 1, ticks: [0] }
  const step = niceStep(top, targetTicks)
  const ticks = []
  for (let i = 0; i * step <= top + step * 1e-6; i++) ticks.push(i * step)
  return { step, ticks }
}

// Whole-number spacing for the year axis so labels never collide.
export function yearTickStep(yearCount, maxLabels) {
  const count = Math.max(1, Math.ceil(Number(yearCount) || 0))
  const room = Math.max(2, Math.floor(Number(maxLabels) || 0))
  const steps = [1, 2, 5, 10, 20, 25, 50]
  return steps.find(step => count / step + 1 <= room) || 50
}

// "$125K" / "$12.5K" / "$2,500": compact, but with enough decimals that
// neighbouring ticks never round to the same label. The unit comes from the top
// of the axis, not from each value, so one axis never mixes "$5,000" and "$10K".
export function axisMoneyLabel(value, step, symbol = '$', axisMax = value) {
  const n = Number(value) || 0
  const abs = Math.abs(n)
  const scale = Math.max(abs, Math.abs(Number(axisMax) || 0))
  const units = [
    { size: 1e12, label: 'T' },
    { size: 1e9, label: 'B' },
    { size: 1e6, label: 'M' },
    { size: 1e4, label: 'K', divisor: 1e3 },
  ]
  const unit = units.find(u => scale >= u.size)
  const sign = n < 0 ? '-' : ''
  if (abs === 0) return `${symbol}0`
  if (!unit) {
    const digits = step > 0 && step < 1 ? 2 : 0
    return `${sign}${symbol}${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
  }
  const divisor = unit.divisor || unit.size
  const stepInUnit = (Number(step) || 0) / divisor
  let digits = 0
  while (digits < 2 && stepInUnit > 0 && Math.abs(stepInUnit * Math.pow(10, digits) - Math.round(stepInUnit * Math.pow(10, digits))) > 1e-6) digits += 1
  return `${sign}${symbol}${(abs / divisor).toFixed(digits)}${unit.label}`
}
