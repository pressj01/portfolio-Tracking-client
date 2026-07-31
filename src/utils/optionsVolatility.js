export const MIN_VOLATILITY = 0.0001
export const MIN_VOLATILITY_SURFACE_SHOCK_PCT = -50
export const MAX_VOLATILITY_SURFACE_SHOCK_PCT = 50

export const clampVolatilitySurfaceShock = value => Math.min(
  MAX_VOLATILITY_SURFACE_SHOCK_PCT,
  Math.max(MIN_VOLATILITY_SURFACE_SHOCK_PCT, Number(value) || 0),
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
