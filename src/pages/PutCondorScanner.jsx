import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerParameterGuide from '../components/ScannerParameterGuide'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'put-call-condor-scanner-filters'
const FALLBACK_DEFAULTS = {
  option_side: 'put',
  underlying: '^XSP',
  placement_mode: 'slightly_otm',
  debit_otm_pct: 0.5,
  target_dte: 42,
  min_dte: 30,
  max_dte: 60,
  max_risk_dollars: 200,
  credit_short_delta: 0.15,
  target_upper_credit_dollars: 10,
  max_upper_credit_dollars: 25,
  min_open_interest: 0,
  max_results: 4,
}

const CREDIT_SHORT_DELTAS = Array.from({ length: 11 }, (_, index) => (10 + index) / 100)

const usd = (value, digits = 2) => value == null
  ? '—'
  : Number(value).toLocaleString(undefined, {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: digits, maximumFractionDigits: digits,
    })
const num = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits)
const pct = (value, digits = 1) => value == null ? '—' : `${Number(value).toFixed(digits)}%`
const signed = (value, digits = 2) => value == null
  ? '—'
  : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}`
const signedUsd = (value, digits = 0) => value == null
  ? '—'
  : `${Number(value) >= 0 ? '+' : '−'}${usd(Math.abs(Number(value)), digits)}`

function readFilters() {
  try {
    return {
      ...FALLBACK_DEFAULTS,
      ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {}),
    }
  } catch {
    return { ...FALLBACK_DEFAULTS }
  }
}

function HelpPanel() {
  return (
    <div style={{
      background: 'var(--surface-sunken)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '0.85rem 1rem', marginBottom: '0.8rem',
      color: 'var(--text-muted)', lineHeight: 1.55, fontSize: '0.82rem',
    }}>
      <p style={{ marginTop: 0 }}>
        This screen builds a Put Condor, a Call Condor, or both on Mini-SPX
        (<strong>^XSP</strong>) or SPY. Each side starts with a one-point debit spread
        near the market and finances it with a farther out-of-the-money credit spread.
      </p>
      <p>
        <strong>Your maximum risk is a hard per-condor expiration-loss ceiling.</strong>
        {' '}The short option anchors the credit spread at your selected 10–20 delta.
        The scanner then adjusts its protective long strike and width to use the risk
        budget as closely as possible without exceeding it. Put risk is on the downside;
        Call risk is on the upside.
      </p>
      <p>
        On the untested side, all four options expire worthless and the opening credit
        remains. The Put Condor therefore keeps a positive upper line; the Call Condor
        keeps a positive lower line. The target and maximum line-credit controls apply
        independently to each side.
      </p>
      <p style={{ marginBottom: 0 }}>
        In Both mode, each result remains available separately and shared expirations are
        also combined as one eight-leg expiration payoff. The combined maximum profit and
        loss account for the fact that the Put and Call peaks occur at different prices.
        Broker margin, interim marks, commissions, assignment, and exercise handling can
        differ from that expiration-only calculation.
      </p>
    </div>
  )
}

function MetricCard({ label, value, subtext, color = 'var(--text-strong)' }) {
  return (
    <div style={{
      flex: '1 1 150px', minWidth: 145, padding: '0.7rem 0.8rem',
      background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 6,
    }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color, fontWeight: 800, fontSize: '1.15rem', marginTop: '0.12rem' }}>{value}</div>
      {subtext && <div style={{ color: 'var(--text-muted)', fontSize: '0.67rem', marginTop: '0.15rem' }}>{subtext}</div>}
    </div>
  )
}

function Structure({ row }) {
  const optionLetter = row.option_side === 'call' ? 'C' : 'P'
  const leg = (side, strike, delta) => (
    <div style={{ whiteSpace: 'nowrap' }}>
      <strong style={{ color: side === 'BUY' ? 'var(--accent-bright)' : 'var(--amber)' }}>{side}</strong>
      {' '}1 × {usd(strike)}{optionLetter}
      <small style={{ color: 'var(--text-dim)', marginLeft: '0.25rem' }}>Δ {num(delta, 3)}</small>
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: '0.12rem', fontSize: '0.71rem' }}>
      {leg('BUY', row.debit_long_strike, row.debit_long_leg?.delta)}
      {leg('SELL', row.debit_short_strike, row.debit_short_leg?.delta)}
      {leg('SELL', row.credit_short_strike, row.credit_short_leg?.delta)}
      {leg('BUY', row.credit_long_strike, row.credit_long_leg?.delta)}
    </div>
  )
}

function ProbabilityCards({ row }) {
  const estimates = row.early_close_estimates || []
  const callSide = row.option_side === 'call'
  const beyond = callSide ? 'above' : 'below'
  return (
    <div style={{ marginBottom: '0.8rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
        <MetricCard
          label="Touch debit long"
          value={pct(row.prob_touch_debit_long_pct)}
          subtext={`${usd(row.debit_long_strike)} through ${row.expiration}`}
          color="var(--accent-bright)"
        />
        <MetricCard
          label={`Finish ${beyond} debit long`}
          value={pct(row.prob_finish_beyond_debit_long_pct)}
          subtext={`${num(row.debit_long_distance_sigma, 2)}σ from spot at entry`}
        />
        <MetricCard
          label="Touch credit short"
          value={pct(row.prob_touch_credit_short_pct)}
          subtext={`${usd(row.credit_short_strike)} · ${row.risk_direction} risk begins beyond the peak`}
          color="var(--amber)"
        />
        <MetricCard
          label={`Finish ${beyond} credit short`}
          value={pct(row.prob_finish_beyond_credit_short_pct)}
          subtext={`Probability IV ${pct((row.probability_iv || 0) * 100)}`}
          color="var(--neg-strong)"
        />
        {estimates.map(estimate => (
          <MetricCard
            key={estimate.elapsed_days}
            label={`Profitable close after ${estimate.elapsed_days}d`}
            value={pct(estimate.probability_profit_pct)}
            subtext={`${estimate.remaining_dte} DTE remaining · modeled marks`}
            color="var(--pos-strong)"
          />
        ))}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', marginTop: '0.45rem' }}>
        Probability estimates use current implied volatility, a continuous-price model, and no jumps.
        Early-close values hold each leg&apos;s IV constant and exclude commissions and slippage.
      </div>
    </div>
  )
}

function LegTable({ row }) {
  const legs = [
    ['Buy debit long', row.debit_long_leg],
    ['Sell debit short', row.debit_short_leg],
    ['Sell credit short', row.credit_short_leg],
    ['Buy credit long', row.credit_long_leg],
  ]
  return (
    <div className="sst-wrap" style={{ marginTop: '0.8rem' }}>
      <table className="sst" style={{ fontSize: '0.72rem' }}>
        <thead><tr><th>Leg</th><th>Strike</th><th>Bid</th><th>Ask</th><th>Mid</th><th>IV</th><th>Delta</th><th>OI</th><th>Volume</th><th>Quote</th></tr></thead>
        <tbody>{legs.map(([label, leg]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{usd(leg?.strike)}</td>
            <td>{usd(leg?.bid)}</td>
            <td>{usd(leg?.ask)}</td>
            <td>{usd(leg?.mid)}</td>
            <td>{pct((leg?.iv || 0) * 100)}</td>
            <td>{num(leg?.delta, 3)}</td>
            <td>{Number(leg?.open_interest || 0).toLocaleString()}</td>
            <td>{Number(leg?.volume || 0).toLocaleString()}</td>
            <td>{leg?.quote_source === 'live_bid_ask' ? 'Live' : 'Estimate'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function Detail({ row, colSpan }) {
  const callSide = row.option_side === 'call'
  const sideLabel = callSide ? 'Call' : 'Put'
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--surface-sunken)', padding: 0, whiteSpace: 'normal' }}>
        <div style={{ position: 'sticky', left: 0, maxWidth: 'calc(min(100vw, 1900px) - 4rem)', padding: '0.85rem 1rem' }}>
          <ProbabilityCards row={row} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Entry at mid</div>
              <div>Debit spread cost: <strong>{usd(row.bought_debit_dollars, 0)}</strong></div>
              <div>Credit spread received: <strong>{usd(row.sold_credit_dollars, 0)}</strong></div>
              <div>{callSide ? 'Lower' : 'Upper'}-line net credit: <strong style={{ color: 'var(--pos-strong)' }}>{usd(row.entry_credit_dollars, 2)}</strong></div>
              <div>Natural-market credit: <strong>{signedUsd(row.natural_credit_dollars, 2)}</strong></div>
              <div>Total quoted width: <strong>{usd(row.execution_cost_dollars, 0)}</strong></div>
            </div>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Expiration payoff</div>
              <div>{row.near_flat_label}: <strong style={{ color: 'var(--pos)' }}>{signedUsd(row.near_flat_dollars, 0)}</strong></div>
              <div>Center maximum: <strong style={{ color: 'var(--pos-strong)' }}>{usd(row.max_profit_dollars, 0)}</strong></div>
              <div>{row.far_flat_label}: <strong style={{ color: 'var(--neg-strong)' }}>{signedUsd(row.far_flat_dollars, 0)}</strong></div>
              <div>{callSide ? 'Upper' : 'Lower'} breakeven: <strong>{usd(row.risk_breakeven)}</strong></div>
              <div>{callSide ? 'Upside' : 'Downside'} cushion: <strong>{pct(row.risk_breakeven_cushion_pct)}</strong></div>
            </div>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Risk budget</div>
              <div>Selected limit: <strong>{usd(row.max_risk_limit_dollars, 0)}</strong></div>
              <div>Calculated maximum loss: <strong style={{ color: 'var(--neg)' }}>{usd(row.max_loss_dollars, 0)}</strong></div>
              <div>Budget used: <strong>{pct(row.risk_utilization_pct)}</strong></div>
              <div>Budget remaining: <strong>{usd(row.risk_remaining_dollars, 0)}</strong></div>
              <div>Max / annualized ROR: <strong>{pct(row.return_on_risk_pct)} / {pct(row.annualized_return_on_risk_pct)}</strong></div>
            </div>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Placement and Greeks</div>
              <div>Target / actual debit long: <strong>{pct(row.target_debit_otm_pct, 2)} / {pct(row.actual_debit_otm_pct, 2)} OTM</strong></div>
              <div>Net position delta: <strong>{signed(row.position_delta)}</strong></div>
              <div>Credit short target / actual: <strong>{num(row.target_credit_short_delta * 100, 0)} / {num(row.actual_credit_short_delta * 100, 1)} Δ</strong></div>
              <div>Debit short delta: <strong>{num(row.debit_short_leg?.delta, 3)}</strong></div>
              <div>Minimum leg OI / volume: <strong>{row.open_interest_min} / {row.volume_min}</strong></div>
              <div>Debit / credit widths: <strong>{num(row.debit_width)} / {num(row.credit_width)} points</strong></div>
            </div>
          </div>
          {row.flags?.length > 0 && <div style={{ color: 'var(--amber)', marginTop: '0.75rem' }}>{row.flags.join(' · ')}</div>}
          <LegTable row={row} />
          <div style={{ marginTop: '0.75rem' }}>
            <RiskGraphButton
              kind={callSide ? 'call-condor' : 'put-condor'}
              row={row}
              source={`${sideLabel} Condor Scanner`}
            />
          </div>
        </div>
      </td>
    </tr>
  )
}

function CombinedPackages({ packages }) {
  if (!packages?.length) return null
  return (
    <div style={{
      background: 'var(--surface-sunken)', border: '1px solid var(--accent)',
      borderRadius: 7, padding: '0.85rem 1rem', marginBottom: '0.8rem',
    }}>
      <div style={{ color: 'var(--accent-bright)', fontWeight: 800, marginBottom: '0.45rem' }}>
        Combined Put + Call expiration payoff
      </div>
      <div className="sst-wrap">
        <table className="sst" style={{ fontSize: '0.74rem' }}>
          <thead><tr>
            <th>Expiration</th><th>Eight-leg credit</th><th>Combined max profit / loss</th>
            <th>Downside tail</th><th>Middle flat</th><th>Upside tail</th><th>Risk context</th><th>Actions</th>
          </tr></thead>
          <tbody>{packages.map(item => (
            <tr key={item.expiration}>
              <td><strong>{item.expiration}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{item.dte} DTE</div></td>
              <td style={{ color: 'var(--pos-strong)' }}><strong>{usd(item.entry_credit_dollars, 2)}</strong></td>
              <td>
                <span style={{ color: 'var(--pos)' }}>{usd(item.max_profit_dollars, 2)}</span>
                {' / '}<span style={{ color: 'var(--neg)' }}>{usd(item.max_loss_dollars, 2)}</span>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(item.return_on_risk_pct)} expiration ROR</div>
              </td>
              <td style={{ color: Number(item.downside_tail_dollars) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{signedUsd(item.downside_tail_dollars, 2)}</td>
              <td style={{ color: Number(item.middle_flat_dollars) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{signedUsd(item.middle_flat_dollars, 2)}</td>
              <td style={{ color: Number(item.upside_tail_dollars) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{signedUsd(item.upside_tail_dollars, 2)}</td>
              <td>
                <div>Gross individual loss: {usd(item.gross_individual_max_loss_dollars, 0)}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>Selected budgets: {usd(item.selected_risk_budget_dollars, 0)}</div>
              </td>
              <td>
                <RiskGraphButton
                  kind="put-call-condor"
                  row={item}
                  source="Put / Call Condor Scanner"
                  label="Combined graph"
                />
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginTop: '0.5rem' }}>
        Combined maximum profit and loss are calculated from the complete eight-leg expiration payoff,
        not by adding two mutually exclusive peaks. Gross individual loss and selected budgets remain
        visible because broker margin and interim marks may not grant full offsetting treatment.
      </div>
    </div>
  )
}

export default function PutCondorScanner() {
  const pf = useProfileFetch()
  const [cachedScan, saveScan] = useScanCache('put-call-condor')
  const [filters, setFilters] = useState(readFilters)
  const [rows, setRows] = useState(cachedScan?.rows || [])
  const [unavailable, setUnavailable] = useState(cachedScan?.unavailable || [])
  const [stats, setStats] = useState(cachedScan?.stats || null)
  const [combinedPackages, setCombinedPackages] = useState(cachedScan?.combined_packages || [])
  const [asOf, setAsOf] = useState(cachedScan?.as_of || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [sortKey, setSortKey] = useState('dte')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const fieldStyle = {
    display: 'block', marginTop: '0.2rem', padding: '0.32rem 0.4rem',
    color: 'var(--text-strong)', background: 'var(--surface-inset)',
    border: '1px solid var(--border)', borderRadius: 4,
  }
  const numberField = (label, key, options = {}) => {
    const { step = 1, min, max, suffix = '', width = 78, tip } = options
    return (
      <label title={tip} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-dim)', fontSize: '0.74rem' }}>
        {label}
        <span>
          <input
            type="number" step={step} min={min} max={max} value={filters[key]}
            onChange={event => set(key, Number(event.target.value))}
            style={{ ...fieldStyle, display: 'inline-block', marginTop: 0, width }}
          />
          {suffix && <span style={{ marginLeft: '0.2rem' }}>{suffix}</span>}
        </span>
      </label>
    )
  }

  const runScan = useCallback(() => {
    setLoading(true)
    setError('')
    setExpanded(null)
    pf('/api/options/condor-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
    })
      .then(async response => {
        let data
        try { data = await response.json() } catch { throw new Error(`Scan request failed (${response.status})`) }
        if (!response.ok || data?.error) throw new Error(data?.error || `Scan request failed (${response.status})`)
        return data
      })
      .then(data => {
        const snapshot = {
          rows: data.rows || [], unavailable: data.unavailable || [],
          stats: data.stats || null, combined_packages: data.combined_packages || [],
          as_of: data.as_of || null,
        }
        setRows(snapshot.rows)
        setUnavailable(snapshot.unavailable)
        setStats(snapshot.stats)
        setCombinedPackages(snapshot.combined_packages)
        setAsOf(snapshot.as_of)
        saveScan(snapshot)
      })
      .catch(scanError => setError(scanError.message))
      .finally(() => setLoading(false))
  }, [filters, pf, saveScan])

  const sortedRows = useMemo(() => {
    const accessors = {
      dte: row => row.dte,
      credit: row => row.entry_credit_dollars,
      max_profit: row => row.max_profit_dollars,
      max_loss: row => row.max_loss_dollars,
      risk_use: row => row.risk_utilization_pct,
      probability: row => row.prob_touch_credit_short_pct,
      oi: row => row.open_interest_min,
    }
    const access = accessors[sortKey] || accessors.dte
    return [...rows].sort((a, b) => {
      const av = access(a), bv = access(b)
      return sortAsc ? (av ?? Infinity) - (bv ?? Infinity) : (bv ?? -Infinity) - (av ?? -Infinity)
    })
  }, [rows, sortKey, sortAsc])
  const sort = key => {
    if (sortKey === key) setSortAsc(value => !value)
    else { setSortKey(key); setSortAsc(true) }
  }
  const heading = (label, key, style) => (
    <th onClick={() => sort(key)} style={{ cursor: 'pointer', ...style }}>
      {label}{sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  )

  const columnCount = 12
  return (
    <div className="page-container" style={{ maxWidth: 1900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.3rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Put / Call Condor Scanner</h1>
        <button className="btn btn-sm btn-outline" onClick={() => setShowHelp(value => !value)}>
          {showHelp ? 'Hide help' : 'How this works'}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Builds a Put Condor, Call Condor, or both together. Each uses a near-the-money
        1-point debit spread and an automatically sized credit wing that honors the selected
        short delta, maximum risk, and positive untested-side expiration line.
      </p>
      <ScannerRiskNotice />
      {showHelp && <HelpPanel />}
      <ScannerParameterGuide scanner="put-condor" />

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.85rem', alignItems: 'flex-end',
        padding: '0.85rem', marginBottom: '0.7rem', background: 'var(--surface-sunken)',
        border: '1px solid var(--border)', borderRadius: 6,
      }}>
        <label style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Condor side
          <select value={filters.option_side} onChange={event => set('option_side', event.target.value)} style={fieldStyle}>
            <option value="put">Put only</option>
            <option value="call">Call only</option>
            <option value="both">Both — combined</option>
          </select>
        </label>
        <label style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Underlying
          <select value={filters.underlying} onChange={event => set('underlying', event.target.value)} style={fieldStyle}>
            <option value="^XSP">Mini-SPX (^XSP)</option>
            <option value="SPY">SPY</option>
          </select>
        </label>
        <label style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Debit-spread placement
          <select value={filters.placement_mode} onChange={event => set('placement_mode', event.target.value)} style={fieldStyle}>
            <option value="atm">At the money</option>
            <option value="slightly_otm">Slightly out of the money</option>
          </select>
        </label>
        {filters.placement_mode === 'slightly_otm' && numberField('Debit spread OTM', 'debit_otm_pct', {
          step: 0.1, min: 0, max: 5, suffix: '%',
          tip: 'Target distance from spot for the debit long on the selected side',
        })}
        {numberField('Maximum risk', 'max_risk_dollars', {
          step: 25, min: 25, suffix: '$', width: 92,
          tip: 'Hard maximum expiration loss for one complete condor',
        })}
        <label title="Target delta for the short option in the credit spread" style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Credit short delta
          <select
            value={Number(filters.credit_short_delta).toFixed(2)}
            onChange={event => set('credit_short_delta', Number(event.target.value))}
            style={fieldStyle}
          >
            {CREDIT_SHORT_DELTAS.map(delta => (
              <option key={delta} value={delta.toFixed(2)}>{Math.round(delta * 100)} delta</option>
            ))}
          </select>
        </label>
        {numberField('Target line credit', 'target_upper_credit_dollars', {
          step: 1, min: 1, suffix: '$', width: 82,
          tip: 'Preferred positive payoff on the untested side of each condor',
        })}
        {numberField('Maximum line credit', 'max_upper_credit_dollars', {
          step: 1, min: 1, suffix: '$', width: 82,
          tip: 'Largest untested-side credit still considered slight',
        })}
        {numberField('Target DTE', 'target_dte', { min: 1, max: 1095 })}
        {numberField('Minimum DTE', 'min_dte', { min: 1, max: 1095 })}
        {numberField('Maximum DTE', 'max_dte', { min: 1, max: 1095 })}
        {numberField('Minimum leg OI', 'min_open_interest', { min: 0, width: 82 })}
        {numberField('Results', 'max_results', { min: 1, max: 12, width: 58 })}
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', padding: '0.35rem 0.5rem', border: '1px solid var(--border)', borderRadius: 4 }}>
          Debit width<br /><strong style={{ color: 'var(--text-strong)' }}>Fixed at 1 point</strong>
        </div>
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Run scan'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p style={{ color: 'var(--text-dim)' }}>
        Pricing nearby expirations and solving the selected condor side or sides against the risk limit…
      </p>}
      {stats && !loading && (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.76rem', marginBottom: '0.55rem' }}>
          Checked <strong>{stats.expirations_checked}</strong> quoted expirations
          {' · '}found <strong>{stats.structures_found}</strong> risk-qualified structures
          {' · '}<strong style={{ color: 'var(--pos)' }}>{stats.actionable}</strong> actionable
          {stats.near_matches ? ` · ${stats.near_matches} review-only` : ''}
          {filters.option_side === 'both' ? ` · ${stats.put_structures || 0} put / ${stats.call_structures || 0} call · ${stats.combined_packages || 0} combined` : ''}
          {asOf ? ` · ${new Date(asOf).toLocaleString()}` : ''}
        </div>
      )}

      {!loading && filters.option_side === 'both' && <CombinedPackages packages={combinedPackages} />}

      {!loading && sortedRows.length > 0 && (
        <div className="sst-wrap">
          <table className="sst">
            <thead><tr>
              <th />
              <th>Underlying</th>
              {heading('Expiration', 'dte')}
              <th>Construction</th>
              <th>Four-option structure</th>
              <th>Widths / gap</th>
              {heading('Line credit', 'credit', { textAlign: 'right' })}
              {heading('Max profit / loss', 'max_loss', { textAlign: 'right' })}
              {heading('Risk used', 'risk_use', { textAlign: 'right' })}
              <th>Risk breakeven / cushion</th>
              {heading('Credit-short touch', 'probability', { textAlign: 'right' })}
              {heading('Liquidity', 'oi', { textAlign: 'right' })}
            </tr></thead>
            <tbody>{sortedRows.map(row => {
              const key = `${row.ticker}-${row.option_side}-${row.expiration}-${row.debit_long_strike}-${row.credit_short_strike}`
              const callSide = row.option_side === 'call'
              return (
                <React.Fragment key={key}>
                  <tr onClick={() => setExpanded(current => current === key ? null : key)} style={{ cursor: 'pointer' }}>
                    <td>{expanded === key ? '▾' : '▸'}</td>
                    <td>
                      <strong>{row.ticker}</strong>
                      <span style={{
                        marginLeft: '0.35rem', padding: '0.08rem 0.3rem', borderRadius: 3,
                        background: callSide
                          ? 'color-mix(in srgb, var(--amber) 15%, var(--surface))'
                          : 'color-mix(in srgb, var(--accent) 15%, var(--surface))',
                        color: callSide ? 'var(--amber)' : 'var(--accent-bright)', fontSize: '0.62rem',
                      }}>{callSide ? 'CALL' : 'PUT'}</span>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.name} · {usd(row.price)}</div>
                      <div style={{ color: row.status === 'actionable' ? 'var(--pos)' : 'var(--amber)', fontSize: '0.64rem' }}>
                        {row.status === 'actionable' ? 'Actionable' : 'Review only'}
                      </div>
                    </td>
                    <td>{row.expiration}<div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.dte} DTE</div></td>
                    <td>
                      {row.construction}
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(row.actual_debit_otm_pct, 2)} actual</div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                        {num(row.target_credit_short_delta * 100, 0)}Δ {callSide ? 'call' : 'put'} short · {num(row.actual_credit_short_delta * 100, 1)}Δ actual
                      </div>
                    </td>
                    <td><Structure row={row} /></td>
                    <td>
                      <strong>{num(row.debit_width)} / {num(row.credit_width)} pts</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{num(row.spread_gap)}-pt body gap</div>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--pos-strong)' }}>
                      <strong>{usd(row.entry_credit_dollars, 2)}</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>natural {signedUsd(row.natural_credit_dollars, 2)}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ color: 'var(--pos)' }}>{usd(row.max_profit_dollars, 0)}</span>
                      {' / '}<span style={{ color: 'var(--neg)' }}>{usd(row.max_loss_dollars, 0)}</span>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(row.return_on_risk_pct)} max ROR</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{pct(row.risk_utilization_pct)}</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>of {usd(row.max_risk_limit_dollars, 0)}</div>
                    </td>
                    <td>
                      <strong>{usd(row.risk_breakeven)}</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(row.risk_breakeven_cushion_pct)} {callSide ? 'above' : 'below'} spot</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{pct(row.prob_touch_credit_short_pct)}</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{pct(row.prob_finish_beyond_credit_short_pct)} finish {callSide ? 'above' : 'below'}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{Number(row.open_interest_min || 0).toLocaleString()} OI</strong>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{usd(row.execution_cost_dollars, 0)} quoted width</div>
                    </td>
                  </tr>
                  {expanded === key && <Detail row={row} colSpan={columnCount} />}
                </React.Fragment>
              )
            })}</tbody>
          </table>
        </div>
      )}

      {!loading && stats && unavailable.map(item => (
        <div key={`${item.ticker}-${item.option_side || 'put'}`} className="alert alert-warning" style={{ marginTop: '0.6rem' }}>
          <strong>{item.ticker} {(item.option_side || 'put').toUpperCase()}</strong>: {item.reason}
          {item.chain_quality && (
            <div style={{ marginTop: '0.25rem', fontSize: '0.75rem' }}>
              Usable options beyond spot: {item.chain_quality.usable_below_spot ?? item.chain_quality.usable_above_spot}
              {' of '}{item.chain_quality.strikes_below_spot ?? item.chain_quality.strikes_above_spot}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
