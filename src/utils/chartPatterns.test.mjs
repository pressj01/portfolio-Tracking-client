import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ALL_PATTERN_KEYS,
  PATTERN_TYPES,
  findChartPatterns,
  sanitizePatternKeys,
} from './chartPatterns.js'

// Bars that walk a straight line between waypoints [index, price]: each bar opens at
// the previous close, and its high / low sit `wick` beyond the body.
function barsFrom(waypoints, wick = 0.3) {
  const closes = []
  for (let w = 1; w < waypoints.length; w += 1) {
    const [i0, p0] = waypoints[w - 1]
    const [i1, p1] = waypoints[w]
    for (let i = w === 1 ? i0 : i0 + 1; i <= i1; i += 1) closes.push(p0 + (p1 - p0) * (i - i0) / (i1 - i0))
  }
  const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
  return closes.map((c, i) => {
    const open = i ? closes[i - 1] : c
    return { date: day(i), open, close: c, high: Math.max(open, c) + wick, low: Math.min(open, c) - wick }
  })
}

// The same path upside down around `pivot`, for the bearish twin of a bullish shape.
const flip = (waypoints, pivot) => waypoints.map(([i, p]) => [i, pivot - p])

const found = (records, key) => findChartPatterns(records).filter(p => p.key === key)

const HEAD_AND_SHOULDERS = [[0, 100], [20, 120], [30, 110], [42, 130], [54, 110], [64, 120], [80, 100]]

test('finds a head and shoulders top and confirms it on the neckline break', () => {
  const records = barsFrom(HEAD_AND_SHOULDERS)
  const [hs] = found(records, 'hs')
  assert.ok(hs, 'head and shoulders found')
  assert.equal(hs.status, 'confirmed')
  assert.deepEqual(hs.tags.map(t => [t.text, t.index]), [['LS', 20], ['H', 42], ['RS', 64]])
  // The break comes after the right shoulder, once price closes under the 110 neckline.
  assert.ok(hs.endIndex > 64 && records[hs.endIndex].close < 110)
  // Measured move: neckline minus the head's height above it, in log terms.
  assert.ok(hs.target > 85 && hs.target < 100)
  assert.equal(hs.color, PATTERN_TYPES.find(t => t.key === 'hs').color)
})

test('a head and shoulders still waiting for its neckline break is forming', () => {
  const records = barsFrom(HEAD_AND_SHOULDERS.slice(0, 6).concat([[68, 114]]))
  const [hs] = found(records, 'hs')
  assert.ok(hs)
  assert.equal(hs.status, 'forming')
  assert.equal(hs.endIndex, records.length - 1)
  assert.equal(hs.target, null)
})

test('finds an inverse head and shoulders bottom', () => {
  const records = barsFrom(flip(HEAD_AND_SHOULDERS, 240))
  const [ihs] = found(records, 'ihs')
  assert.ok(ihs, 'inverse head and shoulders found')
  assert.equal(ihs.status, 'confirmed')
  assert.deepEqual(ihs.tags.map(t => [t.text, t.side]), [['LS', 'below'], ['H', 'below'], ['RS', 'below']])
  assert.equal(found(records, 'hs').length, 0)
})

test('finds a V bottom: a steep fall and an equally quick recovery', () => {
  const flat = Array.from({ length: 11 }, (_, i) => [i * 2, 100 + (i % 2 ? 0.6 : -0.6)])
  const records = barsFrom([...flat, [28, 70], [36, 97], [50, 98]])
  const [v] = found(records, 'vbottom')
  assert.ok(v, 'V bottom found')
  assert.equal(v.status, 'confirmed')
  assert.equal(v.outline[1].index, 28)
  assert.ok(v.endIndex > 28 && v.endIndex <= 36)
})

test('a slow, flat-bottomed recovery is not a V', () => {
  const flat = Array.from({ length: 11 }, (_, i) => [i * 2, 100 + (i % 2 ? 0.6 : -0.6)])
  const records = barsFrom([...flat, [28, 70], [60, 71], [90, 97]])
  assert.equal(found(records, 'vbottom').length, 0)
})

test('an ascending triangle after a rise is the uptrend kind', () => {
  const records = barsFrom([[0, 80], [20, 100], [26, 90], [32, 100], [38, 94], [44, 100], [50, 96], [54, 100], [60, 108]])
  const tri = found(records, 'asc_up')
  assert.equal(tri.length, 1)
  assert.equal(tri[0].status, 'confirmed')
  assert.equal(found(records, 'asc_down').length, 0)
  const resistance = tri[0].lines.find(l => l.role === 'resistance')
  assert.ok(Math.abs(resistance.pts[0].price - resistance.pts[1].price) < 1e-9, 'flat top')
})

test('an ascending triangle after a fall is the downtrend kind', () => {
  const records = barsFrom([[0, 125], [20, 90], [26, 100], [32, 94], [38, 100], [44, 95.5], [48, 100], [54, 108]])
  const tri = found(records, 'asc_down')
  assert.equal(tri.length, 1)
  assert.equal(tri[0].status, 'confirmed')
  assert.equal(found(records, 'asc_up').length, 0)
})

test('an ascending triangle that breaks down is marked failed', () => {
  const records = barsFrom([[0, 80], [20, 100], [26, 90], [32, 100], [38, 94], [44, 100], [50, 96], [52, 98], [60, 86]])
  const [tri] = found(records, 'asc_up')
  assert.ok(tri)
  assert.equal(tri.status, 'failed')
  assert.equal(tri.target, null)
})

const BULL_FLAG = [[0, 100], [15, 100], [21, 115], [23, 113], [25, 114], [27, 112], [29, 113], [31, 111], [35, 120]]

test('finds a bull flag: a steep pole, a small downward drift, a breakout', () => {
  const records = barsFrom(BULL_FLAG)
  const [flag] = found(records, 'bull_flag')
  assert.ok(flag, 'bull flag found')
  assert.equal(flag.status, 'confirmed')
  const pole = flag.lines.find(l => l.role === 'pole')
  // Bars 21 and 22 share the pole's high; the later one counts as the top.
  assert.ok([21, 22].includes(pole.pts[1].index))
  assert.ok(flag.target > 120, 'measured move adds the pole to the breakout')
})

test('finds a bear flag', () => {
  const records = barsFrom(flip(BULL_FLAG, 230))
  const [flag] = found(records, 'bear_flag')
  assert.ok(flag, 'bear flag found')
  assert.equal(flag.status, 'confirmed')
  assert.equal(found(records, 'bull_flag').length, 0)
})

const BULL_PENNANT = [[0, 100], [15, 100], [21, 115], [23, 110.5], [25, 113.8], [27, 111.3], [29, 112.8], [31, 111.9], [35, 120]]

test('finds a bull pennant: a steep pole, then a narrowing range', () => {
  const records = barsFrom(BULL_PENNANT, 0.2)
  const [pennant] = found(records, 'bull_pennant')
  assert.ok(pennant, 'bull pennant found')
  assert.equal(pennant.status, 'confirmed')
  assert.equal(found(records, 'bull_flag').length, 0)
})

test('finds a bear pennant', () => {
  const records = barsFrom(flip(BULL_PENNANT, 230), 0.2)
  const [pennant] = found(records, 'bear_pennant')
  assert.ok(pennant, 'bear pennant found')
})

test('a steady climb has no reversal or triangle patterns', () => {
  const records = barsFrom([[0, 100], [120, 160]])
  const keys = findChartPatterns(records).map(p => p.key)
  for (const key of ['hs', 'ihs', 'vbottom', 'asc_up', 'asc_down']) assert.ok(!keys.includes(key), key)
})

test('too few bars, or no prices, finds nothing', () => {
  assert.deepEqual(findChartPatterns([]), [])
  assert.deepEqual(findChartPatterns(null), [])
  assert.deepEqual(findChartPatterns(barsFrom([[0, 100], [5, 101]])), [])
})

test('saved pattern choices keep known keys only', () => {
  assert.deepEqual(sanitizePatternKeys(null), ALL_PATTERN_KEYS)
  assert.deepEqual(sanitizePatternKeys(['bull_flag', 'nope', 'hs']), ['hs', 'bull_flag'])
  assert.deepEqual(sanitizePatternKeys([]), [])
})
