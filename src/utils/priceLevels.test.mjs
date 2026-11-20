import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PERCENT_LEVEL_OPTIONS,
  RESISTANCE_COLOR,
  SUPPORT_COLOR,
  approachedFromAbove,
  clusterPivots,
  drawdownFromHigh,
  drawdownLabel,
  findPivots,
  findSupportResistance,
  levelDateLabel,
  levelDistanceLabel,
  levelDistancePct,
  normalizeSrSides,
  percentLevelBase,
  percentLevelColor,
  percentLevelLabel,
  percentLevels,
  sanitizePercentLevelColors,
  sanitizeSrColors,
  spreadLabelPositions,
  srColorLabels,
  srHistoryPeriod,
  srLevelColor,
  srLevelsForSides,
} from './priceLevels.js'

const bar = (close, spread = 1) => ({ open: close, high: close + spread, low: close - spread, close })

test('percent levels are computed from the base price and ordered high to low', () => {
  const levels = percentLevels(100, ['d10', 'u20', 'd50'])
  assert.deepEqual(levels.map(l => l.key), ['u20', 'd10', 'd50'])
  assert.deepEqual(levels.map(l => Number(l.price.toFixed(6))), [120, 90, 50])
})

test('five percent levels sit either side of the base', () => {
  const levels = percentLevels(200, ['d5', 'u5'])
  assert.deepEqual(levels.map(l => l.key), ['u5', 'd5'])
  assert.deepEqual(levels.map(l => Number(l.price.toFixed(6))), [210, 190])
  assert.deepEqual(levels.map(l => percentLevelLabel(l.pct)), ['+5%', '-5%'])
})

test('drawdown measures the last close against the highest close in the period', () => {
  const records = [bar(100), bar(120, 2), bar(110), bar(105)].map((r, i) => ({ ...r, date: `2026-01-0${i + 1}` }))
  const dd = drawdownFromHigh(records)
  assert.equal(dd.high, 120)
  assert.equal(dd.highIndex, 1)
  assert.equal(dd.highDate, '2026-01-02')
  assert.equal(dd.close, 105)
  assert.equal(dd.closeDate, '2026-01-04')
  assert.ok(Math.abs(dd.pct - (105 / 120 - 1) * 100) < 1e-9)
  assert.equal(drawdownLabel(dd.pct), '-12.5% from highest close')
})

test('an intraday spike above the highest close is ignored', () => {
  // Day 2 spikes to 140 intraday but closes at 112; day 3 closes higher at 118.
  const records = [bar(100), { open: 110, high: 140, low: 108, close: 112 }, bar(118), bar(100)]
  const dd = drawdownFromHigh(records)
  assert.equal(dd.high, 118)
  assert.equal(dd.highIndex, 2)
  assert.ok(Math.abs(dd.pct - (100 / 118 - 1) * 100) < 1e-9)
})

test('drawdown at the high reads as at the high, and empty data gives null', () => {
  const records = [bar(100), bar(110, 0), bar(120, 0)]
  const dd = drawdownFromHigh(records)
  assert.equal(dd.pct, 0)
  assert.equal(drawdownLabel(dd.pct), 'At highest close')
  assert.equal(drawdownFromHigh([]), null)
  assert.equal(drawdownFromHigh(null), null)
})

test('percent levels ignore invalid base prices', () => {
  assert.deepEqual(percentLevels(null, ['d10']), [])
  assert.deepEqual(percentLevels(0, ['d10']), [])
})

test('percent level base uses last close or period high', () => {
  const records = [bar(10), bar(30), bar(20)]
  assert.equal(percentLevelBase(records, 'close'), 20)
  assert.equal(percentLevelBase(records, 'high'), 31)
  assert.equal(percentLevelBase([], 'close'), null)
})

test('percent level labels are signed', () => {
  assert.equal(percentLevelLabel(10), '+10%')
  assert.equal(percentLevelLabel(-25), '-25%')
})

test('pivots find swing highs and lows and count flat tops once', () => {
  const closes = [10, 11, 12, 13, 12, 11, 10, 11, 12, 12, 11, 10]
  const pivots = findPivots(closes.map(c => bar(c, 0.5)), 2)
  assert.deepEqual(pivots.map(p => [p.index, p.kind]), [[3, 'high'], [6, 'low'], [8, 'high']])
})

test('clusters merge nearby pivots', () => {
  const clusters = clusterPivots([
    { index: 1, price: 100, kind: 'high' },
    { index: 5, price: 100.5, kind: 'high' },
    { index: 9, price: 110, kind: 'low' },
  ], 1)
  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].touches, 2)
  assert.equal(clusters[0].price, 100.25)
  assert.equal(clusters[0].lastIndex, 5)
})

test('support sits below the last close and resistance above it', () => {
  // Oscillate between ~90 and ~110 several times, then finish at 100.
  const closes = []
  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (let i = 0; i <= 10; i += 1) closes.push(90 + i * 2)
    for (let i = 9; i >= 1; i -= 1) closes.push(90 + i * 2)
  }
  for (let i = 0; i <= 5; i += 1) closes.push(90 + i * 2)
  const { support, resistance, lastClose } = findSupportResistance(closes.map(c => bar(c, 0.5)))
  assert.equal(lastClose, 100)
  assert.ok(support.length >= 1)
  assert.ok(resistance.length >= 1)
  assert.equal(support[0].label, 'S1')
  assert.equal(resistance[0].label, 'R1')
  assert.ok(Math.abs(support[0].price - 89.5) < 1, `support ${support[0].price}`)
  assert.ok(Math.abs(resistance[0].price - 110.5) < 1, `resistance ${resistance[0].price}`)
  assert.ok(support[0].touches >= 3)
  assert.ok(resistance[0].touches >= 3)
  support.forEach(l => assert.ok(l.price <= lastClose))
  resistance.forEach(l => assert.ok(l.price > lastClose))
})

test('support levels are ordered nearest first and capped per side', () => {
  const closes = []
  // Step down through several bases so multiple supports exist.
  ;[150, 140, 130, 120, 110].forEach(level => {
    for (let i = 0; i < 6; i += 1) closes.push(level + (i % 2 ? 3 : 0))
    for (let i = 0; i < 4; i += 1) closes.push(level + 3 - i)
  })
  closes.push(160, 161, 162, 163, 164, 165, 166, 167, 168, 170)
  const { support } = findSupportResistance(closes.map(c => bar(c, 0.3)), { maxPerSide: 2 })
  assert.equal(support.length, 2)
  assert.ok(support[0].price > support[1].price)
  assert.deepEqual(support.map(s => s.label), ['S1', 'S2'])
})

test('too little data yields no levels', () => {
  const result = findSupportResistance([bar(1), bar(2)])
  assert.deepEqual(result.support, [])
  assert.deepEqual(result.resistance, [])
})

test('label positions are spread apart and kept under the max', () => {
  assert.deepEqual(spreadLabelPositions([10, 10.5, 30], 2), [10, 12, 30])
  assert.deepEqual(spreadLabelPositions([30, 10, 10.5], 2), [30, 10, 12])
  assert.deepEqual(spreadLabelPositions([9, 10], 2, 10), [8, 10])
})

test('chosen support / resistance levels are not crowded together', () => {
  const closes = []
  for (let cycle = 0; cycle < 6; cycle += 1) {
    for (let i = 0; i <= 10; i += 1) closes.push(90 + i * 2 + (cycle % 2) * 0.8)
    for (let i = 9; i >= 1; i -= 1) closes.push(90 + i * 2)
  }
  for (let i = 0; i <= 5; i += 1) closes.push(90 + i * 2)
  const { support, resistance, tolerance } = findSupportResistance(closes.map(c => bar(c, 0.5)), { maxPerSide: 5 })
  for (const side of [support, resistance]) {
    for (let i = 1; i < side.length; i += 1) {
      assert.ok(Math.abs(side[i].price - side[i - 1].price) >= tolerance * 2)
    }
  }
})

// Dated bars so history levels can report when they were last touched.
const dated = (closes, spread = 0.5, start = Date.UTC(2025, 0, 1)) => closes.map((c, i) => ({
  ...bar(c, spread),
  date: new Date(start + i * 86400000).toISOString().slice(0, 10),
}))

// Oscillate between `lo` and `hi` a few times.
const swings = (lo, hi, cycles, step = 2) => {
  const out = []
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (let v = lo; v <= hi; v += step) out.push(v)
    for (let v = hi - step; v > lo; v -= step) out.push(v)
  }
  return out
}

test('price breaking to a new period low leaves no support without history', () => {
  // Range 120-140 for the whole period, then a slide to a fresh low at 105.
  const closes = [...swings(120, 140, 4), 120, 116, 112, 108, 105]
  const { support, resistance } = findSupportResistance(dated(closes))
  assert.equal(support.length, 0)
  assert.ok(resistance.length >= 1)
})

test('longer history fills support once the period runs out of it', () => {
  // Older history: a base around 90-100, then the same 120-140 range and slide.
  const older = [...swings(90, 100, 4), ...swings(100, 120, 1)]
  const recent = [...swings(120, 140, 4), 120, 116, 112, 108, 105]
  const history = dated([...older, ...recent])
  const period = history.slice(older.length)
  const { support, resistance } = findSupportResistance(period, { maxPerSide: 2, history })
  assert.ok(support.length >= 1, 'support filled from history')
  support.forEach(l => {
    assert.equal(l.fromHistory, true)
    assert.ok(l.price < 105, `support ${l.price} sits below the close`)
    assert.match(l.lastDate, /^\d{4}-\d{2}-\d{2}$/)
  })
  assert.ok(Math.abs(support[0].price - 100) < 3, `nearest older support ${support[0].price}`)
  // Resistance already had levels in the period, so it stays period-only.
  resistance.forEach(l => assert.equal(l.fromHistory, false))
})

test('history never reaches further from price than the period range', () => {
  const ancient = swings(20, 30, 4) // far below anything recent
  const recent = [...swings(120, 140, 4), 120, 116, 112, 108, 105]
  const history = dated([...ancient, ...recent])
  const period = history.slice(ancient.length)
  const { support } = findSupportResistance(period, { maxPerSide: 3, history })
  support.forEach(l => assert.ok(l.price > 60, `support ${l.price} is out of reach`))
})

test('a level price fell into counts as support being tested, even a hair below it', () => {
  // Floor at ~100 touched several times, rally to 130, then a fall that closes just under the floor.
  const closes = [...swings(100, 130, 4, 3), 127, 121, 115, 109, 104, 99.2]
  const { support, resistance, tolerance } = findSupportResistance(dated(closes, 0.4))
  assert.ok(tolerance > 0.8, `tolerance ${tolerance}`)
  assert.ok(support.length >= 1)
  assert.equal(support[0].testing, true)
  assert.ok(support[0].price > 99.2, 'the floor sits just above the close')
  resistance.forEach(l => assert.ok(Math.abs(l.price - support[0].price) > tolerance))
})

test('approach direction reads the last close clearly away from the level', () => {
  const rows = [110, 108, 101, 100.5, 99.8].map(c => bar(c))
  assert.equal(approachedFromAbove(rows, 100, 1), true)
  assert.equal(approachedFromAbove([90, 95, 99.5, 100.2].map(c => bar(c)), 100, 1), false)
  assert.equal(approachedFromAbove([100, 100.2, 99.9].map(c => bar(c)), 100, 1), null)
})

test('history periods match the loaded period', () => {
  assert.equal(srHistoryPeriod('6mo', '1d'), '2y')
  assert.equal(srHistoryPeriod('1y', '1wk'), '5y')
  assert.equal(srHistoryPeriod('1d', '5m'), '5d')
  assert.equal(srHistoryPeriod('5d', '1m'), null)
  assert.equal(srHistoryPeriod('max', '1mo'), null)
})

test('level dates read as month day, year (or time for intraday)', () => {
  assert.equal(levelDateLabel('2026-02-11'), 'Feb 11, 2026')
  assert.equal(levelDateLabel('2026-11-17 10:30'), 'Nov 17 10:30')
  assert.equal(levelDateLabel(null), '')
})

test('each level carries its percent distance from the last close', () => {
  const closes = []
  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (let i = 0; i <= 10; i += 1) closes.push(90 + i * 2)
    for (let i = 9; i >= 1; i -= 1) closes.push(90 + i * 2)
  }
  for (let i = 0; i <= 5; i += 1) closes.push(90 + i * 2)
  const { support, resistance, lastClose } = findSupportResistance(closes.map(c => bar(c, 0.5)))
  ;[...support, ...resistance].forEach(l => {
    assert.ok(Math.abs(l.pctFromClose - (l.price / lastClose - 1) * 100) < 1e-9)
  })
  assert.ok(support[0].pctFromClose < 0)
  assert.ok(resistance[0].pctFromClose > 0)
})

test('level distance is signed and labeled from the close', () => {
  assert.ok(Math.abs(levelDistancePct(98, 100) + 2) < 1e-9)
  assert.ok(Math.abs(levelDistancePct(110, 100) - 10) < 1e-9)
  assert.equal(levelDistancePct(100, 0), null)
  assert.equal(levelDistancePct(null, 100), null)
  assert.equal(levelDistanceLabel(-1.4567), '-1.46% from close')
  assert.equal(levelDistanceLabel(20.32), '+20.32% from close')
  assert.equal(levelDistanceLabel(0.001), 'At close')
  assert.equal(levelDistanceLabel(null), '')
})

test('S/R colors fall back to the side default and drop bad saved entries', () => {
  assert.equal(srLevelColor('S1', {}), SUPPORT_COLOR)
  assert.equal(srLevelColor('R3', undefined), RESISTANCE_COLOR)
  assert.equal(srLevelColor('S2', { S2: '#ffcc00' }), '#ffcc00')
  assert.equal(srLevelColor('R1', { R1: 'red' }), RESISTANCE_COLOR)
  assert.deepEqual(
    sanitizeSrColors({ S1: '#123abc', R2: '#FFEE58', S9: '#000000', R1: 'blue', x: '#111111' }),
    { S1: '#123abc', R2: '#FFEE58' },
  )
  assert.deepEqual(sanitizeSrColors(null), {})
  assert.deepEqual(sanitizeSrColors(['#123abc']), {})
})

test('color rows run from the highest resistance down to the lowest support', () => {
  assert.deepEqual(srColorLabels(3), ['R3', 'R2', 'R1', 'S1', 'S2', 'S3'])
  assert.deepEqual(srColorLabels(1), ['R1', 'S1'])
  assert.deepEqual(srColorLabels(9), ['R5', 'R4', 'R3', 'R2', 'R1', 'S1', 'S2', 'S3', 'S4', 'S5'])
})

test('percent levels take the user color for a key and keep defaults for the rest', () => {
  const levels = percentLevels(100, ['u10', 'd5'], { u10: '#123456', d5: 'nope' })
  const byKey = Object.fromEntries(levels.map(l => [l.key, l.color]))
  assert.equal(byKey.u10, '#123456')
  assert.equal(byKey.d5, PERCENT_LEVEL_OPTIONS.find(o => o.key === 'd5').color)
  assert.equal(percentLevelColor('d50', {}), PERCENT_LEVEL_OPTIONS.find(o => o.key === 'd50').color)
  assert.deepEqual(
    sanitizePercentLevelColors({ u20: '#abcdef', d99: '#000000', d10: 'red', S1: '#111111' }),
    { u20: '#abcdef' },
  )
})

test('S/R can show only support or only resistance', () => {
  const levels = { support: [{ label: 'S1' }], resistance: [{ label: 'R1' }], lastClose: 100, tolerance: 1 }
  assert.deepEqual(srLevelsForSides(levels, 'both'), levels)
  assert.deepEqual(srLevelsForSides(levels, 'support').resistance, [])
  assert.deepEqual(srLevelsForSides(levels, 'support').support, levels.support)
  assert.deepEqual(srLevelsForSides(levels, 'resistance').support, [])
  assert.deepEqual(srLevelsForSides(levels, 'resistance').resistance, levels.resistance)
  assert.equal(srLevelsForSides(levels, 'resistance').tolerance, 1)
  assert.equal(srLevelsForSides(null, 'support'), null)
  assert.deepEqual(srLevelsForSides(levels, 'bogus'), levels)
  assert.equal(normalizeSrSides('support'), 'support')
  assert.equal(normalizeSrSides(null), 'both')
})

test('color rows only list the side(s) being shown', () => {
  assert.deepEqual(srColorLabels(2, 'support'), ['S1', 'S2'])
  assert.deepEqual(srColorLabels(2, 'resistance'), ['R2', 'R1'])
  assert.deepEqual(srColorLabels(2, 'both'), ['R2', 'R1', 'S1', 'S2'])
})
