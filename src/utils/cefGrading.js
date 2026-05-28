// Pure grading helpers for the CEF Buying Checklist Evaluator.
// Each criterion returns a { badge, score, rationale, metrics, ... } record.
// Composite score averages criteria 2-7 (criterion 1 is informational).

export const DEFAULT_THRESHOLDS = {
  sustainability: { passPp: 1, warnPp: 3 },
  discount:       { passPremium: 0, warnPremium: 5 },
  leverage:       { passPct: 30, warnPct: 35 },
  expense:        { passPct: 1.25, warnPct: 1.50 },
  liquidity:      { passDollars: 1_000_000, warnDollars: 250_000 },
}

export const BEST_PRACTICE = {
  sustainability: 'Distribution rate on NAV should not exceed the long-term (5Y) NAV total return by more than ~1 percentage point. Larger gaps suggest the payout is being funded by return-of-capital or asset sales.',
  discount:       'Buy at a discount, ideally below the fund’s 52-week average. Premiums above 5% leave little margin of safety.',
  leverage:       'Effective leverage below 30% leaves cushion. 30–35% is moderate; above 35% is high.',
  expense:        'Total expense ratio below 1.25% is competitive. Above 1.50% is high relative to peers.',
  liquidity:      'Average daily traded value above $1,000,000 absorbs typical retail orders without moving the market.',
  manager:        'NAV total return should meet or beat the category median over 3–5 years.',
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
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
  if (v <= p) return Math.min(100, 85 + Math.max(0, p - v))
  if (v <= w) {
    const span = w - p
    return span <= 0 ? 70 : 50 + 35 * (1 - (v - p) / span)
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
  if (n === null || n === undefined) return 'n/a'
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
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
      { label: 'Uses leverage', value: fund.is_leveraged ? 'Yes' : 'No' },
      { label: 'Managed distribution', value: fund.is_managed_distribution ? 'Yes' : 'No' },
    ],
  }
}

// -- Criterion 2: Distribution sustainability --
// Uses UNII per share and earnings-based coverage when available, otherwise
// falls back to the proxy (distribution rate on NAV vs. long-term NAV return).
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
    metrics.push({ label: 'UNII per share', value: `$${unii.toFixed(4)}` })
    if (nav) metrics.push({ label: 'UNII as % of NAV', value: pct(unii / nav * 100, 3) })
  }
  if (eps !== null && distAmt !== null && distAmt > 0) {
    const coverage = eps / distAmt
    metrics.push({ label: 'Earnings / dist coverage', value: `${coverage.toFixed(2)}x` })
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

  // UNII adjustment — positive UNII means the fund is earning more than it pays out
  if (unii !== null && score !== null) {
    if (unii > 0) {
      score = Math.min(100, score + 10)
    } else if (unii < -0.05) {
      score = Math.max(0, score - 10)
    }
  }

  // EPS-based coverage adjustment
  if (eps !== null && distAmt !== null && distAmt > 0 && score !== null) {
    const coverage = eps / distAmt
    if (coverage >= 1.0) score = Math.min(100, score + 5)
    else if (coverage < 0.5) score = Math.max(0, score - 5)
  }

  // Build rationale
  if (score === null) {
    rationale = 'Insufficient data to score (need distribution rate on NAV and 3Y/5Y NAV return).'
    // But if we have UNII or coverage, at least mention it
    if (unii !== null) {
      rationale += ` UNII per share is $${unii.toFixed(4)} (${unii >= 0 ? 'positive — fund is earning more than it distributes' : 'negative — fund is distributing more than it earns'}).`
    }
    return {
      id: 2, key: 'sustainability',
      question: 'Is the distribution sustainable?',
      badge: unii !== null ? (unii >= 0 ? 'pass' : 'warn') : 'info',
      score: unii !== null ? (unii >= 0 ? 75 : 40) : null,
      editable: true, rationale, metrics,
      threshold: { warnPp: t.warnPp, passPp: t.passPp, bestPractice: BEST_PRACTICE.sustainability },
    }
  }

  // Main rationale from proxy gap
  if (gap <= t.passPp) {
    rationale = `Distribution rate (${pct(drNav)}) is within ${t.passPp.toFixed(1)}pp of long-term NAV return (${pct(longTerm)}) — sustainable.`
  } else if (gap <= t.warnPp) {
    rationale = `Gap of ${gap.toFixed(2)}pp between distribution rate (${pct(drNav)}) and ${longTermLabel} (${pct(longTerm)}) is in the warning band.`
  } else {
    rationale = `Distribution rate (${pct(drNav)}) exceeds ${longTermLabel} (${pct(longTerm)}) by ${gap.toFixed(2)}pp — above your ${t.warnPp.toFixed(1)}pp fail line.`
  }
  // Append UNII context
  if (unii !== null) {
    rationale += ` UNII $${unii.toFixed(4)} (${unii >= 0 ? 'positive — earning surplus' : 'negative — earning deficit'}).`
  }
  // Append EPS coverage context
  if (eps !== null && distAmt !== null && distAmt > 0) {
    const coverage = eps / distAmt
    rationale += ` Earnings cover ${coverage.toFixed(2)}x the distribution.`
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
  if (prem < t.passPremium) {
    rationale = `Trading at a ${pct(Math.abs(prem))} discount`
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
  const lev = num(fund.leverage_ratio)
  const t = thresholds.leverage
  if (lev === null && !fund.is_leveraged) {
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
      metrics: [{ label: 'Uses leverage', value: 'Yes (ratio n/a)' }],
      threshold: { warnPct: t.warnPct, passPct: t.passPct, bestPractice: BEST_PRACTICE.leverage },
    }
  }
  const score = scoreBand(lev, t.passPct, t.warnPct, true)
  let rationale
  if (lev <= t.passPct) rationale = `Leverage of ${pct(lev, 1)} is within your acceptable max of ${t.passPct.toFixed(0)}%.`
  else if (lev <= t.warnPct) rationale = `Leverage of ${pct(lev, 1)} is in the warning band (${t.passPct.toFixed(0)}–${t.warnPct.toFixed(0)}%).`
  else rationale = `Leverage of ${pct(lev, 1)} exceeds your fail threshold of ${t.warnPct.toFixed(0)}% — well above the 30% best-practice guideline.`
  return {
    id: 4, key: 'leverage',
    question: 'How much leverage is used, and how does it behave in stress?',
    badge: badgeFromScore(score), score, editable: true, rationale,
    metrics: [
      { label: 'Leverage ratio', value: pct(lev, 1) },
      { label: 'Uses leverage', value: fund.is_leveraged ? 'Yes' : 'No' },
    ],
    threshold: { warnPct: t.warnPct, passPct: t.passPct, bestPractice: BEST_PRACTICE.leverage },
  }
}

// -- Criterion 5: Expenses --
function gradeExpenses(fund, thresholds) {
  const exp = num(fund.expense_ratio)
  const t = thresholds.expense
  if (exp === null) {
    return {
      id: 5, key: 'expense',
      question: 'Are expenses reasonable relative to peers?',
      badge: 'info', score: null, editable: true,
      rationale: 'Expense ratio not reported in feed.',
      metrics: [{ label: 'Expense ratio', value: 'n/a' }],
      threshold: { warnPct: t.warnPct, passPct: t.passPct, bestPractice: BEST_PRACTICE.expense },
    }
  }
  const score = scoreBand(exp, t.passPct, t.warnPct, true)
  let rationale
  if (exp <= t.passPct) rationale = `Expense ratio of ${pct(exp, 2)} is at or below your ${t.passPct.toFixed(2)}% pass line.`
  else if (exp <= t.warnPct) rationale = `Expense ratio of ${pct(exp, 2)} is in the warning band (above ${t.passPct.toFixed(2)}%).`
  else rationale = `Expense ratio of ${pct(exp, 2)} exceeds your fail threshold of ${t.warnPct.toFixed(2)}%.`
  return {
    id: 5, key: 'expense',
    question: 'Are expenses reasonable relative to peers?',
    badge: badgeFromScore(score), score, editable: true, rationale,
    metrics: [{ label: 'Expense ratio', value: pct(exp, 2) }],
    threshold: { warnPct: t.warnPct, passPct: t.passPct, bestPractice: BEST_PRACTICE.expense },
  }
}

// -- Criterion 6: Manager / track record vs category --
function gradeManager(fund, peers) {
  const r5y = num(fund.return_on_nav_5y)
  const r3y = num(fund.return_on_nav_3y)
  const primary = r5y !== null ? r5y : r3y
  const primaryLabel = r5y !== null ? '5Y NAV return' : '3Y NAV return'
  const peerReturns = (peers || [])
    .map(p => num(r5y !== null ? p.return_on_nav_5y : p.return_on_nav_3y))
    .filter(v => v !== null)
    .sort((a, b) => a - b)
  let median = null, q1 = null
  if (peerReturns.length) {
    median = peerReturns[Math.floor(peerReturns.length / 2)]
    q1 = peerReturns[Math.floor(peerReturns.length / 4)]
  }
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
  let score = 60
  let rationale
  if (median === null) {
    rationale = `${primaryLabel} ${pct(primary)} — no category peers found to compare against.`
  } else if (primary >= median) {
    score = 85 + Math.min(15, (primary - median))
    rationale = `${primaryLabel} ${pct(primary)} meets or beats the ${fund.category || 'category'} median (${pct(median)}).`
  } else if (q1 !== null && primary >= q1) {
    score = 55
    rationale = `${primaryLabel} ${pct(primary)} below ${fund.category || 'category'} median (${pct(median)}) but above the bottom quartile (${pct(q1)}).`
  } else {
    score = 25
    rationale = `${primaryLabel} ${pct(primary)} is in the bottom quartile for the ${fund.category || 'category'} category (median ${pct(median)}).`
  }
  return {
    id: 6, key: 'manager',
    question: 'Is the manager reputable with a strong track record?',
    badge: badgeFromScore(score), score, editable: false, rationale,
    metrics: [
      { label: 'Sponsor', value: fund.sponsor || 'n/a' },
      { label: '3Y NAV return', value: pct(r3y) },
      { label: '5Y NAV return', value: pct(r5y) },
      { label: 'Category median (5Y if avail.)', value: pct(median) },
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

// Translate a composite (0-100) plus any hard fails into a buy / pass verdict.
export function verdictFromComposite(composite, criteria) {
  if (composite === null || composite === undefined) {
    return { label: 'Insufficient Data', tone: 'info', detail: 'Not enough data to score this fund — too few criteria could be evaluated.' }
  }
  const fails = (criteria || []).filter(c => c.badge === 'fail').length
  const failPhrase = fails === 1 ? '1 failing criterion' : `${fails} failing criteria`
  if (composite >= 70 && fails === 0) {
    return { label: 'Strong Buy', tone: 'pass', detail: `Composite ${composite.toFixed(1)}/100 with no failing criteria — it clears the checklist on every measure.` }
  }
  if (composite >= 60 && fails <= 1) {
    return { label: 'Weak Buy', tone: 'warn', detail: `Composite ${composite.toFixed(1)}/100${fails ? ` with ${failPhrase}` : ''} — investable, but address the weak areas flagged below before committing.` }
  }
  return { label: 'Do Not Buy', tone: 'fail', detail: `Composite ${composite.toFixed(1)}/100${fails ? ` with ${failPhrase}` : ''} — fails the checklist. Review the low-scoring criteria below and consider the better-scoring alternatives instead.` }
}

export function gradeFund(fund, peers, thresholds) {
  const criteria = [
    gradePortfolioMatch(fund),
    gradeSustainability(fund, thresholds),
    gradeDiscount(fund, thresholds),
    gradeLeverage(fund, thresholds),
    gradeExpenses(fund, thresholds),
    gradeManager(fund, peers),
    gradeLiquidity(fund, thresholds),
  ]
  const scored = criteria.filter(c => typeof c.score === 'number')
  const composite = scored.length
    ? scored.reduce((s, c) => s + c.score, 0) / scored.length
    : null
  return { fund, criteria, composite }
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

export function findAlternatives(currentFund, peers, thresholds, limit = 5) {
  if (!currentFund || !peers || !peers.length) return []
  const currentTicker = String(currentFund.ticker || '').toUpperCase()
  const graded = peers
    .filter(p => String(p.ticker || '').toUpperCase() !== currentTicker)
    .map(p => gradeFund(p, peers, thresholds))
    .filter(r => typeof r.composite === 'number')
  const currentGrade = gradeFund(currentFund, peers, thresholds)
  const better = graded
    .filter(r => currentGrade.composite === null || r.composite > currentGrade.composite + 1)
    .sort((a, b) => b.composite - a.composite)
    .slice(0, limit)
  return better.map(r => {
    const alt = r.fund
    const cur = currentFund
    const reasons = [
      describeImprovement('expense ratio', num(alt.expense_ratio), num(cur.expense_ratio), true, true),
      describeImprovement('leverage', num(alt.leverage_ratio), num(cur.leverage_ratio), true, true),
      describeImprovement('5Y NAV return', num(alt.return_on_nav_5y), num(cur.return_on_nav_5y), true, false),
      (() => {
        // discount: more negative is better
        const a = num(alt.premium_discount), c = num(cur.premium_discount)
        if (a === null || c === null) return null
        if (a < c - 0.5) return `Deeper discount (${a.toFixed(2)}% vs ${c.toFixed(2)}%)`
        return null
      })(),
      (() => {
        // liquidity
        const a = num(alt.avg_daily_volume) * num(alt.price)
        const c = num(cur.avg_daily_volume) * num(cur.price)
        if (!Number.isFinite(a) || !Number.isFinite(c)) return null
        if (a > c * 1.5) return `Better liquidity (${money(a)} vs ${money(c)} per day)`
        return null
      })(),
      (() => {
        // distribution sustainability proxy
        const aGap = num(alt.distribution_rate_nav) - num(alt.return_on_nav_5y)
        const cGap = num(cur.distribution_rate_nav) - num(cur.return_on_nav_5y)
        if (!Number.isFinite(aGap) || !Number.isFinite(cGap)) return null
        if (aGap < cGap - 1) return `Smaller distribution/return gap (${aGap.toFixed(2)}pp vs ${cGap.toFixed(2)}pp)`
        return null
      })(),
    ].filter(Boolean).slice(0, 3)
    return {
      fund: alt,
      composite: r.composite,
      reasons: reasons.length ? reasons : ['Higher overall composite score across the 7 criteria'],
    }
  })
}
