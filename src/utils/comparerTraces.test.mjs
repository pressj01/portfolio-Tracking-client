import assert from 'node:assert/strict'
import test from 'node:test'
import {
  comparerStatsForMode,
  computeBlendTrace,
  selectComparerTraces,
  shiftColorForReinvest,
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

test('a partial reinvest % swaps the Total Return line to the blended trace', () => {
  assert.deepEqual(selectComparerTraces(bundle, 'total', 30), [['blend', bundle.blend]])
  assert.deepEqual(selectComparerTraces(bundle, 'both', 30).map(([key]) => key), ['blend', 'price'])
  // 100% is still the canonical full-DRIP total return.
  assert.deepEqual(selectComparerTraces(bundle, 'total', 100), [['total', bundle.drip]])
  // Price-style modes never react to the reinvest %.
  assert.deepEqual(selectComparerTraces(bundle, 'price', 30), [['price', bundle.price]])
  // Without a blend trace (older backend), fall back to the full total return.
  const legacy = { total: [100, 105] }
  assert.deepEqual(selectComparerTraces(legacy, 'total', 30), [['total', legacy.total]])
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

  // Partial reinvest moves the Total Return headline onto the blended trace.
  const partialStats = comparerStatsForMode(series, {}, 'total', 30)
  assert.equal(partialStats.total_ret, 8)
  assert.equal(partialStats.price_ret, -10)
})

test('rebuilds the blend line locally and matches the DRIP/cash extremes', () => {
  // Two dividends of 5% of price, both on a rising price path.
  const price = [100, 110, 110, 121, 121]
  const divRatio = [0, 0.05, 0, 0.05, 0]
  // frac=1 compounds both dividends back into shares (pure DRIP).
  const drip = computeBlendTrace(price, divRatio, 1)
  // frac=0 keeps every dividend as uninvested cash.
  const cash = computeBlendTrace(price, divRatio, 0)
  // A partial reinvest sits strictly between the two at the end.
  const partial = computeBlendTrace(price, divRatio, 0.3)
  assert.ok(drip.at(-1) > partial.at(-1))
  assert.ok(partial.at(-1) > cash.at(-1))
  // Cash path final value = price growth + accumulated cash dividends.
  // divs: 0.05*110 (1 sh) at idx1, then 0.05*121 at idx3 → 5.5 + 6.05 = 11.55.
  assert.equal(Number(cash.at(-1).toFixed(2)), Number((121 + 11.55).toFixed(2)))
  // Missing div-ratio data falls back to null so callers keep the server trace.
  assert.equal(computeBlendTrace(price, [], 0.3), null)
  assert.equal(computeBlendTrace([], divRatio, 0.3), null)
})

test('tints the reinvest line below 100% and leaves full DRIP untouched', () => {
  assert.equal(shiftColorForReinvest('#2f7df6', 100), '#2f7df6')
  const tinted = shiftColorForReinvest('#2f7df6', 30)
  assert.notEqual(tinted, '#2f7df6')
  assert.match(tinted, /^#[0-9a-f]{6}$/)
  // A lower reinvest % lifts further toward white than a higher one.
  const [r30] = hexChannels(tinted)
  const [r70] = hexChannels(shiftColorForReinvest('#2f7df6', 70))
  assert.ok(r30 > r70)
})

function hexChannels(hex) {
  const int = parseInt(hex.slice(1), 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

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
