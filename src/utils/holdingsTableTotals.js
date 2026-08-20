// Footer values for the Manage Holdings table.
//
// Dollar and share columns are summed. Percentage columns that are already a
// fraction of a shared base (G/L %, YOC, Yield, Paid For Itself, % Acct) are
// recomputed from the summed numerator and denominator — adding the percents
// themselves is meaningless.
//
// Gain/Loss on this table is the selected-period tracker price return, not
// lifetime cost-basis G/L. When the table is unfiltered, the footer uses the
// portfolio replay (`portfolio_metrics`) so dollars and percent match Growth
// and Total Return Price Return. That replay includes lots closed during the
// range, so the total can differ from the sum of the current rows. A Div Src
// filter cannot use that portfolio total, so it sums the visible rows'
// tracker dollars and weights the percent by each row's tracker start value.
// Lifetime cost-basis G/L is totaled separately.

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function ratio(numer, denom) {
  const numerator = Number(numer)
  const denominator = Number(denom)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null
  }
  return numerator / denominator
}

function weightedMean(rows, valueKey, weightKey) {
  let weighted = 0
  let weight = 0
  for (const row of rows) {
    const value = Number(row[valueKey])
    const rowWeight = Number(row[weightKey])
    if (!Number.isFinite(value) || !Number.isFinite(rowWeight) || rowWeight <= 0) continue
    weighted += value * rowWeight
    weight += rowWeight
  }
  return weight > 0 ? weighted / weight : null
}

export function sharesIfReinvested(holding) {
  if (String(holding?.reinvest || '').toUpperCase() !== 'Y') return 0
  const annual = Number(holding?.estim_payment_per_year)
  const price = Number(holding?.current_price)
  if (!Number.isFinite(annual) || !Number.isFinite(price) || price === 0) return 0
  return annual / price
}

export function accountPercent(holding, accountValue) {
  if (holding?.percent_of_account != null && Number.isFinite(Number(holding.percent_of_account))) {
    return Number(holding.percent_of_account)
  }
  const value = Number(holding?.current_value)
  if (!Number.isFinite(value) || !accountValue) return 0
  return value / accountValue
}

export function computeHoldingsTableTotals(rows, {
  accountValue = 0,
  openPositionMetrics = null,
  matchOpenPositionTotals = false,
} = {}) {
  const list = Array.isArray(rows) ? rows : []
  const sum = (key) => list.reduce((total, row) => total + asNumber(row[key]), 0)

  const purchaseValue = sum('purchase_value')
  const currentValue = sum('current_value')
  const lifetimeGainLoss = sum('lifetime_gain_or_loss')
  const annualIncome = sum('estim_payment_per_year')
  const lifetimeDivs = sum('total_divs_received')

  let priceReturnDollar = null
  let priceReturnPct = null
  if (matchOpenPositionTotals) {
    if (openPositionMetrics) {
      const metricsDollar = Number(openPositionMetrics.price_return_dollar)
      const metricsPct = Number(openPositionMetrics.price_return_pct)
      priceReturnDollar = Number.isFinite(metricsDollar) ? metricsDollar : null
      priceReturnPct = Number.isFinite(metricsPct) ? metricsPct : null
    }
  } else {
    const dollarRows = list.filter(row => Number.isFinite(Number(row.gain_or_loss)))
    priceReturnDollar = dollarRows.length
      ? dollarRows.reduce((total, row) => total + Number(row.gain_or_loss), 0)
      : null
    // Period rows store G/L % as a fraction and have a tracker start value.
    // Lifetime cost-basis rows do not, so fall back to dollars over cost.
    const weighted = weightedMean(list, 'gain_or_loss_percentage', 'tracker_start_value')
    if (weighted != null) {
      priceReturnPct = weighted * 100
    } else if (priceReturnDollar != null) {
      const lifetimePct = ratio(priceReturnDollar, purchaseValue)
      priceReturnPct = lifetimePct == null ? null : lifetimePct * 100
    }
  }

  return {
    quantity: sum('quantity'),
    percent_of_account: list.reduce((total, row) => total + accountPercent(row, accountValue), 0),
    base_quantity: sum('base_quantity'),
    shares_bought_from_dividend: sum('shares_bought_from_dividend'),
    total_cash_reinvested: sum('total_cash_reinvested'),
    purchase_value: purchaseValue,
    current_value: currentValue,
    gain_or_loss: priceReturnDollar,
    gain_or_loss_percentage: priceReturnPct == null ? null : priceReturnPct / 100,
    lifetime_gain_or_loss: lifetimeGainLoss,
    lifetime_gain_or_loss_percentage: ratio(lifetimeGainLoss, purchaseValue),
    estim_payment_per_year: annualIncome,
    approx_monthly_income: sum('approx_monthly_income'),
    annual_yield_on_cost: ratio(annualIncome, purchaseValue),
    current_annual_yield: ratio(annualIncome, currentValue),
    dividend_paid: sum('dividend_paid'),
    ytd_divs: sum('ytd_divs'),
    total_divs_received: lifetimeDivs,
    paid_for_itself: ratio(lifetimeDivs, purchaseValue),
    _shares_if_reinvested: list.reduce((total, row) => total + sharesIfReinvested(row), 0),
    realized_gains: sum('realized_gains'),
    price_return_dollar: priceReturnDollar,
    price_return_pct: priceReturnPct,
  }
}
