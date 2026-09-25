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
