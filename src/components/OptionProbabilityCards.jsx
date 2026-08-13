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

export default function OptionProbabilityCards({
  schedule,
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
  if (!expiration) return null
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
    : 'by expiration'
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
