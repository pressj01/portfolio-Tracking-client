import { formatMoney } from '../utils/money'
import {
  WEEKDAYS,
  calendarPaymentIncome,
  currentYieldPct,
} from '../utils/dividendCalendar'

export function DividendMonthEvent({ ev }) {
  const payment = calendarPaymentIncome(ev)
  const yieldPct = currentYieldPct(ev)
  const estimated = ev.calendar_estimated ?? (ev.pay_estimated || ev.calendar_projected)
  const description = ev.description || 'Dividend payment'

  return (
    <div
      className="dc-month-event"
      style={{ borderLeftColor: ev.color || 'var(--teal)' }}
      title={`${ev.ticker} - ${description}\nPayment: ${formatMoney(payment)}\nYield: ${yieldPct == null ? 'Unavailable' : `${yieldPct.toFixed(2)}%`}\nEx-dividend: ${ev.date || 'Unavailable'}\n${estimated ? 'Estimated pay date' : 'Confirmed pay date'}`}
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
          <strong>{formatMoney(payment)}</strong>
          <span
            className={`dc-month-date-status${estimated ? ' estimated' : ' confirmed'}`}
            title={estimated ? 'Estimated pay date' : 'Confirmed pay date'}
            aria-label={estimated ? 'Estimated pay date' : 'Confirmed pay date'}
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

export function DividendMonthDayCell({ cell, today, showOutsideEvents = false }) {
  const dailyIncome = cell.payments.reduce((sum, ev) => sum + calendarPaymentIncome(ev), 0)
  const isToday = cell.key === today
  const showEvents = cell.currentMonth || showOutsideEvents
  const showTotal = showEvents && dailyIncome > 0

  return (
    <div
      className={`dc-month-cell${cell.currentMonth ? '' : ' outside'}${isToday ? ' today' : ''}`}
      role="gridcell"
      aria-label={`${cell.date.toLocaleDateString()}: ${cell.payments.length} dividend payments`}
    >
      <div className="dc-month-cell-head">
        <span className="dc-month-day-number">{cell.date.getDate()}</span>
        {showTotal && (
          <span className="dc-month-day-total">+{formatMoney(dailyIncome)}</span>
        )}
      </div>
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

export function DividendMonthWeekdays() {
  return WEEKDAYS.map(day => (
    <div key={day} className="dc-month-weekday" role="columnheader">{day}</div>
  ))
}

export function DividendMonthLegend() {
  return (
    <div className="dc-month-legend">
      <span><i className="confirmed">{'\u2713'}</i> confirmed pay date</span>
      <span><i className="confirmed">{'\u2713'}</i> matched to imported transaction history</span>
      <span><i className="estimated">~</i> estimated from the current dividend schedule</span>
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
