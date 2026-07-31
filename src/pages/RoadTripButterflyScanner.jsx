import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import OptionProbabilityCards from '../components/OptionProbabilityCards'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerParameterGuide from '../components/ScannerParameterGuide'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'road-trip-butterfly-scanner-filters'
const FALLBACK_DEFAULTS = {
  tickers: 'SPY,QQQ,IWM',
  market_bias: 'neutral',
  target_dte: 77,
  min_dte: 70,
  max_dte: 85,
  tranche_quantity: 5,
  upper_offset_pct: 1.25,
  offset_tolerance_pct: 0.75,
  upper_wing_pct: 2.25,
  lower_wing_pct: 2.75,
  wing_tolerance_pct: 1,
  min_lower_wing_ratio: 1.05,
  max_debit_to_margin_pct: 5,
  min_theta_dollars: 1,
  profit_target_low_pct: 7,
  profit_target_high_pct: 15,
  max_loss_pct: 5,
  exit_days_before_expiration: 17,
  hands_off_days: 25,
  downside_hedge_width_pct: 0.5,
  require_favorable_entry_timing: false,
  min_open_interest: 0,
  open_positions: 0,
  max_concurrent_positions: 5,
  entry_interval_days: 14,
  days_since_last_entry: 14,
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
const pct = (value, digits = 2) => value == null ? '—' : `${Number(value).toFixed(digits)}%`
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
        This screen adapts the road trip trade described by John A. Sarkett in
        <em> Technical Analysis of Stocks &amp; Commodities</em> V.35:02, the
        broken-wing put butterfly Dan Harvey and Tom Nunamaker run on SPX, ES,
        and RUT. Here it is placed on SPY, QQQ, and IWM. One position is a
        same-expiration <strong>1/−2/+1 put butterfly</strong> sized 5/10/5 by
        default, with the highest strike placed <strong>behind the market</strong>
        rather than at it, and a lower wing wider than the upper one.
      </p>
      <p>
        Placement is selected on the article&rsquo;s own geometry, not a delta
        ladder. Its SPX example with the index at 2000 is 1975/1930/1875: the
        upper long 1.25% behind spot, a 45-point upper wing and a 55-point lower
        wing. Those become percentages of spot so the shape travels to any
        underlying. The deltas the structure lands on are reported rather than
        targeted.
      </p>
      <p>
        The governing gate is the article&rsquo;s price rule: the entry debit
        must be under 5% of initial margin, where margin is the broken-wing
        downside risk, (lower wing − upper wing) × 100 × contracts, plus the
        debit. The article&rsquo;s own arithmetic is 487 / 12,732 = 3.8%. A cheap
        entry is what leaves room to lift the T+0 line later; an expensive one
        makes upside profitability hard to reach.
      </p>
      <p>
        Expect that rule to override the illustrative 45/55 widths. A narrow
        broken wing risks little, so its margin base is small and its debit
        ratio is very sensitive. Widening the lower wing raises margin and
        cheapens the lower long at once, so the scanner routinely settles on a
        wider gap than the example while holding the 1.25% placement. The wing
        tolerance controls how far it may go.
      </p>
      <p>
        Because entry is a debit, the unattended flat above the upper long
        starts as a small loss. Once the hands-off period ends, however, the
        strategy calls for successive <em>reverse Harvey</em> rolls until that
        right side is flat or slightly profitable. The probability cards count
        that prescribed managed upside as success and separately disclose the
        lower, unadjusted expiration-tent probability.
      </p>
      <p style={{ marginBottom: 0 }}>
        Management is scheduled rather than discretionary: leave it alone for
        the first 21–30 days and let theta work, seek the close from halfway to
        two-thirds through the trade while the T+0 zone is broad, and retain the
        article&rsquo;s 15–20 DTE date as the exit backstop. Take 7–15% on capital
        at risk and cut the trade if the loss passes 4–5% of utilized capital.
        Entries are staggered every two weeks
        with four or five running at once. Timing preference is a down day with
        volatility up; that is graded from realized volatility, since the price
        feed carries no implied-volatility history.
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

const TIMING_COLOR = {
  favorable: 'var(--pos-strong)',
  acceptable: 'var(--amber)',
  unfavorable: 'var(--neg-strong)',
}

function Detail({ row, colSpan }) {
  const debitGood = row.debit_to_margin_pct != null
    && row.debit_to_margin_pct <= row.max_debit_to_margin_pct
  const deltaGood = row.position_delta_error === 0
  const thetaGood = row.theta_dollars_per_day >= row.min_theta_dollars
  const expirationPoint = row.probability_schedule?.find(point => (
    point.kind === 'expiration' || point.remaining_dte === 0
  ))

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
            primaryPointLabel="Two-thirds close"
            primaryHorizonLabel="at two-thirds close"
            scheduleTitle="Across the preferred close window"
            successHeadline="Positive modeled close or reverse-Harvey-managed upside"
            failureHeadline="Price remains in the complementary downside loss region"
            successFooter="Success includes positive modeled P/L plus the upside above the upper long, where the prescribed reverse Harvey is continued until the right side is at least flat."
            failureFooter="Failure is the exact complement after allowing for that managed upside; it is concentrated below the managed profit zone."
            methodNote={(
              <>
                All three strikes are repriced halfway and two-thirds through
                the trade with their current IVs held constant. The unadjusted
                expiration tent alone has {pct(expirationPoint?.probability_unadjusted_success_pct, 1)} modeled
                success; it is a reference, not the headline horizon, because
                this strategy closes earlier and manages a rally with the
                reverse Harvey.
              </>
            )}
          />

          <Card title="The article's price rule and structure fit">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric
                label="Debit ÷ initial margin"
                value={pct(row.debit_to_margin_pct)}
                detail={`Must stay under ${pct(row.max_debit_to_margin_pct, 1)} · debit ${usd(row.entry_debit_dollars, 0)} on ${usd(row.initial_margin_dollars, 0)}`}
                good={debitGood}
              />
              <Metric
                label="Behind the market"
                value={pct(row.actual_upper_offset_pct)}
                detail={`Upper long below spot · article places it ${pct(row.target_upper_offset_pct)} back`}
                good={row.behind_the_market}
              />
              <Metric
                label="Wing widths"
                value={`${num(row.upper_width, 1)} / ${num(row.lower_width, 1)}`}
                detail={`${pct(row.actual_upper_wing_pct)} / ${pct(row.actual_lower_wing_pct)} of spot · ${num(row.lower_wing_ratio, 2)}× broken`}
                good={row.lower_wing_ratio > 1}
              />
              <Metric
                label={`${row.market_bias} net delta`}
                value={signed(row.position_delta)}
                detail={`Range ${signed(row.bias_delta_min, 0)} to ${signed(row.bias_delta_max, 0)} share equivalents`}
                good={deltaGood}
              />
              <Metric
                label="Theta"
                value={`${signedUsd(row.theta_dollars_per_day, 2)}/day`}
                detail={`Minimum ${signedUsd(row.min_theta_dollars, 2)}/day · this is a decay trade`}
                good={thetaGood}
              />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.65rem' }}>
              Landed deltas {num(row.actual_upper_long_delta * 100, 1)} / −{num(row.actual_body_short_delta * 100, 1)}×2 / {num(row.actual_lower_long_delta * 100, 1)}.
              {' '}These are reported, not targeted: the article specifies placement, not a delta ladder.
              {row.coarse_strike_legs != null && (
                <> {row.coarse_strike_legs} of 3 legs sit on the chain&rsquo;s coarse strike grid, which Harvey prefers for liquidity.</>
              )}
            </div>
          </Card>

          <Card title="Scheduled management: hands off, managed close window, then backstop">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric
                label="Profit target"
                value={`${usd(row.profit_target_low_dollars, 0)} – ${usd(row.profit_target_high_dollars, 0)}`}
                detail={`${pct(row.profit_target_low_pct, 0)}–${pct(row.profit_target_high_pct, 0)} of capital at risk`}
                good
                accent="var(--accent-bright)"
              />
              <Metric
                label="Stop"
                value={`−${usd(row.stop_loss_dollars, 0)}`}
                detail={`${pct(row.max_loss_pct, 0)} of utilized capital · a small planned loss`}
                good
                accent="var(--accent-bright)"
              />
              <Metric
                label="Hands-off until"
                value={row.hands_off_until_date || '—'}
                detail={`First ${row.hands_off_days} days: let theta work`}
                good
                accent="var(--accent-bright)"
              />
              <Metric
                label="Preferred close window"
                value={`${row.close_window_start_date || '—'} – ${row.close_window_end_date || '—'}`}
                detail={`Halfway to two-thirds elapsed · ${row.close_window_start_dte} to ${row.close_window_end_dte} DTE`}
                good
                accent="var(--accent-bright)"
              />
              <Metric
                label="At halfway, unchanged"
                value={signedUsd(row.halfway_close_unchanged_pl_dollars, 0)}
                detail={`${row.close_window_start_dte} DTE remaining · broad T+0 zone`}
                good={row.halfway_close_unchanged_pl_dollars >= 0}
              />
              <Metric
                label="At two-thirds, unchanged"
                value={signedUsd(row.two_thirds_close_unchanged_pl_dollars, 0)}
                detail={`${signed(row.two_thirds_close_unchanged_return_pct, 1)}% of capital at risk`}
                good={row.two_thirds_close_unchanged_pl_dollars >= row.profit_target_low_dollars}
              />
              <Metric
                label="Article exit backstop"
                value={row.planned_exit_date || '—'}
                detail={`${row.planned_exit_dte} DTE remaining · do not confuse with the preferred close window`}
                good
                accent="var(--accent-bright)"
              />
              <Metric
                label="At two-thirds, at the body"
                value={signedUsd(row.two_thirds_close_body_peak_pl_dollars, 0)}
                detail={`Tent peak ${usd(row.body_short_strike)} · expiration peak ${signedUsd(row.center_max_profit_dollars, 0)}`}
                good={row.two_thirds_close_body_peak_pl_dollars >= 0}
              />
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.65rem' }}>
              Tent breakeven {usd(row.lower_breakeven)} up to {usd(row.upper_breakeven)}.
              {' '}Expiration maximum loss {signedUsd(-row.max_loss_dollars, 0)} at or below {usd(row.lower_long_strike)} &mdash;
              {' '}the planned stop is meant to fire long before that.
            </div>
          </Card>

          <Card title="Pre-planned adjustments">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric
                label="Reverse Harvey roll"
                value={row.reverse_harvey_roll_strike ? `${usd(row.upper_long_strike, 0)} → ${usd(row.reverse_harvey_roll_strike, 0)}` : '—'}
                detail={`Sell the upper long, buy the next strike down · ${signedUsd(row.reverse_harvey_credit_dollars, 0)} credit`}
                good={row.reverse_harvey_credit_dollars > 0}
              />
              <Metric
                label="Upper line after the roll"
                value={signedUsd(row.reverse_harvey_upper_flat_dollars, 0)}
                detail={`Now ${signedUsd(row.upper_flat_dollars, 0)} · one step ${row.reverse_harvey_clears_upper_line ? 'clears $0' : 'does not clear $0'}`}
                good={row.reverse_harvey_clears_upper_line}
              />
              <Metric
                label="Downside trigger"
                value={usd(row.downside_hedge_trigger_price)}
                detail="GTC conditional at the body, where the curve turns back down"
                good
                accent="var(--accent-bright)"
              />
              <Metric
                label="Put debit spread"
                value={row.downside_hedge_long_strike ? `${usd(row.downside_hedge_long_strike, 0)} / ${usd(row.downside_hedge_short_strike, 0)}` : '—'}
                detail={`Buy the higher strike, sell below · ${usd(row.downside_hedge_debit_dollars, 0)} per spread`}
                good={row.downside_hedge_debit_dollars > 0}
              />
              <Metric
                label="Close the hedge at"
                value={`${usd(row.downside_hedge_close_low_dollars, 0)} – ${usd(row.downside_hedge_close_high_dollars, 0)}`}
                detail="50–75% of the debit paid, so a whipsaw does not cost it all"
                good
                accent="var(--accent-bright)"
              />
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginBottom: 0 }}>
              Both are priced from the current chain at one step and at a single
              spread. The article sizes adjustments as partials of the main
              position and layers them gradually &mdash; a baby butterfly, a
              10-delta put credit spread, or a condor above the tent are the
              other upside options. Reprice the whole position after any of them.
            </p>
          </Card>

          <Card title="Entry timing and laddering">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '0.65rem' }}>
              <Metric
                label="Session"
                value={row.entry_timing_status || '—'}
                detail={`${signed(row.session_change_pct, 2)}% today · the model prefers a down day`}
                good={row.entry_timing_status === 'favorable'}
                accent={TIMING_COLOR[row.entry_timing_status]}
              />
              <Metric
                label="20-day realized vol"
                value={pct(row.realized_vol_20d_pct, 1)}
                detail={`Above ${num(row.realized_vol_percentile, 0)}% of the past year's readings · the model wants volatility up`}
                good={row.realized_vol_percentile >= 50}
              />
              <Metric
                label="IV ÷ realized"
                value={num(row.iv_vs_realized_ratio, 2)}
                detail="Body IV over 20-day realized; above 1 means options are rich"
                good={row.iv_vs_realized_ratio >= 1}
              />
              <Metric
                label="Ladder"
                value={`${row.open_positions} / ${row.max_concurrent_positions}`}
                detail={`${row.days_since_last_entry} of ${row.entry_interval_days} days since the last entry`}
                good={!row.ladder_flags?.length}
              />
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginBottom: 0 }}>
              Volatility elevation is measured on realized volatility and its own
              one-year percentile. The price feed carries no implied-volatility
              history, so this is not a VIX, VVIX, SKEW, or term-structure read;
              the article&rsquo;s traders watch all four separately.
            </p>
          </Card>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.72rem' }}>
            <div>
              <strong>Entry at {row.uses_last_trade_prices ? 'recent-trade estimate' : 'live mid'}:</strong>{' '}
              {usd(row.entry_debit_dollars, 0)} debit
              <div style={{ color: 'var(--text-dim)' }}>
                Natural market {signedUsd(row.natural_credit_dollars, 0)} · quoted width {usd(row.execution_cost_dollars, 0)}
              </div>
            </div>
            <div>
              <strong>Expiration:</strong> {row.expiration} · {row.dte} DTE
              <div style={{ color: 'var(--text-dim)' }}>
                {row.is_monthly_expiration ? 'Standard monthly' : 'Weekly expiration'}
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
              kind="road-trip-butterfly"
              row={row}
              source="Road Trip Unbalanced Butterfly Scanner"
            />
          </div>
        </div>
      </td>
    </tr>
  )
}

export default function RoadTripButterflyScanner() {
  const pf = useProfileFetch()
  // Version the result cache when the probability schema changes. Otherwise a
  // hot-reloaded frontend can relabel an old expiration-first payload as the
  // new two-thirds close result until the user happens to run another scan.
  const [cachedScan, saveScan] = useScanCache('road-trip-butterfly-v2')
  const [filters, setFilters] = useState(readFilters)
  const [rows, setRows] = useState(cachedScan?.rows || [])
  const [unavailable, setUnavailable] = useState(cachedScan?.unavailable || [])
  const [stats, setStats] = useState(cachedScan?.stats || null)
  const [asOf, setAsOf] = useState(cachedScan?.as_of || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [sortKey, setSortKey] = useState('debit')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const numberField = (label, key, options = {}) => {
    const { step = 1, min, max, suffix = '', width = 78, tip } = options
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
    pf('/api/options/road-trip-butterfly-scan', {
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
      debit: row => row.debit_to_margin_pct,
      placement: row => row.upper_offset_error_pct + row.wing_error_pct,
      delta: row => row.position_delta_error,
      theta: row => row.theta_dollars_per_day,
      exit: row => row.two_thirds_close_unchanged_return_pct,
      risk: row => row.max_loss_dollars,
      oi: row => row.open_interest_min,
    }
    const access = accessors[sortKey] || accessors.debit
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

  const quantity = Math.max(1, Number(filters.tranche_quantity) || 5)
  const scaledBias = value => signed(value * quantity, 0)
  const columnCount = 11

  return (
    <div className="page-container" style={{ maxWidth: 1900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.3rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Road Trip Unbalanced Butterfly Scanner</h1>
        <button className="btn btn-sm btn-outline" onClick={() => setShowHelp(value => !value)} aria-expanded={showHelp}>
          {showHelp ? 'Hide help' : 'How this works'}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Screens the Harvey/Nunamaker road trip trade on SPY, QQQ, and IWM: a 70–85 DTE broken-wing put butterfly placed behind
        the market, gated by the article&rsquo;s debit-under-5%-of-margin rule, with a priced reverse Harvey roll, a pre-planned
        downside hedge, and the scheduled early exit.
      </p>
      <ScannerRiskNotice />
      {showHelp && <HelpPanel />}
      <ScannerParameterGuide scanner="road-trip-butterfly" />

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
          Market bias
          <select value={filters.market_bias} onChange={event => set('market_bias', event.target.value)} style={{ display: 'block', marginTop: '0.2rem', padding: '0.32rem 0.4rem', color: 'var(--text-strong)', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4 }}>
            <option value="bearish">{`Bearish (${scaledBias(-24)} to ${scaledBias(-8)} Δ)`}</option>
            <option value="neutral">{`Neutral (${scaledBias(-8)} to ${scaledBias(8)} Δ)`}</option>
            <option value="bullish">{`Bullish (${scaledBias(8)} to ${scaledBias(24)} Δ)`}</option>
          </select>
        </label>
        {numberField('Target DTE', 'target_dte', { min: 1, max: 1095, tip: 'The article chooses expirations 70 to 85 days out.' })}
        {numberField('Minimum DTE', 'min_dte', { min: 1, max: 1095 })}
        {numberField('Maximum DTE', 'max_dte', { min: 1, max: 1095 })}
        {numberField('Contracts', 'tranche_quantity', { min: 1, max: 100, width: 65, tip: 'Upper-long count. Typical sizes are 5x10x5 and 6x12x6.' })}
        {numberField('Behind market', 'upper_offset_pct', { step: 0.05, min: 0, max: 25, suffix: '%', width: 70, tip: 'How far below spot the upper long sits. The SPX example is 1.25%.' })}
        {numberField('± tolerance', 'offset_tolerance_pct', { step: 0.05, min: 0.05, max: 15, suffix: '%', width: 70 })}
        {numberField('Upper wing', 'upper_wing_pct', { step: 0.05, min: 0.1, max: 30, suffix: '%', width: 70, tip: '45 points on a 2000 index is 2.25% of spot.' })}
        {numberField('Lower wing', 'lower_wing_pct', { step: 0.05, min: 0.1, max: 40, suffix: '%', width: 70, tip: '55 points on a 2000 index is 2.75% of spot.' })}
        {numberField('Wing ± tolerance', 'wing_tolerance_pct', { step: 0.05, min: 0.05, max: 20, suffix: '%', width: 70, tip: 'The 5%-of-margin rule usually forces a wider lower wing than the example.' })}
        {numberField('Min wing ratio', 'min_lower_wing_ratio', { step: 0.05, min: 1.001, max: 10, width: 70 })}
        {numberField('Max debit / margin', 'max_debit_to_margin_pct', { step: 0.25, min: 0.1, max: 100, suffix: '%', width: 70, tip: "The article's governing price rule." })}
        {numberField('Minimum theta', 'min_theta_dollars', { step: 1, min: -5000, max: 5000, suffix: '$/day' })}
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
          Management plan, entry timing, and position ladder
        </div>
        {numberField('Profit target low', 'profit_target_low_pct', { step: 0.5, min: 0.1, max: 200, suffix: '%', width: 70 })}
        {numberField('Profit target high', 'profit_target_high_pct', { step: 0.5, min: 0.1, max: 500, suffix: '%', width: 70 })}
        {numberField('Stop', 'max_loss_pct', { step: 0.5, min: 0.1, max: 100, suffix: '%', width: 70, tip: 'Exit if the loss exceeds this share of utilized capital.' })}
        {numberField('Article exit backstop', 'exit_days_before_expiration', { min: 0, max: 120, suffix: 'd', width: 65, tip: 'The article plans to be out 15 to 20 days before expiration; the modeled close window starts earlier.' })}
        {numberField('Hands-off window', 'hands_off_days', { min: 0, max: 120, suffix: 'd', width: 65, tip: 'Leave it alone for the first 21 to 30 days and let theta work.' })}
        {numberField('Hedge width', 'downside_hedge_width_pct', { step: 0.05, min: 0.05, max: 10, suffix: '%', width: 70, tip: 'Width of the pre-planned put debit spread, as a percentage of spot.' })}
        <label title="The article prefers a down day with volatility up, but says entry timing is not critical." style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: filters.require_favorable_entry_timing ? 'var(--amber)' : 'var(--text-muted)', fontSize: '0.73rem', paddingBottom: '0.35rem' }}>
          <input type="checkbox" checked={filters.require_favorable_entry_timing} onChange={event => set('require_favorable_entry_timing', event.target.checked)} />
          Require preferred entry session
        </label>
        {numberField('Open positions', 'open_positions', { min: 0, width: 65 })}
        {numberField('Max concurrent', 'max_concurrent_positions', { min: 1, width: 65, tip: 'The pair typically has four or five on at a time.' })}
        {numberField('Entry interval', 'entry_interval_days', { min: 0, suffix: 'd', width: 65, tip: 'A new position every two weeks.' })}
        {numberField('Days since last', 'days_since_last_entry', { min: 0, suffix: 'd', width: 65 })}
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Run scan'}
        </button>
      </div>

      <div style={{ color: 'var(--text-dim)', fontSize: '0.69rem', margin: '-0.25rem 0 0.75rem' }}>
        A structure can fit the article&rsquo;s placement and still fail its price rule. When the two conflict the debit limit wins,
        which normally means a wider lower wing than the illustrative 45/55 &mdash; widen the wing tolerance to give the search room.
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && (
        <p style={{ color: 'var(--text-dim)' }}>
          Searching listed expirations 70–85 days out, including weeklies, for debit broken-wing butterflies placed behind the market…
        </p>
      )}
      {stats && !loading && (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.76rem', marginBottom: '0.55rem' }}>
          Scanned <strong>{stats.tickers}</strong> tickers · priced <strong>{stats.expirations_priced}</strong> expirations ·{' '}
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
                <th>1/−2/+1 structure</th>
                {heading('Placement', 'placement')}
                {heading('Debit ÷ margin', 'debit', { textAlign: 'right' })}
                {heading('Net delta', 'delta', { textAlign: 'right' })}
                {heading('Theta', 'theta', { textAlign: 'right' })}
                {heading('At two-thirds close', 'exit', { textAlign: 'right' })}
                <th>Plan</th>
                {heading('Status', 'oi')}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => {
                const key = `${row.ticker}-${row.market_bias}-${row.expiration}-${row.tranche_quantity}`
                const open = expanded === key
                const debitGood = row.debit_to_margin_pct <= row.max_debit_to_margin_pct
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
                        <strong style={{ color: row.behind_the_market ? 'var(--pos)' : 'var(--neg)' }}>
                          {pct(row.actual_upper_offset_pct)} back
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          {num(row.upper_width, 1)} / {num(row.lower_width, 1)} · {num(row.lower_wing_ratio, 2)}×
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: debitGood ? 'var(--pos)' : 'var(--neg)' }}>{pct(row.debit_to_margin_pct)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          {usd(row.entry_debit_dollars, 0)} / {usd(row.initial_margin_dollars, 0)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: row.position_delta_error === 0 ? 'var(--pos)' : 'var(--amber)' }}>{signed(row.position_delta)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.market_bias}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: row.theta_dollars_per_day >= row.min_theta_dollars ? 'var(--pos)' : 'var(--amber)' }}>
                          {signedUsd(row.theta_dollars_per_day, 2)}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>per day</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: row.two_thirds_close_unchanged_pl_dollars >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                          {signedUsd(row.two_thirds_close_unchanged_pl_dollars, 0)}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          {signed(row.two_thirds_close_unchanged_return_pct, 1)}% if unchanged
                        </div>
                      </td>
                      <td style={{ fontSize: '0.68rem', lineHeight: 1.45 }}>
                        <div>Target <strong style={{ color: 'var(--pos)' }}>{usd(row.profit_target_low_dollars, 0)}</strong>–{usd(row.profit_target_high_dollars, 0)}</div>
                        <div>Stop <strong style={{ color: 'var(--neg)' }}>−{usd(row.stop_loss_dollars, 0)}</strong></div>
                        <div style={{ color: 'var(--text-dim)' }}>Close {row.close_window_start_date}–{row.close_window_end_date}</div>
                      </td>
                      <td>
                        <strong style={{ color: row.status === 'actionable' ? 'var(--pos)' : 'var(--amber)' }}>
                          {row.status === 'actionable' ? 'Entry ready' : 'Needs review'}
                        </strong>
                        <div style={{ color: row.structural_status === 'matched' ? 'var(--pos)' : 'var(--amber)', fontSize: '0.66rem' }}>
                          Structure {row.structural_status}
                        </div>
                        <div style={{ color: TIMING_COLOR[row.entry_timing_status], fontSize: '0.66rem' }}>
                          Session {row.entry_timing_status}
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
          No debit broken-wing butterfly matched the requested placement in the 70–85 DTE window.
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
