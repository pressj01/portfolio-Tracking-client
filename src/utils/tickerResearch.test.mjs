import test from 'node:test'
import assert from 'node:assert/strict'

import {
  checklistHref,
  closureCard,
  discountCard,
  distributionCoverageCard,
  navTrendCard,
} from './tickerResearch.js'

test('checklist links fill the matching evaluator with the ticker', () => {
  assert.equal(checklistHref('cef', 'PDI'), '/cef-buying-checklist-evaluator?ticker=PDI')
  assert.equal(checklistHref('stock', 'AAPL'), '/stock-buying-checklist?ticker=AAPL')
})

test('CEF discount treats a negative premium as a discount', () => {
  const card = discountCard({ premium_discount: -6.4 })
  assert.equal(card.tone, 'good')
  assert.match(card.value, /6\.40%/)
  assert.equal(discountCard(null).tone, 'muted')
})

test('NAV trend uses coverage ratio and severity', () => {
  const card = navTrendCard({
    coverage_ratio: 0.81,
    nav_erosion_severity: 'High',
    price_change_pct: -12.4,
    raw_nav_erosion_rate: 0.124,
    distribution_rate_on_starting_nav: 0.20,
    accounting_total_return_rate: 0.076,
    benchmark: 'SPY',
    nav_tested: true,
  })
  assert.equal(card.tone, 'bad')
  assert.equal(card.value, '0.81')
  assert.match(card.detail, /SPY/)
  assert.match(card.detail, /raw e 12\.40%/)
  assert.match(card.detail, /d 20\.00% − r 7\.60%/)
})

test('distribution coverage prefers earnings cover, then NAV-return gap', () => {
  const earnings = distributionCoverageCard({
    earnings_per_share: 1.2,
    distribution_amount: 1.0,
  })
  assert.equal(earnings.value, '1.20x')
  assert.equal(earnings.tone, 'good')

  const gap = distributionCoverageCard({
    distribution_rate_nav: 12,
    return_on_nav_5y: 8,
  })
  assert.equal(gap.value, '+4.00 pp')
  assert.equal(gap.tone, 'bad')
})

test('closure risk maps ETF tiers', () => {
  assert.equal(closureCard({ tier: 'ok', reason: 'Large enough' }).tone, 'good')
  assert.equal(closureCard({ tier: 'high', reason: 'Tiny AUM' }).value, 'High')
})
