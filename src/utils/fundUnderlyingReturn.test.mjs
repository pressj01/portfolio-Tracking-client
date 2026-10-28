import assert from 'node:assert/strict'
import test from 'node:test'
import { formatGapPoints, fundUnderlyingReturn } from './fundUnderlyingReturn.js'

function row(underlying, extra = {}) {
  return {
    reference: { selected: 'QQQ' },
    underlying: {
      status: 'available',
      selected: 'SOXX',
      source: 'documented',
      fit: 'Sector / style proxy',
      why: 'Semiconductor-sector context.',
      start: '2025-10-27',
      end: '2026-10-27',
      shorter_history: false,
      ratio_floor: 0.02,
      ...underlying,
    },
    ...extra,
  }
}

test('reads the backend underlying, not the NAV screen reference', () => {
  // CHPY with an Include (manual) QQQ benchmark: the NAV screen uses QQQ, TR/Und must not.
  const result = fundUnderlyingReturn(row({ fund_return: 0.486, underlying_return: 0.686, ratio: 0.486 / 0.686 }),
    { periodLabel: '1Y', requestedStart: '2025-10-27' })

  assert.equal(result.reference, 'SOXX')
  assert.equal(result.ratio, 0.486 / 0.686)
  assert.ok(Math.abs(result.gap - (0.486 - 0.686)) < 1e-12)
  assert.match(result.note, /SOXX \+68\.60%/)
  assert.match(result.note, /1Y/)
  assert.match(result.note, /reinvested/)
  assert.match(result.note, /sector \/ style proxy/)
})

test('a falling or flat underlying gives the gap, not a backwards ratio', () => {
  const result = fundUnderlyingReturn(row({
    selected: 'BIZD', fund_return: 0.005, underlying_return: -0.063, ratio: null,
  }))
  assert.equal(result.ratio, null)
  assert.ok(Math.abs(result.gap - 0.068) < 1e-12)
  assert.match(result.note, /BIZD fell/)
  assert.match(result.note, /\+6\.8 pts/)

  const flat = fundUnderlyingReturn(row({ selected: 'HYG', fund_return: -0.115, underlying_return: 0.013, ratio: null }))
  assert.equal(flat.ratio, null)
  assert.match(flat.note, /HYG rose less than 2%/)
  assert.match(flat.note, /-12\.8 pts/)
})

test('formats the gap in points', () => {
  assert.equal(formatGapPoints(0.068), '+6.8 pts')
  assert.equal(formatGapPoints(-0.2), '-20.0 pts')
  assert.equal(formatGapPoints(null), null)
})

test('a manual benchmark used as a last resort says so', () => {
  const result = fundUnderlyingReturn(row({
    selected: 'XLE', source: 'manual', fit: 'Your Include (manual) benchmark', why: null,
    fund_return: 0.1, underlying_return: 0.2, ratio: 0.5,
  }))
  assert.match(result.note, /XLE is your Include \(manual\) benchmark/)
})

test('a stock, company, or unavailable underlying stays blank with its reason', () => {
  assert.equal(fundUnderlyingReturn(null).ratio, null)
  const company = fundUnderlyingReturn({
    underlying: { status: 'not_applicable', selected: null, legs: [], reason: 'No underlying: this is a company, not a fund that tracks one.' },
  })
  assert.equal(company.ratio, null)
  assert.equal(company.gap, null)
  assert.match(company.note, /company/)

  const crypto = fundUnderlyingReturn(row({ status: 'unavailable', reason: 'Crypto trades around the clock.' }))
  assert.equal(crypto.ratio, null)
  assert.equal(crypto.gap, null)
  assert.match(crypto.note, /Crypto/)
})

test('a fund younger than the selected window is N/A with a rollover note', () => {
  const result = fundUnderlyingReturn(row({
    fund_return: 0.22, underlying_return: 0.30, ratio: 0.22 / 0.30,
    shorter_history: true, start: '2025-03-15', end: '2026-10-27',
  }), { periodLabel: '5Y', requestedStart: '2021-10-27' })

  assert.equal(result.ratio, null)
  assert.equal(result.gap, null)
  assert.equal(result.insufficientHistory, true)
  assert.match(result.note, /N\/A/)
  assert.match(result.note, /5Y/)
  assert.match(result.note, /3\/15\/2025/)
  assert.match(result.note, /10\/27\/2021/)
})

test('Open G/L is N/A because it is not a market window', () => {
  const result = fundUnderlyingReturn(row({ fund_return: 0.12, underlying_return: 0.16, ratio: 0.75 }),
    { lifetimeRange: true })

  assert.equal(result.ratio, null)
  assert.equal(result.lifetimeRange, true)
  assert.match(result.note, /Open G\/L/)
})
