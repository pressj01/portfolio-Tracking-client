import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GRADE_LIFETIME_CARD_NOTE,
  GRADE_LIFETIME_SKIP_NOTE,
  GRADE_PERIOD_HELP_ROWS,
  LIFE_VS_ALL_HELP_ROWS,
  GRADE_WINDOW_NOTE,
  formatPerformanceAsOf,
  formatPerformanceDate,
  isLifetimePerformancePeriod,
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

test('Life is not a market window, so grade copy says lifetime has no grade', () => {
  assert.equal(isLifetimePerformancePeriod('lifetime'), true)
  assert.equal(isLifetimePerformancePeriod('ytd'), false)
  assert.match(GRADE_WINDOW_NOTE, /YTD/)
  assert.match(GRADE_WINDOW_NOTE, /Life is cost-basis/)
  assert.match(GRADE_LIFETIME_SKIP_NOTE, /Grade cannot be computed for the Lifetime setting/)
  assert.equal(GRADE_LIFETIME_CARD_NOTE, 'Cannot compute for Lifetime')
  const lifeRow = GRADE_PERIOD_HELP_ROWS.find(row => row.filter === 'Life')
  assert.match(lifeRow.grade, /cannot be computed for the Lifetime setting/)
  const marketRow = GRADE_PERIOD_HELP_ROWS.find(row => row.filter.includes('5Y'))
  assert.match(marketRow.grade, /5Y and All both work/)
  const priceRow = LIFE_VS_ALL_HELP_ROWS.find(row => row.topic === 'Price Return')
  assert.match(priceRow.life, /Holdings Life G\/L/)
  assert.match(priceRow.all, /Time-weighted/)
})
