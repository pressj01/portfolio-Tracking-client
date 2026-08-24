import {
  LIFETIME_PERIOD_KEY,
  todayInputValue,
} from './performancePeriods.js'

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function optionalNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function round4(value) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null
}

function toIsoDate(value) {
  const raw = String(value || '').trim()
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (!mdy) return null
  const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]
  return `${year}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
}

function openHoldings(holdings) {
  return (Array.isArray(holdings) ? holdings : []).filter(row => Number(row.quantity) > 0)
}

// Open-holding lifetime total profit: remaining-lot price G/L + guarded
// lifetime dividends + lot-scoped realized trims. Do not fall back to the
// all-history realized_gains column — that can include closed-out lots and
// tagged transfer-outs.
export function holdingLifetimeReturnParts(row) {
  const purchase = asNumber(row?.purchase_value)
  const current = asNumber(row?.current_value)
  const storedGain = optionalNumber(row?.gain_or_loss)
  const gainLoss = storedGain ?? (current - purchase)
  const distributions = optionalNumber(row?.total_return_divs_component)
    ?? asNumber(row?.total_divs_received)
  const realized = asNumber(row?.total_return_realized_component)
  const storedBasis = optionalNumber(row?.total_return_basis)
  const totalReturnBasis = storedBasis > 0 ? storedBasis : purchase
  const totalReturnDollar = gainLoss + distributions + realized
  return {
    purchase,
    current,
    gainLoss,
    distributions,
    realized,
    totalReturnBasis,
    totalReturnDollar,
    totalReturnRatio: totalReturnBasis > 0 ? totalReturnDollar / totalReturnBasis : null,
  }
}

export function lifetimeMetricsFromHoldings(holdings) {
  const rows = openHoldings(holdings)
  const normalized = rows.map(row => {
    const parts = holdingLifetimeReturnParts(row)
    return { row, ...parts }
  })
  const sum = key => normalized.reduce((total, item) => total + asNumber(item[key]), 0)
  const purchase = sum('purchase')
  const current = sum('current')
  const gainLoss = sum('gainLoss')
  const distributions = sum('distributions')
  const realized = sum('realized')
  const totalReturnBasis = sum('totalReturnBasis')
  const totalReturnDollar = gainLoss + distributions + realized
  const pricePct = purchase > 0 ? (gainLoss / purchase) * 100 : null
  const totalPct = totalReturnBasis > 0
    ? (totalReturnDollar / totalReturnBasis) * 100
    : null
  const starts = rows
    .map(row => toIsoDate(row.purchase_date || row.import_date))
    .filter(Boolean)
    .sort()
  const start = starts[0] || null
  const end = todayInputValue()
  const metrics = {
    start_value: purchase,
    end_value: current,
    price_return_dollar: gainLoss,
    price_return_pct: round4(pricePct),
    distribution_dollar: distributions,
    realized_return_dollar: realized,
    total_return_basis: totalReturnBasis,
    total_return_dollar: totalReturnDollar,
    total_return_pct: round4(totalPct),
    actual_start_date: start,
    actual_end_date: end,
  }
  const performance_rows = normalized.map(item => {
    const {
      row,
      purchase: cost,
      current: rowCurrent,
      gainLoss: rowGain,
      distributions: rowDivs,
      realized: rowRealized,
      totalReturnBasis: rowTotalReturnBasis,
    } = item
    const storedPct = optionalNumber(row.gain_or_loss_percentage)
    const rowPct = storedPct != null
      ? storedPct * 100
      : (cost > 0 ? (rowGain / cost) * 100 : null)
    const rowTotalReturn = rowGain + rowDivs + rowRealized
    return {
      ticker: String(row.ticker || '').trim().toUpperCase(),
      category_name: row.category || row.category_name || '',
      description: row.description || '',
      annual_yield_on_cost: row.annual_yield_on_cost,
      current_annual_yield: row.current_annual_yield,
      start_value: cost,
      end_value: rowCurrent,
      price_paid: optionalNumber(row.price_paid),
      start_price: optionalNumber(row.price_paid),
      end_price: optionalNumber(row.current_price),
      price_return_dollar: rowGain,
      price_return_pct: round4(rowPct),
      distribution_dollar: rowDivs,
      realized_return_dollar: rowRealized,
      total_return_basis: rowTotalReturnBasis,
      total_return_dollar: rowTotalReturn,
      total_return_pct: rowTotalReturnBasis > 0
        ? round4((rowTotalReturn / rowTotalReturnBasis) * 100)
        : null,
      actual_start_date: toIsoDate(row.purchase_date || row.import_date),
      actual_end_date: end,
    }
  })
  return { metrics, performance_rows, start, end }
}

function payloadShell(start, end, extra = {}) {
  return {
    period_key: LIFETIME_PERIOD_KEY,
    period_label: 'Lifetime',
    requested_start_date: start,
    requested_end_date: end,
    actual_start_date: start,
    actual_end_date: end,
    matches_holdings_gl: true,
    ...extra,
  }
}

export function lifetimeTotalReturnPayload(holdings) {
  const { metrics, performance_rows, start, end } = lifetimeMetricsFromHoldings(holdings)
  return payloadShell(start, end, {
    portfolio_metrics: metrics,
    open_position_metrics: metrics,
    performance_rows,
  })
}

export function lifetimeGrowthPayload(holdings, categories = []) {
  const payload = lifetimeTotalReturnPayload(holdings)
  return {
    ...payload,
    portfolio_price: { dates: [], values: [] },
    portfolio_total: { dates: [], values: [] },
    benchmark_price: { dates: [], values: [] },
    benchmark_total: { dates: [], values: [] },
    benchmark_ticker: null,
    categories: Array.isArray(categories) ? categories : [],
  }
}

export function lifetimeGrowth2Payload(holdings, { selectedTickers = [] } = {}) {
  const allHoldings = openHoldings(holdings)
  const selected = new Set(
    (selectedTickers || []).map(ticker => String(ticker || '').trim().toUpperCase()),
  )
  const scopedHoldings = selected.size
    ? allHoldings.filter(row => selected.has(String(row.ticker || '').trim().toUpperCase()))
    : allHoldings
  const { metrics, start, end } = lifetimeMetricsFromHoldings(scopedHoldings)
  return payloadShell(start, end, {
    tickers: [...new Set(allHoldings
      .map(row => String(row.ticker || '').trim().toUpperCase())
      .filter(Boolean))].sort(),
    tracker_actual_start_date: start,
    tracker_actual_end_date: end,
    summary: {
      start_value: metrics.start_value,
      end_value: metrics.end_value,
      price_return_amount: metrics.price_return_dollar,
      distribution_amount: metrics.distribution_dollar,
      realized_return_amount: metrics.realized_return_dollar,
      total_profit_amount: metrics.total_return_dollar,
      total_return_pct: metrics.total_return_pct,
    },
  })
}

export async function fetchHoldingsJson(pf, {
  categories = [],
  subcategories = [],
  tickers = [],
} = {}) {
  const params = new URLSearchParams()
  if (categories.length) params.set('category', categories.join(','))
  if (subcategories.length) params.set('subcategory', subcategories.join(','))
  if (tickers.length) params.set('tickers', tickers.join(','))
  const query = String(params)
  const res = await pf(`/api/holdings${query ? `?${query}` : ''}`)
  const data = await res.json().catch(() => [])
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return Array.isArray(data) ? data : []
}
