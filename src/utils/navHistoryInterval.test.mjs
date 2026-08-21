import assert from 'node:assert/strict'
import test from 'node:test'

import { resampleNavHistory } from './navHistoryInterval.js'

const point = (date, value) => ({ date, value })
const dates = points => points.map(item => item.date)

test('daily history keeps every valid point in chronological order', () => {
  const result = resampleNavHistory([
    point('2026-05-20', 2),
    point('not-a-date', 99),
    point('2026-05-19', 1),
  ], 'daily')

  assert.deepEqual(dates(result), ['2026-05-19', '2026-05-20'])
})

test('weekly history keeps the last available trading-day value in each calendar week', () => {
  const result = resampleNavHistory([
    point('2026-05-22', 2),
    point('2026-05-18', 1),
    point('2026-05-29', 4),
    point('2026-05-25', 3),
  ], 'weekly')

  assert.deepEqual(result, [point('2026-05-22', 2), point('2026-05-29', 4)])
})

test('monthly history keeps the last available trading-day value in each month', () => {
  const result = resampleNavHistory([
    point('2026-06-01', 3),
    point('2026-05-19', 1),
    point('2026-06-30', 4),
    point('2026-05-29', 2),
  ], 'monthly')

  assert.deepEqual(result, [point('2026-05-29', 2), point('2026-06-30', 4)])
})
