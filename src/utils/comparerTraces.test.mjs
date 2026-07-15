import assert from 'node:assert/strict'
import test from 'node:test'
import {
  comparerStatsForMode,
  selectComparerTraces,
  shouldUseComparerLogScale,
} from './comparerTraces.js'

const bundle = {
  price: [100, 101],
  pricediv: [100, 102],
  blend: [100, 103],
  drip: [100, 104],
}

test('selects total return from the bundled DRIP trace', () => {
  assert.deepEqual(selectComparerTraces(bundle, 'total'), [['total', bundle.drip]])
})

test('selects only the traces needed by each display mode', () => {
  assert.deepEqual(selectComparerTraces(bundle, 'both').map(([key]) => key), ['total', 'price'])
  assert.deepEqual(selectComparerTraces(bundle, 'all3').map(([key]) => key), ['price', 'blend', 'drip'])
  assert.deepEqual(selectComparerTraces(bundle, 'all4').map(([key]) => key), ['price', 'pricediv', 'blend', 'drip'])
})

test('accepts the legacy total trace while the backend hot reloads', () => {
  const legacy = { total: [100, 105] }
  assert.deepEqual(selectComparerTraces(legacy, 'total'), [['total', legacy.total]])
})

test('derives mode-specific statistics from one trace bundle', () => {
  const series = {
    dates: ['2025-01-01', '2026-01-01'],
    traces: {
      price: [100, 90],
      pricediv: [100, 105],
      blend: [100, 108],
      drip: [100, 110],
    },
  }
  const priceStats = comparerStatsForMode(series, {}, 'price')
  const totalStats = comparerStatsForMode(series, {}, 'total')
  const allStats = comparerStatsForMode(series, {}, 'all4')
  assert.equal(priceStats.total_ret, -10)
  assert.equal(priceStats.div_contrib, 0)
  assert.equal(totalStats.total_ret, 10)
  assert.equal(totalStats.price_ret, -10)
  assert.equal(totalStats.div_contrib, 20)
  assert.equal(allStats.total_ret, 8)
  assert.equal(allStats.div_contrib, 18)
})

test('automatically selects a log scale only for extreme visible wealth ranges', () => {
  const dates = ['1986-01-01', '2000-01-01', '2026-01-01']
  const extreme = {
    MSFT: { dates, traces: { drip: [100, 5000, 700000] } },
    JNJ: { dates, traces: { drip: [100, 1000, 20000] } },
  }
  const ordinary = {
    SPY: { dates, traces: { drip: [100, 130, 250] } },
    QQQ: { dates, traces: { drip: [100, 150, 400] } },
  }

  assert.equal(shouldUseComparerLogScale(extreme, ['MSFT', 'JNJ'], 'total'), true)
  assert.equal(shouldUseComparerLogScale(ordinary, ['SPY', 'QQQ'], 'total'), false)
  assert.equal(
    shouldUseComparerLogScale(extreme, ['MSFT', 'JNJ'], 'total', '2026-01-01', '2026-01-01'),
    false,
  )
})
