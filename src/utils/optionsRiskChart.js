const RISK_VIEW_REVISION = 'risk-profile-view-v4'

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
