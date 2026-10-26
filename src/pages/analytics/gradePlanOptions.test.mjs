import test from 'node:test'
import assert from 'node:assert/strict'
import { planOptionFacts, planOptionLabel, planOptionNote } from './gradePlanOptions.js'

const plan = ({ kind = 'main', ticker = null, score, moved, income, changes }) => ({
  kind,
  rule_ticker: ticker,
  target: { grade: 'B', score, moved_value: moved },
  comparison: { before: { annual_income: 1000 }, after: { annual_income: 1000 + income } },
  weights: [
    ...Array.from({ length: changes }, (_, i) => ({ ticker: `T${i}`, action: i % 2 ? 'SELL' : 'BUY' })),
    { ticker: 'HELD', action: 'HOLD' },
  ],
})

test('labels name the rule and the holding it applies to', () => {
  assert.equal(planOptionLabel({ kind: 'main' }), 'Main plan')
  assert.equal(planOptionLabel({ kind: 'income' }), 'Keeps income')
  assert.equal(planOptionLabel({ kind: 'keep', rule_ticker: 'BTCI' }), 'Keeps BTCI')
  assert.equal(planOptionLabel({ kind: 'avoid', rule_ticker: 'PEO' }), 'Without adding to PEO')
  assert.equal(planOptionLabel({ kind: 'fewer' }), 'Fewer changes')
  assert.match(planOptionNote({ kind: 'keep', rule_ticker: 'BTCI' }), /Leaves BTCI as it is/)
})

test('facts count only changed holdings and badge the leader on each figure', () => {
  const facts = planOptionFacts([
    plan({ score: 83.0, moved: 27000, income: -6300, changes: 12 }),
    plan({ kind: 'income', score: 83.0, moved: 51000, income: 850, changes: 15 }),
    plan({ kind: 'avoid', ticker: 'XLEI', score: 83.2, moved: 31000, income: -7400, changes: 12 }),
  ])
  assert.deepEqual(facts.map(f => f.changes), [12, 15, 12])
  assert.deepEqual(facts.map(f => f.income), [-6300, 850, -7400])
  // Two options tie on fewest changes, so neither gets that badge.
  assert.deepEqual(facts[0].badges, ['Least moved'])
  assert.deepEqual(facts[1].badges, ['Most income'])
  assert.deepEqual(facts[2].badges, ['Highest score'])
})

test('no badges when every option ties', () => {
  const same = { score: 83, moved: 1000, income: 0, changes: 2 }
  const facts = planOptionFacts([plan(same), plan({ ...same, kind: 'income' })])
  assert.deepEqual(facts.map(f => f.badges), [[], []])
})
