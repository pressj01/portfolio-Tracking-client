import assert from 'node:assert/strict'
import test from 'node:test'
import { dripCheckboxPayload } from './dripSettings.js'

test('Owner checkbox updates the underlying account even when exactly one holds the ticker', () => {
  assert.deepEqual(dripCheckboxPayload(1, false, 1, 'Y'), { reinvest: 'Y', reinvest_all_accounts: true })
  assert.deepEqual(dripCheckboxPayload(1, false, 1, 'N'), { reinvest: 'N', reinvest_all_accounts: true })
  assert.deepEqual(dripCheckboxPayload(1, false, 3, 'Y'), { reinvest: 'Y', reinvest_all_accounts: true })
})

test('standalone and individual account checkbox updates keep their existing scope', () => {
  assert.deepEqual(dripCheckboxPayload(1, false, 0, 'Y'), { reinvest: 'Y' })
  assert.deepEqual(dripCheckboxPayload(2, false, 1, 'N'), { reinvest: 'N' })
  assert.deepEqual(dripCheckboxPayload(1, true, 3, 'Y'), { reinvest: 'Y' })
})
