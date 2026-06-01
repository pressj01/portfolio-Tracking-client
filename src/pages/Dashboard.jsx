import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { API_BASE } from '../config'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { returnVsYield } from '../utils/returnVsYield'
import { readDashboardCache, writeDashboardCache } from '../utils/dashboardCache'

const DASHBOARD_CACHE_TTL_MS = 60 * 60 * 1000
const SP500_CACHE_KEY = 'portfolio_dashboard_sp500'

const fmt = (v, d = 2) => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtShares = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const dripSharePrice = (h) => {
  const currentPrice = Number(h?.current_price || 0)
  if (currentPrice > 0) return currentPrice
  const currentValue = Number(h?.current_value || 0)
  const quantity = Number(h?.quantity || 0)
  return currentValue > 0 && quantity > 0 ? currentValue / quantity : 0
}
const sharesFromDrip = (income, h) => {
  const price = dripSharePrice(h)
  return price > 0 ? Number(income || 0) / price : 0
}
const shortDate = (value) => {
  if (!value) return ''
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const pct = (v) => (v == null ? '—' : (Number(v) * 100).toFixed(2) + '%')
const navSeverityFromRatio = (v) => v == null ? null : v > 0.75 ? 'High' : v > 0.25 ? 'Medium' : 'Low'
const navSeverityColor = (severity) => severity === 'High' ? '#ff6b6b' : severity === 'Medium' ? '#ffb300' : severity === 'Low' ? '#4dff91' : '#6f7890'
const navSeverityBg = (severity) => severity === 'High' ? 'rgba(255,107,107,0.12)' : severity === 'Medium' ? 'rgba(255,179,0,0.12)' : 'rgba(77,255,145,0.12)'
const navSeverityText = (severity) => severity === 'High' ? 'High Benchmark-Adjusted NAV Erosion' : severity === 'Medium' ? 'Moderate Benchmark-Adjusted NAV Erosion' : 'Low Benchmark-Adjusted NAV Erosion'

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
              Pay: {e.pay_estimated === false ? '' : '~'}{e.pay_weekday} {new Date(e.pay_date + 'T00:00').toLocaleDateString()}
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

  const hasTargets = groups?.some(g => g.target_pct != null)
  const totalTarget = groups?.reduce((s, g) => s + (Number(g.target_pct) || 0), 0) || 0
  const showTargetRing = hasTargets && totalTarget > 0

  useEffect(() => {
    if (!groups || !groups.length || !window.Plotly || !chartRef.current) return
    const labels = groups.map(g => g.name)
    const values = groups.map(g => g.value)
    const colors = groups.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length])

    const traces = []

    if (showTargetRing) {
      const sliceLabels = [], sliceValues = [], sliceColors = [], sliceHovers = []
      const toRgba = (hex, a) => {
        const r = parseInt(hex.slice(1,3),16), g2 = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
        return `rgba(${r},${g2},${b},${a})`
      }
      groups.forEach((g, i) => {
        const color = DONUT_COLORS[i % DONUT_COLORS.length]
        const actualPct = totalValue ? (g.value / totalValue) * 100 : 0
        const targetPct = Number(g.target_pct) || 0
        const gap = Math.max(0, targetPct - actualPct)
        sliceLabels.push(g.name)
        sliceValues.push(actualPct)
        sliceColors.push(color)
        sliceHovers.push(`${g.name}: ${actualPct.toFixed(1)}% actual` + (targetPct ? ` (${targetPct}% target)` : ''))
        if (gap > 0) {
          sliceLabels.push(g.name + ' (under)')
          sliceValues.push(gap)
          sliceColors.push(toRgba(color, 0.25))
          sliceHovers.push(`${g.name}: ${gap.toFixed(1)}% under target`)
        }
      })
      traces.push({
        labels: sliceLabels, values: sliceValues,
        type: 'pie', hole: 0.55,
        marker: { colors: sliceColors, line: { color: '#16213e', width: 1.5 } },
        textinfo: 'none',
        hovertemplate: '%{customdata}<extra></extra>',
        customdata: sliceHovers,
        sort: false,
      })
    } else {
      traces.push({
        labels, values,
        type: 'pie', hole: 0.55,
        marker: { colors },
        textinfo: 'none',
        hovertemplate: '%{label}: $%{value:,.2f}<br>%{percent}<extra></extra>',
        sort: false,
      })
    }

    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#16213e', plot_bgcolor: '#16213e',
      margin: { l: 10, r: 10, t: 10, b: 10 },
      showlegend: false,
      height: 280, width: 280,
      annotations: [],
    }
    window.Plotly.newPlot(chartRef.current, traces, layout, { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [groups, showTargetRing, totalTarget])

  if (!groups || !groups.length) return null

  return (
    <div className="portfolio-overview card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
      <h3 style={{ color: '#90caf9', margin: '0 0 0.75rem', fontSize: '1rem' }}>Portfolio</h3>
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        <div ref={chartRef} style={{ width: 280, flexShrink: 0 }} />
        <div style={{ flex: 1, overflowX: 'auto', minWidth: 0 }}>
          <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #0f3460' }}>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Name</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Value/Invested</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Gain</th>
                {showTargetRing && <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Target</th>}
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Allocation</th>
                {showTargetRing && <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: '#8899aa' }}>Diff</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => {
                const color = DONUT_COLORS[i % DONUT_COLORS.length]
                const gain = g.value - g.invested
                const gainPct = g.invested ? ((gain / g.invested) * 100) : 0
                const alloc = totalValue ? ((g.value / totalValue) * 100) : 0
                const target = Number(g.target_pct) || 0
                const diff = showTargetRing && target > 0 ? alloc - target : null
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
                    {showTargetRing && (
                      <td style={{ textAlign: 'right', padding: '0.5rem', color: '#8899aa' }}>
                        {target > 0 ? `${target.toFixed(0)}%` : '—'}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                      <div style={{ color: '#e0e8f5' }}>{alloc.toFixed(2)}%</div>
                    </td>
                    {showTargetRing && (
                      <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                        {diff != null ? (
                          <div style={{ color: diff >= 0 ? '#4dff91' : '#ff6b6b', fontWeight: 600 }}>
                            {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
                          </div>
                        ) : (
                          <span style={{ color: '#8899aa' }}>—</span>
                        )}
                      </td>
                    )}
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

    const hasTotalReturn = data.total_return_available !== false && Array.isArray(data.total_return)
    const traces = hasTotalReturn
      ? [
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
      : [
          {
            x: data.dates, y: data.prices,
            mode: 'lines', name: 'Price',
            line: { color: '#7ecfff', width: 2 },
            hovertemplate: '$%{y:.2f}<extra>Price</extra>',
          },
        ]
    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
      title: { text: `${data.ticker} — ${hasTotalReturn ? 'Return Since Purchase' : 'Recent Price History'}`, font: { size: 16, color: '#e0e8f5' } },
      xaxis: { title: '', gridcolor: '#1a2233' },
      yaxis: hasTotalReturn
        ? { title: 'Return %', gridcolor: '#1a2233', ticksuffix: '%' }
        : { title: 'Price', gridcolor: '#1a2233', tickprefix: '$' },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 12 } },
      margin: { l: 50, r: 20, t: 60, b: 40 },
      hovermode: 'x unified',
      shapes: hasTotalReturn
        ? [{ type: 'line', x0: data.dates[0], x1: data.dates[data.dates.length - 1], y0: 0, y1: 0, line: { dash: 'dot', color: '#556677', width: 1 } }]
        : [],
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
            {data.note && (
              <p style={{ color: '#ffcc80', margin: '-0.5rem 0 1rem', fontSize: '0.85rem' }}>{data.note}</p>
            )}
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
  const { profileId, profiles, isAggregate, selection, currentProfileName, basisMode } = useProfile()
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
  const [rvyMode, setRvyMode] = useState('cur')
  const [modalTicker, setModalTicker] = useState(null)
  const [portfolioCoverage, setPortfolioCoverage] = useState(null)
  const [portfolioCoverageSeverity, setPortfolioCoverageSeverity] = useState(null)
  const [tickerCoverage, setTickerCoverage] = useState({})
  const [tickerCoverageMeta, setTickerCoverageMeta] = useState({})
  const [overviewGroups, setOverviewGroups] = useState(null)
  const [sp500, setSp500] = useState(null)
  const [navHistory, setNavHistory] = useState([])
  const [navSnapping, setNavSnapping] = useState(false)
  const [navBackfilling, setNavBackfilling] = useState(false)
  const [navRepairing, setNavRepairing] = useState(false)
  const [actionCenter, setActionCenter] = useState(null)
  const navChartRef = useRef(null)
  const dashboardCacheKey = useMemo(() => `portfolio_dashboard_v13_${selection}_${basisMode}`, [selection, basisMode])
  const currentProfile = useMemo(
    () => profiles.find(p => p.id === profileId) || null,
    [profiles, profileId],
  )
  const brokerPositionNavBackfillBlocked = !isAggregate && [
    'schwab',
    'etrade',
    'fidelity',
    'shear_group',
    'generic',
    'other',
  ].includes(String(currentProfile?.broker_source || '').toLowerCase())

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
      setPortfolioCoverageSeverity(cached.portfolioCoverageSeverity ?? null)
      setTickerCoverage(cached.tickerCoverage || {})
      setTickerCoverageMeta(cached.tickerCoverageMeta || {})
      setOverviewGroups(cached.overviewGroups || null)
      setLoading(false)
    } else {
      setHoldings([])
      setIncomeSummary(null)
      setUpcomingDivs([])
      setTickerGrades({})
      setPortfolioGrade({})
      setPortfolioCoverage(null)
      setPortfolioCoverageSeverity(null)
      setTickerCoverage({})
      setTickerCoverageMeta({})
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
          pf('/api/nav/history')
            .then(safeJson)
            .then(d => { if (!stale && Array.isArray(d)) setNavHistory(d) })
            .catch(() => {})
          pf('/api/action-center?limit=4')
            .then(safeJson)
            .then(d => { if (!stale) setActionCenter(d) })
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
              setPortfolioCoverage(d.aggregate_coverage ?? null)
              setPortfolioCoverageSeverity(d.aggregate_severity ?? null)
              if (d.results) {
                const map = {}
                const meta = {}
                d.results.forEach(r => {
                  if (r.coverage_ratio != null) map[r.ticker] = r.coverage_ratio
                  meta[r.ticker] = {
                    nav_tested: !!r.nav_tested,
                    benchmark: r.benchmark || null,
                    benchmark_valid: r.benchmark_valid !== false,
                    nav_erosion_scope: r.nav_erosion_scope || 'auto',
                    nav_benchmark_override: r.nav_benchmark_override || '',
                    nav_erosion_severity: r.nav_erosion_severity || null,
                    price_change_pct: r.price_change_pct,
                    warning: r.warning || null,
                  }
                })
                setTickerCoverage(map)
                setTickerCoverageMeta(meta)
              } else {
                setTickerCoverage({})
                setTickerCoverageMeta({})
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
              return Promise.all([
                pf('/api/holdings').then(safeJson),
                pf('/api/income-summary').then(safeJson).catch(() => null),
              ])
            })
            .then(result => {
              if (stale || !result) return
              const [updated, summary] = result
              if (!updated) return
              setHoldings(updated)
              if (summary) setIncomeSummary(summary)
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
      portfolioCoverageSeverity,
      tickerCoverage,
      tickerCoverageMeta,
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
    portfolioCoverageSeverity,
    tickerCoverage,
    tickerCoverageMeta,
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
    const ytdDivs = incomeSummary?.ytd_income ?? rawYtd ?? 0
    const monthlyIncome = sum('approx_monthly_income')
    const monthlyReinvested = sum('monthly_income_reinvested')
    const monthlyNotReinvested = sum('monthly_income_not_reinvested')
    const annualIncome = sum('estim_payment_per_year')
    const dripSharesMonthly = holdings.reduce((s, h) => s + sharesFromDrip(h.approx_monthly_income, h), 0)
    const dripSharesYearly = holdings.reduce((s, h) => s + sharesFromDrip(h.estim_payment_per_year, h), 0)
    const rawMonthIncome = sum('current_month_income')
    const currentMonthIncome = incomeSummary?.current_month_income ?? rawMonthIncome ?? 0
    const currentMonthReinvested = incomeSummary?.current_month_income_reinvested ?? null
    const currentMonthNotReinvested = incomeSummary?.current_month_income_not_reinvested ?? null
    const currentMonthReinvestPct = (currentMonthReinvested != null && currentMonthIncome)
      ? (currentMonthReinvested / currentMonthIncome) : null

    let avgYoc = 0
    const valid = holdings.filter(h => h.purchase_value > 0 && h.annual_yield_on_cost != null)
    if (valid.length) {
      const wSum = valid.reduce((s, h) => s + h.purchase_value, 0)
      avgYoc = valid.reduce((s, h) => s + h.annual_yield_on_cost * h.purchase_value, 0) / wSum
    }

    const currentYield = currentValue ? (annualIncome / currentValue) : 0
    const priceReturn = purchaseValue ? (gainLoss / purchaseValue) : 0
    const totalReturn = purchaseValue ? ((gainLoss + totalDivs) / purchaseValue) : 0
    const reinvestPct = monthlyIncome ? (monthlyReinvested / monthlyIncome) : 0

    return { ytdDivs, monthlyIncome, monthlyReinvested, monthlyNotReinvested, reinvestPct, annualIncome, dripSharesMonthly, dripSharesYearly, currentValue, avgYoc, currentYield, priceReturn, totalReturn, purchaseValue, currentMonthIncome, currentMonthReinvested, currentMonthNotReinvested, currentMonthReinvestPct }
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
        const priceReturn = pv ? (gl / pv) : 0
        const totalReturn = pv ? ((gl + td) / pv) : 0
        const rvyYield = rvyMode === 'yoc' ? h.annual_yield_on_cost : h.current_annual_yield
        const rvy = returnVsYield(totalReturn * 100, (rvyYield || 0) * 100)
        return {
          ...h,
          price_return_pct: priceReturn,
          total_return_pct: totalReturn,
          pct_of_account: totalCv ? (cv / totalCv) : 0,
          drip_shares_monthly: sharesFromDrip(h.approx_monthly_income, h),
          drip_shares_yearly: sharesFromDrip(h.estim_payment_per_year, h),
          ret_vs_yld: rvy,
          ret_vs_yld_sort: rvy ? rvy.spread : -999,
          _coverage: tickerCoverage[h.ticker] ?? null,
          _coverage_meta: tickerCoverageMeta[h.ticker] || null,
          _grade_sort: ({ 'A+': 13, 'A': 12, 'A-': 11, 'B+': 10, 'B': 9, 'B-': 8, 'C+': 7, 'C': 6, 'C-': 5, 'D+': 4, 'D': 3, 'D-': 2, 'F': 1 })[tickerGrades[h.ticker]?.grade] || 0,
        }
      })
  }, [holdings, totals, tickerCoverage, tickerCoverageMeta, tickerGrades, rvyMode])
  const portfolioNavSeverity = portfolioCoverageSeverity || navSeverityFromRatio(portfolioCoverage)
  const portfolioNavColor = navSeverityColor(portfolioNavSeverity)

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

  const refreshPortfolioCoverage = useCallback(() => {
    return pf('/api/portfolio-coverage')
      .then(safeJson)
      .then(d => {
        setPortfolioCoverage(d.aggregate_coverage ?? null)
        setPortfolioCoverageSeverity(d.aggregate_severity ?? null)
        if (d.results) {
          const map = {}
          const meta = {}
          d.results.forEach(r => {
            if (r.coverage_ratio != null) map[r.ticker] = r.coverage_ratio
            meta[r.ticker] = {
              nav_tested: !!r.nav_tested,
              benchmark: r.benchmark || null,
              benchmark_valid: r.benchmark_valid !== false,
              nav_erosion_scope: r.nav_erosion_scope || 'auto',
              nav_benchmark_override: r.nav_benchmark_override || '',
              nav_erosion_severity: r.nav_erosion_severity || null,
              price_change_pct: r.price_change_pct,
              warning: r.warning || null,
            }
          })
          setTickerCoverage(map)
          setTickerCoverageMeta(meta)
        } else {
          setTickerCoverage({})
          setTickerCoverageMeta({})
        }
      })
      .catch(() => {})
  }, [pf])

  const updateNavScope = useCallback((ticker, scope, benchmark = '') => {
    const navBenchmark = String(benchmark || '').trim().toUpperCase()
    setHoldings(prev => prev.map(h => (
      h.ticker === ticker ? { ...h, nav_erosion_scope: scope, nav_benchmark_override: navBenchmark } : h
    )))
    setTickerCoverageMeta(prev => ({
      ...prev,
      [ticker]: {
        ...(prev[ticker] || {}),
        nav_erosion_scope: scope,
        nav_benchmark_override: navBenchmark,
      },
    }))
    pf(`/api/holdings/${ticker}/nav-erosion-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nav_erosion_scope: scope,
        nav_benchmark_override: navBenchmark,
      }),
    })
      .then(safeJson)
      .then(() => refreshPortfolioCoverage())
      .catch(() => {
        setRefreshStatus(`Could not update ${ticker} NAV test setting.`)
        setTimeout(() => setRefreshStatus(null), 3000)
      })
  }, [pf, refreshPortfolioCoverage])

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
  const currentMonthSub = useMemo(() => {
    if (!incomeSummary) return null
    if (incomeSummary.current_month_income_source === 'dividend_payments') {
      const rows = Number(incomeSummary.current_month_payment_rows || 0)
      const through = shortDate(incomeSummary.current_month_payment_through)
      return `${rows} recorded payment${rows === 1 ? '' : 's'}${through ? ` through ${through}` : ''}`
    }
    if (incomeSummary.current_month_income_source === 'monthly_payouts') {
      return 'Monthly payout history'
    }
    return 'Holding estimates'
  }, [incomeSummary])

  useEffect(() => {
    const el = navChartRef.current
    if (!el || !window.Plotly || navHistory.length < 1) return
    const points = navHistory
      .map(r => ({ date: r.date, value: Number(r.value) }))
      .filter(r => r.date && Number.isFinite(r.value))
    if (points.length < 1) return

    const dates = points.map(r => r.date)
    const values = points.map(r => r.value)
    const dateTimes = points
      .map(r => new Date(`${r.date}T00:00:00`).getTime())
      .filter(Number.isFinite)
    const minDate = Math.min(...dateTimes)
    const maxDate = Math.max(...dateTimes)
    const datePadding = dateTimes.length > 1
      ? Math.max(24 * 60 * 60 * 1000, (maxDate - minDate) * 0.15)
      : 24 * 60 * 60 * 1000
    const xRange = Number.isFinite(minDate) && Number.isFinite(maxDate)
      ? [
          new Date(minDate - datePadding).toISOString().slice(0, 10),
          new Date(maxDate + datePadding).toISOString().slice(0, 10),
        ]
      : undefined
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const valuePadding = minValue === maxValue
      ? Math.max(Math.abs(maxValue) * 0.02, 1)
      : Math.max((maxValue - minValue) * 0.25, Math.abs(maxValue) * 0.01, 1)
    const yRange = [
      Math.max(0, minValue - valuePadding),
      maxValue + valuePadding,
    ]
    const singlePoint = points.length === 1
    const denseHistory = points.length > 80
    const chartWidth = el.clientWidth || 900
    const xTickCount = Math.max(3, Math.min(8, Math.floor(chartWidth / 180)))
    const markerSize = denseHistory ? 4 : 8
    const valueTrace = {
      x: dates, y: values,
      mode: singlePoint ? 'markers+text' : denseHistory ? 'lines' : 'lines+markers',
      line: { color: '#7ecfff', width: 2 },
      marker: { color: '#7ecfff', size: markerSize },
      textposition: 'top center',
      hovertemplate: '%{x|%b %d, %Y}<br>$%{y:,.2f}<extra></extra>',
    }
    if (singlePoint) {
      valueTrace.text = values.map(v => fmt(v))
    }
    const traces = [valueTrace]
    const oneDayMs = 24 * 60 * 60 * 1000
    const spanMs = (maxDate - minDate) + 2 * datePadding
    const isLongRange = spanMs > 370 * oneDayMs
    const xaxis = {
      gridcolor: '#1a2233',
      color: '#8899aa',
      type: 'date',
      tickformat: isLongRange ? '%b %Y' : '%b %d',
      tickangle: 0,
      automargin: true,
    }
    if (isLongRange) {
      xaxis.nticks = xTickCount
    } else {
      const spanDays = Math.max(1, Math.ceil(spanMs / oneDayMs))
      const tickStepDays = Math.max(1, Math.round(spanDays / xTickCount))
      xaxis.dtick = tickStepDays * oneDayMs
    }
    if (xRange) xaxis.range = xRange
    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
      xaxis,
      yaxis: { title: { text: 'Portfolio Value ($)', font: { size: 12, color: '#8899aa' } }, gridcolor: '#1a2233', color: '#8899aa', tickprefix: '$', range: yRange },
      margin: { l: 90, r: 20, t: 10, b: 52 },
      height: 300,
      hovermode: 'x unified',
    }
    try {
      window.Plotly.newPlot(el, traces, layout, { responsive: true, displayModeBar: false })
    } catch (err) {
      console.warn('Unable to render NAV history chart', err)
    }
    return () => {
      try {
        if (el) window.Plotly.purge(el)
      } catch {
        // Plot cleanup should not affect dashboard rendering.
      }
    }
  }, [navHistory])

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

      {actionCenter?.items?.length > 0 && (
        <div className="card" style={{ padding: '0.85rem 1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ color: '#90caf9', margin: 0, fontSize: '1rem' }}>Action Center</h3>
              <p style={{ color: '#8899aa', margin: '0.15rem 0 0', fontSize: '0.82rem' }}>
                {actionCenter.summary?.item_count || actionCenter.items.length} follow-up{(actionCenter.summary?.item_count || actionCenter.items.length) !== 1 ? 's' : ''} found for this portfolio.
              </p>
            </div>
            <NavLink className="btn btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.82rem' }} to="/action-center">
              Open Action Center
            </NavLink>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.5rem' }}>
            {actionCenter.items.slice(0, 4).map(item => {
              const color = item.priority === 'warning' ? '#ffd54f' : item.priority === 'success' ? '#4dff91' : '#7ecfff'
              return (
                <NavLink
                  key={item.id}
                  to={item.route || '/action-center'}
                  style={{
                    display: 'block',
                    border: `1px solid ${color}55`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 6,
                    padding: '0.55rem 0.65rem',
                    background: '#10192e',
                    color: '#e0e8f5',
                  }}
                >
                  <div style={{ color, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>
                    {item.kind || 'portfolio'}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.25 }}>{item.title}</div>
                  <div style={{ color: '#9aa8bd', fontSize: '0.76rem', marginTop: 3, lineHeight: 1.35 }}>{item.detail}</div>
                </NavLink>
              )
            })}
          </div>
        </div>
      )}

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
        <SummaryCard label={`${currentMonth} Income`} value={fmt(totals.currentMonthIncome)} color="#4dff91" sub={currentMonthSub} />
        <SummaryCard label="Est. Monthly Income" value={fmt(totals.monthlyIncome)} color="#4dff91" sub="Annual estimate / 12" />
        <SummaryCard label="Est. Mo$ Reinvested" value={fmt(totals.monthlyReinvested)} color="#7ecfff" sub="Forward run-rate" />
        <SummaryCard label="Est. Mo$ Not Reinvested" value={fmt(totals.monthlyNotReinvested)} color="#ffb300" sub="Forward run-rate" />
        <SummaryCard label="Est. % Reinvested" value={pct(totals.reinvestPct)} color="#66bb6a" sub="Forward run-rate" />
        <SummaryCard label={`${currentMonth} Reinvested`} value={fmt(totals.currentMonthReinvested)} color="#7ecfff" sub={currentMonthSub} />
        <SummaryCard label={`${currentMonth} Not Reinvested`} value={fmt(totals.currentMonthNotReinvested)} color="#ffb300" sub={currentMonthSub} />
        <SummaryCard label={`${currentMonth} % Reinvested`} value={totals.currentMonthReinvestPct != null ? pct(totals.currentMonthReinvestPct) : '—'} color="#66bb6a" sub={currentMonthSub} />
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
          label="NAV Erosion Ratio"
          value={portfolioCoverage != null ? portfolioCoverage.toFixed(4) : '—'}
          color={portfolioCoverage == null ? undefined : portfolioNavColor}
        />
        {portfolioCoverage != null && (
          <div className={`summary-card`} style={{
            border: `2px solid ${portfolioNavColor}`,
            borderRadius: '8px',
            background: navSeverityBg(portfolioNavSeverity),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div className="summary-value" style={{
              color: portfolioNavColor,
              fontSize: '0.82rem',
              lineHeight: 1.3,
              textAlign: 'center',
            }}>
              {navSeverityText(portfolioNavSeverity)}
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

      {/* Portfolio Equity Curve */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ color: '#90caf9', margin: 0, fontSize: '1rem' }}>Portfolio Value Over Time</h3>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
            disabled={navSnapping}
            onClick={() => {
              setNavSnapping(true)
              pf('/api/nav/snapshot', { method: 'POST' })
                .then(safeJson)
                .then(d => {
                  if (d?.skipped) {
                    setRefreshStatus(d.reason || 'NAV snapshot skipped because the market is closed.')
                    setTimeout(() => setRefreshStatus(null), 4500)
                  }
                  return pf('/api/nav/history').then(safeJson).then(history => { if (Array.isArray(history)) setNavHistory(history) })
                })
                .catch(() => {
                  setRefreshStatus('Could not record NAV snapshot.')
                  setTimeout(() => setRefreshStatus(null), 3000)
                })
                .finally(() => setNavSnapping(false))
            }}
          >
            {navSnapping ? 'Recording...' : 'Record NAV'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
            disabled={navBackfilling || brokerPositionNavBackfillBlocked}
            title={
              brokerPositionNavBackfillBlocked
                ? 'Use Record NAV or position-file imports for broker-position portfolios'
                : 'Fill any missing days in the chart by replaying transactions against actual closing prices (recorded days are never changed)'
            }
            onClick={() => {
              setNavBackfilling(true)
              pf('/api/nav/backfill', { method: 'POST' })
                .then(safeJson)
                .then(d => {
                  setRefreshStatus(d?.message || `Backfilled ${d?.rows_added || 0} snapshots.`)
                  setTimeout(() => setRefreshStatus(null), 5000)
                  return pf('/api/nav/history').then(safeJson).then(history => { if (Array.isArray(history)) setNavHistory(history) })
                })
                .catch(() => {
                  setRefreshStatus('NAV backfill failed.')
                  setTimeout(() => setRefreshStatus(null), 3000)
                })
                .finally(() => setNavBackfilling(false))
            }}
          >
            {navBackfilling ? 'Backfilling...' : 'Backfill History'}
          </button>
          {navHistory.length > 0 && !brokerPositionNavBackfillBlocked && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
              disabled={navRepairing || navBackfilling}
              title="Rebuild a distorted chart: regenerate previously backfilled points from actual prices. Your recorded snapshots and today's value are kept, and a database backup is made first."
              onClick={() => {
                if (!window.confirm(
                  'Repair the NAV chart?\n\n' +
                  'This rebuilds previously backfilled points using actual closing prices to remove distortion. ' +
                  "Your recorded snapshots and today's value are preserved, and a database backup is taken first."
                )) {
                  return
                }
                setNavRepairing(true)
                pf('/api/nav/repair', { method: 'POST' })
                  .then(safeJson)
                  .then(d => {
                    setRefreshStatus(d?.message || `Repaired chart (${d?.rows_added || 0} points regenerated).`)
                    setTimeout(() => setRefreshStatus(null), 6000)
                    return pf('/api/nav/history').then(safeJson).then(history => { if (Array.isArray(history)) setNavHistory(history) })
                  })
                  .catch(() => {
                    setRefreshStatus('NAV repair failed.')
                    setTimeout(() => setRefreshStatus(null), 3000)
                  })
                  .finally(() => setNavRepairing(false))
              }}
            >
              {navRepairing ? 'Repairing...' : 'Repair Chart'}
            </button>
          )}
        </div>
        {navHistory.length >= 1 ? <div ref={navChartRef} /> : (
          <p style={{ color: '#8899aa', fontSize: '0.85rem', margin: '1rem 0' }}>
            No NAV snapshots yet. Click "Record NAV" or import data to start tracking.
          </p>
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
              <th style={{ textAlign: 'center', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none' }} title="Total return vs yield — Good means total return exceeds yield, Poor means yield exceeds total return (price erosion)">
                <span style={{ cursor: 'pointer' }} onClick={() => setSortCol(sc => sc === 'ret_vs_yld_sort' ? sc : 'ret_vs_yld_sort')}>RvY</span>
                {' '}
                <span
                  onClick={() => setRvyMode(m => m === 'yoc' ? 'cur' : 'yoc')}
                  title={rvyMode === 'yoc' ? 'Using Yield on Cost — click to switch to Current Yield' : 'Using Current Yield — click to switch to Yield on Cost'}
                  style={{ fontSize: '0.65rem', background: rvyMode === 'yoc' ? '#1a3a5c' : '#1a3a2a', color: rvyMode === 'yoc' ? '#7ecfff' : '#4dff91', border: `1px solid ${rvyMode === 'yoc' ? '#294b73' : '#2a5c3a'}`, borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontWeight: 600 }}
                >
                  {rvyMode === 'yoc' ? 'YOC' : 'CYld'}
                </span>
              </th>
              <SortHeader col="div" align="right" tip="Last dividend paid per share">Div$</SortHeader>
              <SortHeader col="current_annual_yield" align="right" tip="Current annual dividend yield based on market price">CurYld</SortHeader>
              <SortHeader col="annual_yield_on_cost" align="right" tip="Annual dividend yield based on your cost basis">YOC</SortHeader>
              <SortHeader col="ytd_divs" align="right" tip="Year-to-date dividends received">YTD</SortHeader>
              <SortHeader col="current_month_income" align="right" tip={`Dividend income received in ${currentMonth}`}>{currentMonth}</SortHeader>
              <SortHeader col="approx_monthly_income" align="right" tip="Estimated monthly dividend income">Mo$</SortHeader>
              <SortHeader col="drip_shares_monthly" align="right" tip="Estimated shares bought per month if 100% of monthly dividend income is reinvested at the current price">MoShr</SortHeader>
              <SortHeader col="monthly_income_reinvested" align="right" tip="Monthly income being reinvested (DRIP)">DRIP$</SortHeader>
              <SortHeader col="monthly_income_not_reinvested" align="right" tip="Monthly income NOT being reinvested (cash)">Cash$</SortHeader>
              <SortHeader col="estim_payment_per_year" align="right" tip="Estimated annual dividend income">Yr$</SortHeader>
              <SortHeader col="drip_shares_yearly" align="right" tip="Estimated shares bought per year if 100% of annual dividend income is reinvested at the current price">YrShr</SortHeader>
              <SortHeader col="paid_for_itself" align="right" tip="Percentage of original cost recovered through dividends">PFI%</SortHeader>
              <SortHeader col="_coverage" align="right" tip="NAV severity uses the benchmark-adjusted ratio, and is forced High for a 50%+ price decline or a 5%+ ending share deficit.">NAV</SortHeader>
              <SortHeader col="_grade_sort" align="center" tip="Composite grade based on yield, growth, and risk metrics">Grd</SortHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.map(h => {
              const g = tickerGrades[h.ticker]
              const cov = h._coverage
              const navMeta = h._coverage_meta || {}
              const navSeverity = navMeta.nav_erosion_severity || navSeverityFromRatio(cov)
              const navColor = navSeverityColor(navSeverity)
              const covBad = navSeverity === 'High'
              const navScope = h.nav_erosion_scope || navMeta.nav_erosion_scope || 'auto'
              const navBenchmark = h.nav_benchmark_override || navMeta.nav_benchmark_override || ''
              // The editable field reads from the holding row alone, so an
              // intentional clear sticks. Using navBenchmark (with its meta
              // fallback) here would re-populate a just-deleted value from
              // stale coverage meta, making the field impossible to empty.
              const navBenchmarkInput = h.nav_benchmark_override || ''
              const navLabel = navScope === 'test' ? 'Test' : navScope === 'skip' ? 'Skip' : 'Auto'
              const navBenchmarkInvalid = navBenchmark && navMeta.benchmark_valid === false
              const navTitle = navScope === 'skip'
                ? 'Skipped by user override'
                : navBenchmarkInvalid
                  ? `${navBenchmark} is not returning benchmark price history`
                : navScope === 'test'
                  ? `Forced NAV test${navBenchmark || navMeta.benchmark ? ` vs ${navBenchmark || navMeta.benchmark}` : ''}`
                  : navMeta.nav_tested
                    ? `Auto-tested${navBenchmark || navMeta.benchmark ? ` vs ${navBenchmark || navMeta.benchmark}` : ''}`
                    : 'Auto: not tested by current NAV erosion rules'
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
                  <td style={{ textAlign: 'center', color: h.ret_vs_yld?.color || '#6f7890', fontWeight: 600 }} title={h.ret_vs_yld ? `Total Return ${h.ret_vs_yld.totalReturnPct?.toFixed(2)}% vs Yield ${h.ret_vs_yld.yieldOnCost?.toFixed(2)}% (spread ${h.ret_vs_yld.spread?.toFixed(2)}%)` : 'N/A'}>{h.ret_vs_yld?.label || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{h.div != null && h.div > 0 ? `$${Number(h.div).toFixed(4)}` : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{pct(h.current_annual_yield)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(h.annual_yield_on_cost)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.ytd_divs)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.current_month_income)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.approx_monthly_income)}</td>
                  <td style={{ textAlign: 'right', color: '#9ad7ff' }}>{fmtShares(h.drip_shares_monthly)}</td>
                  <td style={{ textAlign: 'right', color: '#7ecfff' }}>{fmt(h.monthly_income_reinvested)}</td>
                  <td style={{ textAlign: 'right', color: '#ffb300' }}>{fmt(h.monthly_income_not_reinvested)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.estim_payment_per_year)}</td>
                  <td style={{ textAlign: 'right', color: '#9ad7ff' }}>{fmtShares(h.drip_shares_yearly)}</td>
                  <td style={{ textAlign: 'right', color: pfiColor(h.paid_for_itself), fontWeight: pfiVal(h.paid_for_itself) >= 100 ? 700 : 400 }}>
                    {h.paid_for_itself == null ? '—' : (h.paid_for_itself * 100).toFixed(2) + '%'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: cov == null ? '#6f7890' : navColor,
                      fontWeight: cov != null ? 600 : 400,
                      minWidth: 92,
                    }}
                    title={navTitle}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      <span>{cov != null ? cov.toFixed(2) : '—'}</span>
                      <select
                        aria-label={`${h.ticker} NAV erosion testing`}
                        value={navScope}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateNavScope(h.ticker, e.target.value, navBenchmark)}
                        title={navTitle}
                        style={{
                          width: 46,
                          height: 20,
                          border: '1px solid #294b73',
                          borderRadius: 4,
                          background: '#0f1c36',
                          color: navScope === 'test' ? '#7ecfff' : navScope === 'skip' ? '#ffb300' : '#9aa8bd',
                          fontSize: '0.62rem',
                          padding: '0 2px',
                        }}
                      >
                        <option value="auto">Auto</option>
                        <option value="test">Test</option>
                        <option value="skip">Skip</option>
                      </select>
                    </div>
                    <input
                      aria-label={`${h.ticker} NAV benchmark override`}
                      value={navBenchmarkInput}
                      placeholder={navMeta.benchmark || 'bench'}
                      onClick={e => e.stopPropagation()}
                      onChange={e => {
                        const value = e.target.value.toUpperCase()
                        setHoldings(prev => prev.map(row => (
                          row.ticker === h.ticker ? { ...row, nav_benchmark_override: value } : row
                        )))
                      }}
                      onBlur={e => updateNavScope(h.ticker, navScope, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                      title="Optional benchmark override, e.g. QQQ, GLD, BTC-USD, or BTC-USD+GLD"
                      style={{
                        width: 74,
                        marginTop: 2,
                        border: navBenchmarkInvalid ? '1px solid #ff6b6b' : '1px solid #203a5f',
                        borderRadius: 4,
                        background: '#0d1830',
                        color: navBenchmarkInvalid ? '#ffb3b3' : navBenchmark ? '#d7e8ff' : '#7d8799',
                        fontSize: '0.58rem',
                        padding: '1px 3px',
                        textAlign: 'right',
                      }}
                    />
                    <div style={{ fontSize: '0.58rem', color: '#7d8799', lineHeight: 1.1 }}>{navLabel}</div>
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
              <td colSpan={3} />
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.ytdDivs)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.currentMonthIncome)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.monthlyIncome)}</td>
              <td style={{ textAlign: 'right', color: '#9ad7ff' }}>{fmtShares(totals.dripSharesMonthly)}</td>
              <td style={{ textAlign: 'right', color: '#7ecfff' }}>{fmt(totals.monthlyReinvested)}</td>
              <td style={{ textAlign: 'right', color: '#ffb300' }}>{fmt(totals.monthlyNotReinvested)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.annualIncome)}</td>
              <td style={{ textAlign: 'right', color: '#9ad7ff' }}>{fmtShares(totals.dripSharesYearly)}</td>
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
