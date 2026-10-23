import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bankHolidayFor,
  buildPaymentAgenda,
  buildMonthCells,
  buildWeekCells,
  calendarPaymentStatus,
  isoDate,
  monthKeysForWeek,
  usBankHolidays,
  weekPaymentTotal,
} from './dividendCalendar.js'

test('a scheduled date does not confirm a carried-forward dividend amount', () => {
  const status = calendarPaymentStatus({ pay_estimated: false, amount_estimated: true })
  assert.equal(status.dateEstimated, false)
  assert.equal(status.amountEstimated, true)
  assert.equal(status.estimated, true)
  assert.equal(status.label, 'Scheduled · Estimated amount')
  assert.equal(status.description, 'Confirmed pay date · Estimated amount')
})

test('confirmation requires both a known date and a declared amount', () => {
  assert.equal(calendarPaymentStatus({ pay_estimated: false, amount_estimated: false }).label, '✓ Confirmed')
  assert.equal(calendarPaymentStatus({ pay_estimated: true, amount_estimated: false }).estimated, true)
  assert.equal(calendarPaymentStatus({ pay_estimated: false }).amountEstimated, true)
  assert.equal(calendarPaymentStatus({ calendar_estimated: true, pay_estimated: false, amount_estimated: false }).dateEstimated, true)
})

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

test('usBankHolidays follows the Federal Reserve schedule, not the NYSE one', () => {
  assert.deepEqual([...usBankHolidays(2026).keys()], [
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19',
    '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
  ])
  // Good Friday closes the NYSE but not the banks.
  assert.equal(usBankHolidays(2026).has('2026-04-03'), false)
})

test('usBankHolidays moves Sunday holidays to Monday and skips Saturday ones', () => {
  const holidays = usBankHolidays(2027)
  assert.equal(holidays.get('2027-07-05'), 'Independence Day (observed)')
  // Juneteenth and Christmas 2027 fall on Saturday: the banks open Friday.
  assert.equal(holidays.has('2027-06-18'), false)
  assert.equal(holidays.has('2027-12-24'), false)
  assert.equal(usBankHolidays(2028).has('2027-12-31'), false)
})

test('bankHolidayFor names the holiday and the next business day', () => {
  const columbus = bankHolidayFor(new Date(2026, 9, 12))
  assert.equal(columbus.name, 'Columbus Day')
  assert.equal(isoDate(columbus.nextBusinessDay), '2026-10-13')
  assert.equal(isoDate(bankHolidayFor(new Date(2026, 11, 25)).nextBusinessDay), '2026-12-28')
  assert.equal(bankHolidayFor(new Date(2026, 9, 13)), null)
})

test('week and month cells carry the bank holiday for that day', () => {
  const week = buildWeekCells('2026-10-15', [])
  assert.deepEqual(week.map(cell => cell.holiday?.name || null), [
    'Columbus Day', null, null, null, null, null, null,
  ])
  const month = buildMonthCells('2026-11', [])
  assert.deepEqual(
    month.filter(cell => cell.holiday).map(cell => cell.key),
    ['2026-11-11', '2026-11-26'],
  )
})
