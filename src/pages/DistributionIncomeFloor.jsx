import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import ThemedPlot from '../components/ThemedPlot'
import DistributionSortHeader from '../components/DistributionSortHeader'
import useTableSort from '../utils/useTableSort'
import { formatMoney, formatMoneyDelta } from '../utils/money'
import { defaultFloorGroup, getFloorTickers, grossIncomeFloor, incomeFloorRows, normalizedFunding, stressTestIncome, stressTestSources } from '../utils/distributionFloor'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const GROUP_LABELS = { core: 'Core', satellite: 'Satellite', unassigned: 'Unassigned' }
const GROUP_COLORS = { core: '#3b82c4', satellite: '#ca6736', unassigned: '#8191a4', estimate: '#e4aa45', floor: '#e69a51' }
const money = value => value == null ? '—' : formatMoney(value)
const multiple = value => value == null ? '—' : `${value.toFixed(2)}×`
const tone = value => value == null || value === 0 ? '' : value > 0 ? 'dist-positive' : 'dist-negative'
const coverageTone = value => value == null ? '' : value >= 1 - 1e-8 ? 'dist-positive' : 'dist-negative'
const monthLabel = row => `${MONTHS[row.month - 1]}${row.partial ? ' (partial)' : ''}`
const ASSIGNMENT_COLUMNS = [
  { key: 'ticker', label: 'Ticker', type: 'string', text: true },
  { key: 'holding', label: 'Holding / category', type: 'string', text: true, value: row => [row.description, row.category].filter(Boolean).join(' · ') },
  { key: 'held', label: 'Status', type: 'string', text: true, value: row => row.held ? 'Held' : 'Historical' },
  { key: 'group', label: 'Income group', type: 'string', text: true, value: row => GROUP_LABELS[row.group] },
]
const COVERAGE_COLUMNS = [
  { key: 'month', label: 'Month', type: 'number', text: true },
  ...['core', 'satellite', 'unassigned'].map(key => ({ key, label: GROUP_LABELS[key], type: 'number', value: row => row.hasActual ? row[key] : null })),
  { key: 'estimated', label: 'Projected', type: 'number', value: row => row.hasEstimate ? row.estimated : null },
  { key: 'total', label: 'Total gross', type: 'number', value: row => row.hasRecords ? row.total : null },
  { key: 'netFloor', label: 'Net funding need', type: 'number' },
  { key: 'floor', label: 'Gross floor', type: 'number' },
  { key: 'coreCoverage', label: 'Core coverage', type: 'number' },
  { key: 'totalCoverage', label: 'Total coverage', type: 'number' },
  { key: 'gap', label: 'Surplus / shortfall', type: 'number' },
  { key: 'status', label: 'Status', type: 'string', text: true },
]

function readPreferences(key) {
  try {
    const result = JSON.parse(localStorage.getItem(key) || '{}')
    return result && typeof result === 'object' && !Array.isArray(result) ? result : {}
  } catch { return {} }
}

function savePreferences(key, values) {
  try { localStorage.setItem(key, JSON.stringify(values)) } catch { /* storage may be unavailable */ }
}

async function json(response) {
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(data.error || `Unable to read cash-flow plan (${response.status})`)
  return data
}

function FloorCard({ label, value, detail, color = '' }) {
  return <div className="summary-card dist-metric"><div className="summary-label">{label}</div>
    <div className={`summary-value ${color}`}>{value}</div>{detail && <div className="summary-sub">{detail}</div>}</div>
}

function FloorChart({ rows, includeEstimates, floorMode, hasCore, modeled }) {
  const x = rows.map(monthLabel)
  const groups = ['core', 'satellite', 'unassigned'].filter(group => rows.some(r => r[group] !== 0) || group === 'core' && hasCore)
  const traces = groups.map(group => ({ type: 'bar', name: `${GROUP_LABELS[group]} (${modeled ? 'modeled' : 'confirmed'})`, x, y: rows.map(r => r[group]),
    marker: { color: GROUP_COLORS[group] },
    ...(group === 'core' ? { text: rows.map(r => r.core > 0 && r.coreCoverage != null ? multiple(r.coreCoverage) : ''), textposition: 'inside', insidetextanchor: 'middle', textfont: { color: '#fff', size: 12 } } : {}),
    hovertemplate: `%{x}<br>${GROUP_LABELS[group]}: $%{y:,.2f}${group === 'core' ? '<br>Core coverage: %{customdata}' : ''}<extra></extra>`,
    ...(group === 'core' ? { customdata: rows.map(r => multiple(r.coreCoverage)) } : {}) }))
  if (includeEstimates) traces.push({ type: 'bar', name: 'Recorded projections', x, y: rows.map(r => r.estimated), marker: { color: GROUP_COLORS.estimate, pattern: { shape: '/', solidity: .2 } }, hovertemplate: '%{x}<br>Projected: $%{y:,.2f}<extra></extra>' })
  traces.push({ type: 'scatter', mode: 'markers+text', name: 'Recorded total', x, y: rows.map(r => r.hasRecords ? r.total : null),
    marker: { size: 3, color: '#aab6c5' }, text: rows.map(r => r.hasRecords ? formatMoney(r.total, { currency: 'USD', digits: 0 }) : ''), textposition: 'top center',
    textfont: { size: 12 }, customdata: rows.map(r => multiple(r.totalCoverage)), hovertemplate: '%{x}<br>Total: $%{y:,.2f}<br>Coverage: %{customdata}<extra></extra>' })
  if (rows.some(r => r.floor != null)) traces.push({ type: 'scatter', mode: 'lines+markers', name: floorMode === 'scheduled' ? 'Scheduled gross floor' : 'Normalized gross floor', x, y: rows.map(r => r.floor), connectgaps: false,
    line: { color: GROUP_COLORS.floor, width: 3, dash: 'dash', shape: floorMode === 'scheduled' ? 'hv' : 'linear' }, marker: { size: 5 },
    hovertemplate: '%{x}<br>Required gross income: $%{y:,.2f}<extra></extra>' })
  return <section className="dist-chart dist-floor-chart">
    <h3>Monthly distributions vs. income floor</h3>
    <p className="dist-note">The dashed line is the gross income required by your cash-flow plan. The labels inside the blue bars show confirmed core coverage; totals are labeled above the bars.</p>
    <ThemedPlot themeSurface data={traces} layout={{ autosize: true, height: 410, barmode: 'relative', bargap: .28, hovermode: 'x unified',
      xaxis: { type: 'category', categoryorder: 'array', categoryarray: x }, yaxis: { tickprefix: '$', rangemode: 'tozero', title: 'Gross distributions ($)' },
      margin: { t: 30, r: 25, b: 55, l: 80 }, legend: { orientation: 'h', y: 1.14, x: 0 } }}
      config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] }} useResizeHandler style={{ width: '100%' }} />
  </section>
}

function FloorStressTest({ rows, history, tickers, hasCore }) {
  const [month, setMonth] = useState(null)
  const [sourceId, setSourceId] = useState(null)
  const row = rows.find(r => r.month === month) || rows.filter(r => !r.partial && r.hasActual).at(-1) || rows.filter(r => !r.partial).at(-1) || rows.at(-1)
  const sources = stressTestSources(history, tickers, row?.month)
  const source = sources.find(s => s.id === sourceId) || sources.find(s => s.id !== ':satellite' && s.group === 'satellite' && s.amount > 0) || sources.find(s => s.id !== ':satellite' && s.amount > 0) || sources[0]
  const scenarios = stressTestIncome(row, source, hasCore)
  const sourceShare = row?.confirmed > 0 && source ? Math.max(0, source.amount) / row.confirmed * 100 : null
  return <section className="dist-floor-stress">
    <h2>Income floor stress test</h2>
    <p className="dist-note">What happens if a major payer cuts its distributions? Apply hypothetical cuts to a selected month's confirmed income, with the same cash-flow floor.</p>
    <div className="dist-controls">
      <label>Stress test month <select aria-label="Stress test month" value={row?.month || ''} onChange={e => setMonth(Number(e.target.value))}>{rows.map(r => <option key={r.month} value={r.month}>{monthLabel(r)}</option>)}</select></label>
      <label>Payer to stress <select aria-label="Payer to stress" value={source?.id || ''} disabled={!sources.length} onChange={e => setSourceId(e.target.value)}>{!sources.length && <option value="">No income tickers</option>}{sources.map(s => <option key={s.id} value={s.id}>{s.label} · {money(s.amount)}</option>)}</select></label>
      {source && <div className="dist-stress-exposure"><strong>{source.label}</strong> · {money(source.amount)} confirmed{sourceShare != null ? ` · ${sourceShare.toFixed(1)}% of ${row ? MONTHS[row.month - 1] : 'monthly'} income` : ''}</div>}
    </div>
    {!scenarios.length ? <div className="dist-empty">No confirmed payments are available for this month. Choose another month to run the stress test.</div> : <>
      <div className="summary-strip">{scenarios.map(s => <FloorCard key={s.id} label={s.label} value={money(s.income)} color={tone(s.gap)} detail={s.income == null ? 'Assign core holdings first' : `${multiple(s.coverage)} coverage${s.gap != null ? ` · ${formatMoneyDelta(s.gap)} vs floor` : ' · no floor available'}`} />)}</div>
      <div className="dist-chart dist-stress-chart">
        <h3>{monthLabel(row)} · {source.label} sensitivity</h3>
        <ThemedPlot themeSurface data={[
          { type: 'bar', name: 'Scenario income', x: scenarios.map(s => s.label), y: scenarios.map(s => s.income),
            marker: { color: scenarios.map(s => s.id === 'core' ? GROUP_COLORS.core : s.gap == null ? GROUP_COLORS.unassigned : s.gap >= 0 ? '#32b979' : '#d66a62') },
            text: scenarios.map(s => s.income == null ? '' : multiple(s.coverage)), textposition: 'auto', customdata: scenarios.map(s => multiple(s.coverage)), hovertemplate: '%{x}<br>Gross income: $%{y:,.2f}<br>Coverage: %{customdata}<extra></extra>' },
          ...(row.floor != null ? [{ type: 'scatter', mode: 'lines+markers', name: 'Gross floor', x: scenarios.map(s => s.label), y: scenarios.map(() => row.floor), line: { color: GROUP_COLORS.floor, dash: 'dash', width: 3 }, hovertemplate: 'Required income: $%{y:,.2f}<extra></extra>' }] : []),
        ]} layout={{ autosize: true, height: 280, barmode: 'group', hovermode: 'closest', xaxis: { type: 'category' }, yaxis: { tickprefix: '$', rangemode: 'tozero' }, margin: { t: 20, r: 20, b: 60, l: 75 }, legend: { orientation: 'h', y: 1.12 } }}
        config={{ displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] }} useResizeHandler style={{ width: '100%' }} />
      </div>
      <p className="dist-note">Only the selected payer's positive confirmed distribution is reduced in the cut scenarios; the other income remains unchanged. Core-only removes all non-core income, independently of the selected payer. This is a static illustration using recorded payments, not a prediction of future payouts.</p>
    </>}
  </section>
}

export default function DistributionIncomeFloor({ history, holdings, year, setYear, includeEstimates, setIncludeEstimates, model }) {
  const pf = useProfileFetch()
  const { isAggregate, aggregateId, profileId } = useProfile()
  // A Portfolio Builder model keeps its own core/satellite assignments.
  const preferenceKey = model ? `distribution-income-floor:builder:${model.id}`
    : `distribution-income-floor:${isAggregate ? `aggregate:${aggregateId}` : `profile:${profileId}`}`
  const [preferences, setPreferences] = useState(() => readPreferences(preferenceKey))
  const [plansState, setPlansState] = useState(null)
  const [planData, setPlanData] = useState(null)
  const [firstMonth, setFirstMonth] = useState(1)
  const [showAssignments, setShowAssignments] = useState(false)
  const [assignmentQuery, setAssignmentQuery] = useState('')
  const [retry, setRetry] = useState(0)
  const assignments = preferences.assignments && typeof preferences.assignments === 'object' && !Array.isArray(preferences.assignments) ? preferences.assignments : {}
  const floorMode = preferences.floorMode === 'scheduled' ? 'scheduled' : 'normalized'
  const fundingMode = preferences.fundingMode === 'all' ? 'all' : 'net'
  const elapsed = history.year === Number(history.as_of.slice(0, 4)) ? Number(history.as_of.slice(5, 7)) : 12

  function changePreferences(next) {
    const updated = { ...preferences, ...next }
    savePreferences(preferenceKey, updated)
    setPreferences(updated)
  }

  useEffect(() => {
    let stale = false
    pf('/api/cash-flow/plans').then(json).then(data => {
      if (!stale) setPlansState({ key: retry, plans: data.plans || [] })
    }).catch(error => { if (!stale) setPlansState({ key: retry, error: error.message }) })
    return () => { stale = true }
  }, [pf, retry])

  const currentPlans = plansState?.key === retry ? plansState : null
  const plans = currentPlans?.plans || []
  const selectedPlan = plans.find(p => String(p.id) === String(preferences.planId)) || plans.find(p => p.is_default) || plans[0]
  const planId = selectedPlan?.id
  const asOfMonth = history.as_of.slice(0, 7)
  const planKey = `${retry}:${planId}:${history.year}:${asOfMonth}`

  useEffect(() => {
    if (!planId) return undefined
    let stale = false
    Promise.all([
      pf(`/api/cash-flow/summary?plan_id=${planId}&month=${asOfMonth}`).then(json),
      pf(`/api/cash-flow/settings?plan_id=${planId}`).then(json),
      pf(`/api/cash-flow/series?plan_id=${planId}&start_month=${history.year}-01&months=12&hold_growth=1`).then(json),
    ]).then(([summary, settings, schedule]) => {
      if (!stale) setPlanData({ key: planKey, summary: summary.summary, settings: settings.settings, series: schedule.series })
    }).catch(error => { if (!stale) setPlanData({ key: planKey, error: error.message }) })
    return () => { stale = true }
  }, [pf, planId, planKey, asOfMonth, history.year])

  const data = planData?.key === planKey ? planData : null
  const error = currentPlans?.error || data?.error
  const tickers = useMemo(() => getFloorTickers(history, holdings, assignments), [history, holdings, assignments])
  const groups = Object.fromEntries(Object.keys(GROUP_LABELS).map(group => [group, tickers.filter(t => t.group === group)]))
  const tax = data?.settings?.portfolio_tax_pct
  const rows = useMemo(() => data?.summary && data?.settings ? incomeFloorRows({ history, tickers, summary: data.summary, series: data.series,
    taxRatePct: tax, floorMode, fundingMode, includeEstimates, firstMonth: Math.min(firstMonth, elapsed) }) : [],
  [data, history, tickers, tax, floorMode, fundingMode, includeEstimates, firstMonth, elapsed])
  const completed = rows.filter(r => !r.partial && r.floor > 0)
  const withRecords = completed.filter(r => r.hasActual)
  const coveredCore = withRecords.filter(r => r.coreCoverage != null && r.coreCoverage >= 1 - 1e-8).length
  const coveredTotal = withRecords.filter(r => r.confirmed >= r.floor - 0.005).length
  const latest = rows[rows.length - 1]
  const lastComplete = rows.filter(r => !r.partial).at(-1)
  const floors = rows.map(r => r.floor).filter(v => v != null)
  const min = floors.length ? Math.min(...floors) : null, max = floors.length ? Math.max(...floors) : null
  const floorLabel = min != null && max != null && min !== max ? `${money(min)} – ${money(max)}` : money(min)
  const normalized = normalizedFunding(data?.summary, fundingMode)
  const normalizedGross = normalized.expenses > 0 ? grossIncomeFloor(normalized.required, tax) : null
  const displayedTickers = tickers.filter(t => `${t.ticker} ${t.description} ${t.category}`.toUpperCase().includes(assignmentQuery.trim().toUpperCase()))
  const assignmentSort = useTableSort(displayedTickers, ASSIGNMENT_COLUMNS, { key: 'ticker', direction: 'asc' })
  const coverageColumns = useMemo(() => COVERAGE_COLUMNS.filter(col => includeEstimates || col.key !== 'estimated'), [includeEstimates])
  const coverageSort = useTableSort(rows, coverageColumns, { key: 'month', direction: 'asc' })

  function assign(ticker, value) {
    const next = { ...assignments }
    if (value === 'auto') delete next[ticker]
    else next[ticker] = value
    changePreferences({ assignments: next })
  }

  return <div className="dist-floor">
    <div className="dist-controls">
      <label>Year <select aria-label="Income floor year" value={year || history.year} onChange={e => setYear(Number(e.target.value))}>{history.years.map(y => <option value={y} key={y}>{y}</option>)}</select></label>
      <label>From month <select value={Math.min(firstMonth, elapsed)} onChange={e => setFirstMonth(Number(e.target.value))}>{MONTHS.slice(0, elapsed).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
      <label>Cash Flow plan <select aria-label="Cash Flow plan" value={planId || ''} disabled={!plans.length} onChange={e => changePreferences({ planId: Number(e.target.value) })}>
        {!plans.length && <option value="">{currentPlans ? 'No plans available' : 'Loading plans…'}</option>}
        {plans.map(p => <option key={p.id} value={p.id}>{p.name}{p.is_default ? ' (default)' : ''}</option>)}
      </select></label>
      <label>Floor calculation <select value={floorMode} onChange={e => changePreferences({ floorMode: e.target.value })}>
        <option value="normalized">Normalized monthly need</option><option value="scheduled">Scheduled monthly need</option>
      </select></label>
      <label>Portfolio must fund <select value={fundingMode} onChange={e => changePreferences({ fundingMode: e.target.value })}>
        <option value="net">Expenses after other income</option><option value="all">All expenses</option>
      </select></label>
      <label className="dist-checkbox"><input type="checkbox" checked={includeEstimates} onChange={e => setIncludeEstimates(e.target.checked)} /> {model ? 'Include declared, not yet paid' : 'Include recorded projections'}</label>
    </div>
    {model && <p className="dist-note">Testing the {model.name} model: “confirmed” payments on this tab are the model&apos;s modeled payments (each fund&apos;s past distributions on the shares the model buys today), and projections are distributions past their ex-date that have not been paid yet. The floor comes from your own Cash Flow plan, so this shows whether the model&apos;s income would have covered it.{model.late_starters?.length > 0 ? ` ${model.late_starters.map(l => l.ticker).join(', ')} started trading during or after ${history.year}, so ${model.late_starters.length === 1 ? 'it pays' : 'they pay'} nothing before then.` : ''}</p>}
    <p className="dist-note">The floor is based on the saved <Link to="/cash-flow">Cash Flow &amp; Sustainability</Link> plan{selectedPlan?.source_plan_name ? ` (budget linked from ${selectedPlan.source_plan_name})` : ''}. Changes to the budget or tax assumptions can be made there; this tab does not change them.</p>
    {includeEstimates && history.excluded_duplicate_estimates?.count > 0 && <p className="dist-note">Excluded {money(history.excluded_duplicate_estimates.amount)} in unsupported duplicate projections for {history.excluded_duplicate_estimates.tickers.join(', ')} from the comparison.</p>}
    {error && <div className="alert alert-error" role="alert">{error} <button type="button" className="btn btn-sm" onClick={() => setRetry(v => v + 1)}>Retry</button></div>}
    {!error && (!currentPlans || planId && !data) && <div className="dist-loading" role="status"><span className="spinner" /> Loading the selected cash-flow plan…</div>}
    {!error && currentPlans && !plans.length && <div className="dist-empty">No cash-flow plan is available. <Link to="/cash-flow">Create or configure one in Cash Flow &amp; Sustainability</Link>.</div>}
    {!error && data?.summary && data?.settings && <>
      <div className="dist-floor-heading"><div><span className="dist-floor-kicker">My income floor</span><strong>{floorLabel}<small>{floorLabel === '—' ? '' : ' / month'}</small></strong>
        <p>{floorMode === 'normalized' ? `${money(normalized.required)} average after-tax funding need` : `Scheduled requirements · normalized benchmark ${money(normalizedGross)}`}{tax != null ? ` · ${Number(tax).toLocaleString()}% portfolio tax assumption` : ''}.</p></div>
        <div className="dist-floor-explanation"><strong>{selectedPlan?.name}</strong><span>{fundingMode === 'net' ? 'Expenses less after-tax other income' : 'All planned expenses'}</span><span>Gross floor = after-tax funding need ÷ (1 − portfolio tax rate)</span></div></div>
      {!floors.length && <div className="alert alert-warning">No scheduled expense budget is available for this comparison. Add expenses in Cash Flow &amp; Sustainability or choose another plan or floor calculation.</div>}
      <div className="summary-strip">
        <FloorCard label="Core coverage" value={multiple(lastComplete?.coreCoverage)} detail={lastComplete ? `${MONTHS[lastComplete.month - 1]} · confirmed core payments only` : 'No completed month in range'} color={coverageTone(lastComplete?.coreCoverage)} />
        <FloorCard label="Total coverage" value={multiple(lastComplete?.totalCoverage)} detail={lastComplete ? `${MONTHS[lastComplete.month - 1]}${includeEstimates ? ' · includes projections' : ' · confirmed payments'}` : 'No completed month in range'} color={coverageTone(lastComplete?.totalCoverage)} />
        <FloorCard label="Completed months covered" value={completed.length ? `${coveredTotal} / ${completed.length}` : '—'} detail={completed.length ? `${coveredCore} core-only · ${completed.length - withRecords.length} without records · confirmed only` : 'No completed month with a positive floor'} />
        <FloorCard label={latest?.partial ? 'Current month to floor' : 'Latest month vs floor'} value={latest?.gap == null ? '—' : formatMoneyDelta(latest.gap)} detail={latest ? `${monthLabel(latest)} · ${latest.status}` : 'No recorded payments'} color={tone(latest?.gap)} />
      </div>
      <div className="dist-floor-assign-head"><div className="dist-floor-legend">
        {Object.entries(GROUP_LABELS).map(([key, label]) => <span key={key}><i style={{ background: GROUP_COLORS[key] }} /> {label}: {groups[key].length} {groups[key].length === 1 ? 'ticker' : 'tickers'}</span>)}
      </div><button type="button" className="btn" aria-expanded={showAssignments} onClick={() => setShowAssignments(v => !v)}>{showAssignments ? 'Hide classifications' : 'Assign core & satellite holdings'}</button></div>
      {!groups.core.length && tickers.length > 0 && <p className="dist-note">No core tickers are assigned yet. Classify the holdings you intend to fund your floor; other holdings remain visible without being counted as core coverage.</p>}
      {showAssignments && <section className="dist-floor-assignment-panel">
        <div className="dist-controls"><label>Find ticker <input value={assignmentQuery} onChange={e => setAssignmentQuery(e.target.value)} placeholder="Ticker or category" /></label></div>
        <p className="dist-note">Core and satellite are your own designations. Existing category names containing “Core” or “Satellite” are recognized automatically. Overrides are saved for this portfolio only and also apply to its historical payments.</p>
        <div className="holdings-table-wrap dist-table-wrap dist-floor-assign-table"><table className="holdings-table dist-table"><thead><tr>{ASSIGNMENT_COLUMNS.map(column => <DistributionSortHeader key={column.key} column={column} sort={assignmentSort.sort} onSort={assignmentSort.onSort} />)}</tr></thead>
          <tbody>{assignmentSort.sorted.map(t => <tr key={t.ticker}><td>{t.ticker}</td><td className="dist-left">{t.description || '—'}{t.category ? ` · ${t.category}` : ''}</td><td className="dist-left">{t.held ? 'Held' : 'Historical'}</td><td className="dist-left">
            <select aria-label={`Income group for ${t.ticker}`} value={Object.hasOwn(assignments, t.ticker) ? assignments[t.ticker] : 'auto'} onChange={e => assign(t.ticker, e.target.value)}>
              <option value="auto">Auto ({GROUP_LABELS[defaultFloorGroup(holdings.find(h => String(h.ticker).toUpperCase() === t.ticker))]})</option>
              {Object.entries(GROUP_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select></td></tr>)}</tbody></table>{!displayedTickers.length && <div className="dist-empty">No matching income tickers.</div>}</div>
      </section>}
      {rows.length > 0 && <FloorChart rows={rows} includeEstimates={includeEstimates} floorMode={floorMode} hasCore={Boolean(groups.core.length)} modeled={Boolean(model)} />}
      {rows.length > 0 && <FloorStressTest rows={rows} history={history} tickers={tickers} hasCore={Boolean(groups.core.length)} />}
      <h2>Monthly floor coverage</h2>
      <div className="holdings-table-wrap dist-table-wrap"><table className="holdings-table dist-table dist-floor-coverage"><thead><tr>{coverageColumns.map(column => <DistributionSortHeader key={column.key} column={column} sort={coverageSort.sort} onSort={coverageSort.onSort} />)}
      </tr></thead><tbody>{coverageSort.sorted.map(r => <tr key={r.monthKey}>
        <td className={r.partial ? 'dist-current' : ''}>{monthLabel(r)}</td><td>{r.hasActual ? money(r.core) : '—'}</td><td>{r.hasActual ? money(r.satellite) : '—'}</td><td>{r.hasActual ? money(r.unassigned) : '—'}</td>
        {includeEstimates && <td>{r.hasEstimate ? money(r.estimated) : '—'}</td>}<td className="dist-highlight">{r.hasRecords ? money(r.total) : '—'}</td><td>{money(r.netFloor)}</td><td>{money(r.floor)}</td>
        <td className={coverageTone(r.coreCoverage)}>{multiple(r.coreCoverage)}</td><td className={coverageTone(r.totalCoverage)}>{multiple(r.totalCoverage)}</td><td className={tone(r.gap)}>{r.gap == null ? '—' : formatMoneyDelta(r.gap)}</td><td className="dist-left">{r.status}</td>
      </tr>)}</tbody></table></div>
      <p className="dist-note">{floorMode === 'normalized' ? 'The normalized floor uses the plan’s current 12-month average need in today’s dollars, applied as a consistent comparison benchmark.' : 'The scheduled floor uses the current plan’s scheduled expenses and other income for each month, at entered amounts (no extra inflation). It is not an archived record of historical expenses.'} A ratio of 1.00× means the corresponding recorded distributions equal the required gross floor. Core coverage and completed-month counts use confirmed payments only. The current month is partial and excluded from completed-month counts. Months without payment records are not treated as evidence of a shortfall. Distribution records may include cash later reinvested; this is a gross income comparison, not a cash-balance forecast.</p>
    </>}
  </div>
}
