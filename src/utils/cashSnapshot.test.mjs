import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cashAgeDays,
  cashOriginLabel,
  cashRowStamp,
  cashRowTitle,
  cashDriftLine,
  cashDriftTitle,
} from './cashSnapshot.js'

const NOW = new Date('2026-08-29T18:00:00').getTime()

test('age is whole days, so only today reads as today', () => {
  assert.equal(cashAgeDays('2026-08-29T09:00:00', NOW), 0)
  assert.equal(cashAgeDays('2026-08-28T09:00:00', NOW), 1)
  assert.equal(cashAgeDays('2026-08-26T11:55:07', NOW), 3)
})

test('a missing or unparseable stamp has no age to report', () => {
  assert.equal(cashAgeDays(null, NOW), null)
  assert.equal(cashAgeDays('', NOW), null)
  assert.equal(cashAgeDays('not a date', NOW), null)
})

test('a future stamp never reports negative days', () => {
  assert.equal(cashAgeDays('2026-09-02T09:00:00', NOW), 0)
})

test('origin distinguishes a typed figure from an imported one', () => {
  assert.equal(cashOriginLabel('manual'), 'entered by hand')
  assert.equal(cashOriginLabel('schwab'), 'as imported')
  assert.equal(cashOriginLabel(null), 'as imported')
})

test('the row stamp dates the figure', () => {
  // The real case: pressj04 imported 8/26, read on 8/29.
  const stamp = cashRowStamp(
    { cash_value: 984.58, cash_source: 'schwab', cash_updated_at: '2026-08-26T11:55:07' },
    NOW,
  )
  assert.match(stamp, /as imported/)
  assert.match(stamp, /3 days ago/)
})

test('a same-day figure says today rather than 0 days ago', () => {
  const stamp = cashRowStamp(
    { cash_value: 1343.98, cash_source: 'manual', cash_updated_at: '2026-08-29T09:00:00' },
    NOW,
  )
  assert.equal(stamp, 'entered by hand today')
})

test('one day ago is singular', () => {
  const stamp = cashRowStamp(
    { cash_value: 100, cash_source: 'schwab', cash_updated_at: '2026-08-28T09:00:00' },
    NOW,
  )
  assert.match(stamp, /1 day ago/)
  assert.doesNotMatch(stamp, /1 days ago/)
})

test('cash on record with no stamp is called undated, not fresh', () => {
  const stamp = cashRowStamp(
    { cash_value: 500, cash_source: 'schwab', cash_updated_at: null }, NOW,
  )
  assert.equal(stamp, 'date unknown')
})

test('an account with no cash and no stamp says nothing at all', () => {
  assert.equal(cashRowStamp({ cash_value: 0, cash_updated_at: null }, NOW), '')
})

test('the hover text says the import wins', () => {
  const title = cashRowTitle({ cash_source: 'manual' })
  assert.match(title, /next broker import overwrites/)
})

// --- drift: a floor built from the payment ledger, never the balance ---

test('drift reads as a floor, not a balance', () => {
  const line = cashDriftLine({ amount: 113.75, payments: 3 }, 984.58)
  assert.match(line, /at least/)
  assert.doesNotMatch(line, /^\+.*is /)
})

test('drift adds onto the written balance', () => {
  const line = cashDriftLine({ amount: 113.75, payments: 3 }, 984.58,
    v => `$${v.toFixed(2)}`)
  assert.match(line, /\+\$113\.75 paid since/)
  assert.match(line, /at least \$1098\.33/)
})

test('no drift means no line at all', () => {
  assert.equal(cashDriftLine(null, 984.58), '')
  assert.equal(cashDriftLine({ amount: 0, payments: 0 }, 984.58), '')
  assert.equal(cashDriftLine(undefined, 0), '')
})

test('the drift tooltip names what it cannot see', () => {
  const title = cashDriftTitle({ amount: 113.75, payments: 3 })
  assert.match(title, /3 distributions/)
  assert.match(title, /Reinvested distributions are excluded/)
  assert.match(title, /Trades, option premium, fees and interest are not counted/)
})

test('a single distribution is described in the singular', () => {
  assert.match(cashDriftTitle({ amount: 40, payments: 1 }), /1 distribution settled/)
})
