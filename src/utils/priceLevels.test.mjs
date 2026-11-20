import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clusterPivots,
  findPivots,
  findSupportResistance,
  percentLevelBase,
  percentLevelLabel,
  percentLevels,
  spreadLabelPositions,
} from './priceLevels.js'

const bar = (close, spread = 1) => ({ open: close, high: close + spread, low: close - spread, close })

test('percent levels are computed from the base price and ordered high to low', () => {
  const levels = percentLevels(100, ['d10', 'u20', 'd50'])
  assert.deepEqual(levels.map(l => l.key), ['u20', 'd10', 'd50'])
  assert.deepEqual(levels.map(l => Number(l.price.toFixed(6))), [120, 90, 50])
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
