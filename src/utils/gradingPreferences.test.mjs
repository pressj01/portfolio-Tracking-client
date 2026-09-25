import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_GRADING_PREFERENCES,
  GRADING_PREFERENCES_KEY,
  loadGradingPreferences,
  normalizeGradingPreferences,
  saveGradingPreferences,
} from './gradingPreferences.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

test('partial saved settings merge with every default formula field', () => {
  const normalized = normalizeGradingPreferences({
    stock: { blendWeights: { fundamental: 70 } },
  })
  assert.equal(normalized.stock.blendWeights.fundamental, 70)
  assert.equal(normalized.stock.blendWeights.technical, 40)
  assert.deepEqual(normalized.signals.weights, DEFAULT_GRADING_PREFERENCES.signals.weights)
})

test('formula values are bounded before persistence', () => {
  const storage = memoryStorage()
  const saved = saveGradingPreferences({
    stock: { signalScores: { buy: 150, sell: -10 } },
    signals: { weights: { ao: 99, rsi: -2 } },
  }, storage)
  assert.equal(saved.stock.signalScores.buy, 100)
  assert.equal(saved.stock.signalScores.sell, 0)
  assert.equal(saved.signals.weights.ao, 10)
  assert.equal(saved.signals.weights.rsi, 0)
  assert.ok(storage.getItem(GRADING_PREFERENCES_KEY))
  assert.deepEqual(loadGradingPreferences(storage), saved)
})
