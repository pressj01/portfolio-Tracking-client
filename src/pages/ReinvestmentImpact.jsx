import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Plot from '../components/ThemedPlot'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoneyWhole } from '../utils/money'

const fmt$ = v => formatMoneyWhole(v)
const fmtShares = v => v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct1 = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
const fmtYears = v => v == null ? '—' : v < 1 / 12 ? '<1 mo' : v < 1 ? `${Math.round(v * 12)} mo` : `${v.toFixed(1)} yr`

// Break-even analysis for a single holding. "Break even" = recovering the cost
// basis. We report it two ways: cost-basis (position value alone) and
// total-return (value + dividends already collected). For underwater positions
// we also estimate how long reinvestment alone needs to close the gap at a flat
// price — DRIP adds ~one year's distributions of value per year.
function breakevenMetrics(h) {
  if (!h) return null
  const shares = Number(h.quantity) || 0
  const price = Number(h.current_price) || 0
  const cost = Number(h.purchase_value) || 0
  const value = Number(h.current_value) || shares * price
  const divs = Number(h.total_divs_received) || 0
  const annualIncome = Number(h.estim_payment_per_year) || 0
  if (cost <= 0 || price <= 0 || value <= 0) return null

  // Past ~90% down, a price/share recovery is implausibly large (e.g. a
  // position down 99.7% "needs +35,000%"), so we soften that display.
  const WIPED_PCT = 900           // pctToBreakeven above this = effectively wiped out
  const MAX_DRIP_YEARS = 50       // DRIP horizons beyond this aren't actionable

  const leg = (effValue) => {
    const gap = cost - effValue                 // $ still short of cost basis (<0 means past it)
    const brokenEven = effValue >= cost
    const pctToBreakeven = brokenEven ? null : (cost / effValue - 1) * 100
    const years = brokenEven || annualIncome <= 0 ? null : gap / annualIncome
    return {
      brokenEven,
      // value's distance from cost basis (negative = underwater, positive = above)
      pctFromCost: (effValue / cost - 1) * 100,
      // % the value must still rise to reach cost basis (null once past it)
      pctToBreakeven,
      // % the value sits above cost basis (null until past it)
      pctAbove: brokenEven ? (effValue / cost - 1) * 100 : null,
      // extra shares at today's price to close the remaining gap
      sharesNeeded: brokenEven ? 0 : gap / price,
      // years for reinvested distributions to close the gap at a flat price
      years,
      // too far gone for a meaningful price/share recovery target
      wipedOut: !brokenEven && pctToBreakeven > WIPED_PCT,
      // reinvestment still offers a realistic, finite path back
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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Period key ("YYYY" | "YYYY-MM" | "YYYY-Www") → short, readable axis label.
function labelFor(key, view) {
  if (view === 'yearly') return key
  if (view === 'weekly') {
    const [y, w] = key.split('-W')
    return `Wk${Number(w)} '${y.slice(-2)}`
  }
  const [y, m] = key.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${y.slice(-2)}`
}

const DARK_LAYOUT = {
  paper_bgcolor: '#16213e',
  plot_bgcolor: '#16213e',
  font: { color: '#e0e8f5', size: 12 },
  margin: { l: 64, r: 56, t: 50, b: 64 },
}

function StatTile({ label, value, color, sub }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{label}</div>
      <div className="summary-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>{sub}</div>}
    </div>
  )
}

// One side of the break-even panel (cost-basis or total-return).
function BreakevenLeg({ title, leg, hint }) {
  const green = '#4dff91', amber = '#f59e0b'
  return (
    <div style={{ flex: '1 1 240px', minWidth: 240 }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.1rem' }}>{title}</div>
      <div style={{ fontSize: '0.7rem', color: 'var(--p-6a7892)', marginBottom: '0.5rem' }}>{hint}</div>
      {leg.brokenEven ? (
        <>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: green }}>{fmtPct1(leg.pctAbove)}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>above break-even ✓</div>
        </>
      ) : leg.wipedOut ? (
        <>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--neg-3)' }}>{fmtPct1(leg.pctFromCost)}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>from cost — effectively wiped out</div>
          {leg.dripRecoverable ? (
            <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: 'var(--p-c5d0dc)' }}>
              Price recovery unlikely, but reinvestment closes it in ~<span style={{ fontWeight: 600 }}>{fmtYears(leg.years)}</span> at a flat price
            </div>
          ) : (
            <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--p-6a7892)', fontStyle: 'italic' }}>
              Recovery impractical at the current distribution rate
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: amber }}>{fmtPct1(leg.pctToBreakeven)}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>needed to break even</div>
          <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: 'var(--p-c5d0dc)' }}>
            <span style={{ color: 'var(--p-a855f7)', fontWeight: 600 }}>{fmtShares(leg.sharesNeeded)}</span> more shares at today's price
          </div>
          {leg.years != null && (
            <div style={{ fontSize: '0.85rem', color: 'var(--p-c5d0dc)' }}>
              ~<span style={{ fontWeight: 600 }}>{fmtYears(leg.years)}</span> via reinvestment at a flat price
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BreakevenPanel({ ticker, holding }) {
  const be = breakevenMetrics(holding)
  if (!be) return null
  return (
    <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Break-Even — {ticker}</h3>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', margin: '0 0 0.75rem' }}>
        Cost basis {fmt$(be.cost)} · current value {fmt$(be.value)} · dividends received {fmt$(be.divs)}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
        <BreakevenLeg title="Cost basis" hint="position value vs. what you paid" leg={be.costBasis} />
        <BreakevenLeg title="Total return" hint="value + dividends collected vs. cost" leg={be.totalReturn} />
      </div>
      {be.annualIncome > 0 && (
        <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0.6rem 0 0', fontStyle: 'italic' }}>
          Time-to-break-even assumes a flat price and reinvested distributions at the current annual rate ({fmt$(be.annualIncome)}/yr); price moves and distribution changes will shift it.
        </p>
      )}
    </div>
  )
}

export default function ReinvestmentImpact() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const { isDark } = useTheme()

  const [mode, setMode] = useState('historical')   // historical | projection
  const [view, setView] = useState('monthly')
  const [monthsBack, setMonthsBack] = useState(60)
  const [categories, setCategories] = useState([])  // selected category ids (strings)
  const [subcategories, setSubcategories] = useState([])  // selected sub-category ids (strings)
  const [catOpen, setCatOpen] = useState(false)
  const [scopeTicker, setScopeTicker] = useState('')  // '' = whole portfolio
  const [decompCumulative, setDecompCumulative] = useState(false)  // attribution chart: per-period vs running total

  // Projection controls
  const [years, setYears] = useState(10)
  const [marketType, setMarketType] = useState('neutral')
  const [reinvestPct, setReinvestPct] = useState(100)
  const [monthlyContribution, setMonthlyContribution] = useState(0)
  const [projScopeTicker, setProjScopeTicker] = useState('')  // '' = whole portfolio
  const [projCategories, setProjCategories] = useState([])  // selected category names for projection
  const [projSubcats, setProjSubcats] = useState([])  // selected sub-category ids (strings) for projection
  const [projCatOpen, setProjCatOpen] = useState(false)
  const [allCategories, setAllCategories] = useState([])  // loaded independently for projection tab

  const [data, setData] = useState(null)        // historical response
  // Projection holds all three scenarios so the income chart can switch market
  // type instantly and the share-growth chart can plot all three at once.
  const [projScenarios, setProjScenarios] = useState(null)  // { bullish, neutral, bearish }
  const [holdings, setHoldings] = useState([])
  const [actualReinvest, setActualReinvest] = useState(null)  // trailing-3-mo actual reinvest % from recorded payments
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const catRef = useRef(null)
  const projCatRef = useRef(null)
  // Guards against out-of-order responses: switching granularity fires two
  // fetches (old range, then the reset range) — only apply the latest.
  const reqIdRef = useRef(0)
  const projReqIdRef = useRef(0)
  // Seed the Reinvest % default from the portfolio's actual DRIP mix only once,
  // so later user edits (and scope/portfolio switches) aren't clobbered.
  const seededReinvestRef = useRef(false)

  // Close category dropdowns on outside click
  useEffect(() => {
    const handler = e => {
      if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false)
      if (projCatRef.current && !projCatRef.current.contains(e.target)) setProjCatOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Load category list independently so the projection tab has it even before
  // the historical tab has fired a fetch.
  useEffect(() => {
    pf('/api/categories/data')
      .then(r => r.json())
      .then(d => setAllCategories((d.categories || []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setAllCategories([]))
  }, [pf, selection])

  // Reset range sensibly when granularity changes
  useEffect(() => {
    if (view === 'monthly') setMonthsBack(60)
    else if (view === 'weekly') setMonthsBack(12)
    else setMonthsBack(120)
  }, [view])

  // Load holdings for the scope dropdown + projection override
  useEffect(() => {
    seededReinvestRef.current = false  // re-seed when the active portfolio changes
    pf('/api/holdings')
      .then(r => r.json())
      .then(rows => setHoldings((rows || []).filter(r => r.quantity > 0 && r.current_price > 0)))
      .catch(() => setHoldings([]))
  }, [pf, selection])

  // Actual reinvested % over the trailing 3 completed months (recorded payments
  // split by per-account reinvest flag). Offered next to Reinvest % as a
  // real-data seed alongside the estimate. Excludes the in-progress month.
  useEffect(() => {
    pf('/api/reinvestment-actual-pct?months=3')
      .then(r => r.json())
      .then(d => setActualReinvest(d && d.pct_reinvested != null ? d : null))
      .catch(() => setActualReinvest(null))
  }, [pf, selection])

  // Portfolio's actual reinvested share of monthly income, mirroring the
  // Holdings/Dashboard "% Reinvested" metric (income reinvested ÷ total income).
  const portfolioReinvestPct = useMemo(() => {
    const mi = holdings.reduce((s, h) => s + (Number(h.approx_monthly_income) || 0), 0)
    const ri = holdings.reduce((s, h) => s + (Number(h.monthly_income_reinvested) || 0), 0)
    return mi > 0 ? (ri / mi) * 100 : null
  }, [holdings])

  // Default the Reinvest % control to the portfolio's real DRIP mix (once).
  useEffect(() => {
    if (!seededReinvestRef.current && portfolioReinvestPct != null) {
      setReinvestPct(Math.round(portfolioReinvestPct))
      seededReinvestRef.current = true
    }
  }, [portfolioReinvestPct])

  // ── Historical fetch ──────────────────────────────────────────────────────
  const fetchHistorical = useCallback(() => {
    const myId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ view, months_back: monthsBack })
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    if (scopeTicker) params.set('ticker', scopeTicker)
    pf(`/api/reinvestment-impact/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (myId !== reqIdRef.current) return  // a newer request superseded this one
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => { if (myId === reqIdRef.current) setError(e.message) })
      .finally(() => { if (myId === reqIdRef.current) setLoading(false) })
  }, [view, monthsBack, categories, subcategories, scopeTicker, selection, pf])

  // ── Projection fetch (reuse Income Growth engine) ──────────────────────────
  // Fetches all three market scenarios at once so the income chart can switch
  // instantly and the share-growth chart can show every scenario together.
  const fetchProjection = useCallback(() => {
    const myId = ++projReqIdRef.current
    setLoading(true)
    setError(null)
    const scoped = holdings
      .filter(h => !projScopeTicker || h.ticker === projScopeTicker)
      .filter(h => (!projCategories.length && !projSubcats.length)
        || projCategories.includes(String(h.category))
        || (h.subcategory_id != null && projSubcats.includes(String(h.subcategory_id))))
    const override = scoped.map(h => ({
      ticker: h.ticker,
      shares: h.quantity,
      price: h.current_price,
      div_per_share: h.div || 0,
      freq_str: h.div_frequency || 'Q',
      description: (h.description || '').substring(0, 40),
      // Projection models the user's chosen Reinvest %, not the portfolio's
      // stored DRIP flag — so setting 100% reinvests even funds marked 'N'.
      reinvest: reinvestPct > 0,
    }))
    const run = (mt) => {
      const payload = { years, market_type: mt, monthly_contribution: monthlyContribution, reinvest_pct: reinvestPct, monte_carlo: false }
      if (override.length) payload.holdings_override = override
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
      .catch(e => { if (myId === projReqIdRef.current) setError(e.message) })
      .finally(() => { if (myId === projReqIdRef.current) setLoading(false) })
  }, [holdings, years, monthlyContribution, reinvestPct, projScopeTicker, projCategories, projSubcats, pf])

  useEffect(() => {
    if (mode === 'historical') fetchHistorical()
  }, [mode, fetchHistorical])

  useEffect(() => {
    if (mode === 'projection' && holdings.length) fetchProjection()
  }, [mode, fetchProjection, holdings.length])

  const categoryOptions = data?.categories || []

  // ── Historical chart data ──────────────────────────────────────────────────
  const s = data?.series
  const xText = useMemo(() => (s?.labels || []).map(k => labelFor(k, view)), [s, view])
  // Categorical axis stays readable by thinning tick labels: show ~14 evenly
  // spaced periods (weekly views otherwise cram 50+ labels into the axis).
  const xAxis = useMemo(() => {
    const n = xText.length
    const step = Math.max(1, Math.ceil(n / 14))
    const tickvals = xText.filter((_, i) => i % step === 0)
    return {
      type: 'category', categoryorder: 'array', categoryarray: xText,
      tickmode: 'array', tickvals, ticktext: tickvals,
      tickangle: view === 'monthly' && n <= 14 ? 0 : -45,
      gridcolor: '#1c2a4b',
    }
  }, [xText, view])

  const distTraces = useMemo(() => {
    if (!s) return []
    const colors = (s.payout_source || []).map(src => src === 'actual' ? '#4dff91' : '#38bdf8')
    const traces = [{
      x: xText, y: s.payout, type: 'bar',
      marker: { color: colors },
      hovertemplate: '%{x}<br>$%{y:,.2f}<extra></extra>',
      name: 'Distributions',
    }]
    // Counterfactual: payout had distributions been taken as cash (no reinvestment).
    // The bars show actual recorded payments where available, while payout_nodrip
    // is reconstructed — so we can't plot the raw nodrip series against them (it can
    // float above the bars when actual < reconstructed). Instead subtract the
    // modeled per-period DRIP benefit (recon − nodrip, ≥ 0) from each bar, so the
    // line is always ≤ the bar and the gap equals the income reinvesting added.
    const nodrip = s.payout_nodrip
    const recon = s.payout_reconstructed
    if (nodrip && recon) {
      const benefit = recon.map((r, i) => Math.max(0, r - (nodrip[i] ?? 0)))
      if (benefit.some(b => b > 0.005)) {
        const line = s.payout.map((p, i) => Math.max(0, (p ?? 0) - benefit[i]))
        traces.push({
          x: xText, y: line, type: 'scatter', mode: 'lines',
          line: { color: '#94a3b8', width: 1.5, dash: 'dot' },
          hovertemplate: '%{x}<br>$%{y:,.2f} income if not reinvested<extra></extra>',
          name: 'Income if not reinvested',
        })
      }
    }
    // Cumulative income received across the window (right axis).
    let runTotal = 0
    const cum = (s.payout || []).map(v => { runTotal += (v || 0); return Math.round(runTotal * 100) / 100 })
    traces.push({
      x: xText, y: cum, type: 'scatter', mode: 'lines', yaxis: 'y2',
      line: { color: '#f59e0b', width: 2 },
      hovertemplate: '%{x}<br>$%{y:,.2f} received so far<extra></extra>',
      name: 'Cumulative received',
    })
    return traces
  }, [s, xText])

  const shareTraces = useMemo(() => {
    if (!s) return []
    return [
      {
        x: xText, y: s.drip_shares_added, type: 'bar',
        marker: { color: '#a855f7' }, name: 'Shares added (Δ)',
        hovertemplate: '%{x}<br>+%{y:,.4f} sh<extra></extra>',
      },
      {
        x: xText, y: s.drip_shares_cumulative, type: 'scatter', mode: 'lines',
        line: { color: '#f59e0b', width: 2 }, yaxis: 'y2', name: 'Cumulative shares',
        hovertemplate: '%{x}<br>%{y:,.4f} sh total<extra></extra>',
      },
    ]
  }, [s, xText])

  // Per-share distribution-rate trend — only meaningful for a single fund, so it's
  // shown when the charts are scoped to one ticker. Aligns the ticker's dps series
  // to the aggregate label axis.
  const rateTraces = useMemo(() => {
    if (!scopeTicker || !s) return []
    const t = (data?.per_ticker || []).find(x => x.ticker === scopeTicker)
    if (!t?.dps?.length) return []
    const byLabel = {}
    t.labels.forEach((k, i) => { byLabel[k] = t.dps[i] })
    const y = (s.labels || []).map(k => (k in byLabel ? byLabel[k] : null))
    return [{
      x: xText, y, type: 'scatter', mode: 'lines+markers', connectgaps: true,
      line: { color: '#38bdf8', width: 2 }, marker: { size: 4, color: '#38bdf8' },
      hovertemplate: '%{x}<br>$%{y:,.4f} / share<extra></extra>',
      name: 'Distribution / share',
    }]
  }, [scopeTicker, s, xText, data])

  const decompTraces = useMemo(() => {
    if (!s?.decomp) return []
    const d = s.decomp
    // Running total of each effect since the window start — answers "over the
    // whole window, how much of my income growth came from DRIP vs. rate?"
    const runningSum = (arr) => {
      let run = 0
      return (arr || []).map(v => { run += (v || 0); return Math.round(run * 100) / 100 })
    }
    const shares = decompCumulative ? runningSum(d.shares) : d.shares
    const rate = decompCumulative ? runningSum(d.rate) : d.rate
    const price = decompCumulative ? runningSum(d.price) : d.price
    const mk = (y, name, color) => ({
      x: xText, y, type: 'bar', name,
      marker: { color }, hovertemplate: '%{x}<br>$%{y:,.2f}<extra></extra>',
    })
    return [
      mk(shares, 'Share growth (DRIP)', '#4dff91'),
      mk(rate, 'Distribution rate', '#38bdf8'),
      mk(price, 'Interaction', '#f59e0b'),
    ]
  }, [s, xText, decompCumulative])

  // ── Projection chart data ──────────────────────────────────────────────────
  const SCENARIO_COLORS = { bullish: '#4dff91', neutral: '#f59e0b', bearish: '#e05555' }
  const projData = projScenarios ? projScenarios[marketType] : null  // selected-scenario response (for income chart + tiles)
  const seriesKey = years <= 5 ? 'monthly_series' : 'annual_series'
  const projSeries = projData ? projData[seriesKey] : []
  const projTraces = useMemo(() => {
    if (!projSeries?.length) return []
    const color = SCENARIO_COLORS[marketType]
    return [{
      x: projSeries.map(p => p.label),
      y: projSeries.map(p => p.total_income),
      type: 'scatter', mode: 'lines', fill: 'tozeroy',
      fillcolor: color + '22', line: { color, width: 2 },
      hovertemplate: '%{x}<br>$%{y:,.0f}<extra></extra>', name: 'Projected income',
    }]
  }, [projSeries, marketType])

  // Share-count growth across all three scenarios on one chart.
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
        hovertemplate: `%{x}<br>${mt}: %{y:,.2f} sh<extra></extra>`,
      }
    })
  }, [projScenarios, seriesKey])

  const rangeOptions = view === 'monthly' ? MONTHLY_RANGE : view === 'weekly' ? WEEKLY_RANGE : YEARLY_RANGE
  const hasData = s && s.labels.length > 0

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '0.25rem' }}>Reinvestment Impact</h1>
      <p style={{ color: 'var(--text-dim)', marginTop: 0, marginBottom: '0.5rem', fontSize: '0.9rem' }}>
        How dividend reinvestment reshapes your payouts — share growth, rate changes, and price effects over time.
      </p>
      {portfolioReinvestPct != null && (
        <p style={{ marginTop: 0, marginBottom: '1rem', fontSize: '0.9rem' }}>
          <span style={{ color: 'var(--text-dim)' }}>Currently reinvesting </span>
          <span style={{ color: 'var(--pos-muted)', fontWeight: 700 }}>{portfolioReinvestPct.toFixed(1)}%</span>
          <span style={{ color: 'var(--text-dim)' }}> of this portfolio's monthly income (used as the projection default below).</span>
        </p>
      )}

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1rem' }}>
        {['historical', 'projection'].map((m, i) => (
          <button
            key={m}
            className={`btn${mode === m ? ' btn-active' : ' btn-secondary'}`}
            style={{ borderRadius: i === 0 ? '6px 0 0 6px' : '0 6px 6px 0', textTransform: 'capitalize', padding: '0.45rem 1.1rem' }}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="growth-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
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
              <label>Time Range</label>
              <select
                value={monthsBack}
                onChange={e => setMonthsBack(Number(e.target.value))}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }}
              >
                {rangeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            {categoryOptions.length > 0 && (
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
                      <input type="checkbox" checked={categories.length === 0 && subcategories.length === 0}
                        onChange={() => { setCategories([]); setSubcategories([]) }} />
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
                                  // Selecting the whole category supersedes any of its
                                  // sub-category selections, so clear those.
                                  const subIds = subs.map(s => String(s.id))
                                  setCategories(prev => [...prev, String(c.id)])
                                  setSubcategories(prev => prev.filter(id => !subIds.includes(id)))
                                } else {
                                  setCategories(prev => prev.filter(id => id !== String(c.id)))
                                }
                              }}
                            />
                            <span>{c.name}</span>
                          </label>
                          {subs.map(s => (
                            <label key={`sub-${s.id}`} className="growth-cat-option"
                              style={{ paddingLeft: '1.4rem', opacity: catChecked ? 0.5 : 1 }}>
                              <input type="checkbox" disabled={catChecked}
                                checked={catChecked || subcategories.includes(String(s.id))}
                                onChange={e => {
                                  if (e.target.checked) setSubcategories(prev => [...prev, String(s.id)])
                                  else setSubcategories(prev => prev.filter(id => id !== String(s.id)))
                                }} />
                              <span>{s.name}</span>
                            </label>
                          ))}
                        </React.Fragment>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="growth-filter-group">
              <label>Scope</label>
              <select
                value={scopeTicker}
                onChange={e => setScopeTicker(e.target.value)}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px', minWidth: '160px' }}
              >
                <option value="">Whole Portfolio</option>
                {holdings.map(h => <option key={h.ticker} value={h.ticker}>{h.ticker}</option>)}
              </select>
            </div>
          </>
        )}

        {mode === 'projection' && (
          <>
            <div className="growth-filter-group">
              <label>Fund</label>
              <select value={projScopeTicker} onChange={e => { setProjScopeTicker(e.target.value); setProjCategories([]); setProjSubcats([]) }}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px', minWidth: '160px' }}>
                <option value="">Whole Portfolio</option>
                {holdings.map(h => <option key={h.ticker} value={h.ticker}>{h.ticker}</option>)}
              </select>
            </div>

            {allCategories.length > 0 && !projScopeTicker && (
              <div className="growth-filter-group" style={{ position: 'relative' }} ref={projCatRef}>
                <label>Categories</label>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
                  onClick={() => setProjCatOpen(o => !o)}
                >
                  {projCategories.length === 0 && projSubcats.length === 0
                    ? 'All Holdings'
                    : `${projCategories.length + projSubcats.length} selected`}
                  <span style={{ float: 'right', marginLeft: '0.5rem' }}>{projCatOpen ? '▴' : '▾'}</span>
                </button>
                {projCatOpen && (
                  <div className="growth-cat-dropdown">
                    <label className="growth-cat-option" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                      <input type="checkbox" checked={projCategories.length === 0 && projSubcats.length === 0}
                        onChange={() => { setProjCategories([]); setProjSubcats([]) }} />
                      <span>All Holdings</span>
                    </label>
                    {allCategories.map(c => {
                      const catChecked = projCategories.includes(c.name)
                      const subs = c.subcategories || []
                      return (
                        <React.Fragment key={c.id}>
                          <label className="growth-cat-option">
                            <input
                              type="checkbox"
                              checked={catChecked}
                              onChange={e => {
                                if (e.target.checked) {
                                  // Selecting the whole category supersedes any of its
                                  // sub-category selections, so clear those.
                                  const subIds = subs.map(s => String(s.id))
                                  setProjCategories(prev => [...prev, c.name])
                                  setProjSubcats(prev => prev.filter(id => !subIds.includes(id)))
                                } else {
                                  setProjCategories(prev => prev.filter(n => n !== c.name))
                                }
                              }}
                            />
                            <span>{c.name}</span>
                          </label>
                          {subs.map(s => (
                            <label key={`sub-${s.id}`} className="growth-cat-option"
                              style={{ paddingLeft: '1.4rem', opacity: catChecked ? 0.5 : 1 }}>
                              <input type="checkbox" disabled={catChecked}
                                checked={catChecked || projSubcats.includes(String(s.id))}
                                onChange={e => {
                                  if (e.target.checked) setProjSubcats(prev => [...prev, String(s.id)])
                                  else setProjSubcats(prev => prev.filter(id => id !== String(s.id)))
                                }} />
                              <span>{s.name}</span>
                            </label>
                          ))}
                        </React.Fragment>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
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
            <div className="growth-filter-group">
              <label>Market</label>
              <select value={marketType} onChange={e => setMarketType(e.target.value)}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }}>
                {MARKET_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="growth-filter-group">
              <label>Reinvest %</label>
              <input type="number" min="0" max="100" value={reinvestPct}
                onChange={e => setReinvestPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                style={{ width: '80px', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }} />
              {(portfolioReinvestPct != null || actualReinvest) && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {portfolioReinvestPct != null && (
                    <span
                      onClick={() => setReinvestPct(Math.round(portfolioReinvestPct))}
                      title="Use the estimated DRIP mix from your reinvest settings"
                      style={{ cursor: 'pointer', textDecoration: 'underline dotted', color: 'var(--pos-muted)' }}
                    >
                      Est: {portfolioReinvestPct.toFixed(1)}%
                    </span>
                  )}
                  {actualReinvest && (
                    <span
                      onClick={() => setReinvestPct(Math.round(actualReinvest.pct_reinvested))}
                      title={`Actual reinvested share of distributions paid ${actualReinvest.window_start} to ${actualReinvest.window_end} (${actualReinvest.months_with_data} mo of data). Click to use.`}
                      style={{ cursor: 'pointer', textDecoration: 'underline dotted', color: 'var(--p-38bdf8)' }}
                    >
                      Actual 3mo: {actualReinvest.pct_reinvested.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="growth-filter-group">
              <label>Monthly Add</label>
              <input type="number" min="0" value={monthlyContribution}
                onChange={e => setMonthlyContribution(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: '110px', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--p-0a1929)', color: 'var(--p-c5d0dc)', border: '1px solid var(--p-1a3a5c)', borderRadius: '4px' }} />
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
            <StatTile label="TOTAL DISTRIBUTIONS" value={fmt$(data.summary.total_payout)} />
            <StatTile label="DRIP SHARES ADDED" value={fmtShares(data.summary.total_drip_shares)} color="#a855f7" />
            <StatTile label="GROWTH FROM DRIP" value={`${data.summary.drip_pct_of_growth}%`} color="#4dff91"
              sub="share of payout change" />
            <StatTile label="ANNUAL RUN-RATE" value={fmt$(data.summary.run_rate)} color="#f59e0b"
              sub={`most recent ${view === 'weekly' ? 'week' : view === 'yearly' ? 'year' : 'month'} × ${view === 'weekly' ? 52 : view === 'yearly' ? 1 : 12} — current pace, not a year-to-date total`} />
            {data.summary.extra_income_from_drip > 0 && (
              <StatTile label="EXTRA FROM REINVESTING" value={fmt$(data.summary.extra_income_from_drip)} color="#4dff91"
                sub={`+${data.summary.extra_income_pct}% vs. taking the cash`} />
            )}
            {data.summary.pct_reinvested != null && (
              <StatTile label="% REINVESTED" value={`${data.summary.pct_reinvested}%`} color="#38bdf8"
                sub={data.summary.cash_payout > 0 ? `${fmt$(data.summary.cash_payout)} taken as cash` : 'all distributions reinvested'} />
            )}
          </div>

          {scopeTicker && (
            <BreakevenPanel ticker={scopeTicker} holding={holdings.find(h => h.ticker === scopeTicker)} />
          )}

          {hasData ? (
            <>
              <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
                <Plot
                  data={distTraces}
                  layout={themedPlotlyLayout({ ...DARK_LAYOUT, title: { text: 'Distributions Over Time', x: 0.5 }, height: 380, yaxis: { tickprefix: '$', gridcolor: '#293a5f' }, yaxis2: { title: 'Cumulative', tickprefix: '$', overlaying: 'y', side: 'right', gridcolor: 'rgba(0,0,0,0)', rangemode: 'tozero' }, xaxis: xAxis, showlegend: true, legend: { orientation: 'h', y: -0.2 } }, isDark)}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
                <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', margin: '0.25rem 0 0', paddingLeft: '0.5rem' }}>
                  <span style={{ color: 'var(--pos)' }}>■</span> Actual recorded payments&nbsp;&nbsp;
                  <span style={{ color: 'var(--p-38bdf8)' }}>■</span> Reconstructed from price + distribution history&nbsp;&nbsp;
                  <span style={{ color: 'var(--p-94a3b8)' }}>┄</span> Income each period if you had <strong>not</strong> reinvested (taken as cash)&nbsp;&nbsp;
                  <span style={{ color: 'var(--p-f59e0b)' }}>━</span> Cumulative received (right axis)
                </p>
                <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0.15rem 0 0', paddingLeft: '0.5rem', fontStyle: 'italic' }}>
                  The dotted line is the distribution income you'd have collected each period had you taken the cash instead of reinvesting — lower because you'd own fewer shares. The gap above it is the income reinvesting created.
                </p>
                <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0.15rem 0 0', paddingLeft: '0.5rem', fontStyle: 'italic' }}>
                  Reconstruction models your current position reinvested across the window (per-event lot history isn't tracked), hybridized with actual recorded payments where available.
                </p>
              </div>

              {scopeTicker && rateTraces.length > 0 && (
                <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
                  <Plot
                    data={rateTraces}
                    layout={themedPlotlyLayout({ ...DARK_LAYOUT, title: { text: `Distribution per Share — ${scopeTicker}`, x: 0.5 }, height: 320, yaxis: { tickprefix: '$', gridcolor: '#293a5f', rangemode: 'tozero' }, xaxis: xAxis, showlegend: false }, isDark)}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: '100%' }}
                    useResizeHandler
                  />
                  <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0.15rem 0 0', paddingLeft: '0.5rem', fontStyle: 'italic' }}>
                    The fund's actual distribution paid per share each period — a falling trend means payout erosion, independent of how many shares you hold.
                  </p>
                </div>
              )}

              <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
                <Plot
                  data={shareTraces}
                  layout={themedPlotlyLayout({ ...DARK_LAYOUT, title: { text: 'DRIP Share Growth', x: 0.5 }, height: 360, yaxis: { title: 'Shares added', gridcolor: '#293a5f' }, yaxis2: { title: 'Cumulative', overlaying: 'y', side: 'right', gridcolor: 'rgba(0,0,0,0)' }, xaxis: xAxis, legend: { orientation: 'h', y: -0.2 } }, isDark)}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>

              <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.25rem', marginBottom: '-0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setDecompCumulative(false)}
                    style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--p-2a3a5a)', background: decompCumulative ? 'transparent' : 'var(--p-1c2a4b)', color: decompCumulative ? 'var(--text-dim)' : 'var(--p-cfe0ff)' }}
                  >Per period</button>
                  <button
                    type="button"
                    onClick={() => setDecompCumulative(true)}
                    style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--p-2a3a5a)', background: decompCumulative ? 'var(--p-1c2a4b)' : 'transparent', color: decompCumulative ? 'var(--p-cfe0ff)' : 'var(--text-dim)' }}
                  >Cumulative</button>
                </div>
                <Plot
                  data={decompTraces}
                  layout={themedPlotlyLayout({ ...DARK_LAYOUT, title: { text: decompCumulative ? 'Why Payouts Changed (cumulative since window start)' : 'Why Payouts Changed (vs. prior period)', x: 0.5 }, height: 360, barmode: 'relative', yaxis: { tickprefix: '$', gridcolor: '#293a5f' }, xaxis: xAxis, legend: { orientation: 'h', y: -0.2 } }, isDark)}
                  config={{ responsive: true, displayModeBar: false }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
                <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0.15rem 0 0', paddingLeft: '0.5rem', fontStyle: 'italic' }}>
                  {decompCumulative
                    ? 'Running total of each effect since the window start. Green = extra income from DRIP share growth; blue = the fund changing its per-share rate; amber = the interaction of both.'
                    : 'Each bar sums to the net change in payout vs. the prior period. Green = more shares from DRIP; blue = the fund changed its per-share rate; amber = the interaction of both.'}
                </p>
              </div>

              {!scopeTicker && ((data.rate_raises?.length > 0 || data.rate_cuts?.length > 0) || data.summary.drip_off?.length > 0) && (
                <div className="da-chart-panel" style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
                  {(data.rate_raises?.length > 0 || data.rate_cuts?.length > 0) && (
                    <div style={{ flex: '1 1 320px' }}>
                      <h3 style={{ marginTop: 0 }}>Notable rate changes this window</h3>
                      <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
                        Dollar impact of each fund changing its per-share distribution (drives the blue bars above).
                      </p>
                      {data.rate_raises?.length > 0 && (
                        <div style={{ marginBottom: '0.5rem' }}>
                          {data.rate_raises.map(r => (
                            <div key={r.ticker} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.15rem 0' }}>
                              <span><span style={{ color: 'var(--pos)' }}>▲</span> <strong style={{ cursor: 'pointer' }} onClick={() => setScopeTicker(r.ticker)}>{r.ticker}</strong></span>
                              <span style={{ color: 'var(--pos)' }}>+{fmt$(r.rate_impact)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {data.rate_cuts?.length > 0 && data.rate_cuts.map(r => (
                        <div key={r.ticker} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.15rem 0' }}>
                          <span><span style={{ color: 'var(--neg-3)' }}>▼</span> <strong style={{ cursor: 'pointer' }} onClick={() => setScopeTicker(r.ticker)}>{r.ticker}</strong></span>
                          <span style={{ color: 'var(--neg-3)' }}>{fmt$(r.rate_impact)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {data.summary.drip_off?.length > 0 && (
                    <div style={{ flex: '1 1 320px' }}>
                      <h3 style={{ marginTop: 0 }}>DRIP off — cash not compounding</h3>
                      <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0 0 0.5rem', fontStyle: 'italic' }}>
                        These holdings paid distributions but aren't reinvesting — {fmt$(data.summary.cash_payout)} took as cash this window.
                      </p>
                      {data.summary.drip_off.map(d => (
                        <div key={d.ticker} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.15rem 0' }}>
                          <strong style={{ cursor: 'pointer' }} onClick={() => setScopeTicker(d.ticker)}>{d.ticker}</strong>
                          <span style={{ color: 'var(--text-dim)' }}>{fmt$(d.payout)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!scopeTicker && data.per_ticker?.length > 0 && (
                <div className="da-chart-panel">
                  <h3 style={{ marginTop: 0 }}>Top Contributors</h3>
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr><th>Ticker</th><th>Description</th><th style={{ textAlign: 'right' }}>Distributions</th><th style={{ textAlign: 'right' }}>DRIP Shares</th><th>Reinvest</th></tr>
                    </thead>
                    <tbody>
                      {data.per_ticker.map(t => (
                        <tr key={t.ticker} style={{ cursor: 'pointer' }} onClick={() => setScopeTicker(t.ticker)}>
                          <td style={{ fontWeight: 600 }}>{t.ticker}</td>
                          <td style={{ color: 'var(--text-dim)' }}>{t.description}</td>
                          <td style={{ textAlign: 'right' }}>{fmt$(t.total_payout)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--p-a855f7)' }}>{fmtShares(t.total_drip_shares)}</td>
                          <td>{t.reinvest ? '✓' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
              No reinvestment history available for the selected filters and timeframe.
            </div>
          )}
        </>
      )}

      {/* ── Projection view ── */}
      {mode === 'projection' && !loading && projData && (
        <>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <StatTile label="CURRENT ANNUAL INCOME" value={fmt$(projData.current_annual_income)} />
            <StatTile label={`PROJECTED IN ${years}YR`} value={fmt$(projData.projected_annual_income)} color="#4dff91" />
            <StatTile
              label="GROWTH"
              value={projData.current_annual_income > 0
                ? `+${(((projData.projected_annual_income / projData.current_annual_income) - 1) * 100).toFixed(1)}%`
                : '—'}
              color="#f59e0b"
            />
          </div>

          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
            background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.35)',
            borderLeft: '3px solid var(--p-38bdf8)', borderRadius: '6px',
            padding: '0.7rem 0.9rem', margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--p-c5d0dc)', lineHeight: 1.45,
          }}>
            <span style={{ color: 'var(--p-38bdf8)', fontSize: '1rem', fontWeight: 700, flexShrink: 0, lineHeight: 1.3 }}>ⓘ</span>
            <span>
              <strong style={{ color: 'var(--text-strong)' }}>Why this differs from the dashboard:</strong> Current annual income here is
              computed from each holding's latest declared distribution × frequency × shares, so it can differ slightly from the
              dashboard's “Est. Annual Income,” which uses a smoothed per-holding estimate. The two diverge most for
              variable-payout option-income funds.
            </span>
          </div>

          {projScopeTicker && (
            <BreakevenPanel ticker={projScopeTicker} holding={holdings.find(h => h.ticker === projScopeTicker)} />
          )}

          {projTraces.length > 0 ? (
            <div className="da-chart-panel" style={{ marginBottom: '1rem' }}>
              <Plot
                data={projTraces}
                layout={themedPlotlyLayout({ ...DARK_LAYOUT, title: { text: `Projected Income — ${projScopeTicker || 'Whole Portfolio'} (${marketType}, ${reinvestPct}% reinvested)`, x: 0.5 }, height: 420, yaxis: { tickprefix: '$', gridcolor: '#293a5f' }, xaxis: { gridcolor: '#1c2a4b' }, showlegend: false }, isDark)}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>No projection data.</div>
          )}

          {shareGrowthTraces.length > 0 && (
            <div className="da-chart-panel">
              <Plot
                data={shareGrowthTraces}
                layout={themedPlotlyLayout({ ...DARK_LAYOUT, title: { text: `Share Count Growth by Scenario — ${projScopeTicker || 'Whole Portfolio'}`, x: 0.5 }, height: 380, yaxis: { title: 'Total shares', gridcolor: '#293a5f' }, xaxis: { gridcolor: '#1c2a4b' }, legend: { orientation: 'h', y: -0.2 } }, isDark)}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%' }}
                useResizeHandler
              />
              {!projScopeTicker && (
                <p style={{ color: 'var(--p-6a7892)', fontSize: '0.72rem', margin: '0.15rem 0 0', fontStyle: 'italic' }}>
                  Whole-portfolio share count sums shares across funds with different prices — select a single Fund above for a clean per-fund view.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}


