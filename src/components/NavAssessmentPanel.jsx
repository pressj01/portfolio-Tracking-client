import { useId, useState } from 'react'
import { useNavAssessment, isNavLag, navMoney, navPercent, navProbability, NAV_LAG_EXPLAINER, strategyInQuestion } from '../utils/navAssessment'
import NavErosionHelp from './NavErosionHelp'
import { NavFindingLabel, NavLagNote } from './NavFinding'
import NavReferenceEditor from './NavReferenceEditor'
import './NavAssessment.css'
import { PERFORMANCE_PERIODS, customRangeError, formatPerformanceRange, isLifetimePerformancePeriod } from '../utils/performancePeriods'

// One sentence that reads the three averages together: paid out + price
// change = total return.
function describeFundAverages(preliminary) {
  const paid = preliminary?.weighted_distribution_rate
  const price = preliminary?.weighted_price_change_rate
  const total = preliminary?.weighted_cash_total_return
  if ([paid, price, total].some(value => value == null)) return null
  const pct = value => `${Math.abs(Number(value) * 100).toFixed(1)}%`
  const sentence = `Across the funds checked, weighted by how much you hold of each: they paid out ${pct(paid)} of their starting price in cash, `
    + `and their prices ${price < 0 ? 'fell' : 'rose'} ${pct(price)}, so overall they ${total < 0 ? 'lost' : 'returned'} ${pct(total)}.`
  return price < 0 && paid > 0
    ? `${sentence} Prices falling while payouts stay high is what this screen looks into fund by fund; the average on its own does not show erosion.`
    : sentence
}

// Why funds lack verified NAV, grouped by what is missing.
function navCoverage(results) {
  const applicable = results.filter(row => row.capital_status !== 'not_applicable')
  const unverified = applicable.filter(row => !row.metrics)
  const kind = row => row.guidance?.security_kind
  const cef = unverified.filter(row => kind(row) === 'cef')
  const quarterly = unverified.filter(row => ['bdc', 'reit'].includes(kind(row))).length
  const noSource = unverified.filter(row => kind(row) === 'fund' && row.nav_erosion_scope !== 'skip'
    && String(row.reason || '').startsWith('Published NAV and complete')).length
  const noHistory = unverified.filter(row => String(row.reason || '').startsWith('NEOS does not publish')).length
  return {
    applicable: applicable.length, unverified: unverified.length, cef: cef.length, quarterly, noSource, noHistory,
    other: unverified.length - cef.length - quarterly - noSource - noHistory,
    cefBlocked: cef.some(row => String(row.reason || '').startsWith('CEF Connect')),
  }
}

function describeNavStates(summary) {
  const states = summary?.states
  if (!states || states.unconfirmed.share == null) return null
  const share = key => `${(states[key].share * 100).toFixed(1)}%`
  const verified = states.declined.count + states.preserved.count
  if (!verified) {
    return `None of your funds have published NAV the app can check yet, so ${share('unconfirmed')} of your account is checked with market prices only.`
  }
  return `Of your account: ${share('declined')} is in funds whose published NAV fell, ${share('preserved')} in funds whose published NAV held up, `
    + `and ${share('unconfirmed')} in funds with no published NAV to check, which are judged on market prices only.`
}

export default function NavAssessmentPanel({ period = '1y', start = '', end = '' }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [verdictOpen, setVerdictOpen] = useState(false)
  // Split View mounts a page twice, so the id must be unique per mount.
  const drilldownId = useId()
  const rangeError = customRangeError(period, start, end)
  const isCostBasis = isLifetimePerformancePeriod(period)
  const enabled = !isCostBasis && !rangeError
  const { data, error, loading, refresh, selection } = useNavAssessment({ period, start, end }, { enabled })
  const rangeLabel = PERFORMANCE_PERIODS.find(option => option.key === period)?.label || period
  const summary = data?.summary
  const preliminary = data?.preliminary
  const verdict = data?.verdict
  const groupSentence = describeFundAverages(preliminary)
  const coverage = navCoverage(data?.results || [])
  const statesSentence = describeNavStates(summary)
  const rows = (data?.results || []).filter(row => (
    (filter === 'all' || (filter === 'price_review' ? row.price_screen?.review_candidate
      : filter === 'nav_lag' ? isNavLag(row.finding)
      : filter === 'reference' ? Boolean(row.reference.warning) || !row.reference.legs.length
        : filter === 'strategy' ? strategyInQuestion(row) && row.capital_status !== 'not_applicable'
          : row.capital_status === filter))
    && `${row.ticker} ${row.description}`.toLowerCase().includes(search.toLowerCase())
  ))
  const active = data?.results.find(row => row.ticker === selected)
  const openHolding = ticker => {
    setDetailsOpen(true)
    setSelected(ticker)
    setFilter('all')
    setSearch(ticker)
  }
  const implicated = verdict?.holdings?.implicated || []
  const lagging = verdict?.nav_lag || []
  const reduction = verdict?.reduction
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
        {verdict && (
          <div className={`nav-verdict-row${verdictOpen ? ' is-open' : ''}`}>
            <div
              className={`summary-card nav-verdict-card nav-verdict-${verdict.strength}`}
              role="status"
              title={verdict.explanation}
            >
              <div className="summary-label">Portfolio NAV Erosion</div>
              <div className="summary-value">{verdict.label}</div>
              <div className="summary-sub">{navProbability(verdict.probability)} evidence probability</div>
              <div className="summary-sub">{verdict.summary}</div>
              {lagging.length > 0 && <div className="summary-sub ci-nav-tone-lag" title={NAV_LAG_EXPLAINER}>
                {lagging.length} covered-call fund{lagging.length === 1 ? '' : 's'} with NAV lag, not counted as erosion
              </div>}
              <button
                type="button"
                className="nav-verdict-link"
                aria-expanded={verdictOpen}
                aria-controls={drilldownId}
                onClick={() => setVerdictOpen(open => !open)}
              >
                {verdictOpen ? 'Hide details'
                  : verdict.strength === 'strong' ? 'See holdings and how to get under 50%'
                    : implicated.length ? `See the ${implicated.length} holding${implicated.length === 1 ? '' : 's'} behind this reading`
                      : 'Why this reading'}
              </button>
            </div>
            {verdictOpen && <div className="card nav-verdict-drilldown" id={drilldownId}>
              <strong>Holdings behind this reading ({implicated.length})</strong>
              {implicated.length === 0 ? (
                <p className="nav-assessment-note">No estimated eroders, verified persistent candidates, or price-based review candidates in this account.</p>
              ) : (
                <ul className="nav-verdict-holding-list">
                  {implicated.map(item => (
                    <li key={`${item.role}-${item.ticker}`}>
                      <button type="button" className="btn btn-sm" onClick={() => openHolding(item.ticker)}>{item.ticker}</button>
                      {' '}<strong>{item.label}</strong>
                      {item.value_share != null && <> · {navPercent(item.value_share)} of account</>}
                      {item.current_value != null && <> · {navMoney(item.current_value)}</>}
                      {item.reason && <small>{item.reason}</small>}
                    </li>
                  ))}
                </ul>
              )}
              {lagging.length > 0 && <>
                <strong className="ci-nav-tone-lag">NAV lag — not erosion ({lagging.length})</strong>
                <p className="nav-assessment-note">{NAV_LAG_EXPLAINER}</p>
                <ul className="nav-lag-list">
                  {lagging.map(item => (
                    <li key={item.ticker}>
                      <button type="button" className="btn btn-sm" onClick={() => openHolding(item.ticker)}>{item.ticker}</button>
                      {' '}{item.detail}
                      {item.value_share != null && <> · {navPercent(item.value_share)} of account</>}
                      {item.reason && <small>{item.reason}</small>}
                    </li>
                  ))}
                </ul>
              </>}
              {reduction && (
                <>
                  <strong>{reduction.under_50 ? 'Evidence probability' : 'How to get the evidence probability under 50%'}</strong>
                  <p className="nav-assessment-note">{reduction.headline}</p>
                  <ul>{(reduction.steps || []).map(step => <li key={step}>{step}</li>)}</ul>
                </>
              )}
            </div>}
          </div>
        )}
        {preliminary && <details className="card nav-overall-assessment">
          <summary>Account erosion assessment: {preliminary.title}</summary>
          {preliminary.estimated_eroder_count > 0 && <p><strong>{preliminary.estimated_eroder_count} estimated covered-call eroder{preliminary.estimated_eroder_count === 1 ? '' : 's'} · {navMoney(preliminary.estimated_eroder_value)} · {navPercent(preliminary.estimated_eroder_account_share)} of current account value.</strong> These call-income holdings meet the material decline, repeated payout and same-cash reference shortfall rules. This is a price-based review signal, not verified NAV causation.</p>}
          <p className="nav-assessment-note">
            {preliminary.covered_count} of {preliminary.applicable_count} funds had enough price history to check ({navPercent(preliminary.value_coverage)} of their value).
            {' '}{preliminary.reference_covered_count} could be compared with a reference fund, and {preliminary.persistence_evaluable_count} had at least two months when the reference was flat or up, which the repeat test needs.
            {' '}{preliminary.covered_call_count} sell call options; the others (Treasury, credit and put-selling funds, for example) still get the capital and payout check but can&apos;t be labelled covered-call eroders. Published NAV is checked separately below.
          </p>
          {preliminary.candidates.length > 0 ? <>
            <strong className="nav-reference-warning">Holdings to investigate — price-based estimates</strong>
            <ul>{preliminary.candidates.map(item => <li key={item.ticker}>
              <button type="button" className="btn btn-sm" onClick={() => openHolding(item.ticker)}>{item.ticker}</button>
              {' '}<strong>{item.label}</strong> · {item.strategy} · price change {navPercent(item.price_change_rate)}. {item.reason} Reference fit: {item.reference_fit}.
            </li>)}</ul>
          </> : <p className="nav-assessment-note">No repeated price-based signal was established in the covered holdings. This does not establish NAV preservation or clear holdings with missing evidence.</p>}
          {preliminary.priority_holdings && <details className="nav-assessment-note">
            <summary>Funds paying over 15% a year ({preliminary.priority_holdings.length}, crypto not included)</summary>
            <p>
              A list to look at first, not a finding. It uses each holding&apos;s current yearly payout estimate (its estimated annual income
              divided by its current value), whatever dates are selected above. Paying a lot is not erosion by itself; the table shows how
              each fund did in the check. Crypto funds, including crypto-company and stacked crypto funds, are left off this list but are
              still checked.
            </p>
            <div className="nav-assessment-table-wrap"><table className="nav-assessment-table">
              <thead><tr><th>Holding</th><th>Yearly payout estimate</th><th>Result for these dates</th><th>Price change</th><th>Capital vs reference</th></tr></thead>
              <tbody>{preliminary.priority_holdings.map(item => <tr key={item.ticker}>
                <td><button type="button" className="btn btn-sm" onClick={() => openHolding(item.ticker)}>{item.ticker}</button></td>
                <td>{navPercent(item.annual_rate)}</td><td>{item.label}<small>{item.reason}</small></td><td>{navPercent(item.price_change_rate)}</td><td>{navPercent(item.reference_gap_rate)}</td>
              </tr>)}</tbody>
            </table></div>
            {preliminary.priority_rate_unavailable_tickers?.length > 0 && <p>No yearly payout estimate yet: {preliminary.priority_rate_unavailable_tickers.join(', ')}. They are not assumed to be under 15%.</p>}
          </details>}
          {groupSentence && <p className="nav-cards-lead">{groupSentence}</p>}
          <div className="nav-assessment-cards">
            {[
              ['Paid out in cash', preliminary.weighted_distribution_rate, 'Distributions paid over these dates, as a share of the starting price'],
              ['Price change', preliminary.weighted_price_change_rate, 'Market price only, with payouts not added back'],
              ['Total return', preliminary.weighted_cash_total_return, 'Paid out + price change, payouts not reinvested'],
              ['Funds covered', preliminary.value_coverage, `Share of your fund holdings' value with enough price history for this check`],
            ].map(([label, value, sub]) => (
              <div className="summary-card" key={label}>
                <div className="summary-label">{label}</div>
                <div className="summary-value">{navPercent(value)}</div>
                <div className="summary-sub">{sub}</div>
              </div>
            ))}
          </div>
          <p className="nav-assessment-note">
            These are averages across the funds you hold now, weighted by how much you hold of each, over the dates selected above. They
            are not your account&apos;s actual return: buys, sells and cash are left out, and a fund held for less time uses the dates it has.
            Market prices are used, which can differ from NAV, especially for closed-end funds, BDCs and REITs. Paid out is what was paid in
            these dates, not a yearly yield.
          </p>
          {preliminary.missing_tickers.length > 0 && <p className="nav-assessment-note">No price history for this check: {preliminary.missing_tickers.join(', ')}.</p>}
          {preliminary.reference_unavailable_tickers?.length > 0 && <details className="nav-assessment-note"><summary>Funds with no comparison yet ({preliminary.reference_unavailable_tickers.length})</summary><p>{preliminary.reference_unavailable_tickers.join(', ')}. Their price and payout numbers are shown above, but with no reference fund to compare against they can&apos;t be flagged either way. Choose a reference under Reference details, or wait for the missing price data.</p></details>}
          {preliminary.strategy_unverified_tickers?.length > 0 && <details className="nav-assessment-note"><summary>Strategies the app could not detect ({preliminary.strategy_unverified_tickers.length})</summary><p>{preliminary.strategy_unverified_tickers.join(', ')}. Neither the reviewed list, the fund&apos;s disclosed option positions nor its name or category said whether it sells options. Price and reference results remain available, but these holdings cannot be labelled covered-call eroders until you answer <strong>Sells call options?</strong> in the holdings table or under Reference details.</p></details>}
        </details>}
        <details className="card nav-overall-assessment" role="status">
          <summary>Verified NAV assessment: {data.overall.title}</summary>
          <p className="nav-cards-lead">
            <strong>{data.overall.assessed_count} of {data.overall.applicable_count} funds</strong> have published NAV the app can check.
            {' '}Verified means the fund&apos;s own NAV per share, every distribution and any splits were all available, so lost capital
            is measured directly rather than estimated from market prices.
            {data.overall.partial && ' Because the rest are not verified, this section cannot give a whole-portfolio verdict; the price-based check above covers them.'}
          </p>
          {coverage.unverified > 0 && (
            <>
              <p className="nav-assessment-note"><strong>Why the other {coverage.unverified} aren&apos;t verified:</strong></p>
              <ul className="nav-coverage-reasons">
                {coverage.noSource > 0 && <li><strong>{coverage.noSource}</strong> fund{coverage.noSource === 1 ? '' : 's'}: the app has no published-NAV source for their issuer yet. It has one for TappAlpha and NEOS funds.</li>}
                {coverage.noHistory > 0 && <li><strong>{coverage.noHistory}</strong> NEOS fund{coverage.noHistory === 1 ? '' : 's'}: NEOS shows only today&apos;s NAV for {coverage.noHistory === 1 ? 'it' : 'them'}, not a daily history, so a date range can&apos;t be checked yet.</li>}
                {coverage.cef > 0 && <li><strong>{coverage.cef}</strong> closed-end fund{coverage.cef === 1 ? '' : 's'}: published NAV comes from CEF Connect, and its full distribution history isn&apos;t read yet{coverage.cefBlocked ? '; CEF Connect is also refusing the app’s requests right now' : ''}.</li>}
                {coverage.quarterly > 0 && <li><strong>{coverage.quarterly}</strong> BDC{coverage.quarterly === 1 ? '' : 's'} or mortgage REIT{coverage.quarterly === 1 ? '' : 's'}: these report NAV or book value quarterly, and the app doesn&apos;t fetch those reports yet.</li>}
                {coverage.other > 0 && <li><strong>{coverage.other}</strong> other{coverage.other === 1 ? '' : 's'}: skipped, unidentified, or the source had stale or incomplete data. Reference details on each holding says which.</li>}
              </ul>
              <p className="nav-assessment-note">
                Nothing in your settings changes this number. It goes up as the app adds NAV sources for more fund issuers, closed-end
                funds and BDCs.
              </p>
            </>
          )}
          {data.overall.candidates.length > 0 ? <>
            <strong className="nav-reference-warning">Potential erosion candidates</strong>
            <ul>{data.overall.candidates.map(item => <li key={item.ticker}>
              <button type="button" className="btn btn-sm" onClick={() => openHolding(item.ticker)}>{item.ticker}</button>
              {' '}NAV {navPercent(item.nav_change_rate)} · same-cash reference gap {navPercent(item.reference_gap_rate)}. {item.reason}
            </li>)}</ul>
          </> : <p className="nav-assessment-note">{data.overall.assessed_count
            ? `None of the ${data.overall.assessed_count} verified fund${data.overall.assessed_count === 1 ? '' : 's'} showed repeated NAV erosion.`
            : 'No fund has verified NAV yet, so this section has nothing to flag.'}</p>}
          {data.overall.payout_pressure_tickers.length > 0 && <details className="nav-assessment-note">
            <summary>Paid out more than they earned this period (not a warning)</summary>
            <p>{data.overall.payout_pressure_tickers.join(', ')} paid out more cash than they earned over these dates, so their NAV per share ended lower. That can just reflect when the market fell and when payouts landed, so it does not flag them on its own.</p>
          </details>}
          <p className="nav-assessment-note">
            A verified fund is flagged here only when its published NAV fell in at least two of the last four completed quarters while
            its reference was flat or up. One bad quarter, a small end-to-end dip or a falling market does not count.
          </p>
        </details>
        {statesSentence && <p className="nav-cards-lead">{statesSentence}</p>}
        <div className="nav-assessment-cards">
          {[
            ['declined', 'Published NAV fell', 'Verified NAV per share ended lower than it started'],
            ['preserved', 'Published NAV held up', 'Verified NAV per share ended level or higher, within rounding'],
            ['unconfirmed', 'No published NAV to check', 'Checked with market prices only, in the price-based results above'],
            ['not_applicable', 'Not a fund', 'Stocks, preferreds and money-market funds the NAV check skips'],
          ].map(([key, label, sub]) => {
            const state = summary.states[key]
            return <div className="summary-card" key={key}>
              <div className="summary-label">{label}</div>
              <div className="summary-value">{state.share == null ? navMoney(state.value) : navPercent(state.share)}</div>
              <div className="summary-sub">{state.count} holding{state.count === 1 ? '' : 's'} · {navMoney(state.value)}</div>
              <div className="summary-sub">{sub}</div>
            </div>
          })}
        </div>
        <p className="nav-assessment-note">
          Percentages are shares of your whole account today, {navMoney(summary.account_value)}, which includes {navMoney(summary.cash)} of
          cash that is in none of the boxes. They describe what you hold now, not your account&apos;s past return.
          {!summary.value_coverage_complete && ' Some holdings have no current value, so percentages are withheld.'}
        </p>
        <p className="nav-assessment-note">
          {summary.reference_available} of {coverage.applicable} funds have a published-NAV comparison with a reference fund; the
          price-based check above compares the rest.
          {summary.reference_needs_review > 0 && ` ${summary.reference_needs_review} still need a reference chosen or reviewed.`}
        </p>
        <details className="card nav-assessment-details" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
          <summary>Review holdings and references ({data.results.length})</summary>
          <div className="nav-assessment-toolbar">
            <label>Show <select aria-label="Filter NAV assessments" value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">All holdings</option><option value="price_review">Price-based review candidates</option><option value="nav_lag">NAV lag (not erosion)</option><option value="declined">Verified NAV declined</option><option value="unconfirmed">NAV not verified</option><option value="reference">Reference needs review</option><option value="strategy">Strategy needs your answer</option><option value="not_applicable">Not applicable</option>
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
                const reasons = [...new Set([row.finding?.reason, metrics ? row.reason : price?.reason, metrics ? null : row.reason].filter(Boolean))]
                const last = metrics ? row.window_end : price?.end
                return <tr key={row.ticker}>
                <td><strong>{row.ticker}</strong></td>
                <td><NavFindingLabel finding={row.finding} title="" />{!metrics && price && <small>Market prices · NAV not verified</small>}{isNavLag(row.finding) && <NavLagNote compact />}{reasons.map(text => <small key={text}>{text}</small>)}{metrics && row.persistence && <small>{row.persistence.quarters_compared} completed quarters compared · {row.persistence.qualifying_quarters} NAV declines in flat/rising reference markets</small>}{price && <small>{price.persistence.intervals_compared} {price.persistence.cadence}s compared · {price.persistence.qualifying_intervals} price declines in flat/rising reference periods · {price.persistence.joint_qualifying_intervals} also paid above reference return</small>}{(metrics ? row.source : price?.source) && <small><a href={(metrics ? row.source : price.source).url} target="_blank" rel="noreferrer">{(metrics ? row.source : price.source).label}</a></small>}</td>
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
