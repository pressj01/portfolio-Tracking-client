import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatPerformanceAsOf,
  formatPerformanceDate,
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
