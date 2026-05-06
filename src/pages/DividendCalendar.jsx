import React, { useState, useEffect, useMemo } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'next30', label: 'Next 30 Days' },
]

const TABS = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'optimization', label: 'Optimization' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const CANDIDATE_PROVIDERS = [
  { name: 'NEOs', note: 'primary candidate source' },
  { name: 'TAPPALPHA', note: 'primary candidate source' },
  { name: 'X Funds', note: 'primary candidate source' },
  { name: 'Tuttle funds', note: 'primary candidate source' },
  { name: 'Kurv funds', note: 'primary candidate source' },
  { name: 'Amplify', note: 'primary candidate source' },
  { name: 'Shelton SEPI', note: 'primary candidate source' },
  { name: 'YieldMax', note: 'primary candidate source' },
  { name: 'REX Shares', note: 'secondary source' },
]

const SEEDED_CANDIDATES = [
  { ticker: 'SPYI', provider: 'NEOS' },
  { ticker: 'QQQI', provider: 'NEOS' },
  { ticker: 'IWMI', provider: 'NEOS' },
  { ticker: 'IYRI', provider: 'NEOS' },
  { ticker: 'BTCI', provider: 'NEOS' },
  { ticker: 'IAUI', provider: 'NEOS' },
  { ticker: 'HYBI', provider: 'NEOS' },
  { ticker: 'CSHI', provider: 'NEOS' },
  { ticker: 'QQQH', provider: 'NEOS' },
  { ticker: 'SPYH', provider: 'NEOS' },
  { ticker: 'XQQI', provider: 'NEOS' },
  { ticker: 'XSPI', provider: 'NEOS' },
  { ticker: 'TSPY', provider: 'TAPPALPHA' },
  { ticker: 'TDAQ', provider: 'TAPPALPHA' },
  { ticker: 'TDAX', provider: 'TAPPALPHA' },
  { ticker: 'TSYX', provider: 'TAPPALPHA' },
  { ticker: 'GIAX', provider: 'X Funds' },
  { ticker: 'BLOX', provider: 'X Funds' },
  { ticker: 'FIAX', provider: 'X Funds' },
  { ticker: 'WEPN', provider: 'X Funds' },
  { ticker: 'NUKX', provider: 'X Funds' },
  { ticker: 'GLDN', provider: 'X Funds' },
  { ticker: 'SPCI', provider: 'Tuttle funds' },
  { ticker: 'MEMY', provider: 'Tuttle funds' },
  { ticker: 'MAGO', provider: 'Tuttle funds' },
  { ticker: 'BITK', provider: 'Tuttle funds' },
  { ticker: 'KQQQ', provider: 'Kurv funds' },
  { ticker: 'KSLV', provider: 'Kurv funds' },
  { ticker: 'KCOP', provider: 'Kurv funds' },
  { ticker: 'AMZP', provider: 'Kurv funds' },
  { ticker: 'GOOP', provider: 'Kurv funds' },
  { ticker: 'MSFY', provider: 'Kurv funds' },
  { ticker: 'NFLP', provider: 'Kurv funds' },
  { ticker: 'TSLP', provider: 'Kurv funds' },
  { ticker: 'BAGY', provider: 'Amplify' },
  { ticker: 'BITY', provider: 'Amplify' },
  { ticker: 'DIVO', provider: 'Amplify' },
  { ticker: 'QDVO', provider: 'Amplify' },
  { ticker: 'IDVO', provider: 'Amplify' },
  { ticker: 'HCOW', provider: 'Amplify' },
  { ticker: 'HAKY', provider: 'Amplify' },
  { ticker: 'ETTY', provider: 'Amplify' },
  { ticker: 'SLJY', provider: 'Amplify' },
  { ticker: 'SEPI', provider: 'Shelton SEPI' },
  { ticker: 'GPTY', provider: 'YieldMax' },
  { ticker: 'CHPY', provider: 'YieldMax' },
  { ticker: 'SOXY', provider: 'YieldMax' },
  { ticker: 'BIGY', provider: 'YieldMax' },
  { ticker: 'ULTY', provider: 'YieldMax' },
  { ticker: 'YMAX', provider: 'YieldMax' },
  { ticker: 'YMAG', provider: 'YieldMax' },
  { ticker: 'FEPI', provider: 'REX Shares' },
  { ticker: 'AIPI', provider: 'REX Shares' },
  { ticker: 'CEPI', provider: 'REX Shares' },
  { ticker: 'ULTI', provider: 'REX Shares' },
]

const SEEDED_PROVIDER_BY_TICKER = new Map(SEEDED_CANDIDATES.map(c => [c.ticker, c.provider]))

const DIV_CAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function readCalendarCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached?.ts || Date.now() - cached.ts > DIV_CAL_CACHE_TTL_MS) {
      localStorage.removeItem(key)
      return null
    }
    return cached.data || null
  } catch {
    return null
  }
}

function writeCalendarCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // Cache writes are best-effort; the live request remains the source of truth.
  }
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function addMonths(date, n) {
  const d = new Date(date)
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() !== day) d.setDate(0)
  return d
}

function addFreqCycle(date, freq) {
  const f = String(freq || '').toUpperCase()
  const d = new Date(date)
  if (f === '52' || f === 'W') {
    d.setDate(d.getDate() + 7)
    return d
  }
  if (f === 'M') return addMonths(d, 1)
  if (f === 'Q') return addMonths(d, 3)
  if (f === 'SA' || f === 'S') return addMonths(d, 6)
  if (f === 'A') return addMonths(d, 12)
  return addMonths(d, 1)
}

function paymentsPerYear(freq) {
  const f = String(freq || '').toUpperCase()
  if (f === '52' || f === 'W') return 52
  if (f === 'M') return 12
  if (f === 'Q') return 4
  if (f === 'SA' || f === 'S') return 2
  if (f === 'A') return 1
  return 12
}

function money(n, digits = 0) {
  const value = Number(n || 0)
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatPct(n) {
  if (!Number.isFinite(n)) return '0%'
  return `${Math.round(n)}%`
}

function formatPct1(n) {
  if (!Number.isFinite(Number(n))) return '-'
  return `${Number(n).toFixed(1)}%`
}

function formatShares(n) {
  if (!Number.isFinite(Number(n))) return '-'
  return Math.ceil(Number(n)).toLocaleString()
}

function estimatePaymentIncome(ev) {
  const annual = Number(ev.annual_income || 0)
  if (annual > 0) return annual / paymentsPerYear(ev.freq)
  const amount = Number(ev.amount || ev.dividend_paid || 0)
  const qty = Number(ev.quantity || 0)
  return amount > 0 && qty > 0 ? amount * qty : 0
}

function estimateAnnualYieldPct(amount, freq, price) {
  const amt = Number(amount || 0)
  const px = Number(price || 0)
  if (amt <= 0 || px <= 0) return null
  return (amt * paymentsPerYear(freq) / px) * 100
}

function providerForCandidate(ticker, description = '') {
  const t = String(ticker || '').trim().toUpperCase()
  const desc = String(description || '').toLowerCase()
  if (SEEDED_PROVIDER_BY_TICKER.has(t)) return SEEDED_PROVIDER_BY_TICKER.get(t)
  if (desc.includes('neos')) return 'NEOS'
  if (desc.includes('tappalpha') || desc.includes('tapp alpha') || desc.includes('tapalpha')) return 'TAPPALPHA'
  if (desc.includes('nicholas') || desc.includes('xfunds') || desc.includes('x funds')) return 'X Funds'
  if (desc.includes('tuttle')) return 'Tuttle funds'
  if (desc.includes('kurv') || desc.includes('kurve')) return 'Kurv funds'
  if (desc.includes('amplify')) return 'Amplify'
  if (t === 'SEPI' || desc.includes('shelton')) return 'Shelton SEPI'
  if (desc.includes('yieldmax')) return 'YieldMax'
  if (desc.includes('rex ' ) || desc.includes('rex shares') || desc.includes('rexshares')) return 'REX Shares'
  return null
}

function freqLabel(freq) {
  const f = String(freq || '').toUpperCase()
  if (f === '52' || f === 'W') return 'Weekly'
  if (f === 'M') return 'Monthly'
  if (f === 'Q') return 'Quarterly'
  if (f === 'SA' || f === 'S') return 'Semiannual'
  if (f === 'A') return 'Annual'
  return freq || '-'
}

function buildCandidateRecommendations(data, events, watchlistRows = [], candidateRows = []) {
  const watchlist = new Set((watchlistRows || []).map(r => String(r.ticker || '').toUpperCase()))
  const weakKeys = new Set(data.targetMonths.map(m => m.key))
  const gapByKey = new Map(data.months.map(m => [m.key, Math.max(0, data.average - m.income)]))
  const byTicker = new Map()
  const monthByKey = new Map(data.months.map(m => [m.key, m]))
  const startMonth = data.months.length
    ? new Date(`${data.months[0].key}-01T00:00:00`)
    : new Date()
  const endMonth = addMonths(startMonth, 12)

  function ensureCandidate(ticker, provider, fields = {}) {
    if (!ticker || !provider) return null
    if (!byTicker.has(ticker)) {
      byTicker.set(ticker, {
        ticker,
        provider,
        description: fields.description || '',
        freq: fields.freq || '',
        amount: Number(fields.amount || 0),
        currentPrice: Number(fields.current_price || fields.currentPrice || 0),
        annualYieldPct: fields.annual_yield_pct != null
          ? Number(fields.annual_yield_pct)
          : estimateAnnualYieldPct(fields.amount, fields.freq, fields.current_price || fields.currentPrice),
        payMonths: new Set(),
        perShareByMonth: new Map(),
        helps: [],
        coverage: 0,
        totalContribution: 0,
        owned: !!fields.owned,
        ownedQuantity: Number(fields.owned_quantity || fields.ownedQuantity || 0),
        watchlist: watchlist.has(ticker) || !!fields.watchlist,
        hasSchedule: !!fields.has_schedule,
      })
    }
    const candidate = byTicker.get(ticker)
    candidate.provider = candidate.provider || provider
    candidate.description = candidate.description || fields.description || ''
    candidate.freq = candidate.freq || fields.freq || ''
    candidate.amount = candidate.amount || Number(fields.amount || 0)
    candidate.currentPrice = candidate.currentPrice || Number(fields.current_price || fields.currentPrice || 0)
    candidate.annualYieldPct = candidate.annualYieldPct ?? (
      fields.annual_yield_pct != null
        ? Number(fields.annual_yield_pct)
        : estimateAnnualYieldPct(candidate.amount, candidate.freq, candidate.currentPrice)
    )
    candidate.owned = candidate.owned || !!fields.owned
    candidate.ownedQuantity = Math.max(candidate.ownedQuantity || 0, Number(fields.owned_quantity || fields.ownedQuantity || 0))
    candidate.watchlist = candidate.watchlist || watchlist.has(ticker) || !!fields.watchlist
    candidate.hasSchedule = candidate.hasSchedule || !!fields.has_schedule
    return candidate
  }

  events.forEach(ev => {
    const ticker = String(ev.ticker || '').toUpperCase()
    const provider = providerForCandidate(ticker, ev.description)
    if (!ticker || !provider) return
    ensureCandidate(ticker, provider, {
      description: ev.description || '',
      freq: ev.freq,
      amount: ev.amount,
      current_price: ev.current_price,
      owned: true,
      owned_quantity: ev.quantity,
      has_schedule: true,
    })
  })

  candidateRows.forEach(row => {
    const ticker = String(row.ticker || '').toUpperCase()
    const provider = row.provider || providerForCandidate(ticker, row.description)
    const candidate = ensureCandidate(ticker, provider, row)
    if (!candidate || !row.pay_date || !row.freq || !row.amount) return
    let d = new Date(row.pay_date + 'T00:00:00')
    let guard = 0
    while (d < startMonth && guard < 80) {
      d = addFreqCycle(d, row.freq)
      guard += 1
    }
    while (d < endMonth && guard < 160) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const month = monthByKey.get(key)
      if (month) {
        candidate.payMonths.add(month.label)
        candidate.perShareByMonth.set(
          month.label,
          (candidate.perShareByMonth.get(month.label) || 0) + Number(row.amount || 0),
        )
        if (weakKeys.has(key) && !candidate.helps.includes(month.label)) {
          candidate.helps.push(month.label)
        }
      }
      d = addFreqCycle(d, row.freq)
      guard += 1
    }
  })

  data.months.forEach(month => {
    month.tickers.forEach((amount, tickerRaw) => {
      const ticker = String(tickerRaw || '').toUpperCase()
      const candidate = byTicker.get(ticker)
      if (!candidate) return
      candidate.payMonths.add(month.label)
      candidate.totalContribution += amount
      const perShareAmount = Number(candidate.amount || 0)
      if (perShareAmount > 0 && !candidate.perShareByMonth.has(month.label)) {
        candidate.perShareByMonth.set(month.label, perShareAmount)
      }
      if (weakKeys.has(month.key)) {
        const gap = gapByKey.get(month.key) || 0
        if (!candidate.helps.includes(month.label)) candidate.helps.push(month.label)
        candidate.coverage += Math.min(gap, amount)
      }
    })
  })

  const recommendations = Array.from(byTicker.values())
    .filter(c => c.helps.length > 0)
    .map(c => {
      const helped = data.months.filter(m => c.helps.includes(m.label))
      const targetMonth = helped.reduce((max, m) => {
        const gap = Math.max(0, data.average - m.income)
        const maxGap = max ? Math.max(0, data.average - max.income) : -1
        return gap > maxGap ? m : max
      }, null)
      const targetShortfall = targetMonth ? Math.max(0, data.average - targetMonth.income) : 0
      const distributionPerShareInMonth = Number(c.perShareByMonth.get(targetMonth?.label) || c.amount || 0)
      const sharesNeeded = distributionPerShareInMonth > 0 ? targetShortfall / distributionPerShareInMonth : null
      const currentPrice = Number(c.currentPrice || 0)
      return {
        ...c,
        payMonths: Array.from(c.payMonths),
        targetMonth: targetMonth?.label || '',
        targetShortfall,
        distributionPerShareInMonth,
        sharesNeeded,
        estimatedCost: sharesNeeded != null && currentPrice > 0 ? sharesNeeded * currentPrice : null,
        score: (c.coverage || targetShortfall) + c.helps.length * 100,
      }
    })
    .sort((a, b) => b.score - a.score)

  const known = new Set(recommendations.map(c => c.ticker))
  const tracked = SEEDED_CANDIDATES.map(seed => {
    const ev = events.find(item => String(item.ticker || '').toUpperCase() === seed.ticker)
    const meta = candidateRows.find(item => String(item.ticker || '').toUpperCase() === seed.ticker)
    const recommended = known.has(seed.ticker)
    return {
      ...seed,
      status: recommended ? 'Schedule fit' : ev || meta?.has_schedule ? 'Known schedule' : watchlist.has(seed.ticker) ? 'Watchlist, needs schedule' : 'Needs schedule',
      watchlist: watchlist.has(seed.ticker),
    }
  })

  return { recommendations, tracked }
}

function buildOptimization(events, todayIso) {
  const start = todayIso ? new Date(todayIso + 'T00:00:00') : new Date()
  const startMonth = new Date(start.getFullYear(), start.getMonth(), 1)
  const end = addMonths(startMonth, 12)
  const months = Array.from({ length: 12 }, (_, idx) => {
    const d = addMonths(startMonth, idx)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: MONTHS[d.getMonth()],
      year: d.getFullYear(),
      monthIndex: d.getMonth(),
      income: 0,
      tickers: new Map(),
    }
  })
  const byKey = new Map(months.map(m => [m.key, m]))

  events.forEach(ev => {
    const payDate = ev.pay_date || ev.date
    if (!payDate) return
    const paymentIncome = estimatePaymentIncome(ev)
    if (paymentIncome <= 0) return
    let d = new Date(payDate + 'T00:00:00')
    let guard = 0
    while (d < startMonth && guard < 80) {
      d = addFreqCycle(d, ev.freq)
      guard += 1
    }
    while (d < end && guard < 160) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const bucket = byKey.get(key)
      if (bucket) {
        bucket.income += paymentIncome
        bucket.tickers.set(ev.ticker, (bucket.tickers.get(ev.ticker) || 0) + paymentIncome)
      }
      d = addFreqCycle(d, ev.freq)
      guard += 1
    }
  })

  const projectedTotal = months.reduce((sum, m) => sum + m.income, 0)
  const annualTarget = events.reduce((sum, ev) => {
    const annual = Number(ev.annual_income || 0)
    if (annual > 0) return sum + annual
    return sum + estimatePaymentIncome(ev) * paymentsPerYear(ev.freq)
  }, 0)
  if (projectedTotal > 0 && annualTarget > 0) {
    const scale = annualTarget / projectedTotal
    months.forEach(m => {
      m.income *= scale
      m.tickers.forEach((value, ticker) => {
        m.tickers.set(ticker, value * scale)
      })
    })
  }

  months.forEach(m => {
    m.income = Math.round(m.income * 100) / 100
    m.tickerList = Array.from(m.tickers.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([ticker]) => ticker)
  })

  const total = months.reduce((sum, m) => sum + m.income, 0)
  const average = total / 12
  const lows = months.filter(m => m.income < average).sort((a, b) => (average - b.income) - (average - a.income))
  const lowest = months.reduce((min, m) => (m.income < min.income ? m : min), months[0])
  const highest = months.reduce((max, m) => (m.income > max.income ? m : max), months[0])
  const totalGap = months.reduce((sum, m) => sum + Math.max(0, average - m.income), 0)
  const targetMonths = lows.slice(0, 4)

  return { months, average, lowest, highest, totalGap, targetMonths }
}

export default function DividendCalendar() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [events, setEvents] = useState([])
  const [watchlistRows, setWatchlistRows] = useState([])
  const [candidateRows, setCandidateRows] = useState([])
  const [today, setToday] = useState('')
  const [filter, setFilter] = useState('all')
  const [tab, setTab] = useState('calendar')
  const [loading, setLoading] = useState(true)
  const cacheKey = useMemo(() => `portfolio_div_calendar_v3_${selection}`, [selection])

  useEffect(() => {
    let stale = false
    const cached = readCalendarCache(cacheKey)
    if (cached) {
      setEvents(cached.events || [])
      setToday(cached.today || new Date().toISOString().slice(0, 10))
      setLoading(false)
    } else {
      setEvents([])
      setToday('')
      setLoading(true)
    }
    pf('/api/div-calendar')
      .then(r => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json()
      })
      .then(data => {
        if (stale) return
        setEvents(data.events || [])
        setToday(data.today || new Date().toISOString().slice(0, 10))
        writeCalendarCache(cacheKey, {
          events: data.events || [],
          today: data.today || new Date().toISOString().slice(0, 10),
        })
        setLoading(false)
      })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [pf, selection, cacheKey])

  useEffect(() => {
    let stale = false
    pf('/api/watchlist/watching')
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(data => {
        if (!stale) setWatchlistRows(data.rows || [])
      })
      .catch(() => { if (!stale) setWatchlistRows([]) })
    return () => { stale = true }
  }, [pf, selection])

  useEffect(() => {
    let stale = false
    pf('/api/div-calendar/candidates')
      .then(r => r.ok ? r.json() : { candidates: [] })
      .then(data => {
        if (!stale) setCandidateRows(data.candidates || [])
      })
      .catch(() => { if (!stale) setCandidateRows([]) })
    return () => { stale = true }
  }, [pf, selection])

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

  const optimization = useMemo(() => buildOptimization(events, today), [events, today])

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

      <div className="dc-tabs" role="tablist" aria-label="Dividend calendar views">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`dc-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'calendar' && (
        <>
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
        </>
      )}

      {tab === 'optimization' && (
        <DividendOptimization data={optimization} events={events} watchlistRows={watchlistRows} candidateRows={candidateRows} />
      )}
    </div>
  )
}

function DividendOptimization({ data, events, watchlistRows, candidateRows }) {
  const maxIncome = Math.max(...data.months.map(m => m.income), 1)
  const hasIncome = data.months.some(m => m.income > 0)
  const weakMonths = data.targetMonths
  const candidates = useMemo(
    () => buildCandidateRecommendations(data, events, watchlistRows, candidateRows),
    [data, events, watchlistRows, candidateRows],
  )

  if (!hasIncome) {
    return (
      <div className="dc-opt-empty">
        No dividend income estimates are available yet. Refresh dividend metadata or import annual income and payment amounts first.
      </div>
    )
  }

  return (
    <div className="dc-opt">
      <div className="dc-opt-stats">
        <OptStat label="Average monthly income" value={money(data.average)} />
        <OptStat label="Lowest month" value={`${data.lowest.label} ${money(data.lowest.income)}`} tone="low" />
        <OptStat label="Highest month" value={`${data.highest.label} ${money(data.highest.income)}`} tone="high" />
        <OptStat label="Total shortfall" value={money(data.totalGap)} tone={data.totalGap > 0 ? 'low' : 'high'} />
      </div>

      <section className="dc-opt-panel">
        <div className="dc-opt-head">
          <h2>12-Month Income Smoothing</h2>
          <p>Projected from current pay dates and reconciled to the portfolio's estimated annual income.</p>
        </div>
        <div className="dc-heatmap" aria-label="Projected dividend income by month">
          {data.months.map(m => {
            const ratio = maxIncome > 0 ? m.income / maxIncome : 0
            const gap = Math.max(0, data.average - m.income)
            const status = gap <= 0 ? 'strong' : gap / data.average > 0.25 ? 'gap' : 'soft'
            return (
              <div key={m.key} className={`dc-heat-cell ${status}`} style={{ '--heat': ratio }}>
                <span className="dc-heat-month">{m.label}</span>
                <span className="dc-heat-income">{money(m.income)}</span>
                <span className="dc-heat-gap">{gap > 0 ? `${formatPct((gap / data.average) * 100)} below avg` : 'above avg'}</span>
              </div>
            )
          })}
        </div>
      </section>

      <div className="dc-opt-layout">
        <section className="dc-opt-panel">
          <div className="dc-opt-head">
            <h2>Shortfall Months</h2>
            <p>Months below your projected average monthly dividend income.</p>
          </div>
          <div className="dc-gap-table-wrap">
            <table className="dc-gap-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Projected</th>
                  <th>Shortfall to avg</th>
                  <th>Top current payers</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map(m => {
                  const gap = Math.max(0, data.average - m.income)
                  return (
                    <tr key={m.key} className={gap > 0 ? 'dc-gap-row' : ''}>
                      <td>{m.label}</td>
                      <td>{money(m.income)}</td>
                      <td>{gap > 0 ? money(gap) : 'On target'}</td>
                      <td>{m.tickerList.length ? m.tickerList.slice(0, 8).join(', ') : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="dc-opt-panel">
          <div className="dc-opt-head">
            <h2>Suggestions</h2>
            <p>Target months before choosing specific tickers.</p>
          </div>
          <div className="dc-suggestion-list">
            {weakMonths.length === 0 && (
              <div className="dc-suggestion good">Your projected calendar is already at or above average in every month.</div>
            )}
            {weakMonths.map(m => {
              const gap = Math.max(0, data.average - m.income)
              return (
                <div key={m.key} className="dc-suggestion">
                  <strong>{m.label} is {formatPct((gap / data.average) * 100)} below your monthly average.</strong>
                  <span>{m.label} needs about {money(gap)} more estimated income to match your average month.</span>
                </div>
              )
            })}
            {weakMonths.length > 0 && (
              <div className="dc-suggestion">
                <strong>Look for payers with {weakMonths.map(m => m.label).join('/')} payment schedules.</strong>
                <span>Monthly, quarterly, and semiannual funds are the first pass for reducing those shortfalls.</span>
              </div>
            )}
          </div>

        </section>
      </div>

      <section className="dc-opt-panel">
        <CandidateRecommendations candidates={candidates} weakMonths={weakMonths} />
      </section>

      <div className="dc-opt-footnote">
        Projection uses {events.length} calendar event{events.length !== 1 ? 's' : ''}; confirmed and estimated pay dates are both included.
      </div>
    </div>
  )
}

function OptStat({ label, value, tone }) {
  return (
    <div className={`dc-opt-stat ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CandidateRecommendations({ candidates, weakMonths }) {
  const top = candidates.recommendations.slice(0, 10)
  const trackedPreview = candidates.tracked
  const targetLabel = weakMonths.length ? weakMonths.map(m => m.label).join(', ') : 'No shortfall months'

  return (
    <div className="dc-candidate-panel">
      <div className="dc-candidate-head">
        <div>
          <h3>Schedule-Fit Candidates</h3>
          <p>
            What-if math only, not a buy signal. Ranked by known schedules that overlap the current shortfall months: {targetLabel}.
          </p>
        </div>
      </div>

      {top.length > 0 ? (
        <div className="dc-candidate-table-wrap">
          <table className="dc-candidate-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Provider</th>
                <th>Freq</th>
                <th>Helps</th>
                <th>Distribution/share</th>
                <th>Yield</th>
                <th>Shares needed to fill the gap</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {top.map(c => (
                <tr key={c.ticker}>
                  <td>
                    <strong>{c.ticker}</strong>
                    <span>{c.owned ? 'Owned' : c.watchlist ? 'Watchlist' : 'Known'}</span>
                  </td>
                  <td>{c.provider}</td>
                  <td>{freqLabel(c.freq)}</td>
                  <td>
                    {c.helps.join(', ')}
                    {c.targetMonth && <span>basis: {c.targetMonth} {money(c.targetShortfall)}</span>}
                  </td>
                  <td>
                    {c.distributionPerShareInMonth ? money(c.distributionPerShareInMonth, 4) : '-'}
                    {c.targetMonth && c.distributionPerShareInMonth !== c.amount && (
                      <span>{c.targetMonth} total/share</span>
                    )}
                  </td>
                  <td>{formatPct1(c.annualYieldPct)}</td>
                  <td>{formatShares(c.sharesNeeded)}</td>
                  <td>{c.estimatedCost != null ? money(c.estimatedCost) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dc-suggestion">
          <strong>No known candidates match the shortfall months yet.</strong>
          <span>Add candidates to holdings or watchlist, refresh dividend metadata, then this panel can score their pay schedules.</span>
        </div>
      )}

      <div className="dc-universe-block">
        <h3>Candidate Universe</h3>
        <div className="dc-provider-grid">
          {CANDIDATE_PROVIDERS.map(provider => (
            <div key={provider.name} className="dc-provider-chip">
              <span>{provider.name}</span>
              <small>{provider.note}</small>
            </div>
          ))}
        </div>
        <div className="dc-tracked-grid">
          {trackedPreview.map(item => (
            <div key={item.ticker} className={`dc-tracked-chip ${item.status === 'Needs schedule' ? 'needs' : ''}`}>
              <strong>{item.ticker}</strong>
              <span>{item.provider}</span>
              <small>{item.status}</small>
            </div>
          ))}
        </div>
        <p>
          Tickers without schedule data are tracked as candidates, but this panel only ranks funds with known pay dates. Use it to identify months and schedules to research before deciding whether to buy or add shares.
        </p>
      </div>
    </div>
  )
}
