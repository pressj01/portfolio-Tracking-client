import React, { useState, useEffect, useCallback, useId, useMemo, useRef } from 'react'
import { useTheme } from '../context/ThemeContext'
import { chartTheme, themedPlotlyLayout } from '../utils/chartTheme'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { formatMoney, getDisplayCurrency, getMoneyDisplayConfig } from '../utils/money'
import {
  balanceToTargetYield,
  holdingsOverCap,
  monthlyToYieldPct,
  yieldPctToMonthly,
  yieldRange,
  yieldTargetStatus,
} from '../utils/targetYield'
import { GRADING_PREFERENCES_EVENT, gradingSettingsPayload } from '../utils/gradingPreferences'
import { PERFORMANCE_PERIODS } from '../utils/performancePeriods'
import NotFinancialAdviceNotice from '../components/NotFinancialAdviceNotice'

// The Builder grades over Dashboard's calendar windows (same keys, same
// backend resolver), plus Max, which a model with no first trade defines as
// the holdings' common history.
const PERIODS = [
  ...['1m', '3m', '6m', 'ytd', '1y', '2y', '3y', '5y', '10y']
    .map(key => PERFORMANCE_PERIODS.find(p => p.key === key))
    .filter(Boolean),
  {
    key: 'max',
    label: 'Max',
    hint: "The longest stretch every holding has traded. It starts on the youngest holding's first price, so no fund is graded as years of cash.",
  },
]

const PREF_PERIOD = 'portfolioBuilder.period'
const PREF_BENCHMARK = 'portfolioBuilder.benchmark'
const PREF_VIEW = 'portfolioBuilder.columnView'
const PREF_LAST = 'portfolioBuilder.lastPortfolio:'
const PREF_WHOLE_SHARES = 'portfolioBuilder.wholeShares'

// Amounts are stored in USD and shown in the display currency: the factor a
// stored amount is multiplied by to show it.
function moneyRate() {
  const { currency, usdToCadRate } = getMoneyDisplayConfig()
  return currency === 'CAD' && usdToCadRate > 0 ? usdToCadRate : 1
}

// A typed dollar amount such as "150,000" or "$150000.50"; NaN when it is not one.
function parseMoneyText(text) {
  const cleaned = String(text ?? '').trim().replace(/^\$/, '').replace(/,/g, '').trim()
  return cleaned === '' || !/^\d*\.?\d+$|^\d+\.$/.test(cleaned) ? NaN : Number(cleaned)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// Plotly needs concrete colors; a var(--x) silently falls back to its palette.
const CHART = { portfolio: '#64b5f6', benchmark: '#ffb74d', up: '#00c896', down: '#ff5252' }

function readPref(key, fallback) {
  try {
    const value = globalThis.localStorage?.getItem(key)
    return value == null || value === '' ? fallback : value
  } catch {
    return fallback
  }
}

function writePref(key, value) {
  try {
    globalThis.localStorage?.setItem(key, String(value))
  } catch {
    /* storage blocked: the preference just isn't remembered */
  }
}

const isNum = v => v != null && v !== '' && Number.isFinite(Number(v))
const fmt$ = v => (isNum(v) ? formatMoney(Number(v), { fallback: '--' }) : '--')
const fmtN = (v, dec = 2) => (isNum(v) ? Number(v).toFixed(dec) : '--')
function fmtPct(v, dec = 1, signed = false) {
  if (!isNum(v)) return '--'
  const n = Number(v)
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(dec)}%`
}
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const signedColor = v => (!isNum(v) || Number(v) === 0 ? undefined : Number(v) > 0 ? 'var(--pos)' : 'var(--neg)')

function letterClass(grade) {
  return ({ A: 'a', B: 'b', C: 'c', D: 'd', F: 'f' })[String(grade || '')[0]] || 'na'
}

function GradeBadge({ grade, large }) {
  const shown = grade && grade !== 'N/A' ? grade : 'N/A'
  return <span className={`grade-badge grade-${letterClass(grade)} ${large ? 'grade-lg' : ''}`}>{shown}</span>
}

// Cell color from the user's own grading bands, so a green Sharpe is one the
// grade also scores as excellent.
const BAND_COLORS = ['var(--pos)', 'var(--accent)', 'var(--p-ffb74d)', 'var(--neg)']
function bandColor(value, settings, band) {
  if (!band || !isNum(value) || !settings) return undefined
  const [direction, metric] = band
  const bands = settings[direction]?.[metric]
  if (!bands) return undefined
  const v = Number(value)
  const lower = direction === 'lowerBands'
  const idx = [bands.excellent, bands.good, bands.fair].findIndex(limit => (lower ? v <= limit : v >= limit))
  return BAND_COLORS[idx === -1 ? 3 : idx]
}

const COLUMN_GROUPS = {
  position: 'Position',
  grade: 'Grade',
  risk: 'Risk (colored by your grade bands)',
  return: 'Return over the window',
  income: 'Income (estimated)',
}

const COLUMNS = [
  { key: 'ticker', label: 'Ticker', group: 'position', align: 'left', sticky: true },
  { key: 'dollar_amount', label: 'Amount', group: 'position', fmt: fmt$, title: 'Dollars in this holding. Click an amount to edit it.' },
  {
    key: 'running_total',
    label: 'Running Total',
    group: 'position',
    fmt: fmt$,
    noSort: true,
    title: 'This amount plus every amount above it, in the order shown. With a starting balance, it turns green where the holdings fill it and red past it.',
  },
  { key: 'weight_pct', label: 'Wt %', group: 'position', fmt: v => fmtN(v, 1) },
  { key: 'shares', label: 'Shares', group: 'position', fmt: v => fmtN(v, 2), title: 'Amount ÷ latest close.' },
  { key: 'current_price', label: 'Price', group: 'position', fmt: fmt$, title: 'Latest close.' },
  { key: 'grade', label: 'Grade', group: 'grade', align: 'center', sortKey: 'score', title: 'Holding grade, computed exactly as the Dashboard grades a holding.' },
  { key: 'score', label: 'Score', group: 'grade', fmt: v => fmtN(v, 1) },
  { key: 'ulcer_index', label: 'Ulcer', group: 'risk', fmt: v => fmtN(v, 2), band: ['lowerBands', 'ulcerIndex'], title: 'Ulcer Index: depth and length of drawdowns. Lower is better.' },
  { key: 'sharpe', label: 'Sharpe', group: 'risk', fmt: v => fmtN(v, 2), band: ['higherBands', 'sharpe'], title: 'Excess return per unit of volatility (5% risk-free rate).' },
  { key: 'sortino', label: 'Sortino', group: 'risk', fmt: v => fmtN(v, 2), band: ['higherBands', 'sortino'], title: 'Excess return per unit of downside volatility.' },
  { key: 'calmar', label: 'Calmar', group: 'risk', fmt: v => fmtN(v, 2), band: ['higherBands', 'calmar'], title: 'Annualized return ÷ maximum drawdown.' },
  { key: 'omega', label: 'Omega', group: 'risk', fmt: v => fmtN(v, 2), band: ['higherBands', 'omega'], title: 'Sum of daily gains ÷ sum of daily losses.' },
  { key: 'max_drawdown', label: 'Max DD %', group: 'risk', fmt: v => fmtN(v, 1), band: ['lowerBands', 'maxDrawdown'], abs: true, title: 'Largest peak-to-trough fall in the window.' },
  { key: 'down_capture', label: 'Down Cap', group: 'risk', fmt: v => fmtN(v, 1), band: ['lowerBands', 'downCapture'], title: "Share of the benchmark's down-day losses taken. Lower is better." },
  { key: 'up_capture', label: 'Up Cap', group: 'risk', fmt: v => fmtN(v, 1), title: "Share of the benchmark's up-day gains kept." },
  { key: 'annual_vol', label: 'Vol %', group: 'risk', fmt: v => fmtN(v, 1), title: 'Annualized volatility of daily returns.' },
  { key: 'total_return_pct', label: 'Total Ret %', group: 'return', fmt: v => fmtPct(v, 1, true), signed: true, title: 'Return over the window with distributions reinvested.' },
  { key: 'price_change_pct', label: 'Price Δ %', group: 'return', fmt: v => fmtPct(v, 1, true), signed: true, title: 'Price (NAV) change alone, before distributions. A high yield with a falling price is NAV erosion.' },
  { key: 'annual_ret', label: 'Ann Ret %', group: 'return', fmt: v => fmtPct(v, 1, true), signed: true, title: 'Total return, annualized. Blank when the history is too short to annualize.' },
  { key: 'annual_yield_pct', label: 'Yield %', group: 'income', fmt: v => fmtN(v, 2), title: 'Forward distribution yield: the fund’s recent payments annualized at their current cadence (TappAlpha funds use the issuer rate; Yahoo’s quote is the last resort).' },
  { key: 'annual_income', label: 'Annual Inc', group: 'income', fmt: fmt$ },
  { key: 'monthly_income', label: 'Monthly Inc', group: 'income', fmt: fmt$ },
]

const COLUMN_VIEWS = [
  { key: 'all', label: 'All columns', groups: ['position', 'grade', 'risk', 'return', 'income'] },
  { key: 'risk', label: 'Risk', groups: ['position', 'grade', 'risk'] },
  { key: 'income', label: 'Return & income', groups: ['position', 'grade', 'return', 'income'] },
]

const FACTORS = {
  'Ulcer Index': { value: pm => fmtN(pm.ulcer_index), help: 'Depth and length of drawdowns. Lower is better.' },
  'Calmar Ratio': { value: pm => fmtN(pm.calmar), help: 'Annualized return ÷ maximum drawdown.' },
  'Omega Ratio': { value: pm => fmtN(pm.omega), help: 'Sum of daily gains ÷ sum of daily losses.' },
  'Sortino Ratio': { value: pm => fmtN(pm.sortino), help: 'Excess return per unit of downside volatility.' },
  'Sharpe Ratio': { value: pm => fmtN(pm.sharpe), help: 'Excess return per unit of volatility.' },
  'Max Drawdown': { value: pm => (isNum(pm.max_drawdown) ? fmtPct(pm.max_drawdown * 100) : '--'), help: 'Largest peak-to-trough fall.' },
  'Downside Capture': { value: pm => fmtPct(pm.down_capture), help: "Share of the benchmark's down-day losses taken." },
  'Capture Ratio': { value: pm => fmtN(pm.capture_ratio), help: 'Upside capture ÷ downside capture.' },
  Diversification: { value: pm => (isNum(pm.effective_n) ? `${fmtN(pm.effective_n, 1)} eff.` : '--'), help: 'Effective number of holdings: 1 ÷ the sum of squared weights.' },
  'Diversification Ratio': { value: pm => fmtN(pm.diversification_ratio), help: 'Weighted holding volatility ÷ portfolio volatility. 1.0 means no diversification benefit.' },
}
const FACTOR_ORDER = Object.keys(FACTORS)

const COMPARE_METRICS = [
  { key: 'score', label: 'Score', dec: 1, better: 'higher' },
  { key: 'total_return_pct', label: 'Total Ret', kind: 'pct', better: 'higher' },
  { key: 'yield_pct', label: 'Yield', kind: 'pct', dec: 2, better: 'higher' },
  { key: 'monthly_income', label: 'Mo Income', kind: 'money', better: 'sameSizeHigher' },
  { key: 'sharpe', label: 'Sharpe', better: 'higher' },
  { key: 'sortino', label: 'Sortino', better: 'higher' },
  { key: 'calmar', label: 'Calmar', better: 'higher' },
  { key: 'omega', label: 'Omega', better: 'higher' },
  { key: 'ulcer_index', label: 'Ulcer', better: 'lower' },
  // Stored as a negative fraction: the shallower (closer to zero) one wins.
  { key: 'max_drawdown', label: 'Max DD', kind: 'fraction', better: 'shallower' },
  { key: 'capture_ratio', label: 'Capture', better: 'higher' },
  { key: 'effective_n', label: 'Eff N', dec: 1, better: 'higher' },
  { key: 'diversification_ratio', label: 'Div Ratio', better: 'higher' },
  { key: 'beta', label: 'Beta', better: null },
]

function compareValue(metric, row) {
  const v = row[metric.key]
  if (!isNum(v)) return null
  return metric.better === 'shallower' ? Math.abs(Number(v)) : Number(v)
}

function fmtCompare(metric, v) {
  if (!isNum(v)) return '--'
  if (metric.kind === 'money') return fmt$(v)
  if (metric.kind === 'fraction') return fmtPct(Number(v) * 100)
  if (metric.kind === 'pct') return fmtPct(v, metric.dec ?? 1)
  return Number(v).toFixed(metric.dec ?? 2)
}

function compareWinners(results) {
  const totals = results.map(r => Number(r.total_value) || 0)
  const sameSize = totals.length > 1 && Math.max(...totals) - Math.min(...totals) <= Math.max(...totals) * 0.01
  return COMPARE_METRICS.map(metric => {
    if (!metric.better || (metric.better === 'sameSizeHigher' && !sameSize)) return { best: [], worst: [] }
    const values = results.map(r => compareValue(metric, r))
    const present = values.filter(v => v != null)
    if (present.length < 2) return { best: [], worst: [] }
    const lowerWins = metric.better === 'lower' || metric.better === 'shallower'
    const bestValue = lowerWins ? Math.min(...present) : Math.max(...present)
    const worstValue = lowerWins ? Math.max(...present) : Math.min(...present)
    if (bestValue === worstValue) return { best: [], worst: [] }
    return {
      best: values.map((v, i) => (v === bestValue ? i : -1)).filter(i => i >= 0),
      worst: values.map((v, i) => (v === worstValue ? i : -1)).filter(i => i >= 0),
    }
  })
}

// ── Report card ──────────────────────────────────────────────────────────────

function ReportCard({ pm, benchmark, stale }) {
  const grade = pm.grade || {}
  const breakdown = [...(grade.breakdown || [])].sort(
    (a, b) => FACTOR_ORDER.indexOf(a.category) - FACTOR_ORDER.indexOf(b.category),
  )
  const stats = [
    { label: 'Total value', value: fmt$(pm.total_value) },
    { label: 'Est. annual income', value: fmt$(pm.est_annual_income), sub: isNum(pm.yield_pct) ? `${fmtPct(pm.yield_pct, 2)} yield` : null },
    { label: 'Est. monthly income', value: fmt$(pm.est_monthly_income) },
    {
      label: 'Total return',
      value: fmtPct(pm.total_return_pct, 1, true),
      color: signedColor(pm.total_return_pct),
      sub: isNum(pm.benchmark_total_return_pct) ? `${benchmark} ${fmtPct(pm.benchmark_total_return_pct, 1, true)}` : null,
    },
    { label: 'Annualized return / vol', value: `${fmtPct(pm.annual_ret, 1, true)} / ${fmtPct(pm.annual_vol)}` },
    { label: `Beta vs ${benchmark}`, value: fmtN(pm.beta) },
    { label: 'Up / down capture', value: `${fmtN(pm.up_capture, 0)} / ${fmtN(pm.down_capture, 0)}` },
    { label: 'Largest holding', value: fmtPct(pm.top_weight) },
  ]
  return (
    <div className={`card pb-card ${stale ? 'pb-is-stale' : ''}`}>
      <div className="pb-card-head">
        <h3>Portfolio Report Card</h3>
        <span className="pb-muted">Same formula, bands, and weights as the Dashboard grade (Settings › Grading)</span>
      </div>
      <div className="pb-report">
        <div className="pb-grade-ring">
          <GradeBadge grade={grade.overall} large />
          <div className="pb-score">{isNum(grade.score) ? `${fmtN(grade.score, 1)} / 100` : 'Not graded'}</div>
          <div className="pb-muted">{pm.n_graded} of {pm.n_holdings} holdings graded</div>
        </div>

        <div className="pb-breakdown">
          {breakdown.length > 0 && (
            <div className="pb-breakdown-row pb-breakdown-head">
              <span>Factor</span><span>Value</span><span>Score</span><span /><span>Grade</span><span title="Each factor's share of the grade">Weight</span>
            </div>
          )}
          {breakdown.map(b => {
            const letter = letterClass(b.grade)
            return (
              <div key={b.category} className="pb-breakdown-row" title={FACTORS[b.category]?.help}>
                <span className="pb-breakdown-label">{b.category}</span>
                <span className="pb-breakdown-value">{FACTORS[b.category]?.value(pm) ?? '--'}</span>
                <span className="pb-breakdown-score">{fmtN(b.score, 0)}</span>
                <span className="pb-breakdown-bar-bg">
                  <span className={`pb-breakdown-bar pb-fill-${letter}`} style={{ width: `${Math.max(0, Math.min(100, b.score))}%` }} />
                </span>
                <span className={`pb-breakdown-grade pb-letter-${letter}`}>{b.grade}</span>
                <span className="pb-breakdown-weight">{fmtN(b.weight_pct ?? b.weight, 1)}%</span>
              </div>
            )
          })}
          {!breakdown.length && <div className="pb-muted">No factor could be measured in this window.</div>}
        </div>

        <div className="pb-stat-grid">
          {stats.map(s => (
            <div key={s.label} className="pb-stat-card">
              <div className="pb-stat-val" style={s.color ? { color: s.color } : undefined}>{s.value}</div>
              <div className="pb-stat-lbl">{s.label}</div>
              {s.sub && <div className="pb-stat-sub">{s.sub}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Window and data notes ────────────────────────────────────────────────────

function AnalysisNotes({ data }) {
  const w = data.window || {}
  const n = data.notices || {}
  const shortSet = new Set((n.short_history || []).map(s => s.ticker))
  const late = (n.late_starters || []).filter(s => !shortSet.has(s.ticker))
  // Only a portfolio saved before amounts had to be positive can hold these.
  const unfunded = (data.holdings || []).filter(h => !(Number(h.dollar_amount) > 0)).map(h => h.ticker)
  const range = w.actual_start_date ? `${fmtDate(w.actual_start_date)} – ${fmtDate(w.actual_end_date)}` : 'no dates'
  return (
    <div className="pb-notes">
      <p className="pb-window-note">
        <strong>{w.period_label}:</strong> {range} · {w.window_observations ?? 0} trading days · benchmark {w.benchmark}
        {w.limited_by ? ` · starts at ${w.limited_by}'s first price` : ''}
        {w.benchmark && w.benchmark !== 'SPY' && (
          <span className="pb-muted"> · The Dashboard grades against SPY, so capture factors here differ from it.</span>
        )}
      </p>
      {w.window_too_short && (
        <div className="pb-notice pb-notice-warn">
          Only {w.window_observations ?? 0} trading days in this window. The risk ratios annualize daily returns and need
          at least 15, so nothing is graded. Pick a longer period.
        </div>
      )}
      {!w.benchmark_priced && (
        <div className="pb-notice pb-notice-warn">
          No prices for the benchmark {w.benchmark}, so downside capture and capture ratio are left out of the grade.
        </div>
      )}
      {unfunded.length > 0 && (
        <div className="pb-notice pb-notice-warn">
          <strong>No dollar amount:</strong> {unfunded.join(', ')}. A holding needs an amount above $0 to count in the
          portfolio grade. Click its amount to set one.
        </div>
      )}
      {n.unpriced?.length > 0 && (
        <div className="pb-notice pb-notice-bad">
          <strong>No price history:</strong> {n.unpriced.join(', ')}. Check the symbol. These holdings are not graded and
          carry no weight in the portfolio grade.
        </div>
      )}
      {n.short_history?.length > 0 && (
        <div className="pb-notice pb-notice-warn">
          <strong>Too new to grade in this window:</strong>{' '}
          {n.short_history.map(s => `${s.ticker} (since ${fmtDate(s.first_date)}, ${s.observations} days)`).join(', ')}.
          They are left out of the portfolio grade, as the Dashboard does.
        </div>
      )}
      {late.length > 0 && (
        <div className="pb-notice">
          <strong>Started trading inside the window:</strong>{' '}
          {late.map(s => `${s.ticker} (${fmtDate(s.first_date)})`).join(', ')}. Before its first price each counts as cash
          (0% return) in the portfolio grade, the Dashboard's convention. Choose <strong>Max</strong> to grade only the
          stretch every holding has traded.
        </div>
      )}
    </div>
  )
}

// ── Target yield ─────────────────────────────────────────────────────────────

const BALANCE_HELP = 'Moves dollars out of the lower-yielding holdings and into the higher-yielding ones, '
  + 'just far enough to reach the target. No holding is removed, holdings with the same yield keep their '
  + 'proportions, and each share count follows its new amount. You can undo it.'
const CAP_HELP = 'Brings every holding down to the max per holding and spreads the difference over the others, '
  + 'keeping the yield as close to where it is as the cap allows (and never below the target). You can undo it.'

const listTickers = items => {
  const names = items.map(i => i.ticker)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
}

function blockedReason(plan) {
  if (!plan || plan.ok) return null
  switch (plan.reason) {
    case 'above_max':
      return plan.cap != null
        ? `With no holding above ${fmtN(plan.cap, 0)}%, these holdings reach at most ${fmtPct(plan.maxYieldPct, 2)}. Add a higher-yielding holding, raise the max per holding, or lower the target.`
        : `No mix of these holdings gets there: with everything in ${plan.maxTicker}, the highest yielder, the portfolio would yield ${fmtPct(plan.maxYieldPct, 2)}. Add a higher-yielding holding or lower the target.`
    case 'cap_too_low':
      return `A ${fmtN(plan.cap, 0)}% max per holding needs at least ${plan.minHoldings} holdings to hold every dollar. Add holdings or raise the max.`
    case 'no_price':
      return 'Whole shares needs a price for every holding. Turn Whole shares off, or fix the symbol that has no price.'
    case 'no_spread':
      return 'There is nothing to shift between: add a higher-yielding holding or lower the target.'
    default:
      return 'No mix of these holdings reaches it.'
  }
}

/**
 * The holdings table's last row: the cash still to invest (or how far the
 * holdings are over the starting balance) and a bar of how much is invested.
 */
function BalanceProgressRow({ balance, invested, span }) {
  const left = balance - invested
  const pct = balance > 0 ? (invested / balance) * 100 : 0
  const state = Math.abs(left) < 0.005 ? 'full' : left > 0 ? 'under' : 'over'
  const label = state === 'over' ? 'Over by' : 'Cash left'
  const summary = state === 'full'
    ? `Fully invested: ${fmt$(invested)} of the ${fmt$(balance)} starting balance.`
    : state === 'over'
      ? `${fmt$(invested)} invested: ${fmtPct(pct, 1)} of the ${fmt$(balance)} starting balance.`
      : `${fmt$(invested)} of the ${fmt$(balance)} starting balance invested (${fmtPct(pct, 1)}).`
  return (
    <tr className={`pb-total-row pb-cash-row pb-cash-${state}`}>
      <td className="pb-sticky pb-left">{label}</td>
      <td className="pb-dollar-cell">{fmt$(Math.abs(left))}</td>
      <td colSpan={span}>
        <div className="pb-progress-wrap">
          <div
            className="pb-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(pct, 100))}
            aria-label="Share of the starting balance invested"
          >
            <span style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className="pb-progress-text">{summary}</span>
        </div>
      </td>
    </tr>
  )
}

/** How the holdings compare with the starting balance, and the Scale button. */
function BalanceNotice({ balance, invested, undone, busy, onScale, onUndo }) {
  if (!undone) {
    return (
      <div className="pb-notice pb-target pb-target-met" role="status">
        <span>
          <strong>Scaled every holding to fill the {fmt$(balance)} starting balance.</strong> The mix, and so the
          yield, is unchanged.
        </span>
        <button type="button" className="btn btn-secondary pb-btn-sm" onClick={onUndo} disabled={busy}>Undo</button>
      </div>
    )
  }
  const gap = balance - invested
  const pct = balance > 0 ? (invested / balance) * 100 : 0
  return (
    <div className="pb-notice pb-target" role="status">
      <span>
        {gap > 0
          ? <><strong>{fmt$(gap)} of the {fmt$(balance)} starting balance is not invested</strong> ({fmtPct(pct, 1)} invested).</>
          : <><strong>The holdings total {fmt$(invested)}, {fmt$(-gap)} over the {fmt$(balance)} starting balance.</strong></>}
      </span>
      <button
        type="button"
        className="btn btn-secondary pb-btn-sm"
        onClick={onScale}
        disabled={busy}
        title="Scale every holding by the same factor so they add up to the starting balance. The mix stays the same. You can undo it."
      >Scale holdings to {fmt$(balance)}</button>
    </div>
  )
}

/**
 * The line under the Add row: where the portfolio stands against its target
 * (in the unit the target was set in, with the other beside it), any holding
 * over the max per holding, and the one button that fixes either.
 */
function TargetYieldNotice({
  status, plan, overCap, cap, monthlyTarget, undo, topHolding, total, busy, onBalance, onUndo,
}) {
  const monthlyAt = y => (isNum(y) && total > 0 ? (total * y) / 1200 : null)
  const current = `${fmtPct(status.yieldPct, 2)} (${fmt$(monthlyAt(status.yieldPct))}/mo)`
  const hasTarget = status.status !== 'none'
  const target = !hasTarget ? null
    : monthlyTarget != null
      ? `${fmt$(monthlyTarget)}/mo target (${fmtPct(status.targetPct, 2)} yield)`
      : `${fmtPct(status.targetPct, 2)} target (${fmt$(monthlyAt(status.targetPct))}/mo)`
  const capNote = overCap.length
    ? ` ${listTickers(overCap)} ${overCap.length === 1 ? 'is' : 'are'} above the ${fmtN(cap, 0)}% max per holding.`
    : ''

  if (undo) {
    const lead = undo.kind === 'cap'
      ? `Capped every holding at ${fmtN(cap, 0)}%; yield is now ${current}.`
      : `Balanced to ${current}.`
    const totalNote = undo.wholeShares && undo.cash > 0.005
      ? ` In whole shares: ${fmt$(undo.cash)} is left over as cash, so the total invested is now ${fmt$(total)}.`
      : ` The total invested is still ${fmt$(total)}.`
    const concentration = cap == null && topHolding && topHolding.weight_pct >= 50
      ? ` ${topHolding.ticker} is now ${fmtPct(topHolding.weight_pct, 0)} of the portfolio; set a Max per holding to limit that.`
      : ''
    return (
      <div className="pb-notice pb-target pb-target-met" role="status">
        <span><strong>{lead}</strong> Moved {fmt$(undo.moved)} between holdings.{totalNote}{concentration}</span>
        <button type="button" className="btn btn-secondary pb-btn-sm" onClick={onUndo} disabled={busy}>Undo</button>
      </div>
    )
  }

  const blocked = blockedReason(plan)
  const button = plan?.ok && (
    <button
      type="button"
      className="btn btn-primary pb-btn-sm"
      onClick={onBalance}
      disabled={busy}
      title={plan.kind === 'cap' ? CAP_HELP : BALANCE_HELP}
    >{plan.kind === 'cap' ? 'Apply max per holding' : 'Balance to target'}</button>
  )

  if (status.status === 'short') {
    const gap = monthlyTarget != null
      ? `${fmt$(monthlyTarget - monthlyAt(status.yieldPct))}/mo short of the ${target}`
      : `${fmtN(-status.gapPct, 2)} pts below the ${target}, about ${fmt$(status.incomeShort)} a year short`
    return (
      <div className="pb-notice pb-notice-warn pb-target" role="status">
        <span><strong>Yield {current}</strong> is {gap}.{capNote}{blocked ? ` ${blocked}` : ''}</span>
        {button}
      </div>
    )
  }

  const standing = hasTarget
    ? <><strong>Yield {current}</strong> meets the {target}{status.gapPct >= 0.005 ? `, ${fmtN(status.gapPct, 2)} pts above it` : ''}.</>
    : <><strong>Yield {current}.</strong></>
  return (
    <div className={`pb-notice pb-target ${overCap.length ? 'pb-notice-warn' : 'pb-target-met'}`} role="status">
      <span>{standing}{capNote}{overCap.length && blocked ? ` ${blocked}` : ''}</span>
      {overCap.length > 0 && button}
    </div>
  )
}

// ── Compare ──────────────────────────────────────────────────────────────────

function CompareResults({ result, radarRef, onClose }) {
  const res = result.results || []
  const winners = compareWinners(res)
  const wins = res.map((_, i) => winners.filter(w => w.best.includes(i)).length)
  const pair = res.length === 2
  const starts = [...new Set(res.map(r => r.window?.actual_start_date).filter(Boolean))]
  return (
    <div className="card pb-card">
      <div className="pb-card-head">
        <h3>Comparison · {result.period_label} · vs {result.benchmark}</h3>
        <button type="button" className="btn btn-secondary pb-btn-sm" onClick={onClose}>Close</button>
      </div>
      {res.length > 1 && (
        <div className="pb-compare-wins">
          {res.map((r, i) => <span key={r.id}><strong>{r.name}</strong>: best on {wins[i]}</span>)}
        </div>
      )}
      {starts.length > 1 && (
        <div className="pb-notice">
          The windows differ ({res.map(r => `${r.name} from ${fmtDate(r.window?.actual_start_date)}`).join('; ')}).
          Max uses each portfolio's own common history.
        </div>
      )}
      {result.skipped?.length > 0 && (
        <div className="pb-notice pb-notice-warn">
          Not compared: {result.skipped.map(s => `${s.name} (${s.reason})`).join('; ')}.
        </div>
      )}
      {res.length > 0 && <div ref={radarRef} className="pb-chart pb-chart-radar" />}
      {res.length > 0 && (
        <div className="pb-table-wrap">
          <table className="pb-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Portfolio</th>
                <th style={{ textAlign: 'center' }}>Grade</th>
                {COMPARE_METRICS.map(m => <th key={m.key}>{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {res.map((r, ri) => (
                <tr key={r.id}>
                  <td style={{ textAlign: 'left' }}>{r.name}</td>
                  <td style={{ textAlign: 'center' }}><GradeBadge grade={r.grade} /></td>
                  {COMPARE_METRICS.map((m, mi) => {
                    const best = winners[mi].best.includes(ri)
                    const worst = !best && winners[mi].worst.includes(ri)
                    return (
                      <td key={m.key} className={best ? 'pb-win' : worst ? 'pb-lose' : undefined}>
                        {fmtCompare(m, r[m.key])}{best ? ' ▲' : worst ? ' ▼' : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {pair && (
                <tr className="pb-total-row">
                  <td style={{ textAlign: 'left' }}>Difference</td>
                  <td />
                  {COMPARE_METRICS.map(m => {
                    const a = res[0][m.key]
                    const b = res[1][m.key]
                    if (!isNum(a) || !isNum(b)) return <td key={m.key}>--</td>
                    const diff = Number(a) - Number(b)
                    const text = m.kind === 'money'
                      ? `${diff >= 0 ? '+' : '-'}${fmt$(Math.abs(diff))}`
                      : m.kind === 'fraction' ? fmtPct(diff * 100, 1, true)
                        : m.kind === 'pct' ? fmtPct(diff, m.dec ?? 1, true)
                          : `${diff > 0 ? '+' : ''}${diff.toFixed(m.dec ?? 2)}`
                    return <td key={m.key} className="pb-muted">{text}</td>
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Strategy templates ───────────────────────────────────────────────────────

const STRATEGIES = [
  {
    key: 'all_weather', label: 'All Weather', title: 'All Weather Portfolio',
    blurb: 'Ray Dalio-style allocation: 30% Stocks, 40% Long Bonds, 15% Intermediate Bonds, 5-7.5% Gold, 2.5% Silver (income), 7.5% Commodities.',
  },
  {
    key: 'income_factory', label: 'Income Factory', title: "Bavaria's Income Factory",
    blurb: 'Steven Bavaria-style Income Factory: ~2/3 credit (HY bonds, CLOs, BDCs) + ~1/3 equity-income (covered calls, REITs, MLPs, preferred). Target 8-10%+ yield.',
  },
  {
    key: 'covered_call', label: 'Covered Call', title: 'Covered Call Income',
    blurb: 'Option-premium focused: heavy covered-call ETFs (S&P 500, Nasdaq, single-stock) for maximum monthly income, anchored with dividend growth and bonds. Target 10-15%+ yield.',
  },
  {
    key: 'dividend_growth', label: 'Dividend Growth', title: 'Dividend Growth',
    blurb: 'Focus on companies with strong, growing dividends — aristocrats, quality payers, and international diversification. Lower current yield but rising income stream.',
  },
  {
    key: 'retirement_income', label: 'Retirement', title: 'Retirement Income',
    blurb: '3-bucket strategy: cash/short bonds for near-term spending, intermediate bonds for stability, equities and covered calls for long-term growth and income.',
  },
  {
    key: 'growth', label: 'Growth', title: 'Growth Portfolio',
    blurb: 'Capital appreciation focused: heavy US large-cap growth, Nasdaq/tech, semiconductors, and innovation. Minimal income, maximum growth potential.',
  },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PortfolioBuilder() {
  const { isDark } = useTheme()
  // Per-instance ids: Split View can mount this page in both panes, and a
  // label or datalist pointing at a repeated id resolves to the other pane's
  // field.
  const uid = useId()
  const pf = useProfileFetch()
  const { profileQueryString, currentProfileName } = useProfile()
  const dialog = useDialog()

  // Portfolio list
  const [portfolios, setPortfolios] = useState([])
  const [portfoliosLoaded, setPortfoliosLoaded] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  // Enter, Escape, and the blur that follows either must settle a rename once.
  const renameDoneRef = useRef(false)

  // Holdings
  const [holdings, setHoldings] = useState([])
  const [holdingsFor, setHoldingsFor] = useState(null)
  const [tickerInput, setTickerInput] = useState('')
  const [dollarInput, setDollarInput] = useState('')
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // { ticker, field: 'ticker' | 'amount' | 'shares' }
  const committingRef = useRef(false)

  // Target yield
  const [targetInput, setTargetInput] = useState('')
  const [targetMode, setTargetMode] = useState('yield') // 'yield' (%) or 'monthly' ($ a month)
  const [capInput, setCapInput] = useState('')
  const [balanceInput, setBalanceInput] = useState('')
  const [scaleUndo, setScaleUndo] = useState(null) // { pid, changes } from the last Scale
  const [wholeShares, setWholeSharesState] = useState(() => readPref(PREF_WHOLE_SHARES, '0') === '1')
  const [balanceUndo, setBalanceUndo] = useState(null) // { pid, changes, moved, cash, kind, wholeShares }
  const [exporting, setExporting] = useState(null)

  // Analysis
  const [period, setPeriodState] = useState(() => {
    const saved = readPref(PREF_PERIOD, '1y')
    return PERIODS.some(p => p.key === saved) ? saved : '1y'
  })
  const [benchmark, setBenchmarkState] = useState(() => readPref(PREF_BENCHMARK, 'SPY'))
  const [benchInput, setBenchInput] = useState(benchmark)
  const [gradingVersion, setGradingVersion] = useState(0)
  const [analysis, setAnalysis] = useState(null) // { key, pid, data }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const analysisSeq = useRef(0)
  const holdingsSeq = useRef(0)

  // Table
  const [columnView, setColumnViewState] = useState(() => {
    const saved = readPref(PREF_VIEW, 'all')
    return COLUMN_VIEWS.some(v => v.key === saved) ? saved : 'all'
  })
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)

  // Compare
  const [compareIds, setCompareIds] = useState([])
  const [compareResult, setCompareResult] = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState(null)

  // Strategies
  const [awOpen, setAwOpen] = useState(false)
  const [awStrategy, setAwStrategy] = useState('all_weather')
  const [awMode, setAwMode] = useState('income')
  const [awBudget, setAwBudget] = useState('100000')
  const [awFundsPerClass, setAwFundsPerClass] = useState(1)
  const [awSelectionMode, setAwSelectionMode] = useState('auto')
  const [awResult, setAwResult] = useState(null)
  const [awLoading, setAwLoading] = useState(false)
  const [awError, setAwError] = useState(null)
  const [awOverrides, setAwOverrides] = useState({})
  const [rebalanceResult, setRebalanceResult] = useState(null)
  const [rebalanceLoading, setRebalanceLoading] = useState(false)

  // Chart containers are reached through refs, never by id: Split View can
  // mount this page in both panes, and an id lookup returns the other pane's
  // element.
  const growthRef = useRef(null)
  const scatterRef = useRef(null)
  const corrRef = useRef(null)
  const drawdownRef = useRef(null)
  const radarRef = useRef(null)

  const active = portfolios.find(p => p.id === activeId) || null
  const activeName = active?.name || ''
  const positive = v => (isNum(v) && Number(v) > 0 ? Number(v) : null)
  const savedTargetYield = positive(active?.target_yield_pct)
  const savedMonthly = positive(active?.target_monthly_income) // USD a month
  const savedCap = positive(active?.max_weight_pct)
  const savedBalance = positive(active?.starting_balance) // USD
  const balanceInputFor = useCallback(
    () => (savedBalance == null ? '' : String(Math.round(savedBalance * moneyRate() * 100) / 100)),
    [savedBalance],
  )

  useEffect(() => {
    setBalanceInput(balanceInputFor())
  }, [activeId, balanceInputFor])

  // The target box in a unit: a monthly amount shows in the display currency.
  const targetInputFor = useCallback((mode) => {
    if (mode === 'monthly') {
      return savedMonthly == null ? '' : String(Math.round(savedMonthly * moneyRate() * 100) / 100)
    }
    return savedTargetYield == null ? '' : String(savedTargetYield)
  }, [savedMonthly, savedTargetYield])

  // A saved target opens in the unit it was set in; with none, the unit stays.
  useEffect(() => {
    const mode = savedMonthly != null ? 'monthly' : savedTargetYield != null ? 'yield' : null
    if (mode) setTargetMode(mode)
    setTargetInput(targetInputFor(mode || 'yield'))
  }, [activeId, savedMonthly, savedTargetYield, targetInputFor])

  useEffect(() => {
    setCapInput(savedCap == null ? '' : String(savedCap))
  }, [activeId, savedCap])

  const send = useCallback(async (path, method, body) => {
    const res = await pf(path, {
      method,
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) throw new Error(data.error || `Request failed (HTTP ${res.status})`)
    return data
  }, [pf])

  // ── Portfolio list ─────────────────────────────────────────────────────────
  const loadPortfolios = useCallback(async () => {
    try {
      const res = await pf('/api/builder/portfolios')
      const data = await res.json()
      const list = data.portfolios || []
      setPortfolios(list)
      return list
    } catch (e) {
      console.error(e)
      return null
    } finally {
      setPortfoliosLoaded(true)
    }
  }, [pf])

  const selectPortfolio = useCallback((pid) => {
    setActiveId(pid)
    if (pid) writePref(PREF_LAST + profileQueryString, pid)
  }, [profileQueryString])

  // A different account has its own model portfolios: start over, then reopen
  // the one last used there.
  useEffect(() => {
    let cancelled = false
    setActiveId(null)
    setCompareIds([])
    setCompareResult(null)
    setPortfoliosLoaded(false)
    loadPortfolios().then(list => {
      if (cancelled || !list || !list.length) return
      const saved = Number(readPref(PREF_LAST + profileQueryString, ''))
      setActiveId((list.find(p => p.id === saved) || list[0]).id)
    })
    return () => { cancelled = true }
  }, [loadPortfolios, profileQueryString])

  // ── Holdings ───────────────────────────────────────────────────────────────
  const fetchHoldings = useCallback(async (pid) => {
    const seq = ++holdingsSeq.current
    try {
      const res = await pf(`/api/builder/portfolios/${pid}/holdings`)
      const data = await res.json().catch(() => ({}))
      if (seq !== holdingsSeq.current) return
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      setHoldings((data.holdings || []).map(h => ({ ticker: h.ticker, dollar_amount: Number(h.dollar_amount) || 0 })))
      setHoldingsFor(pid)
    } catch (e) {
      if (seq !== holdingsSeq.current) return
      setError(`Could not load holdings: ${e.message}`)
      setHoldings([])
      setHoldingsFor(pid)
    }
  }, [pf])

  useEffect(() => {
    // Drop any response still in flight for the previous portfolio.
    holdingsSeq.current += 1
    analysisSeq.current += 1
    setHoldings([])
    setHoldingsFor(null)
    setAnalysis(null)
    setLoading(false)
    setError(null)
    setFormError(null)
    setEditingName(false)
    setEditing(null)
    setSortCol(null)
    setBalanceUndo(null)
    setScaleUndo(null)
    if (activeId) fetchHoldings(activeId)
  }, [activeId, fetchHoldings])

  const refreshAfterWrite = useCallback(async (pid) => {
    await Promise.all([fetchHoldings(pid), loadPortfolios()])
  }, [fetchHoldings, loadPortfolios])

  // ── Analysis ───────────────────────────────────────────────────────────────
  // Re-grades whenever the holdings, window, benchmark, or grade formula
  // change. Every request is numbered and only the newest may land, so a slow
  // response for the previous portfolio or period can't overwrite this one.
  const holdingsKey = useMemo(() => holdings.map(h => `${h.ticker}:${h.dollar_amount}`).join('|'), [holdings])
  const holdingsReady = Boolean(activeId) && holdingsFor === activeId
  const requestKey = holdingsReady && holdings.length
    ? `${activeId}|${period}|${benchmark}|${gradingVersion}|${holdingsKey}`
    : null

  const runAnalysis = useCallback(async (pid, key) => {
    const seq = ++analysisSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await pf(`/api/builder/portfolios/${pid}/analyze`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ benchmark, period, grading_settings: gradingSettingsPayload() }),
      })
      const data = await res.json().catch(() => ({}))
      if (seq !== analysisSeq.current) return
      if (!res.ok || data.error) {
        setError(data.error || `Analysis failed (HTTP ${res.status})`)
        setAnalysis(prev => (prev && prev.pid === pid ? prev : null))
      } else {
        setAnalysis({ key, pid, data })
      }
    } catch (e) {
      if (seq !== analysisSeq.current) return
      setError(e.message || String(e))
      setAnalysis(prev => (prev && prev.pid === pid ? prev : null))
    } finally {
      if (seq === analysisSeq.current) setLoading(false)
    }
  }, [pf, benchmark, period])

  useEffect(() => {
    if (!requestKey) {
      analysisSeq.current += 1
      setLoading(false)
      if (holdingsReady) setAnalysis(null)
      return undefined
    }
    // A short pause lets a burst of edits settle into one request.
    const timer = setTimeout(() => runAnalysis(activeId, requestKey), 250)
    return () => clearTimeout(timer)
  }, [requestKey, holdingsReady, activeId, runAnalysis])

  useEffect(() => {
    const refresh = () => setGradingVersion(v => v + 1)
    window.addEventListener(GRADING_PREFERENCES_EVENT, refresh)
    return () => window.removeEventListener(GRADING_PREFERENCES_EVENT, refresh)
  }, [])
  // gradingVersion bumps when the saved formula changes; re-read it then.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gradingSettings = useMemo(() => gradingSettingsPayload(), [gradingVersion])

  const data = analysis && analysis.pid === activeId ? analysis.data : null
  const stale = Boolean(data) && analysis.key !== requestKey
  const pm = data?.portfolio_metrics

  const setPeriod = (key) => {
    setPeriodState(key)
    writePref(PREF_PERIOD, key)
  }
  const commitBenchmark = () => {
    const next = benchInput.trim().toUpperCase() || 'SPY'
    setBenchInput(next)
    if (next !== benchmark) {
      setBenchmarkState(next)
      writePref(PREF_BENCHMARK, next)
    }
  }
  const setColumnView = (key) => {
    setColumnViewState(key)
    writePref(PREF_VIEW, key)
  }

  // ── Portfolio actions ─────────────────────────────────────────────────────
  const createPortfolio = async () => {
    const name = (await dialog.prompt('Portfolio name:'))?.trim()
    if (!name) return
    const rawBalance = await dialog.prompt(
      `Starting balance for "${name}" (optional). Holdings can then be added as a percent of it, such as 25%:`,
      '',
    )
    if (rawBalance == null) return
    const typed = parseMoneyText(rawBalance)
    if (rawBalance.trim() && !(typed > 0)) {
      await dialog.alert('The starting balance must be a dollar amount greater than zero, such as 150000.')
      return
    }
    const startingBalance = typed > 0 ? Math.round((typed / moneyRate()) * 100) / 100 : null
    try {
      const created = await send('/api/builder/portfolios', 'POST', { name, starting_balance: startingBalance })
      await loadPortfolios()
      selectPortfolio(created.id)
    } catch (e) { await dialog.alert(e.message) }
  }

  const copyMyHoldings = async () => {
    const source = currentProfileName || 'My holdings'
    const name = (await dialog.prompt(
      `Copy ${source}'s current holdings (at market value) into a new model portfolio named:`,
      `${source} ${new Date().toLocaleDateString()}`,
    ))?.trim()
    if (!name) return
    try {
      const created = await send('/api/builder/portfolios', 'POST', { name, from_holdings: true })
      await loadPortfolios()
      selectPortfolio(created.id)
    } catch (e) { await dialog.alert(e.message) }
  }

  const deletePortfolio = async (p, e) => {
    e.stopPropagation()
    const count = Number(p.holding_count) || 0
    if (!await dialog.confirm(`Delete "${p.name}"${count ? ` and its ${count} holding${count === 1 ? '' : 's'}` : ''}?`)) return
    try {
      await send(`/api/builder/portfolios/${p.id}`, 'DELETE')
    } catch (err) { await dialog.alert(err.message); return }
    setCompareIds(ids => ids.filter(id => id !== p.id))
    setCompareResult(r => (r && r.results?.some(x => x.id === p.id) ? null : r))
    const list = await loadPortfolios()
    if (activeId === p.id) selectPortfolio(list?.[0]?.id ?? null)
  }

  const saveAsPortfolio = async () => {
    if (!activeId || !holdings.length) return
    const name = (await dialog.prompt('Save a copy as:', `${activeName} copy`))?.trim()
    if (!name) return
    try {
      const created = await send('/api/builder/portfolios', 'POST', {
        name,
        holdings,
        target_yield_pct: savedTargetYield,
        target_monthly_income: savedMonthly,
        max_weight_pct: savedCap,
        starting_balance: savedBalance,
      })
      await loadPortfolios()
      selectPortfolio(created.id)
    } catch (e) { await dialog.alert(e.message) }
  }

  const startRename = () => {
    renameDoneRef.current = false
    setEditingName(true)
    setNameInput(activeName)
  }
  const cancelRename = () => {
    renameDoneRef.current = true
    setEditingName(false)
  }
  const commitRename = async () => {
    if (renameDoneRef.current) return
    renameDoneRef.current = true
    setEditingName(false)
    const name = nameInput.trim()
    if (!name || name === activeName) return
    try {
      await send(`/api/builder/portfolios/${activeId}`, 'PATCH', { name })
    } catch (e) { await dialog.alert(e.message) }
    loadPortfolios()
  }

  const clearHoldings = async () => {
    if (!activeId || !holdings.length) return
    if (!await dialog.confirm(`Remove all ${holdings.length} holdings from "${activeName}"?`)) return
    setBusy(true)
    try {
      await send(`/api/builder/portfolios/${activeId}/holdings`, 'PUT', { holdings: [], replace: true })
      await refreshAfterWrite(activeId)
    } catch (e) { await dialog.alert(e.message) } finally { setBusy(false) }
  }

  // ── Holding actions ───────────────────────────────────────────────────────
  // An amount typed as dollars ("5000", "$5,000") or as a percent of the
  // starting balance ("25%"): { amount, percent } or { error }.
  const readAmount = (raw) => {
    const text = String(raw ?? '').trim()
    if (text.endsWith('%')) {
      const pct = parseMoneyText(text.slice(0, -1))
      if (savedBalance == null) return { error: 'Set a starting balance to enter a percent of it.' }
      if (!(pct > 0) || pct > 100) return { error: 'Enter a percent of the starting balance between 0% and 100%.' }
      return { amount: Math.round(savedBalance * pct) / 100, percent: true }
    }
    const amount = parseMoneyText(text)
    if (!(amount > 0)) {
      return {
        error: /[a-z]/i.test(text)
          ? 'Enter an amount such as 5000 or 25%. The symbol goes in the Ticker box.'
          : 'Enter a dollar amount greater than zero, such as 5000 or 25%.',
      }
    }
    return { amount: Math.round(amount * 100) / 100, percent: false }
  }

  // A bare dollar amount under 1% of the starting balance is usually a
  // percent typed without its sign: ask which was meant. Resolves to the
  // amount to use, or null to cancel.
  const confirmSmallAmount = async (ticker, amount, raw) => {
    if (savedBalance == null || amount >= savedBalance / 100) return amount
    const typed = parseMoneyText(raw)
    const asPercent = typed > 0 && typed <= 100 ? Math.round(savedBalance * typed) / 100 : null
    const share = fmtPct((amount / savedBalance) * 100, amount / savedBalance < 0.001 ? 3 : 2)
    const message = `${fmt$(amount)} of ${ticker} is only ${share} of the ${fmt$(savedBalance)} starting balance.`
      + (asPercent != null ? ` Did you mean ${typed}% (${fmt$(asPercent)})?` : ' Use it anyway?')
    return dialog.choose(message, [
      { label: 'Cancel', value: null },
      { label: `Keep ${fmt$(amount)}`, value: amount, primary: asPercent == null },
      ...(asPercent != null ? [{ label: `Use ${typed}% (${fmt$(asPercent)})`, value: asPercent, primary: true }] : []),
    ])
  }

  const addHolding = async (e) => {
    e.preventDefault()
    if (!activeId || busy) return
    const ticker = tickerInput.trim().toUpperCase()
    const raw = dollarInput.trim()
    if (!ticker) {
      // A symbol typed into the Amount box is the usual reason the ticker is blank.
      setFormError(/[a-z]/i.test(raw) ? 'Put the symbol in the Ticker box.' : 'Enter a ticker.')
      return
    }
    if (/\s/.test(ticker)) { setFormError('A ticker cannot contain spaces.'); return }
    const read = readAmount(raw)
    if (read.error) { setFormError(read.error); return }
    const amount = read.percent ? read.amount : await confirmSmallAmount(ticker, read.amount, raw)
    if (amount == null) return
    const existing = holdings.find(h => h.ticker === ticker)
    if (existing && !await dialog.confirm(
      `${ticker} is already in this portfolio at ${fmt$(existing.dollar_amount)}. Change it to ${fmt$(amount)}?`,
    )) return
    setBusy(true)
    try {
      await send(`/api/builder/portfolios/${activeId}/holdings`, 'POST', { ticker, dollar_amount: amount })
      setTickerInput('')
      setDollarInput('')
      setFormError(null)
      await refreshAfterWrite(activeId)
    } catch (err) { setFormError(err.message) } finally { setBusy(false) }
  }

  const deleteHolding = async (ticker) => {
    setHoldings(prev => prev.filter(h => h.ticker !== ticker))
    try {
      await send(`/api/builder/portfolios/${activeId}/holdings/${encodeURIComponent(ticker)}`, 'DELETE')
    } catch (e) { await dialog.alert(e.message) }
    refreshAfterWrite(activeId)
  }

  // One cell of one row is edited at a time: its ticker, amount, or shares.
  const startEdit = (ticker, field) => {
    committingRef.current = false
    setEditing({ ticker, field })
  }
  const cancelEdit = () => {
    committingRef.current = true
    setEditing(null)
  }

  // A new symbol for a holding, keeping its amount and its row. Onto a symbol
  // already held, it offers to combine the two.
  const renameHolding = async (old, raw) => {
    const next = String(raw ?? '').trim().toUpperCase()
    if (!next || next === old) return
    if (/\s/.test(next) || next.length > 20) { setFormError('A ticker cannot contain spaces.'); return }
    setFormError(null)
    const pid = activeId
    const path = `/api/builder/portfolios/${pid}/holdings/${encodeURIComponent(old)}`
    try {
      const res = await pf(path, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ ticker: next }) })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409 && body.exists) {
        const moving = holdings.find(h => h.ticker === old)?.dollar_amount ?? 0
        if (!await dialog.confirm(
          `${next} is already in this portfolio at ${fmt$(body.dollar_amount)}. `
          + `Combine the two into one ${next} holding of ${fmt$(body.dollar_amount + moving)}?`,
        )) return
        await send(path, 'PATCH', { ticker: next, merge: true })
      } else if (!res.ok || body.error) {
        throw new Error(body.error || `HTTP ${res.status}`)
      }
    } catch (e) { await dialog.alert(e.message) }
    await refreshAfterWrite(pid)
  }

  const commitEdit = async (ticker, field, raw) => {
    if (committingRef.current) return
    committingRef.current = true
    setEditing(null)
    const current = holdings.find(h => h.ticker === ticker)
    if (!current) return
    if (field === 'ticker') { await renameHolding(ticker, raw); return }
    let amount
    if (field === 'shares') {
      // Shares set the amount at the latest price.
      const price = tableRows.find(r => r.ticker === ticker)?.current_price
      const shares = parseMoneyText(raw)
      if (!(Number(price) > 0)) { setFormError(`${ticker}: there is no price yet, so shares cannot set its amount.`); return }
      if (!(shares > 0)) { setFormError(`${ticker}: enter a share count greater than zero. Use × to remove a holding.`); return }
      amount = Math.round(shares * price * 100) / 100
    } else {
      const read = readAmount(raw)
      if (read.error) { setFormError(`${ticker}: ${read.error} Use × to remove a holding.`); return }
      amount = read.amount
      if (Math.abs(amount - current.dollar_amount) < 0.005) return
      if (!read.percent) {
        amount = await confirmSmallAmount(ticker, amount, raw)
        if (amount == null) return
      }
    }
    if (Math.abs(amount - current.dollar_amount) < 0.005) return
    setFormError(null)
    setHoldings(prev => prev.map(h => (h.ticker === ticker ? { ...h, dollar_amount: amount } : h)))
    try {
      await send(`/api/builder/portfolios/${activeId}/holdings`, 'POST', { ticker, dollar_amount: amount })
      loadPortfolios()
    } catch (e) {
      await dialog.alert(e.message)
      fetchHoldings(activeId)
    }
  }

  // ── Compare ────────────────────────────────────────────────────────────────
  const validCompareIds = compareIds.filter(id => portfolios.some(p => p.id === id))
  const toggleCompare = (pid) => {
    setCompareIds(prev => (prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]))
  }
  const runCompare = async () => {
    if (validCompareIds.length < 2) return
    setCompareLoading(true)
    setCompareError(null)
    try {
      const result = await send('/api/builder/compare', 'POST', {
        portfolio_ids: validCompareIds, period, benchmark, grading_settings: gradingSettingsPayload(),
      })
      setCompareResult(result)
    } catch (e) { setCompareError(e.message) } finally { setCompareLoading(false) }
  }

  // ── Strategies ─────────────────────────────────────────────────────────────
  const openStrategies = () => {
    // A strategy for this model is sized to its starting balance by default.
    if (savedBalance != null) setAwBudget(String(savedBalance))
    setAwOpen(true)
    setAwResult(null)
    setAwError(null)
    setRebalanceResult(null)
  }
  const closeStrategies = () => setAwOpen(false)

  useEffect(() => {
    if (!awOpen) return undefined
    const onKey = e => { if (e.key === 'Escape') setAwOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [awOpen])

  const runAllWeather = async () => {
    setAwLoading(true)
    setAwError(null)
    setAwResult(null)
    setRebalanceResult(null)
    setAwOverrides({})
    try {
      const result = await send('/api/builder/all-weather', 'POST', {
        mode: awMode, budget: Number(awBudget), strategy: awStrategy, funds_per_class: awFundsPerClass,
      })
      setAwResult(result)
    } catch (e) { setAwError(e.message) } finally { setAwLoading(false) }
  }

  const applyAllWeather = async () => {
    if (!activeId || !awResult) return
    // The same ticker can land in two rows when a manual override repeats a fund.
    const amounts = {}
    awResult.allocations.forEach((alloc, idx) => {
      const ticker = String(awOverrides[idx] || alloc.ticker || '').trim().toUpperCase()
      if (ticker) amounts[ticker] = (amounts[ticker] || 0) + alloc.dollar_amount
    })
    const list = Object.entries(amounts).map(([ticker, dollar_amount]) => ({ ticker, dollar_amount }))
    let replace = true
    if (holdings.length) {
      replace = await dialog.confirm(
        `Replace the ${holdings.length} holdings in "${activeName}" with this ${list.length}-fund allocation?`,
      )
      if (!replace && !await dialog.confirm(
        `Add these ${list.length} funds to the current holdings instead? A fund already held takes the new amount.`,
      )) return
    }
    setBusy(true)
    try {
      await send(`/api/builder/portfolios/${activeId}/holdings`, 'PUT', { holdings: list, replace })
      closeStrategies()
      setAwResult(null)
      await refreshAfterWrite(activeId)
    } catch (e) { setAwError(e.message) } finally { setBusy(false) }
  }

  const runRebalance = async () => {
    if (!activeId || !holdings.length) { setAwError('Portfolio has no holdings to rebalance'); return }
    setRebalanceLoading(true)
    setAwError(null)
    setAwResult(null)
    setRebalanceResult(null)
    try {
      const result = await send(`/api/builder/portfolios/${activeId}/rebalance`, 'POST', { mode: awMode, strategy: awStrategy })
      setRebalanceResult(result)
    } catch (e) { setAwError(e.message) } finally { setRebalanceLoading(false) }
  }

  const applyRebalance = async () => {
    if (!activeId || !rebalanceResult) return
    const plan = rebalanceResult.apply_holdings || []
    const dropped = rebalanceResult.unclassified || []
    const message = `Set "${activeName}" to the template at its current total of ${fmt$(rebalanceResult.total_value)}? `
      + 'Each asset class is set to its target, and funds within a class keep their proportions.'
      + (dropped.length
        ? ` ${dropped.length} holding${dropped.length === 1 ? '' : 's'} outside the template will be removed: ${dropped.map(h => h.ticker).join(', ')}.`
        : '')
    if (!plan.length || !await dialog.confirm(message)) return
    setBusy(true)
    try {
      await send(`/api/builder/portfolios/${activeId}/holdings`, 'PUT', { holdings: plan, replace: true })
      closeStrategies()
      setRebalanceResult(null)
      await refreshAfterWrite(activeId)
    } catch (e) { setAwError(e.message) } finally { setBusy(false) }
  }

  // ── Table rows ─────────────────────────────────────────────────────────────
  // Rows come from the saved holdings, so an add or an edit shows at once;
  // each row's measured metrics come from the latest analysis of that ticker.
  const totalInvested = holdings.reduce((s, h) => s + (h.dollar_amount || 0), 0)
  const tableRows = useMemo(() => {
    const measured = new Map((data?.holdings || []).map(r => [r.ticker, r]))
    return holdings.map(h => {
      const m = measured.get(h.ticker)
      const amount = h.dollar_amount
      const yieldPct = m?.annual_yield_pct
      return {
        ...(m || {}),
        ticker: h.ticker,
        dollar_amount: amount,
        weight_pct: totalInvested > 0 ? (amount / totalInvested) * 100 : 0,
        shares: isNum(m?.current_price) && m.current_price > 0 ? amount / m.current_price : null,
        annual_income: isNum(yieldPct) ? (amount * yieldPct) / 100 : null,
        monthly_income: isNum(yieldPct) ? (amount * yieldPct) / 1200 : null,
        pending: !m,
      }
    })
  }, [holdings, data, totalInvested])

  const sortedRows = useMemo(() => {
    const col = COLUMNS.find(c => c.key === sortCol)
    const key = col?.sortKey || sortCol
    const dir = sortAsc ? 1 : -1
    const ordered = !sortCol ? tableRows : [...tableRows].sort((a, b) => {
      if (key === 'ticker') return dir * String(a.ticker).localeCompare(String(b.ticker))
      const av = isNum(a[key]) ? Number(a[key]) : null
      const bv = isNum(b[key]) ? Number(b[key]) : null
      // Blanks sink to the bottom in either direction.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return dir * (av - bv)
    })
    // The running total follows the rows as shown, so a sort changes it.
    let running = 0
    return ordered.map(row => {
      running += Number(row.dollar_amount) || 0
      return { ...row, running_total: Math.round(running * 100) / 100 }
    })
  }, [tableRows, sortCol, sortAsc])

  const handleSort = (key) => {
    if (sortCol === key) setSortAsc(asc => !asc)
    else {
      setSortCol(key)
      setSortAsc(key === 'ticker')
    }
  }

  // ── Target yield ───────────────────────────────────────────────────────────
  // Read from the table's rows, so the status follows an amount the moment it
  // is edited: a holding's yield does not depend on how much of it is held.
  const yieldReady = Boolean(data) && tableRows.length > 0 && tableRows.every(r => !r.pending)
  const yieldHoldings = useMemo(() => tableRows.map(r => ({
    ticker: r.ticker,
    dollar_amount: r.dollar_amount,
    yieldPct: r.annual_yield_pct,
    price: r.current_price,
    // No price means the yield is unknown, not zero: leave that holding alone.
    locked: !isNum(r.current_price),
  })), [tableRows])
  // A monthly target is a yield that moves with the total invested.
  const targetYieldPct = savedMonthly != null ? monthlyToYieldPct(savedMonthly, totalInvested) : savedTargetYield
  const targetStatus = useMemo(
    () => (yieldReady ? yieldTargetStatus(yieldHoldings, targetYieldPct) : null),
    [yieldReady, yieldHoldings, targetYieldPct],
  )
  const overCap = useMemo(
    () => (yieldReady ? holdingsOverCap(yieldHoldings, savedCap) : []),
    [yieldReady, yieldHoldings, savedCap],
  )
  // Short of the target: balance to it. On target (or with no target) but
  // over the cap: bring the big holdings down, keeping as much yield as the
  // cap allows and never dropping below the target.
  const balancePlan = useMemo(() => {
    if (!targetStatus) return null
    const options = { maxWeightPct: savedCap, wholeShares }
    if (targetStatus.status === 'short') {
      let plan = null
      if (wholeShares && savedMonthly != null) {
        // Whole shares can leave up to a share's price as cash, and the income
        // must still cover the target on the smaller total.
        const priciest = Math.max(0, ...yieldHoldings.filter(h => !h.locked).map(h => Number(h.price) || 0))
        const covered = monthlyToYieldPct(savedMonthly, totalInvested - priciest)
        if (covered != null && priciest < totalInvested) plan = balanceToTargetYield(yieldHoldings, covered, options)
      }
      if (!plan?.ok) plan = balanceToTargetYield(yieldHoldings, targetYieldPct, options)
      return { ...plan, kind: 'target' }
    }
    if (!overCap.length || targetStatus.yieldPct == null) return null
    const range = yieldRange(yieldHoldings, savedCap)
    if (!range?.feasible) return { ok: false, reason: 'cap_too_low', minHoldings: range?.minHoldings, cap: savedCap, kind: 'cap' }
    const goal = Math.max(targetYieldPct ?? 0, Math.min(targetStatus.yieldPct, range.maxYieldPct))
    return { ...balanceToTargetYield(yieldHoldings, goal, options), kind: 'cap' }
  }, [targetStatus, overCap, yieldHoldings, savedCap, wholeShares, savedMonthly, totalInvested, targetYieldPct])
  // Undo is offered only while the holdings are still exactly what Balance wrote.
  const undoLive = Boolean(balanceUndo) && balanceUndo.pid === activeId && balanceUndo.changes.every(c => {
    const held = holdings.find(h => h.ticker === c.ticker)
    return held && Math.abs(held.dollar_amount - c.to) < 0.005
  })
  const topHolding = tableRows.reduce((top, r) => (!top || r.weight_pct > top.weight_pct ? r : top), null)

  // What the typed (or saved) target means in the other unit, on today's
  // total, or on the starting balance before anything is invested.
  const typedTarget = targetInput.trim() !== '' && Number(targetInput) > 0
    ? (targetMode === 'monthly' ? Number(targetInput) / moneyRate() : Number(targetInput))
    : null
  const equivalentBase = totalInvested > 0 ? totalInvested : (savedBalance ?? 0)
  const targetEquivalent = typedTarget == null || !(equivalentBase > 0) ? null
    : targetMode === 'monthly'
      ? `= ${fmtPct(monthlyToYieldPct(typedTarget, equivalentBase), 2)} yield on ${fmt$(equivalentBase)}`
      : `= ${fmt$(yieldPctToMonthly(typedTarget, equivalentBase))}/mo on ${fmt$(equivalentBase)}`

  // ── Starting balance ───────────────────────────────────────────────────────
  const uninvested = savedBalance != null ? savedBalance - totalInvested : null
  const scaleLive = Boolean(scaleUndo) && scaleUndo.pid === activeId && scaleUndo.changes.every(c => {
    const held = holdings.find(h => h.ticker === c.ticker)
    return held && Math.abs(held.dollar_amount - c.to) < 0.005
  })

  const commitBalance = async () => {
    if (!activeId) return
    const raw = balanceInput.trim()
    const typed = raw === '' ? 0 : parseMoneyText(raw)
    if (!Number.isFinite(typed) || typed < 0) {
      setFormError('Enter a starting balance of $0 or more.')
      setBalanceInput(balanceInputFor())
      return
    }
    // Typed in the display currency; saved, like every amount, in USD.
    const value = typed > 0 ? Math.round((typed / moneyRate()) * 100) / 100 : null
    if (value === savedBalance) { setBalanceInput(balanceInputFor()); return }
    setScaleUndo(null)
    await saveSettings({ starting_balance: value })
  }

  const saveSettings = async (changes) => {
    const pid = activeId
    setFormError(null)
    setBalanceUndo(null)
    setPortfolios(prev => prev.map(p => (p.id === pid ? { ...p, ...changes } : p)))
    try {
      await send(`/api/builder/portfolios/${pid}`, 'PATCH', changes)
    } catch (e) {
      await dialog.alert(e.message)
      loadPortfolios()
    }
  }

  const commitTarget = async () => {
    if (!activeId) return
    const raw = targetInput.trim()
    const typed = raw === '' ? 0 : Number(raw)
    const monthly = targetMode === 'monthly'
    const limit = monthly ? 1e12 : 500
    if (!Number.isFinite(typed) || typed < 0 || typed > limit) {
      setFormError(monthly ? 'Enter a monthly income target of $0 or more.' : 'Enter a target yield between 0% and 500%.')
      setTargetInput(targetInputFor(targetMode))
      return
    }
    // Typed in the display currency; saved, like every amount, in USD.
    const value = typed > 0 ? Math.round((monthly ? typed / moneyRate() : typed) * 100) / 100 : null
    const field = monthly ? 'target_monthly_income' : 'target_yield_pct'
    const saved = monthly ? savedMonthly : savedTargetYield
    const otherSaved = monthly ? savedTargetYield : savedMonthly
    // Clearing the box clears the target in either unit.
    if (value === saved && (value != null || otherSaved == null)) { setTargetInput(targetInputFor(targetMode)); return }
    await saveSettings(value == null
      ? { target_yield_pct: null, target_monthly_income: null }
      : { [field]: value, ...(monthly ? { target_yield_pct: null } : { target_monthly_income: null }) })
  }

  // Switching units keeps the same target, restated on today's total.
  const switchTargetMode = async (mode) => {
    if (mode === targetMode) return
    setTargetMode(mode)
    if (!activeId || targetYieldPct == null || !(totalInvested > 0)) {
      setTargetInput('')
      return
    }
    const changes = mode === 'monthly'
      ? { target_monthly_income: Math.round(yieldPctToMonthly(targetYieldPct, totalInvested) * 100) / 100, target_yield_pct: null }
      : { target_yield_pct: Math.round(targetYieldPct * 100) / 100, target_monthly_income: null }
    await saveSettings(changes)
  }

  const commitCap = async () => {
    if (!activeId) return
    const raw = capInput.trim()
    const typed = raw === '' ? 0 : Number(raw)
    if (!Number.isFinite(typed) || typed < 0 || typed > 100) {
      setFormError('Enter a max per holding between 0% and 100%.')
      setCapInput(savedCap == null ? '' : String(savedCap))
      return
    }
    const value = typed > 0 && typed < 100 ? Math.round(typed * 100) / 100 : null
    if (value === savedCap) { setCapInput(savedCap == null ? '' : String(savedCap)); return }
    await saveSettings({ max_weight_pct: value })
  }

  const setWholeShares = (on) => {
    setWholeSharesState(on)
    writePref(PREF_WHOLE_SHARES, on ? '1' : '0')
  }

  const writeAmounts = async (pid, amounts) => {
    setBusy(true)
    try {
      // Merge, not replace: holdings Balance did not touch stay as they are.
      await send(`/api/builder/portfolios/${pid}/holdings`, 'PUT', { holdings: amounts, replace: false })
      await refreshAfterWrite(pid)
      return true
    } catch (e) {
      await dialog.alert(e.message)
      return false
    } finally { setBusy(false) }
  }

  const balanceToTarget = async () => {
    if (!activeId || busy || !balancePlan?.ok) return
    const changes = balancePlan.changes.filter(c => Math.abs(c.to - c.from) >= 0.005)
    if (!changes.length) return
    const undo = {
      pid: activeId, changes, moved: balancePlan.moved, cash: balancePlan.cash, kind: balancePlan.kind, wholeShares,
    }
    setFormError(null)
    if (await writeAmounts(activeId, changes.map(c => ({ ticker: c.ticker, dollar_amount: c.to })))) {
      setBalanceUndo(undo)
    }
  }

  const undoBalance = async () => {
    if (!undoLive || busy) return
    const { pid, changes } = balanceUndo
    if (await writeAmounts(pid, changes.map(c => ({ ticker: c.ticker, dollar_amount: c.from })))) {
      setBalanceUndo(null)
    }
  }

  // Every holding scaled by the same factor so they add up to the starting
  // balance: the mix (and so the yield) stays as it is.
  const scaleToBalance = async () => {
    if (!activeId || busy || savedBalance == null) return
    const funded = holdings.filter(h => h.dollar_amount > 0)
    if (!funded.length || !(totalInvested > 0)) return
    const factor = savedBalance / totalInvested
    const cents = funded.map(h => Math.max(Math.round(h.dollar_amount * factor * 100), 1))
    const largest = cents.indexOf(Math.max(...cents))
    cents[largest] += Math.round(savedBalance * 100) - cents.reduce((s, c) => s + c, 0)
    const changes = funded.map((h, i) => ({ ticker: h.ticker, from: h.dollar_amount, to: cents[i] / 100 }))
    setBalanceUndo(null)
    if (await writeAmounts(activeId, changes.map(c => ({ ticker: c.ticker, dollar_amount: c.to })))) {
      setScaleUndo({ pid: activeId, changes })
    }
  }

  const undoScale = async () => {
    if (!scaleLive || busy) return
    const { pid, changes } = scaleUndo
    if (await writeAmounts(pid, changes.map(c => ({ ticker: c.ticker, dollar_amount: c.from })))) {
      setScaleUndo(null)
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportPortfolio = async (format) => {
    if (!activeId || !holdings.length || exporting) return
    setExporting(format)
    try {
      const res = await pf(`/api/builder/portfolios/${activeId}/export?currency=${getDisplayCurrency()}`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ format, benchmark, period, grading_settings: gradingSettingsPayload() }),
      })
      if (!res.ok) {
        const failure = await res.json().catch(() => ({}))
        throw new Error(failure.error || `HTTP ${res.status}`)
      }
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      const slug = activeName.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'model'
      link.href = url
      link.download = `portfolio_builder_${slug}_${period}.${format}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      await dialog.alert(`Export failed: ${e.message}`)
    } finally { setExporting(null) }
  }

  const visibleGroups = (COLUMN_VIEWS.find(v => v.key === columnView) || COLUMN_VIEWS[0]).groups
  const visibleColumns = COLUMNS.filter(c => visibleGroups.includes(c.group))
  const groupSpans = visibleColumns.reduce((spans, c) => {
    const last = spans[spans.length - 1]
    if (last && last.group === c.group) last.span += 1
    else spans.push({ group: c.group, span: 1 })
    return spans
  }, [])

  const portfolioCells = pm ? {
    ticker: 'Portfolio',
    dollar_amount: totalInvested,
    weight_pct: 100,
    grade: pm.grade?.overall,
    score: pm.grade?.score,
    ulcer_index: pm.ulcer_index,
    sharpe: pm.sharpe,
    sortino: pm.sortino,
    calmar: pm.calmar,
    omega: pm.omega,
    max_drawdown: isNum(pm.max_drawdown) ? pm.max_drawdown * 100 : null,
    down_capture: pm.down_capture,
    up_capture: pm.up_capture,
    annual_vol: pm.annual_vol,
    total_return_pct: pm.total_return_pct,
    annual_ret: pm.annual_ret,
    annual_yield_pct: isNum(pm.yield_pct) ? pm.yield_pct : null,
    annual_income: tableRows.some(r => isNum(r.annual_income))
      ? tableRows.reduce((s, r) => s + (Number(r.annual_income) || 0), 0) : null,
    monthly_income: tableRows.some(r => isNum(r.monthly_income))
      ? tableRows.reduce((s, r) => s + (Number(r.monthly_income) || 0), 0) : null,
  } : null

  // The ticker, amount, and shares of a holding row are edited in place:
  // click the value, type, then Enter (or click away) saves and Esc cancels.
  const EDITABLE = {
    ticker: {
      field: 'ticker',
      label: 'ticker',
      value: row => row.ticker,
      title: 'Click to change the symbol. The amount stays the same.',
    },
    dollar_amount: {
      field: 'amount',
      label: 'amount',
      value: row => row.dollar_amount,
      title: () => (savedBalance != null
        ? `Click to edit the amount: dollars, or a percent of the ${fmt$(savedBalance)} starting balance such as 25%.`
        : 'Click to edit the amount.'),
    },
    shares: {
      field: 'shares',
      label: 'shares',
      value: row => (isNum(row.shares) ? Math.round(row.shares * 10000) / 10000 : ''),
      title: 'Click to set the number of shares. The amount follows at the latest price.',
    },
  }

  const renderEditor = (c, row, cls) => {
    const spec = EDITABLE[c.key]
    return (
      <td key={c.key} className={cls}>
        <input
          type="text"
          inputMode={spec.field === 'ticker' ? undefined : 'decimal'}
          className={`pb-dollar-input ${spec.field === 'ticker' ? 'pb-ticker-input' : ''}`}
          defaultValue={spec.value(row)}
          aria-label={`${spec.label} for ${row.ticker}`}
          onBlur={e => commitEdit(row.ticker, spec.field, e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(row.ticker, spec.field, e.target.value) }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
          onFocus={e => e.target.select()}
          autoFocus
        />
      </td>
    )
  }

  const renderCell = (c, row, isTotal = false) => {
    const val = row[c.key]
    const cls = [c.sticky ? 'pb-sticky' : '', c.align === 'left' ? 'pb-left' : c.align === 'center' ? 'pb-center' : ''].join(' ').trim() || undefined
    const spec = !isTotal && EDITABLE[c.key]
    // Shares can only set an amount once the holding has a price.
    const editable = spec && (c.key !== 'shares' || isNum(row.current_price))
    if (editable && editing?.ticker === row.ticker && editing.field === spec.field) {
      return renderEditor(c, row, cls)
    }
    if (c.key === 'ticker') {
      return (
        <td key={c.key} className={cls}>
          {isTotal ? <strong>{val}</strong> : (
            <span className="pb-ticker">
              <button type="button" className="pb-link-btn pb-ticker-btn" onClick={() => startEdit(row.ticker, 'ticker')} title={spec.title}>
                {val}
              </button>
              {row.pending && loading && <span className="pb-pending" title="Being analyzed">…</span>}
            </span>
          )}
        </td>
      )
    }
    if (c.key === 'grade') {
      return <td key={c.key} className={cls}>{(val || !isTotal) ? <GradeBadge grade={val} /> : '--'}</td>
    }
    if (editable) {
      return (
        <td key={c.key} className="pb-dollar-cell">
          <button
            type="button"
            className="pb-link-btn"
            onClick={() => startEdit(row.ticker, spec.field)}
            title={typeof spec.title === 'function' ? spec.title() : spec.title}
          >
            {c.fmt(val)}
          </button>
        </td>
      )
    }
    const colorValue = c.abs && isNum(val) ? Math.abs(Number(val)) : val
    let color = c.band ? bandColor(colorValue, gradingSettings, c.band) : c.signed ? signedColor(val) : undefined
    if (c.key === 'running_total' && savedBalance != null && isNum(val)) {
      // Green on the row that fills the starting balance, red once past it.
      const over = Number(val) - savedBalance
      color = Math.abs(over) < 0.005 ? 'var(--pos)' : over > 0 ? 'var(--neg)' : undefined
    }
    return (
      <td key={c.key} className={cls} style={color ? { color } : undefined}>
        {c.fmt ? c.fmt(val) : (val ?? '--')}
      </td>
    )
  }

  // ── Charts ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const Plotly = window.Plotly
    if (!Plotly || !data) return
    const ct = chartTheme(isDark)
    const config = { responsive: true, displaylogo: false }
    const base = { margin: { t: 40, r: 20, b: 50, l: 60 }, font: { size: 11 } }
    const bench = data.benchmark || benchmark

    const growth = data.growth_series
    if (growthRef.current && growth?.dates?.length) {
      const start = growth.start_value || 1
      const toPct = values => values.map(v => (isNum(v) ? (Number(v) / start - 1) * 100 : null))
      const traces = [{
        x: growth.dates, y: toPct(growth.portfolio), name: 'Portfolio', mode: 'lines',
        line: { color: CHART.portfolio, width: 2 }, hovertemplate: 'Portfolio %{y:.2f}%<extra></extra>',
      }]
      if (growth.benchmark) {
        traces.push({
          x: growth.dates, y: toPct(growth.benchmark), name: bench, mode: 'lines',
          line: { color: CHART.benchmark, width: 1.5, dash: 'dot' }, hovertemplate: `${bench} %{y:.2f}%<extra></extra>`,
        })
      }
      Plotly.react(growthRef.current, traces, themedPlotlyLayout({
        ...base,
        title: { text: `Cumulative total return vs ${bench} (distributions reinvested)`, font: { size: 13 } },
        hovermode: 'x unified',
        xaxis: { type: 'date' },
        yaxis: { ticksuffix: '%', zeroline: true },
        legend: { orientation: 'h', y: 1.02, x: 1, xanchor: 'right', yanchor: 'bottom' },
      }, isDark), config)
    }

    const points = (data.holdings || []).filter(h => isNum(h.annual_ret) && isNum(h.annual_vol))
    if (scatterRef.current) {
      const traces = [{
        type: 'scatter', mode: 'markers+text', name: 'Holdings',
        x: points.map(h => h.annual_vol), y: points.map(h => h.annual_ret),
        text: points.map(h => h.ticker), textposition: 'top center',
        textfont: { color: ct.title, size: 11 },
        marker: {
          color: points.map(h => (h.annual_ret >= 0 ? CHART.up : CHART.down)),
          size: points.map(h => Math.max(8, Math.min(44, (h.weight_pct || 1) * 2.8))),
          line: { color: ct.grid, width: 1 }, opacity: 0.85,
        },
        customdata: points.map(h => [h.weight_pct, h.grade]),
        hovertemplate: '%{text}<br>Return %{y:.1f}% · Vol %{x:.1f}%<br>Weight %{customdata[0]:.1f}% · Grade %{customdata[1]}<extra></extra>',
      }]
      if (pm && isNum(pm.annual_ret) && isNum(pm.annual_vol)) {
        traces.push({
          type: 'scatter', mode: 'markers+text', name: 'Portfolio',
          x: [pm.annual_vol], y: [pm.annual_ret], text: ['Portfolio'], textposition: 'bottom center',
          textfont: { color: CHART.portfolio, size: 11 },
          marker: { symbol: 'diamond', size: 16, color: CHART.portfolio, line: { color: ct.title, width: 1 } },
          hovertemplate: 'Portfolio<br>Return %{y:.1f}% · Vol %{x:.1f}%<extra></extra>',
        })
      }
      if (pm && isNum(pm.benchmark_annual_ret) && isNum(pm.benchmark_annual_vol)) {
        traces.push({
          type: 'scatter', mode: 'markers+text', name: bench,
          x: [pm.benchmark_annual_vol], y: [pm.benchmark_annual_ret], text: [bench], textposition: 'bottom center',
          textfont: { color: CHART.benchmark, size: 11 },
          marker: { symbol: 'star', size: 15, color: CHART.benchmark },
          hovertemplate: `${bench}<br>Return %{y:.1f}% · Vol %{x:.1f}%<extra></extra>`,
        })
      }
      Plotly.react(scatterRef.current, traces, themedPlotlyLayout({
        ...base,
        title: { text: 'Risk vs return, annualized (bubble = weight)', font: { size: 13 } },
        showlegend: false,
        xaxis: { title: { text: 'Volatility (annualized %)' }, zeroline: false },
        yaxis: { title: { text: 'Total return (annualized %)' }, zeroline: true },
      }, isDark), config)
    }

    const corr = data.correlation
    if (corrRef.current) {
      if (corr && corr.labels.length > 1) {
        const small = corr.labels.length <= 12
        Plotly.react(corrRef.current, [{
          type: 'heatmap', x: corr.labels, y: corr.labels, z: corr.matrix,
          colorscale: [[0, '#d32f2f'], [0.5, isDark ? '#111124' : '#f4f6fb'], [1, '#00a878']],
          zmin: -1, zmax: 1, showscale: true, colorbar: { len: 0.8 },
          texttemplate: small ? '%{z:.2f}' : '', textfont: { size: 10 },
          hovertemplate: '%{y} / %{x}: %{z:.2f}<extra></extra>',
        }], themedPlotlyLayout({
          ...base, margin: { t: 40, r: 30, b: 80, l: 80 },
          title: { text: 'Correlation of daily returns', font: { size: 13 } },
          xaxis: { tickangle: -45 }, yaxis: { autorange: 'reversed' },
        }, isDark), config)
      } else {
        Plotly.purge(corrRef.current)
      }
    }

    const dd = data.drawdown_series
    if (drawdownRef.current && dd?.dates?.length) {
      Plotly.react(drawdownRef.current, [{
        x: dd.dates, y: dd.values, fill: 'tozeroy', mode: 'lines', name: 'Drawdown',
        fillcolor: 'rgba(255,82,82,0.15)', line: { color: CHART.down, width: 1.5 },
        hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
      }], themedPlotlyLayout({
        ...base, margin: { t: 40, r: 20, b: 40, l: 60 },
        title: { text: 'Portfolio drawdown from its running peak', font: { size: 13 } },
        xaxis: { type: 'date' }, yaxis: { tickformat: '.1f', ticksuffix: '%' },
      }, isDark), config)
    }
  }, [data, pm, isDark, benchmark])

  useEffect(() => {
    const Plotly = window.Plotly
    const el = radarRef.current
    if (!Plotly || !el || !compareResult?.results?.length) return
    const present = new Set(compareResult.results.flatMap(r => Object.keys(r.breakdown || {})))
    const categories = FACTOR_ORDER.filter(c => present.has(c))
    if (!categories.length) return
    const traces = compareResult.results.map(r => {
      const vals = categories.map(c => r.breakdown?.[c] ?? 0)
      return {
        type: 'scatterpolar', r: [...vals, vals[0]], theta: [...categories, categories[0]],
        fill: 'toself', name: `${r.name} (${r.grade})`, opacity: 0.6,
        hovertemplate: '%{theta}: %{r:.0f}<extra>%{fullData.name}</extra>',
      }
    })
    const ct = chartTheme(isDark)
    Plotly.react(el, traces, themedPlotlyLayout({
      polar: {
        radialaxis: { visible: true, range: [0, 100], color: ct.font, gridcolor: ct.grid },
        angularaxis: { color: ct.font, gridcolor: ct.grid },
        bgcolor: ct.plot,
      },
      title: { text: 'Factor scores (0–100)', font: { size: 13 } },
      margin: { t: 50, r: 40, b: 40, l: 40 },
      showlegend: true,
      legend: { orientation: 'h', y: -0.1 },
    }, isDark), { responsive: true, displaylogo: false })
  }, [compareResult, isDark])

  useEffect(() => {
    const refs = [growthRef, scatterRef, corrRef, drawdownRef, radarRef]
    return () => {
      const Plotly = window.Plotly
      if (!Plotly) return
      refs.forEach(ref => {
        if (ref.current) {
          try { Plotly.purge(ref.current) } catch { /* already gone */ }
        }
      })
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────
  const strategy = STRATEGIES.find(s => s.key === awStrategy) || STRATEGIES[0]

  return (
    <div className="pb-layout">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="pb-sidebar">
        <div className="pb-sidebar-title">Model portfolios</div>
        <button type="button" className="pb-new-btn" onClick={createPortfolio}>+ New Portfolio</button>
        <button
          type="button"
          className="pb-new-btn pb-copy-btn"
          onClick={copyMyHoldings}
          title="Start a model from the selected account's current holdings at market value. It grades the same as the Dashboard."
        >
          Copy my holdings
        </button>
        <div className="pb-port-list">
          {portfolios.map(p => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              className={`pb-port-item ${p.id === activeId ? 'pb-port-active' : ''}`}
              onClick={() => selectPortfolio(p.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPortfolio(p.id) } }}
            >
              <div className="pb-port-text">
                <div className="pb-port-name" title={p.name}>{p.name}</div>
                <div className="pb-port-sub">{fmt$(p.total_value)}</div>
              </div>
              <div className="pb-port-count" title="Holdings">{p.holding_count}</div>
              <button type="button" className="pb-port-del" onClick={(e) => deletePortfolio(p, e)} title={`Delete ${p.name}`} aria-label={`Delete ${p.name}`}>&times;</button>
            </div>
          ))}
          {portfoliosLoaded && !portfolios.length && <div className="pb-muted pb-side-empty">No model portfolios yet.</div>}
        </div>
        {portfolios.length > 1 && (
          <div className="pb-compare-section">
            <div className="pb-sidebar-title">Compare</div>
            {portfolios.map(p => (
              <label key={p.id} className="pb-compare-item">
                <input type="checkbox" checked={compareIds.includes(p.id)} onChange={() => toggleCompare(p.id)} />
                <span>{p.name}</span>
              </label>
            ))}
            <button
              type="button"
              className="btn btn-primary pb-btn-block"
              onClick={runCompare}
              disabled={compareLoading || validCompareIds.length < 2}
              title={validCompareIds.length < 2 ? 'Check two or more portfolios' : `Compare over ${PERIODS.find(p => p.key === period)?.label} vs ${benchmark}`}
            >
              {compareLoading ? 'Comparing…' : `Compare${validCompareIds.length >= 2 ? ` (${validCompareIds.length})` : ''}`}
            </button>
            {compareError && <div className="pb-form-error">{compareError}</div>}
          </div>
        )}
      </div>

      {/* ── Main panel ───────────────────────────────────────────────────── */}
      <div className="pb-main">
        <NotFinancialAdviceNotice />

        {!activeId ? (
          <div className="card pb-empty">
            <h3>Build and grade a model portfolio</h3>
            <p>
              Model portfolios never touch your real holdings. Each one is graded with exactly the same formula, windows,
              and settings as the Dashboard grade, so you can test changes before you make them.
            </p>
            <div className="pb-empty-actions">
              <button type="button" className="btn btn-primary" onClick={createPortfolio}>New portfolio</button>
              <button type="button" className="btn btn-secondary" onClick={copyMyHoldings}>Copy my holdings</button>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="pb-header">
              <div className="pb-title-block">
                {editingName ? (
                  <input
                    className="pb-name-input"
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') cancelRename()
                    }}
                    aria-label="Portfolio name"
                    autoFocus
                  />
                ) : (
                  <h2 className="pb-port-title" onClick={startRename} title="Click to rename">{activeName}</h2>
                )}
                <div className="pb-subtitle">
                  {holdings.length} holding{holdings.length === 1 ? '' : 's'} · {fmt$(totalInvested)} invested
                  {savedBalance != null ? ` of ${fmt$(savedBalance)}` : ''}
                  {uninvested != null && uninvested >= 0.005 ? ` · ${fmt$(uninvested)} cash` : ''}
                  {pm && isNum(pm.est_annual_income) ? ` · ${fmt$(pm.est_annual_income)}/yr est. income` : ''}
                </div>
              </div>
              <div className="pb-actions">
                <button type="button" className="btn btn-success pb-btn-sm" onClick={openStrategies}>Strategies</button>
                <button
                  type="button"
                  className="btn btn-secondary pb-btn-sm"
                  onClick={() => exportPortfolio('xlsx')}
                  disabled={!holdings.length || Boolean(exporting)}
                  title="Download the holdings table and a summary as an Excel workbook, for the selected period and benchmark."
                >{exporting === 'xlsx' ? 'Exporting…' : 'Export Excel'}</button>
                <button
                  type="button"
                  className="btn btn-secondary pb-btn-sm"
                  onClick={() => exportPortfolio('csv')}
                  disabled={!holdings.length || Boolean(exporting)}
                  title="Download the holdings table as a CSV file, for the selected period and benchmark."
                >{exporting === 'csv' ? 'Exporting…' : 'Export CSV'}</button>
                <button type="button" className="btn btn-secondary pb-btn-sm" onClick={saveAsPortfolio} disabled={!holdings.length || busy}>Save As</button>
                <button type="button" className="btn btn-danger pb-btn-sm" onClick={clearHoldings} disabled={!holdings.length || busy}>Clear</button>
              </div>
            </div>

            <div className="pb-toolbar">
              <div className="pb-controls" role="group" aria-label="Grade window">
                {PERIODS.map(p => (
                  <button
                    type="button"
                    key={p.key}
                    className={`pb-period-btn ${period === p.key ? 'pb-period-active' : ''}`}
                    onClick={() => setPeriod(p.key)}
                    title={p.hint}
                    aria-pressed={period === p.key}
                  >{p.label}</button>
                ))}
              </div>
              <label className="pb-bench">
                <span>Benchmark</span>
                <input
                  className="pb-bench-input"
                  value={benchInput}
                  onChange={e => setBenchInput(e.target.value.toUpperCase())}
                  onBlur={commitBenchmark}
                  onKeyDown={e => { if (e.key === 'Enter') commitBenchmark() }}
                  placeholder="SPY"
                  title="Used for the capture factors and the comparison line. The Dashboard grades against SPY."
                />
              </label>
              <button
                type="button"
                className="btn btn-primary pb-btn-sm"
                onClick={() => requestKey && runAnalysis(activeId, requestKey)}
                disabled={loading || !requestKey}
                title="Grades update automatically; this re-runs the analysis with fresh prices."
              >
                {loading ? 'Analyzing…' : 'Refresh'}
              </button>
            </div>

            {/* Starting balance, income target, and how Balance may move money */}
            <div className="pb-toolbar pb-target-row">
              <label
                className="pb-bench"
                title="The dollars this model starts out with. Holdings can then be added as a percent of it, and Scale fills it exactly. Leave it blank for none."
              >
                <span>Starting balance</span>
                <input
                  className="pb-bench-input pb-target-input pb-target-money pb-balance-input"
                  type="text"
                  inputMode="decimal"
                  value={balanceInput}
                  onChange={e => setBalanceInput(e.target.value)}
                  onBlur={commitBalance}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setBalanceInput(balanceInputFor())
                  }}
                  placeholder="None"
                  aria-label="Starting balance"
                />
              </label>
              <span className="pb-target-sep" aria-hidden="true" />
              <label
                className="pb-bench"
                title="The income you are building this model toward, as a yield or as dollars a month. Saved with the portfolio. Leave it blank for no target."
              >
                <span>Target</span>
                <input
                  className={`pb-bench-input pb-target-input ${targetMode === 'monthly' ? 'pb-target-money' : ''}`}
                  type="number"
                  min="0"
                  max={targetMode === 'monthly' ? undefined : 500}
                  step={targetMode === 'monthly' ? 'any' : '0.1'}
                  value={targetInput}
                  onChange={e => setTargetInput(e.target.value)}
                  onBlur={commitTarget}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setTargetInput(targetInputFor(targetMode))
                  }}
                  placeholder="None"
                  aria-label={targetMode === 'monthly' ? 'Target monthly income' : 'Target yield percent'}
                />
              </label>
              <div className="pb-controls" role="group" aria-label="Target unit">
                {[['yield', '% yield'], ['monthly', '$ / month']].map(([mode, label]) => (
                  <button
                    type="button"
                    key={mode}
                    className={`pb-period-btn ${targetMode === mode ? 'pb-period-active' : ''}`}
                    onClick={() => switchTargetMode(mode)}
                    aria-pressed={targetMode === mode}
                    title={mode === 'monthly'
                      ? 'Set the target as income a month. Its yield follows the total invested.'
                      : 'Set the target as a yield on the total invested.'}
                  >{label}</button>
                ))}
              </div>
              {targetEquivalent && <span className="pb-target-equiv">{targetEquivalent}</span>}
              <label
                className="pb-bench"
                title="The largest share of the portfolio Balance may put in one holding. Leave it blank for no limit."
              >
                <span>Max per holding</span>
                <input
                  className="pb-bench-input pb-target-input"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={capInput}
                  onChange={e => setCapInput(e.target.value)}
                  onBlur={commitCap}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setCapInput(savedCap == null ? '' : String(savedCap))
                  }}
                  placeholder="None"
                  aria-label="Max per holding percent"
                />
                <span>%</span>
              </label>
              <label
                className="pb-bench pb-check"
                title="Balance in whole shares at the latest price. What no share fits into is left over as cash, so the total invested drops a little."
              >
                <input type="checkbox" checked={wholeShares} onChange={e => setWholeShares(e.target.checked)} />
                <span>Whole shares</span>
              </label>
            </div>

            {/* Add holding */}
            <form className="pb-add-row" onSubmit={addHolding} noValidate>
              <input
                className="pb-add-ticker"
                placeholder="Ticker"
                value={tickerInput}
                onChange={e => { setTickerInput(e.target.value.toUpperCase()); setFormError(null) }}
                aria-label="Ticker"
              />
              <input
                className="pb-add-dollars"
                placeholder={savedBalance != null ? 'Amount ($ or %)' : 'Amount ($)'}
                type="text"
                inputMode="decimal"
                value={dollarInput}
                onChange={e => { setDollarInput(e.target.value); setFormError(null) }}
                aria-label="Dollar amount"
                title={savedBalance != null
                  ? `Dollars, or a percent of the ${fmt$(savedBalance)} starting balance such as 25%.`
                  : 'Dollars. Set a starting balance to add holdings as a percent of it.'}
              />
              <button type="submit" className="btn btn-primary pb-btn-sm" disabled={busy}>Add</button>
              {savedBalance != null && dollarInput.trim().endsWith('%') && parseMoneyText(dollarInput.trim().slice(0, -1)) > 0 && (
                <span className="pb-target-equiv">
                  = {fmt$(savedBalance * parseMoneyText(dollarInput.trim().slice(0, -1)) / 100)}
                </span>
              )}
              {formError && <span className="pb-form-error">{formError}</span>}
            </form>

            {savedBalance != null && holdings.length > 0 && (scaleLive || Math.abs(uninvested) >= 0.005) && (
              <BalanceNotice
                balance={savedBalance}
                invested={totalInvested}
                undone={!scaleLive}
                busy={busy}
                onScale={scaleToBalance}
                onUndo={undoScale}
              />
            )}

            {targetStatus && (targetStatus.status !== 'none' || overCap.length > 0 || undoLive) && (
              <TargetYieldNotice
                status={targetStatus}
                plan={balancePlan}
                overCap={overCap}
                cap={savedCap}
                monthlyTarget={savedMonthly}
                undo={undoLive ? balanceUndo : null}
                topHolding={topHolding}
                total={totalInvested}
                busy={busy}
                onBalance={balanceToTarget}
                onUndo={undoBalance}
              />
            )}

            {error && <div className="alert alert-error">{error}</div>}
            {data && <AnalysisNotes data={data} />}
            {!data && loading && <p className="pb-window-note pb-muted">Grading {holdings.length} holdings…</p>}

            {holdings.length > 0 ? (
              <>
                <div className="pb-table-tools">
                  <div className="pb-view-chips" role="group" aria-label="Columns">
                    {COLUMN_VIEWS.map(v => (
                      <button
                        type="button"
                        key={v.key}
                        className={`pb-period-btn ${columnView === v.key ? 'pb-period-active' : ''}`}
                        onClick={() => setColumnView(v.key)}
                        aria-pressed={columnView === v.key}
                      >{v.label}</button>
                    ))}
                  </div>
                  {stale && <span className="pb-stale-tag">{error && !loading ? 'Out of date — press Refresh' : 'Updating…'}</span>}
                </div>
                <div className={`pb-table-wrap ${stale ? 'pb-is-stale' : ''}`}>
                  <table className="pb-table">
                    <thead>
                      <tr className="pb-group-row">
                        {groupSpans.map(g => (
                          <th key={g.group} colSpan={g.span} className={g.group === 'position' ? 'pb-left' : undefined}>
                            {COLUMN_GROUPS[g.group]}
                          </th>
                        ))}
                        <th />
                      </tr>
                      <tr>
                        {visibleColumns.map(c => (
                          <th
                            key={c.key}
                            className={[c.sticky ? 'pb-sticky' : '', c.align === 'left' ? 'pb-left' : c.align === 'center' ? 'pb-center' : ''].join(' ').trim() || undefined}
                            title={c.title}
                            aria-sort={sortCol === c.key ? (sortAsc ? 'ascending' : 'descending') : undefined}
                          >
                            {c.noSort ? <span className="pb-sort-btn pb-no-sort">{c.label}</span> : (
                              <button type="button" className="pb-sort-btn" onClick={() => handleSort(c.key)}>
                                {c.label}{sortCol === c.key ? (sortAsc ? ' ▴' : ' ▾') : ''}
                              </button>
                            )}
                          </th>
                        ))}
                        <th aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map(row => (
                        <tr key={row.ticker}>
                          {visibleColumns.map(c => renderCell(c, row))}
                          <td>
                            <button type="button" className="pb-del-holding" onClick={() => deleteHolding(row.ticker)} title={`Remove ${row.ticker}`} aria-label={`Remove ${row.ticker}`}>&times;</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {(portfolioCells || savedBalance != null) && (
                      <tfoot>
                        {portfolioCells && (
                          <tr className="pb-total-row">
                            {visibleColumns.map(c => renderCell(c, portfolioCells, true))}
                            <td />
                          </tr>
                        )}
                        {savedBalance != null && (
                          <BalanceProgressRow
                            balance={savedBalance}
                            invested={totalInvested}
                            // Ticker and Amount lead every column view; the bar spans the rest.
                            span={visibleColumns.length - 1}
                          />
                        )}
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            ) : holdingsReady && (
              <div className="pb-muted pb-hint">
                Add a ticker and dollar amount above, or generate a starting mix from <strong>Strategies</strong>.
              </div>
            )}

            {pm && <ReportCard pm={pm} benchmark={data.benchmark || benchmark} stale={stale} />}

            {data && (
              <div className={`card pb-card ${stale ? 'pb-is-stale' : ''}`}>
                <div className="pb-card-head"><h3>Risk &amp; performance</h3></div>
                {data.growth_series && <div ref={growthRef} className="pb-chart pb-chart-wide" />}
                <div className="pb-chart-grid">
                  <div ref={scatterRef} className="pb-chart" />
                  {data.correlation?.labels?.length > 1
                    ? <div ref={corrRef} className="pb-chart" />
                    : <div className="pb-chart pb-chart-empty">Correlation needs two or more graded holdings.</div>}
                </div>
                {data.drawdown_series && <div ref={drawdownRef} className="pb-chart pb-chart-short" />}
              </div>
            )}
          </>
        )}

        {compareResult && (
          <CompareResults result={compareResult} radarRef={radarRef} onClose={() => setCompareResult(null)} />
        )}
      </div>

      {/* ── Strategy modal ───────────────────────────────────────────────── */}
      {awOpen && (
        <div className="pb-modal-overlay" onClick={closeStrategies}>
          <div className="pb-modal" role="dialog" aria-modal="true" aria-label={strategy.title} onClick={e => e.stopPropagation()}>
            <div className="pb-modal-head">
              <h3>{strategy.title}</h3>
              <button type="button" className="pb-port-del pb-modal-close" onClick={closeStrategies} aria-label="Close">&times;</button>
            </div>

            <div className="pb-strategy-tabs">
              {STRATEGIES.map(s => (
                <button
                  type="button"
                  key={s.key}
                  className={`pb-period-btn ${awStrategy === s.key ? 'pb-period-active' : ''}`}
                  onClick={() => { setAwStrategy(s.key); setAwResult(null); setRebalanceResult(null); setAwError(null) }}
                >{s.label}</button>
              ))}
            </div>

            <p className="pb-muted pb-strategy-blurb">{strategy.blurb}</p>

            <div className="pb-strategy-controls">
              <div>
                <span className="pb-field-label">Mode</span>
                <div className="pb-inline-group">
                  {['income', 'growth'].map(m => (
                    <button
                      type="button"
                      key={m}
                      className={`pb-period-btn ${awMode === m ? 'pb-period-active' : ''}`}
                      onClick={() => setAwMode(m)}
                    >{m.charAt(0).toUpperCase() + m.slice(1)}</button>
                  ))}
                </div>
              </div>
              <div>
                <span className="pb-field-label">ETF selection</span>
                <div className="pb-inline-group">
                  {['auto', 'manual'].map(m => (
                    <button
                      type="button"
                      key={m}
                      className={`aw-mode-btn ${awSelectionMode === m ? 'aw-mode-active' : ''}`}
                      onClick={() => setAwSelectionMode(m)}
                    >{m === 'auto' ? 'Auto' : 'Manual'}</button>
                  ))}
                </div>
              </div>
              <label>
                <span className="pb-field-label">Budget ($)</span>
                <input type="number" min="1" step="any" value={awBudget} onChange={e => setAwBudget(e.target.value)} className="pb-budget-input" />
              </label>
              <div>
                <span className="pb-field-label">Funds / class</span>
                <div className="pb-inline-group">
                  {[1, 2, 3, 4].map(n => (
                    <button
                      type="button"
                      key={n}
                      className={`pb-period-btn ${awFundsPerClass === n ? 'pb-period-active' : ''}`}
                      onClick={() => setAwFundsPerClass(n)}
                    >{n}</button>
                  ))}
                </div>
              </div>
              <div className="pb-strategy-buttons">
                <button type="button" className="btn btn-primary pb-btn-sm" onClick={runAllWeather} disabled={awLoading}>
                  {awLoading ? 'Loading…' : 'Generate'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary pb-btn-sm"
                  onClick={runRebalance}
                  disabled={rebalanceLoading || !activeId || !holdings.length}
                  title="Compare this model's mix with the template"
                >{rebalanceLoading ? 'Analyzing…' : 'Compare to template'}</button>
              </div>
            </div>

            {awError && <div className="alert alert-error">{awError}</div>}

            {awResult && (
              <>
                <div className="pb-table-wrap">
                  <table className="pb-table">
                    <thead>
                      <tr>
                        <th className="pb-left">Asset class</th>
                        <th>Target %</th>
                        <th className="pb-center">ETF</th>
                        <th className="pb-center">Source</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {awResult.allocations.map((a, idx) => (
                        <tr key={`${a.asset_class}-${a.ticker}-${idx}`}>
                          <td className="pb-left">{a.asset_class}</td>
                          <td>{a.target_pct}%</td>
                          <td className="pb-center">
                            {awSelectionMode === 'manual' ? (
                              <>
                                <input
                                  value={awOverrides[idx] ?? a.ticker}
                                  onChange={e => setAwOverrides(prev => ({ ...prev, [idx]: e.target.value.toUpperCase() }))}
                                  className="pb-override-input"
                                  list={`${uid}-aw-opts-${idx}`}
                                  aria-label={`ETF for ${a.asset_class}`}
                                />
                                <datalist id={`${uid}-aw-opts-${idx}`}>
                                  {(a.candidates || []).map(c => <option key={c} value={c} />)}
                                </datalist>
                              </>
                            ) : <strong>{a.ticker}</strong>}
                          </td>
                          <td className="pb-center"><span className={`aw-source-tag aw-source-${a.source}`}>{a.source}</span></td>
                          <td>{fmt$(a.dollar_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pb-modal-actions">
                  <button type="button" className="btn btn-success pb-btn-sm" onClick={applyAllWeather} disabled={!activeId || busy}>
                    Apply to {activeName ? `"${activeName}"` : 'portfolio'}
                  </button>
                  <button type="button" className="btn btn-secondary pb-btn-sm" onClick={closeStrategies}>Cancel</button>
                </div>
              </>
            )}

            {rebalanceResult && (
              <>
                <h4 className="pb-rebalance-head">
                  Gap to the template
                  <span className="pb-muted">Total {fmt$(rebalanceResult.total_value)}</span>
                </h4>
                <p className="pb-muted pb-small">
                  Illustrative only. Each row shows how far this model portfolio sits from the strategy template and an
                  example ticker for that asset class. It is not a recommendation to buy or sell any security.
                </p>
                <div className="pb-table-wrap">
                  <table className="pb-table">
                    <thead>
                      <tr>
                        <th className="pb-left">Asset class</th>
                        <th>Target %</th>
                        <th>Current %</th>
                        <th>Drift</th>
                        <th>Current value</th>
                        <th>Target value</th>
                        <th className="pb-left">Gap</th>
                        <th className="pb-center">Example</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rebalanceResult.suggestions.map(s => {
                        const driftColor = Math.abs(s.drift_pct) <= 2 ? 'var(--pos)' : Math.abs(s.drift_pct) <= 5 ? 'var(--p-ffb74d)' : 'var(--neg)'
                        const actionText = s.action === 'buy' ? `Under by ${fmt$(s.change_amount)}`
                          : s.action === 'reduce' ? `Over by ${fmt$(Math.abs(s.change_amount))}`
                            : s.action === 'add_new' ? `Not held: ${fmt$(s.change_amount)}`
                              : 'On target'
                        return (
                          <tr key={s.asset_class}>
                            <td className="pb-left">{s.asset_class}</td>
                            <td>{s.target_pct}%</td>
                            <td>{s.current_pct}%</td>
                            <td style={{ color: driftColor, fontWeight: 600 }}>{s.drift_pct > 0 ? '+' : ''}{s.drift_pct}%</td>
                            <td>{fmt$(s.current_amount)}</td>
                            <td>{fmt$(s.target_amount)}</td>
                            <td className={`pb-left pb-gap-${s.action}`}>{actionText}</td>
                            <td className="pb-center"><strong>{s.suggested_ticker}</strong></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {rebalanceResult.unclassified.length > 0 && (
                  <div className="pb-notice pb-notice-warn">
                    <strong>Not part of this template:</strong>{' '}
                    {rebalanceResult.unclassified.map(h => `${h.ticker} (${fmt$(h.amount)})`).join(', ')}
                  </div>
                )}
                <div className="pb-modal-actions">
                  <button type="button" className="btn btn-success pb-btn-sm" onClick={applyRebalance} disabled={busy}>Apply template to model</button>
                  <button type="button" className="btn btn-secondary pb-btn-sm" onClick={() => setRebalanceResult(null)}>Dismiss</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
