import assert from 'node:assert/strict'
import test from 'node:test'

import { navHistoryCallouts, resampleNavHistory } from './navHistoryInterval.js'

const point = (date, value) => ({ date, value })
const dates = points => points.map(item => item.date)

test('daily history keeps every valid point in chronological order', () => {
  const result = resampleNavHistory([
    point('2026-05-20', 2),
    point('not-a-date', 99),
    point('2026-05-19', 1),
  ], 'daily')

  assert.deepEqual(dates(result), ['2026-05-19', '2026-05-20'])
})

test('weekly history keeps the last available trading-day value in each calendar week', () => {
  const result = resampleNavHistory([
    point('2026-05-22', 2),
    point('2026-05-18', 1),
    point('2026-05-29', 4),
    point('2026-05-25', 3),
  ], 'weekly')

  assert.deepEqual(result, [point('2026-05-22', 2), point('2026-05-29', 4)])
})

const labels = points => navHistoryCallouts(points).map(callout => [callout.label, callout.point.date])

test('portfolio value callouts mark the high, the low, and the latest value', () => {
  assert.deepEqual(labels([
    point('2026-05-19', 560000),
    point('2026-05-28', 575037.19),
    point('2026-07-23', 517659.39),
    point('2026-09-21', 569000),
  ]), [
    ['High', '2026-05-28'],
    ['Low', '2026-07-23'],
    ['Current', '2026-09-21'],
  ])
})

test('the current label says so when that value is the high or the low', () => {
  assert.deepEqual(labels([
    point('2026-05-19', 560000),
    point('2026-07-23', 517659.39),
    point('2026-09-21', 575037.19),
  ]), [
    ['Current is the high', '2026-09-21'],
    ['Low', '2026-07-23'],
  ])

  assert.deepEqual(labels([
    point('2026-05-19', 575037.19),
    point('2026-07-23', 540000),
    point('2026-09-21', 517659.39),
  ]), [
    ['High', '2026-05-19'],
    ['Current is the low', '2026-09-21'],
  ])

  assert.deepEqual(labels([
    point('2026-05-28', 575037.19),
    point('2026-07-23', 517659.39),
    point('2026-09-21', 575037.19),
  ]), [
    ['High', '2026-05-28'],
    ['Low', '2026-07-23'],
    ['Current is the high', '2026-09-21'],
  ])
})

test('a zoomed range does not call an older endpoint the current value', () => {
  const points = [
    point('2026-05-28', 575037.19),
    point('2026-06-15', 540000),
    point('2026-07-23', 517659.39),
    point('2026-09-21', 569000),
  ]
  const dateTime = value => new Date(`${value}T00:00:00`).getTime()
  const callouts = navHistoryCallouts(points, {
    start: dateTime('2026-06-01'),
    end: dateTime('2026-08-01'),
    dateTime,
  })

  assert.deepEqual(callouts.map(callout => callout.label), ['High', 'Low'])
})

test('a narrow chart moves the current label below the latest point so it does not cover the high', () => {
  const points = [
    point('2026-05-19', 560000),
    point('2026-05-28', 575037.19),
    point('2026-07-23', 517659.39),
    point('2026-09-21', 569000),
  ]
  const dateTime = value => new Date(`${value}T00:00:00`).getTime()
  const range = {
    start: dateTime('2026-04-15'),
    end: dateTime('2026-10-05'),
    dateTime,
  }
  const narrow = navHistoryCallouts(points, { ...range, plotWidth: 260 })
  const wide = navHistoryCallouts(points, { ...range, plotWidth: 1200 })

  assert.equal(narrow.find(callout => callout.role === 'current').offset, 28)
  assert.equal(wide.find(callout => callout.role === 'current').offset, -28)
})

test('one recorded value admits that it is both the high and the low', () => {
  assert.deepEqual(labels([point('2026-09-21', 569000)]), [
    ['Current is the high and the low', '2026-09-21'],
  ])
})

test('monthly history keeps the last available trading-day value in each month', () => {
  const result = resampleNavHistory([
    point('2026-06-01', 3),
    point('2026-05-19', 1),
    point('2026-06-30', 4),
    point('2026-05-29', 2),
  ], 'monthly')

  assert.deepEqual(result, [point('2026-05-29', 2), point('2026-06-30', 4)])
})
