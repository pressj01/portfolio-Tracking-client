import { Fragment, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import DistributionSortHeader from '../components/DistributionSortHeader'
import useTableSort from '../utils/useTableSort'
import { convertMoneyValue, formatMoney, getDisplayCurrency } from '../utils/money'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DASH = '—'
const BATCH = 20
const money = v => v == null ? DASH : formatMoney(v)
const price = v => v == null ? DASH : formatMoney(v, { digits: 4 })
const shares = v => v == null ? DASH : Number(v).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 4 })
const signedShares = v => !v ? DASH : `${v > 0 ? '+' : ''}${shares(v)}`
const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0)
const monthLabel = key => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`
const SOURCE_TONE = { Actual: 'dist-positive', Modeled: 'dist-drip-modeled', Cash: 'dist-drip-cash', 'Partly cash': 'dist-drip-cash' }
const KIND_LABEL = { drip: 'Reinvested', partial: 'Reinvested, rest cash', cash: 'Cash', modeled: 'Modeled reinvestment' }

const COLUMNS = [
  { key: 'month', label: 'Month', type: 'string', text: true, csv: r => r.month },
  { key: 'ticker', label: 'Ticker', type: 'string', text: true, csv: r => r.ticker },
  { key: 'base_shares', label: 'Base shares', type: 'number', format: shares, tip: 'Shares held at the start of the month, including shares bought by earlier reinvestments' },
  { key: 'distribution', label: 'Distribution', type: 'number', format: money, money: true, tip: 'Cash the holding paid this month' },
  { key: 'drip_amount', label: 'DRIP amount', type: 'number', format: money, money: true, highlight: true, tip: 'Part of the distribution that bought more shares' },
  { key: 'shares_bought', label: 'Shares repurchased', type: 'number', format: shares, highlight: true },
  { key: 'avg_price', label: 'Reinvest price', type: 'number', format: price, money: true, tip: 'Average price paid for the reinvested shares' },
  { key: 'other_shares', label: 'Other buys/sells', type: 'number', format: signedShares, tip: 'Shares bought or sold this month other than by reinvesting' },
  { key: 'end_shares', label: 'Ending shares', type: 'number', format: shares },
  { key: 'total_value', label: 'Total value', type: 'number', format: money, money: true, highlight: true, tip: 'Ending shares at the month-end closing price: the whole holding, including the shares reinvesting added' },
  { key: 'drip_shares', label: 'DRIP shares to date', type: 'number', format: shares, tip: 'Shares bought by reinvesting since the start of the range, reduced in proportion when shares were sold' },
  { key: 'income_from_drip', label: 'Income from DRIP shares', type: 'number', format: money, money: true, highlight: true, tip: "The part of this month's distribution paid on shares that reinvesting added" },
  { key: 'value_of_drip', label: 'Value of DRIP shares', type: 'number', format: money, money: true, highlight: true, tip: 'DRIP shares to date at the month-end closing price' },
  { key: 'source', label: 'Source', type: 'string', text: true, tip: 'Actual: broker reinvestment records. Cash: the payment was not reinvested. Modeled: reinvestment worked out for the "as if reinvested" view' },
]
const SORT_COLUMNS = COLUMNS.map(column => ({ ...column, type: column.type }))

async function readJSON(response) {
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(data.error || `Unable to load data (${response.status})`)
  return data
}

function rangeParams(range, firstMonth, asOf) {
  if (range === 'all' && firstMonth) return { start: firstMonth, end: asOf.slice(0, 7) }
  if (/^\d{4}$/.test(range)) return { start: `${range}-01`, end: `${range}-12` }
  return {}
}

function query(params) {
  return Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

function Metric({ label, value, sub, color }) {
  return <div className="summary-card dist-metric">
    <div className="summary-label">{label}</div>
    <div className={`summary-value ${color || ''}`}>{value}</div>
    {sub && <div className="summary-sub">{sub}</div>}
  </div>
}

function latestByTicker(rows) {
  const latest = new Map()
  for (const row of rows) if (!latest.has(row.ticker) || latest.get(row.ticker).month < row.month) latest.set(row.ticker, row)
  return [...latest.values()]
}

// Subtotal for a ticker (money summed, share counts as of its last month) or a
// month (money summed across holdings; share counts of different funds are not added).
function subtotal(list, groupBy) {
  const total = { distribution: sum(list, 'distribution'), drip_amount: sum(list, 'drip_amount'), shares_bought: null,
    income_from_drip: sum(list, 'income_from_drip'), other_shares: null, end_shares: null, drip_shares: null, value_of_drip: null, total_value: null }
  if (groupBy === 'ticker') {
    const last = list.reduce((a, b) => (a.month > b.month ? a : b))
    Object.assign(total, { shares_bought: sum(list, 'shares_bought'), other_shares: sum(list, 'other_shares'),
      end_shares: last.end_shares, drip_shares: last.drip_shares, value_of_drip: last.value_of_drip, total_value: last.total_value })
  } else {
    for (const key of ['value_of_drip', 'total_value']) {
      const values = list.filter(r => r[key] != null)
      total[key] = values.length ? sum(values, key) : null
    }
  }
  return total
}

function exportCsv(rows, label) {
  const currency = getDisplayCurrency()
  const header = COLUMNS.map(c => c.money ? `${c.label} (${currency})` : c.label)
  const cell = (column, row) => {
    const value = column.csv ? column.csv(row) : row[column.key]
    if (value == null) return ''
    if (column.money) return Number(convertMoneyValue(value)).toFixed(column.key === 'avg_price' ? 4 : 2)
    if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6)
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = [header.join(','), ...rows.map(row => COLUMNS.map(column => cell(column, row)).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `drip-ledger-${label}-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function PaymentDetail({ row, modelAll }) {
  return <tr className="dist-drip-detail"><td colSpan={COLUMNS.length}>
    <table className="dist-drip-payments">
      <thead><tr><th>Paid</th><th>Account</th><th>Amount</th>{modelAll && <th>From modeled shares</th>}<th>$/share</th><th>Shares held</th><th>Reinvested</th><th>Shares bought</th><th>Price</th><th>Cash kept</th><th>What happened</th></tr></thead>
      <tbody>{row.payments.map((p, i) => <tr key={`${p.date}-${p.account}-${i}`}>
        <td>{p.date}</td><td>{p.account}</td><td>{money(p.amount)}</td>{modelAll && <td>{p.extra ? money(p.extra) : DASH}</td>}
        <td>{price(p.per_share)}</td><td>{shares(p.shares_held)}</td><td>{p.reinvested ? money(p.reinvested) : DASH}</td>
        <td>{p.shares ? shares(p.shares) : DASH}</td><td>{price(p.price)}</td><td>{p.cash ? money(p.cash) : DASH}</td>
        <td>{KIND_LABEL[p.kind] || p.kind}{p.synthetic ? ' (no payment record; from the reinvestment buy)' : ''}</td>
      </tr>)}</tbody>
    </table>
  </td></tr>
}

export default function DistributionDripLedger({ refreshKey, showSold = true, setShowSold, heldTickers }) {
  const pf = useProfileFetch()
  const [range, setRange] = useState('last12')
  const [modelAll, setModelAll] = useState(false)
  const [groupBy, setGroupBy] = useState('ticker')
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [meta, setMeta] = useState(null)
  const [state, setState] = useState(null)
  const [firstMonth, setFirstMonth] = useState(null)
  const today = new Date()
  const asOf = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const params = rangeParams(range, firstMonth, asOf)
  const loadKey = `${refreshKey}:${range}:${params.start || ''}:${modelAll ? 1 : 0}`

  useEffect(() => {
    let stale = false
    const base = { ...params, model_all: modelAll ? 1 : 0 }
    const load = async () => {
      setState({ key: loadKey, rows: [], statuses: [], loaded: 0, total: null })
      const list = await readJSON(await pf(`/api/portfolio-distributions/drip-ledger/tickers?${query(base)}`))
      if (stale) return
      setMeta(list)
      if (list.first_month) setFirstMonth(list.first_month)
      const tickers = list.tickers.map(t => t.ticker)
      setState(s => ({ ...s, total: tickers.length }))
      for (let i = 0; i < tickers.length; i += BATCH) {
        const batch = tickers.slice(i, i + BATCH)
        let data
        try {
          data = await readJSON(await pf(`/api/portfolio-distributions/drip-ledger?${query({ ...base, start: list.start, end: list.end, tickers: batch.join(',') })}`))
        } catch (e) {
          data = { rows: [], tickers: batch.map(ticker => ({ ticker, message: e.message })) }
        }
        if (stale) return
        setState(s => ({ ...s, rows: [...s.rows, ...data.rows], statuses: [...s.statuses, ...data.tickers], loaded: Math.min(tickers.length, i + BATCH) }))
      }
      if (!stale) setState(s => ({ ...s, done: true }))
    }
    load().catch(e => { if (!stale) setState({ key: loadKey, error: e.message, rows: [], statuses: [] }) })
    return () => { stale = true }
    // params are derived from range/firstMonth, which loadKey already covers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf, loadKey])

  const current = state?.key === loadKey ? state : null
  const { rows, hidden } = useMemo(() => {
    const needle = filter.trim().toUpperCase()
    const matched = (current?.rows || []).filter(r => !needle || `${r.ticker} ${r.description || ''}`.toUpperCase().includes(needle))
    // Holdings no longer owned in any account of this portfolio can be hidden;
    // like the filter box, the cards and totals then cover the rows shown.
    const isSold = r => heldTickers && !heldTickers.has(String(r.ticker).toUpperCase())
    const soldRows = showSold ? [] : matched.filter(isSold)
    const tickers = [...new Set(soldRows.map(r => r.ticker))]
    return {
      rows: soldRows.length ? matched.filter(r => !isSold(r)) : matched,
      hidden: { tickers, amount: sum(soldRows, 'distribution') },
    }
  }, [current, filter, showSold, heldTickers])
  const { sorted, sort, onSort } = useTableSort(rows, SORT_COLUMNS, { key: 'month', direction: 'asc' })
  const groupKey = groupBy === 'none' ? null : groupBy
  const groups = useMemo(() => {
    if (!groupKey) return [[null, sorted]]
    const names = [...new Set(sorted.map(r => r[groupKey]))]
    if (sort?.key !== groupKey) names.sort()
    return names.map(name => [name, sorted.filter(r => r[groupKey] === name)])
  }, [sorted, groupKey, sort])

  const latest = latestByTicker(rows)
  const valued = latest.filter(r => r.value_of_drip != null)
  const positioned = latest.filter(r => r.total_value != null)
  const totals = {
    distribution: sum(rows, 'distribution'), drip: sum(rows, 'drip_amount'), income: sum(rows, 'income_from_drip'),
    extra: sum(rows, 'extra_income'), value: valued.length ? sum(valued, 'value_of_drip') : null,
    position: positioned.length ? sum(positioned, 'total_value') : null,
    buying: new Set(rows.filter(r => r.shares_bought > 0).map(r => r.ticker)).size,
  }
  const years = useMemo(() => {
    const first = Number((firstMonth || asOf).slice(0, 4))
    const out = []
    for (let y = today.getFullYear(); y >= first; y--) out.push(String(y))
    return out
  }, [firstMonth, asOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = id => setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const loading = !current || (!current.done && !current.error)
  const problems = (current?.statuses || []).filter(s => s.message)
  const rangeLabel = meta ? `${monthLabel(meta.start)} – ${monthLabel(meta.end)}` : ''

  const cellFor = (column, row) => {
    if (column.key === 'month') return <>{monthLabel(row.month)}{row.partial ? '*' : ''}</>
    if (column.key === 'ticker') return <strong title={row.description || row.ticker}>{row.ticker}</strong>
    if (column.key === 'source') return <span className={SOURCE_TONE[row.source] || ''}>{row.source}</span>
    return column.format(row[column.key])
  }

  return <>
    <div className="dist-controls">
      <label>Range <select value={range} onChange={e => setRange(e.target.value)}>
        <option value="last12">Last 12 months</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
        {firstMonth && <option value="all">All history (since {monthLabel(firstMonth)})</option>}
      </select></label>
      <label>Group by <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
        <option value="ticker">Holding</option><option value="month">Month</option><option value="none">No grouping</option>
      </select></label>
      <label>Filter holdings <input value={filter} placeholder="Ticker or fund name" onChange={e => setFilter(e.target.value)} /></label>
      <label className="dist-checkbox" title="Reinvest every payment that was taken as cash at that day's close, and model holdings with no payment records from the fund's distribution history">
        <input type="checkbox" checked={modelAll} onChange={e => setModelAll(e.target.checked)} /> Show all holdings as if reinvested
      </label>
      {setShowSold && <label className="dist-checkbox" title="Holdings no account in this portfolio holds any more">
        <input type="checkbox" checked={showSold} onChange={e => setShowSold(e.target.checked)} /> Show holdings I no longer own
      </label>}
      <button type="button" className="btn" disabled={!rows.length} onClick={() => exportCsv(sorted, range)}>Export CSV</button>
    </div>
    {current?.error && <div className="alert alert-error" role="alert">{current.error}</div>}
    {loading && !current?.error && <div className="dist-loading" role="status"><span className="spinner" /> {current?.total ? `Loading ${current.loaded} of ${current.total} holdings…` : 'Finding reinvested holdings…'}</div>}
    <div className="summary-strip">
      <Metric label="Distributions" value={money(totals.distribution)} sub={rangeLabel} />
      <Metric label={modelAll ? 'Reinvested (actual + modeled)' : 'Reinvested'} value={money(totals.drip)} sub={totals.distribution > 0 ? `${(totals.drip / totals.distribution * 100).toFixed(1)}% of distributions` : DASH} color="dist-positive" />
      <Metric label="Holdings buying shares" value={String(totals.buying)} sub={`${latest.length} holdings listed`} />
      <Metric label="Income from DRIP shares" value={money(totals.income)} sub="Paid on shares reinvesting added in this range" color="dist-positive" />
      <Metric label="Value of DRIP shares" value={money(totals.value)} sub={valued.length < latest.length ? `${valued.length} of ${latest.length} holdings priced` : 'At each holding\'s latest month-end close'} />
      {modelAll && <Metric label="Modeled extra income" value={money(totals.extra)} sub="Paid on shares that reinvesting cash payments would have added" />}
    </div>
    {hidden.tickers.length > 0 && <p className="dist-note">Hiding {hidden.tickers.length} {hidden.tickers.length === 1 ? 'holding' : 'holdings'} you no longer own ({hidden.tickers.join(', ')}), which paid {money(hidden.amount)} in this range. The cards and totals leave {hidden.tickers.length === 1 ? 'it' : 'them'} out; tick “Show holdings I no longer own” to include {hidden.tickers.length === 1 ? 'it' : 'them'}.</p>}
    {meta?.flagged_without_records?.length > 0 && !modelAll && <p className="dist-note">Marked DRIP on Holdings but no reinvestment records in this range: {meta.flagged_without_records.join(', ')}. Tick “Show all holdings as if reinvested” to model them.</p>}
    <div className="holdings-table-wrap dist-table-wrap">
      <table className="holdings-table dist-table dist-drip-table">
        <thead><tr>{COLUMNS.map(column => <DistributionSortHeader key={column.key} column={column} sort={sort} onSort={onSort} />)}</tr></thead>
        <tbody>{groups.map(([name, list]) => <Fragment key={name || 'all'}>
          {name != null && <tr className="dist-group-title-row"><td colSpan={COLUMNS.length}>
            {groupKey === 'month' ? monthLabel(name) : `${name}${list[0]?.description ? ` · ${list[0].description}` : ''}`} · {list.length} {groupKey === 'month' ? (list.length === 1 ? 'holding' : 'holdings') : (list.length === 1 ? 'month' : 'months')}
          </td></tr>}
          {list.map(row => {
            const id = `${row.ticker}:${row.month}`
            const open = expanded.has(id)
            return <Fragment key={id}>
              <tr className={`dist-drip-row${open ? ' dist-selected-row' : ''}`} onClick={() => toggle(id)} title="Click to show each payment">
                {COLUMNS.map(column => <td key={column.key} className={`${column.text ? 'dist-left' : ''} ${column.highlight ? 'dist-highlight' : ''}`}>{cellFor(column, row)}</td>)}
              </tr>
              {open && <PaymentDetail row={row} modelAll={modelAll} />}
            </Fragment>
          })}
          {name != null && list.length > 1 && (() => {
            const total = subtotal(list, groupKey)
            return <tr className="dist-group-total">{COLUMNS.map((column, i) => <td key={column.key} className={column.text ? 'dist-left' : ''}>
              {i === 0 ? 'Subtotal' : column.key in total ? (total[column.key] == null ? '' : column.format(total[column.key])) : ''}
            </td>)}</tr>
          })()}
        </Fragment>)}</tbody>
        {rows.length > 0 && <tfoot><tr>{COLUMNS.map((column, i) => <td key={column.key} className={column.text ? 'dist-left' : ''}>
          {i === 0 ? 'Total' : { distribution: money(totals.distribution), drip_amount: money(totals.drip), income_from_drip: money(totals.income), value_of_drip: money(totals.value), total_value: money(totals.position) }[column.key] ?? ''}
        </td>)}</tr></tfoot>}
      </table>
      {!loading && !rows.length && !current?.error && <div className="dist-empty">{filter ? 'No holdings match this filter.' : modelAll ? 'No holdings paid distributions in this range.' : 'No reinvestment records in this range. Tick “Show all holdings as if reinvested” to model every holding.'}</div>}
    </div>
    {problems.length > 0 && <p className="dist-note">{problems.map(s => `${s.ticker}: ${s.message}`).join(' ')}</p>}
    <p className="dist-note">* Current month in progress. Click a row to see each payment and which account it came from. Base shares are counted back from each account's current share count through its buys and sells, so a position opened before your transaction history still starts from the right number. {modelAll
      ? 'Modeled rows reinvest the cash payments at that day\'s closing price; those shares then earn the payments after them. Holdings with no payment records are modeled from the fund\'s distribution history and your share count.'
      : 'Only holdings that actually reinvested in this range are listed; months they took cash show as Cash.'} Share counts are in today's units after any stock split. Value of DRIP shares and Total value use the month-end closing price; their totals add each holding's latest month.</p>
  </>
}
