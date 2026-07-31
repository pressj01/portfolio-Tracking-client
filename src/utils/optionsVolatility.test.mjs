import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyVolatilitySurfaceShock,
  clampVolatilitySurfaceShock,
  MAX_VOLATILITY_SURFACE_SHOCK_PCT,
  MIN_VOLATILITY,
  MIN_VOLATILITY_SURFACE_SHOCK_PCT,
} from './optionsVolatility.js'

const assertClose = (actual, expected, tolerance = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  )
}

test('surface shocks preserve the relative volatility skew between legs', () => {
  const lowerVolLeg = applyVolatilitySurfaceShock(0.20, 0, 10)
  const higherVolLeg = applyVolatilitySurfaceShock(0.30, 0, 10)

  assertClose(lowerVolLeg, 0.22)
  assertClose(higherVolLeg, 0.33)
  assertClose(higherVolLeg / lowerVolLeg, 1.5)
})

test('leg-specific point adjustments are applied before the surface shock', () => {
  assertClose(applyVolatilitySurfaceShock(0.20, 2, 10), 0.242)
})

test('negative surface shocks reduce each modeled volatility proportionally', () => {
  assert.equal(applyVolatilitySurfaceShock(0.20, 0, -50), 0.10)
  assert.equal(applyVolatilitySurfaceShock(0.32, 0, -50), 0.16)
})

test('surface shocks are bounded to the slider range and volatility stays positive', () => {
  assert.equal(clampVolatilitySurfaceShock(-500), MIN_VOLATILITY_SURFACE_SHOCK_PCT)
  assert.equal(clampVolatilitySurfaceShock(500), MAX_VOLATILITY_SURFACE_SHOCK_PCT)
  assert.equal(applyVolatilitySurfaceShock(0.20, -100, -50), MIN_VOLATILITY)
})
