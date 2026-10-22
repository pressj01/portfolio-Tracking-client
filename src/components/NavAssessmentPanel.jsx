import { useState } from 'react'
import { useNavAssessment, navMoney, navPercent, NAV_STATUS } from '../utils/navAssessment'
import NavErosionHelp from './NavErosionHelp'
import NavReferenceEditor from './NavReferenceEditor'
import './NavAssessment.css'
import { PERFORMANCE_PERIODS, customRangeError, formatPerformanceRange, isLifetimePerformancePeriod } from '../utils/performancePeriods'

export default function NavAssessmentPanel({ period = '1y', start = '', end = '' }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const rangeError = customRangeError(period, start, end)
  const isCostBasis = isLifetimePerformancePeriod(period)
  const enabled = !isCostBasis && !rangeError
  const { data, error, loading, refresh, selection } = useNavAssessment({ period, start, end }, { enabled })
  const rangeLabel = PERFORMANCE_PERIODS.find(option => option.key === period)?.label || period
  const summary = data?.summary
  const preliminary = data?.preliminary
  const rows = (data?.results || []).filter(row => (
    (filter === 'all' || (filter === 'price_review' ? row.price_screen?.review_candidate : filter === 'reference' ? Boolean(row.reference.warning) || !row.reference.legs.length : row.capital_status === filter))
    && `${row.ticker} ${row.description}`.toLowerCase().includes(search.toLowerCase())
  ))
  const active = data?.results.find(row => row.ticker === selected)
  return (
    <section className="nav-assessment" aria-label="NAV, distributions and references">
      <div className="nav-assessment-toolbar">
        <strong>NAV, distributions and references</strong>
        <span className="nav-assessment-note">Shared range: <strong>{rangeLabel}</strong></span>
        <button type="button" className="btn btn-sm" disabled={loading || !enabled} onClick={refresh}>Refresh assessment</button>
      </div>
      {isCostBasis && <p role="status" className="nav-assessment-note">NAV assessment needs a date range. Open G/L is based on the cost of your current shares. Choose YTD, another market period, or Custom above to assess NAV over that same range.</p>}
      {rangeError && <p role="status" className="nav-assessment-note">Choose a valid shared custom date range above to assess NAV.</p>}
      {data && <p className="nav-assessment-note">Assessment range: {formatPerformanceRange(data.requested_start, data.as_of)}. Published NAV may lag live market quotes; each holding shows its actual NAV dates. Younger funds use their shorter available history.</p>}
      {enabled && ['1d', '7d', '1m', '3m'].includes(period) && <p className="nav-assessment-note">Price and payout metrics follow this range. The erosion screen needs at least two completed calendar months; shorter ranges cannot establish persistence. The separate verified-NAV check needs two completed quarters.</p>}
      <p className="nav-assessment-note">NAV decline, distributions and reference performance are assessed separately. A falling underlying market alone does not establish destructive erosion.</p>
      {loading && <p role="status">Loading NAV, closing prices, distributions and references…</p>}
      {error && <p role="alert" className="nav-reference-warning">{error} <button type="button" className="btn btn-sm" onClick={refresh}>Retry</button></p>}
      {summary && data.overall && <>
        {preliminary && <div className="card nav-overall-assessment">
          <strong>Account erosion assessment: {preliminary.title}</strong>
          {preliminary.estimated_eroder_count > 0 && <p><strong>{preliminary.estimated_eroder_count} estimated covered-call eroder{preliminary.estimated_eroder_count === 1 ? '' : 's'} · {navMoney(preliminary.estimated_eroder_value)} · {navPercent(preliminary.estimated_eroder_account_share)} of current account value.</strong> These call-income holdings meet the material decline, repeated payout and same-cash reference shortfall rules. This is a price-based review signal, not verified NAV causation.</p>}
          <p className="nav-assessment-note">{preliminary.covered_count} of {preliminary.applicable_count} applicable holdings have price-based metrics, covering {navPercent(preliminary.value_coverage)} of applicable holding value. Published NAV is verified separately below.</p>
          <p className="nav-assessment-note">{preliminary.reference_covered_count} have an aligned reference comparison; {preliminary.persistence_evaluable_count} have at least two flat/rising-reference intervals to evaluate persistence.</p>
          <p className="nav-assessment-note">{preliminary.covered_call_count} holdings have a documented call-income strategy. Treasury/credit funds, put overlays and other strategies retain capital and payout metrics without receiving a covered-call eroder label.</p>
          {preliminary.candidates.length > 0 ? <>
            <strong className="nav-reference-warning">Holdings to investigate — price-based estimates</strong>
            <ul>{preliminary.candidates.map(item => <li key={item.ticker}>
              <button type="button" className="btn btn-sm" onClick={() => { setDetailsOpen(true); setSelected(item.ticker); setFilter('all'); setSearch(item.ticker) }}>{item.ticker}</button>
              {' '}<strong>{item.label}</strong> · {item.strategy} · price change {navPercent(item.price_change_rate)}. {item.reason} Reference fit: {item.reference_fit}.
            </li>)}</ul>
          </> : <p className="nav-assessment-note">No repeated price-based signal was established in the covered holdings. This does not establish NAV preservation or clear holdings with missing evidence.</p>}
          {preliminary.priority_holdings && <details className="nav-assessment-note">
            <summary>High-payout watchlist: {preliminary.priority_holdings.length} holdings above 15%, excluding crypto</summary>
            <p>This prioritizes review using current estimated annual payouts, regardless of the selected historical range. A high payout alone is not an erosion finding. Crypto-related holdings, including crypto-company equities and stacked crypto exposures, are excluded from this priority list; their metrics remain in the assessment.</p>
            <div className="nav-assessment-table-wrap"><table className="nav-assessment-table">
              <thead><tr><th>Holding</th><th>Estimated annual payout</th><th>Selected-window assessment</th><th>Price change</th><th>Same-cash reference gap</th></tr></thead>
              <tbody>{preliminary.priority_holdings.map(item => <tr key={item.ticker}>
                <td><button type="button" className="btn btn-sm" onClick={() => { setDetailsOpen(true); setSelected(item.ticker); setFilter('all'); setSearch(item.ticker) }}>{item.ticker}</button></td>
                <td>{navPercent(item.annual_rate)}</td><td>{item.label}<small>{item.reason}</small></td><td>{navPercent(item.price_change_rate)}</td><td>{navPercent(item.reference_gap_rate)}</td>
              </tr>)}</tbody>
            </table></div>
            {preliminary.priority_rate_unavailable_tickers?.length > 0 && <p>Annual payout estimate unavailable: {preliminary.priority_rate_unavailable_tickers.join(', ')}. These holdings are not assumed below 15%.</p>}
          </details>}
          <div className="nav-assessment-cards">
            {[
              ['Price change estimate', preliminary.weighted_price_change_rate],
              ['Return with cash payouts', preliminary.weighted_cash_total_return],
              ['Cash paid / starting price', preliminary.weighted_distribution_rate],
              ['Fund value screened', preliminary.value_coverage],
            ].map(([label,value]) => <div className="summary-card" key={label}><div className="summary-label">{label}</div><div className="summary-value">{navPercent(value)}</div></div>)}
          </div>
          <p className="nav-assessment-note">{preliminary.limitation} Cash payouts are historical, not an annualized yield. Exchange prices can differ from NAV, especially for CEFs, BDCs and REITs. A weak reference limits the interpretation.</p>
          {preliminary.missing_tickers.length > 0 && <p className="nav-assessment-note">Price metrics unavailable or skipped: {preliminary.missing_tickers.join(', ')}.</p>}
          {preliminary.reference_unavailable_tickers?.length > 0 && <details className="nav-assessment-note"><summary>Reference comparisons still need data</summary><p>{preliminary.reference_unavailable_tickers.join(', ')}. Their price and payout metrics remain available; an erosion label is withheld when reference evidence is unavailable.</p></details>}
          {preliminary.strategy_unverified_tickers?.length > 0 && <details className="nav-assessment-note"><summary>Strategies still need verification</summary><p>{preliminary.strategy_unverified_tickers.join(', ')}. Price and reference results remain available, but these holdings cannot be classified as covered-call eroders until their strategy is documented.</p></details>}
        </div>}
        <div className="card nav-overall-assessment" role="status">
          <strong>Verified NAV assessment: {data.overall.title}</strong>
          <p className="nav-assessment-note">{data.overall.assessed_count} of {data.overall.applicable_count} applicable holdings have verified NAV accounting.{data.overall.partial ? ' Partial coverage: a complete portfolio-wide verdict is unavailable.' : ''}</p>
          {data.overall.candidates.length > 0 ? <>
            <strong className="nav-reference-warning">Potential erosion candidates</strong>
            <ul>{data.overall.candidates.map(item => <li key={item.ticker}>
              <button type="button" className="btn btn-sm" onClick={() => { setDetailsOpen(true); setSelected(item.ticker); setFilter('all'); setSearch(item.ticker) }}>{item.ticker}</button>
              {' '}NAV {navPercent(item.nav_change_rate)} · same-cash reference gap {navPercent(item.reference_gap_rate)}. {item.reason}
            </li>)}</ul>
          </> : <p className="nav-assessment-note">{data.overall.partial ? 'A full NAV conclusion is withheld. Use the preliminary price-based results above to identify holdings needing review.' : 'No persistent NAV erosion signal was established by the available reference screen.'}</p>}
          {data.overall.payout_pressure_tickers.length > 0 && <details className="nav-assessment-note">
            <summary>Cash payout accounting — not an erosion warning</summary>
            <p>{data.overall.payout_pressure_tickers.join(', ')} paid more cash than the selected period&apos;s positive economic result replenished. This can reflect the market path and payout timing. These tickers are not added to the erosion watchlist on that basis.</p>
          </details>}
          <p className="nav-assessment-note">{data.overall.explanation}</p>
        </div>
        <div className="nav-assessment-cards">
          {[['declined', 'Observed NAV decline'], ['preserved', 'Capital preserved / within precision'], ['unconfirmed', 'NAV unconfirmed'], ['not_applicable', 'Not applicable']].map(([key, label]) => {
            const state = summary.states[key]
            return <div className="summary-card" key={key}>
              <div className="summary-label">{label}</div>
              <div className="summary-value">{state.share == null ? navMoney(state.value) : navPercent(state.share)}</div>
              <div className="summary-sub">{state.count} holding{state.count === 1 ? '' : 's'} · {navMoney(state.value)}</div>
            </div>
          })}
        </div>
        <p className="nav-assessment-note">
          Current exposure in {navMoney(summary.account_value)} account value, including {navMoney(summary.cash)} cash shown separately.
          {' '}These are holding diagnostics, not your historical account return. Each holding&apos;s actual NAV dates appear below.
          {!summary.value_coverage_complete && ' Current-value coverage is incomplete; percentages are withheld.'}
        </p>
        <p className="nav-assessment-note">
          {summary.reference_available} of {data.results.filter(row => row.capital_status !== 'not_applicable').length} applicable holdings have a calculated reference comparison.
          {' '}{summary.reference_needs_review} need reference selection or review.
          {summary.states.unconfirmed.count > 0 && ' Unconfirmed holdings remain in the account denominator. Published NAV, complete distributions or share adjustments still need verification.'}
        </p>
        <details className="card nav-assessment-details" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
          <summary>Review holdings and references ({data.results.length})</summary>
          <div className="nav-assessment-toolbar">
            <label>Show <select aria-label="Filter NAV assessments" value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">All holdings</option><option value="price_review">Price-based review candidates</option><option value="declined">Verified NAV declined</option><option value="unconfirmed">NAV not verified</option><option value="reference">Reference needs review</option><option value="not_applicable">Not applicable</option>
            </select></label>
            <label>Find holding <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Ticker or name" /></label>
          </div>
          {active && <NavReferenceEditor key={`${selection}:${active.ticker}`} row={active} onClose={() => setSelected(null)} />}
          <div className="nav-assessment-table-wrap">
            <table className="nav-assessment-table">
              <thead><tr><th>Holding</th><th>Assessment and evidence</th><th>Evidence dates</th><th>NAV / price change</th><th>Cash paid / share</th><th>Return with cash payouts</th><th>Same-cash reference gap</th><th>Reference and fit</th></tr></thead>
              <tbody>{rows.map(row => {
                const price = row.price_screen?.status === 'available' ? row.price_screen : null
                const metrics = row.metrics
                const ref = metrics ? row.reference_result : price?.reference_result || row.reference_result
                const first = metrics ? row.window_start : price?.start
                const last = metrics ? row.window_end : price?.end
                return <tr key={row.ticker}>
                <td><strong>{row.ticker}</strong></td>
                <td><strong>{metrics || !price ? NAV_STATUS[row.capital_status] || 'Unconfirmed' : `${price.label} · NAV not verified`}</strong>{row.erosion_review && <small className="nav-reference-warning">Potential NAV erosion — review</small>}{price?.review_candidate && <small className="nav-reference-warning">{price.label}</small>}<small>{metrics || !price ? row.reason : price.reason}</small>{!metrics && <small>{row.reason}</small>}{metrics && row.persistence && <small>{row.persistence.quarters_compared} completed quarters compared · {row.persistence.qualifying_quarters} NAV declines in flat/rising reference markets</small>}{price && <small>{price.persistence.intervals_compared} {price.persistence.cadence}s compared · {price.persistence.qualifying_intervals} price declines in flat/rising reference periods · {price.persistence.joint_qualifying_intervals} also paid above reference return</small>}{(metrics ? row.source : price?.source) && <small><a href={(metrics ? row.source : price.source).url} target="_blank" rel="noreferrer">{(metrics ? row.source : price.source).label}</a></small>}</td>
                <td>{first ? <>{first}<br />{last}{(metrics ? row.shorter_history : price?.shorter_history) && <small>Shorter available history</small>}</> : '—'}</td>
                <td>{navPercent(metrics?.capital_change_rate ?? price?.price_change_rate)}<small>{metrics ? 'Published NAV' : price ? 'Market price estimate' : ''}</small></td>
                <td>{navMoney(metrics ? metrics.investment_result - metrics.capital_change : price?.cash_paid)}<small>{metrics ? 'Per original share' : price ? 'Split-restated share basis' : ''}</small></td>
                <td>{navPercent(metrics?.cash_total_return ?? price?.cash_total_return)}</td>
                <td>{ref.status === 'available' ? <>{navPercent(ref.capital_gap_rate)}<small>of starting {metrics ? 'NAV' : 'price'} · {ref.comparison.replaceAll('_', ' ')}</small></> : <>{ref.status.replaceAll('_', ' ')}<small>{ref.reason}</small></>}</td>
                <td><strong>{row.reference.selected || (row.capital_status === 'not_applicable' ? 'Not applicable' : 'Needs verification')}</strong><small>{row.reference.automatic ? 'Automatic · ' : ''}{row.reference.fit}</small>{row.reference.warning && <small className="nav-reference-warning">{row.reference.warning}</small>}
                  {row.capital_status !== 'not_applicable' && <button type="button" className="btn btn-sm" onClick={() => setSelected(row.ticker)}>Reference details</button>}
                </td>
              </tr>})}</tbody>
            </table>
          </div>
          {!rows.length && <p>No holdings match these filters.</p>}
        </details>
      </>}
      <NavErosionHelp />
    </section>
  )
}
