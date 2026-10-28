import React, { useState, useEffect, useCallback, useId, useMemo, useRef } from 'react'
import { useTheme } from '../context/ThemeContext'
import { chartTheme, themedPlotlyLayout } from '../utils/chartTheme'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import { formatMoney } from '../utils/money'
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
  const [editingDollar, setEditingDollar] = useState(null)
  const committingRef = useRef(false)

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
    setEditingDollar(null)
    setSortCol(null)
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
    try {
      const created = await send('/api/builder/portfolios', 'POST', { name })
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
      const created = await send('/api/builder/portfolios', 'POST', { name, holdings })
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
  const addHolding = async (e) => {
    e.preventDefault()
    if (!activeId || busy) return
    const ticker = tickerInput.trim().toUpperCase()
    const amount = Number(dollarInput)
    if (!ticker) { setFormError('Enter a ticker.'); return }
    if (/\s/.test(ticker)) { setFormError('A ticker cannot contain spaces.'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('Enter a dollar amount greater than zero.'); return }
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

  const startDollarEdit = (ticker) => {
    committingRef.current = false
    setEditingDollar(ticker)
  }
  const cancelDollarEdit = () => {
    committingRef.current = true
    setEditingDollar(null)
  }
  const commitDollarEdit = async (ticker, raw) => {
    if (committingRef.current) return
    committingRef.current = true
    setEditingDollar(null)
    const current = holdings.find(h => h.ticker === ticker)
    const amount = Math.round(Number(raw) * 100) / 100
    if (!current) return
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError(`${ticker}: the amount must be greater than zero. Use × to remove a holding.`)
      return
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
    if (!sortCol) return tableRows
    const col = COLUMNS.find(c => c.key === sortCol)
    const key = col?.sortKey || sortCol
    const dir = sortAsc ? 1 : -1
    return [...tableRows].sort((a, b) => {
      if (key === 'ticker') return dir * String(a.ticker).localeCompare(String(b.ticker))
      const av = isNum(a[key]) ? Number(a[key]) : null
      const bv = isNum(b[key]) ? Number(b[key]) : null
      // Blanks sink to the bottom in either direction.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return dir * (av - bv)
    })
  }, [tableRows, sortCol, sortAsc])

  const handleSort = (key) => {
    if (sortCol === key) setSortAsc(asc => !asc)
    else {
      setSortCol(key)
      setSortAsc(key === 'ticker')
    }
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

  const renderCell = (c, row, isTotal = false) => {
    const val = row[c.key]
    const cls = [c.sticky ? 'pb-sticky' : '', c.align === 'left' ? 'pb-left' : c.align === 'center' ? 'pb-center' : ''].join(' ').trim() || undefined
    if (c.key === 'ticker') {
      return (
        <td key={c.key} className={cls}>
          {isTotal ? <strong>{val}</strong> : (
            <span className="pb-ticker">
              {val}
              {row.pending && loading && <span className="pb-pending" title="Being analyzed">…</span>}
            </span>
          )}
        </td>
      )
    }
    if (c.key === 'grade') {
      return <td key={c.key} className={cls}>{(val || !isTotal) ? <GradeBadge grade={val} /> : '--'}</td>
    }
    if (c.key === 'dollar_amount' && !isTotal) {
      if (editingDollar === row.ticker) {
        return (
          <td key={c.key} className={cls}>
            <input
              type="number"
              min="0.01"
              step="any"
              className="pb-dollar-input"
              defaultValue={row.dollar_amount}
              aria-label={`Amount for ${row.ticker}`}
              onBlur={e => commitDollarEdit(row.ticker, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitDollarEdit(row.ticker, e.target.value) }
                if (e.key === 'Escape') { e.preventDefault(); cancelDollarEdit() }
              }}
              autoFocus
            />
          </td>
        )
      }
      return (
        <td key={c.key} className="pb-dollar-cell">
          <button type="button" className="pb-link-btn" onClick={() => startDollarEdit(row.ticker)} title="Click to edit the amount">
            {c.fmt(val)}
          </button>
        </td>
      )
    }
    const colorValue = c.abs && isNum(val) ? Math.abs(Number(val)) : val
    const color = c.band ? bandColor(colorValue, gradingSettings, c.band) : c.signed ? signedColor(val) : undefined
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
                  {pm && isNum(pm.est_annual_income) ? ` · ${fmt$(pm.est_annual_income)}/yr est. income` : ''}
                </div>
              </div>
              <div className="pb-actions">
                <button type="button" className="btn btn-success pb-btn-sm" onClick={openStrategies}>Strategies</button>
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
                placeholder="Amount ($)"
                type="number"
                min="0.01"
                step="any"
                value={dollarInput}
                onChange={e => { setDollarInput(e.target.value); setFormError(null) }}
                aria-label="Dollar amount"
              />
              <button type="submit" className="btn btn-primary pb-btn-sm" disabled={busy}>Add</button>
              {formError && <span className="pb-form-error">{formError}</span>}
            </form>

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
                            <button type="button" className="pb-sort-btn" onClick={() => handleSort(c.key)}>
                              {c.label}{sortCol === c.key ? (sortAsc ? ' ▴' : ' ▾') : ''}
                            </button>
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
                    {portfolioCells && (
                      <tfoot>
                        <tr className="pb-total-row">
                          {visibleColumns.map(c => renderCell(c, portfolioCells, true))}
                          <td />
                        </tr>
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
