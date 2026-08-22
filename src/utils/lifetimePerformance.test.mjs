import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchHoldingsJson,
  holdingLifetimeReturnParts,
  lifetimeGrowth2Payload,
  lifetimeMetricsFromHoldings,
  lifetimeTotalReturnPayload,
} from './lifetimePerformance.js'

const holdings = [
  {
    ticker: 'aaa',
    quantity: 10,
    purchase_value: 100,
    current_value: 90,
    gain_or_loss: -10,
    gain_or_loss_percentage: -0.1,
    total_divs_received: 4,
    purchase_date: '2024-01-15',
    category: 'Anchors',
  },
  {
    ticker: 'BBB',
    quantity: 5,
    purchase_value: 50,
    current_value: 60,
    gain_or_loss: 10,
    gain_or_loss_percentage: 0.2,
    total_divs_received: 1,
    purchase_date: '03/02/25',
    category: 'Boosters',
  },
  {
    ticker: 'ZERO',
    quantity: 0,
    purchase_value: 999,
    current_value: 1,
    gain_or_loss: -998,
  },
]

test('lifetime metrics match Holdings cost-basis sums, not a time-weighted replay', () => {
  const { metrics, performance_rows } = lifetimeMetricsFromHoldings(holdings)

  assert.equal(metrics.start_value, 150)
  assert.equal(metrics.end_value, 150)
  assert.equal(metrics.price_return_dollar, 0)
  assert.equal(metrics.price_return_pct, 0)
  assert.equal(metrics.distribution_dollar, 5)
  assert.equal(metrics.total_return_dollar, 5)
  assert.equal(metrics.total_return_pct, roundish(5 / 150 * 100))
  assert.equal(metrics.actual_start_date, '2024-01-15')
  assert.equal(performance_rows.length, 2)
  assert.equal(performance_rows[0].ticker, 'AAA')
  assert.equal(performance_rows[0].price_return_dollar, -10)
  assert.equal(performance_rows[0].price_return_pct, -10)
  assert.equal(performance_rows[1].actual_start_date, '2025-03-02')
})

test('lifetime Total Return payload is the same object Holdings footers can check', () => {
  const payload = lifetimeTotalReturnPayload(holdings)
  assert.equal(payload.period_key, 'lifetime')
  assert.equal(payload.matches_holdings_gl, true)
  assert.equal(payload.open_position_metrics.price_return_dollar, 0)
  assert.equal(payload.portfolio_metrics.price_return_dollar, payload.open_position_metrics.price_return_dollar)
})

test('lifetime Growth 2 summary uses the same cost-basis dollars', () => {
  const payload = lifetimeGrowth2Payload(holdings)
  assert.equal(payload.summary.price_return_amount, 0)
  assert.equal(payload.summary.total_profit_amount, 5)
})

test('lifetime total return uses the guarded Holdings components and basis', () => {
  const { metrics, performance_rows } = lifetimeMetricsFromHoldings([{
    ticker: 'TRIM',
    quantity: 1,
    purchase_value: 10,
    current_value: 12,
    gain_or_loss: 2,
    gain_or_loss_percentage: null,
    total_divs_received: 100,
    total_return_divs_component: 3,
    total_return_realized_component: 4,
    total_return_basis: 20,
  }])

  assert.equal(metrics.price_return_dollar, 2)
  assert.equal(metrics.price_return_pct, 20)
  assert.equal(metrics.distribution_dollar, 3)
  assert.equal(metrics.realized_return_dollar, 4)
  assert.equal(metrics.total_return_dollar, 9)
  assert.equal(metrics.total_return_pct, 45)
  assert.equal(performance_rows[0].price_return_pct, 20)
  assert.equal(performance_rows[0].total_return_pct, 45)
})

test('lifetime total profit ignores the stale realized_gains column', () => {
  const parts = holdingLifetimeReturnParts({
    ticker: 'TRIM',
    quantity: 1,
    purchase_value: 10,
    current_value: 12,
    gain_or_loss: 2,
    total_divs_received: 100,
    total_return_divs_component: 3,
    total_return_realized_component: 0,
    total_return_basis: 20,
    realized_gains: -25,
  })

  assert.equal(parts.gainLoss, 2)
  assert.equal(parts.distributions, 3)
  assert.equal(parts.realized, 0)
  assert.equal(parts.totalReturnDollar, 5)
  assert.equal(parts.totalReturnRatio, 0.25)
})

test('lifetime Growth 2 applies the ticker scope but keeps every ticker selectable', () => {
  const payload = lifetimeGrowth2Payload(holdings, { selectedTickers: ['BBB'] })

  assert.deepEqual(payload.tickers, ['AAA', 'BBB'])
  assert.equal(payload.summary.start_value, 50)
  assert.equal(payload.summary.end_value, 60)
  assert.equal(payload.summary.price_return_amount, 10)
})

test('lifetime holdings request carries the same category and subcategory scope', async () => {
  let requestedPath = null
  const pf = async path => {
    requestedPath = path
    return { ok: true, json: async () => [] }
  }

  await fetchHoldingsJson(pf, {
    categories: ['10'],
    subcategories: ['21'],
    tickers: ['AAA', 'BBB'],
  })

  assert.equal(
    requestedPath,
    '/api/holdings?category=10&subcategory=21&tickers=AAA%2CBBB',
  )
})

function roundish(value) {
  return Math.round(value * 10000) / 10000
}
