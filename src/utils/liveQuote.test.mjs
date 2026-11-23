import test from 'node:test'
import assert from 'node:assert/strict'

import {
  accumulateLiveBars,
  LIVE_QUOTE_IDLE_MS,
  LIVE_QUOTE_POLL_MS,
  intradayBarStart,
  lastFinite,
  liveQuotePollMs,
  mergeLiveQuote,
  stackAxisTags,
  tagTextColor,
} from './liveQuote.js'

const bar = (date, open, high, low, close, volume = 1000) => ({ date, open, high, low, close, volume })
const quote = (overrides = {}) => ({
  price: 652.26,
  open: 640,
  day_high: 655,
  day_low: 638,
  volume: 35148674,
  session: '2026-11-23',
  time: '2026-11-23 14:07',
  market_state: 'REGULAR',
  ...overrides,
})

test('a daily chart takes the live price into the session bar', () => {
  const records = [bar('2026-11-20', 600, 610, 595, 608), bar('2026-11-23', 640, 650, 639, 645, 20000000)]
  const merged = mergeLiveQuote(records, quote(), '1d')
  assert.deepEqual(merged[1], bar('2026-11-23', 640, 655, 638, 652.26, 35148674))
  assert.equal(merged[0], records[0])
  assert.deepEqual(records[1], bar('2026-11-23', 640, 650, 639, 645, 20000000), 'the loaded bars are not mutated')
})

test('a daily chart left open overnight opens the new session bar', () => {
  const records = [bar('2026-11-20', 600, 610, 595, 608)]
  const merged = mergeLiveQuote(records, quote({ day_high: null, day_low: null }), '1d')
  assert.equal(merged.length, 2)
  assert.deepEqual(merged[1], bar('2026-11-23', 640, 652.26, 640, 652.26, 35148674))
})

test('a quote older than the last bar, or one that changes nothing, keeps the same array', () => {
  const records = [bar('2026-11-23', 640, 655, 638, 652.26, 35148674)]
  assert.equal(mergeLiveQuote(records, quote({ session: '2026-11-20' }), '1d'), records)
  assert.equal(mergeLiveQuote(records, quote(), '1d'), records)
  assert.equal(mergeLiveQuote(records, null, '1d'), records)
  assert.equal(mergeLiveQuote(records, quote({ price: 0 }), '1d'), records)
  assert.equal(mergeLiveQuote([], quote(), '1d').length, 0)
})

test('a weekly bar follows the price while the session is inside its week', () => {
  const records = [bar('2026-11-16', 590, 620, 585, 608, 5), bar('2026-11-23', 609, 650, 607, 645, 9)]
  const merged = mergeLiveQuote(records, quote(), '1wk')
  assert.deepEqual(merged[1], bar('2026-11-23', 609, 655, 607, 652.26, 9))
  assert.equal(mergeLiveQuote(records, quote({ session: '2026-11-30' }), '1wk'), records)
})

test('monthly and quarterly bars follow the price inside their period only', () => {
  const monthly = [bar('2026-11-01', 600, 650, 590, 640, 7)]
  assert.equal(mergeLiveQuote(monthly, quote(), '1mo')[0].close, 652.26)
  assert.equal(mergeLiveQuote(monthly, quote({ session: '2026-12-01' }), '1mo'), monthly)
  const quarterly = [bar('2026-10-01', 600, 650, 590, 640, 7)]
  assert.equal(mergeLiveQuote(quarterly, quote(), '3mo')[0].close, 652.26)
  assert.equal(mergeLiveQuote(quarterly, quote({ session: '2027-01-02' }), '3mo'), quarterly)
})

test('intraday bars update the current bar and append the next one', () => {
  const records = [bar('2026-11-23 13:55', 640, 645, 639, 644, 10), bar('2026-11-23 14:00', 644, 650, 643, 649, 12)]
  const same = mergeLiveQuote(records, quote({ time: '2026-11-23 14:04' }), '5m')
  assert.deepEqual(same[1], bar('2026-11-23 14:00', 644, 652.26, 643, 652.26, 12))
  const next = mergeLiveQuote(records, quote({ time: '2026-11-23 14:07' }), '5m')
  assert.equal(next.length, 3)
  assert.deepEqual(next[2], bar('2026-11-23 14:05', 652.26, 652.26, 652.26, 652.26, 0))
  assert.equal(mergeLiveQuote(records, quote({ time: '2026-11-23 13:50' }), '5m'), records)
})

test('live intraday bars build up poll by poll instead of restarting from the load', () => {
  const loaded = [bar('2026-11-23 13:55', 100, 101, 99, 100, 10), bar('2026-11-23 14:00', 100, 102, 99, 101, 12)]
  let live = null
  live = accumulateLiveBars(live, 1, loaded, quote({ price: 110, time: '2026-11-23 14:06' }), '5m')
  live = accumulateLiveBars(live, 1, loaded, quote({ price: 105, time: '2026-11-23 14:07' }), '5m')
  // The 14:05 bar keeps the 110 it opened and peaked at.
  assert.deepEqual(live.records[2], bar('2026-11-23 14:05', 110, 110, 105, 105, 0))
  live = accumulateLiveBars(live, 1, loaded, quote({ price: 107, time: '2026-11-23 14:11' }), '5m')
  // The next bar opens beside it rather than replacing it.
  assert.deepEqual(live.records.map(r => r.date), ['2026-11-23 13:55', '2026-11-23 14:00', '2026-11-23 14:05', '2026-11-23 14:10'])
  assert.deepEqual(live.records[2], bar('2026-11-23 14:05', 110, 110, 105, 105, 0))
  assert.deepEqual(loaded.length, 2, 'the loaded bars are not mutated')
})

test('a new load drops the bars the polls built, and a no-op quote keeps the same state', () => {
  const loaded = [bar('2026-11-23', 640, 650, 639, 645, 20)]
  const first = accumulateLiveBars(null, 1, loaded, quote({ price: 660, day_high: null, day_low: null, volume: 0 }), '1d')
  assert.equal(first.records[0].high, 660)
  assert.equal(accumulateLiveBars(first, 1, loaded, quote({ price: 660, day_high: null, day_low: null, volume: 0 }), '1d'), first)
  const reloaded = [bar('2026-11-23', 640, 652, 639, 648, 25)]
  const next = accumulateLiveBars(first, 2, reloaded, quote({ price: 649, day_high: null, day_low: null, volume: 0 }), '1d')
  assert.equal(next.loadId, 2)
  assert.deepEqual(next.records[0], bar('2026-11-23', 640, 652, 639, 649, 25))
})

test('intraday bars count from the 09:30 open and stop at the close', () => {
  assert.equal(intradayBarStart('2026-11-23 10:44', 60), '2026-11-23 10:30')
  assert.equal(intradayBarStart('2026-11-23 09:30', 15), '2026-11-23 09:30')
  assert.equal(intradayBarStart('2026-11-23 16:00', 5), '2026-11-23 15:55')
  assert.equal(intradayBarStart('2026-11-23 18:30', 30), '2026-11-23 15:30')
  assert.equal(intradayBarStart('2026-11-23 08:15', 5), null)
  assert.equal(intradayBarStart('', 5), null)
})

test('the poll slows down outside the regular session', () => {
  assert.equal(liveQuotePollMs({ market_state: 'REGULAR' }), LIVE_QUOTE_POLL_MS)
  assert.equal(liveQuotePollMs(null), LIVE_QUOTE_POLL_MS)
  assert.equal(liveQuotePollMs({ market_state: 'POST' }), LIVE_QUOTE_IDLE_MS)
  assert.equal(liveQuotePollMs({ market_state: 'CLOSED' }), LIVE_QUOTE_IDLE_MS)
})

test('moving-average tags keep their side of the price tag and stay a tag apart', () => {
  // Price 100; MAs at 101 and 100.5 crowd the price tag, 90 is clear of it.
  const ys = stackAxisTags(100, [101, 100.5, 90], 2)
  assert.deepEqual(ys, [104, 102, 90])
  // Below the price they stack downward.
  assert.deepEqual(stackAxisTags(100, [99.5, 99], 2), [98, 96])
  // Without a price they only spread apart.
  assert.deepEqual(stackAxisTags(null, [10, 10.5], 2), [10, 12])
  // Non-finite values pass through untouched.
  assert.deepEqual(stackAxisTags(100, [null, 120], 2), [null, 120])
})

test('tag stacks stay inside the pane where they fit', () => {
  // The top of the pane is 105: the upper tag drops to 104 and pushes its neighbour down.
  assert.deepEqual(stackAxisTags(100, [104.5, 104], 2, 0, 105), [104, 102])
  // The bottom is 95: the lowest tag rises to 96.
  assert.deepEqual(stackAxisTags(100, [95.2], 2, 95, 200), [96])
})

test('tag text is black on bright fills and white on dark ones', () => {
  assert.equal(tagTextColor('#FFD700'), '#000000')
  assert.equal(tagTextColor('#26A69A'), '#000000')
  assert.equal(tagTextColor('#1565C0'), '#ffffff')
  assert.equal(tagTextColor('nope'), '#ffffff')
})

test('lastFinite skips the trailing gaps', () => {
  assert.equal(lastFinite([1, 2, null, NaN]), 2)
  assert.equal(lastFinite([]), null)
  assert.equal(lastFinite(undefined), null)
})
