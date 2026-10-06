import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOpenLotMetrics } from './openLotMetrics.js'

test('open lot metrics exclude sells, dividends, and fully closed buys', () => {
  const result = buildOpenLotMetrics([
    { id: 1, transaction_type: 'BUY', shares: 10, shares_remaining: 4, price_per_share: 20, fees: 1, transaction_date: '2024-01-01' },
    { id: 2, transaction_type: 'BUY', shares: 3, shares_remaining: 0, price_per_share: 30, transaction_date: '2024-02-01' },
    { id: 3, transaction_type: 'SELL', shares: 6, shares_remaining: null, price_per_share: 25, transaction_date: '2024-03-01' },
    { id: 4, record_type: 'dividend', transaction_type: 'DIVIDEND', dividend_amount: 2 },
  ], {
    quantity: 4,
    purchase_value: 80.4,
    current_price: 30,
  })

  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].shares, 4)
  assert.equal(result.totals.cost_basis, 80.4)
  assert.equal(result.totals.market_value, 120)
  assert.ok(Math.abs(result.totals.gain_loss - 39.6) < 1e-9)
  assert.ok(Math.abs(result.totals.gain_loss_pct - 49.25373134328358) < 1e-9)
})

test('selected broker basis is allocated across reconciled open lots', () => {
  const result = buildOpenLotMetrics([
    { id: 2, transaction_type: 'BUY', shares: 1, shares_remaining: 1, price_per_share: 60, transaction_date: '2024-02-01' },
    { id: 1, transaction_type: 'BUY', shares: 1, shares_remaining: 1, price_per_share: 40, transaction_date: '2024-01-01' },
  ], {
    quantity: 2,
    purchase_value: 90,
    current_price: 100,
    current_value: 201,
  })

  assert.equal(result.basis_adjusted, true)
  assert.equal(result.shares_match_holding, true)
  assert.deepEqual(result.rows.map(row => row.id), [1, 2])
  assert.ok(Math.abs(result.rows[0].cost_basis - 36) < 1e-9)
  assert.ok(Math.abs(result.rows[1].cost_basis - 54) < 1e-9)
  assert.ok(Math.abs(result.totals.cost_basis - 90) < 1e-9)
  assert.ok(Math.abs(result.totals.market_value - 201) < 1e-9)
  assert.ok(Math.abs(result.totals.gain_loss - 111) < 1e-9)
})

test('an incomplete ledger is not stretched to the holding basis', () => {
  const result = buildOpenLotMetrics([
    { id: 1, transaction_type: 'BUY', shares: 1, shares_remaining: 1, price_per_share: 40 },
  ], {
    quantity: 2,
    purchase_value: 90,
    current_price: 100,
  })

  assert.equal(result.shares_match_holding, false)
  assert.equal(result.basis_adjusted, false)
  assert.equal(result.totals.cost_basis, 40)
  assert.equal(result.totals.shares, 1)
})
