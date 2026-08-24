import { annualDistributionEstimate } from './approxYield'

const dateKey = value => String(value || '').slice(0, 10)

// Recover each per-share distribution from a comparison payload. The backend
// ships div_ratio (dividend / close) alongside the un-normalized closes, so the
// product is the dividend Yahoo reported for that session — and it stays on the
// same split-and-transition-corrected basis as the return traces, which
// profiles.distribution_history (often scraped from the fund site) does not.
export function distributionsFromSeries(series = {}) {
  const dates = series?.dates || []
  const ratios = series?.div_ratio || []
  const closes = series?.closes || []
  const payments = []
  for (let i = 0; i < dates.length; i += 1) {
    const ratio = Number(ratios[i])
    const close = Number(closes[i])
    if (!Number.isFinite(ratio) || ratio <= 0) continue
    if (!Number.isFinite(close) || close <= 0) continue
    payments.push({ date: dateKey(dates[i]), amount: ratio * close })
  }
  return payments
}

/**
 * Yield on cost over the visible window: the fund's annualized distribution
 * rate at each point, measured against the share price at the start of the
 * window ("what you'd have paid"). The cost basis follows the same first
 * visible close the return chart rebases on, so both charts describe the same
 * hypothetical purchase.
 *
 * The rate comes from annualDistributionEstimate — the same run-rate the
 * Est. Yield readout and the approx-yield column use. It equals a trailing
 * twelve months once a full cycle of payments exists, and annualizes the
 * partial run at the fund's own cadence before that, so a six-month window
 * still reads as an annual yield rather than half of one.
 *
 * Returns null when the window holds no usable distribution.
 */
export function buildYieldOnCostSeries(series = {}, {
  frequency = null,
  visibleStart = null,
  visibleEnd = null,
} = {}) {
  const dates = (series?.dates || []).map(dateKey)
  const closes = series?.closes || []
  const inWindow = day => (
    (!visibleStart || day >= visibleStart) && (!visibleEnd || day <= visibleEnd)
  )

  let costIdx = -1
  for (let i = 0; i < dates.length; i += 1) {
    if (inWindow(dates[i]) && Number(closes[i]) > 0) { costIdx = i; break }
  }
  if (costIdx < 0) return null
  const cost = Number(closes[costIdx])

  const payments = distributionsFromSeries(series)
  const steps = []
  payments.forEach((payment, idx) => {
    // A lone payment carries no cadence, and annualDistributionEstimate falls
    // back to quarterly — which would print a weekly fund at a twelfth of its
    // real rate. Wait for a second payment unless the cadence is already known.
    if (idx === 0 && !frequency) return
    const estimate = annualDistributionEstimate(payments.slice(0, idx + 1), frequency)
    if (!estimate || !Number.isFinite(estimate.annual) || estimate.annual <= 0) return
    steps.push({ date: payment.date, ...estimate })
  })
  if (!steps.length) return null

  // Plot every date the fund has, not just the window. MAX rebases on the
  // newest fund's inception, so a window-truncated line would leave nothing to
  // pan or zoom back to — the return chart keeps the full series and merely
  // clips the axis, and this has to behave the same way. Points outside the
  // window are still measured against the in-window cost, so the line reads as
  // "what this fund's payout would have yielded on that purchase price".
  const stepByDate = new Map(steps.map(step => [step.date, step]))
  const x = []
  const y = []
  // Seed with the first known rate rather than leaving a blank run until that
  // fund's first distribution lands. Funds pay on different calendars, so
  // without this a monthly payer and a quarterly one start weeks apart and the
  // two lines are not comparable over the window the user actually selected.
  // The leading segment is the fund's own first observed rate carried back —
  // an extrapolation, but a flat one that implies no trend it hasn't earned.
  let current = steps[0]
  let latest = null
  let visibleMin = Infinity
  let visibleMax = -Infinity
  for (let i = 0; i < dates.length; i += 1) {
    const day = dates[i]
    const step = stepByDate.get(day)
    if (step) current = step
    const value = Number((current.annual / cost * 100).toFixed(4))
    x.push(day)
    y.push(value)
    // The headline number and the y-scale describe the window on screen, so
    // both stay pinned to it even though the line runs past both edges.
    if (inWindow(day)) {
      latest = current
      visibleMin = Math.min(visibleMin, value)
      visibleMax = Math.max(visibleMax, value)
    }
  }
  if (!latest) return null

  return {
    x,
    y,
    cost,
    costDate: dates[costIdx],
    annual: latest.annual,
    basis: latest.basis,
    yieldPct: latest.annual / cost * 100,
    visibleMin: Number.isFinite(visibleMin) ? visibleMin : null,
    visibleMax: Number.isFinite(visibleMax) ? visibleMax : null,
  }
}
