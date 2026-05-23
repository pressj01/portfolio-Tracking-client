/**
 * Compare total return % to annual yield on cost.
 *
 * Good:  total return > yield  — price appreciation adds value beyond dividends
 * Poor:  yield > total return  — price decline is eating into dividend income
 *
 * Both values must be on the same scale (both decimals OR both percentages).
 */
export function returnVsYield(totalReturnPct, yieldOnCost) {
  if (totalReturnPct == null || yieldOnCost == null || yieldOnCost <= 0) return null

  const spread = totalReturnPct - yieldOnCost

  return {
    totalReturnPct,
    yieldOnCost,
    spread,
    status: spread >= 0 ? 'good' : 'poor',
    label: spread >= 0 ? 'Good' : 'Poor',
    color: spread >= 0 ? '#4dff91' : '#ff6b6b',
  }
}

export function returnVsYieldFromHolding(h) {
  const pv = h.purchase_value || 0
  const gl = h.gain_or_loss || 0
  const td = h.total_divs_received || 0
  const yoc = h.annual_yield_on_cost || 0

  if (pv <= 0 || yoc <= 0) return null

  const totalReturnRatio = (gl + td) / pv
  return returnVsYield(totalReturnRatio, yoc)
}
