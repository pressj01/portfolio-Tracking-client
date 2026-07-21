// Grading helpers for ETF and Option-Income ETF Buying Checklist Evaluators.
// Reuses scoreBand / badgeFromScore / verdictFromComposite from cefGrading.js.

import { verdictFromComposite, gradeRiskRatios } from './cefGrading'
import { formatMoney, formatMoneyCompact } from './money'
export { verdictFromComposite, gradeRiskRatios }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function scoreBand(value, passAt, warnAt, lowerBetter = true) {
  if (value === null) return 60
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

// Expense, fund size, and age can describe a fund without showing whether the
// strategy actually works. A buy/do-not-buy verdict therefore requires at
// least one scored outcome/risk criterion in addition to the minimum coverage.
const PERFORMANCE_EVIDENCE_KEYS = new Set([
  'performance',
  'navErosion',
  'yieldSustainability',
  'risk',
  'riskRatios',
])

function hasPerformanceEvidence(criteria) {
  return criteria.some(c => PERFORMANCE_EVIDENCE_KEYS.has(c.key) && typeof c.score === 'number')
}

const pct = (n, d = 2) => (n === null || n === undefined ? 'n/a' : `${Number(n).toFixed(d)}%`)
const money = (n) => {
  return formatMoneyCompact(n, { fallback: 'n/a' })
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DEFAULT THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════════

export const ETF_DEFAULT_THRESHOLDS = {
  expense:     { passPct: 0.20, warnPct: 0.50 },
  fundSize:    { passAum: 1_000_000_000, warnAum: 100_000_000, passDollars: 1_000_000, warnDollars: 250_000 },
  performance: {},
  risk:        { highBeta: 1.5, lowBeta: 0.3 },
  yieldSustainability: { passPp: 0, warnPp: 2 },
}

export const OPTION_DEFAULT_THRESHOLDS = {
  yieldSustainability: { passPp: 2, warnPp: 4 },
  expense:     { passPct: 0.50, warnPct: 0.75 },
  fundSize:    { passAum: 500_000_000, warnAum: 100_000_000, passDollars: 1_000_000, warnDollars: 250_000 },
  performance: { passReturnPct: 7, warnReturnPct: 4 },
  navErosion:  { passPct: -1, warnPct: -4 },
  trackRecord: { passAgeYears: 3, warnAgeYears: 1 },
}

export const ETF_BEST_PRACTICE = {
  expense: 'Lower is always better. <0.10% for broad market, <0.50% for specialty.',
  fundSize: 'AUM above $1B lowers closure risk and tightens spreads.',
  performance: 'Beat the strategy peer group over 3–5 years.',
  risk: 'Beta near 1.0 for market-tracking; lower for defensive strategies.',
  yieldSustainability: 'Yield should not consistently exceed total return — the gap erodes NAV.',
}

export const OPTION_BEST_PRACTICE = {
  yieldSustainability: 'Yield funded by NAV erosion is not sustainable. Gap > 4pp is a red flag.',
  expense: 'Option-income funds are pricier. <0.50% is competitive for this space.',
  fundSize: 'Many option-income ETFs are new and small. AUM > $500M lowers closure risk.',
  performance: 'Accept lower upside for income, but total return should exceed ~7% annualized.',
  navErosion: 'Share price (NAV) should hold roughly flat over time. A persistent annualized price decline means the distribution is being funded by capital — the hallmark of an at-the-money covered-call fund like QYLD.',
  trackRecord: 'Funds < 3 years old have no full-cycle track record. < 1 year is speculative.',
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REGULAR ETF CRITERIA
// ═══════════════════════════════════════════════════════════════════════════════

function etfGradeCategoryFit(fund) {
  return {
    id: 1, key: 'categoryFit',
    question: 'Does this ETF fit your portfolio strategy?',
    badge: 'info', score: null, editable: false,
    rationale: 'Review the fund details below to confirm it matches your investment goals.',
    metrics: [
      { label: 'Category', value: fund.category || fund.etf_category || 'n/a' },
      { label: 'Strategy', value: fund.etf_strategy || 'n/a' },
      { label: 'Cap size', value: fund.etf_cap_size || 'n/a' },
      { label: 'Fund family', value: fund.fund_family || 'n/a' },
    ],
  }
}

function etfGradeExpense(fund, thresholds) {
  const exp = num(fund.expense_ratio)
  const t = thresholds.expense
  if (exp === null) {
    return {
      id: 2, key: 'expense',
      question: 'Is the expense ratio competitive?',
      badge: 'info', score: null, editable: true,
      rationale: 'Expense ratio not available.',
      metrics: [{ label: 'Expense ratio', value: 'n/a' }],
      threshold: { passPct: t.passPct, warnPct: t.warnPct, bestPractice: ETF_BEST_PRACTICE.expense },
    }
  }
  const score = scoreBand(exp, t.passPct, t.warnPct, true)
  let rationale
  if (exp <= t.passPct) rationale = `Expense ratio of ${pct(exp)} is at or below your ${pct(t.passPct)} pass line — very competitive.`
  else if (exp <= t.warnPct) rationale = `Expense ratio of ${pct(exp)} is in the warning band (above ${pct(t.passPct)}).`
  else rationale = `Expense ratio of ${pct(exp)} exceeds your ${pct(t.warnPct)} fail threshold.`
  return {
    id: 2, key: 'expense',
    question: 'Is the expense ratio competitive?',
    badge: badgeFromScore(score), score, editable: true, rationale,
    metrics: [{ label: 'Expense ratio', value: pct(exp) }],
    threshold: { passPct: t.passPct, warnPct: t.warnPct, bestPractice: ETF_BEST_PRACTICE.expense },
  }
}

function etfGradeFundSize(fund, thresholds) {
  const aum = num(fund.aum)
  const vol = num(fund.avg_volume)
  const price = num(fund.price)
  const t = thresholds.fundSize
  const metrics = [
    { label: 'AUM', value: money(aum) },
    { label: 'Avg daily volume', value: vol !== null ? Number(vol).toLocaleString() + ' shares' : 'n/a' },
  ]
  if (vol !== null && price !== null) {
    metrics.push({ label: 'Avg daily $ volume', value: money(vol * price) })
  }
  if (aum === null) {
    return {
      id: 3, key: 'fundSize',
      question: 'Is the fund large and liquid enough?',
      badge: 'info', score: null, editable: true, rationale: 'AUM not available.',
      metrics, threshold: { passAum: t.passAum, warnAum: t.warnAum, bestPractice: ETF_BEST_PRACTICE.fundSize },
    }
  }
  let score = scoreBand(aum, t.passAum, t.warnAum, false)
  if (vol !== null && price !== null) {
    const dollars = vol * price
    if (dollars < t.warnDollars) score = Math.max(0, score - 15)
    else if (dollars >= t.passDollars) score = Math.min(100, score + 5)
  }
  let rationale
  if (aum >= t.passAum) rationale = `AUM of ${money(aum)} comfortably exceeds your ${money(t.passAum)} minimum.`
  else if (aum >= t.warnAum) rationale = `AUM of ${money(aum)} is in the warning band (below ${money(t.passAum)}).`
  else rationale = `AUM of only ${money(aum)} is below your ${money(t.warnAum)} floor — higher closure and liquidity risk.`
  return {
    id: 3, key: 'fundSize',
    question: 'Is the fund large and liquid enough?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { passAum: t.passAum, warnAum: t.warnAum, bestPractice: ETF_BEST_PRACTICE.fundSize },
  }
}

function etfGradePerformance(fund, peers) {
  const { value: primary, label } = longTermTotalReturn(fund)
  const peerReturns = (peers || [])
    .map(p => longTermTotalReturn(p).value)
    .filter(v => v !== null)
    .sort((a, b) => a - b)
  let median = null, q1 = null
  if (peerReturns.length) {
    median = peerReturns[Math.floor(peerReturns.length / 2)]
    q1 = peerReturns[Math.floor(peerReturns.length / 4)]
  }
  const metrics = [
    { label: '3Y avg total return', value: pct(fund.three_year_return) },
    { label: '5Y avg total return', value: pct(fund.five_year_return) },
    { label: 'Total return (ann.)', value: pct(fund.total_cagr) },
    { label: 'YTD return', value: pct(fund.ytd_return) },
    { label: 'Peer median', value: pct(median) },
  ]
  if (primary === null) {
    return {
      id: 4, key: 'performance',
      question: 'How does performance compare to peers?',
      badge: 'info', score: null, editable: false,
      rationale: 'Multi-year return data not available — fund may be too new.',
      metrics,
    }
  }
  let score = 60, rationale
  if (median === null) {
    rationale = `${label} ${pct(primary)} — no peers found to compare against.`
  } else if (primary >= median) {
    score = 85 + Math.min(15, primary - median)
    rationale = `${label} ${pct(primary)} meets or beats the peer median (${pct(median)}).`
  } else if (q1 !== null && primary >= q1) {
    score = 55
    rationale = `${label} ${pct(primary)} is below peer median (${pct(median)}) but above bottom quartile (${pct(q1)}).`
  } else {
    score = 25
    rationale = `${label} ${pct(primary)} is in the bottom quartile for peers (median ${pct(median)}).`
  }
  return {
    id: 4, key: 'performance',
    question: 'How does performance compare to peers?',
    badge: badgeFromScore(score), score, editable: false, rationale, metrics,
    threshold: { bestPractice: ETF_BEST_PRACTICE.performance },
  }
}

function etfGradeRisk(fund, thresholds) {
  const beta = num(fund.beta_3y)
  const t = thresholds.risk
  const metrics = [
    { label: '3Y beta', value: beta !== null ? beta.toFixed(2) : 'n/a' },
    { label: '52-wk high', value: fund.week52_high != null ? formatMoney(fund.week52_high) : 'n/a' },
    { label: '52-wk low', value: fund.week52_low != null ? formatMoney(fund.week52_low) : 'n/a' },
  ]
  if (beta === null) {
    return {
      id: 5, key: 'risk',
      question: 'What is the risk profile?',
      badge: 'info', score: null, editable: true,
      rationale: 'Beta not available.',
      metrics, threshold: { highBeta: t.highBeta, lowBeta: t.lowBeta, bestPractice: ETF_BEST_PRACTICE.risk },
    }
  }
  let score = 75, rationale
  if (beta > t.highBeta) {
    score = 40
    rationale = `Beta of ${beta.toFixed(2)} is above ${t.highBeta.toFixed(1)} — significantly more volatile than the market.`
  } else if (beta < t.lowBeta) {
    score = 60
    rationale = `Beta of ${beta.toFixed(2)} is below ${t.lowBeta.toFixed(1)} — very low correlation to the market. Good for defense, but check if returns justify the allocation.`
  } else {
    score = 85
    rationale = `Beta of ${beta.toFixed(2)} is within normal range.`
  }
  return {
    id: 5, key: 'risk',
    question: 'What is the risk profile?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { highBeta: t.highBeta, lowBeta: t.lowBeta, bestPractice: ETF_BEST_PRACTICE.risk },
  }
}

function etfGradeYieldSustainability(fund, thresholds) {
  const yld = num(fund.yield_pct) || num(fund.dividend_yield)
  const { value: longTerm, label: longTermLabel } = longTermTotalReturn(fund)
  const t = thresholds.yieldSustainability
  const metrics = [
    { label: 'Yield', value: pct(yld) },
    { label: longTermLabel, value: pct(longTerm) },
  ]
  if (yld === null || yld <= 2) {
    return {
      id: 6, key: 'yieldSustainability',
      question: 'Is the yield sustainable?',
      badge: 'info', score: null, editable: true,
      rationale: yld === null ? 'Yield not available.' : `Yield of ${pct(yld)} is low enough that sustainability is not a concern.`,
      metrics,
      threshold: { passPp: t.passPp, warnPp: t.warnPp, bestPractice: ETF_BEST_PRACTICE.yieldSustainability },
    }
  }
  if (longTerm === null) {
    return {
      id: 6, key: 'yieldSustainability',
      question: 'Is the yield sustainable?',
      badge: 'info', score: null, editable: true,
      rationale: 'Long-term return not available to compare against yield.',
      metrics,
      threshold: { passPp: t.passPp, warnPp: t.warnPp, bestPractice: ETF_BEST_PRACTICE.yieldSustainability },
    }
  }
  const gap = yld - longTerm
  metrics.push({ label: 'Gap (yield − return)', value: `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}pp` })
  const score = scoreBand(gap, t.passPp, t.warnPp, true)
  let rationale
  if (gap <= t.passPp) rationale = `Yield (${pct(yld)}) is within ${t.passPp.toFixed(1)}pp of ${longTermLabel} (${pct(longTerm)}) — sustainable.`
  else if (gap <= t.warnPp) rationale = `Gap of ${gap.toFixed(2)}pp between yield (${pct(yld)}) and ${longTermLabel} (${pct(longTerm)}) is in the warning band.`
  else rationale = `Yield (${pct(yld)}) exceeds ${longTermLabel} (${pct(longTerm)}) by ${gap.toFixed(2)}pp — likely NAV erosion.`
  return {
    id: 6, key: 'yieldSustainability',
    question: 'Is the yield sustainable?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { passPp: t.passPp, warnPp: t.warnPp, bestPractice: ETF_BEST_PRACTICE.yieldSustainability },
  }
}

export function gradeETF(fund, peers, thresholds) {
  const criteria = [
    etfGradeCategoryFit(fund),
    etfGradeExpense(fund, thresholds),
    etfGradeFundSize(fund, thresholds),
    etfGradePerformance(fund, peers),
    etfGradeRisk(fund, thresholds),
    etfGradeYieldSustainability(fund, thresholds),
    gradeRiskRatios(fund, 7),
  ]
  const scored = criteria.filter(c => typeof c.score === 'number')
  const composite = scored.length >= 3 && hasPerformanceEvidence(criteria)
    ? scored.reduce((s, c) => s + c.score, 0) / scored.length
    : null
  return { fund, criteria, composite }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OPTION-INCOME ETF CRITERIA
// ═══════════════════════════════════════════════════════════════════════════════

function optGradeStrategyFit(fund) {
  return {
    id: 1, key: 'strategyFit',
    question: 'Does this option-income strategy fit your goals?',
    badge: 'info', score: null, editable: false,
    rationale: 'Review the strategy details below. Option-income ETFs sacrifice upside for current income.',
    metrics: [
      { label: 'Category', value: fund.category || fund.etf_category || 'n/a' },
      { label: 'Strategy', value: fund.etf_strategy || 'n/a' },
      { label: 'Fund family', value: fund.fund_family || 'n/a' },
    ],
  }
}

function longTermTotalReturn(fund) {
  const r5y = num(fund.five_year_return)
  const r3y = num(fund.three_year_return)
  const cagr = num(fund.total_cagr)
  const yrs = num(fund.history_years)
  if (r5y !== null) return { value: r5y, label: '5Y avg total return' }
  if (r3y !== null) return { value: r3y, label: '3Y avg total return' }
  if (cagr !== null) return { value: cagr, label: yrs !== null ? `${yrs.toFixed(1)}Y total return (ann.)` : 'Total return (ann.)' }
  return { value: null, label: 'long-term return' }
}

function optGradeYieldSustainability(fund, thresholds) {
  const yld = num(fund.yield_pct) || num(fund.dividend_yield)
  const { value: longTerm, label: longTermLabel } = longTermTotalReturn(fund)
  const t = thresholds.yieldSustainability
  const metrics = [
    { label: 'Yield', value: pct(yld) },
    { label: longTermLabel, value: pct(longTerm) },
  ]
  if (yld === null || longTerm === null) {
    return {
      id: 2, key: 'yieldSustainability',
      question: 'Is the yield sustainable or eroding NAV?',
      badge: 'info', score: null, editable: true,
      rationale: 'Yield or long-term return not available to score.',
      metrics,
      threshold: { passPp: t.passPp, warnPp: t.warnPp, bestPractice: OPTION_BEST_PRACTICE.yieldSustainability },
    }
  }
  const gap = yld - longTerm
  metrics.push({ label: 'Gap (yield − return)', value: `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}pp` })
  const score = scoreBand(gap, t.passPp, t.warnPp, true)
  let rationale
  if (gap <= t.passPp) rationale = `Yield (${pct(yld)}) is within ${t.passPp.toFixed(1)}pp of ${longTermLabel} (${pct(longTerm)}) — sustainable.`
  else if (gap <= t.warnPp) rationale = `Gap of ${gap.toFixed(2)}pp between yield and ${longTermLabel} — moderate NAV erosion risk.`
  else rationale = `Yield (${pct(yld)}) exceeds ${longTermLabel} (${pct(longTerm)}) by ${gap.toFixed(2)}pp — significant NAV erosion.`
  return {
    id: 2, key: 'yieldSustainability',
    question: 'Is the yield sustainable or eroding NAV?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { passPp: t.passPp, warnPp: t.warnPp, bestPractice: OPTION_BEST_PRACTICE.yieldSustainability },
  }
}

function optGradeExpense(fund, thresholds) {
  const exp = num(fund.expense_ratio)
  const t = thresholds.expense
  if (exp === null) {
    return {
      id: 3, key: 'expense',
      question: 'Is the expense ratio competitive for option-income?',
      badge: 'info', score: null, editable: true,
      rationale: 'Expense ratio not available.',
      metrics: [{ label: 'Expense ratio', value: 'n/a' }],
      threshold: { passPct: t.passPct, warnPct: t.warnPct, bestPractice: OPTION_BEST_PRACTICE.expense },
    }
  }
  const score = scoreBand(exp, t.passPct, t.warnPct, true)
  let rationale
  if (exp <= t.passPct) rationale = `Expense ratio of ${pct(exp)} is at or below your ${pct(t.passPct)} pass line — competitive for this space.`
  else if (exp <= t.warnPct) rationale = `Expense ratio of ${pct(exp)} is in the warning band (above ${pct(t.passPct)}).`
  else rationale = `Expense ratio of ${pct(exp)} exceeds your ${pct(t.warnPct)} fail threshold — expensive even for option-income.`
  return {
    id: 3, key: 'expense',
    question: 'Is the expense ratio competitive for option-income?',
    badge: badgeFromScore(score), score, editable: true, rationale,
    metrics: [{ label: 'Expense ratio', value: pct(exp) }],
    threshold: { passPct: t.passPct, warnPct: t.warnPct, bestPractice: OPTION_BEST_PRACTICE.expense },
  }
}

function optGradeFundSize(fund, thresholds) {
  const aum = num(fund.aum)
  const vol = num(fund.avg_volume)
  const price = num(fund.price)
  const t = thresholds.fundSize
  const metrics = [
    { label: 'AUM', value: money(aum) },
    { label: 'Avg daily volume', value: vol !== null ? Number(vol).toLocaleString() + ' shares' : 'n/a' },
  ]
  if (vol !== null && price !== null) {
    metrics.push({ label: 'Avg daily $ volume', value: money(vol * price) })
  }
  if (aum === null) {
    return {
      id: 4, key: 'fundSize',
      question: 'Is the fund large and liquid enough?',
      badge: 'info', score: null, editable: true, rationale: 'AUM not available.',
      metrics, threshold: { passAum: t.passAum, warnAum: t.warnAum, bestPractice: OPTION_BEST_PRACTICE.fundSize },
    }
  }
  let score = scoreBand(aum, t.passAum, t.warnAum, false)
  if (vol !== null && price !== null) {
    const dollars = vol * price
    if (dollars < t.warnDollars) score = Math.max(0, score - 15)
    else if (dollars >= t.passDollars) score = Math.min(100, score + 5)
  }
  let rationale
  if (aum >= t.passAum) rationale = `AUM of ${money(aum)} exceeds your ${money(t.passAum)} minimum.`
  else if (aum >= t.warnAum) rationale = `AUM of ${money(aum)} is in the warning band (below ${money(t.passAum)}).`
  else rationale = `AUM of only ${money(aum)} is below your ${money(t.warnAum)} floor — elevated closure risk for a new fund.`
  return {
    id: 4, key: 'fundSize',
    question: 'Is the fund large and liquid enough?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { passAum: t.passAum, warnAum: t.warnAum, bestPractice: OPTION_BEST_PRACTICE.fundSize },
  }
}

function optGradePerformance(fund, thresholds) {
  const { value: primary, label } = longTermTotalReturn(fund)
  const beta = num(fund.beta_3y)
  const t = thresholds.performance
  const metrics = [
    { label: '3Y avg total return', value: pct(fund.three_year_return) },
    { label: '5Y avg total return', value: pct(fund.five_year_return) },
    { label: 'Total return (ann.)', value: pct(fund.total_cagr) },
    { label: 'YTD return', value: pct(fund.ytd_return) },
    { label: '3Y beta', value: beta !== null ? beta.toFixed(2) : 'n/a' },
  ]
  if (primary === null) {
    return {
      id: 5, key: 'performance',
      question: 'Does total return justify the income trade-off?',
      badge: 'info', score: null, editable: true,
      rationale: 'Multi-year return data not available — fund may be too new.',
      metrics,
      threshold: { passReturnPct: t.passReturnPct, warnReturnPct: t.warnReturnPct, bestPractice: OPTION_BEST_PRACTICE.performance },
    }
  }
  const score = scoreBand(primary, t.passReturnPct, t.warnReturnPct, false)
  let rationale
  if (primary >= t.passReturnPct) rationale = `${label} ${pct(primary)} meets your ${pct(t.passReturnPct)} target — reasonable total return for an income strategy.`
  else if (primary >= t.warnReturnPct) rationale = `${label} ${pct(primary)} is in the warning band (below ${pct(t.passReturnPct)}).`
  else rationale = `${label} ${pct(primary)} is below your ${pct(t.warnReturnPct)} floor — the income trade-off may not be worth it.`
  return {
    id: 5, key: 'performance',
    question: 'Does total return justify the income trade-off?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { passReturnPct: t.passReturnPct, warnReturnPct: t.warnReturnPct, bestPractice: OPTION_BEST_PRACTICE.performance },
  }
}

function optGradeTrackRecord(fund, peers, thresholds) {
  const t = thresholds.trackRecord
  const inception = fund.inception_date
  let ageYears = null
  let ageFromHistory = false
  if (inception) {
    const diff = Date.now() - new Date(inception).getTime()
    ageYears = diff / (365.25 * 24 * 60 * 60 * 1000)
  }
  // Without an inception date, the span of available price history is a solid
  // lower bound on age — otherwise young funds dodge the track-record penalty.
  if (ageYears === null) {
    const histYears = num(fund.history_years)
    if (histYears !== null) {
      ageYears = histYears
      ageFromHistory = true
    }
  }
  const r3y = num(fund.three_year_return)
  const peerReturns = (peers || [])
    .map(p => num(p.three_year_return))
    .filter(v => v !== null)
    .sort((a, b) => a - b)
  let median = null
  if (peerReturns.length) median = peerReturns[Math.floor(peerReturns.length / 2)]
  const metrics = [
    { label: 'Fund family', value: fund.fund_family || 'n/a' },
    { label: 'Inception date', value: inception || 'n/a' },
    { label: 'Age', value: ageYears !== null ? `${ageYears.toFixed(1)} years${ageFromHistory ? ' (from price history)' : ''}` : 'n/a' },
    { label: '3Y avg total return', value: pct(r3y) },
    { label: 'Option-income peer median (3Y)', value: pct(median) },
  ]
  let score = null, rationale
  if (ageYears !== null && ageYears < t.warnAgeYears) {
    score = 25
    rationale = `Fund is only ${ageYears.toFixed(1)} years old — less than ${t.warnAgeYears} year. No meaningful track record.`
  } else if (ageYears !== null && ageYears < t.passAgeYears) {
    score = 50
    rationale = `Fund is ${ageYears.toFixed(1)} years old — less than ${t.passAgeYears} years. Limited track record.`
  } else if (r3y !== null && median !== null) {
    if (r3y >= median) {
      score = 90
      rationale = `Established fund (${ageYears !== null ? ageYears.toFixed(1) + 'y' : ''}). 3Y return ${pct(r3y)} beats peer median (${pct(median)}).`
    } else {
      score = 55
      rationale = `Established fund but 3Y return ${pct(r3y)} lags peer median (${pct(median)}).`
    }
  } else if (ageYears !== null && ageYears >= t.passAgeYears) {
    score = 75
    rationale = `Fund has ${ageYears.toFixed(1)} years of history. Peer comparison not available.`
  } else {
    rationale = `Track record data incomplete.`
  }
  return {
    id: 7, key: 'trackRecord',
    question: 'Does the fund family have a strong track record?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { passAgeYears: t.passAgeYears, warnAgeYears: t.warnAgeYears, bestPractice: OPTION_BEST_PRACTICE.trackRecord },
  }
}

function optGradeNavErosion(fund, thresholds) {
  const cagr = num(fund.price_cagr)
  const yrs = num(fund.history_years)
  const t = thresholds.navErosion
  const periodLabel = yrs !== null ? `${yrs.toFixed(1)}Y price-only return (ann.)` : 'Price-only return (ann.)'
  const metrics = [
    { label: periodLabel, value: pct(cagr) },
    { label: 'Total return (ann.)', value: pct(fund.total_cagr) },
  ]
  if (cagr === null) {
    return {
      id: 6, key: 'navErosion',
      question: 'Is the NAV (share price) holding up over time?',
      badge: 'info', score: null, editable: true,
      rationale: 'Price history not available to measure NAV trend.',
      metrics,
      threshold: { passPct: t.passPct, warnPct: t.warnPct, bestPractice: OPTION_BEST_PRACTICE.navErosion },
    }
  }
  // Higher (less negative) annualized price return is better.
  const score = scoreBand(cagr, t.passPct, t.warnPct, false)
  let rationale
  if (cagr >= t.passPct) {
    rationale = cagr >= 0
      ? `Share price has grown ${pct(cagr)} annualized — NAV is intact; the distribution is not eroding capital.`
      : `Share price has declined only ${pct(cagr)} annualized — within your ${pct(t.passPct)} tolerance.`
  } else if (cagr >= t.warnPct) {
    rationale = `Share price has declined ${pct(cagr)} annualized — moderate NAV erosion. Part of the distribution is funded by capital.`
  } else {
    rationale = `Share price has declined ${pct(cagr)} annualized — chronic NAV erosion. The high yield is substantially funded by returning your own capital (the at-the-money covered-call problem).`
  }
  return {
    id: 6, key: 'navErosion',
    question: 'Is the NAV (share price) holding up over time?',
    badge: badgeFromScore(score), score, editable: true, rationale, metrics,
    threshold: { passPct: t.passPct, warnPct: t.warnPct, bestPractice: OPTION_BEST_PRACTICE.navErosion },
  }
}

export function gradeOptionIncomeETF(fund, peers, thresholds) {
  const criteria = [
    optGradeStrategyFit(fund),
    optGradeYieldSustainability(fund, thresholds),
    optGradeExpense(fund, thresholds),
    optGradeFundSize(fund, thresholds),
    optGradePerformance(fund, thresholds),
    optGradeNavErosion(fund, thresholds),
    optGradeTrackRecord(fund, peers, thresholds),
    gradeRiskRatios(fund, 8),
  ]
  const scored = criteria.filter(c => typeof c.score === 'number')
  const composite = scored.length >= 3 && hasPerformanceEvidence(criteria)
    ? scored.reduce((s, c) => s + c.score, 0) / scored.length
    : null
  return { fund, criteria, composite }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ALTERNATIVES (shared by both evaluators)
// ═══════════════════════════════════════════════════════════════════════════════

const fundYield = (f) => num(f.yield_pct) ?? num(f.ttm_yield) ?? num(f.dividend_yield)

// Prefer the matched-window pair (peer + evaluated fund measured over their
// SHARED history window, attached to the peer by the backend) over raw
// full-history CAGRs: funds launched at different points in the cycle are not
// comparable on full-history numbers. Falls back to raw values when the
// matched pair is unavailable (fund too new, backend cache miss).
function pairDelta(altFund, curFund, matchedAltKey, matchedRefKey, rawKey) {
  const am = num(altFund[matchedAltKey])
  const rm = num(altFund[matchedRefKey])
  if (am !== null && rm !== null) return { alt: am, cur: rm, delta: am - rm, matched: true }
  const ar = num(altFund[rawKey])
  const cr = num(curFund[rawKey])
  if (ar !== null && cr !== null) return { alt: ar, cur: cr, delta: ar - cr, matched: false }
  return null
}

// Signed metric deltas of an alternative vs the evaluated fund, plus the
// honest list of genuine improvements. `reasons` is empty when the candidate
// has no concrete edge — callers must not paper over that.
export function compareAlternative(altFund, curFund, altComposite, curComposite) {
  const ay = fundYield(altFund)
  const cy = fundYield(curFund)
  const nav = pairDelta(altFund, curFund, 'matched_price_cagr', 'ref_matched_price_cagr', 'price_cagr')
  const total = pairDelta(altFund, curFund, 'matched_total_cagr', 'ref_matched_total_cagr', 'total_cagr')
  const ae = num(altFund.expense_ratio)
  const ce = num(curFund.expense_ratio)
  const aa = num(altFund.aum)
  const ca = num(curFund.aum)
  const matchedYears = num(altFund.matched_years)
  const deltas = {
    composite: (typeof altComposite === 'number' && typeof curComposite === 'number')
      ? altComposite - curComposite : null,
    yieldPp: (ay !== null && cy !== null) ? ay - cy : null,
    nav,
    total,
    expense: (ae !== null && ce !== null) ? ae - ce : null,
    aumRatio: (aa && ca) ? aa / ca : null,
    matchedYears,
  }
  const sharedWindow = matchedYears !== null ? ` over the shared ${matchedYears.toFixed(1)}y window` : ''
  const reasons = []
  if (deltas.yieldPp !== null && deltas.yieldPp > 0.25) {
    reasons.push(`Higher yield (${pct(ay)} vs ${pct(cy)})`)
  }
  if (nav && nav.delta > 0.5) {
    reasons.push(`NAV holds up better (price ${pct(nav.alt)}/yr vs ${pct(nav.cur)}/yr${nav.matched ? sharedWindow : ''})`)
  }
  if (total && total.delta > 0.5) {
    reasons.push(`Higher total return (${pct(total.alt)}/yr vs ${pct(total.cur)}/yr${total.matched ? sharedWindow : ''})`)
  }
  if (deltas.expense !== null && deltas.expense < -0.05) {
    reasons.push(`Lower expense ratio (${pct(ae)} vs ${pct(ce)})`)
  }
  if (deltas.aumRatio !== null && deltas.aumRatio > 2) {
    reasons.push(`Larger fund (${money(aa)} vs ${money(ca)})`)
  }
  return { deltas, reasons }
}

// Derive a canonical "underlying" group from the fund's live name / category.
// Purely data-driven keyword extraction — no per-ticker table — so alternatives
// can be restricted to funds tracking the same kind of underlier (a crypto fund
// should not be compared against a QQQ fund). Crypto variants collapse into one
// group, and any single-stock fund is bucketed together regardless of the stock.
export function deriveUnderlying(fund) {
  if (!fund) return 'other'
  if (fund.is_single_stock) return 'single-stock'
  const text = `${fund.name || ''} ${fund.category || fund.etf_category || ''}`.toLowerCase()
  if (/\b(bitcoin|btc|ether|ethereum|eth|crypto|digital asset|blockchain)\b/.test(text)) return 'crypto'
  if (/nasdaq|\bndx\b|\bqqq\b/.test(text)) return 'nasdaq100'
  if (/s\s*&\s*p|\bs and p\b|standard\s*&?\s*poor|\bspx\b|\bspy\b|\bsp\s*500\b|\b500\b/.test(text)) return 'sp500'
  if (/russell|\biwm\b|\b2000\b|small[-\s]?cap/.test(text)) return 'russell2000'
  if (/\bdow\b|djia|\bdia\b|industrial average/.test(text)) return 'dow'
  if (/\bgold\b|\bgld\b|\bsilver\b|\bslv\b|precious metal|commodit/.test(text)) return 'gold'
  if (/treasur|\bbonds?\b|fixed[-\s]?income|\btlt\b|\bhyg\b|\blqd\b|\bagg\b|munic|corporate credit|high[-\s]?yield credit/.test(text)) return 'bond'
  return 'other'
}

export const UNDERLYING_LABELS = {
  crypto: 'Crypto',
  nasdaq100: 'Nasdaq 100',
  sp500: 'S&P 500',
  russell2000: 'Russell 2000',
  dow: 'Dow',
  gold: 'Gold / Commodity',
  bond: 'Bond / Fixed Income',
  'single-stock': 'Single-stock',
  other: 'Other',
}

function criterionScore(grade, key) {
  const item = (grade?.criteria || []).find(c => c.key === key)
  return typeof item?.score === 'number' ? item.score : null
}

function providerToken(fund) {
  const text = `${fund?.fund_family || ''} ${fund?.name || ''}`.toLowerCase()
  if (text.includes('neos')) return 'neos'
  if (text.includes('jpmorgan') || text.includes('jp morgan')) return 'jpmorgan'
  if (text.includes('global x')) return 'globalx'
  if (text.includes('amplify')) return 'amplify'
  if (text.includes('yieldmax')) return 'yieldmax'
  if (text.includes('roundhill')) return 'roundhill'
  if (text.includes('rex')) return 'rex'
  return ''
}

function sameSponsorFamily(a, b) {
  const ap = providerToken(a)
  const bp = providerToken(b)
  return !!ap && ap === bp
}

function passesOptionIncomeQualityFloor(currentFund, candidateFund, currentGrade, candidateGrade, opts) {
  const compositeTolerance = opts.qualityCompositeTolerance
  if (
    typeof compositeTolerance === 'number' &&
    typeof currentGrade?.composite === 'number' &&
    typeof candidateGrade?.composite === 'number' &&
    candidateGrade.composite < currentGrade.composite - compositeTolerance
  ) {
    return false
  }

  if (opts.excludeSingleStockUnlessCurrent && candidateFund.is_single_stock && !currentFund.is_single_stock) {
    return false
  }

  const curPrice = num(currentFund.price_cagr)
  const altPrice = num(candidateFund.price_cagr)
  const curTotal = num(currentFund.total_cagr)
  const altTotal = num(candidateFund.total_cagr)

  if (curPrice !== null && altPrice === null) return false
  if (curTotal !== null && altTotal === null) return false

  const curNavScore = criterionScore(currentGrade, 'navErosion')
  const altNavScore = criterionScore(candidateGrade, 'navErosion')
  if (curNavScore !== null && curNavScore >= 80 && altNavScore !== null && altNavScore < 70) {
    return false
  }

  // If the selected fund has a positive NAV trend, do not recommend funds with
  // chronic price erosion as "better" alternatives.
  if (curPrice !== null && curPrice >= 0 && altPrice !== null && altPrice < -1) {
    return false
  }

  const sameSponsor = sameSponsorFamily(currentFund, candidateFund)
  if (!sameSponsor && curTotal !== null && altTotal !== null && curPrice !== null && altPrice !== null) {
    const totalLag = curTotal - altTotal
    const navLag = curPrice - altPrice
    if (totalLag > 5 && navLag > 1) return false
  }

  const curYield = fundYield(currentFund)
  const altYield = fundYield(candidateFund)
  const years = num(candidateFund.history_years)
  if (curYield !== null && altYield !== null && years !== null && years < 3 && altYield > curYield * 1.75) {
    return false
  }

  return true
}

// Peers restricted to the comparable universe: same underlying group, real
// price history, enough history, and (optionally) enough scored criteria for
// the composite to mean something. Shared by the ranking and alternatives
// paths so "rank" and "alternatives" always draw from the same population.
function comparablePeers(currentFund, peers, thresholds, gradeFunc, opts = {}) {
  const { underlyingGroup = null, minHistoryYears = null, minScoredCriteria = null,
          excludeSingleStockUnlessCurrent = false } = opts
  const currentTicker = String(currentFund.ticker || '').toUpperCase()
  let graded = peers
    .filter(p => String(p.ticker || '').toUpperCase() !== currentTicker)
    .map(p => ({ grade: gradeFunc(p, peers, thresholds), fund: p }))
    .filter(g => typeof g.grade.composite === 'number')

  if (underlyingGroup && underlyingGroup !== 'any') {
    graded = graded.filter(g => deriveUnderlying(g.fund) === underlyingGroup)
  }
  if (excludeSingleStockUnlessCurrent && !currentFund.is_single_stock) {
    graded = graded.filter(g => !g.fund.is_single_stock)
  }
  if (minHistoryYears !== null) {
    graded = graded.filter(g => {
      const yrs = num(g.fund.history_years)
      return yrs !== null && yrs >= minHistoryYears
    })
  }
  // A composite blended from only 2-3 criteria isn't comparable to the
  // evaluated fund's 6-7. Require real coverage before a peer can rank or
  // be surfaced as an alternative.
  if (minScoredCriteria !== null) {
    graded = graded.filter(g =>
      (g.grade.criteria || []).filter(c => typeof c.score === 'number').length >= minScoredCriteria)
  }
  return graded
}

// Where the evaluated fund lands among its comparable peers by composite.
// Returns { rank, total, betterCount } (rank 1 = best) or null if the fund
// has no composite or has no comparable peers to rank against.
export function rankAmongPeers(currentFund, peers, thresholds, gradeFunc, opts = {}) {
  if (!currentFund || !peers || !peers.length) return null
  const currentGrade = gradeFunc(currentFund, peers, thresholds)
  if (typeof currentGrade.composite !== 'number') return null
  const graded = comparablePeers(currentFund, peers, thresholds, gradeFunc, opts)
  if (!graded.length) return null
  const betterCount = graded.filter(g => g.grade.composite > currentGrade.composite).length
  return { rank: betterCount + 1, total: graded.length + 1, betterCount }
}

// opts:
//   passingOnly    — only keep alternatives that clear the checklist (verdict not "Do Not Buy")
//   yieldFloorRatio — alt yield must be ≥ currentYield × ratio (e.g. 0.90 = at most 10% less income)
//   singleStockLast — sort diversified funds first, single-stock income ETFs last (still shown, flagged)
//   optionIncomeQualityFloor — reject option-income peers materially worse than the selected fund
//   minCompositeDelta — alt composite must beat the evaluated fund by at least this (applies on ALL paths)
//   requireImprovement — drop candidates with no concrete metric edge (yield/NAV/return/expense/size)
//   minScoredCriteria — require the candidate's composite to cover at least N criteria
export function findETFAlternatives(currentFund, peers, thresholds, gradeFunc, limit = 5, opts = {}) {
  if (!currentFund || !peers || !peers.length) return []
  const {
    passingOnly = false,
    yieldFloorRatio = null,
    yieldBaseline = null,
    singleStockLast = false,
    minCompositeDelta = 1,
    requireImprovement = false,
    optionIncomeQualityFloor = false,
  } = opts
  const currentGrade = gradeFunc(currentFund, peers, thresholds)
  const curYield = fundYield(currentFund)
  // Income floor is measured against an explicit target yield when supplied,
  // otherwise against the evaluated fund's own yield.
  const baselineYield = (yieldBaseline !== null && Number.isFinite(yieldBaseline)) ? yieldBaseline : curYield
  const yieldFloor = (yieldFloorRatio !== null && baselineYield !== null) ? baselineYield * yieldFloorRatio : null

  let graded = comparablePeers(currentFund, peers, thresholds, gradeFunc, opts)

  if (passingOnly) {
    graded = graded.filter(g => {
      const f = g.fund
      // Only recommend funds we have real NAV/return data for, with enough history
      // that the annualized figures aren't a short-window extrapolation.
      if (num(f.price_cagr) === null) return false
      const v = verdictFromComposite(g.grade.composite, g.grade.criteria)
      return v.tone === 'pass' || v.tone === 'warn'
    })
  }

  // An alternative must out-score the evaluated fund to be "better" — enforced
  // on every path (the passing-checklist path used to skip this, which is why
  // funds worse than the one being evaluated kept showing up).
  if (typeof currentGrade.composite === 'number') {
    graded = graded.filter(g => g.grade.composite >= currentGrade.composite + minCompositeDelta)
  }

  if (optionIncomeQualityFloor) {
    graded = graded.filter(g => passesOptionIncomeQualityFloor(currentFund, g.fund, currentGrade, g.grade, opts))
  }

  if (yieldFloor !== null) {
    graded = graded.filter(g => {
      const ay = fundYield(g.fund)
      return ay !== null && ay >= yieldFloor
    })
  }

  // Attach honest, matched-window-aware deltas and the list of genuine edges.
  let scored = graded.map(g => ({
    ...g,
    cmp: compareAlternative(g.fund, currentFund, g.grade.composite, currentGrade.composite),
  }))

  // A higher composite alone can come entirely from softer criteria (expense,
  // size, age). Require a concrete outcome edge so every listed alternative is
  // defensibly better on something the investor cares about.
  if (requireImprovement) {
    scored = scored.filter(s => s.cmp.reasons.length > 0)
  }

  scored.sort((a, b) => {
    if (singleStockLast) {
      const as = a.fund.is_single_stock ? 1 : 0
      const bs = b.fund.is_single_stock ? 1 : 0
      if (as !== bs) return as - bs
    }
    return b.grade.composite - a.grade.composite
  })

  return scored.slice(0, limit).map(({ grade, fund: alt, cmp }) => {
    let reasons = cmp.reasons.slice(0, 3)
    if (!reasons.length) {
      const d = cmp.deltas.composite
      reasons = (typeof d === 'number' && d > 0)
        ? [`Higher composite score (+${d.toFixed(1)})`]
        : ['Comparable overall profile']
    }
    return {
      fund: alt,
      composite: grade.composite,
      deltas: cmp.deltas,
      scoredCount: (grade.criteria || []).filter(c => typeof c.score === 'number').length,
      isSingleStock: !!alt.is_single_stock,
      reasons,
    }
  })
}
