export const EXPIRATION_SCENARIO_STRATEGIES = new Set([
  'covered-call',
  'cash-secured-put',
  'naked-call',
  'long-call',
  'long-put',
  'bull-put-spread',
  'bear-call-spread',
])

export const EXPIRATION_SCENARIO_REFERENCES = [
  { value: 'current_pct', label: '% from the current price', unit: '%' },
  { value: 'current_atr', label: 'ATRs from the current price', unit: 'ATR' },
  { value: 'current_stddev', label: 'Std. Devs. from the current price', unit: 'σ' },
  { value: 'target_pct', label: '% from the target price', unit: '%' },
  { value: 'sma200_pct', label: '% from the MA 200', unit: '%' },
  { value: 'week52_high_pct', label: '% from the 52 week high', unit: '%' },
  { value: 'week52_low_pct', label: '% from the 52 week low', unit: '%' },
]

export const DEFAULT_EXPIRATION_SCENARIO = {
  reference: 'current_pct',
  amount: 0,
  marginRule: 'any',
  marginPct: 0,
}

const finite = value => value != null && value !== '' && Number.isFinite(Number(value))
const positive = value => finite(value) && Number(value) > 0 ? Number(value) : null

export function scenarioReferenceAvailable(reference, context = {}) {
  if (reference === 'current_pct') return positive(context.currentPrice) != null
  if (reference === 'current_atr') return positive(context.currentPrice) != null && positive(context.atr14) != null
  if (reference === 'current_stddev') return positive(context.currentPrice) != null && positive(context.annualizedVolatility) != null
  if (reference === 'target_pct') return positive(context.targetPrice) != null
  if (reference === 'sma200_pct') return positive(context.sma200) != null
  if (reference === 'week52_high_pct') return positive(context.week52High) != null
  if (reference === 'week52_low_pct') return positive(context.week52Low) != null
  return false
}

export function resolveExpirationScenarioSpot(scenario, context = {}, dte = 0) {
  const reference = String(scenario?.reference || DEFAULT_EXPIRATION_SCENARIO.reference)
  const amount = finite(scenario?.amount) ? Number(scenario.amount) : 0
  const currentPrice = positive(context.currentPrice)
  if (!scenarioReferenceAvailable(reference, context) || currentPrice == null) {
    return { spot: null, changePct: null, error: 'The selected reference is unavailable for this ticker.' }
  }

  let spot
  if (reference === 'current_atr') {
    spot = currentPrice + amount * Number(context.atr14)
  } else if (reference === 'current_stddev') {
    let annualizedVolatility = Number(context.annualizedVolatility)
    if (annualizedVolatility > 3) annualizedVolatility /= 100
    const horizonYears = Math.max(0, Number(dte) || 0) / 365
    spot = currentPrice * Math.exp(amount * annualizedVolatility * Math.sqrt(horizonYears))
  } else {
    const anchors = {
      current_pct: currentPrice,
      target_pct: Number(context.targetPrice),
      sma200_pct: Number(context.sma200),
      week52_high_pct: Number(context.week52High),
      week52_low_pct: Number(context.week52Low),
    }
    spot = anchors[reference] * (1 + amount / 100)
  }

  if (!Number.isFinite(spot) || spot <= 0) {
    return { spot: null, changePct: null, error: 'This scenario produces an invalid underlying price.' }
  }
  return {
    spot,
    changePct: (spot / currentPrice - 1) * 100,
    error: null,
  }
}

export function expirationPayoff(trade, scenarioSpot) {
  if (!trade?.legs?.length || !positive(scenarioSpot)) return null
  return trade.legs.reduce((total, leg) => {
    const sign = String(leg.side).toUpperCase() === 'SELL' ? -1 : 1
    const qty = Math.max(1, Number(leg.qty) || 1)
    const type = String(leg.opt_type).toUpperCase()
    const entry = Number(leg.entry_price) || 0
    if (type === 'STOCK') return total + sign * qty * (scenarioSpot - entry)
    const strike = Number(leg.strike)
    if (!Number.isFinite(strike) || strike <= 0) return total
    const intrinsic = type === 'PUT'
      ? Math.max(strike - scenarioSpot, 0)
      : Math.max(scenarioSpot - strike, 0)
    return total + sign * qty * 100 * (intrinsic - entry)
  }, 0)
}

export function estimateScenarioMargin(trade, reportedMaxLoss, currentPrice) {
  const maxLoss = positive(reportedMaxLoss)
  if (maxLoss != null) return maxLoss
  if (!trade?.legs?.length) return null

  const stock = trade.legs.find(leg => String(leg.opt_type).toUpperCase() === 'STOCK')
  if (stock) {
    const basis = positive(stock.entry_price) ?? positive(currentPrice)
    return basis == null ? null : basis * Math.max(1, Number(stock.qty) || 1)
  }

  const shortPut = trade.legs.find(leg => (
    String(leg.opt_type).toUpperCase() === 'PUT'
    && String(leg.side).toUpperCase() === 'SELL'
  ))
  if (shortPut && trade.legs.length === 1) {
    return Math.max(0, Number(shortPut.strike) * 100 - (Number(shortPut.entry_price) || 0) * 100)
  }
  return null
}

export function calculateExpirationScenario(trade, scenario, context, dte, reportedMaxLoss) {
  const resolved = resolveExpirationScenarioSpot(scenario, context, dte)
  if (resolved.error) return { ...resolved, pnl: null, margin: null, pnlOnMarginPct: null }
  const pnl = expirationPayoff(trade, resolved.spot)
  const margin = estimateScenarioMargin(trade, reportedMaxLoss, context?.currentPrice)
  return {
    ...resolved,
    pnl,
    margin,
    pnlOnMarginPct: pnl != null && margin ? pnl / margin * 100 : null,
  }
}

export function expirationScenarioPasses(result, scenario) {
  const rule = String(scenario?.marginRule || 'any')
  if (rule === 'any') return true
  if (!finite(result?.pnlOnMarginPct)) return false
  const threshold = finite(scenario?.marginPct) ? Number(scenario.marginPct) : 0
  return rule === 'above'
    ? Number(result.pnlOnMarginPct) >= threshold
    : Number(result.pnlOnMarginPct) <= threshold
}

export function describeExpirationScenario(scenario) {
  const option = EXPIRATION_SCENARIO_REFERENCES.find(item => item.value === scenario?.reference)
    || EXPIRATION_SCENARIO_REFERENCES[0]
  const amount = finite(scenario?.amount) ? Number(scenario.amount) : 0
  const formatted = `${amount > 0 ? '+' : ''}${amount.toLocaleString()}${option.unit === '%' ? '%' : ` ${option.unit}`}`
  const referenceText = {
    current_pct: 'from the current price',
    current_atr: 'from the current price',
    current_stddev: 'from the current price',
    target_pct: 'from the target price',
    sma200_pct: 'from the MA 200',
    week52_high_pct: 'from the 52 week high',
    week52_low_pct: 'from the 52 week low',
  }[option.value]
  return `${formatted} ${referenceText}`
}
