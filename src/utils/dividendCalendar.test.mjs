import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPaymentAgenda,
  buildMonthCells,
  buildWeekCells,
  monthKeysForWeek,
  weekPaymentTotal,
} from './dividendCalendar.js'

test('buildPaymentAgenda groups and sorts events by pay date', () => {
  const groups = buildPaymentAgenda([
    { ticker: 'SPYI', pay_date: '2026-08-21', payment_income: 51.40 },
    { ticker: 'CHPY', pay_date: '2026-08-20', payment_income: 109.76 },
    { ticker: 'BLOX', pay_date: '2026-08-21', payment_income: 18.08 },
    { ticker: 'TBD', date: '2026-08-19', payment_income: 5 },
  ])

  assert.deepEqual(groups.map(group => group.date), ['2026-08-20', '2026-08-21', null])
  assert.deepEqual(groups[1].events.map(event => event.ticker), ['BLOX', 'SPYI'])
  assert.equal(groups[1].income, 69.48)
})

test('buildWeekCells returns the Monday-Sunday containing the given day', () => {
  const cells = buildWeekCells('2026-08-13', [
    { ticker: 'CHPY', calendar_pay_date: '2026-08-13', payment_income: 109.76 },
    { ticker: 'SPYI', calendar_pay_date: '2026-08-21', payment_income: 51.40 },
  ])

  assert.equal(cells.length, 7)
  assert.equal(cells[0].key, '2026-08-10')
  assert.equal(cells[6].key, '2026-08-16')
  assert.deepEqual(cells.map(cell => cell.payments.map(p => p.ticker)), [
    [], [], [], ['CHPY'], [], [], [],
  ])
  assert.equal(weekPaymentTotal(cells), 109.76)
})

test('monthKeysForWeek includes both months when the week crosses a boundary', () => {
  assert.deepEqual(monthKeysForWeek('2026-08-31'), ['2026-08', '2026-09'])
  assert.deepEqual(monthKeysForWeek('2026-08-13'), ['2026-08'])
  assert.deepEqual(monthKeysForWeek('2026-09-01'), ['2026-08', '2026-09'])
})

test('buildMonthCells still groups payments onto the matching calendar day', () => {
  const cells = buildMonthCells('2026-08', [
    { ticker: 'BLOX', calendar_pay_date: '2026-08-03', payment_income: 18.08 },
  ])
  const monday = cells.find(cell => cell.key === '2026-08-03')

  assert.ok(monday)
  assert.equal(monday.currentMonth, true)
  assert.equal(monday.payments[0].ticker, 'BLOX')
  assert.equal(cells[0].key, '2026-07-27')
  assert.equal(cells[0].currentMonth, false)
})
