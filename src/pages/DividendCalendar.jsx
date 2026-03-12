import React, { useState, useEffect, useMemo } from 'react'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'next30', label: 'Next 30 Days' },
]

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function DividendCalendar() {
  const [events, setEvents] = useState([])
  const [today, setToday] = useState('')
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/div-calendar')
      .then(r => r.json())
      .then(data => {
        setEvents(data.events || [])
        setToday(data.today || new Date().toISOString().slice(0, 10))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!today) return events
    const next30end = addDays(today, 30)
    return events.filter(ev => {
      const d = ev.pay_date || ev.date
      if (filter === 'all') return true
      if (filter === 'upcoming') return d >= today
      if (filter === 'next30') return d >= today && d <= next30end
      return true
    })
  }, [events, filter, today])

  // Determine paid status for each card
  const now = today ? new Date(today + 'T00:00:00') : new Date()
  const dow = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((dow + 6) % 7))
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekStartIso = monday.toISOString().slice(0, 10)
  const monthStartIso = monthStart.toISOString().slice(0, 10)

  function getPaidStatus(ev) {
    const pd = ev.pay_date
    if (!pd || pd > today) return null
    if (pd >= weekStartIso) return 'paid this week'
    if (pd >= monthStartIso) return 'paid this month'
    return null
  }

  if (loading) return <div style={{ padding: '2rem', color: '#8899aa' }}>Loading dividend calendar...</div>

  return (
    <div className="dc-page">
      <h1 className="dc-title">Dividend Calendar</h1>
      <p className="dc-subtitle">Ex-dividend &amp; estimated pay dates for portfolio holdings</p>

      <div className="dc-filters">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`dc-filter-btn${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <span className="dc-count">
          {filtered.length} holding{filtered.length !== 1 ? 's' : ''}
        </span>
        <span className="dc-paydate-note">* estimated pay date &nbsp;|&nbsp; no asterisk = confirmed</span>
      </div>

      {filtered.length === 0 && events.length > 0 && (
        <p style={{ color: '#8899aa', padding: '1rem 0' }}>
          No events match this filter.
        </p>
      )}

      {events.length === 0 && (
        <p style={{ color: '#8899aa' }}>No ex-dividend date data found. Import data first.</p>
      )}

      <div className="dc-grid">
        {filtered.map((ev, i) => {
          const paidStatus = getPaidStatus(ev)
          const isPaid = !!paidStatus
          // Color logic: if paid, pay date is green; if not paid, ex-div color matches pay date color
          const cardBorderColor = isPaid ? '#2a6655' : ev.color
          const payChipBorderColor = isPaid ? '#2a6655' : '#00c9a7'

          return (
            <div
              key={`${ev.ticker}-${ev.date}-${i}`}
              className={`dc-card${ev.date === today ? ' dc-today' : ''}${isPaid ? ' dc-paid' : ''}`}
              style={{ borderLeftColor: cardBorderColor }}
            >
              <div className="dc-date-col">
                <span className="dc-day">{ev.day}</span>
                <span className="dc-month">{ev.month}</span>
                <span className="dc-wday">{ev.weekday}</span>
              </div>
              <div className="dc-body">
                <div className="dc-label">Ex-Dividend Date</div>
                <div className="dc-ticker-row">
                  <div
                    className="dc-icon"
                    style={{ background: ev.color + '22', color: ev.color }}
                  >
                    {ev.ticker[0]}
                  </div>
                  <div className="dc-ticker-info">
                    <span className="dc-ticker">{ev.ticker}</span>
                    {isPaid && <span className="dc-paid-badge">✓ {paidStatus}</span>}
                    <span className="dc-desc">
                      {ev.description.length > 45
                        ? ev.description.slice(0, 45) + '…'
                        : ev.description}
                    </span>
                  </div>
                </div>
                <div className="dc-dates-row">
                  <div className="dc-date-chip dc-exdiv-chip" style={{ borderTopColor: isPaid ? '#334455' : ev.color }}>
                    <span className="dc-chip-label">Ex-Div</span>
                    <span className="dc-chip-val" style={{ color: isPaid ? '#b0c0d0' : ev.color }}>
                      {ev.month} {ev.day}
                    </span>
                  </div>
                  <div className="dc-date-chip dc-pay-chip" style={{ borderTopColor: isPaid ? '#2a6655' : ev.color }}>
                    <span className="dc-chip-label">Pay Date</span>
                    <span
                      className="dc-chip-val"
                      style={{ color: isPaid ? '#00e89a' : ev.color, fontWeight: isPaid ? 700 : 600 }}
                    >
                      {ev.pay_month} {ev.pay_day}{ev.pay_estimated ? ' *' : ''}
                    </span>
                  </div>
                </div>
                <div className="dc-amount">
                  {ev.amount !== null && `$${ev.amount}/share`}
                  {ev.freq_label && <span className="dc-freq">, {ev.freq_label}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
