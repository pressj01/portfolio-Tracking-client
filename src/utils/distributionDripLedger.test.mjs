import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeReinvestment } from './distributionDripLedger.js'

test('reinvested shares are valued at the ticker latest close, not the last payment month', () => {
  const rows = [
    { ticker: 'QTR', month: '2026-01', drip_amount: 100, shares_bought: 10, month_end_price: 10 },
    { ticker: 'QTR', month: '2026-04', drip_amount: 120, shares_bought: 10, month_end_price: 12 },
  ]
  const result = summarizeReinvestment(rows, [{ ticker: 'QTR', latest_close: 15 }])
  assert.deepEqual(result.get('QTR'), { reinvested: 220, shares: 20, value: 300 })
})

test('unavailable latest close leaves the value blank instead of using a stale price', () => {
  const rows = [{ ticker: 'ANNUAL', drip_amount: 100, shares_bought: 10, month_end_price: 10 }]
  assert.equal(summarizeReinvestment(rows, [{ ticker: 'ANNUAL', latest_close: null }]).get('ANNUAL').value, null)
  assert.equal(summarizeReinvestment(rows).get('ANNUAL').value, null)
})
