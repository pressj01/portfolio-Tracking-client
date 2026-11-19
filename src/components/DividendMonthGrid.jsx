import { formatMoney } from '../utils/money'
import {
  WEEKDAYS,
  calendarPaymentIncome,
  calendarPaymentStatus,
  currentYieldPct,
} from '../utils/dividendCalendar'

export function DividendMonthEvent({ ev }) {
  const payment = calendarPaymentIncome(ev)
  const yieldPct = currentYieldPct(ev)
  const { estimated, amountEstimated, description: statusDescription } = calendarPaymentStatus(ev)
  const description = ev.description || 'Dividend payment'

  return (
    <div
      className="dc-month-event"
      style={{ borderLeftColor: ev.color || 'var(--teal)' }}
      title={`${ev.ticker} - ${description}\n${amountEstimated ? 'Estimated payment' : 'Payment'}: ${formatMoney(payment)}\nYield: ${yieldPct == null ? 'Unavailable' : `${yieldPct.toFixed(2)}%`}\nEx-dividend: ${ev.date || 'Unavailable'}\n${statusDescription}`}
    >
      <div
        className="dc-month-event-icon"
        style={{ background: `${ev.color || '#8899aa'}22`, color: ev.color || 'var(--text-soft)' }}
        aria-hidden="true"
      >
        {String(ev.ticker || '?').slice(0, 2)}
      </div>
      <div className="dc-month-event-body">
        <div className="dc-month-event-title">
          <strong>{ev.ticker}</strong>
          <span>{description}</span>
        </div>
        <div className="dc-month-event-meta">
          <strong>{amountEstimated ? '~ ' : ''}{formatMoney(payment)}</strong>
          <span
            className={`dc-month-date-status${estimated ? ' estimated' : ' confirmed'}`}
            title={statusDescription}
            aria-label={statusDescription}
          >
            {estimated ? '~' : '\u2713'}
          </span>
          <span className="dc-month-meta-dot" aria-hidden="true">&bull;</span>
          <span>{yieldPct == null ? 'Yield unavailable' : `${yieldPct.toFixed(2)}% yield`}</span>
        </div>
      </div>
    </div>
  )
}

function DividendHolidayNote({ holiday }) {
  const nextDay = holiday.nextBusinessDay.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <div
      className="dc-month-holiday"
      title={`${holiday.name}: banks and the payment system are closed. Distributions payable today are paid on the next business day, ${nextDay}.`}
    >
      <strong>{holiday.name}</strong>
      <span>Bank holiday &middot; payments move to the next business day ({nextDay})</span>
    </div>
  )
}

export function DividendMonthDayCell({ cell, today, showOutsideEvents = false }) {
  const dailyIncome = cell.payments.reduce((sum, ev) => sum + calendarPaymentIncome(ev), 0)
  const isToday = cell.key === today
  const showEvents = cell.currentMonth || showOutsideEvents
  const showTotal = showEvents && dailyIncome > 0
  const holiday = showEvents ? cell.holiday : null

  return (
    <div
      className={`dc-month-cell${cell.currentMonth ? '' : ' outside'}${isToday ? ' today' : ''}${holiday ? ' holiday' : ''}`}
      role="gridcell"
      aria-label={`${cell.date.toLocaleDateString()}: ${holiday ? `${holiday.name}, bank holiday, ` : ''}${cell.payments.length} dividend payments`}
    >
      <div className="dc-month-cell-head">
        <span className="dc-month-day-number">{cell.date.getDate()}</span>
        {showTotal && (
          <span className="dc-month-day-total">+{formatMoney(dailyIncome)}</span>
        )}
      </div>
      {holiday && <DividendHolidayNote holiday={holiday} />}
      {showEvents && (
        <div className="dc-month-cell-events">
          {cell.payments.map((ev, index) => (
            <DividendMonthEvent
              key={`${cell.key}-${ev.ticker}-${index}`}
              ev={ev}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function DividendMonthWeekdays({ withWeekTotal = false }) {
  const headers = WEEKDAYS.map(day => (
    <div key={day} className="dc-month-weekday" role="columnheader">{day}</div>
  ))
  if (!withWeekTotal) return headers
  return [
    ...headers,
    <div key="week" className="dc-month-weekday dc-month-week-head" role="columnheader">Week</div>,
  ]
}

function shortDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function DividendMonthWeekTotal({ week, monthIncome, today }) {
  const hasIncome = week.income > 0
  const share = monthIncome > 0 ? Math.min(1, week.income / monthIncome) : 0
  const isCurrentWeek = Boolean(today && week.days.some(cell => cell.key === today))
  const range = week.firstKey === week.lastKey
    ? shortDate(week.firstKey)
    : `${shortDate(week.firstKey)} – ${shortDate(week.lastKey)}`
  const summary = hasIncome
    ? `${week.paymentCount} payment${week.paymentCount !== 1 ? 's' : ''} · ${week.paymentDays} day${week.paymentDays !== 1 ? 's' : ''}`
    : 'No payments'

  return (
    <div
      className={`dc-month-cell dc-month-week-total${isCurrentWeek ? ' current' : ''}${hasIncome ? '' : ' empty'}`}
      role="gridcell"
      aria-label={`Week of ${range}: ${formatMoney(week.income)} from ${summary.toLowerCase()}`}
      title={`${range}\n${formatMoney(week.income)} · ${summary}${hasIncome && monthIncome > 0 ? `\n${(share * 100).toFixed(1)}% of the month` : ''}`}
    >
      <div className="dc-month-cell-head">
        <span className="dc-month-week-range">{range}</span>
      </div>
      <strong className="dc-month-week-amount">{hasIncome ? `+${formatMoney(week.income)}` : formatMoney(0)}</strong>
      <span className="dc-month-week-meta">{summary}</span>
      {hasIncome && monthIncome > 0 && (
        <div className="dc-month-week-share">
          <div className="dc-month-week-bar" aria-hidden="true">
            <i style={{ width: `${(share * 100).toFixed(1)}%` }} />
          </div>
          <span>{Math.round(share * 100)}% of month</span>
        </div>
      )}
    </div>
  )
}

export function DividendMonthLegend() {
  return (
    <div className="dc-month-legend">
      <span><i className="confirmed">{'\u2713'}</i> confirmed pay date and declared amount</span>
      <span><i className="estimated">~</i> estimated date or amount; hover for details</span>
      <span><i className="holiday" aria-hidden="true" /> bank holiday: payments due that day are paid the next business day</span>
      <span>Tickers and amounts follow the selected account; aggregate views combine only their configured members.</span>
    </div>
  )
}

export function DividendWeekGrid({ cells, today, ariaLabel }) {
  return (
    <div className="dc-month-scroll">
      <div className="dc-month-grid dc-week-grid" role="grid" aria-label={ariaLabel}>
        <DividendMonthWeekdays />
        {cells.map(cell => (
          <DividendMonthDayCell
            key={cell.key}
            cell={cell}
            today={today}
            showOutsideEvents
          />
        ))}
      </div>
    </div>
  )
}
