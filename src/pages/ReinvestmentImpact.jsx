import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Plot from '../components/ThemedPlot'
import BuilderModelSelect from '../components/BuilderModelSelect'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoneyWhole } from '../utils/money'
import { PRICE_SHOCK_PRESETS, PRICE_SENSITIVITY_POINTS, projectPriceImpact } from '../utils/priceImpactModel'
import { holdingInSubcategories } from '../utils/categoryHierarchy'

const fmt$ = v => formatMoneyWhole(v)
const fmtSigned$ = v => {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return n >= 0 ? `+${fmt$(n)}` : `-${fmt$(Math.abs(n))}`
}
const fmtShares = v => v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct1 = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
const fmtYears = v => v == null ? '—' : v < 1 / 12 ? '<1 mo' : v < 1 ? `${Math.round(v * 12)} mo` : `${v.toFixed(1)} yr`

// Break-even analysis for a single holding: compares position market value alone
// (price-only) and value + cumulative dividends collected (total return) against
// out-of-pocket cost basis.
function breakevenMetrics(h, histTickerRow) {
  if (!h) return null
  const shares = Number(h.quantity) || 0
  const price = Number(h.current_price) || 0
  const cost = Number(h.purchase_value) || 0
  const value = Number(h.current_value) || shares * price
  const holdingDivs = Number(h.total_divs_received) || 0
  const ledgerDivs = Number(histTickerRow?.total_payout) || 0
  const divs = Math.max(holdingDivs, ledgerDivs)
  const annualIncome = Number(h.estim_payment_per_year) || 0
  if (cost <= 0 || price <= 0 || value <= 0) return null

  const WIPED_PCT = 900
  const MAX_DRIP_YEARS = 50

  const leg = (effValue) => {
    const netDollar = effValue - cost
    const gap = cost - effValue
    const brokenEven = effValue >= cost
    const pctToBreakeven = brokenEven ? null : (cost / effValue - 1) * 100
    const years = brokenEven || annualIncome <= 0 ? null : gap / annualIncome
    return {
      brokenEven,
      netDollar,
      gap: Math.max(0, gap),
      pctFromCost: (effValue / cost - 1) * 100,
      pctToBreakeven,
      pctAbove: brokenEven ? (effValue / cost - 1) * 100 : null,
      sharesNeeded: brokenEven ? 0 : gap / price,
      years,
      wipedOut: !brokenEven && pctToBreakeven > WIPED_PCT,
      dripRecoverable: years != null && years <= MAX_DRIP_YEARS,
    }
  }

  return {
    shares, price, cost, value, divs, annualIncome,
    costBasis: leg(value),
    totalReturn: leg(value + divs),
  }
}

const VIEW_OPTIONS = [
  { value: 'yearly', label: 'Annual' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
]

const MONTHLY_RANGE = [
  { value: 24, label: '2 Years' },
  { value: 36, label: '3 Years' },
  { value: 60, label: '5 Years' },
  { value: 120, label: '10 Years' },
]
const WEEKLY_RANGE = [
  { value: 3, label: '3 Months' },
  { value: 6, label: '6 Months' },
  { value: 12, label: '12 Months' },
  { value: 24, label: '24 Months' },
]
const YEARLY_RANGE = [
  { value: 60, label: '5 Years' },
  { value: 120, label: '10 Years' },
  { value: 240, label: '20 Years' },
]

const YEAR_PRESETS = [
  { l: '1yr', v: 1 }, { l: '3yr', v: 3 }, { l: '5yr', v: 5 },
  { l: '10yr', v: 10 }, { l: '20yr', v: 20 },
]
const MARKET_TYPES = [
  { value: 'bullish', label: 'Bullish' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'bearish', label: 'Bearish' },
]
const MODE_OPTIONS = [
  {
    value: 'historical',
    label: 'Historical',
    desc: 'Actual recorded distributions paired with your [DRIP] share purchases — shows how much was reinvested vs. taken as cash and how much extra income those DRIP shares have already paid.',
  },
  {
    value: 'projection',
    label: 'Projection',
    desc: 'Forward simulation starting from your Dashboard Est. Annual Income — compares compounding at your chosen Reinvest % against keeping 0% reinvested.',
  },
  {
    value: 'priceImpact',
    label: 'Price Impact',
    desc: 'Stress-tests what an immediate portfolio price drop or rally does to today’s income and to future share accumulation when distributions are reinvested at the new price.',
  },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function labelFor(key, view, isPartial = false) {
  let base
  if (view === 'yearly') {
    base = key
    return isPartial ? `${base} YTD` : base
  }
  if (view === 'weekly') {
    const [y, w] = key.split('-W')
    base = `Wk${Number(w)} '${y.slice(-2)}`
    return isPartial ? `${base}*` : base
  }
  const [y, m] = key.split('-')
  base = `${MONTH_NAMES[Number(m) - 1]} ${y.slice(-2)}`
  return isPartial ? `${base} MTD` : base
}

const DARK_LAYOUT = {
  paper_bgcolor: '#16213e',
  plot_bgcolor: '#16213e',
  font: { color: '#e0e8f5', size: 12 },
  margin: { l: 64, r: 56, t: 50, b: 64 },
}
const READ_ONLY_PLOT_CONFIG = {
  responsive: true,
  displayModeBar: false,
  scrollZoom: false,
  editable: false,
}

function readOnlyAxes(layout) {
  return {
    ...layout,
    dragmode: false,
    xaxis: { ...(layout.xaxis || {}), fixedrange: true },
    yaxis: { ...(layout.yaxis || {}), fixedrange: true },
    yaxis2: layout.yaxis2 ? { ...layout.yaxis2, fixedrange: true } : layout.yaxis2,
  }
}

// Using a Portfolio Builder model lasts for this app session; the chosen model is remembered.
const USE_MODEL_KEY = 'reinvestmentImpact.useBuilderModel'
const MODEL_ID_KEY = 'reinvestmentImpact.builderModelId'
const STALE_BACKEND_MESSAGE = 'The backend that is running started before Portfolio Builder models could be used on this page, so it cannot model one yet. Restart the app (close it and any “npm run dev:all” windows, then reopen it) and try again.'
const SCENARIO_COLORS = { bullish: '#4dff91', neutral: '#f59e0b', bearish: '#e05555' }

const usableHolding = h => Number(h.quantity) > 0 && Number(h.current_price) > 0

// A Builder model row (from /api/portfolio-distributions/model-holdings) in the
// holdings shape this page reads. A model has no DRIP settings: its income is
// modeled as if every distribution were reinvested, like the Distributions page.
function modelHoldingRow(row) {
  const annual = Number(row.estim_payment_per_year) || 0
  return {
    ...row,
    current_price: Number(row.price) || 0,
    approx_monthly_income: annual / 12,
    monthly_income_reinvested: annual / 12,
    reinvest: 'Y',
    total_divs_received: 0,
  }
}

// Rollover help, shown with the app's ⓘ + hover-text convention.
const HELP = {
  sourcePicker: 'Run every tab on a model portfolio from Portfolio Builder instead of the selected portfolio. A model has no payment records, so its history is modeled from each fund’s actual past distributions.',
  distributions: 'Bars: total distributions paid each period. Green = recorded payments, blue = modeled from market history (no payment records), teal = both; a faded last bar is a period still in progress. Hover a bar for how much was reinvested through DRIP, taken as cash, and earned by shares that earlier DRIP purchases bought. Dotted line: what the same periods would have paid if nothing had been reinvested since the window began. Orange line (right axis): running total received.',
  ratePerShare: 'What one share paid in each period, summed over that period’s payments. It does not depend on how many shares you own, so it shows whether the fund raised or cut its payout. Months with five weekly payments read higher than four-payment months.',
  dripShares: 'Purple bars: shares bought each period by reinvesting distributions (your [DRIP] purchases; for a Builder model, bought at that day’s close). Orange line (right axis): running total bought since the window began. Shares later sold still count here; the DRIP Shares Bought tile shows how many are still held.',
  decomposition: 'Splits each change in payouts into its causes. Green: more shares from DRIP. Purple: shares bought or sold for cash, including new positions. Blue: the fund changing its per-share payout. Orange: share and rate changes landing in the same period. Cumulative adds the changes up from the window start; Period-over-Period compares each period with the one before. A fund’s first period has nothing to compare with, so its starting payout is not attributed.',
  rateShifts: 'Funds whose per-share payout changed the most over the window, in dollars: each change in the per-share payout times the shares held before it. Click a ticker to see its own charts.',
  cashNotReinvesting: 'Open holdings where at least one account takes distributions as cash. The amount is what was paid as cash in this window: payments with no matching [DRIP] purchase.',
  topContributors: 'The funds that paid the most in the window. Window Reinv % = share of those payments that was actually reinvested. DRIP Shares = shares bought by reinvesting. Extra from DRIP = distributions those shares earned. Current DRIP Setting = today’s reinvest setting across the accounts that hold the fund. Click a row to scope the page to that fund.',
  projection: 'Simulated income over the horizon at your Reinvest % and Monthly Add, under the chosen market scenario. Solid line: with reinvesting (and additions). Dashed line: the same holdings with nothing reinvested and nothing added. The gap between them is what compounding adds. Horizons up to 5 years show months; longer ones show years.',
  shareCount: 'Total shares held over the horizon in each market scenario as reinvested distributions and monthly additions buy more. Lower bearish prices let each reinvested dollar buy more shares. For a whole portfolio this adds up shares of funds with different prices, so pick one ticker in Scope for a meaningful share curve.',
  immediateIncome: 'Income right after an instant portfolio price move of the size on the x-axis, before any reinvesting. Each holding’s payout moves by its income sensitivity: option-income funds the most, declared dividends the least. Blue: monthly income (left axis). Green: annual income (right axis). The dotted line marks the price change you selected.',
  sensitivity: 'Green: annual income at the end of the horizon after reinvesting at your Reinvest % (plus additions), starting from each price move. Dashed: the immediate annual payout at that price, with nothing reinvested. A drop lowers today’s payout, but each reinvested dollar buys more shares, so the green line falls less than the dashed one.',
  trajectory: 'Month-by-month income after the selected price change. Solid: reinvesting at your Reinvest % (plus additions). Dashed: the shocked income with nothing reinvested.',
  priceHoldings: 'Holdings ranked by projected annual income after the price change: today’s and the shocked price, the income sensitivity applied to the payout, the shares held at the end of the horizon, and how much reinvesting lifts the fund’s income.',
  breakeven: 'Compares what you paid with what the position is worth now. Price Only: market value alone. Total Return: market value plus the distributions collected. When short of cost, it shows the price gain needed, or the shares at today’s price that reinvested distributions would have to buy to close the gap.',
}

// ⓘ with hover text. In a panel corner by default; `inline` for use beside a label.
function HelpTip({ text, inline = false }) {
  if (!text) return null
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      tabIndex={0}
      style={inline
        ? { cursor: 'help', marginLeft: 4, opacity: 0.8 }
        : { position: 'absolute', top: '0.5rem', right: '0.7rem', zIndex: 2, cursor: 'help', color: 'var(--text-dim)', fontSize: '0.95rem', lineHeight: 1 }}
    >ⓘ</span>
  )
}

function StatTile({ label, value, color, sub, help }) {
  return (
    <div className="summary-card" title={help || undefined} style={help ? { cursor: 'help' } : undefined}>
      <div className="summary-label">{label}{help && <span aria-hidden="true" style={{ marginLeft: 4, opacity: 0.8 }}>ⓘ</span>}</div>
      <div className="summary-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem', lineHeight: 1.35 }}>{sub}</div>}
    </div>
  )
}

function BreakevenLeg({ title, leg, hint }) {
  const green = '#4dff91', red = '#f87171', amber = '#f59e0b'
  return (
    <div style={{ flex: '1 1 260px', minWidth: 240, padding: '0.65rem 0.85rem', borderRadius: 6, background: 'rgba(15, 23, 42, 0.35)', border: '1px solid var(--p-1f2f4d)' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.1rem' }}>{title}</div>
      <div style={{ fontSize: '0.7rem', color: 'var(--p-6a7892)', marginBottom: '0.45rem' }}>{hint}</div>
      {leg.brokenEven ? (
        <>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: green }}>
            {fmtSigned$(leg.netDollar)} <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>({fmtPct1(leg.pctAbove)})</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>above cost basis ✓</div>
        </>
      ) : leg.wipedOut ? (
        <>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: red }}>
            {fmtSigned$(leg.netDollar)} <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>({fmtPct1(leg.pctFromCost)})</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>below cost — price recovery unlikely</div>
          {leg.dripRecoverable ? (
            <div style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: 'var(--p-c5d0dc)' }}>
              100% reinvestment closes {fmt$(leg.gap)} gap in ~<span style={{ fontWeight: 600 }}>{fmtYears(leg.years)}</span> at a flat price
            </div>
          ) : (
            <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--p-6a7892)', fontStyle: 'italic' }}>
              Recovery impractical at the current distribution rate
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: red }}>
            {fmtSigned$(leg.netDollar)} <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>({fmtPct1(leg.pctFromCost)})</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: amber, marginTop: '0.1rem' }}>
            {fmt$(leg.gap)} short of cost · needs +{leg.pctToBreakeven.toFixed(1)}% gain to recover
          </div>
          <div style={{ marginTop: '0.35rem', fontSize: '0.82rem', color: 'var(--p-c5d0dc)' }}>
            Or <span style={{ color: 'var(--p-a855f7)', fontWeight: 600 }}>{fmtShares(leg.sharesNeeded)}</span> DRIP shares at {fmt$(leg.gap / Math.max(leg.sharesNeeded, 1e-9))}/sh
            {leg.years != null && <> (~<span style={{ fontWeight: 600 }}>{fmtYears(leg.years)}</span> at 100% DRIP)</>}
          </div>
        </>
      )}
    </div>
  )
}

function BreakevenPanel({ ticker, holding, histTickerRow }) {
  // A Builder model was never bought: it has no cost basis or collected distributions to break even on.
  if (holding?.model) return null
  const be = breakevenMetrics(holding, histTickerRow)
  if (!be) return null
  return (
    <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
      <HelpTip text={HELP.breakeven} />
      <h3 style={{ marginTop: 0, marginBottom: '0.25rem', paddingRight: '1.5rem' }}>Break-Even Check — {ticker}</h3>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
        Cost basis <strong>{fmt$(be.cost)}</strong> · Current market value <strong>{fmt$(be.value)}</strong> · Distributions collected <strong>{fmt$(be.divs)}</strong> · Total value + distributions <strong>{fmt$(be.value + be.divs)}</strong>
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
        <BreakevenLeg title="Price Only (Unrealized)" hint="Current share value vs. what you paid" leg={be.costBasis} />
        <BreakevenLeg title="Total Return (With Distributions)" hint="Current value + cash/DRIP distributions collected vs. cost" leg={be.totalReturn} />
      </div>
      {be.annualIncome > 0 && (!be.costBasis.brokenEven || !be.totalReturn.brokenEven) && (
        <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0.6rem 0 0', fontStyle: 'italic' }}>
          Reinvestment recovery time assumes a flat share price and 100% of {ticker}&apos;s estimated {fmt$(be.annualIncome)}/yr distributions reinvested into shares.
        </p>
      )}
    </div>
  )
}

export default function ReinvestmentImpact() {
  const pf = useProfileFetch()
  const { selection, currentProfileName, profileQueryString } = useProfile()
  const { isDark } = useTheme()

  const [mode, setMode] = useState('historical')
  const [view, setView] = useState('monthly')
  const [monthsBack, setMonthsBack] = useState(60)
  // Unified scope across Historical, Projection, and Price Impact
  const [categories, setCategories] = useState([])     // selected category IDs (strings)
  const [subcategories, setSubcategories] = useState([]) // selected sub-category IDs (strings)
  const [catOpen, setCatOpen] = useState(false)
  const [scopeTicker, setScopeTicker] = useState('')   // '' = whole portfolio
  const [decompCumulative, setDecompCumulative] = useState(true)

  // Projection / Price Impact controls
  const [years, setYears] = useState(5)
  const [marketType, setMarketType] = useState('neutral')
  const [reinvestPct, setReinvestPct] = useState(100)
  const [monthlyContribution, setMonthlyContribution] = useState(0)
  const [allCategories, setAllCategories] = useState([])
  const [priceShockPct, setPriceShockPct] = useState(0)

  const [data, setData] = useState(null)
  const [projScenarios, setProjScenarios] = useState(null)
  // Each tab keeps its own request state, so a slow Historical load never
  // hides Price Impact or ends the Projection spinner early.
  const [histLoading, setHistLoading] = useState(false)
  const [histError, setHistError] = useState(null)
  const [projLoading, setProjLoading] = useState(false)
  const [projError, setProjError] = useState(null)
  const catRef = useRef(null)
  const reqIdRef = useRef(0)
  const projReqIdRef = useRef(0)
  const seededScopeKeyRef = useRef(null)

  // Source: the selected portfolio (default) or a Portfolio Builder model saved in any account.
  const [useModel, setUseModelState] = useState(() => {
    try { return sessionStorage.getItem(USE_MODEL_KEY) === '1' } catch { return false }
  })
  const [modelId, setModelIdState] = useState(() => {
    try { return Number(localStorage.getItem(MODEL_ID_KEY)) || null } catch { return null }
  })
  const setUseModel = value => {
    setUseModelState(value)
    try { sessionStorage.setItem(USE_MODEL_KEY, value ? '1' : '0') } catch { /* private mode */ }
  }
  const setModelId = value => {
    setModelIdState(value)
    try { localStorage.setItem(MODEL_ID_KEY, String(value)) } catch { /* private mode */ }
  }
  const [modelsState, setModelsState] = useState(null)
  useEffect(() => {
    let stale = false
    pf('/api/builder/portfolios')
      .then(r => r.json())
      .then(d => { if (!stale) setModelsState({ key: profileQueryString, list: Array.isArray(d?.portfolios) ? d.portfolios : [] }) })
      .catch(() => { if (!stale) setModelsState({ key: profileQueryString, list: [] }) })
    return () => { stale = true }
  }, [pf, profileQueryString])
  const models = modelsState?.key === profileQueryString ? modelsState.list : null
  const activeModel = useModel && models?.length ? (models.find(m => m.id === modelId) || models[0]) : null
  const builderId = activeModel?.id ?? null
  // Wait for the model list before loading, so a remembered model does not first load the portfolio.
  const sourceReady = !useModel || models != null
  const sourceKey = `${profileQueryString}|${builderId ? `model:${builderId}` : 'own'}`

  // Category ids belong to the selected portfolio, and a scoped ticker may not
  // exist in the next portfolio or model: drop a scope that no longer applies.
  const [scopeSource, setScopeSource] = useState(sourceKey)
  if (scopeSource !== sourceKey) {
    if (scopeSource.split('|')[0] !== profileQueryString) {
      setCategories([])
      setSubcategories([])
    }
    setScopeTicker('')
    setScopeSource(sourceKey)
  }

  useEffect(() => {
    const handler = e => {
      if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    let stale = false
    pf('/api/categories/data')
      .then(r => r.json())
      .then(d => { if (!stale) setAllCategories((d.categories || []).sort((a, b) => a.name.localeCompare(b.name))) })
      .catch(() => { if (!stale) setAllCategories([]) })
    return () => { stale = true }
  }, [pf, selection])

  useEffect(() => {
    if (view === 'monthly') setMonthsBack(60)
    else if (view === 'weekly') setMonthsBack(12)
    else setMonthsBack(60)
  }, [view])

  // Holdings for the active source, keyed so a slow response for a previous
  // portfolio or model is never shown for the current one.
  const [holdingsState, setHoldingsState] = useState(null)
  useEffect(() => {
    if (!sourceReady) return undefined
    let stale = false
    const key = sourceKey
    const path = builderId ? `/api/portfolio-distributions/model-holdings?builder_id=${builderId}` : '/api/holdings'
    pf(path)
      .then(r => r.json())
      .then(body => {
        if (stale) return
        if (builderId) {
          if (!body || !Array.isArray(body.rows)) throw new Error(body?.error || STALE_BACKEND_MESSAGE)
          setHoldingsState({ key, rows: body.rows.map(modelHoldingRow).filter(usableHolding), model: body.model || null, error: null })
        } else {
          setHoldingsState({ key, rows: (Array.isArray(body) ? body : []).filter(usableHolding), model: null, error: null })
        }
      })
      .catch(e => {
        if (!stale) setHoldingsState({ key, rows: [], model: null, error: builderId ? (e.message || STALE_BACKEND_MESSAGE) : null })
      })
    return () => { stale = true }
  }, [pf, selection, sourceKey, builderId, sourceReady])
  const holdingsReady = holdingsState?.key === sourceKey
  const holdings = useMemo(() => (holdingsReady ? holdingsState.rows : []), [holdingsReady, holdingsState])
  const modelMeta = holdingsReady ? holdingsState.model : null
  const holdingsError = holdingsReady ? holdingsState.error : null

  const categoryOptions = useMemo(
    () => (allCategories.length ? allCategories : (data?.categories || [])),
    [allCategories, data]
  )

  const selectedCategoryNames = useMemo(() => {
    if (!categories.length) return []
    return categoryOptions
      .filter(c => categories.includes(String(c.id)))
      .map(c => c.name)
  }, [categories, categoryOptions])

  // Scoped open holdings (shared by header stats, Projection, and Price Impact).
  // A ticker scope replaces the category filter, as it does for Historical.
  const scopedHoldings = useMemo(() => {
    if (scopeTicker) return holdings.filter(h => h.ticker === scopeTicker)
    if (!categories.length && !subcategories.length) return holdings
    return holdings.filter(h => selectedCategoryNames.includes(String(h.category))
      || holdingInSubcategories(h, subcategories))
  }, [holdings, scopeTicker, categories.length, subcategories, selectedCategoryNames])

  // Forward income & reinvestment metrics for the active scope — matches Dashboard exactly
  const scopeForwardStats = useMemo(() => {
    const estAnnual = scopedHoldings.reduce((sum, h) => sum + (Number(h.estim_payment_per_year) || 0), 0)
    const estMonthly = scopedHoldings.reduce((sum, h) => sum + (Number(h.approx_monthly_income) || 0), 0)
    const estMonthlyReinv = scopedHoldings.reduce((sum, h) => sum + (Number(h.monthly_income_reinvested) || 0), 0)
    const estMonthlyCash = Math.max(0, estMonthly - estMonthlyReinv)
    const pct = estMonthly > 0 ? (estMonthlyReinv / estMonthly) * 100 : null
    return {
      estAnnual,
      estMonthly,
      estMonthlyReinv,
      estMonthlyCash,
      reinvestPct: pct,
    }
  }, [scopedHoldings])

  // Trailing 3 completed months actual reinvested % for the active scope. Keyed
  // so a slow answer for a previous scope is never shown; a model has no records.
  const scopeSeedKey = `${sourceKey}|${scopeTicker}|${categories.join(',')}|${subcategories.join(',')}`
  const [actualState, setActualState] = useState(null)
  useEffect(() => {
    if (builderId || !sourceReady) return undefined
    let stale = false
    const key = scopeSeedKey
    const params = new URLSearchParams({ months: 3 })
    if (scopeTicker) params.set('ticker', scopeTicker)
    else {
      if (categories.length) params.set('category', categories.join(','))
      if (subcategories.length) params.set('subcategory', subcategories.join(','))
    }
    pf(`/api/reinvestment-actual-pct?${params}`)
      .then(r => r.json())
      .then(d => { if (!stale) setActualState({ key, data: d && d.pct_reinvested != null ? d : null }) })
      .catch(() => { if (!stale) setActualState({ key, data: null }) })
    return () => { stale = true }
  }, [pf, scopeSeedKey, builderId, sourceReady, scopeTicker, categories, subcategories])
  const actualReinvest = !builderId && actualState?.key === scopeSeedKey ? actualState.data : null

  // Seed Reinvest % when portfolio, model or scope changes so switching to one fund seeds that fund's real DRIP mix
  useEffect(() => {
    if (scopeForwardStats.reinvestPct != null && seededScopeKeyRef.current !== scopeSeedKey) {
      setReinvestPct(Math.round(scopeForwardStats.reinvestPct * 10) / 10)
      seededScopeKeyRef.current = scopeSeedKey
    }
  }, [scopeForwardStats.reinvestPct, scopeSeedKey])

  // ── Historical fetch ──────────────────────────────────────────────────────
  const fetchHistorical = useCallback(() => {
    const myId = ++reqIdRef.current
    setHistLoading(true)
    setHistError(null)
    const params = new URLSearchParams({ view, months_back: monthsBack })
    if (!scopeTicker) {
      if (categories.length) params.set('category', categories.join(','))
      if (subcategories.length) params.set('subcategory', subcategories.join(','))
    }
    if (scopeTicker) params.set('ticker', scopeTicker)
    if (builderId) params.set('builder_id', builderId)
    pf(`/api/reinvestment-impact/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (myId !== reqIdRef.current) return
        if (d.error) throw new Error(d.error)
        // A backend from before model support ignores builder_id and returns the portfolio's own records.
        if (builderId && !d.model) throw new Error(STALE_BACKEND_MESSAGE)
        setData(d)
      })
      .catch(e => {
        if (myId !== reqIdRef.current) return
        // Never leave the previous scope's charts under the new scope's title.
        setData(null)
        setHistError(e.message)
      })
      .finally(() => { if (myId === reqIdRef.current) setHistLoading(false) })
  }, [view, monthsBack, categories, subcategories, scopeTicker, builderId, pf])

  // ── Projection fetch ──────────────────────────────────────────────────────
  const fetchProjection = useCallback(() => {
    const myId = ++projReqIdRef.current
    const override = scopedHoldings.map(h => ({
      ticker: h.ticker,
      shares: h.quantity,
      price: h.current_price,
      div_per_share: h.div || 0,
      estim_payment_per_year: h.estim_payment_per_year || 0,
      freq_str: h.div_frequency || 'Q',
      description: (h.description || '').substring(0, 40),
      reinvest: reinvestPct > 0,
    }))
    if (override.length === 0) {
      // Nothing to simulate (empty scope, or a portfolio/model with no priced
      // holdings): clear the last result instead of showing another scope's.
      setProjScenarios(null)
      setProjError(null)
      setProjLoading(false)
      return
    }
    setProjLoading(true)
    setProjError(null)
    const run = (mt) => {
      const payload = {
        years,
        market_type: mt,
        monthly_contribution: monthlyContribution,
        reinvest_pct: reinvestPct,
        monte_carlo: false,
        holdings_override: override,
      }
      return pf('/api/analytics/income-growth-sim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json())
    }
    Promise.all([run('bullish'), run('neutral'), run('bearish')])
      .then(([bullish, neutral, bearish]) => {
        if (myId !== projReqIdRef.current) return
        const err = [bullish, neutral, bearish].find(d => d && d.error)
        if (err) throw new Error(err.error)
        setProjScenarios({ bullish, neutral, bearish })
      })
      .catch(e => {
        if (myId !== projReqIdRef.current) return
        setProjScenarios(null)
        setProjError(e.message)
      })
      .finally(() => { if (myId === projReqIdRef.current) setProjLoading(false) })
  }, [scopedHoldings, years, monthlyContribution, reinvestPct, pf])

  useEffect(() => {
    if (mode === 'historical' && sourceReady) fetchHistorical()
  }, [mode, fetchHistorical, sourceReady])

  useEffect(() => {
    if (mode === 'projection' && holdingsReady) fetchProjection()
  }, [mode, fetchProjection, holdingsReady])

  const loading = mode === 'historical'
    ? (histLoading || !sourceReady)
    : (!holdingsReady || (mode === 'projection' && projLoading))
  const error = mode === 'historical'
    ? histError
    : (holdingsError || (mode === 'projection' ? projError : null))
  const isModel = Boolean(builderId)

  // ── Historical chart data ──────────────────────────────────────────────────
  const s = data?.series
  const partialArr = useMemo(() => s?.partial_periods || [], [s])
  const xText = useMemo(
    () => (s?.labels || []).map((k, i) => labelFor(k, view, Boolean(partialArr[i]))),
    [s, view, partialArr]
  )
  const xAxis = useMemo(() => {
    const n = xText.length
    const step = Math.max(1, Math.ceil(n / 14))
    const tickvals = xText.filter((_, i) => i % step === 0)
    if (n > 1 && tickvals[tickvals.length - 1] !== xText[n - 1]) {
      tickvals.push(xText[n - 1])
    }
    return {
      type: 'category', categoryorder: 'array', categoryarray: xText,
      tickmode: 'array', tickvals, ticktext: tickvals,
      tickangle: view === 'monthly' && n <= 14 ? 0 : -45,
      gridcolor: '#1c2a4b',
    }
  }, [xText, view])

  const distTraces = useMemo(() => {
    if (!s) return []
    const colors = (s.payout_source || []).map((src, i) => {
      if (partialArr[i]) return src === 'reconstructed' ? 'rgba(56, 189, 248, 0.48)' : 'rgba(77, 255, 145, 0.48)'
      if (src === 'reconstructed') return '#38bdf8'
      if (src === 'mixed') return '#2dd4bf'
      return '#4dff91'
    })
    const borderWidths = partialArr.map(p => (p ? 1.5 : 0))
    const custom = (s.payout || []).map((p, i) => [
      s.reinvested_amount?.[i] ?? 0,
      s.cash_amount?.[i] ?? 0,
      s.income_from_drip?.[i] ?? 0,
      partialArr[i] ? ' (in progress)' : '',
    ])
    const traces = [{
      x: xText,
      y: s.payout,
      customdata: custom,
      type: 'bar',
      marker: {
        color: colors,
        line: { color: '#4dff91', width: borderWidths },
      },
      hovertemplate:
        '<b>%{x}</b>%{customdata[3]}<br>' +
        'Total distributions: <b>$%{y:,.2f}</b><br>' +
        'Reinvested (DRIP): $%{customdata[0]:,.2f}<br>' +
        'Taken as cash: $%{customdata[1]:,.2f}<br>' +
        'Earned from prior DRIP shares: +$%{customdata[2]:,.2f}<extra></extra>',
      name: 'Distributions paid',
    }]

    const dripInc = s.income_from_drip || []
    const nodrip = s.payout_nodrip || []
    if (nodrip.length === s.payout.length && dripInc.some(b => b > 0.005)) {
      traces.push({
        x: xText,
        y: nodrip,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#94a3b8', width: 2, dash: 'dot' },
        hovertemplate: '<b>%{x}</b><br>If never reinvested (0% DRIP): <b>$%{y:,.2f}</b><extra></extra>',
        name: 'If never reinvested (0% DRIP)',
      })
    }

    let runTotal = 0
    const cum = (s.payout || []).map(v => { runTotal += (v || 0); return Math.round(runTotal * 100) / 100 })
    traces.push({
      x: xText,
      y: cum,
      type: 'scatter',
      mode: 'lines',
      yaxis: 'y2',
      line: { color: '#f59e0b', width: 2 },
      hovertemplate: '<b>%{x}</b><br>Cumulative received: <b>$%{y:,.2f}</b><extra></extra>',
      name: 'Cumulative received',
    })
    return traces
  }, [s, xText, partialArr])

  const shareTraces = useMemo(() => {
    if (!s) return []
    return [
      {
        x: xText, y: s.drip_shares_added, type: 'bar',
        marker: { color: '#a855f7' }, name: 'DRIP shares bought',
        hovertemplate: '<b>%{x}</b><br>+%{y:,.4f} DRIP shares bought<extra></extra>',
      },
      {
        x: xText, y: s.drip_shares_cumulative, type: 'scatter', mode: 'lines',
        line: { color: '#f59e0b', width: 2 }, yaxis: 'y2', name: 'Cumulative DRIP shares bought',
        hovertemplate: '<b>%{x}</b><br>%{y:,.4f} cumulative DRIP shares<extra></extra>',
      },
    ]
  }, [s, xText])

  const rateTraces = useMemo(() => {
    if (!scopeTicker || !s) return []
    const t = (data?.per_ticker || []).find(x => x.ticker === scopeTicker)
    if (!t?.dps?.length) return []
    const byLabel = {}
    const cntByLabel = {}
    t.labels.forEach((k, i) => {
      byLabel[k] = t.dps[i]
      cntByLabel[k] = t.payment_counts?.[i] ?? 1
    })
    const y = (s.labels || []).map(k => (k in byLabel ? byLabel[k] : null))
    const counts = (s.labels || []).map(k => cntByLabel[k] || 1)
    return [{
      x: xText,
      y,
      customdata: counts,
      type: 'scatter',
      mode: 'lines+markers',
      connectgaps: true,
      line: { color: '#38bdf8', width: 2 },
      marker: { size: 5, color: '#38bdf8' },
      hovertemplate: '<b>%{x}</b><br>$%{y:,.4f} / share (%{customdata} payment(s))<extra></extra>',
      name: 'Distribution / share',
    }]
  }, [scopeTicker, s, xText, data])

  const decompTraces = useMemo(() => {
    if (!s?.decomp) return []
    const d = s.decomp
    const runningSum = (arr) => {
      let run = 0
      return (arr || []).map(v => { run += (v || 0); return Math.round(run * 100) / 100 })
    }
    const shares = decompCumulative ? runningSum(d.shares) : (d.shares || [])
    const trades = decompCumulative ? runningSum(d.trades) : (d.trades || [])
    const rate = decompCumulative ? runningSum(d.rate) : (d.rate || [])
    const price = decompCumulative ? runningSum(d.price) : (d.price || [])
    const mk = (y, name, color) => ({
      x: xText, y, type: 'bar', name,
      marker: { color }, hovertemplate: `<b>%{x}</b><br>${name}: <b>$%{y:+,.2f}</b><extra></extra>`,
    })
    const out = [mk(shares, 'DRIP share growth', '#4dff91')]
    if ((d.trades || []).some(v => Math.abs(v) > 0.01)) {
      out.push(mk(trades, 'Cash buys / sells & new lots', '#a855f7'))
    }
    out.push(mk(rate, 'Fund payout rate changes', '#38bdf8'))
    if ((d.price || []).some(v => Math.abs(v) > 0.5)) {
      out.push(mk(price, 'Combined share × rate effect', '#f59e0b'))
    }
    return out
  }, [s, xText, decompCumulative])

  // ── Projection chart data ──────────────────────────────────────────────────
  const projData = projScenarios ? projScenarios[marketType] : null
  const seriesKey = years <= 5 ? 'monthly_series' : 'annual_series'
  const projSeries = projData ? projData[seriesKey] : []

  const projBaselineEndAnnual = useMemo(() => {
    const ann = projData?.annual_series || []
    if (!ann.length) return null
    return ann[ann.length - 1]?.income_from_existing ?? null
  }, [projData])

  const projTraces = useMemo(() => {
    if (!projSeries?.length) return []
    const color = SCENARIO_COLORS[marketType]
    const periodUnit = years <= 5 ? '/mo' : '/yr'
    const traces = [{
      x: projSeries.map(p => p.label),
      y: projSeries.map(p => p.total_income),
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      fillcolor: color + '22',
      line: { color, width: 2.5 },
      hovertemplate: `<b>%{x}</b><br>With reinvesting: <b>$%{y:,.0f}${periodUnit}</b><extra></extra>`,
      name: `With ${reinvestPct}% reinvested${monthlyContribution > 0 ? ` + ${fmt$(monthlyContribution)}/mo` : ''}`,
    }]
    if (projSeries.some(p => p.income_from_existing != null)) {
      traces.push({
        x: projSeries.map(p => p.label),
        y: projSeries.map(p => p.income_from_existing),
        type: 'scatter',
        mode: 'lines',
        line: { color: '#94a3b8', width: 2, dash: 'dash' },
        hovertemplate: `<b>%{x}</b><br>Without reinvesting (0% DRIP): <b>$%{y:,.0f}${periodUnit}</b><extra></extra>`,
        name: 'Without reinvesting (0% DRIP, $0 add)',
      })
    }
    return traces
  }, [projSeries, marketType, years, reinvestPct, monthlyContribution])

  const shareGrowthTraces = useMemo(() => {
    if (!projScenarios) return []
    return ['bullish', 'neutral', 'bearish'].map(mt => {
      const ser = projScenarios[mt]?.[seriesKey] || []
      return {
        x: ser.map(p => p.label),
        y: ser.map(p => p.total_shares),
        type: 'scatter', mode: 'lines',
        line: { color: SCENARIO_COLORS[mt], width: 2 },
        name: mt.charAt(0).toUpperCase() + mt.slice(1),
        hovertemplate: `<b>%{x}</b><br>${mt}: %{y:,.2f} sh<extra></extra>`,
      }
    })
  }, [projScenarios, seriesKey])

  const priceImpact = useMemo(() => projectPriceImpact(scopedHoldings, {
    years,
    shockPct: priceShockPct,
    reinvestPct,
    monthlyContribution,
  }), [scopedHoldings, years, priceShockPct, reinvestPct, monthlyContribution])

  const priceSensitivity = useMemo(() => PRICE_SENSITIVITY_POINTS.map(pct => {
    const result = projectPriceImpact(scopedHoldings, {
      years,
      shockPct: pct,
      reinvestPct,
      monthlyContribution,
    })
    return {
      pct,
      currentAnnual: result.adjustedCurrentAnnualIncome,
      currentMonthly: result.adjustedCurrentMonthlyIncome,
      annual: result.projectedAnnualIncome,
      monthly: result.projectedMonthlyIncome,
      value: result.adjustedValue,
    }
  }), [scopedHoldings, years, reinvestPct, monthlyContribution])

  const currentIncomeSensitivityTraces = useMemo(() => {
    if (!priceSensitivity.length) return []
    return [
      {
        x: priceSensitivity.map(p => p.pct),
        y: priceSensitivity.map(p => p.currentMonthly),
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#38bdf8', width: 2 },
        marker: { size: 5, color: '#38bdf8' },
        name: 'Immediate monthly income',
        hovertemplate: '%{x:+.0f}% price<br>$%{y:,.0f} monthly<extra></extra>',
      },
      {
        x: priceSensitivity.map(p => p.pct),
        y: priceSensitivity.map(p => p.currentAnnual),
        type: 'scatter',
        mode: 'lines+markers',
        yaxis: 'y2',
        line: { color: '#4dff91', width: 2 },
        marker: { size: 5, color: '#4dff91' },
        name: 'Immediate annual income',
        hovertemplate: '%{x:+.0f}% price<br>$%{y:,.0f} annual<extra></extra>',
      },
      {
        x: [priceShockPct, priceShockPct],
        y: [0, Math.max(...priceSensitivity.map(p => p.currentMonthly), 1)],
        type: 'scatter',
        mode: 'lines',
        line: { color: '#f59e0b', width: 1.5, dash: 'dot' },
        name: 'Selected price shock',
        hoverinfo: 'skip',
      },
    ]
  }, [priceSensitivity, priceShockPct])

  const priceSensitivityTraces = useMemo(() => {
    if (!priceSensitivity.length) return []
    return [
      {
        x: priceSensitivity.map(p => p.pct),
        y: priceSensitivity.map(p => p.annual),
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#4dff91', width: 2 },
        marker: { size: 5, color: '#4dff91' },
        name: `Projected annual in ${years}yr (${reinvestPct}% DRIP)`,
        hovertemplate: '%{x:+.0f}% price<br>$%{y:,.0f} projected annual<extra></extra>',
      },
      {
        x: priceSensitivity.map(p => p.pct),
        y: priceSensitivity.map(p => p.currentAnnual),
        type: 'scatter',
        mode: 'lines',
        line: { color: '#94a3b8', width: 1.5, dash: 'dash' },
        name: 'Immediate annual payout (0% DRIP)',
        hovertemplate: '%{x:+.0f}% price<br>$%{y:,.0f} immediate annual<extra></extra>',
      },
      {
        x: [priceShockPct, priceShockPct],
        y: [0, Math.max(...priceSensitivity.map(p => p.annual), 1)],
        type: 'scatter',
        mode: 'lines',
        line: { color: '#f59e0b', width: 1.5, dash: 'dot' },
        name: 'Selected price shock',
        hoverinfo: 'skip',
      },
    ]
  }, [priceSensitivity, priceShockPct, years, reinvestPct])

  const priceMonthlyTraces = useMemo(() => {
    const series = priceImpact.monthlySeries || []
    if (!series.length) return []
    const traces = [{
      x: series.map(p => p.label),
      y: series.map(p => p.total_income),
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      fillcolor: '#38bdf822',
      line: { color: '#38bdf8', width: 2.5 },
      name: `With ${reinvestPct}% reinvested`,
      hovertemplate: '<b>%{x}</b><br>With reinvesting: <b>$%{y:,.0f}/mo</b><extra></extra>',
    }]
    if (series.some(p => p.income_without_reinvest != null)) {
      traces.push({
        x: series.map(p => p.label),
        y: series.map(p => p.income_without_reinvest),
        type: 'scatter',
        mode: 'lines',
        line: { color: '#94a3b8', width: 1.8, dash: 'dash' },
        name: 'Without reinvesting (0% DRIP)',
        hovertemplate: '<b>%{x}</b><br>0% DRIP baseline: <b>$%{y:,.0f}/mo</b><extra></extra>',
      })
    }
    return traces
  }, [priceImpact, reinvestPct])

  const priceHoldingRows = useMemo(() => (priceImpact.holdings || []).slice(0, 12), [priceImpact])

  const rangeOptions = view === 'monthly' ? MONTHLY_RANGE : view === 'weekly' ? WEEKLY_RANGE : YEARLY_RANGE
  const hasData = s && s.labels.length > 0
  const activeModeMeta = MODE_OPTIONS.find(m => m.value === mode) || MODE_OPTIONS[0]
  const scopedTickerHistRow = useMemo(
    () => (scopeTicker ? (data?.per_ticker || []).find(t => t.ticker === scopeTicker) : null),
    [scopeTicker, data]
  )
  const scopeTitle = scopeTicker
    ? scopeTicker
    : (categories.length + subcategories.length > 0
      ? `${categories.length + subcategories.length} Category Filter(s)`
      : (isModel ? `${activeModel.name} model` : 'Whole Portfolio'))

  return (
    <div className="page dashboard">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.2rem' }}>Reinvestment Impact</h1>
          <p style={{ color: 'var(--text-dim)', margin: 0, fontSize: '0.9rem' }}>
            Track how DRIP share purchases grow your distributions and project future compounding — aligned directly with your Dashboard income metrics.
          </p>
        </div>
        {(scopeTicker || categories.length > 0 || subcategories.length > 0) && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.35rem 0.7rem', borderRadius: '999px',
            background: 'rgba(56, 189, 248, 0.14)', border: '1px solid rgba(56, 189, 248, 0.45)',
            fontSize: '0.82rem', color: 'var(--p-c5d0dc)',
          }}>
            <span>Scoped to <strong style={{ color: '#38bdf8' }}>{scopeTitle}</strong></span>
            <button
              type="button"
              onClick={() => { setScopeTicker(''); setCategories([]); setSubcategories([]) }}
              style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontWeight: 700, padding: '0 0.15rem', fontSize: '0.85rem' }}
              title="Reset to Whole Portfolio"
            >
              ✕ Whole Portfolio
            </button>
          </div>
        )}
      </div>

      {/* Source: the selected portfolio or a Portfolio Builder model (any account's) */}
      <div role="group" aria-label="Portfolio to analyze" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem 1rem', margin: '0.35rem 0 0.75rem', fontSize: '0.85rem', color: 'var(--p-c5d0dc)' }}>
        <label title={HELP.sourcePicker} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', cursor: models?.length ? 'pointer' : 'default' }}>
          <input type="checkbox" checked={Boolean(activeModel)} disabled={!models?.length} onChange={e => setUseModel(e.target.checked)} />
          <span>Use a Portfolio Builder model{activeModel ? '' : <> instead of <strong>{currentProfileName}</strong></>}</span>
          <span aria-hidden="true" style={{ opacity: 0.8 }}>ⓘ</span>
        </label>
        {useModel && models?.length > 0 && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            Model
            <BuilderModelSelect
              aria-label="Portfolio Builder model"
              models={models}
              value={activeModel?.id}
              onChange={setModelId}
              style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }}
            />
          </label>
        )}
        {activeModel?.account_name && <span style={{ color: 'var(--text-dim)' }}>Saved in {activeModel.account_name}</span>}
        {models != null && !models.length && (
          <span style={{ color: 'var(--text-dim)' }}>No Portfolio Builder models yet. <Link to="/portfolio-builder" style={{ color: 'var(--accent-bright)' }}>Build one</Link> to use it here.</span>
        )}
      </div>

      {isModel && (
        <div role="note" style={{
          padding: '0.6rem 0.85rem', marginBottom: '0.9rem', borderRadius: '6px', fontSize: '0.84rem', lineHeight: 1.45,
          color: 'var(--p-c5d0dc)', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.35)', borderLeft: '3px solid #38bdf8',
        }}>
          <strong>Using the {activeModel.name} model.</strong>{' '}
          Its history is modeled, not received: each fund&apos;s actual past distributions on the shares this model buys today
          {modelMeta?.invested != null ? ` (${fmt$(modelMeta.invested)} at the ${modelMeta.price_date || 'latest'} closes)` : ''}, with every payment
          reinvested at that day&apos;s close from the start of the window. Projection and Price Impact start from the model&apos;s estimated income.
          {mode === 'historical' && data?.model?.late_starters?.length > 0 && (
            <> {data.model.late_starters.map(l => l.ticker).join(', ')} started trading after the window began, so {data.model.late_starters.length === 1 ? 'it pays' : 'they pay'} only part of it.</>
          )}
          {modelMeta?.unavailable?.length > 0 && (
            <> No market history could be loaded for {modelMeta.unavailable.join(', ')}, so {modelMeta.unavailable.length === 1 ? 'it is' : 'they are'} left out.</>
          )}
          {' '}Edit the model in <Link to="/portfolio-builder" style={{ color: 'var(--accent-bright)' }}>Portfolio Builder</Link>.
        </div>
      )}

      {/* Scope-aware DRIP status bar matching Dashboard */}
      {scopeForwardStats.reinvestPct != null && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem 1.25rem',
          padding: '0.55rem 0.85rem', marginBottom: '0.9rem', borderRadius: '6px',
          background: 'rgba(15, 23, 42, 0.4)', border: '1px solid var(--p-1f2f4d)',
          fontSize: '0.84rem', color: 'var(--p-c5d0dc)',
        }}>
          {isModel ? (
            <span>
              <strong style={{ color: 'var(--text-strong)' }}>{scopeTitle} model income:</strong>{' '}
              {fmt$(scopeForwardStats.estMonthly)}/mo · {fmt$(scopeForwardStats.estAnnual)}/yr est., modeled as if every distribution is reinvested
            </span>
          ) : (
            <span>
              <strong style={{ color: 'var(--text-strong)' }}>{scopeTitle} DRIP setting:</strong>{' '}
              reinvesting <strong style={{ color: 'var(--pos-muted)' }}>{scopeForwardStats.reinvestPct.toFixed(1)}%</strong> of estimated income
              {' '}({fmt$(scopeForwardStats.estMonthlyReinv)}/mo DRIP · {fmt$(scopeForwardStats.estMonthlyCash)}/mo cash · {fmt$(scopeForwardStats.estAnnual)}/yr est.)
            </span>
          )}
          {scopedTickerHistRow && scopedTickerHistRow.accounts_total > 1 && (
            <span style={{ color: 'var(--text-dim)' }}>
              ({scopedTickerHistRow.accounts_reinvest_on} of {scopedTickerHistRow.accounts_total} accounts have DRIP on)
            </span>
          )}
          {actualReinvest && (
            <span style={{ color: 'var(--text-dim)' }}>
              Last 3 full mo actual: <strong style={{ color: '#38bdf8' }}>{actualReinvest.pct_reinvested.toFixed(1)}%</strong> reinvested ({fmt$(actualReinvest.reinvested)} of {fmt$(actualReinvest.total)})
            </span>
          )}
        </div>
      )}

      {/* Mode toggle + plain-English explanation of active tab */}
      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: '0.45rem' }}>
          {MODE_OPTIONS.map((opt, i) => (
            <button
              key={opt.value}
              className={`btn${mode === opt.value ? ' btn-active' : ' btn-secondary'}`}
              style={{
                borderRadius: i === 0 ? '6px 0 0 6px' : i === MODE_OPTIONS.length - 1 ? '0 6px 6px 0' : '0',
                padding: '0.45rem 1.1rem',
              }}
              onClick={() => setMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          {activeModeMeta.desc}
        </p>
      </div>

      {/* Unified Controls */}
      <div className="growth-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div className="growth-filter-group">
          <label>Scope</label>
          <select
            value={scopeTicker}
            onChange={e => setScopeTicker(e.target.value)}
            style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px', minWidth: '165px' }}
          >
            <option value="">{isModel ? 'Whole Model' : 'Whole Portfolio'}</option>
            {holdings.map(h => <option key={h.ticker} value={h.ticker}>{h.ticker}</option>)}
            {/* A sold fund picked from the tables has no open holding, but is still the scope. */}
            {scopeTicker && holdingsReady && !holdings.some(h => h.ticker === scopeTicker) && (
              <option value={scopeTicker}>{scopeTicker} (closed)</option>
            )}
          </select>
        </div>

        {categoryOptions.length > 0 && !scopeTicker && (
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
            <label>Categories</label>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
              onClick={() => setCatOpen(o => !o)}
            >
              {categories.length === 0 && subcategories.length === 0
                ? 'All Holdings'
                : `${categories.length + subcategories.length} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '▴' : '▾'}</span>
            </button>
            {catOpen && (
              <div className="growth-cat-dropdown">
                <label className="growth-cat-option" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                  <input
                    type="checkbox"
                    checked={categories.length === 0 && subcategories.length === 0}
                    onChange={() => { setCategories([]); setSubcategories([]) }}
                  />
                  <span>All Holdings</span>
                </label>
                {categoryOptions.map(c => {
                  const catChecked = categories.includes(String(c.id))
                  const subs = c.subcategories || []
                  return (
                    <React.Fragment key={c.id}>
                      <label className="growth-cat-option">
                        <input
                          type="checkbox"
                          checked={catChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              const subIds = subs.map(sc => String(sc.id))
                              setCategories(prev => [...prev, String(c.id)])
                              setSubcategories(prev => prev.filter(id => !subIds.includes(id)))
                            } else {
                              setCategories(prev => prev.filter(id => id !== String(c.id)))
                            }
                          }}
                        />
                        <span>{c.name}</span>
                      </label>
                      {subs.map(sc => (
                        <label
                          key={`sub-${sc.id}`}
                          className="growth-cat-option"
                          style={{ paddingLeft: `${1.4 + (Number(sc.depth) || 0) * 1.1}rem`, opacity: catChecked ? 0.5 : 1 }}
                        >
                          <input
                            type="checkbox"
                            disabled={catChecked}
                            checked={catChecked || subcategories.includes(String(sc.id))}
                            onChange={e => {
                              if (e.target.checked) setSubcategories(prev => [...prev, String(sc.id)])
                              else setSubcategories(prev => prev.filter(id => id !== String(sc.id)))
                            }}
                          />
                          <span>{sc.name}</span>
                        </label>
                      ))}
                    </React.Fragment>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {mode === 'historical' && (
          <>
            <div className="growth-filter-group">
              <label>Granularity</label>
              <div style={{ display: 'flex' }}>
                {VIEW_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`btn btn-sm${view === opt.value ? ' btn-active' : ''}`}
                    style={{ borderRadius: opt.value === 'yearly' ? '4px 0 0 4px' : opt.value === 'weekly' ? '0 4px 4px 0' : '0', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                    onClick={() => setView(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="growth-filter-group">
              <label>Window</label>
              <select
                value={monthsBack}
                onChange={e => setMonthsBack(Number(e.target.value))}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }}
              >
                {rangeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </>
        )}

        {(mode === 'projection' || mode === 'priceImpact') && (
          <>
            <div className="growth-filter-group">
              <label>Horizon</label>
              <div style={{ display: 'flex' }}>
                {YEAR_PRESETS.map((p, i) => (
                  <button
                    key={p.v}
                    className={`btn btn-sm${years === p.v ? ' btn-active' : ''}`}
                    style={{ borderRadius: i === 0 ? '4px 0 0 4px' : i === YEAR_PRESETS.length - 1 ? '0 4px 4px 0' : '0', padding: '0.35rem 0.7rem', fontSize: '0.85rem' }}
                    onClick={() => setYears(p.v)}
                  >
                    {p.l}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'projection' && (
              <div className="growth-filter-group">
                <label>Market Scenario</label>
                <select
                  value={marketType}
                  onChange={e => setMarketType(e.target.value)}
                  style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }}
                >
                  {MARKET_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            )}

            {mode === 'priceImpact' && (
              <div className="growth-filter-group" style={{ minWidth: '270px', flex: '1 1 320px' }}>
                <label>Price Change</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <input
                    type="range"
                    min="-60"
                    max="100"
                    step="1"
                    value={priceShockPct}
                    onChange={e => setPriceShockPct(Number(e.target.value))}
                    style={{ width: '100%' }}
                    aria-label="Portfolio price change"
                  />
                  <input
                    type="number"
                    min="-60"
                    max="100"
                    value={priceShockPct}
                    onChange={e => setPriceShockPct(Math.max(-60, Math.min(100, Number(e.target.value) || 0)))}
                    style={{ width: '76px', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }}
                  />
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>%</span>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                  {PRICE_SHOCK_PRESETS.map(pct => (
                    <button
                      key={pct}
                      type="button"
                      className={`btn btn-sm${priceShockPct === pct ? ' btn-active' : ''}`}
                      onClick={() => setPriceShockPct(pct)}
                      style={{ padding: '0.18rem 0.45rem', fontSize: '0.72rem' }}
                    >
                      {pct > 0 ? `+${pct}%` : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="growth-filter-group">
              <label>Reinvest %</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={reinvestPct}
                onChange={e => setReinvestPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                style={{ width: '84px', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }}
              />
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {scopeForwardStats.reinvestPct != null && (
                  <span
                    onClick={() => setReinvestPct(Math.round(scopeForwardStats.reinvestPct * 10) / 10)}
                    title={isModel
                      ? 'A Builder model has no DRIP settings: it is modeled as if every distribution is reinvested'
                      : 'Use your current DRIP setting (matches Dashboard Est. % Reinvested)'}
                    style={{ cursor: 'pointer', textDecoration: 'underline dotted', color: 'var(--pos-muted)' }}
                  >
                    {isModel ? 'Model' : 'Setting'}: {scopeForwardStats.reinvestPct.toFixed(1)}%
                  </span>
                )}
                {actualReinvest && (
                  <span
                    onClick={() => setReinvestPct(Math.round(actualReinvest.pct_reinvested * 10) / 10)}
                    title={`Actual reinvested share paid ${actualReinvest.window_start} to ${actualReinvest.window_end}. Click to use.`}
                    style={{ cursor: 'pointer', textDecoration: 'underline dotted', color: 'var(--p-38bdf8)' }}
                  >
                    Actual 3mo: {actualReinvest.pct_reinvested.toFixed(1)}%
                  </span>
                )}
                <span
                  onClick={() => setReinvestPct(100)}
                  title="Model reinvesting 100% of all distributions"
                  style={{ cursor: 'pointer', textDecoration: 'underline dotted', color: 'var(--p-c5d0dc)' }}
                >
                  All: 100%
                </span>
              </div>
            </div>

            <div className="growth-filter-group">
              <label>Monthly Add ($)</label>
              <input
                type="number"
                min="0"
                value={monthlyContribution}
                onChange={e => setMonthlyContribution(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: '110px', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }}
              />
            </div>
          </>
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* ── Historical view ── */}
      {mode === 'historical' && !loading && data && (
        <>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <StatTile
              label="WINDOW DISTRIBUTIONS"
              value={fmt$(data.summary.total_payout)}
              help={isModel
                ? 'Modeled distributions in the window: each fund’s actual past payouts on the model’s shares, with every payment reinvested from the window start.'
                : 'Every distribution paid in the window for this scope: your recorded payments, plus [DRIP] purchases that have no matching payment row (payments from before the account’s payment history was imported).'}
              sub={
                xText.length >= 2
                  ? `${xText[0]} – ${xText[xText.length - 1]}${data.summary.covers_all_records ? ' · all recorded payments' : ''}`
                  : (isModel ? 'Modeled distributions in window' : 'Recorded distributions in window')
              }
            />
            <StatTile
              label="WINDOW % REINVESTED"
              value={`${data.summary.pct_reinvested ?? 0}%`}
              color="#38bdf8"
              help={isModel
                ? 'A Builder model is modeled as if every distribution is reinvested.'
                : 'Share of the window’s distributions that actually bought shares: payments matched to [DRIP] purchases. “Now set to” is today’s DRIP setting for this scope, weighted by estimated income.'}
              sub={isModel
                ? `${fmt$(data.summary.reinvested_payout)} reinvested (modeled)`
                : `${fmt$(data.summary.reinvested_payout)} DRIP · ${fmt$(data.summary.cash_payout)} cash · Now set to ${data.summary.current_reinvest_pct ?? 0}%`}
            />
            <StatTile
              label="DRIP SHARES BOUGHT"
              value={fmtShares(data.summary.total_drip_shares)}
              color="#a855f7"
              help="Shares bought by reinvesting distributions during the window. When some were sold since, the line below shows how many are still held, valued at today’s price."
              sub={
                data.summary.net_drip_shares_held > 0
                  ? (Math.abs(data.summary.total_drip_shares - data.summary.net_drip_shares_held) > 0.05
                    ? `${fmtShares(data.summary.net_drip_shares_held)} sh still held (${fmt$(data.summary.drip_shares_value)})`
                    : `Worth ${fmt$(data.summary.drip_shares_value)} at current prices`)
                  : 'No active DRIP shares held today'
              }
            />
            <StatTile
              label="EXTRA EARNED FROM DRIP"
              value={fmt$(data.summary.extra_income_from_drip)}
              color="#4dff91"
              help="Distributions paid on the shares that reinvesting bought during the window: income you would not have had by taking the cash. Compared with what the window would have paid with nothing reinvested."
              sub={
                data.summary.extra_income_from_drip > 0
                  ? `+${data.summary.extra_income_pct}% vs. ${fmt$(data.summary.total_nodrip)} if never reinvested`
                  : 'Distributions paid on accumulated DRIP shares'
              }
            />
            <StatTile
              label="EST. ANNUAL INCOME"
              value={fmt$(data.summary.run_rate)}
              color="#f59e0b"
              help={`Forward estimate for the holdings in scope${isModel ? ': each fund’s latest payout × its cadence on the model’s shares.' : ' (the Dashboard’s Est. Annual Income).'} Realized = what was paid over ${data.summary.realized_run_rate_basis}.`}
              sub={
                data.summary.est_annual_income > 0
                  ? `${fmt$(data.summary.est_monthly_income)}/mo forward est.${isModel ? '' : ' (matches Dashboard)'}${data.summary.realized_run_rate > 0 ? ` · Realized ${fmt$(data.summary.realized_run_rate)}/yr` : ''}`
                  : `Realized pace: ${data.summary.realized_run_rate_basis}`
              }
            />
          </div>

          {scopeTicker && (
            <BreakevenPanel
              ticker={scopeTicker}
              holding={holdings.find(h => h.ticker === scopeTicker)}
              histTickerRow={scopedTickerHistRow}
            />
          )}

          {hasData ? (
            <>
              <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
                <HelpTip text={HELP.distributions} />
                <Plot
                  data={distTraces}
                  layout={themedPlotlyLayout({
                    ...DARK_LAYOUT,
                    title: { text: `Distributions Over Time — ${scopeTitle}`, x: 0.5 },
                    height: 390,
                    yaxis: { tickprefix: '$', gridcolor: '#293a5f', rangemode: 'tozero' },
                    yaxis2: { title: 'Cumulative', tickprefix: '$', overlaying: 'y', side: 'right', gridcolor: 'rgba(0,0,0,0)', rangemode: 'tozero' },
                    xaxis: xAxis,
                    showlegend: true,
                    legend: { orientation: 'h', y: -0.22 },
                  }, isDark)}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
                <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', margin: '0.3rem 0 0', paddingLeft: '0.5rem' }}>
                  <span style={{ color: '#4dff91' }}>■</span> Recorded distributions{data.summary.has_partial_last ? ' (faded last bar = period still in progress)' : ''}&nbsp;&nbsp;
                  {data.summary.has_reconstructed && (
                    <><span style={{ color: '#38bdf8' }}>■</span> Modeled from market history (no ledger rows)&nbsp;&nbsp;</>
                  )}
                  <span style={{ color: '#94a3b8' }}>┄</span> Counterfactual income if 0% had been reinvested&nbsp;&nbsp;
                  <span style={{ color: '#f59e0b' }}>━</span> Cumulative distributions (right axis)
                </p>
              </div>

              {scopeTicker && rateTraces.length > 0 && (
                <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
                  <HelpTip text={HELP.ratePerShare} />
                  <Plot
                    data={rateTraces}
                    layout={themedPlotlyLayout({
                      ...DARK_LAYOUT,
                      title: { text: `Distribution Paid per Share — ${scopeTicker}`, x: 0.5 },
                      height: 320,
                      yaxis: { tickprefix: '$', gridcolor: '#293a5f', rangemode: 'tozero' },
                      xaxis: xAxis,
                      showlegend: false,
                    }, isDark)}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: '100%' }}
                    useResizeHandler
                  />
                  <p style={{ color: 'var(--p-6a7892)', fontSize: '0.73rem', margin: '0.15rem 0 0', paddingLeft: '0.5rem' }}>
                    Total per-share payout collected inside each period (independent of share count). Note: 5-Friday months naturally contain 5 weekly payments vs. 4 in normal months.
                  </p>
                </div>
              )}

              <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
                <HelpTip text={HELP.dripShares} />
                <Plot
                  data={shareTraces}
                  layout={themedPlotlyLayout({
                    ...DARK_LAYOUT,
                    title: { text: `DRIP Shares Purchased Over Time — ${scopeTitle}`, x: 0.5 },
                    height: 350,
                    yaxis: { title: 'Shares bought', gridcolor: '#293a5f', rangemode: 'tozero' },
                    yaxis2: { title: 'Cumulative DRIP shares', overlaying: 'y', side: 'right', gridcolor: 'rgba(0,0,0,0)', rangemode: 'tozero' },
                    xaxis: xAxis,
                    legend: { orientation: 'h', y: -0.22 },
                  }, isDark)}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>

              <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', paddingLeft: '0.5rem' }}>
                    Separates payout changes from DRIP shares, cash buys/sells, and fund rate changes
                    <HelpTip text={HELP.decomposition} inline />
                  </span>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button
                      type="button"
                      onClick={() => setDecompCumulative(true)}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--p-2a3a5a)', background: decompCumulative ? 'var(--p-1c2a4b)' : 'transparent', color: decompCumulative ? 'var(--p-cfe0ff)' : 'var(--text-dim)' }}
                    >Cumulative</button>
                    <button
                      type="button"
                      onClick={() => setDecompCumulative(false)}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--p-2a3a5a)', background: decompCumulative ? 'transparent' : 'var(--p-1c2a4b)', color: decompCumulative ? 'var(--text-dim)' : 'var(--p-cfe0ff)' }}
                    >Period-over-Period</button>
                  </div>
                </div>
                <Plot
                  data={decompTraces}
                  layout={themedPlotlyLayout({
                    ...DARK_LAYOUT,
                    title: { text: decompCumulative ? 'What Drove Payout Changes (Cumulative Since Window Start)' : 'What Drove Payout Changes (vs. Prior Period)', x: 0.5 },
                    height: 370,
                    barmode: 'relative',
                    yaxis: { tickprefix: '$', gridcolor: '#293a5f' },
                    xaxis: xAxis,
                    legend: { orientation: 'h', y: -0.22 },
                  }, isDark)}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>

              {!scopeTicker && ((data.rate_raises?.length > 0 || data.rate_cuts?.length > 0) || data.summary.drip_off?.length > 0) && (
                <div className="da-chart-panel" style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
                  {(data.rate_raises?.length > 0 || data.rate_cuts?.length > 0) && (
                    <div style={{ flex: '1 1 320px' }}>
                      <h3 style={{ marginTop: 0 }}>Largest Per-Share Payout Rate Shifts<HelpTip text={HELP.rateShifts} inline /></h3>
                      <p style={{ color: 'var(--p-6a7892)', fontSize: '0.74rem', margin: '0 0 0.5rem' }}>
                        Cumulative dollar impact from funds raising or trimming per-share distributions. Click any ticker to inspect.
                      </p>
                      {data.rate_raises?.length > 0 && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          {data.rate_raises.map(r => (
                            <div key={r.ticker} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.18rem 0' }}>
                              <span><span style={{ color: 'var(--pos)' }}>▲</span> <strong style={{ cursor: 'pointer', textDecoration: 'underline dotted' }} onClick={() => setScopeTicker(r.ticker)}>{r.ticker}</strong></span>
                              <span style={{ color: 'var(--pos)' }}>+{fmt$(r.rate_impact)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {data.rate_cuts?.length > 0 && data.rate_cuts.map(r => (
                        <div key={r.ticker} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.18rem 0' }}>
                          <span><span style={{ color: 'var(--neg-3)' }}>▼</span> <strong style={{ cursor: 'pointer', textDecoration: 'underline dotted' }} onClick={() => setScopeTicker(r.ticker)}>{r.ticker}</strong></span>
                          <span style={{ color: 'var(--neg-3)' }}>{fmt$(r.rate_impact)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {data.summary.drip_off?.length > 0 && (
                    <div style={{ flex: '1 1 320px' }}>
                      <h3 style={{ marginTop: 0 }}>Cash Distributions Not Currently Reinvesting<HelpTip text={HELP.cashNotReinvesting} inline /></h3>
                      <p style={{ color: 'var(--p-6a7892)', fontSize: '0.74rem', margin: '0 0 0.5rem' }}>
                        Open holdings where some or all accounts have DRIP off — {fmt$(data.summary.cash_payout)} taken as cash in this window.
                      </p>
                      {data.summary.drip_off.map(d => (
                        <div key={d.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.18rem 0' }}>
                          <span>
                            <strong style={{ cursor: 'pointer', textDecoration: 'underline dotted' }} onClick={() => setScopeTicker(d.ticker)}>{d.ticker}</strong>
                            {d.current_reinvest_pct > 0 && (
                              <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem', marginLeft: '0.4rem' }}>
                                ({d.current_reinvest_pct}% DRIP now)
                              </span>
                            )}
                          </span>
                          <span style={{ color: 'var(--text-dim)' }}>{fmt$(d.payout)} cash</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!scopeTicker && data.per_ticker?.length > 0 && (
                <div className="da-chart-panel">
                  <h3 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Top Contributors in Window<HelpTip text={HELP.topContributors} inline /></h3>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.76rem', margin: '0 0 0.6rem' }}>
                    Click any row to drill into that fund&apos;s distribution rate, DRIP shares, and break-even check.
                  </p>
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'right' }}>Distributions</th>
                        <th style={{ textAlign: 'right' }}>Window Reinv %</th>
                        <th style={{ textAlign: 'right' }}>DRIP Shares</th>
                        <th style={{ textAlign: 'right' }}>Extra from DRIP</th>
                        <th>Current DRIP Setting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.per_ticker.map(t => {
                        let statusLabel = 'Off (0%)'
                        let statusColor = 'var(--text-dim)'
                        if (t.model) {
                          statusLabel = 'Model (modeled 100%)'
                          statusColor = 'var(--pos)'
                        } else if (t.closed) {
                          statusLabel = 'Closed position'
                        } else if (t.current_reinvest_pct >= 99.9) {
                          statusLabel = t.accounts_total > 1 ? `On (all ${t.accounts_total} accts)` : 'On (100%)'
                          statusColor = 'var(--pos)'
                        } else if (t.current_reinvest_pct > 0) {
                          statusLabel = `Partial (${t.current_reinvest_pct}% · ${t.accounts_reinvest_on}/${t.accounts_total} accts)`
                          statusColor = '#38bdf8'
                        }
                        return (
                          <tr key={t.ticker} style={{ cursor: 'pointer' }} onClick={() => setScopeTicker(t.ticker)}>
                            <td style={{ fontWeight: 600 }}>{t.ticker}</td>
                            <td style={{ color: 'var(--text-dim)' }}>{t.description || (t.closed ? 'Closed / sold holding' : '—')}</td>
                            <td style={{ textAlign: 'right' }}>{fmt$(t.total_payout)}</td>
                            <td style={{ textAlign: 'right', color: t.reinvest_pct > 0 ? '#38bdf8' : 'var(--text-dim)' }}>{t.reinvest_pct}%</td>
                            <td style={{ textAlign: 'right', color: 'var(--p-a855f7)' }}>{fmtShares(t.total_drip_shares)}</td>
                            <td style={{ textAlign: 'right', color: t.extra_income_from_drip > 0 ? '#4dff91' : 'var(--text-dim)' }}>
                              {t.extra_income_from_drip > 0 ? `+${fmt$(t.extra_income_from_drip)}` : '$0'}
                            </td>
                            <td style={{ color: statusColor, fontSize: '0.82rem' }}>{statusLabel}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
              No distribution history available for the selected scope and timeframe.
            </div>
          )}
        </>
      )}

      {/* ── Projection view ── */}
      {mode === 'projection' && !loading && (
        projData ? (
          <>
            <div className="summary-strip" style={{ marginBottom: '1rem' }}>
              <StatTile
                label="CURRENT ANNUAL INCOME"
                value={fmt$(projData.current_annual_income)}
                help="Estimated annual income of the holdings in scope today: the simulation’s starting point."
                sub={`${fmt$(projData.current_annual_income / 12)}/mo — ${isModel ? 'the model’s estimated income' : 'matches Dashboard Est. Annual Income'}`}
              />
              <StatTile
                label={`PROJECTED IN ${years}YR`}
                value={fmt$(projData.projected_annual_income)}
                color="#4dff91"
                help="Annual income at the end of the horizon in the chosen market scenario, reinvesting at your Reinvest % and adding your Monthly Add."
                sub={`${fmt$(projData.projected_annual_income / 12)}/mo (${marketType}, ${reinvestPct}% DRIP)`}
              />
              {projBaselineEndAnnual != null && (
                <StatTile
                  label={`GAIN FROM REINVESTING (YR ${years})`}
                  value={fmtSigned$(projData.projected_annual_income - projBaselineEndAnnual)}
                  color="#38bdf8"
                  help="Projected annual income at the end of the horizon minus the same holdings with nothing reinvested and nothing added, in the same scenario."
                  sub={`vs. ${fmt$(projBaselineEndAnnual)}/yr with 0% DRIP & $0 add`}
                />
              )}
              <StatTile
                help="Projected annual income at the end of the horizon compared with today’s."
                label={`${years}YR INCOME CHANGE`}
                value={projData.current_annual_income > 0
                  ? fmtPct1(((projData.projected_annual_income / projData.current_annual_income) - 1) * 100)
                  : '—'}
                color={projData.projected_annual_income >= projData.current_annual_income ? '#f59e0b' : '#e05555'}
                sub={`${fmtSigned$(projData.projected_annual_income - projData.current_annual_income)}/yr vs. today`}
              />
            </div>

            {scopeTicker && (
              <BreakevenPanel
                ticker={scopeTicker}
                holding={holdings.find(h => h.ticker === scopeTicker)}
                histTickerRow={scopedTickerHistRow}
              />
            )}

            {projTraces.length > 0 ? (
              <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
                <HelpTip text={HELP.projection} />
                <Plot
                  data={projTraces}
                  layout={themedPlotlyLayout({
                    ...DARK_LAYOUT,
                    title: { text: `Projected ${years <= 5 ? 'Monthly' : 'Annual'} Income — ${scopeTitle} (${marketType}, ${reinvestPct}% reinvested)`, x: 0.5 },
                    height: 420,
                    yaxis: { tickprefix: '$', gridcolor: '#293a5f', rangemode: 'tozero' },
                    xaxis: { gridcolor: '#1c2a4b' },
                    showlegend: true,
                    legend: { orientation: 'h', y: -0.2 },
                  }, isDark)}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
                <p style={{ color: 'var(--p-6a7892)', fontSize: '0.74rem', margin: '0.2rem 0 0', paddingLeft: '0.5rem' }}>
                  The shaded wedge between the solid line and dashed 0% DRIP baseline is the extra future income generated by reinvesting distributions{monthlyContribution > 0 ? ` and adding ${fmt$(monthlyContribution)}/mo` : ''}.
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>No projection data.</div>
            )}

            {shareGrowthTraces.length > 0 && (
              <div className="da-chart-panel" style={{ position: 'relative' }}>
                <HelpTip text={HELP.shareCount} />
                <Plot
                  data={shareGrowthTraces}
                  layout={themedPlotlyLayout({
                    ...DARK_LAYOUT,
                    title: { text: `Projected Share Count by Scenario — ${scopeTitle}`, x: 0.5 },
                    height: 380,
                    yaxis: { title: 'Total shares', gridcolor: '#293a5f' },
                    xaxis: { gridcolor: '#1c2a4b' },
                    legend: { orientation: 'h', y: -0.2 },
                  }, isDark)}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
                {!scopeTicker && (
                  <p style={{ color: 'var(--p-6a7892)', fontSize: '0.73rem', margin: '0.15rem 0 0' }}>
                    {isModel ? 'Whole-model' : 'Whole-portfolio'} share count sums shares across funds with different prices — select a single Ticker in Scope above for a single-fund share curve.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
            No open dividend-paying holdings match the selected scope.
          </div>
        )
      )}

      {/* ── Price Impact view ── */}
      {mode === 'priceImpact' && !loading && (
        priceImpact.currentValue > 0 ? (
          <>
            <div className="summary-strip" style={{ marginBottom: '1rem' }}>
              <StatTile
                label="PRICE SHOCK"
                value={`${priceShockPct > 0 ? '+' : ''}${priceShockPct}%`}
                color={priceShockPct < 0 ? '#e05555' : priceShockPct > 0 ? '#4dff91' : undefined}
                help="The instant price change applied to every holding in scope, and the scope’s market value before → after it."
                sub={`${fmt$(priceImpact.currentValue)} → ${fmt$(priceImpact.adjustedValue)}`}
              />
              <StatTile
                label="IMMEDIATE MONTHLY"
                value={fmt$(priceImpact.adjustedCurrentMonthlyIncome)}
                color={priceImpact.adjustedCurrentMonthlyIncome >= priceImpact.currentMonthlyIncome ? '#4dff91' : '#e05555'}
                help="Monthly income right after the price change, before any reinvesting: each holding’s payout moved by its income sensitivity."
                sub={`base ${fmt$(priceImpact.currentMonthlyIncome)}/mo${isModel ? '' : ' (matches Dashboard)'}`}
              />
              <StatTile
                label="IMMEDIATE ANNUAL"
                value={fmt$(priceImpact.adjustedCurrentAnnualIncome)}
                color={priceImpact.adjustedCurrentAnnualIncome >= priceImpact.currentAnnualIncome ? '#4dff91' : '#e05555'}
                help="Annual income right after the price change, before any reinvesting."
                sub={`base ${fmt$(priceImpact.currentAnnualIncome)}/yr${isModel ? '' : ' (matches Dashboard)'}`}
              />
              <StatTile
                label={`MONTHLY IN ${years}YR`}
                value={fmt$(priceImpact.projectedMonthlyIncome)}
                color={priceImpact.projectedMonthlyIncome >= priceImpact.adjustedCurrentMonthlyIncome ? '#4dff91' : '#e05555'}
                help="Monthly income at the end of the horizon, reinvesting at your Reinvest % (and adding your Monthly Add) at the shocked price."
                sub={`at ${reinvestPct}% DRIP`}
              />
              <StatTile
                label={`ANNUAL IN ${years}YR`}
                value={fmt$(priceImpact.projectedAnnualIncome)}
                color={priceImpact.projectedAnnualIncome >= priceImpact.adjustedCurrentAnnualIncome ? '#4dff91' : '#e05555'}
                help="Annual income at the end of the horizon, compared with the shocked income with nothing reinvested."
                sub={`vs. ${fmt$(priceImpact.adjustedCurrentAnnualIncome)}/yr at 0% DRIP`}
              />
              <StatTile
                help="How much higher income is at the end of the horizon than right after the price change: what compounding at the new price adds."
                label={`${years}YR REINVEST LIFT`}
                value={priceImpact.adjustedCurrentAnnualIncome > 0
                  ? fmtPct1((priceImpact.projectedAnnualIncome / priceImpact.adjustedCurrentAnnualIncome - 1) * 100)
                  : '—'}
                color={priceImpact.projectedAnnualIncome >= priceImpact.adjustedCurrentAnnualIncome ? '#4dff91' : '#e05555'}
                sub={`${fmtSigned$(priceImpact.projectedAnnualIncome - priceImpact.adjustedCurrentAnnualIncome)}/yr from compounding`}
              />
            </div>

            <details style={{
              background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.35)',
              borderLeft: '3px solid var(--p-f59e0b)', borderRadius: '6px',
              padding: '0.7rem 0.9rem', margin: '0 0 1rem', fontSize: '0.84rem', color: 'var(--p-c5d0dc)', lineHeight: 1.45,
            }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-strong)', fontWeight: 700 }}>
                How the Price Impact model works
              </summary>
              <div style={{ marginTop: '0.55rem' }}>
                <p style={{ margin: '0 0 0.45rem' }}>
                  <strong>1. Immediate payout adjustment:</strong> Each holding starts at its Dashboard forward annual income estimate and applies a strategy-specific income beta to the price shock (option-income funds: 35% down / 20% up; CEF/BDC/fixed-income: 20% down / 10% up; declared equity dividends: 10% down / 5% up).
                </p>
                <p style={{ margin: 0 }}>
                  <strong>2. Compounding at the shocked price:</strong> Reinvested distributions and monthly additions buy shares at the new price across your {years}-year horizon. Lower prices reduce immediate payouts on NAV-sensitive funds, but each reinvested dollar buys more shares — lifting future income faster.
                </p>
              </div>
            </details>

            {scopeTicker && (
              <BreakevenPanel
                ticker={scopeTicker}
                holding={holdings.find(h => h.ticker === scopeTicker)}
                histTickerRow={scopedTickerHistRow}
              />
            )}

            {currentIncomeSensitivityTraces.length > 0 && (
              <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
                <HelpTip text={HELP.immediateIncome} />
                <Plot
                  data={currentIncomeSensitivityTraces}
                  layout={themedPlotlyLayout(readOnlyAxes({
                    ...DARK_LAYOUT,
                    title: { text: `Immediate Income by Portfolio Price Shock — ${scopeTitle}`, x: 0.5 },
                    height: 370,
                    yaxis: { title: 'Immediate monthly income', tickprefix: '$', gridcolor: '#293a5f', rangemode: 'tozero' },
                    yaxis2: { title: 'Immediate annual income', tickprefix: '$', overlaying: 'y', side: 'right', gridcolor: 'rgba(0,0,0,0)', rangemode: 'tozero' },
                    xaxis: { title: 'Portfolio price change', ticksuffix: '%', gridcolor: '#1c2a4b', range: [-65, 105], zeroline: true, zerolinecolor: '#64748b' },
                    legend: { orientation: 'h', y: -0.22 },
                  }), isDark)}
                  config={READ_ONLY_PLOT_CONFIG}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>
            )}

            {priceSensitivityTraces.length > 0 && (
              <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
                <HelpTip text={HELP.sensitivity} />
                <Plot
                  data={priceSensitivityTraces}
                  layout={themedPlotlyLayout(readOnlyAxes({
                    ...DARK_LAYOUT,
                    title: { text: `Year-${years} Annual Income vs. Immediate Payout Across Price Shocks (${reinvestPct}% DRIP)`, x: 0.5 },
                    height: 400,
                    yaxis: { title: 'Annual income', tickprefix: '$', gridcolor: '#293a5f', rangemode: 'tozero' },
                    xaxis: { title: 'Portfolio price change', ticksuffix: '%', gridcolor: '#1c2a4b', range: [-65, 105], zeroline: true, zerolinecolor: '#64748b' },
                    legend: { orientation: 'h', y: -0.22 },
                  }), isDark)}
                  config={READ_ONLY_PLOT_CONFIG}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>
            )}

            {priceMonthlyTraces.length > 0 && (
              <div className="da-chart-panel" style={{ marginBottom: '1rem', position: 'relative' }}>
                <HelpTip text={HELP.trajectory} />
                <Plot
                  data={priceMonthlyTraces}
                  layout={themedPlotlyLayout(readOnlyAxes({
                    ...DARK_LAYOUT,
                    title: { text: `Projected Monthly Income Trajectory at ${priceShockPct > 0 ? '+' : ''}${priceShockPct}% Price Shock`, x: 0.5 },
                    height: 360,
                    yaxis: { tickprefix: '$', gridcolor: '#293a5f', rangemode: 'tozero' },
                    xaxis: { gridcolor: '#1c2a4b' },
                    showlegend: true,
                    legend: { orientation: 'h', y: -0.22 },
                  }), isDark)}
                  config={READ_ONLY_PLOT_CONFIG}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>
            )}

            {priceHoldingRows.length > 0 && (
              <div className="da-chart-panel">
                <h3 style={{ marginTop: 0 }}>Top Income Contributors at Adjusted Price<HelpTip text={HELP.priceHoldings} inline /></h3>
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Price</th>
                      <th style={{ textAlign: 'right' }}>Shocked Price</th>
                      <th>Income Sensitivity</th>
                      <th style={{ textAlign: 'right' }}>End Shares</th>
                      <th style={{ textAlign: 'right' }}>Projected Annual</th>
                      <th style={{ textAlign: 'right' }}>Compounding Lift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceHoldingRows.map(h => (
                      <tr key={h.ticker} style={{ cursor: 'pointer' }} onClick={() => setScopeTicker(h.ticker)}>
                        <td style={{ fontWeight: 600 }}>{h.ticker}</td>
                        <td style={{ color: 'var(--text-dim)' }}>{h.description}</td>
                        <td style={{ textAlign: 'right' }}>{fmt$(h.current_price)}</td>
                        <td style={{ textAlign: 'right', color: priceShockPct < 0 ? 'var(--neg-3)' : priceShockPct > 0 ? 'var(--pos)' : 'var(--text)' }}>{fmt$(h.adjusted_price)}</td>
                        <td style={{ color: 'var(--text-dim)' }}>{h.income_type || 'Modeled'} ({((h.income_beta || 0) * 100).toFixed(0)}% beta)</td>
                        <td style={{ textAlign: 'right' }}>{fmtShares(h.shares_end)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--pos)', fontWeight: 600 }}>{fmt$(h.projected_annual_income)}</td>
                        <td style={{ textAlign: 'right' }}>{h.growth_pct == null ? '—' : `${h.growth_pct >= 0 ? '+' : ''}${h.growth_pct.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
            No priced income holdings are available for the selected scope.
          </div>
        )
      )}
    </div>
  )
}
