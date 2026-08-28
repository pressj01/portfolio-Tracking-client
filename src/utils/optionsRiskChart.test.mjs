import assert from 'node:assert/strict'
import test from 'node:test'
import { interpolateRiskPnl, riskChartFocusRange, riskChartMoneynessFills, riskChartSpotValue, riskChartViewRevision } from './optionsRiskChart.js'

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

test('current-price overlay sits at the live spot, not the strike', () => {
  assert.equal(riskChartSpotValue(58.99), 58.99)
  assert.equal(riskChartSpotValue(66), 66)
  assert.equal(riskChartSpotValue(0), null)
  assert.notEqual(riskChartSpotValue(58.99), 66)
})

test('a far OTM covered call keeps current price in the OTM fill, not ITM green', () => {
  const fills = riskChartMoneynessFills({
    low: 300 / 1.1,
    high: 300 / 0.9,
    strike: 300,
    optType: 'CALL',
    spot: 266.43,
    rangeMode: 'moneyness',
  })
  const otm = fills.find(fill => fill.kind === 'OTM')
  const itm = fills.find(fill => fill.kind === 'ITM')

  assert.ok(otm)
  assert.ok(itm)
  assert.ok(otm.x0 <= 266.43)
  assert.equal(otm.x1, 300)
  assert.equal(itm.x0, 300)
  assert.ok(266.43 < itm.x0)
  assert.ok(266.43 <= otm.x1)
})

test('a missing option type does not paint the left of a call strike as ITM', () => {
  const fills = riskChartMoneynessFills({
    low: 300 / 1.1,
    high: 300 / 0.9,
    strike: 300,
    optType: '',
    spot: 266.43,
    rangeMode: 'moneyness',
  })
  const itm = fills.find(fill => fill.kind === 'ITM')

  assert.ok(itm)
  assert.ok(itm.x0 >= 300)
  assert.ok(266.43 < itm.x0)
})

test('risk graph frames a far OTM strike away from the live price', () => {
  const range = riskChartFocusRange({
    spot: 266.43,
    strikes: [300, 300 / 1.1, 300 / 0.9],
    evaluationLow: 173,
    evaluationHigh: 393,
  })
  const width = range[1] - range[0]

  assert.ok(range[0] < 266.43)
  assert.ok(range[1] > 300)
  assert.ok(range[1] >= 300 / 0.9)
  assert.ok((300 - 266.43) / width > 0.2)
  assert.ok(width < 393 - 173)
})

test('P/L at the current price is read from the curve at that spot', () => {
  const curve = [
    { s: 50, pnl: -900 },
    { s: 58.75, pnl: 0 },
    { s: 58.99, pnl: 24 },
    { s: 66, pnl: 700 },
    { s: 80, pnl: 700 },
  ]
  assert.equal(interpolateRiskPnl(curve, 58.99), 24)
  assert.equal(interpolateRiskPnl(curve, 66), 700)
  assert.ok(interpolateRiskPnl(curve, 58.99) < interpolateRiskPnl(curve, 66))
})
