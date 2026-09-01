import assert from 'node:assert/strict'
import test from 'node:test'
import {
  distributionPeriodsPerYear,
  distributionYieldPeriodLabel,
  formatDistributionFrequencyLabel,
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

test('formats issuer cadence codes including daily', () => {
  assert.equal(formatDistributionFrequencyLabel('M'), 'Monthly')
  assert.equal(formatDistributionFrequencyLabel('weekly'), 'Weekly')
  assert.equal(formatDistributionFrequencyLabel('Quarterly'), 'Quarterly')
  assert.equal(formatDistributionFrequencyLabel('D'), 'Daily')
  assert.equal(formatDistributionFrequencyLabel('daily'), 'Daily')
})

test('infers daily cadence from trading-day payment history', () => {
  const history = [
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
    '2026-08-31', '2026-09-01',
  ].map(date => ({ date, amount: 0.01 }))
  assert.equal(formatDistributionFrequencyLabel(null, history), 'Daily')
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
