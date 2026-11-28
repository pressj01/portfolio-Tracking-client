import test from 'node:test'
import assert from 'node:assert/strict'
import { annualDistributionEstimate } from './approxYield.js'
import { buildYieldOnCostSeries, yieldOnCostGapReason } from './yieldOnCost.js'

const pay = (date, amount) => ({ date, amount })
const close = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) < tolerance,
  `expected ${expected}, got ${actual}`,
)

// SCHG's real distributions around its 2021 year-end: a regular $0.0286 on
// 12-08 and a $0.0051 stub on 12-30, both belonging to the same quarter.
const SCHG = [
  pay('2021-09-22', 0.0183),
  pay('2021-12-08', 0.0286),
  pay('2021-12-30', 0.0051),
  pay('2022-03-23', 0.0160),
  pay('2022-06-22', 0.0193),
  pay('2022-09-21', 0.0197),
]

test('a plain quarterly history still sums the latest four payments', () => {
  const history = [
    pay('2025-03-26', 0.25), pay('2025-06-25', 0.26), pay('2025-09-24', 0.27),
    pay('2025-12-10', 0.28), pay('2026-03-25', 0.29),
  ]
  const estimate = annualDistributionEstimate(history, 'Q')
  close(estimate.annual, 0.26 + 0.27 + 0.28 + 0.29)
  assert.equal(estimate.basis, 'latest 4 distributions')
})

test('an extra year-end payment is counted with its quarter, not as a fifth period', () => {
  const estimate = annualDistributionEstimate(SCHG, 'Q')
  // 2022-09, 06, 03 and the whole December quarter (0.0286 + 0.0051). Counting
  // the stub as its own period gave 0.0601 and dropped the real December payment.
  close(estimate.annual, 0.0197 + 0.0193 + 0.0160 + 0.0286 + 0.0051)
  assert.match(estimate.basis, /extra payments counted with their period/)
})

test('the same history is order-independent', () => {
  const shuffled = [...SCHG].reverse()
  close(
    annualDistributionEstimate(shuffled, 'Q').annual,
    annualDistributionEstimate(SCHG, 'Q').annual,
  )
})

test('a stub as the newest payment no longer drags a partial-run average down', () => {
  const young = SCHG.slice(0, 3) // 2021-09-22, 12-08, 12-30
  const estimate = annualDistributionEstimate(young, 'Q')
  // Two periods (0.0183 and 0.0286 + 0.0051), averaged and annualized.
  close(estimate.annual, ((0.0183 + 0.0337) / 2) * 4)
  assert.match(estimate.basis, /^2 recent distributions annualized/)
})

test('payments far enough apart to be separate periods are not merged', () => {
  // 50 days apart is wider than 40% of a quarter (36.5 days).
  const history = [pay('2026-01-01', 1), pay('2026-02-20', 1), pay('2026-05-25', 1), pay('2026-08-20', 1)]
  close(annualDistributionEstimate(history, 'Q').annual, 4)
})

test('a semi-annual fund folds an extra into its period on a wider window', () => {
  const history = [pay('2024-06-10', 1), pay('2024-12-10', 1), pay('2025-01-05', 0.5), pay('2025-06-10', 1)]
  // Jan 5 is 26 days after the December payment, inside 40% of 182.5 days.
  close(annualDistributionEstimate(history, 'SA').annual, 1 + 1.5)
})

test('monthly cadence is untouched: a short gap still ends the run', () => {
  // A former weekly fund now paying monthly. Its weekly payments must not be
  // folded into monthly-sized lumps or dilute the run.
  const history = [
    pay('2026-07-15', 1), pay('2026-06-15', 1), pay('2026-05-15', 1),
    pay('2026-05-01', 0.25), pay('2026-04-24', 0.25), pay('2026-04-17', 0.25),
  ]
  const estimate = annualDistributionEstimate(history, 'M')
  close(estimate.annual, 1 * 12)
  assert.doesNotMatch(estimate.basis, /extra payments/)
})

test('yield on cost follows the true trailing year through an extra payment', () => {
  const cost = 10
  const dates = ['2021-05-05', ...SCHG.map(p => p.date)]
  const series = {
    dates,
    closes: dates.map(() => cost),
    div_ratio: dates.map(d => {
      const payment = SCHG.find(p => p.date === d)
      return payment ? payment.amount / cost : 0
    }),
  }
  const result = buildYieldOnCostSeries(series, { frequency: 'Q', visibleStart: '2021-05-05' })
  const at = date => result.y[result.x.indexOf(date)]
  // The chart rounds each point to four decimals, hence the looser tolerance.
  // 2022-06-22: latest four periods are Jun, Mar, Dec (0.0337) and Sep 2021.
  close(at('2022-06-22'), ((0.0193 + 0.0160 + 0.0337 + 0.0183) / cost) * 100, 1e-4)
  // 2022-09-21: Sep 2021 has rolled off; the December quarter is still counted whole.
  close(at('2022-09-21'), ((0.0197 + 0.0193 + 0.0160 + 0.0337) / cost) * 100, 1e-4)
})

// Builds a comparer series payload: one priced row per date, with div_ratio
// set so div_ratio × close recovers each payment exactly.
const comparerSeries = (dates, closeFor, payments = []) => ({
  dates,
  closes: dates.map(closeFor),
  div_ratio: dates.map(d => {
    const payment = payments.find(p => p.date === d)
    return payment ? payment.amount / closeFor(d) : 0
  }),
})

const weekdays = (start, end) => {
  const out = []
  for (let t = new Date(`${start}T00:00:00Z`); t <= new Date(`${end}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1)) {
    const dow = t.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(t.toISOString().slice(0, 10))
  }
  return out
}

test('yield on cost: weekly fund = latest ten payments × 52 over the first in-window close', () => {
  // TDAX's last ten weekly payouts as of 2026-11-20, against its 2026-01-07
  // first close of $23.97 — the chart read 20.00%.
  const amounts = [0.087, 0.087, 0.087, 0.087, 0.087, 0.099, 0.099, 0.099, 0.099, 0.091]
  const payDates = ['2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07', '2026-10-14',
    '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-10', '2026-11-18']
  const payments = payDates.map((date, i) => pay(date, amounts[i]))
  const dates = weekdays('2026-09-01', '2026-11-20')
  const series = comparerSeries(dates, d => (d === dates[0] ? 23.97 : 21), payments)
  const result = buildYieldOnCostSeries(series, { frequency: 'W', visibleStart: '2026-09-01' })
  close(result.cost, 23.97)
  close(result.annual, (amounts.reduce((a, b) => a + b, 0) / 10) * 52)
  close(result.yieldPct, 20.0017, 1e-3)
})

test('a fund that launched inside the window and has not paid is named, not dropped', () => {
  const dates = weekdays('2026-11-18', '2026-11-20')
  const series = comparerSeries(dates, () => 25)
  const options = { frequency: null, visibleStart: '2026-01-07', visibleEnd: '2026-11-20' }
  assert.equal(buildYieldOnCostSeries(series, options), null)
  assert.equal(yieldOnCostGapReason(series, options), 'no distributions yet (trading since 2026-11-18)')
})

test('an older fund with no payment in a short window reads as a window gap, not a new fund', () => {
  // The backend relabels the pre-window close onto the window's first day.
  const dates = weekdays('2026-10-20', '2026-11-20')
  const series = comparerSeries(dates, () => 50)
  const options = { frequency: 'Q', visibleStart: '2026-10-20', visibleEnd: '2026-11-20' }
  assert.equal(buildYieldOnCostSeries(series, options), null)
  assert.equal(yieldOnCostGapReason(series, options), 'no distributions in this window')
})

test('a single payment waits for a cadence unless the frequency is known', () => {
  const dates = weekdays('2026-10-23', '2026-11-20')
  const series = comparerSeries(dates, () => 20, [pay('2026-11-13', 0.4)])
  const unknown = { frequency: null, visibleStart: '2026-01-07', visibleEnd: '2026-11-20' }
  assert.equal(buildYieldOnCostSeries(series, unknown), null)
  assert.match(yieldOnCostGapReason(series, unknown), /^one distribution so far \(2026-11-13\)/)
  const monthly = buildYieldOnCostSeries(series, { ...unknown, frequency: 'M' })
  close(monthly.yieldPct, (0.4 * 12 / 20) * 100)
})

test('no in-window prices is its own reason', () => {
  const dates = weekdays('2026-01-05', '2026-01-09')
  const series = comparerSeries(dates, () => 20, [pay('2026-01-07', 0.1)])
  const options = { frequency: 'W', visibleStart: '2026-06-01', visibleEnd: '2026-06-30' }
  assert.equal(buildYieldOnCostSeries(series, options), null)
  assert.equal(yieldOnCostGapReason(series, options), 'no prices in this window')
})

// A monthly fund's last year: $0.14 a month, a $0.266 December, a $0.246
// September and a one-off $2.01 in November that is not its new monthly rate.
const MONTHLY_WITH_SPECIAL = [
  pay('2025-12-30', 0.266), pay('2026-01-28', 0.14), pay('2026-02-25', 0.14), pay('2026-03-27', 0.14),
  pay('2026-04-28', 0.14), pay('2026-05-27', 0.14), pay('2026-06-26', 0.14), pay('2026-07-29', 0.14),
  pay('2026-08-27', 0.14), pay('2026-09-28', 0.246), pay('2026-11-25', 2.01),
]

test('a one-off special is left out of the forward yield', () => {
  const estimate = annualDistributionEstimate(MONTHLY_WITH_SPECIAL, 'M')
  // The ten regular payments, averaged and annualized.
  const regular = MONTHLY_WITH_SPECIAL.slice(0, -1).map(p => p.amount)
  close(estimate.annual, (regular.reduce((a, b) => a + b, 0) / regular.length) * 12)
  assert.ok(estimate.annual < 2.2, `got ${estimate.annual}`)
  assert.match(estimate.basis, /one-off special left out/)
})

test('repeated high payments are a level change, not a special', () => {
  const history = [
    pay('2026-01-07', 0.1), pay('2026-01-14', 0.1), pay('2026-01-21', 0.1), pay('2026-01-28', 0.1),
    pay('2026-02-04', 0.1), pay('2026-03-04', 0.45), pay('2026-04-01', 0.45), pay('2026-04-29', 0.45),
  ]
  const estimate = annualDistributionEstimate(history, 'M')
  // Unchanged behaviour: the monthly run back to the last weekly payment.
  close(estimate.annual, ((0.45 * 3 + 0.1) / 4) * 12)
  assert.doesNotMatch(estimate.basis, /special/)
})
