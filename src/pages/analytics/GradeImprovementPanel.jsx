import { formatMoney, formatMoneyDelta, formatMoneyWhole } from '../../utils/money'
import { planOptionFacts, planOptionLabel, planOptionNote } from './gradePlanOptions'
import './GradeImprovementPanel.css'

// Signed share count, up to two decimals; a full trim shows the exact position size.
function formatShares(n) {
  const abs = Math.abs(n)
  const text = abs > 0 && abs < 0.01 ? '<0.01' : abs.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : '+'}${text} ${abs === 1 ? 'share' : 'shares'}`
}

// Grade scores carry one decimal, so 83 reads as 83.0 beside 83.2.
function formatScore(n) {
  return typeof n === 'number' ? n.toFixed(1) : n
}

// Whole-dollar income change; anything that rounds to $0 is shown unsigned.
function formatIncome(n) {
  return Math.round(Math.abs(n)) === 0 ? '$0' : formatMoneyDelta(n, { digits: 0 })
}

// The plan options as tabs; the arrow keys, Home and End move between them.
function PlanOptionTabs({ options, selectedIndex, onSelect, letter, idPrefix }) {
  const facts = planOptionFacts(options)
  const onKeyDown = event => {
    const last = options.length - 1
    const next = { ArrowRight: selectedIndex + 1, ArrowLeft: selectedIndex - 1, Home: 0, End: last }[event.key]
    if (next == null) return
    event.preventDefault()
    const index = next > last ? 0 : next < 0 ? last : next
    onSelect(index)
    event.currentTarget.querySelectorAll('[role="tab"]')[index]?.focus()
  }
  return (
    <div className="grade-plan-options" role="tablist" aria-label={`Ways to reach ${letter}`} onKeyDown={onKeyDown}>
      {options.map((option, i) => {
        const f = facts[i]
        const selected = i === selectedIndex
        return (
          <button key={i} type="button" role="tab" id={`${idPrefix}-tab-${i}`} aria-selected={selected}
            aria-controls={`${idPrefix}-panel`} tabIndex={selected ? 0 : -1}
            className={`grade-plan-option${selected ? ' selected' : ''}`} onClick={() => onSelect(i)}>
            <span className="grade-plan-option-number">Option {i + 1}</span>
            <strong className="grade-plan-option-label">{planOptionLabel(option)}</strong>
            <span className="grade-plan-option-facts">
              <span>{f.grade} ({formatScore(f.score)})</span>
              <span>{formatMoneyWhole(f.moved)} moved</span>
              {f.income != null && <span className={f.income > 0.5 ? 'pos' : f.income < -0.5 ? 'neg' : ''}>{formatIncome(f.income)}/yr</span>}
              <span>{f.changes} {f.changes === 1 ? 'change' : 'changes'}</span>
            </span>
            {f.badges.length > 0 && (
              <span className="grade-plan-option-badges">{f.badges.map(b => <span key={b}>{b}</span>)}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function GradeImprovementPanel({ optimization, options = [], selectedIndex = 0, onSelectOption, periodLabel, onViewDetails }) {
  const titleId = useId()
  const optionsId = useId()
  const target = optimization.target
  const multiple = options.length > 1
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
        : reached ? (multiple ? `${options.length} model mixes that reach ${target.letter}` : `A model mix that reaches ${target.letter}`)
          : `Target ${target.letter} not found — best mix tested`

  const allocationList = (items, action) => {
    const label = action === 'add' ? 'Increase' : 'Trim'
    const income = items.reduce((sum, w) => sum + (w.income_change ?? 0), 0)
    return (
      <div className={`grade-plan-list grade-plan-${action}`}>
        <h3>{label} ({items.length})<span className="grade-plan-list-income">{formatIncome(income)}/yr income</span></h3>
        <table>
          <thead>
            <tr>
              <th scope="col">Ticker</th>
              <th scope="col">Amount</th>
              <th scope="col">Weight</th>
              <th scope="col" title="Estimated annual income this change adds or gives up, at the holding’s current payout yield">Income/yr</th>
            </tr>
          </thead>
          <tbody>
            {items.map(w => (
              <tr key={w.ticker}>
                <th scope="row">{w.ticker}</th>
                <td>
                  <span className="grade-plan-amount">{formatMoneyDelta(w.dollar_change, { digits: 0 })}</span>
                  {w.shares_change != null && <span className="grade-plan-shares" title={w.current_price ? `At ${formatMoney(w.current_price)} a share` : undefined}>{formatShares(w.shares_change)}</span>}
                </td>
                <td>{w.current_pct.toFixed(2)}% → {w.optimal_pct.toFixed(2)}%</td>
                <td className={`grade-plan-income-cell${w.income_change > 0.5 ? ' pos' : w.income_change < -0.5 ? ' neg' : ''}`}
                  title={w.yield_pct != null ? `${w.ticker} yields an estimated ${w.yield_pct.toFixed(2)}% a year` : undefined}>
                  {w.income_change != null ? formatIncome(w.income_change) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section className="card grade-plan" aria-labelledby={titleId} tabIndex={-1}>
      <div className="grade-plan-eyebrow">What would it take? · {periodLabel} analysis</div>
      <h2 id={titleId}>{heading}</h2>
      {multiple && <>
        <p>Each option reaches {target.letter} a different way. Pick one to see its changes; the full comparison and export below follow your pick.</p>
        <PlanOptionTabs options={options} selectedIndex={selectedIndex} onSelect={onSelectOption}
          letter={target.letter} idPrefix={optionsId} />
      </>}
      {noHoldings ? <p>None of the tickers with usable history are held in this account. Use Load Portfolio, then run the search again.</p>
        : historyMissing ? <p>No held ticker has enough history in this window. Choose a longer period, then run the search again.</p>
          : <div {...(multiple ? { role: 'tabpanel', id: `${optionsId}-panel`, 'aria-labelledby': `${optionsId}-tab-${selectedIndex}` } : {})}>
            {multiple && <p className="grade-plan-option-note"><strong>Option {selectedIndex + 1} · {planOptionLabel(options[selectedIndex])}: </strong>{planOptionNote(options[selectedIndex])}</p>}
            <div className="grade-plan-stats">
              <div><span>Current grade</span><strong>{target.start_grade} <small>({formatScore(target.start_score)})</small></strong></div>
              <div><span>Model grade</span><strong>{target.grade} <small>({formatScore(target.score)})</small></strong></div>
              <div><span>Target score</span><strong>{target.cutoff}+</strong></div>
              <div><span>Amount shifted</span><strong>{formatMoneyWhole(target.moved_value)} <small>({target.moved_pct}%)</small></strong></div>
            </div>
            {already ? <p>No allocation changes are needed for this target. Select a higher grade to explore an improvement.</p>
              : <p>{reached ? 'To reproduce this grade on the historical window, fund the increases below with the trims beside them.'
                : changed ? 'This search improved the score but did not reach the target. The changes below show the best mix it tested.'
                  : 'The search found no improving shift within its limits. Try a lower target or compare a broader set of holdings with the other model tools.'}
                {!reached && (target.stopped === 'budget' ? ' It stopped at its search limit; this does not prove the target is impossible.'
                  : ' A different combination could still do better.')}
                {reached && !multiple && ` The alternative searches found no other distinct mix that reaches ${target.letter}.`}</p>}
            {incomeDelta != null && <p className="grade-plan-income"><strong>Income change from this plan: </strong>
              <span className={incomeDelta > 0.5 ? 'pos' : incomeDelta < -0.5 ? 'neg' : ''}>
                {formatIncome(incomeDelta)}/year ({formatIncome(incomeDelta / 12)}/month)
              </span>
              {' '}— estimated annual income {formatMoneyWhole(before.annual_income)} → {formatMoneyWhole(after.annual_income)}.
              {' '}Uses today’s payout estimates on the graded holdings; Income/yr shows each change’s share.
            </p>}
            {changed && <div className="grade-plan-allocations">{allocationList(adds, 'add')}{allocationList(trims, 'trim')}</div>}
            {drivers.length > 0 && <p><strong>What lifts the model’s grade: </strong>{drivers.map(d => `${d.category} score ${d.before} → ${d.score}`).join('; ')}. Each category is scored out of 100.</p>}
          </div>}
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
