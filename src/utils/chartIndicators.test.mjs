import test from 'node:test'
import assert from 'node:assert/strict'

import { sma, ema, computeMacd, computeRsi, tradingSessionRangeBreaks } from './chartIndicators.js'

function bars(closes, startDate = '2026-01-05') {
  // Consecutive weekdays so the daily rangebreak path is exercised.
  const out = []
  const d = new Date(`${startDate}T00:00:00Z`)
  for (const close of closes) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
    out.push({ date: d.toISOString().slice(0, 10), close, open: close, high: close, low: close, volume: 1000 })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

test('sma warms up from bar 0 with a partial window', () => {
  const got = sma([2, 4, 6, 8], 3)
  assert.deepEqual(got, [2, 3, 4, 6])   // 2, (2+4)/2, (2+4+6)/3, (4+6+8)/3
})

test('ema seeds with the first value and tracks a constant series', () => {
  assert.deepEqual(ema([5, 5, 5], 3), [5, 5, 5])
  assert.equal(ema([], 3).length, 0)
})

test('ema responds to a step change without overshooting', () => {
  const got = ema([10, 20], 3)
  assert.equal(got[0], 10)
  assert.equal(got[1], 15)             // k = 0.5 for period 3
  assert.ok(got[1] > 10 && got[1] < 20)
})

test('rsi is 100 for an unbroken advance and 0 for an unbroken decline', () => {
  const up = computeRsi(bars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { period: 3 })
  const upVals = up.subTraces[0].y.filter(v => v != null)
  assert.equal(upVals[upVals.length - 1], 100)

  const down = computeRsi(bars([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), { period: 3 })
  const downVals = down.subTraces[0].y.filter(v => v != null)
  assert.equal(downVals[downVals.length - 1], 0)
})

test('rsi stays inside 0..100 and labels its period', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8)
  const res = computeRsi(bars(closes), { period: 14 })
  assert.equal(res.subTitle, 'RSI (14)')
  for (const v of res.subTraces[0].y) {
    if (v != null) assert.ok(v >= 0 && v <= 100, `RSI out of range: ${v}`)
  }
  // 70 / 30 guide lines are present.
  assert.deepEqual(res.subTraces[1].y, [70, 70])
  assert.deepEqual(res.subTraces[2].y, [30, 30])
})

test('rsi handles a series too short to compute', () => {
  const res = computeRsi(bars([100]), { period: 14 })
  assert.deepEqual(res.subTraces, [])
})

test('macd histogram equals the macd line minus the signal line', () => {
  const closes = Array.from({ length: 80 }, (_, i) => 50 + i * 0.7)
  const res = computeMacd(bars(closes))
  const [hist, macdLine, signal] = res.subTraces
  assert.equal(res.subTitle, 'MACD (12,26,9)')
  for (let i = 0; i < hist.y.length; i++) {
    if (hist.y[i] == null) continue
    assert.ok(Math.abs(hist.y[i] - (macdLine.y[i] - signal.y[i])) < 1e-9)
  }
})

test('macd line is positive in an uptrend and negative in a downtrend', () => {
  const up = computeMacd(bars(Array.from({ length: 80 }, (_, i) => 50 + i)))
  const down = computeMacd(bars(Array.from({ length: 80 }, (_, i) => 130 - i)))
  const last = (t) => t.y.filter(v => v != null).slice(-1)[0]
  assert.ok(last(up.subTraces[1]) > 0)
  assert.ok(last(down.subTraces[1]) < 0)
})

test('macd honours custom periods', () => {
  const closes = Array.from({ length: 80 }, (_, i) => 50 + Math.sin(i / 5) * 5)
  assert.equal(computeMacd(bars(closes), { fast: 5, slow: 20, signal: 4 }).subTitle, 'MACD (5,20,4)')
})

test('daily series collapses weekends, weekly series is left alone', () => {
  const daily = bars(Array.from({ length: 30 }, () => 100)).map(b => b.date)
  const breaks = tradingSessionRangeBreaks(daily)
  assert.ok(breaks.some(b => Array.isArray(b.bounds) && b.bounds[0] === 'sat'))

  const weekly = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']
  assert.deepEqual(tradingSessionRangeBreaks(weekly), [])
})

test('missing weekdays become holiday rangebreaks', () => {
  // Skip Thursday 2026-01-08 to simulate an exchange holiday.
  const dates = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-13']
  const breaks = tradingSessionRangeBreaks(dates)
  const holiday = breaks.find(b => Array.isArray(b.values))
  assert.ok(holiday, 'expected a holiday rangebreak')
  assert.ok(holiday.values.includes('2026-01-08'))
})
