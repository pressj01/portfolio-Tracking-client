import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useDialog } from '../components/DialogProvider'
import RiskReturnCharts from './analytics/RiskReturnCharts'
import IncomeCharts from './analytics/IncomeCharts'
import BacktestCharts from './analytics/BacktestCharts'
import ToolsPanel from './analytics/ToolsPanel'
import { formatMoney, formatMoneyDelta, formatMoneyWhole, getCurrencyLabel } from '../utils/money'
import { gradingSettingsPayload } from '../utils/gradingPreferences'
import NotFinancialAdviceNotice from '../components/NotFinancialAdviceNotice'
import { loadGradingPreferences, portfolioGradeGuideRows } from '../utils/gradingPreferences'
import { NavFindingLabel, NavLagNote } from '../components/NavFinding'
import { isNavLag, navProbability, NAV_LAG_EXPLAINER } from '../utils/navAssessment'
import '../components/NavAssessment.css'

// Grades the "what would it take" search can aim for (backend GRADE_TARGET_CUTOFF_KEYS).
const TARGET_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C']
const GRADE_ORDER = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+']
const gradeBelow = (grade, target) => GRADE_ORDER.indexOf(grade) >= 0 && GRADE_ORDER.indexOf(grade) < GRADE_ORDER.indexOf(target)

// Verdict colors, as NavAssessment.css paints the Dashboard's verdict card.
const VERDICT_TONE = { strong: 'var(--neg)', weak: 'var(--warning-money)', none: 'var(--pos)', insufficient: 'var(--text-dim)' }

// Sort order for the shared NAV finding, worst first when sorted descending.
// The labels themselves come from the backend; nothing here re-decides them.
const NAV_FINDING_SEVERITY = {
  verified_erosion: 9, estimated_eroder: 8, losing_capital: 7, declined: 6, nav_lag: 4,
  needs_strategy: 3, limited_evidence: 2, unconfirmed: 2, no_signal: 1, skipped: 0, not_applicable: 0,
}

// Shown before the first run so the page explains itself.
const INTRO_TILES = [
  {
    title: 'Portfolio grade (A–F)',
    body: 'One letter grade for how much return the mix earned for the swings and drops it took along the way.',
  },
  {
    title: 'Holding-by-holding scorecard',
    body: 'Each ticker’s grade, return, volatility and worst drop, so you can see which ones lift the grade and which drag it down.',
  },
  {
    title: 'NAV erosion check',
    body: 'The Dashboard’s NAV erosion result for each fund. NAV lag, a covered-call fund trailing its underlying, is shown but not counted as erosion.',
  },
  {
    title: 'What-if mixes',
    body: 'Re-weight toward returns, income or a balance, or see which holdings you own to add to and trim to reach a grade such as B. Nothing is traded.',
  },
]

const stepRowStyle = { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.6rem' }
const STEP_LABEL_WIDTH = '5.5rem'
const stepLabelStyle = {
  width: STEP_LABEL_WIDTH, display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
  color: 'var(--text-strong)', fontSize: '0.82rem', fontWeight: 600,
}
const stepNumStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
  background: 'var(--accent)', color: 'var(--bg)', fontSize: '0.7rem', fontWeight: 700,
}

const PERIODS = [
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: 'YTD', value: 'ytd' },
  { label: '1Y', value: '1y' },
  { label: '2Y', value: '2y' },
  { label: '5Y', value: '5y' },
  { label: 'Max', value: 'max' },
]

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function metricColor(val, thresholds, lowerBetter = false) {
  if (val == null) return '#8899aa'
  const [a, b, c] = thresholds
  if (lowerBetter) return val <= a ? '#4dff91' : val <= b ? '#7ecfff' : val <= c ? '#ffb74d' : '#ff6b6b'
  return val >= a ? '#4dff91' : val >= b ? '#7ecfff' : val >= c ? '#ffb74d' : '#ff6b6b'
}

export default function Analytics() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const dialog = useDialog()
  const [tickers, setTickers] = useState([])
  const [input, setInput] = useState('')
  const [benchmark, setBenchmark] = useState('SPY')
  const [period, setPeriod] = useState('1y')
  const [mode, setMode] = useState('metrics')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [portfolioTickers, setPortfolioTickers] = useState([])
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [balance, setBalance] = useState(50)
  const [snapshots, setSnapshots] = useState([])
  const [chartTab, setChartTab] = useState('risk')
  const [targetGrade, setTargetGrade] = useState('B')
  const lastAnalyzedPeriod = useRef(null)
  // Period buttons stay live during a run, so two requests can overlap. Only the
  // newest may write state; otherwise a slow 1M reply can land under a 1Y button.
  const requestSeq = useRef(0)

  // Load portfolio tickers on mount
  useEffect(() => {
    pf('/api/holdings')
      .then(r => r.json())
      .then(d => {
        const t = (d.holdings || d || []).map(h => h.ticker).filter(Boolean)
        setPortfolioTickers([...new Set(t)])
      })
      .catch(() => {})
  }, [pf, selection])

  const addTicker = useCallback(() => {
    const t = input.trim().toUpperCase()
    if (t && !tickers.includes(t)) setTickers(prev => [...prev, t])
    setInput('')
  }, [input, tickers])

  const removeTicker = (t) => setTickers(prev => prev.filter(x => x !== t))

  const loadPortfolio = () => {
    if (portfolioTickers.length > 0) {
      setTickers([...new Set([...tickers, ...portfolioTickers])])
    }
  }

  const clearAll = () => {
    requestSeq.current += 1
    setLoading(false)
    setTickers([])
    setResult(null)
    setError(null)
    lastAnalyzedPeriod.current = null
  }

  // tickerList lets "Analyze my portfolio" run on the list it just set,
  // before the setTickers state update reaches this closure.
  const runAnalysis = useCallback((runMode, tickerList = tickers) => {
    if (tickerList.length < 1) { setError('Enter at least 1 ticker.'); return }
    const seq = ++requestSeq.current
    setError(null); setResult(null); setLoading(true)
    lastAnalyzedPeriod.current = period
    const body = { tickers: tickerList, benchmark, period, mode: runMode || mode, grading_settings: gradingSettingsPayload() }
    if (runMode === 'optimize_balanced') body.balance = balance / 100
    if ((runMode || mode) === 'target_grade') body.target_grade = targetGrade
    pf('/api/analytics/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(d => {
        if (seq !== requestSeq.current) return
        if (d.error) { setError(d.error); return }
        setResult(d)
        setMode(runMode || mode)
      })
      .catch(e => { if (seq === requestSeq.current) setError('Request failed: ' + e.message) })
      .finally(() => { if (seq === requestSeq.current) setLoading(false) })
  }, [tickers, benchmark, period, mode, balance, targetGrade, pf])

  const analyzePortfolio = () => {
    const list = [...new Set([...tickers, ...portfolioTickers])]
    setTickers(list)
    runAnalysis('metrics', list)
  }

  // Dashboard re-grades as soon as the lookback changes. Keep this page on
  // the same window so a 1M click cannot keep showing last run's 1Y scores.
  useEffect(() => {
    if (tickers.length < 1) return
    if (lastAnalyzedPeriod.current == null) return
    if (lastAnalyzedPeriod.current === period) return
    runAnalysis(mode)
  }, [period, tickers.length, mode, runAnalysis])

  // NAV erosion and NAV lag: the Dashboard's assessment, sent by the backend as is.
  const nav = result?.nav_assessment || null
  const navVerdict = nav?.verdict || null
  const navLagging = navVerdict?.nav_lag || []
  const navFindings = React.useMemo(() => Object.fromEntries(
    (result?.nav_assessment?.results || []).map(row => [row.ticker, row.finding]),
  ), [result])
  const navSeverity = useCallback(ticker => {
    const code = navFindings[ticker]?.code
    return code == null ? null : NAV_FINDING_SEVERITY[code] ?? 3
  }, [navFindings])

  // Sort metrics table
  const sortedMetrics = React.useMemo(() => {
    if (!result?.metrics) return []
    if (!sortCol) return result.metrics
    return [...result.metrics].sort((a, b) => {
      const av = sortCol === '_nav' ? navSeverity(a.ticker) : a[sortCol]
      const bv = sortCol === '_nav' ? navSeverity(b.ticker) : b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sortAsc ? av - bv : bv - av
    })
  }, [result, sortCol, sortAsc, navSeverity])

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(false) }
  }


  const pm = result?.portfolio_metrics || {}
  const grade = pm.grade || {}
  // The slider can move after a Balanced run without re-running it, so labels
  // use the balance the result was computed with.
  const runBalance = result?.optimization?.summary?.balance ?? balance
  const targetResult = result?.optimization?.target || null
  const scenarioLabel = mode === 'target_grade' ? `Reach ${targetResult?.letter || targetGrade}`
    : mode === 'optimize_balanced' ? `Balanced (${runBalance}%)`
      : mode === 'optimize_income' ? 'Optimize Income' : 'Optimize Returns'
  const showYieldColumn = (result?.optimization?.weights || []).some(w => w.yield_pct != null)
  const periodLabel = PERIODS.find(p => p.value === period)?.label || period
  const runHint = tickers.length === 0
    ? 'Add a ticker or load your portfolio to enable Analyze.'
    : tickers.length === 1 ? 'The re-weighting tools need at least 2 tickers.' : null

  return (
    <div className="page">
      <NotFinancialAdviceNotice />
      <h1 style={{ marginBottom: '0.3rem' }}>Portfolio Analytics</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1rem', maxWidth: '62rem', lineHeight: 1.5 }}>
        Has your portfolio been paid enough for the risk it took? Grade your holdings (or any list of tickers),
        spot high-yield funds whose payouts are shrinking their share price, and try alternative mixes.
      </p>

      <details style={{ marginBottom: '1rem', borderLeft: '3px solid var(--accent-2)', background: 'var(--p-0a1628)', borderRadius: '4px', padding: '0.5rem 0.75rem' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--accent-2)', fontWeight: 600, fontSize: '0.85rem' }}>
          How this screen works — what every button does {'ⓘ'}
        </summary>
        <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
          <p style={{ margin: '0 0 0.6rem' }}>
            <strong style={{ color: 'var(--text-strong)' }}>What this page is.</strong> Portfolio Analytics
            grades a set of tickers over a lookback you choose. It scores risk-adjusted quality (Sharpe, Sortino,
            Calmar, Omega, Ulcer, drawdowns), shows a letter grade for the whole portfolio and each holding,
            shows the Dashboard&apos;s NAV erosion result for each fund (NAV lag included, never counted as erosion),
            can propose a new mix that favors returns, income, or a blend, and can show what it would take to reach
            a grade. Nothing is sent to a broker — Analyze and Optimize only compute.
          </p>
          <p style={{ margin: '0 0 0.7rem' }}>
            <strong style={{ color: 'var(--text-strong)' }}>Typical path.</strong> Load your holdings (or type
            tickers) → pick a period and benchmark → <strong>Analyze</strong> → read the grade card and
            per-ticker table → optionally Optimize or open the chart tabs. 1M / 3M / YTD / 1Y use the same
            calendar windows as the Dashboard, so a 1M grade here is meant to match the Dashboard 1M grade
            for the same holdings.
          </p>

          <p style={{ margin: '0.7rem 0 0.3rem', color: 'var(--text-strong)', fontWeight: 600 }}>Ticker list</p>
          <ul style={{ margin: '0 0 0.7rem 1.1rem', padding: 0 }}>
            <li><strong>Ticker</strong> — type a symbol and press Enter or click <strong>Add</strong> to put it on the list.</li>
            <li><strong>Load Portfolio (N)</strong> — adds every holding in the currently selected account (N is the count). Existing tickers stay; duplicates are ignored.</li>
            <li><strong>×</strong> on a chip — removes that ticker from this analysis only. It does not sell or edit holdings.</li>
            <li><strong>Clear</strong> — empties the ticker list and the last result.</li>
            <li><strong>Suggested Growth / Income ETFs</strong> and <strong>Add All</strong> — appear after Analyze when the mix looks growth- or income-heavy. Click a chip (or Add All) to append those tickers, then Analyze again.</li>
          </ul>

          <p style={{ margin: '0.7rem 0 0.3rem', color: 'var(--text-strong)', fontWeight: 600 }}>Lookback and benchmark</p>
          <ul style={{ margin: '0 0 0.7rem 1.1rem', padding: 0 }}>
            <li><strong>Bench</strong> — comparison ticker for up/down capture and the Risk vs Return plot. Defaults to SPY; type any symbol.</li>
            <li><strong>1M / 3M / 6M / YTD / 1Y / 2Y / 5Y / Max</strong> — the market window used for grades and ratios. After you have run Analyze once, clicking a period re-runs on that window so the table is not left showing a different lookback. 1M is one calendar month (same rule as Dashboard), not “the last 30 bars.” Max uses each ticker’s full available history.</li>
          </ul>

          <p style={{ margin: '0.7rem 0 0.3rem', color: 'var(--text-strong)', fontWeight: 600 }}>Analyze</p>
          <ul style={{ margin: '0 0 0.7rem 1.1rem', padding: 0 }}>
            <li><strong>Analyze</strong> — downloads prices for the selected window and fills the grade card, NAV erosion, per-ticker metrics, and charts. Needs at least one ticker. This is the button that produces the Dashboard-style grade.</li>
          </ul>

          <p style={{ margin: '0.7rem 0 0.3rem', color: 'var(--text-strong)', fontWeight: 600 }}>Optimize Returns</p>
          <p style={{ margin: '0 0 0.45rem' }}>
            Re-weights the tickers already on the list to raise <strong>risk-adjusted total return</strong>
            (about 60% Sharpe, 40% Sortino). It is not “pick the highest-returning ETF.” Needs at least two tickers.
            Single-stock option ETFs get a 0% model weight. Funds the NAV assessment flags for erosion (the same
            ones the Dashboard counts) get a smaller max weight; NAV lag is not penalized. Each name is capped near 40%, and the model cannot cut a current holding below about 25% of
            its present weight in one pass. The result is an illustrative scenario showing which weights the model
            would increase, decrease, or leave unchanged versus your current mix — an example to study, not a
            recommendation to trade. Nothing is sent to a broker.
          </p>

          <p style={{ margin: '0.7rem 0 0.3rem', color: 'var(--text-strong)', fontWeight: 600 }}>Optimize Income</p>
          <p style={{ margin: '0 0 0.45rem' }}>
            Re-weights toward <strong>higher cash yield</strong> while still scoring quality (Ulcer, Calmar, Omega, Sortino).
            About 70% of the objective is yield and 30% is that quality score. Yield is reduced by the price decline of
            funds the NAV assessment flags for erosion (so a 40% distribution on a melting NAV does not win); NAV lag
            is not penalized. Names with no yield
            get no model weight. Per-holding cap is about 20%. Same increase / decrease / no-change scenario; no trades are placed.
          </p>

          <p style={{ margin: '0.7rem 0 0.3rem', color: 'var(--text-strong)', fontWeight: 600 }}>Balanced</p>
          <p style={{ margin: '0 0 0.45rem' }}>
            Mixes the two goals. Clicking <strong>Balanced</strong> shows a <strong>Safety ↔ Income</strong> slider:
            0% is capital preservation (quality / low drawdown), 100% is income. The default is 50/50. Per-holding
            caps loosen from about 10% on the safety end to about 20% on the income end. Single-stock ETFs are
            tapered off toward the safety end and only get full priority on the income end if they yield 10%+.
            Move the slider, then click <strong>Balanced</strong> again — the slider alone does not re-run.
          </p>
          <p style={{ margin: '0.7rem 0 0.3rem', color: 'var(--text-strong)', fontWeight: 600 }}>Reach [grade] — What would it take?</p>
          <p style={{ margin: '0 0 0.45rem' }}>
            Pick a grade (B by default) and click <strong>What would it take?</strong>, or use the prompt under the grade card
            when the portfolio is below it. It re-weights <strong>only the holdings you already own</strong>, on the same
            period and benchmark as the grade, and makes the smallest moves it can that reach the grade: each step trims the
            holdings that drag the score most and adds to the ones that lift it most. No holding grows past 25%, and
            single-stock ETFs and funds flagged for NAV erosion can only shrink. Tickers on the list that you don&apos;t own
            are left out. If the grade can&apos;t be reached within those limits, it says so and shows the best mix it found.
            The result lists the holdings to add to and trim with dollar amounts, the before/after grade, and the same
            scenario table as the optimizers. It is a model to study, not a recommendation to trade.
          </p>
          <p style={{ margin: '0 0 0.7rem' }}>
            On any optimization result, <strong>Export CSV</strong> downloads the scenario's model weight changes and
            <strong>Save Snapshot</strong> keeps a few runs so you can compare scenarios on this page.
          </p>

          <p style={{ margin: '0.7rem 0 0.3rem', color: 'var(--text-strong)', fontWeight: 600 }}>Tabs (once tickers are loaded)</p>
          <ul style={{ margin: '0 0 0.2rem 1.1rem', padding: 0 }}>
            <li><strong>Risk &amp; Returns</strong> — risk vs return scatter, correlation heatmap, drawdown path, and (after Optimize) the efficient-frontier / yield-vs-risk charts.</li>
            <li><strong>Income &amp; Allocation</strong> — sector/type mix, monthly income calendar, trailing yield trend, and a NAV vs distributions chart for a selected ticker.</li>
            <li><strong>Backtesting</strong> — growth of $10,000 over a period you pick here, risk contribution by holding, and rolling Sharpe/Sortino.</li>
            <li><strong>Tools</strong> — peer lookup for a ticker and a What-If slider that estimates income and volatility if you change one holding’s weight. The slider does not edit your real portfolio.</li>
          </ul>
        </div>
      </details>

      {/* Controls — one row per step: pick tickers, pick a window, run. */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <div style={stepRowStyle}>
          <span style={stepLabelStyle}><span style={stepNumStyle}>1</span>Tickers</span>
          <input
            style={{
              width: 110, padding: '0.35rem 0.5rem',
              background: 'var(--bg)', border: '1px solid var(--p-3a3a5c)', borderRadius: 4,
              color: 'var(--text)', fontSize: '0.9rem',
            }}
            maxLength={10} placeholder="Add a ticker"
            aria-label="Ticker to add"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') addTicker() }}
          />
          <button className="btn btn-primary" onClick={addTicker} style={{ padding: '0.35rem 0.8rem' }}>Add</button>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>or</span>
          <button className="btn" onClick={loadPortfolio} disabled={portfolioTickers.length === 0}
            title="Add every holding in the selected account. Tickers already on the list stay."
            style={{
              padding: '0.35rem 0.8rem',
              fontWeight: 600,
              color: 'var(--accent-bright)',
              background: 'color-mix(in srgb, var(--accent) 22%, var(--surface))',
              border: '1px solid var(--accent)',
            }}>
            Load Portfolio ({portfolioTickers.length})
          </button>
        </div>

        {/* Ticker chips */}
        {tickers.length > 0 && (
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', margin: `0 0 0.6rem ${STEP_LABEL_WIDTH}`, paddingLeft: '0.5rem' }}>
            {tickers.map(t => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '0.2rem 0.5rem', background: 'var(--p-1a2a3e)', border: '1px solid var(--p-2a4a6e)',
                borderRadius: 4, fontSize: '0.82rem', color: 'var(--accent-bright)', fontWeight: 600,
              }}>
                {t}
                <button onClick={() => removeTicker(t)} aria-label={`Remove ${t}`} title={`Remove ${t} from this analysis`} style={{
                  background: 'none', border: 'none', color: 'var(--neg)', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.9rem', padding: '0 2px', lineHeight: 1,
                }}>&times;</button>
              </span>
            ))}
            <span style={{ color: 'var(--p-556677)', fontSize: '0.78rem', alignSelf: 'center' }}>
              {tickers.length} ticker{tickers.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div style={stepRowStyle}>
          <span style={stepLabelStyle}><span style={stepNumStyle}>2</span>Period</span>
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)} style={{
              padding: '0.25rem 0.5rem', borderRadius: 4, cursor: 'pointer',
              border: period === p.value ? '1px solid var(--accent)' : '1px solid var(--p-3a3a5c)',
              background: period === p.value ? 'var(--p-1a3a5c)' : 'var(--bg)',
              color: period === p.value ? 'var(--accent)' : 'var(--text-dim)',
              fontSize: '0.78rem', fontWeight: period === p.value ? 600 : 400,
            }}>{p.label}</button>
          ))}

          <span style={{ color: 'var(--p-556677)', margin: '0 0.2rem' }}>|</span>

          {/* Wrapping label, not htmlFor: Split View mounts this page twice. */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-dim)', fontSize: '0.82rem' }}
            title="The market yardstick for up/down capture and the Risk vs Return chart. SPY is the S&P 500.">
            Compare to
            <input
              style={{
                width: 60, padding: '0.35rem 0.4rem',
                background: 'var(--bg)', border: '1px solid var(--p-3a3a5c)', borderRadius: 4,
                color: 'var(--text)', fontSize: '0.82rem', textAlign: 'center',
              }}
              maxLength={6} value={benchmark}
              onChange={e => setBenchmark(e.target.value.toUpperCase())}
              onBlur={() => { if (!benchmark.trim()) setBenchmark('SPY') }}
            />
          </label>
        </div>

        {/* Suggested ETFs based on portfolio type */}
        {result?.suggested_growth && result.suggested_growth.filter(t => !tickers.includes(t)).length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600 }}>Suggested Growth ETFs:</span>
            {result.suggested_growth.filter(t => !tickers.includes(t)).map(t => (
              <button key={t} onClick={() => { if (!tickers.includes(t)) setTickers(prev => [...prev, t]) }}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'var(--p-1a2a3e)', border: '1px solid var(--p-3a5a8c)',
                         borderRadius: 12, color: 'var(--accent)', cursor: 'pointer' }}>{t}</button>
            ))}
            <button onClick={() => { const add = result.suggested_growth.filter(t => !tickers.includes(t)); setTickers(prev => [...new Set([...prev, ...add])]) }}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', background: 'var(--p-1a3a5c)', border: '1px solid var(--p-3a5a8c)',
                       borderRadius: 12, color: 'var(--accent-2)', cursor: 'pointer', fontWeight: 600 }}>Add All</button>
          </div>
        )}
        {result?.suggested_income && result.suggested_income.filter(t => !tickers.includes(t)).length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--pos-muted)', fontSize: '0.78rem', fontWeight: 600 }}>Suggested Income ETFs:</span>
            {result.suggested_income.filter(t => !tickers.includes(t)).map(t => (
              <button key={t} onClick={() => { if (!tickers.includes(t)) setTickers(prev => [...prev, t]) }}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'var(--p-1a2e1e)', border: '1px solid var(--p-2a5a3c)',
                         borderRadius: 12, color: 'var(--pos-muted)', cursor: 'pointer' }}>{t}</button>
            ))}
            <button onClick={() => { const add = result.suggested_income.filter(t => !tickers.includes(t)); setTickers(prev => [...new Set([...prev, ...add])]) }}
              style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', background: 'var(--p-1a3a2e)', border: '1px solid var(--p-2a5a3c)',
                       borderRadius: 12, color: 'var(--p-81c784)', cursor: 'pointer', fontWeight: 600 }}>Add All</button>
          </div>
        )}

        <div style={{ ...stepRowStyle, marginBottom: 0 }}>
          <span style={stepLabelStyle}><span style={stepNumStyle}>3</span>Run</span>
          <button className="btn btn-success" onClick={() => runAnalysis('metrics')} disabled={loading || tickers.length < 1}
            title="Grade these tickers over the selected period"
            style={{ padding: '0.35rem 1rem', fontWeight: 600 }}>
            {loading ? 'Loading...' : 'Analyze'}
          </button>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginLeft: '0.4rem' }}>or try a model mix:</span>
          <button className="btn" onClick={() => runAnalysis('optimize_returns')} disabled={loading || tickers.length < 2}
            title="Re-weight the list toward better return for the risk taken. Needs 2+ tickers. Nothing is traded."
            style={{ padding: '0.35rem 0.8rem', color: 'var(--accent)', background: 'var(--p-1a2a3e)', border: '1px solid var(--p-3a5a8c)' }}>
            Optimize Returns
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_income')} disabled={loading || tickers.length < 2}
            title="Re-weight the list toward higher, sustainable cash yield. Needs 2+ tickers. Nothing is traded."
            style={{ padding: '0.35rem 0.8rem', color: 'var(--pos-muted)', background: 'var(--p-1a2e1e)', border: '1px solid var(--p-2a5a3c)' }}>
            Optimize Income
          </button>
          <button className="btn" onClick={() => runAnalysis('optimize_balanced')} disabled={loading || tickers.length < 2}
            title="Blend safety and income; a slider appears after the first run. Needs 2+ tickers. Nothing is traded."
            style={{ padding: '0.35rem 0.8rem', color: 'var(--p-ffb74d)', background: 'var(--p-2e2517)', border: '1px solid var(--p-5a4a2c)' }}>
            Balanced
          </button>
          {mode === 'optimize_balanced' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ color: 'var(--pos-muted)', fontSize: '0.72rem' }}>Safety</span>
              <input type="range" min="0" max="100" value={balance}
                onChange={e => setBalance(Number(e.target.value))}
                style={{ width: 90 }} />
              <span style={{ color: 'var(--p-ffb74d)', fontSize: '0.72rem' }}>Income</span>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginLeft: 4 }}>({balance}%)</span>
            </span>
          )}
          <span style={{ color: 'var(--p-556677)', margin: '0 0.1rem' }}>|</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-dim)', fontSize: '0.78rem' }}
            title="Grade to aim for when showing what it would take">
            Reach
            <select value={targetGrade} onChange={e => setTargetGrade(e.target.value)} aria-label="Target grade"
              style={{ padding: '0.3rem 0.35rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--p-3a3a5c)', borderRadius: 4, fontSize: '0.8rem' }}>
              {TARGET_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <button className="btn" onClick={() => runAnalysis('target_grade')} disabled={loading || tickers.length < 2}
            title="Show which of the holdings you already own to add to and trim to reach this grade. Needs 2+ tickers. Nothing is traded."
            style={{ padding: '0.35rem 0.8rem', color: 'var(--accent-bright)', background: 'var(--p-1a2a3e)', border: '1px solid var(--accent)' }}>
            What would it take?
          </button>
          {/* .btn sets no background, so without one this fell back to the browser's white button. */}
          <button className="btn" onClick={clearAll} disabled={tickers.length === 0 && !result && !error && !loading}
            title="Empty the ticker list and the last result"
            style={{ padding: '0.35rem 0.7rem', marginLeft: 'auto', color: 'var(--text-dim)', background: 'transparent', border: '1px solid var(--p-3a3a5c)' }}>
            Clear
          </button>
        </div>
        {runHint && (
          <div style={{ margin: `0.35rem 0 0 ${STEP_LABEL_WIDTH}`, paddingLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            {runHint}
          </div>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {/* Before the first run: say what the page produces and offer a one-click start. */}
      {!result && !loading && (
        <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: '0.95rem' }}>What you get</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem', margin: '0.6rem 0 1rem' }}>
            {INTRO_TILES.map(t => (
              <div key={t.title} style={{ padding: '0.65rem 0.8rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-inset)' }}>
                <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>{t.title}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', lineHeight: 1.45 }}>{t.body}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {tickers.length > 0 ? (
              <button className="btn btn-success" onClick={() => runAnalysis('metrics')} style={{ padding: '0.45rem 1.1rem', fontWeight: 600 }}>
                Analyze {tickers.length} ticker{tickers.length !== 1 ? 's' : ''}
              </button>
            ) : portfolioTickers.length > 0 ? (
              <button className="btn btn-success" onClick={analyzePortfolio} style={{ padding: '0.45rem 1.1rem', fontWeight: 600 }}>
                Analyze my portfolio ({portfolioTickers.length} holdings)
              </button>
            ) : null}
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
              {tickers.length > 0 || portfolioTickers.length > 0
                ? `Uses the ${periodLabel} window, compared with ${benchmark || 'SPY'}. Change either in step 2.`
                : 'Type a ticker in step 1 to get started.'}
              {tickers.length === 0 && portfolioTickers.length > 0 && ' Or type tickers in step 1 to grade any list, such as funds you are considering.'}
            </span>
          </div>
        </div>
      )}

      {result && !loading && (!result.metrics || result.metrics.length === 0) && (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          {result.window_too_short ? (
            <>
              Only {result.window_observations ?? 0} trading{' '}
              {result.window_observations === 1 ? 'day' : 'days'} in this window.
              Risk ratios need at least 15 trading days — pick a longer period to grade this portfolio.
            </>
          ) : (
            <>No holdings had enough price history in this window to compute metrics.</>
          )}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" />
          <div style={{ color: 'var(--text-dim)', marginTop: '0.5rem', fontSize: '0.85rem' }}>Fetching data & calculating metrics...</div>
        </div>
      )}

      {result && !loading && (
        <>
          {/* Portfolio Grade + Quick Stats */}
          {grade.overall && (
            <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {/* Grade badge */}
                <div style={{ textAlign: 'center', minWidth: 120 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '0.3rem' }}>Portfolio Grade</div>
                  <GradeBadge grade={grade.overall} large />
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                    Score: {grade.score}
                  </div>
                </div>

                {/* Grade breakdown bars */}
                <div style={{ flex: 1, minWidth: 250 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>Grade Breakdown</div>
                  {(grade.breakdown || []).map((b, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span style={{ width: 130, fontSize: '0.78rem', color: 'var(--text-dim-2)', textAlign: 'right' }}>
                        {b.category} ({b.weight_pct ?? b.weight}%)
                      </span>
                      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 4, height: 16, position: 'relative' }}>
                        <div style={{
                          width: `${Math.max(b.score, 2)}%`, height: '100%', borderRadius: 4,
                          background: b.score >= 80 ? 'var(--p-4caf50)' : b.score >= 60 ? 'var(--p-ffb74d)' : 'var(--neg-2)',
                        }} />
                        <span style={{
                          position: 'absolute', right: 4, top: 0, fontSize: '0.7rem',
                          color: 'var(--text-strong)', lineHeight: '16px',
                        }}>{b.grade} ({b.score})</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Quick stats */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 160 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Quick Stats</div>
                  <Stat label="Holdings" value={pm.n_holdings} />
                  <Stat label="Effective N" value={pm.effective_n?.toFixed(1)} />
                  <Stat label="Diversification Ratio" value={pm.diversification_ratio?.toFixed(2)} />
                  <Stat label="Capture Ratio" value={pm.capture_ratio?.toFixed(2)} />
                  <Stat label="Max Drawdown" value={pm.max_drawdown != null ? (pm.max_drawdown * 100).toFixed(1) + '%' : '—'} color="#ef5350" />
                  <Stat label="Top Holding" value={pm.top_weight != null ? pm.top_weight + '%' : '—'} />
                  <Stat label="Ulcer Index" value={pm.ulcer_index?.toFixed(2)} color={metricColor(pm.ulcer_index, [3, 7, 12], true)} />
                  <Stat label="Est. Annual Income" value={formatMoneyWhole(pm.est_annual_income)} color="#66bb6a" />
                </div>

                {/* NAV erosion: the Dashboard's verdict for these funds and dates. */}
                {nav && (
                  <div style={{ minWidth: 220, maxWidth: 320, flex: '1 1 220px' }}>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: '0.3rem' }}>NAV Erosion</div>
                    {navVerdict ? (
                      <div className="nav-assessment" style={{ margin: 0 }}>
                        <div className="nav-verdict-row" style={{ margin: 0 }}>
                          <div className={`summary-card nav-verdict-card nav-verdict-${navVerdict.strength}`} role="status" title={navVerdict.explanation}>
                            <div className="summary-value">{navVerdict.label}</div>
                            <div className="summary-sub">{navProbability(navVerdict.probability)} evidence probability</div>
                            {navVerdict.summary && <div className="summary-sub">{navVerdict.summary}</div>}
                            {navLagging.length > 0 && (
                              <div className="summary-sub ci-nav-tone-lag" title={NAV_LAG_EXPLAINER}>
                                {navLagging.length} covered-call fund{navLagging.length === 1 ? '' : 's'} with NAV lag, not counted as erosion
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="nav-reference-warning" style={{ fontSize: '0.8rem' }}>{nav.error || 'NAV assessment unavailable.'}</div>
                    )}
                    {navVerdict && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.35rem', lineHeight: 1.4 }}>
                        {nav.whole_portfolio
                          ? 'Same assessment as the Dashboard for this period.'
                          : 'The Dashboard’s method, for only the tickers listed (cash and unlisted holdings left out).'}
                        {nav.requested_start && nav.as_of && ` ${nav.requested_start} → ${nav.as_of}.`}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Below the target grade: offer the reach-a-grade scenario right here. */}
              {mode !== 'target_grade' && tickers.length >= 2 && gradeBelow(grade.overall, targetGrade) && (
                <div style={{
                  display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.85rem',
                  padding: '0.55rem 0.8rem', borderRadius: 6, border: '1px solid var(--p-3a5a8c)', background: 'var(--p-1a2a3e)',
                }}>
                  <span style={{ color: 'var(--text-strong)', fontSize: '0.85rem' }}>
                    What would it take to get this portfolio to a <strong>{targetGrade}</strong>?
                  </span>
                  <button className="btn btn-primary" onClick={() => runAnalysis('target_grade')} disabled={loading}
                    style={{ padding: '0.3rem 0.8rem', fontSize: '0.82rem' }}>
                    Show what to add to and trim
                  </button>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Uses only the holdings you already own.</span>
                </div>
              )}
            </div>
          )}

          {/* Metrics Table */}
          {sortedMetrics.length > 0 && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--accent-2)', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                Per-Ticker Metrics
                <span style={{ color: 'var(--p-556677)', fontWeight: 400, fontSize: '0.82rem', marginLeft: '0.5rem' }}>
                  ({result.data_window?.period_label
                    || PERIODS.find(p => p.value === (result.data_window?.period || period))?.label
                    || period})
                </span>
              </h3>

              {/* Data window — scores are a deterministic function of this window,
                  so the same window always reproduces the same scores. */}
              {result.data_window && (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                  Data window: <span style={{ color: 'var(--text-strong)' }}>{result.data_window.start} → {result.data_window.end}</span>
                  {' '}({result.data_window.trading_days} trading days, benchmark {result.data_window.benchmark}).
                  <span title="Scores are deterministic for a given window. They shift only as the trailing window moves to a new day or the latest intraday bar updates."> Re-running on the same window reproduces identical scores. {'ⓘ'}</span>
                  {pm.grade_window_days != null && pm.grade_window_days !== result.data_window.trading_days && (
                    <span> Portfolio grade computed on the {pm.grade_window_days}-day window all holdings share.</span>
                  )}
                  {pm.grade_excluded?.length > 0 && (
                    <span style={{ color: 'var(--p-ffb74d)' }}> Excluded from the portfolio grade for insufficient history: {pm.grade_excluded.join(', ')}.</span>
                  )}
                </div>
              )}

              {/* Hidden explanation: what the Score means, how it's computed, why it matters */}
              <details style={{ marginBottom: '0.75rem', borderLeft: '3px solid var(--accent-2)', background: 'var(--p-0a1628)', borderRadius: '4px', padding: '0.5rem 0.75rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--accent-2)', fontWeight: 600, fontSize: '0.85rem' }}>
                  How is the Score computed? {'ⓘ'}
                </summary>
                <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
                  <p style={{ margin: '0 0 0.6rem' }}>
                    <strong style={{ color: 'var(--text-strong)' }}>What it is.</strong> A single <strong>risk-adjusted quality score from 0 to 100</strong> (higher is better),
                    mapped to a letter grade. It is computed over the selected lookback period from daily returns and is purely
                    backward-looking — it rewards consistent risk-adjusted returns and penalizes deep, prolonged drawdowns.
                    1M uses the same calendar-month window as the Dashboard. It is <em>not</em> a return forecast or a buy/sell signal.
                  </p>

                  <p style={{ margin: '0 0 0.4rem' }}>
                    <strong style={{ color: 'var(--text-strong)' }}>How it's computed.</strong> Each component metric is scored 0–100 against
                    fixed thresholds, then combined as a <strong>weighted average</strong> (only metrics with enough observations in the
                    selected window — 30 days on a 1Y lookback, scaled down to about 15 days on 1M — are
                    included, and the weights renormalize over whatever is available). Higher-is-better metrics score 100 at/above their
                    "excellent" threshold; lower-is-better metrics score 100 at/below it; values in between are linearly interpolated.
                  </p>

                  <div style={{ overflowX: 'auto', margin: '0.5rem 0' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', width: '100%' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)' }}>Metric</th>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Ticker wt</th>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Portfolio wt</th>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)' }}>Direction</th>
                          <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)' }}>Thresholds (exc / good / fair / poor)</th>
                        </tr>
                      </thead>
                      <tbody style={{ color: 'var(--text-strong)' }}>
                        {portfolioGradeGuideRows().map(row => {
                          const metric = row.metric
                          const tw = row.holdingShare == null ? '—' : `${row.holdingShare}%`
                          const pw = `${row.portfolioShare}%`
                          const dir = row.direction
                          const thr = row.list
                          return (
                          <tr key={metric} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                            <td style={{ padding: '0.25rem 0.5rem' }}>{metric}</td>
                            <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>{tw}</td>
                            <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>{pw}</td>
                            <td style={{ padding: '0.25rem 0.5rem', color: 'var(--text-dim)' }}>{dir} is better</td>
                            <td style={{ padding: '0.25rem 0.5rem', color: 'var(--text-dim)' }}>{thr}</td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.74rem' }}>
                    The portfolio row uses the same metrics on the blended portfolio return stream and adds
                    <strong> Diversification</strong> (the effective number of holdings), <strong>Diversification Ratio</strong> (how
                    much the holdings offset one another, from their correlations), and <strong>Capture Ratio</strong> (upside capture
                    ÷ downside capture), plus NAV Health where NAV-erosion data exists. Stale, delisted, or
                    flat-lined price series are treated as un-gradeable and score 0 rather than being rewarded for zero volatility.
                  </p>

                  {/* Worked example using ULTY */}
                  <div style={{ margin: '0.5rem 0 0.75rem', padding: '0.5rem 0.75rem', background: 'var(--p-0b0b1c)', borderRadius: '4px', border: '1px solid var(--p-2a3a4e)' }}>
                    <p style={{ margin: '0 0 0.4rem' }}>
                      <strong style={{ color: 'var(--text-strong)' }}>Worked example — ULTY (per-ticker).</strong> Each raw metric is
                      first mapped to a 0–100 sub-score, then multiplied by its weight. For example, ULTY's Ulcer Index of 12.56 lands
                      in the fair-to-poor band (12–20), so it scores <code>40 + 20 × (20 − 12.56) / (20 − 12) = 58.6</code>; its Sortino
                      of 0.10 is below the "poor" floor of 0.5, so it scores <code>40 × 0.10 / 0.5 = 8.0</code>.
                    </p>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: '0.76rem', width: '100%' }}>
                        <thead>
                          <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)' }}>Metric</th>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>ULTY value</th>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Sub-score</th>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Weight</th>
                            <th style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)', textAlign: 'right' }}>Contribution</th>
                          </tr>
                        </thead>
                        <tbody style={{ color: 'var(--text-strong)' }}>
                          {[
                            ['Ulcer Index', '12.56', '58.6', '25%', '14.65'],
                            ['Calmar Ratio', '0.18', '36.0', '20%', '7.20'],
                            ['Omega Ratio', '1.05', '45.0', '15%', '6.75'],
                            ['Sortino Ratio', '0.10', '8.0', '15%', '1.20'],
                            ['Sharpe Ratio', '0.07', '42.8', '10%', '4.28'],
                            ['Max Drawdown', '24.2%', '71.6', '10%', '7.16'],
                            ['Downside Capture', '161', '26.3', '5%', '1.32'],
                          ].map(([metric, val, sub, wt, contrib]) => (
                            <tr key={metric} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                              <td style={{ padding: '0.25rem 0.5rem' }}>{metric}</td>
                              <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{val}</td>
                              <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>{sub}</td>
                              <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{wt}</td>
                              <td style={{ padding: '0.25rem 0.5rem', textAlign: 'right' }}>{contrib}</td>
                            </tr>
                          ))}
                          <tr style={{ fontWeight: 700 }}>
                            <td style={{ padding: '0.3rem 0.5rem' }} colSpan={4}>Total = weighted average (weights sum to 100%)</td>
                            <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--neg-2)' }}>42.5 → F</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', color: 'var(--p-556677)' }}>
                      Summing the contributions gives 42.56, which rounds to the <strong>42.5</strong> shown in the table — a grade of
                      <strong> F</strong>. (Minor differences from a hand calculation come from the engine using full-precision metric
                      values rather than the 2-decimal figures displayed.)
                    </p>
                  </div>

                  <p style={{ margin: '0 0 0.4rem' }}>
                    <strong style={{ color: 'var(--text-strong)' }}>Letter grades.</strong> {(() => {
                      const cuts = loadGradingPreferences().portfolioRisk.letterCutoffs
                      return `A+ ≥${cuts.aPlus} · A ≥${cuts.a} · A- ≥${cuts.aMinus} · B+ ≥${cuts.bPlus} · B ≥${cuts.b} · B- ≥${cuts.bMinus} · C+ ≥${cuts.cPlus} · C ≥${cuts.c} · C- ≥${cuts.cMinus} · D+ ≥${cuts.dPlus} · D ≥${cuts.d} · D- ≥${cuts.dMinus} · F <${cuts.dMinus}`
                    })()}
                  </p>

                  <p style={{ margin: 0 }}>
                    <strong style={{ color: 'var(--text-strong)' }}>Significance.</strong> Because Ulcer Index + Calmar together
                    carry ~45% of the weight, the score is deliberately <strong>drawdown-focused</strong> — it favours capital
                    preservation and steady income over raw upside. A high-yield fund can still grade poorly if it gets there with
                    severe drawdowns or high downside capture (see ULTY above). Use it to compare holdings on risk-adjusted terms,
                    not to predict future returns.
                  </p>
                </div>
              </details>

              {/* What the NAV column is: the shared per-fund result, not a number of its own. */}
              <details style={{ marginBottom: '0.75rem', borderLeft: '3px solid var(--p-ffb74d)', background: 'var(--p-0a1628)', borderRadius: '4px', padding: '0.5rem 0.75rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--p-ffb74d)', fontWeight: 600, fontSize: '0.85rem' }}>
                  NAV erosion and NAV lag {'ⓘ'}
                </summary>
                <div style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
                  <p style={{ margin: '0 0 0.6rem' }}>
                    The <strong style={{ color: 'var(--text-strong)' }}>NAV</strong> column shows the same result for each fund
                    as the Dashboard and both NAV Erosion screens, over this screen&apos;s period and each fund&apos;s saved reference.
                    The backend decides it once, so a fund reads the same everywhere.
                  </p>
                  <ul style={{ margin: '0 0 0.6rem 1.1rem', padding: 0 }}>
                    <li><span className="ci-nav-tone-neg">Red</span>: verified NAV erosion, or an estimated covered-call eroder.</li>
                    <li><span className="ci-nav-tone-warn">Amber</span>: losing capital against its reference (a price-based review candidate), or published NAV that fell.</li>
                    <li><span className="ci-nav-tone-lag">Blue</span>: NAV lag. The fund&apos;s price trailed its underlying, which is expected for a fund that sells calls. It is listed, never counted as erosion.</li>
                  </ul>
                  <p style={{ margin: '0 0 0.4rem' }}>
                    Only the red and amber funds count toward the NAV Erosion verdict in the grade card, and only they get the optimizers&apos;
                    erosion limits. To change a fund&apos;s reference or answer whether it sells calls, use Reference details in the
                    Dashboard&apos;s NAV panel.
                  </p>
                  <NavLagNote />
                </div>
              </details>

              <div style={{ maxHeight: '600px', overflow: 'auto', borderRadius: '4px' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
                <thead>
                  <tr>
                    {[
                      { key: 'ticker', label: 'Ticker' },
                      { key: 'grade', label: 'Grade' },
                      { key: 'score', label: 'Score' },
                      { key: 'weight', label: 'Wt %' },
                      { key: 'ulcer_index', label: 'Ulcer', tip: 'Drawdown severity & duration. <3 great, <5 good, >10 poor' },
                      { key: 'sharpe', label: 'Sharpe', tip: 'Risk-adjusted return. >1.5 great, >1.0 good, <0.5 poor' },
                      { key: 'sortino', label: 'Sortino', tip: 'Like Sharpe but only penalizes downside. >2.0 great, >1.5 good' },
                      { key: 'calmar', label: 'Calmar', tip: 'Return vs max drawdown. >2.0 great, >1.0 good' },
                      { key: 'omega', label: 'Omega', tip: 'Gains vs losses ratio. >2.0 great, >1.5 good' },
                      { key: 'max_drawdown', label: 'Max DD', tip: 'Largest peak-to-trough decline. Closer to 0% is better' },
                      { key: 'up_capture', label: 'Up Cap', tip: '% of benchmark gains captured. >100% = outperforming in up markets' },
                      { key: 'down_capture', label: 'Dn Cap', tip: '% of benchmark losses captured. <100% = less downside than benchmark' },
                      { key: 'annual_ret', label: 'Ann Ret', tip: 'Price return annualized (excludes dividends)' },
                      { key: 'annual_total_ret', label: 'Tot Ret', tip: 'Price return + dividend yield annualized' },
                      { key: 'annual_vol', label: 'Ann Vol', tip: 'Annualized standard deviation. Lower = less volatile' },
                      { key: '_nav', label: 'NAV', tip: 'The same NAV result as the Dashboard and NAV Erosion screens. NAV lag is not erosion. Sorts worst first.' },
                    ].map(col => (
                      <th key={col.key} onClick={() => handleSort(col.key)} title={col.tip || ''} style={{
                        padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)',
                        color: sortCol === col.key ? 'var(--accent)' : 'var(--text-dim)',
                        cursor: 'pointer', whiteSpace: 'nowrap', textAlign: col.key === 'ticker' ? 'left' : 'right',
                        fontSize: '0.78rem',
                        position: 'sticky', top: 0, zIndex: 3, background: 'var(--p-0b0b1c)',
                      }}>
                        {col.label}{col.tip ? ' \u24D8' : ''} {sortCol === col.key ? (sortAsc ? '\u25B4' : '\u25BE') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Portfolio row */}
                  {pm.sharpe != null && (
                    <tr style={{ background: 'var(--p-0a1628)', fontWeight: 600 }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: 'var(--accent-2)' }}>PORTFOLIO</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}><GradeBadge grade={grade.overall} /></td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)' }}>{grade.score}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>100</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.ulcer_index, [3, 7, 12], true) }}>
                        {pm.ulcer_index?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.sharpe, [1.5, 1.0, 0.5]) }}>
                        {pm.sharpe?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.sortino, [2.0, 1.5, 1.0]) }}>
                        {pm.sortino?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.calmar, [1.5, 1.0, 0.5]) }}>
                        {pm.calmar?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.omega, [2.0, 1.5, 1.2]) }}>
                        {pm.omega?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--neg-2)' }}>
                        {pm.max_drawdown != null ? (pm.max_drawdown * 100).toFixed(1) + '%' : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>
                        {pm.up_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(pm.down_capture, [80, 90, 100], true) }}>
                        {pm.down_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }} colSpan={3}></td>
                      <td title={navVerdict?.explanation || ''} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontSize: '0.76rem' }}>
                        {navVerdict ? <strong style={{ color: VERDICT_TONE[navVerdict.strength] || 'var(--text-strong)' }}>{navVerdict.label}</strong> : '—'}
                      </td>
                    </tr>
                  )}
                  {sortedMetrics.map(m => (
                    <tr key={m.ticker} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                      <td style={{ padding: '0.4rem 0.5rem', color: 'var(--accent-bright)', fontWeight: 600 }}>{m.ticker}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}><GradeBadge grade={m.grade} /></td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)' }}>{m.score}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{m.weight?.toFixed(1)}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.ulcer_index, [3, 7, 12], true) }}>
                        {m.ulcer_index?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.sharpe, [1.5, 1.0, 0.5]) }}>
                        {m.sharpe?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.sortino, [2.0, 1.5, 1.0]) }}>
                        {m.sortino?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.calmar, [1.5, 1.0, 0.5]) }}>
                        {m.calmar?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.omega, [2.0, 1.5, 1.2]) }}>
                        {m.omega?.toFixed(2) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--neg-2)' }}>
                        {m.max_drawdown != null ? m.max_drawdown.toFixed(1) + '%' : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>
                        {m.up_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: metricColor(m.down_capture, [80, 90, 100], true) }}>
                        {m.down_capture?.toFixed(0) ?? '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: m.annual_ret >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {m.annual_ret != null ? `${m.annual_ret.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: m.annual_total_ret >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                        {m.annual_total_ret != null ? `${m.annual_total_ret.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>
                        {m.annual_vol != null ? `${m.annual_vol.toFixed(1)}%` : '—'}
                      </td>
                      {(() => {
                        const finding = navFindings[m.ticker]
                        return (
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontSize: '0.76rem', minWidth: 150 }}>
                            {finding ? <>
                              <NavFindingLabel finding={finding} />
                              {finding.detail && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{finding.detail}</small>}
                              {isNavLag(finding) && <NavLagNote compact />}
                            </> : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                          </td>
                        )
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Optimization results */}
          {result.optimization && (
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
              <h3 style={{ color: 'var(--accent-2)', margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                Optimization Results
                {mode === 'optimize_returns' && ' — Max Returns (Sharpe + Sortino)'}
                {mode === 'optimize_income' && ' — Max Income (Omega, Calmar, Ulcer, Sortino)'}
                {mode === 'optimize_balanced' && ` — Balanced (${runBalance}%) — Income vs Safety (Omega, Calmar, Ulcer, Sortino)`}
                {mode === 'target_grade' && ` — What it takes to reach a ${targetResult?.letter || targetGrade}`}
              </h3>

              {/* Reach a grade: the headline answer, then the holdings to add to and trim. */}
              {targetResult && (() => {
                const t = targetResult
                const weights = result.optimization.weights || []
                const adds = weights.filter(w => w.action === 'BUY').sort((a, b) => b.dollar_change - a.dollar_change)
                const trims = weights.filter(w => w.action === 'SELL').sort((a, b) => a.dollar_change - b.dollar_change)
                const SHOWN = 12
                const headline = t.status === 'no_holdings'
                  ? 'None of the tickers on the list are held, so there is nothing to re-weight. Load your portfolio first.'
                  : t.status === 'already'
                    ? `This portfolio is already a ${t.start_grade} (${t.start_score}), at or above a ${t.letter}. No changes are needed.`
                    : t.status === 'reached'
                      ? `Shifting about ${formatMoneyWhole(t.moved_value)} (${t.moved_pct}% of the graded holdings) among holdings you already own takes the grade from ${t.start_grade} (${t.start_score}) to ${t.grade} (${t.score}).`
                      : `A ${t.letter} (score ${t.cutoff}+) can't be reached by re-weighting these holdings within the limits below. The best mix found scores ${t.score} (${t.grade}), up from ${t.start_grade} (${t.start_score}), by shifting about ${formatMoneyWhole(t.moved_value)}.`
                const list = (items, color) => <>
                  {items.slice(0, SHOWN).map(w => (
                    <div key={w.ticker} style={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
                      <strong style={{ color: 'var(--accent-bright)' }}>{w.ticker}</strong>{' '}
                      <span style={{ color, fontWeight: 600 }}>{formatMoneyDelta(w.dollar_change, { digits: 0 })}</span>{' '}
                      <span style={{ color: 'var(--text-dim)' }}>{w.current_pct.toFixed(1)}% {'→'} {w.optimal_pct.toFixed(1)}%</span>
                    </div>
                  ))}
                  {items.length > SHOWN && <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>+{items.length - SHOWN} more in the table below</div>}
                </>
                return (
                  <div style={{
                    marginBottom: '0.9rem', padding: '0.7rem 0.9rem', borderRadius: 6, background: 'var(--surface-inset)',
                    border: `1px solid ${t.status === 'unreachable' || t.status === 'no_holdings' ? 'var(--p-5a4a2c)' : 'var(--p-2a5a3c)'}`,
                  }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-strong)', fontWeight: 600, lineHeight: 1.45 }}>{headline}</div>
                    {(adds.length > 0 || trims.length > 0) && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.5rem 1.5rem', margin: '0.6rem 0' }}>
                        <div>
                          <div style={{ color: 'var(--pos)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.15rem' }}>Add to ({adds.length})</div>
                          {adds.length ? list(adds, 'var(--pos)') : <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>None</div>}
                        </div>
                        <div>
                          <div style={{ color: 'var(--neg)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.15rem' }}>Trim ({trims.length})</div>
                          {trims.length ? list(trims, 'var(--neg)') : <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>None</div>}
                        </div>
                      </div>
                    )}
                    {t.status !== 'no_holdings' && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', lineHeight: 1.5, marginTop: '0.35rem' }}>
                        Limits: only holdings you already own, graded on the same {periodLabel} window as the grade above, and no holding
                        grows past {t.max_weight_pct}%. The search makes the smallest moves it can that reach the grade.
                        {t.blocked?.length > 0 && ` Can only shrink: ${t.blocked.map(b => `${b.ticker} (${b.reason})`).join(', ')}.`}
                        {t.not_held?.length > 0 && ` On the list but not held, so left out: ${t.not_held.join(', ')}.`}
                        {t.ungraded?.length > 0 && ` Held but without enough history to grade, so left as is: ${t.ungraded.join(', ')}.`}
                        {t.status === 'unreachable' && t.stopped === 'budget' && ' The search hit its time limit; a longer one might find a little more.'}
                        {' '}Illustrative only: a model mix to study, not a recommendation to buy or sell.
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Summary stats */}
              {result.optimization.summary && (
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {Object.entries(result.optimization.summary).map(([k, v]) => (
                    <div key={k} style={{ fontSize: '0.82rem' }}>
                      <span style={{ color: 'var(--text-dim)' }}>{k.replace(/_/g, ' ')}: </span>
                      <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
                        {typeof v === 'number' ? (k.includes('income') ? formatMoneyWhole(v) : v.toFixed(2) + (k.includes('pct') || k.includes('yield') || k.includes('return') || k.includes('vol') || k.includes('dd') ? '%' : '')) : v}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Weights table */}
              {result.optimization.weights && (
                <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%', marginBottom: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Ticker</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Current %</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Optimal %</th>
                      {showYieldColumn && (
                        <th style={{ ...thStyle, textAlign: 'right' }}>Yield %</th>
                      )}
                      <th style={{ ...thStyle, textAlign: 'right' }}>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.optimization.weights.map(w => {
                      const change = w.optimal_pct - w.current_pct
                      return (
                        <tr key={w.ticker} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                          <td style={{ padding: '0.35rem 0.5rem', color: 'var(--accent-bright)', fontWeight: 600 }}>{w.ticker}</td>
                          <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{w.current_pct.toFixed(1)}</td>
                          <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{w.optimal_pct.toFixed(1)}</td>
                          {showYieldColumn && (
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--pos)' }}>{w.yield_pct != null ? w.yield_pct.toFixed(2) : '—'}</td>
                          )}
                          <td style={{
                            padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 600,
                            color: change > 0.5 ? 'var(--pos)' : change < -0.5 ? 'var(--neg)' : 'var(--text-dim)',
                          }}>
                            {change > 0 ? '+' : ''}{change.toFixed(1)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* Before / After Comparison */}
              {result.optimization.comparison && (() => {
                const c = result.optimization.comparison
                const b = c.before, a = c.after
                const delta = (v1, v2, fmt, isDollar = false) => {
                  if (v1 == null || v2 == null) return '—'
                  const diff = v2 - v1
                  const color = diff > 0.01 ? '#4dff91' : diff < -0.01 ? '#ff6b6b' : '#8899aa'
                  if (isDollar) {
                    return <span style={{ color }}>{formatMoneyDelta(diff, { digits: 0 })}</span>
                  }
                  return <span style={{ color }}>{diff > 0 ? '+' : ''}{fmt(diff)}</span>
                }
                const fmtPct = v => (v * 100).toFixed(1) + '%'
                const fmtDollar = v => formatMoneyWhole(v, { absolute: true })
                const fmtNum = v => v.toFixed(2)
                const metricRow = (label, bv, av, fmt, isDollar = false, tip = '') => (
                  <tr key={label} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                    <td title={tip} style={{ padding: '0.3rem 0.5rem', color: 'var(--text-dim)', fontSize: '0.78rem', cursor: tip ? 'help' : 'default' }}>{label}{tip ? ' \u24D8' : ''}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{bv != null ? (isDollar ? formatMoneyWhole(bv, { absolute: true }) : fmt(bv)) : '—'}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{av != null ? (isDollar ? formatMoneyWhole(av, { absolute: true }) : fmt(av)) : '—'}</td>
                    <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right' }}>{delta(bv, av, fmt, isDollar)}</td>
                  </tr>
                )
                return (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-strong)', fontWeight: 600, marginBottom: '0.4rem' }}>Impact Analysis — Before vs After</div>
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%', marginBottom: '0.5rem' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Metric</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Current</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>After</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                          <td style={{ padding: '0.3rem 0.5rem', color: 'var(--text-dim)', fontSize: '0.78rem' }}>Grade</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 700, fontSize: '0.9rem' }}>{b.grade} ({b.score})</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontWeight: 700, fontSize: '0.9rem',
                            color: a.score > b.score ? 'var(--pos)' : a.score < b.score ? 'var(--neg)' : 'var(--text-strong)' }}>{a.grade} ({a.score})</td>
                          <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right',
                            color: a.score > b.score ? 'var(--pos)' : a.score < b.score ? 'var(--neg)' : 'var(--text-dim)' }}>
                            {a.score !== b.score ? (a.score > b.score ? '+' : '') + (a.score - b.score).toFixed(1) : '—'}
                          </td>
                        </tr>
                        {metricRow('Monthly Income', b.monthly_income, a.monthly_income, fmtDollar, true)}
                        {metricRow('Annual Income', b.annual_income, a.annual_income, fmtDollar, true)}
                        {metricRow('Sharpe Ratio', b.sharpe, a.sharpe, fmtNum, false, 'Risk-adjusted return. >1.5 great, >1.0 good, <0.5 poor')}
                        {metricRow('Sortino Ratio', b.sortino, a.sortino, fmtNum, false, 'Like Sharpe but only penalizes downside. >2.0 great, >1.5 good')}
                        {metricRow('Omega Ratio', b.omega, a.omega, fmtNum, false, 'Gains vs losses ratio. >2.0 great, >1.5 good')}
                        {metricRow('Calmar Ratio', b.calmar, a.calmar, fmtNum, false, 'Return vs max drawdown. >2.0 great, >1.0 good')}
                        {metricRow('Ulcer Index', b.ulcer_index, a.ulcer_index, fmtNum, false, 'Drawdown severity & duration. <3 great, <5 good, >10 poor')}
                        {metricRow('Max Drawdown', b.max_drawdown, a.max_drawdown, fmtPct, false, 'Largest peak-to-trough decline. Closer to 0% is better')}
                        {(b.nav_flagged_share != null || a.nav_flagged_share != null) && (() => {
                          const pct = v => v != null ? `${(v * 100).toFixed(1)}%` : '—'
                          const delta = b.nav_flagged_share != null && a.nav_flagged_share != null ? a.nav_flagged_share - b.nav_flagged_share : null
                          const tip = 'Share of the mix in funds the NAV assessment flags for erosion (the Dashboard verdict’s holdings behind its reading). NAV lag is not counted. Lower is better.'
                          return (
                            <tr style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                              <td title={tip} style={{ padding: '0.3rem 0.5rem', color: 'var(--text-dim)', fontSize: '0.78rem', cursor: 'help' }}>In NAV-flagged funds {'ⓘ'}</td>
                              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{pct(b.nav_flagged_share)}</td>
                              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{pct(a.nav_flagged_share)}</td>
                              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: delta == null ? 'var(--text-dim)' : delta < -0.001 ? 'var(--pos)' : delta > 0.001 ? 'var(--neg)' : 'var(--text-dim)', fontWeight: 600 }}>
                                {delta != null ? `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts` : '—'}
                              </td>
                            </tr>
                          )
                        })()}
                      </tbody>
                    </table>
                  </div>
                )
              })()}

              {/* Model allocation scenario */}
              {result.optimization.weights?.[0]?.action && (() => {
                const sorted = [...result.optimization.weights].sort((a, b) => {
                  const pri = { SELL: 0, BUY: 1, HOLD: 2 }
                  if (pri[a.action] !== pri[b.action]) return pri[a.action] - pri[b.action]
                  return Math.abs(b.dollar_change) - Math.abs(a.dollar_change)
                })
                const rs = result.optimization.rebalance_summary || {}
                // BUY / SELL / HOLD are the API's direction codes. The screen shows them as
                // model weight shifts so the table reads as a scenario, not trade instructions.
                const shiftLabel = { BUY: 'Increase', SELL: 'Decrease', HOLD: 'No change' }
                const actionColor = { BUY: '#4dff91', SELL: '#ff6b6b', HOLD: '#8899aa' }
                const actionBg = { BUY: 'rgba(77,255,145,0.12)', SELL: 'rgba(255,107,107,0.12)', HOLD: 'rgba(136,153,170,0.08)' }
                // Quick action summary
                const comp = result.optimization.comparison
                const incomeChange = comp ? (comp.after.annual_income - comp.before.annual_income) : null
                const summaryParts = []
                if (rs.num_sells > 0) summaryParts.push(`${rs.num_sells} lower weight${rs.num_sells > 1 ? 's' : ''}`)
                if (rs.num_buys > 0) summaryParts.push(`${rs.num_buys} higher weight${rs.num_buys > 1 ? 's' : ''}`)
                const summaryText = summaryParts.length ? `In this scenario the model mix has ${summaryParts.join(' and ')}` : ''
                const incomeSuffix = incomeChange != null ? ` \u2014 modeled income ${formatMoneyDelta(incomeChange, { digits: 0 })}/yr` : ''

                // CSV export
                const exportCsv = () => {
                  const modeLabel = scenarioLabel
                  const header = `# ${modeLabel} scenario - ${new Date().toLocaleDateString()} - illustrative model weights, not a recommendation to trade\n`
                  const cols = 'Model Shift,Ticker,USD Change,~Share Equivalent,USD Price,NAV,Current %,Model %\n'
                  const csvText = value => `"${String(value ?? '').replace(/"/g, '""')}"`
                  const rows = sorted.map(w =>
                    `${shiftLabel[w.action] ?? w.action},${w.ticker},${w.dollar_change},${w.shares_change},${w.current_price?.toFixed(2) ?? ''},${csvText(navFindings[w.ticker]?.label)},${w.current_pct.toFixed(1)},${w.optimal_pct.toFixed(1)}`
                  ).join('\n')
                  const blob = new Blob([header + cols + rows], { type: 'text/csv' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = `optimization-scenario-${mode}-${new Date().toISOString().slice(0,10)}.csv`
                  a.click(); URL.revokeObjectURL(url)
                }

                return (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-strong)', fontWeight: 600 }}>Scenario: Model Allocation Changes</span>
                      <button onClick={exportCsv} style={{
                        background: 'none', border: '1px solid var(--p-3a5a8c)', borderRadius: 4, color: 'var(--accent-bright)',
                        fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer',
                      }}>Export CSV</button>
                      {result.optimization.comparison && (
                        <button onClick={async () => {
                          const label = await dialog.prompt('Snapshot label:', scenarioLabel)
                          if (label) setSnapshots(prev => [...prev.slice(-2), { label, mode, balance: runBalance, optimization: result.optimization, portfolio_metrics: result.portfolio_metrics }])
                        }} style={{
                          background: 'none', border: '1px solid var(--p-3a5a3c)', borderRadius: 4, color: 'var(--pos-muted)',
                          fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer',
                        }}>Save Snapshot</button>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '0.4rem' }}>
                      Illustrative only. This compares your current weights with the optimizer's model mix for the selected
                      goal and period. It is an example to study, not a recommendation to buy or sell; share equivalents use the last close.
                    </div>
                    {summaryText && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontStyle: 'italic' }}>
                        {summaryText}
                        <span style={{ color: incomeChange >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{incomeSuffix}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem', fontSize: '0.78rem' }}>
                      {rs.num_sells > 0 && <span style={{ color: 'var(--neg)' }}>{rs.num_sells} lower weight{rs.num_sells > 1 ? 's' : ''} ({formatMoneyWhole(rs.total_sell)})</span>}
                      {rs.num_buys > 0 && <span style={{ color: 'var(--pos)' }}>{rs.num_buys} higher weight{rs.num_buys > 1 ? 's' : ''} ({formatMoneyWhole(rs.total_buy)})</span>}
                      {rs.num_holds > 0 && <span style={{ color: 'var(--text-dim)' }}>{rs.num_holds} unchanged</span>}
                    </div>
                    <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Model Shift</th>
                          <th style={thStyle}>Ticker</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Change ({getCurrencyLabel()})</th>
                          <th style={{ ...thStyle, textAlign: 'right' }} title="Approximate share equivalent of the dollar change at the last close">~Share Equiv.</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                          <th style={thStyle} title="The same NAV result as the Dashboard and NAV Erosion screens">NAV</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Current %</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Model %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map(w => (
                          <tr key={w.ticker} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              <span style={{
                                display: 'inline-block', padding: '1px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                                color: actionColor[w.action], background: actionBg[w.action],
                              }}>{shiftLabel[w.action] ?? w.action}</span>
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: 'var(--accent-bright)', fontWeight: 600 }}>{w.ticker}</td>
                            <td style={{
                              padding: '0.35rem 0.5rem', textAlign: 'right', fontWeight: 600,
                              color: w.action === 'BUY' ? 'var(--pos)' : w.action === 'SELL' ? 'var(--neg)' : 'var(--text-dim)',
                            }}>
                              {formatMoneyDelta(w.dollar_change, { digits: 0 })}
                            </td>
                            <td style={{
                              padding: '0.35rem 0.5rem', textAlign: 'right',
                              color: w.action === 'BUY' ? 'var(--pos)' : w.action === 'SELL' ? 'var(--neg)' : 'var(--text-dim)',
                            }}>
                              {w.shares_change > 0 ? '+' : ''}{w.shares_change ?? '—'}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>
                              {formatMoney(w.current_price)}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}>
                              {navFindings[w.ticker] ? <NavFindingLabel finding={navFindings[w.ticker]} /> : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-dim)' }}>{w.current_pct.toFixed(1)}</td>
                            <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)', fontWeight: 600 }}>{w.optimal_pct.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })()}

              {/* Scenario Comparison */}
              {snapshots.length >= 2 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-strong)', fontWeight: 600 }}>Compare Scenarios</span>
                    <button onClick={() => setSnapshots([])} style={{
                      background: 'none', border: '1px solid var(--p-3a3a5c)', borderRadius: 4, color: 'var(--text-dim)',
                      fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer',
                    }}>Clear All</button>
                  </div>
                  <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Metric</th>
                        {snapshots.map((s, i) => <th key={i} style={{ ...thStyle, textAlign: 'right' }}>{s.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: 'Grade', get: s => { const c = s.optimization.comparison; return c ? `${c.after.grade} (${c.after.score})` : '—' } },
                        { label: 'Annual Income', get: s => { const c = s.optimization.comparison; return c ? formatMoneyWhole(c.after.annual_income) : '—' } },
                        { label: 'Sharpe', get: s => s.optimization.comparison?.after.sharpe?.toFixed(2) ?? '—' },
                        { label: 'Sortino', get: s => s.optimization.comparison?.after.sortino?.toFixed(2) ?? '—' },
                        { label: 'Omega', get: s => s.optimization.comparison?.after.omega?.toFixed(2) ?? '—' },
                        { label: 'Calmar', get: s => s.optimization.comparison?.after.calmar?.toFixed(2) ?? '—' },
                        { label: 'Ulcer Index', get: s => s.optimization.comparison?.after.ulcer_index?.toFixed(2) ?? '—' },
                        { label: 'Max Drawdown', get: s => { const v = s.optimization.comparison?.after.max_drawdown; return v != null ? (v * 100).toFixed(1) + '%' : '—' } },
                        { label: 'Higher weights', get: s => { const r = s.optimization.rebalance_summary; return r ? `${r.num_buys} (${formatMoneyWhole(r.total_buy)})` : '—' } },
                        { label: 'Lower weights', get: s => { const r = s.optimization.rebalance_summary; return r ? `${r.num_sells} (${formatMoneyWhole(r.total_sell)})` : '—' } },
                      ].map(row => (
                        <tr key={row.label} style={{ borderBottom: '1px solid var(--p-1a2a3e)' }}>
                          <td style={{ padding: '0.3rem 0.5rem', color: 'var(--text-dim)', fontSize: '0.78rem' }}>{row.label}</td>
                          {snapshots.map((s, i) => (
                            <td key={i} style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-strong)' }}>{row.get(s)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          )}

        </>
      )}

      {/* Chart Tabs — always visible when tickers exist */}
      {tickers.length > 0 && !loading && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: '1rem', flexWrap: 'wrap' }}>
            {[
              { key: 'risk', label: 'Risk & Returns' },
              { key: 'income', label: 'Income & Allocation' },
              { key: 'backtest', label: 'Backtesting' },
              { key: 'tools', label: 'Tools' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setChartTab(t.key)}
                style={{
                  padding: '0.45rem 1.1rem', borderRadius: 4, cursor: 'pointer',
                  border: chartTab === t.key ? '1px solid var(--accent)' : '1px solid var(--p-3a3a5c)',
                  background: chartTab === t.key ? 'var(--p-1a3a5c)' : 'var(--bg)',
                  color: chartTab === t.key ? 'var(--accent)' : 'var(--text-dim)',
                  fontSize: '0.85rem', fontWeight: chartTab === t.key ? 600 : 400,
                }}
              >{t.label}</button>
            ))}
          </div>

          {chartTab === 'risk' && <RiskReturnCharts result={result} />}
          {chartTab === 'income' && <IncomeCharts tickers={tickers} result={result} period={period} />}
          {chartTab === 'backtest' && <BacktestCharts tickers={tickers} result={result} period={period} />}
          {chartTab === 'tools' && <ToolsPanel tickers={tickers} result={result} onAddTicker={t => { if (!tickers.includes(t)) setTickers(prev => [...prev, t]) }} />}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ color: color || 'var(--text-strong)', fontWeight: 600 }}>{value ?? '—'}</span>
    </div>
  )
}

const thStyle = {
  padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--p-2a3a4e)',
  color: 'var(--text-dim)', fontSize: '0.78rem', textAlign: 'left',
}

