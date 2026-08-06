import assert from 'node:assert/strict'
import test from 'node:test'
import { riskChartViewRevision } from './optionsRiskChart.js'

const evaluation = [{ s: 80 }, { s: 100 }, { s: 120 }]
const result = {
  underlying: 'SPY',
  eval_date: '2026-08-01',
  analysis_horizon: '2026-10-16',
  curves: { expiration_date: '2026-10-16' },
  per_leg: [{
    side: 'BUY',
    qty: 1,
    opt_type: 'CALL',
    strike: 105,
    expiration: '2026-10-16',
    entry_price: 4.25,
    iv: 0.20,
  }],
}

test('risk chart viewport survives volatility and time scenario changes', () => {
  const initialRevision = riskChartViewRevision(result, evaluation)
  const volatilityRevision = riskChartViewRevision({
    ...result,
    per_leg: [{ ...result.per_leg[0], iv: 0.35 }],
  }, evaluation)
  const timeRevision = riskChartViewRevision({
    ...result,
    eval_date: '2026-09-01',
  }, evaluation)

  assert.equal(volatilityRevision, initialRevision)
  assert.equal(timeRevision, initialRevision)
})

test('risk chart viewport resets for structural and modeled price-range changes', () => {
  const initialRevision = riskChartViewRevision(result, evaluation)
  const structureRevision = riskChartViewRevision({
    ...result,
    per_leg: [{ ...result.per_leg[0], strike: 110 }],
  }, evaluation)
  const priceRangeRevision = riskChartViewRevision(result, [{ s: 70 }, { s: 100 }, { s: 130 }])

  assert.notEqual(structureRevision, initialRevision)
  assert.notEqual(priceRangeRevision, initialRevision)
})
