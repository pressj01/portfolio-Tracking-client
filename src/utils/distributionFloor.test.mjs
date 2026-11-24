import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultFloorGroup, getFloorTickers, grossIncomeFloor, incomeFloorRows, stressTestIncome, stressTestSources } from './distributionFloor.js'

const history = {
  year: 2026, as_of: '2026-03-15',
  rows: [
    { ticker: 'CORE1', actual: [4500, 3500, 1500, null], estimated: [0, 1000, 0, null] },
    { ticker: 'SAT1', actual: [500, 100, 200, null], estimated: [0, 50, 0, null] },
    { ticker: 'SOLD', actual: [200, 0, 0, null], estimated: [0, 0, 0, null] },
  ],
}
const holdings = [
  { ticker: 'CORE1', category: 'Income', subcategory: 'Core positions', quantity: 10, div: 1 },
  { ticker: 'SAT1', category: 'Satellite', quantity: 10, div: 1 },
  { ticker: 'FUTURE', category: 'Income', quantity: 2, estim_payment_per_year: 12 },
  { ticker: 'NONPAYER', category: 'Core', quantity: 2, div: 0 },
]
const summary = { normalized_monthly_expenses: 4000, normalized_portfolio_required: 3000 }
const series = [
  { month: '2026-01', expenses: 2500, additional_income_net: 1000, portfolio_required: 1500 },
  { month: '2026-02', expenses: 5000, additional_income_net: 1000, portfolio_required: 4000 },
  { month: '2026-03', expenses: 2000, additional_income_net: 3000, portfolio_required: 0 },
]
const tickers = getFloorTickers(history, holdings)

test('classifications use existing categories and include paid historical tickers and future income holdings', () => {
  assert.deepEqual(tickers.map(t => [t.ticker, t.group, t.held]), [
    ['CORE1', 'core', true], ['FUTURE', 'unassigned', true], ['SAT1', 'satellite', true], ['SOLD', 'unassigned', false],
  ])
  assert.equal(defaultFloorGroup({ category: 'Core', subcategory: 'Satellite' }), 'unassigned')
  assert.equal(defaultFloorGroup({ category: 'Score' }), 'unassigned')
  assert.equal(getFloorTickers(history, holdings, { SOLD: 'core', CORE1: 'unassigned' }).find(t => t.ticker === 'SOLD').group, 'core')
  assert.equal(getFloorTickers(history, holdings, { CORE1: 'unassigned' }).find(t => t.ticker === 'CORE1').group, 'unassigned')
})

test('gross floor accounts for portfolio tax, rounds up, and preserves unknown values', () => {
  assert.equal(grossIncomeFloor(3000, 25), 4000)
  assert.equal(grossIncomeFloor(100, 15), 117.65)
  assert.equal(grossIncomeFloor(100, 0), 100)
  assert.equal(grossIncomeFloor(0, 25), 0)
  assert.equal(grossIncomeFloor(null, 25), null)
  assert.equal(grossIncomeFloor(100, null), null)
  assert.equal(grossIncomeFloor(100, 100), null)
})

test('normalized floor shows confirmed core and total coverage without treating partial months as failures', () => {
  const rows = incomeFloorRows({ history, tickers, summary, series, taxRatePct: 25 })
  assert.deepEqual(rows.map(r => r.floor), [4000, 4000, 4000])
  assert.equal(rows[0].core, 4500)
  assert.equal(rows[0].unassigned, 200)
  assert.equal(rows[0].total, 5200)
  assert.equal(rows[0].coreCoverage, 1.125)
  assert.equal(rows[0].totalCoverage, 1.3)
  assert.equal(rows[0].gap, 1200)
  assert.equal(rows[0].status, 'Covered')
  assert.equal(rows[1].total, 3600)
  assert.equal(rows[1].gap, -400)
  assert.equal(rows[1].status, 'Recorded shortfall')
  assert.equal(rows[2].partial, true)
  assert.equal(rows[2].status, 'In progress')
})

test('projections are optional and never counted in confirmed core coverage', () => {
  const rows = incomeFloorRows({ history, tickers, summary, series, taxRatePct: 25, includeEstimates: true })
  const feb = rows[1]
  assert.equal(feb.estimated, 1050)
  assert.equal(feb.confirmed, 3600)
  assert.equal(feb.total, 4650)
  assert.equal(feb.coreCoverage, 3500 / 4000)
  assert.equal(feb.totalCoverage, 4650 / 4000)
  assert.equal(feb.status, 'Covered with projections')
})

test('scheduled floor follows the actual plan schedule and can use all expenses', () => {
  const options = { history, tickers, summary, series, taxRatePct: 25, floorMode: 'scheduled', firstMonth: 2 }
  const rows = incomeFloorRows(options)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].floor, 5333.34)
  assert.equal(rows[0].netFloor, 4000)
  assert.equal(rows[1].floor, 0)
  assert.equal(rows[1].status, 'No portfolio need')
  assert.equal(rows[1].totalCoverage, null)
  assert.equal(incomeFloorRows({ ...options, fundingMode: 'all' })[1].floor, 2666.67)
  assert.equal(incomeFloorRows({ ...options, floorMode: 'normalized', fundingMode: 'all' })[0].floor, 5333.34)
})

test('missing payment data and absent budgets do not report coverage or shortfall', () => {
  const empty = { ...history, rows: [] }
  const result = incomeFloorRows({ history: empty, tickers, summary, series, taxRatePct: 25 })
  assert.equal(result[0].status, 'No payment records')
  assert.equal(result[0].gap, null)
  assert.equal(result[0].totalCoverage, null)
  const noBudget = incomeFloorRows({ history, tickers, summary: { normalized_monthly_expenses: 0, normalized_portfolio_required: 0 }, series, taxRatePct: 25 })
  assert.equal(noBudget[0].floor, null)
  assert.equal(noBudget[0].status, 'No scheduled expenses')
  const noCore = incomeFloorRows({ history, tickers: tickers.map(t => ({ ...t, group: 'unassigned' })), summary, series, taxRatePct: 25 })
  assert.equal(noCore[0].coreCoverage, null)
  assert.equal(noCore[0].totalCoverage, 1.3)
})

test('stress test removes only the selected payer’s confirmed income and uses the same floor', () => {
  const rows = incomeFloorRows({ history, tickers, summary, series, taxRatePct: 25, includeEstimates: true })
  const sources = stressTestSources(history, tickers, 2)
  const source = sources.find(s => s.id === 'CORE1')
  const result = stressTestIncome(rows[1], source, true)
  assert.deepEqual(result.map(s => s.income), [3600, 1850, 100, 3500])
  assert.deepEqual(result.map(s => s.gap), [-400, -2150, -3900, -500])
  assert.equal(result[2].coverage, 0.025)
  const satellite = sources.find(s => s.id === ':satellite')
  assert.equal(satellite.amount, 100)
  assert.equal(stressTestIncome(rows[1], satellite, true)[2].income, 3500)
  assert.equal(stressTestIncome(rows[1], satellite, false)[3].income, null)
  assert.deepEqual(stressTestIncome({ ...rows[1], hasActual: false }, source, true), [])
})
