import test from 'node:test'
import assert from 'node:assert/strict'

import {
  shortImportDate,
  hasDistributionsSinceImport,
  distributionsSinceImportLine,
  distributionsSinceImportTitle,
} from './distributionsSinceImport.js'

const money = value => `$${value.toFixed(2)}`

test('the import date reads from its digits, so no timezone moves the day', () => {
  assert.equal(shortImportDate('2026-11-05'), '11/5')
  assert.equal(shortImportDate('2026-01-31T23:59:00'), '1/31')
  assert.equal(shortImportDate(null), null)
  assert.equal(shortImportDate('soon'), null)
})

test('nothing to add means no line, so the card keeps its usual note', () => {
  assert.equal(hasDistributionsSinceImport(null), false)
  assert.equal(hasDistributionsSinceImport({ value: 0 }), false)
  assert.equal(distributionsSinceImportLine({ value: 0 }, money), '')
  assert.equal(distributionsSinceImportTitle(undefined, money), '')
})

test('the line names the shared import date and says it is an estimate', () => {
  const line = distributionsSinceImportLine({ value: 1240.5, since: '2026-11-05' }, money)
  assert.equal(line, 'Includes ~$1240.50 paid since the 11/5 import (est.)')
})

test('accounts imported on different days are not given one date', () => {
  const line = distributionsSinceImportLine({ value: 80, since: null }, money)
  assert.equal(line, 'Includes ~$80.00 paid since the last imports (est.)')
})

test('the hover text says what replaces it and what it leaves out', () => {
  const title = distributionsSinceImportTitle({
    value: 155,
    payments: 4,
    since: null,
    accounts: [
      { name: 'Pressj04', value: 130, since: '2026-11-05' },
      { name: 'Pressj05', value: 25, since: '2026-11-06' },
    ],
  }, money)
  assert.match(title, /About \$155\.00 from 4 distributions/)
  assert.match(title, /next positions import replaces this/)
  assert.match(title, /Trades, deposits, withdrawals/)
  assert.match(title, /Pressj04: \$130\.00 since 11\/5; Pressj05: \$25\.00 since 11\/6/)
})

test('a single account does not repeat itself in a per-account list', () => {
  const title = distributionsSinceImportTitle({
    value: 50, payments: 1, accounts: [{ name: 'IRA', value: 50, since: '2026-11-05' }],
  }, money)
  assert.match(title, /1 distribution paid/)
  assert.doesNotMatch(title, /By account/)
})
