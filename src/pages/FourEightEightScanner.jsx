import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import OptionProbabilityCards from '../components/OptionProbabilityCards'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerParameterGuide from '../components/ScannerParameterGuide'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'four-eight-eight-scanner-filters'
const BASE_QUANTITY = 4
const FALLBACK_DEFAULTS = {
  tickers: 'SPY,QQQ,IWM',
  market_bias: 'neutral',
  target_dte: 200,
  min_dte: 160,
  max_dte: 230,
  tranche_quantity: 4,
  delta_tolerance: 0.02,
  min_theta_dollars: 10,
  min_t0_minus_20_dollars: -10000,
  uel_tolerance_dollars: 250,
  min_lower_wing_ratio: 1.05,
  min_open_interest: 0,
  price_signal: 'unconfirmed',
  concavity_signal: 'unconfirmed',
  skew_signal: 'unconfirmed',
  warning_signal_count: 0,
  awaiting_all_clear: false,
  campaign_planned_capital_dollars: 150000,
  planned_capital_per_tranche_dollars: 12500,
  open_tranches: 0,
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
const signed = (value, digits = 2) => value == null
  ? '—'
  : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}`
const signedUsd = (value, digits = 0) => value == null
  ? '—'
  : `${Number(value) >= 0 ? '+' : ''}${usd(value, digits)}`

function readFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved?.tickers === '^SPX') saved.tickers = FALLBACK_DEFAULTS.tickers
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
        This screen adapts the March 2021 SPX CC4 setup to liquid index ETFs as a
        same-expiration <strong>4/−8/+8 put tranche</strong>: buy four near
        25-delta puts, sell eight near 15 delta, and buy eight near 2.5 delta.
        The lower longs may shift to put the complete tranche in the STFS bias
        range. It starts with the standard monthly nearest 200 DTE and searches
        the documented 160–230 DTE window.
      </p>
      <p>
        The structural gates follow the document&rsquo;s management trio: tranche
        delta in the chosen bullish, neutral, or bearish range; ATM theta at
        least +$10 per day; and a modeled T+0 mark after a 20% decline no worse
        than −$10,000. The upper expiration line is ranked toward $0. T+0 marks
        hold each leg&rsquo;s current IV constant and are diagnostics, not an
        OptionNet or broker-margin replacement.
      </p>
      <p>
        The structure-price, concavity, and skew monitors use changes from their
        own recent histories. A current option chain cannot reconstruct those
        histories, so their blue/green states are entered explicitly below.
        The screen still shows today&rsquo;s body richness versus a linear wing
        interpolation and today&rsquo;s put-skew slope as transparent cross-sectional
        diagnostics. They do not impersonate the proprietary monitors.
      </p>
      <p>
        Enter the five-indicator warning count from the document&rsquo;s OBV, ATR,
        STFS, Force Index, and term-structure monitor. Four or five warnings stop
        a new tranche. After such an event, keep &ldquo;awaiting all-clear&rdquo; checked
        until the bullish 8/34 EMA crossover appears on the 30-minute chart.
      </p>
      <p>
        The campaign panel applies the presentation&rsquo;s $12,500 planned capital,
        $1,000 target, roughly $800 average expectation, $2,500 management loss,
        and 12-week average holding period. The $20,000 learning reserve and the
        appendix&rsquo;s 120× theta target / 71× theta expected-P/L references are
        shown separately. The presentation ultimately preferred conservatively tiered fixed
        targets, so the theta values are context rather than automatic exits.
      </p>
      <p style={{ marginBottom: 0 }}>
        LPTA guidance is campaign context, not part of the entry order: at four
        warnings, one roughly 30-DTE 2-delta long put per three open tranches;
        at five warnings, two. Coverage is reassessed at 7 DTE. The document&rsquo;s
        PCS/PDS adjustments, roll-down near 2% above the upper long, roll-up
        review near 14% above it, pause conversion, and max-loss exit all require
        active position-level judgment after entry.
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

function Metric({ label, value, detail, good, accent }) {
  const color = accent || (good ? 'var(--pos-strong)' : 'var(--amber)')
  return (
    <div style={{
      flex: '1 1 185px',
      background: 'var(--surface-sunken)',
      borderLeft: `4px solid ${color}`,
      borderRadius: 4,
      padding: '0.65rem 0.75rem',
    }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.63rem', textTransform: 'uppercase' }}>{label}</div>
      <strong style={{ color, fontSize: '1.18rem' }}>{value}</strong>
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

function Detail({ row, colSpan }) {
  const deltaGood = row.position_delta_error === 0
  const thetaGood = row.theta_dollars_per_day >= row.min_theta_dollars
  const t0Good = row.t0_minus_20_dollars >= row.min_t0_minus_20_dollars
  const uelGood = Math.abs(row.upper_flat_dollars) <= row.uel_tolerance_dollars

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
            capture={row.profit_capture}
            successHeadline="Price is above the upper long, inside the modeled tent, or in the recovered crash tail"
            failureHeadline="Price is in the complementary modeled loss region"
            successFooter="The doubled lower hedge adds a second success region below the downside breakeven when the crash tail recovers above $0."
            failureFooter="Failure is the exact complement where the complete 4/−8/+8 tranche has negative modeled P/L."
            methodNote={(
              <>
                All three strikes are repriced at the halfway and two-thirds
                reviews with their current IVs held constant. At expiration,
                intrinsic value forms the upper flat, center tent, lower-strike
                valley, and recovering downside tail.
              </>
            )}
          />

          <Card title="Document entry trio and upper-line fit">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric
                label={`${row.market_bias} tranche delta`}
                value={signed(row.position_delta)}
                detail={`Range ${signed(row.bias_delta_min, 0)} to ${signed(row.bias_delta_max, 0)}`}
                good={deltaGood}
              />
              <Metric
                label="ATM theta"
                value={`${signedUsd(row.theta_dollars_per_day, 0)}/day`}
                detail={`Document minimum ${signedUsd(row.min_theta_dollars, 0)}/day`}
                good={thetaGood}
              />
              <Metric
                label="T+0 after −20%"
                value={signedUsd(row.t0_minus_20_dollars, 0)}
                detail={`Must be no worse than ${signedUsd(row.min_t0_minus_20_dollars, 0)}`}
                good={t0Good}
              />
              <Metric
                label="T+0 after −15%"
                value={signedUsd(row.t0_minus_15_dollars, 0)}
                detail="Buying-power diagnostic emphasized in the document"
                good={row.t0_minus_15_dollars >= row.t0_minus_20_dollars}
              />
              <Metric
                label="Upper expiration line"
                value={signedUsd(row.upper_flat_dollars, 0)}
                detail={`Preferred within ${usd(row.uel_tolerance_dollars, 0)} of $0`}
                good={uelGood}
              />
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginBottom: 0 }}>
              The T+0 values are Black-Scholes scenario marks using each leg&rsquo;s
              current IV. Portfolio margin uses broker scenarios and the complete
              account, so confirm −15% buying power and the document&rsquo;s 2× −20%
              versus net-liquidity rule in the trading platform.
            </p>
          </Card>

          <Card title="Double-hedge expiration geometry and management landmarks">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric label="Upper flat" value={signedUsd(row.upper_flat_dollars, 0)} detail={`Above ${usd(row.upper_long_strike)}`} good={row.upper_flat_dollars >= 0} />
              <Metric label="Body peak" value={signedUsd(row.center_max_profit_dollars, 0)} detail={`At ${usd(row.body_short_strike)}`} good={row.center_max_profit_dollars >= 0} />
              <Metric label="Lower-strike valley" value={signedUsd(row.lower_corner_dollars, 0)} detail={`At ${usd(row.lower_long_strike)} · expiration max-loss area`} good={row.lower_corner_dollars >= 0} />
              <Metric label="Crash tail at $0" value={signedUsd(row.zero_price_tail_dollars, 0)} detail="Doubled lower puts recover below the lower strike" good={row.zero_price_tail_dollars >= 0} />
              <Metric label="Tent breakeven" value={usd(row.lower_breakeven)} detail="Between body and lower long" good accent="var(--accent-bright)" />
              <Metric label="Downside breakeven" value={usd(row.downside_breakeven)} detail="Below this level the crash hedge is profitable again" good accent="var(--accent-bright)" />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.65rem' }}>
              Roll-down review near {usd(row.roll_down_review_price)} (roughly 2% above the upper long).
              {' '}Roll-up review near {usd(row.roll_up_review_price)} (roughly 14% above it), only if the delta/theta/risk trio remains supportable.
            </div>
          </Card>

          <Card title="Entry monitors: confirmed states and current-chain context">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              {[
                ['Structure-price monitor', row.price_signal],
                ['Concavity monitor', row.concavity_signal],
                ['Skew monitor', row.skew_signal],
              ].map(([label, value]) => (
                <Metric
                  key={label}
                  label={label}
                  value={value}
                  detail="Manual blue/green historical-monitor confirmation"
                  good={value === 'favorable'}
                  accent={value === 'unfavorable' ? 'var(--neg-strong)' : undefined}
                />
              ))}
              <Metric
                label="Five-indicator warnings"
                value={`${row.warning_signal_count} / 5`}
                detail={row.warning_signal_count >= 4 ? 'Document says no new tranche' : 'Below the 4-warning entry stop'}
                good={row.warning_signal_count < 4}
              />
              <Metric
                label="30-minute 8/34 all-clear"
                value={row.awaiting_all_clear ? 'Awaiting' : 'Clear / not required'}
                detail="Required after a 4- or 5-warning event"
                good={!row.awaiting_all_clear}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginTop: '0.75rem', fontSize: '0.72rem' }}>
              <div>
                <strong>Current-chain body richness:</strong>{' '}
                {signedUsd(row.body_richness_dollars_per_contract, 0)} per contract
                <div style={{ color: 'var(--text-dim)' }}>Body mid versus linear interpolation between the two long strikes.</div>
              </div>
              <div>
                <strong>Current put skew:</strong> {signed(row.put_skew_iv_points, 2)} IV points
                <div style={{ color: 'var(--text-dim)' }}>{signed(row.put_skew_iv_points_per_10pct, 2)} IV points per 10% strike span.</div>
              </div>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginBottom: 0 }}>
              These two chain measurements describe the current cross-section.
              Favorable/steepening in the document&rsquo;s monitors is a change versus recent
              history, which is why the confirmed states remain separate.
            </p>
          </Card>

          <Card title="Campaign sizing, targets, and LPTA context">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric label="Fixed profit target" value={usd(row.course_profit_target_dollars, 0)} detail={`Average expectation about ${usd(row.course_average_profit_dollars, 0)}`} good />
              <Metric label="Management max loss" value={`−${usd(row.course_max_loss_target_dollars, 0)}`} detail="Exit discipline, not expiration geometry" good />
              <Metric label="Planned capital" value={usd(row.course_planned_capital_dollars, 0)} detail={`Learning suggestion at least ${usd(row.course_learning_capital_dollars, 0)}`} good />
              <Metric label="Average holding period" value={`${row.course_expected_hold_days} days`} detail="About 12 weeks; actual examples ranged widely" good />
              <Metric label="Campaign capacity" value={`${row.open_tranches} / ${row.max_campaign_tranches}`} detail={`${row.campaign_capacity_remaining} tranche slots before this entry`} good={row.campaign_capacity_remaining > 0} />
              <Metric label="LPTA puts indicated" value={row.required_lpta_puts} detail="Roughly 30 DTE / 2 delta; reassess at 7 DTE" good={row.required_lpta_puts === 0} accent={row.required_lpta_puts ? 'var(--amber)' : undefined} />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.65rem' }}>
              Appendix references from current entry theta: 120× target {usd(row.theta_reference_profit_target_dollars, 0)};
              {' '}71× expected realized P/L {usd(row.theta_reference_expected_profit_dollars, 0)}.
              {' '}The document prefers conservative tiered fixed targets over relying on these values alone.
            </div>
          </Card>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.72rem' }}>
            <div>
              <strong>Entry at {row.uses_last_trade_prices ? 'recent-trade estimate' : 'live mid'}:</strong>{' '}
              {row.entry_credit >= 0
                ? `${usd(row.entry_credit_dollars, 0)} credit`
                : `${usd(row.entry_debit_dollars, 0)} debit`}
              <div style={{ color: 'var(--text-dim)' }}>Natural market {signedUsd(row.natural_credit_dollars, 0)} · quoted width {usd(row.execution_cost_dollars, 0)}</div>
              <div style={{ color: 'var(--text-dim)' }}>The document commonly allowed 5–10 cents from the modeled mid; verify the live complex-order quote.</div>
            </div>
            <div>
              <strong>Target deltas:</strong> 25 / −15×2 / 2.5×2
              <div style={{ color: 'var(--text-dim)' }}>
                Actual {num(row.actual_upper_long_delta * 100, 1)} / −{num(row.actual_body_short_delta * 100, 1)}×2 / {num(row.actual_lower_long_delta * 100, 1)}×2
              </div>
            </div>
            <div>
              <strong>Liquidity:</strong> minimum OI {row.open_interest_min}
              <div style={{ color: 'var(--text-dim)' }}>Minimum volume {row.volume_min}</div>
            </div>
          </div>

          {!!row.flags?.length && (
            <div style={{ color: 'var(--amber)', marginTop: '0.75rem', fontSize: '0.72rem' }}>
              {row.flags.join(' · ')}
            </div>
          )}
          <div style={{ marginTop: '0.75rem' }}>
            <RiskGraphButton
              kind="double-hedge-put-butterfly"
              row={row}
              source="Double-Hedge Put Butterfly Scanner"
            />
          </div>
        </div>
      </td>
    </tr>
  )
}

function SignalSelect({ label, value, onChange }) {
  const color = value === 'favorable'
    ? 'var(--pos-strong)'
    : value === 'unfavorable' ? 'var(--neg-strong)' : 'var(--amber)'
  return (
    <label style={{ color: 'var(--text-dim)', fontSize: '0.73rem' }}>
      {label}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        style={{
          display: 'block',
          marginTop: '0.2rem',
          minWidth: 125,
          padding: '0.32rem 0.4rem',
          color,
          fontWeight: 700,
          background: 'var(--surface-inset)',
          border: '1px solid var(--border)',
          borderRadius: 4,
        }}
      >
        <option value="unconfirmed">Unconfirmed</option>
        <option value="favorable">Favorable</option>
        <option value="unfavorable">Unfavorable</option>
      </select>
    </label>
  )
}

export default function DoubleHedgePutButterflyScanner() {
  const pf = useProfileFetch()
  const [cachedScan, saveScan] = useScanCache('four-eight-eight')
  const [filters, setFilters] = useState(readFilters)
  const [rows, setRows] = useState(cachedScan?.rows || [])
  const [unavailable, setUnavailable] = useState(cachedScan?.unavailable || [])
  const [stats, setStats] = useState(cachedScan?.stats || null)
  const [asOf, setAsOf] = useState(cachedScan?.as_of || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [sortKey, setSortKey] = useState('fit')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const numberField = (label, key, options = {}) => {
    const { step = 1, min, max, suffix = '', width = 78, tip, onValueChange } = options
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
            onChange={event => {
              const value = Number(event.target.value)
              if (onValueChange) onValueChange(value)
              else set(key, value)
            }}
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

  const setTrancheQuantity = value => {
    setFilters(current => {
      const previous = Math.max(1, Number(current.tranche_quantity) || BASE_QUANTITY)
      const next = Math.max(1, Number(value) || 1)
      const ratio = next / previous
      const scale = field => Math.round((Number(current[field]) || 0) * ratio * 1000) / 1000
      return {
        ...current,
        tranche_quantity: value,
        min_theta_dollars: scale('min_theta_dollars'),
        min_t0_minus_20_dollars: scale('min_t0_minus_20_dollars'),
        uel_tolerance_dollars: scale('uel_tolerance_dollars'),
        planned_capital_per_tranche_dollars: scale('planned_capital_per_tranche_dollars'),
      }
    })
  }

  const runScan = useCallback(() => {
    setLoading(true)
    setError('')
    setExpanded(null)
    pf('/api/options/double-hedge-put-butterfly-scan', {
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
      ticker: row => row.ticker,
      dte: row => row.dte,
      fit: row => row.position_delta_error,
      theta: row => row.theta_dollars_per_day,
      t0: row => row.t0_minus_20_dollars,
      uel: row => Math.abs(row.upper_flat_dollars),
      loss: row => row.max_loss_dollars,
      oi: row => row.open_interest_min,
    }
    const access = accessors[sortKey] || accessors.fit
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

  const quantityScale = Math.max(1, Number(filters.tranche_quantity) || BASE_QUANTITY) / BASE_QUANTITY
  const scaledBias = value => signed(value * quantityScale, Number.isInteger(value * quantityScale) ? 0 : 1)
  const columnCount = 12

  return (
    <div className="page-container" style={{ maxWidth: 1900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.3rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Double-Hedge Put Butterfly Scanner</h1>
        <button className="btn btn-sm btn-outline" onClick={() => setShowHelp(value => !value)} aria-expanded={showHelp}>
          {showHelp ? 'Hide help' : 'How this works'}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Screens a smaller-scale, long-dated 4/−8/+8 index-ETF put butterfly with a doubled lower hedge, using the March 2021 SPX document&rsquo;s 25/15/2.5 deltas, 200-DTE timing, entry trio, monitor confirmations, and campaign limits.
      </p>
      <ScannerRiskNotice />
      {showHelp && <HelpPanel />}
      <ScannerParameterGuide scanner="double-hedge-put-butterfly" />

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
            placeholder="SPY,QQQ,IWM"
            style={{ display: 'block', width: '100%', marginTop: '0.2rem', padding: '0.32rem 0.4rem', color: 'var(--text-strong)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4 }}
          />
        </label>
        <label style={{ color: 'var(--text-dim)', fontSize: '0.73rem' }}>
          STFS market bias
          <select value={filters.market_bias} onChange={event => set('market_bias', event.target.value)} style={{ display: 'block', marginTop: '0.2rem', padding: '0.32rem 0.4rem', color: 'var(--text-strong)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4 }}>
            <option value="bearish">{`Bearish (${scaledBias(-3)} to ${scaledBias(-1)} Δ)`}</option>
            <option value="neutral">{`Neutral (${scaledBias(-1)} to ${scaledBias(1)} Δ)`}</option>
            <option value="bullish">{`Bullish (${scaledBias(1)} to ${scaledBias(3)} Δ)`}</option>
          </select>
        </label>
        {numberField('Target DTE', 'target_dte', { min: 1, max: 1095 })}
        {numberField('Minimum DTE', 'min_dte', { min: 1, max: 1095 })}
        {numberField('Maximum DTE', 'max_dte', { min: 1, max: 1095 })}
        {numberField('Upper-long qty', 'tranche_quantity', { min: 1, max: 100, width: 65, onValueChange: setTrancheQuantity, tip: 'Scales the complete 1/−2/+2 ratio and all dollar guidance.' })}
        {numberField('Leg Δ tolerance', 'delta_tolerance', { step: 0.0025, min: 0.0025, max: 0.1 })}
        {numberField('Minimum theta', 'min_theta_dollars', { step: 1, min: -5000, max: 5000, suffix: '$/day' })}
        {numberField('Minimum T+0 −20%', 'min_t0_minus_20_dollars', { step: 500, min: -1000000, max: 0, suffix: '$', width: 95 })}
        {numberField('UEL tolerance', 'uel_tolerance_dollars', { step: 25, min: 0, max: 100000, suffix: '$' })}
        {numberField('Min lower-wing ratio', 'min_lower_wing_ratio', { step: 0.05, min: 1.001, max: 10, width: 70 })}
        {numberField('Minimum leg OI', 'min_open_interest', { min: 0, width: 75 })}
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
          Document entry monitors and campaign state
        </div>
        <SignalSelect label="Structure-price monitor" value={filters.price_signal} onChange={value => set('price_signal', value)} />
        <SignalSelect label="Concavity monitor" value={filters.concavity_signal} onChange={value => set('concavity_signal', value)} />
        <SignalSelect label="Skew monitor" value={filters.skew_signal} onChange={value => set('skew_signal', value)} />
        {numberField('Warning signals', 'warning_signal_count', { min: 0, max: 5, width: 55, tip: 'Count from OBV, ATR, STFS, Force Index, and term structure.' })}
        <label title="After a 4/5-warning event, leave this checked until the bullish 8/34 EMA crossover appears on a 30-minute chart." style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: filters.awaiting_all_clear ? 'var(--amber)' : 'var(--text-muted)', fontSize: '0.73rem', paddingBottom: '0.35rem' }}>
          <input type="checkbox" checked={filters.awaiting_all_clear} onChange={event => set('awaiting_all_clear', event.target.checked)} />
          Awaiting 8/34 all-clear
        </label>
        {numberField('Campaign capital', 'campaign_planned_capital_dollars', { min: 0, step: 12500, suffix: '$', width: 100 })}
        {numberField('Capital / tranche', 'planned_capital_per_tranche_dollars', { min: 1, step: 500, suffix: '$', width: 95 })}
        {numberField('Open tranches', 'open_tranches', { min: 0, width: 65 })}
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Run scan'}
        </button>
      </div>

      <div style={{ color: 'var(--text-dim)', fontSize: '0.69rem', margin: '-0.25rem 0 0.75rem' }}>
        A structure can match while entry readiness remains unconfirmed. Mark all three historical monitors favorable only after checking the document&rsquo;s blue/green signals; the scanner will not invent them from one chain snapshot.
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && (
        <p style={{ color: 'var(--text-dim)' }}>
          Starting with the standard monthly nearest 200 DTE, then balancing nearby 25/15/2.5-delta 4/−8/+8 put combinations across the 160–230 DTE window…
        </p>
      )}
      {stats && !loading && (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.76rem', marginBottom: '0.55rem' }}>
          Scanned <strong>{stats.tickers}</strong> tickers · priced <strong>{stats.expirations_priced}</strong> monthly expirations ·{' '}
          <strong style={{ color: 'var(--pos)' }}>{stats.structural_matches}</strong> structural matches ·{' '}
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
                <th>4/−8/+8 structure</th>
                <th>Wing widths</th>
                {heading('Net delta', 'fit', { textAlign: 'right' })}
                {heading('Theta', 'theta', { textAlign: 'right' })}
                {heading('T+0 −20%', 't0', { textAlign: 'right' })}
                {heading('Upper line', 'uel', { textAlign: 'right' })}
                <th>Expiration geometry</th>
                <th>Entry readiness</th>
                {heading('Min OI', 'oi', { textAlign: 'right' })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => {
                const key = `${row.ticker}-${row.market_bias}-${row.expiration}-${row.tranche_quantity}`
                const open = expanded === key
                const monitorColor = row.entry_monitor_status === 'ready'
                  ? 'var(--pos)' : row.entry_monitor_status === 'unfavorable' ? 'var(--neg)' : 'var(--amber)'
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
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.dte} DTE · monthly</div>
                      </td>
                      <td><Structure row={row} /></td>
                      <td>
                        <strong>{num(row.upper_width, 1)} / {num(row.lower_width, 1)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{num(row.lower_wing_ratio, 2)}× lower/upper</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: row.position_delta_error === 0 ? 'var(--pos)' : 'var(--amber)' }}>{signed(row.position_delta)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.market_bias} {signed(row.bias_delta_min, 0)} to {signed(row.bias_delta_max, 0)}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: row.theta_dollars_per_day >= row.min_theta_dollars ? 'var(--pos)' : 'var(--amber)' }}>{signedUsd(row.theta_dollars_per_day, 0)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>minimum {signedUsd(row.min_theta_dollars, 0)}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: row.t0_minus_20_dollars >= row.min_t0_minus_20_dollars ? 'var(--pos)' : 'var(--amber)' }}>{signedUsd(row.t0_minus_20_dollars, 0)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>floor {signedUsd(row.min_t0_minus_20_dollars, 0)}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: Math.abs(row.upper_flat_dollars) <= row.uel_tolerance_dollars ? 'var(--pos)' : 'var(--amber)' }}>{signedUsd(row.upper_flat_dollars, 0)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>target near $0</div>
                      </td>
                      <td style={{ fontSize: '0.68rem', lineHeight: 1.45 }}>
                        <div>Peak <strong style={{ color: 'var(--pos)' }}>{signedUsd(row.center_max_profit_dollars, 0)}</strong></div>
                        <div>Valley <strong style={{ color: row.lower_corner_dollars >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{signedUsd(row.lower_corner_dollars, 0)}</strong></div>
                        <div>Crash tail <strong style={{ color: 'var(--pos)' }}>{signedUsd(row.zero_price_tail_dollars, 0)}</strong></div>
                      </td>
                      <td>
                        <strong style={{ color: monitorColor }}>{row.status === 'actionable' ? 'Entry ready' : 'Needs review'}</strong>
                        <div style={{ color: row.structural_status === 'matched' ? 'var(--pos)' : 'var(--amber)', fontSize: '0.66rem' }}>
                          Structure {row.structural_status}
                        </div>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.warning_signal_count}/5 warnings</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>{row.open_interest_min}</td>
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
          No usable 4/−8/+8 structure was available in the selected standard-monthly window.
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
