import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TRANSITION_PRIOR,
  computeMarkov,
  stationary,
  transitionCounts,
  transitionMatrix,
} from './markov.js'

const approximately = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`)
}

test('transition counts keep the Bear / Sideways / Bull index mapping', () => {
  const regimes = [null, 1, 1, 2, 2]
  assert.deepEqual(transitionCounts(regimes), [
    [0, 0, 0],
    [0, 1, 1],
    [0, 0, 1],
  ])
})

test('Jeffreys smoothing stabilizes empty and one-observation rows', () => {
  const matrix = transitionMatrix([null, 1, 1, 2, 2])
  const alpha = TRANSITION_PRIOR

  assert.deepEqual(matrix[0], [1 / 3, 1 / 3, 1 / 3])
  approximately(matrix[1][0], alpha / (2 + 3 * alpha))
  approximately(matrix[1][1], (1 + alpha) / (2 + 3 * alpha))
  approximately(matrix[1][2], (1 + alpha) / (2 + 3 * alpha))
  assert.deepEqual(matrix[2], [0.2, 0.2, 0.6])
  matrix.forEach(row => approximately(row.reduce((sum, value) => sum + value, 0), 1))
})

test('stationary solves a slow absorbing chain instead of stopping at P^50', () => {
  const matrix = [
    [1 / 3, 1 / 3, 1 / 3],
    [0, 0.9946524064171123, 0.0053475935828877],
    [0, 0, 1],
  ]
  const result = stationary(matrix)

  approximately(result[0], 0)
  approximately(result[1], 0)
  approximately(result[2], 1)
})

test('computed result exposes samples and the current lookback log-return', () => {
  const records = [100, 101, 102, 104, 106, 108, 110].map((close, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    close,
  }))
  const result = computeMarkov(records, 5, 5)

  assert.equal(result.ok, true)
  assert.equal(result.currentRegime, 2)
  assert.deepEqual(result.transitionSamples, [0, 0, 1])
  approximately(result.currentLogReturnPct, Math.log(110 / 101) * 100)
})

test('invalid parameters fail closed instead of producing a misleading matrix', () => {
  const records = Array.from({ length: 10 }, (_, i) => ({ close: 100 + i }))

  assert.equal(computeMarkov(records, 0, 5).ok, false)
  assert.equal(computeMarkov(records, 5.5, 5).ok, false)
  assert.equal(computeMarkov(records, 5, 0).ok, false)
  assert.equal(computeMarkov(records, 5, Number.NaN).ok, false)
})
