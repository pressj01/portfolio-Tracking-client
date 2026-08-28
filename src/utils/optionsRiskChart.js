const RISK_VIEW_REVISION = 'risk-profile-view-v5'
export const RISK_CHART_SPOT_COLOR = '#ffd166'


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
  spot,
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

  const spotValue = riskChartSpotValue(spot)
  // Missing type must not be treated as a put: that paints green ITM *below*
  // the strike, which is exactly how a far-OTM covered call was looking ITM.
  let otmLow = isPut ? anchorStrike : rangeLow
  let otmHigh = isPut ? rangeHigh : anchorStrike
  const itmLow = isPut ? rangeLow : anchorStrike
  const itmHigh = isPut ? anchorStrike : rangeHigh
  // A 12% OTM call's 10% handle sits between spot and strike. Keep the live
  // price inside the OTM fill so the sold call is not painted as ITM-green.
  if (spotValue != null) {
    if (!isPut && spotValue < anchorStrike) otmLow = Math.min(otmLow, spotValue)
    else if (isPut && spotValue > anchorStrike) otmHigh = Math.max(otmHigh, spotValue)
  }
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
