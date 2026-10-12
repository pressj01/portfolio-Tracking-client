import assert from 'node:assert/strict'
import test from 'node:test'
import { signedPercent } from './signedPercent.js'

test('signedPercent rounds to two decimals and always shows the sign', () => {
  assert.equal(signedPercent(27.96650000000001), '+27.97%')
  assert.equal(signedPercent(12.34), '+12.34%')
  assert.equal(signedPercent(-3.1), '-3.10%')
  assert.equal(signedPercent(1234.5), '+1234.50%')
})

test('signedPercent honors the digit count', () => {
  assert.equal(signedPercent(20, 0), '+20%')
  assert.equal(signedPercent(-50, 0), '-50%')
  assert.equal(signedPercent(4.25, 1), '+4.3%')
})

test('signedPercent shows zero, and a loss that rounds to zero, as positive', () => {
  assert.equal(signedPercent(0), '+0.00%')
  assert.equal(signedPercent(-0), '+0.00%')
  assert.equal(signedPercent(-0.004), '+0.00%')
  assert.equal(signedPercent(-0.005), '-0.01%')
  assert.equal(signedPercent(0, 0), '+0%')
})

test('signedPercent accepts numeric strings', () => {
  assert.equal(signedPercent('7.5'), '+7.50%')
})

test('signedPercent does not turn a missing value into a zero return', () => {
  assert.equal(signedPercent(null), '-')
  assert.equal(signedPercent(undefined), '-')
  assert.equal(signedPercent(''), '-')
  assert.equal(signedPercent(NaN), '-')
  assert.equal(signedPercent(Infinity), '-')
  assert.equal(signedPercent('n/a'), '-')
})
