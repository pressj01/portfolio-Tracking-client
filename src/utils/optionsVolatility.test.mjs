import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyVolatilitySurfaceShock,
  buildVolatilityScenarioLeg,
  clampVolatilitySurfaceShock,
  CRASH_VOLATILITY_PRESET,
  downsideMoneynessUnits,
  estimateVolatilitySkewByExpiration,
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

test('downside skew steepening raises lower-strike IV and lowers upper-strike IV', () => {
  const lower = buildVolatilityScenarioLeg(
    { strike: 90, expiration: '2026-09-18', iv: 0.25, iv_adjustment: 0 },
    { spot: 100, skewPoints: 2, termShocks: {} },
  )
  const upper = buildVolatilityScenarioLeg(
    { strike: 110, expiration: '2026-09-18', iv: 0.25, iv_adjustment: 0 },
    { spot: 100, skewPoints: 2, termShocks: {} },
  )

  assert.ok(downsideMoneynessUnits(90, 100) > 0)
  assert.ok(downsideMoneynessUnits(110, 100) < 0)
  assert.ok(lower.modeledIv > 0.25)
  assert.ok(upper.modeledIv < 0.25)
})

test('crash preset gives the far-downside hedge the largest IV-point increase', () => {
  const spot = 748.18
  const legs = [
    { strike: 355, expiration: '2027-01-15', iv: 0.4919 },
    { strike: 655, expiration: '2027-01-15', iv: 0.2124 },
    { strike: 710, expiration: '2027-01-15', iv: 0.1687 },
  ]
  const scenarios = legs.map(leg => buildVolatilityScenarioLeg(leg, {
    spot,
    surfaceShockPct: CRASH_VOLATILITY_PRESET.surfaceShockPct,
    skewPoints: CRASH_VOLATILITY_PRESET.skewPoints,
    termShocks: {},
  }))

  assert.equal(CRASH_VOLATILITY_PRESET.surfaceShockPct, 50)
  assert.equal(CRASH_VOLATILITY_PRESET.skewPoints, 2)
  assert.ok(scenarios[0].totalChangePoints > scenarios[1].totalChangePoints)
  assert.ok(scenarios[1].totalChangePoints > scenarios[2].totalChangePoints)
})

test('expiration-specific term shocks affect only their matching legs', () => {
  const near = buildVolatilityScenarioLeg(
    { strike: 100, expiration: '2026-08-21', iv: 0.20 },
    { spot: 100, termShocks: { '2026-08-21': -3, '2026-09-18': 4 } },
  )
  const far = buildVolatilityScenarioLeg(
    { strike: 100, expiration: '2026-09-18', iv: 0.20 },
    { spot: 100, termShocks: { '2026-08-21': -3, '2026-09-18': 4 } },
  )

  assertClose(near.modeledIv, 0.17)
  assertClose(far.modeledIv, 0.24)
})

test('scenario details reconcile baseline and modeled volatility', () => {
  const result = buildVolatilityScenarioLeg(
    { strike: 90, expiration: '2026-08-21', iv: 0.20, iv_adjustment: 1 },
    {
      spot: 100,
      surfaceShockPct: 10,
      skewPoints: 2,
      termShocks: { '2026-08-21': 3 },
    },
  )

  assertClose(result.adjustedIv, 0.21)
  assertClose(result.parallelIv, 0.231)
  assertClose(
    result.modeledIv,
    result.adjustedIv + result.totalChangePoints / 100,
  )
})

test('modeled skew is estimated independently for each expiration', () => {
  const legs = [
    { local_id: 'near-low', expiration: '2026-08-21', strike: 90 },
    { local_id: 'near-high', expiration: '2026-08-21', strike: 110 },
    { local_id: 'far-low', expiration: '2026-09-18', strike: 90 },
    { local_id: 'far-high', expiration: '2026-09-18', strike: 110 },
  ]
  const slopes = estimateVolatilitySkewByExpiration(legs, {
    'near-low': { modeledIv: 0.30 },
    'near-high': { modeledIv: 0.20 },
    'far-low': { modeledIv: 0.27 },
    'far-high': { modeledIv: 0.23 },
  }, 100)

  assert.ok(slopes['2026-08-21'] > slopes['2026-09-18'])
  assert.ok(slopes['2026-09-18'] > 0)
})
