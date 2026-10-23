import test from 'node:test'
import assert from 'node:assert/strict'
import { gradeStock } from './stockGrading.js'
import { DEFAULT_GRADING_PREFERENCES } from './gradingPreferences.js'

const metrics = {
  sector: 'Default',
  fundamentals: { trailing_pe: 20 },
  technicals: {
    price: 102,
    sma50: 100,
    sma200: 100,
    pct_vs_sma50: 2,
    pct_vs_sma200: 2,
    trend_state: 'BUY',
    macd: -1,
    macd_signal_line: 0,
    macd_histogram: -1,
    macd_state: 'SELL',
    rsi14: 50,
    rsi_state: 'NEUTRAL',
    stoch_k: 50,
    stoch_d: 50,
    stoch_state: 'NEUTRAL',
    ao_state: 'NEUTRAL',
    volume_state: 'NEUTRAL',
  },
}

test('default preferences preserve the published 60/40 blend', () => {
  const result = gradeStock(metrics, { settings: DEFAULT_GRADING_PREFERENCES.stock })
  assert.equal(result.verdict.weights.fundamental, 0.6)
  assert.equal(result.verdict.weights.technical, 0.4)
})

// What /api/stock-evaluate sends when the price-history download fails.
const placeholderTechnicals = {
  price: null, sma50: null, sma200: null, pct_vs_sma50: null, pct_vs_sma200: null,
  trend_state: 'NEUTRAL', rsi14: null, rsi_state: 'NEUTRAL',
  macd: null, macd_signal_line: null, macd_histogram: null, macd_state: 'NEUTRAL',
  stoch_k: null, stoch_d: null, stoch_state: 'NEUTRAL',
  awesome_oscillator: null, ao_state: 'NEUTRAL',
  obv_trend_pct: null, volume_state: 'NEUTRAL', range_position_pct: null,
}

test('placeholder technicals are missing data, not a neutral 60', () => {
  const result = gradeStock(
    { sector: 'Default', fundamentals: {}, technicals: placeholderTechnicals },
    { settings: DEFAULT_GRADING_PREFERENCES.stock },
  )
  assert.equal(result.technical.composite, null)
  assert.ok(result.technical.criteria.every(c => c.score === null && c.badge === 'info'))
  assert.equal(result.verdict.label, 'Insufficient Data')
})

test('an unscored technical side leaves the blend to the fundamentals alone', () => {
  const result = gradeStock(
    { sector: 'Default', fundamentals: { trailing_pe: 40, debt_to_equity: 200 }, technicals: placeholderTechnicals },
    { settings: DEFAULT_GRADING_PREFERENCES.stock },
  )
  assert.equal(result.verdict.combined, result.fundamental.composite)
  assert.deepEqual(result.verdict.weights, { fundamental: 1, technical: 0 })
})

test('a group averages only the indicators that were computed', () => {
  const technicals = { ...placeholderTechnicals, rsi14: 25 } // oversold, MACD missing
  const result = gradeStock({ sector: 'Default', technicals }, { settings: DEFAULT_GRADING_PREFERENCES.stock })
  const momentum = result.technical.criteria.find(c => c.key === 'momentum')
  assert.equal(momentum.score, DEFAULT_GRADING_PREFERENCES.stock.signalScores.buy)
})

test('criterion weights steer the technical composite', () => {
  const technicals = { ...metrics.technicals, rsi14: 25 } // trend BUY, momentum mixed
  const trendOnly = structuredClone(DEFAULT_GRADING_PREFERENCES.stock)
  for (const key of ['momentum', 'oscillators', 'volume']) trendOnly.groupWeights[key] = 0
  const result = gradeStock({ ...metrics, technicals }, { settings: trendOnly })
  const trend = result.technical.criteria.find(c => c.key === 'trend')
  assert.equal(result.technical.composite, trend.score)
})

test('custom RSI threshold and blend weights change the live grade', () => {
  const baseline = gradeStock(metrics, { settings: DEFAULT_GRADING_PREFERENCES.stock })
  const custom = structuredClone(DEFAULT_GRADING_PREFERENCES.stock)
  custom.technicalThresholds.rsiBuyBelow = 55
  custom.blendWeights.fundamental = 0
  custom.blendWeights.technical = 100
  const adjusted = gradeStock(metrics, { settings: custom })
  assert.notEqual(adjusted.technical.composite, baseline.technical.composite)
  assert.equal(adjusted.verdict.combined, adjusted.technical.composite)
})
