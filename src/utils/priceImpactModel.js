const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const PRICE_SHOCK_PRESETS = [-60, -40, -20, 0, 25, 50, 100]
export const PRICE_SENSITIVITY_POINTS = Array.from({ length: 17 }, (_, i) => -60 + i * 10)

const FREQ_MAP = {
  Monthly: 12, M: 12, Weekly: 52, W: 52, 52: 52,
  'Bi-Weekly': 26, BW: 26, Quarterly: 4, Q: 4,
  'Semi-Annual': 2, SA: 2, Annual: 1, A: 1,
}
const MONTH_PAY_MAP = {
  12: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  52: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  26: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  4: [3, 6, 9, 12],
  2: [6, 12],
  1: [12],
}
const PAYMENTS_PER_MONTH = { 12: 1, 52: 52 / 12, 26: 26 / 12, 4: 1, 2: 1, 1: 1 }

const OPTION_INCOME_KEYWORDS = [
  'option income', 'options income', 'covered call', 'buy write', 'buywrite',
  'premium income', 'option premium', 'derivative income', 'yieldmax',
  'yieldboost', 'single stock', 'enhanced income', 'equity premium', 'option strategy',
]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function holdingIncomeSensitivity(holding, shockPct) {
  const text = [
    holding.description,
    holding.category,
    holding.classification_type,
    holding.etf_category,
    holding.etf_strategy,
    holding.nav_erosion_scope,
  ].filter(Boolean).join(' ').toLowerCase().replace(/[-_/]+/g, ' ')
  const isOptionIncome = OPTION_INCOME_KEYWORDS.some(keyword => text.includes(keyword))
  if (isOptionIncome) {
    return {
      beta: shockPct < 0 ? 0.35 : 0.20,
      type: 'Option income',
    }
  }
  if (/(cef|bdc|preferred|bond|loan|fixed income|closed end|senior loan)/i.test(text)) {
    return {
      beta: shockPct < 0 ? 0.20 : 0.10,
      type: 'Income fund',
    }
  }
  return {
    beta: shockPct < 0 ? 0.10 : 0.05,
    type: 'Declared dividend',
  }
}

export function projectPriceImpact(holdings, options) {
  const years = Math.max(1, Number(options.years) || 1)
  const totalMonths = years * 12
  const shockPct = clamp(Number(options.shockPct) || 0, -60, 100)
  const priceFactor = Math.max(0.01, 1 + shockPct / 100)
  const reinvestFrac = clamp(Number(options.reinvestPct) || 0, 0, 100) / 100
  const monthlyContribution = Math.max(0, Number(options.monthlyContribution) || 0)
  const now = new Date()
  const startYear = now.getFullYear()
  const startMonth = now.getMonth() + 1

  const rows = (holdings || []).map(h => {
    const shares = Number(h.quantity) || 0
    const price = Number(h.current_price) || 0
    const freq = FREQ_MAP[String(h.div_frequency || '').trim()] || 0
    let dps = Number(h.div) || 0
    if (dps <= 0 && shares > 0 && freq > 0) {
      const estimate = Number(h.estim_payment_per_year) || 0
      if (estimate > 0) dps = estimate / (shares * freq)
    }
    const sensitivity = holdingIncomeSensitivity(h, shockPct)
    const incomeFactor = Math.max(0, 1 + (shockPct / 100) * sensitivity.beta)
    return {
      ticker: h.ticker,
      description: h.description || '',
      shares,
      price,
      adjustedPrice: price * priceFactor,
      dps,
      adjustedDps: dps * incomeFactor,
      incomeSensitivity: sensitivity.beta,
      incomeType: sensitivity.type,
      freq,
      value: shares * price,
      adjustedValue: shares * price * priceFactor,
    }
  }).filter(h => h.shares > 0 && h.price > 0 && h.adjustedPrice > 0 && h.freq > 0 && h.dps > 0)

  const currentValue = rows.reduce((sum, h) => sum + h.value, 0)
  const adjustedValue = rows.reduce((sum, h) => sum + h.adjustedValue, 0)
  const currentAnnualIncome = rows.reduce((sum, h) => sum + h.dps * h.freq * h.shares, 0)
  const currentMonthlyIncome = currentAnnualIncome / 12
  const adjustedCurrentAnnualIncome = rows.reduce((sum, h) => sum + h.adjustedDps * h.freq * h.shares, 0)
  const adjustedCurrentMonthlyIncome = adjustedCurrentAnnualIncome / 12
  const simShares = Object.fromEntries(rows.map(h => [h.ticker, h.shares]))
  const simDripShares = Object.fromEntries(rows.map(h => [h.ticker, h.shares]))
  const contributionShares = Object.fromEntries(rows.map(h => [h.ticker, 0]))
  const eligibleValue = rows.reduce((sum, h) => sum + h.adjustedValue, 0)
  const weights = Object.fromEntries(rows.map(h => [h.ticker, eligibleValue > 0 ? h.adjustedValue / eligibleValue : 0]))

  const monthlySeries = []
  for (let m = 1; m <= totalMonths; m += 1) {
    const totalM = startMonth + m
    const year = startYear + Math.floor((totalM - 1) / 12)
    const calMonth = ((totalM - 1) % 12) + 1
    const label = `${MONTH_NAMES[calMonth - 1]} ${year}`

    if (monthlyContribution > 0 && eligibleValue > 0) {
      rows.forEach(h => {
        const alloc = monthlyContribution * (weights[h.ticker] || 0)
        const newShares = alloc / h.adjustedPrice
        simShares[h.ticker] += newShares
        contributionShares[h.ticker] += newShares
      })
    }

    let monthIncome = 0
    const dripBuys = {}
    rows.forEach(h => {
      const annualIncome = h.adjustedDps * h.freq * simShares[h.ticker]
      monthIncome += annualIncome / 12
      if (reinvestFrac > 0 && MONTH_PAY_MAP[h.freq]?.includes(calMonth)) {
        dripBuys[h.ticker] = h.adjustedDps * simDripShares[h.ticker] * (PAYMENTS_PER_MONTH[h.freq] || 1) * reinvestFrac
      }
    })

    Object.entries(dripBuys).forEach(([ticker, amount]) => {
      const h = rows.find(row => row.ticker === ticker)
      if (!h || amount <= 0) return
      const newShares = amount / h.adjustedPrice
      simShares[ticker] += newShares
      simDripShares[ticker] += newShares
      contributionShares[ticker] += newShares
    })

    monthlySeries.push({
      month: m,
      label,
      total_income: Math.round(monthIncome * 100) / 100,
      annualized_income: Math.round(monthIncome * 12 * 100) / 100,
      total_shares: Math.round(rows.reduce((sum, h) => sum + simShares[h.ticker], 0) * 100) / 100,
    })
  }

  const annualSeries = []
  for (let yr = 1; yr <= years; yr += 1) {
    const months = monthlySeries.slice((yr - 1) * 12, yr * 12)
    const totalIncome = months.reduce((sum, m) => sum + (m.total_income || 0), 0)
    const previous = yr === 1
      ? adjustedCurrentAnnualIncome
      : annualSeries[annualSeries.length - 1]?.total_income || adjustedCurrentAnnualIncome
    annualSeries.push({
      year: yr,
      label: `Year ${yr}`,
      total_income: Math.round(totalIncome * 100) / 100,
      change_dollar: Math.round((totalIncome - previous) * 100) / 100,
      change_pct: previous > 0 ? Math.round(((totalIncome / previous - 1) * 100) * 100) / 100 : null,
      total_shares: months[months.length - 1]?.total_shares || null,
    })
  }

  const projectedAnnualIncome = annualSeries[annualSeries.length - 1]?.total_income || adjustedCurrentAnnualIncome
  const projectedMonthlyIncome = monthlySeries[monthlySeries.length - 1]?.total_income || adjustedCurrentMonthlyIncome
  const holdingsOut = rows.map(h => {
    const endShares = simShares[h.ticker] || h.shares
    const adjustedStartAnnual = h.adjustedDps * h.freq * h.shares
    const endAnnual = h.adjustedDps * h.freq * endShares
    return {
      ticker: h.ticker,
      description: h.description,
      current_price: h.price,
      adjusted_price: h.adjustedPrice,
      income_type: h.incomeType,
      income_beta: h.incomeSensitivity,
      shares_start: h.shares,
      shares_end: endShares,
      shares_added: contributionShares[h.ticker] || 0,
      current_annual_income: h.dps * h.freq * h.shares,
      adjusted_current_annual_income: adjustedStartAnnual,
      projected_annual_income: endAnnual,
      growth_pct: adjustedStartAnnual > 0 ? (endAnnual / adjustedStartAnnual - 1) * 100 : null,
    }
  }).sort((a, b) => b.projected_annual_income - a.projected_annual_income)

  return {
    shockPct,
    priceFactor,
    currentValue,
    adjustedValue,
    currentMonthlyIncome,
    currentAnnualIncome,
    adjustedCurrentMonthlyIncome,
    adjustedCurrentAnnualIncome,
    projectedMonthlyIncome,
    projectedAnnualIncome,
    monthlySeries,
    annualSeries,
    holdings: holdingsOut,
  }
}
