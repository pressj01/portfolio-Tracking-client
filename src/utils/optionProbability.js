const DAYS_PER_YEAR = 365.25

function normalCdf(value) {
  if (value === Infinity) return 1
  if (value === -Infinity) return 0

  // Abramowitz and Stegun 7.1.26. Maximum error is about 7.5e-8.
  const absolute = Math.abs(value)
  const t = 1 / (1 + 0.2316419 * absolute)
  const density = 0.3989422804014327 * Math.exp(-0.5 * absolute * absolute)
  const tail = density * t * (
    0.319381530
    + t * (-0.356563782
      + t * (1.781477937
        + t * (-1.821255978 + t * 1.330274429)))
  )
  const probability = 1 - tail
  return value >= 0 ? probability : 1 - probability
}

function probabilityAtOrBelow(target, spot, horizonVolatility) {
  if (target <= 0) return 0
  if (horizonVolatility <= 0) return target >= spot ? 1 : 0
  const zScore = Math.log(target / spot) / horizonVolatility
  return normalCdf(zScore)
}

export function annualizedPriceReturnPct(currentPrice, targetPrice, daysAhead) {
  const spot = Number(currentPrice)
  const target = Number(targetPrice)
  const days = Number(daysAhead)
  if (![spot, target, days].every(Number.isFinite) || spot <= 0 || target <= 0 || days <= 0) return null
  return ((target / spot) - 1) * (DAYS_PER_YEAR / days) * 100
}

export function calculateOptionProbability({
  currentPrice,
  daysAhead,
  volatilityPct,
  firstTarget,
  secondTarget,
}) {
  const spot = Number(currentPrice)
  const days = Number(daysAhead)
  const volatility = Number(volatilityPct) / 100
  const targetA = Number(firstTarget)
  const targetB = Number(secondTarget)

  if (![spot, days, volatility, targetA, targetB].every(Number.isFinite)) return null
  if (spot <= 0 || days <= 0 || volatility <= 0 || targetA <= 0 || targetB <= 0) return null

  const timeYears = days / DAYS_PER_YEAR
  const horizonVolatility = volatility * Math.sqrt(timeYears)
  const expectedMove = spot * horizonVolatility
  const lowerTarget = Math.min(targetA, targetB)
  const upperTarget = Math.max(targetA, targetB)
  const below = probabilityAtOrBelow(lowerTarget, spot, horizonVolatility)
  const atOrBelowUpper = probabilityAtOrBelow(upperTarget, spot, horizonVolatility)
  const between = Math.max(0, atOrBelowUpper - below)
  const above = Math.max(0, 1 - atOrBelowUpper)

  return {
    spot,
    days,
    volatility,
    timeYears,
    horizonVolatility,
    expectedMove,
    lowerTarget,
    upperTarget,
    targetReturns: [targetA, targetB].map((target, index) => ({
      index,
      target,
      horizonReturnPct: ((target / spot) - 1) * 100,
      annualizedReturnPct: annualizedPriceReturnPct(spot, target, days),
    })),
    standardDeviationPrices: [-3, -2, -1, 0, 1, 2, 3].map(deviation => ({
      deviation,
      price: Math.max(0, spot + deviation * expectedMove),
    })),
    probabilityBelowPct: below * 100,
    probabilityBetweenPct: between * 100,
    probabilityAbovePct: above * 100,
  }
}

export { DAYS_PER_YEAR, normalCdf }
