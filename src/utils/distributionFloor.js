// Compare broker-recorded distributions with the saved spending plan. Keep
// dollars in the backend's base currency until the rendering boundary.
export const FLOOR_GROUPS = ['core', 'satellite', 'unassigned']

const finite = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const amount = value => finite(value) ?? 0
const tickerKey = value => String(value || '').trim().toUpperCase()
const cents = value => Math.round(value * 100) / 100 || 0

export function defaultFloorGroup(holding) {
  const labels = `${holding?.category || ''} ${holding?.subcategory || ''}`
  const core = /\bcore\b/i.test(labels)
  const satellite = /\bsatellite\b/i.test(labels)
  return core === satellite ? 'unassigned' : core ? 'core' : 'satellite'
}

export function getFloorTickers(history, holdings, assignments = {}) {
  const byTicker = new Map((holdings || []).map(h => [tickerKey(h.ticker), h]))
  const candidates = new Set((history?.rows || []).map(r => tickerKey(r.ticker)))
  for (const h of holdings || []) {
    if (Number(h.quantity) > 0 && (Number(h.div) > 0 || Number(h.estim_payment_per_year) > 0)) candidates.add(tickerKey(h.ticker))
  }
  return [...candidates].filter(Boolean).sort().map(ticker => {
    const h = byTicker.get(ticker)
    const override = Object.hasOwn(assignments, ticker) ? assignments[ticker] : null
    return { ticker, description: h?.description || '', category: [h?.category, h?.subcategory].filter(Boolean).join(' / '),
      held: Boolean(h && Number(h.quantity) > 0), group: FLOOR_GROUPS.includes(override) ? override : defaultFloorGroup(h) }
  })
}

export function grossIncomeFloor(netRequired, taxRatePct) {
  const net = finite(netRequired), tax = finite(taxRatePct)
  if (net == null || tax == null || tax < 0 || tax > 95) return null
  if (net <= 0) return 0
  // Round up to cents so the gross target always covers the net requirement.
  return Math.ceil(net / (1 - tax / 100) * 100 - 1e-8) / 100
}

export function normalizedFunding(summary, fundingMode) {
  const expenses = finite(summary?.normalized_monthly_expenses)
  const required = fundingMode === 'all' ? expenses : finite(summary?.normalized_portfolio_required)
  return { expenses, required }
}

export function incomeFloorRows({ history, tickers, summary, series, taxRatePct, floorMode = 'normalized', fundingMode = 'net', includeEstimates = false, firstMonth = 1 }) {
  if (!history?.as_of || !history.year) return []
  const currentYear = Number(history.as_of.slice(0, 4))
  const elapsed = history.year === currentYear ? Number(history.as_of.slice(5, 7)) : 12
  const groups = new Map(tickers.map(t => [tickerKey(t.ticker), t.group]))
  const schedule = new Map((series || []).map(row => [row.month, row]))
  const normalized = normalizedFunding(summary, fundingMode)
  const hasCore = tickers.some(t => t.group === 'core')
  const rows = []

  for (let month = Math.max(1, firstMonth); month <= elapsed; month++) {
    const monthKey = `${history.year}-${String(month).padStart(2, '0')}`
    const partial = history.year === currentYear && month === elapsed
    const scheduled = schedule.get(monthKey)
    const expenses = finite(scheduled?.expenses)
    const otherIncome = finite(scheduled?.additional_income_net)
    const target = floorMode === 'scheduled'
      ? { expenses, required: fundingMode === 'all' ? expenses : finite(scheduled?.portfolio_required) }
      : normalized
    // A zero-dollar portfolio need with an expense budget is valid (other
    // income covers it). No scheduled expenses is a different, unconfigured
    // comparison; don't report it as 100% covered.
    const budgetConfigured = target.expenses != null && target.expenses > 0 && target.required != null
    const netFloor = budgetConfigured ? Math.max(0, target.required) : null
    const floor = grossIncomeFloor(netFloor, taxRatePct)
    const actual = { core: 0, satellite: 0, unassigned: 0 }
    let estimated = 0
    let hasActual = false, hasEstimate = false
    for (const payment of history.rows || []) {
      const group = groups.get(tickerKey(payment.ticker))
      const bucket = FLOOR_GROUPS.includes(group) ? group : 'unassigned'
      const paid = amount(payment.actual?.[month - 1])
      const projected = amount(payment.estimated?.[month - 1])
      actual[bucket] += paid
      estimated += projected
      hasActual ||= paid !== 0
      hasEstimate ||= projected !== 0
    }
    for (const key of FLOOR_GROUPS) actual[key] = cents(actual[key])
    estimated = cents(estimated)
    const confirmed = cents(actual.core + actual.satellite + actual.unassigned)
    const total = cents(confirmed + (includeEstimates ? estimated : 0))
    const hasRecords = hasActual || (includeEstimates && hasEstimate)
    const coreCoverage = hasActual && hasCore && floor > 0 ? actual.core / floor : null
    const totalCoverage = hasRecords && floor > 0 ? total / floor : null
    const gap = hasRecords && floor != null ? cents(total - floor) : null
    let status = 'No budget data'
    if (target.expenses != null && target.expenses <= 0) status = 'No scheduled expenses'
    else if (floor === 0) status = 'No portfolio need'
    else if (floor != null && !hasRecords) status = partial ? 'In progress · no records' : 'No payment records'
    else if (floor != null && gap >= -0.005) status = hasActual && confirmed >= floor - 0.005
      ? partial ? 'Covered to date' : 'Covered'
      : 'Covered with projections'
    else if (floor != null) status = partial ? 'In progress' : includeEstimates && hasEstimate ? 'Shortfall with projections' : 'Recorded shortfall'
    rows.push({ month, monthKey, partial, expenses, otherIncome, netFloor, floor, ...actual,
      estimated, confirmed, total, hasActual, hasRecords, hasEstimate, coreCoverage, totalCoverage, gap, status })
  }
  return rows
}

export function stressTestSources(history, tickers, month) {
  const byTicker = new Map()
  for (const payment of history?.rows || []) {
    const ticker = tickerKey(payment.ticker)
    byTicker.set(ticker, (byTicker.get(ticker) || 0) + amount(payment.actual?.[month - 1]))
  }
  const securities = tickers.map(t => ({ id: t.ticker, label: t.ticker, group: t.group, amount: cents(byTicker.get(t.ticker) || 0) }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))
  const satellite = securities.filter(t => t.group === 'satellite')
  return [
    ...(satellite.length ? [{ id: ':satellite', label: 'All satellite holdings', group: 'satellite', amount: cents(satellite.reduce((s, t) => s + Math.max(0, t.amount), 0)) }] : []),
    ...securities,
  ]
}

export function stressTestIncome(row, source, hasCore) {
  if (!row?.hasActual || !source) return []
  const affected = Math.max(0, amount(source.amount))
  const scenarios = [
    { id: 'baseline', label: 'Confirmed baseline', income: row.confirmed },
    { id: 'half', label: '50% payout cut', income: cents(row.confirmed - affected / 2) },
    { id: 'zero', label: '100% payout cut', income: cents(row.confirmed - affected) },
    { id: 'core', label: 'Core only', income: hasCore ? row.core : null },
  ]
  return scenarios.map(s => ({ ...s, coverage: s.income != null && row.floor > 0 ? s.income / row.floor : null,
    gap: s.income != null && row.floor != null ? cents(s.income - row.floor) : null }))
}
