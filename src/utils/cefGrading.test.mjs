import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_THRESHOLDS,
  findAlternatives,
  gradeFund,
  mergeThresholds,
  selectComparablePeers,
} from './cefGrading.js'

const fund = (ticker, overrides = {}) => ({
  ticker,
  name: `${ticker} Emerging Markets Income`,
  category: 'Morningstar US CEF Emerging Market Income',
  strategy: 'Fixed Income - Taxable-Emerging Market Income',
  is_leveraged: true,
  leverage_ratio: 20,
  expense_ratio: 2.5,
  return_on_nav_5y: 6,
  return_on_nav_3y: 8,
  distribution_rate_nav: 6,
  premium_discount: -5,
  avg_daily_volume: 200000,
  price: 10,
  ...overrides,
})
const criterion = (subject, peers, key, thresholds = DEFAULT_THRESHOLDS) =>
  gradeFund(subject, peers, thresholds).criteria.find(c => c.key === key)

test('TEI peers exclude equity EMF, near-zero leverage, and materially different leverage', () => {
  const tei = fund('TEI', { leverage_ratio: 16.18 })
  const rows = [tei,
    fund('EDD', { leverage_ratio: 14.52 }),
    fund('EDF', { leverage_ratio: 21.27 }),
    fund('MSD', { leverage_ratio: 0.03 }),
    fund('EMD', { leverage_ratio: 27.07 }),
    fund('EMF', { category: 'Morningstar US CEF Emerging Market Equity', strategy: 'Equity-Emerging Market Equity', leverage_ratio: 2.58, expense_ratio: 0.5, return_on_nav_5y: 25 }),
  ]
  assert.deepEqual(selectComparablePeers(tei, rows).map(p => p.ticker), ['EDD', 'EDF'])
  assert.equal(findAlternatives(tei, rows, DEFAULT_THRESHOLDS).some(a => a.fund.ticker === 'EMF'), false)
  assert.equal(criterion(tei, rows, 'expense').score, null)
})

test('strategy and theme filters never broaden a small peer group', () => {
  const subject = fund('UTF', { name: 'Infrastructure Fund', category: 'Sector Equity', strategy: 'Equity-Sector Equity' })
  const peer = fund('INF', { ...subject, ticker: 'INF' })
  const otherSector = { ...subject, ticker: 'TEC', name: 'Technology Fund' }
  const otherAsset = { ...subject, ticker: 'BND', strategy: 'Fixed Income-Infrastructure' }
  assert.deepEqual(selectComparablePeers(subject, [subject, peer, otherSector, otherAsset]), [peer])
  assert.deepEqual(selectComparablePeers({ ...subject, strategy: null }, [peer]), [])
})

test('expense grade uses an actual peer median and reports mean and membership', () => {
  const subject = fund('TEI', { expense_ratio: 2.37 })
  const peers = [subject, fund('A', { expense_ratio: 2 }), fund('B', { expense_ratio: 3 }), fund('C', { expense_ratio: 8 }), fund('D', { expense_ratio: 3 })]
  const expense = criterion(subject, peers, 'expense')
  assert.equal(expense.badge, 'pass')
  assert.equal(expense.comparison.median, 3)
  assert.equal(expense.comparison.mean, 4)
  assert.deepEqual(expense.comparison.tickers, ['A', 'B', 'C', 'D'])
  assert.equal(criterion(subject, peers, 'leverage').badge, 'pass')
  assert.match(expense.rationale, /does not separate borrowing costs/)
})

test('expense grades respect exact median-multiple boundaries and custom thresholds', () => {
  const peers = ['A', 'B', 'C'].map(t => fund(t, { expense_ratio: 2 }))
  for (const [expense_ratio, expected] of [[2, 'pass'], [2.001, 'warn'], [2.5, 'warn'], [2.501, 'fail']]) {
    assert.equal(criterion(fund('TEI', { expense_ratio }), peers, 'expense').badge, expected)
  }
  const custom = { ...DEFAULT_THRESHOLDS, expense: { passMultiple: 1.1, warnMultiple: 1.5 } }
  assert.equal(criterion(fund('TEI', { expense_ratio: 2.1 }), peers, 'expense', custom).badge, 'pass')
  assert.equal(criterion(fund('TEI', { expense_ratio: 2.9 }), peers, 'expense', custom).badge, 'warn')
})

test('missing data, duplicate tickers and the selected fund do not fabricate benchmarks', () => {
  const subject = fund('TEI')
  const peers = [subject, { ...subject, ticker: 'tei' }, fund('A'), fund('a'), fund('B', { expense_ratio: null }), fund('C', { expense_ratio: ' ' }), fund('D', { expense_ratio: 0 })]
  const expense = criterion(subject, peers, 'expense')
  assert.equal(expense.comparison.count, 1)
  assert.equal(expense.score, null)
  assert.equal(expense.badge, 'info')
  const result = gradeFund(subject, peers, DEFAULT_THRESHOLDS)
  const scores = result.criteria.filter(c => c.score !== null).map(c => c.score)
  assert.equal(result.composite, scores.reduce((a, b) => a + b, 0) / scores.length)
})

test('unknown leverage is not treated as no leverage or compared with known peers', () => {
  const unknown = fund('UNK', { leverage_ratio: null, is_leveraged: null })
  assert.equal(criterion(unknown, [], 'leverage').score, null)
  assert.deepEqual(selectComparablePeers(unknown, [fund('A')]), [])
  const unleveraged = fund('ZERO', { leverage_ratio: null, is_leveraged: false })
  assert.equal(criterion(unleveraged, [], 'leverage').badge, 'pass')
  assert.deepEqual(selectComparablePeers(unleveraged, [fund('A', { leverage_ratio: 0 }), fund('B', { leverage_ratio: 1 }), unknown]).map(p => p.ticker), ['A'])
})

test('track record excludes self, uses the true even-sample median and matches return periods', () => {
  const subject = fund('TEI', { return_on_nav_5y: 6 })
  const peers = [subject, ...[1, 3, 7, 9].map((r, i) => fund(`P${i}`, { return_on_nav_5y: r }))]
  const manager = criterion(subject, peers, 'manager')
  assert.equal(manager.comparison.median, 5)
  assert.equal(manager.badge, 'pass')
  assert.equal(criterion(subject, [subject], 'manager').score, null)
  const noFiveYear = ['A', 'B', 'C'].map(t => fund(t, { return_on_nav_5y: null, return_on_nav_3y: 99 }))
  assert.equal(criterion(subject, noFiveYear, 'manager').score, null)
  const threeYearSubject = { ...subject, return_on_nav_5y: null }
  assert.equal(criterion(threeYearSubject, noFiveYear, 'manager').comparison.median, 99)
})

test('ordinary threshold warning bands cannot produce a pass badge', () => {
  assert.equal(criterion(fund('A', { leverage_ratio: 30.01 }), [], 'leverage').badge, 'warn')
  assert.equal(criterion(fund('A', { leverage_ratio: 35 }), [], 'leverage').badge, 'warn')
  assert.equal(criterion(fund('A', { leverage_ratio: 35.01 }), [], 'leverage').badge, 'fail')
  assert.equal(criterion(fund('A', { premium_discount: 0.01 }), [], 'discount').badge, 'warn')
  assert.equal(criterion(fund('A', { avg_daily_volume: 99999 }), [], 'liquidity').badge, 'warn')
})

test('sustainability does not grade earnings divided by an unmatched distribution period', () => {
  const subject = fund('TEI', { earnings_per_share: 0.37, distribution_amount: 0.054 })
  const withEarnings = criterion(subject, [], 'sustainability')
  const withoutEarnings = criterion({ ...subject, earnings_per_share: null }, [], 'sustainability')
  assert.equal(withEarnings.score, withoutEarnings.score)
  assert.match(withEarnings.rationale, /reporting periods are not matched/)
  assert.equal(criterion(fund('A', { return_on_nav_5y: null, return_on_nav_3y: null, unii_per_share: 1 }), [], 'sustainability').score, null)
})

test('old expense percentages are reset while other user settings are retained', () => {
  const old = { leverage: { passPct: 25, warnPct: 32 }, expense: { passPct: 1.1, warnPct: 1.6 } }
  const migrated = mergeThresholds(old)
  assert.deepEqual(migrated.leverage, old.leverage)
  assert.deepEqual(migrated.expense, DEFAULT_THRESHOLDS.expense)
  assert.deepEqual(mergeThresholds({ expense: { passMultiple: 1.1, warnMultiple: 1.4 } }).expense, { passMultiple: 1.1, warnMultiple: 1.4 })
})

test('alternatives use the same scored criteria and do not claim lower leverage as an improvement', () => {
  const subject = fund('TEI', { distribution_rate_nav: 15, premium_discount: 10, avg_daily_volume: 1000 })
  const good = fund('GOOD', { leverage_ratio: 18 })
  const missing = fund('MISS', { price: null })
  const alternatives = findAlternatives(subject, [subject, good, missing], DEFAULT_THRESHOLDS)
  assert.deepEqual(alternatives.map(a => a.fund.ticker), ['GOOD'])
  assert.equal(alternatives[0].composite, gradeFund(good, [subject, good, missing], DEFAULT_THRESHOLDS).composite)
  assert.equal(alternatives[0].reasons.some(reason => /Lower leverage|expense/i.test(reason)), false)
})

test('a mixed scan batch cannot contaminate CEF expense or return benchmarks', () => {
  const subject = fund('TEI')
  const bonds = ['A', 'B', 'C'].map(t => fund(t))
  const equities = ['X', 'Y', 'Z'].map(t => fund(t, { category: 'Equity', strategy: 'Equity', expense_ratio: 0.1, return_on_nav_5y: 50 }))
  assert.deepEqual(gradeFund(subject, [...bonds, ...equities], DEFAULT_THRESHOLDS), gradeFund(subject, bonds, DEFAULT_THRESHOLDS))
})
