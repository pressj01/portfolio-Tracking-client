import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import OptionProbabilityCards from '../components/OptionProbabilityCards'
import RiskGraphButton from '../components/RiskGraphButton'
import ScannerParameterGuide from '../components/ScannerParameterGuide'
import ScannerRiskNotice from '../components/ScannerRiskNotice'
import { useScanCache } from '../utils/useScanCache'

const STORAGE_KEY = 'unbalanced-butterfly-scanner-filters'
const COURSE_BASE_LONG_QUANTITY = 4
const FALLBACK_DEFAULTS = {
  tickers: 'SPY,QQQ,IWM',
  upper_long_delta: 'both',
  market_bias: 'neutral',
  target_dte: 160,
  min_dte: 120,
  max_dte: 240,
  tranche_quantity: 4,
  delta_tolerance: 0.035,
  target_theta_dollars: 20,
  theta_tolerance_dollars: 15,
  uel_tolerance_dollars: 250,
  min_lower_wing_ratio: 1.05,
  min_open_interest: 0,
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
const formatDate = value => {
  if (!value) return '—'
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function readFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (
      saved?.target_dte === 200
      && saved?.min_dte === 170
      && saved?.max_dte === 230
    ) {
      saved.target_dte = FALLBACK_DEFAULTS.target_dte
      saved.min_dte = FALLBACK_DEFAULTS.min_dte
      saved.max_dte = FALLBACK_DEFAULTS.max_dte
    }
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
      padding: '0.8rem 1rem',
      marginBottom: '0.8rem',
      color: 'var(--text-muted)',
      lineHeight: 1.55,
      fontSize: '0.82rem',
    }}>
      <p style={{ marginTop: 0 }}>
        This scanner implements the course&rsquo;s STT broken-wing butterfly as one
        4/−8/4 put tranche, starting with the standard monthly expiration
        nearest 160 DTE and then checking the rest of the selected 120–240 DTE
        window when that chain cannot form the structure.
        It buys the upper long, sells twice as many body puts, and buys the lower
        long with a wider downside wing.
      </p>
      <p>
        <strong>Upper-long delta can be 20 or 25.</strong> The body stays near 15
        delta. A 25-delta upper long begins with a lower long near 5 delta; a
        20-delta upper long begins nearer 10 delta. The scanner searches adjacent
        lower strikes because the complete tranche must land in the selected
        bearish, neutral, or bullish delta range.
      </p>
      <p>
        Changing the long quantity scales the full 1/−2/1 ratio. For example,
        doubling 4/−8/4 produces 8/−16/8. Per-leg delta targets stay the same,
        while total debit or credit, payoff, theta, whole-position delta range,
        course profit and loss guidance, and planned capital scale with size.
      </p>
      <p>
        Candidate ranking follows the documented priorities: fit the tranche
        delta, keep the upper expiration line near $0, and bring daily theta near
        +$20. Success includes price staying above the upper long. Inside the
        structure, the theoretical P/L tent determines success and grows as time
        passes. The expanded cards show that success and its exact failure
        complement at the same halfway, two-thirds, and expiration checkpoints
        used by the Unbalanced Put Condor.
      </p>
      <p>
        The entry Greeks are managed similarly to the Unbalanced Put Condor:
        keep delta near the selected directional range while positive theta
        builds the profit tent through time. The time-evolution card reprices
        all three strikes at each checkpoint instead of treating today&rsquo;s
        expiration payoff as the trade&rsquo;s path.
      </p>
      <p>
        The $1,000 profit target and $2,000 loss limit are management targets,
        not the mathematical maximum profit and loss at expiration. This screen
        proposes one income tranche; it does not add the separate campaign hedges
        described in the course.
      </p>
      <p>
        <strong>Upside-only adjustment: raise the upper expiration line by
        narrowing the front wing.</strong> Consider this only after the underlying
        has rallied away from the butterfly—up and farther above the upper long.
        Narrowing the distance between the upper long and the double-short body
        through a net-credit roll adds cash to the position. That added credit
        raises the payoff above the upper long, where the puts otherwise expire
        worthless, and the narrower front wing makes the complete trade more bullish.
      </p>
      <p style={{ marginBottom: 0 }}>
        The adjustment is not free profit and it is not a defense for a falling
        market. Depending on which front leg is rolled, it can lower or relocate
        the tent peak, change the downside flat, reduce protection, and add bullish
        delta, short gamma, slippage, and assignment risk. Never narrow the front
        wing while price is moving down toward the butterfly. Reprice the complete
        adjusted structure and verify the upper line, tent peak, lower flat,
        breakeven, delta, theta, maximum loss, liquidity, and probability cards.
        Use the smallest net-credit roll that reaches the intended upper-line or
        delta target; if price reverses toward the puts, reduce or close rather
        than repeatedly narrowing.
      </p>
    </div>
  )
}

function Structure({ row }) {
  return (
    <div style={{ fontSize: '0.75rem', lineHeight: 1.45 }}>
      <div>
        <span style={{ color: 'var(--pos)' }}>Buy {row.upper_long_quantity}</span>
        {' '}P {usd(row.upper_long_strike)}
      </div>
      <div>
        <span style={{ color: 'var(--neg)' }}>Sell {row.body_short_quantity}</span>
        {' '}P {usd(row.body_short_strike)}
      </div>
      <div>
        <span style={{ color: 'var(--pos)' }}>Buy {row.lower_long_quantity}</span>
        {' '}P {usd(row.lower_long_strike)}
      </div>
    </div>
  )
}

function Outcome({ label, value, emphasize = false }) {
  const color = value >= 0 ? 'var(--pos)' : 'var(--neg)'
  return (
    <div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.62rem', textTransform: 'uppercase' }}>
        {label}
      </div>
      <strong style={{ color, fontSize: emphasize ? '0.9rem' : '0.78rem' }}>
        {signedUsd(value, 0)}
      </strong>
    </div>
  )
}

function StructureCard({
  label,
  accent,
  probability,
  headline,
  context,
  schedule,
  scheduleLabel,
  footer,
}) {
  return (
    <div style={{
      flex: '1 1 330px',
      background: 'var(--surface-inset)',
      border: `1px solid ${accent}`,
      borderRadius: 7,
      padding: '0.85rem 1rem',
    }}>
      <div style={{
        color: 'var(--text-dim)',
        fontSize: '0.66rem',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        {label} <span style={{ color: accent, fontWeight: 700 }}>· by expiration</span>
      </div>
      <div style={{
        color: accent,
        fontSize: '2rem',
        lineHeight: 1.05,
        fontWeight: 850,
        marginTop: '0.2rem',
      }}>
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
          borderTop: '1px solid var(--border)',
          marginTop: '0.6rem',
          paddingTop: '0.5rem',
        }}>
          <div style={{
            color: 'var(--text-dim)',
            fontSize: '0.63rem',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: '0.35rem',
          }}>
            {scheduleLabel}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.6rem',
          }}>
            {schedule.map(step => (
              <div key={`${step.label}-${step.elapsed_days}`} style={{ borderLeft: `3px solid ${accent}`, paddingLeft: '0.6rem' }}>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.63rem', textTransform: 'uppercase' }}>
                  {step.label || `By ${Math.round(step.elapsed_fraction * 100)}% of DTE`}
                </div>
                <strong style={{ fontSize: '1.15rem', color: accent }}>{pct(step.value)}</strong>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                  {step.elapsed_days} days held · {step.remaining_dte} DTE
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{
        borderTop: '1px solid var(--border)',
        marginTop: '0.6rem',
        paddingTop: '0.5rem',
        color: 'var(--text-muted)',
        fontSize: '0.72rem',
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
          headline={`Touch the ${strike} upper long before expiration`}
          context={`${pct(row.upper_long_distance_pct)} below spot · ${num(row.upper_long_distance_sigma, 2)}σ away · ${row.dte} DTE`}
          schedule={touchBy}
          scheduleLabel="Touched by the earlier close dates"
          footer={(
            <>
              <strong style={{ color: 'var(--accent-bright)' }}>{pct(finishBelow)}</strong>
              {' '}finish below {strike} at expiration
            </>
          )}
        />
        <StructureCard
          label="Never touches it"
          accent="var(--amber)"
          probability={100 - touch}
          headline={`Stay above ${strike} for the full trade`}
          context="The three-strike structure remains untested and stays on its upper expiration line."
          schedule={untouchedBy}
          scheduleLabel="Still untouched at the earlier close dates"
          footer={(
            <>
              Upper expiration-line outcome:{' '}
              <strong style={{ color: flatColor }}>{signedUsd(row.upper_flat_dollars, 0)}</strong>
              {finishBelow == null ? '' : ` · ${pct(100 - finishBelow)} finish above ${strike}`}
            </>
          )}
        />
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginTop: '0.5rem' }}>
        These are first-passage estimates. Finishing above the upper long is more
        likely than never touching it because a path can dip below the strike and
        recover. The model uses the upper long&rsquo;s own implied volatility.
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
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'stretch',
      gap: '1rem',
      background: 'var(--surface-inset)',
      border: `1px solid ${riskColor}`,
      borderRadius: 7,
      padding: '0.85rem 1rem',
      marginBottom: '0.9rem',
    }}>
      <div style={{ minWidth: 245, flex: '1 1 280px' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Body-test probability
        </div>
        <div style={{ color: riskColor, fontSize: '2rem', lineHeight: 1.05, fontWeight: 850, marginTop: '0.2rem' }}>
          {pct(touch)}
        </div>
        <div style={{ color: 'var(--text-strong)', fontWeight: 700, marginTop: '0.2rem' }}>
          Touch the {usd(row.body_short_strike)} double-short body
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
          {pct(row.lower_short_distance_pct)} below spot · {num(row.lower_short_distance_sigma, 2)}σ away · {row.dte} DTE
        </div>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(135px, 1fr))',
        gap: '0.6rem',
        flex: '2 1 520px',
      }}>
        <div style={{ borderLeft: '3px solid var(--amber)', paddingLeft: '0.65rem' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>
            Finish below body
          </div>
          <strong style={{ fontSize: '1.15rem', color: 'var(--amber)' }}>
            {pct(row.prob_finish_below_lower_short_pct)}
          </strong>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
            Below {usd(row.body_short_strike)} at expiration
          </div>
        </div>
        <div style={{ borderLeft: '3px solid var(--accent-bright)', paddingLeft: '0.65rem' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>
            Reach lower tail
          </div>
          <strong style={{ fontSize: '1.15rem', color: 'var(--accent-bright)' }}>
            {pct(row.prob_touch_lower_long_pct)}
          </strong>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
            Touch {usd(row.lower_long_strike)} lower long
          </div>
        </div>
        <div style={{ borderLeft: '3px solid var(--neg-strong)', paddingLeft: '0.65rem' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>
            {lowerTailIsMaxLoss ? 'Finish in max-loss tail' : 'Finish in lower tail'}
          </div>
          <strong style={{ fontSize: '1.15rem', color: 'var(--neg-strong)' }}>
            {pct(row.prob_finish_below_lower_long_pct)}
          </strong>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
            Below {usd(row.lower_long_strike)} at expiration
          </div>
        </div>
      </div>
      <div style={{ flex: '1 0 100%', color: 'var(--text-dim)', fontSize: '0.67rem' }}>
        Option-implied, risk-neutral estimate using {pct(
          row.probability_iv == null ? null : row.probability_iv * 100,
          1,
        )} IV and a continuous-price first-passage model. Constant volatility and
        no jumps are assumed; this is a risk gauge, not a forecast.
      </div>
    </div>
  )
}

function CourseTargetsCard({ row }) {
  const deltaInRange = row.position_delta >= row.bias_delta_min && row.position_delta <= row.bias_delta_max
  const uelInRange = Math.abs(row.upper_flat_dollars) <= row.uel_tolerance_dollars
  const thetaInRange = Math.abs(
    row.theta_dollars_per_day - row.target_theta_dollars,
  ) <= row.theta_tolerance_dollars
  const metric = (label, value, detail, good) => (
    <div style={{
      flex: '1 1 190px',
      background: 'var(--surface-sunken)',
      borderLeft: `4px solid ${good ? 'var(--pos-strong)' : 'var(--amber)'}`,
      borderRadius: 4,
      padding: '0.65rem 0.75rem',
    }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.64rem', textTransform: 'uppercase' }}>{label}</div>
      <strong style={{ color: good ? 'var(--pos-strong)' : 'var(--amber)', fontSize: '1.25rem' }}>{value}</strong>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{detail}</div>
    </div>
  )
  return (
    <div style={{
      background: 'var(--surface-inset)',
      border: '1px solid var(--accent)',
      borderRadius: 7,
      padding: '0.85rem 1rem',
      marginBottom: '0.9rem',
    }}>
      <strong style={{ color: 'var(--accent-bright)', fontSize: '0.92rem' }}>
        Course entry and management targets
      </strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.7rem', marginTop: '0.65rem' }}>
        {metric(
          `${row.market_bias} tranche delta`,
          signed(row.position_delta),
          `Course range ${signed(row.bias_delta_min, 0)} to ${signed(row.bias_delta_max, 0)}`,
          deltaInRange,
        )}
        {metric(
          'Upper expiration line',
          signedUsd(row.upper_flat_dollars, 0),
          `Preferred within ${usd(row.uel_tolerance_dollars, 0)} of $0`,
          uelInRange,
        )}
        {metric(
          'Daily theta',
          signedUsd(row.theta_dollars_per_day, 0),
          `Preferred near ${signedUsd(row.target_theta_dollars, 0)} per day`,
          thetaInRange,
        )}
        {metric(
          'Profit target',
          usd(row.course_profit_target_dollars, 0),
          `Course expectation is about ${row.course_expected_hold_days} days`,
          true,
        )}
        {metric(
          'Management loss limit',
          `−${usd(row.course_max_loss_target_dollars, 0)}`,
          `Separate from ${usd(row.max_loss_dollars, 0)} expiration max loss`,
          row.max_loss_dollars <= row.course_max_loss_target_dollars,
        )}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginTop: '0.6rem' }}>
        Suggested planned capital: {usd(row.course_planned_capital_low_dollars, 0)}
        {' '}to {usd(row.course_planned_capital_high_dollars, 0)} per tranche.
        {row.course_quantity_scale === 1
          ? ''
          : ` Scaled ${num(row.course_quantity_scale, 2)}× from the default 4/−8/4 tranche.`}
        {' '}Management targets require active monitoring and do not cap gap or
        execution risk.
      </div>
    </div>
  )
}

function formatSuccessRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return '—'
  return ranges.map(({ lower, upper }) => {
    if (lower == null && upper == null) return 'All prices'
    if (lower == null) return `At or below ${usd(upper)}`
    if (upper == null) return `At or above ${usd(lower)}`
    return `${usd(lower)} to ${usd(upper)}`
  }).join(' · ')
}

function TimeEvolutionCard({ row }) {
  const points = Array.isArray(row.probability_schedule)
    ? row.probability_schedule
    : []
  if (!points.length) return null

  return (
    <div style={{
      background: 'var(--surface-inset)',
      border: '1px solid var(--accent)',
      borderRadius: 7,
      padding: '0.85rem 1rem',
      marginBottom: '0.9rem',
    }}>
      <strong style={{ color: 'var(--accent-bright)', fontSize: '0.92rem' }}>
        How the profit tent builds through time
      </strong>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.25rem' }}>
        Each checkpoint reprices the complete {row.upper_long_quantity}/−{row.body_short_quantity}/
        {row.lower_long_quantity} tranche with its remaining time. Above the
        upper long remains a successful, untested outcome; inside the structure,
        success follows the growing $0-or-better modeled tent.
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))',
        gap: '0.75rem',
        marginTop: '0.7rem',
      }}>
        {points.map((point, index) => (
          <div
            key={`${point.kind}-${point.remaining_dte}`}
            style={{
              background: 'var(--surface-sunken)',
              borderLeft: `4px solid ${index === points.length - 1 ? 'var(--accent-bright)' : 'var(--pos-strong)'}`,
              borderRadius: 5,
              padding: '0.7rem 0.8rem',
            }}
          >
            <div style={{
              color: 'var(--text-dim)',
              fontSize: '0.64rem',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              {point.label} · {formatDate(point.exit_date)} · {point.remaining_dte} DTE
            </div>
            <div style={{ display: 'flex', gap: '1rem', margin: '0.35rem 0 0.55rem' }}>
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.62rem' }}>Success</div>
                <strong style={{ color: 'var(--pos-strong)', fontSize: '1.2rem' }}>
                  {pct(point.probability_success_pct)}
                </strong>
              </div>
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.62rem' }}>Failure</div>
                <strong style={{ color: 'var(--neg-strong)', fontSize: '1.2rem' }}>
                  {pct(point.probability_failure_pct)}
                </strong>
              </div>
            </div>
            <div style={{ fontSize: '0.7rem', lineHeight: 1.55 }}>
              <div>
                If price is unchanged: <strong>{signedUsd(point.unchanged_spot_pl_dollars, 0)}</strong>
              </div>
              <div>
                At upper long {usd(row.upper_long_strike)}:{' '}
                <strong>{signedUsd(point.upper_long_pl_dollars, 0)}</strong>
              </div>
              <div>
                At body / tent peak {usd(row.body_short_strike)}:{' '}
                <strong>{signedUsd(point.body_peak_pl_dollars, 0)}</strong>
              </div>
              <div style={{ color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                Successful price region: {formatSuccessRanges(point.profitable_ranges)}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginTop: '0.55rem' }}>
        The dollar figures are theoretical mark-to-model P/L at each underlying
        price, using each leg&rsquo;s current IV held constant. They exclude
        commissions, slippage, volatility changes, and gap risk.
      </div>
    </div>
  )
}

function Detail({ row, colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--surface-sunken)', padding: 0, whiteSpace: 'normal' }}>
        <div style={{
          position: 'sticky',
          left: 0,
          maxWidth: 'calc(min(100vw, 1900px) - 4rem)',
          padding: '0.8rem 1rem',
        }}>
          <OptionProbabilityCards
            schedule={row.probability_schedule}
            capture={row.profit_capture}
            successHeadline="Price is above the upper long or supported by the modeled profit tent"
            failureHeadline="Price is in the complementary downside loss region"
            successFooter="Success includes the untested region above the upper long and $0-or-better modeled P/L inside the structure."
            failureFooter="Failure is exactly the complement: the downside region where the complete tranche has negative modeled P/L."
            methodNote={(
              <>
                The upper region is always counted as success, matching how this
                trade is managed. At the halfway and two-thirds reviews, all
                three strikes are repriced with their remaining time; at
                expiration, intrinsic value forms the completed tent. Success
                and failure remain exact complements at every date.
              </>
            )}
          />
          <TimeEvolutionCard row={row} />
          <ReachStructureCards row={row} />
          <DownsideRiskCard row={row} />
          <CourseTargetsCard row={row} />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                {row.uses_last_trade_prices
                  ? 'Entry estimate from recent trades'
                  : 'Entry at live mid'}
              </div>
              <div>
                Per 1/−2/1 fly: <strong>{row.entry_credit_per_fly >= 0
                  ? `${usd(row.entry_credit_per_fly)} credit`
                  : `${usd(Math.abs(row.entry_credit_per_fly))} debit`}</strong>
              </div>
              <div>
                Full tranche: <strong style={{ color: row.entry_credit >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                  {row.entry_credit >= 0
                    ? `${usd(row.entry_credit_dollars, 0)} credit`
                    : `${usd(row.entry_debit_dollars, 0)} debit`}
                </strong>
              </div>
              <div style={{ color: 'var(--text-dim)' }}>
                Natural market: {signedUsd(row.natural_credit_dollars, 0)}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                Delta fit
              </div>
              <div>
                Targets: {num(row.target_upper_long_delta * 100, 0)}
                {' / '}−{num(row.target_body_short_delta * 100, 0)}×2
                {' / '}{num(row.target_lower_long_delta * 100, 0)}
              </div>
              <div>
                Actual: {num(row.actual_upper_long_delta * 100, 1)}
                {' / '}−{num(row.actual_body_short_delta * 100, 1)}×2
                {' / '}{num(row.actual_lower_long_delta * 100, 1)}
              </div>
              <div>Complete tranche: <strong>{signed(row.position_delta)}</strong></div>
            </div>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                Expiration
              </div>
              <div>
                Lower breakeven: <strong>{row.lower_breakeven == null ? 'none' : usd(row.lower_breakeven)}</strong>
              </div>
              <div>
                Upper breakeven: <strong>{row.upper_breakeven == null ? 'none' : usd(row.upper_breakeven)}</strong>
              </div>
              <div>
                Maximum profit: <strong style={{ color: 'var(--pos)' }}>{usd(row.max_profit_dollars, 0)}</strong>
              </div>
              <div>
                Maximum loss: <strong style={{ color: 'var(--neg)' }}>{usd(row.max_loss_dollars, 0)}</strong>
              </div>
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
              kind="unbalanced-butterfly"
              row={row}
              source="Unbalanced Butterfly Scanner"
            />
          </div>
        </div>
      </td>
    </tr>
  )
}

export default function UnbalancedButterflyScanner() {
  const pf = useProfileFetch()
  const [cachedScan, saveScan] = useScanCache('unbalanced-butterfly')
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
    const {
      step = 1,
      min,
      max,
      suffix = '',
      width = 76,
      tip,
      onValueChange,
    } = options
    return (
      <label title={tip} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        color: 'var(--text-dim)',
        fontSize: '0.74rem',
      }}>
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

  const runScan = useCallback(() => {
    setLoading(true)
    setError('')
    setExpanded(null)
    pf('/api/options/unbalanced-butterfly-scan', {
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

  const sortedRows = useMemo(() => {
    const accessors = {
      ticker: row => row.ticker,
      delta: row => Number(row.upper_long_delta_mode),
      dte: row => row.dte,
      fit: row => row.position_delta_error,
      uel: row => Math.abs(row.upper_flat_dollars),
      theta: row => Math.abs(row.theta_dollars_per_day - row.target_theta_dollars),
      max_profit: row => row.max_profit_dollars,
      max_loss: row => row.max_loss_dollars,
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

  const setTrancheQuantity = value => {
    setFilters(current => {
      const previous = Math.max(
        1,
        Number(current.tranche_quantity) || COURSE_BASE_LONG_QUANTITY,
      )
      const next = Math.max(1, Number(value) || 1)
      const ratio = next / previous
      const scale = field => Math.round(
        (Number(current[field]) || 0) * ratio * 1000,
      ) / 1000
      return {
        ...current,
        tranche_quantity: value,
        target_theta_dollars: scale('target_theta_dollars'),
        theta_tolerance_dollars: scale('theta_tolerance_dollars'),
        uel_tolerance_dollars: scale('uel_tolerance_dollars'),
      }
    })
  }

  const quantityScale = Math.max(
    1,
    Number(filters.tranche_quantity) || COURSE_BASE_LONG_QUANTITY,
  ) / COURSE_BASE_LONG_QUANTITY
  const scaledBias = value => {
    const scaled = value * quantityScale
    const digits = Number.isInteger(scaled) ? 0 : 1
    return signed(scaled, digits)
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
        <h1 style={{ margin: 0, color: 'var(--accent-bright)' }}>Unbalanced Butterfly Scanner</h1>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => setShowHelp(value => !value)}
          aria-expanded={showHelp}
        >
          {showHelp ? 'Hide help' : 'How this works'}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Builds the course&rsquo;s long-dated 4/−8/4 put broken-wing butterfly with
        selectable 20- or 25-delta upper longs, then balances the lower wing for
        the chosen market bias.
      </p>
      <ScannerRiskNotice />
      {showHelp && <HelpPanel />}
      <ScannerParameterGuide scanner="unbalanced-butterfly" />

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.85rem',
        alignItems: 'flex-end',
        padding: '0.85rem',
        marginBottom: '0.7rem',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}>
        <label style={{ flex: '1 1 250px', color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Tickers
          <input
            value={filters.tickers}
            onChange={event => set('tickers', event.target.value.toUpperCase())}
            placeholder="SPY,QQQ,IWM"
            style={{
              display: 'block',
              width: '100%',
              marginTop: '0.2rem',
              padding: '0.32rem 0.4rem',
              color: 'var(--text-strong)',
              background: 'var(--surface-inset)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          />
        </label>
        <label style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Upper-long delta
          <select
            value={filters.upper_long_delta}
            onChange={event => set('upper_long_delta', event.target.value)}
            style={{
              display: 'block',
              marginTop: '0.2rem',
              padding: '0.32rem 0.4rem',
              color: 'var(--text-strong)',
              background: 'var(--surface-inset)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          >
            <option value="both">Both 20 and 25</option>
            <option value="20">20 delta</option>
            <option value="25">25 delta</option>
          </select>
        </label>
        <label style={{ color: 'var(--text-dim)', fontSize: '0.74rem' }}>
          Market bias
          <select
            value={filters.market_bias}
            onChange={event => set('market_bias', event.target.value)}
            style={{
              display: 'block',
              marginTop: '0.2rem',
              padding: '0.32rem 0.4rem',
              color: 'var(--text-strong)',
              background: 'var(--surface-inset)',
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          >
            <option value="bearish">
              {`Bearish (${scaledBias(-3)} to ${scaledBias(-1)} Δ)`}
            </option>
            <option value="neutral">
              {`Neutral (${scaledBias(-1)} to ${scaledBias(1)} Δ)`}
            </option>
            <option value="bullish">
              {`Bullish (${scaledBias(1)} to ${scaledBias(3)} Δ)`}
            </option>
          </select>
        </label>
        {numberField('Target DTE', 'target_dte', { min: 1, max: 1095 })}
        {numberField('Minimum DTE', 'min_dte', { min: 1, max: 1095 })}
        {numberField('Maximum DTE', 'max_dte', { min: 1, max: 1095 })}
        {numberField('Tranche long qty', 'tranche_quantity', {
          min: 1,
          max: 100,
          width: 65,
          onValueChange: setTrancheQuantity,
          tip: 'Changing quantity scales the dollar targets and whole-position delta range.',
        })}
        {numberField('Leg Δ tolerance', 'delta_tolerance', { step: 0.005, min: 0.005, max: 0.15 })}
        {numberField('Target theta', 'target_theta_dollars', { step: 1, min: -1000, max: 1000, suffix: '$/day' })}
        {numberField('Theta tolerance', 'theta_tolerance_dollars', { step: 1, min: 0, max: 1000, suffix: '$' })}
        {numberField('UEL tolerance', 'uel_tolerance_dollars', { step: 25, min: 0, max: 100000, suffix: '$' })}
        {numberField('Min lower-wing ratio', 'min_lower_wing_ratio', { step: 0.05, min: 1.001, max: 10, width: 70 })}
        {numberField('Minimum leg OI', 'min_open_interest', { min: 0, width: 80 })}
        <button className="btn btn-sm btn-scan" onClick={runScan} disabled={loading}>
          {loading ? 'Scanning…' : 'Run scan'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.74rem', alignSelf: 'center' }}>Quick upper-long delta:</span>
        {[
          ['Both 20 and 25', 'both'],
          ['20 delta', '20'],
          ['25 delta', '25'],
        ].map(([label, value]) => (
          <button
            key={value}
            className={`btn btn-xs ${filters.upper_long_delta === value ? 'btn-scan' : 'btn-outline'}`}
            aria-pressed={filters.upper_long_delta === value}
            onClick={() => set('upper_long_delta', value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && (
        <p style={{ color: 'var(--text-dim)' }}>
          Starting with the monthly expiration nearest the target DTE, then
          checking the rest of the selected window while balancing nearby
          20/15/lower or 25/15/5-delta put combinations…
        </p>
      )}
      {stats && !loading && (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.76rem', marginBottom: '0.55rem' }}>
          Scanned <strong>{stats.tickers}</strong> tickers · priced{' '}
          <strong>{stats.expirations_priced}</strong> monthly expirations ·{' '}
          <strong style={{ color: 'var(--pos)' }}>{stats.actionable}</strong> matched
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
                {heading('Upper Δ', 'delta')}
                {heading('Expiration', 'dte')}
                <th>Structure</th>
                <th>Wing widths</th>
                {heading('Net delta', 'fit', { textAlign: 'right' })}
                {heading('Upper line', 'uel', { textAlign: 'right' })}
                {heading('Theta', 'theta', { textAlign: 'right' })}
                <th>Expiration outcomes</th>
                {heading('Max P/L', 'max_profit', { textAlign: 'right' })}
                {heading('Min OI', 'oi', { textAlign: 'right' })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => {
                const key = `${row.ticker}-${row.upper_long_delta_mode}-${row.market_bias}-${row.expiration}`
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
                        <strong>{row.upper_long_delta_mode}</strong>
                        <div style={{
                          color: row.status === 'actionable' ? 'var(--pos)' : 'var(--amber)',
                          fontSize: '0.66rem',
                        }}>
                          {row.status === 'actionable' ? 'matched' : 'near match'}
                        </div>
                      </td>
                      <td>
                        <strong>{row.expiration}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>{row.dte} DTE · monthly</div>
                      </td>
                      <td><Structure row={row} /></td>
                      <td>
                        <strong>{num(row.upper_width, 1)} / {num(row.lower_width, 1)}</strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          lower is {num(row.lower_wing_ratio, 2)}× upper
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{
                          color: row.position_delta_error === 0 ? 'var(--pos)' : 'var(--amber)',
                        }}>
                          {signed(row.position_delta)}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          {row.market_bias} {signed(row.bias_delta_min, 0)} to {signed(row.bias_delta_max, 0)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{
                          color: Math.abs(row.upper_flat_dollars) <= row.uel_tolerance_dollars
                            ? 'var(--pos)' : 'var(--amber)',
                        }}>
                          {signedUsd(row.upper_flat_dollars, 0)}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>target $0</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong style={{
                          color: Math.abs(row.theta_dollars_per_day - row.target_theta_dollars) <= row.theta_tolerance_dollars
                            ? 'var(--pos)' : 'var(--amber)',
                        }}>
                          {signedUsd(row.theta_dollars_per_day, 0)}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                          per day · target {signedUsd(row.target_theta_dollars, 0)}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <Outcome label="Upper flat" value={row.upper_flat_dollars} />
                          <Outcome label="Body peak" value={row.center_max_profit_dollars} emphasize />
                          <Outcome label="Lower flat" value={row.lower_flat_dollars} />
                        </div>
                        {!!row.probability_schedule?.length && (
                          <div style={{ color: 'var(--pos-strong)', fontSize: '0.66rem', fontWeight: 700, marginTop: '0.25rem' }}>
                            Success {row.probability_schedule.map(point => (
                              `${point.label}: ${pct(point.probability_success_pct)}`
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
        <p style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '2rem' }}>
          No live or recent-trade broken-wing butterflies were available in the
          selected monthly-expiration window.
        </p>
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
