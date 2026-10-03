import test from 'node:test'
import assert from 'node:assert/strict'
import {
  axisMoneyLabel,
  axisTicks,
  evaluateGoal,
  niceCeiling,
  todaysDollars,
  yearTickStep,
} from './dividendGoal.js'

const close = (actual, expected, tolerance = 1e-6) => assert.ok(
  Math.abs(actual - expected) < tolerance,
  `expected ${expected}, got ${actual}`,
)

test('today\'s dollars discounts each year by compounded inflation', () => {
  const real = todaysDollars([100, 103, 106.09], [0, 1, 2], 3)
  close(real[0], 100)
  close(real[1], 100)
  close(real[2], 100)
})

test('zero inflation leaves the series untouched', () => {
  assert.deepEqual(todaysDollars([10, 20, 30], [0, 1, 2], 0), [10, 20, 30])
})

test('a goal is reached in the first year the series clears the target', () => {
  const goal = evaluateGoal({ years: [0, 1, 2, 3], values: [400, 700, 1100, 1500], target: 1000 })
  assert.equal(goal.status, 'reached')
  assert.equal(goal.yearReached, 2)
  assert.equal(goal.gap, 500)
  assert.equal(goal.progressPct, 150)
})

test('a goal that is never reached reports the shortfall', () => {
  const goal = evaluateGoal({ years: [0, 1, 2], values: [10000, 30000, 50000], target: 100000 })
  assert.equal(goal.status, 'missed')
  assert.equal(goal.yearReached, null)
  assert.equal(goal.gap, -50000)
  assert.equal(goal.progressPct, 50)
})

test('touching the target and falling back is not the same as reaching it', () => {
  // A return-of-capital fund can cross a portfolio target and then erode.
  const goal = evaluateGoal({ years: [0, 1, 2, 3], values: [900, 1050, 980, 940], target: 1000 })
  assert.equal(goal.status, 'lapsed')
  assert.equal(goal.yearReached, 1)
  assert.equal(goal.gap, -60)
})

test('a starting value already at the target is reached in year 0', () => {
  const goal = evaluateGoal({ years: [0, 1], values: [5000, 5200], target: 5000 })
  assert.equal(goal.status, 'reached')
  assert.equal(goal.yearReached, 0)
})

test('a blank or zero target means no goal', () => {
  assert.equal(evaluateGoal({ years: [0, 1], values: [1, 2], target: '' }).status, 'none')
  assert.equal(evaluateGoal({ years: [0, 1], values: [1, 2], target: 0 }).status, 'none')
  assert.equal(evaluateGoal({ years: [], values: [], target: 100 }).status, 'none')
})

test('the axis tops out on a round step above the largest value', () => {
  assert.equal(niceCeiling(104000), 125000)
  assert.equal(niceCeiling(70700), 80000)
  assert.equal(niceCeiling(2712), 3000)
  assert.equal(niceCeiling(0), 1)
})

test('ticks stay inside an axis whose maximum is mid-animation', () => {
  const { step, ticks } = axisTicks(97300)
  assert.equal(step, 20000)
  assert.deepEqual(ticks, [0, 20000, 40000, 60000, 80000])
  assert.deepEqual(axisTicks(125000).ticks, [0, 25000, 50000, 75000, 100000, 125000])
})

test('year labels thin out when there is no room for one per year', () => {
  assert.equal(yearTickStep(10, 12), 1)
  assert.equal(yearTickStep(30, 9), 5)
  assert.equal(yearTickStep(50, 8), 10)
})

test('axis labels keep the decimals a fractional step needs', () => {
  assert.equal(axisMoneyLabel(125000, 25000), '$125K')
  assert.equal(axisMoneyLabel(12500, 2500), '$12.5K')
  assert.equal(axisMoneyLabel(2500, 500), '$2,500')
  assert.equal(axisMoneyLabel(1500000, 500000), '$1.5M')
  assert.equal(axisMoneyLabel(0, 25000), '$0')
  assert.equal(axisMoneyLabel(50000, 25000, 'CA$'), 'CA$50K')
})

test('every label on an axis shares the unit of the axis top', () => {
  // Without the axis maximum this read "$5,000" beside "$10K".
  assert.equal(axisMoneyLabel(5000, 5000, '$', 25000), '$5K')
  assert.equal(axisMoneyLabel(25000, 5000, '$', 25000), '$25K')
  assert.equal(axisMoneyLabel(500000, 500000, '$', 2000000), '$0.5M')
  assert.equal(axisMoneyLabel(0, 500000, '$', 2000000), '$0')
  assert.equal(axisMoneyLabel(1500, 500, '$', 3000), '$1,500')
})
