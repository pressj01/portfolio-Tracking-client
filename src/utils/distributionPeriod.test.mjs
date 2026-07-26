import assert from 'node:assert/strict'
import test from 'node:test'
import {
  distributionPeriodsPerYear,
  distributionYieldPeriodLabel,
} from './distributionPeriod.js'

test('uses authoritative quarterly metadata for a one-payment fund', () => {
  const label = distributionYieldPeriodLabel(['2026-06'], 'Quarterly')

  assert.equal(label, 'Quarterly')
  assert.equal(distributionPeriodsPerYear(label), 4)
})

test('does not call a one-payment fund monthly when frequency is unknown', () => {
  const label = distributionYieldPeriodLabel(['2026-06'])

  assert.equal(label, 'Distribution')
  assert.equal(distributionPeriodsPerYear(label), null)
})

test('infers monthly and quarterly periods from observed payment months', () => {
  assert.equal(
    distributionYieldPeriodLabel(['2026-01', '2026-02', '2026-03']),
    'Monthly',
  )
  assert.equal(
    distributionYieldPeriodLabel(['2025-09', '2025-12', '2026-03', '2026-06']),
    'Quarterly',
  )
})
