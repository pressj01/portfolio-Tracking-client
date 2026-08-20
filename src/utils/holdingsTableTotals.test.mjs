import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accountPercent,
  computeHoldingsTableTotals,
  sharesIfReinvested,
} from './holdingsTableTotals.js'

const rows = [
  {
    ticker: 'AAA',
    quantity: 10,
    percent_of_account: 0.6,
    base_quantity: 8,
    shares_bought_from_dividend: 2,
    total_cash_reinvested: 20,
    purchase_value: 100,
    current_value: 130,
    gain_or_loss: 8,
    gain_or_loss_percentage: 0.10,
    lifetime_gain_or_loss: 30,
    estim_payment_per_year: 12,
    approx_monthly_income: 1,
    dividend_paid: 1.5,
    ytd_divs: 4,
    total_divs_received: 10,
    realized_gains: 5,
    reinvest: 'Y',
    current_price: 13,
    price_return_dollar: 8,
    price_return_pct: 10,
    tracker_start_value: 80,
  },
  {
    ticker: 'BBB',
    quantity: 5,
    percent_of_account: 0.4,
    base_quantity: 5,
    shares_bought_from_dividend: 0,
    total_cash_reinvested: 0,
    purchase_value: 50,
    current_value: 40,
    gain_or_loss: -2,
    gain_or_loss_percentage: -0.05,
    lifetime_gain_or_loss: -10,
    estim_payment_per_year: 3,
    approx_monthly_income: 0.25,
    dividend_paid: 0.4,
    ytd_divs: 1,
    total_divs_received: 5,
    realized_gains: 0,
    reinvest: 'N',
    current_price: 8,
    price_return_dollar: -2,
    price_return_pct: -5,
    tracker_start_value: 40,
  },
]

test('share and dollar columns sum; percents are recomputed from the totals', () => {
  const totals = computeHoldingsTableTotals(rows, { accountValue: 170 })

  assert.equal(totals.quantity, 15)
  assert.equal(totals.base_quantity, 13)
  assert.equal(totals.shares_bought_from_dividend, 2)
  assert.equal(totals.total_cash_reinvested, 20)
  assert.equal(totals.purchase_value, 150)
  assert.equal(totals.current_value, 170)
  assert.equal(totals.gain_or_loss, 6)
  assert.equal(totals.gain_or_loss_percentage, 0.05)
  assert.equal(totals.lifetime_gain_or_loss, 20)
  assert.equal(totals.lifetime_gain_or_loss_percentage, 20 / 150)
  assert.equal(totals.estim_payment_per_year, 15)
  assert.equal(totals.approx_monthly_income, 1.25)
  assert.equal(totals.dividend_paid, 1.9)
  assert.equal(totals.ytd_divs, 5)
  assert.equal(totals.total_divs_received, 15)
  assert.equal(totals.realized_gains, 5)
  assert.equal(totals.percent_of_account, 1)
  assert.equal(totals.annual_yield_on_cost, 15 / 150)
  assert.equal(totals.current_annual_yield, 15 / 170)
  assert.equal(totals.paid_for_itself, 15 / 150)
  assert.equal(totals._shares_if_reinvested, 12 / 13)
})

test('unfiltered price return uses open-position metrics, not a sum of percents', () => {
  const totals = computeHoldingsTableTotals(rows, {
    matchOpenPositionTotals: true,
    openPositionMetrics: { price_return_dollar: 6.5, price_return_pct: 7.25 },
  })

  assert.equal(totals.price_return_dollar, 6.5)
  assert.equal(totals.price_return_pct, 7.25)
  assert.equal(totals.gain_or_loss, 6.5)
  assert.equal(totals.gain_or_loss_percentage, 0.0725)
  assert.equal(totals.lifetime_gain_or_loss, 20)
})

test('unfiltered price return stays blank until open-position metrics arrive', () => {
  const totals = computeHoldingsTableTotals(rows, { matchOpenPositionTotals: true })
  assert.equal(totals.price_return_dollar, null)
  assert.equal(totals.price_return_pct, null)
})

test('filtered price return sums dollars and weights the percent by start value', () => {
  const totals = computeHoldingsTableTotals(rows, { matchOpenPositionTotals: false })

  assert.equal(totals.price_return_dollar, 6)
  assert.equal(totals.price_return_pct, 5)
  assert.equal(totals.gain_or_loss, 6)
  assert.equal(totals.gain_or_loss_percentage, 0.05)
})

test('sharesIfReinvested is annual income divided by current price for DRIP rows only', () => {
  assert.equal(sharesIfReinvested({ reinvest: 'Y', estim_payment_per_year: 12, current_price: 4 }), 3)
  assert.equal(sharesIfReinvested({ reinvest: 'N', estim_payment_per_year: 12, current_price: 4 }), 0)
  assert.equal(sharesIfReinvested({ reinvest: 'Y', estim_payment_per_year: 12, current_price: 0 }), 0)
})

test('accountPercent falls back to current value over the full account', () => {
  assert.equal(accountPercent({ percent_of_account: 0.2, current_value: 50 }, 100), 0.2)
  assert.equal(accountPercent({ current_value: 25 }, 100), 0.25)
  assert.equal(accountPercent({ current_value: 25 }, 0), 0)
})
