import { normalCdf } from './optionProbability.js'

const DEFAULT_RATE = 0.0375
const MIN_VOLATILITY = 0.0001

const finiteNumber = (value, fallback = 0) => {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function blackScholesOptionValue(
  type,
  spot,
  strike,
  years,
  volatility,
  rate = DEFAULT_RATE,
  dividendYield = 0,
) {
  const safeSpot = finiteNumber(spot)
  const safeStrike = finiteNumber(strike)
  const safeYears = finiteNumber(years)
  const safeVolatility = finiteNumber(volatility)
  if (safeYears <= 0 || safeVolatility <= 0 || safeSpot <= 0 || safeStrike <= 0) {
    return String(type).toUpperCase() === 'PUT'
      ? Math.max(safeStrike - safeSpot, 0)
      : Math.max(safeSpot - safeStrike, 0)
  }

  const safeRate = finiteNumber(rate, DEFAULT_RATE)
  const safeDividendYield = finiteNumber(dividendYield)
  const root = Math.sqrt(safeYears)
  const d1 = (
    Math.log(safeSpot / safeStrike)
    + (safeRate - safeDividendYield + safeVolatility * safeVolatility / 2) * safeYears
  ) / (safeVolatility * root)
  const d2 = d1 - safeVolatility * root
  const discountedSpot = safeSpot * Math.exp(-safeDividendYield * safeYears)
  const discountedStrike = safeStrike * Math.exp(-safeRate * safeYears)
  if (String(type).toUpperCase() === 'PUT') {
    return discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1)
  }
  return discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2)
}

/**
 * Keep the scanner's observed cross-strike volatility surface intact. The
 * compact chart exposes one IV control, so moving it shifts every leg by the
 * same number of volatility points instead of replacing every quote with one
 * average volatility.
 */
export function scannerLegVolatility(leg, baseIvPct, selectedIvPct) {
  const fallback = Math.max(MIN_VOLATILITY, finiteNumber(baseIvPct, 20) / 100)
  const marketIv = Number(leg?.iv) > 0 ? Number(leg.iv) : fallback
  const pointShift = (finiteNumber(selectedIvPct, baseIvPct) - finiteNumber(baseIvPct)) / 100
  return Math.max(MIN_VOLATILITY, marketIv + pointShift)
}

/**
 * Where the P/L crosses zero between two chart samples that straddle it. The
 * payoff is not a straight line between samples — at expiration it bends at
 * every strike — so interpolating across a strike put a bull put's breakeven
 * on the wrong side of its short strike ($676.26 for a $674.50 breakeven).
 */
export function payoffZeroBetween(valueAt, low, high, iterations = 40) {
  let lowValue = valueAt(low)
  for (let step = 0; step < iterations; step += 1) {
    const middle = (low + high) / 2
    const value = valueAt(middle)
    if (value === 0) return middle
    if (value * lowValue < 0) high = middle
    else {
      low = middle
      lowValue = value
    }
  }
  return (low + high) / 2
}

export function scannerTradePayoff(
  trade,
  scenarioSpot,
  dte,
  {
    baseIvPct = 20,
    selectedIvPct = baseIvPct,
    rate = DEFAULT_RATE,
    dividendYield = 0,
  } = {},
) {
  return (trade?.legs || []).reduce((total, leg) => {
    const sign = String(leg.side).toUpperCase() === 'SELL' ? -1 : 1
    const qty = Math.max(1, Number(leg.qty) || 1)
    const type = String(leg.opt_type).toUpperCase()
    if (type === 'STOCK') {
      return total + sign * qty * (scenarioSpot - Number(leg.entry_price || 0))
    }
    const current = blackScholesOptionValue(
      type,
      scenarioSpot,
      Number(leg.strike),
      Math.max(0, Number(dte) || 0) / 365,
      scannerLegVolatility(leg, baseIvPct, selectedIvPct),
      rate,
      dividendYield,
    )
    return total + sign * qty * 100 * (current - Number(leg.entry_price || 0))
  }, 0)
}
