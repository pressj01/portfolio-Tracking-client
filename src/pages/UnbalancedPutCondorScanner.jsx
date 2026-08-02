import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerParameterGuide from '../components/ScannerParameterGuide'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'unbalanced-put-condor-scanner-filters'
const FALLBACK_DEFAULTS = {
  tickers: 'SPY,IWM,GLD,QQQ',
  delta_preset: 'all',
  target_dte: 160,
  min_dte: 120,
  max_dte: 240,
  bought_width: 5,
  sold_width: 10,
  bought_quantity: 1,
  sold_quantity: 1,
  delta_tolerance: 0.04,
  target_position_delta: 0,
  position_delta_tolerance: 2,
  width_tolerance_pct: 20,
  min_open_interest: 0,
  require_upside_credit: false,
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
      background: 'var(--surface-sunken)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '0.8rem 1rem', marginBottom: '0.8rem',
      color: 'var(--text-muted)', lineHeight: 1.55, fontSize: '0.82rem',
    }}>
      <p style={{ marginTop: 0 }}>
        This is a four-put, same-expiration position: buy the upper long put, sell the upper
        short put, sell the lower short put, and buy the lower long put. The upper pair is
        the purchased spread; the lower pair is the sold spread.
      </p>
      <p>
        <strong>15/5, 20/10, and 25/15 name the target deltas of the two short puts.</strong>
        {' '}The first number is the short put in the purchased spread. The second is the
        short put in the sold spread, approximately ten delta points farther out of the money.
        The scanner searches neighboring strikes because the delta of the complete package—not
        a single leg—is the governing choice.
      </p>
      <p>
        <strong>Target net delta</strong> is quoted in one-contract share equivalents. Zero
        targets a flat package; +1.5 is slightly bullish; −1.5 is slightly bearish. The
        achieved value nets all four option deltas using their buy/sell signs.
      </p>
      <p>
        Bought and sold widths are independent. A 5/10 or 10/20 point construction has
        unequal downside risk; 5/5 or 10/10 points is also valid. Contract quantities are
        separate again: buying five debit spreads and selling ten credit spreads is a 5:10
        quantity ratio, and every payoff and delta is weighted by those quantities. Both
        tails remain horizontal at expiration, and the result table shows the upper flat
        outcome, center maximum profit, and lower flat outcome separately.
      </p>
      <p>
        <strong>Upside-only adjustment: raise the upper expiration line by selling
        additional credit spreads.</strong> Consider this only after the underlying
        has rallied away from the put structure—up and farther above every put strike.
        The added net credit lifts the payoff above the upper long because all puts
        expire worthless there and the accumulated entry and adjustment credits remain.
        The additional short-put spreads also make the complete position more bullish.
      </p>
      <p style={{ marginBottom: 0 }}>
        This is not free profit. Every additional credit spread increases downside
        exposure, positive delta, short-gamma risk, assignment exposure, and usually
        the lower-tail maximum loss. Never add them while price is falling toward the
        structure. Before adjusting, rebuild the complete payoff and verify the new
        upper line, center peak, lower flat, net delta, theta, maximum loss, buying
        power, liquidity, and probability cards. Use the smallest size that reaches
        the intended upper-line or delta target, and treat a reversal back toward the
        puts as a reason to reduce or close—not to keep adding.
      </p>
    </div>
  )
}

function Outcome({ label, value, emphasize = false }) {
  const positive = Number(value) >= 0
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{
        color: positive ? 'var(--pos-strong)' : 'var(--neg-strong)',
        fontWeight: emphasize ? 800 : 600,
      }}>
        {signed(value, 0)}
      </div>
    </div>
  )
}

function Structure({ row }) {
  const leg = (side, qty, strike, delta) => (
    <span style={{ whiteSpace: 'nowrap' }}>
      <strong style={{ color: side === 'BUY' ? 'var(--accent-bright)' : 'var(--amber)' }}>
        {side}
      </strong>{' '}{qty} × {usd(strike)}P <small style={{ color: 'var(--text-dim)' }}>Δ {num(Math.abs(delta) * 100, 1)}</small>
    </span>
  )
  return (
    <div style={{ display: 'grid', gap: '0.16rem', fontSize: '0.72rem' }}>
      {leg('BUY', row.bought_quantity, row.upper_long_strike, row.upper_long_leg?.delta)}
      {leg('SELL', row.bought_quantity, row.upper_short_strike, row.upper_short_leg?.delta)}
      {leg('SELL', row.sold_quantity, row.lower_short_strike, row.lower_short_leg?.delta)}
      {leg('BUY', row.sold_quantity, row.lower_long_strike, row.lower_long_leg?.delta)}
    </div>
  )
}

function StructureCard({ label, accent, probability, headline, context, schedule, scheduleLabel, footer }) {
  return (
    <div style={{
      flex: '1 1 330px', background: 'var(--surface-inset)', border: `1px solid ${accent}`,
      borderRadius: 7, padding: '0.85rem 1rem',
    }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label} <span style={{ color: accent, fontWeight: 700 }}>· by expiration</span>
      </div>
      <div style={{ color: accent, fontSize: '2rem', lineHeight: 1.05, fontWeight: 850, marginTop: '0.2rem' }}>
        {pct(probability)}
      </div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 700, marginTop: '0.2rem' }}>
        {headline}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
        {context}
      </div>
      {!!schedule?.length && (
        <div style={{
          borderTop: '1px solid var(--border)', marginTop: '0.6rem', paddingTop: '0.5rem',
        }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.63rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
            {scheduleLabel}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
            {schedule.map(step => (
              <div key={step.elapsed_days} style={{ borderLeft: `3px solid ${accent}`, paddingLeft: '0.6rem' }}>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.63rem', textTransform: 'uppercase' }}>
                  By {Math.round(step.elapsed_fraction * 100)}% of DTE
                </div>
                <strong style={{ fontSize: '1.15rem', color: accent }}>{pct(step.value)}</strong>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                  {step.elapsed_days} days held · {step.remaining_dte} DTE remaining
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{
        borderTop: '1px solid var(--border)', marginTop: '0.6rem', paddingTop: '0.5rem',
        color: 'var(--text-muted)', fontSize: '0.72rem',
      }}>
        {footer}
      </div>
    </div>
  )
}

function ReachStructureCards({ row }) {
  const touch = row.prob_touch_upper_long_pct
  if (touch == null) return null
  const finishBelow = row.prob_finish_below_upper_long_pct
  const strike = usd(row.upper_long_strike)
  const flatColor = row.upper_flat_outcome >= 0 ? 'var(--pos-strong)' : 'var(--neg-strong)'
  const schedule = row.upper_long_touch_schedule || []
  const touchBy = schedule.map(step => ({ ...step, value: step.prob_touch_pct }))
  const untouchedBy = schedule.map(step => ({ ...step, value: 100 - step.prob_touch_pct }))
  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <StructureCard
          label="Reach the structure"
          accent="var(--accent-bright)"
          probability={touch}
          headline={`Touch the ${strike} front long at any time through the ${row.expiration} expiration`}
          context={`${pct(row.upper_long_distance_pct)} below spot · ${num(row.upper_long_distance_sigma, 2)}σ away · ${row.dte} DTE`}
          schedule={touchBy}
          scheduleLabel="Touched by the earlier close dates"
          footer={
            <>
              <strong style={{ color: 'var(--accent-bright)' }}>{pct(finishBelow)}</strong>
              {' '}finish below {strike} at expiration
            </>
          }
        />
        <StructureCard
          label="Never touches it"
          accent="var(--amber)"
          probability={100 - touch}
          headline={`Stays above ${strike} for all ${row.dte} days to the ${row.expiration} expiration`}
          context="The four puts expire untested and the position never leaves its upper flat outcome."
          schedule={untouchedBy}
          scheduleLabel="Still untouched at the earlier close dates"
          footer={
            <>
              P/L is then the upper flat outcome{' '}
              <strong style={{ color: flatColor }}>{signedUsd(row.upper_flat_dollars, 0)}</strong>
              {finishBelow == null ? '' : ` · ${pct(100 - finishBelow)} simply finish above ${strike}`}
            </>
          }
        />
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginTop: '0.5rem' }}>
        The front long is the first put this position owns below spot: above it the expiration payoff is flat.
        The two headline figures run the full term to expiration and are complements—one is the chance the trade
        gets tested at all, the other the chance it never is. The smaller figures use the same two planned close
        dates as the profitable-close card above, over the shorter window from today to that date only.
        Finishing above the front long is likelier than never touching it because the terminal figure also counts paths
        that dipped below and recovered. Same first-passage model as the downside card, but priced off the front
        long&rsquo;s own {pct(
          row.upper_long_probability_iv == null ? null : row.upper_long_probability_iv * 100,
          1,
        )} IV rather than the far out-of-the-money back short&rsquo;s, so put skew does not inflate it.
      </div>
    </div>
  )
}

function DownsideRiskCard({ row }) {
  const touch = row.prob_touch_lower_short_pct
  const riskColor = touch == null
    ? 'var(--text-muted)'
    : touch >= 50 ? 'var(--neg-strong)' : touch >= 30 ? 'var(--amber)' : 'var(--pos-strong)'
  const lowerTailIsMaxLoss = row.lower_flat_outcome <= row.upper_flat_outcome
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: '1rem',
      background: 'var(--surface-inset)', border: `1px solid ${riskColor}`,
      borderRadius: 7, padding: '0.85rem 1rem', marginBottom: '0.9rem',
    }}>
      <div style={{ minWidth: 245, flex: '1 1 280px' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Downside test probability
        </div>
        <div style={{ color: riskColor, fontSize: '2rem', lineHeight: 1.05, fontWeight: 850, marginTop: '0.2rem' }}>
          {pct(touch)}
        </div>
        <div style={{ color: 'var(--text-strong)', fontWeight: 700, marginTop: '0.2rem' }}>
          Touch the {usd(row.lower_short_strike)} back short before expiration
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
          {pct(row.lower_short_distance_pct)} below spot · {num(row.lower_short_distance_sigma, 2)}σ away · {row.dte} DTE
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(135px, 1fr))', gap: '0.6rem', flex: '2 1 520px' }}>
        <div style={{ borderLeft: '3px solid var(--amber)', paddingLeft: '0.65rem' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>Finish below back short</div>
          <strong style={{ fontSize: '1.15rem', color: 'var(--amber)' }}>{pct(row.prob_finish_below_lower_short_pct)}</strong>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>Below {usd(row.lower_short_strike)} at expiration</div>
        </div>
        <div style={{ borderLeft: '3px solid var(--accent-bright)', paddingLeft: '0.65rem' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>Reach max-loss area</div>
          <strong style={{ fontSize: '1.15rem', color: 'var(--accent-bright)' }}>{pct(row.prob_touch_lower_long_pct)}</strong>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
            Touch {usd(row.lower_long_strike)} back long before expiration
          </div>
        </div>
        <div style={{ borderLeft: '3px solid var(--neg-strong)', paddingLeft: '0.65rem' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>
            {lowerTailIsMaxLoss ? 'Finish in max-loss region' : 'Finish in lower-tail region'}
          </div>
          <strong style={{ fontSize: '1.15rem', color: 'var(--neg-strong)' }}>{pct(row.prob_finish_below_lower_long_pct)}</strong>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>Below {usd(row.lower_long_strike)} at expiration</div>
        </div>
      </div>
      <div style={{ flex: '1 0 100%', color: 'var(--text-dim)', fontSize: '0.67rem' }}>
        Option-implied, risk-neutral estimate using {pct(
          row.probability_iv == null ? null : row.probability_iv * 100,
          1,
        )} IV and a continuous-price
        first-passage model. It assumes constant volatility and no jumps; it is a risk gauge, not a forecast.
      </div>
    </div>
  )
}

function formatProfitableRanges(ranges) {
  if (!ranges?.length) return 'No modeled profitable price range'
  return ranges.map(priceRange => {
    if (priceRange.lower == null && priceRange.upper == null) return 'All modeled prices'
    if (priceRange.lower == null) return `At or below ${usd(priceRange.upper)}`
    if (priceRange.upper == null) return `At or above ${usd(priceRange.lower)}`
    return `${usd(priceRange.lower)} to ${usd(priceRange.upper)}`
  }).join(' or ')
}

function EarlyCloseWinCard({ row }) {
  const estimates = row.early_close_estimates || []
  if (!estimates.length) return null
  return (
    <div style={{
      background: 'var(--surface-inset)', border: '1px solid var(--accent)',
      borderRadius: 7, padding: '0.85rem 1rem', marginBottom: '0.9rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.55rem', flexWrap: 'wrap', marginBottom: '0.65rem' }}>
        <strong style={{ color: 'var(--accent-bright)', fontSize: '0.92rem' }}>
          Modeled probability of a profitable close
        </strong>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>
          Win = close all four legs together for more than $0 modeled P/L
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))', gap: '0.75rem' }}>
        {estimates.map(estimate => {
          const elapsedPct = Math.round(estimate.elapsed_fraction * 100)
          return (
            <div key={elapsedPct} style={{
              padding: '0.7rem 0.8rem', background: 'var(--surface-sunken)',
              borderLeft: '4px solid var(--pos-strong)', borderRadius: 4,
            }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>
                Close after {elapsedPct}% of original DTE
              </div>
              <strong style={{ display: 'block', color: 'var(--pos-strong)', fontSize: '1.65rem', lineHeight: 1.15 }}>
                {pct(estimate.probability_profit_pct)}
              </strong>
              <div style={{ color: 'var(--text-strong)', fontWeight: 650, marginTop: '0.15rem' }}>
                {estimate.elapsed_days} days held · {estimate.remaining_dte} DTE remaining
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.69rem', marginTop: '0.25rem' }}>
                Profitable modeled {row.ticker} range: {formatProfitableRanges(estimate.profitable_ranges)}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginTop: '0.65rem' }}>
        Entry uses the current mid; all four exit values are theoretical marks with each leg&rsquo;s
        current IV held constant. The risk-neutral estimate excludes commissions and slippage and measures
        P/L only on the planned close date; price may have crossed a strike earlier.
      </div>
    </div>
  )
}

function Detail({ row, colSpan }) {
  return (
    <tr>
      {/* .sst td sets white-space: nowrap for the data columns, which this
          panel inherits: every card headline and footnote became one
          unwrappable line and stretched the table to nearly three screens.
          The sticky wrapper then keeps the panel inside the visible width so
          no card is scrolled off the right edge. */}
      <td colSpan={colSpan} style={{ background: 'var(--surface-sunken)', padding: 0, whiteSpace: 'normal' }}>
        <div style={{
          position: 'sticky', left: 0,
          maxWidth: 'calc(min(100vw, 1900px) - 4rem)',
          padding: '0.8rem 1rem',
        }}>
        <EarlyCloseWinCard row={row} />
        <ReachStructureCards row={row} />
        <DownsideRiskCard row={row} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
              Entry at mid
            </div>
            <div>Bought spread debit ({row.bought_quantity}×): <strong>{usd(row.bought_debit_dollars, 0)}</strong></div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{num(row.bought_debit_per_spread, 2)} points each</div>
            <div>Sold spread credit ({row.sold_quantity}×): <strong>{usd(row.sold_credit_dollars, 0)}</strong></div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{num(row.sold_credit_per_spread, 2)} points each</div>
            <div>Net: <strong style={{ color: row.entry_credit >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
              {row.entry_credit >= 0 ? `${usd(row.entry_credit_dollars, 0)} credit` : `${usd(row.entry_debit_dollars, 0)} debit`}
            </strong></div>
            <div style={{ color: 'var(--text-dim)' }}>Natural market: {signedUsd(row.natural_credit_dollars, 0)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
              Delta fit
            </div>
            <div>Target short deltas: {num(row.target_upper_short_delta * 100, 0)} / {num(row.target_lower_short_delta * 100, 0)}</div>
            <div>Actual short deltas: {num(row.actual_upper_short_delta * 100, 1)} / {num(row.actual_lower_short_delta * 100, 1)}</div>
            <div>Target package: <strong>{signed(row.target_position_delta)}</strong></div>
            <div>Achieved package: <strong>{signed(row.position_delta)}</strong></div>
          </div>
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
              Expiration
            </div>
            <div>Lower breakeven: <strong>{usd(row.lower_breakeven)}</strong></div>
            <div>Upper breakeven: <strong>{row.upper_breakeven == null ? 'none—upper tail profitable' : usd(row.upper_breakeven)}</strong></div>
            <div>Maximum profit: <strong style={{ color: 'var(--pos)' }}>{usd(row.max_profit_dollars, 0)}</strong></div>
            <div>Maximum loss: <strong style={{ color: 'var(--neg)' }}>{usd(row.max_loss_dollars, 0)}</strong></div>
          </div>
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
              Execution
            </div>
            <div>Minimum leg OI: <strong>{row.open_interest_min}</strong></div>
            <div>Minimum leg volume: <strong>{row.volume_min}</strong></div>
            <div>Total quoted width: <strong>{usd(row.execution_cost_dollars, 0)}</strong></div>
          </div>
        </div>
        {row.flags?.length > 0 && (
          <div style={{ color: 'var(--amber)', marginTop: '0.7rem' }}>
            {row.flags.join(' · ')}
          </div>
        )}
        <div style={{ marginTop: '0.75rem' }}>
          <RiskGraphButton
            kind="unbalanced-put-condor"
            row={row}
            source="Unbalanced Put Condor Scanner"
          />
        </div>
        </div>
      </td>
    </tr>
  )
}

export default function UnbalancedPutCondorScanner() {
  const pf = useProfileFetch()
  const [cachedScan, saveScan] = useScanCache('unbalanced-put-condor')
  const [filters, setFilters] = useState(readFilters)
  const [rows, setRows] = useState(cachedScan?.rows || [])
  const [unavailable, setUnavailable] = useState(cachedScan?.unavailable || [])
  const [stats, setStats] = useState(cachedScan?.stats || null)
  const [asOf, setAsOf] = useState(cachedScan?.as_of || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [sortKey, setSortKey] = useState('delta_error')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const numberField = (label, key, options = {}) => {
    const { step = 1, min, max, suffix = '', width = 72, tip } = options
    return (
      <label title={tip} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', color: 'var(--text-dim)', fontSize: '0.74rem' }}>
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
              width, padding: '0.32rem 0.4rem', color: 'var(--text-strong)',
              background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 4,
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
    pf('/api/options/unbalanced-put-condor-scan', {
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
        if (!response.ok || data?.error) {
          throw new Error(data?.error || `Scan request failed (${response.status})`)
        }
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

  // An empty scan has two very different causes.  When the feed reported no
  // live markets to read, say that instead of implying the market has no such
  // trade — the widest-quoted expiration tried is the honest one to cite.
  const staleChain = useMemo(() => {
    const outages = unavailable.filter(row => row.chain_quality)
    if (!outages.length) return null
    return outages.reduce((widest, row) => (
      row.chain_quality.quoted_below_spot < widest.chain_quality.quoted_below_spot
        ? row
        : widest
    ))
  }, [unavailable])

  const sortedRows = useMemo(() => {
    const accessors = {
      ticker: row => row.ticker,
      dte: row => row.dte,
      preset: row => Number(row.preset.split('/')[0]),
      delta_error: row => row.position_delta_error,
      credit: row => row.entry_credit,
      max_profit: row => row.max_profit_dollars,
      max_loss: row => row.max_loss_dollars,
      oi: row => row.open_interest_min,
    }
    const access = accessors[sortKey] || accessors.delta_error
    return [...rows].sort((a, b) => {
      const av = access(a), bv = access(b)
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortAsc ? (av ?? Infinity) - (bv ?? Infinity) : (bv ?? -Infinity) - (av ?? -Infinity)
    })
  }, [rows, sortKey, sortAsc])

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

  const columnCount = 12
  return (
    <div className="page-container" style={{ maxWidth: 1900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.3rem' }}>
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Unbalanced Put Condor Scanner</h1>
        <button className="btn btn-sm btn-outline" onClick={() => setShowHelp(value => !value)}>
          {showHelp ? 'Hide help' : 'How this works'}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Builds long-dated four-put condors from 15/5, 20/10, and 25/15 short-delta
        pairs, then selects the complete structure whose net delta best matches your
        neutral, bullish, or bearish target.
      </p>
      <ScannerRiskNotice />
      {showHelp && <HelpPanel />}
      <ScannerParameterGuide scanner="unbalanced-put-condor" />

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.85rem', alignItems: 'flex-end',
        padding: '0.85rem', marginBottom: '0.7rem', background: 'var(--surface-sunken)',
        border: '1px solid var(--border)', borderRadius: 6,
      }}>
        <label style={{ flex: '1 1 260px', color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Tickers
          <input
            value={filters.tickers}
            onChange={event => set('tickers', event.target.value.toUpperCase())}
            placeholder="SPY,IWM,GLD,QQQ"
            style={{
              display: 'block', width: '100%', marginTop: '0.2rem', padding: '0.32rem 0.4rem',
              color: 'var(--text-strong)', background: 'var(--surface-inset)',
              border: '1px solid var(--border)', borderRadius: 4,
            }}
          />
        </label>
        <label style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Short-delta pair
          <select
            value={filters.delta_preset}
            onChange={event => set('delta_preset', event.target.value)}
            style={{
              display: 'block', marginTop: '0.2rem', padding: '0.32rem 0.4rem',
              color: 'var(--text-strong)', background: 'var(--surface-inset)',
              border: '1px solid var(--border)', borderRadius: 4,
            }}
          >
            <option value="all">All three</option>
            <option value="15/5">15 / 5</option>
            <option value="20/10">20 / 10</option>
            <option value="25/15">25 / 15</option>
          </select>
        </label>
        {numberField('Target DTE', 'target_dte', { min: 1, max: 1095 })}
        {numberField('Minimum DTE', 'min_dte', { min: 1, max: 1095 })}
        {numberField('Maximum DTE', 'max_dte', { min: 1, max: 1095 })}
        {numberField('Bought width', 'bought_width', { step: 0.5, min: 0.5, suffix: 'pts' })}
        {numberField('Sold width', 'sold_width', { step: 0.5, min: 0.5, suffix: 'pts' })}
        {numberField('Bought qty', 'bought_quantity', { min: 1, max: 100, width: 60 })}
        {numberField('Sold qty', 'sold_quantity', { min: 1, max: 100, width: 60 })}
        {numberField('Target net Δ', 'target_position_delta', {
          step: 0.5, min: -100, max: 100, tip: 'One-contract share equivalents: positive is bullish and negative is bearish',
        })}
        {numberField('Net Δ tolerance', 'position_delta_tolerance', { step: 0.5, min: 0.1, suffix: 'Δ' })}
        {numberField('Leg Δ tolerance', 'delta_tolerance', { step: 0.005, min: 0.005, max: 0.2 })}
        {numberField('Width tolerance', 'width_tolerance_pct', { min: 0, max: 100, suffix: '%' })}
        {numberField('Minimum leg OI', 'min_open_interest', { min: 0, width: 80 })}
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          <input
            type="checkbox"
            checked={!!filters.require_upside_credit}
            onChange={event => set('require_upside_credit', event.target.checked)}
          />
          Require upper-tail credit
        </label>
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Run scan'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem', alignSelf: 'center' }}>Quick delta lean:</span>
        {[
          ['Neutral', 0],
          ['Slight bullish', 1.5],
          ['Slight bearish', -1.5],
        ].map(([label, value]) => (
          <button
            key={label}
            className={`btn btn-xs ${Number(filters.target_position_delta) === value ? 'btn-scan' : 'btn-outline'}`}
            aria-pressed={Number(filters.target_position_delta) === value}
            onClick={() => set('target_position_delta', value)}
          >
            {label} ({signed(value, 1)})
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '-0.35rem 0 0.75rem' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem', alignSelf: 'center' }}>Quick quantity ratio:</span>
        {[
          ['1 debit / 1 credit', 1, 1],
          ['5 debit / 10 credit', 5, 10],
        ].map(([label, bought, sold]) => (
          <button
            key={label}
            className={`btn btn-xs ${
              Number(filters.bought_quantity) === bought && Number(filters.sold_quantity) === sold
                ? 'btn-scan'
                : 'btn-outline'
            }`}
            aria-pressed={
              Number(filters.bought_quantity) === bought && Number(filters.sold_quantity) === sold
            }
            onClick={() => setFilters(current => ({
              ...current,
              bought_quantity: bought,
              sold_quantity: sold,
            }))}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <p style={{ color: 'var(--text-dim)' }}>
        Loading the nearest long-dated expiration and evaluating nearby strikes for the best four-leg delta fit…
      </p>}
      {stats && !loading && (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.76rem', marginBottom: '0.55rem' }}>
          Scanned <strong>{stats.tickers}</strong> tickers · priced <strong>{stats.expirations_priced}</strong> expirations
          {' · '}<strong style={{ color: 'var(--pos)' }}>{stats.actionable}</strong> matched
          {stats.near_matches ? ` · ${stats.near_matches} near matches` : ''}
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
                {heading('Preset', 'preset')}
                {heading('Expiration', 'dte')}
                <th>Four-put structure</th>
                <th>Widths / Qty</th>
                {heading('Net delta', 'delta_error', { textAlign: 'right' })}
                {heading('Entry', 'credit', { textAlign: 'right' })}
                <th>Expiration outcomes</th>
                <th>Breakevens</th>
                {heading('Max P/L', 'max_profit', { textAlign: 'right' })}
                {heading('Min OI', 'oi', { textAlign: 'right' })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => {
                const key = `${row.ticker}-${row.preset}-${row.bought_width}-${row.sold_width}-${row.bought_quantity}-${row.sold_quantity}`
                const open = expanded === key
                return (
                  <React.Fragment key={key}>
                    <tr onClick={() => setExpanded(open ? null : key)} style={{ cursor: 'pointer' }}>
                      <td>{open ? '▾' : '▸'}</td>
                      <td>
                        <strong style={{ color: 'var(--accent-bright)' }}>{row.ticker}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{usd(row.price)}</div>
                      </td>
                      <td>
                        <strong>{row.preset}</strong>
                        <div style={{ color: row.status === 'actionable' ? 'var(--pos)' : 'var(--amber)', fontSize: '0.66rem' }}>
                          {row.status === 'actionable' ? 'matched' : 'near match'}
                        </div>
                      </td>
                      <td>
                        <strong>{row.expiration}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.dte} DTE</div>
                      </td>
                      <td><Structure row={row} /></td>
                      <td>
                        <strong>{num(row.bought_width, 1)} / {num(row.sold_width, 1)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          pts · qty {row.bought_quantity} / {row.sold_quantity}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{
                          color: Math.abs(row.position_delta_error) <= filters.position_delta_tolerance
                            ? 'var(--pos)' : 'var(--amber)',
                        }}>{signed(row.position_delta)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          target {signed(row.target_position_delta)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: row.entry_credit >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                          {row.entry_credit >= 0 ? `${usd(row.entry_credit_dollars, 0)} cr` : `${usd(row.entry_debit_dollars, 0)} db`}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          natural {signedUsd(row.natural_credit_dollars, 0)}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <Outcome label="Upper flat" value={row.upper_flat_dollars} />
                          <Outcome label="Center max" value={row.max_profit_dollars} emphasize />
                          <Outcome label="Lower flat" value={row.lower_flat_dollars} />
                        </div>
                      </td>
                      <td>
                        <div>Lower {usd(row.lower_breakeven)}</div>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          Upper {row.upper_breakeven == null ? 'none' : usd(row.upper_breakeven)}
                        </div>
                        <div style={{ color: 'var(--amber)', fontSize: '0.66rem', fontWeight: 700 }}>
                          Touch back short {pct(row.prob_touch_lower_short_pct)}
                        </div>
                        {!!row.early_close_estimates?.length && (
                          <div style={{ color: 'var(--pos-strong)', fontSize: '0.66rem', fontWeight: 700 }}>
                            Close win {row.early_close_estimates.map(estimate => (
                              `${Math.round(estimate.elapsed_fraction * 100)}%: ${pct(estimate.probability_profit_pct)}`
                            )).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{ color: 'var(--pos)' }}>{usd(row.max_profit_dollars, 0)}</strong>
                        <div style={{ color: 'var(--neg)', fontSize: '0.7rem' }}>−{usd(row.max_loss_dollars, 0)}</div>
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
        staleChain ? (
          <div className="alert alert-warning" style={{ marginTop: '1.2rem' }}>
            <strong>No live option quotes to scan.</strong>
            <div style={{ marginTop: '0.35rem' }}>
              The chain snapshot has two-sided markets on only{' '}
              <strong>{staleChain.chain_quality.quoted_below_spot}</strong> of{' '}
              <strong>{staleChain.chain_quality.strikes_below_spot}</strong> put strikes
              below spot, so no four-leg structure can be priced. Quotes are normally
              zeroed outside regular trading hours — rerun while the market is open.
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>
            No four-put structures were available in the selected DTE window.
          </p>
        )
      )}

      {!loading && unavailable.length > 0 && (
        <details style={{ marginTop: '0.8rem', color: 'var(--text-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>Unavailable tickers ({unavailable.length})</summary>
          <ul>
            {unavailable.map(row => (
              <li key={row.ticker}><strong>{row.ticker}</strong>: {row.reason}</li>
            ))}
          </ul>
        </details>
      )}

    </div>
  )
}
