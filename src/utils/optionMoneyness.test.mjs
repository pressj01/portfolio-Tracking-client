import assert from 'node:assert/strict'
import test from 'node:test'
import { optionMoneyness, optionMoneynessRange } from './optionMoneyness.js'

test('a 195 call is 12.2% ITM when the underlying is 222.02', () => {
  const result = optionMoneyness({ opt_type: 'CALL', strike: 195 }, 222.02)

  assert.equal(result.status, 'ITM')
  assert.equal(result.relativePosition, 'below')
  assert.ok(Math.abs(result.percentDistance - 12.1700748) < 0.0001)
})

test('call moneyness boundaries put OTM below the strike and ITM above it', () => {
  const result = optionMoneynessRange({ opt_type: 'CALL', strike: 195 }, 10, 10)

  assert.equal(result.low, 175.5)
  assert.ok(Math.abs(result.high - 214.5) < 1e-9)
  assert.equal(result.lower_label, '10% OTM')
  assert.equal(result.upper_label, '10% ITM')
})

test('put moneyness boundaries remain the mirror image of calls', () => {
  const result = optionMoneynessRange({ opt_type: 'PUT', strike: 195 }, 10, 10)

  assert.equal(result.lower_label, '10% ITM')
  assert.equal(result.upper_label, '10% OTM')
})
