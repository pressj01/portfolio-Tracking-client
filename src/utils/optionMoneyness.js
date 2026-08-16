const finitePositive = value => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function optionMoneyness(leg, spot) {
  const strike = finitePositive(leg?.strike)
  const current = finitePositive(spot)
  const optType = String(leg?.opt_type || leg?.option_type || '').toUpperCase()
  if (!strike || !current || !['CALL', 'PUT'].includes(optType)) return null

  const signedDistance = optType === 'CALL' ? current - strike : strike - current
  const percentDistance = Math.abs(signedDistance) / current * 100
  return {
    strike,
    optType,
    status: percentDistance < 0.01 ? 'ATM' : signedDistance > 0 ? 'ITM' : 'OTM',
    percentDistance,
    dollarDistance: Math.abs(current - strike),
    relativePosition: strike >= current ? 'above' : 'below',
  }
}

export function optionMoneynessRange(leg, itmPercent, otmPercent) {
  const strike = finitePositive(leg?.strike)
  const optType = String(leg?.opt_type || leg?.option_type || '').toUpperCase()
  if (!strike || !['CALL', 'PUT'].includes(optType)) return null

  const itmPct = Math.max(0, Number(itmPercent) || 0)
  const otmPct = Math.max(0, Number(otmPercent) || 0)
  const isCall = optType === 'CALL'
  return {
    low: strike * (1 - (isCall ? otmPct : itmPct) / 100),
    high: strike * (1 + (isCall ? itmPct : otmPct) / 100),
    anchor_strike: strike,
    opt_type: optType,
    itm_pct: itmPct,
    otm_pct: otmPct,
    lower_label: `${isCall ? otmPct : itmPct}% ${isCall ? 'OTM' : 'ITM'}`,
    upper_label: `${isCall ? itmPct : otmPct}% ${isCall ? 'ITM' : 'OTM'}`,
  }
}
