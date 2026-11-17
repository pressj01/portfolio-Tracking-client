import test from 'node:test'
import assert from 'node:assert/strict'
import {
  YIELD_TOLERANCE,
  balanceToTargetYield,
  holdingsOverCap,
  monthlyToYieldPct,
  portfolioYield,
  yieldPctToMonthly,
  yieldRange,
  yieldTargetStatus,
} from './targetYield.js'

const close = (actual, expected, tolerance = 1e-6) => assert.ok(
  Math.abs(actual - expected) < tolerance,
  `expected ${expected}, got ${actual}`,
)

const MIX = [
  { ticker: 'SPY', dollar_amount: 50000, yieldPct: 1.2 },
  { ticker: 'SCHD', dollar_amount: 30000, yieldPct: 3.5 },
  { ticker: 'JEPI', dollar_amount: 20000, yieldPct: 7.5 },
]
const withYields = (result, source) => result.holdings.map((h, i) => ({ ...h, yieldPct: source[i].yieldPct }))
const amounts = result => Object.fromEntries(result.holdings.map(h => [h.ticker, h.dollar_amount]))

test('portfolio yield is the dollar-weighted yield', () => {
  close(portfolioYield(MIX), (50000 * 1.2 + 30000 * 3.5 + 20000 * 7.5) / 100000)
  assert.equal(portfolioYield([]), null)
  assert.equal(portfolioYield([{ ticker: 'X', dollar_amount: 0, yieldPct: 5 }]), null)
})

test('a missing yield counts as zero income, as the Builder grades it', () => {
  close(portfolioYield([
    { ticker: 'A', dollar_amount: 100, yieldPct: 10 },
    { ticker: 'B', dollar_amount: 100, yieldPct: null },
  ]), 5)
})

test('status reports the gap and the income still missing', () => {
  const status = yieldTargetStatus(MIX, 5)
  assert.equal(status.status, 'short')
  close(status.yieldPct, 3.15)
  close(status.gapPct, -1.85)
  close(status.incomeShort, 1850)
})

test('a yield at or above the target is met, and a rounding hair below still is', () => {
  assert.equal(yieldTargetStatus(MIX, 3).status, 'met')
  assert.equal(yieldTargetStatus(MIX, 3.15 + YIELD_TOLERANCE / 2).status, 'met')
  assert.equal(yieldTargetStatus(MIX, 3.15 + YIELD_TOLERANCE * 3).status, 'short')
})

test('no target, or nothing invested, has no status', () => {
  for (const target of [null, '', 0, -2, 'abc']) {
    assert.equal(yieldTargetStatus(MIX, target).status, 'none', String(target))
  }
  assert.equal(yieldTargetStatus([], 5).status, 'none')
})

test('balancing hits the target and keeps the total invested', () => {
  const result = balanceToTargetYield(MIX, 5)
  assert.equal(result.ok, true)
  close(portfolioYield(withYields(result, MIX)), 5, YIELD_TOLERANCE)
  close(result.yieldPct, 5, YIELD_TOLERANCE)
  close(result.holdings.reduce((s, h) => s + h.dollar_amount, 0), 100000, 1e-9)
  close(result.total, 100000)
})

test('balancing moves dollars from low yielders to high yielders and keeps every holding', () => {
  const after = amounts(balanceToTargetYield(MIX, 5))
  assert.ok(after.SPY < 50000)
  assert.ok(after.JEPI > 20000)
  assert.ok(Object.values(after).every(a => a >= 0.01))
})

test('amounts come back in whole cents', () => {
  const result = balanceToTargetYield(MIX, 4.37)
  for (const h of result.holdings) close(h.dollar_amount * 100, Math.round(h.dollar_amount * 100), 1e-6)
})

test('moved counts each traded dollar once', () => {
  const result = balanceToTargetYield(MIX, 5)
  const bought = result.changes.reduce((s, c) => s + Math.max(c.to - c.from, 0), 0)
  const sold = result.changes.reduce((s, c) => s + Math.max(c.from - c.to, 0), 0)
  close(bought, sold, 0.011)
  close(result.moved, bought, 0.011)
})

test('holdings with the same yield keep their proportions to each other', () => {
  const mix = [
    { ticker: 'A', dollar_amount: 6000, yieldPct: 2 },
    { ticker: 'B', dollar_amount: 3000, yieldPct: 2 },
    { ticker: 'C', dollar_amount: 1000, yieldPct: 10 },
  ]
  const after = amounts(balanceToTargetYield(mix, 6))
  close(after.A / after.B, 2, 1e-3)
  close(after.A + after.B + after.C, 10000, 1e-9)
})

test('a target the portfolio already yields changes nothing', () => {
  const result = balanceToTargetYield(MIX, portfolioYield(MIX))
  assert.equal(result.ok, true)
  close(result.moved, 0, 0.011)
})

test('balancing also works downward', () => {
  const result = balanceToTargetYield(MIX, 2)
  assert.equal(result.ok, true)
  close(result.yieldPct, 2, YIELD_TOLERANCE)
  assert.ok(amounts(result).SPY > 50000)
})

test('a target above the best yielder is unreachable and names it', () => {
  const result = balanceToTargetYield(MIX, 9)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'above_max')
  assert.equal(result.maxTicker, 'JEPI')
  close(result.maxYieldPct, 7.5)
  assert.equal(balanceToTargetYield(MIX, 7.5).reason, 'above_max')
})

test('a target below the lowest yielder is unreachable', () => {
  const result = balanceToTargetYield(MIX, 0.5)
  assert.equal(result.reason, 'below_min')
  assert.equal(result.minTicker, 'SPY')
})

test('one holding, or holdings that all yield the same, leave nothing to trade', () => {
  assert.equal(balanceToTargetYield([MIX[0]], 5).reason, 'no_spread')
  assert.equal(balanceToTargetYield([
    { ticker: 'A', dollar_amount: 100, yieldPct: 4 },
    { ticker: 'B', dollar_amount: 300, yieldPct: 4 },
  ], 5).reason, 'no_spread')
})

test('no target and no holdings are reported, not balanced', () => {
  assert.equal(balanceToTargetYield(MIX, 0).reason, 'no_target')
  assert.equal(balanceToTargetYield([], 5).reason, 'no_holdings')
  assert.equal(balanceToTargetYield([{ ticker: 'A', dollar_amount: 0, yieldPct: 4 }], 5).reason, 'no_holdings')
})

test('a locked holding keeps its amount and the rest make up the difference', () => {
  const mix = [
    { ticker: 'BAD', dollar_amount: 20000, yieldPct: 0, locked: true },
    { ticker: 'LOW', dollar_amount: 40000, yieldPct: 2 },
    { ticker: 'HIGH', dollar_amount: 40000, yieldPct: 12 },
  ]
  const result = balanceToTargetYield(mix, 8)
  assert.equal(result.ok, true)
  assert.equal(amounts(result).BAD, 20000)
  assert.deepEqual(result.changes.map(c => c.ticker), ['LOW', 'HIGH'])
  close(portfolioYield(withYields(result, mix)), 8, YIELD_TOLERANCE)
})

test('a locked holding lowers the yield the portfolio can reach', () => {
  const mix = [
    { ticker: 'BAD', dollar_amount: 50000, yieldPct: 0, locked: true },
    { ticker: 'LOW', dollar_amount: 25000, yieldPct: 2 },
    { ticker: 'HIGH', dollar_amount: 25000, yieldPct: 12 },
  ]
  const result = balanceToTargetYield(mix, 8)
  assert.equal(result.reason, 'above_max')
  close(result.maxYieldPct, 6)
})

test('an unfunded holding is left out and stays unfunded', () => {
  const mix = [...MIX, { ticker: 'ZERO', dollar_amount: 0, yieldPct: 20 }]
  const result = balanceToTargetYield(mix, 5)
  assert.equal(result.ok, true)
  assert.equal(amounts(result).ZERO, 0)
  assert.equal(result.changes.some(c => c.ticker === 'ZERO'), false)
})

test('a target just under the best yielder still lands within a cent of every holding', () => {
  const result = balanceToTargetYield(MIX, 7.49)
  assert.equal(result.ok, true)
  close(result.yieldPct, 7.49, YIELD_TOLERANCE)
  assert.ok(result.holdings.every(h => h.dollar_amount >= 0.01))
})

// ── Monthly income ↔ yield ───────────────────────────────────────────────────

test('$5,000 a month on $1,000,000 is a 6% yield, and back', () => {
  close(monthlyToYieldPct(5000, 1000000), 6)
  close(yieldPctToMonthly(6, 1000000), 5000)
  close(yieldPctToMonthly(monthlyToYieldPct(1234.56, 250000), 250000), 1234.56)
})

test('no income or nothing invested has no equivalent', () => {
  for (const [m, t] of [[0, 1000], [5000, 0], [-1, 1000], [null, 1000], ['', 1000]]) {
    assert.equal(monthlyToYieldPct(m, t), null, `${m}/${t}`)
  }
  assert.equal(yieldPctToMonthly(0, 1000), null)
  assert.equal(yieldPctToMonthly(5, null), null)
})

// ── Max per holding ──────────────────────────────────────────────────────────

const amountsWithin = (result, total, cap) => result.holdings.every(h => h.dollar_amount <= total * cap / 100 + 0.01)

test('a cap keeps every holding at or under it while hitting the target', () => {
  const result = balanceToTargetYield(MIX, 5, { maxWeightPct: 45 })
  assert.equal(result.ok, true)
  close(result.yieldPct, 5, YIELD_TOLERANCE)
  assert.ok(amountsWithin(result, 100000, 45))
  close(result.total, 100000, 1e-6)
})

test('a cap lowers the highest yield the holdings can reach', () => {
  const range = yieldRange(MIX, 40)
  // 40% JEPI, 40% SCHD, 20% SPY.
  close(range.maxYieldPct, 0.4 * 7.5 + 0.4 * 3.5 + 0.2 * 1.2)
  const result = balanceToTargetYield(MIX, 5, { maxWeightPct: 40 })
  assert.equal(result.reason, 'above_max')
  assert.equal(result.cap, 40)
})

test('a target at the very top of the capped range fills the best holdings to the cap', () => {
  const top = yieldRange(MIX, 40).maxYieldPct
  const result = balanceToTargetYield(MIX, top, { maxWeightPct: 40 })
  assert.equal(result.ok, true)
  const after = amounts(result)
  close(after.JEPI, 40000, 0.02)
  close(after.SCHD, 40000, 0.02)
  close(after.SPY, 20000, 0.02)
})

test('a cap too low for the number of holdings is reported', () => {
  const result = balanceToTargetYield(MIX, 4, { maxWeightPct: 30 })
  assert.equal(result.reason, 'cap_too_low')
  assert.equal(result.minHoldings, 4)
  assert.equal(yieldRange(MIX, 30).feasible, false)
})

test('applying a cap at the current yield brings an oversized holding down', () => {
  const heavy = [
    { ticker: 'BIG', dollar_amount: 70000, yieldPct: 4 },
    { ticker: 'A', dollar_amount: 15000, yieldPct: 4 },
    { ticker: 'B', dollar_amount: 15000, yieldPct: 4 },
  ]
  assert.deepEqual(holdingsOverCap(heavy, 50).map(h => h.ticker), ['BIG'])
  const result = balanceToTargetYield(heavy, 4, { maxWeightPct: 50 })
  assert.equal(result.ok, true)
  const after = amounts(result)
  close(after.BIG, 50000, 0.02)
  close(after.A, 25000, 0.02)
  close(after.B, 25000, 0.02)
})

test('no cap, or a cap of 100%, changes nothing about balancing', () => {
  const plain = balanceToTargetYield(MIX, 5)
  for (const cap of [null, 0, 100, '']) {
    assert.deepEqual(amounts(balanceToTargetYield(MIX, 5, { maxWeightPct: cap })), amounts(plain), String(cap))
  }
  assert.deepEqual(holdingsOverCap(MIX, null), [])
})

test('the cap counts locked holdings in the total but never trades them', () => {
  const mix = [
    { ticker: 'BAD', dollar_amount: 60000, yieldPct: 0, locked: true },
    { ticker: 'LOW', dollar_amount: 20000, yieldPct: 2 },
    { ticker: 'HIGH', dollar_amount: 20000, yieldPct: 12 },
  ]
  assert.deepEqual(holdingsOverCap(mix, 50), [])
  // Capped at $25,000 each, LOW and HIGH reach at most (25,000 × 12 + 15,000 × 2) / 100,000 = 3.3%.
  close(yieldRange(mix, 25).maxYieldPct, 3.3)
  const result = balanceToTargetYield(mix, 3, { maxWeightPct: 25 })
  assert.equal(result.ok, true)
  assert.equal(amounts(result).BAD, 60000)
  assert.ok(amounts(result).HIGH <= 25000.01)
})

// ── Whole shares ─────────────────────────────────────────────────────────────

const PRICED = [
  { ticker: 'SPY', dollar_amount: 50000, yieldPct: 1.2, price: 600 },
  { ticker: 'SCHD', dollar_amount: 30000, yieldPct: 3.5, price: 27.5 },
  { ticker: 'JEPI', dollar_amount: 20000, yieldPct: 7.5, price: 57 },
]

test('whole shares buys whole shares and leaves the rest as cash', () => {
  const result = balanceToTargetYield(PRICED, 5, { wholeShares: true })
  assert.equal(result.ok, true)
  for (const change of result.changes) {
    const price = PRICED.find(h => h.ticker === change.ticker).price
    assert.ok(Number.isInteger(change.shares))
    close(change.to, change.shares * price, 0.006)
  }
  close(result.total + result.cash, 100000, 0.01)
  assert.ok(result.cash >= 0)
  // No share of anything fits into the cash that is left.
  assert.ok(result.cash < Math.max(...PRICED.map(h => h.price)))
})

test('whole shares reaches the target, or a little above it', () => {
  const result = balanceToTargetYield(PRICED, 5, { wholeShares: true })
  assert.ok(result.yieldPct >= 5 - 1e-9, String(result.yieldPct))
  assert.ok(result.yieldPct < 5.1, String(result.yieldPct))
})

test('whole shares respects the cap', () => {
  const result = balanceToTargetYield(PRICED, 4.5, { wholeShares: true, maxWeightPct: 45 })
  assert.equal(result.ok, true)
  assert.ok(amountsWithin(result, 100000, 45))
})

test('whole shares keeps at least one share of every holding', () => {
  const result = balanceToTargetYield(PRICED, 6.5, { wholeShares: true })
  assert.equal(result.ok, true)
  assert.ok(result.changes.every(c => c.shares >= 1))
})

test('whole shares needs a price for every holding it trades', () => {
  const unpriced = PRICED.map((h, i) => (i === 0 ? { ...h, price: null } : h))
  assert.equal(balanceToTargetYield(unpriced, 5, { wholeShares: true }).reason, 'no_price')
})
