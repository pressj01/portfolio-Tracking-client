import { normalCdf } from './optionProbability.js'

const RISK_VIEW_REVISION = 'risk-profile-view-v5'
export const RISK_CHART_SPOT_COLOR = '#ffd166'
export const RISK_CHART_SLICE_COLOR = '#ff9f43'

// thinkorswim's Prob range choices: the share of outcomes inside ±1, 2 or 3σ.
export const PROBABILITY_SIGMA_PRESETS = [
  { sigma: 1, pct: 68.27 },
  { sigma: 2, pct: 95.45 },
  { sigma: 3, pct: 99.73 },
]

export function matchingSigmaPreset(rangePct) {
  const value = Number(rangePct)
  return PROBABILITY_SIGMA_PRESETS.find(preset => Math.abs(preset.pct - value) < 0.005)?.sigma ?? null
}

const usableIv = value => {
  const iv = Number(value)
  // Yahoo reports near-zero IVs for dead quotes after hours; ignore them.
  return iv > 0.01 && iv < 5 ? iv : null
}

/**
 * At-the-money implied volatility for one expiration's chain: the call and put
 * IVs at the strikes bracketing the underlying, interpolated to the price.
 * The probability band is the underlying's expected move, which this prices.
 */
export function atmImpliedVolatility(chain, spot) {
  const price = Number(spot)
  if (!(price > 0) || !chain) return null
  const byStrike = new Map()
  ;[...(chain.calls || []), ...(chain.puts || [])].forEach(contract => {
    const strike = Number(contract?.strike)
    const iv = usableIv(contract?.iv)
    if (!(strike > 0) || iv == null) return
    const values = byStrike.get(strike) || []
    values.push(iv)
    byStrike.set(strike, values)
  })
  const strikes = [...byStrike.keys()].sort((a, b) => a - b)
  if (!strikes.length) return null
  const average = strike => {
    const values = byStrike.get(strike)
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  const above = strikes.find(strike => strike >= price)
  const below = [...strikes].reverse().find(strike => strike <= price)
  if (above == null) return average(below)
  if (below == null || above === below) return average(above)
  const weight = (price - below) / (above - below)
  return average(below) + (average(above) - average(below)) * weight
}

/** Risk-neutral lognormal probability the price finishes below `price` (as the backend band). */
export function lognormalBelowProbability(price, { spot, iv, years, rate = 0, dividendYield = 0 } = {}) {
  const target = Number(price)
  const base = Number(spot)
  const sigma = Math.max(Number(iv) || 0, 1e-4)
  const time = Number(years)
  if (!(base > 0) || !(target > 0)) return 0
  if (!(time > 1e-8)) return base <= target ? 1 : 0
  const mu = Math.log(base) + ((Number(rate) || 0) - (Number(dividendYield) || 0) - 0.5 * sigma * sigma) * time
  return normalCdf((Math.log(target) - mu) / (sigma * Math.sqrt(time)))
}

/**
 * thinkorswim's percentages between price slices: the chance the price
 * finishes in each zone, tails included, so the zones add up to 100%.
 */
export function sliceZoneProbabilities(prices, distribution) {
  const edges = [...new Set((prices || []).map(Number).filter(price => price > 0))].sort((a, b) => a - b)
  if (!edges.length || !(Number(distribution?.spot) > 0)) return []
  const below = edges.map(edge => lognormalBelowProbability(edge, distribution))
  return [
    { low: null, high: edges[0], pct: below[0] * 100 },
    ...edges.slice(1).map((edge, index) => ({ low: edges[index], high: edge, pct: (below[index + 1] - below[index]) * 100 })),
    { low: edges.at(-1), high: null, pct: (1 - below.at(-1)) * 100 },
  ]
}

// thinkorswim's "Set slices": the outer slices sit this far below and above the
// underlying, and the middle slice always returns to the current price.
export const PRICE_SLICE_PRESETS = [5, 10, 15, 20, 25, 30]

export function priceSlicePresetOffsets(percent) {
  const value = Math.abs(Number(percent))
  if (!Number.isFinite(value) || value <= 0) return null
  return [-value, 0, value]
}

/** The Set slices spacing the offsets sit on exactly, or null once any slice has moved. */
export function matchingSlicePreset(offsets) {
  const values = (offsets || []).map(Number)
  if (values.length !== 3) return null
  return PRICE_SLICE_PRESETS.find(percent => (
    priceSlicePresetOffsets(percent).every((expected, index) => Math.abs(values[index] - expected) < 1e-9)
  )) ?? null
}

/** A dragged slice's price as the % move the slices table and risk request use. */
export function priceSliceOffsetFromPrice(price, spot) {
  const target = Number(price)
  const base = Number(spot)
  if (!(target > 0) || !(base > 0)) return null
  return Math.round((target / base - 1) * 10000) / 100
}

// The P/L axis is fixed, so a price window only a few dollars wide flattens
// every curve into the zero line and the graph looks empty. A stray drag that
// starts a zoom box is the usual cause.
const MIN_PRICE_SPAN_SPOT_FRACTION = 0.05
const MIN_PRICE_SPAN_MODELED_FRACTION = 0.1

export function riskChartMinimumPriceSpan(spot, modeledLow, modeledHigh) {
  const spotValue = Number(spot)
  if (spotValue > 0) return spotValue * MIN_PRICE_SPAN_SPOT_FRACTION
  const span = Number(modeledHigh) - Number(modeledLow)
  return span > 0 ? span * MIN_PRICE_SPAN_MODELED_FRACTION : 0
}

/** The widened range when a zoom falls below the minimum span, else null. */
export function widenRiskChartPriceRange(range, minimumSpan) {
  const [first, second] = (range || []).map(Number)
  if (![first, second].every(Number.isFinite) || !(minimumSpan > 0)) return null
  if (Math.abs(second - first) >= minimumSpan) return null
  const center = (first + second) / 2
  return [center - minimumSpan / 2, center + minimumSpan / 2]
}

/**
 * Widen a price window just enough to show every price in `prices`, never
 * past the modeled curve. Used so Set slices never leaves a slice off-screen.
 */
export function riskChartRangeWithPrices(range, prices, modeledLow, modeledHigh, padFraction = 0.03) {
  let [low, high] = (range || []).map(Number)
  if (!Number.isFinite(low) || !Number.isFinite(high) || !(high > low)) return range
  const values = (prices || []).map(Number).filter(Number.isFinite)
  // Leave a window that already shows every price alone, so dropping a slice
  // never nudges the view.
  if (values.every(price => price >= low && price <= high)) return [low, high]
  const pad = (high - low) * padFraction
  values.forEach(price => {
    if (price - pad < low) low = price - pad
    if (price + pad > high) high = price + pad
  })
  const floor = Number(modeledLow)
  const ceiling = Number(modeledHigh)
  if (Number.isFinite(floor)) low = Math.max(low, floor)
  if (Number.isFinite(ceiling)) high = Math.min(high, ceiling)
  return [low, high]
}

/** Index of the handle nearest `x` within `tolerance` pixels, or -1. */
export function nearestRiskHandleIndex(pixels, x, tolerance) {
  let best = -1
  let bestDistance = Infinity
  ;(pixels || []).forEach((pixel, index) => {
    const distance = Math.abs(Number(pixel) - x)
    if (Number.isFinite(distance) && distance <= tolerance && distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}


export function interpolateRiskPnl(curve, price) {
  if (!Array.isArray(curve) || !curve.length) return null
  const target = Number(price)
  if (!Number.isFinite(target)) return null
  if (target <= curve[0].s) return Number(curve[0].pnl)
  const last = curve[curve.length - 1]
  if (target >= last.s) return Number(last.pnl)
  let low = 0
  let high = curve.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (curve[mid].s <= target) low = mid
    else high = mid
  }
  const left = curve[low]
  const right = curve[high]
  const span = right.s - left.s || 1
  return left.pnl + ((target - left.s) / span) * (right.pnl - left.pnl)
}


export function riskChartSpotValue(spot) {
  const value = Number(spot)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function riskChartMoneynessFills({
  low,
  high,
  strike,
  optType,
  rangeMode,
} = {}) {
  const rangeLow = Number(low)
  const rangeHigh = Number(high)
  if (!(rangeHigh > rangeLow)) return []

  const anchorStrike = Number(strike)
  const isPut = String(optType || '').toUpperCase() === 'PUT'
  const splitAtStrike = rangeMode !== 'probability' && anchorStrike > 0
    && rangeLow < anchorStrike && rangeHigh > anchorStrike
  if (!splitAtStrike) {
    return [{ kind: 'band', x0: rangeLow, x1: rangeHigh }]
  }

  // Missing type must not be treated as a put: that paints green ITM *below*
  // the strike, which is exactly how a far-OTM covered call was looking ITM.
  // Both fills end at the range edges, like thinkorswim's shading; stretching
  // the OTM fill out to the live price hid where the range actually ends.
  const otmLow = isPut ? anchorStrike : rangeLow
  const otmHigh = isPut ? rangeHigh : anchorStrike
  const itmLow = isPut ? rangeLow : anchorStrike
  const itmHigh = isPut ? anchorStrike : rangeHigh
  return [
    { kind: 'OTM', x0: otmLow, x1: otmHigh },
    { kind: 'ITM', x0: itmLow, x1: itmHigh },
  ]
}

export function riskChartFocusRange({
  spot,
  strikes,
  evaluationLow,
  evaluationHigh,
} = {}) {
  const low = Number(evaluationLow)
  const high = Number(evaluationHigh)
  if (!(high > low)) return null

  const spotValue = riskChartSpotValue(spot)
  const strikeValues = (strikes || []).map(Number).filter(value => Number.isFinite(value) && value > 0)
  const anchors = [spotValue, ...strikeValues].filter(value => value != null)
  if (!anchors.length) return [low, high]

  const innerLow = Math.min(...anchors)
  const innerHigh = Math.max(...anchors)
  const innerSpan = Math.max(innerHigh - innerLow, (spotValue || innerHigh) * 0.08)
  const pad = Math.max(innerSpan * 0.45, (spotValue || innerHigh) * 0.08)
  return [
    Math.max(low, innerLow - pad),
    Math.min(high, innerHigh + pad),
  ]
}

// Plotly preserves zoom and pan state while this revision stays unchanged.
// Volatility and evaluation date are pricing scenarios, not structural changes,
// so neither belongs in the view identity. Scanner handoffs all use this same
// risk chart and therefore inherit the same viewport behavior.
export function riskChartViewRevision(result = {}, evaluation = []) {
  const viewLegs = (result.per_leg || []).map(leg => [
    leg.side,
    leg.qty,
    leg.opt_type,
    leg.strike,
    leg.expiration,
    leg.entry_price,
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  const horizonDate = result.curves?.expiration_date || result.analysis_horizon

  return JSON.stringify({
    version: RISK_VIEW_REVISION,
    underlying: result.underlying,
    horizonDate,
    priceRange: [evaluation[0]?.s, evaluation[evaluation.length - 1]?.s],
    legs: viewLegs,
  })
}
