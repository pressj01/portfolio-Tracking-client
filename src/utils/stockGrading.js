// Pure grading helpers for the Stock Buying Checklist.
//
// Fundamentals are graded SECTOR-RELATIVE: each ratio is compared to a sector
// benchmark (the median of the scanned cohort when available, otherwise a
// built-in per-sector baseline). Technicals are graded from standard indicator
// signals (trend, MACD, RSI, stochastics, awesome oscillator, volume).
//
// gradeStock() returns a Fundamental composite and a Technical composite plus a
// blended verdict, so a great business with poor entry timing reads differently
// from a weak business on a hot chart.

export const SCORE_WEIGHTS = { fundamental: 0.6, technical: 0.4 }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Built-in sector baselines (rough sector medians) used for a single-ticker
// deep dive when there's no scanned cohort to draw a live median from.
// Values: P/E, forward P/E, PEG, P/B, P/S, EV/EBITDA, margins %, ROE/ROA %,
// growth %, debt/equity (yfinance scale), current ratio, payout %.
const BASE = {
  trailing_pe: 20, forward_pe: 18, peg_ratio: 1.5, price_to_book: 3,
  price_to_sales_ttm: 3, ev_to_ebitda: 14,
  profit_margin_pct: 10, operating_margin_pct: 12, gross_margin_pct: 40,
  roe_pct: 15, roa_pct: 6, revenue_growth_pct: 8, earnings_growth_pct: 8,
  debt_to_equity: 100, current_ratio: 1.5, payout_ratio_pct: 60,
}

export const SECTOR_BASELINES = {
  'Technology':             { ...BASE, trailing_pe: 30, forward_pe: 26, peg_ratio: 2.0, price_to_book: 6, price_to_sales_ttm: 6, ev_to_ebitda: 20, profit_margin_pct: 18, operating_margin_pct: 22, gross_margin_pct: 55, roe_pct: 22, revenue_growth_pct: 12, earnings_growth_pct: 12, debt_to_equity: 60 },
  'Communication Services': { ...BASE, trailing_pe: 22, forward_pe: 18, peg_ratio: 1.5, price_to_book: 3, price_to_sales_ttm: 3, ev_to_ebitda: 12, profit_margin_pct: 14, operating_margin_pct: 18, roe_pct: 16, revenue_growth_pct: 8 },
  'Healthcare':             { ...BASE, trailing_pe: 24, forward_pe: 18, peg_ratio: 1.8, price_to_book: 4, price_to_sales_ttm: 4, ev_to_ebitda: 15, profit_margin_pct: 12, operating_margin_pct: 16, gross_margin_pct: 60, roe_pct: 16, revenue_growth_pct: 8 },
  'Financial Services':     { ...BASE, trailing_pe: 13, forward_pe: 12, peg_ratio: 1.3, price_to_book: 1.4, price_to_sales_ttm: 3, ev_to_ebitda: 12, profit_margin_pct: 22, operating_margin_pct: 30, roe_pct: 12, roa_pct: 1.2, debt_to_equity: 150 },
  'Consumer Cyclical':      { ...BASE, trailing_pe: 20, forward_pe: 17, peg_ratio: 1.6, price_to_book: 4, price_to_sales_ttm: 1.5, ev_to_ebitda: 13, profit_margin_pct: 7, operating_margin_pct: 9, roe_pct: 18, revenue_growth_pct: 8 },
  'Consumer Defensive':     { ...BASE, trailing_pe: 22, forward_pe: 19, peg_ratio: 2.2, price_to_book: 4, price_to_sales_ttm: 1.5, ev_to_ebitda: 14, profit_margin_pct: 7, operating_margin_pct: 9, roe_pct: 18, revenue_growth_pct: 4, payout_ratio_pct: 65 },
  'Industrials':            { ...BASE, trailing_pe: 20, forward_pe: 18, peg_ratio: 1.8, price_to_book: 4, price_to_sales_ttm: 2, ev_to_ebitda: 13, profit_margin_pct: 9, operating_margin_pct: 12, roe_pct: 16, revenue_growth_pct: 6 },
  'Energy':                 { ...BASE, trailing_pe: 12, forward_pe: 11, peg_ratio: 1.2, price_to_book: 1.8, price_to_sales_ttm: 1.2, ev_to_ebitda: 6, profit_margin_pct: 10, operating_margin_pct: 14, roe_pct: 14, revenue_growth_pct: 4, payout_ratio_pct: 45 },
  'Utilities':              { ...BASE, trailing_pe: 18, forward_pe: 16, peg_ratio: 2.8, price_to_book: 1.8, price_to_sales_ttm: 2.5, ev_to_ebitda: 11, profit_margin_pct: 12, operating_margin_pct: 20, roe_pct: 10, revenue_growth_pct: 3, debt_to_equity: 130, payout_ratio_pct: 70 },
  'Real Estate':            { ...BASE, trailing_pe: 30, forward_pe: 28, peg_ratio: 2.5, price_to_book: 2, price_to_sales_ttm: 6, ev_to_ebitda: 18, profit_margin_pct: 20, operating_margin_pct: 30, roe_pct: 8, revenue_growth_pct: 5, debt_to_equity: 120, payout_ratio_pct: 80 },
  'Basic Materials':        { ...BASE, trailing_pe: 15, forward_pe: 13, peg_ratio: 1.4, price_to_book: 2, price_to_sales_ttm: 1.5, ev_to_ebitda: 9, profit_margin_pct: 9, operating_margin_pct: 13, roe_pct: 13, revenue_growth_pct: 4 },
  'Default': { ...BASE },
}

// Which fundamental metrics get a sector median, and their direction.
const LOWER_BETTER = new Set([
  'trailing_pe', 'forward_pe', 'peg_ratio', 'price_to_book', 'price_to_sales_ttm',
  'ev_to_ebitda', 'debt_to_equity', 'payout_ratio_pct',
])
// Ratios where a non-positive value signals no/again earnings (a red flag),
// vs. lower-better metrics where zero is simply excellent (debt, payout).
const NEGATIVE_IS_BAD = new Set(['trailing_pe', 'forward_pe', 'peg_ratio', 'ev_to_ebitda'])

function band(score) {
  return { score, badge: score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail' }
}

// Grade one fundamental metric against its sector benchmark.
function gradeMetric(key, value, benchmark) {
  const v = num(value)
  if (v === null) return { score: null, badge: 'info' }
  const b = num(benchmark)
  const lowerBetter = LOWER_BETTER.has(key)
  if (lowerBetter) {
    if (NEGATIVE_IS_BAD.has(key) && v <= 0) return band(22) // negative earnings, etc.
    if (b === null || b <= 0) return { score: 60, badge: 'warn' }
    const r = v / b
    if (r <= 0.8) return band(100)
    if (r <= 1.0) return band(85)
    if (r <= 1.3) return band(64)
    if (r <= 1.6) return band(46)
    return band(28)
  }
  // higher better
  if (v < 0) return band(22)
  if (b === null) return { score: 60, badge: 'warn' }
  const r = b <= 0 ? (v > 0 ? 1.2 : 0) : v / b
  if (r >= 1.2) return band(100)
  if (r >= 1.0) return band(85)
  if (r >= 0.7) return band(62)
  if (r >= 0.4) return band(44)
  return band(28)
}

const fmtX = (n) => (num(n) === null ? 'n/a' : `${Number(n).toFixed(2)}×`)
const fmtPct = (n) => (num(n) === null ? 'n/a' : `${Number(n).toFixed(2)}%`)
const fmtNum = (n, d = 2) => (num(n) === null ? 'n/a' : Number(n).toFixed(d))

// Fundamental criterion groups: each is one card averaging its sub-metrics.
const FUND_GROUPS = [
  {
    id: 1, key: 'valuation', question: 'Is the valuation reasonable for its sector?',
    items: [
      ['trailing_pe', 'P/E (TTM)', fmtX],
      ['forward_pe', 'Forward P/E', fmtX],
      ['peg_ratio', 'PEG', fmtX],
      ['price_to_book', 'P/B', fmtX],
      ['price_to_sales_ttm', 'P/S (TTM)', fmtX],
      ['ev_to_ebitda', 'EV/EBITDA', fmtX],
    ],
  },
  {
    id: 2, key: 'profitability', question: 'Is the business highly profitable?',
    items: [
      ['profit_margin_pct', 'Net margin', fmtPct],
      ['operating_margin_pct', 'Operating margin', fmtPct],
      ['gross_margin_pct', 'Gross margin', fmtPct],
      ['roe_pct', 'Return on equity', fmtPct],
      ['roa_pct', 'Return on assets', fmtPct],
    ],
  },
  {
    id: 3, key: 'growth', question: 'Are revenue and earnings growing?',
    items: [
      ['revenue_growth_pct', 'Revenue growth (YoY)', fmtPct],
      ['earnings_growth_pct', 'Earnings growth (YoY)', fmtPct],
    ],
  },
  {
    id: 4, key: 'health', question: 'Is the balance sheet healthy?',
    items: [
      ['debt_to_equity', 'Debt / equity', (n) => fmtNum(n, 1)],
      ['current_ratio', 'Current ratio', (n) => fmtNum(n, 2)],
      ['payout_ratio_pct', 'Payout ratio', fmtPct],
    ],
  },
]

function gradeFundamentalGroup(group, fundamentals, benchmark, earnings) {
  const metrics = []
  const scores = []
  for (const [key, label, fmt] of group.items) {
    const value = fundamentals[key]
    const { score, badge } = gradeMetric(key, value, benchmark[key])
    if (score !== null) scores.push(score)
    metrics.push({ label, value: fmt(value), badge, benchmark: benchmark[key] })
  }
  // EPS / earnings-quality nudges
  if (group.key === 'growth') {
    const eps = num(fundamentals.eps)
    if (eps !== null) metrics.push({ label: 'EPS (TTM)', value: formatMoney(eps), badge: eps > 0 ? 'pass' : 'fail' })
    if (eps !== null) scores.push(eps > 0 ? 85 : 25)
    if (earnings && num(earnings.recent_beats) !== null && num(earnings.recent_reports)) {
      metrics.push({ label: 'Recent earnings beats', value: `${earnings.recent_beats}/${earnings.recent_reports}` })
    }
  }
  const score = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null
  const badge = score === null ? 'info' : score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail'
  return {
    id: group.id, key: group.key, question: group.question,
    group: 'fundamental', badge, score, metrics,
    rationale: fundamentalRationale(group.key, score, badge),
  }
}

function fundamentalRationale(key, score, badge) {
  if (score === null) return 'Not enough data from the data source to score this group.'
  const label = badge === 'pass' ? 'better than' : badge === 'warn' ? 'in line with' : 'weaker than'
  const map = {
    valuation: `Valuation multiples are ${label} the sector benchmark (lower is better).`,
    profitability: `Margins and returns on capital are ${label} the sector benchmark.`,
    growth: `Top- and bottom-line growth is ${label} the sector benchmark.`,
    health: `Leverage, liquidity and payout are ${label} healthy sector levels.`,
  }
  return map[key] || ''
}

const signalScore = (state) => (state === 'BUY' ? 90 : state === 'SELL' ? 25 : 60)
const signalBadge = (state) => (state === 'BUY' ? 'pass' : state === 'SELL' ? 'fail' : 'warn')

function rangeScore(position) {
  const p = num(position)
  if (p === null) return null
  if (p <= 30) return 90
  if (p <= 50) return 75
  if (p <= 70) return 55
  if (p <= 85) return 40
  return 28
}

function gradeTechnicals(t) {
  const groups = []

  // Trend
  const trendScore = signalScore(t.trend_state)
  groups.push({
    id: 5, key: 'trend', group: 'technical',
    question: 'Is the price trend constructive?',
    badge: signalBadge(t.trend_state), score: trendScore,
    metrics: [
      { label: 'Price', value: num(t.price) === null ? 'n/a' : formatMoney(t.price) },
      { label: '50-day SMA', value: num(t.sma50) === null ? 'n/a' : formatMoney(t.sma50) },
      { label: '200-day SMA', value: num(t.sma200) === null ? 'n/a' : formatMoney(t.sma200) },
      { label: 'vs 50-day', value: fmtPct(t.pct_vs_sma50) },
      { label: 'vs 200-day', value: fmtPct(t.pct_vs_sma200) },
      { label: 'Golden cross', value: t.golden_cross === null || t.golden_cross === undefined ? 'n/a' : (t.golden_cross ? 'Yes (50 > 200)' : 'No (50 < 200)') },
    ],
    rationale: t.trend_state === 'BUY' ? 'Price is above its major moving averages — an uptrend.'
      : t.trend_state === 'SELL' ? 'Price is below its major moving averages — a downtrend.'
      : 'Price is hovering around its moving averages — no clear trend.',
  })

  // Momentum: MACD + RSI
  const momScores = [signalScore(t.macd_state), signalScore(t.rsi_state)]
  const momScore = Math.round((momScores[0] + momScores[1]) / 2)
  groups.push({
    id: 6, key: 'momentum', group: 'technical',
    question: 'Does momentum support an entry?',
    badge: momScore >= 80 ? 'pass' : momScore >= 50 ? 'warn' : 'fail', score: momScore,
    metrics: [
      { label: 'MACD', value: fmtNum(t.macd, 3), badge: signalBadge(t.macd_state) },
      { label: 'Signal line', value: fmtNum(t.macd_signal_line, 3) },
      { label: 'Histogram', value: fmtNum(t.macd_histogram, 3) },
      { label: 'RSI (14)', value: fmtNum(t.rsi14, 1), badge: signalBadge(t.rsi_state) },
    ],
    rationale: `MACD is ${t.macd_state === 'BUY' ? 'bullish (line above signal)' : t.macd_state === 'SELL' ? 'bearish (line below signal)' : 'flat'}; `
      + `RSI ${num(t.rsi14) === null ? 'n/a' : Number(t.rsi14).toFixed(0)} is ${t.rsi_state === 'BUY' ? 'oversold' : t.rsi_state === 'SELL' ? 'overbought' : 'neutral'}.`,
  })

  // Oscillators: Stochastic + Awesome Oscillator
  const oscScores = [signalScore(t.stoch_state), signalScore(t.ao_state)]
  const oscScore = Math.round((oscScores[0] + oscScores[1]) / 2)
  groups.push({
    id: 7, key: 'oscillators', group: 'technical',
    question: 'What do the oscillators say?',
    badge: oscScore >= 80 ? 'pass' : oscScore >= 50 ? 'warn' : 'fail', score: oscScore,
    metrics: [
      { label: 'Stochastic %K', value: fmtNum(t.stoch_k, 1), badge: signalBadge(t.stoch_state) },
      { label: 'Stochastic %D', value: fmtNum(t.stoch_d, 1) },
      { label: 'Awesome Oscillator', value: fmtNum(t.awesome_oscillator, 3), badge: signalBadge(t.ao_state) },
    ],
    rationale: `Slow stochastic is ${t.stoch_state === 'BUY' ? 'oversold' : t.stoch_state === 'SELL' ? 'overbought' : 'mid-range'}; `
      + `the awesome oscillator is ${t.ao_state === 'BUY' ? 'bullish' : t.ao_state === 'SELL' ? 'bearish' : 'flat'}.`,
  })

  // Volume & 52-week range
  const rScore = rangeScore(t.range_position_pct)
  const volScores = [signalScore(t.volume_state)]
  if (rScore !== null) volScores.push(rScore)
  const volScore = Math.round(volScores.reduce((s, v) => s + v, 0) / volScores.length)
  groups.push({
    id: 8, key: 'volume', group: 'technical',
    question: 'Do volume and price location confirm?',
    badge: volScore >= 80 ? 'pass' : volScore >= 50 ? 'warn' : 'fail', score: volScore,
    metrics: [
      { label: 'OBV trend (20d)', value: fmtPct(t.obv_trend_pct), badge: signalBadge(t.volume_state) },
      { label: 'Volume vs 20d avg', value: num(t.volume_vs_avg) === null ? 'n/a' : `${Number(t.volume_vs_avg).toFixed(2)}×` },
      { label: '52-wk range position', value: num(t.range_position_pct) === null ? 'n/a' : `${Number(t.range_position_pct).toFixed(0)}%`, badge: rScore === null ? 'info' : rScore >= 80 ? 'pass' : rScore >= 50 ? 'warn' : 'fail' },
      { label: '52-wk low / high', value: `${num(t.fifty_two_week_low) === null ? 'n/a' : formatMoney(t.fifty_two_week_low)} / ${num(t.fifty_two_week_high) === null ? 'n/a' : formatMoney(t.fifty_two_week_high)}` },
    ],
    rationale: `On-balance volume is ${t.volume_state === 'BUY' ? 'rising (accumulation)' : t.volume_state === 'SELL' ? 'falling (distribution)' : 'flat'}`
      + (num(t.range_position_pct) === null ? '.' : `; price sits at ${Number(t.range_position_pct).toFixed(0)}% of its 52-week range (lower is a better entry).`),
  })

  return groups
}

function compositeOf(criteria) {
  const scored = criteria.filter(c => typeof c.score === 'number')
  return scored.length ? scored.reduce((s, c) => s + c.score, 0) / scored.length : null
}

export function stockVerdict(fundComposite, techComposite) {
  const f = num(fundComposite)
  const t = num(techComposite)
  if (f === null && t === null) {
    return { label: 'Insufficient Data', tone: 'info', combined: null, detail: 'Not enough data to evaluate this ticker.' }
  }
  const w = SCORE_WEIGHTS
  let combined
  if (f === null) combined = t
  else if (t === null) combined = f
  else combined = f * w.fundamental + t * w.technical
  let label, tone
  if (combined >= 75 && (f === null || f >= 70)) { label = 'Strong Buy'; tone = 'pass' }
  else if (combined >= 60) { label = 'Buy'; tone = 'pass' }
  else if (combined >= 45) { label = 'Hold'; tone = 'warn' }
  else { label = 'Avoid'; tone = 'fail' }

  let detail = `Fundamental ${f === null ? 'n/a' : f.toFixed(0)}/100, technical ${t === null ? 'n/a' : t.toFixed(0)}/100 → blended ${combined.toFixed(0)}/100.`
  if (f !== null && t !== null) {
    if (f >= 65 && t < 50) detail += ' Solid business, but the chart/entry timing is weak — consider waiting for a better setup.'
    else if (f < 50 && t >= 65) detail += ' The chart looks strong, but the underlying business scores poorly — momentum without quality.'
    else if (f >= 65 && t >= 65) detail += ' Quality business and a constructive chart line up.'
  }
  return { label, tone, combined, detail }
}

// Compute per-sector medians for the metrics we grade, from a scanned cohort.
export function computeSectorStats(results) {
  const bySector = {}
  for (const m of results || []) {
    const sector = m.sector || 'Unknown'
    if (!bySector[sector]) bySector[sector] = []
    bySector[sector].push(m.fundamentals || {})
  }
  const keys = Object.keys(BASE)
  const stats = {}
  for (const [sector, list] of Object.entries(bySector)) {
    const med = { __count__: list.length }
    for (const k of keys) {
      const vals = list.map(f => num(f[k])).filter(v => v !== null).sort((a, b) => a - b)
      if (vals.length) med[k] = vals[Math.floor(vals.length / 2)]
    }
    stats[sector] = med
  }
  return stats
}

// Resolve the benchmark for a ticker: live sector-cohort median first (only if
// the cohort is big enough to be meaningful), then the built-in sector baseline,
// then the default baseline. Missing keys fall back to the sector baseline.
export function resolveBenchmark(sector, sectorStats, minCohort = 3) {
  const baseline = SECTOR_BASELINES[sector] || SECTOR_BASELINES.Default
  const live = sectorStats && sectorStats[sector]
  const cohortSize = live && live.__count__
  if (!live) return { benchmark: { ...baseline }, source: 'baseline' }
  const merged = { ...baseline }
  let used = 0
  for (const [k, v] of Object.entries(live)) {
    if (k === '__count__') continue
    if (num(v) !== null) { merged[k] = v; used += 1 }
  }
  const enoughCohort = cohortSize === undefined || cohortSize >= minCohort
  return { benchmark: merged, source: enoughCohort && used ? 'cohort' : 'baseline' }
}

export function gradeStock(metrics, opts = {}) {
  const fundamentals = metrics.fundamentals || {}
  const technicals = metrics.technicals || {}
  const earnings = metrics.earnings || {}
  const { benchmark, source } = resolveBenchmark(metrics.sector, opts.sectorStats)

  const fundamentalCriteria = FUND_GROUPS.map(g => gradeFundamentalGroup(g, fundamentals, benchmark, earnings))
  const technicalCriteria = gradeTechnicals(technicals)

  const fundComposite = compositeOf(fundamentalCriteria)
  const techComposite = compositeOf(technicalCriteria)
  const verdict = stockVerdict(fundComposite, techComposite)

  return {
    metrics,
    benchmarkSource: source,
    fundamental: { criteria: fundamentalCriteria, composite: fundComposite },
    technical: { criteria: technicalCriteria, composite: techComposite },
    verdict,
  }
}
import { formatMoney } from './money'
