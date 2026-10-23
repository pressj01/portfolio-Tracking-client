export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function paymentsPerYear(freq) {
  const f = String(freq || '').toUpperCase()
  if (f === '52' || f === 'W') return 52
  if (f === 'M') return 12
  if (f === 'Q') return 4
  if (f === 'SA' || f === 'S') return 2
  if (f === 'A') return 1
  return 12
}

export function estimatePaymentIncome(ev) {
  const annual = Number(ev.annual_income || 0)
  if (annual > 0) return annual / paymentsPerYear(ev.freq)
  const amount = Number(ev.amount || ev.dividend_paid || 0)
  const qty = Number(ev.quantity || 0)
  return amount > 0 && qty > 0 ? amount * qty : 0
}

export function calendarPaymentIncome(ev) {
  const scopedPayment = Number(ev.payment_income || 0)
  if (scopedPayment > 0) return scopedPayment
  const amount = Number(ev.amount || ev.dividend_paid || 0)
  const qty = Number(ev.quantity || 0)
  if (amount > 0 && qty > 0) return amount * qty
  return estimatePaymentIncome(ev)
}

export function calendarPaymentStatus(ev) {
  const dateEstimated = Boolean(ev.calendar_estimated ?? (ev.pay_estimated || ev.calendar_projected))
  // Old cached rows contain only date confirmation, so cannot confirm amounts.
  const amountEstimated = ev.amount_estimated !== false
  const estimated = dateEstimated || amountEstimated
  const label = dateEstimated
    ? '~ Estimated'
    : amountEstimated ? 'Scheduled · Estimated amount' : '✓ Confirmed'
  const description = `${dateEstimated ? 'Estimated' : 'Confirmed'} pay date · ${amountEstimated ? 'Estimated' : 'Declared'} amount`
  return { dateEstimated, amountEstimated, estimated, label, description }
}

export function buildPaymentAgenda(events = []) {
  const groups = new Map()
  ;(events || []).forEach((event) => {
    const date = event?.calendar_pay_date || event?.pay_date || null
    const key = date || 'unscheduled'
    if (!groups.has(key)) groups.set(key, { date, events: [], income: 0 })
    const group = groups.get(key)
    group.events.push(event)
    group.income += calendarPaymentIncome(event)
  })

  return [...groups.values()]
    .map(group => ({
      ...group,
      income: Math.round(group.income * 100) / 100,
      events: [...group.events].sort((a, b) => (
        String(a?.ticker || '').localeCompare(String(b?.ticker || ''))
      )),
    }))
    .sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return a.date.localeCompare(b.date)
    })
}

export function estimateAnnualYieldPct(amount, freq, price) {
  const amt = Number(amount || 0)
  const px = Number(price || 0)
  if (amt <= 0 || px <= 0) return null
  return (amt * paymentsPerYear(freq) / px) * 100
}

export function currentYieldPct(ev) {
  const annualIncome = Number(ev.annual_income || 0)
  const holdingValue = Number(ev.current_value || 0)
    || Number(ev.quantity || 0) * Number(ev.current_price || 0)
  if (annualIncome > 0 && holdingValue > 0) return (annualIncome / holdingValue) * 100
  return estimateAnnualYieldPct(ev.amount, ev.freq, ev.current_price)
}

export function isoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateFromIso(value) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function shiftMonthKey(key, amount) {
  const [year, month] = String(key || '').split('-').map(Number)
  const date = new Date(year, (month || 1) - 1 + amount, 1)
  return monthKey(date)
}

export function startOfWeekMonday(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

export function monthKeysForWeek(todayIso) {
  const today = dateFromIso(todayIso) || new Date()
  const monday = startOfWeekMonday(today)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return [...new Set([monthKey(monday), monthKey(sunday)])]
}

function nthWeekday(year, monthIndex, weekday, n) {
  const first = new Date(year, monthIndex, 1)
  return new Date(year, monthIndex, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7)
}

function lastWeekday(year, monthIndex, weekday) {
  const last = new Date(year, monthIndex + 1, 0)
  return new Date(year, monthIndex, last.getDate() - ((last.getDay() - weekday + 7) % 7))
}

// Federal Reserve rule for fixed-date holidays: Sunday closes the following
// Monday, but Saturday closes nothing (the banks open the Friday before).
function observedFixedHoliday(year, monthIndex, day) {
  const actual = new Date(year, monthIndex, day)
  if (actual.getDay() === 6) return null
  if (actual.getDay() === 0) return { date: new Date(year, monthIndex, day + 1), observed: true }
  return { date: actual, observed: false }
}

const bankHolidayCache = new Map()

// Weekdays the Federal Reserve -- and with it DTC, which pays fund
// distributions -- is closed. Distinct from NYSE holidays: Columbus Day and
// Veterans Day close the banks with the stock market open, and Good Friday is
// the reverse. A payable date that lands on one of these pays the next
// business day, so the broker records it then.
export function usBankHolidays(year) {
  if (bankHolidayCache.has(year)) return bankHolidayCache.get(year)
  const holidays = new Map()
  const add = (date, name) => holidays.set(isoDate(date), name)
  const addFixed = (monthIndex, day, name) => {
    const holiday = observedFixedHoliday(year, monthIndex, day)
    if (holiday) add(holiday.date, holiday.observed ? `${name} (observed)` : name)
  }

  addFixed(0, 1, "New Year's Day")
  add(nthWeekday(year, 0, 1, 3), 'Martin Luther King Jr. Day')
  add(nthWeekday(year, 1, 1, 3), "Presidents' Day")
  add(lastWeekday(year, 4, 1), 'Memorial Day')
  if (year >= 2022) addFixed(5, 19, 'Juneteenth')
  addFixed(6, 4, 'Independence Day')
  add(nthWeekday(year, 8, 1, 1), 'Labor Day')
  add(nthWeekday(year, 9, 1, 2), 'Columbus Day')
  addFixed(10, 11, 'Veterans Day')
  add(nthWeekday(year, 10, 4, 4), 'Thanksgiving Day')
  addFixed(11, 25, 'Christmas Day')

  bankHolidayCache.set(year, holidays)
  return holidays
}

export function isBankBusinessDay(date) {
  const day = date.getDay()
  return day !== 0 && day !== 6 && !usBankHolidays(date.getFullYear()).has(isoDate(date))
}

export function bankHolidayFor(date) {
  const name = usBankHolidays(date.getFullYear()).get(isoDate(date))
  if (!name) return null
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  while (!isBankBusinessDay(next)) next.setDate(next.getDate() + 1)
  return { name, nextBusinessDay: next }
}

function paymentsByDate(payments) {
  const byDate = new Map()
  ;(payments || []).forEach(payment => {
    const key = payment.calendar_pay_date
    if (!key) return
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key).push(payment)
  })
  return byDate
}

export function buildMonthCells(selectedMonth, payments) {
  const [year, month] = String(selectedMonth || '').split('-').map(Number)
  if (!year || !month) return []
  const first = new Date(year, month - 1, 1)
  const leadingDays = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7
  const byDate = paymentsByDate(payments)

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(year, month - 1, index - leadingDays + 1)
    const key = isoDate(date)
    return {
      key,
      date,
      currentMonth: date.getMonth() === month - 1,
      payments: byDate.get(key) || [],
      holiday: bankHolidayFor(date),
    }
  })
}

export function buildWeekCells(todayIso, payments) {
  const today = dateFromIso(todayIso) || new Date()
  const monday = startOfWeekMonday(today)
  const byDate = paymentsByDate(payments)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)
    const key = isoDate(date)
    return {
      key,
      date,
      currentMonth: true,
      payments: byDate.get(key) || [],
      holiday: bankHolidayFor(date),
    }
  })
}

export function weekPaymentTotal(cells) {
  return (cells || []).reduce(
    (sum, cell) => sum + cell.payments.reduce((day, ev) => day + calendarPaymentIncome(ev), 0),
    0,
  )
}
