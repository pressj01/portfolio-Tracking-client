import React from 'react'

const pct = value => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `${Number(value).toFixed(1)}%`
const MONTH_LABELS = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
const ordinal = value => {
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  return `${value}${value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'}`
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return `${MONTH_LABELS[date.getMonth()]} ${ordinal(date.getDate())} ${date.getFullYear()}`
}

function failureProbability(point) {
  if (point?.probability_failure_pct != null) return point.probability_failure_pct
  if (point?.probability_success_pct == null) return null
  return Math.max(0, Math.min(100, 100 - Number(point.probability_success_pct)))
}

function ProbabilityCard({
  label,
  accent,
  probability,
  headline,
  context,
  schedule,
  valueForPoint,
  footer,
  horizonLabel,
  scheduleTitle,
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
        {label} <span style={{ color: accent, fontWeight: 700 }}>· {horizonLabel}</span>
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
      {!!schedule.length && (
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
            {scheduleTitle}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.6rem',
          }}>
            {schedule.map(point => (
              <div
                key={`${point.kind}-${point.remaining_dte}`}
                style={{ borderLeft: `3px solid ${accent}`, paddingLeft: '0.6rem' }}
              >
                <div style={{
                  color: 'var(--text-dim)',
                  fontSize: '0.63rem',
                  textTransform: 'uppercase',
                }}>
                  {point.label}
                </div>
                <strong style={{ fontSize: '1.15rem', color: accent }}>
                  {pct(valueForPoint(point))}
                </strong>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.66rem' }}>
                  {formatDate(point.exit_date)} · {point.remaining_dte} DTE
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


const money = value => value == null || !Number.isFinite(Number(value))
  ? '\u2014'
  : `${Number(value) < 0 ? '\u2212' : '+'}$${Math.abs(Number(value)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

const price = value => value == null || !Number.isFinite(Number(value))
  ? '\u2014'
  : `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function PriceScenarioTable({ scenarios }) {
  const rows = Array.isArray(scenarios?.rows) ? scenarios.rows : []
  const columns = Array.isArray(scenarios?.columns) ? scenarios.columns : []
  if (!rows.length || !columns.length) return null
  const zone = scenarios.zone || {}
  return (
    <div style={{
      marginTop: '0.75rem',
      background: 'var(--surface-inset)',
      border: '1px solid var(--border)',
      borderRadius: 7,
      padding: '0.85rem 1rem',
    }}>
      <div style={{
        color: 'var(--text-dim)',
        fontSize: '0.66rem',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        Holding it out
      </div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 700, marginTop: '0.2rem' }}>
        What the trade is worth each month, at three prices
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginTop: '0.25rem' }}>
        Modeled P/L if the underlying sits at each price on that date &mdash; today&rsquo;s
        price, {scenarios.step_pct}% toward the tent, and {scenarios.step_pct}% away from it.
        The tent&rsquo;s near edge is {price(scenarios.tent_edge)}: nothing in this structure
        pays until price reaches it. Each row&rsquo;s best month is highlighted.
      </div>
      <div style={{ overflowX: 'auto', marginTop: '0.6rem' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{
                textAlign: 'left',
                padding: '0.3rem 0.6rem 0.35rem 0',
                color: 'var(--text-dim)',
                fontSize: '0.66rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                whiteSpace: 'nowrap',
              }}>
                If price is
              </th>
              {columns.map(column => (
                <th
                  key={column.remaining_dte}
                  style={{
                    textAlign: 'right',
                    padding: '0.3rem 0 0.35rem 0.6rem',
                    color: 'var(--text-dim)',
                    fontSize: '0.66rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <div style={{ color: 'var(--text-strong)', fontSize: '0.72rem' }}>
                    {formatDate(column.exit_date)}
                  </div>
                  <div style={{ fontWeight: 400 }}>
                    {column.kind === 'expiration'
                      ? 'expiration'
                      : `${column.remaining_dte} DTE left`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{
                  padding: '0.45rem 0.6rem 0.45rem 0',
                  color: 'var(--text-strong)',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}>
                  {price(row.price)}
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', fontWeight: 400 }}>
                    {row.label}
                  </div>
                  {row.best_month && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 400 }}>
                      best in {row.best_month.month_label}
                    </div>
                  )}
                </td>
                {row.cells.map(cell => (
                  <td
                    key={cell.remaining_dte}
                    style={{
                      padding: '0.45rem 0.4rem 0.45rem 0.6rem',
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                      background: cell.is_row_best
                        ? 'color-mix(in srgb, var(--accent) 14%, transparent)'
                        : undefined,
                      outline: cell.is_row_best ? '1px solid var(--accent)' : undefined,
                      borderRadius: cell.is_row_best ? 5 : undefined,
                    }}
                  >
                    <strong style={{
                      fontSize: '1.02rem',
                      color: Number(cell.profit_dollars) > 0 ? 'var(--pos-strong)' : 'var(--neg-strong)',
                    }}>
                      {money(cell.profit_dollars)}
                    </strong>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                      {row.is_spot
                        ? 'price unchanged'
                        : `${pct(cell.touch_pct)} touched by then`}
                    </div>
                    {!row.is_spot && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                        {pct(cell.beyond_pct)} past it on the day
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{
                padding: '0.45rem 0.6rem 0.45rem 0',
                color: 'var(--text-strong)',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>
                Best case
                <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', fontWeight: 400 }}>
                  anywhere in the hold zone
                </div>
              </td>
              {columns.map(column => (
                <td
                  key={column.remaining_dte}
                  style={{ padding: '0.45rem 0.4rem 0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}
                >
                  <strong style={{ fontSize: '0.95rem', color: 'var(--text-strong)' }}>
                    {money(column.zone_best_profit_dollars)}
                  </strong>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                    at {price(column.zone_best_price)}
                    {column.zone_best_at_edge ? ' \u00b7 zone edge' : ''}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{
        borderTop: '1px solid var(--border)',
        marginTop: '0.5rem',
        paddingTop: '0.5rem',
        color: 'var(--text-muted)',
        fontSize: '0.72rem',
        display: 'grid',
        gap: '0.35rem',
      }}>
        <div>
          <strong style={{ color: 'var(--text-strong)' }}>The hold zone</strong> is
          {' '}{price(zone.low)} to {price(zone.high)} &mdash; up to {zone.above_pct}% above
          today&rsquo;s price, down to {zone.inside_pct}% inside the tent. Below that the
          position is running at its own wing, which is a move most holders close rather
          than sit through, so the best case is not scanned there.
        </div>
        {scenarios.zone_best_pinned_to_edge && (
          <div>
            Every month&rsquo;s best case lands on the bottom of that zone, which means the
            payoff is still improving as price falls: the limit here is how far you are
            willing to let it run, not where the structure stops paying.
          </div>
        )}
        <div>
          Each column prices the same position at the same volatility, so the only things
          changing across a row are the days remaining and the price. A real move of this
          size would move implied volatility too.
        </div>
      </div>
    </div>
  )
}


function ProfitCaptureTable({ capture, expirationSuccessPct }) {
  const targets = Array.isArray(capture?.targets) ? capture.targets : []
  if (!targets.length) return null
  const horizons = targets[0].horizons || []
  if (!horizons.length) return null
  const headline = targets[0].horizons[targets[0].horizons.length - 1]
  // A structure that only converges on its maximum at expiration cannot be
  // worth a large fraction of it months out, whatever price does. Those cells
  // are arithmetic, not a market view, and get said out loud.
  const blocked = targets.filter(target =>
    target.horizons.some(point => point.reachable === false))
  const earliest = blocked
    .map(target => target.reachable_from_dte)
    .filter(value => value != null)
    .sort((left, right) => right - left)[0]
  return (
    <div style={{
      marginTop: '0.75rem',
      background: 'var(--surface-inset)',
      border: '1px solid var(--border)',
      borderRadius: 7,
      padding: '0.85rem 1rem',
    }}>
      <div style={{
        color: 'var(--text-dim)',
        fontSize: '0.66rem',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        Taking profit early
      </div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 700, marginTop: '0.2rem' }}>
        Odds a partial-profit target fills before expiration
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginTop: '0.25rem' }}>
        Holding to expiration is worth {capture.max_profit_dollars != null
          ? `$${Number(capture.max_profit_dollars).toFixed(0)} per contract`
          : 'the maximum profit'} and nothing more. These are the odds of buying the
        position back early for part of that instead &mdash; the plan most short-premium
        trades are actually managed on.
      </div>
      <div style={{ overflowX: 'auto', marginTop: '0.6rem' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 }}>
          <thead>
            <tr>
              <th style={{
                textAlign: 'left',
                padding: '0.3rem 0.6rem 0.35rem 0',
                color: 'var(--text-dim)',
                fontSize: '0.66rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                whiteSpace: 'nowrap',
              }}>
                Buy it back for
              </th>
              {horizons.map(point => (
                <th
                  key={point.remaining_dte}
                  style={{
                    textAlign: 'right',
                    padding: '0.3rem 0 0.35rem 0.6rem',
                    color: 'var(--text-dim)',
                    fontSize: '0.66rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <div style={{ color: 'var(--text-strong)', fontSize: '0.72rem' }}>
                    {formatDate(point.exit_date)}
                  </div>
                  <div style={{ fontWeight: 400 }}>
                    {point.kind === 'expiration'
                      ? 'expiration'
                      : `${point.remaining_dte} DTE left · ${point.label.replace(' through the trade', '')} through`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {targets.map(target => (
              <tr key={target.fraction} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{
                  padding: '0.45rem 0.6rem 0.45rem 0',
                  color: 'var(--text-strong)',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}>
                  {target.label}
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem', fontWeight: 400 }}>
                    banking ${Number(target.target_profit_dollars).toFixed(0)} per contract
                  </div>
                  {target.horizons.some(point => point.reachable === false)
                    && target.reachable_from_dte != null && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 400 }}>
                      not priceable until {target.reachable_from_dte} DTE
                      {' '}({formatDate(target.reachable_from_date)})
                    </div>
                  )}
                </td>
                {target.horizons.map(point => (
                  <td
                    key={point.remaining_dte}
                    style={{ padding: '0.45rem 0 0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}
                  >
                    {point.reachable === false ? (
                      <>
                        <strong style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                          Out of reach
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>
                          best possible {point.best_profit_dollars != null
                            ? `$${Number(point.best_profit_dollars).toFixed(0)}`
                            : '—'}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                          {point.best_profit_fraction_pct != null
                            ? `${pct(point.best_profit_fraction_pct)} of max, on the peak`
                            : 'below this target'}
                        </div>
                      </>
                    ) : (
                      <>
                        <strong style={{ fontSize: '1.1rem', color: 'var(--pos-strong)' }}>
                          {pct(point.probability_by_pct)}
                        </strong>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>
                          reached by then
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                          {pct(point.probability_at_pct)} still there on the day
                        </div>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{
        borderTop: '1px solid var(--border)',
        marginTop: '0.5rem',
        paddingTop: '0.5rem',
        color: 'var(--text-muted)',
        fontSize: '0.72rem',
        display: 'grid',
        gap: '0.35rem',
      }}>
        <div>
          <strong style={{ color: 'var(--text-strong)' }}>Reached by then</strong> is the chance
          the target is available at least once on or before that date &mdash; what a resting
          good-till-cancelled closing order needs in order to fill. It is the number to plan
          around if you intend to take profit early.
        </div>
        {blocked.length > 0 && (
          <div>
            <strong style={{ color: 'var(--text-strong)' }}>Out of reach</strong> is not a long
            shot &mdash; it means the target cannot be quoted on that date at any price. This
            position only converges on its maximum as expiration approaches, so with time still
            on the clock the whole structure is worth a fraction of max profit even with the
            underlying sitting exactly on its best price.
            {earliest != null && (
              <> Partial-profit management only becomes possible inside about {earliest} DTE;
                before that the checkpoints are for judging the trade, not for closing it.</>
            )}
          </div>
        )}
        <div>
          <strong style={{ color: 'var(--text-strong)' }}>Still there on the day</strong> is the
          chance the position is at or past the target on that date itself. It is lower because a
          target reached early can be handed back.
        </div>
        {expirationSuccessPct != null && headline?.probability_by_pct != null && (
          <div>
            These two answer different questions from the {pct(expirationSuccessPct)} success
            figure above, so they will not tie out to it directly. Success is measured only at
            expiration; {pct(headline.probability_by_pct)} counts every path that reached the
            target at any point, including paths that later gave it back, which is why it can be
            the larger number. Compare like with like using
            &ldquo;still there on the day&rdquo; at expiration
            ({pct(headline.probability_at_pct)}): it always sits at or below
            {' '}{pct(expirationSuccessPct)}, because finishing at the target is a subset of
            finishing profitable at all.
          </div>
        )}
      </div>
    </div>
  )
}

export default function OptionProbabilityCards({
  schedule,
  capture,
  scenarios,
  successHeadline = 'The complete position has positive modeled P/L',
  failureHeadline = 'The complete position has negative modeled P/L',
  successFooter = 'Success means the complete position can be closed for more than $0 modeled P/L.',
  failureFooter = 'Failure is the complement: the complete position closes at or below $0 modeled P/L.',
  methodNote,
  primaryPointLabel,
  primaryHorizonLabel,
  scheduleTitle = 'At the recommended management dates',
}) {
  const points = Array.isArray(schedule) ? schedule : []
  const expiration = points.find(point => point.kind === 'expiration' || point.remaining_dte === 0)
  if (!expiration) {
    return scenarios ? (
      <div style={{ marginBottom: '0.9rem' }}>
        <PriceScenarioTable scenarios={scenarios} />
      </div>
    ) : null
  }
  const requestedPrimaryPoint = (
    primaryPointLabel
      ? points.find(point => point.label === primaryPointLabel)
      : null
  )
  const primaryPoint = requestedPrimaryPoint || expiration
  const plannedExits = points.filter(point => point !== expiration)
  const success = primaryPoint.probability_success_pct
  const failure = failureProbability(primaryPoint)
  const horizonLabel = requestedPrimaryPoint
    ? (primaryHorizonLabel || `at ${primaryPoint.label.toLowerCase()}`)
    : 'at expiration'
  const primaryContext = primaryPoint === expiration
    ? `${formatDate(expiration.exit_date)} · modeled from today through expiration`
    : `${formatDate(primaryPoint.exit_date)} · ${primaryPoint.remaining_dte} DTE remaining`

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        <ProbabilityCard
          label="Probability of success"
          accent="var(--pos-strong)"
          probability={success}
          headline={successHeadline}
          context={primaryContext}
          schedule={plannedExits}
          valueForPoint={point => point.probability_success_pct}
          footer={successFooter}
          horizonLabel={horizonLabel}
          scheduleTitle={scheduleTitle}
        />
        <ProbabilityCard
          label="Probability of failure"
          accent="var(--neg-strong)"
          probability={failure}
          headline={failureHeadline}
          context={primaryContext}
          schedule={plannedExits}
          valueForPoint={failureProbability}
          footer={failureFooter}
          horizonLabel={horizonLabel}
          scheduleTitle={scheduleTitle}
        />
      </div>
      <ProfitCaptureTable
        capture={capture}
        expirationSuccessPct={expiration.probability_success_pct}
      />
      <PriceScenarioTable scenarios={scenarios} />
      <div style={{ color: 'var(--text-dim)', fontSize: '0.67rem', marginTop: '0.5rem' }}>
        {methodNote || (
          <>
            Option-implied, risk-neutral estimates using current implied volatility with each leg&rsquo;s IV
            held constant. Success and failure are complements at every date. Values exclude commissions
            and slippage and are risk gauges, not forecasts.
          </>
        )}
      </div>
    </div>
  )
}
