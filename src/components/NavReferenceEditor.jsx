import { useId, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import {
  invalidateNavAssessment, isNavLag, navPercent, readNavJson, useStrategyAnswer, NAV_LAG_EXPLAINER, STRATEGY_ANSWER_OPTIONS,
} from '../utils/navAssessment'

// Registry family names describe the NAV source, not what a reader calls the fund.
const FAMILY_LABELS = {
  'Published CEF NAV': 'Closed-end fund',
  'Quarterly BDC NAV': 'Business development company',
  'Quarterly mortgage REIT book value': 'Mortgage REIT',
}

const STRATEGY_SOURCE_NOTE = {
  user: 'You answered this. Choose Not sure to go back to automatic detection.',
  holdings: 'Detected automatically from the option positions in the fund’s disclosed holdings. Answer only if that is wrong.',
  inferred: 'Detected automatically from the fund’s category or name. Answer if you know otherwise.',
  family: 'Set from the fund type in the reviewed list. Answer if you know it sells options.',
  manual: 'Treated as a call-income fund because it is set to Include (manual). Answer to confirm or change.',
  unverified: 'The app could not tell from the fund’s holdings, name or category.',
}

export default function NavReferenceEditor({ row, onClose }) {
  const pf = useProfileFetch()
  const choice = row.reference.choice
  const [mode, setMode] = useState(choice.mode === 'custom' ? 'custom' : 'symbol')
  const [symbol, setSymbol] = useState(choice.symbol || (row.reference.legs.length === 1 ? row.reference.legs[0].symbol : '') || row.guidance.suggestion || '')
  const [legs, setLegs] = useState(choice.legs || [{ symbol: '', weight: 1 }])
  const [cost, setCost] = useState((choice.annual_cost || 0) * 100)
  const [effective, setEffective] = useState(choice.effective_date || row.window_start || '')
  const [reason, setReason] = useState(choice.reason || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const strategyAnswer = useStrategyAnswer(row.ticker, row.guidance?.strategy_answer)
  // Radios group by name across the whole page; the panel's editor and the
  // table's dialog (or a second Split View pane) must not share one group.
  const radioGroup = useId()
  const guide = row.guidance
  const price = row.price_screen?.status === 'available' ? row.price_screen : null
  const refName = row.reference.selected || 'the reference'
  const finding = row.finding
  const findingTone = ['neg', 'warn', 'lag'].includes(finding?.tone) ? finding.tone : 'ok'
  const save = async value => {
    setSaving(true)
    setError('')
    try {
      await pf(`/api/nav-assessment/reference/${encodeURIComponent(row.ticker)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
      }).then(readNavJson)
      invalidateNavAssessment()
      onClose?.()
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }
  return (
    <div className="nav-reference-editor" aria-label={`${row.ticker} reference guidance`}>
      <div className="nav-assessment-toolbar">
        <strong>{row.ticker}: NAV check</strong>
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      {finding && (price || row.metrics) && (
        <div className={`nav-finding nav-finding-${findingTone}`}>
          <strong>{finding.label}</strong>
          <p>{finding.reason}</p>
          {isNavLag(finding) && <p className="nav-assessment-note">{NAV_LAG_EXPLAINER}</p>}
          {price && <p className="nav-assessment-note">Dates checked: {price.start} to {price.end}{price.reference_aligned_end && ' (the latest close both the fund and the reference have)'}.</p>}
        </div>
      )}
      <p><strong>Compared with:</strong> {row.reference.selected || 'no reference yet'}{' '}
        <span className="nav-assessment-note">({row.reference.manual ? 'your Include (manual) benchmark' : row.reference.automatic ? (row.reference.inferred ? 'chosen automatically, inferred' : 'chosen automatically') : row.reference.legs?.length ? 'your choice' : 'choose one under Advanced'})</span>
      </p>
      {row.reference.manual && (
        <p className="nav-assessment-note">
          This holding is set to Include (manual) in the holdings table, so it is compared with the benchmark typed there
          {row.reference.automatic_label ? <> instead of the automatic reference, {row.reference.automatic_label}</> : null}.
          Change the benchmark in the table, or set the table back to Include to use the automatic reference.
          A ticker or basket saved under Advanced takes precedence over both.
        </p>
      )}
      {guide.inferred && (
        <p className="nav-assessment-note">
          Not in the reviewed fund list: its type, strategy and reference were inferred from {guide.inferred_from || 'its stored data'}.
          Check the issuer&apos;s documents before relying on them.
        </p>
      )}
      <p><strong>Why it fits:</strong> {row.reference.why}</p>
      <p><strong>Fund type:</strong> {FAMILY_LABELS[guide.family] || guide.family}. <strong>Strategy:</strong> {guide.screen_strategy?.label || 'Not known'}.</p>
      {guide.strategy_source !== 'registry' && (
        <fieldset className="nav-strategy-question">
          <legend>Does this fund sell options?</legend>
          <p className="nav-assessment-note">{STRATEGY_SOURCE_NOTE[guide.strategy_source] || STRATEGY_SOURCE_NOTE.unverified} {guide.screen_strategy?.reason}</p>
          <div className="nav-strategy-options" role="radiogroup" aria-label={`Does ${row.ticker} sell options?`}>
            {STRATEGY_ANSWER_OPTIONS.map(([value, label]) => (
              <label key={value || 'unsure'}>
                <input
                  type="radio"
                  name={radioGroup}
                  value={value}
                  checked={strategyAnswer.value === value}
                  onChange={() => strategyAnswer.choose(value)}
                />
                {value ? label : 'Not sure — detect automatically'}
              </label>
            ))}
          </div>
          <p className="nav-assessment-note">Only funds that sell call options can be labelled covered-call eroders. Your answer applies to this fund in every account; the result at the top updates once the assessment refreshes.</p>
          {strategyAnswer.error && <p role="alert" className="nav-reference-warning">{strategyAnswer.error}</p>}
        </fieldset>
      )}
      {row.reference.legacy_notice && <p className="nav-assessment-note">{row.reference.legacy_notice}</p>}
      {row.reference.warning && <p role="status" className="nav-reference-warning">{row.reference.warning}</p>}
      {price && <details>
        <summary>Month by month ({price.persistence.windows.length} months)</summary>
        <p className="nav-assessment-note">
          Over the whole period: price {navPercent(price.price_change_rate)}, return including payouts {navPercent(price.cash_total_return)},
          paid out {navPercent(price.distribution_rate_on_start)} of the starting price. A month is <strong>flagged</strong> when {refName} was
          flat or up but the fund&apos;s price fell and it kept less capital than {refName} after paying the same cash.
        </p>
        <div className="nav-assessment-table-wrap"><table className="nav-assessment-table">
          <thead><tr><th>Month</th><th>Price change</th><th>Return with payouts</th><th>Paid out</th><th>{refName} return</th><th>Capital vs {refName}</th><th>Flagged?</th></tr></thead>
          <tbody>{price.persistence.windows.map(item => <tr key={item.end}>
            <td>{item.start} to {item.end}</td><td>{navPercent(item.price_change_rate)}</td><td>{navPercent(item.cash_total_return)}</td><td>{navPercent(item.distribution_rate)}</td><td>{navPercent(item.reference_return)}</td><td>{navPercent(item.reference_gap_rate)}</td>
            <td>{item.reference_status !== 'available' ? 'No data'
              : !item.qualifies ? 'No'
                : item.payouts_exceed_reference_return ? `Yes — and paid out more than ${refName} earned` : 'Yes'}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
      <details>
        <summary>How this check works</summary>
        <p className="nav-assessment-note">
          Every completed calendar month in the dates is checked. A month is flagged when the reference returned at least −0.25%,
          the fund&apos;s price fell at least 0.25% (and at least one cent), and after paying out the same cash the fund kept at least
          0.25% less capital than the reference would have. The fund is reported as <strong>Losing capital vs reference</strong> when
          that repeats (two months in a row, or at least two thirds of the flat-or-rising months) and, over the whole period, its price
          fell at least 1% and it ended at least 0.5% behind the reference.
        </p>
        <p className="nav-assessment-note">
          It becomes an <strong>Estimated covered-call eroder</strong> only when it also sells call options and, in those same months,
          paid out more than the reference earned. A fund that sells no options is reported only when its payouts also outran the
          reference, otherwise lagging is weaker performance, not erosion. These are review thresholds, not probabilities.
        </p>
        <p className="nav-assessment-note">{price?.limitation || ''} A market or sector reference is context; it does not reproduce an options strategy.</p>
      </details>
      <details>
        <summary>About the data</summary>
        {row.capital_status === 'unconfirmed' && <p className="nav-assessment-note"><strong>Why published NAV isn&apos;t used:</strong> {row.reason} Until it is, the check above uses market prices. Changing the reference does not supply NAV.</p>}
        {row.reference_result.status === 'available' && <p className="nav-assessment-note">Published-NAV comparison: {navPercent(row.reference_result.capital_gap_rate)} of starting NAV versus {refName} after the same distributions.</p>}
        <p className="nav-assessment-note"><strong>Reference limits:</strong> {guide.limitations}</p>
        <p className="nav-assessment-note">
          {guide.source_url ? <><a href={guide.source_url} target="_blank" rel="noreferrer">Issuer / filing</a> · reviewed {guide.source_checked}.</> : 'Issuer objective and historical exposures have not been reviewed.'}
        </p>
        <p className="nav-assessment-note">To compare with a different ticker, open Advanced, choose Single ticker as context, enter the ticker, then select Save and compare. Restore automatic reference returns to the suggested choice.</p>
      </details>
      {row.persistence?.windows?.length > 0 && <details>
        <summary>Completed-quarter check ({row.persistence.quarters_compared} comparisons)</summary>
        <p className="nav-assessment-note">A persistent review signal requires NAV decline in at least two of the most recent four completed quarters while the exposure reference was flat/rising. The same-cash gap provides additional context; outperformance does not erase repeated capital depletion. A small endpoint decline does not qualify by itself.</p>
        <div className="nav-assessment-table-wrap"><table className="nav-assessment-table">
          <thead><tr><th>Quarter dates</th><th>NAV change</th><th>Reference total return</th><th>Same-cash gap</th><th>NAV down in flat/rising market</th></tr></thead>
          <tbody>{row.persistence.windows.map(item => <tr key={item.end}>
            <td>{item.start} to {item.end}</td><td>{navPercent(item.nav_change_rate)}</td><td>{navPercent(item.reference_return)}</td><td>{navPercent(item.reference_gap_rate)}</td><td>{item.reference_status !== 'available' ? 'Data unavailable' : item.qualifies ? 'Yes — one quarter' : 'No'}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
      {!row.reference.automatic && !row.reference.manual && row.guidance.automatic_legs?.length > 0 && (
        <button type="button" className="btn btn-sm" disabled={saving} onClick={() => save({ mode: 'auto' })}>
          Use automatic reference
        </button>
      )}
      <details>
        <summary>Advanced: choose another reference or custom basket</summary>
      <form onSubmit={event => {
        event.preventDefault()
        save(mode === 'symbol' ? { mode, symbol } : { mode, legs, annual_cost: Number(cost) / 100, effective_date: effective, reason })
      }}>
        <label>Comparison type
          <select value={mode} onChange={event => setMode(event.target.value)}>
            <option value="symbol">Single ticker as context</option>
            <option value="custom">Custom daily exposure basket</option>
          </select>
        </label>
        {mode === 'symbol' ? (
          <label>Reference ticker<input aria-label={`${row.ticker} reference ticker`} value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} placeholder="For example, QQQ" required maxLength={20} /></label>
        ) : <>
          <p className="nav-assessment-note">Fixed exposures reset daily. For a 1x + 1x stack enter 100% on each leg. For a 130% daily target enter 130% on its actual underlying fund. Any unused exposure is modeled as non-interest-bearing cash. Variable exposures or other rebalance schedules need a separate model.</p>
          {legs.map((leg, index) => <div className="nav-reference-leg" key={index}>
            <label>Leg {index + 1} ticker<input required value={leg.symbol} onChange={event => setLegs(values => values.map((v, i) => i === index ? { ...v, symbol: event.target.value.toUpperCase() } : v))} /></label>
            <label>Exposure %<input required type="number" min="0.01" max="300" step="0.01" value={leg.weight * 100} onChange={event => setLegs(values => values.map((v, i) => i === index ? { ...v, weight: Number(event.target.value) / 100 } : v))} /></label>
            {legs.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setLegs(values => values.filter((_, i) => i !== index))}>Remove</button>}
          </div>)}
          {legs.length < 6 && <button type="button" className="btn btn-sm" onClick={() => setLegs(values => [...values, { symbol: '', weight: 1 }])}>Add leg</button>}
          <label>Incremental annual costs %<input type="number" required min="0" max="50" step="0.01" value={cost} onChange={event => setCost(event.target.value)} /></label>
          <p className="nav-assessment-note">Include financing and additional strategy costs. Reference ETF returns already include their own fund expenses; avoid counting them twice. Zero means an explicit assumption of no additional costs.</p>
          <label>Assumptions valid from<input type="date" required value={effective} onChange={event => setEffective(event.target.value)} /></label>
          <label>Why these exposures and costs fit<textarea required minLength={5} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        </>}
        <p className="nav-assessment-note">This is a hypothetical comparison using total-return history and the fund&apos;s actual distribution entitlements. Saving assumptions does not certify a strategy match or prove the cause of NAV decline.</p>
        {error && <p role="alert" className="nav-reference-warning">{error}</p>}
        <div className="nav-assessment-toolbar">
          <button className="btn btn-sm" disabled={saving} type="submit">{saving ? 'Saving…' : 'Save and compare'}</button>
          <button className="btn btn-sm" disabled={saving} type="button" onClick={() => save({ mode: 'auto' })}>Restore automatic reference</button>
        </div>
      </form>
      </details>
    </div>
  )
}
