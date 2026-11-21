import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ALL_CANDLE_PATTERN_KEYS,
  CANDLE_PATTERN_TYPES,
  blendCandleOdds,
  candleBoxX,
  candlePatternHover,
  findCandlestickPatterns,
  sanitizeCandleMinOdds,
  sanitizeCandlePatternKeys,
  placeCandleLabels,
  summarizeCandlePatterns,
} from './candlestickPatterns.js'

const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
const toRecords = (bars) => bars.map(([open, high, low, close], i) => ({ date: day(i), open, high, low, close }))

// 12 sideways bars around 120, then 8 bars falling (or rising) 1.5 a bar, each opening
// at the last close: the trend a reversal pattern needs in front of it.
function lead(direction = 'down') {
  const bars = []
  let p = 120
  for (let k = 0; k < 12; k += 1) {
    const c = k % 2 === 0 ? p + 1.2 : p - 1.2
    bars.push([p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c])
    p = c
  }
  const step = direction === 'down' ? -1.5 : 1.5
  for (let k = 0; k < 8; k += 1) {
    const c = p + step
    bars.push([p, Math.max(p, c) + 0.3, Math.min(p, c) - 0.3, c])
    p = c
  }
  return bars // last close 108 (down) or 132 (up)
}

// The same bars upside down around `pivot`: a bullish pattern becomes its bearish twin.
const mirror = (bars, pivot = 240) => bars.map(([o, h, l, c]) => [pivot - o, pivot - l, pivot - h, pivot - c])

// Each bullish pattern, drawn after the lead-in; `end` is the bar it completes on.
const LEAD = lead('down').length
const BULLISH = {
  hammer: [[107.6, 108.1, 104.5, 108.0]],
  inv_hammer: [[108.0, 111.6, 107.9, 108.4]],
  bull_engulfing: [[108.0, 108.2, 107.0, 107.3], [107.1, 109.0, 106.9, 108.8]],
  piercing: [[108.0, 108.2, 105.3, 105.5], [105.0, 107.2, 104.8, 107.0]],
  morning_star: [[108.0, 108.2, 105.3, 105.5], [104.9, 105.2, 104.4, 104.7], [105.2, 107.6, 105.0, 107.4]],
  three_soldiers: [[108.0, 109.6, 107.9, 109.5], [109.4, 111.1, 109.3, 111.0], [110.9, 112.6, 110.8, 112.5]],
  tweezer_bottom: [[108.0, 108.2, 106.3, 106.5], [106.5, 108.0, 106.3, 107.8]],
  bull_harami: [[108.0, 108.2, 105.3, 105.5], [105.9, 106.6, 105.7, 106.4]],
}
// Rising three methods continues an uptrend, so it follows the rising lead-in.
const RISING_THREE = [
  [132.0, 134.7, 131.8, 134.5],
  [134.3, 134.5, 133.4, 133.6],
  [133.6, 134.0, 132.9, 133.1],
  [133.1, 133.8, 132.8, 133.5],
  [133.6, 136.2, 133.5, 136.0],
]
const TWIN = {
  hammer: 'shooting_star',
  inv_hammer: 'hanging_man',
  bull_engulfing: 'bear_engulfing',
  piercing: 'dark_cloud',
  morning_star: 'evening_star',
  three_soldiers: 'three_crows',
  tweezer_bottom: 'tweezer_top',
  bull_harami: 'bear_harami',
  rising_three: 'falling_three',
}

const found = (bars, key) => findCandlestickPatterns(toRecords(bars)).filter(f => f.key === key)

test('every pattern type has a twin with the opposite bias, and each type is listed once', () => {
  assert.equal(new Set(ALL_CANDLE_PATTERN_KEYS).size, CANDLE_PATTERN_TYPES.length)
  Object.entries(TWIN).forEach(([bull, bear]) => {
    assert.equal(CANDLE_PATTERN_TYPES.find(t => t.key === bull).bias, 'bullish')
    assert.equal(CANDLE_PATTERN_TYPES.find(t => t.key === bear).bias, 'bearish')
  })
  assert.equal(Object.keys(TWIN).length * 2, CANDLE_PATTERN_TYPES.length)
})

for (const [key, pattern] of Object.entries(BULLISH)) {
  test(`finds a ${key} after a fall, and its bearish twin in the mirrored bars`, () => {
    const bars = [...lead('down'), ...pattern]
    const end = LEAD + pattern.length - 1
    const [f] = found(bars, key)
    assert.ok(f, `${key} found`)
    assert.equal(f.endIndex, end)
    assert.equal(f.startIndex, LEAD)
    assert.equal(f.bias, 'bullish')
    assert.equal(f.top, Math.max(...pattern.map(b => b[1])))
    assert.equal(f.bottom, Math.min(...pattern.map(b => b[2])))

    const [twin] = found(mirror(bars), TWIN[key])
    assert.ok(twin, `${TWIN[key]} found in the mirrored bars`)
    assert.equal(twin.endIndex, end)
    assert.equal(twin.bias, 'bearish')
  })
}

test('finds rising three methods in a rise, and falling three methods in the mirrored fall', () => {
  const bars = [...lead('up'), ...RISING_THREE]
  const [f] = found(bars, 'rising_three')
  assert.ok(f, 'rising three methods found')
  assert.equal(f.startIndex, LEAD)
  assert.equal(f.endIndex, LEAD + 4)
  const [twin] = found(mirror(bars), 'falling_three')
  assert.ok(twin, 'falling three methods found')
  assert.equal(twin.endIndex, LEAD + 4)
})

test('a reversal shape needs the trend in front of it', () => {
  // A hammer shape after a rise is a hanging man, not a hammer.
  const afterRise = [...lead('up'), [131.6, 132.1, 128.5, 132.0]]
  assert.equal(found(afterRise, 'hammer').length, 0)
  assert.equal(found(afterRise, 'hanging_man').length, 1)
  // With no rise or fall before it, neither.
  const sideways = lead('down').slice(0, 12).concat([[119.6, 120.1, 116.5, 120.0]])
  assert.equal(found(sideways, 'hammer').length, 0)
  assert.equal(found(sideways, 'hanging_man').length, 0)
})

test('outcome: played out, did not play out, or not decided yet', () => {
  // A close above the hammer's high next bar: the expected move.
  const worked = found([...lead('down'), ...BULLISH.hammer, [108.0, 109.8, 107.7, 109.5]], 'hammer')[0]
  assert.equal(worked.outcome.result, 'worked')
  assert.equal(worked.outcome.direction, 'up')
  assert.equal(worked.outcome.bars, 1)
  // An inverted hammer followed by a close below its low: tested as the usual result.
  const failed = found([...lead('down'), ...BULLISH.inv_hammer, [108.2, 108.6, 107.95, 108.0], [107.4, 107.6, 106.3, 106.5]], 'inv_hammer')[0]
  assert.equal(failed.outcome.result, 'failed')
  assert.equal(failed.outcome.direction, 'down')
  assert.equal(failed.outcome.bars, 2)
  // Nothing after the pattern yet.
  const pending = found([...lead('down'), ...BULLISH.hammer], 'hammer')[0]
  assert.equal(pending.outcome.result, 'pending')
  assert.equal(pending.outcome.index, null)
})

test('odds start from the published figure and lean toward the chart\'s own record', () => {
  assert.equal(blendCandleOdds(60, 0, 0), 60)
  assert.ok(Math.abs(blendCandleOdds(60, 10, 10) - 73.333) < 0.01)
  assert.ok(Math.abs(blendCandleOdds(60, 0, 10) - 40) < 0.01)
  const pending = found([...lead('down'), ...BULLISH.hammer], 'hammer')[0]
  assert.deepEqual(
    { pct: pending.odds.pct, wins: pending.odds.wins, resolved: pending.odds.resolved, published: pending.odds.published },
    { pct: 60, wins: 0, resolved: 0, published: 60 },
  )
  const worked = found([...lead('down'), ...BULLISH.hammer, [108.0, 109.8, 107.7, 109.5]], 'hammer')[0]
  assert.equal(worked.odds.resolved, 1)
  assert.equal(worked.odds.wins, 1)
  assert.ok(Math.abs(worked.odds.pct - blendCandleOdds(60, 1, 1)) < 1e-9)
})

test('summary counts each type and carries its odds', () => {
  const finds = findCandlestickPatterns(toRecords([...lead('down'), ...BULLISH.hammer, [108.0, 109.8, 107.7, 109.5]]))
  const s = summarizeCandlePatterns(finds)
  assert.equal(s.hammer.count, 1)
  assert.equal(s.hammer.wins, 1)
  assert.equal(s.hammer.resolved, 1)
  assert.ok(s.hammer.oddsPct > 60)
})

test('bars without an open, or with no range at all, find nothing', () => {
  const noOpen = toRecords([...lead('down'), ...BULLISH.hammer]).map(({ open, ...r }) => r)
  assert.deepEqual(findCandlestickPatterns(noOpen), [])
  const flat = Array.from({ length: 30 }, (_, i) => ({ date: day(i), open: 10, high: 10, low: 10, close: 10 }))
  assert.deepEqual(findCandlestickPatterns(flat), [])
  assert.deepEqual(findCandlestickPatterns([]), [])
})

test('four white soldiers in a row is one find, not two', () => {
  const four = [...BULLISH.three_soldiers, [112.4, 114.1, 112.3, 114.0]]
  assert.equal(found([...lead('down'), ...four], 'three_soldiers').length, 1)
})

test('hover text gives the odds, the published result and how this one did', () => {
  const bars = [...lead('down'), ...BULLISH.inv_hammer, [108.2, 108.6, 107.95, 108.0], [107.4, 107.6, 106.3, 106.5]]
  const records = toRecords(bars)
  const f = findCandlestickPatterns(records).find(x => x.key === 'inv_hammer')
  const lines = candlePatternHover(f, records.map(r => r.date))
  assert.match(lines[0], /Inverted Hammer/)
  assert.equal(lines[1], records[f.endIndex].date)
  assert.match(lines[2], /Chance of the expected move: <b>\d+%<\/b>/)
  assert.match(lines[3], /From published tests: 35% \(tested as: bearish continuation 65% of the time\)/)
  assert.match(lines[4], /From this chart: 0 of 1 played out/)
  assert.match(lines[5], /did not play out/)
  assert.match(lines[6], /close above the pattern's high/)
})

test('labels move outward only when they would land on another label', () => {
  const f = (endIndex, bias, price) => ({ endIndex, bias, price })
  const opts = { barCount: 100, arrowPx: 16, labelPx: 15, gapPx: 2 }
  // No price scale: every anchor counts as level, so neighbors on a side stack.
  assert.deepEqual(
    placeCandleLabels([f(10, 'bullish'), f(11, 'bullish'), f(11, 'bearish'), f(12, 'bullish'), f(40, 'bullish')], opts),
    [0, 17, 0, 34, 0],
  )
  // 1 unit per px: anchors 50 px apart don't collide; anchors 10 px apart do, even
  // when the second label's anchor is higher (it moves below the first).
  const scaled = { ...opts, unitsPerPx: 1, axisValue: x => x.price }
  assert.deepEqual(placeCandleLabels([f(10, 'bullish', 100), f(11, 'bullish', 150)], scaled), [0, 0])
  assert.deepEqual(placeCandleLabels([f(10, 'bullish', 100), f(11, 'bullish', 110)], scaled), [0, 34])
  // Other labels on the chart are obstacles too: a bearish code under a label that
  // spans bars 5 to 30 just above its anchor moves out past it; one clear of it doesn't.
  const obstacles = [{ from: 5, to: 30, box: [110, 130] }]
  assert.deepEqual(placeCandleLabels([f(20, 'bearish', 100)], { ...scaled, obstacles }), [17])
  assert.deepEqual(placeCandleLabels([f(40, 'bearish', 100)], { ...scaled, obstacles }), [0])
  // Next to another label's thin arrow (a High label's, say) a code keeps its own spot
  // when only the empty space beside that arrow is in the way.
  const hiLoLike = [{ from: 19.9, to: 20.1, box: [100, 126] }, { from: 10, to: 30, box: [126, 146] }]
  assert.deepEqual(placeCandleLabels([f(25, 'bearish', 90)], { ...scaled, obstacles: hiLoLike }), [0])
  // A code whose arrow would have to cut through a label above it settles for the first
  // clear spot rather than climbing forever.
  assert.deepEqual(placeCandleLabels([f(20, 'bearish', 100)], { ...scaled, obstacles: [{ from: 10, to: 30, box: [120, 140] }] }), [34])
  // Without a usable scale, obstacles can't be placed and are ignored.
  assert.deepEqual(placeCandleLabels([f(20, 'bearish', 100)], { ...opts, obstacles }), [0])
  // A bullish label below a high bar can meet a bearish label above a low bar.
  assert.deepEqual(placeCandleLabels([f(10, 'bearish', 100), f(11, 'bullish', 150)], scaled), [0, 34])
})

test('pattern boxes reach half a bar past each end, skipping hidden weekends', () => {
  const daily = ['2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10']
  // Monday's box starts half a bar after Friday, not in the hidden weekend.
  assert.deepEqual(candleBoxX(daily, 2, 2), { x0: '2026-03-06 12:00', x1: '2026-03-09 12:00' })
  assert.deepEqual(candleBoxX(daily, 0, 1), { x0: '2026-03-04 12:00', x1: '2026-03-06 12:00' })
  const intraday = ['2026-03-09 09:30', '2026-03-09 09:35', '2026-03-09 09:40']
  assert.deepEqual(candleBoxX(intraday, 0, 1), { x0: '2026-03-09 09:27:30', x1: '2026-03-09 09:37:30' })
  const weekly = ['2026-03-02', '2026-03-09', '2026-03-16']
  assert.deepEqual(candleBoxX(weekly, 1, 1), { x0: '2026-03-05 12:00', x1: '2026-03-12 12:00' })
})

test('saved choices: known keys only; nothing saved means none ticked; min odds from the list', () => {
  assert.deepEqual(sanitizeCandlePatternKeys(null), [])
  assert.deepEqual(sanitizeCandlePatternKeys('junk'), [])
  assert.deepEqual(sanitizeCandlePatternKeys([...ALL_CANDLE_PATTERN_KEYS]), ALL_CANDLE_PATTERN_KEYS)
  assert.deepEqual(sanitizeCandlePatternKeys(['hammer', 'nope', 'evening_star']), ['hammer', 'evening_star'])
  assert.deepEqual(sanitizeCandlePatternKeys([]), [])
  assert.equal(sanitizeCandleMinOdds('60'), 60)
  assert.equal(sanitizeCandleMinOdds('65'), 0)
  assert.equal(sanitizeCandleMinOdds(null), 0)
})
