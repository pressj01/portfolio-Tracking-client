const finitePositive = value => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function priceBelowStrike(strike, percent) {
  const pct = Math.max(0, Number(percent) || 0)
  return pct < 1000 ? strike / (1 + pct / 100) : strike * 0.5
}

function priceAboveStrike(strike, percent) {
  const pct = Math.max(0, Number(percent) || 0)
  if (pct > 0 && pct < 100) return strike / (1 - pct / 100)
  return strike * (1 + pct / 100)
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
  // Match optionMoneyness: percent is |strike − price| / price, not a haircut
  // off the strike. 10% of a $300 call is not $270, which parked "10% OTM"
  // on a $266 name and made a 12% OTM covered call look at the money.
  return {
    low: isCall ? priceBelowStrike(strike, otmPct) : priceBelowStrike(strike, itmPct),
    high: isCall ? priceAboveStrike(strike, itmPct) : priceAboveStrike(strike, otmPct),
    anchor_strike: strike,
    opt_type: optType,
    itm_pct: itmPct,
    otm_pct: otmPct,
    lower_label: `${isCall ? otmPct : itmPct}% ${isCall ? 'OTM' : 'ITM'}`,
    upper_label: `${isCall ? itmPct : otmPct}% ${isCall ? 'ITM' : 'OTM'}`,
  }
}

export function moneynessPercentFromPrice(leg, price) {
  const strike = finitePositive(leg?.strike)
  const level = finitePositive(price)
  const optType = String(leg?.opt_type || leg?.option_type || '').toUpperCase()
  if (!strike || !level || !['CALL', 'PUT'].includes(optType)) return null

  const isCall = optType === 'CALL'
  if (level >= strike) {
    return {
      edge: isCall ? 'itm' : 'otm',
      percent: Math.max(0, (1 - strike / level) * 100),
    }
  }
  return {
    edge: isCall ? 'otm' : 'itm',
    percent: Math.max(0, (strike / level - 1) * 100),
  }
}
