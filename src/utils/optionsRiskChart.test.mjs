import assert from 'node:assert/strict'
import test from 'node:test'
import { atmImpliedVolatility, interpolateRiskPnl, lognormalBelowProbability, matchingSigmaPreset, matchingSlicePreset, nearestRiskHandleIndex, PRICE_SLICE_PRESETS, priceSliceOffsetFromPrice, priceSlicePresetOffsets, riskChartFocusRange, riskChartMinimumPriceSpan, riskChartMoneynessFills, riskChartRangeWithPrices, riskChartSpotValue, riskChartViewRevision, sliceZoneProbabilities, widenRiskChartPriceRange } from './optionsRiskChart.js'

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

test('moneyness fills end at the range edges and never paint the live price ITM', () => {
  // thinkorswim shades only the range itself; stretching the OTM fill out to a
  // live price beyond the 10% OTM edge hid where the range ends.
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
  assert.equal(otm.x0, 300 / 1.1)
  assert.equal(otm.x1, 300)
  assert.equal(itm.x0, 300)
  assert.equal(itm.x1, 300 / 0.9)
  assert.ok(266.43 < itm.x0)

  const put = riskChartMoneynessFills({ low: 671 / 1.1, high: 671 / 0.9, strike: 671, optType: 'PUT', spot: 765.61, rangeMode: 'moneyness' })
  assert.ok(Math.abs(put.find(fill => fill.kind === 'OTM').x1 - 745.56) < 0.01)
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

test('Set slices returns the middle slice to the current price', () => {
  assert.deepEqual(PRICE_SLICE_PRESETS, [5, 10, 15, 20, 25, 30])
  for (const percent of PRICE_SLICE_PRESETS) {
    assert.deepEqual(priceSlicePresetOffsets(percent), [-percent, 0, percent])
  }
  assert.equal(priceSlicePresetOffsets(0), null)
  assert.equal(priceSlicePresetOffsets('x'), null)
})

test('a dragged slice becomes a % move from the underlying', () => {
  assert.equal(priceSliceOffsetFromPrice(842.03, 765.48), 10)
  assert.equal(priceSliceOffsetFromPrice(688.93, 765.48), -10)
  assert.equal(priceSliceOffsetFromPrice(765.48, 765.48), 0)
  assert.equal(priceSliceOffsetFromPrice(700, 0), null)
})

test('a stray zoom box cannot collapse the price axis to a sliver', () => {
  // The reproduced drag zoomed SPY to $743.95–$765.49 and the graph looked empty.
  const minimum = riskChartMinimumPriceSpan(765.55, 497, 1034)
  assert.ok(Math.abs(minimum - 38.2775) < 1e-9)
  const widened = widenRiskChartPriceRange([743.95, 765.49], minimum)
  assert.ok(Math.abs((widened[1] - widened[0]) - minimum) < 1e-9)
  assert.ok(Math.abs((widened[0] + widened[1]) / 2 - 754.72) < 1e-9)
  assert.equal(widenRiskChartPriceRange([517.8, 845.8], minimum), null)
  assert.equal(riskChartMinimumPriceSpan(null, 500, 1000), 50)
})

test('overlapping grab strips pick the nearest line', () => {
  assert.equal(nearestRiskHandleIndex([1172, 1183, 895], 1180, 9), 1)
  assert.equal(nearestRiskHandleIndex([1172, 1183, 895], 1175, 9), 0)
  assert.equal(nearestRiskHandleIndex([1172, 1183], 1000, 9), -1)
})

test('slices widen the view to stay on screen but never past the model', () => {
  // ±30% SPY slices from the default window.
  const [low, high] = riskChartRangeWithPrices([545.3, 833.9], [535.89, 765.55, 995.22], 497, 1034)
  assert.ok(low < 535.89 && low >= 497)
  assert.ok(high > 995.22 && high <= 1034)
  assert.deepEqual(riskChartRangeWithPrices([545.3, 833.9], [650, 765.55], 497, 1034), [545.3, 833.9])
  assert.deepEqual(riskChartRangeWithPrices([545.3, 833.9], [1200], 497, 1034)[1], 1034)
})

test('the Set slices menu shows the spacing until a slice moves', () => {
  assert.equal(matchingSlicePreset([-15, 0, 15]), 15)
  assert.equal(matchingSlicePreset([-10, 0, 10]), 10)
  assert.equal(matchingSlicePreset(['-30', '0', '30']), 30)
  assert.equal(matchingSlicePreset([-9.87, 0, 10]), null)
  assert.equal(matchingSlicePreset([-10, 1.2, 10]), null)
  assert.equal(matchingSlicePreset([-12, 0, 12]), null)
})

test('dropping a slice inside the view leaves the view alone', () => {
  assert.deepEqual(riskChartRangeWithPrices([545.2, 889.1], [664.47, 765.61, 880.45], 497, 1034), [545.2, 889.1])
})

test('Prob range presets are thinkorswim sigma bands', () => {
  assert.equal(matchingSigmaPreset(68.27), 1)
  assert.equal(matchingSigmaPreset('95.45'), 2)
  assert.equal(matchingSigmaPreset(99.73), 3)
  assert.equal(matchingSigmaPreset(80), null)
})

test('the band uses at-the-money IV, interpolated to the price', () => {
  const chain = {
    calls: [{ strike: 760, iv: 0.15 }, { strike: 770, iv: 0.13 }, { strike: 900, iv: 0.12 }],
    puts: [{ strike: 760, iv: 0.17 }, { strike: 770, iv: 0.15 }, { strike: 671, iv: 0.26 }, { strike: 765, iv: 0.00001 }],
  }
  // 760 averages 16%, 770 averages 14%; 765.61 sits 56.1% of the way up.
  assert.ok(Math.abs(atmImpliedVolatility(chain, 765.61) - (0.16 - 0.02 * 0.561)) < 1e-9)
  assert.equal(atmImpliedVolatility({ calls: [], puts: [] }, 765.61), null)
  assert.equal(atmImpliedVolatility(chain, 0), null)
})

test('zone odds between slices use the band distribution and add to 100%', () => {
  const distribution = { spot: 765.42, iv: 0.165, years: 64 / 365, rate: 0.0375, dividendYield: 0.012 }
  const zones = sliceZoneProbabilities([688.88, 765.42, 841.96], distribution)
  assert.equal(zones.length, 4)
  assert.ok(Math.abs(zones.reduce((sum, zone) => sum + zone.pct, 0) - 100) < 1e-9)
  assert.equal(zones[0].low, null)
  assert.equal(zones.at(-1).high, null)
  // Same shape as thinkorswim's 5.84% / 42.49% / 42.64% / 9.03% at ±10%.
  assert.ok(zones[0].pct > 4 && zones[0].pct < 8)
  assert.ok(zones[3].pct > zones[0].pct)
  assert.ok(zones[1].pct > 40 && zones[2].pct > 40)
  // ±1σ edges hold 68.27% on the same distribution the backend band uses.
  const drift = Math.log(765.42) + (0.0375 - 0.012 - 0.5 * 0.165 ** 2) * (64 / 365)
  const scale = 0.165 * Math.sqrt(64 / 365)
  const inside = lognormalBelowProbability(Math.exp(drift + scale), distribution) - lognormalBelowProbability(Math.exp(drift - scale), distribution)
  assert.ok(Math.abs(inside - 0.6827) < 1e-4)
  assert.equal(lognormalBelowProbability(700, { ...distribution, years: 0 }), 0)
})
