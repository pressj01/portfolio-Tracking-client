import test from 'node:test'
import assert from 'node:assert/strict'

import { annualizedPriceReturnPct, calculateOptionProbability, normalCdf } from './optionProbability.js'

const assertClose = (actual, expected, tolerance = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  )
}

test('normal CDF matches common standard-deviation probabilities', () => {
  assertClose(normalCdf(0), 0.5, 1e-7)
  assertClose(normalCdf(1), 0.8413447, 1e-6)
  assertClose(normalCdf(-1), 0.1586553, 1e-6)
})

test('calculator reproduces the reference standard-deviation levels and strike probability', () => {
  const result = calculateOptionProbability({
    currentPrice: 113.6,
    daysAhead: 54,
    volatilityPct: 53.7,
    firstTarget: 80,
    secondTarget: 80,
  })

  assert.ok(result)
  assertClose(result.expectedMove, 23.456, 0.001)
  assertClose(result.standardDeviationPrices[2].price, 90.144, 0.001)
  assertClose(result.standardDeviationPrices[4].price, 137.056, 0.001)
  assertClose(result.probabilityBelowPct, 4.473, 0.001)
  assert.equal(result.probabilityBetweenPct, 0)
  assertClose(result.probabilityAbovePct, 95.527, 0.001)
})

test('targets can be entered in either order and probabilities remain complementary', () => {
  const result = calculateOptionProbability({
    currentPrice: 100,
    daysAhead: 45,
    volatilityPct: 25,
    firstTarget: 110,
    secondTarget: 90,
  })

  assert.equal(result.lowerTarget, 90)
  assert.equal(result.upperTarget, 110)
  assertClose(
    result.probabilityBelowPct + result.probabilityBetweenPct + result.probabilityAbovePct,
    100,
    1e-9,
  )
})

test('target price returns are annualized over the selected calendar days', () => {
  assertClose(annualizedPriceReturnPct(100, 110, 45), 81.1666666667, 1e-9)
  assertClose(annualizedPriceReturnPct(100, 90, 45), -81.1666666667, 1e-9)
  assert.equal(annualizedPriceReturnPct(0, 110, 45), null)
})

test('invalid or incomplete inputs do not produce a result', () => {
  assert.equal(calculateOptionProbability({
    currentPrice: '', daysAhead: 45, volatilityPct: 25, firstTarget: 90, secondTarget: 110,
  }), null)
  assert.equal(calculateOptionProbability({
    currentPrice: 100, daysAhead: 0, volatilityPct: 25, firstTarget: 90, secondTarget: 110,
  }), null)
})
