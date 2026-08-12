import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react'
import { API_BASE } from '../config'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useMarketRefresh } from '../context/MarketRefreshContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { prorateAnnualYield, returnVsYield } from '../utils/returnVsYield'
import { readDashboardCache, writeDashboardCache, dashboardCacheKey as buildDashboardCacheKey } from '../utils/dashboardCache'
import { formatMoney } from '../utils/money'
import {
  MIN_PERFORMANCE_DATE,
  PERFORMANCE_PERIODS,
  PERFORMANCE_RANGE_NOTE,
  addCustomRangeParams,
  customRangeError,
  formatAccountingCoverage,
  formatPerformanceChartRange,
  formatPerformanceRange,
  readSharedPerformanceRange,
  todayInputValue,
  writeSharedPerformanceRange,
} from '../utils/performancePeriods'
import ColumnCustomizer from '../components/ColumnCustomizer'
import { useColumnLayout } from '../utils/useColumnLayout'
import { layoutFromVisibleKeys } from '../utils/columnLayout'

const DASHBOARD_CACHE_TTL_MS = 60 * 60 * 1000
const SP500_CACHE_KEY = 'portfolio_dashboard_sp500'
// Holds an {order, hidden} layout so a switched-off column keeps its place
// for when it comes back. The key is unchanged: the old bare list of visible
// ids is migrated in place on first read (migrateLegacyHoldingColumns).
const HOLDINGS_COLUMN_PREF_KEY = 'dashboard_holdings_visible_columns_v1'
// Freeze the first N visible holdings columns horizontally (Excel-style freeze
// panes). By default the 5th column is "Purchased", so freezing 5 keeps
// Ticker → Purchased pinned while the rest scroll under them.
const FROZEN_HOLDING_COLS = 5
const CLOSURE_DISMISS_KEY = 'dashboard_closure_warning_dismissed_v1'
// Mirrors grading.ABSOLUTE_MIN_RATIO_OBSERVATIONS — the shortest window the
// backend will annualize a risk ratio over. Only used to explain the 7D tab.
const SHORT_WINDOW_MIN_TRADING_DAYS = 15
const OVERVIEW_RETURN_MODE_KEY = 'dashboard_overview_return_mode_v1'
const NAV_RETURN_MODE_KEY = 'dashboard_nav_return_mode_v1'
const IMPORT_DISMISS_KEY = 'dashboard_import_warning_dismissed_v1'
const IRR_EXCLUSIONS_KEY_PREFIX = 'dashboard_irr_exclusions_v1_'
const validSp500 = value => value?.price != null && Number.isFinite(Number(value.price))

const normalizeIrrExclusions = tickers => [...new Set((tickers || [])
  .map(ticker => String(ticker || '').trim().toUpperCase())
  .filter(Boolean))].sort()

const readIrrExclusions = selection => {
  if (typeof window === 'undefined' || !selection) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${IRR_EXCLUSIONS_KEY_PREFIX}${selection}`) || '[]')
    return Array.isArray(parsed) ? normalizeIrrExclusions(parsed) : []
  } catch {
    return []
  }
}

const persistIrrExclusions = (selection, tickers) => {
  if (typeof window === 'undefined' || !selection) return
  try {
    window.localStorage.setItem(
      `${IRR_EXCLUSIONS_KEY_PREFIX}${selection}`,
      JSON.stringify(normalizeIrrExclusions(tickers)),
    )
  } catch {
    // best-effort
  }
}

const portfolioValuePath = (selection, tickers = readIrrExclusions(selection)) => {
  const exclusions = normalizeIrrExclusions(tickers)
  if (!exclusions.length) return '/api/portfolio-value'
  const params = new URLSearchParams({ irr_exclude: exclusions.join(',') })
  return `/api/portfolio-value?${params}`
}

const DEFAULT_HOLDINGS_COLUMN_IDS = [
  'ticker',
  'description',
  'category',
  'div_frequency',
  'purchase_date',
  'ex_div_date',
  'div_pay_date',
  'quantity',
  'price_paid',
  'current_price',
  'pct_of_account',
  'price_return_pct',
  'total_return_pct',
  'beta',
  'delta_up',
  'delta_down',
  'ret_vs_yld',
  'div',
  'current_annual_yield',
  'annual_yield_on_cost',
  'ytd_divs',
  'current_month_income',
  'approx_monthly_income',
  'drip_shares_monthly',
  'monthly_income_reinvested',
  'monthly_income_not_reinvested',
  'estim_payment_per_year',
  'drip_shares_yearly',
  'paid_for_itself',
  'nav',
  'closure_risk',
  'grade',
]

const SPREADSHEET_DELTA_COLUMN_IDS = [
  'percent_change',
  'purchase_value',
  'current_value',
  'gain_or_loss',
  'reinvest',
  'dividend_paid',
  'withdraw_8pct_cost_annually',
  'withdraw_8pct_per_month',
  'cash_not_reinvested',
  'total_cash_reinvested',
  'shares_bought_from_dividend',
  'shares_bought_in_year',
  'shares_in_month',
  'total_divs_received',
  'current_month_income_delta',
]

// v1 saved a bare list of the visible ids. That list is already an order, so it
// converts to the {order, hidden} layout without the user losing a thing.
const migrateLegacyHoldingColumns = (parsed) => {
  if (!Array.isArray(parsed) || !parsed.length) return null
  const ids = [...parsed]
  // One-time migration: surface the Closure Risk column for users whose saved
  // column set predates it (insert next to NAV/Grade, not at the end).
  if (!ids.includes('closure_risk')) {
    const anchor = ids.indexOf('grade')
    const at = anchor >= 0 ? anchor : (ids.indexOf('nav') >= 0 ? ids.indexOf('nav') + 1 : ids.length)
    ids.splice(at, 0, 'closure_risk')
  }
  return layoutFromVisibleKeys(ids, [...new Set([...ids, ...ALL_HOLDING_COLUMN_IDS])])
}

const HOLDINGS_LOCKED_COLS = ['ticker']
const HOLDINGS_COLUMN_PRESETS = [
  { label: 'Current View', keys: DEFAULT_HOLDINGS_COLUMN_IDS, tip: 'The columns the dashboard ships with' },
  {
    label: 'All Calculated',
    keys: [...DEFAULT_HOLDINGS_COLUMN_IDS, ...SPREADSHEET_DELTA_COLUMN_IDS],
    tip: 'Everything, including the calculated spreadsheet additions',
  },
]
const ALL_HOLDING_COLUMN_IDS = [...DEFAULT_HOLDINGS_COLUMN_IDS, ...SPREADSHEET_DELTA_COLUMN_IDS]

const readOverviewReturnMode = () => {
  if (typeof window === 'undefined') return 'price'
  try {
    return window.localStorage.getItem(OVERVIEW_RETURN_MODE_KEY) === 'total' ? 'total' : 'price'
  } catch {
    return 'price'
  }
}

const persistOverviewReturnMode = (mode) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(OVERVIEW_RETURN_MODE_KEY, mode)
  } catch {}
}

const readNavReturnMode = () => {
  if (typeof window === 'undefined') return 'price'
  try {
    return window.localStorage.getItem(NAV_RETURN_MODE_KEY) === 'total' ? 'total' : 'price'
  } catch {
    return 'price'
  }
}

const persistNavReturnMode = (mode) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(NAV_RETURN_MODE_KEY, mode)
  } catch {}
}


const fmt = (v, d = 2) => formatMoney(v, { digits: d, zeroIfInvalid: true })
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
// Rows are shown as stored. A blank frequency means the holding pays nothing
// (a growth stock, a non-payer), so it renders as — rather than being defaulted
// to Monthly, which invented a cadence for securities that have no dividend.
const normalizeDashboardHoldings = (rows) => Array.isArray(rows) ? rows : []
const shortDate = (value) => {
  if (!value) return ''
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
// Date-only strings (YYYY-MM-DD) parse as UTC midnight, which can render a day
// early in negative-UTC timezones. Pin to local midnight so dates match the editor.
const localDateString = (value) => {
  if (!value) return ''
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}
// Ex-div / pay dates arrive from the backend as MM/DD/YY strings (some null).
const exPayDisplay = (value) => value || '—'
// Sortable key from a MM/DD/YY string → YYYYMMDD integer (missing sorts last).
const exPaySortKey = (value) => {
  if (!value) return -1
  const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? -1 : d.getTime()
  }
  let year = parseInt(m[3], 10)
  if (year < 100) year += 2000
  return year * 10000 + parseInt(m[1], 10) * 100 + parseInt(m[2], 10)
}
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) * 100).toFixed(2) + '%')
const navSeverityFromRatio = (v) => v == null ? null : v > 0.75 ? 'High' : v > 0.25 ? 'Medium' : 'Low'
const navSeverityColor = (severity) => severity === 'High' ? 'var(--neg)' : severity === 'Medium' ? 'var(--warning-money)' : severity === 'Low' ? 'var(--pos)' : 'var(--text-dim)'
const navSeverityBg = (severity) => severity === 'High' ? 'color-mix(in srgb, var(--neg) 14%, transparent)' : severity === 'Medium' ? 'color-mix(in srgb, var(--warning-money) 14%, transparent)' : 'color-mix(in srgb, var(--pos) 14%, transparent)'
const navSeverityText = (severity) => severity === 'High' ? 'High Benchmark-Adjusted NAV Erosion' : severity === 'Medium' ? 'Moderate Benchmark-Adjusted NAV Erosion' : 'Low Benchmark-Adjusted NAV Erosion'

// ── ETF closure risk (fund too small to be profitable for the issuer) ──────────
const CLOSURE_TIER = {
  high: { rank: 3, label: 'High', color: 'var(--neg)' },
  elevated: { rank: 2, label: 'Elevated', color: 'var(--warning-money)' },
  watch: { rank: 1, label: 'Watch', color: 'var(--warning-text)' },
  ok: { rank: 0, label: 'OK', color: 'var(--pos)' },
  unknown: { rank: -1, label: '?', color: 'var(--text-dim)' },
}
const closureRank = (info) => CLOSURE_TIER[info?.tier]?.rank ?? -2
const isAtClosureRisk = (info) => ['watch', 'elevated', 'high'].includes(info?.tier)

function ClosureRiskBadge({ info }) {
  if (!info) return <span style={{ color: 'var(--text-dim)' }} title="Not an ETF — individual stocks aren't rated for closure risk.">—</span>
  const tier = CLOSURE_TIER[info.tier] || CLOSURE_TIER.unknown
  if (info.tier === 'ok' || info.tier === 'unknown') {
    return <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }} title={info.reason || ''}>{tier.label}</span>
  }
  return (
    <span
      title={info.reason || ''}
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 10,
        fontSize: '0.68rem',
        fontWeight: 700,
        color: tier.color,
        background: `color-mix(in srgb, ${tier.color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tier.color} 45%, transparent)`,
        whiteSpace: 'nowrap',
      }}
    >
      {tier.label}
    </span>
  )
}

// A warning banner the user can hide and re-open. `signature` identifies the
// current situation (e.g. the set of at-risk tickers or stale accounts): the
// banner collapses to a slim "…— warning hidden. Show" bar while a dismissal
// matches it, and re-alerts on its own if the situation later changes. The
// dismissal persists in localStorage under `storageKey`.
function DismissibleBanner({ storageKey, signature, collapsedContent, children }) {
  const [dismissedSig, setDismissedSig] = useState(() => {
    if (typeof window === 'undefined') return null
    try { return window.localStorage.getItem(storageKey) } catch { return null }
  })
  const hide = () => {
    try { window.localStorage.setItem(storageKey, signature) } catch {}
    setDismissedSig(signature)
  }
  const show = () => {
    try { window.localStorage.removeItem(storageKey) } catch {}
    setDismissedSig(null)
  }
  if (signature && signature === dismissedSig) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', padding: '0.35rem 0.7rem', fontSize: '0.8rem', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 6 }}>
        {collapsedContent}
        <button
          type="button"
          onClick={show}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-bright)', fontWeight: 600, textDecoration: 'underline', padding: 0, fontSize: '0.8rem' }}
        >
          Show
        </button>
      </div>
    )
  }
  return (
    <div className="alert alert-warning" style={{ marginBottom: '1rem', position: 'relative' }}>
      <button
        type="button"
        onClick={hide}
        title="Hide this warning (it returns on its own if the situation changes)"
        aria-label="Hide warning"
        style={{ position: 'absolute', top: '0.5rem', right: '0.6rem', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '1.1rem', lineHeight: 1, padding: '0.15rem 0.35rem' }}
      >
        ✕
      </button>
      <div style={{ paddingRight: '1.5rem' }}>
        {children}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, sub, color, className, title, action }) {
  return (
    <div className={`summary-card ${className || ''}`} title={title}>
      <div className="summary-label">{label}</div>
      <div className="summary-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="summary-sub">{sub}</div>}
      {action && <div style={{ marginTop: '0.45rem' }}>{action}</div>}
    </div>
  )
}

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function BenchmarkBetaCard({ benchmark, onBenchmarkChange, beta, exposure }) {
  const options = [
    { key: 'sp500', label: 'S&P 500' },
    { key: 'nasdaq', label: 'Nasdaq' },
  ]
  const benchmarkLabel = options.find(option => option.key === benchmark)?.label || 'benchmark'
  const betaNumber = beta == null ? null : Number(beta)
  const value = betaNumber == null || !Number.isFinite(betaNumber) ? '--' : `${betaNumber.toFixed(2)}x`
  const relativeMovePct = betaNumber == null || !Number.isFinite(betaNumber) ? null : betaNumber * 100
  const onePctMove = exposure == null || !Number.isFinite(Number(exposure)) ? null : exposure * 0.01
  const betaBucket = betaNumber == null || !Number.isFinite(betaNumber)
    ? null
    : betaNumber < 0.5
      ? 'Below conservative income'
      : betaNumber <= 0.7
        ? 'Conservative income'
        : betaNumber <= 0.9
          ? 'Balanced income'
          : betaNumber <= 1.15
            ? 'Aggressive income'
            : 'Very aggressive income'

  return (
    <div
      className="summary-card summary-card-beta"
      title="Portfolio beta compares the portfolio's return sensitivity to the selected benchmark."
    >
      <div className="summary-label-row">
        <div className="summary-label">Portfolio Beta</div>
        <div className="benchmark-toggle" aria-label="Beta benchmark">
          {options.map(option => (
            <button
              key={option.key}
              type="button"
              className={benchmark === option.key ? 'active' : ''}
              onClick={() => onBenchmarkChange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="summary-value">{value}</div>
      {relativeMovePct == null ? (
        <div className="summary-sub">Relative move unavailable</div>
      ) : (
        <>
          <div className="summary-sub">{betaBucket}</div>
          <div className="summary-sub">~{relativeMovePct.toFixed(0)}% of {benchmarkLabel} moves</div>
          {onePctMove != null && <div className="summary-sub">~{fmt(onePctMove, 0)} per 1% benchmark move</div>}
        </>
      )}
    </div>
  )
}

function UpcomingDividends({ events }) {
  if (!events || events.length === 0) {
    return (
      <div className="upcoming-dividends card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <h3 style={{ color: 'var(--accent-2)', marginBottom: '0.5rem', fontSize: '1rem' }}>Upcoming Dividends This Week</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No ex-dividend dates in the next 7 days.</p>
      </div>
    )
  }

  const sortedEvents = [...events].sort((a, b) => (
    (a.ex_date || '').localeCompare(b.ex_date || '')
    || (a.ticker || '').localeCompare(b.ticker || '')
  ))
  const totalEst = events.reduce((s, e) => s + e.est_payment, 0)

  return (
    <div className="upcoming-dividends card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ color: 'var(--accent-2)', margin: 0, fontSize: '1rem' }}>Upcoming Dividends This Week</h3>
        <span style={{ color: 'var(--pos)', fontWeight: 700, fontSize: '0.95rem' }}>Est. Total: {fmt(totalEst)}</span>
      </div>
      <div className="upcoming-grid">
        {sortedEvents.map((e, i) => (
          <div key={i} className="upcoming-event" style={{ borderLeft: `3px solid ${e.color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--accent-bright)', fontWeight: 700 }}>{e.ticker}</span>
              <span className="upcoming-freq" style={{ color: e.color }}>{e.freq_label}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
              Ex: {e.ex_weekday} {new Date(e.ex_date + 'T00:00').toLocaleDateString()}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Pay: {e.pay_estimated === false ? '' : '~'}{e.pay_weekday} {new Date(e.pay_date + 'T00:00').toLocaleDateString()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim-2)' }}>{formatMoney(e.amount)}/share</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--pos)', fontWeight: 600 }}>{fmt(e.est_payment)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Per-holding pieces behind the Portfolio overview's two return views. Price
// return is just value − invested; total return adds lifetime dividends and
// gains already realized on trimmed shares, over the same invested-cost floor
// the holdings table uses (see backend _apply_basis_mode_to_holdings).
const overviewReturnParts = (h) => {
  const value = Number(h?.current_value) || 0
  const invested = Number(h?.purchase_value) || 0
  // Use the backend's gain_or_loss (recomputed against the selected basis) so
  // these rows match the holdings table exactly; value − invested drifts by a
  // few cents because price_paid is stored rounded.
  const gain = invested > 0 && Number.isFinite(Number(h?.gain_or_loss))
    ? Number(h.gain_or_loss)
    : value - invested
  return {
    value,
    invested,
    gain,
    income: Number(h?.total_return_divs_component ?? h?.total_divs_received) || 0,
    realized: Number(h?.total_return_realized_component) || 0,
    trBasis: Number(h?.total_return_basis || h?.purchase_value) || 0,
  }
}

const addReturnParts = (bucket, parts) => {
  bucket.value += Number(parts.value) || 0
  bucket.invested += Number(parts.invested) || 0
  bucket.gain += Number(parts.gain ?? ((Number(parts.value) || 0) - (Number(parts.invested) || 0))) || 0
  bucket.income += Number(parts.income) || 0
  bucket.realized += Number(parts.realized) || 0
  bucket.trBasis += Number(parts.trBasis) || Number(parts.invested) || 0
  bucket.count += 1
  return bucket
}

const emptyReturnBucket = (name) => ({ name, value: 0, invested: 0, gain: 0, income: 0, realized: 0, trBasis: 0, count: 0 })

const sumReturnParts = (name, items) => items.reduce(addReturnParts, emptyReturnBucket(name))

// Gain shown for one row, in the selected mode. Groups cached before this
// feature existed have no income/basis fields, so both fall back to the
// price-return numbers rather than rendering blanks.
const groupGain = (g, mode) => {
  const priceGain = Number(g.gain ?? ((Number(g.value) || 0) - (Number(g.invested) || 0))) || 0
  if (mode !== 'total') {
    const basis = Number(g.invested) || 0
    return { gain: priceGain, income: 0, realized: 0, pct: basis ? (priceGain / basis) * 100 : 0 }
  }
  const income = Number(g.income) || 0
  const realized = Number(g.realized) || 0
  const basis = Number(g.trBasis) || Number(g.invested) || 0
  const gain = priceGain + income + realized
  return { gain, income, realized, pct: basis ? (gain / basis) * 100 : 0 }
}

const DONUT_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8',
  '#4dd0e1', '#aed581', '#fff176', '#f06292', '#7986cb',
  '#90a4ae', '#a1887f',
]

function PortfolioOverview({ groups, categories, totalValue, categoryId, subcategoryId, onFilterChange, returnMode, onReturnModeChange }) {
  const chartRef = React.useRef(null)
  const { isDark } = useTheme()
  const catId = categoryId ?? null
  const subId = subcategoryId ?? null

  const selectedCat = useMemo(
    () => (categories && catId != null ? categories.find(c => String(c.id) === String(catId)) : null),
    [categories, catId]
  )

  // Groups actually shown in the donut + table, derived from the active filter.
  // Top level → one slice per category; drill into a category → its
  // sub-categories (+ an "Unassigned" bucket); drill into a sub-category (or a
  // category without sub-categories) → individual holdings.
  const displayGroups = useMemo(() => {
    if (!selectedCat) return groups || []

    if (subId != null) {
      return selectedCat.tickers
        .filter(t => String(t.subcategory_id ?? '') === String(subId))
        .map(t => sumReturnParts(t.ticker, [t]))
        .sort((a, b) => b.value - a.value)
    }

    const subcats = selectedCat.subcategories || []
    if (subcats.length) {
      const bySub = new Map()
      subcats.forEach(s => bySub.set(s.id, emptyReturnBucket(s.name)))
      const unassigned = emptyReturnBucket('Unassigned')
      selectedCat.tickers.forEach(t => {
        const bucket = (t.subcategory_id != null && bySub.get(t.subcategory_id)) || unassigned
        addReturnParts(bucket, t)
      })
      return [...bySub.values(), unassigned]
        .filter(g => g.count > 0)
        .sort((a, b) => b.value - a.value)
    }

    return selectedCat.tickers
      .map(t => sumReturnParts(t.ticker, [t]))
      .sort((a, b) => b.value - a.value)
  }, [groups, selectedCat, subId])

  // Target ring only makes sense at the top level (sub-categories / holdings
  // have no allocation targets).
  const atTopLevel = !selectedCat
  const hasTargets = atTopLevel && displayGroups.some(g => g.target_pct != null)
  const totalTarget = atTopLevel ? displayGroups.reduce((s, g) => s + (Number(g.target_pct) || 0), 0) : 0
  const showTargetRing = hasTargets && totalTarget > 0

  // When drilled into a category (or sub-category), each row's Allocation also
  // shows its share of the parent group, alongside its share of the whole
  // portfolio. The displayed groups sum to the parent's value in every
  // drill-down case (sub-categories of a category, or holdings of either).
  const parentValue = atTopLevel ? 0 : displayGroups.reduce((s, g) => s + (Number(g.value) || 0), 0)
  const parentName = !selectedCat
    ? null
    : (subId != null
        ? (selectedCat.subcategories?.find(s => s.id === subId)?.name || selectedCat.name)
        : selectedCat.name)
  const parentAccountPct = (!atTopLevel && totalValue > 0 && parentValue > 0)
    ? (parentValue / totalValue) * 100
    : null

  useEffect(() => {
    if (!displayGroups.length || !window.Plotly || !chartRef.current) return
    const labels = displayGroups.map(g => g.name)
    const values = displayGroups.map(g => g.value)
    const colors = displayGroups.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length])

    const traces = []

    if (showTargetRing) {
      const sliceLabels = [], sliceValues = [], sliceColors = [], sliceHovers = []
      const toRgba = (hex, a) => {
        const r = parseInt(hex.slice(1,3),16), g2 = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
        return `rgba(${r},${g2},${b},${a})`
      }
      displayGroups.forEach((g, i) => {
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
        marker: { colors: sliceColors, line: { color: chartTheme(isDark).surface, width: 1.5 } },
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

    const ct = chartTheme(isDark)
    const layout = {
      template: ct.template,
      paper_bgcolor: ct.surface, plot_bgcolor: ct.surface,
      margin: { l: 10, r: 10, t: 10, b: 10 },
      showlegend: false,
      height: 280, width: 280,
      annotations: [],
    }
    window.Plotly.newPlot(chartRef.current, traces, layout, { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [displayGroups, showTargetRing, totalTarget, isDark])

  if (!groups || !groups.length) return null

  const selectStyle = {
    background: 'var(--border)', color: 'var(--text-strong)', border: '1px solid var(--border)',
    borderRadius: 6, padding: '0.3rem 0.5rem', fontSize: '0.8rem',
  }
  const canFilter = categories && categories.length > 0
  const isTotalMode = returnMode === 'total'

  return (
    <div className="portfolio-overview card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
      <h3 style={{ color: 'var(--accent-2)', margin: '0 0 0.75rem', fontSize: '1rem' }}>Portfolio</h3>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {canFilter && (
          <>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Category:</span>
          <select
            value={catId ?? ''}
            onChange={e => { const v = e.target.value; onFilterChange?.(v === '' ? null : Number(v), null) }}
            style={selectStyle}
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {selectedCat && (selectedCat.subcategories?.length > 0) && (
            <>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Sub-category:</span>
              <select
                value={subId ?? ''}
                onChange={e => { const v = e.target.value; onFilterChange?.(catId, v === '' ? null : Number(v)) }}
                style={selectStyle}
              >
                <option value="">All sub-categories</option>
                {selectedCat.subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          )}
          {parentAccountPct != null && (
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', fontWeight: 600 }}>
              {parentName}: {parentAccountPct.toFixed(2)}% of account
            </span>
          )}
          {catId != null && (
            <button
              onClick={() => onFilterChange?.(null, null)}
              style={{ ...selectStyle, cursor: 'pointer', color: 'var(--accent-2)' }}
            >
              Clear
            </button>
          )}
          </>
        )}
        <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Gain:</span>
        <select
          value={isTotalMode ? 'total' : 'price'}
          onChange={e => onReturnModeChange?.(e.target.value === 'total' ? 'total' : 'price')}
          style={selectStyle}
          title="Price return counts share-price change only. Total return adds lifetime dividends received and gains already realized on shares that were sold."
        >
          <option value="price">Price return</option>
          <option value="total">Total return (with dividends)</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        <div ref={chartRef} style={{ width: 280, flexShrink: 0 }} />
        <div style={{ flex: 1, overflowX: 'auto', minWidth: 0 }}>
          <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Name</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Value/Invested</th>
                <th
                  style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}
                  title={isTotalMode
                    ? 'Price change + lifetime dividends received + gains realized on shares already sold'
                    : 'Share-price change only — dividends received are excluded'}
                >
                  {isTotalMode ? 'Gain (total return)' : 'Gain (price return)'}
                </th>
                {showTargetRing && <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Target</th>}
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Allocation</th>
                {showTargetRing && <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem', color: 'var(--text-dim)' }}>Diff</th>}
              </tr>
            </thead>
            <tbody>
              {displayGroups.map((g, i) => {
                const color = DONUT_COLORS[i % DONUT_COLORS.length]
                const { gain, income, realized, pct: gainPct } = groupGain(g, returnMode)
                const alloc = totalValue ? ((g.value / totalValue) * 100) : 0
                const target = Number(g.target_pct) || 0
                const diff = showTargetRing && target > 0 ? alloc - target : null
                return (
                  <tr key={g.name} style={{ borderBottom: '1px solid var(--p-0a1628)' }}>
                    <td style={{ padding: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <div>
                          <div style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{g.name}</div>
                          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{g.count} item{g.count !== 1 ? 's' : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                      <div style={{ color: 'var(--text-strong)' }}>{fmt(g.value)}</div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{fmt(g.invested)}</div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                      <div style={{ color: gain >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{gain >= 0 ? '+' : ''}{fmt(gain)}</div>
                      <div style={{ color: gain >= 0 ? 'var(--pos)' : 'var(--neg)', fontSize: '0.75rem' }}>
                        {gain >= 0 ? '▲' : '▼'} {Math.abs(gainPct).toFixed(2)}%
                      </div>
                      {isTotalMode && (income > 0 || realized !== 0) && (
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                          incl. {fmt(income)} divs{realized !== 0 ? ` · ${fmt(realized)} realized` : ''}
                        </div>
                      )}
                    </td>
                    {showTargetRing && (
                      <td style={{ textAlign: 'right', padding: '0.5rem', color: 'var(--text-dim)' }}>
                        {target > 0 ? `${target.toFixed(0)}%` : '—'}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                      <div style={{ color: 'var(--text-strong)' }}>{alloc.toFixed(2)}%</div>
                      {!atTopLevel && parentValue > 0 && (
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                          {((g.value / parentValue) * 100).toFixed(1)}% of {parentName}
                        </div>
                      )}
                    </td>
                    {showTargetRing && (
                      <td style={{ textAlign: 'right', padding: '0.5rem' }}>
                        {diff != null ? (
                          <div style={{ color: diff >= 0 ? 'var(--pos)' : 'var(--neg)', fontWeight: 600 }}>
                            {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>—</span>
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

function TickerModal({
  ticker,
  onClose,
  period,
  customStart,
  customEnd,
  onPeriodChange,
  onCustomStartChange,
  onCustomEndChange,
  maxDate,
}) {
  const pf = useProfileFetch()
  const { isDark } = useTheme()
  const { selection } = useProfile()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const rangeError = customRangeError(period, customStart, customEnd)

  useEffect(() => {
    if (!ticker) return undefined
    if (rangeError) {
      setData(null)
      setLoading(false)
      setError(rangeError)
      return undefined
    }
    let active = true
    setLoading(true)
    setError(null)
    setData(null)
    const params = new URLSearchParams({ period })
    addCustomRangeParams(params, period, customStart, customEnd)
    pf(`/api/ticker-return/${encodeURIComponent(ticker)}?${params}`)
      .then(async r => {
        const payload = await r.json().catch(() => null)
        if (!r.ok) throw new Error(payload?.error || `Could not load return data for ${ticker}`)
        return payload
      })
      .then(d => {
        if (!active) return
        if (!d) throw new Error(`Could not load return data for ${ticker}`)
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [ticker, pf, selection, period, customStart, customEnd, rangeError])

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
            line: { color: isDark ? '#4dff91' : '#15803d', width: 2 },
            fill: 'tonexty', fillcolor: isDark ? 'rgba(77,255,145,0.08)' : 'rgba(21,128,61,0.10)',
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
    const ct = chartTheme(isDark)
    const chartRange = formatPerformanceChartRange(
      data.requested_start_date,
      data.requested_end_date,
      data.effective_start_date || data.dates?.[0],
      data.effective_end_date || data.dates?.[data.dates.length - 1],
    )
    const layout = {
      template: ct.template,
      paper_bgcolor: ct.paper, plot_bgcolor: ct.plot,
      title: { text: `${data.ticker} — ${hasTotalReturn ? `${data.period_label || 'Selected Period'} Return` : 'Recent Price History'}${chartRange ? `<br><sup>${chartRange}</sup>` : ''}`, font: { size: 16, color: ct.title } },
      xaxis: { title: '', gridcolor: ct.grid },
      yaxis: hasTotalReturn
        ? { title: 'Return %', gridcolor: ct.grid, ticksuffix: '%' }
        : { title: 'Price', gridcolor: ct.grid, tickprefix: '$' },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 12 } },
      margin: { l: 50, r: 20, t: 80, b: 40 },
      hovermode: 'x unified',
      shapes: hasTotalReturn
        ? [{ type: 'line', x0: data.dates[0], x1: data.dates[data.dates.length - 1], y0: 0, y1: 0, line: { dash: 'dot', color: ct.zeroline, width: 1 } }]
        : [],
    }
    window.Plotly.newPlot(el, traces, layout, { responsive: true })
    return () => { if (el) window.Plotly.purge(el) }
  }, [data, isDark])

  if (!ticker) return null

  const lastNumber = values => {
    for (let index = (values || []).length - 1; index >= 0; index -= 1) {
      const value = Number(values[index])
      if (Number.isFinite(value)) return value
    }
    return null
  }
  const endingTotalReturn = lastNumber(data?.total_return)
  const endingPriceReturn = lastNumber(data?.price_return)
  const effectiveRange = formatPerformanceRange(
    data?.effective_start_date,
    data?.effective_end_date,
  )
  const requestedRange = formatPerformanceRange(
    data?.requested_start_date,
    data?.requested_end_date,
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2 style={{ color: 'var(--accent-bright)', marginBottom: '0.25rem' }}>
          {data ? `${data.ticker} — ${data.description}` : ticker}
        </h2>
        {data && (
          <p style={{ color: 'var(--text-dim)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            Purchased {localDateString(data.purchase_date) || '—'} at {fmt(data.price_paid)}
          </p>
        )}
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
                onClick={() => onPeriodChange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="tr-note perf-range-note">{PERFORMANCE_RANGE_NOTE}</p>
        </div>
        {period === 'custom' && (
          <div className="g2-custom-range" role="group" aria-label="Custom holding return date range" style={{ marginBottom: '0.75rem' }}>
            <label>
              <span>Start date</span>
              <input
                type="date"
                value={customStart}
                min={MIN_PERFORMANCE_DATE}
                max={customEnd || maxDate}
                onChange={event => onCustomStartChange(event.target.value)}
              />
            </label>
            <label>
              <span>End date</span>
              <input
                type="date"
                value={customEnd}
                min={customStart || MIN_PERFORMANCE_DATE}
                max={maxDate}
                onChange={event => onCustomEndChange(event.target.value)}
              />
            </label>
          </div>
        )}
        {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
        {error && <div className="alert alert-error">{error}</div>}
        {data && (
          <>
            {data.calculation_method && (
              <p style={{ color: 'var(--text-dim)', margin: '-0.5rem 0 1rem', fontSize: '0.82rem', lineHeight: 1.45 }}>
                <strong>Matches Total Return for {data.period_label || 'the selected period'}:</strong>{' '}
                {data.calculation_method}
              </p>
            )}
            <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
              <strong>{data.period_label || 'Selected period'}:</strong>{' '}
              {effectiveRange || requestedRange || 'Dates unavailable'}
              {requestedRange && effectiveRange && requestedRange !== effectiveRange
                ? ` (requested ${requestedRange})`
                : ''}
              {endingTotalReturn != null && (
                <> — <strong>Total Return {endingTotalReturn.toFixed(2)}%</strong></>
              )}
              {endingPriceReturn != null && `; Price Return ${endingPriceReturn.toFixed(2)}%`}
            </div>
            {data.note && (
              <p style={{ color: 'var(--p-ffcc80)', margin: '-0.5rem 0 1rem', fontSize: '0.85rem' }}>{data.note}</p>
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
  const { isDark } = useTheme()
  const { runMarketRefresh } = useMarketRefresh()
  const { profileId, profiles, isAggregate, selection, currentProfileName, basisMode } = useProfile()
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshStatus, setRefreshStatus] = useState(null)
  const [gradeStatus, setGradeStatus] = useState(null)
  const [tickerGrades, setTickerGrades] = useState({})
  const [tickerRisk, setTickerRisk] = useState({})
  const [tickerClosureRisk, setTickerClosureRisk] = useState({})
  const [tickerRiskLoading, setTickerRiskLoading] = useState(false)
  const [portfolioGrade, setPortfolioGrade] = useState({})
  const [initialGradeCustomDates] = useState(() => readSharedPerformanceRange())
  const [gradePeriod, setGradePeriod] = useState(initialGradeCustomDates.period)
  const [gradeCustomStart, setGradeCustomStart] = useState(initialGradeCustomDates.start)
  const [gradeCustomEnd, setGradeCustomEnd] = useState(initialGradeCustomDates.end)
  const [gradeRefreshToken, setGradeRefreshToken] = useState(0)
  const [trackerPerformance, setTrackerPerformance] = useState(null)
  const [trackerPerformanceLoading, setTrackerPerformanceLoading] = useState(false)
  const [trackerPerformanceError, setTrackerPerformanceError] = useState(null)
  const [betaBenchmark, setBetaBenchmark] = useState('sp500')
  const [upcomingDivs, setUpcomingDivs] = useState([])
  const [incomeSummary, setIncomeSummary] = useState(null)
  const [portfolioValue, setPortfolioValue] = useState(null)
  const [irrExcludedTickers, setIrrExcludedTickers] = useState([])
  const [irrExclusionDraft, setIrrExclusionDraft] = useState([])
  const [irrExclusionOpen, setIrrExclusionOpen] = useState(false)
  const [irrExclusionLoading, setIrrExclusionLoading] = useState(false)
  const [brokerImportStatus, setBrokerImportStatus] = useState(null)
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [rvyMode, setRvyMode] = useState('cur')
  const [modalTicker, setModalTicker] = useState(null)
  const [portfolioCoverage, setPortfolioCoverage] = useState(null)
  const [portfolioCoverageSeverity, setPortfolioCoverageSeverity] = useState(null)
  const [tickerCoverage, setTickerCoverage] = useState({})
  const [tickerCoverageMeta, setTickerCoverageMeta] = useState({})
  const [overviewGroups, setOverviewGroups] = useState(null)
  const [overviewCategories, setOverviewCategories] = useState(null)
  const [overviewCategoryId, setOverviewCategoryId] = useState(null)
  const [overviewSubcategoryId, setOverviewSubcategoryId] = useState(null)
  const [overviewReturnMode, setOverviewReturnMode] = useState(readOverviewReturnMode)
  const [sp500, setSp500] = useState(null)
  const [dailyChange, setDailyChange] = useState(null)
  const [navHistory, setNavHistory] = useState([])
  const [navReturnMode, setNavReturnMode] = useState(readNavReturnMode)
  const [navSnapping, setNavSnapping] = useState(false)
  const [navBackfilling, setNavBackfilling] = useState(false)
  const [navRepairing, setNavRepairing] = useState(false)
  const [actionCenter, setActionCenter] = useState(null)
  // Left offsets (px) for each frozen holdings column, measured from the
  // rendered header widths so freezing works with the auto-sized table.
  const [frozenColLefts, setFrozenColLefts] = useState([])
  const holdingsTableRef = useRef(null)
  const holdingsHeadRowRef = useRef(null)
  const navChartRef = useRef(null)
  const dashboardCacheKey = useMemo(() => buildDashboardCacheKey(selection, basisMode), [selection, basisMode])
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
    writeSharedPerformanceRange(gradePeriod, gradeCustomStart, gradeCustomEnd)
  }, [gradePeriod, gradeCustomStart, gradeCustomEnd])

  const gradeRangeError = customRangeError(gradePeriod, gradeCustomStart, gradeCustomEnd)

  useEffect(() => {
    if (!holdings.length) return undefined
    if (gradeRangeError) {
      setTrackerPerformance(null)
      setTrackerPerformanceLoading(false)
      setTrackerPerformanceError(null)
      return undefined
    }
    const controller = new AbortController()
    let active = true
    const params = new URLSearchParams({ period: gradePeriod })
    addCustomRangeParams(params, gradePeriod, gradeCustomStart, gradeCustomEnd)
    setTrackerPerformance(null)
    setTrackerPerformanceLoading(true)
    setTrackerPerformanceError(null)
    pf(`/api/total-return/charts?${params}`, { signal: controller.signal })
      .then(safeJson)
      .then(result => { if (active) setTrackerPerformance(result) })
      .catch(error => {
        if (active && error.name !== 'AbortError') setTrackerPerformanceError(error.message)
      })
      .finally(() => { if (active) setTrackerPerformanceLoading(false) })
    return () => {
      active = false
      controller.abort()
    }
  }, [
    gradePeriod,
    gradeCustomStart,
    gradeCustomEnd,
    gradeRangeError,
    gradeRefreshToken,
    holdings.length,
    selection,
    pf,
  ])

  useEffect(() => {
    const cached = readDashboardCache(SP500_CACHE_KEY)
    if (validSp500(cached)) setSp500(cached)
    const fetchSp500 = () =>
      fetch(`${API_BASE}/api/sp500-performance`)
        .then(safeJson)
        .then(d => {
          if (!validSp500(d)) throw new Error('S&P 500 quote was incomplete')
          setSp500(d)
          writeDashboardCache(SP500_CACHE_KEY, d)
        })
        .catch(() => {})
    fetchSp500()
    const interval = setInterval(fetchSp500, 60000)
    return () => clearInterval(interval)
  }, [])

  // Reload the NAV chart when the automatic end-of-day capture records a point
  // while the dashboard is open, so the new close appears without a manual reload.
  useEffect(() => {
    const reload = () => {
      pf('/api/nav/history')
        .then(safeJson)
        .then(d => { if (Array.isArray(d)) setNavHistory(d) })
        .catch(() => {})
    }
    window.addEventListener('nav-auto-captured', reload)
    return () => window.removeEventListener('nav-auto-captured', reload)
  }, [pf])

  useEffect(() => {
    let stale = false
    const selectionExclusions = readIrrExclusions(selection)
    setIrrExcludedTickers(selectionExclusions)
    setIrrExclusionDraft(selectionExclusions)
    setIrrExclusionOpen(false)
    const cached = readDashboardCache(dashboardCacheKey)
    if (cached) {
      // Holding rows are editable and are also changed by imports/refreshes.
      // Never render them from the long-lived Dashboard cache: a fresh
      // /api/holdings read is the source of truth for every editable field.
      setHoldings([])
      setIncomeSummary(cached.incomeSummary || null)
      const cachedExclusions = normalizeIrrExclusions(cached.portfolioValue?.irr_details?.excluded_tickers)
      const savedExclusions = readIrrExclusions(selection)
      setPortfolioValue(
        JSON.stringify(cachedExclusions) === JSON.stringify(savedExclusions)
          ? (cached.portfolioValue || null)
          : null,
      )
      setUpcomingDivs(cached.upcomingDivs || [])
      setTickerGrades(cached.tickerGrades || {})
      setTickerRisk(cached.tickerRisk || {})
      setTickerClosureRisk(cached.tickerClosureRisk || {})
      setTickerRiskLoading(false)
      setPortfolioGrade(cached.portfolioGrade || {})
      setPortfolioCoverage(cached.portfolioCoverage ?? null)
      setPortfolioCoverageSeverity(cached.portfolioCoverageSeverity ?? null)
      setTickerCoverage(cached.tickerCoverage || {})
      setTickerCoverageMeta(cached.tickerCoverageMeta || {})
      setOverviewGroups(cached.overviewGroups || null)
      setOverviewCategories(cached.overviewCategories || null)
      setDailyChange(cached.dailyChange || null)
      setLoading(true)
    } else {
      setHoldings([])
      setIncomeSummary(null)
      setPortfolioValue(null)
      setUpcomingDivs([])
      setTickerGrades({})
      setTickerRisk({})
      setTickerClosureRisk({})
      setTickerRiskLoading(false)
      setPortfolioGrade({})
      setPortfolioCoverage(null)
      setPortfolioCoverageSeverity(null)
      setTickerCoverage({})
      setTickerCoverageMeta({})
      setOverviewGroups(null)
      setOverviewCategories(null)
      setDailyChange(null)
      setLoading(true)
    }
    setRefreshStatus(null)
    setGradeStatus(null)
    pf('/api/holdings')
      .then(safeJson)
      .then(data => {
        if (stale) return
        const normalized = normalizeDashboardHoldings(data)
        setHoldings(normalized)
        setLoading(false)
        if (normalized.length > 0) {
          // Fetch upcoming dividends and portfolio coverage immediately (no refresh needed)
          pf('/api/upcoming-dividends')
            .then(safeJson)
            .then(d => { if (!stale && Array.isArray(d)) setUpcomingDivs(d) })
            .catch(() => {})
          pf('/api/income-summary')
            .then(safeJson)
            .then(d => { if (!stale) setIncomeSummary(d) })
            .catch(() => {})
          pf(portfolioValuePath(selection))
            .then(safeJson)
            .then(d => { if (!stale) setPortfolioValue(d) })
            .catch(() => {})
          // Fetched fresh (never cached) so it hides as soon as a re-import
          // updates the account's import date.
          pf('/api/broker-import-status')
            .then(safeJson)
            .then(d => { if (!stale) setBrokerImportStatus(d) })
            .catch(() => { if (!stale) setBrokerImportStatus(null) })
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
                // Enriched per-category structure (keeps tickers + subcategories so
                // the overview can be drilled into by category / sub-category).
                const enrichedCats = cats.map(c => ({
                  id: c.id,
                  name: c.name,
                  target_pct: c.target_pct,
                  subcategories: c.subcategories || [],
                  tickers: (c.tickers || [])
                    .filter(t => holdingMap[t.ticker])
                    .map(t => ({
                      ticker: t.ticker,
                      description: t.description || holdingMap[t.ticker]?.description || '',
                      subcategory_id: t.subcategory_id ?? null,
                      ...overviewReturnParts(holdingMap[t.ticker]),
                    })),
                }))
                const groups = enrichedCats
                  .map(c => ({
                    ...sumReturnParts(c.name, c.tickers),
                    target_pct: c.target_pct,
                  }))
                  .filter(g => g.count > 0)
                  .sort((a, b) => b.value - a.value)
                setOverviewGroups(groups)
                setOverviewCategories(enrichedCats.filter(c => c.tickers.length > 0))
              } else {
                // Fallback: group by classification_type
                const byType = {}
                data.forEach(h => {
                  if (h.quantity <= 0) return
                  const ct = h.classification_type || 'Other'
                  if (!byType[ct]) byType[ct] = emptyReturnBucket(ct)
                  addReturnParts(byType[ct], overviewReturnParts(h))
                })
                setOverviewGroups(Object.values(byType).sort((a, b) => b.value - a.value))
                setOverviewCategories(null)
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
          // Grades are NOT fetched here. The grade-period effect below owns every
          // /api/portfolio-summary/data call so exactly one window is ever in
          // flight: this effect used to fire its own un-parameterised (1Y)
          // request alongside the period-scoped one, and because yfinance keys
          // its download cache on ticker alone, the two crossed — pick 6M while
          // the 1Y request was still running and both came back holding 1Y
          // prices, so the cards never recalculated for the period you clicked.
          setRefreshStatus('Updating prices & dividends...')
          runMarketRefresh({ statusMessage: 'Updating prices & dividends...' })
            .then(r => {
              if (stale) return
              setRefreshStatus(r.message)
              setDailyChange(r.daily_change || null)
              return Promise.all([
                pf('/api/holdings').then(safeJson),
                pf('/api/income-summary').then(safeJson).catch(() => null),
                pf(portfolioValuePath(selection)).then(safeJson).catch(() => null),
              ])
            })
            .then(result => {
              if (stale || !result) return
              const [updated, summary, valueSummary] = result
              if (!updated) return
              setHoldings(normalizeDashboardHoldings(updated))
              if (summary) setIncomeSummary(summary)
              if (valueSummary) setPortfolioValue(valueSummary)
              // Prices just moved, so re-grade — but hand the work to the
              // grade-period effect rather than issuing a second request here,
              // whatever period is selected.
              setGradeStatus('Loading risk grades...')
              setGradeRefreshToken(token => token + 1)
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
  }, [pf, selection, dashboardCacheKey, runMarketRefresh])

  // Depend on the boolean, not the array: this tracks "is there anything to
  // grade", which flips once per account, where `holdings` is replaced again on
  // every market refresh and would re-fetch grades each time.
  const hasHoldings = holdings.length > 0

  useEffect(() => {
    // Sole owner of /api/portfolio-summary/data — the initial load as well as
    // every period, account, custom-range, and market-refresh change. Keeping
    // it in one effect means only one grade window is ever in flight, and the
    // AbortController below cancels the previous one the moment you switch
    // periods, so a slow response can never land on top of a newer selection.
    // It re-fetches without reloading any unrelated Dashboard data source.
    if (!hasHoldings) return undefined
    if (gradeRangeError) {
      setGradeStatus(gradeRangeError)
      return undefined
    }

    const controller = new AbortController()
    let active = true
    const params = new URLSearchParams({ period: gradePeriod })
    addCustomRangeParams(params, gradePeriod, gradeCustomStart, gradeCustomEnd)
    setGradeStatus('Loading risk grades...')
    setTickerRiskLoading(true)
    // Drop the displayed grade only when it belongs to a different window —
    // showing one period's ratios under another period's label is the bug this
    // screen had. A plain refresh of the same window keeps its cards up (and
    // the cached grade visible on first paint) instead of flashing to dashes.
    setPortfolioGrade(previous => {
      if (!previous || previous.period_key !== gradePeriod) return {}
      if (gradePeriod === 'custom' && (
        previous.requested_start_date !== gradeCustomStart
        || previous.requested_end_date !== gradeCustomEnd
      )) return {}
      return previous
    })
    pf(`/api/portfolio-summary/data?${params}`, { signal: controller.signal })
      .then(safeJson)
      .then(g => {
        if (!active || !g) return
        if (g.ticker_grades) setTickerGrades(g.ticker_grades)
        if (g.ticker_risk) setTickerRisk(g.ticker_risk)
        if (g.ticker_closure_risk) setTickerClosureRisk(g.ticker_closure_risk)
        if (g.portfolio_grade && Object.keys(g.portfolio_grade).length) {
          setPortfolioGrade(g.portfolio_grade)
        }
        setGradeStatus('Grades loaded.')
        setTimeout(() => { if (active) setGradeStatus(null) }, 3000)
      })
      .catch(error => {
        if (active && error.name !== 'AbortError') setGradeStatus('Grade loading failed.')
      })
      .finally(() => {
        if (active) setTickerRiskLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [
    gradePeriod,
    gradeCustomStart,
    gradeCustomEnd,
    gradeRangeError,
    gradeRefreshToken,
    hasHoldings,
    selection,
    pf,
  ])

  useEffect(() => {
    if (loading || !holdings.length) return
    writeDashboardCache(dashboardCacheKey, {
      incomeSummary,
      portfolioValue,
      upcomingDivs,
      tickerGrades: gradePeriod === '1y' ? tickerGrades : {},
      tickerRisk: gradePeriod === '1y' ? tickerRisk : {},
      tickerClosureRisk: gradePeriod === '1y' ? tickerClosureRisk : {},
      portfolioGrade: gradePeriod === '1y' ? portfolioGrade : {},
      portfolioCoverage,
      portfolioCoverageSeverity,
      tickerCoverage,
      tickerCoverageMeta,
      overviewGroups,
      overviewCategories,
      dailyChange,
    })
  }, [
    dashboardCacheKey,
    loading,
    holdings,
    incomeSummary,
    portfolioValue,
    upcomingDivs,
    tickerGrades,
    tickerRisk,
    tickerClosureRisk,
    portfolioGrade,
    gradePeriod,
    portfolioCoverage,
    portfolioCoverageSeverity,
    tickerCoverage,
    tickerCoverageMeta,
    overviewGroups,
    overviewCategories,
    dailyChange,
  ])

  useEffect(() => {
    setOverviewCategoryId(null)
    setOverviewSubcategoryId(null)
  }, [selection, basisMode])

  useEffect(() => {
    if (overviewCategoryId == null || !overviewCategories) return
    const category = overviewCategories.find(item => String(item.id) === String(overviewCategoryId))
    if (!category) {
      setOverviewCategoryId(null)
      setOverviewSubcategoryId(null)
      return
    }
    if (overviewSubcategoryId != null && !(category.subcategories || []).some(item => String(item.id) === String(overviewSubcategoryId))) {
      setOverviewSubcategoryId(null)
    }
  }, [overviewCategories, overviewCategoryId, overviewSubcategoryId])

  const filteredTickerSet = useMemo(() => {
    if (overviewCategoryId == null || !overviewCategories) return null
    const category = overviewCategories.find(item => String(item.id) === String(overviewCategoryId))
    if (!category) return null
    return new Set((category.tickers || [])
      .filter(item => overviewSubcategoryId == null || String(item.subcategory_id ?? '') === String(overviewSubcategoryId))
      .map(item => String(item.ticker || '').toUpperCase()))
  }, [overviewCategories, overviewCategoryId, overviewSubcategoryId])

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
    const dividendPaid = sum('dividend_paid')
    const withdraw8Annual = sum('withdraw_8pct_cost_annually')
    const withdraw8Monthly = sum('withdraw_8pct_per_month')
    const cashNotReinvested = sum('cash_not_reinvested')
    const totalCashReinvested = sum('total_cash_reinvested')
    const sharesBoughtFromDividend = sum('shares_bought_from_dividend')
    const sharesBoughtInYear = sum('shares_bought_in_year')
    const sharesInMonth = sum('shares_in_month')
    const dripSharesMonthly = holdings.reduce((s, h) => s + sharesFromDrip(h.approx_monthly_income, h), 0)
    const dripSharesYearly = holdings.reduce((s, h) => s + sharesFromDrip(h.estim_payment_per_year, h), 0)
    const rawMonthIncome = sum('current_month_income')
    const currentMonthIncome = incomeSummary?.current_month_income ?? rawMonthIncome ?? 0
    const currentMonthIncomeDelta = currentMonthIncome - monthlyIncome
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

    const cashValue = Number(portfolioValue?.cash_value || 0)
    const accountValue = portfolioValue?.account_value == null
      ? currentValue
      : Number(portfolioValue.account_value)

    return { lifetimeIncome: totalDivs, ytdDivs, monthlyIncome, monthlyReinvested, monthlyNotReinvested, reinvestPct, annualIncome, dividendPaid, withdraw8Annual, withdraw8Monthly, cashNotReinvested, totalCashReinvested, sharesBoughtFromDividend, sharesBoughtInYear, sharesInMonth, dripSharesMonthly, dripSharesYearly, currentValue, cashValue, accountValue, avgYoc, currentYield, priceReturn, totalReturn, purchaseValue, gainLoss, currentMonthIncome, currentMonthIncomeDelta, currentMonthReinvested, currentMonthNotReinvested, currentMonthReinvestPct }
  }, [holdings, incomeSummary, portfolioValue])

  const marketExposure = useMemo(() => {
    const betas = portfolioGrade?.benchmark_betas || {}
    const selectedBeta = betaBenchmark === 'nasdaq'
      ? (betas.nasdaq ?? portfolioGrade?.beta_nasdaq)
      : (betas.sp500 ?? portfolioGrade?.beta_sp500 ?? portfolioGrade?.beta)
    const betaNumber = selectedBeta == null ? null : Number(selectedBeta)
    const currentValue = Number(totals.currentValue || 0)
    const betaAdjustedExposure = Number.isFinite(betaNumber) ? currentValue * betaNumber : null
    return { beta: betaNumber, betaAdjustedExposure }
  }, [portfolioGrade, betaBenchmark, totals.currentValue])

  const trackerPortfolioMetrics = trackerPerformance?.portfolio_metrics || {}
  const trackerPerformanceRange = formatPerformanceRange(
    trackerPerformance?.actual_start_date || trackerPerformance?.requested_start_date,
    trackerPerformance?.actual_end_date || trackerPerformance?.requested_end_date,
  )
  const trackerAccountingCoverage = formatAccountingCoverage(trackerPortfolioMetrics)
  const trackerPerformanceByTicker = useMemo(() => new Map(
    (trackerPerformance?.performance_rows || []).map(row => [
      String(row.ticker || '').trim().toUpperCase(),
      row,
    ]),
  ), [trackerPerformance])

  // Enrich holdings with computed fields
  const enrichedHoldings = useMemo(() => {
    return holdings
      .filter(h => h.quantity > 0)
      .map(h => {
        const trackerRow = trackerPerformanceByTicker.get(String(h.ticker || '').trim().toUpperCase())
        const pv = h.purchase_value || 0
        const gl = h.gain_or_loss || 0
        const td = h.total_divs_received || 0
        const cv = h.current_value || 0
        const totalCv = totals.currentValue || 1
        const priceReturn = pv ? (gl / pv) : 0
        // Total return divides by the same invested-cost floor used for
        // paid-for-itself (see backend _apply_basis_mode_to_holdings), not just
        // the residual purchase_value — otherwise a trimmed position's lifetime
        // dividends (earned on far more shares than remain) blow the % up.
        const totalReturnBasis = h.total_return_basis || pv
        const totalReturnDivs = h.total_return_divs_component != null ? h.total_return_divs_component : td
        // Gains/losses already realized on shares that were trimmed off (not
        // just the unrealized gl on what's left) — without this, a trimmed
        // position with zero dividends can show a total return that doesn't
        // match its price return even though nothing else changed.
        const totalReturnRealized = h.total_return_realized_component || 0
        const totalReturn = totalReturnBasis ? ((gl + totalReturnDivs + totalReturnRealized) / totalReturnBasis) : 0
        const periodPriceReturn = trackerRow?.price_return_pct
        const periodTotalReturn = trackerRow?.total_return_pct
        const rvyYield = rvyMode === 'yoc' ? h.annual_yield_on_cost : h.current_annual_yield
        const rvyAnnualYieldPct = (rvyYield || 0) * 100
        // The tracker return covers the selected range, so the yield compared
        // against it is scaled to that same window — an annual yield would mark
        // every payer "Poor" on a 1D or 7D range by construction.
        const rvyWindowYieldPct = prorateAnnualYield(
          rvyAnnualYieldPct,
          trackerRow?.actual_start_date,
          trackerRow?.actual_end_date,
        )
        const rvy = periodTotalReturn != null && rvyWindowYieldPct != null
          ? returnVsYield(periodTotalReturn, rvyWindowYieldPct)
          : null
        return {
          ...h,
          lifetime_price_return_pct: priceReturn,
          lifetime_total_return_pct: totalReturn,
          price_return_pct: periodPriceReturn != null ? periodPriceReturn / 100 : null,
          total_return_pct: periodTotalReturn != null ? periodTotalReturn / 100 : null,
          tracker_start_value: trackerRow?.start_value,
          tracker_actual_start_date: trackerRow?.actual_start_date,
          tracker_actual_end_date: trackerRow?.actual_end_date,
          pct_of_account: totalCv ? (cv / totalCv) : 0,
          drip_shares_monthly: sharesFromDrip(h.approx_monthly_income, h),
          drip_shares_yearly: sharesFromDrip(h.estim_payment_per_year, h),
          current_month_income_delta: (h.current_month_income || 0) - (h.approx_monthly_income || 0),
          rvy_annual_yield_pct: rvyAnnualYieldPct,
          ret_vs_yld: rvy,
          ret_vs_yld_sort: rvy ? rvy.spread : -999,
          _coverage: tickerCoverage[h.ticker] ?? null,
          _coverage_meta: tickerCoverageMeta[h.ticker] || null,
          _risk: tickerRisk[h.ticker] || null,
          _closure: tickerClosureRisk[h.ticker] || null,
          _closure_sort: closureRank(tickerClosureRisk[h.ticker]),
          _beta_sort: tickerRisk[h.ticker]?.beta ?? -999,
          _delta_up_sort: tickerRisk[h.ticker]?.delta_up ?? -999,
          _delta_down_sort: tickerRisk[h.ticker]?.delta_down ?? -999,
          _ex_div_sort: exPaySortKey(h.ex_div_date),
          _pay_date_sort: exPaySortKey(h.div_pay_date),
          _grade_sort: ({ 'A+': 13, 'A': 12, 'A-': 11, 'B+': 10, 'B': 9, 'B-': 8, 'C+': 7, 'C': 6, 'C-': 5, 'D+': 4, 'D': 3, 'D-': 2, 'F': 1 })[tickerGrades[h.ticker]?.grade] || 0,
        }
      })
  }, [holdings, totals, trackerPerformanceByTicker, tickerCoverage, tickerCoverageMeta, tickerGrades, tickerRisk, tickerClosureRisk, rvyMode])
  const portfolioNavSeverity = portfolioCoverageSeverity || navSeverityFromRatio(portfolioCoverage)
  const portfolioNavColor = navSeverityColor(portfolioNavSeverity)
  const dailyChangeAmount = Number(dailyChange?.amount)
  const dailyChangePercent = Number(dailyChange?.percent)
  const hasDailyChange = Number.isFinite(dailyChangeAmount) && Number.isFinite(dailyChangePercent)
  const dailyChangeColor = !hasDailyChange
    ? 'var(--text-dim)'
    : dailyChangeAmount > 0
      ? 'var(--pos)'
      : dailyChangeAmount < 0
        ? 'var(--neg)'
        : 'var(--text)'
  const dailyChangeValue = hasDailyChange
    ? `${formatMoney(dailyChangeAmount, { signed: true })} (${dailyChangePercent >= 0 ? '+' : ''}${dailyChangePercent.toFixed(2)}%)`
    : refreshStatus?.startsWith('Updating')
      ? 'Updating...'
      : 'Unavailable'
  const dailyChangeSub = dailyChange?.previous_date && dailyChange?.as_of_date
    ? `${shortDate(dailyChange.previous_date)} to ${shortDate(dailyChange.as_of_date)}`
    : null
  const dailyChangeTitle = dailyChange?.holdings_total > dailyChange?.holdings_covered
    ? `Price move from the previous market close. Based on ${dailyChange.holdings_covered} of ${dailyChange.holdings_total} holdings with available prices.`
    : 'Price move from the previous market close, based on current share counts.'
  const irrDetails = portfolioValue?.irr_details || null
  const portfolioIrr = portfolioValue?.irr == null ? null : Number(portfolioValue.irr)
  const hasPortfolioIrr = Number.isFinite(portfolioIrr)
  const unreconciledIrrValuePct = Number(irrDetails?.unreconciled_current_value_pct)
  const excludedIrrValuePct = Number(irrDetails?.excluded_current_value_pct)
  const appliedIrrExclusions = useMemo(
    () => normalizeIrrExclusions(irrDetails?.excluded_tickers || irrExcludedTickers),
    [irrDetails?.excluded_tickers, irrExcludedTickers],
  )
  const irrSub = hasPortfolioIrr && irrDetails?.start_date
    ? `Money-weighted${Number.isFinite(excludedIrrValuePct) && excludedIrrValuePct > 0 ? ` · ${excludedIrrValuePct.toFixed(1)}% excluded` : ''} · since ${shortDate(irrDetails.start_date)}`
    : irrDetails?.coverage_complete === false && Number.isFinite(unreconciledIrrValuePct) && unreconciledIrrValuePct > 0
      ? `${unreconciledIrrValuePct.toFixed(1)}% of value lacks reconciled history`
      : irrDetails?.coverage_complete === false
        ? 'Cash-flow history is incomplete'
      : null
  const irrTitle = hasPortfolioIrr
    ? `Annualized money-weighted return from dated buys, sells, fees, recorded dividends, and current holdings value. Idle account cash is excluded.${appliedIrrExclusions.length ? ` Filtered result excludes: ${appliedIrrExclusions.join(', ')}.` : ''}`
    : irrDetails?.reason || 'Complete dated investment cash flows are required to calculate IRR.'
  const irrExclusionOptions = useMemo(() => {
    const reasonsByTicker = new Map()
    const addReason = (ticker, reason) => {
      const key = String(ticker || '').trim().toUpperCase()
      if (!key) return
      const reasons = reasonsByTicker.get(key) || []
      if (reason && !reasons.includes(reason)) reasons.push(reason)
      reasonsByTicker.set(key, reasons)
    }
    ;(irrDetails?.missing_transaction_tickers || []).forEach(ticker => addReason(ticker, 'No complete trade history'))
    ;(irrDetails?.invalid_transaction_tickers || []).forEach(ticker => addReason(ticker, 'Missing or future trade date'))
    ;(irrDetails?.zero_value_transaction_tickers || []).forEach(ticker => addReason(ticker, 'Trade has no cash value'))
    ;(irrDetails?.unpaired_transfer_tickers || []).forEach(ticker => addReason(ticker, 'Transfer history is incomplete'))
    ;(irrDetails?.share_mismatches || []).forEach(item => addReason(item.ticker, 'Trade shares do not match current shares'))
    ;(irrDetails?.missing_dividend_tickers || []).forEach(item => addReason(item.ticker, `Missing ${fmt(item.missing_amount)} of dated dividends`))
    appliedIrrExclusions.forEach(ticker => addReason(ticker, 'Currently excluded'))

    const holdingByTicker = new Map(holdings.map(holding => [
      String(holding.ticker || '').toUpperCase(),
      holding,
    ]))
    return [...reasonsByTicker.entries()]
      .map(([ticker, reasons]) => ({
        ticker,
        reasons,
        description: holdingByTicker.get(ticker)?.description || '',
        currentValue: Number(holdingByTicker.get(ticker)?.current_value || 0),
      }))
      .sort((a, b) => b.currentValue - a.currentValue || a.ticker.localeCompare(b.ticker))
  }, [appliedIrrExclusions, holdings, irrDetails])

  const applyIrrExclusions = useCallback(() => {
    const next = normalizeIrrExclusions(irrExclusionDraft)
    persistIrrExclusions(selection, next)
    setIrrExcludedTickers(next)
    setIrrExclusionOpen(false)
    setIrrExclusionLoading(true)
    pf(portfolioValuePath(selection, next))
      .then(safeJson)
      .then(setPortfolioValue)
      .catch(() => {})
      .finally(() => setIrrExclusionLoading(false))
  }, [irrExclusionDraft, pf, selection])

  const filteredEnrichedHoldings = useMemo(() => {
    if (!filteredTickerSet) return enrichedHoldings
    return enrichedHoldings.filter(holding => filteredTickerSet.has(String(holding.ticker || '').toUpperCase()))
  }, [enrichedHoldings, filteredTickerSet])

  // Sorting
  const sorted = useMemo(() => {
    if (!sortCol) return filteredEnrichedHoldings
    return [...filteredEnrichedHoldings].sort((a, b) => {
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
  }, [filteredEnrichedHoldings, sortCol, sortAsc])

  const calculatedTableTotals = useMemo(() => {
    const rows = filteredEnrichedHoldings
    const sum = key => rows.reduce((total, holding) => total + (Number(holding[key]) || 0), 0)
    const purchaseValue = sum('purchase_value')
    const currentValue = sum('current_value')
    const gainLoss = sum('gain_or_loss')
    const lifetimeIncome = sum('total_divs_received')
    const annualIncome = sum('estim_payment_per_year')
    const trackerRows = rows.filter(holding => (
      Number.isFinite(Number(holding.tracker_start_value))
      && Number(holding.tracker_start_value) > 0
    ))
    const trackerBasis = trackerRows.reduce(
      (total, holding) => total + Number(holding.tracker_start_value || 0),
      0,
    )
    const trackerPriceReturn = trackerBasis
      ? trackerRows.reduce((total, holding) => total
        + Number(holding.price_return_pct || 0) * Number(holding.tracker_start_value || 0), 0) / trackerBasis
      : null
    const trackerTotalReturn = trackerBasis
      ? trackerRows.reduce((total, holding) => total
        + Number(holding.total_return_pct || 0) * Number(holding.tracker_start_value || 0), 0) / trackerBasis
      : null
    const yieldRows = rows.filter(holding => Number(holding.purchase_value) > 0 && holding.annual_yield_on_cost != null)
    const yieldBasis = yieldRows.reduce((total, holding) => total + Number(holding.purchase_value || 0), 0)
    const avgYoc = yieldBasis
      ? yieldRows.reduce((total, holding) => total + Number(holding.annual_yield_on_cost || 0) * Number(holding.purchase_value || 0), 0) / yieldBasis
      : 0

    return {
      priceReturn: trackerPriceReturn,
      totalReturn: trackerTotalReturn,
      currentYield: currentValue ? annualIncome / currentValue : 0,
      avgYoc,
      ytdDivs: sum('ytd_divs'),
      currentMonthIncome: sum('current_month_income'),
      monthlyIncome: sum('approx_monthly_income'),
      dripSharesMonthly: sum('drip_shares_monthly'),
      monthlyReinvested: sum('monthly_income_reinvested'),
      monthlyNotReinvested: sum('monthly_income_not_reinvested'),
      annualIncome,
      dripSharesYearly: sum('drip_shares_yearly'),
      purchaseValue,
      currentValue,
      gainLoss,
      dividendPaid: sum('dividend_paid'),
      withdraw8Annual: sum('withdraw_8pct_cost_annually'),
      withdraw8Monthly: sum('withdraw_8pct_per_month'),
      cashNotReinvested: sum('cash_not_reinvested'),
      totalCashReinvested: sum('total_cash_reinvested'),
      sharesBoughtFromDividend: sum('shares_bought_from_dividend'),
      sharesBoughtInYear: sum('shares_bought_in_year'),
      sharesInMonth: sum('shares_in_month'),
      lifetimeIncome,
      currentMonthIncomeDelta: sum('current_month_income_delta'),
    }
  }, [filteredEnrichedHoldings])
  const isHoldingsFiltered = overviewCategoryId != null
  const fullTrackerPriceReturn = trackerPortfolioMetrics.price_return_pct == null
    ? null
    : Number(trackerPortfolioMetrics.price_return_pct) / 100
  const fullTrackerTotalReturn = trackerPortfolioMetrics.total_return_pct == null
    ? null
    : Number(trackerPortfolioMetrics.total_return_pct) / 100
  const tableTotals = isHoldingsFiltered
    ? calculatedTableTotals
    : {
        ...totals,
        priceReturn: fullTrackerPriceReturn,
        totalReturn: fullTrackerTotalReturn,
      }
  const tablePctOfAccount = useMemo(
    () => filteredEnrichedHoldings.reduce((total, holding) => total + (Number(holding.pct_of_account) || 0), 0),
    [filteredEnrichedHoldings],
  )

  const handleSort = useCallback((col) => {
    setSortAsc(prev => sortCol === col ? !prev : (typeof filteredEnrichedHoldings[0]?.[col] === 'string'))
    setSortCol(col)
  }, [sortCol, filteredEnrichedHoldings])

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

  const SortHeader = ({ col, children, align, tip, style, className, ...rest }) => (
    <th
      {...rest}
      onClick={() => handleSort(col)}
      className={className}
      style={{ cursor: 'pointer', textAlign: align || 'left', userSelect: 'none', ...style }}
      title={tip || ''}
    >
      {children}{tip ? ' \u24D8' : ''} {sortCol === col ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  const gradeColor = (v) => v >= 0 ? 'var(--pos)' : 'var(--neg)'
  const riskNum = (v, loading = false) => {
    if (v == null || !Number.isFinite(Number(v))) return loading ? '...' : '—'
    return Number(v).toFixed(2)
  }
  const pfiVal = (v) => v == null ? 0 : v * 100
  const pfiColor = (v) => { const p = pfiVal(v); return p >= 100 ? 'var(--pos)' : p >= 50 ? '#ffd700' : undefined }

  const currentMonth = new Date().toLocaleString('default', { month: 'long' })
  const moneyOrDash = (value, digits = 2) => (
    value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : fmt(value, digits)
  )
  const numberOrDash = (value, digits = 2) => (
    value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
  )
  const textOrDash = (value) => (value == null || value === '' ? '—' : value)
  const dateOrDash = (value) => {
    if (!value) return '—'
    return localDateString(value) || textOrDash(value)
  }
  const quantityOrDash = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return '—'
    return Number.isInteger(value) ? value : parseFloat(Number(value).toFixed(3))
  }
  const holdingCellStyle = (column, extra) => ({
    textAlign: column.align || 'left',
    ...(extra || {}),
  })
  const renderNavCell = (h) => {
    const cov = h._coverage
    const navMeta = h._coverage_meta || {}
    const navSeverity = navMeta.nav_erosion_severity || navSeverityFromRatio(cov)
    const navColor = navSeverityColor(navSeverity)
    const navScope = h.nav_erosion_scope || navMeta.nav_erosion_scope || 'auto'
    const navBenchmark = h.nav_benchmark_override || navMeta.nav_benchmark_override || ''
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
      <td
        style={{
          textAlign: 'right',
          color: cov == null ? 'var(--p-6f7890)' : navColor,
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
              border: '1px solid var(--p-294b73)',
              borderRadius: 4,
              background: 'var(--p-0f1c36)',
              color: navScope === 'test' ? 'var(--accent-bright)' : navScope === 'skip' ? 'var(--warning-money)' : 'var(--p-9aa8bd)',
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
            border: navBenchmarkInvalid ? '1px solid var(--neg)' : '1px solid var(--p-203a5f)',
            borderRadius: 4,
            background: 'var(--p-0d1830)',
            color: navBenchmarkInvalid ? 'var(--p-ffb3b3)' : navBenchmark ? 'var(--p-d7e8ff)' : 'var(--p-7d8799)',
            fontSize: '0.58rem',
            padding: '1px 3px',
            textAlign: 'right',
          }}
        />
        <div style={{ fontSize: '0.58rem', color: 'var(--p-7d8799)', lineHeight: 1.1 }}>{navLabel}</div>
      </td>
    )
  }
  const holdingsColumns = (() => {
    const totals = tableTotals
    return [
    { id: 'ticker', label: 'Ticker', name: 'Ticker', sortKey: 'ticker', group: 'Current', defaultVisible: true, render: h => (
      <td>
        <a href="#" onClick={(e) => { e.preventDefault(); setModalTicker(h.ticker) }} style={{ color: 'var(--accent-bright)', fontWeight: 600 }}>
          {h.ticker}
        </a>
      </td>
    ) },
    { id: 'description', label: 'Desc', name: 'Description', sortKey: 'description', group: 'Current', defaultVisible: true, tip: 'Security description / name', render: h => <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{textOrDash(h.description)}</td> },
    { id: 'category', label: 'Cat', name: 'Category', sortKey: 'category', group: 'Current', defaultVisible: true, tip: 'Investment category', render: h => <td>{textOrDash(h.category)}</td> },
    { id: 'div_frequency', label: 'Freq', name: 'Dividend Frequency', sortKey: 'div_frequency', group: 'Current', defaultVisible: true, align: 'center', tip: 'Dividend payment frequency (M=Monthly, Q=Quarterly, W=Weekly)', render: h => <td style={{ textAlign: 'center' }}>{textOrDash(h.div_frequency)}</td> },
    { id: 'purchase_date', label: 'Purchased', name: 'Date Purchased', sortKey: 'purchase_date', group: 'Current', defaultVisible: true, render: h => <td>{dateOrDash(h.purchase_date)}</td> },
    { id: 'ex_div_date', label: 'Ex-Div', name: 'Ex-Dividend Date', sortKey: '_ex_div_sort', group: 'Current', defaultVisible: true, tip: 'Ex-dividend date — own the shares before this date to receive the dividend', render: h => <td style={{ whiteSpace: 'nowrap' }}>{exPayDisplay(h.ex_div_date)}</td> },
    { id: 'div_pay_date', label: 'Pay Date', name: 'Dividend Pay Date', sortKey: '_pay_date_sort', group: 'Current', defaultVisible: true, tip: 'Dividend payment (pay) date resolved from confirmed schedules, imported transaction patterns, or the saved schedule fallback', render: h => (
      <td
        style={{ whiteSpace: 'nowrap' }}
        title={h.div_pay_date_estimated ? 'Estimated from dividend schedule and payment history' : 'Confirmed pay date'}
      >
        {h.div_pay_date_estimated ? '~' : ''}{exPayDisplay(h.div_pay_date)}
      </td>
    ) },
    { id: 'quantity', label: 'Qty', name: 'Quantity', sortKey: 'quantity', group: 'Current', defaultVisible: true, align: 'right', tip: 'Number of shares held', render: h => <td style={{ textAlign: 'right' }}>{quantityOrDash(h.quantity)}</td> },
    { id: 'price_paid', label: 'Paid', name: 'Price Paid', sortKey: 'price_paid', group: 'Current', defaultVisible: true, align: 'right', tip: 'Price paid per share', render: h => <td style={{ textAlign: 'right' }}>{moneyOrDash(h.price_paid, 4)}</td> },
    { id: 'current_price', label: 'Price', name: 'Current Price', sortKey: 'current_price', group: 'Current', defaultVisible: true, align: 'right', tip: 'Current market price per share', render: h => <td style={{ textAlign: 'right' }}>{moneyOrDash(h.current_price)}</td> },
    { id: 'pct_of_account', label: '%Acct', name: 'Percent of Account', sortKey: 'pct_of_account', group: 'Current', defaultVisible: true, align: 'right', tip: 'Percent of total account value', render: h => <td style={{ textAlign: 'right' }}>{pct(h.pct_of_account)}</td>, footer: () => pct(tablePctOfAccount) },
    { id: 'price_return_pct', label: 'PrRtn', name: 'Tracker Price Return', sortKey: 'price_return_pct', group: 'Current', defaultVisible: true, align: 'right', tip: 'Transaction-aware price-only return for the Shared Performance Date Range', render: h => <td style={{ textAlign: 'right', color: gradeColor(h.price_return_pct) }} title={formatPerformanceRange(h.tracker_actual_start_date, h.tracker_actual_end_date)}>{pct(h.price_return_pct)}</td>, footer: () => <span style={{ color: gradeColor(totals.priceReturn) }}>{pct(totals.priceReturn)}</span> },
    { id: 'total_return_pct', label: 'TrkTR', name: 'Tracker Total Return', sortKey: 'total_return_pct', group: 'Current', defaultVisible: true, align: 'right', tip: 'Transaction-aware Total Return for the Shared Performance Date Range; matches the Total Return page', render: h => <td style={{ textAlign: 'right', color: gradeColor(h.total_return_pct) }} title={formatPerformanceRange(h.tracker_actual_start_date, h.tracker_actual_end_date)}>{pct(h.total_return_pct)}</td>, footer: () => <span style={{ color: gradeColor(totals.totalReturn) }}>{pct(totals.totalReturn)}</span> },
    { id: 'beta', label: 'Beta', name: 'Benchmark Beta', sortKey: '_beta_sort', group: 'Current', defaultVisible: true, align: 'right', tip: "Price-return beta versus the ticker's best-fitting benchmark, usually SPY or QQQ", render: h => {
      const risk = h._risk || {}
      return (
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} title={risk.beta_benchmark ? `Beta regressed against ${risk.beta_benchmark}, the best-fitting benchmark for this ticker.` : 'Beta unavailable'}>
          {riskNum(risk.beta, tickerRiskLoading)}
          {risk.beta_benchmark && risk.beta != null && <span style={{ color: 'var(--p-6f7890)', fontSize: '0.8em', marginLeft: 3 }}>vs {risk.beta_benchmark}</span>}
        </td>
      )
    } },
    { id: 'delta_up', label: 'Delta Up', name: 'Benchmark Up Delta', sortKey: '_delta_up_sort', group: 'Current', defaultVisible: true, align: 'right', tip: 'Approximate effective delta on benchmark up-days from return regression; lower than down delta can indicate capped upside', render: h => <td style={{ textAlign: 'right', color: 'var(--p-2f9d55)' }} title={h._risk?.beta_benchmark ? `Approximate effective delta on ${h._risk.beta_benchmark} up-days. This is a price-regression proxy, not true option delta.` : 'Approximate up-delta unavailable'}>{riskNum(h._risk?.delta_up, tickerRiskLoading)}</td> },
    { id: 'delta_down', label: 'Delta Down', name: 'Benchmark Down Delta', sortKey: '_delta_down_sort', group: 'Current', defaultVisible: true, align: 'right', tip: 'Approximate effective delta on benchmark down-days from return regression; higher than up delta can indicate fuller downside participation', render: h => <td style={{ textAlign: 'right', color: 'var(--p-d94b4b)' }} title={h._risk?.beta_benchmark ? `Approximate effective delta on ${h._risk.beta_benchmark} down-days. This is a price-regression proxy, not true option delta.` : 'Approximate down-delta unavailable'}>{riskNum(h._risk?.delta_down, tickerRiskLoading)}</td> },
    { id: 'ret_vs_yld', label: 'RvY', name: 'Return vs Yield', sortKey: 'ret_vs_yld_sort', group: 'Current', defaultVisible: true, align: 'center', tip: 'Total return vs yield, both over the selected range — the annual yield is scaled to that window so short periods stay comparable. Good means total return exceeds yield, Poor means yield exceeds total return (price erosion)', renderHeader: () => (
      <th key="ret_vs_yld" style={{ textAlign: 'center', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none' }} title="Total return vs yield, both over the selected range — the annual yield is scaled to that window so short periods stay comparable. Good means total return exceeds yield, Poor means yield exceeds total return (price erosion)">
        <span style={{ cursor: 'pointer' }} onClick={() => handleSort('ret_vs_yld_sort')}>RvY</span>{' '}
        <span
          onClick={() => setRvyMode(m => m === 'yoc' ? 'cur' : 'yoc')}
          title={rvyMode === 'yoc' ? 'Using Yield on Cost — click to switch to Current Yield' : 'Using Current Yield — click to switch to Yield on Cost'}
          style={{ fontSize: '0.65rem', background: rvyMode === 'yoc' ? 'var(--p-1a3a5c)' : 'var(--p-1a3a2a)', color: rvyMode === 'yoc' ? 'var(--accent-bright)' : 'var(--pos)', border: `1px solid ${rvyMode === 'yoc' ? 'var(--p-294b73)' : 'var(--p-2a5c3a)'}`, borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontWeight: 600 }}
        >
          {rvyMode === 'yoc' ? 'YOC' : 'CYld'}
        </span>
      </th>
    ), render: h => <td style={{ textAlign: 'center', color: h.ret_vs_yld?.color || 'var(--p-6f7890)', fontWeight: 600 }} title={h.ret_vs_yld ? `Total Return ${h.ret_vs_yld.totalReturnPct?.toFixed(2)}% vs Yield ${h.ret_vs_yld.yieldOnCost?.toFixed(2)}% over this range${h.rvy_annual_yield_pct != null ? ` (${Number(h.rvy_annual_yield_pct).toFixed(2)}% annual)` : ''} · spread ${h.ret_vs_yld.spread?.toFixed(2)}%` : 'N/A'}>{h.ret_vs_yld?.label || '—'}</td> },
    { id: 'div', label: 'Div$', name: 'Dividend per Share', sortKey: 'div', group: 'Current', defaultVisible: true, align: 'right', tip: 'Last dividend paid per share', render: h => <td style={{ textAlign: 'right' }}>{h.div != null && h.div > 0 ? formatMoney(h.div, { digits: 4 }) : '—'}</td> },
    { id: 'current_annual_yield', label: 'CurYld', name: 'Current Annual Yield', sortKey: 'current_annual_yield', group: 'Current', defaultVisible: true, align: 'right', tip: 'Current annual dividend yield based on market price', render: h => <td style={{ textAlign: 'right' }}>{pct(h.current_annual_yield)}</td>, footer: () => pct(totals.currentYield) },
    { id: 'annual_yield_on_cost', label: 'YOC', name: 'Yield on Cost', sortKey: 'annual_yield_on_cost', group: 'Current', defaultVisible: true, align: 'right', tip: 'Annual dividend yield based on your cost basis', render: h => <td style={{ textAlign: 'right' }}>{pct(h.annual_yield_on_cost)}</td>, footer: () => pct(totals.avgYoc) },
    { id: 'ytd_divs', label: 'YTD', name: 'YTD Dividends', sortKey: 'ytd_divs', group: 'Current', defaultVisible: true, align: 'right', tip: 'Year-to-date dividends received', render: h => <td style={{ textAlign: 'right', color: 'var(--pos)' }}>{fmt(h.ytd_divs)}</td>, footer: () => <span style={{ color: 'var(--pos)' }}>{fmt(totals.ytdDivs)}</span> },
    { id: 'current_month_income', label: currentMonth, name: `${currentMonth} Income`, sortKey: 'current_month_income', group: 'Current', defaultVisible: true, align: 'right', tip: `Dividend income received in ${currentMonth}`, render: h => <td style={{ textAlign: 'right', color: 'var(--pos)' }}>{fmt(h.current_month_income)}</td>, footer: () => <span style={{ color: 'var(--pos)' }}>{fmt(totals.currentMonthIncome)}</span> },
    { id: 'approx_monthly_income', label: 'Mo$', name: 'Estimated Monthly Income', sortKey: 'approx_monthly_income', group: 'Current', defaultVisible: true, align: 'right', tip: 'Estimated monthly dividend income', render: h => <td style={{ textAlign: 'right', color: 'var(--pos)' }}>{fmt(h.approx_monthly_income)}</td>, footer: () => <span style={{ color: 'var(--pos)' }}>{fmt(totals.monthlyIncome)}</span> },
    { id: 'drip_shares_monthly', label: 'MoShr', name: 'Estimated Monthly DRIP Shares', sortKey: 'drip_shares_monthly', group: 'Current', defaultVisible: true, align: 'right', tip: 'Estimated shares bought per month if 100% of monthly dividend income is reinvested at the current price', render: h => <td style={{ textAlign: 'right', color: 'var(--accent-soft)' }}>{fmtShares(h.drip_shares_monthly)}</td>, footer: () => <span style={{ color: 'var(--accent-soft)' }}>{fmtShares(totals.dripSharesMonthly)}</span> },
    { id: 'monthly_income_reinvested', label: 'DRIP$', name: 'Estimated Monthly Income Reinvested', sortKey: 'monthly_income_reinvested', group: 'Current', defaultVisible: true, align: 'right', tip: 'Monthly income being reinvested (DRIP)', render: h => <td style={{ textAlign: 'right', color: 'var(--accent-bright)' }}>{fmt(h.monthly_income_reinvested)}</td>, footer: () => <span style={{ color: 'var(--accent-bright)' }}>{fmt(totals.monthlyReinvested)}</span> },
    { id: 'monthly_income_not_reinvested', label: 'Cash$', name: 'Estimated Monthly Income Not Reinvested', sortKey: 'monthly_income_not_reinvested', group: 'Current', defaultVisible: true, align: 'right', tip: 'Monthly income NOT being reinvested (cash)', render: h => <td style={{ textAlign: 'right', color: 'var(--warning-money)' }}>{fmt(h.monthly_income_not_reinvested)}</td>, footer: () => <span style={{ color: 'var(--warning-money)' }}>{fmt(totals.monthlyNotReinvested)}</span> },
    { id: 'estim_payment_per_year', label: 'Yr$', name: 'Estimated Annual Payment', sortKey: 'estim_payment_per_year', group: 'Current', defaultVisible: true, align: 'right', tip: 'Estimated annual dividend income', render: h => <td style={{ textAlign: 'right', color: 'var(--pos)' }}>{fmt(h.estim_payment_per_year)}</td>, footer: () => <span style={{ color: 'var(--pos)' }}>{fmt(totals.annualIncome)}</span> },
    { id: 'drip_shares_yearly', label: 'YrShr', name: 'Estimated Yearly DRIP Shares', sortKey: 'drip_shares_yearly', group: 'Current', defaultVisible: true, align: 'right', tip: 'Estimated shares bought per year if 100% of annual dividend income is reinvested at the current price', render: h => <td style={{ textAlign: 'right', color: 'var(--accent-soft)' }}>{fmtShares(h.drip_shares_yearly)}</td>, footer: () => <span style={{ color: 'var(--accent-soft)' }}>{fmtShares(totals.dripSharesYearly)}</span> },
    { id: 'paid_for_itself', label: 'PFI%', name: 'Paid For Itself', sortKey: 'paid_for_itself', group: 'Current', defaultVisible: true, align: 'right', tip: 'Percentage of original cost recovered through dividends', render: h => <td style={{ textAlign: 'right', color: pfiColor(h.paid_for_itself), fontWeight: pfiVal(h.paid_for_itself) >= 100 ? 700 : 400 }}>{h.paid_for_itself == null ? '—' : (h.paid_for_itself * 100).toFixed(2) + '%'}</td> },
    { id: 'nav', label: 'NAV', name: 'NAV Erosion', sortKey: '_coverage', group: 'Current', defaultVisible: true, align: 'right', tip: 'NAV severity uses the benchmark-adjusted ratio, and is forced High for a 50%+ price decline or a 5%+ ending share deficit.', render: renderNavCell },
    { id: 'closure_risk', label: 'Close?', name: 'Closure Risk', sortKey: '_closure_sort', group: 'Current', defaultVisible: true, align: 'center', tip: 'Risk the ETF issuer shuts the fund down for being too small to be profitable. Estimated from AUM × expense ratio (annual fee revenue) with AUM floors and a grace period for newly launched funds. Individual stocks are not rated.', render: h => <td style={{ textAlign: 'center' }}><ClosureRiskBadge info={h._closure} /></td> },
    { id: 'grade', label: 'Grd', name: 'Composite Grade', sortKey: '_grade_sort', group: 'Current', defaultVisible: true, align: 'center', tip: 'Composite grade based on yield, growth, and risk metrics', render: h => <td style={{ textAlign: 'center' }}>{tickerGrades[h.ticker] ? <GradeBadge grade={tickerGrades[h.ticker].grade} /> : '—'}</td> },
    { id: 'percent_change', label: '% Chg', name: 'Daily Percent Change', sortKey: 'percent_change', group: 'Calculated Additions', align: 'right', tip: 'Daily percent change calculated from the current holding data', render: h => <td style={{ textAlign: 'right', color: gradeColor(h.percent_change || 0) }}>{pct(h.percent_change)}</td> },
    { id: 'purchase_value', label: 'Invested', name: 'Purchase Value', sortKey: 'purchase_value', group: 'Calculated Additions', align: 'right', tip: 'Cost basis / purchase value', render: h => <td style={{ textAlign: 'right' }}>{moneyOrDash(h.purchase_value)}</td>, footer: () => moneyOrDash(totals.purchaseValue) },
    { id: 'current_value', label: 'Value', name: 'Current Value', sortKey: 'current_value', group: 'Calculated Additions', align: 'right', tip: 'Current market value', render: h => <td style={{ textAlign: 'right' }}>{moneyOrDash(h.current_value)}</td>, footer: () => moneyOrDash(totals.currentValue) },
    { id: 'gain_or_loss', label: 'Gain$', name: 'Gain/Loss Dollars', sortKey: 'gain_or_loss', group: 'Calculated Additions', align: 'right', tip: 'Current value minus purchase value', render: h => <td style={{ textAlign: 'right', color: gradeColor(h.gain_or_loss || 0) }}>{moneyOrDash(h.gain_or_loss)}</td>, footer: () => <span style={{ color: gradeColor(totals.gainLoss || 0) }}>{moneyOrDash(totals.gainLoss)}</span> },
    { id: 'reinvest', label: 'DRIP', name: 'DRIP Flag', sortKey: 'reinvest', group: 'Calculated Additions', align: 'center', tip: 'Whether dividends are reinvested for this holding', render: h => <td style={{ textAlign: 'center' }}>{textOrDash(h.reinvest)}</td> },
    { id: 'dividend_paid', label: 'Div Paid', name: 'Dividend Paid', sortKey: 'dividend_paid', group: 'Calculated Additions', align: 'right', tip: 'Dividend paid amount calculated from the current holding data', render: h => <td style={{ textAlign: 'right' }}>{moneyOrDash(h.dividend_paid)}</td>, footer: () => moneyOrDash(totals.dividendPaid) },
    { id: 'withdraw_8pct_cost_annually', label: '8% Yr Wd', name: '8% Annual Withdrawal', sortKey: 'withdraw_8pct_cost_annually', group: 'Calculated Additions', align: 'right', tip: '8% annual withdrawal based on cost', render: h => <td style={{ textAlign: 'right' }}>{moneyOrDash(h.withdraw_8pct_cost_annually)}</td>, footer: () => moneyOrDash(totals.withdraw8Annual) },
    { id: 'withdraw_8pct_per_month', label: '8% Mo Wd', name: '8% Monthly Withdrawal', sortKey: 'withdraw_8pct_per_month', group: 'Calculated Additions', align: 'right', tip: '8% monthly withdrawal based on cost', render: h => <td style={{ textAlign: 'right' }}>{moneyOrDash(h.withdraw_8pct_per_month)}</td>, footer: () => moneyOrDash(totals.withdraw8Monthly) },
    { id: 'cash_not_reinvested', label: 'Cash Not', name: 'Cash Not Reinvested', sortKey: 'cash_not_reinvested', group: 'Calculated Additions', align: 'right', tip: 'Cash not reinvested from current holding data', render: h => <td style={{ textAlign: 'right', color: 'var(--warning-money)' }}>{moneyOrDash(h.cash_not_reinvested)}</td>, footer: () => <span style={{ color: 'var(--warning-money)' }}>{moneyOrDash(totals.cashNotReinvested)}</span> },
    { id: 'total_cash_reinvested', label: 'Cash Reinv', name: 'Cash Reinvested', sortKey: 'total_cash_reinvested', group: 'Calculated Additions', align: 'right', tip: 'Cash reinvested from current holding data', render: h => <td style={{ textAlign: 'right', color: 'var(--accent-bright)' }}>{moneyOrDash(h.total_cash_reinvested)}</td>, footer: () => <span style={{ color: 'var(--accent-bright)' }}>{moneyOrDash(totals.totalCashReinvested)}</span> },
    { id: 'shares_bought_from_dividend', label: 'Div Shares', name: 'Shares From Dividends', sortKey: 'shares_bought_from_dividend', group: 'Calculated Additions', align: 'right', tip: 'Shares bought from dividend reinvestment', render: h => <td style={{ textAlign: 'right' }}>{numberOrDash(h.shares_bought_from_dividend, 3)}</td>, footer: () => numberOrDash(totals.sharesBoughtFromDividend, 3) },
    { id: 'shares_bought_in_year', label: 'Calc YrShr', name: 'Calculated Shares/Year', sortKey: 'shares_bought_in_year', group: 'Calculated Additions', align: 'right', tip: 'Calculated annual shares from dividend reinvestment', render: h => <td style={{ textAlign: 'right' }}>{numberOrDash(h.shares_bought_in_year, 3)}</td>, footer: () => numberOrDash(totals.sharesBoughtInYear, 3) },
    { id: 'shares_in_month', label: 'Calc MoShr', name: 'Calculated Shares/Month', sortKey: 'shares_in_month', group: 'Calculated Additions', align: 'right', tip: 'Calculated monthly shares from dividend reinvestment', render: h => <td style={{ textAlign: 'right' }}>{numberOrDash(h.shares_in_month, 3)}</td>, footer: () => numberOrDash(totals.sharesInMonth, 3) },
    { id: 'total_divs_received', label: 'Tot Divs', name: 'Total Dividends Received', sortKey: 'total_divs_received', group: 'Calculated Additions', align: 'right', tip: 'Lifetime dividends received', render: h => <td style={{ textAlign: 'right', color: 'var(--pos)' }}>{moneyOrDash(h.total_divs_received)}</td>, footer: () => <span style={{ color: 'var(--pos)' }}>{moneyOrDash(totals.lifetimeIncome)}</span> },
    { id: 'current_month_income_delta', label: `${currentMonth} Δ`, name: `${currentMonth} Income Difference`, sortKey: 'current_month_income_delta', group: 'Calculated Additions', align: 'right', tip: `${currentMonth} income minus estimated monthly income`, render: h => <td style={{ textAlign: 'right', color: gradeColor(h.current_month_income_delta || 0) }}>{moneyOrDash(h.current_month_income_delta)}</td>, footer: () => <span style={{ color: gradeColor(totals.currentMonthIncomeDelta || 0) }}>{moneyOrDash(totals.currentMonthIncomeDelta)}</span> },
    ]
  })()
  // Column visibility AND order, shared with Manage Holdings and Gains & Losses.
  // Declared here rather than with the other hooks because it needs the built
  // column list, and it still sits above every early return.
  const holdingsLayout = useColumnLayout({
    storageKey: HOLDINGS_COLUMN_PREF_KEY,
    columns: holdingsColumns,
    keyField: 'id',
    lockedKeys: HOLDINGS_LOCKED_COLS,
    defaultLayout: allKeys => layoutFromVisibleKeys(DEFAULT_HOLDINGS_COLUMN_IDS, allKeys),
    migrate: migrateLegacyHoldingColumns,
  })
  const effectiveVisibleHoldingColumns = holdingsLayout.activeColumns
  const visibleColumnCount = effectiveVisibleHoldingColumns.length
  const frozenColCount = Math.min(FROZEN_HOLDING_COLS, visibleColumnCount)
  const visibleHoldingColumnSignature = effectiveVisibleHoldingColumns.map(column => column.id).join('|')
  // Sticky style for a frozen holdings cell (header/body/footer). Background,
  // z-index and hover live in CSS (.holdings-table .frozen-col).
  const frozenColStyle = (index) => (
    index < frozenColCount ? { position: 'sticky', left: frozenColLefts[index] ?? 0 } : null
  )
  // Class names for a frozen cell. The last frozen column also gets
  // .frozen-col-edge, which draws the single Excel-style freeze divider.
  const frozenColClass = (index, base) => {
    if (index >= frozenColCount) return base || undefined
    const parts = [base, 'frozen-col']
    if (index === frozenColCount - 1) parts.push('frozen-col-edge')
    return parts.filter(Boolean).join(' ')
  }


  // Measure the rendered widths of the frozen header cells and turn them into
  // cumulative left offsets so the pinned columns line up with an auto-sized
  // table. Re-runs when the visible columns change; a ResizeObserver + resize
  // listener keep offsets correct as content or the window changes width.
  useLayoutEffect(() => {
    const headRow = holdingsHeadRowRef.current
    if (!headRow) return undefined
    const measure = () => {
      const cells = Array.from(headRow.children)
      const count = Math.min(FROZEN_HOLDING_COLS, cells.length)
      const lefts = []
      let acc = 0
      for (let i = 0; i < count; i++) {
        lefts.push(acc)
        acc += cells[i].getBoundingClientRect().width
      }
      setFrozenColLefts(prev => (
        prev.length === lefts.length && prev.every((v, i) => Math.abs(v - lefts[i]) < 0.5)
      ) ? prev : lefts)
    }
    measure()
    const table = holdingsTableRef.current
    let observer
    if (typeof ResizeObserver !== 'undefined' && table) {
      observer = new ResizeObserver(measure)
      observer.observe(table)
    }
    window.addEventListener('resize', measure)
    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', measure)
    }
    // `loading` is included so we re-measure once the table mounts (the
    // component renders a spinner and no table while loading).
  }, [visibleHoldingColumnSignature, loading])

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
    const isTotalReturn = navReturnMode === 'total'
    const points = navHistory
      .map(r => ({
        date: r.date,
        value: Number(isTotalReturn ? (r.total_return_value ?? r.value) : r.value),
        dividends: Number(r.cumulative_dividends) || 0,
      }))
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
      name: isTotalReturn ? 'Total Return' : 'Price Return',
      line: { color: isTotalReturn ? (isDark ? '#4dff91' : '#15803d') : '#7ecfff', width: 2 },
      marker: { color: isTotalReturn ? (isDark ? '#4dff91' : '#15803d') : '#7ecfff', size: markerSize },
      textposition: 'top center',
      customdata: points.map(point => point.dividends),
      hovertemplate: isTotalReturn
        ? '%{x|%b %d, %Y}<br>Total return value: $%{y:,.2f}<br>Dividends added: $%{customdata:,.2f}<extra></extra>'
        : '%{x|%b %d, %Y}<br>Portfolio value: $%{y:,.2f}<extra></extra>',
    }
    if (singlePoint) {
      valueTrace.text = values.map(v => fmt(v))
    }
    const traces = [valueTrace]
    const oneDayMs = 24 * 60 * 60 * 1000
    const spanMs = (maxDate - minDate) + 2 * datePadding
    const isLongRange = spanMs > 370 * oneDayMs
    const ct = chartTheme(isDark)
    const xaxis = {
      gridcolor: ct.grid,
      color: ct.font,
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
    const chartRange = formatPerformanceChartRange(
      dates[0],
      dates[dates.length - 1],
      dates[0],
      dates[dates.length - 1],
    )
    const layout = {
      template: ct.template,
      paper_bgcolor: ct.paper, plot_bgcolor: ct.plot,
      title: {
        text: `${isTotalReturn ? 'Portfolio Total Return Value History' : 'Portfolio Value History'}${chartRange ? `<br><sup>${chartRange}</sup>` : ''}`,
        font: { size: 15, color: ct.title },
      },
      xaxis,
      yaxis: { title: { text: isTotalReturn ? 'Value + Dividends ($)' : 'Portfolio Value ($)', font: { size: 12, color: ct.font } }, gridcolor: ct.grid, color: ct.font, tickprefix: '$', range: yRange },
      margin: { l: 90, r: 20, t: 70, b: 52 },
      height: 340,
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
  }, [navHistory, navReturnMode, isDark])

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
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
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

      {brokerImportStatus?.stale_accounts?.length > 0 && (() => {
        const accts = brokerImportStatus.stale_accounts
        const single = accts.length === 1
        const sig = accts.map(a => a.profile_id ?? a.name).sort().join(',')
        return (
          <DismissibleBanner
            storageKey={IMPORT_DISMISS_KEY}
            signature={sig}
            collapsedContent={
              <>
                <span style={{ color: 'var(--warning-money)' }}>⚠</span>
                <span>
                  {accts.length} broker account{accts.length !== 1 ? 's' : ''} out of date — re-import needed. Warning hidden.
                </span>
              </>
            }
          >
            <strong style={{ display: 'block' }}>Broker positions are out of date — tracked share counts are drifting.</strong>
            {single ? (
              <p style={{ margin: '0.4rem 0 0' }}>
                <strong>{accts[0].name}</strong> hasn't been imported in {accts[0].days_since_import} days. It is a
                broker-managed account with dividend reinvestment (DRIP) on, so shares reinvested since the last
                import aren't captured — the tracked quantities are falling below your broker's actual holdings,
                which understates share counts and value.
              </p>
            ) : (
              <>
                <p style={{ margin: '0.4rem 0 0' }}>
                  These broker-managed accounts have dividend reinvestment (DRIP) on but haven't been imported in
                  over a month, so shares reinvested since the last import aren't captured — their tracked quantities
                  are falling below your broker's actual holdings, which understates share counts and value. The
                  following need a re-import:
                </p>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.4rem' }}>
                  {accts.map(a => (
                    <li key={a.profile_id}>
                      <strong>{a.name}</strong> — last imported {a.days_since_import} days ago
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p style={{ margin: '0.4rem 0 0' }}>
              To resync, re-import {single ? 'this account' : 'each account'}'s <strong>positions (holdings) file</strong> —
              the share-count snapshot. A <strong>transactions-only import will not fix the quantities</strong>; only a
              positions import resets them. Import transactions too if you also want reinvestment history and cost basis
              kept current. <NavLink to="/import" style={{ fontWeight: 600 }}>Go to Import →</NavLink>
            </p>
          </DismissibleBanner>
        )
      })()}

      {(() => {
        const atRisk = enrichedHoldings
          .filter(h => isAtClosureRisk(h._closure))
          .sort((a, b) => (b._closure_sort || 0) - (a._closure_sort || 0) || (a._closure.aum || 0) - (b._closure.aum || 0))
        if (!atRisk.length) return null
        const sig = atRisk.map(h => h.ticker).sort().join(',')
        const highCount = atRisk.filter(h => h._closure.tier === 'high').length
        // Serious cases (established funds actually below break-even) get full
        // detail; the watch tier — mostly newly launched funds in their grace
        // period — is collapsed to a compact ticker list so the banner stays short.
        const serious = atRisk.filter(h => h._closure.tier === 'high' || h._closure.tier === 'elevated')
        const watch = atRisk.filter(h => h._closure.tier === 'watch')
        return (
          <DismissibleBanner
            storageKey={CLOSURE_DISMISS_KEY}
            signature={sig}
            collapsedContent={
              <>
                <span style={{ color: highCount ? 'var(--neg)' : 'var(--warning-money)' }}>⚠</span>
                <span>
                  {atRisk.length} ETF{atRisk.length !== 1 ? 's' : ''} flagged for possible closure
                  {highCount ? ` (${highCount} high risk)` : ''} — warning hidden.
                </span>
              </>
            }
          >
            <strong style={{ display: 'block' }}>
              {atRisk.length} ETF{atRisk.length !== 1 ? 's' : ''} in this portfolio {atRisk.length !== 1 ? 'are' : 'is'} small
              enough to carry closure risk{highCount ? ` — ${highCount} at high risk` : ''}.
            </strong>
            <p style={{ margin: '0.4rem 0 0.35rem' }}>
              ETF issuers earn roughly <em>assets × expense ratio</em> per year, so a fund that stays too
              small to cover its running costs is a candidate for liquidation — which would force a sale
              (a possible taxable event) and reinvestment.
            </p>
            {serious.length > 0 && (
              <ul style={{ margin: '0 0 0.35rem', paddingLeft: '1.4rem' }}>
                {serious.map(h => {
                  const tier = CLOSURE_TIER[h._closure.tier] || CLOSURE_TIER.unknown
                  return (
                    <li key={h.ticker} style={{ marginBottom: '0.2rem' }}>
                      <strong>{h.ticker}</strong>{' '}
                      <span style={{ color: tier.color, fontWeight: 700 }}>{tier.label}</span>
                      {' — '}
                      <span style={{ color: 'var(--text-dim)' }}>{h._closure.reason}</span>
                    </li>
                  )
                })}
              </ul>
            )}
            {watch.length > 0 && (
              <p style={{ margin: '0 0 0.15rem' }}>
                <span style={{ color: CLOSURE_TIER.watch.color, fontWeight: 700 }}>Watch</span>{' '}
                <span style={{ color: 'var(--text-dim)' }}>
                  (small, most newly launched — a low size is normal early on):{' '}
                  {watch.map(h => h.ticker).join(', ')}
                </span>
              </p>
            )}
            <p style={{ margin: '0.45rem 0 0', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
              Estimated from fund size and fees, not a closure announcement — confirm on the issuer's
              site. See the <strong>Close?</strong> column for a per-holding rating. Informational only,
              not investment advice.
            </p>
          </DismissibleBanner>
        )
      })()}

      {actionCenter?.items?.length > 0 && (
        <div className="card" style={{ padding: '0.85rem 1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ color: 'var(--accent-2)', margin: 0, fontSize: '1rem' }}>Action Center</h3>
              <p style={{ color: 'var(--text-dim)', margin: '0.15rem 0 0', fontSize: '0.82rem' }}>
                {actionCenter.summary?.item_count || actionCenter.items.length} follow-up{(actionCenter.summary?.item_count || actionCenter.items.length) !== 1 ? 's' : ''} found for this portfolio.
              </p>
            </div>
            <NavLink className="btn btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.82rem' }} to="/action-center">
              Open Action Center
            </NavLink>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.5rem' }}>
            {actionCenter.items.slice(0, 4).map(item => {
              const color = item.priority === 'warning' ? 'var(--warning-text)' : item.priority === 'success' ? 'var(--pos)' : 'var(--accent-bright)'
              return (
                <NavLink
                  key={item.id}
                  to={item.route || '/action-center'}
                  style={{
                    display: 'block',
                    border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 6,
                    padding: '0.55rem 0.65rem',
                    background: 'var(--surface-inset)',
                    color: 'var(--text-strong)',
                  }}
                >
                  <div style={{ color, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>
                    {item.kind || 'portfolio'}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.25 }}>{item.title}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.76rem', marginTop: 3, lineHeight: 1.35 }}>{item.detail}</div>
                </NavLink>
              )
            })}
          </div>
        </div>
      )}

      <div className="growth-filters" style={{ marginBottom: '0.5rem' }}>
        <div className="growth-filter-group">
          <label>Shared Performance Date Range</label>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {PERFORMANCE_PERIODS.map(option => (
              <button
                key={option.key}
                className={`tab${gradePeriod === option.key ? ' active' : ''}`}
                onClick={() => setGradePeriod(option.key)}
                style={{ padding: '0.3rem 0.8rem', fontSize: '0.85rem' }}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="tr-note perf-range-note">{PERFORMANCE_RANGE_NOTE}</p>
        </div>
        {gradePeriod === 'custom' && (
          <div className="g2-custom-range" role="group" aria-label="Custom grade date range">
            <label>
              <span>Start date</span>
              <input
                type="date"
                value={gradeCustomStart}
                min={MIN_PERFORMANCE_DATE}
                max={gradeCustomEnd || todayInputValue()}
                onChange={event => setGradeCustomStart(event.target.value)}
              />
            </label>
            <label>
              <span>End date</span>
              <input
                type="date"
                value={gradeCustomEnd}
                min={gradeCustomStart || MIN_PERFORMANCE_DATE}
                max={todayInputValue()}
                onChange={event => setGradeCustomEnd(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>
      {gradeRangeError && <div className="alert alert-error">{gradeRangeError}</div>}
      {trackerPerformanceError && (
        <div className="alert alert-error">
          Shared-period Total Return could not be loaded: {trackerPerformanceError}
        </div>
      )}
      {trackerAccountingCoverage && !trackerPerformanceLoading && (
        <p className="tr-note" style={{ marginTop: 0 }}>
          <strong>Tracker accounting:</strong> {trackerAccountingCoverage}
        </p>
      )}

      {portfolioCoverage != null && (
        <div className="nav-erosion-summary-row">
          <div
            className="summary-card nav-erosion-severity-card"
            style={{
              borderColor: portfolioNavColor,
              background: navSeverityBg(portfolioNavSeverity),
            }}
          >
            <div
              className="summary-value"
              style={{
                color: portfolioNavColor,
                fontSize: '0.82rem',
                lineHeight: 1.3,
                textAlign: 'center',
              }}
            >
              {navSeverityText(portfolioNavSeverity)}
            </div>
          </div>
          <SummaryCard
            label="NAV Erosion Score"
            value={portfolioCoverage.toFixed(4)}
            color={portfolioNavColor}
          />
          <SummaryCard
            className="daily-change-card"
            label="Account Day Change"
            value={dailyChangeValue}
            color={dailyChangeColor}
            sub={dailyChangeSub}
            title={dailyChangeTitle}
          />
          <SummaryCard
            label={`Price Return \u2014 ${trackerPerformance?.period_label || 'Selected Period'}`}
            value={trackerPerformanceLoading ? 'Loading...' : pct(fullTrackerPriceReturn)}
            color={gradeColor(fullTrackerPriceReturn)}
            sub={trackerPerformanceRange}
            title="Transaction-aware price return for the Shared Performance Date Range"
          />
          <SummaryCard
            label={`Tracker Total Return \u2014 ${trackerPerformance?.period_label || 'Selected Period'}`}
            value={trackerPerformanceLoading ? 'Loading...' : pct(fullTrackerTotalReturn)}
            color={gradeColor(fullTrackerTotalReturn)}
            sub={trackerPerformanceRange}
            title="The same transaction-aware Total Return shown on the Total Return, Growth, and Gains & Losses pages"
          />
        </div>
      )}

      <details className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--accent-2)', fontWeight: 500 }}>
          Understanding NAV Erosion Values and Colors
        </summary>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem', lineHeight: 1.5, marginTop: '0.75rem' }}>
          <p style={{ margin: '0 0 0.65rem' }}>
            The displayed NAV value and its color answer related but different questions. The value is the
            benchmark-adjusted NAV erosion ratio: the holding&apos;s qualifying price decline divided by its
            trailing-12-month distribution yield. Lower is better.
          </p>
          <ul style={{ margin: '0 0 0.65rem', paddingLeft: '1.2rem' }}>
            <li>
              <strong style={{ color: 'var(--text-strong)' }}>Why can the value be 0.00?</strong> The ratio is
              zero when the holding&apos;s price rose or when its selected benchmark also declined. In the latter
              case, the benchmark gate treats the drop as a broader market move instead of fund-specific erosion.
            </li>
            <li>
              <strong style={{ color: 'var(--text-strong)' }}>Why can 0.00 still be red?</strong> The Dashboard
              forces a High/red warning when the holding&apos;s unadjusted price has fallen 50% or more during the
              trailing-year test, even if the benchmark gate made the ratio zero. The color is warning about the
              absolute price collapse, not saying that 0.00 is a bad ratio.
            </li>
          </ul>
          <p style={{ margin: 0 }}>
            For example, BTCI can show <strong style={{ color: 'var(--text-strong)' }}>0.00 in red</strong> when
            both BTCI and its BTC-USD benchmark declined, but BTCI&apos;s own decline exceeded the 50% safety threshold.
            Detailed NAV back-tests can also force High when the ending share deficit reaches 5% or more.
          </p>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.8rem', paddingTop: '0.75rem' }}>
            <strong style={{ color: 'var(--text-strong)' }}>Why can the benchmark box turn red?</strong>
            <p style={{ margin: '0.35rem 0 0.55rem' }}>
              A red border around the benchmark entry box is a validation error, not a NAV-risk rating. It means
              the manual symbol did not return usable price history from the market-data provider, so the NAV test
              cannot compare the holding with that benchmark.
            </p>
            <p style={{ margin: 0 }}>
              To fix it, enter the provider&apos;s complete symbol and press Enter or click outside the box. For
              example, the PHLX Semiconductor Index is <strong style={{ color: 'var(--text-strong)' }}>^SOX</strong>,
              not SOX; <strong style={{ color: 'var(--text-strong)' }}>SOXX</strong> is also a valid semiconductor ETF
              proxy. You can instead clear the box to let Auto choose the holding&apos;s default benchmark. A valid
              symbol restores the normal border. Changing a valid benchmark only to remove a red NAV warning is
              not recommended—the benchmark should represent the holding&apos;s actual underlying exposure.
            </p>
          </div>
        </div>
      </details>

      <p className="tr-note" style={{ marginTop: 0 }}>
        <strong>{portfolioGrade.period_label || 'Grade period'}:</strong>{' '}
        {formatPerformanceRange(
          portfolioGrade.actual_start_date,
          portfolioGrade.actual_end_date,
        ) || (tickerRiskLoading ? 'Loading dates...' : 'Dates unavailable')}
        {portfolioGrade.requested_start_date
          && portfolioGrade.actual_start_date !== portfolioGrade.requested_start_date
          ? ` (requested from ${formatPerformanceRange(
            portfolioGrade.requested_start_date,
            portfolioGrade.requested_end_date,
          )})`
          : ''}
        . These dates apply to the Portfolio Grade, beta, and risk-ratio cards below.
        {/* A window this short can't carry the ratios — say so, rather than
            leaving a strip of dashes that reads like a failed load. */}
        {portfolioGrade.window_too_short && (
          <>
            {' '}
            <strong style={{ color: 'var(--warning-money)' }}>
              Only {portfolioGrade.window_observations ?? 0} trading{' '}
              {portfolioGrade.window_observations === 1 ? 'day' : 'days'} in this window.
            </strong>{' '}
            The risk ratios annualize daily returns, so they need at least{' '}
            {SHORT_WINDOW_MIN_TRADING_DAYS} trading days before they mean anything — pick a
            longer period to grade this portfolio.
          </>
        )}
      </p>

      {/* Summary Cards Strip */}
      <div className="summary-strip">
        <SummaryCard
          className="summary-card-grade"
          label="Portfolio Grade"
          value={portfolioGrade.overall ? <GradeBadge grade={portfolioGrade.overall} large /> : '—'}
          sub={portfolioGrade.score != null ? `Score: ${portfolioGrade.score}` : null}
        />
        <BenchmarkBetaCard
          benchmark={betaBenchmark}
          onBenchmarkChange={setBetaBenchmark}
          beta={marketExposure.beta}
          exposure={marketExposure.betaAdjustedExposure}
        />
        <SummaryCard label="Ulcer Index" value={portfolioGrade.ulcer_index ?? '—'} />
        <SummaryCard label="Calmar Ratio" value={portfolioGrade.calmar ?? '—'} />
        <SummaryCard label="Omega Ratio" value={portfolioGrade.omega ?? '—'} />
        <SummaryCard label="Sortino Ratio" value={portfolioGrade.sortino ?? '—'} />
        <SummaryCard label="Sharpe Ratio" value={portfolioGrade.sharpe ?? '—'} />
        <SummaryCard label="Lifetime Income" value={fmt(totals.lifetimeIncome)} color="var(--pos)" />
        <SummaryCard label="YTD Dividends" value={fmt(totals.ytdDivs)} color="var(--pos)" />
        <SummaryCard label={`${currentMonth} Income`} value={fmt(totals.currentMonthIncome)} color="var(--pos)" sub={currentMonthSub} />
        <SummaryCard label="Est. Monthly Income" value={fmt(totals.monthlyIncome)} color="var(--pos)" sub="Annual estimate / 12" />
        <SummaryCard label="Est. Mo$ Reinvested" value={fmt(totals.monthlyReinvested)} color="var(--accent-bright)" sub="Forward run-rate" />
        <SummaryCard label="Est. Mo$ Not Reinvested" value={fmt(totals.monthlyNotReinvested)} color="var(--warning-money)" sub="Forward run-rate" />
        <SummaryCard label="Est. % Reinvested" value={pct(totals.reinvestPct)} color="var(--pos-muted)" sub="Forward run-rate" />
        <SummaryCard label={`${currentMonth} Reinvested`} value={fmt(totals.currentMonthReinvested)} color="var(--accent-bright)" sub={currentMonthSub} />
        <SummaryCard label={`${currentMonth} Not Reinvested`} value={fmt(totals.currentMonthNotReinvested)} color="var(--warning-money)" sub={currentMonthSub} />
        <SummaryCard label={`${currentMonth} % Reinvested`} value={totals.currentMonthReinvestPct != null ? pct(totals.currentMonthReinvestPct) : '—'} color="var(--pos-muted)" sub={currentMonthSub} />
        <SummaryCard label="Est. Annual Income" value={fmt(totals.annualIncome)} color="var(--pos)" />
        <SummaryCard
          label="Portfolio Value"
          value={fmt(totals.accountValue)}
          color="var(--accent-bright)"
          sub={totals.cashValue > 0 ? `Includes ${fmt(totals.cashValue)} cash` : null}
        />
        <SummaryCard
          label={appliedIrrExclusions.length ? 'Filtered IRR' : 'Portfolio IRR'}
          value={irrExclusionLoading ? 'Updating…' : hasPortfolioIrr ? pct(portfolioIrr) : 'Unavailable'}
          color={hasPortfolioIrr ? gradeColor(portfolioIrr) : undefined}
          sub={irrSub}
          title={irrTitle}
          action={(irrExclusionOptions.length > 0 || appliedIrrExclusions.length > 0) ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
              disabled={irrExclusionLoading}
              onClick={() => {
                setIrrExclusionDraft(appliedIrrExclusions)
                setIrrExclusionOpen(true)
              }}
            >
              Manage exclusions
            </button>
          ) : null}
        />
        <SummaryCard label="Avg Yield on Cost" value={pct(totals.avgYoc)} />
        <SummaryCard label="Current Yield" value={pct(totals.currentYield)} />
        {sp500 && (
          <SummaryCard
            label="S&P 500"
            value={sp500.price != null && Number.isFinite(Number(sp500.price))
              ? Number(sp500.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : 'Unavailable'}
            sub={
              <span>
                <span style={{ color: sp500.day_pct == null ? 'var(--text-dim)' : sp500.day_pct >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  Day: {sp500.day_pct != null && Number.isFinite(Number(sp500.day_pct))
                    ? `${Number(sp500.day_pct) >= 0 ? '+' : ''}${Number(sp500.day_pct).toFixed(2)}%`
                    : 'Unavailable'}
                </span>
                {' · '}
                <span style={{ color: sp500.ytd_pct == null ? 'var(--text-dim)' : sp500.ytd_pct >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  YTD: {sp500.ytd_pct != null && Number.isFinite(Number(sp500.ytd_pct))
                    ? `${Number(sp500.ytd_pct) >= 0 ? '+' : ''}${Number(sp500.ytd_pct).toFixed(2)}%`
                    : 'Unavailable'}
                </span>
              </span>
            }
          />
        )}
      </div>

      {irrExclusionOpen && (
        <div className="modal-overlay" onClick={() => setIrrExclusionOpen(false)}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="irr-exclusion-title"
            onClick={event => event.stopPropagation()}
            style={{ maxWidth: 760, maxHeight: '85vh', overflow: 'auto' }}
          >
            <h3 id="irr-exclusion-title" style={{ marginTop: 0, color: 'var(--accent-2)' }}>
              Filter incomplete tickers from IRR
            </h3>
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              A filtered IRR measures only the included, fully documented holdings. It is not the
              IRR of the entire account. The Dashboard will label it <strong>Filtered IRR</strong> and
              disclose the percentage of portfolio value excluded.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIrrExclusionDraft(irrExclusionOptions.map(option => option.ticker))}
              >
                Select all incomplete
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIrrExclusionDraft([])}
              >
                Clear exclusions
              </button>
            </div>
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              {irrExclusionOptions.map(option => {
                const checked = irrExclusionDraft.includes(option.ticker)
                return (
                  <label
                    key={option.ticker}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                      gap: '0.65rem',
                      alignItems: 'start',
                      padding: '0.6rem 0.7rem',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: checked ? 'var(--surface-inset)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setIrrExclusionDraft(previous => checked
                        ? previous.filter(ticker => ticker !== option.ticker)
                        : normalizeIrrExclusions([...previous, option.ticker]))}
                    />
                    <span>
                      <strong>{option.ticker}</strong>
                      {option.description ? <span style={{ color: 'var(--text-dim)' }}> — {option.description}</span> : null}
                      <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.76rem', marginTop: 2 }}>
                        {option.reasons.join(' · ')}
                      </span>
                    </span>
                    <span style={{ whiteSpace: 'nowrap', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                      {option.currentValue > 0 ? fmt(option.currentValue) : 'No current value'}
                    </span>
                  </label>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIrrExclusionOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={applyIrrExclusions}>
                Apply {irrExclusionDraft.length} exclusion{irrExclusionDraft.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portfolio Equity Curve */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ color: 'var(--accent-2)', margin: 0, fontSize: '1rem' }}>Portfolio Value Over Time</h3>
          <div
            role="group"
            aria-label="Portfolio value chart return type"
            style={{ display: 'flex', marginLeft: 'auto' }}
          >
            {[
              { value: 'price', label: 'Price Return', title: 'Show recorded portfolio value without adding dividend payments' },
              { value: 'total', label: 'Total Return', title: 'Add actual recorded dividend payments since the first chart date' },
            ].map((option, index, options) => (
              <button
                key={option.value}
                type="button"
                className={`btn btn-sm${navReturnMode === option.value ? ' btn-active' : ''}`}
                style={{
                  borderRadius: index === 0 ? '4px 0 0 4px' : index === options.length - 1 ? '0 4px 4px 0' : 0,
                }}
                aria-pressed={navReturnMode === option.value}
                title={option.title}
                onClick={() => {
                  setNavReturnMode(option.value)
                  persistNavReturnMode(option.value)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
            disabled={navSnapping}
            onClick={() => {
              setNavSnapping(true)
              setRefreshStatus('Updating prices & dividends before recording NAV...')
              runMarketRefresh({ statusMessage: 'Updating prices & dividends before recording NAV...' })
                .then(r => {
                  setDailyChange(r.daily_change || null)
                  return pf('/api/nav/snapshot', { method: 'POST' })
                })
                .then(safeJson)
                .then(d => {
                  if (d?.skipped) {
                    setRefreshStatus(d.reason || 'NAV snapshot skipped because the market is closed.')
                    setTimeout(() => setRefreshStatus(null), 4500)
                  } else {
                    setRefreshStatus('NAV snapshot recorded.')
                    setTimeout(() => setRefreshStatus(null), 3000)
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
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', margin: '1rem 0' }}>
            No NAV snapshots yet. Click "Record NAV" or import data to start tracking.
          </p>
        )}
      </div>

      {/* Grade Thresholds (collapsible) */}
      <details className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--accent-2)', fontWeight: 500 }}>Grade & Exposure Guide</summary>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', lineHeight: 1.45, margin: '0.75rem 0 0' }}>
          Portfolio beta is an exposure readout, not an input to the composite grade. It estimates how sensitive the portfolio is to the selected benchmark: 1.00x moves roughly with the benchmark, 0.80x moves about 80% as much, and 1.20x moves about 120% as much. The dollar estimate below beta translates a 1% benchmark move into an approximate portfolio-value move.
        </p>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem', lineHeight: 1.45, marginTop: '0.5rem' }}>
          <div>Conservative income: 0.50-0.70 beta</div>
          <div>Balanced income: 0.70-0.90 beta</div>
          <div>Aggressive income: 0.90-1.15 beta</div>
          <div>Very aggressive: &gt;1.15 beta</div>
        </div>
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
      {overviewGroups && (
        <PortfolioOverview
          groups={overviewGroups}
          categories={overviewCategories}
          totalValue={totals.currentValue}
          categoryId={overviewCategoryId}
          subcategoryId={overviewSubcategoryId}
          onFilterChange={(categoryId, subcategoryId) => {
            setOverviewCategoryId(categoryId)
            setOverviewSubcategoryId(subcategoryId)
          }}
          returnMode={overviewReturnMode}
          onReturnModeChange={mode => {
            setOverviewReturnMode(mode)
            persistOverviewReturnMode(mode)
          }}
        />
      )}

      {/* Holdings Table */}
      <div className="holdings-toolbar">
        <div>
          <div className="holdings-toolbar-title">Holdings Columns</div>
          <div className="holdings-toolbar-sub">
            {visibleColumnCount} of {holdingsColumns.length} columns · {sorted.length} of {enrichedHoldings.length} holdings
          </div>
          <div className="holdings-toolbar-sub">
            Customizable &mdash; use <strong>Columns</strong> to choose which ones show, and drag a
            header to reorder them.
          </div>
        </div>
        <ColumnCustomizer
          layout={holdingsLayout}
          labelOf={column => column.name}
          detailOf={column => column.label}
          groupOf={column => column.group}
          presets={HOLDINGS_COLUMN_PRESETS}
        />
      </div>

      <div className="holdings-table-wrap">
        <table className="holdings-table" ref={holdingsTableRef}>
          <thead>
            <tr ref={holdingsHeadRowRef}>
              {effectiveVisibleHoldingColumns.map((column, index) => {
                const frozen = index < frozenColCount
                const frozenStyle = frozenColStyle(index)
                const dragProps = holdingsLayout.dragHandlers(column.id)
                const dragTitle = `${column.tip || column.name}\u000a\u000aDrag this header to reorder the columns.`
                if (column.renderHeader) {
                  const header = column.renderHeader()
                  return React.cloneElement(header, {
                    key: column.id,
                    ...dragProps,
                    title: dragTitle,
                    className: holdingsLayout.dragClass(
                      column.id,
                      frozen ? frozenColClass(index, header.props.className) : header.props.className,
                    ),
                    style: { ...header.props.style, cursor: 'grab', ...(frozen ? frozenStyle : null) },
                  })
                }
                return (
                  <SortHeader
                    key={column.id}
                    col={column.sortKey || column.id}
                    align={column.align}
                    tip={column.tip || column.name}
                    className={holdingsLayout.dragClass(column.id, frozen ? frozenColClass(index) : undefined)}
                    style={{ cursor: 'grab', ...(frozenStyle || {}) }}
                    {...dragProps}
                  >
                    {column.label}
                  </SortHeader>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(h => {
              const navSeverity = h._coverage_meta?.nav_erosion_severity || navSeverityFromRatio(h._coverage)
              const covBad = navSeverity === 'High'
              return (
                <tr key={h.ticker} className={covBad ? 'cov-bad' : undefined} style={covBad ? { background: 'rgba(255,107,107,0.1)' } : undefined}>
                  {effectiveVisibleHoldingColumns.map((column, index) => {
                    const cell = column.render(h)
                    if (index < frozenColCount) {
                      return React.cloneElement(cell, {
                        key: column.id,
                        className: frozenColClass(index, cell.props.className),
                        style: { ...cell.props.style, ...frozenColStyle(index) },
                      })
                    }
                    return React.cloneElement(cell, { key: column.id })
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
              {effectiveVisibleHoldingColumns.map((column, index) => {
                const frozen = index < frozenColCount
                return (
                  <td
                    key={column.id}
                    className={frozen ? frozenColClass(index) : undefined}
                    style={holdingCellStyle(column, frozen ? frozenColStyle(index) : undefined)}
                  >
                    {index === 0 ? (isHoldingsFiltered ? 'Filtered Totals' : 'Totals') : column.footer ? column.footer() : ''}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Ticker Modal */}
      {modalTicker && (
        <TickerModal
          ticker={modalTicker}
          onClose={() => setModalTicker(null)}
          period={gradePeriod}
          customStart={gradeCustomStart}
          customEnd={gradeCustomEnd}
          onPeriodChange={setGradePeriod}
          onCustomStartChange={setGradeCustomStart}
          onCustomEndChange={setGradeCustomEnd}
          maxDate={initialGradeCustomDates.end}
        />
      )}
    </div>
  )
}
