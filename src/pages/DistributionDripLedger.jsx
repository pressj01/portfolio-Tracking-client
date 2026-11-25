import { Fragment, useEffect, useMemo, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import DistributionSortHeader from '../components/DistributionSortHeader'
import useTableSort from '../utils/useTableSort'
import { summarizeReinvestment } from '../utils/distributionDripLedger'
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
const NO_RECORDS_MESSAGE = 'No reinvestment records in this range.'
const SOURCE_TONE = { Actual: 'dist-positive', Modeled: 'dist-drip-modeled', Cash: 'dist-drip-cash', 'Partly cash': 'dist-drip-cash' }
// What each month's reinvestment status reads as on screen.
const SOURCE_LABEL = { Actual: 'Reinvested', 'Partly cash': 'Part reinvested', Cash: 'Taken as cash', Modeled: 'Modeled' }

// Hover text for the Reinvested? cell: what happened to this month's payments, account by account.
function sourceTitle(row) {
  const lines = []
  const paid = money(row.distribution)
  if (row.source === 'Actual') {
    lines.push(`Reinvested: all ${paid} paid this month bought more shares (${shares(row.shares_bought)} shares), according to your broker's reinvestment records.`)
  } else if (row.source === 'Partly cash') {
    lines.push(`Part reinvested: ${money(row.drip_amount)} of the ${paid} paid this month bought more shares; ${money(row.cash)} was taken as cash.`)
    lines.push('That happens when one account reinvests and another takes cash, when DRIP was turned on or off during the month, or when the broker reinvests only whole shares and pays out the rest.')
  } else if (row.source === 'Cash') {
    lines.push(`Taken as cash: none of the ${paid} paid this month was reinvested; it was paid out as cash.`)
  } else if (row.source === 'Modeled') {
    lines.push(`Modeled: this is the "as if reinvested" view. Payments that were really taken as cash are treated as if they had bought shares at that day's closing price, and those shares earn the payments after them. ${money(row.drip_amount)} of ${paid} counts as reinvested here.`)
  }
  const accounts = new Map()
  for (const p of row.payments || []) {
    const entry = accounts.get(p.account) || { paid: 0, reinvested: 0, cash: 0, modeled: 0, shares: 0 }
    const modeled = p.kind === 'modeled' ? p.reinvested : (p.extra || 0)
    entry.paid += p.amount || 0
    entry.reinvested += (p.reinvested || 0) - modeled
    entry.modeled += modeled
    entry.cash += p.cash || 0
    entry.shares += p.shares || 0
    accounts.set(p.account, entry)
  }
  if (accounts.size) {
    lines.push('')
    for (const [account, a] of accounts) {
      const parts = []
      if (a.reinvested > 0.005) parts.push(`${money(a.reinvested)} reinvested`)
      if (a.modeled > 0.005) parts.push(`${money(a.modeled)} modeled as reinvested`)
      if (a.cash > 0.005) parts.push(`${money(a.cash)} taken as cash`)
      const summary = parts.length === 1 && a.cash > 0.005 ? 'all taken as cash'
        : parts.length === 1 && a.reinvested > 0.005 ? `all reinvested (${shares(a.shares)} shares)` : parts.join(', ')
      lines.push(`${account}: ${money(a.paid)} paid, ${summary}`)
    }
  }
  lines.push('', 'Click the row to see each payment.')
  return lines.join('\n')
}
const KIND_LABEL = { drip: 'Reinvested', partial: 'Reinvested, rest cash', cash: 'Cash', modeled: 'Modeled reinvestment' }

const COLUMNS = [
  { key: 'month', label: 'Month', type: 'string', text: true, csv: r => r.month },
  { key: 'ticker', label: 'Ticker', type: 'string', text: true, csv: r => r.ticker },
  { key: 'base_shares', label: 'Base shares', type: 'number', format: shares, tip: 'Shares held at the start of the month, including shares bought by earlier reinvestments' },
  { key: 'month_end_price', label: 'Share price', type: 'number', format: price, money: true, tip: "The ticker's closing price at month end (the latest close for the current month). Total value and Value of DRIP shares use this price" },
  { key: 'distribution', label: 'Distribution', type: 'number', format: money, money: true, tip: 'Cash the holding paid this month' },
  { key: 'drip_amount', label: 'DRIP amount', type: 'number', format: money, money: true, highlight: true, tip: 'Part of the distribution that bought more shares' },
  { key: 'shares_bought', label: 'Shares repurchased', type: 'number', format: shares, highlight: true },
  { key: 'avg_price', label: 'Reinvest price', type: 'number', format: price, money: true, tip: 'Average price paid for the reinvested shares' },
  { key: 'other_shares', label: 'Other buys/sells', type: 'number', format: signedShares, tip: 'Shares bought or sold this month other than by reinvesting' },
  { key: 'end_shares', label: 'Ending shares', type: 'number', format: shares },
  { key: 'total_value', label: 'Total value', type: 'number', format: money, money: true, highlight: true, tip: 'Ending shares at the month-end closing price: the whole holding, including the shares reinvesting added' },
  { key: 'drip_shares', label: 'DRIP shares to date', type: 'number', format: shares, tip: 'Shares bought by reinvesting since the start of the range, reduced in proportion when shares were sold' },
  { key: 'income_from_drip', label: 'Income from DRIP shares', type: 'number', format: money, money: true, highlight: true, tip: "The part of this month's distribution paid on shares that reinvesting added before the ex-dividend date" },
  { key: 'value_of_drip', label: 'Value of DRIP shares', type: 'number', format: money, money: true, highlight: true, tip: 'DRIP shares to date at the month-end closing price' },
  { key: 'source', label: 'Reinvested?', type: 'string', text: true, value: r => SOURCE_LABEL[r.source] || r.source, csv: r => SOURCE_LABEL[r.source] || r.source,
    tip: 'What happened to this month\'s payments. Reinvested: they all bought more shares. Part reinvested: some bought shares and some were taken as cash. Taken as cash: none were reinvested. Modeled: the "as if reinvested" view. Hover a cell for the details.' },
]
const FIT_TONE = { 'Good DRIP candidate': 'dist-fit-good', 'Not a good DRIP candidate': 'dist-fit-cash', Borderline: 'dist-fit-toss', 'Not enough history': 'dist-fit-na', 'No distributions': 'dist-fit-na' }
const BUCKET_HINT = {
  Compounder: 'high income, fully paid for by total return',
  Grower: 'modest income, fully paid for by total return',
  Harvester: 'high income, but the price gave back part of it',
  Fading: 'modest income, and the price gave back part of it',
  Liquidator: 'high income paid while the fund lost value overall',
  Broken: 'little income and a loss overall',
}
const SUMMARY_WORDS = { 'Good DRIP candidate': 'good DRIP candidates', 'Not a good DRIP candidate': 'not good for DRIP', Borderline: 'borderline', 'Not enough history': 'without enough history', 'No distributions': 'paying no distributions' }
const pct = (v, digits = 1) => v == null ? DASH : `${(Math.abs(v) * 100).toFixed(digits)}%`
const edgeText = edge => edge == null ? DASH : Math.abs(edge) < 0.02 ? 'About the same' : `${pct(edge, 0)} ${edge > 0 ? 'better' : 'worse'}`

// Plain-language reason behind a holding's verdict.
function fitTitle(ticker, fit, mine) {
  if (!fit) return 'Checking…'
  const lines = [`${ticker}: ${fit.label}.`]
  if (!fit.call) {
    if (fit.reason) lines.push(fit.reason)
  } else {
    const edge = fit.re - 1
    lines.push(`Over ${Number(fit.years).toFixed(1)} years (${monthLabel(fit.start.slice(0, 7))} to ${monthLabel(fit.end.slice(0, 7))}), reinvesting every distribution left you ${Math.abs(edge) < 0.02 ? 'about the same as' : `${pct(edge, 0)} ${edge > 0 ? 'more' : 'less'} than`} taking the cash and earning ${pct(fit.cash_rate, 0)} a year on it.`)
    if (fit.paid_cash > 0 && fit.paid_drip != null && fit.cash_value != null && fit.drip_shares_value != null) {
      const per = `For every ${formatMoney(fit.base, { digits: 0 })} invested at the start`
      const extra = fit.paid_drip - fit.paid_cash
      lines.push(`${per}: reinvesting was paid ${money(fit.paid_drip)} in distributions, ${money(extra)} (${pct(fit.extra_payout_pct, 0)}) more than the ${money(fit.paid_cash)} taking the cash would pay, because the new shares earn payouts too.`)
      lines.push(`Those payouts bought shares now worth ${money(fit.drip_shares_value)}, while taking the cash would have left ${money(fit.cash_value)} with interest. ${fit.drip_shares_value >= fit.cash_value
        ? 'So the extra payouts, plus what the shares did, put reinvesting ahead.'
        : 'So the extra payouts did not make up for the shares losing value.'}`)
    }
    if (fit.price_cagr != null) lines.push(`Why: the price ${fit.price_cagr < 0 ? 'fell' : 'rose'} about ${pct(fit.price_cagr)} a year, so shares bought with distributions ${fit.price_cagr < 0 ? 'kept losing value' : 'grew in value'}.`)
    if (fit.win_rate != null) lines.push(`Reinvesting came out ahead at ${pct(fit.win_rate, 0)} of the dates you could have sold.`)
    if (fit.bucket) lines.push(`Fund type: ${fit.bucket} (${BUCKET_HINT[fit.bucket] || fit.bucket}).`)
  }
  if (mine && mine.reinvested > 0 && mine.value != null) {
    const change = mine.value / mine.reinvested - 1
    lines.push(`Your own reinvesting in this range: ${money(mine.reinvested)} reinvested bought shares worth ${money(mine.value)} at the latest close (${change >= 0 ? 'up' : 'down'} ${pct(change)}).`)
  }
  lines.push('Based on past prices and distributions only; not a prediction.')
  return lines.join('\n')
}

const EVAL_COLUMNS = [
  { key: 'ticker', label: 'Holding', type: 'string', text: true },
  { key: 'status', label: 'You now', type: 'string', text: true, tip: 'Whether you reinvest it today, from the DRIP boxes on the Holdings screen' },
  { key: 'verdict', label: 'Verdict', type: 'string', text: true, tip: 'Whether reinvesting this ticker has paid more than taking the cash' },
  { key: 'shares_held', label: 'Shares Held', type: 'number', tip: 'Current shares held in the selected account or combined accounts, regardless of the selected date range' },
  { key: 'percent_of_account', label: '% of Account', type: 'number', tip: 'Current holding value as a percentage of the entire selected account or combined accounts' },
  { key: 'edge', label: 'DRIP vs cash', type: 'number', tip: 'How much more or less reinvesting every distribution left you than taking the cash and earning 4% a year on it, over the selected range or the last 3 years, whichever is longer' },
  { key: 'extra', label: 'Extra payouts from DRIP', type: 'number', tip: 'How much more the holding was paid in distributions when they were reinvested than when they were taken as cash, over the same dates: the shares DRIP buys earn payouts too. DRIP vs cash already counts these payouts; hover a row to see them weighed against the price change.' },
  { key: 'meaning', label: 'What it means', type: 'number', text: true, value: r => r.priority, tip: 'Sorted so the holdings you reinvest but probably should not come first' },
  { key: 'change', label: 'Your reinvesting in this range', type: 'number', tip: 'What you reinvested in the selected range, and every share it bought valued at the latest close' },
]

function evaluationRows(holdings, fits, mine, dripStatus, heldTickers) {
  return holdings.map(({ ticker, description }) => {
    const key = String(ticker).toUpperCase()
    const fit = fits.get(ticker)
    const sold = heldTickers && !heldTickers.has(key)
    const current = sold ? null : dripStatus?.get(key)
    // A model has no DRIP setting to agree or disagree with.
    const reinvesting = current && !current.model ? current.on > 0 : null
    const status = !current ? 'No longer owned' : current.model ? 'Model holding' : current.on === 0 ? 'Taking cash'
      : current.on === current.total ? 'Reinvesting' : `Reinvesting in ${current.on} of ${current.total} accounts`
    const call = fit?.call
    let meaning, tone, priority
    if (!fit) [meaning, tone, priority] = ['Checking…', 'na', 10]
    else if (!call && fit.label === 'No distributions') [meaning, tone, priority] = ['Nothing to reinvest: it pays no distributions', 'na', 9]
    else if (!call) [meaning, tone, priority] = ['Too new to tell', 'na', 8]
    else if (call === 'Toss-up') [meaning, tone, priority] = ['Little difference either way', 'toss', 5]
    else if (reinvesting === null) [meaning, tone, priority] = call === 'DRIP' ? ['Paid more reinvested', 'good', 6] : ['Paid more as cash', 'cash', 7]
    else if (reinvesting && call === 'Take cash') [meaning, tone, priority] = ["Doesn't make much sense to DRIP: taking the cash has paid more", 'cash', 1]
    else if (!reinvesting && call === 'DRIP') [meaning, tone, priority] = ['Worth reinvesting: DRIP has paid more than cash', 'good', 2]
    else if (reinvesting) [meaning, tone, priority] = ['Keep reinvesting: DRIP has paid more than cash', 'good', 3]
    else [meaning, tone, priority] = ['Taking the cash makes sense', 'good', 4]
    const own = mine.get(ticker)
    return {
      ticker, description, status, reinvesting, fit, meaning, tone, priority,
      shares_held: sold ? 0 : current?.shares_held ?? null,
      percent_of_account: sold ? 0 : current?.percent_of_account ?? null,
      verdict: fit?.label ?? null, edge: fit?.re != null ? fit.re - 1 : null, extra: fit?.extra_payout_pct ?? null,
      reinvested: own?.reinvested || 0, worth: own?.value ?? null,
      change: own && own.reinvested > 0 && own.value != null ? own.value / own.reinvested - 1 : null,
    }
  })
}

// Collapsed until opened: how a holding is judged a good or poor DRIP candidate.
function DripDecisionHelp() {
  return <details className="dist-eval-help">
    <summary>How is this decided?</summary>
    <div className="dist-eval-help-body">
      <h4>What is compared</h4>
      <p>For each holding, the page replays the fund&apos;s real daily closing prices and every distribution it paid, two ways, starting from the same shares on the same day:</p>
      <ol>
        <li><strong>Reinvest:</strong> every distribution buys more shares at that day&apos;s price. Those new shares then earn distributions of their own.</li>
        <li><strong>Take the cash:</strong> every distribution is set aside as cash earning 4% a year, about what a money-market fund pays.</li>
      </ol>
      <p>At the end it compares what the shares bought by reinvesting are worth at the latest price with the cash pile. The <em>DRIP vs cash</em> column is that difference: &quot;24% better&quot; means reinvesting left you 24% more than the cash; &quot;44% worse&quot; means 44% less.</p>

      <h4>What about the extra payouts DRIP brings in?</h4>
      <p>They are counted. On the reinvest path every new share is paid on every distribution after it, and those payouts buy more shares too; on the cash path only the original shares are paid. So reinvesting is always paid more, and the <em>Extra payouts from DRIP</em> column shows how much more over the same dates (for example &quot;+38% more&quot;). Those payouts end up as shares, so <em>DRIP vs cash</em> already includes them; adding them again would count them twice.</p>
      <p>Hover a row to see them weighed against the price: for every $1,000 invested at the start, how much each path was paid, what the reinvested shares are worth now, and what the cash would be. A fund can pay a lot more when reinvested and still be <em>Not a good DRIP candidate</em> when its price falls faster than the extra payouts add up.</p>

      <h4>Which dates</h4>
      <p>The selected range or the last 3 years, whichever is longer. A fund younger than that is judged from its first price. The same window is used for every holding, so the results can be compared.</p>

      <h4>The verdict</h4>
      <ul>
        <li><strong className="dist-fit-good">Good DRIP candidate:</strong> reinvesting finished more than 2% ahead of the cash.</li>
        <li><strong className="dist-fit-cash">Not a good DRIP candidate:</strong> the cash finished more than 2% ahead of reinvesting.</li>
        <li><strong className="dist-fit-toss">Borderline:</strong> the two finished within 2% of each other, too close to call.</li>
        <li><strong className="dist-fit-na">Not enough history:</strong> fewer than 120 days of prices in the window.</li>
        <li><strong className="dist-fit-na">No distributions:</strong> it paid nothing in the window, so there is nothing to reinvest. Every holding in the account is listed, these included.</li>
      </ul>

      <h4>What usually decides it: the price trend</h4>
      <p>Reinvesting turns each distribution into shares, so it only pays off if those shares hold their value. Roughly, for 100 shares of a $10 fund that pays $1 a share over a year ($100 of distributions):</p>
      <ul>
        <li>If the price <strong>falls to $6</strong>, reinvesting buys about 12.5 shares at an average of $8, worth about $75 at $6. Taking the cash leaves $100 plus about $2 of interest. The cash wins: <em>Not a good DRIP candidate</em>. High-yield funds whose price keeps sliding (NAV erosion) usually land here.</li>
        <li>If the price <strong>rises to $12</strong>, reinvesting buys about 9 shares at an average of $11, worth about $110 at $12, plus a little more from the payouts those shares earn. That beats $102 of cash: <em>Good DRIP candidate</em>.</li>
      </ul>

      <h4>You now and What it means</h4>
      <p><em>You now</em> comes from the DRIP boxes on the Holdings screen (on Owner, how many of its accounts reinvest). It is combined with the verdict:</p>
      <ul>
        <li>Reinvesting + not a good candidate → <strong className="dist-fit-cash">Doesn&apos;t make much sense to DRIP: taking the cash has paid more</strong>. These sort first and are listed in the red box.</li>
        <li>Taking cash + good candidate → <strong className="dist-fit-good">Worth reinvesting: DRIP has paid more than cash</strong>. Listed in the green box.</li>
        <li>Reinvesting + good candidate → <strong>Keep reinvesting</strong>. Taking cash + not a good candidate → <strong>Taking the cash makes sense</strong>.</li>
        <li>Borderline → <strong>Little difference either way</strong>. A holding you no longer own shows only whether it paid more reinvested or as cash.</li>
      </ul>

      <h4>Also on hover</h4>
      <ul>
        <li><strong>How often reinvesting was ahead:</strong> the share of the dates you could have sold on (after holding at least six months, or a quarter of the window if longer) where reinvesting was in front. Near 100% or 0% means the answer held up whenever you sold; near 50% means it depended on timing.</li>
        <li><strong>Fund type:</strong> <em>Compounder</em> and <em>Grower</em>: total return fully paid for the distributions. <em>Harvester</em> and <em>Fading</em>: total return was positive but the price gave back part of the payout. <em>Liquidator</em> and <em>Broken</em>: the fund lost value overall while paying out. &quot;High income&quot; means a yield of 8% or more.</li>
      </ul>

      <h4>Your reinvesting in this range</h4>
      <p>Your own record, kept apart from the verdict: the dollars you actually reinvested in the selected range, and every share they bought valued at the latest close. The verdict uses the fund&apos;s full history in the window, not when you happened to buy.</p>

      <h4>Keep in mind</h4>
      <ul>
        <li>It is history only. A fund that has done well reinvested can still turn, and the reverse.</li>
        <li>Taxes and fees are not included, and the 4% cash rate is an assumption.</li>
        <li>Prices are adjusted for stock splits, so a reverse split does not look like a crash.</li>
        <li>It is the same test as the DRIP vs. Cash Analyzer page, so the two always agree for the same dates.</li>
      </ul>
    </div>
  </details>
}

function DripEvaluation({ rows, mine, loading }) {
  const { sorted, sort, onSort } = useTableSort(rows, EVAL_COLUMNS, { key: 'meaning', direction: 'asc' })
  const counts = ['Good DRIP candidate', 'Not a good DRIP candidate', 'Borderline', 'Not enough history', 'No distributions']
    .map(label => [label, rows.filter(r => r.verdict === label).length])
    .filter(([label, n]) => n > 0 || label !== 'No distributions')
  const wrongWay = rows.filter(r => r.priority === 1)
  const missed = rows.filter(r => r.priority === 2)
  return <section className="dist-eval">
    <h2>Is DRIP worth it?</h2>
    <p className="dist-note">Every holding in the account: has reinvesting its distributions paid more than taking the cash? {loading ? 'Checking each holding…' : counts.map(([label, n]) => `${n} ${SUMMARY_WORDS[label]}`).join(' · ')}</p>
    <DripDecisionHelp />
    {wrongWay.length > 0 && <div className="dist-eval-callout dist-eval-callout-bad">
      <strong>You&apos;re reinvesting {wrongWay.length} {wrongWay.length === 1 ? 'holding' : 'holdings'} where taking the cash has paid more:</strong> {wrongWay.map(r => r.ticker).join(', ')}. It doesn&apos;t make much sense to DRIP {wrongWay.length === 1 ? 'it' : 'these'}.
    </div>}
    {missed.length > 0 && <div className="dist-eval-callout dist-eval-callout-good">
      <strong>{missed.length} {missed.length === 1 ? 'holding' : 'holdings'} you take as cash would have paid more reinvested:</strong> {missed.map(r => r.ticker).join(', ')}.
    </div>}
    <div className="holdings-table-wrap dist-table-wrap dist-eval-table-wrap">
      <table className="holdings-table dist-table dist-eval-table">
        <thead><tr>{EVAL_COLUMNS.map(column => <DistributionSortHeader key={column.key} column={column} sort={sort} onSort={onSort} />)}</tr></thead>
        <tbody>{sorted.map(row => <tr key={row.ticker} title={fitTitle(row.ticker, row.fit, mine.get(row.ticker))}>
          <td className="dist-left"><strong>{row.ticker}</strong>{row.description ? <span className="dist-eval-desc"> {row.description}</span> : null}</td>
          <td className="dist-left">{row.status}</td>
          <td className="dist-left"><span className={`dist-fit ${FIT_TONE[row.verdict] || ''}`}>{row.verdict || (loading ? '…' : DASH)}</span></td>
          <td>{shares(row.shares_held)}</td>
          <td>{row.percent_of_account == null ? DASH : `${(row.percent_of_account * 100).toFixed(2)}%`}</td>
          <td className={row.edge == null || Math.abs(row.edge) < 0.02 ? '' : row.edge > 0 ? 'dist-positive' : 'dist-negative'}>{edgeText(row.edge)}</td>
          <td>{row.extra == null ? DASH : `+${pct(row.extra, 0)} more`}</td>
          <td className={`dist-left dist-eval-meaning dist-eval-${row.tone}`}>{row.meaning}</td>
          <td>{row.reinvested > 0 ? <>{money(row.reinvested)} → {money(row.worth)} <span className={row.change == null ? '' : row.change >= 0 ? 'dist-positive' : 'dist-negative'}>({row.change == null ? DASH : `${row.change >= 0 ? '+' : '−'}${pct(row.change)}`})</span></> : DASH}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <div className="dist-empty">No holdings to evaluate in this range.</div>}
    </div>
    <p className="dist-note">Hover a row for the reason. Open &quot;How is this decided?&quot; above for the full method. This describes the past, not what a fund will do next.</p>
  </section>
}

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
      end_shares: last.end_shares, drip_shares: last.drip_shares, value_of_drip: last.value_of_drip, total_value: last.total_value,
      month_end_price: last.month_end_price })
  } else {
    for (const key of ['value_of_drip', 'total_value']) {
      const values = list.filter(r => r[key] != null)
      total[key] = values.length ? sum(values, key) : null
    }
  }
  return total
}

function exportCsv(rows, label, columns) {
  const currency = getDisplayCurrency()
  const header = columns.map(c => c.money ? `${c.label} (${currency})` : c.label)
  const cell = (column, row) => {
    const value = column.csv ? column.csv(row) : row[column.key]
    if (value == null) return ''
    if (column.money) return Number(convertMoneyValue(value)).toFixed(['avg_price', 'month_end_price'].includes(column.key) ? 4 : 2)
    if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6)
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = [header.join(','), ...rows.map(row => columns.map(column => cell(column, row)).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `drip-ledger-${label}-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function PaymentDetail({ row, modelAll, span }) {
  return <tr className="dist-drip-detail"><td colSpan={span}>
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

export default function DistributionDripLedger({ refreshKey, showSold = true, setShowSold, heldTickers, dripStatus, model }) {
  const pf = useProfileFetch()
  const [range, setRange] = useState('last12')
  const [modelAllChoice, setModelAll] = useState(false)
  // A Portfolio Builder model has no reinvestment records, so it is always shown as if reinvested.
  const modelId = model?.id ?? null
  const modelAll = Boolean(modelId) || modelAllChoice
  const [evaluate, setEvaluate] = useState(false)
  const [groupBy, setGroupBy] = useState('ticker')
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [meta, setMeta] = useState(null)
  const [state, setState] = useState(null)
  const [firstMonth, setFirstMonth] = useState(null)
  const today = new Date()
  const asOf = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
  const params = rangeParams(range, firstMonth, asOf)
  const loadKey = `${refreshKey}:${modelId || ''}:${range}:${params.start || ''}:${modelAll ? 1 : 0}:${evaluate ? 1 : 0}`
  const columns = COLUMNS

  useEffect(() => {
    let stale = false
    const base = { ...params, model_all: modelAll ? 1 : 0, evaluate: evaluate ? 1 : '', builder_id: modelId }
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
  const fits = useMemo(() => new Map((current?.statuses || []).filter(s => s.evaluation).map(s => [s.ticker, s.evaluation])), [current])
  // Your own result per ticker: what was reinvested in the range, and every share
  // it bought at the latest close (a later sale does not shrink this comparison).
  const mine = useMemo(() => summarizeReinvestment(current?.rows, current?.statuses), [current])
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
  const { sorted, sort, onSort } = useTableSort(rows, columns, { key: 'month', direction: 'asc' })
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
  // Every holding that was judged, including income holdings taken as cash
  // that the ledger itself does not list; the filter box and the "no longer
  // own" switch apply here as well.
  const evaluation = useMemo(() => {
    if (!evaluate) return []
    const needle = filter.trim().toUpperCase()
    const judged = new Map()
    for (const status of current?.statuses || []) {
      if (!status.evaluation) continue
      const ticker = String(status.ticker)
      if (needle && !`${ticker} ${status.description || ''}`.toUpperCase().includes(needle)) continue
      if (!showSold && heldTickers && !heldTickers.has(ticker.toUpperCase())) continue
      judged.set(ticker, { ticker, description: status.description || '' })
    }
    return evaluationRows([...judged.values()], fits, mine, dripStatus, heldTickers)
  }, [evaluate, current, filter, showSold, fits, mine, dripStatus, heldTickers])
  const years = useMemo(() => {
    const first = Number((firstMonth || asOf).slice(0, 4))
    const out = []
    for (let y = today.getFullYear(); y >= first; y--) out.push(String(y))
    return out
  }, [firstMonth, asOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = id => setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const loading = !current || (!current.done && !current.error)
  // A holding that only took cash is expected to have no ledger rows; that is not a problem to report.
  const problems = (current?.statuses || []).filter(s => s.message && s.message !== NO_RECORDS_MESSAGE)
  const rangeLabel = meta ? `${monthLabel(meta.start)} – ${monthLabel(meta.end)}` : ''

  const fitBadge = ticker => {
    const fit = fits.get(ticker)
    return <span className={`dist-fit ${FIT_TONE[fit?.label] || ''}`} title={fitTitle(ticker, fit, mine.get(ticker))}>{fit?.label || (loading ? '…' : DASH)}</span>
  }

  const cellFor = (column, row) => {
    if (column.key === 'month') return <>{monthLabel(row.month)}{row.partial ? '*' : ''}</>
    if (column.key === 'ticker') return <strong title={row.description || row.ticker}>{row.ticker}</strong>
    if (column.key === 'source') return <span className={`dist-drip-source ${SOURCE_TONE[row.source] || ''}`} title={sourceTitle(row)}>{SOURCE_LABEL[row.source] || row.source}</span>
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
      {!modelId && <label className="dist-checkbox" title="Reinvest every payment that was taken as cash at that day's close, and model holdings with no payment records from the fund's distribution history">
        <input type="checkbox" checked={modelAll} onChange={e => setModelAll(e.target.checked)} /> Show all holdings as if reinvested
      </label>}
      <label className="dist-checkbox" title={modelId ? 'For each holding in the model: has reinvesting paid more than taking the cash?' : 'For each holding: has reinvesting paid more than taking the cash? Flags the ones you reinvest that would have done better as cash.'}>
        <input type="checkbox" checked={evaluate} onChange={e => setEvaluate(e.target.checked)} /> Is DRIP worth it?
      </label>
      {setShowSold && <label className="dist-checkbox" title="Holdings no account in this portfolio holds any more">
        <input type="checkbox" checked={showSold} onChange={e => setShowSold(e.target.checked)} /> Show holdings I no longer own
      </label>}
      <button type="button" className="btn" disabled={!rows.length} onClick={() => exportCsv(sorted, range, columns)}>Export CSV</button>
    </div>
    {current?.error && <div className="alert alert-error" role="alert">{current.error}</div>}
    {evaluate && <DripEvaluation rows={evaluation} mine={mine} loading={loading} />}
    {loading && !current?.error && <div className="dist-loading" role="status"><span className="spinner" /> {current?.total ? `Loading ${current.loaded} of ${current.total} holdings…` : 'Finding reinvested holdings…'}</div>}
    <div className="summary-strip">
      <Metric label="Distributions" value={money(totals.distribution)} sub={rangeLabel} />
      <Metric label={modelId ? 'Reinvested (modeled)' : modelAll ? 'Reinvested (actual + modeled)' : 'Reinvested'} value={money(totals.drip)} sub={totals.distribution > 0 ? `${(totals.drip / totals.distribution * 100).toFixed(1)}% of distributions` : DASH} color="dist-positive" />
      <Metric label="Holdings buying shares" value={String(totals.buying)} sub={`${latest.length} holdings listed`} />
      <Metric label="Income from DRIP shares" value={money(totals.income)} sub="Paid on shares reinvesting added in this range" color="dist-positive" />
      <Metric label="Value of DRIP shares" value={money(totals.value)} sub={valued.length < latest.length ? `${valued.length} of ${latest.length} holdings priced` : 'At each holding\'s latest month-end close'} />
      {modelAll && <Metric label="Modeled extra income" value={money(totals.extra)} sub="Paid on shares that reinvesting cash payments would have added" />}
    </div>
    {hidden.tickers.length > 0 && <p className="dist-note">Hiding {hidden.tickers.length} {hidden.tickers.length === 1 ? 'holding' : 'holdings'} you no longer own ({hidden.tickers.join(', ')}), which paid {money(hidden.amount)} in this range. The cards and totals leave {hidden.tickers.length === 1 ? 'it' : 'them'} out; tick “Show holdings I no longer own” to include {hidden.tickers.length === 1 ? 'it' : 'them'}.</p>}
    {meta?.flagged_without_records?.length > 0 && !modelAll && <p className="dist-note">Marked DRIP on Holdings but no reinvestment records in this range: {meta.flagged_without_records.join(', ')}. Tick “Show all holdings as if reinvested” to model them.</p>}
    <div className="holdings-table-wrap dist-table-wrap">
      <table className="holdings-table dist-table dist-drip-table">
        <thead><tr>{columns.map(column => <DistributionSortHeader key={column.key} column={column} sort={sort} onSort={onSort} />)}</tr></thead>
        <tbody>{groups.map(([name, list]) => <Fragment key={name || 'all'}>
          {name != null && <tr className="dist-group-title-row"><td colSpan={columns.length}>
            {groupKey === 'month' ? monthLabel(name) : `${name}${list[0]?.description ? ` · ${list[0].description}` : ''}`} · {list.length} {groupKey === 'month' ? (list.length === 1 ? 'holding' : 'holdings') : (list.length === 1 ? 'month' : 'months')}
            {evaluate && groupKey === 'ticker' && <> · {fitBadge(name)}</>}
          </td></tr>}
          {list.map(row => {
            const id = `${row.ticker}:${row.month}`
            const open = expanded.has(id)
            return <Fragment key={id}>
              <tr className={`dist-drip-row${open ? ' dist-selected-row' : ''}`} onClick={() => toggle(id)} title="Click to show each payment">
                {columns.map(column => <td key={column.key} className={`${column.text ? 'dist-left' : ''} ${column.highlight ? 'dist-highlight' : ''}`}>{cellFor(column, row)}</td>)}
              </tr>
              {open && <PaymentDetail row={row} modelAll={modelAll} span={columns.length} />}
            </Fragment>
          })}
          {name != null && list.length > 1 && (() => {
            const total = subtotal(list, groupKey)
            return <tr className="dist-group-total">{columns.map((column, i) => <td key={column.key} className={column.text ? 'dist-left' : ''}>
              {i === 0 ? 'Subtotal' : column.key in total ? (total[column.key] == null ? '' : column.format(total[column.key])) : ''}
            </td>)}</tr>
          })()}
        </Fragment>)}</tbody>
        {rows.length > 0 && <tfoot><tr>{columns.map((column, i) => <td key={column.key} className={column.text ? 'dist-left' : ''}>
          {i === 0 ? 'Total' : { distribution: money(totals.distribution), drip_amount: money(totals.drip), income_from_drip: money(totals.income), value_of_drip: money(totals.value), total_value: money(totals.position) }[column.key] ?? ''}
        </td>)}</tr></tfoot>}
      </table>
      {!loading && !rows.length && !current?.error && <div className="dist-empty">{filter ? 'No holdings match this filter.' : modelId ? 'No holding in this model paid distributions in this range.' : modelAll ? 'No holdings paid distributions in this range.' : 'No reinvestment records in this range. Tick “Show all holdings as if reinvested” to model every holding.'}</div>}
    </div>
    {problems.length > 0 && <p className="dist-note">{problems.map(s => `${s.ticker}: ${s.message}`).join(' ')}</p>}
    {modelId ? <p className="dist-note">* Current month in progress. Click a row to see each payment. The {model.name} model starts the range with the shares it buys today and never trades; every payment it is modeled to receive is reinvested at that day&apos;s closing price, and those shares earn the payments after them. Share counts are in today&apos;s units after any stock split. Value of DRIP shares and Total value use the month-end closing price; their totals add each holding&apos;s latest month.</p>
    : <p className="dist-note">* Current month in progress. Click a row to see each payment and which account it came from. Base shares are counted back from each account's current share count through its buys and sells, so a position opened before your transaction history still starts from the right number. {modelAll
      ? 'Modeled rows reinvest the cash payments at that day\'s closing price; those shares then earn the payments after them. Holdings with no payment records are modeled from the fund\'s distribution history and your share count.'
      : 'Only holdings that actually reinvested in this range are listed; months they took cash show as Taken as cash. Hover the Reinvested? column for what happened in each month.'} Share counts are in today's units after any stock split. Value of DRIP shares and Total value use the month-end closing price; their totals add each holding's latest month.</p>}
  </>
}
