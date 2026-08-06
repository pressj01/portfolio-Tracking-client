import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import OptionProbabilityCards from '../components/OptionProbabilityCards'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerParameterGuide from '../components/ScannerParameterGuide'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'sixty-forty-twenty-fly-scanner-filters'
const FALLBACK_DEFAULTS = {
  tickers: 'SPY,QQQ,IWM,VOO',
  target_dte: 70,
  min_dte: 60,
  max_dte: 80,
  quantity: 1,
  delta_tolerance: 0.03,
  max_abs_net_delta: 5,
  delta_theta_caution_pct: 50,
  delta_theta_exit_pct: 60,
  exit_dte: 30,
  min_open_interest: 0,
  max_bid_ask_pct: 35,
}

const usd = (value, digits = 2) => value == null
  ? '—'
  : Number(value).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
const num = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits)
const pct = (value, digits = 1) => value == null ? '—' : `${Number(value).toFixed(digits)}%`
const delta = (value, digits = 1) => value == null ? '—' : `${Number(value * 100).toFixed(digits)}Δ`
const signed = (value, digits = 2) => value == null
  ? '—'
  : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}`
const signedUsd = (value, digits = 0) => value == null
  ? '—'
  : `${Number(value) >= 0 ? '+' : ''}${usd(value, digits)}`

function readFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return { ...FALLBACK_DEFAULTS, ...(saved || {}) }
  } catch {
    return { ...FALLBACK_DEFAULTS }
  }
}

function HelpPanel() {
  return (
    <div style={{
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '0.85rem 1rem',
      marginBottom: '0.8rem',
      color: 'var(--text-muted)',
      fontSize: '0.8rem',
      lineHeight: 1.55,
    }}>
      <p style={{ marginTop: 0 }}>
        The scanner buys one put nearest <strong>60 delta</strong>, sells two puts
        nearest <strong>40 delta</strong>, and buys one put nearest <strong>20 delta</strong>,
        all in the same 60–80 DTE expiration. At the target deltas the complete
        position starts near zero delta: -0.60 + 2(0.40) - 0.20 = 0.
      </p>
      <p>
        SPY, QQQ, IWM, and VOO use exactly the same selection and liquidity gates.
        VOO is not assumed to be interchangeable with SPY: it is marked entry-ready
        only when its own listed chain, open interest, live quotes, and bid/ask widths
        pass the configured limits.
      </p>
      <p style={{ marginBottom: 0 }}>
        Management follows the supplied presentation. Caution begins when the
        original 60- or 40-delta leg changes 20% from entry; a 30% change is an
        exit. Also caution at a 50% absolute delta/theta ratio, exit at 60%, and
        close at 30 DTE regardless. The 8- and 14-day cards are modeled reference
        points, not guaranteed returns.
      </p>
    </div>
  )
}

function Structure({ row }) {
  return (
    <div style={{ fontSize: '0.74rem', lineHeight: 1.45 }}>
      <div><span style={{ color: 'var(--pos)' }}>Buy {row.upper_long_quantity}</span> P {usd(row.upper_long_strike)}</div>
      <div><span style={{ color: 'var(--neg)' }}>Sell {row.body_short_quantity}</span> P {usd(row.body_short_strike)}</div>
      <div><span style={{ color: 'var(--pos)' }}>Buy {row.lower_long_quantity}</span> P {usd(row.lower_long_strike)}</div>
    </div>
  )
}

function Metric({ label, value, detail, good = true, accent }) {
  const color = accent || (good ? 'var(--pos-strong)' : 'var(--amber)')
  return (
    <div style={{
      flex: '1 1 190px',
      background: 'var(--surface-sunken)',
      borderLeft: `4px solid ${color}`,
      borderRadius: 4,
      padding: '0.65rem 0.75rem',
    }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.63rem', textTransform: 'uppercase' }}>{label}</div>
      <strong style={{ color, fontSize: '1.16rem' }}>{value}</strong>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.67rem' }}>{detail}</div>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <section style={{
      background: 'var(--surface-inset)',
      border: '1px solid var(--accent)',
      borderRadius: 7,
      padding: '0.85rem 1rem',
      marginBottom: '0.85rem',
    }}>
      <strong style={{ color: 'var(--accent-bright)', fontSize: '0.9rem' }}>{title}</strong>
      {children}
    </section>
  )
}

function DeltaMonitorRow({ label, monitor }) {
  if (!monitor) return null
  return (
    <tr>
      <td><strong>{label}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>Original entry contract</div></td>
      <td style={{ textAlign: 'right' }}>{delta(monitor.target)}</td>
      <td style={{ textAlign: 'right', color: 'var(--amber)' }}>
        {delta(monitor.caution_low)} to {delta(monitor.caution_high)}
      </td>
      <td style={{ textAlign: 'right', color: 'var(--neg-strong)' }}>
        at/below {delta(monitor.exit_low)} or at/above {delta(monitor.exit_high)}
      </td>
    </tr>
  )
}

function Detail({ row, colSpan }) {
  const review8 = row.probability_schedule?.find(point => point.label === '8-day review')
  const review14 = row.probability_schedule?.find(point => point.label === '14-day review')
  const exitPoint = row.probability_schedule?.find(point => point.label === `${row.mandatory_exit_dte}-DTE exit`)
  const ratioGood = row.delta_theta_ratio_pct != null
    && row.delta_theta_ratio_pct < row.delta_theta_caution_pct
  const spreadGood = row.max_leg_bid_ask_pct != null
    && row.max_leg_bid_ask_pct <= row.max_bid_ask_pct

  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--surface-sunken)', padding: 0, whiteSpace: 'normal' }}>
        <div style={{
          position: 'sticky',
          left: 0,
          maxWidth: 'calc(min(100vw, 1900px) - 4rem)',
          padding: '0.85rem 1rem',
        }}>
          <OptionProbabilityCards
            schedule={row.probability_schedule}
            primaryPointLabel={`${row.mandatory_exit_dte}-DTE exit`}
            primaryHorizonLabel={`at the mandatory ${row.mandatory_exit_dte}-DTE exit`}
            scheduleTitle="At the supplied review dates"
            methodNote={(
              <>
                All three entry contracts are repriced with their current IVs held constant.
                These are risk-neutral estimates before commissions and slippage, not forecasts.
              </>
            )}
          />

          <Card title="Entry fit: 60 / 40 / 20 and near-zero delta">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric
                label="Landed put deltas"
                value={`${delta(row.actual_upper_long_delta)} / ${delta(row.actual_body_short_delta)} / ${delta(row.actual_lower_long_delta)}`}
                detail={`Targets 60Δ / 40Δ / 20Δ · tolerance ${delta(row.delta_tolerance)}`}
                good={Math.max(row.upper_long_delta_error, row.body_short_delta_error, row.lower_long_delta_error) <= row.delta_tolerance}
              />
              <Metric
                label="Complete net delta"
                value={signed(row.position_delta)}
                detail={`Share equivalents · limit ±${num(row.max_abs_net_delta, 1)}`}
                good={Math.abs(row.position_delta) <= row.max_abs_net_delta}
              />
              <Metric
                label="Delta / theta"
                value={pct(row.delta_theta_ratio_pct)}
                detail={`Caution ${pct(row.delta_theta_caution_pct, 0)} · exit ${pct(row.delta_theta_exit_pct, 0)}`}
                good={ratioGood}
              />
              <Metric
                label="Theta"
                value={`${signedUsd(row.theta_dollars_per_day, 2)}/day`}
                detail="The complete fly should begin with positive time decay"
                good={row.theta_dollars_per_day > 0}
              />
              <Metric
                label={`${row.entry_side} at mid`}
                value={usd(row.entry_price_dollars, 0)}
                detail={row.natural_credit_dollars == null ? 'Natural price unavailable' : `Natural net credit ${signedUsd(row.natural_credit_dollars, 0)}`}
                good={!row.uses_last_trade_prices}
              />
              <Metric
                label="Widest leg market"
                value={pct(row.max_leg_bid_ask_pct)}
                detail={`Limit ${pct(row.max_bid_ask_pct)} · minimum leg OI ${row.open_interest_min}`}
                good={spreadGood && row.open_interest_min >= row.min_open_interest}
              />
            </div>
          </Card>

          <Card title="Exit monitor for the original entry contracts">
            <div className="sst-wrap" style={{ marginTop: '0.65rem' }}>
              <table className="sst" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>Leg to monitor</th>
                    <th style={{ textAlign: 'right' }}>Entry</th>
                    <th style={{ textAlign: 'right' }}>20% change: caution</th>
                    <th style={{ textAlign: 'right' }}>30% change: exit</th>
                  </tr>
                </thead>
                <tbody>
                  <DeltaMonitorRow label="Upper long put" monitor={row.upper_delta_monitor} />
                  <DeltaMonitorRow label="Short body put" monitor={row.body_delta_monitor} />
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.75rem' }}>
              <Metric
                label="Time exit"
                value={`${row.mandatory_exit_dte} DTE`}
                detail={`${exitPoint?.exit_date || '—'} · exit regardless of price or P/L`}
                accent="var(--neg-strong)"
              />
              <Metric
                label="Ratio exit"
                value={`>${pct(row.delta_theta_exit_pct, 0)}`}
                detail={`Begin caution above ${pct(row.delta_theta_caution_pct, 0)}`}
                accent="var(--neg-strong)"
              />
              <Metric
                label="After 8 days, unchanged"
                value={signedUsd(review8?.unchanged_spot_pl_dollars, 0)}
                detail={`${review8?.remaining_dte ?? '—'} DTE remaining · modeled reference`}
                good={review8?.unchanged_spot_pl_dollars >= 0}
              />
              <Metric
                label="After 14 days, unchanged"
                value={signedUsd(review14?.unchanged_spot_pl_dollars, 0)}
                detail={`${review14?.remaining_dte ?? '—'} DTE remaining · modeled reference`}
                good={review14?.unchanged_spot_pl_dollars >= 0}
              />
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.68rem', marginBottom: 0 }}>
              {row.monitor_note} The presentation rounds the 30% zones to about
              40–80 delta for the upper leg and 30–50 delta for the body; this
              scanner shows the exact relative thresholds.
            </p>
          </Card>

          <Card title="Expiration geometry and risk">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric label="Upper flat" value={signedUsd(row.upper_flat_dollars, 0)} detail={`Above ${usd(row.upper_long_strike)}`} good={row.upper_flat_dollars >= 0} />
              <Metric label="Tent peak" value={signedUsd(row.center_max_profit_dollars, 0)} detail={`At the ${usd(row.body_short_strike)} body`} good={row.center_max_profit_dollars > 0} />
              <Metric label="Lower flat" value={signedUsd(row.lower_flat_dollars, 0)} detail={`Below ${usd(row.lower_long_strike)}`} good={row.lower_flat_dollars >= 0} />
              <Metric label="Maximum loss" value={usd(row.max_loss_dollars, 0)} detail="Expiration model before commissions" good={false} accent="var(--neg-strong)" />
              <Metric
                label="Breakevens"
                value={`${row.lower_breakeven == null ? '—' : usd(row.lower_breakeven)} / ${row.upper_breakeven == null ? '—' : usd(row.upper_breakeven)}`}
                detail="Lower / upper at expiration"
                accent="var(--accent-bright)"
              />
            </div>
          </Card>

          {!!row.flags?.length && (
            <div className="alert alert-warning" style={{ marginBottom: '0.8rem' }}>
              <strong>Review before entry:</strong>
              <ul style={{ marginBottom: 0 }}>{row.flags.map(flag => <li key={flag}>{flag}</li>)}</ul>
            </div>
          )}

          <RiskGraphButton
            kind="sixty-forty-twenty-fly"
            row={row}
            source="60/40/20 Fly Scanner"
          />
        </div>
      </td>
    </tr>
  )
}

export default function SixtyFortyTwentyFlyScanner() {
  const pf = useProfileFetch()
  const [cachedScan, saveScan] = useScanCache('sixty-forty-twenty-fly-v1')
  const [filters, setFilters] = useState(readFilters)
  const [rows, setRows] = useState(cachedScan?.rows || [])
  const [unavailable, setUnavailable] = useState(cachedScan?.unavailable || [])
  const [stats, setStats] = useState(cachedScan?.stats || null)
  const [asOf, setAsOf] = useState(cachedScan?.as_of || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [sortKey, setSortKey] = useState('status')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const numberField = (label, key, options = {}) => {
    const { step = 1, min, max, suffix = '', width = 76, tip } = options
    return (
      <label title={tip} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-dim)', fontSize: '0.73rem' }}>
        {label}
        <span>
          <input
            type="number"
            step={step}
            min={min}
            max={max}
            value={filters[key]}
            onChange={event => set(key, Number(event.target.value))}
            style={{
              width,
              padding: '0.32rem 0.4rem',
              color: 'var(--text-strong)',
              background: 'var(--surface-inset)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
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
    pf('/api/options/sixty-forty-twenty-fly-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
    })
      .then(async response => {
        let data
        try {
          data = await response.json()
        } catch {
          throw new Error(`Scan request failed (${response.status})`)
        }
        if (!response.ok || data?.error) throw new Error(data?.error || `Scan request failed (${response.status})`)
        return data
      })
      .then(data => {
        const snapshot = {
          rows: data.rows || [],
          unavailable: data.unavailable || [],
          stats: data.stats || null,
          as_of: data.as_of || null,
        }
        setRows(snapshot.rows)
        setUnavailable(snapshot.unavailable)
        setStats(snapshot.stats)
        setAsOf(snapshot.as_of)
        saveScan(snapshot)
      })
      .catch(scanError => setError(scanError.message))
      .finally(() => setLoading(false))
  }, [filters, pf, saveScan])

  const sortedRows = useMemo(() => {
    const accessors = {
      status: row => row.status === 'actionable' ? 0 : 1,
      ticker: row => row.ticker,
      dte: row => row.dte,
      deltas: row => row.upper_long_delta_error + row.body_short_delta_error + row.lower_long_delta_error,
      netDelta: row => Math.abs(row.position_delta),
      ratio: row => row.delta_theta_ratio_pct,
      entry: row => row.entry_price_dollars,
      liquidity: row => row.max_leg_bid_ask_pct,
    }
    const access = accessors[sortKey] || accessors.status
    return [...rows].sort((a, b) => {
      const av = access(a)
      const bv = access(b)
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? (av ?? Infinity) - (bv ?? Infinity) : (bv ?? -Infinity) - (av ?? -Infinity)
    })
  }, [rows, sortAsc, sortKey])

  const sort = key => {
    if (sortKey === key) setSortAsc(value => !value)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }
  const heading = (label, key, style) => (
    <th onClick={() => sort(key)} style={{ cursor: 'pointer', ...style }}>
      {label}{sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  )
  const columnCount = 10

  return (
    <div className="page-container" style={{ maxWidth: 1900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.3rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>60/40/20 Fly Scanner</h1>
        <button className="btn btn-sm btn-outline" onClick={() => setShowHelp(value => !value)} aria-expanded={showHelp}>
          {showHelp ? 'Hide help' : 'How this works'}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Finds 60–80 DTE, delta-neutral 1/−2/+1 put butterflies on SPY, QQQ, IWM, and VOO using
        the 60/40/20 delta ladder, the 20% caution and 30% exit bands, the delta/theta exit rule,
        and a mandatory close at 30 DTE.
      </p>
      <ScannerRiskNotice />
      {showHelp && <HelpPanel />}
      <ScannerParameterGuide scanner="sixty-forty-twenty-fly" />

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.8rem',
        alignItems: 'flex-end',
        padding: '0.85rem',
        marginBottom: '0.7rem',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}>
        <label style={{ flex: '1 1 230px', color: 'var(--text-dim)', fontSize: '0.73rem' }}>
          Tickers
          <input
            value={filters.tickers}
            onChange={event => set('tickers', event.target.value.toUpperCase())}
            placeholder="SPY,QQQ,IWM,VOO"
            style={{ display: 'block', width: '100%', marginTop: '0.2rem', padding: '0.32rem 0.4rem', color: 'var(--text-strong)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4 }}
          />
        </label>
        {numberField('Target DTE', 'target_dte', { min: 1, max: 1095, tip: 'Nearest preferred expiration inside the 60-80 DTE entry window.' })}
        {numberField('Minimum DTE', 'min_dte', { min: 1, max: 1095 })}
        {numberField('Maximum DTE', 'max_dte', { min: 1, max: 1095 })}
        {numberField('Fly quantity', 'quantity', { min: 1, max: 100, width: 66, tip: 'One unit is a 1/-2/+1 put fly.' })}
        {numberField('Leg delta tolerance', 'delta_tolerance', { step: 0.005, min: 0.005, max: 0.2, suffix: 'Δ', width: 72 })}
        {numberField('Max |net delta|', 'max_abs_net_delta', { step: 0.5, min: 0.1, max: 100, width: 72 })}
        {numberField('Minimum leg OI', 'min_open_interest', { min: 0, width: 72 })}
        {numberField('Max bid/ask width', 'max_bid_ask_pct', { step: 1, min: 1, max: 500, suffix: '%', width: 72 })}
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.8rem',
        alignItems: 'flex-end',
        padding: '0.85rem',
        marginBottom: '0.7rem',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}>
        <div style={{ flex: '1 0 100%', color: 'var(--accent-bright)', fontSize: '0.78rem', fontWeight: 700 }}>
          Management thresholds
        </div>
        {numberField('Delta/theta caution', 'delta_theta_caution_pct', { min: 1, max: 500, suffix: '%', width: 72 })}
        {numberField('Delta/theta exit', 'delta_theta_exit_pct', { min: 1, max: 500, suffix: '%', width: 72 })}
        {numberField('Mandatory exit', 'exit_dte', { min: 1, max: 79, suffix: 'DTE', width: 68 })}
        <div style={{ flex: '1 1 380px', color: 'var(--text-dim)', fontSize: '0.7rem', lineHeight: 1.45 }}>
          Fixed leg monitors: 20% change is caution; 30% change is exit. The scanner
          applies these bands to the original entry contracts and never silently swaps strikes.
        </div>
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Run scan'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && (
        <p style={{ color: 'var(--text-dim)' }}>
          Searching every listed 60–80 DTE expiration for the nearest liquid 60/40/20 delta-neutral fly…
        </p>
      )}
      {stats && !loading && (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.76rem', marginBottom: '0.55rem' }}>
          Scanned <strong>{stats.tickers}</strong> tickers · priced <strong>{stats.expirations_priced}</strong> expirations ·{' '}
          <strong style={{ color: 'var(--pos)' }}>{stats.structures_found}</strong> structures ·{' '}
          <strong style={{ color: stats.actionable ? 'var(--pos)' : 'var(--amber)' }}>{stats.actionable}</strong> entry ready
          {stats.near_matches ? ` · ${stats.near_matches} needing review` : ''}
          {asOf ? ` · ${new Date(asOf).toLocaleString()}` : ''}
        </div>
      )}

      {!loading && sortedRows.length > 0 && (
        <div className="sst-wrap">
          <table className="sst">
            <thead>
              <tr>
                <th />
                {heading('Ticker', 'ticker')}
                {heading('Expiration', 'dte')}
                <th>1/−2/+1 structure</th>
                {heading('Landed deltas', 'deltas')}
                {heading('Net delta', 'netDelta', { textAlign: 'right' })}
                {heading('Δ / Θ', 'ratio', { textAlign: 'right' })}
                {heading('Entry', 'entry', { textAlign: 'right' })}
                {heading('Liquidity', 'liquidity', { textAlign: 'right' })}
                {heading('Status', 'status')}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => {
                const key = `${row.ticker}-${row.expiration}-${row.quantity}-${row.upper_long_strike}-${row.body_short_strike}-${row.lower_long_strike}`
                const open = expanded === key
                const ratioGood = row.delta_theta_ratio_pct != null && row.delta_theta_ratio_pct < row.delta_theta_caution_pct
                return (
                  <React.Fragment key={key}>
                    <tr onClick={() => setExpanded(open ? null : key)} style={{ cursor: 'pointer' }}>
                      <td>{open ? '▾' : '▸'}</td>
                      <td>
                        <strong style={{ color: 'var(--accent-bright)' }}>{row.ticker}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{usd(row.price)}</div>
                      </td>
                      <td>
                        <strong>{row.expiration}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          {row.dte} DTE · {row.is_monthly_expiration ? 'monthly' : 'weekly'}
                        </div>
                      </td>
                      <td><Structure row={row} /></td>
                      <td>
                        <strong>{delta(row.actual_upper_long_delta)} / {delta(row.actual_body_short_delta)} / {delta(row.actual_lower_long_delta)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>targets 60 / 40 / 20</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: Math.abs(row.position_delta) <= row.max_abs_net_delta ? 'var(--pos)' : 'var(--amber)' }}>
                          {signed(row.position_delta)}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>share equivalents</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: ratioGood ? 'var(--pos)' : 'var(--amber)' }}>{pct(row.delta_theta_ratio_pct)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{signedUsd(row.theta_dollars_per_day, 2)}/day</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{usd(row.entry_price_dollars, 0)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.entry_side} at mid</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: row.max_leg_bid_ask_pct <= row.max_bid_ask_pct ? 'var(--pos)' : 'var(--amber)' }}>
                          {pct(row.max_leg_bid_ask_pct)}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>widest leg · OI {row.open_interest_min}</div>
                      </td>
                      <td>
                        <strong style={{ color: row.status === 'actionable' ? 'var(--pos)' : 'var(--amber)' }}>
                          {row.status === 'actionable' ? 'Entry ready' : 'Needs review'}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          {row.quote_source === 'live_bid_ask' ? 'Live market' : 'Estimated quotes'}
                        </div>
                      </td>
                    </tr>
                    {open && <Detail row={row} colSpan={columnCount} />}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && stats && !sortedRows.length && !error && (
        <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>
          No ordered 60/40/20 put fly could be built in the 60–80 DTE window.
        </p>
      )}
      {!loading && unavailable.length > 0 && (
        <details style={{ marginTop: '0.8rem', color: 'var(--text-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>Unavailable tickers ({unavailable.length})</summary>
          <ul>{unavailable.map(row => <li key={row.ticker}><strong>{row.ticker}</strong>: {row.reason}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
