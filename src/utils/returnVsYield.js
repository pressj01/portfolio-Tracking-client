const MS_PER_DAY = 86400000
const DAYS_PER_YEAR = 365.25

/**
 * Fraction of a year spanned by an inclusive [start, end] range of closes.
 * Returns null when either date is missing or unparseable.
 */
export function yearFraction(startDate, endDate) {
  const parse = (value) => {
    const text = String(value || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
    const ms = Date.parse(`${text}T00:00:00Z`)
    return Number.isFinite(ms) ? ms : null
  }
  const start = parse(startDate)
  const end = parse(endDate)
  if (start === null || end === null || end < start) return null
  // Both endpoints are closes, so the accrual span is the gap between them.
  // Floored at one day so a single-session window still scales to something.
  const days = Math.max((end - start) / MS_PER_DAY, 1)
  return days / DAYS_PER_YEAR
}

/**
 * Scale an annual yield down to the window actually being measured.
 *
 * A period return and an annual yield are not on the same time base. Comparing
 * a 7-day return against a 12-month yield marks every dividend payer "Poor" by
 * construction — a +0.3% week cannot out-run an 8% annual yield. Pro-rating the
 * yield to the window keeps the question meaningful at every range length:
 * did the position return more than the income it threw off over that window?
 *
 * Returns null when the window is unknown, so callers can withhold a verdict
 * rather than print a mis-scaled one.
 */
export function prorateAnnualYield(annualYieldPct, startDate, endDate) {
  const annual = Number(annualYieldPct)
  if (annualYieldPct == null || !Number.isFinite(annual)) return null
  const fraction = yearFraction(startDate, endDate)
  return fraction === null ? null : annual * fraction
}

/**
 * Compare total return % to yield.
 *
 * Good:  total return > yield  — price appreciation adds value beyond dividends
 * Poor:  yield > total return  — price decline is eating into dividend income
 *
 * Both values must be on the same scale (both decimals OR both percentages) and
 * on the same time base. When the return covers a selected window rather than a
 * full year, run the yield through prorateAnnualYield first.
 */
export function returnVsYield(totalReturnPct, yieldOnCost) {
  if (totalReturnPct == null || yieldOnCost == null || yieldOnCost <= 0) return null

  const spread = totalReturnPct - yieldOnCost

  return {
    totalReturnPct,
    yieldOnCost,
    spread,
    status: spread >= 0 ? 'good' : 'poor',
    label: spread >= 0 ? 'Good' : 'Poor',
    color: spread >= 0 ? '#4dff91' : '#ff6b6b',
  }
}

export function returnVsYieldFromHolding(h) {
  const pv = h.purchase_value || 0
  const gl = h.gain_or_loss || 0
  const td = h.total_divs_received || 0
  const yoc = h.annual_yield_on_cost || 0

  if (pv <= 0 || yoc <= 0) return null

  const totalReturnRatio = (gl + td) / pv
  return returnVsYield(totalReturnRatio, yoc)
}
