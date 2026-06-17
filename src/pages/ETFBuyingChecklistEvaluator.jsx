import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../config'
import FundScanTab from '../components/FundScanTab'
import {
  ETF_DEFAULT_THRESHOLDS,
  OPTION_DEFAULT_THRESHOLDS,
  ETF_BEST_PRACTICE,
  gradeETF,
  gradeOptionIncomeETF,
  findETFAlternatives,
  verdictFromComposite,
} from '../utils/etfGrading'

const STORAGE_KEY = 'etfChecklistThresholds.v1'

const QUESTION_DETAILS = {
  1: [
    'Confirm the ETF tracks the index or sector you want exposure to.',
    'Check the category — "Large Blend" is different from "Large Growth" or "Dividend".',
    'Avoid doubling up on the same strategy if you already hold a similar ETF.',
  ],
  2: [
    'Expense ratio directly erodes returns. 0.03% vs 0.20% compounds significantly over decades.',
    'Broad market ETFs should be under 0.10%; sector and specialty funds under 0.50%.',
    'Compare against category peers, not just absolute numbers.',
  ],
  3: [
    'Larger AUM means tighter bid-ask spreads and lower closure risk.',
    'Check average daily dollar volume — thin trading means higher implicit costs.',
    'Funds under $100M AUM face elevated risk of liquidation.',
  ],
  4: [
    'Compare 3Y and 5Y average annual total returns against the strategy peer group median.',
    'Short-term outperformance can be luck — 5Y is a better signal.',
    'Underperformance relative to peers suggests tracking error or poor index construction.',
  ],
  5: [
    'Beta near 1.0 means the fund moves with the broad market.',
    'Beta > 1.5 is significantly more volatile — appropriate only for aggressive portfolios.',
    'Very low beta (< 0.3) may indicate a niche strategy with limited growth potential.',
  ],
  6: [
    'When yield exceeds long-term total return, the difference comes from NAV erosion.',
    'Only scored for ETFs yielding above 2% — low-yield index funds are not a concern.',
    'For dividend ETFs, check if the yield is supported by underlying earnings.',
  ],
}

function loadThresholds() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return ETF_DEFAULT_THRESHOLDS
    const parsed = JSON.parse(raw)
    return {
      expense:             { ...ETF_DEFAULT_THRESHOLDS.expense, ...(parsed.expense || {}) },
      fundSize:            { ...ETF_DEFAULT_THRESHOLDS.fundSize, ...(parsed.fundSize || {}) },
      performance:         { ...ETF_DEFAULT_THRESHOLDS.performance, ...(parsed.performance || {}) },
      risk:                { ...ETF_DEFAULT_THRESHOLDS.risk, ...(parsed.risk || {}) },
      yieldSustainability: { ...ETF_DEFAULT_THRESHOLDS.yieldSustainability, ...(parsed.yieldSustainability || {}) },
    }
  } catch {
    return ETF_DEFAULT_THRESHOLDS
  }
}

function saveThresholds(t) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t)) } catch {}
}

const fmtMoney = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-'
  const v = Number(n)
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toFixed(2)}`
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
  if (key === 'expense') {
    controls = (
      <>
        <div>
          <label className="stock-check-threshold-label">Pass if ≤ (%)</label>
          <input type="number" step="0.05" className="stock-check-threshold-input" value={t.passPct}
            onChange={e => update({ passPct: Number(e.target.value) })} />
        </div>
        <div>
          <label className="stock-check-threshold-label">Fail if &gt; (%)</label>
          <input type="number" step="0.05" className="stock-check-threshold-input" value={t.warnPct}
            onChange={e => update({ warnPct: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'fundSize') {
    controls = (
      <>
        <div>
          <label className="stock-check-threshold-label">Pass if AUM ≥ ($)</label>
          <input type="number" step="100000000" className="stock-check-threshold-input stock-check-threshold-input-wide" value={t.passAum}
            onChange={e => update({ passAum: Number(e.target.value) })} />
        </div>
        <div>
          <label className="stock-check-threshold-label">Fail if AUM &lt; ($)</label>
          <input type="number" step="100000000" className="stock-check-threshold-input stock-check-threshold-input-wide" value={t.warnAum}
            onChange={e => update({ warnAum: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'risk') {
    controls = (
      <>
        <div>
          <label className="stock-check-threshold-label">Flag if beta &gt;</label>
          <input type="number" step="0.1" className="stock-check-threshold-input" value={t.highBeta}
            onChange={e => update({ highBeta: Number(e.target.value) })} />
        </div>
        <div>
          <label className="stock-check-threshold-label">Flag if beta &lt;</label>
          <input type="number" step="0.1" className="stock-check-threshold-input" value={t.lowBeta}
            onChange={e => update({ lowBeta: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'yieldSustainability') {
    controls = (
      <>
        <div>
          <label className="stock-check-threshold-label">Pass if gap ≤ (pp)</label>
          <input type="number" step="0.5" className="stock-check-threshold-input" value={t.passPp}
            onChange={e => update({ passPp: Number(e.target.value) })} />
        </div>
        <div>
          <label className="stock-check-threshold-label">Warn if gap ≤ (pp)</label>
          <input type="number" step="0.5" className="stock-check-threshold-input" value={t.warnPp}
            onChange={e => update({ warnPp: Number(e.target.value) })} />
        </div>
      </>
    )
  }

  return (
    <div className="stock-check-threshold-editor">
      {controls}
      <div className="stock-check-threshold-note">
        <strong>Best practice:</strong> {criterion.threshold.bestPractice}
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
        <span><span style={{ color: 'var(--text-dim-2)' }}>Price: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.price != null ? `$${Number(fund.price).toFixed(2)}` : '-'}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>NAV: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.nav != null ? `$${Number(fund.nav).toFixed(2)}` : '-'}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>AUM: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fmtMoney(fund.aum)}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Yield: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fmtPct(fund.yield_pct || fund.dividend_yield)}</strong></span>
      </div>
    </div>
  )
}

function AlternativesList({ alternatives, peerCount, strategy, isOptionIncome }) {
  if (!strategy) return null
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2 style={{ color: 'var(--p-e6edf7)', fontSize: '1.1rem', margin: '0 0 0.4rem' }}>
        {isOptionIncome ? 'Quality alternatives' : 'Better alternatives'} in the {strategy} strategy
      </h2>
      <p style={{ color: 'var(--text-dim-2)', fontSize: '0.86rem', margin: '0 0 0.8rem' }}>
        {isOptionIncome
          ? 'Option-income ETFs that pass the specialized quality checks for NAV trend, total return, history, and structure.'
          : 'ETFs in the same strategy scoring higher on the composite of all 6 criteria.'} {peerCount} peers screened.
      </p>
      {alternatives.length === 0 ? (
        <div style={{ background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6, padding: '1rem', color: 'var(--p-b8c8e0)' }}>
          {isOptionIncome
            ? 'No option-income peers passed the quality floor against this fund.'
            : 'No higher-scoring alternatives found in this strategy group.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alternatives.map(alt => (
            <div key={alt.fund.ticker} style={{
              background: 'var(--p-1a2744)', border: '1px solid var(--p-243356)', borderRadius: 8, padding: '0.8rem 1rem',
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'baseline' }}>
                <strong style={{ color: 'var(--teal-2)' }}>{alt.fund.ticker}</strong>
                <span style={{ color: 'var(--p-b8c8e0)', flex: 1 }}>{alt.fund.name}</span>
                <span style={{ color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
                  Composite <strong style={{ color: 'var(--p-e6edf7)' }}>{alt.composite.toFixed(1)}</strong>
                </span>
              </div>
              <div style={{ color: 'var(--p-cfd8e3)', fontSize: '0.88rem', marginTop: '0.35rem' }}>
                <span style={{ color: 'var(--text-dim-2)' }}>Why listed: </span>
                {alt.reasons.join('; ')}.
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ETFBuyingChecklistEvaluator() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inputTicker, setInputTicker] = useState('')
  const [fund, setFund] = useState(null)
  const [peers, setPeers] = useState([])
  const [strategy, setStrategy] = useState('')
  const [isOptionIncome, setIsOptionIncome] = useState(false)
  const [thresholds, setThresholds] = useState(loadThresholds())
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
    fetch(`${API_BASE}/api/etf-evaluate/${encodeURIComponent(ticker)}`, { cache: 'no-store' })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Could not evaluate ETF.')
        setFund(payload.fund)
        setPeers(payload.peers || [])
        setStrategy(payload.strategy || '')
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
    return gradeETF(fund, peers, thresholds)
  }, [fund, peers, thresholds])

  const alternatives = useMemo(() => {
    if (!fund) return []
    if (isOptionIncome) {
      return findETFAlternatives(fund, peers, OPTION_DEFAULT_THRESHOLDS, gradeOptionIncomeETF, 6, {
        passingOnly: true,
        yieldFloorRatio: 0.40,
        singleStockLast: true,
        minHistoryYears: 1.0,
        optionIncomeQualityFloor: true,
        excludeSingleStockUnlessCurrent: true,
        minCompositeDelta: 0,
      })
    }
    return findETFAlternatives(fund, peers, thresholds, gradeETF, 5)
  }, [fund, peers, thresholds, isOptionIncome])

  const verdict = useMemo(() => {
    if (!result) return null
    return verdictFromComposite(result.composite, result.criteria)
  }, [result])

  return (
    <div className="page cef-page stock-check-page">
      <div className="cef-title-row stock-check-title-row">
        <div>
          <h1>ETF Buying Checklist Evaluator</h1>
          <p>Enter an ETF ticker. Six criteria are scored against editable thresholds, and better alternatives in the same strategy group are surfaced.</p>
        </div>
      </div>

      <div className="stock-check-tabs" role="tablist" aria-label="ETF checklist mode">
        {tabBtn('deep', 'Deep Dive')}
        {tabBtn('scan', 'Scan a List')}
      </div>

      {tab === 'scan' ? (
        <FundScanTab
          endpoint="/api/etf/scan"
          kindLabel="ETFs"
          gradeFund={gradeETF}
          verdictFromComposite={verdictFromComposite}
          thresholds={thresholds}
          extraColumns={[
            { key: 'expense_ratio', label: 'Expense', fmt: (r) => (r.expense_ratio == null ? '—' : `${Number(r.expense_ratio).toFixed(2)}%`) },
            { key: 'total_cagr', label: 'TR/yr', fmt: (r) => (r.total_cagr == null ? '—' : `${Number(r.total_cagr).toFixed(1)}%`) },
          ]}
        />
      ) : (
      <>
      <form onSubmit={submit} className="stock-check-search">
        <input
          value={inputTicker}
          onChange={e => setInputTicker(e.target.value.toUpperCase())}
          placeholder="e.g. VOO, SCHD, QQQ, BND..."
          className="stock-check-input stock-check-ticker-input"
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>Evaluate</button>
      </form>

      {loading && <div className="cef-loading"><span className="spinner" /> Fetching ETF data from yfinance...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {isOptionIncome && fund && (
        <div style={{
          background: 'var(--p-1f2e52)', border: '1px solid var(--p-2a3e6b)', borderRadius: 6,
          padding: '0.8rem 1rem', marginBottom: '1rem', color: 'var(--p-8aa0c8)', fontSize: '0.92rem',
        }}>
          <strong style={{ color: 'var(--p-ffd76a)' }}>{fund.ticker}</strong> is classified as an
          option-income / derivative-income ETF.
          The <Link to="/option-income-etf-evaluator" style={{ color: 'var(--teal-2)' }}>Option-Income ETF Evaluator</Link> uses
          criteria tailored to that strategy (yield sustainability, upside capture, track record).
          The general evaluation below still applies.
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
                (average of scored criteria 2-6)
              </span>
            </div>
            <button type="button" onClick={() => setThresholds(ETF_DEFAULT_THRESHOLDS)} style={{
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

          <AlternativesList alternatives={alternatives} peerCount={peers.length} strategy={strategy} isOptionIncome={isOptionIncome} />

          <div style={{
            marginTop: '1.5rem', padding: '0.8rem 1rem',
            background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6,
            color: 'var(--text-dim-2)', fontSize: '0.84rem', lineHeight: 1.55,
          }}>
            <strong style={{ color: 'var(--teal-2)' }}>Notes:</strong> Data is fetched live from yfinance.
            Peers are drawn from the scanner cache matching this ETF's strategy group.
            Custom thresholds persist in this browser via localStorage.
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
