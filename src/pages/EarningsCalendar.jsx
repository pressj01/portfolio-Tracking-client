import React, { useState, useEffect, useMemo } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'next30', label: 'Next 30 Days' },
  { key: 'past30', label: 'Past 30 Days' },
  { key: 'all', label: 'All' },
]

const EARN_CAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function readCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached?.ts || Date.now() - cached.ts > EARN_CAL_CACHE_TTL_MS) {
      localStorage.removeItem(key)
      return null
    }
    return cached.data || null
  } catch {
    return null
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // best-effort
  }
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtEps(val) {
  if (val === null || val === undefined) return '—'
  const n = Number(val)
  if (Number.isNaN(n)) return '—'
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`
}

function fmtPct(val) {
  if (val === null || val === undefined) return null
  const n = Number(val)
  if (Number.isNaN(n)) return null
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

export default function EarningsCalendar() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [events, setEvents] = useState([])
  const [today, setToday] = useState('')
  const [filter, setFilter] = useState('upcoming')
  const [loading, setLoading] = useState(true)
  const cacheKey = useMemo(() => `portfolio_earnings_calendar_${selection}`, [selection])

  useEffect(() => {
    let stale = false
    const cached = readCache(cacheKey)
    if (cached) {
      setEvents(cached.events || [])
      setToday(cached.today || new Date().toISOString().slice(0, 10))
      setLoading(false)
    } else {
      setEvents([])
      setToday('')
      setLoading(true)
    }
    pf('/api/earnings-calendar')
      .then(r => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then(data => {
        if (stale) return
        setEvents(data.events || [])
        setToday(data.today || new Date().toISOString().slice(0, 10))
        writeCache(cacheKey, {
          events: data.events || [],
          today: data.today || new Date().toISOString().slice(0, 10),
        })
        setLoading(false)
      })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [pf, selection, cacheKey])

  const filtered = useMemo(() => {
    if (!today) return events
    const next30end = addDays(today, 30)
    const past30start = addDays(today, -30)
    return events.filter(ev => {
      const d = ev.date
      if (filter === 'all') return true
      if (filter === 'upcoming') return ev.is_upcoming
      if (filter === 'next30') return ev.is_upcoming && d <= next30end
      if (filter === 'past30') return !ev.is_upcoming && d >= past30start
      return true
    })
  }, [events, filter, today])

  if (loading) return <div style={{ padding: '2rem', color: '#8899aa' }}>Loading earnings calendar...</div>

  return (
    <div className="dc-page ec-page">
      <h1 className="dc-title">Earnings Calendar</h1>
      <p className="dc-subtitle">Upcoming earnings dates for portfolio holdings &mdash; surprises can affect dividend safety</p>

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
        <span className="dc-paydate-note">ETFs without earnings are not shown</span>
      </div>

      {filtered.length === 0 && events.length > 0 && (
        <p style={{ color: '#8899aa', padding: '1rem 0' }}>
          No earnings match this filter.
        </p>
      )}

      {events.length === 0 && (
        <p style={{ color: '#8899aa' }}>
          No earnings dates found for this portfolio. ETFs and funds typically don't report earnings; verify holdings include individual stocks.
        </p>
      )}

      <div className="dc-grid">
        {filtered.map((ev, i) => {
          const surprisePct = fmtPct(ev.last_surprise_pct)
          const beat = ev.last_surprise_pct !== null && ev.last_surprise_pct !== undefined && Number(ev.last_surprise_pct) > 0
          const miss = ev.last_surprise_pct !== null && ev.last_surprise_pct !== undefined && Number(ev.last_surprise_pct) < 0
          const cardColor = ev.color || '#7ecfff'
          const isToday = ev.date === today

          let daysLabel = ''
          if (ev.is_upcoming) {
            if (ev.days_until === 0) daysLabel = 'today'
            else if (ev.days_until === 1) daysLabel = 'tomorrow'
            else if (ev.days_until !== null && ev.days_until !== undefined) daysLabel = `in ${ev.days_until} days`
          }

          return (
            <div
              key={`${ev.ticker}-${ev.date}-${i}`}
              className={`dc-card ec-card${isToday ? ' dc-today' : ''}${ev.is_upcoming ? '' : ' ec-past'}`}
              style={{ borderLeftColor: cardColor }}
            >
              <div className="dc-date-col">
                <span className="dc-day">{ev.day}</span>
                <span className="dc-month">{ev.month}</span>
                <span className="dc-wday">{ev.weekday}</span>
              </div>
              <div className="dc-body">
                <div className="dc-label" style={{ color: cardColor }}>
                  {ev.is_upcoming ? 'Next Earnings' : 'Last Earnings'}
                  {daysLabel && <span className="ec-days"> &middot; {daysLabel}</span>}
                </div>
                <div className="dc-ticker-row">
                  <div
                    className="dc-icon"
                    style={{ background: cardColor + '22', color: cardColor }}
                  >
                    {ev.ticker[0]}
                  </div>
                  <div className="dc-ticker-info">
                    <span className="dc-ticker">{ev.ticker}</span>
                    <span className="dc-desc">
                      {(ev.description || '').length > 45
                        ? ev.description.slice(0, 45) + '…'
                        : (ev.description || '')}
                    </span>
                  </div>
                </div>
                <div className="dc-dates-row">
                  {ev.eps_estimate !== null && ev.eps_estimate !== undefined && (
                    <div className="dc-date-chip" style={{ borderTopColor: cardColor }}>
                      <span className="dc-chip-label">EPS Est</span>
                      <span className="dc-chip-val" style={{ color: cardColor }}>{fmtEps(ev.eps_estimate)}</span>
                    </div>
                  )}
                  {ev.last_eps_actual !== null && ev.last_eps_actual !== undefined && (
                    <div
                      className="dc-date-chip"
                      style={{ borderTopColor: beat ? '#00e89a' : (miss ? '#e05555' : '#334455') }}
                    >
                      <span className="dc-chip-label">Last Actual</span>
                      <span
                        className="dc-chip-val"
                        style={{ color: beat ? '#00e89a' : (miss ? '#e05555' : '#b0c0d0'), fontWeight: 600 }}
                      >
                        {fmtEps(ev.last_eps_actual)}
                      </span>
                    </div>
                  )}
                  {ev.last_eps_estimate !== null && ev.last_eps_estimate !== undefined && (
                    <div className="dc-date-chip" style={{ borderTopColor: '#334455' }}>
                      <span className="dc-chip-label">Last Est</span>
                      <span className="dc-chip-val">{fmtEps(ev.last_eps_estimate)}</span>
                    </div>
                  )}
                </div>
                <div className="dc-amount ec-meta">
                  {surprisePct && (
                    <span className={beat ? 'ec-beat' : (miss ? 'ec-miss' : '')}>
                      {beat ? '▲' : (miss ? '▼' : '')} {surprisePct} surprise
                    </span>
                  )}
                  {ev.last_date_label && (
                    <span className="dc-freq">
                      {surprisePct ? ' · ' : ''}prior: {ev.last_date_label}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
