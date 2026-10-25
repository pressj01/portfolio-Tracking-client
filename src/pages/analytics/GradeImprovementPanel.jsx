import { formatMoneyDelta, formatMoneyWhole } from '../../utils/money'
import './GradeImprovementPanel.css'

export default function GradeImprovementPanel({ optimization, periodLabel, onViewDetails }) {
  const titleId = useId()
  const target = optimization.target
  const { before, after } = optimization.comparison || {}
  const weights = optimization.weights || []
  const adds = weights.filter(w => w.action === 'BUY').sort((a, b) => b.dollar_change - a.dollar_change)
  const trims = weights.filter(w => w.action === 'SELL').sort((a, b) => a.dollar_change - b.dollar_change)
  const changed = adds.length + trims.length > 0
  const historyMissing = target.status === 'insufficient_history'
  const noHoldings = target.status === 'no_holdings'
  const already = target.status === 'already'
  const reached = target.status === 'reached'
  const drivers = (after?.breakdown || []).map(row => {
    const prior = before?.breakdown?.find(b => b.category === row.category)
    return prior ? { ...row, before: prior.score, gain: (row.score - prior.score) * row.weight } : null
  }).filter(row => row && row.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3)
  const incomeDelta = before && after ? after.annual_income - before.annual_income : null
  const heading = historyMissing ? 'More price history is needed'
    : noHoldings ? 'Load your holdings to build a grade plan'
      : already ? `Your portfolio already meets ${target.letter}`
        : reached ? `A model mix that reaches ${target.letter}` : `Target ${target.letter} not found — best mix tested`

  const allocationList = (items, action) => (
    <div className={`grade-plan-list grade-plan-${action}`}>
      <h3>{action === 'add' ? 'Increase' : 'Trim'} ({items.length})</h3>
      <ul>
        {items.map(w => (
          <li key={w.ticker}>
            <strong>{w.ticker}</strong>
            <span className="grade-plan-amount">{formatMoneyDelta(w.dollar_change, { digits: 0 })}</span>
            <span>{w.current_pct.toFixed(2)}% → {w.optimal_pct.toFixed(2)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <section className="card grade-plan" aria-labelledby={titleId} tabIndex={-1}>
      <div className="grade-plan-eyebrow">What would it take? · {periodLabel} analysis</div>
      <h2 id={titleId}>{heading}</h2>
      {noHoldings ? <p>None of the tickers with usable history are held in this account. Use Load Portfolio, then run the search again.</p>
        : historyMissing ? <p>No held ticker has enough history in this window. Choose a longer period, then run the search again.</p>
          : <>
            <div className="grade-plan-stats">
              <div><span>Current grade</span><strong>{target.start_grade} <small>({target.start_score})</small></strong></div>
              <div><span>Model grade</span><strong>{target.grade} <small>({target.score})</small></strong></div>
              <div><span>Target score</span><strong>{target.cutoff}+</strong></div>
              <div><span>Amount shifted</span><strong>{formatMoneyWhole(target.moved_value)} <small>({target.moved_pct}%)</small></strong></div>
            </div>
            {already ? <p>No allocation changes are needed for this target. Select a higher grade to explore an improvement.</p>
              : <p>{reached ? 'To reproduce this grade on the historical window, fund the increases below with the trims beside them.'
                : changed ? 'This search improved the score but did not reach the target. The changes below show the best mix it tested.'
                  : 'The search found no improving shift within its limits. Try a lower target or compare a broader set of holdings with the other model tools.'}
                {!reached && (target.stopped === 'budget' ? ' It stopped at its search limit; this does not prove the target is impossible.'
                  : ' A different combination could still do better.')}</p>}
            {incomeDelta != null && <p className="grade-plan-income"><strong>Estimated annual income: </strong>
              {formatMoneyWhole(before.annual_income)} → {formatMoneyWhole(after.annual_income)}
              {' '}({formatMoneyDelta(incomeDelta, { digits: 0 })}/year; {formatMoneyDelta(incomeDelta / 12, { digits: 0 })}/month).
              {' '}Uses today’s payout estimates on the graded holdings.
            </p>}
            {changed && <div className="grade-plan-allocations">{allocationList(adds, 'add')}{allocationList(trims, 'trim')}</div>}
            {drivers.length > 0 && <p><strong>What lifts the model’s grade: </strong>{drivers.map(d => `${d.category} score ${d.before} → ${d.score}`).join('; ')}. Each category is scored out of 100.</p>}
          </>}
      <details className="grade-plan-limits">
        <summary>Search limits and excluded holdings</summary>
        <p>Only holdings already owned can receive money. No holding may increase above {target.max_weight_pct}%; an existing larger position may stay or shrink. Single-stock ETFs, funds flagged for NAV erosion, and holdings with unreliable or distressed price history may only shrink. This is a limited search for a nearby improvement, with no guarantee of the smallest possible move.</p>
        {target.blocked?.length > 0 && <p><strong>Cannot increase: </strong>{target.blocked.map(b => `${b.ticker} (${b.reason})`).join(', ')}.</p>}
        {target.not_held?.length > 0 && <p><strong>Not held: </strong>{target.not_held.join(', ')}.</p>}
        {target.ungraded?.length > 0 && <p><strong>Not graded; left unchanged: </strong>{target.ungraded.join(', ')}.</p>}
      </details>
      <p className="grade-plan-note">Percentages and dollars refer to the graded holdings. This historical model does not forecast future grades or include taxes and trading costs. Your actual holdings are unchanged.</p>
      {weights.length > 0 && <button className="btn" onClick={onViewDetails}>View full comparison and export</button>}
    </section>
  )
}
import { useId } from 'react'
