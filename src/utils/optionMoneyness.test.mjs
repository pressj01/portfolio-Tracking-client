import assert from 'node:assert/strict'
import test from 'node:test'
import { moneynessPercentFromPrice, optionMoneyness, optionMoneynessRange } from './optionMoneyness.js'

test('a 195 call is 12.2% ITM when the underlying is 222.02', () => {
  const result = optionMoneyness({ opt_type: 'CALL', strike: 195 }, 222.02)

  assert.equal(result.status, 'ITM')
  assert.equal(result.relativePosition, 'below')
  assert.ok(Math.abs(result.percentDistance - 12.1700748) < 0.0001)
})

test('call moneyness boundaries put OTM below the strike and ITM above it', () => {
  const result = optionMoneynessRange({ opt_type: 'CALL', strike: 195 }, 10, 10)

  assert.ok(Math.abs(result.low - 195 / 1.1) < 1e-9)
  assert.ok(Math.abs(result.high - 195 / 0.9) < 1e-9)
  assert.equal(result.lower_label, '10% OTM')
  assert.equal(result.upper_label, '10% ITM')
})

test('put moneyness boundaries remain the mirror image of calls', () => {
  const result = optionMoneynessRange({ opt_type: 'PUT', strike: 195 }, 10, 10)

  assert.ok(Math.abs(result.low - 195 / 1.1) < 1e-9)
  assert.ok(Math.abs(result.high - 195 / 0.9) < 1e-9)
  assert.equal(result.lower_label, '10% ITM')
  assert.equal(result.upper_label, '10% OTM')
})

test('10% OTM is 10% of the stock at that price, not 10% of a far-away strike', () => {
  const result = optionMoneynessRange({ opt_type: 'CALL', strike: 300 }, 10, 10)

  assert.ok(Math.abs(result.low - 300 / 1.1) < 1e-9)
  assert.ok(Math.abs(result.high - 300 / 0.9) < 1e-9)
  assert.ok(result.low > 266.43)
  assert.equal(result.anchor_strike, 300)
  assert.notEqual(result.low, 300 * 0.9)
})

test('dragging a moneyness handle inverts the same percent-of-price formula', () => {
  const call = { opt_type: 'CALL', strike: 300 }
  const otm = moneynessPercentFromPrice(call, 300 / 1.1)
  const itm = moneynessPercentFromPrice(call, 300 / 0.9)

  assert.equal(otm.edge, 'otm')
  assert.ok(Math.abs(otm.percent - 10) < 1e-9)
  assert.equal(itm.edge, 'itm')
  assert.ok(Math.abs(itm.percent - 10) < 1e-9)
})
