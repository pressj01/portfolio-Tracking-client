import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPARER_SERIES_COLORS,
  comparerEndLabelAxisY,
  comparerLogHoverData,
  comparerReturnModeLabel,
  comparerSeriesColor,
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

test('labels comparer charts for the traces shown by each return mode', () => {
  assert.equal(comparerReturnModeLabel('total'), 'Total Return')
  assert.equal(comparerReturnModeLabel('price'), 'Price Only')
  assert.equal(comparerReturnModeLabel('pricediv'), 'Price + Dividends')
  assert.equal(comparerReturnModeLabel('both'), 'Total Return & Price Only')
  assert.equal(comparerReturnModeLabel('all3'), 'Price Only, Reinvested & Total Return')
  assert.equal(comparerReturnModeLabel('all4'), 'Price Only, Price + Dividends, Reinvested & Total Return')
  assert.equal(comparerReturnModeLabel('unknown'), 'Total Return')
})

test('preformats log-scale hover values to two decimal places', () => {
  assert.deepEqual(
    comparerLogHoverData(
      [1234567.89123, -12.3456],
      [1234667.89123, 87.6544],
    ),
    [
      ['+1,234,567.89%', '1,234,667.89'],
      ['-12.35%', '87.65'],
    ],
  )
})

test('positions end labels in Plotly axis coordinates', () => {
  assert.equal(comparerEndLabelAxisY(77, false), 77)
  assert.equal(comparerEndLabelAxisY(100, true), 2)
  assert.equal(comparerEndLabelAxisY(77, true), Math.log10(77))
  assert.equal(comparerEndLabelAxisY('not-a-number', true), null)
})

// --- series palette --------------------------------------------------------
// The predecessor was seven colors, so an eight-ticker comparison drew two
// lines in the same blue. These guard the properties that fix earns.

const srgb = hex => [0, 2, 4].map(i => parseInt(hex.slice(i + 1, i + 3), 16) / 255)
const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linear = hex => srgb(hex).map(toLinear)

function oklab(hex) {
  const [r, g, b] = linear(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

// Euclidean distance in OKLab x100, the same measure the data-viz validator uses.
function deltaE(a, b) {
  const [l1, a1, b1] = oklab(a)
  const [l2, a2, b2] = oklab(b)
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

function contrast(a, b) {
  const lum = hex => { const [r, g, bl] = linear(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * bl }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('every series color is distinct', () => {
  assert.equal(new Set(COMPARER_SERIES_COLORS).size, COMPARER_SERIES_COLORS.length)
  assert.ok(COMPARER_SERIES_COLORS.length >= 14, 'palette carries at least 14 tickers')
  COMPARER_SERIES_COLORS.forEach(hex => assert.match(hex, /^#[0-9a-f]{6}$/))
})

test('no two series colors collapse together for a full-color reader', () => {
  let worst = [Infinity, '', '']
  for (let a = 0; a < COMPARER_SERIES_COLORS.length; a += 1) {
    for (let b = a + 1; b < COMPARER_SERIES_COLORS.length; b += 1) {
      const d = deltaE(COMPARER_SERIES_COLORS[a], COMPARER_SERIES_COLORS[b])
      if (d < worst[0]) worst = [d, COMPARER_SERIES_COLORS[a], COMPARER_SERIES_COLORS[b]]
    }
  }
  assert.ok(worst[0] >= 15, `worst pair ${worst[1]}/${worst[2]} is only ΔE ${worst[0].toFixed(1)}, floor is 15`)
})

test('series colors read on both the dark and the light chart surface', () => {
  // One palette serves both themes, and the ticker chips sit on white either way.
  COMPARER_SERIES_COLORS.forEach(hex => {
    assert.ok(contrast(hex, '#0e1117') >= 3, `${hex} is ${contrast(hex, '#0e1117').toFixed(2)}:1 on the dark surface`)
    assert.ok(contrast(hex, '#ffffff') >= 3, `${hex} is ${contrast(hex, '#ffffff').toFixed(2)}:1 on white`)
  })
})

test('assigns each ticker index its own slot, then shifts lightness per lap', () => {
  const n = COMPARER_SERIES_COLORS.length
  COMPARER_SERIES_COLORS.forEach((hex, i) => assert.equal(comparerSeriesColor(i), hex))
  // A 15th ticker must not be handed back the 1st ticker's exact color.
  assert.notEqual(comparerSeriesColor(n), comparerSeriesColor(0))
  assert.notEqual(comparerSeriesColor(2 * n), comparerSeriesColor(0))
  assert.notEqual(comparerSeriesColor(2 * n), comparerSeriesColor(n))
  // Odd laps lighten, even laps darken.
  const lum = hex => { const [r, g, b] = linear(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  assert.ok(lum(comparerSeriesColor(n)) > lum(comparerSeriesColor(0)))
  assert.ok(lum(comparerSeriesColor(2 * n)) < lum(comparerSeriesColor(0)))
  // Junk indices fall back to the first slot rather than emitting undefined.
  assert.equal(comparerSeriesColor(-1), COMPARER_SERIES_COLORS[0])
  assert.equal(comparerSeriesColor(NaN), COMPARER_SERIES_COLORS[0])
})
