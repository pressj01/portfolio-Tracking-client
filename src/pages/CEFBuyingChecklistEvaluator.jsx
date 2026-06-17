import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../config'
import FundScanTab from '../components/FundScanTab'
import {
  DEFAULT_THRESHOLDS,
  BEST_PRACTICE,
  gradeFund,
  findAlternatives,
  verdictFromComposite,
  detectFundTheme,
  fundMatchesTheme,
} from '../utils/cefGrading'

const STORAGE_KEY = 'cefChecklistThresholds.v1'

const QUESTION_DETAILS = {
  1: [
    'Read the fund’s stated mandate — does it match your timeline and risk tolerance?',
    'Yield vs. total return mix: a 15% payout funded by return-of-capital is not the same as 8% from net investment income.',
    'Avoid concentrating into another leveraged equity CEF if you already own one.',
  ],
  2: [
    'Compare distribution rate on NAV to long-term NAV total return (5Y or 3Y).',
    'Managed-distribution policies must be monitored for NAV erosion over time.',
    'Check Section 19(a) notices for income vs. return-of-capital breakdowns.',
  ],
  3: [
    'Current discount vs. 52-week average and 1Y z-score.',
    'A discount wider than its own history is more attractive; a premium > 5% leaves no margin of safety.',
    'Premiums are warnings — you’re paying more than the portfolio is worth.',
  ],
  4: [
    'Regulatory leverage is capped at 50% for bond funds, 33% for equity funds. Funds near those limits have less cushion.',
    'Type of leverage (preferred shares vs. credit facility vs. reverse repos) behaves differently in stress.',
  ],
  5: [
    'Total expense ratio includes management fees, administration, and the interest cost of leverage.',
    'A higher-fee fund must deliver superior NAV total return to justify the cost.',
  ],
  6: [
    'NAV total return isolates the manager’s stock-picking and income generation from discount movement.',
    'Sponsor reputation, manager tenure, and distribution-history discipline are key qualitative signals.',
  ],
  7: [
    'A single trade should not exceed 10–20% of average daily volume — otherwise you move the market.',
    'Wider bid-ask spreads in thin funds mean higher implicit transaction costs. Always use limit orders.',
  ],
}

function loadThresholds() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_THRESHOLDS
    const parsed = JSON.parse(raw)
    return {
      sustainability: { ...DEFAULT_THRESHOLDS.sustainability, ...(parsed.sustainability || {}) },
      discount:       { ...DEFAULT_THRESHOLDS.discount,       ...(parsed.discount || {}) },
      leverage:       { ...DEFAULT_THRESHOLDS.leverage,       ...(parsed.leverage || {}) },
      expense:        { ...DEFAULT_THRESHOLDS.expense,        ...(parsed.expense || {}) },
      liquidity:      { ...DEFAULT_THRESHOLDS.liquidity,      ...(parsed.liquidity || {}) },
    }
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

function saveThresholds(t) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t)) } catch {}
}

const fmtPct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '-' : `${Number(n).toFixed(2)}%`)
const fmtMoney = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '-' : `$${Number(n).toFixed(2)}`)

function ThresholdEditor({ criterion, thresholds, onChange }) {
  if (!criterion.editable || !criterion.threshold) return null
  const key = criterion.key
  const t = thresholds[key]
  const update = (patch) => {
    const next = { ...thresholds, [key]: { ...t, ...patch } }
    onChange(next)
  }

  const labelStyle = { color: 'var(--text-dim)', fontSize: '0.78rem', display: 'block', marginBottom: 2 }
  const inputStyle = {
    background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-strong)', padding: '0.3rem 0.5rem', fontSize: '0.85rem', width: 90,
  }

  let controls = null
  if (key === 'sustainability') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if gap ≤ (pp)</label>
          <input type="number" step="0.1" style={inputStyle}
            value={t.passPp}
            onChange={e => update({ passPp: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Warn if gap ≤ (pp)</label>
          <input type="number" step="0.1" style={inputStyle}
            value={t.warnPp}
            onChange={e => update({ warnPp: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'discount') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if premium ≤ (%)</label>
          <input type="number" step="0.5" style={inputStyle}
            value={t.passPremium}
            onChange={e => update({ passPremium: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if premium &gt; (%)</label>
          <input type="number" step="0.5" style={inputStyle}
            value={t.warnPremium}
            onChange={e => update({ warnPremium: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'leverage') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if ≤ (%)</label>
          <input type="number" step="1" style={inputStyle}
            value={t.passPct}
            onChange={e => update({ passPct: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if &gt; (%)</label>
          <input type="number" step="1" style={inputStyle}
            value={t.warnPct}
            onChange={e => update({ warnPct: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'expense') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if ≤ (%)</label>
          <input type="number" step="0.05" style={inputStyle}
            value={t.passPct}
            onChange={e => update({ passPct: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if &gt; (%)</label>
          <input type="number" step="0.05" style={inputStyle}
            value={t.warnPct}
            onChange={e => update({ warnPct: Number(e.target.value) })} />
        </div>
      </>
    )
  } else if (key === 'liquidity') {
    controls = (
      <>
        <div>
          <label style={labelStyle}>Pass if ≥ ($/day)</label>
          <input type="number" step="50000" style={{ ...inputStyle, width: 130 }}
            value={t.passDollars}
            onChange={e => update({ passDollars: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if &lt; ($/day)</label>
          <input type="number" step="50000" style={{ ...inputStyle, width: 130 }}
            value={t.warnDollars}
            onChange={e => update({ warnDollars: Number(e.target.value) })} />
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
        <Link to={`/closed-cef-info/${fund.ticker}`} style={{ marginLeft: 'auto', fontSize: '0.85rem' }}>
          View full CEF detail →
        </Link>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.5rem', marginTop: '0.6rem', color: 'var(--p-b8c8e0)', fontSize: '0.9rem' }}>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Category: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.category || 'n/a'}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Strategy: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.strategy || 'n/a'}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Sponsor: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fund.sponsor || 'n/a'}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Price: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fmtMoney(fund.price)}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>NAV: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fmtMoney(fund.nav)}</strong></span>
        <span><span style={{ color: 'var(--text-dim-2)' }}>Prem/Disc: </span><strong style={{ color: 'var(--p-e6edf7)' }}>{fmtPct(fund.premium_discount)}</strong></span>
      </div>
    </div>
  )
}

function AlternativesList({ alternatives, peerCount, groupLabel, themed }) {
  if (!groupLabel) return null
  const heading = themed
    ? `Better ${groupLabel} alternatives`
    : `Better alternatives in the ${groupLabel} category`
  const blurb = themed
    ? `Other ${groupLabel}s scoring higher on the composite of all 7 criteria. ${peerCount} same-sector peers screened.`
    : `Funds in the same category scoring higher on the composite of all 7 criteria. ${peerCount} peers screened.`
  const emptyMsg = themed
    ? `No higher-scoring ${groupLabel}s found.`
    : 'No higher-scoring alternatives found in this category.'
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2 style={{ color: 'var(--p-e6edf7)', fontSize: '1.1rem', margin: '0 0 0.4rem' }}>
        {heading}
      </h2>
      <p style={{ color: 'var(--text-dim-2)', fontSize: '0.86rem', margin: '0 0 0.8rem' }}>
        {blurb}
      </p>
      {alternatives.length === 0 ? (
        <div style={{ background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6, padding: '1rem', color: 'var(--p-b8c8e0)' }}>
          {emptyMsg}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alternatives.map(alt => (
            <div key={alt.fund.ticker} style={{
              background: 'var(--p-1a2744)', border: '1px solid var(--p-243356)', borderRadius: 8,
              padding: '0.8rem 1rem',
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'baseline' }}>
                <Link to={`/closed-cef-info/${alt.fund.ticker}`} style={{ fontWeight: 700, color: 'var(--teal-2)', textDecoration: 'none' }}>
                  {alt.fund.ticker}
                </Link>
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

export default function CEFBuyingChecklistEvaluator() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inputTicker, setInputTicker] = useState('')
  const [activeTicker, setActiveTicker] = useState('')
  const [thresholds, setThresholds] = useState(loadThresholds())
  const [tab, setTab] = useState('deep')

  const tabBtn = (key, label) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`stock-check-tab${tab === key ? ' is-active' : ''}`}
    >{label}</button>
  )

  const loadPricing = useCallback(() => {
    setLoading(true)
    setError('')
    fetch(`${API_BASE}/api/closed-cef/pricing`, { cache: 'no-store' })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Could not load CEF pricing.')
        setData(payload)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadPricing() }, [loadPricing])

  useEffect(() => { saveThresholds(thresholds) }, [thresholds])

  const submit = (e) => {
    e?.preventDefault?.()
    setActiveTicker(inputTicker.trim().toUpperCase())
  }

  const fund = useMemo(() => {
    if (!activeTicker || !data?.rows) return null
    return data.rows.find(r => String(r.ticker || '').toUpperCase() === activeTicker) || null
  }, [activeTicker, data])

  const peers = useMemo(() => {
    if (!fund || !data?.rows) return []
    return data.rows.filter(r => r.category && r.category === fund.category)
  }, [fund, data])

  // Peer group for the "better alternatives" list. When the fund belongs to a
  // recognizable sector/strategy theme (e.g. infrastructure), narrow to other
  // funds sharing that theme so an infrastructure CEF only surfaces other
  // infrastructure CEFs — not every fund in its broad Morningstar category.
  // Falls back to the broad category when no theme is detected or too few
  // themed peers exist to compare against.
  const altPeerGroup = useMemo(() => {
    if (!fund || !data?.rows) return { peers: [], label: fund?.category || '', themed: false }
    const theme = detectFundTheme(fund)
    if (theme) {
      const themed = data.rows.filter(r => fundMatchesTheme(r, theme))
      if (themed.length >= 3) {
        return { peers: themed, label: `${theme.label} CEF`, themed: true }
      }
    }
    return { peers, label: fund.category, themed: false }
  }, [fund, data, peers])

  const result = useMemo(() => {
    if (!fund) return null
    return gradeFund(fund, peers, thresholds)
  }, [fund, peers, thresholds])

  const alternatives = useMemo(() => {
    if (!fund) return []
    return findAlternatives(fund, altPeerGroup.peers, thresholds, 5)
  }, [fund, altPeerGroup, thresholds])

  const verdict = useMemo(() => {
    if (!result) return null
    return verdictFromComposite(result.composite, result.criteria)
  }, [result])

  return (
    <div className="page cef-page stock-check-page">
      <div className="cef-title-row stock-check-title-row">
        <div>
          <h1>CEF Buying Checklist Evaluator</h1>
          <p>Enter a CEF ticker. The 7 questions from the buying guide are scored against editable thresholds, and alternatives in the same category are surfaced.</p>
        </div>
      </div>

      <div className="stock-check-tabs" role="tablist" aria-label="CEF checklist mode">
        {tabBtn('deep', 'Deep Dive')}
        {tabBtn('scan', 'Scan a List')}
      </div>

      {tab === 'scan' ? (
        <FundScanTab
          endpoint="/api/cef/scan"
          kindLabel="closed-end funds"
          gradeFund={gradeFund}
          verdictFromComposite={verdictFromComposite}
          thresholds={thresholds}
          allowCefUniverse
          extraColumns={[
            { key: 'premium_discount', label: 'Prem/Disc', fmt: (r) => (r.premium_discount == null ? '—' : `${Number(r.premium_discount).toFixed(2)}%`) },
          ]}
        />
      ) : (
      <>
      <form onSubmit={submit} className="stock-check-search">
        <input
          value={inputTicker}
          onChange={e => setInputTicker(e.target.value.toUpperCase())}
          placeholder="e.g. PDI, UTG, JEPI..."
          className="stock-check-input stock-check-ticker-input"
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>Evaluate</button>
        <Link to="/cef-buying-guide" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
          View static guide →
        </Link>
      </form>

      {loading && <div className="cef-loading"><span className="spinner" /> Loading CEF Connect daily pricing...</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!loading && activeTicker && !fund && (
        <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>
          Ticker <strong>{activeTicker}</strong> not found in CEF Connect daily pricing. Try a different CEF symbol or
          {' '}<Link to="/cef-buying-guide">review the static buying guide</Link>.
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
                (average of scored criteria 2–7)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
              style={{
                background: 'transparent', border: '1px solid var(--p-2a3e6b)', borderRadius: 4,
                color: 'var(--p-8aa0c8)', padding: '0.3rem 0.7rem', cursor: 'pointer', fontSize: '0.82rem',
              }}
            >
              Reset thresholds to defaults
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.criteria.map(c => (
              <CriterionCard
                key={c.id}
                criterion={c}
                thresholds={thresholds}
                onChangeThresholds={setThresholds}
              />
            ))}
          </div>

          {verdict && (
            <div style={{
              marginTop: '1.25rem',
              padding: '1rem 1.2rem',
              borderRadius: 8,
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

          <AlternativesList
            alternatives={alternatives}
            peerCount={altPeerGroup.peers.length}
            groupLabel={altPeerGroup.label}
            themed={altPeerGroup.themed}
          />

          <div style={{
            marginTop: '1.5rem', padding: '0.8rem 1rem',
            background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6,
            color: 'var(--text-dim-2)', fontSize: '0.84rem', lineHeight: 1.55,
          }}>
            <strong style={{ color: 'var(--teal-2)' }}>Notes:</strong> Sustainability scoring uses distribution rate vs. long-term
            NAV return as the primary proxy, enhanced by UNII per share and earnings-based coverage when CEF Connect
            reports them (many funds return null for UNII). Custom thresholds you set persist in this browser.
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
