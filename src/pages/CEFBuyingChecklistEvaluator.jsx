import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../config'
import FundScanTab from '../components/FundScanTab'
import { formatMoney } from '../utils/money'
import useTickerQueryParam from '../utils/useTickerQueryParam'
import {
  DEFAULT_THRESHOLDS,
  mergeThresholds,
  leverageProfile,
  MIN_COMPARABLE_PEERS,
  MAX_LEVERAGE_GAP_PP,
  gradeFund,
  findAlternatives,
  verdictFromComposite,
} from '../utils/cefGrading'

const STORAGE_KEY = 'cefChecklistThresholds.v2'

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
    'The 30% / 35% defaults are application risk screens. Regulatory limits depend on the financing instrument, not simply whether a fund holds bonds or equities.',
    'Type of leverage (preferred shares vs. credit facility vs. reverse repos) behaves differently in stress.',
  ],
  5: [
    'Total expense ratio includes management fees, administration, and the interest cost of leverage.',
    'The peer median uses the same category, strategy and similar leverage amounts. The average is shown separately for context.',
    'A leverage pass concerns the amount borrowed; expenses concern its cost. Check borrowing terms and operating fees in the fund report.',
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
    const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem('cefChecklistThresholds.v1')
    if (!raw) return DEFAULT_THRESHOLDS
    const parsed = JSON.parse(raw)
    return mergeThresholds(parsed)
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

function saveThresholds(t) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t)) } catch {}
}

const fmtPct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '-' : `${Number(n).toFixed(2)}%`)
const fmtMoney = (n) => formatMoney(n, { fallback: '-' })

function ThresholdEditor({ criterion, thresholds, onChange }) {
  if (!criterion.editable || !criterion.threshold) return null
  const key = criterion.key
  const t = thresholds[key]
  const update = (patch) => {
    const value = Object.values(patch)[0]
    if (!Number.isFinite(value) || (key !== 'discount' && value < 0)) return
    const nextBand = { ...t, ...patch }
    const [passKey, warnKey] = key === 'sustainability' ? ['passPp', 'warnPp']
      : key === 'discount' ? ['passPremium', 'warnPremium']
      : key === 'expense' ? ['passMultiple', 'warnMultiple']
      : key === 'liquidity' ? ['passDollars', 'warnDollars'] : ['passPct', 'warnPct']
    if (key === 'expense' && value === 0) return
    if (key === 'liquidity' ? nextBand[passKey] < nextBand[warnKey] : nextBand[passKey] > nextBand[warnKey]) return
    const next = { ...thresholds, [key]: nextBand }
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
          <label style={labelStyle}>Pass if ≤ (× peer median)</label>
          <input aria-label="Expense pass multiple" type="number" min="0.05" step="0.05" style={inputStyle}
            value={t.passMultiple}
            onChange={e => update({ passMultiple: Number(e.target.value) })} />
        </div>
        <div>
          <label style={labelStyle}>Fail if &gt; (× peer median)</label>
          <input aria-label="Expense fail multiple" type="number" min="0.05" step="0.05" style={inputStyle}
            value={t.warnMultiple}
            onChange={e => update({ warnMultiple: Number(e.target.value) })} />
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
        <strong style={{ color: 'var(--teal-2)' }}>Default rationale:</strong> {criterion.threshold.bestPractice}
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
          <span className={`stock-check-badge tone-${c.badge}`}>{c.badge === 'info' ? 'Not scored' : c.badge}</span>
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

        {c.comparison && (
          <details style={{ paddingLeft: 42, color: 'var(--text-dim-2)', fontSize: '0.85rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--teal-2)' }}>Which peers were used?</summary>
            <p>The selected fund is excluded. Only peers with the required metric contribute to this benchmark.</p>
            {c.comparison.members.length ? (
              <div className="stock-check-table-wrap">
                <table className="stock-check-table" style={{ minWidth: 0, width: '100%' }}>
                  <thead><tr><th>Peer</th><th>Leverage</th><th>{c.comparison.metric}</th></tr></thead>
                  <tbody>{c.comparison.members.map(peer => (
                    <tr key={peer.ticker}>
                      <td><Link to={`/closed-cef-info/${peer.ticker}`}>{peer.ticker}</Link></td>
                      <td>{fmtPct(peer.leverage)}</td><td>{fmtPct(peer.value)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p>No peers with usable data.</p>}
          </details>
        )}

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

function GradingHelp() {
  return (
    <details style={{ margin: '0.8rem 0 1rem', padding: '0.8rem 1rem', background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6, color: 'var(--p-b8c8e0)', lineHeight: 1.6 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--teal-2)', fontWeight: 600 }}>How grading works and why these defaults?</summary>
      <p>The defaults are application screening heuristics, not industry standards, regulatory limits, or a backtested prediction of returns.
        They express preferences for distribution coverage, valuation, moderate leverage, comparable costs and trading capacity.
        Edit the thresholds to reflect your goals; saved changes remain in this browser.</p>
      <div className="stock-check-table-wrap">
        <table className="stock-check-table" style={{ minWidth: 0, width: '100%' }}>
          <thead><tr><th>Check</th><th>Default method and rationale</th></tr></thead>
          <tbody>
            <tr><td>Portfolio fit</td><td>Informational. Category, strategy and income needs require your judgment and contribute no points.</td></tr>
            <tr><td>Distribution sustainability</td><td>Subtract annualized 5Y NAV total return (3Y if 5Y is missing) from the distribution rate on NAV. Pass through a 1 percentage point gap, warn through 3, fail above 3 before UNII adjustments. The gap screens for payouts outpacing past returns; it does not establish the source of distributions. Positive UNII adds 10 points; UNII below −$0.05/share subtracts 10. UNII is accumulated income, not proof of current coverage. Earnings/payment coverage is not scored because the feed does not align reporting periods.</td></tr>
            <tr><td>Discount / premium</td><td>Pass at or below NAV (0% premium), warn through a 5% premium, fail above 5% before history adjustments. This expresses a preference for buying assets below NAV. A 1Y z-score ≤ −1 adds 10 points; ≥ 1 subtracts 15. The 52-week average is context only.</td></tr>
            <tr><td>Leverage</td><td>Pass through 30%, warn through 35%, fail above 35%. Reported zero leverage scores 95; unknown leverage is not scored. This measures leverage exposure, not whether the borrowing cost is attractive or whether the fund will withstand stress.</td></tr>
            <tr><td>Expenses</td><td>Use reported total expenses, including financing costs. Pass at or below 1.00× the comparable-peer median, warn through 1.25×, fail above 1.25×. The 25% margin allows some cost variation; it is a configurable app choice. The old 1.25%/1.50% absolute cutoffs were not peer averages and have been replaced. Other saved settings are retained.</td></tr>
            <tr><td>Track record</td><td>Use the same 5Y NAV return period for every peer, or 3Y if the selected fund lacks 5Y. At/above the peer median scores 85 plus up to 15 points of outperformance; below median but at/above the lower quartile scores 55; below the lower quartile scores 25. Sponsor reputation is not graded.</td></tr>
            <tr><td>Liquidity</td><td>Price × average daily share volume estimates daily traded value. Pass at $1 million/day or more, warn down to $250,000, fail below it. These are retail-trading screens; check order size and spreads separately.</td></tr>
            <tr><td>Risk-adjusted returns</td><td>Scan a List adds one bundled score from Sharpe, Sortino, Calmar, Omega and Ulcer ratios when sufficient history is available. It gets the same weight as one other scored criterion. Deep Dive has no risk-ratio score.</td></tr>
          </tbody>
        </table>
      </div>
      <p><strong>Peers and expenses:</strong> Require the same reported category and strategy, the same detected sector/theme,
        and the same use of leverage. Leveraged peers must be within {MAX_LEVERAGE_GAP_PP} percentage points of the selected fund’s leverage ratio.
        This tolerance is an application choice to limit differences in borrowing exposure.
        Unleveraged funds are compared with unleveraged funds. Unknown classifications or leverage are excluded; small groups are never widened to unrelated funds.
        These rules apply in Deep Dive and within the selected scan batch. Duplicate tickers and the selected fund are excluded.</p>
      <p>Expense and track-record grades each require at least {MIN_COMPARABLE_PEERS} other peers with usable data for that metric.
        The minimum sample is an application guard against relying on one or two funds, not a guarantee of statistical reliability.
        The median is the middle value, averaging the two middle values for an even sample. The lower quartile is interpolated at 25% of the sorted sample.
        The expense average is the arithmetic mean and is shown only for context. Expand “Which peers were used?” to inspect the actual tickers.</p>
      <p>A fund can pass the leverage check while having relatively expensive financing or management fees.
        Total expenses include borrowing costs; the daily feed does not provide a usable fee/interest breakdown, so the app does not estimate one.
        Even similar leverage amounts can have different borrowing terms and expense reporting dates. NAV total return already reflects fund expenses and leverage effects;
        it is not a return adjusted to remove leverage. Review the fund’s annual report for those details.</p>
      <p><strong>Scores and verdicts:</strong> Ordinary threshold checks score 85–100 in the pass band, 50–79 in the warning band,
        and below 50 in the fail band. Better values increase scores; UNII and z-score adjustments can move the final badge into a different band.
        Final badges use pass ≥ 80, warn ≥ 50, fail below 50. Scores are clamped to 0–100; calculations use unrounded values.
        The composite is the equal-weight average of available scored criteria; missing data contributes no points and no failure.
        At least 3 scored criteria are needed. “Strong Buy” requires ≥ 70 and no failures; “Weak Buy” requires ≥ 60 and at most 1 failure;
        otherwise the label is “Do Not Buy.” These are checklist labels, and unscored checks still need review.</p>
      <p><strong>Alternatives:</strong> Candidates must pass the same peer filters, have exactly the same set of scored criteria,
        and exceed the selected fund’s composite by more than 1 point. Show up to 5, ordered by composite.
        Each fund’s peer benchmarks exclude itself. Lower leverage is shown as context rather than a standalone reason to recommend switching.
        A higher score does not establish suitability or equal currency, credit, duration or portfolio risk.</p>
      <p><strong>Background:</strong>{' '}
        <a href="https://www.fidelity.com/learning-center/investment-products/closed-end-funds/leverage" target="_blank" rel="noreferrer">Leverage, expenses and NAV returns (Fidelity)</a>
        {' · '}<a href="https://www.nuveen.com/en-us/insights/understanding-leverage" target="_blank" rel="noreferrer">Leverage structure and regulatory limits (Nuveen)</a>.
        These sources explain the concepts; the numerical grading defaults are this app’s choices.</p>
    </details>
  )
}

function AlternativesList({ alternatives, peers, fund }) {
  const leverage = leverageProfile(fund)
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2 style={{ color: 'var(--p-e6edf7)', fontSize: '1.1rem', margin: '0 0 0.4rem' }}>
        Higher-scoring comparable alternatives
      </h2>
      <p style={{ color: 'var(--text-dim-2)', fontSize: '0.86rem', margin: '0 0 0.8rem' }}>
        {peers.length} other funds match {fund.category || 'the category'}, the strategy and theme, and
        {' '}{leverage === null ? 'a known leverage profile' : leverage === 0 ? 'no leverage' : `leverage within ${MAX_LEVERAGE_GAP_PP} percentage points of ${fmtPct(leverage)}`}.
        {' '}Rankings require the same scored criteria. Review each fund’s mandate and financing terms.
      </p>
      {alternatives.length === 0 ? (
        <div style={{ background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6, padding: '1rem', color: 'var(--p-b8c8e0)' }}>
          {peers.length ? 'No higher-scoring alternatives with matching data coverage were found in this comparison group.' : 'No comparable peers found. The search has not been broadened to a different asset class, strategy or leverage profile.'}
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
              <div style={{ color: 'var(--text-dim-2)', fontSize: '0.84rem', marginTop: '0.35rem' }}>
                {alt.fund.strategy} · Leverage {fmtPct(leverageProfile(alt.fund))} vs {fmtPct(leverage)} · Total expenses {fmtPct(alt.fund.expense_ratio)} vs {fmtPct(fund.expense_ratio)}
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
  const [thresholds, setThresholds] = useState(loadThresholds)
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

  const evaluateRequestedTicker = useCallback((ticker) => {
    setInputTicker(ticker)
    setActiveTicker(ticker)
    setTab('deep')
  }, [])
  useTickerQueryParam(evaluateRequestedTicker)

  const submit = (e) => {
    e?.preventDefault?.()
    setActiveTicker(inputTicker.trim().toUpperCase())
  }

  const fund = useMemo(() => {
    if (!activeTicker || !data?.rows) return null
    return data.rows.find(r => String(r.ticker || '').toUpperCase() === activeTicker) || null
  }, [activeTicker, data])

  const result = useMemo(() => {
    if (!fund) return null
    return gradeFund(fund, data?.rows || [], thresholds)
  }, [fund, data, thresholds])

  const alternatives = useMemo(() => {
    if (!fund) return []
    return findAlternatives(fund, data?.rows || [], thresholds, 5)
  }, [fund, data, thresholds])

  const verdict = useMemo(() => {
    if (!result) return null
    return verdictFromComposite(result.composite, result.criteria)
  }, [result])

  return (
    <div className="page cef-page stock-check-page">
      <div className="cef-title-row stock-check-title-row">
        <div>
          <h1>CEF Buying Checklist Evaluator</h1>
          <p>Evaluate the buying-guide questions with editable thresholds and compare funds with similar strategies and leverage.</p>
        </div>
      </div>

      <GradingHelp />

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
          getTickerHref={ticker => `/closed-cef-info/${encodeURIComponent(ticker)}`}
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
          placeholder="e.g. TEI, PDI, UTG..."
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
                ({result.criteria.filter(c => c.id >= 2 && c.id <= 7 && c.score !== null).length} of 6 criteria scored; average excludes missing grades)
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
            peers={result.peers}
            fund={fund}
          />

          <div style={{
            marginTop: '1.5rem', padding: '0.8rem 1rem',
            background: 'var(--p-0f1e3b)', border: '1px solid var(--p-1c2e52)', borderRadius: 6,
            color: 'var(--text-dim-2)', fontSize: '0.84rem', lineHeight: 1.55,
          }}>
            <strong style={{ color: 'var(--teal-2)' }}>Notes:</strong> Sustainability is a proxy based on distribution rate vs. long-term
            NAV return, with a UNII adjustment when available. Missing grades are excluded from the composite.
            Custom thresholds persist in this browser. Open the grading help above for the defaults, formulas and limitations.
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
