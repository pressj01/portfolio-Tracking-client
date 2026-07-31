export const MIN_VOLATILITY = 0.0001
export const MIN_VOLATILITY_SURFACE_SHOCK_PCT = -50
export const MAX_VOLATILITY_SURFACE_SHOCK_PCT = 50
export const MIN_VOLATILITY_SKEW_POINTS = -20
export const MAX_VOLATILITY_SKEW_POINTS = 20
export const MIN_VOLATILITY_TERM_POINTS = -50
export const MAX_VOLATILITY_TERM_POINTS = 50

export const VOLATILITY_DYNAMICS = Object.freeze({
  STICKY_STRIKE: 'sticky-strike',
  STICKY_DELTA: 'sticky-delta',
})

// A transparent, deliberately modest joint crash scenario. A volatility event
// is not only a parallel level change: downside put skew normally steepens as
// well. Keeping this preset explicit avoids silently coupling two independent
// controls while still making the combined scenario one click away.
export const CRASH_VOLATILITY_PRESET = Object.freeze({
  surfaceShockPct: 50,
  skewPoints: 2,
  dynamics: VOLATILITY_DYNAMICS.STICKY_STRIKE,
})

export const clampVolatilitySurfaceShock = value => Math.min(
  MAX_VOLATILITY_SURFACE_SHOCK_PCT,
  Math.max(MIN_VOLATILITY_SURFACE_SHOCK_PCT, Number(value) || 0),
)

export const clampVolatilitySkewPoints = value => Math.min(
  MAX_VOLATILITY_SKEW_POINTS,
  Math.max(MIN_VOLATILITY_SKEW_POINTS, Number(value) || 0),
)

export const clampVolatilityTermPoints = value => Math.min(
  MAX_VOLATILITY_TERM_POINTS,
  Math.max(MIN_VOLATILITY_TERM_POINTS, Number(value) || 0),
)

export const applyVolatilitySurfaceShock = (
  marketIv,
  legAdjustmentPoints = 0,
  surfaceShockPct = 0,
) => {
  const baseIv = Number(marketIv) > 0 ? Number(marketIv) : 0.2
  const adjustedLegIv = Math.max(
    MIN_VOLATILITY,
    baseIv + (Number(legAdjustmentPoints) || 0) / 100,
  )
  const shockMultiplier = 1 + clampVolatilitySurfaceShock(surfaceShockPct) / 100
  return Math.max(MIN_VOLATILITY, adjustedLegIv * shockMultiplier)
}

/**
 * Express strike location in units of a 10% downside move. A 90 strike with a
 * 100 spot is approximately +1 while a 110 strike is approximately -1.
 */
export const downsideMoneynessUnits = (strike, spot) => {
  const safeStrike = Number(strike)
  const safeSpot = Number(spot)
  if (!(safeStrike > 0) || !(safeSpot > 0)) return 0
  return -Math.log(safeStrike / safeSpot) / Math.log(1.1)
}

export const buildVolatilityScenarioLeg = (leg, scenario = {}) => {
  const marketIv = Number(leg?.iv) > 0 ? Number(leg.iv) : 0.2
  const legAdjustmentPoints = Number(leg?.iv_adjustment) || 0
  const adjustedIv = Math.max(MIN_VOLATILITY, marketIv + legAdjustmentPoints / 100)
  const parallelIv = applyVolatilitySurfaceShock(
    marketIv,
    legAdjustmentPoints,
    scenario.surfaceShockPct,
  )
  const skewPoints = clampVolatilitySkewPoints(scenario.skewPoints)
  const skewContribution = downsideMoneynessUnits(leg?.strike, scenario.spot) * skewPoints / 100
  const expiration = String(leg?.expiration || '')
  const termPoints = clampVolatilityTermPoints(scenario.termShocks?.[expiration])
  const modeledIv = Math.max(MIN_VOLATILITY, parallelIv + skewContribution + termPoints / 100)

  return {
    marketIv,
    adjustedIv,
    parallelIv,
    parallelChangePoints: (parallelIv - adjustedIv) * 100,
    skewContributionPoints: skewContribution * 100,
    termContributionPoints: termPoints,
    totalChangePoints: (modeledIv - adjustedIv) * 100,
    modeledIv,
  }
}

/**
 * Estimate the displayed surface's downside-skew slope separately for every
 * expiration. The result is used only by sticky-delta scenario repricing.
 */
export const estimateVolatilitySkewByExpiration = (legs, scenarioByLegId, spot) => {
  const groups = new Map()
  ;(legs || []).forEach(leg => {
    const expiration = String(leg?.expiration || '')
    const record = scenarioByLegId?.[leg?.local_id]
    const x = downsideMoneynessUnits(leg?.strike, spot)
    const y = Number(record?.modeledIv) * 100
    if (!expiration || !Number.isFinite(x) || !Number.isFinite(y)) return
    if (!groups.has(expiration)) groups.set(expiration, [])
    groups.get(expiration).push({ x, y })
  })

  return Object.fromEntries([...groups.entries()].map(([expiration, points]) => {
    if (points.length < 2) return [expiration, 0]
    const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length
    const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0)
    if (denominator <= 1e-12) return [expiration, 0]
    const slope = points.reduce(
      (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
      0,
    ) / denominator
    return [expiration, Math.min(100, Math.max(-100, slope))]
  }))
}
