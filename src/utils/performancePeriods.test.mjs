import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GRADE_LIFETIME_CARD_NOTE,
  GRADE_LIFETIME_SKIP_NOTE,
  GRADE_PERIOD_HELP_ROWS,
  LIFE_VS_ALL_HELP_ROWS,
  GRADE_WINDOW_NOTE,
  PERFORMANCE_PERIODS,
  formatPerformanceAsOf,
  formatPerformanceDate,
  isLifetimePerformancePeriod,
  performancePeriodUnavailableReason,
  performancePeriodWindow,
  todayInputValue,
} from './performancePeriods.js'

test('today with a clock stamp is labeled as a live price', () => {
  const today = todayInputValue()
  const label = formatPerformanceAsOf(today, `${today}T15:12:00`)
  assert.equal(label.startsWith(`As of ${formatPerformanceDate(today)} · live price`), true)
  assert.match(label, /read /)
})

test('today without a clock stamp is still labeled as a live price', () => {
  const today = todayInputValue()
  assert.equal(
    formatPerformanceAsOf(today),
    `As of ${formatPerformanceDate(today)} · live price`,
  )
})

test('a prior day is always labeled as the close', () => {
  assert.equal(
    formatPerformanceAsOf('2026-08-18'),
    'As of 8/18/2026 close',
  )
})

test('Open G/L is not a market window, so grade copy says lifetime has no grade', () => {
  assert.equal(isLifetimePerformancePeriod('lifetime'), true)
  assert.equal(isLifetimePerformancePeriod('ytd'), false)
  assert.match(GRADE_WINDOW_NOTE, /YTD/)
  assert.match(GRADE_WINDOW_NOTE, /Open G\/L is cost-basis/)
  assert.match(GRADE_LIFETIME_SKIP_NOTE, /Grade cannot be computed for Open G\/L/)
  assert.equal(GRADE_LIFETIME_CARD_NOTE, 'Cannot compute for Open G/L')
  const lifeRow = GRADE_PERIOD_HELP_ROWS.find(row => row.filter === 'Open G/L')
  assert.match(lifeRow.grade, /cannot be computed for Open G\/L/)
  const marketRow = GRADE_PERIOD_HELP_ROWS.find(row => row.filter.includes('5Y'))
  assert.match(marketRow.grade, /5Y and All Market both work/)
  const priceRow = LIFE_VS_ALL_HELP_ROWS.find(row => row.topic === 'Price Return')
  assert.match(priceRow.life, /Holdings Open Position G\/L/)
  assert.match(priceRow.all, /Time-weighted/)
})

test('year presets run from 1Y through 10Y in order, skipping only 4Y', () => {
  const years = PERFORMANCE_PERIODS.map(option => option.key).filter(key => /^\d+y$/.test(key))
  assert.deepEqual(years, ['1y', '2y', '3y', '5y', '6y', '7y', '8y', '9y', '10y'])
  assert.equal(PERFORMANCE_PERIODS.find(option => option.key === '10y').months, 120)
})

test('preset windows match the backend calendar offsets', () => {
  const today = '2026-07-23'
  assert.deepEqual(performancePeriodWindow('3m', { today }), { start: '2026-04-23', end: today, anchored: true })
  assert.equal(performancePeriodWindow('10y', { today }).start, '2016-07-23')
  assert.equal(performancePeriodWindow('ytd', { today }).start, '2026-01-01')
  assert.equal(performancePeriodWindow('7d', { today }).start, '2026-07-16')
  // Month-end clamps like _calendar_months_ago, and leap day falls back.
  assert.equal(performancePeriodWindow('1m', { today: '2026-03-31' }).start, '2026-02-28')
  assert.equal(performancePeriodWindow('1y', { today: '2028-02-29' }).start, '2027-02-28')
  // 1D is the last two sessions: a Monday reaches back to Friday.
  assert.deepEqual(performancePeriodWindow('1d', { today: '2026-08-10' }), { start: '2026-08-07', end: '2026-08-10', anchored: false })
  assert.equal(performancePeriodWindow('all', { today }), null)
  assert.equal(performancePeriodWindow('lifetime', { today }), null)
  assert.deepEqual(
    performancePeriodWindow('custom', { start: '2025-01-02', end: '2025-06-30', today }),
    { start: '2025-01-02', end: '2025-06-30', anchored: true },
  )
  assert.equal(performancePeriodWindow('custom', { start: '2025-06-30', end: '2025-01-02', today }), null)
})

test('a duration preset older than the first trade is unavailable', () => {
  const today = '2026-10-23'
  const inception = '2022-04-18'
  assert.equal(performancePeriodUnavailableReason('3y', inception, today), null)
  assert.match(
    performancePeriodUnavailableReason('5y', inception, today),
    /5Y starts 10\/23\/2021, but this portfolio's first trade is 4\/18\/2022/,
  )
  assert.notEqual(performancePeriodUnavailableReason('10y', inception, today), null)
})

test('a first trade just after a weekend start still has that window', () => {
  // 1Y starts Saturday 2025-10-25; the first trade the next Monday counts.
  assert.equal(performancePeriodUnavailableReason('1y', '2025-10-27', '2026-10-25'), null)
  assert.notEqual(performancePeriodUnavailableReason('1y', '2025-11-10', '2026-10-25'), null)
})

test('calendar-anchored presets and an unknown inception are never blocked', () => {
  for (const key of ['1d', '7d', 'ytd', 'all', 'lifetime', 'custom']) {
    assert.equal(performancePeriodUnavailableReason(key, '2026-10-01', '2026-10-23'), null, key)
  }
  assert.equal(performancePeriodUnavailableReason('10y', null, '2026-10-23'), null)
})
