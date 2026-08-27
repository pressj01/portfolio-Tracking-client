import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../config'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'
import {
  MIN_PERFORMANCE_DATE,
  PERFORMANCE_PERIODS,
  PERFORMANCE_RANGE_NOTE,
  HOLDINGS_LIFETIME_MATCH_NOTE,
  addCustomRangeParams,
  customRangeError,
  isLifetimePerformancePeriod,
  formatPerformanceChartRange,
  formatPerformanceRange,
  readSharedPerformanceRange,
  todayInputValue,
} from '../utils/performancePeriods'
import useSharedPerformanceRange from '../utils/useSharedPerformanceRange'
import { gradeFund, DEFAULT_THRESHOLDS, verdictFromComposite as cefVerdict } from '../utils/cefGrading'
import {
  gradeETF,
  gradeOptionIncomeETF,
  ETF_DEFAULT_THRESHOLDS,
  OPTION_DEFAULT_THRESHOLDS,
  verdictFromComposite as etfVerdict,
} from '../utils/etfGrading'
import { gradeStock } from '../utils/stockGrading'
import {
  checklistCard,
  closureCard,
  discountCard,
  distributionCoverageCard,
  navFromSeed,
  navTrendCard,
  num,
} from '../utils/tickerResearch'

const METRIC_HELP = {
  'CEF discount': 'For closed-end funds, this is market price versus net asset value (NAV). A negative number means the fund trades below NAV at a discount; a positive number means a premium. It is not applicable to ordinary ETFs or stocks.',
  'NAV trend': 'When available, the large value is the Overall Verdict and 0–100 historical score, combining raw NAV decline, raw payout gap e ÷ d, benchmark-gated coverage, and relative drag. It is not a forecast. The detail preserves each component: positive raw e means NAV ERODER regardless of benchmark, while benchmark coverage is lower-is-better with 0–0.25 Low, above 0.25–0.75 Medium, and above 0.75 High.',
  'Distribution coverage': 'Shows whether the payout is supported. CEFs use earnings coverage when available, otherwise distribution rate versus long-term NAV return. ETFs and stocks compare current yield with one-year total return. For percentage-point gaps, zero or negative is better.',
  'Checklist score': 'The 0–100 composite from the buying checklist that matches this security type. Higher is better, but the detail also reports failed criteria so a strong average cannot hide a serious weak spot.',
  'Closure risk': 'An ETF viability estimate based on assets under management, expense ratio, estimated fee revenue, and fund age. It is a screening signal—not a closure announcement. This metric is not calculated for stocks or CEFs.',
}

function DecisionCard({ card, href, hrefLabel, onNavigate }) {
  const help = METRIC_HELP[card.label]
  const helpId = `trs-help-${card.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <article className={`trs-card tone-${card.tone || 'muted'}`}>
      <div className="trs-card-heading">
        <h3>{card.label}</h3>
        {help && (
          <span className="trs-inline-help">
            <button
              type="button"
              aria-label={`What does ${card.label} mean?`}
              aria-describedby={helpId}
              title={help}
            >?</button>
            <span id={helpId} className="trs-metric-tooltip" role="tooltip">{help}</span>
          </span>
        )}
      </div>
      <p className="trs-card-value">{card.value}</p>
      <p className="trs-card-detail">{card.detail}</p>
      {href && (
        <Link className="trs-card-link" to={href} onClick={onNavigate}>{hrefLabel || 'Open full page'}</Link>
      )}
    </article>
  )
}

function PositionChip({ label, value }) {
  return (
    <span className="trs-chip">
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  )
}

function lastNumber(values) {
  for (let index = (values || []).length - 1; index >= 0; index -= 1) {
    const value = Number(values[index])
    if (Number.isFinite(value)) return value
  }
  return null
}

function scoreChecklist(kind, payload) {
  if (kind === 'cef') {
    const fund = payload
    const graded = gradeFund(fund, [fund], DEFAULT_THRESHOLDS)
    const verdict = cefVerdict(graded.composite, graded.criteria)
    return {
      composite: graded.composite,
      verdict: verdict?.label,
      detail: verdict?.detail,
      tone: verdict?.tone === 'pass' ? 'good' : verdict?.tone === 'fail' ? 'bad' : verdict?.tone === 'warn' ? 'warn' : 'muted',
      kindLabel: 'CEF',
    }
  }
  if (kind === 'option_income') {
    const graded = gradeOptionIncomeETF(payload.fund, payload.peers || [payload.fund], OPTION_DEFAULT_THRESHOLDS)
    const verdict = etfVerdict(graded.composite, graded.criteria)
    return {
      composite: graded.composite,
      verdict: verdict?.label,
      detail: verdict?.detail,
      tone: verdict?.tone === 'pass' ? 'good' : verdict?.tone === 'fail' ? 'bad' : verdict?.tone === 'warn' ? 'warn' : 'muted',
      kindLabel: 'Option-income ETF',
    }
  }
  if (kind === 'etf') {
    const graded = gradeETF(payload.fund, payload.peers || [payload.fund], ETF_DEFAULT_THRESHOLDS)
    const verdict = etfVerdict(graded.composite, graded.criteria)
    return {
      composite: graded.composite,
      verdict: verdict?.label,
      detail: verdict?.detail,
      tone: verdict?.tone === 'pass' ? 'good' : verdict?.tone === 'fail' ? 'bad' : verdict?.tone === 'warn' ? 'warn' : 'muted',
      kindLabel: 'ETF',
    }
  }
  const graded = gradeStock(payload)
  return {
    composite: graded?.verdict?.combined,
    verdict: graded?.verdict?.label,
    detail: graded?.verdict?.detail,
    tone: graded?.verdict?.tone === 'pass' ? 'good' : graded?.verdict?.tone === 'fail' ? 'bad' : graded?.verdict?.tone === 'warn' ? 'warn' : 'muted',
    kindLabel: 'Stock',
  }
}

export default function TickerResearchSheet({ ticker, seed = null, onClose }) {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const { isDark } = useTheme()
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const initialRange = readSharedPerformanceRange()
  const [period, setPeriod] = useState(initialRange.period)
  const [customStart, setCustomStart] = useState(initialRange.start)
  const [customEnd, setCustomEnd] = useState(initialRange.end)
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotError, setSnapshotError] = useState('')
  const [snapshotLoading, setSnapshotLoading] = useState(true)
  const [freshNav, setFreshNav] = useState(undefined)
  const [navLoading, setNavLoading] = useState(false)
  const [research, setResearch] = useState(null)
  const [return1y, setReturn1y] = useState(null)
  const [checklist, setChecklist] = useState(null)
  const [chart, setChart] = useState(null)
  const [chartError, setChartError] = useState('')
  const [chartLoading, setChartLoading] = useState(false)

  useSharedPerformanceRange(period, customStart, customEnd, adopted => {
    setPeriod(adopted.period)
    setCustomStart(adopted.start)
    setCustomEnd(adopted.end)
  })

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])].filter(element => element.getClientRects().length > 0)
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [onClose])

  useEffect(() => {
    if (!ticker) return undefined
    let active = true
    setSnapshotLoading(true)
    setSnapshotError('')
    setSnapshot(null)
    setFreshNav(undefined)
    setNavLoading(false)
    setResearch(null)
    setChecklist(null)
    pf(`/api/ticker-research/${encodeURIComponent(ticker)}`)
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || `Could not load research for ${ticker}`)
        return body
      })
      .then(body => {
        if (!active) return
        setSnapshot(body)
      })
      .catch(error => {
        if (active) setSnapshotError(error.message || `Could not load research for ${ticker}`)
      })
      .finally(() => { if (active) setSnapshotLoading(false) })
    return () => { active = false }
  }, [ticker, pf, selection])

  const kind = snapshot?.kind || 'stock'
  const holding = snapshot?.holding || seed?.holding || null
  const cef = snapshot?.cef || null
  const nav = snapshot?.nav || freshNav || navFromSeed(seed)
  const links = snapshot?.links || {}

  useEffect(() => {
    if (!ticker || !snapshot?.holding || snapshot.nav) return undefined
    let active = true
    setNavLoading(true)
    pf(`/api/ticker-research/${encodeURIComponent(ticker)}/nav`)
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || `Could not compute NAV coverage for ${ticker}`)
        return body
      })
      .then(body => { if (active) setFreshNav(body.nav || null) })
      .catch(() => { if (active) setFreshNav(null) })
      .finally(() => { if (active) setNavLoading(false) })
    return () => { active = false }
  }, [ticker, snapshot, pf, selection])

  useEffect(() => {
    if (!ticker || !snapshot || kind === 'cef') return undefined
    let active = true
    const first = kind === 'stock' ? 'stock' : 'etf'
    const second = first === 'etf' ? 'stock' : 'etf'
    const lookup = nextKind => pf(`/api/security-research/${nextKind}/${encodeURIComponent(ticker)}?_=${Date.now()}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok || body.error) throw new Error(body.error || 'not found')
        return body
      })
    lookup(first)
      .catch(() => lookup(second))
      .then(body => { if (active) setResearch(body) })
      .catch(() => { if (active) setResearch(null) })
    return () => { active = false }
  }, [ticker, snapshot, kind, pf])

  useEffect(() => {
    if (!ticker || !snapshot || kind === 'cef') return undefined
    let active = true
    pf(`/api/ticker-return-1y/${encodeURIComponent(ticker)}?_=${Date.now()}`, { cache: 'no-store' })
      .then(response => response.json())
      .then(body => {
        if (!active || body.error) return
        setReturn1y(lastNumber(body.total_return))
      })
      .catch(() => {})
    return () => { active = false }
  }, [ticker, snapshot, kind, pf])

  useEffect(() => {
    if (!ticker || !snapshot) return undefined
    let active = true
    setChecklist(null)
    const fail = message => { if (active) setChecklist({ error: message }) }
    if (kind === 'cef') {
      if (!cef) {
        fail('Not in CEF Connect daily pricing — open the CEF checklist to search.')
        return undefined
      }
      try {
        setChecklist(scoreChecklist('cef', cef))
      } catch (error) {
        fail(error.message || 'Could not score the CEF checklist.')
      }
      return undefined
    }
    const load = kind === 'stock'
      ? fetch(`${API_BASE}/api/stock-evaluate/${encodeURIComponent(ticker)}`, { cache: 'no-store' })
      : fetch(`${API_BASE}/api/etf-evaluate/${encodeURIComponent(ticker)}`, { cache: 'no-store' })
    load
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok || body.error) throw new Error(body.error || 'Could not score this ticker.')
        return body
      })
      .then(body => {
        if (!active) return
        if (kind === 'stock') setChecklist(scoreChecklist('stock', body))
        else setChecklist(scoreChecklist(kind, body))
      })
      .catch(error => fail(error.message))
    return () => { active = false }
  }, [ticker, snapshot, kind, cef])

  const rangeError = customRangeError(period, customStart, customEnd)

  useEffect(() => {
    if (!ticker) return undefined
    if (isLifetimePerformancePeriod(period)) {
      setChart(null)
      setChartLoading(false)
      setChartError('')
      return undefined
    }
    if (rangeError) {
      setChart(null)
      setChartLoading(false)
      setChartError(rangeError)
      return undefined
    }
    let active = true
    setChartLoading(true)
    setChartError('')
    setChart(null)
    const params = new URLSearchParams({ period })
    addCustomRangeParams(params, period, customStart, customEnd)
    pf(`/api/ticker-return/${encodeURIComponent(ticker)}?${params}`)
      .then(async response => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || `Could not load return data for ${ticker}`)
        return body
      })
      .then(body => {
        if (!active) return
        if (body.error) throw new Error(body.error)
        setChart(body)
      })
      .catch(error => { if (active) setChartError(error.message) })
      .finally(() => { if (active) setChartLoading(false) })
    return () => { active = false }
  }, [ticker, pf, selection, period, customStart, customEnd, rangeError])

  useEffect(() => {
    if (!chart || chart.history_pending || !window.Plotly) return undefined
    const el = document.getElementById('ticker-research-chart')
    if (!el) return undefined
    const hasTotalReturn = chart.total_return_available !== false && Array.isArray(chart.total_return)
    const traces = hasTotalReturn
      ? [
          {
            x: chart.dates, y: chart.price_return,
            mode: 'lines', name: 'Price Return %',
            line: { color: '#7ecfff', width: 2 },
            hovertemplate: '%{y:.2f}%<extra>Price</extra>',
          },
          {
            x: chart.dates, y: chart.total_return,
            mode: 'lines', name: 'Total Return %',
            line: { color: isDark ? '#4dff91' : '#15803d', width: 2 },
            fill: 'tonexty', fillcolor: isDark ? 'rgba(77,255,145,0.08)' : 'rgba(21,128,61,0.10)',
            hovertemplate: '%{y:.2f}%<extra>Total</extra>',
          },
        ]
      : [
          {
            x: chart.dates, y: chart.prices,
            mode: 'lines', name: 'Price',
            line: { color: '#7ecfff', width: 2 },
            hovertemplate: '$%{y:.2f}<extra>Price</extra>',
          },
        ]
    const ct = chartTheme(isDark)
    const chartRange = formatPerformanceChartRange(
      chart.requested_start_date,
      chart.requested_end_date,
      chart.effective_start_date || chart.dates?.[0],
      chart.effective_end_date || chart.dates?.[chart.dates.length - 1],
    )
    window.Plotly.newPlot(el, traces, {
      template: ct.template,
      paper_bgcolor: ct.paper,
      plot_bgcolor: ct.plot,
      title: {
        text: `${chart.ticker} — ${hasTotalReturn ? `${chart.period_label || 'Selected Period'} Return` : 'Recent Price History'}${chartRange ? `<br><sup>${chartRange}</sup>` : ''}`,
        font: { size: 16, color: ct.title },
      },
      xaxis: { title: '', gridcolor: ct.grid },
      yaxis: hasTotalReturn
        ? { title: 'Return %', gridcolor: ct.grid, ticksuffix: '%' }
        : { title: 'Price', gridcolor: ct.grid, tickprefix: '$' },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 12 } },
      margin: { l: 50, r: 20, t: 80, b: 40 },
      hovermode: 'x unified',
      shapes: hasTotalReturn
        ? [{ type: 'line', x0: chart.dates[0], x1: chart.dates[chart.dates.length - 1], y0: 0, y1: 0, line: { dash: 'dot', color: ct.zeroline, width: 1 } }]
        : [],
    }, { responsive: true })
    return () => { if (el) window.Plotly.purge(el) }
  }, [chart, isDark])

  const researchWithReturn = useMemo(() => {
    if (!research) return research
    return { ...research, return_1y: return1y, estimated_yield_pct: research.estimated_yield_pct }
  }, [research, return1y])

  const cards = [
    { card: discountCard(cef), href: kind === 'cef' ? links.closed_cef : null, hrefLabel: 'Closed CEF Information' },
    { card: navTrendCard(nav, navLoading), href: links.nav_erosion, hrefLabel: 'NAV Erosion' },
    { card: distributionCoverageCard(cef, researchWithReturn), href: kind === 'cef' ? links.closed_cef : links.research, hrefLabel: kind === 'cef' ? 'Closed CEF Information' : 'Security Research' },
    { card: checklistCard(kind, checklist), href: links.checklist, hrefLabel: 'Open checklist' },
    { card: closureCard(research?.closure_risk || seed?.closure), href: links.research, hrefLabel: 'Security Research' },
  ]

  const title = research?.name || holding?.description || cef?.name || ticker
  const endingTotalReturn = lastNumber(chart?.total_return)
  const endingPriceReturn = lastNumber(chart?.price_return)
  const yieldPct = num(holding?.current_annual_yield)
  const yieldDisplay = yieldPct == null
    ? '—'
    : `${(yieldPct > 1 ? yieldPct : yieldPct * 100).toFixed(2)}%`

  return (
    <div className="modal-overlay ticker-research-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-content ticker-research-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticker-research-title"
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
      >
        <button ref={closeButtonRef} className="modal-close" type="button" onClick={onClose} aria-label="Close research sheet">&times;</button>
        <header className="trs-header">
          <p className="trs-kicker">{snapshot?.kind_label || 'Security'}</p>
          <h2 id="ticker-research-title">{ticker} — {title}</h2>
          {holding ? (
            <div className="trs-position" aria-label="Position">
              <PositionChip label="Shares" value={Number(holding.quantity).toLocaleString()} />
              <PositionChip label="Value" value={formatMoney(holding.current_value)} />
              <PositionChip label="Cost" value={formatMoney(holding.purchase_value)} />
              <PositionChip label="Paid" value={formatMoney(holding.price_paid, { maximumFractionDigits: 4 })} />
              <PositionChip label="Yield" value={yieldDisplay} />
              {holding.purchase_date && (
                <PositionChip
                  label={holding.purchase_date_source === 'import_date' ? 'Tracked' : 'Purchased'}
                  value={holding.purchase_date}
                />
              )}
            </div>
          ) : (
            <p className="trs-empty-position">Not in the current portfolio — showing public research only.</p>
          )}
        </header>

        {snapshotError && <div className="alert alert-error">{snapshotError}</div>}
        {snapshotLoading && !snapshot && (
          <div className="trs-loading"><span className="spinner" /> Loading position, CEF quote, and NAV coverage…</div>
        )}

        <section className="trs-decision" aria-label="Research decision">
          {cards.map(item => (
            <DecisionCard
              key={item.card.label}
              card={item.card}
              href={item.href}
              hrefLabel={item.hrefLabel}
              onNavigate={onClose}
            />
          ))}
        </section>

        <nav className="trs-links" aria-label="Open the full research tools">
          {links.research && <Link to={links.research} onClick={onClose}>Security Research</Link>}
          {kind === 'cef' && links.closed_cef && <Link to={links.closed_cef} onClick={onClose}>Closed CEF Information</Link>}
          {links.nav_erosion && <Link to={links.nav_erosion} onClick={onClose}>NAV Erosion</Link>}
          {links.etf_screen && <Link to={links.etf_screen} onClick={onClose}>Stock &amp; ETF Analysis</Link>}
          {links.checklist && <Link to={links.checklist} onClick={onClose}>Matching checklist</Link>}
        </nav>

        <section className="trs-chart-block">
          <div className="growth-filter-group" style={{ marginBottom: '0.75rem', paddingRight: '2rem' }}>
            <label>Shared Performance Date Range</label>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {PERFORMANCE_PERIODS.map(option => (
                <button
                  type="button"
                  key={option.key}
                  className={`tr-pbtn${period === option.key ? ' tr-pbtn-active' : ''}`}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                  title={option.hint}
                  onClick={() => setPeriod(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="tr-note perf-range-note">{PERFORMANCE_RANGE_NOTE}</p>
            {isLifetimePerformancePeriod(period) && (
              <div className="alert alert-info" style={{ marginTop: '0.65rem' }}>
                <strong>Matches Holdings:</strong> {HOLDINGS_LIFETIME_MATCH_NOTE}
              </div>
            )}
          </div>
          {period === 'custom' && (
            <div className="g2-custom-range" role="group" aria-label="Custom holding return date range" style={{ marginBottom: '0.75rem' }}>
              <label>
                <span>Start date</span>
                <input
                  type="date"
                  value={customStart}
                  min={MIN_PERFORMANCE_DATE}
                  max={customEnd || todayInputValue()}
                  onChange={event => setCustomStart(event.target.value)}
                />
              </label>
              <label>
                <span>End date</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart || MIN_PERFORMANCE_DATE}
                  max={todayInputValue()}
                  onChange={event => setCustomEnd(event.target.value)}
                />
              </label>
            </div>
          )}
          {chartLoading && <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></div>}
          {chartError && <div className="alert alert-error">{chartError}</div>}
          {chart?.history_pending && (
            <div className="alert alert-info">{chart.message}</div>
          )}
          {chart && !chart.history_pending && (
            <>
              {chart.return_basis === 'market_period' && (
                <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                  Purchase date unavailable — showing this ticker&apos;s market return for the selected period.
                </div>
              )}
              <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
                <strong>{chart.period_label || 'Selected period'}:</strong>{' '}
                {formatPerformanceRange(chart.effective_start_date, chart.effective_end_date)
                  || formatPerformanceRange(chart.requested_start_date, chart.requested_end_date)
                  || 'Dates unavailable'}
                {endingTotalReturn != null && (
                  <> — <strong>Total Return {endingTotalReturn.toFixed(2)}%</strong></>
                )}
                {endingPriceReturn != null && `; Price Return ${endingPriceReturn.toFixed(2)}%`}
              </div>
              <div id="ticker-research-chart" style={{ height: '360px' }} />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
