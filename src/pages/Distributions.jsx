import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useCurrency } from '../context/CurrencyContext'
import ThemedPlot from '../components/ThemedPlot'
import DistributionIncomeFloor from './DistributionIncomeFloor'
import DistributionDripLedger from './DistributionDripLedger'
import DistributionSortHeader from '../components/DistributionSortHeader'
import useTableSort from '../utils/useTableSort'
import { formatMoney, formatMoneyDelta } from '../utils/money'
import './Distributions.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TABS = [['monthly', 'Monthly Income'], ['analyzer', 'Distribution Analyzer'], ['portfolio', 'Portfolio Income'], ['floor', 'Income Floor'], ['drip', 'DRIP Ledger']]
const DASH = '—'
const SHOW_SOLD_KEY = 'distributions.showSoldHoldings'
const COLORS = { actual: '#32b979', estimate: '#e4aa45', reference: '#55b9ea', latest: '#e8a543' }
const money = v => v == null ? DASH : formatMoney(v)
const money4 = v => v == null ? DASH : formatMoney(v, { digits: 4 })
const deltaMoney = v => v == null ? DASH : formatMoneyDelta(v)
const percent = (v, digits = 1) => v == null ? DASH : `${Number(v).toFixed(digits)}%`
const signedPercent = v => v == null ? DASH : `${v > 0 ? '+' : ''}${percent(v)}`
const tone = v => v == null || v === 0 ? '' : v > 0 ? 'dist-positive' : 'dist-negative'
const num = v => v == null ? DASH : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })
const sum = values => values.reduce((s, v) => s + (v || 0), 0)
const sumKnown = values => values.some(v => v != null) ? sum(values) : null
const ratio = (numerator, denominator) => numerator != null && denominator > 0 ? numerator / denominator * 100 : null
const payoutCell = v => v == null || v === 0 ? DASH : money(v)
const plotConfig = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] }
const MONTHLY_COLUMNS = [
  { key: 'ticker', label: 'Investment', type: 'string', text: true },
  ...MONTHS.map((label, i) => ({ key: `month-${i}`, label, type: 'number', value: row => row.values[i] })),
  { key: 'total', label: 'Total', type: 'number' },
]
const YEARLY_COLUMNS = [
  { key: 'year', label: 'Year', type: 'number', text: true },
  { key: 'actual', label: 'Confirmed income', type: 'number' },
  { key: 'realized_gain', label: 'Realized gain/loss', type: 'number' },
]

async function readJSON(response) {
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(data.error || `Unable to load data (${response.status})`)
  return data
}

function Metric({ label, value, sub, color }) {
  return <div className="summary-card dist-metric">
    <div className="summary-label">{label}</div>
    <div className={`summary-value ${color || ''}`}>{value}</div>
    {sub && <div className="summary-sub">{sub}</div>}
  </div>
}

function Chart({ title, subtitle, data, layout }) {
  return <section className="dist-chart">
    <h3>{title}</h3>
    {subtitle && <p className="dist-note">{subtitle}</p>}
    <ThemedPlot themeSurface data={data} layout={{ autosize: true, height: 280, margin: { t: 12, r: 20, b: 50, l: 75 },
      legend: { orientation: 'h', y: 1.13 }, ...layout }} config={plotConfig} useResizeHandler style={{ width: '100%' }} />
  </section>
}

function Empty({ children }) { return <div className="dist-empty">{children}</div> }

function MonthlyIncome({ history, holdings, year, setYear, includeEstimates, setIncludeEstimates, query, setQuery, showSold, setShowSold, heldTickers }) {
  const { rows, totals, actual, estimated, prev, completed, elapsed, partial, hidden } = useMemo(() => {
    const currentYear = Number(history.as_of.slice(0, 4))
    const isCurrent = history.year === currentYear
    const elapsed = isCurrent ? Number(history.as_of.slice(5, 7)) : 12
    const completed = isCurrent ? elapsed - 1 : 12
    const descriptions = new Map(holdings.map(h => [h.ticker, h.description || '']))
    const sources = new Map(history.rows.map(row => [row.ticker, row]))
    // Keep currently held income payers visible even in a year with no recorded cash.
    for (const h of holdings) if (isIncomeHolding(h) && !sources.has(h.ticker)) {
      sources.set(h.ticker, { ticker: h.ticker, actual: Array(12).fill(0), estimated: Array(12).fill(0) })
    }
    const matched = [...sources.values()].filter(r => `${r.ticker} ${descriptions.get(r.ticker) || ''}`.toUpperCase().includes(query.trim().toUpperCase()))
      .map(r => {
        const values = r.actual.map((v, i) => i >= elapsed ? null : (v || 0) + (includeEstimates ? r.estimated[i] || 0 : 0))
        return { ...r, description: descriptions.get(r.ticker), values, total: sum(values) }
      }).sort((a, b) => a.ticker.localeCompare(b.ticker))
    // Holdings no longer owned in any account of this portfolio can be hidden;
    // like the filter box, the totals then cover the rows shown.
    const sold = showSold ? [] : matched.filter(r => !heldTickers.has(String(r.ticker).toUpperCase()))
    const rows = sold.length ? matched.filter(r => !sold.includes(r)) : matched
    const hidden = { count: sold.length, amount: sum(sold.map(r => r.total)), tickers: sold.map(r => r.ticker) }
    const monthTotals = key => MONTHS.map((_, i) => i >= elapsed ? null : sum(rows.map(r => r[key][i])))
    return { rows, totals: monthTotals('values'), actual: monthTotals('actual'), estimated: monthTotals('estimated'),
      prev: query.trim() || hidden.count ? null : sumKnown([history.previous_december.actual, includeEstimates ? history.previous_december.estimated : null]),
      elapsed, completed, partial: isCurrent, hidden }
  }, [history, holdings, query, includeEstimates, showSold, heldTickers])
  const { sorted, sort, onSort } = useTableSort(rows, MONTHLY_COLUMNS, { key: 'total', direction: 'desc' })
  const changes = totals.map((v, i) => {
    const previous = i === 0 ? prev : totals[i - 1]
    return i < completed && previous != null ? v - previous : null
  })
  const growth = changes.map((v, i) => v == null ? null : ratio(v, i === 0 ? prev : totals[i - 1]))
  const best = completed ? Math.max(...totals.slice(0, completed)) : null
  const total = sum(totals)
  const labels = MONTHS.map((m, i) => partial && i === elapsed - 1 ? `${m} (partial)` : m)
  return <>
    <div className="dist-controls">
      <label>Year <select value={year || history.year} onChange={e => setYear(Number(e.target.value))}>
        {history.years.map(y => <option key={y} value={y}>{y}</option>)}
      </select></label>
      <label>Filter holdings <input value={query} placeholder="Ticker or fund name" onChange={e => setQuery(e.target.value)} /></label>
      <label className="dist-checkbox"><input type="checkbox" checked={includeEstimates} onChange={e => setIncludeEstimates(e.target.checked)} /> Include recorded projections</label>
      <label className="dist-checkbox"><input type="checkbox" checked={showSold} onChange={e => setShowSold(e.target.checked)} /> Show holdings I no longer own</label>
    </div>
    {hidden.count > 0 && <p className="dist-note">Hiding {hidden.count} {hidden.count === 1 ? 'holding' : 'holdings'} you no longer own ({hidden.tickers.join(', ')}), which paid {money(hidden.amount)} in {history.year}. Totals below leave {hidden.count === 1 ? 'it' : 'them'} out; tick “Show holdings I no longer own” to include {hidden.count === 1 ? 'it' : 'them'}.</p>}
    {sum(estimated) !== 0 && <p className="dist-note">{includeEstimates ? <>Cells marked <span className="dist-estimate-mark">est</span> include recorded projections awaiting broker confirmation.</> : `${money(sum(estimated))} in recorded projections is excluded. Enable them to see estimated payments, including holdings without confirmed records.`}</p>}
    {history.excluded_duplicate_estimates?.count > 0 && <p className="dist-note">Excluded {history.excluded_duplicate_estimates.count} unsupported duplicate {history.excluded_duplicate_estimates.count === 1 ? 'projection' : 'projections'} ({money(history.excluded_duplicate_estimates.amount)}) for {history.excluded_duplicate_estimates.tickers.join(', ')}. These estimates matched confirmed payments in another account but had no holding or transaction evidence in their own account.</p>}
    <div className="summary-strip">
      <Metric label={`${history.year} ${partial ? 'YTD' : 'total'}`} value={money(total)} sub={includeEstimates ? `${money(sum(estimated))} projected` : 'Confirmed payment records'} color="dist-positive" />
      <Metric label="Average completed month" value={money(completed ? sum(totals.slice(0, completed)) / completed : null)} sub={`${completed} completed months`} />
      <Metric label="Best completed month" value={money(best)} sub={best > 0 ? MONTHS[totals.indexOf(best)] : 'No recorded income'} />
      <Metric label={partial ? 'Current month' : 'December income'} value={money(totals[elapsed - 1])} sub={`${MONTHS[elapsed - 1]}${partial ? ' · partial' : ''}`} />
    </div>
    <Chart title="Monthly distributions" subtitle={`Cash payments by payment date, ${history.year}.${partial ? ' The current month is partial.' : ''}`}
      data={[{ type: 'bar', name: 'Confirmed', x: labels, y: actual, marker: { color: COLORS.actual }, hovertemplate: '%{x}<br>Confirmed: $%{y:,.2f}<extra></extra>' },
        ...(includeEstimates ? [{ type: 'bar', name: 'Projected', x: labels, y: estimated, marker: { color: COLORS.estimate }, hovertemplate: '%{x}<br>Projected: $%{y:,.2f}<extra></extra>' }] : []),
        { type: 'scatter', mode: 'lines+markers', name: 'Monthly total', x: labels, y: totals, line: { color: COLORS.reference, width: 2 }, hovertemplate: '%{x}<br>Total: $%{y:,.2f}<extra></extra>' }]}
      layout={{ barmode: 'stack', xaxis: { type: 'category' }, yaxis: { tickprefix: '$', rangemode: 'tozero' }, hovermode: 'x unified' }} />
    <h2>Income by holding</h2>
    <div className="holdings-table-wrap dist-table-wrap">
      <table className="holdings-table dist-table dist-matrix">
        <thead><tr>{MONTHLY_COLUMNS.map((column, index) => {
          const current = partial && index === elapsed
          return <DistributionSortHeader key={column.key} column={current ? { ...column, display: `${column.label}*` } : column} sort={sort} onSort={onSort} className={current ? 'dist-current' : ''} />
        })}</tr></thead>
        <tbody>{sorted.map(r => <tr key={r.ticker}><td title={r.description || r.ticker}><strong>{r.ticker}</strong></td>{r.values.map((v, i) => <td key={i} className={partial && i === elapsed - 1 ? 'dist-current' : ''} title={r.estimated[i] ? `${money(r.actual[i])} confirmed + ${money(r.estimated[i])} projected${includeEstimates ? '' : ' (excluded)'}` : undefined}>{payoutCell(v)}{includeEstimates && i < elapsed && Boolean(r.estimated[i]) && <span className="dist-estimate-mark">est</span>}</td>)}<td className="dist-positive"><strong>{money(r.total)}</strong>{includeEstimates && r.estimated.some(v => v) && <span className="dist-estimate-mark" title="Total includes projected payments">est</span>}</td></tr>)}</tbody>
        <tfoot>
          <tr><td>Total</td>{totals.map((v, i) => <td key={i} className={partial && i === elapsed - 1 ? 'dist-current' : ''}>{money(v)}</td>)}<td>{money(total)}</td></tr>
          <tr><td>MoM change</td>{changes.map((v, i) => <td key={i} className={tone(v)}>{deltaMoney(v)}</td>)}<td>{DASH}</td></tr>
          <tr><td>MoM %</td>{growth.map((v, i) => <td key={i} className={tone(v)}>{signedPercent(v)}</td>)}<td>{DASH}</td></tr>
        </tfoot>
      </table>
      {!rows.length && <Empty>No holding-level payment records match this selection.</Empty>}
    </div>
    <p className="dist-note">{partial ? '* Current month is in progress; month-over-month change compares completed months only. ' : ''}Dashes indicate no recorded distribution or a future month. January compares with the preceding December when available. Imported aggregate-only monthly totals cannot be attributed to individual tickers.</p>
  </>
}

function SortableTable({ columns, rows, initialSort = 'ticker', onTicker, selected, footer, groupBy, groupTotals }) {
  const sortColumns = useMemo(() => columns.map(col => ({ ...col, type: col.type || (col.text ? 'string' : 'number') })), [columns])
  const { sorted, sort, onSort } = useTableSort(rows, sortColumns, { key: initialSort, direction: 'asc' })
  const groupNames = groupBy ? [...new Set(sorted.map(groupBy))] : []
  if (sort?.key !== 'category') groupNames.sort((a, b) => String(a).localeCompare(String(b)))
  const groups = groupBy ? groupNames.map(name => [name, sorted.filter(r => groupBy(r) === name)]) : [[null, sorted]]
  const totalCells = row => columns.map((col, i) => <td key={col.key}>{i === 0 ? row.ticker : row[col.key] != null ? col.format?.(row[col.key], row) ?? row[col.key] : DASH}</td>)
  const renderRow = r => <tr key={r.ticker} className={selected === r.ticker ? 'dist-selected-row' : ''}>{columns.map(col => <td key={col.key} className={`${col.text ? 'dist-left' : ''} ${col.highlight ? 'dist-highlight' : ''} ${col.signed ? tone(r[col.key]) : ''}`}
      title={col.key === 'ticker' ? r.message || r.description : col.key === 'description' ? r.description : undefined}>
      {col.key === 'ticker' && onTicker ? <button className="dist-ticker" type="button" onClick={() => onTicker(r.ticker)}>{r.ticker}</button> : col.format ? col.format(r[col.key], r) : r[col.key] ?? DASH}
    </td>)}</tr>
  return <div className="holdings-table-wrap dist-table-wrap"><table className="holdings-table dist-table">
    <thead><tr>{columns.map(col => <DistributionSortHeader key={col.key} column={col} sort={sort} onSort={onSort} />)}</tr></thead>
    <tbody>{groups.map(([name, list]) => <Fragment key={name || 'all'}>
      {name != null && <tr className="dist-group-title-row"><td colSpan={columns.length}>{name} · {list.length} {list.length === 1 ? 'holding' : 'holdings'}</td></tr>}
      {list.map(renderRow)}
      {name != null && groupTotals && <tr className="dist-group-total">{totalCells(groupTotals(list))}</tr>}
    </Fragment>)}</tbody>
    {footer && rows.length > 0 && <tfoot><tr>{totalCells(footer)}</tr></tfoot>}
  </table>{!rows.length && <Empty>No matching data.</Empty>}</div>
}

const ANALYZER_COLUMNS = [
  { key: 'ticker', label: 'Fund', text: true }, { key: 'frequency', label: 'Frequency', text: true },
  { key: 'low', label: 'Low', format: percent, highlight: true, tip: 'Minimum historically observed annualized payout yield' },
  { key: 'average', label: 'Average', format: percent }, { key: 'median', label: 'Median', format: percent },
  { key: 'high', label: 'High', format: percent }, { key: 'latest', label: 'Latest', format: percent, highlight: true },
  { key: 'ttm_yield', label: 'Trailing 12M', format: percent, tip: 'Cash/share over the trailing 365 days divided by the latest available close; requires a full year of price history' },
  { key: 'down_average', label: 'Avg when price fell', format: percent, tip: 'Average annualized payout yield when the pre-ex-date close fell relative to the prior payout' },
  { key: 'up_average', label: 'Avg when price rose', format: percent },
  { key: 'down_up', label: 'Down − Up (pp)', format: v => v == null ? DASH : `${v.toFixed(2)} pp`, signed: true },
  { key: 'price_change', label: 'Price change', format: signedPercent, signed: true, tip: 'First to last available pre-ex-date close, excluding distributions' },
  { key: 'payout_trend', label: 'Payout trend', format: signedPercent, signed: true, tip: 'Average cash/share of the latest three payments vs the previous three' },
  { key: 'latest_amount', label: 'Latest $/payout', format: money4 }, { key: 'latest_date', label: 'Latest ex-date', text: true },
  { key: 'priced_count', label: 'Yield samples', format: (v, r) => v == null ? DASH : `${v} / ${r.payout_count}` },
  { key: 'status', label: 'Data status', text: true, format: (v, r) => v === 'ok' ? `${r.provider || 'Market data'} · ${r.price_date}` : r.message || v || 'Loading…' },
]

// Wrapper avoids Array/column callbacks passing a row as the optional precision.
for (const col of ANALYZER_COLUMNS) if (col.format === percent) col.format = v => percent(v)

function Analyzer({ rows, loading, holdings, custom, setCustom, allHoldings, setAllHoldings, refresh }) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const visible = rows.filter(r => r.ticker.includes(query.trim().toUpperCase()))
  const chartRows = visible.filter(r => r.low != null && r.high != null).sort((a, b) => b.average - a.average).slice(0, 30)
  const detail = visible.find(r => r.ticker === selected && r.events?.length) || visible.find(r => r.events?.length)
  const add = e => {
    e.preventDefault()
    const values = input.toUpperCase().split(/[\s,]+/).filter(t => /^[A-Z0-9.^=\-/]{1,20}$/.test(t))
    if (values.length) { setCustom([...new Set([...custom, ...values])]); setInput('') }
  }
  return <>
    <div className="dist-controls">
      <form className="dist-add" onSubmit={add}><label>Compare other funds <input value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. SPYI, QQQI" /></label><button type="submit" className="btn btn-primary" disabled={!input.trim()}>Add</button></form>
      <label>Filter <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ticker" /></label>
      <label className="dist-checkbox"><input type="checkbox" checked={allHoldings} onChange={e => setAllHoldings(e.target.checked)} /> Include non-income holdings</label>
      <button type="button" className="btn" onClick={refresh} disabled={loading}>Reload market data</button>
    </div>
    {custom.length > 0 && <div className="dist-chips">{custom.map(t => <button key={t} className="dist-chip" type="button" title={`Remove ${t} from comparison`} onClick={() => setCustom(custom.filter(v => v !== t))}>{t} ×</button>)}</div>}
    {loading && <div className="dist-loading" role="status"><span className="spinner" /> Loading historical prices and cash distributions…</div>}
    {chartRows.length > 0 && <Chart title="Annualized payout yield range" subtitle={`Historical low to high range, with average and latest payout yield${visible.length > 30 ? ' (top 30 by average yield)' : ''}.`}
      data={[{ type: 'scatter', mode: 'markers', name: 'Historical average', x: chartRows.map(r => r.ticker), y: chartRows.map(r => r.average), marker: { color: COLORS.reference, size: 10 },
        error_y: { type: 'data', symmetric: false, array: chartRows.map(r => r.high - r.average), arrayminus: chartRows.map(r => r.average - r.low), color: COLORS.reference, thickness: 2 },
        customdata: chartRows.map(r => [r.low, r.high]), hovertemplate: '%{x}<br>Average: %{y:.2f}%<br>Low–high: %{customdata[0]:.2f}% – %{customdata[1]:.2f}%<extra></extra>' },
      { type: 'scatter', mode: 'markers', name: 'Latest', x: chartRows.map(r => r.ticker), y: chartRows.map(r => r.latest), marker: { color: COLORS.latest, size: 10, symbol: 'diamond' }, hovertemplate: '%{x}<br>Latest: %{y:.2f}%<extra></extra>' }]}
      layout={{ xaxis: { type: 'category', tickangle: chartRows.length > 12 ? -45 : 0 }, yaxis: { ticksuffix: '%', rangemode: 'tozero' }, margin: { t: 20, l: 65, r: 20, b: 70 } }} />}
    <h2>All fund distributions</h2>
    {!loading && visible.some(r => r.status === 'unavailable') && <p className="dist-note">Market history unavailable for {visible.filter(r => r.status === 'unavailable').length} of {visible.length} displayed funds; see the data status column or retry.</p>}
    <SortableTable rows={visible} columns={ANALYZER_COLUMNS} onTicker={setSelected} selected={detail?.ticker} />
    {!loading && !holdings.length && !custom.length && <p className="dist-note">Add a fund ticker above to compare its distribution history.</p>}
    <p className="dist-note">Scroll the table horizontally for all statistics. Annualized payout yield = cash per share ÷ closing price before the ex-date × payments per year. Historical cadence is inferred from payout intervals; trailing 12M uses the latest available close. Down − Up is a percentage-point difference. These are historical distributions, not total returns or guaranteed future yields. Missing or insufficient observations display a dash.</p>
    {detail && <Chart title={`${detail.ticker} payout yield over time`} subtitle="Select a fund in the table to inspect individual payment yields."
      data={[{ type: 'scatter', mode: 'lines+markers', name: 'Annualized yield', x: detail.events.map(e => e.date), y: detail.events.map(e => e.annualized_yield), line: { color: COLORS.reference, width: 2 }, hovertemplate: '%{x}<br>Yield: %{y:.2f}%<extra></extra>' }]}
      layout={{ xaxis: { type: 'date' }, yaxis: { ticksuffix: '%' }, showlegend: false }} />}
  </>
}

function isIncomeHolding(h) { return Number(h.quantity) > 0 && (Number(h.div) > 0 || Number(h.estim_payment_per_year) > 0) }

const PORTFOLIO_COLUMNS = [
  { key: 'ticker', label: 'Ticker', text: true }, { key: 'description', label: 'Fund', text: true }, { key: 'category', label: 'Category', text: true },
  { key: 'cost', label: 'Original cost', format: money }, { key: 'weight', label: 'Cost weight', format: v => percent(v, 2) },
  { key: 'shares', label: 'Shares', format: num }, { key: 'avg_price', label: 'Avg price/share', format: money },
  { key: 'value', label: 'Current value', format: money }, { key: 'cost_change', label: 'Value vs cost', format: signedPercent, signed: true },
  { key: 'ttm_per_share', label: '12M $/share', format: money4 }, { key: 'ttm_income', label: '12M annual income', format: money, highlight: true },
  { key: 'ttm_yoc', label: '12M yield on cost', format: v => percent(v, 2) },
  { key: 'latest_amount', label: 'Latest $/payout', format: money4 }, { key: 'run_income', label: 'Run-rate annual income', format: money, highlight: true },
  { key: 'run_yoc', label: 'Annual run-rate yield', format: v => percent(v, 2) }, { key: 'monthly_yoc', label: 'Monthly run-rate yield', format: v => percent(v, 2) },
  { key: 'income_change', label: 'Run rate − 12M', format: deltaMoney, signed: true },
  { key: 'status', label: 'Data status', text: true },
]

function PortfolioIncome({ holdings, history, market, loading }) {
  const [groupByCategory, setGroupByCategory] = useState(true)
  const yearlySort = useTableSort(history?.yearly || [], YEARLY_COLUMNS, { key: 'year', direction: 'asc' })
  const rows = useMemo(() => {
    const cost = h => h.original_purchase_value ?? h.purchase_value ?? null
    const totalCost = sum(holdings.map(cost))
    return holdings.map(h => {
      const m = market.get(h.ticker) || {}
      const c = cost(h), shares = Number(h.quantity), value = h.current_value ?? null
      const ttm = m.ttm_per_share == null ? null : m.ttm_per_share * shares
      const run = m.latest_amount != null && m.payments_per_year != null ? m.latest_amount * m.payments_per_year * shares : null
      return { ticker: h.ticker, description: h.description, category: h.subcategory ? `${h.category || 'Other'} / ${h.subcategory}` : h.category || 'Uncategorized',
        cost: c, weight: ratio(c, totalCost), shares, avg_price: c != null && shares > 0 ? c / shares : null, value,
        cost_change: c > 0 && value != null ? (value / c - 1) * 100 : null,
        ttm_per_share: m.ttm_per_share, ttm_income: ttm, ttm_yoc: ratio(ttm, c), latest_amount: m.latest_amount,
        monthly_yoc: run == null ? null : ratio(run / 12, c), run_yoc: ratio(run, c), run_income: run,
        income_change: ttm != null && run != null ? run - ttm : null, status: m.status === 'ok' ? `${m.provider || 'Market data'} · ${m.price_date}` : m.message || (loading ? 'Loading…' : 'Not available') }
    })
  }, [holdings, market, loading])
  const totalsFor = list => {
    const cost = sumKnown(list.map(r => r.cost)), value = sumKnown(list.map(r => r.value))
    const trailing = list.filter(r => r.ttm_income != null), latest = list.filter(r => r.run_income != null)
    const paired = list.filter(r => r.income_change != null)
    const ttm = sumKnown(trailing.map(r => r.ttm_income)), run = sumKnown(latest.map(r => r.run_income))
    const ttmBasis = trailing.filter(r => r.cost > 0), runBasis = latest.filter(r => r.cost > 0)
    const ttmYield = ratio(sumKnown(ttmBasis.map(r => r.ttm_income)), sum(ttmBasis.map(r => r.cost)))
    const runYield = ratio(sumKnown(runBasis.map(r => r.run_income)), sum(runBasis.map(r => r.cost)))
    return { ticker: 'Subtotal', cost, value, weight: sumKnown(list.map(r => r.weight)), cost_change: list.every(r => r.cost != null && r.value != null) && cost > 0 && value != null ? (value / cost - 1) * 100 : null,
      ttm_income: ttm, ttm_yoc: ttmYield, run_income: run, run_yoc: runYield,
      monthly_yoc: runYield == null ? null : runYield / 12, income_change: sumKnown(paired.map(r => r.income_change)), ttm_count: trailing.length, run_count: latest.length }
  }
  const total = totalsFor(rows)
  const top = [...rows].filter(r => r.ttm_income != null || r.run_income != null).sort((a, b) => (b.run_income ?? b.ttm_income) - (a.run_income ?? a.ttm_income)).slice(0, 12)
  const lifetimeIncome = sum((history?.yearly || []).map(r => r.actual))
  const lifetimeGain = sumKnown((history?.yearly || []).map(r => r.realized_gain))
  return <>
    {loading && <div className="dist-loading" role="status"><span className="spinner" /> Loading income estimates from distribution history…</div>}
    <div className="summary-strip">
      <Metric label="Original cost basis" value={money(total.cost)} sub={`${rows.length} income holdings`} />
      <Metric label="Current value" value={money(total.value)} sub={`${signedPercent(total.cost_change)} vs cost`} />
      <Metric label="Trailing 12M annual income" value={money(total.ttm_income)} sub={`${money(total.ttm_income == null ? null : total.ttm_income / 12)} / month · ${percent(total.ttm_yoc, 2)} yield on cost · ${total.ttm_count}/${rows.length} holdings`} color="dist-positive" />
      <Metric label="Latest payout run rate" value={money(total.run_income)} sub={`${money(total.run_income == null ? null : total.run_income / 12)} / month · ${percent(total.run_yoc, 2)} yield on cost · ${total.run_count}/${rows.length} holdings`} color="dist-positive" />
      <Metric label="Portfolio income past 30 days" value={money(history?.past_30_days.actual)} sub="Confirmed payments across all holdings" />
    </div>
    {top.length > 0 && <Chart title="Income contribution by holding" subtitle="Trailing 12-month distributions and latest payout annualized, both applied to today's shares. Up to 12 largest available contributors."
      data={[{ type: 'bar', name: 'Trailing 12M', x: top.map(r => r.ticker), y: top.map(r => r.ttm_income), marker: { color: COLORS.reference }, hovertemplate: '%{x}<br>12M: $%{y:,.2f}<extra></extra>' },
        { type: 'bar', name: 'Latest run rate', x: top.map(r => r.ticker), y: top.map(r => r.run_income), marker: { color: COLORS.actual }, hovertemplate: '%{x}<br>Run rate: $%{y:,.2f}<extra></extra>' }]}
      layout={{ barmode: 'group', xaxis: { type: 'category' }, yaxis: { tickprefix: '$', rangemode: 'tozero' } }} />}
    <div className="dist-controls"><h2>Income positions</h2><label className="dist-checkbox"><input type="checkbox" checked={groupByCategory} onChange={e => setGroupByCategory(e.target.checked)} /> Group by portfolio category</label></div>
    {rows.length ? <SortableTable rows={rows} columns={PORTFOLIO_COLUMNS} footer={{ ...total, ticker: 'Total' }} groupBy={groupByCategory ? r => r.category : null} groupTotals={totalsFor} /> : <Empty>No current income-paying holdings in this portfolio.</Empty>}
    <p className="dist-note">Scroll the table horizontally for all statistics. When grouped, sorting stays within each category; uncheck grouping to sort all holdings together. Cost weight is based on the original cost of the displayed income holdings. Yield on cost divides modeled annual or monthly income by original cost. Both income estimates use current shares; past 12-month cash actually received may differ. Totals include available market data only; yield-on-cost totals use holdings with both a positive cost and the corresponding estimate.</p>
    <h2>Recorded portfolio income &amp; realized gains</h2>
    <div className="summary-strip">
      <Metric label="Lifetime recorded income" value={money(lifetimeIncome)} color="dist-positive" />
      <Metric label="Lifetime recorded realized gains/losses" value={deltaMoney(lifetimeGain)} color={tone(lifetimeGain)} />
      <Metric label="Recorded income + realized gains" value={lifetimeGain == null ? DASH : money(lifetimeIncome + lifetimeGain)} color={tone(lifetimeIncome + (lifetimeGain || 0))} />
    </div>
    {(history?.yearly || []).length > 0 && <div className="dist-yearly">
      <div className="holdings-table-wrap dist-table-wrap"><table className="holdings-table dist-table"><thead><tr>{YEARLY_COLUMNS.map(column => <DistributionSortHeader key={column.key} column={column} sort={yearlySort.sort} onSort={yearlySort.onSort} />)}</tr></thead><tbody>
        {yearlySort.sorted.map(r => <tr key={r.year}><td>{r.year}{Number(history.as_of.slice(0, 4)) === r.year ? ' YTD' : ''}</td><td>{money(r.actual)}</td><td className={tone(r.realized_gain)}>{deltaMoney(r.realized_gain)}</td></tr>)}
      </tbody></table></div>
      <Chart title="Recorded income over time" data={[{ type: 'bar', x: history.yearly.map(r => `${r.year}${Number(history.as_of.slice(0, 4)) === r.year ? ' YTD' : ''}`), y: history.yearly.map(r => r.actual), marker: { color: COLORS.actual }, hovertemplate: '%{x}<br>Income: $%{y:,.2f}<extra></extra>' }]}
        layout={{ height: 240, xaxis: { type: 'category' }, yaxis: { tickprefix: '$', rangemode: 'tozero' }, showlegend: false }} />
    </div>}
    <p className="dist-note">Lifetime figures cover available payment and realized sale records for the entire selected portfolio, including sold holdings; they are not total return on current positions. See <Link to="/growth">Growth</Link> for transaction-aware portfolio returns.</p>
  </>
}

export default function Distributions() {
  const pf = useProfileFetch()
  useCurrency() // Reformat the tables and cards when display currency changes.
  const { currentProfileName, profileQueryString } = useProfile()
  const [tab, setTab] = useState('monthly')
  const [year, setYear] = useState(null)
  const [includeEstimates, setIncludeEstimates] = useState(true)
  const [floorIncludeEstimates, setFloorIncludeEstimates] = useState(false)
  const [monthlyQuery, setMonthlyQuery] = useState('')
  const [showSold, setShowSoldState] = useState(() => {
    try { return localStorage.getItem(SHOW_SOLD_KEY) === '1' } catch { return false }
  })
  const setShowSold = value => {
    setShowSoldState(value)
    try { localStorage.setItem(SHOW_SOLD_KEY, value ? '1' : '0') } catch { /* private mode */ }
  }
  const [snapshot, setSnapshot] = useState(null)
  const [historyState, setHistoryState] = useState(null)
  const [custom, setCustom] = useState([])
  const [allHoldings, setAllHoldings] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [marketRefresh, setMarketRefresh] = useState(0)
  const [marketState, setMarketState] = useState(null)
  const snapshotKey = `${profileQueryString}:${refresh}`
  const historyKey = `${snapshotKey}:${year || 'current'}`

  useEffect(() => {
    let stale = false
    pf('/api/holdings').then(readJSON).then(rows => { if (!stale) setSnapshot({ key: snapshotKey, rows }) })
      .catch(e => { if (!stale) setSnapshot({ key: snapshotKey, error: e.message }) })
    return () => { stale = true }
  }, [pf, snapshotKey])

  useEffect(() => {
    let stale = false
    const path = `/api/portfolio-distributions${year ? `?year=${year}` : ''}`
    pf(path).then(readJSON).then(data => { if (!stale) setHistoryState({ key: historyKey, data }) })
      .catch(e => { if (!stale) setHistoryState({ key: historyKey, error: e.message }) })
    return () => { stale = true }
  }, [pf, historyKey, year])

  const currentSnapshot = snapshot?.key === snapshotKey ? snapshot : null
  const currentHistory = historyState?.key === historyKey ? historyState : null
  const holdings = useMemo(() => currentSnapshot?.rows || [], [currentSnapshot])
  const incomeHoldings = useMemo(() => holdings.filter(isIncomeHolding), [holdings])
  const heldTickers = useMemo(() => new Set(holdings.filter(h => Number(h.quantity) > 0).map(h => String(h.ticker).toUpperCase())), [holdings])
  const symbols = [...new Set([...(allHoldings ? holdings : incomeHoldings).map(h => h.ticker), ...custom])].sort()
  const symbolKey = symbols.join(',')
  const marketKey = `${snapshotKey}:${marketRefresh}:${symbolKey}`
  const marketEnabled = (tab === 'analyzer' || tab === 'portfolio') && Boolean(currentSnapshot)
  const marketReady = marketState?.key === marketKey

  useEffect(() => {
    if (!marketEnabled || !symbolKey || marketReady) return
    let stale = false
    const list = symbolKey.split(',')
    const batches = Array.from({ length: Math.ceil(list.length / 30) }, (_, i) => list.slice(i * 30, (i + 1) * 30))
    const loadBatch = async batch => {
      try {
        const data = await readJSON(await pf(`/api/portfolio-distributions/analyzer?tickers=${encodeURIComponent(batch.join(','))}`))
        return data.rows
      } catch (e) { return batch.map(ticker => ({ ticker, status: 'unavailable', message: e.message })) }
    }
    const load = async () => {
      const rows = []
      for (const batch of batches) {
        if (stale) return
        rows.push(...await loadBatch(batch))
      }
      if (!stale) setMarketState({ key: marketKey, rows })
    }
    load()
    return () => { stale = true }
  }, [pf, marketKey, symbolKey, marketEnabled, marketReady])

  const marketRows = marketReady ? marketState.rows : []
  const market = new Map(marketRows.map(row => [row.ticker, row]))
  const loadingMarket = marketEnabled && Boolean(symbolKey) && !marketReady
  const loading = !currentSnapshot || !currentHistory
  const error = currentSnapshot?.error || currentHistory?.error
  const data = currentHistory?.data

  return <div className="page dashboard distributions-page">
    <header className="dist-page-header"><div><h1>Distributions</h1><p className="dist-note">Track payment history, compare payout yields and understand where portfolio income comes from. <strong>{currentProfileName}</strong>{data ? ` · through ${data.as_of}` : ''}</p></div>
      <button type="button" className="btn" onClick={() => setRefresh(v => v + 1)} disabled={loading}>Refresh data</button></header>
    <div className="tabs dist-tabs" aria-label="Distribution views">{TABS.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {loading && <div className="dist-loading" role="status"><span className="spinner" /> Loading portfolio distributions…</div>}
    {!loading && !error && data && <>
      {tab === 'monthly' && <MonthlyIncome history={data} holdings={holdings} year={year} setYear={setYear} includeEstimates={includeEstimates} setIncludeEstimates={setIncludeEstimates} query={monthlyQuery} setQuery={setMonthlyQuery} showSold={showSold} setShowSold={setShowSold} heldTickers={heldTickers} />}
      {tab === 'analyzer' && <Analyzer rows={symbols.map(ticker => market.get(ticker) || { ticker, status: marketReady ? 'unavailable' : 'loading', message: marketReady ? 'No market history returned for this symbol.' : 'Loading…' })} loading={loadingMarket} holdings={incomeHoldings} custom={custom} setCustom={setCustom} allHoldings={allHoldings} setAllHoldings={setAllHoldings} refresh={() => setMarketRefresh(v => v + 1)} />}
      {tab === 'portfolio' && <PortfolioIncome holdings={incomeHoldings} history={data} market={market} loading={loadingMarket} />}
      {tab === 'drip' && <DistributionDripLedger key={profileQueryString} refreshKey={refresh} showSold={showSold} setShowSold={setShowSold} heldTickers={heldTickers} />}
      {tab === 'floor' && <DistributionIncomeFloor key={profileQueryString} history={data} holdings={holdings} year={year} setYear={setYear} includeEstimates={floorIncludeEstimates} setIncludeEstimates={setFloorIncludeEstimates} />}
    </>}
  </div>
}
