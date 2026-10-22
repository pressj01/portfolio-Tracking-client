import { useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import { invalidateNavAssessment, navPercent, readNavJson } from '../utils/navAssessment'

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
  const guide = row.guidance
  const price = row.price_screen?.status === 'available' ? row.price_screen : null
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
        <strong>{row.ticker}: reference</strong>
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      <p><strong>{row.reference.manual ? 'Include (manual) benchmark' : row.reference.automatic ? 'Automatic reference' : 'Selected reference'}: {row.reference.selected || 'Needs verification'}</strong></p>
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
      <p className="nav-assessment-note">To enter a different ticker, expand Advanced below, choose Single ticker as context, enter the Reference ticker, then select Save and compare. Restore automatic reference returns to the suggested choice.</p>
      {row.capital_status === 'unconfirmed' && <p className="nav-assessment-note"><strong>Why unconfirmed:</strong> {row.reason} Changing the reference does not supply missing NAV evidence.</p>}
      <p><strong>Why it fits:</strong> {row.reference.why}</p>
      <p><strong>What the fund owns:</strong> {guide.family}.</p>
      <p><strong>Screen category:</strong> {guide.screen_strategy?.label || 'Strategy needs verification'}. {guide.screen_strategy?.reason}</p>
      <p><strong>Important differences:</strong> {guide.limitations}</p>
      <p className="nav-assessment-note">
        {guide.source_url ? <><a href={guide.source_url} target="_blank" rel="noreferrer">Issuer / filing</a> · reviewed {guide.source_checked}.</> : 'Issuer objective and historical exposures need verification.'}
        {' '}A market or sector reference is context. It does not reproduce the complete options strategy.
      </p>
      {row.reference.legacy_notice && <p className="nav-assessment-note">{row.reference.legacy_notice}</p>}
      {row.reference.warning && <p role="status" className="nav-reference-warning">{row.reference.warning}</p>}
      {row.reference_result.status === 'available' && <p>Current comparison: {navPercent(row.reference_result.capital_gap_rate)} of starting NAV after the same dated distributions. Choosing a reference changes this comparison, not the fund&apos;s NAV accounting.</p>}
      {price && <details open>
        <summary>Price-based persistence and payout check — {price.label}</summary>
        <p className="nav-assessment-note">Selected-window price change {navPercent(price.price_change_rate)}; return including cash payouts {navPercent(price.cash_total_return)}; cash paid / starting price {navPercent(price.distribution_rate_on_start)}. Split-adjusted market prices are used here, not published NAV.</p>
        <p className="nav-assessment-note">Actual comparison dates: {price.start} to {price.end}.{price.reference_aligned_end && ' The latest common fund/reference close is used because a newer reference close is not yet available.'}</p>
        <p className="nav-assessment-note">{price.reason} All completed calendar months within these dates are checked. A qualifying month needs a reference return ≥ −0.25%, a fund price decline ≥ 0.25% (and at least one cent), and a same-cash reference shortfall ≥ 0.25%. Persistence needs two consecutive qualifying months, or at least two making up two-thirds of usable flat/rising-reference months. Estimated covered-call eroder additionally requires a documented call-income strategy, persistent payouts above reference returns in those same months, a selected-window price decline ≥ 1%, and a same-cash shortfall ≥ 0.5%. These are review thresholds, not calibrated probabilities.</p>
        <div className="nav-assessment-table-wrap"><table className="nav-assessment-table">
          <thead><tr><th>Dates</th><th>Price change</th><th>Fund return with payouts</th><th>Cash paid / start</th><th>Reference total return</th><th>Same-cash gap</th><th>Qualifies including payout test</th></tr></thead>
          <tbody>{price.persistence.windows.map(item => <tr key={item.end}>
            <td>{item.start} to {item.end}</td><td>{navPercent(item.price_change_rate)}</td><td>{navPercent(item.cash_total_return)}</td><td>{navPercent(item.distribution_rate)}</td><td>{navPercent(item.reference_return)}</td><td>{navPercent(item.reference_gap_rate)}</td><td>{item.reference_status !== 'available' ? 'Reference unavailable' : item.qualifies && item.payouts_exceed_reference_return ? 'Yes' : 'No'}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="nav-assessment-note">Payouts versus total return are an accounting clue, not independent proof. Stock dividend yield and a fund&apos;s SEC yield exclude parts of option-income results. {price.limitation}</p>
      </details>}
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
