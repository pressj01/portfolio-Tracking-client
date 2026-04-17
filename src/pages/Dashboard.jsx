import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { API_BASE } from '../config'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const DASHBOARD_CACHE_TTL_MS = 15 * 60 * 1000
const SP500_CACHE_KEY = 'portfolio_dashboard_sp500'

function readDashboardCache(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached?.ts || Date.now() - cached.ts > DASHBOARD_CACHE_TTL_MS) {
      sessionStorage.removeItem(key)
      return null
    }
    return cached.data || null
  } catch {
    return null
  }
}

function writeDashboardCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // Cache writes are best-effort; rendering should never depend on storage.
  }
}

const fmt = (v, d = 2) => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (v) => (v == null ? '—' : (Number(v) * 100).toFixed(2) + '%')

function SummaryCard({ label, value, sub, color, className }) {
  return (
    <div className={`summary-card ${className || ''}`}>
      <div className="summary-label">{label}</div>
      <div className="summary-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="summary-sub">{sub}</div>}
    </div>
  )
}

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function UpcomingDividends({ events }) {
  if (!events || events.length === 0) {
    return (
      <div className="upcoming-dividends card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <h3 style={{ color: '#90caf9', marginBottom: '0.5rem', fontSize: '1rem' }}>Upcoming Dividends This Week</h3>
        <p style={{ color: '#8899aa', fontSize: '0.85rem' }}>No ex-dividend dates in the next 7 days.</p>
      </div>
    )
  }

  const totalEst = events.reduce((s, e) => s + e.est_payment, 0)

  return (
    <div className="upcoming-dividends card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ color: '#90caf9', margin: 0, fontSize: '1rem' }}>Upcoming Dividends This Week</h3>
        <span style={{ color: '#4dff91', fontWeight: 700, fontSize: '0.95rem' }}>Est. Total: {fmt(totalEst)}</span>
      </div>
      <div className="upcoming-grid">
        {events.map((e, i) => (
          <div key={i} className="upcoming-event" style={{ borderLeft: `3px solid ${e.color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#7ecfff', fontWeight: 700 }}>{e.ticker}</span>
              <span className="upcoming-freq" style={{ color: e.color }}>{e.freq_label}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#8899aa', marginTop: '0.2rem' }}>
              Ex: {e.ex_weekday} {new Date(e.ex_date + 'T00:00').toLocaleDateString()}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#8899aa' }}>
              Pay: ~{e.pay_weekday} {new Date(e.pay_date + 'T00:00').toLocaleDateString()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>${e.amount}/share</span>
              <span style={{ fontSize: '0.85rem', color: '#4dff91', fontWeight: 600 }}>{fmt(e.est_payment)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const DONUT_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8',
  '#4dd0e1', '#aed581', '#fff176', '#f06292', '#7986cb',
  '#90a4ae', '#a1887f',
]

function PortfolioOverview({ groups, totalValue }) {
  const chartRef = React.useRef(null)

  useEffect(() => {
    if (!groups || !groups.length || !window.Plotly || !chartRef.current) return
    const labels = groups.map(g => g.name)
    const values = groups.map(g => g.value)
    const colors = groups.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length])

    const trace = {
      labels, values,
      type: 'pie', hole: 0.55,
      marker: { colors },
      textinfo: 'none',
      hovertemplate: '%{label}: $%{value:,.2f}<br>%{percent}<extra></extra>',
      sort: false,
    }
    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#16213e', plot_bgcolor: '#16213e',
      margin: { l: 10, r: 10, t: 10, b: 10 },
      showlegend: false,
      height: 220, width: 220,
    }
    window.Plotly.newPlot(chartRef.current, [trace], layout, { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [groups])

  const hasTargets = groups?.some(g => g.target_pct != null)

  if (!groups || !groups.length) return null

  return (
    <div className="portfolio-overview card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
      <h3 style={{ color: '#90caf9', margin: '0 0 0.75rem', fontSize: '1rem' }}>Portfolio</h3>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div ref={chartRef} style={{ width: 220, flexShrink: 0 }} />
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #0f3460' }}>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Name</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Value/Invested</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Gain</th>
                {hasTargets && <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Target</th>}
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Allocation</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => {
                const color = DONUT_COLORS[i % DONUT_COLORS.length]
                const gain = g.value - g.invested
                const gainPct = g.invested ? ((gain / g.invested) * 100) : 0
                const alloc = totalValue ? ((g.value / totalValue) * 100) : 0
                return (
                  <tr key={g.name} style={{ borderBottom: '1px solid #0a1628' }}>
                    <td style={{ padding: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <div>
                          <div style={{ color: '#e0e8f5', fontWeight: 600 }}>{g.name}</div>
                          <div style={{ color: '#8899aa', fontSize: '0.75rem' }}>{g.count} item{g.count !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                      <div style={{ color: '#e0e8f5' }}>{fmt(g.value)}</div>
                      <div style={{ color: '#8899aa', fontSize: '0.75rem' }}>{fmt(g.invested)}</div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                      <div style={{ color: gain >= 0 ? '#4dff91' : '#ff6b6b' }}>{gain >= 0 ? '+' : ''}{fmt(gain)}</div>
                      <div style={{ color: gain >= 0 ? '#4dff91' : '#ff6b6b', fontSize: '0.75rem' }}>
                        {gain >= 0 ? '▲' : '▼'} {Math.abs(gainPct).toFixed(2)}%
                      </div>
                    </td>
                    {hasTargets && (
                      <td style={{ textAlign: 'right', padding: '0.5rem', color: '#8899aa' }}>
                        {g.target_pct != null ? `${Number(g.target_pct).toFixed(0)}%` : '—'}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                      <div style={{ color: '#e0e8f5' }}>{alloc.toFixed(2)}%</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TickerModal({ ticker, onClose }) {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(null)
    pf(`/api/ticker-return/${ticker}`)
      .then(r => {
        if (!r.ok) throw new Error(`Could not load return data for ${ticker}`)
        return r.json()
      })
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticker, pf, selection])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (!data || !window.Plotly) return
    const el = document.getElementById('ticker-chart')
    if (!el) return

    const traces = [
      {
        x: data.dates, y: data.price_return,
        mode: 'lines', name: 'Price Return %',
        line: { color: '#7ecfff', width: 2 },
        hovertemplate: '%{y:.2f}%<extra>Price</extra>',
      },
      {
        x: data.dates, y: data.total_return,
        mode: 'lines', name: 'Total Return %',
        line: { color: '#4dff91', width: 2 },
        fill: 'tonexty', fillcolor: 'rgba(77,255,145,0.08)',
        hovertemplate: '%{y:.2f}%<extra>Total</extra>',
      },
    ]
    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
      title: { text: `${data.ticker} — Return Since Purchase`, font: { size: 16, color: '#e0e8f5' } },
      xaxis: { title: '', gridcolor: '#1a2233' },
      yaxis: { title: 'Return %', gridcolor: '#1a2233', ticksuffix: '%' },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 12 } },
      margin: { l: 50, r: 20, t: 60, b: 40 },
      hovermode: 'x unified',
      shapes: [{ type: 'line', x0: data.dates[0], x1: data.dates[data.dates.length - 1], y0: 0, y1: 0, line: { dash: 'dot', color: '#556677', width: 1 } }],
    }
    window.Plotly.newPlot(el, traces, layout, { responsive: true })
    return () => { if (el) window.Plotly.purge(el) }
  }, [data])

  if (!ticker) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
        {error && <div className="alert alert-error">{error}</div>}
        {data && (
          <>
            <h2 style={{ color: '#7ecfff', marginBottom: '0.25rem' }}>{data.ticker} — {data.description}</h2>
            <p style={{ color: '#8899aa', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Purchased {new Date(data.purchase_date).toLocaleDateString()} at {fmt(data.price_paid)}
            </p>
            <div id="ticker-chart" style={{ height: '400px' }} />
          </>
        )}
      </div>
    </div>
  )
}

/** Parse JSON from a fetch response, throwing on non-OK status. */
function safeJson(r) {
  if (!r.ok) throw new Error(`Request failed (${r.status})`)
  return r.json()
}

export default function Dashboard() {
  const pf = useProfileFetch()
  const { profileId, isAggregate, selection, currentProfileName } = useProfile()
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshStatus, setRefreshStatus] = useState(null)
  const [gradeStatus, setGradeStatus] = useState(null)
  const [tickerGrades, setTickerGrades] = useState({})
  const [portfolioGrade, setPortfolioGrade] = useState({})
  const [upcomingDivs, setUpcomingDivs] = useState([])
  const [incomeSummary, setIncomeSummary] = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [modalTicker, setModalTicker] = useState(null)
  const [portfolioCoverage, setPortfolioCoverage] = useState(null)
  const [tickerCoverage, setTickerCoverage] = useState({})
  const [overviewGroups, setOverviewGroups] = useState(null)
  const [sp500, setSp500] = useState(null)
  const dashboardCacheKey = useMemo(() => `portfolio_dashboard_${selection}`, [selection])

  useEffect(() => {
    const cached = readDashboardCache(SP500_CACHE_KEY)
    if (cached) setSp500(cached)
    const fetchSp500 = () =>
      fetch(`${API_BASE}/api/sp500-performance`)
        .then(safeJson)
        .then(d => {
          setSp500(d)
          writeDashboardCache(SP500_CACHE_KEY, d)
        })
        .catch(() => {})
    fetchSp500()
    const interval = setInterval(fetchSp500, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let stale = false
    const cached = readDashboardCache(dashboardCacheKey)
    if (cached) {
      setHoldings(cached.holdings || [])
      setIncomeSummary(cached.incomeSummary || null)
      setUpcomingDivs(cached.upcomingDivs || [])
      setTickerGrades(cached.tickerGrades || {})
      setPortfolioGrade(cached.portfolioGrade || {})
      setPortfolioCoverage(cached.portfolioCoverage ?? null)
      setTickerCoverage(cached.tickerCoverage || {})
      setOverviewGroups(cached.overviewGroups || null)
      setLoading(false)
    } else {
      setHoldings([])
      setIncomeSummary(null)
      setUpcomingDivs([])
      setTickerGrades({})
      setPortfolioGrade({})
      setPortfolioCoverage(null)
      setTickerCoverage({})
      setOverviewGroups(null)
      setLoading(true)
    }
    setRefreshStatus(null)
    setGradeStatus(null)
    pf('/api/holdings')
      .then(safeJson)
      .then(data => {
        if (stale) return
        setHoldings(data)
        setLoading(false)
        if (data.length > 0) {
          // Fetch upcoming dividends and portfolio coverage immediately (no refresh needed)
          pf('/api/upcoming-dividends')
            .then(safeJson)
            .then(d => { if (!stale && Array.isArray(d)) setUpcomingDivs(d) })
            .catch(() => {})
          pf('/api/income-summary')
            .then(safeJson)
            .then(d => { if (!stale) setIncomeSummary(d) })
            .catch(() => {})
          // Build portfolio overview groups from categories or classification_type
          pf('/api/categories/data')
            .then(safeJson)
            .then(catData => {
              if (stale) return
              const cats = catData.categories || []
              if (cats.length > 0) {
                // Use category grouping — need purchase_value per ticker from holdings
                const holdingMap = {}
                data.forEach(h => { if (h.quantity > 0) holdingMap[h.ticker] = h })
                const groups = cats
                  .map(c => {
                    const tickers = (c.tickers || []).filter(t => holdingMap[t.ticker])
                    const value = tickers.reduce((s, t) => s + (holdingMap[t.ticker]?.current_value || 0), 0)
                    const invested = tickers.reduce((s, t) => s + (holdingMap[t.ticker]?.purchase_value || 0), 0)
                    return { name: c.name, value, invested, count: tickers.length, target_pct: c.target_pct }
                  })
                  .filter(g => g.count > 0)
                  .sort((a, b) => b.value - a.value)
                setOverviewGroups(groups)
              } else {
                // Fallback: group by classification_type
                const byType = {}
                data.forEach(h => {
                  if (h.quantity <= 0) return
                  const ct = h.classification_type || 'Other'
                  if (!byType[ct]) byType[ct] = { name: ct, value: 0, invested: 0, count: 0 }
                  byType[ct].value += h.current_value || 0
                  byType[ct].invested += h.purchase_value || 0
                  byType[ct].count += 1
                })
                setOverviewGroups(Object.values(byType).sort((a, b) => b.value - a.value))
              }
            })
            .catch(() => {})
          pf('/api/portfolio-coverage')
            .then(safeJson)
            .then(d => {
              if (stale) return
              if (d.aggregate_coverage != null) setPortfolioCoverage(d.aggregate_coverage)
              if (d.results) {
                const map = {}
                d.results.forEach(r => { if (r.coverage_ratio != null) map[r.ticker] = r.coverage_ratio })
                setTickerCoverage(map)
              }
            })
            .catch(() => {})
          pf('/api/portfolio-summary/data')
            .then(safeJson)
            .then(g => {
              if (stale || !g) return
              if (g.ticker_grades) setTickerGrades(g.ticker_grades)
              if (g.portfolio_grade) setPortfolioGrade(g.portfolio_grade)
            })
            .catch(() => {})

          setRefreshStatus('Updating prices & dividends...')
          pf('/api/refresh', { method: 'POST' })
            .then(safeJson)
            .then(r => {
              if (stale) return
              setRefreshStatus(r.message)
              return pf('/api/holdings')
            })
            .then(r => { if (!stale && r) return safeJson(r) })
            .then(updated => {
              if (stale || !updated) return
              setHoldings(updated)
              setGradeStatus('Loading risk grades...')
              return pf('/api/portfolio-summary/data')
                .then(safeJson)
                .then(g => {
                  if (stale || !g) return
                  if (g.ticker_grades) setTickerGrades(g.ticker_grades)
                  if (g.portfolio_grade) setPortfolioGrade(g.portfolio_grade)
                  setGradeStatus('Grades loaded.')
                  setTimeout(() => { if (!stale) setGradeStatus(null) }, 3000)
                })
                .catch(() => { if (!stale) setGradeStatus('Grade loading failed.') })
            })
            .catch(() => {
              if (!stale) {
                setRefreshStatus('Refresh failed.')
                setGradeStatus(null)
              }
            })
        }
      })
      .catch(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [pf, selection, dashboardCacheKey])

  useEffect(() => {
    if (loading || !holdings.length) return
    writeDashboardCache(dashboardCacheKey, {
      holdings,
      incomeSummary,
      upcomingDivs,
      tickerGrades,
      portfolioGrade,
      portfolioCoverage,
      tickerCoverage,
      overviewGroups,
    })
  }, [
    dashboardCacheKey,
    loading,
    holdings,
    incomeSummary,
    upcomingDivs,
    tickerGrades,
    portfolioGrade,
    portfolioCoverage,
    tickerCoverage,
    overviewGroups,
  ])

  // Derived totals
  const totals = useMemo(() => {
    if (!holdings.length) return {}
    const sum = (key) => holdings.reduce((s, h) => s + (h[key] || 0), 0)
    const purchaseValue = sum('purchase_value')
    const currentValue = sum('current_value')
    const gainLoss = sum('gain_or_loss')
    const totalDivs = sum('total_divs_received')
    const rawYtd = sum('ytd_divs')
    const ytdDivs = rawYtd != null && rawYtd > 0 ? rawYtd : (incomeSummary?.ytd_income ?? 0)
    const monthlyIncome = sum('approx_monthly_income')
    const monthlyReinvested = sum('monthly_income_reinvested')
    const monthlyNotReinvested = sum('monthly_income_not_reinvested')
    const annualIncome = sum('estim_payment_per_year')
    const rawMonthIncome = sum('current_month_income')
    const currentMonthIncome = rawMonthIncome != null ? rawMonthIncome : (incomeSummary?.current_month_income ?? 0)

    let avgYoc = 0
    const valid = holdings.filter(h => h.purchase_value > 0 && h.annual_yield_on_cost != null)
    if (valid.length) {
      const wSum = valid.reduce((s, h) => s + h.purchase_value, 0)
      avgYoc = valid.reduce((s, h) => s + h.annual_yield_on_cost * h.purchase_value, 0) / wSum
    }

    const currentYield = currentValue ? (annualIncome / currentValue) : 0
    const priceReturn = purchaseValue ? (gainLoss / purchaseValue) : 0
    const totalReturn = purchaseValue ? ((gainLoss + totalDivs) / purchaseValue) : 0

    return { ytdDivs, monthlyIncome, monthlyReinvested, monthlyNotReinvested, annualIncome, currentValue, avgYoc, currentYield, priceReturn, totalReturn, purchaseValue, currentMonthIncome }
  }, [holdings, incomeSummary])

  // Enrich holdings with computed fields
  const enrichedHoldings = useMemo(() => {
    return holdings
      .filter(h => h.quantity > 0)
      .map(h => {
        const pv = h.purchase_value || 0
        const gl = h.gain_or_loss || 0
        const td = h.total_divs_received || 0
        const cv = h.current_value || 0
        const totalCv = totals.currentValue || 1
        return {
          ...h,
          price_return_pct: pv ? (gl / pv) : 0,
          total_return_pct: pv ? ((gl + td) / pv) : 0,
          pct_of_account: totalCv ? (cv / totalCv) : 0,
          _coverage: tickerCoverage[h.ticker] ?? null,
          _grade_sort: ({ 'A+': 13, 'A': 12, 'A-': 11, 'B+': 10, 'B': 9, 'B-': 8, 'C+': 7, 'C': 6, 'C-': 5, 'D+': 4, 'D': 3, 'D-': 2, 'F': 1 })[tickerGrades[h.ticker]?.grade] || 0,
        }
      })
  }, [holdings, totals, tickerCoverage, tickerGrades])

  // Sorting
  const sorted = useMemo(() => {
    if (!sortCol) return enrichedHoldings
    return [...enrichedHoldings].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      if (typeof av === 'string') {
        av = (av || '').toLowerCase()
        bv = (bv || '').toLowerCase()
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      av = av || 0
      bv = bv || 0
      return sortAsc ? av - bv : bv - av
    })
  }, [enrichedHoldings, sortCol, sortAsc])

  const handleSort = useCallback((col) => {
    setSortAsc(prev => sortCol === col ? !prev : (typeof enrichedHoldings[0]?.[col] === 'string'))
    setSortCol(col)
  }, [sortCol, enrichedHoldings])

  const SortHeader = ({ col, children, align, tip }) => (
    <th
      onClick={() => handleSort(col)}
      style={{ cursor: 'pointer', textAlign: align || 'left', userSelect: 'none' }}
      title={tip || ''}
    >
      {children}{tip ? ' \u24D8' : ''} {sortCol === col ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  const gradeColor = (v) => v >= 0 ? '#4dff91' : '#ff6b6b'
  const pfiVal = (v) => v == null ? 0 : v * 100
  const pfiColor = (v) => { const p = pfiVal(v); return p >= 100 ? '#4dff91' : p >= 50 ? '#ffd700' : undefined }

  const currentMonth = new Date().toLocaleString('default', { month: 'long' })

  if (loading) {
    return <div className="page" style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
  }

  if (!holdings.length) {
    return (
      <div className="page">
        <h1>Portfolio Dashboard</h1>
        <div className="card">
          <p>No holdings yet. Go to <NavLink to="/import">Import</NavLink> to upload your spreadsheet, or <NavLink to="/holdings">Manage Holdings</NavLink> to add manually.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page dashboard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>Portfolio Dashboard</h1>
          <p style={{ color: '#8899aa', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            {currentProfileName} — {enrichedHoldings.length} holding{enrichedHoldings.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {refreshStatus && (
            <span className="alert alert-info" style={{ margin: 0, padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>
              {refreshStatus}
            </span>
          )}
          {gradeStatus && (
            <span className="alert alert-info" style={{ margin: 0, padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>
              {gradeStatus === 'Loading risk grades...' && <span className="spinner" style={{ width: 14, height: 14, marginRight: 6 }} />}
              {gradeStatus}
            </span>
          )}
        </div>
      </div>

      {/* Summary Cards Strip */}
      <div className="summary-strip">
        <SummaryCard
          className="summary-card-grade"
          label="Portfolio Grade"
          value={portfolioGrade.overall ? <GradeBadge grade={portfolioGrade.overall} large /> : '—'}
          sub={portfolioGrade.score != null ? `Score: ${portfolioGrade.score}` : null}
        />
        <SummaryCard label="Ulcer Index" value={portfolioGrade.ulcer_index ?? '—'} />
        <SummaryCard label="Calmar Ratio" value={portfolioGrade.calmar ?? '—'} />
        <SummaryCard label="Omega Ratio" value={portfolioGrade.omega ?? '—'} />
        <SummaryCard label="Sortino Ratio" value={portfolioGrade.sortino ?? '—'} />
        <SummaryCard label="Sharpe Ratio" value={portfolioGrade.sharpe ?? '—'} />
        <SummaryCard label="YTD Dividends" value={fmt(totals.ytdDivs)} color="#4dff91" />
        <SummaryCard label={`${currentMonth} Income`} value={fmt(totals.currentMonthIncome)} color="#4dff91" />
        <SummaryCard label="Est. Monthly Income" value={fmt(totals.monthlyIncome)} color="#4dff91" />
        <SummaryCard label="Mo$ Reinvested" value={fmt(totals.monthlyReinvested)} color="#7ecfff" />
        <SummaryCard label="Mo$ Not Reinvested" value={fmt(totals.monthlyNotReinvested)} color="#ffb300" />
        <SummaryCard label="Est. Annual Income" value={fmt(totals.annualIncome)} color="#4dff91" />
        <SummaryCard label="Portfolio Value" value={fmt(totals.currentValue)} color="#7ecfff" />
        <SummaryCard label="Avg Yield on Cost" value={pct(totals.avgYoc)} />
        <SummaryCard label="Current Yield" value={pct(totals.currentYield)} />
        <SummaryCard
          label="Price Return"
          value={pct(totals.priceReturn)}
          color={gradeColor(totals.priceReturn)}
        />
        <SummaryCard
          label="Coverage Ratio"
          value={portfolioCoverage != null ? portfolioCoverage.toFixed(4) : '—'}
          color={portfolioCoverage == null ? undefined : portfolioCoverage < 0.8 ? '#ff6b6b' : portfolioCoverage < 1.0 ? '#ffb300' : '#4dff91'}
        />
        {portfolioCoverage != null && (
          <div className={`summary-card`} style={{
            border: portfolioCoverage < 0.8 ? '2px solid #ff6b6b' : portfolioCoverage < 1.0 ? '2px solid #ffb300' : '2px solid #4dff91',
            borderRadius: '8px',
            background: portfolioCoverage < 0.8 ? 'rgba(255,107,107,0.12)' : portfolioCoverage < 1.0 ? 'rgba(255,179,0,0.12)' : 'rgba(77,255,145,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div className="summary-value" style={{
              color: portfolioCoverage < 0.8 ? '#ff6b6b' : portfolioCoverage < 1.0 ? '#ffb300' : '#4dff91',
              fontSize: '0.82rem',
              lineHeight: 1.3,
              textAlign: 'center',
            }}>
              {portfolioCoverage < 0.8 ? 'High Probability of NAV Erosion' : portfolioCoverage < 1.0 ? 'Borderline NAV Erosion Risk' : 'Low Probability of NAV Erosion'}
            </div>
          </div>
        )}
        <SummaryCard
          label="Total Return"
          value={pct(totals.totalReturn)}
          color={gradeColor(totals.totalReturn)}
        />
        {sp500 && (
          <SummaryCard
            label="S&P 500"
            value={sp500.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            sub={
              <span>
                <span style={{ color: sp500.day_pct >= 0 ? '#4dff91' : '#ff6b6b' }}>
                  Day: {sp500.day_pct >= 0 ? '+' : ''}{sp500.day_pct.toFixed(2)}%
                </span>
                {' · '}
                <span style={{ color: sp500.ytd_pct >= 0 ? '#4dff91' : '#ff6b6b' }}>
                  YTD: {sp500.ytd_pct >= 0 ? '+' : ''}{sp500.ytd_pct.toFixed(2)}%
                </span>
              </span>
            }
          />
        )}
      </div>

      {/* Grade Thresholds (collapsible) */}
      <details className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
        <summary style={{ cursor: 'pointer', color: '#90caf9', fontWeight: 500 }}>Grade Thresholds Guide</summary>
        <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
          <table style={{ fontSize: '0.8rem' }}>
            <thead>
              <tr><th>Metric</th><th>What It Measures</th><th>A</th><th>B</th><th>C</th><th>D</th><th>F</th><th>Weight</th></tr>
            </thead>
            <tbody>
              <tr><td>Ulcer Index</td><td>Drawdown depth &amp; duration (lower = better)</td><td>&le;3</td><td>&le;7</td><td>&le;12</td><td>&le;20</td><td>&gt;20</td><td>20%</td></tr>
              <tr><td>Calmar</td><td>Return / max drawdown</td><td>&ge;1.5</td><td>&ge;1.0</td><td>&ge;0.5</td><td>&ge;0.2</td><td>&lt;0.2</td><td>20%</td></tr>
              <tr><td>Omega</td><td>Gains vs losses</td><td>&ge;2.0</td><td>&ge;1.5</td><td>&ge;1.2</td><td>&ge;1.0</td><td>&lt;1.0</td><td>15%</td></tr>
              <tr><td>Sortino</td><td>Return per downside risk</td><td>&ge;2.0</td><td>&ge;1.5</td><td>&ge;1.0</td><td>&ge;0.5</td><td>&lt;0.5</td><td>12%</td></tr>
              <tr><td>Sharpe</td><td>Return per unit of risk</td><td>&ge;1.5</td><td>&ge;1.0</td><td>&ge;0.5</td><td>&ge;0.0</td><td>&lt;0</td><td>8%</td></tr>
              <tr><td>Max Drawdown</td><td>Worst peak-to-trough</td><td>&le;10%</td><td>&le;20%</td><td>&le;30%</td><td>&le;40%</td><td>&gt;40%</td><td>10%</td></tr>
              <tr><td>Down Capture</td><td>Loss vs benchmark</td><td>&le;80%</td><td>&le;90%</td><td>&le;100%</td><td>&le;120%</td><td>&gt;120%</td><td>5%</td></tr>
              <tr><td>Diversification</td><td>Effective # holdings</td><td>&ge;20</td><td>&ge;12</td><td>&ge;6</td><td>&ge;3</td><td>&lt;3</td><td>10%</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Upcoming Dividends This Week */}
      <UpcomingDividends events={upcomingDivs} />

      {/* Portfolio Overview — Donut + Category Table */}
      {overviewGroups && <PortfolioOverview groups={overviewGroups} totalValue={totals.currentValue} />}

      {/* Holdings Table */}
      <div className="holdings-table-wrap">
        <table className="holdings-table">
          <thead>
            <tr>
              <SortHeader col="ticker">Ticker</SortHeader>
              <SortHeader col="description" tip="Security description / name">Desc</SortHeader>
              <SortHeader col="category" tip="Investment category">Cat</SortHeader>
              <SortHeader col="div_frequency" align="center" tip="Dividend payment frequency (M=Monthly, Q=Quarterly, W=Weekly)">Freq</SortHeader>
              <SortHeader col="purchase_date">Purchased</SortHeader>
              <SortHeader col="quantity" align="right" tip="Number of shares held">Qty</SortHeader>
              <SortHeader col="price_paid" align="right" tip="Price paid per share">Paid</SortHeader>
              <SortHeader col="current_price" align="right" tip="Current market price per share">Price</SortHeader>
              <SortHeader col="pct_of_account" align="right" tip="Percent of total account value">%Acct</SortHeader>
              <SortHeader col="gain_or_loss_percentage" align="right" tip="Unrealized gain or loss percentage">G/L%</SortHeader>
              <SortHeader col="price_return_pct" align="right" tip="Price-only return (excludes dividends)">PrRtn</SortHeader>
              <SortHeader col="total_return_pct" align="right" tip="Total return including dividends">TotRtn</SortHeader>
              <SortHeader col="current_annual_yield" align="right" tip="Current annual dividend yield based on market price">CurYld</SortHeader>
              <SortHeader col="annual_yield_on_cost" align="right" tip="Annual dividend yield based on your cost basis">YOC</SortHeader>
              <SortHeader col="ytd_divs" align="right" tip="Year-to-date dividends received">YTD</SortHeader>
              <SortHeader col="current_month_income" align="right" tip={`Dividend income received in ${currentMonth}`}>{currentMonth}</SortHeader>
              <SortHeader col="approx_monthly_income" align="right" tip="Estimated monthly dividend income">Mo$</SortHeader>
              <SortHeader col="monthly_income_reinvested" align="right" tip="Monthly income being reinvested (DRIP)">DRIP$</SortHeader>
              <SortHeader col="monthly_income_not_reinvested" align="right" tip="Monthly income NOT being reinvested (cash)">Cash$</SortHeader>
              <SortHeader col="estim_payment_per_year" align="right" tip="Estimated annual dividend income">Yr$</SortHeader>
              <SortHeader col="paid_for_itself" align="right" tip="Percentage of original cost recovered through dividends">PFI%</SortHeader>
              <SortHeader col="_coverage" align="right" tip="Coverage ratio — above 1.0 sustainable, 0.8–1.0 borderline, below 0.8 likely NAV decay">Cov</SortHeader>
              <SortHeader col="_grade_sort" align="center" tip="Composite grade based on yield, growth, and risk metrics">Grd</SortHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.map(h => {
              const g = tickerGrades[h.ticker]
              const cov = h._coverage
              const covBad = cov != null && cov < 0.8
              return (
                <tr key={h.ticker} style={covBad ? { background: 'rgba(255,107,107,0.1)' } : undefined}>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); setModalTicker(h.ticker) }}
                      style={{ color: '#7ecfff', fontWeight: 600 }}
                    >
                      {h.ticker}
                    </a>
                  </td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.description}</td>
                  <td>{h.category || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{h.div_frequency || '—'}</td>
                  <td>{h.purchase_date ? new Date(h.purchase_date).toLocaleDateString() : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{Number.isInteger(h.quantity) ? h.quantity : parseFloat(h.quantity.toFixed(3))}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(h.price_paid, 4)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(h.current_price)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(h.pct_of_account)}</td>
                  <td style={{ textAlign: 'right', color: gradeColor(h.gain_or_loss_percentage) }}>{pct(h.gain_or_loss_percentage)}</td>
                  <td style={{ textAlign: 'right', color: gradeColor(h.price_return_pct) }}>{pct(h.price_return_pct)}</td>
                  <td style={{ textAlign: 'right', color: gradeColor(h.total_return_pct) }}>{pct(h.total_return_pct)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(h.current_annual_yield)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(h.annual_yield_on_cost)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.ytd_divs)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.current_month_income)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.approx_monthly_income)}</td>
                  <td style={{ textAlign: 'right', color: '#7ecfff' }}>{fmt(h.monthly_income_reinvested)}</td>
                  <td style={{ textAlign: 'right', color: '#ffb300' }}>{fmt(h.monthly_income_not_reinvested)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.estim_payment_per_year)}</td>
                  <td style={{ textAlign: 'right', color: pfiColor(h.paid_for_itself), fontWeight: pfiVal(h.paid_for_itself) >= 100 ? 700 : 400 }}>
                    {h.paid_for_itself == null ? '—' : (h.paid_for_itself * 100).toFixed(2) + '%'}
                  </td>
                  <td style={{ textAlign: 'right', color: cov == null ? '#556' : cov < 0.8 ? '#ff6b6b' : cov < 1.0 ? '#ffb300' : '#4dff91', fontWeight: cov != null ? 600 : 400 }}>
                    {cov != null ? cov.toFixed(2) : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>{g ? <GradeBadge grade={g.grade} /> : '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid #0f3460' }}>
              <td colSpan={10} style={{ textAlign: 'right' }}>Totals</td>
              <td style={{ textAlign: 'right', color: gradeColor(totals.priceReturn) }}>{pct(totals.priceReturn)}</td>
              <td style={{ textAlign: 'right', color: gradeColor(totals.totalReturn) }}>{pct(totals.totalReturn)}</td>
              <td colSpan={2} />
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.ytdDivs)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.currentMonthIncome)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.monthlyIncome)}</td>
              <td style={{ textAlign: 'right', color: '#7ecfff' }}>{fmt(totals.monthlyReinvested)}</td>
              <td style={{ textAlign: 'right', color: '#ffb300' }}>{fmt(totals.monthlyNotReinvested)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.annualIncome)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Ticker Modal */}
      {modalTicker && <TickerModal ticker={modalTicker} onClose={() => setModalTicker(null)} />}
    </div>
  )
}
