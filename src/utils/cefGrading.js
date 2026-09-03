// Pure grading helpers for the CEF Buying Checklist Evaluator.
// Each criterion returns a { badge, score, rationale, metrics, ... } record.
// Composite score averages criteria 2-7 (criterion 1 is informational).
import { formatMoney, formatMoneyCompact } from './money.js'

export const DEFAULT_THRESHOLDS = {
  sustainability: { passPp: 1, warnPp: 3 },
  discount:       { passPremium: 0, warnPremium: 5 },
  leverage:       { passPct: 30, warnPct: 35 },
  expense:        { passMultiple: 1, warnMultiple: 1.25 },
  liquidity:      { passDollars: 1_000_000, warnDollars: 250_000 },
}

export const BEST_PRACTICE = {
  sustainability: 'Distribution rate on NAV should not exceed the long-term (5Y) NAV total return by more than ~1 percentage point. Larger gaps suggest the payout is being funded by return-of-capital or asset sales.',
  discount:       'Buy at a discount, ideally below the fund’s 52-week average. Premiums above 5% leave little margin of safety.',
  leverage:       'The default risk screen passes leverage up to 30%, warns through 35%, and fails above 35%. These are application settings, not regulatory limits or a judgment about borrowing costs.',
  expense:        'Compare reported total expenses with the median of at least 3 other comparable funds. Defaults: pass at or below the median, warn through 1.25× the median, fail above it. Financing costs remain included.',
  liquidity:      'The $1,000,000/day default favors funds with more trading capacity. Check your order size and the bid-ask spread before trading.',
  manager:        'Compare the same 5Y (or 3Y) NAV return period with at least 3 other funds in the same category, strategy and leverage profile. This does not measure sponsor reputation.',
}

export const MIN_COMPARABLE_PEERS = 3
export const MAX_LEVERAGE_GAP_PP = 10

// Old expense cutoffs were absolute percentages. Never reinterpret a saved
// 1.25% cutoff as a multiple of the peer median; retain other user settings.
export function mergeThresholds(saved = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([key, defaults]) => [
    key,
    Object.fromEntries(Object.entries(defaults).map(([field, fallback]) => {
      const value = saved?.[key]?.[field]
      return [field, typeof value === 'number' && Number.isFinite(value) ? value : fallback]
    })),
  ]))
}

const num = (v) => {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim()) || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Map a metric onto a 0-100 score band given pass/warn cutoffs.
// lowerBetter = true means smaller values are better (e.g. leverage, expense).
function scoreBand(value, passAt, warnAt, lowerBetter = true) {
  if (value === null) return 60 // neutral for missing data
  const v = lowerBetter ? value : -value
  const p = lowerBetter ? passAt : -passAt
  const w = lowerBetter ? warnAt : -warnAt
  if (v <= p) return Math.min(100, 85 + 15 * (p - v) / Math.max(0.1, Math.abs(p)))
  if (v <= w) {
    const span = w - p
    return span <= 0 ? 70 : 50 + 29 * (1 - (v - p) / span)
  }
  const overshoot = w === 0 ? Math.abs(v) : (v - w) / Math.max(0.1, Math.abs(w))
  return Math.max(0, 50 * (1 - overshoot))
}

function badgeFromScore(score) {
  if (score === null || score === undefined) return 'info'
  if (score >= 80) return 'pass'
  if (score >= 50) return 'warn'
  return 'fail'
}

const pct = (n, digits = 2) => (n === null || n === undefined ? 'n/a' : `${Number(n).toFixed(digits)}%`)
const money = (n) => {
  return formatMoneyCompact(n, { fallback: 'n/a' })
}

const normalized = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')
const tickerOf = (fund) => normalized(fund?.ticker)

export function leverageProfile(fund) {
  const reported = num(fund?.leverage_ratio)
  if (reported !== null) return reported >= 0 ? reported : null
  // Missing and false are different: unknown leverage must not become a pass.
  return fund?.is_leveraged === false ? 0 : null
}

// Category and strategy are mandatory: a name/theme must never override the
// feed's distinction between emerging-market bonds and emerging-market equity.
export function selectComparablePeers(fund, universe = []) {
  const category = normalized(fund?.category)
  const strategy = normalized(fund?.strategy)
  const leverage = leverageProfile(fund)
  if (!category || !strategy || leverage === null) return []
  const theme = detectFundTheme(fund)
  const seen = new Set([tickerOf(fund)])
  return (universe || []).filter(peer => {
    const ticker = tickerOf(peer)
    if (!ticker || seen.has(ticker)) return false
    if (normalized(peer.category) !== category || normalized(peer.strategy) !== strategy) return false
    if (detectFundTheme(peer)?.key !== theme?.key) return false
    const peerLeverage = leverageProfile(peer)
    if (peerLeverage === null || (leverage === 0) !== (peerLeverage === 0)) return false
    if (Math.abs(peerLeverage - leverage) > MAX_LEVERAGE_GAP_PP) return false
    seen.add(ticker)
    return true
  })
}

function quantile(sorted, fraction) {
  if (!sorted.length) return null
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function peerSummary(peers, field) {
  const rows = peers.filter(p => num(p[field]) !== null && (field !== 'expense_ratio' || num(p[field]) > 0))
  const values = rows.map(p => num(p[field])).sort((a, b) => a - b)
  return {
    count: rows.length,
    tickers: rows.map(p => String(p.ticker).toUpperCase()).sort(),
    members: rows.map(p => ({ ticker: String(p.ticker).toUpperCase(), leverage: leverageProfile(p), value: num(p[field]) }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    metric: field === 'expense_ratio' ? 'Total expenses' : field === 'return_on_nav_5y' ? '5Y NAV return' : '3Y NAV return',
    median: quantile(values, 0.5),
    q1: quantile(values, 0.25),
    mean: values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null,
  }
}

// -- Criterion 1: Portfolio match (informational only) --
function gradePortfolioMatch(fund) {
  return {
    id: 1,
    key: 'portfolioMatch',
    question: 'Does the portfolio match my income and risk goals?',
    badge: 'info',
    score: null,
    editable: false,
    rationale: 'Subjective — review the data points below against your own goals before continuing.',
    metrics: [
      { label: 'Category', value: fund.category || 'n/a' },
      { label: 'Strategy', value: fund.strategy || 'n/a' },
      { label: 'Sponsor', value: fund.sponsor || 'n/a' },
      { label: 'Distribution frequency', value: fund.distribution_frequency || 'n/a' },
      { label: 'Uses leverage', value: leverageProfile(fund) === null ? 'Unknown' : leverageProfile(fund) > 0 ? 'Yes' : 'No' },
      { label: 'Managed distribution', value: fund.is_managed_distribution ? 'Yes' : 'No' },
    ],
  }
}

// -- Criterion 2: Distribution sustainability --
// Uses the distribution/NAV-return gap as a proxy, with UNII as context.
// The feed does not supply matching earnings/distribution reporting periods.
function gradeSustainability(fund, thresholds) {
  const drNav = num(fund.distribution_rate_nav)
  const r5y = num(fund.return_on_nav_5y)
  const r3y = num(fund.return_on_nav_3y)
  const longTerm = r5y !== null ? r5y : r3y
  const longTermLabel = r5y !== null ? '5Y NAV return' : '3Y NAV return'
  const unii = num(fund.unii_per_share)
  const eps = num(fund.earnings_per_share)
  const distAmt = num(fund.distribution_amount)
  const nav = num(fund.nav)
  const t = thresholds.sustainability

  // Build metrics list — always show what we have
  const metrics = [
    { label: 'Distribution rate on NAV', value: pct(drNav) },
    { label: longTermLabel, value: pct(longTerm) },
  ]
  if (unii !== null) {
    metrics.push({ label: 'UNII per share', value: formatMoney(unii, { digits: 4 }) })
    if (nav) metrics.push({ label: 'UNII as % of NAV', value: pct(unii / nav * 100, 3) })
  }
  if (eps !== null && distAmt !== null && distAmt > 0) {
    metrics.push({ label: 'Reported earnings per share', value: formatMoney(eps, { digits: 4 }) })
    metrics.push({ label: 'Distribution per payment', value: formatMoney(distAmt, { digits: 4 }) })
  }
  metrics.push({ label: 'Managed distribution', value: fund.is_managed_distribution ? 'Yes' : 'No' })

  // Score: start with the proxy gap if available
  let score = null
  let rationale = ''
  let gap = null
  if (drNav !== null && longTerm !== null) {
    gap = drNav - longTerm
    score = scoreBand(gap, t.passPp, t.warnPp, true)
  }

  // UNII is accumulated undistributed income, not current-period coverage.
  if (unii !== null && score !== null) {
    if (unii > 0) {
      score = Math.min(100, score + 10)
    } else if (unii < -0.05) {
      score = Math.max(0, score - 10)
    }
  }

  // Build rationale
  if (score === null) {
    rationale = 'Insufficient data to score (need distribution rate on NAV and 3Y/5Y NAV return).'
    // But if we have UNII or coverage, at least mention it
    if (unii !== null) {
      rationale += ` UNII per share is ${formatMoney(unii, { digits: 4 })}; accumulated income alone is not enough to score sustainability.`
    }
    return {
      id: 2, key: 'sustainability',
      question: 'Is the distribution sustainable?',
      badge: 'info', score: null,
      editable: true, rationale, metrics,
      threshold: { warnPp: t.warnPp, passPp: t.passPp, bestPractice: BEST_PRACTICE.sustainability },
    }
  }

  // Main rationale from proxy gap
  if (gap <= t.passPp) {
    rationale = `Distribution rate (${pct(drNav)}) does not exceed long-term NAV return (${pct(longTerm)}) by more than ${t.passPp.toFixed(1)}pp — within the proxy pass band.`
  } else if (gap <= t.warnPp) {
    rationale = `Gap of ${gap.toFixed(2)}pp between distribution rate (${pct(drNav)}) and ${longTermLabel} (${pct(longTerm)}) is in the warning band.`
  } else {
    rationale = `Distribution rate (${pct(drNav)}) exceeds ${longTermLabel} (${pct(longTerm)}) by ${gap.toFixed(2)}pp — above your ${t.warnPp.toFixed(1)}pp fail line.`
  }
  // Append UNII context
  if (unii !== null) {
    rationale += ` UNII ${formatMoney(unii, { digits: 4 })} (${unii > 0 ? '+10 score points for accumulated undistributed income' : unii < -0.05 ? '−10 score points for an accumulated income deficit' : 'no score adjustment'}).`
  }
  // Append EPS coverage context
  if (eps !== null && distAmt !== null && distAmt > 0) {
    rationale += ' Earnings and distribution amounts are shown for review; coverage is not scored because their reporting periods are not matched in this feed.'
  }

  if (gap !== null) {
    metrics.splice(2, 0, { label: 'Gap (rate − return)', value: `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}pp` })
  }

  return {
    id: 2, key: 'sustainability',
    question: 'Is the distribution sustainable?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { warnPp: t.warnPp, passPp: t.passPp, bestPractice: BEST_PRACTICE.sustainability },
  }
}

// -- Criterion 3: Discount justified --
function gradeDiscount(fund, thresholds) {
  const prem = num(fund.premium_discount)
  const avg52 = num(fund.discount_52wk_avg)
  const z = num(fund.z_score_1y)
  const t = thresholds.discount
  let score, rationale
  if (prem === null) {
    return {
      id: 3, key: 'discount',
      question: 'Is the discount justified or likely to narrow?',
      badge: 'info', score: null, editable: true,
      rationale: 'Premium/discount unavailable.',
      metrics: [],
      threshold: { warnPremium: t.warnPremium, passPremium: t.passPremium, bestPractice: BEST_PRACTICE.discount },
    }
  }
  score = scoreBand(prem, t.passPremium, t.warnPremium, true)
  // bonus/penalty from z-score 1y (lower z = more attractive)
  if (z !== null) {
    if (z <= -1) score = Math.min(100, score + 10)
    else if (z >= 1) score = Math.max(0, score - 15)
  }
  if (prem <= t.passPremium) {
    rationale = prem < 0 ? `Trading at a ${pct(Math.abs(prem))} discount` : `Premium of ${pct(prem)} is at or below your ${pct(t.passPremium)} pass line`
    if (avg52 !== null) rationale += `, vs. 52-wk avg ${pct(avg52, 2)}`
    if (z !== null) rationale += `. 1Y z-score ${z.toFixed(2)}${z <= -1 ? ' (attractive vs. own history)' : z >= 1 ? ' (expensive vs. own history)' : ''}`
    rationale += '.'
  } else if (prem <= t.warnPremium) {
    rationale = `Premium of ${pct(prem)} — within your ${t.warnPremium.toFixed(1)}% warning band but no margin of safety.`
  } else {
    rationale = `Premium of ${pct(prem)} exceeds your ${t.warnPremium.toFixed(1)}% fail line — you’re paying more than the portfolio is worth.`
  }
  const metrics = [
    { label: 'Premium / Discount', value: pct(prem, 2) },
    { label: '52-week avg discount', value: pct(avg52, 2) },
    { label: '1Y z-score', value: z === null ? 'n/a' : z.toFixed(2) },
  ]
  return {
    id: 3, key: 'discount',
    question: 'Is the discount justified or likely to narrow?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { warnPremium: t.warnPremium, passPremium: t.passPremium, bestPractice: BEST_PRACTICE.discount },
  }
}

// -- Criterion 4: Leverage --
function gradeLeverage(fund, thresholds) {
  const lev = leverageProfile(fund)
  const t = thresholds.leverage
  if (lev === 0) {
    return {
      id: 4, key: 'leverage',
      question: 'How much leverage is used, and how does it behave in stress?',
      badge: 'pass', score: 95, editable: true,
      rationale: 'Fund reports no leverage in CEF Connect data.',
      metrics: [{ label: 'Uses leverage', value: 'No' }],
      threshold: { warnPct: t.warnPct, passPct: t.passPct, bestPractice: BEST_PRACTICE.leverage },
    }
  }
  if (lev === null) {
    return {
      id: 4, key: 'leverage',
      question: 'How much leverage is used, and how does it behave in stress?',
      badge: 'info', score: null, editable: true,
      rationale: 'Leverage ratio not reported in feed.',
      metrics: [{ label: 'Uses leverage', value: fund.is_leveraged === true ? 'Yes (ratio n/a)' : 'Unknown' }],
      threshold: { warnPct: t.warnPct, passPct: t.passPct, bestPractice: BEST_PRACTICE.leverage },
    }
  }
  const score = scoreBand(lev, t.passPct, t.warnPct, true)
  let rationale
  if (lev <= t.passPct) rationale = `Leverage of ${pct(lev, 1)} is within your acceptable max of ${t.passPct.toFixed(0)}%.`
  else if (lev <= t.warnPct) rationale = `Leverage of ${pct(lev, 1)} is in the warning band (${t.passPct.toFixed(0)}–${t.warnPct.toFixed(0)}%).`
  else rationale = `Leverage of ${pct(lev, 1)} exceeds your fail threshold of ${t.warnPct.toFixed(0)}%.`
  rationale += ' This grades the amount of leverage; the expense check separately compares costs with similar funds.'
  return {
    id: 4, key: 'leverage',
    question: 'How much leverage is used, and how does it behave in stress?',
    badge: badgeFromScore(score), score, editable: true, rationale,
    metrics: [
      { label: 'Leverage ratio', value: pct(lev, 1) },
      { label: 'Uses leverage', value: lev > 0 ? 'Yes' : 'No' },
    ],
    threshold: { warnPct: t.warnPct, passPct: t.passPct, bestPractice: BEST_PRACTICE.leverage },
  }
}

// -- Criterion 5: Expenses --
function gradeExpenses(fund, peers, thresholds) {
  const exp = num(fund.expense_ratio)
  const t = thresholds.expense
  const comparison = peerSummary(peers, 'expense_ratio')
  const metrics = [
    { label: 'Total expense ratio (including financing costs)', value: pct(exp) },
    { label: comparison.count >= MIN_COMPARABLE_PEERS ? 'Peer median (grading benchmark)' : 'Peer median (context only)', value: pct(comparison.median) },
    { label: 'Peer average (mean, context only)', value: pct(comparison.mean) },
    { label: 'Peers with expense data', value: comparison.count },
  ]
  let score = null
  let rationale
  if (exp === null || exp <= 0) {
    rationale = 'A positive reported total expense ratio is needed to score expenses.'
  } else if (comparison.count < MIN_COMPARABLE_PEERS) {
    rationale = `Only ${comparison.count} comparable peers have expense data; at least ${MIN_COMPARABLE_PEERS} are required. Any displayed median or average is context only. Expenses are excluded from the composite, with no automatic failure against a flat expense cutoff.`
  } else {
    const multiple = exp / comparison.median
    const passAt = comparison.median * t.passMultiple
    const warnAt = comparison.median * t.warnMultiple
    score = scoreBand(multiple, t.passMultiple, t.warnMultiple)
    metrics.push({ label: 'Expense / peer median', value: `${multiple.toFixed(2)}×` })
    metrics.push({ label: 'Pass / fail above', value: `${pct(passAt)} / ${pct(warnAt)}` })
    rationale = `Total expenses of ${pct(exp)} are ${multiple.toFixed(2)}× the ${pct(comparison.median)} median of ${comparison.count} comparable peers. Your pass line is ${t.passMultiple.toFixed(2)}× the median; the fail line is above ${t.warnMultiple.toFixed(2)}×.`
  }
  rationale += ' The feed does not separate borrowing costs from operating fees. Similar leverage amounts improve comparability, but financing terms and reporting periods can differ.'
  return {
    id: 5, key: 'expense',
    question: 'Are expenses reasonable relative to peers?',
    badge: badgeFromScore(score), score, editable: true, rationale,
    metrics, comparison,
    threshold: { ...t, bestPractice: BEST_PRACTICE.expense },
  }
}

// -- Criterion 6: Manager / track record vs category --
function gradeManager(fund, peers) {
  const r5y = num(fund.return_on_nav_5y)
  const r3y = num(fund.return_on_nav_3y)
  const primary = r5y !== null ? r5y : r3y
  const primaryLabel = r5y !== null ? '5Y NAV return' : '3Y NAV return'
  const comparison = peerSummary(peers, r5y !== null ? 'return_on_nav_5y' : 'return_on_nav_3y')
  const { median, q1 } = comparison
  if (primary === null) {
    return {
      id: 6, key: 'manager',
      question: 'Is the manager reputable with a strong track record?',
      badge: 'info', score: null, editable: false,
      rationale: 'Long-term NAV return unavailable — review sponsor reputation manually.',
      metrics: [
        { label: 'Sponsor', value: fund.sponsor || 'n/a' },
        { label: '3Y NAV return', value: pct(r3y) },
        { label: '5Y NAV return', value: pct(r5y) },
      ],
    }
  }
  let score = null
  let rationale
  if (comparison.count < MIN_COMPARABLE_PEERS) {
    rationale = `${primaryLabel} ${pct(primary)} — only ${comparison.count} comparable peers report this same return period; at least ${MIN_COMPARABLE_PEERS} are required. Any displayed median is context only. Track record is excluded from the composite.`
  } else if (primary >= median) {
    score = 85 + Math.min(15, (primary - median))
    rationale = `${primaryLabel} ${pct(primary)} meets or beats the comparable-peer median (${pct(median)}).`
  } else if (q1 !== null && primary >= q1) {
    score = 55
    rationale = `${primaryLabel} ${pct(primary)} is below the comparable-peer median (${pct(median)}) but at or above the lower quartile (${pct(q1)}).`
  } else {
    score = 25
    rationale = `${primaryLabel} ${pct(primary)} is below the comparable-peer lower quartile (${pct(q1)}; median ${pct(median)}).`
  }
  return {
    id: 6, key: 'manager',
    question: 'Is the manager reputable with a strong track record?',
    badge: badgeFromScore(score), score, editable: false, rationale, comparison,
    metrics: [
      { label: 'Sponsor', value: fund.sponsor || 'n/a' },
      { label: '3Y NAV return', value: pct(r3y) },
      { label: '5Y NAV return', value: pct(r5y) },
      { label: `Peer median (${primaryLabel})`, value: pct(median) },
      { label: 'Peers with matching return data', value: comparison.count },
    ],
    threshold: { bestPractice: BEST_PRACTICE.manager },
  }
}

// -- Criterion 7: Liquidity --
function gradeLiquidity(fund, thresholds) {
  const vol = num(fund.avg_daily_volume)
  const price = num(fund.price)
  const t = thresholds.liquidity
  if (vol === null || price === null) {
    return {
      id: 7, key: 'liquidity',
      question: 'Is liquidity sufficient for my position size?',
      badge: 'info', score: null, editable: true,
      rationale: 'Average daily volume or price unavailable.',
      metrics: [
        { label: 'Avg daily volume', value: vol === null ? 'n/a' : Number(vol).toLocaleString() },
        { label: 'Price', value: price === null ? 'n/a' : `$${price.toFixed(2)}` },
      ],
      threshold: { warnDollars: t.warnDollars, passDollars: t.passDollars, bestPractice: BEST_PRACTICE.liquidity },
    }
  }
  const dollars = vol * price
  const score = scoreBand(dollars, t.passDollars, t.warnDollars, false)
  let rationale
  if (dollars >= t.passDollars) rationale = `Average daily traded value of ${money(dollars)} comfortably exceeds your ${money(t.passDollars)}/day minimum.`
  else if (dollars >= t.warnDollars) rationale = `Average daily traded value of ${money(dollars)} is in the warning band (below ${money(t.passDollars)}).`
  else rationale = `Average daily traded value of only ${money(dollars)} is below your ${money(t.warnDollars)}/day floor — expect wide spreads and price impact.`
  return {
    id: 7, key: 'liquidity',
    question: 'Is liquidity sufficient for my position size?',
    badge: badgeFromScore(score), score, editable: true, rationale,
    metrics: [
      { label: 'Avg daily volume', value: Number(vol).toLocaleString() + ' shares' },
      { label: 'Avg daily $ volume', value: money(dollars) },
    ],
    threshold: { warnDollars: t.warnDollars, passDollars: t.passDollars, bestPractice: BEST_PRACTICE.liquidity },
  }
}

// -- Shared bundled risk-adjusted-return criterion --
// Folds the five server-computed ratios (Sharpe / Sortino / Calmar / Omega /
// Ulcer) into ONE scored criterion so the correlated ratios don't swamp the
// asset-class-specific checks. Inert when `fund.risk_ratios` is absent (the
// single-ticker deep dives don't supply it yet) or when history is too short:
// in those cases it returns an info card with score null, which every grader
// excludes from the composite average — so it never scores a fund as a failure
// for simply being too new.
export function gradeRiskRatios(fund, id = 8) {
  const rr = fund && fund.risk_ratios
  const fmt = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? 'n/a' : Number(v).toFixed(2))
  const baseMetrics = [
    { label: 'Sharpe', value: fmt(rr && rr.sharpe) },
    { label: 'Sortino', value: fmt(rr && rr.sortino) },
    { label: 'Calmar', value: fmt(rr && rr.calmar) },
    { label: 'Omega', value: fmt(rr && rr.omega) },
    { label: 'Ulcer Index', value: fmt(rr && rr.ulcer_index) },
    { label: 'Max drawdown', value: rr && rr.max_drawdown != null ? `${Number(rr.max_drawdown).toFixed(1)}%` : 'n/a' },
  ]
  if (!rr || rr.sufficient === false || typeof rr.composite !== 'number') {
    const yrs = rr && rr.history_years != null ? Number(rr.history_years).toFixed(1) : null
    return {
      id, key: 'riskRatios',
      question: 'How strong is the risk-adjusted return profile?',
      badge: 'info', score: null, editable: false,
      rationale: rr
        ? `Only ${yrs || '<1'}y of price history — not enough to compute reliable risk-adjusted ratios. Excluded from the composite.`
        : 'Risk-adjusted ratios are computed in the Scan a List tab (they need full price history).',
      metrics: baseMetrics,
    }
  }
  const score = rr.composite
  const badge = score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail'
  const yrs = rr.history_years != null ? `${Number(rr.history_years).toFixed(1)}y` : 'full'
  let rationale
  if (badge === 'pass') rationale = `Strong risk-adjusted profile (score ${score.toFixed(0)}/100 over ${yrs}): drawdowns are shallow and returns compensate for the volatility taken.`
  else if (badge === 'warn') rationale = `Middling risk-adjusted profile (score ${score.toFixed(0)}/100 over ${yrs}): acceptable, but either drawdowns run deep or returns don't fully pay for the risk.`
  else rationale = `Weak risk-adjusted profile (score ${score.toFixed(0)}/100 over ${yrs}): deep/prolonged drawdowns relative to the return earned.`
  return {
    id, key: 'riskRatios',
    question: 'How strong is the risk-adjusted return profile?',
    badge, score, editable: false, rationale,
    metrics: [{ label: 'Risk-adjusted score', value: `${score.toFixed(0)}/100` }, ...baseMetrics],
  }
}

// Translate a composite (0-100) plus any hard fails into a buy / pass verdict.
export function verdictFromComposite(composite, criteria) {
  const scoredCount = (criteria || []).filter(c => typeof c.score === 'number').length
  const keys = new Set((criteria || []).map(c => c.key))
  const isEtfChecklist = keys.has('categoryFit') || keys.has('strategyFit')
  const hasPerformanceEvidence = (criteria || []).some(c => (
    ['performance', 'navErosion', 'yieldSustainability', 'risk', 'riskRatios'].includes(c.key)
    && typeof c.score === 'number'
  ))
  if (
    composite === null
    || composite === undefined
    || scoredCount < 3
    || (isEtfChecklist && !hasPerformanceEvidence)
  ) {
    return {
      label: 'Not Enough Information to Evaluate',
      tone: 'info',
      detail: 'A verdict requires at least three scored criteria, including total return, NAV erosion, yield sustainability, or risk.',
    }
  }
  const fails = (criteria || []).filter(c => c.badge === 'fail').length
  const failPhrase = fails === 1 ? '1 failing criterion' : `${fails} failing criteria`
  if (composite >= 70 && fails === 0) {
    return { label: 'Strong Buy', tone: 'pass', detail: `Composite ${composite.toFixed(1)}/100 with no failing scored criteria. Unscored criteria still need review.` }
  }
  if (composite >= 60 && fails <= 1) {
    return { label: 'Weak Buy', tone: 'warn', detail: `Composite ${composite.toFixed(1)}/100${fails ? ` with ${failPhrase}` : ''} — investable, but address the weak areas flagged below before committing.` }
  }
  return { label: 'Do Not Buy', tone: 'fail', detail: `Composite ${composite.toFixed(1)}/100${fails ? ` with ${failPhrase}` : ''} — fails the checklist. Review the low-scoring criteria below and consider the better-scoring alternatives instead.` }
}

export function gradeFund(fund, peers, thresholds) {
  const comparablePeers = selectComparablePeers(fund, peers)
  thresholds = mergeThresholds(thresholds)
  const criteria = [
    gradePortfolioMatch(fund),
    gradeSustainability(fund, thresholds),
    gradeDiscount(fund, thresholds),
    gradeLeverage(fund, thresholds),
    gradeExpenses(fund, comparablePeers, thresholds),
    gradeManager(fund, comparablePeers),
    gradeLiquidity(fund, thresholds),
    gradeRiskRatios(fund, 8),
  ]
  const scored = criteria.filter(c => typeof c.score === 'number')
  const composite = scored.length >= 3
    ? scored.reduce((s, c) => s + c.score, 0) / scored.length
    : null
  return { fund, criteria, composite, peers: comparablePeers }
}

function describeImprovement(label, altVal, curVal, isPctPoints, lowerBetter) {
  if (altVal === null || curVal === null) return null
  const delta = altVal - curVal
  if (lowerBetter && delta < 0) {
    return `Lower ${label} (${isPctPoints ? altVal.toFixed(2) + '%' : altVal.toFixed(2)} vs ${isPctPoints ? curVal.toFixed(2) + '%' : curVal.toFixed(2)})`
  }
  if (!lowerBetter && delta > 0) {
    return `Higher ${label} (${isPctPoints ? altVal.toFixed(2) + '%' : altVal.toFixed(2)} vs ${isPctPoints ? curVal.toFixed(2) + '%' : curVal.toFixed(2)})`
  }
  return null
}

// Sector/strategy themes used to keep "better alternatives" within the same
// kind of fund. The broad Morningstar CategoryName (e.g. "US CEF Global Income")
// lumps an infrastructure fund in with every global-income CEF, so on its own it
// surfaces unrelated alternatives. These themes are matched against the fund's
// name + strategy + category so an infrastructure CEF is only ever compared to
// other infrastructure CEFs. Ordered most-specific first; the first theme whose
// pattern matches the fund wins.
const FUND_THEMES = [
  { key: 'infrastructure', label: 'infrastructure',                patterns: [/infrastructure/] },
  { key: 'utilities',      label: 'utilities & infrastructure',    patterns: [/utilit/] },
  { key: 'midstream',      label: 'energy / MLP / midstream',      patterns: [/midstream/, /\bmlp\b/, /pipeline/, /natural resources?/, /\benergy\b/, /oil\s*&?\s*gas/] },
  { key: 'real-estate',    label: 'real estate',                   patterns: [/real estate/, /\breits?\b/, /\bproperty\b/] },
  { key: 'municipal',      label: 'municipal',                     patterns: [/municipal/, /\bmuni\b/, /tax[-\s]?free/, /tax[-\s]?exempt/] },
  { key: 'preferred',      label: 'preferred securities',          patterns: [/preferred/] },
  { key: 'senior-loan',    label: 'senior loan / floating rate',   patterns: [/senior loan/, /floating[-\s]?rate/, /bank loan/] },
  { key: 'convertible',    label: 'convertible',                   patterns: [/convertible/] },
  { key: 'covered-call',   label: 'option income / covered call',  patterns: [/covered[-\s]?call/, /buy[-\s]?write/, /option income/, /equity premium/] },
  { key: 'technology',     label: 'technology',                    patterns: [/technology/, /\btech\b/] },
  { key: 'healthcare',     label: 'health care',                   patterns: [/health\s?care/, /\bhealth\b/, /biotech/, /life sciences?/] },
  { key: 'emerging',       label: 'emerging markets',              patterns: [/emerging market/] },
]

function fundThemeText(fund) {
  return `${fund?.name || ''} ${fund?.strategy || ''} ${fund?.category || ''}`.toLowerCase()
}

// Identify a sector/strategy theme to narrow a category, never to cross one.
// Funds without a detected theme still require matching category and strategy.
export function detectFundTheme(fund) {
  const text = fundThemeText(fund)
  if (!text.trim()) return null
  for (const theme of FUND_THEMES) {
    if (theme.patterns.some(p => p.test(text))) return theme
  }
  return null
}

export function fundMatchesTheme(fund, theme) {
  if (!theme) return false
  const text = fundThemeText(fund)
  return theme.patterns.some(p => p.test(text))
}

export function findAlternatives(currentFund, peers, thresholds, limit = 5) {
  if (!currentFund || !peers || !peers.length) return []
  const universe = peers.some(p => tickerOf(p) === tickerOf(currentFund)) ? peers : [currentFund, ...peers]
  const currentGrade = gradeFund(currentFund, universe, thresholds)
  if (currentGrade.composite === null) return []
  const scoredKeys = result => result.criteria.filter(c => typeof c.score === 'number').map(c => c.key).join(',')
  const graded = selectComparablePeers(currentFund, universe)
    .map(p => gradeFund(p, universe, thresholds))
    .filter(r => typeof r.composite === 'number' && scoredKeys(r) === scoredKeys(currentGrade))
  const better = graded
    .filter(r => r.composite > currentGrade.composite + 1)
    .sort((a, b) => b.composite - a.composite)
    .slice(0, limit)
  return better.map(r => {
    const alt = r.fund
    const cur = currentFund
    const reasons = [
      describeImprovement('5Y NAV return', num(alt.return_on_nav_5y), num(cur.return_on_nav_5y), true, false),
      currentGrade.criteria.find(c => c.key === 'expense').score !== null
        ? describeImprovement('total expense ratio (financing included)', num(alt.expense_ratio), num(cur.expense_ratio), true, true)
        : null,
      (() => {
        // discount: more negative is better
        const a = num(alt.premium_discount), c = num(cur.premium_discount)
        if (a === null || c === null) return null
        if (a < c - 0.5) return `Deeper discount (${a.toFixed(2)}% vs ${c.toFixed(2)}%)`
        return null
      })(),
      (() => {
        // liquidity
        const values = [alt.avg_daily_volume, alt.price, cur.avg_daily_volume, cur.price].map(num)
        if (values.some(v => v === null)) return null
        const a = values[0] * values[1], c = values[2] * values[3]
        if (a > c * 1.5) return `Better liquidity (${money(a)} vs ${money(c)} per day)`
        return null
      })(),
      (() => {
        // distribution sustainability proxy
        const values = [alt.distribution_rate_nav, alt.return_on_nav_5y, cur.distribution_rate_nav, cur.return_on_nav_5y].map(num)
        if (values.some(v => v === null)) return null
        const aGap = values[0] - values[1], cGap = values[2] - values[3]
        if (aGap < cGap - 1) return `Smaller distribution/return gap (${aGap.toFixed(2)}pp vs ${cGap.toFixed(2)}pp)`
        return null
      })(),
    ].filter(Boolean).slice(0, 3)
    return {
      fund: alt,
      composite: r.composite,
      reasons: reasons.length ? reasons : ['Higher composite across the same scored criteria'],
    }
  })
}
