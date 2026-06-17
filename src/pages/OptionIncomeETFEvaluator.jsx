import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../config'
import FundScanTab from '../components/FundScanTab'
import { formatMoney, formatMoneyCompact } from '../utils/money'
import {
  OPTION_DEFAULT_THRESHOLDS,
  OPTION_BEST_PRACTICE,
  gradeOptionIncomeETF,
  findETFAlternatives,
  verdictFromComposite,
  deriveUnderlying,
  UNDERLYING_LABELS,
} from '../utils/etfGrading'

const STORAGE_KEY = 'optionIncomeEtfChecklistThresholds.v1'

const QUESTION_DETAILS = {
  1: [
    'Option-income ETFs sacrifice upside for current income — confirm this trade-off suits your goals.',
    'Covered-call strategies (JEPI, XYLD) behave differently from put-write (PUTW) or collar strategies.',
    'Check whether the fund targets equity or fixed-income underliers.',
  ],
  2: [
    'When yield exceeds total return, the gap is funded by NAV erosion.',
    'A gap under 2pp is normal for option-income; above 4pp is a red flag.',
    'Check if the distribution has been declining — that signals the erosion is catching up.',
  ],
  3: [
    'Option-income funds are inherently pricier due to strategy complexity.',
    'Under 0.50% is competitive for this space; above 0.75% needs justification.',
    'Compare against other option-income peers, not broad-market index ETFs.',
  ],
  4: [
    'Many option-income ETFs launched in 2020-2023 — some are still very small.',
    'Funds under $100M AUM face real closure risk if assets don\'t grow.',
    'Check daily dollar volume — thin markets mean worse fills on your trades.',
  ],
  5: [
    'Option-income funds will lag the S&P in bull runs — that\'s by design.',
    'A total return of 7%+ annualized is competitive for the income trade-off.',
    'Low beta (< 0.7) is expected — you gave up upside for lower volatility and income.',
  ],
  6: [
    'This compares the annualized share-price (NAV) trend against the annualized total return.',
    'A fund whose price chronically declines while paying a high yield is funding the distribution from your capital (return of capital), not from income.',
    'At-the-money covered-call funds (e.g. QYLD) cap nearly all upside, so their NAV erodes over full cycles even though reinvested-dividend total return looks acceptable.',
    'Funds that write further out-of-the-money or use index options (e.g. QQQI, SPYI) retain more upside and hold NAV better.',
  ],
  7: [
    'Funds under 3 years old have no full market-cycle track record.',
    'Funds under 1 year are speculative — strategy performance is unknown.',
    'Established fund families (JPMorgan, Global X, Amplify) have deeper resources for complex strategies.',
  ],
}

function loadThresholds() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return OPTION_DEFAULT_THRESHOLDS
    const parsed = JSON.parse(raw)
    return {
      yieldSustainability: { ...OPTION_DEFAULT_THRESHOLDS.yieldSustainability, ...(parsed.yieldSustainability || {}) },
      expense:             { ...OPTION_DEFAULT_THRESHOLDS.expense, ...(parsed.expense || {}) },
      fundSize:            { ...OPTION_DEFAULT_THRESHOLDS.fundSize, ...(parsed.fundSize || {}) },
      performance:         { ...OPTION_DEFAULT_THRESHOLDS.performance, ...(parsed.performance || {}) },
      navErosion:          { ...OPTION_DEFAULT_THRESHOLDS.navErosion, ...(parsed.navErosion || {}) },
      trackRecord:         { ...OPTION_DEFAULT_THRESHOLDS.trackRecord, ...(parsed.trackRecord || {}) },
    }
  } catch {
    return OPTION_DEFAULT_THRESHOLDS
  }
}

function saveThresholds(t) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t)) } catch {}
}

const fmtMoney = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-'
  const v = Number(n)
  if (Math.abs(v) >= 1e6) return formatMoneyCompact(v, { fallback: '-' })
  return formatMoney(v, { fallback: '-' })
}
const fmtPct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '-' : `${Number(n).toFixed(2)}%`)

function ThresholdEditor({ criterion, thresholds, onChange }) {
  if (!criterion.editable || !criterion.threshold) return null
  const key = criterion.key
  const t = thresholds[key]
  if (!t) return null
  const update = (patch) => onChange({ ...thresholds, [key]: { ...t, ...patch } })

  const labelStyle = { color: 'var(--text-dim)', fontSize: '0.78rem', display: 'block', marginBottom: 2 }
  const inputStyle = {
    background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-strong)', padding: '0.3rem 0.5rem', fontSize: '0.85rem', width: 90,
  }

  let controls = null
  if (key === 'yieldSustainability') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if gap ≤ (pp)</label>
          <input type="number" step="0.5" style={inputStyle} value={t.passPp}
            onChange={e => update({ passPp: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Warn if gap ≤ (pp)</label>
          <input type="number" step="0.5" style={inputStyle} value={t.warnPp}
            onChange={e => update({ warnPp: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'expense') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if ≤ (%)</label>
          <input type="number" step="0.05" style={inputStyle} value={t.passPct}
            onChange={e => update({ passPct: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if &gt; (%)</label>
          <input type="number" step="0.05" style={inputStyle} value={t.warnPct}
            onChange={e => update({ warnPct: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'fundSize') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if AUM ≥ ($)</label>
          <input type="number" step="100000000" style={{ ...inputStyle, width: 140 }} value={t.passAum}
            onChange={e => update({ passAum: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if AUM &lt; ($)</label>
          <input type="number" step="100000000" style={{ ...inputStyle, width: 140 }} value={t.warnAum}
            onChange={e => update({ warnAum: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'performance') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if return ≥ (%)</label>
          <input type="number" step="0.5" style={inputStyle} value={t.passReturnPct}
            onChange={e => update({ passReturnPct: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Warn if return &lt; (%)</label>
          <input type="number" step="0.5" style={inputStyle} value={t.warnReturnPct}
            onChange={e => update({ warnReturnPct: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'navErosion') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if price CAGR ≥ (%/yr)</label>
          <input type="number" step="0.5" style={inputStyle} value={t.passPct}
            onChange={e => update({ passPct: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if price CAGR &lt; (%/yr)</label>
          <input type="number" step="0.5" style={inputStyle} value={t.warnPct}
            onChange={e => update({ warnPct: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'trackRecord') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if age ≥ (years)</label>
          <input type="number" step="1" style={inputStyle} value={t.passAgeYears}
            onChange={e => update({ passAgeYears: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if age &lt; (years)</label>
          <input type="number" step="1" style={inputStyle} value={t.warnAgeYears}
            onChange={e => update({ warnAgeYears: Number(e.target.value) })} />
        </div>
      </>
    )
  }

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: '0.9rem', alignItems: 'flex-end',
      marginTop: '0.75rem', padding: '0.75rem 0.9rem',
      background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6,
    }}>
      {controls}
      <div style={{ flex: 1, minWidth: 220, color: 'var(--p-8aa0c8)', fontSize: '0.82rem', lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--teal-2)' }}>Best practice:</strong> {criterion.threshold.bestPractice}
      </div>
    </div>
  )
}

function CriterionCard({ criterion, thresholds, onChangeThresholds }) {
  const c = criterion
  return (
    <div className="cef-guide-card" style={{ background: 'var(--p-1a2744)', border: '1px solid var(--p-243356)', borderRadius: 8 }}>
      <div style={{ padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="cef-guide-number">{c.id}</span>
          <span className="cef-guide-question" style={{ flex: 1 }}>{c.question}</span>
          <span className={`stock-check-badge tone-${c.badge}`}>{c.badge}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.2rem', paddingLeft: 42, color: 'var(--p-b8c8e0)' }}>
          {c.metrics.map((m, i) => (
            <div key={i} style={{ fontSize: '0.88rem' }}>
              <span style={{ color: 'var(--text-dim-2)' }}>{m.label}: </span>
              <strong style={{ color: 'var(--p-e6edf7)' }}>{m.value}</strong>
            </div>
          ))}
        </div>
        <div style={{ paddingLeft: 42, color: 'var(--p-cfd8e3)', fontSize: '0.9rem', lineHeight: 1.5 }}>
          {c.rationale}
        </div>
        {(QUESTION_DETAILS[c.id] || []).length > 0 && (
          <details style={{ paddingLeft: 42, color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--teal-2)' }}>What to check</summary>
            <ul style={{ margin: '0.4rem 0 0.2rem 1rem' }}>
              {QUESTION_DETAILS[c.id].map((d, i) => <li key={i} style={{ margin: '0.2rem 0' }}>{d}</li>)}
            </ul>
          </details>
        )}
        <div style={{ paddingLeft: 42 }}>
          <ThresholdEditor criterion={c} thresholds={thresholds} onChange={onChangeThresholds} />
        </div>
      </div>
    </div>
  )
}

function HeaderCard({ fund }) {
  return (
    <div style={{
      background: 'var(--p-1a2744)', border: '1px solid var(--p-243356)', borderRadius: 8,
      padding: '1rem 1.2rem', marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, color: 'var(--p-e6edf7)' }}>{fund.ticker}</h2>
        <span style={{ color: 'var(--p-b8c8e0)', fontSize: '1rem' }}>{fund.name}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.5rem', marginTop: '0.6rem', color: 'var(--p-b8c8e0)', fontSize: '0.9rem' }}>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Category: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.category || 'n/a'}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Strategy: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.etf_strategy || 'n/a'}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Fund family: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.fund_family || 'n/a'}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Price: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{formatMoney(fund.price, { fallback: '-' })}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Yield: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fmtPct(fund.yield_pct || fund.dividend_yield)}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>AUM: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fmtMoney(fund.aum)}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Inception: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.inception_date || '-'}</strong></span>
      </div>
    </div>
  )
}

const UNDERLYING_OPTIONS = [
  ['crypto', 'Crypto'],
  ['nasdaq100', 'Nasdaq 100'],
  ['sp500', 'S&P 500'],
  ['russell2000', 'Russell 2000'],
  ['dow', 'Dow'],
  ['gold', 'Gold / Commodity'],
  ['single-stock', 'Single-stock'],
  ['other', 'Other'],
  ['any', 'Any underlying'],
]

function AlternativesControls({ underlyingOverride, setUnderlyingOverride, autoUnderlying, targetYield, setTargetYield, minYield, setMinYield, fundYield }) {
  const labelStyle = { color: 'var(--text-dim)', fontSize: '0.78rem', display: 'block', marginBottom: 3 }
  const inputStyle = {
    background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-strong)', padding: '0.4rem 0.55rem', fontSize: '0.88rem',
  }
  const autoLabel = UNDERLYING_LABELS[autoUnderlying] || 'Other'
  const hasMin = minYield.trim() !== '' && Number(minYield) > 0
  const hasTarget = targetYield.trim() !== '' && Number(targetYield) > 0
  let floor = null
  let floorSource = ''
  if (hasMin) {
    floor = Number(minYield)
    floorSource = 'your min yield'
  } else {
    const base = hasTarget ? Number(targetYield) : fundYield
    if (base != null && Number.isFinite(Number(base))) {
      floor = Number(base) * 0.90
      floorSource = hasTarget ? '90% of your target' : "90% of this fund's yield"
    }
  }
  return (
    <div style={{
      marginTop: '1.5rem', padding: '0.85rem 1rem',
      background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6,
      display: 'flex', flexWrap: 'wrap', gap: '0.9rem 1.4rem', alignItems: 'flex-end',
    }}>
      <div>
        <label style={labelStyle}>Underlying</label>
        <select
          value={underlyingOverride}
          onChange={e => setUnderlyingOverride(e.target.value)}
          style={{ ...inputStyle, minWidth: 170 }}
        >
          <option value="auto">Auto-detect ({autoLabel})</option>
          {UNDERLYING_OPTIONS.map(([val, lab]) => (
            <option key={val} value={val}>{lab}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Target yield (%)</label>
        <input
          type="number" step="0.5" min="0" placeholder="fund yield"
          value={targetYield}
          onChange={e => setTargetYield(e.target.value)}
          style={{ ...inputStyle, width: 100 }}
        />
      </div>
      <div>
        <label style={labelStyle}>Min yield (%)</label>
        <input
          type="number" step="0.5" min="0" placeholder="auto"
          value={minYield}
          onChange={e => setMinYield(e.target.value)}
          style={{ ...inputStyle, width: 100 }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 220, color: 'var(--p-8aa0c8)', fontSize: '0.82rem', lineHeight: 1.5 }}>
        Alternatives must track the selected underlying and yield{' '}
        <strong style={{ color: 'var(--teal-2)' }}>
          {floor != null ? `≥ ${floor.toFixed(2)}%` : 'at least 94% of the baseline'}
        </strong>{' '}
        ({floorSource || 'default'}).
      </div>
    </div>
  )
}

function AltCard({ alt }) {
  return (
    <div style={{
      background: 'var(--p-1a2744)', border: '1px solid var(--p-243356)', borderRadius: 8, padding: '0.8rem 1rem',
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'baseline' }}>
        <strong style={{ color: 'var(--teal-2)' }}>{alt.fund.ticker}</strong>
        <span style={{ color: 'var(--p-b8c8e0)', flex: 1 }}>{alt.fund.name}</span>
        {alt.isSingleStock && (
          <span style={{
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            background: 'var(--p-5a4a14)', color: 'var(--p-ffd76a)', border: '1px solid var(--p-a3812a)',
            borderRadius: 4, padding: '0.1rem 0.4rem',
          }}>
            Single-stock — higher risk
          </span>
        )}
        <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
          Yield <strong style={{ color: 'var(--p-e6edf7)' }}>{fmtPct(alt.fund.yield_pct || alt.fund.dividend_yield)}</strong>
        </span>
        <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
          Composite <strong style={{ color: 'var(--p-e6edf7)' }}>{alt.composite.toFixed(1)}</strong>
        </span>
      </div>
      <div style={{ color: 'var(--p-cfd8e3)', fontSize: '0.88rem', marginTop: '0.35rem' }}>
        <span style={{ color: 'var(--text-dim-2)' }}>Why listed: </span>
        {alt.reasons.join('; ')}.
      </div>
    </div>
  )
}

function AlternativesList({ alternatives, fallbackAlternatives, peerCount, effectiveUnderlying }) {
  const filterLabel = (effectiveUnderlying && effectiveUnderlying !== 'any')
    ? (UNDERLYING_LABELS[effectiveUnderlying] || 'Other')
    : null
  const showFallback = alternatives.length === 0 && fallbackAlternatives.length > 0
  return (
    <div style={{ marginTop: '1rem' }}>
      <h2 style={{ color: 'var(--p-e6edf7)', fontSize: '1.1rem', margin: '0 0 0.4rem' }}>
        Quality alternatives{filterLabel ? ` — ${filterLabel}` : ''}
      </h2>
      <p style={{ color: 'var(--text-dim-2)', fontSize: '0.86rem', margin: '0 0 0.8rem' }}>
        Option-income ETFs that clear the checklist and pass quality checks against this fund's NAV trend,
        total return, history, and structure{filterLabel ? `, restricted to ${filterLabel} underliers` : ''}. {peerCount} peers screened.
        Single-stock income ETFs are excluded unless the selected fund is also single-stock: they are typically far more volatile than a
        diversified fund.
      </p>
      {alternatives.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alternatives.map(alt => <AltCard key={alt.fund.ticker} alt={alt} />)}
        </div>
      ) : showFallback ? (
        <>
          <div style={{
            background: 'var(--p-5a1a1a)', border: '1px solid var(--p-a83232)', borderRadius: 6,
            padding: '0.8rem 1rem', marginBottom: '0.7rem', color: 'var(--neg-soft)', fontSize: '0.9rem',
          }}>
            All {filterLabel || 'matching'} peers fail the checklist — these are the highest-scoring options in this space, but none earned a passing grade.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fallbackAlternatives.map(alt => <AltCard key={alt.fund.ticker} alt={alt} />)}
          </div>
        </>
      ) : (
        <div style={{ background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6, padding: '1rem', color: 'var(--p-b8c8e0)' }}>
          No option-income peers found for this underlying group.
        </div>
      )}
    </div>
  )
}

export default function OptionIncomeETFEvaluator() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inputTicker, setInputTicker] = useState('')
  const [fund, setFund] = useState(null)
  const [peers, setPeers] = useState([])
  const [isOptionIncome, setIsOptionIncome] = useState(false)
  const [thresholds, setThresholds] = useState(loadThresholds())
  const [underlyingOverride, setUnderlyingOverride] = useState('auto')
  const [targetYield, setTargetYield] = useState('')
  const [minYield, setMinYield] = useState('')
  const [tab, setTab] = useState('deep')

  useEffect(() => { saveThresholds(thresholds) }, [thresholds])

  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`stock-check-tab${tab === key ? ' is-active' : ''}`}
    >{label}</button>
  )

  const evaluate = useCallback((ticker) => {
    if (!ticker) return
    setLoading(true)
    setError('')
    setFund(null)
    setPeers([])
    setIsOptionIncome(false)
    setUnderlyingOverride('auto')
    fetch(`${API_BASE}/api/etf-evaluate/${encodeURIComponent(ticker)}`, { cache: 'no-store' })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Could not evaluate ETF.')
        setFund(payload.fund)
        setPeers(payload.peers || [])
        setIsOptionIncome(payload.is_option_income || false)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const submit = (e) => {
    e?.preventDefault?.()
    const t = inputTicker.trim().toUpperCase()
    if (t) evaluate(t)
  }

  const result = useMemo(() => {
    if (!fund) return null
    return gradeOptionIncomeETF(fund, peers, thresholds)
  }, [fund, peers, thresholds])

  const autoUnderlying = useMemo(() => (fund ? deriveUnderlying(fund) : 'other'), [fund])
  const effectiveUnderlying = underlyingOverride === 'auto' ? autoUnderlying : underlyingOverride

  const altOpts = useMemo(() => {
    const parsedMin = Number(minYield)
    const parsedTarget = Number(targetYield)
    const hasMinYield = minYield.trim() !== '' && Number.isFinite(parsedMin) && parsedMin > 0
    const hasTarget = targetYield.trim() !== '' && Number.isFinite(parsedTarget) && parsedTarget > 0
    return {
      yieldFloorRatio: hasMinYield ? 1.0 : 0.90,
      yieldBaseline: hasMinYield ? parsedMin : (hasTarget ? parsedTarget : null),
      underlyingGroup: effectiveUnderlying,
      singleStockLast: true,
      minHistoryYears: 1.0,
      optionIncomeQualityFloor: true,
      excludeSingleStockUnlessCurrent: true,
      minCompositeDelta: 0,
    }
  }, [effectiveUnderlying, targetYield, minYield])

  const alternatives = useMemo(() => {
    if (!fund) return []
    return findETFAlternatives(fund, peers, thresholds, gradeOptionIncomeETF, 6, {
      ...altOpts, passingOnly: true,
    })
  }, [fund, peers, thresholds, altOpts])

  const fallbackAlternatives = useMemo(() => {
    if (!fund || alternatives.length > 0) return []
    return findETFAlternatives(fund, peers, thresholds, gradeOptionIncomeETF, 6, {
      ...altOpts, passingOnly: false, optionIncomeQualityFloor: false, minCompositeDelta: -100,
    })
  }, [fund, peers, thresholds, altOpts, alternatives])

  const verdict = useMemo(() => {
    if (!result) return null
    return verdictFromComposite(result.composite, result.criteria)
  }, [result])

  return (
    <div className="page cef-page stock-check-page">
      <div className="cef-title-row stock-check-title-row">
        <div>
          <h1>Option-Income ETF Evaluator</h1>
          <p>Enter an option-income / derivative-income ETF ticker. Six criteria are scored against editable thresholds tailored to the income trade-off, and better alternatives are surfaced.</p>
        </div>
      </div>

      <div className="stock-check-tabs" role="tablist" aria-label="Option-income ETF checklist mode">
        {tabBtn('deep', 'Deep Dive')}
        {tabBtn('scan', 'Scan a List')}
      </div>

      {tab === 'scan' ? (
        <FundScanTab
          endpoint="/api/option-income/scan"
          kindLabel="option-income ETFs"
          gradeFund={gradeOptionIncomeETF}
          verdictFromComposite={verdictFromComposite}
          thresholds={thresholds}
          extraColumns={[
            { key: 'price_cagr', label: 'NAV/yr', fmt: (r) => (r.price_cagr == null ? '—' : `${Number(r.price_cagr).toFixed(1)}%`) },
            { key: 'expense_ratio', label: 'Expense', fmt: (r) => (r.expense_ratio == null ? '—' : `${Number(r.expense_ratio).toFixed(2)}%`) },
          ]}
        />
      ) : (
      <>
      <form onSubmit={submit} className="stock-check-search">
        <input
          value={inputTicker}
          onChange={e => setInputTicker(e.target.value.toUpperCase())}
          placeholder="e.g. JEPI, QYLD, SPYI, DIVO..."
          className="stock-check-input stock-check-ticker-input"
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>Evaluate</button>
      </form>

      {loading && <div className="cef-loading"><span className="spinner" /> Fetching ETF data from yfinance...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {fund && !isOptionIncome && (
        <div style={{
          background: 'var(--p-5a4a14)', border: '1px solid var(--p-a3812a)', borderRadius: 6,
          padding: '0.8rem 1rem', marginBottom: '1rem', color: 'var(--p-ffd76a)', fontSize: '0.92rem',
        }}>
          <strong>{fund.ticker}</strong> is not classified as an option-income ETF.
          You may get more relevant results from the{' '}
          <Link to="/etf-buying-checklist-evaluator" style={{ color: 'var(--teal-2)' }}>general ETF Evaluator</Link>.
          The option-income evaluation below still runs, but peer comparisons use option-income funds.
        </div>
      )}

      {result && (
        <>
          <HeaderCard fund={fund} />

          <div style={{
            background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6,
            padding: '0.7rem 1rem', marginBottom: '1rem',
            display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem',
          }}>
            <div style={{ color: 'var(--p-b8c8e0)', fontSize: '0.9rem' }}>
              <strong style={{ color: 'var(--teal-2)' }}>Composite score:</strong>{' '}
              <span style={{ color: 'var(--p-e6edf7)', fontSize: '1.1rem', fontWeight: 700 }}>
                {result.composite === null ? 'n/a' : result.composite.toFixed(1)}
              </span>
              <span style={{ color: 'var(--text-dim-2)' }}> / 100</span>
              <span style={{ color: 'var(--text-dim-2)', marginLeft: '0.7rem', fontSize: '0.85rem' }}>
                (average of scored criteria 2-7)
              </span>
            </div>
            <button type="button" onClick={() => setThresholds(OPTION_DEFAULT_THRESHOLDS)} style={{
              background: 'transparent', border: '1px solid var(--p-2a3e6b)', borderRadius: 4,
              color: 'var(--p-8aa0c8)', padding: '0.3rem 0.7rem', cursor: 'pointer', fontSize: '0.82rem',
            }}>
              Reset thresholds to defaults
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.criteria.map(c => (
              <CriterionCard key={c.id} criterion={c} thresholds={thresholds} onChangeThresholds={setThresholds} />
            ))}
          </div>

          {verdict && (
            <div style={{
              marginTop: '1.25rem', padding: '1rem 1.2rem', borderRadius: 8,
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem 1rem',
              ...(verdict.tone === 'pass'
                ? { background: 'var(--p-0f4e2e)', border: '1px solid var(--p-1d8a52)' }
                : verdict.tone === 'warn'
                ? { background: 'var(--p-5a4a14)', border: '1px solid var(--p-a3812a)' }
                : verdict.tone === 'fail'
                ? { background: 'var(--p-5a1a1a)', border: '1px solid var(--p-a83232)' }
                : { background: 'var(--p-1f2e52)', border: '1px solid var(--p-2a3e6b)' }),
            }}>
              <span style={{
                fontSize: '1.25rem', fontWeight: 800, letterSpacing: '0.02em',
                color: verdict.tone === 'pass' ? 'var(--p-7be5a8)'
                  : verdict.tone === 'warn' ? 'var(--p-ffd76a)'
                  : verdict.tone === 'fail' ? 'var(--neg-soft)' : 'var(--p-8aa0c8)',
              }}>
                Verdict: {verdict.label}
              </span>
              <span style={{ color: 'var(--p-e6edf7)', fontSize: '0.92rem', flex: 1, minWidth: 260 }}>
                {verdict.detail}
              </span>
            </div>
          )}

          <AlternativesControls
            underlyingOverride={underlyingOverride}
            setUnderlyingOverride={setUnderlyingOverride}
            autoUnderlying={autoUnderlying}
            targetYield={targetYield}
            setTargetYield={setTargetYield}
            minYield={minYield}
            setMinYield={setMinYield}
            fundYield={fund.yield_pct || fund.dividend_yield}
          />
          <AlternativesList
            alternatives={alternatives}
            fallbackAlternatives={fallbackAlternatives}
            peerCount={peers.length}
            effectiveUnderlying={effectiveUnderlying}
          />

          <div style={{
            marginTop: '1.5rem', padding: '0.8rem 1rem',
            background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6,
            color: 'var(--text-dim-2)', fontSize: '0.84rem', lineHeight: 1.55,
          }}>
            <strong style={{ color: 'var(--teal-2)' }}>Notes:</strong> Data is fetched live from yfinance.
            Peers are drawn from a curated list of ~150 option-income ETFs cached in the scanner.
            Yield sustainability compares yield to long-term total return; NAV erosion measures the annualized
            share-price (price-only) trend over the fund's full history, which exposes distributions funded by
            return of capital even when reinvested-dividend total return looks acceptable. For funds without a
            3Y/5Y yfinance return, the full-history annualized total return is used as a fallback so newer funds
            are still scored. Custom thresholds persist in this browser via localStorage.
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
