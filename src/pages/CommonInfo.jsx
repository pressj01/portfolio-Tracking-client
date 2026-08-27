import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { formatMoney, formatMoneyWhole } from '../utils/money'
import { holdingLifetimeReturnParts } from '../utils/lifetimePerformance'
import { useColumnLayout } from '../utils/useColumnLayout'
import { insertMissingKeysAfter } from '../utils/columnLayout'
import ColumnCustomizer from '../components/ColumnCustomizer'

// Each view keeps its own column order and hidden set — the views curate
// different columns, so one shared layout would fight itself.
const COLUMN_LAYOUT_KEY = view => `common_info_columns_${view}_v1`
const LOCKED_COLUMNS = ['holding']

// Where a column added after a user saved their order should land. Without
// this a new column joins the end of that saved order, far from the column it
// belongs beside. Only applied to layouts the user actually saved.
const ADOPTED_COLUMNS = {
  general: [
    { key: 'unrealizedGain', after: 'currentValue' },
    { key: 'unrealizedPct', after: 'unrealizedGain' },
  ],
}

const VIEW_COLUMNS = {
  common: [
    'holding', 'grade', 'shares', 'avgCost', 'currentPrice', 'category', 'subcategory', 'costBasis', 'currentValue', 'dividends',
    'dividendYield', 'estimatedYield', 'dividendGrowth', 'paidForItself', 'totalProfit', 'shareOfPortfolio', 'nav',
  ],
  general: [
    'holding', 'status', 'shares', 'category', 'subcategory', 'shareOfPortfolio',
    'avgCost', 'currentPrice', 'costBasis', 'currentValue', 'unrealizedGain', 'unrealizedPct',
    'nav',
  ],
  dividends: [
    'holding', 'shares', 'category', 'subcategory', 'currentValue', 'dividends', 'dividendYield',
    'estimatedYield', 'dividendGrowth', 'paidForItself', 'nextPayment', 'exDividend', 'frequency', 'nav',
  ],
  returns: [
    'holding', 'category', 'subcategory', 'costBasis', 'currentValue', 'divsReceived', 'paidForItself',
    'capitalGain', 'realizedProfit', 'totalProfit', 'shareOfPortfolio', 'nav',
  ],
}

const VIEW_LABELS = [
  { key: 'common', label: 'Common' },
  { key: 'general', label: 'General' },
  { key: 'dividends', label: 'Dividends' },
  { key: 'returns', label: 'Returns' },
]

const FREQ_LABELS = {
  W: 'Weekly',
  M: 'Monthly',
  Q: 'Quarterly',
  SA: 'Semiannual',
  A: 'Annual',
}

const GRADE_RANK = {
  'A+': 13,
  A: 12,
  'A-': 11,
  'B+': 10,
  B: 9,
  'B-': 8,
  'C+': 7,
  C: 6,
  'C-': 5,
  'D+': 4,
  D: 3,
  'D-': 2,
  F: 1,
}

const SUMMARY_HELP = {
  value: 'Summary card: current market value of the open holdings shown after filters. Cash is not included; Dashboard Portfolio Value is holdings plus cash. The lower line is their active cost basis.',
  totalProfit: 'Summary card: remaining-lot price gain or loss plus guarded lifetime dividends plus realized gain or loss on shares trimmed from still-open tickers. The percent is that total versus invested/profit basis, not versus current value. Cash and fully sold tickers are not included. Same number as Gains & Losses Total Profit.',
  passiveIncome: 'Summary card: estimated next-12-month dividends divided by current holdings value. This is a forward yield on open holdings, not income already received and not yield on cash. The lower line is the dollar estimate.',
}

const COLUMN_HELP = {
  holding: 'Column: security name and ticker. Sold rows are marked Sold and shown with a line through the name.',
  grade: 'Column: composite grade for this ticker over the Dashboard Shared Performance Date Range. Shows a dash or N/A when the selected period cannot produce a grade.',
  status: 'Column: Open means currently held. Sold means fully sold.',
  shares: 'Column: current shares held. Sold rows show 0 because there is no open position.',
  category: 'Column: portfolio category assignment from the Categories page.',
  subcategory: 'Column: portfolio sub-category assignment from the Categories page.',
  costBasis: 'Column: amount invested in the open position. The lower line is average price per share.',
  avgCost: 'Column: average price paid per share.',
  currentValue: 'Column: current market value of the open position. The lower line is current price per share.',
  currentPrice: 'Column: current market price per share.',
  dividends: 'Column: estimated dividends for the next 12 months. The lower line is the annualized dividend per share, not the next single payment.',
  dividendYield: 'Column: upper value is current yield. Lower value is yield on cost.',
  estimatedYield: 'Column: forward yield estimate based on next-12-month dividends and current value.',
  dividendGrowth: 'Column: five-year dividend growth when available from the source data.',
  totalProfit: 'Column: current price gain or loss plus dividends received plus realized profit from sold shares.',
  shareOfPortfolio: 'Column: the holding current value as a percentage of the visible open portfolio value. Sold rows are 0%.',
  paidForItself: 'Column: lifetime distributions received as a percent of original cost. 100% means dividends have paid back the amount invested.',
  nav: 'Column: benchmark-adjusted NAV erosion. Auto/Test/Skip chooses whether to test this ticker. The box assigns a benchmark such as QQQ or BTC-USD.',
  nextPayment: 'Column: next listed dividend payment date.',
  exDividend: 'Column: the listed ex-dividend date.',
  frequency: 'Column: dividend payment frequency.',
  divsReceived: 'Column: lifetime dividends recorded for the holding or sold transaction group.',
  unrealizedGain: 'Column: price gain or loss on the shares still held — current value minus cost basis. Dividends and realized trims are not included. Sold rows show a dash because there is no open position.',
  unrealizedPct: 'Column: unrealized gain as a percent of cost basis. Sold rows show a dash because there is no open position.',
  capitalGain: 'Column: current value minus cost basis for open holdings; proceeds minus cost for sold rows.',
  realizedProfit: 'Column: profit or loss already locked in from shares that were sold.',
}

const HELP_ITEMS = [
  { kind: 'Summary card', label: 'Value', body: SUMMARY_HELP.value.replace('Summary card: ', '') },
  { kind: 'Summary card', label: 'Total profit', body: SUMMARY_HELP.totalProfit.replace('Summary card: ', '') },
  { kind: 'Summary card', label: 'Passive income', body: SUMMARY_HELP.passiveIncome.replace('Summary card: ', '') },
  { kind: 'Table column', label: 'Holding', body: COLUMN_HELP.holding.replace('Column: ', '') },
  { kind: 'Table column', label: 'Grade', body: COLUMN_HELP.grade.replace('Column: ', '') },
  { kind: 'Table column', label: 'Status', body: COLUMN_HELP.status.replace('Column: ', '') },
  { kind: 'Table column', label: 'Shares', body: COLUMN_HELP.shares.replace('Column: ', '') },
  { kind: 'Table column', label: 'Average price paid', body: COLUMN_HELP.avgCost.replace('Column: ', '') },
  { kind: 'Table column', label: 'Current share price', body: COLUMN_HELP.currentPrice.replace('Column: ', '') },
  { kind: 'Table column', label: 'Category', body: COLUMN_HELP.category.replace('Column: ', '') },
  { kind: 'Table column', label: 'Sub category', body: COLUMN_HELP.subcategory.replace('Column: ', '') },
  { kind: 'Table column', label: 'Cost basis', body: COLUMN_HELP.costBasis.replace('Column: ', '') },
  { kind: 'Table column', label: 'Current value', body: COLUMN_HELP.currentValue.replace('Column: ', '') },
  { kind: 'Table column', label: 'Dividends', body: COLUMN_HELP.dividends.replace('Column: ', '') },
  { kind: 'Table column', label: 'Dividend yield', body: COLUMN_HELP.dividendYield.replace('Column: ', '') },
  { kind: 'Table column', label: 'Estimated yield', body: COLUMN_HELP.estimatedYield.replace('Column: ', '') },
  { kind: 'Table column', label: 'Dividend growth (5Y)', body: COLUMN_HELP.dividendGrowth.replace('Column: ', '') },
  { kind: 'Table column', label: 'Total profit', body: COLUMN_HELP.totalProfit.replace('Column: ', '') },
  { kind: 'Table column', label: 'Share in portfolio', body: COLUMN_HELP.shareOfPortfolio.replace('Column: ', '') },
  { kind: 'Table column', label: 'Paid for itself', body: COLUMN_HELP.paidForItself.replace('Column: ', '') },
  { kind: 'Table column', label: 'Next payment', body: COLUMN_HELP.nextPayment.replace('Column: ', '') },
  { kind: 'Table column', label: 'Ex-dividend date', body: COLUMN_HELP.exDividend.replace('Column: ', '') },
  { kind: 'Table column', label: 'Frequency', body: COLUMN_HELP.frequency.replace('Column: ', '') },
  { kind: 'Table column', label: 'Div. received', body: COLUMN_HELP.divsReceived.replace('Column: ', '') },
  { kind: 'Table column', label: 'Unrealized gain', body: COLUMN_HELP.unrealizedGain.replace('Column: ', '') },
  { kind: 'Table column', label: 'Unrealized %', body: COLUMN_HELP.unrealizedPct.replace('Column: ', '') },
  { kind: 'Table column', label: 'Capital gain', body: COLUMN_HELP.capitalGain.replace('Column: ', '') },
  { kind: 'Table column', label: 'Realized P&L', body: COLUMN_HELP.realizedProfit.replace('Column: ', '') },
  { kind: 'Table column', label: 'NAV', body: COLUMN_HELP.nav.replace('Column: ', '') },
]

function finite(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function num(value) {
  return finite(value) ?? 0
}

function text(value, fallback = '--') {
  return value === null || value === undefined || value === '' ? fallback : value
}

function money(value, options = {}) {
  return formatMoney(value, { fallback: '--', ...options })
}

function signedMoney(value, options = {}) {
  if (finite(value) === null) return '--'
  return formatMoney(value, { signed: true, fallback: '--', ...options })
}

function pct(value, options = {}) {
  const n = finite(value)
  if (n === null) return '--'
  const pctValue = n * 100
  const sign = options.signed && pctValue > 0 ? '+' : ''
  return `${sign}${pctValue.toLocaleString(undefined, {
    minimumFractionDigits: options.digits ?? 2,
    maximumFractionDigits: options.digits ?? 2,
  })}%`
}

function wholePct(value, options = {}) {
  return pct(value, { digits: 0, ...options })
}

function shares(value) {
  const n = finite(value)
  if (n === null) return '--'
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function latestDate(a, b) {
  if (!a) return b || ''
  if (!b) return a
  return String(a) > String(b) ? a : b
}

function growthDisplay(value) {
  const n = finite(value)
  if (n === null) return '--'
  const ratio = Math.abs(n) > 1 ? n / 100 : n
  return pct(ratio, { signed: true })
}

function valueTone(value) {
  const n = finite(value)
  if (n === null || n === 0) return ''
  return n > 0 ? 'ci-positive' : 'ci-negative'
}

function paidForItselfRatio(source, totalDivs, cost) {
  if (source && Object.prototype.hasOwnProperty.call(source, 'paid_for_itself') && source.paid_for_itself == null) {
    return null
  }
  const fromApi = finite(source?.paid_for_itself)
  if (fromApi !== null) return fromApi
  if (cost > 0) return totalDivs / cost
  return null
}

function pfiTone(value) {
  const n = finite(value)
  if (n === null) return ''
  if (n >= 1) return 'ci-positive'
  if (n >= 0.5) return 'ci-pfi-mid'
  return ''
}

function hasDefinedCategory(row) {
  const name = String(row.categoryName || '').trim()
  if (row.categoryId !== null && row.categoryId !== undefined && row.categoryId !== '') return true
  return Boolean(name && name !== 'Uncategorized' && name !== 'Sold')
}

function hasDefinedSubcategory(row) {
  const name = String(row.subcategoryName || '').trim()
  if (row.subcategoryId !== null && row.subcategoryId !== undefined && row.subcategoryId !== '') return true
  return Boolean(name)
}

function StackValue({ primary, secondary, tone, title }) {
  return (
    <div className="ci-stack" title={title}>
      <strong className={tone || ''}>{primary}</strong>
      <span>{secondary}</span>
    </div>
  )
}

function MetricCard({ label, value, sub, note, tone, help }) {
  return (
    <div className="summary-card ci-metric-card" title={help}>
      <div className="summary-label">{label}</div>
      <div className={`summary-value ${tone || ''}`}>{value}</div>
      {sub && <div className="summary-sub">{sub}</div>}
      {note && <div className="summary-sub">{note}</div>}
    </div>
  )
}

function FieldHelp() {
  const fields = [
    ['Value', 'Current market value of the open holdings shown after filters. Cash is not included; Dashboard Portfolio Value is holdings plus cash. The lower line is their active cost basis.'],
    ['Total profit', 'Remaining-lot price gain or loss plus guarded lifetime dividends plus realized gain or loss on shares trimmed from still-open tickers. The percent is that total versus invested/profit basis, not versus current value. Cash and fully sold tickers are not included. Same number as Gains & Losses Total Profit.'],
    ['Passive income', 'Estimated next-12-month dividends divided by current holdings value. This is a forward yield on open holdings, not income already received and not yield on cash. The lower line is the dollar estimate.'],
    ['Holding', 'Security name and ticker. Sold rows are marked Sold and shown with a line through the name.'],
    ['Status', 'Open means currently held. Sold means fully sold.'],
    ['Shares', 'Current shares held. Sold rows show 0 because there is no open position.'],
    ['Category / Sub category', 'Portfolio category assignment from the Categories page. Sold rows only show a category when the app can still match an assignment for that ticker.'],
    ['Cost basis', 'Amount invested in the open position. The lower line is average price per share.'],
    ['Current value', 'Current market value of the open position. The lower line is current price per share.'],
    ['Dividends', 'Estimated dividends for the next 12 months. The lower line is the annualized dividend per share, not the next single payment.'],
    ['Dividend yield', 'Upper value is current yield. Lower value is yield on cost.'],
    ['Estimated yield', 'Forward yield estimate based on next-12-month dividends and current value.'],
    ['Dividend growth (5Y)', 'Five-year dividend growth when available from the source data.'],
    ['Total profit', 'For each row, current price gain or loss plus dividends received plus realized profit from sold shares.'],
    ['Share in portfolio', 'The holding’s current value as a percentage of the visible open portfolio value. Sold rows are 0%.'],
    ['Paid for itself', 'Lifetime distributions received divided by original cost. 100% means dividends have paid back the amount invested. Blank when there is not enough purchase history to trust the percentage.'],
    ['Next payment', 'Next listed dividend payment date.'],
    ['Ex-dividend date', 'The listed ex-dividend date.'],
    ['Frequency', 'Dividend payment frequency.'],
    ['Div. received', 'Lifetime dividends recorded for the holding or sold transaction group.'],
    ['Capital gain', 'Current value minus cost basis for open holdings; proceeds minus cost for sold rows.'],
    ['Realized P&L', 'Profit or loss already locked in from shares that were sold.'],
    ['NAV', 'Benchmark-adjusted NAV erosion. Auto/Test/Skip chooses whether this ticker is tested. Type a benchmark such as QQQ, SPY, GLD, or BTC-USD to override the default.'],
  ]

  return (
    <details className="ci-help">
      <summary>Field help</summary>
      <div className="ci-help-body">
        {HELP_ITEMS.map(item => (
          <div key={`${item.kind}-${item.label}`}>
            <small>{item.kind}</small>
            <strong>{item.label}</strong>
            <span>{item.body}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

function HoldingCell({ row }) {
  const letters = row.ticker.slice(0, 4)
  return (
    <div className="ci-holding-cell">
      <div className={`ci-logo ${row.sold ? 'ci-logo-sold' : ''}`}>{letters}</div>
      <div className="ci-holding-copy">
        <strong className="ci-holding-name" title={row.description || row.ticker}>
          {row.description || row.ticker}
        </strong>
        <span>
          {row.onTickerClick && !row.sold ? (
            <button type="button" className="ci-ticker-link" onClick={() => row.onTickerClick(row.ticker)}>
              {row.ticker}
            </button>
          ) : row.ticker}
          {row.sold && <em>Sold</em>}
        </span>
      </div>
    </div>
  )
}

function GradeBadge({ grade }) {
  if (!grade || grade === 'N/A') return <span className="grade-badge grade-na">N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls}`}>{grade}</span>
}

function NavCell({ row }) {
  if (row.sold) return <span className="ci-muted">--</span>
  const meta = row.navMeta || {}
  const scope = row.navScope || 'auto'
  const coverage = row.navCoverage
  const invalid = Boolean(row.navBenchmark && meta.benchmark_valid === false)
  const severity = meta.nav_erosion_severity
  const priceOutage = Boolean(meta.price_data_unavailable)
  const coverageTitle = scope === 'skip'
    ? 'Skipped by user override'
    : priceOutage
      // Without this the cell reads exactly like a holding the rules exempt,
      // and a quote-feed outage looks like a deliberate decision not to test.
      ? (meta.warning
        || 'No price history returned for this ticker right now - retry after the next refresh')
      : invalid
        ? `${row.navBenchmark} is not returning benchmark price history`
        : scope === 'test'
            ? `Forced NAV test${row.navBenchmark || meta.benchmark ? ` vs ${row.navBenchmark || meta.benchmark}` : ''}`
            : meta.nav_tested
              ? `Auto-tested${row.navBenchmark || meta.benchmark ? ` vs ${row.navBenchmark || meta.benchmark}` : ''}`
              : 'Auto: not tested by current NAV erosion rules'
  const identityAvailable = meta.raw_nav_erosion_rate != null
  const overallScore = meta.overall_nav_erosion_score
  const overallSeverity = meta.overall_nav_erosion_severity
  const rateText = value => value == null ? '--' : `${(Number(value) * 100).toFixed(2)}%`
  const identityTitle = identityAvailable
    ? `Raw 1Y accounting: e ${rateText(meta.raw_nav_erosion_rate)}, d ${rateText(meta.distribution_rate_on_starting_nav)}, r ${rateText(meta.accounting_total_return_rate)}; e = d - r. Positive e means NAV ERODER regardless of the benchmark; negative e means NAV rose; zero is flat. Higher r is better. A higher d is more cash, but is not automatically better when d exceeds r`
    : ''
  const coverageGuidance = coverage == null
    ? ''
    : 'Coverage is benchmark-gated and lower is better: 0–0.25 Low, above 0.25–0.75 Medium, above 0.75 High'
  const overallTitle = overallScore == null ? '' : `Overall verdict: ${overallSeverity} NAV erosion risk (${Number(overallScore).toFixed(1)}/100)`
  const title = [overallTitle, coverageTitle, coverageGuidance, identityTitle].filter(Boolean).join('. ')
  const color = severity === 'High'
    ? 'var(--neg)'
    : severity === 'Medium'
      ? 'var(--warning-money)'
      // An outage dash is tinted so it does not read as a dim "nothing to see
      // here" next to the holdings the rules genuinely exempt.
      : priceOutage
        ? 'var(--warning-money)'
        : coverage == null
          ? 'var(--text-dim)'
          : 'var(--pos)'
  return (
    <div className="ci-nav-cell" title={title}>
      <div className="ci-nav-row">
        <strong style={{ color }}>{coverage == null ? '--' : Number(coverage).toFixed(2)}</strong>
        <select
          aria-label={`${row.ticker} NAV erosion testing`}
          value={scope}
          onChange={event => row.onNavScope?.(row.ticker, event.target.value, row.navBenchmark)}
        >
          <option value="auto">Auto</option>
          <option value="test">Test</option>
          <option value="skip">Skip</option>
        </select>
      </div>
      <input
        aria-label={`${row.ticker} NAV benchmark override`}
        value={row.navBenchmarkInput ?? ''}
        placeholder={meta.benchmark || 'bench'}
        onChange={event => row.onNavBenchmarkDraft?.(row.ticker, event.target.value)}
        onBlur={event => row.onNavScope?.(row.ticker, scope, event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        style={{ borderColor: invalid ? 'var(--neg)' : undefined }}
      />
      {identityAvailable && (
        <div style={{ marginTop: 3, fontSize: '0.66rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          e {rateText(meta.raw_nav_erosion_rate)} · d {rateText(meta.distribution_rate_on_starting_nav)} · r {rateText(meta.accounting_total_return_rate)}
        </div>
      )}
      {overallScore != null && (
        <div style={{ marginTop: 2, fontSize: '0.66rem', fontWeight: 700, color: overallSeverity === 'High' ? 'var(--neg)' : overallSeverity === 'Medium' ? 'var(--warning-money)' : 'var(--pos)', whiteSpace: 'nowrap' }}>
          {String(overallSeverity).toUpperCase()} RISK · {Number(overallScore).toFixed(1)}/100
        </div>
      )}
    </div>
  )
}

function buildCategoryLookup(categoryData) {
  const byTicker = new Map()
  const byName = new Map()
  const categories = categoryData?.categories || []

  categories.forEach(category => {
    byName.set(String(category.name || '').toLowerCase(), category.id)
    const subById = new Map((category.subcategories || []).map(sub => [String(sub.id), sub.name]))
    ;(category.tickers || []).forEach(ticker => {
      byTicker.set(String(ticker.ticker || '').toUpperCase(), {
        categoryId: category.id,
        categoryName: category.name,
        subcategoryId: ticker.subcategory_id ?? null,
        subcategoryName: ticker.subcategory_id != null ? subById.get(String(ticker.subcategory_id)) : null,
      })
    })
  })

  ;(categoryData?.unallocated || []).forEach(ticker => {
    byTicker.set(String(ticker.ticker || '').toUpperCase(), {
      categoryId: null,
      categoryName: 'Uncategorized',
      subcategoryId: null,
      subcategoryName: null,
    })
  })

  return { byTicker, byName }
}

function activeRow(holding, categoryLookup, totalActiveValue, dividendGrowth) {
  const ticker = String(holding.ticker || '').toUpperCase()
  const growth = dividendGrowth?.[ticker] || {}
  const lookup = categoryLookup.byTicker.get(ticker)
  const fallbackCategoryId = holding.category
    ? categoryLookup.byName.get(String(holding.category).toLowerCase()) ?? null
    : null
  const categoryName = lookup?.categoryName || holding.category || 'Uncategorized'
  const categoryId = lookup?.categoryId ?? fallbackCategoryId
  const subcategoryId = lookup?.subcategoryId ?? holding.subcategory_id ?? null
  const subcategoryName = lookup?.subcategoryName || holding.subcategory || ''

  const quantity = num(holding.quantity)
  const costBasis = num(holding.purchase_value)
  const currentValue = num(holding.current_value)
  const avgCost = quantity > 0 ? costBasis / quantity : num(holding.price_paid)
  const currentPrice = quantity > 0 ? currentValue / quantity : num(holding.current_price)
  const annualDividends = num(holding.estim_payment_per_year)
  const dividendPerShare = quantity > 0 ? annualDividends / quantity : num(holding.div)
  const currentYield = currentValue > 0 ? annualDividends / currentValue : num(holding.current_annual_yield)
  const yieldOnCost = costBasis > 0 ? annualDividends / costBasis : num(holding.annual_yield_on_cost)
  const parts = holdingLifetimeReturnParts(holding)
  const totalDivs = parts.distributions
  const realizedProfit = parts.realized
  const capitalGain = parts.gainLoss
  const capitalGainPct = costBasis > 0 ? capitalGain / costBasis : null
  const totalProfit = parts.totalReturnDollar
  const profitBasis = parts.totalReturnBasis || costBasis
  const totalProfitPct = parts.totalReturnRatio
  const shareOfPortfolio = totalActiveValue > 0 ? currentValue / totalActiveValue : 0

  return {
    id: `open-${ticker}`,
    ticker,
    description: holding.description || '',
    status: 'Open',
    sold: false,
    categoryId,
    categoryName,
    subcategoryId,
    subcategoryName,
    quantity,
    costBasis,
    avgCost,
    currentValue,
    currentPrice,
    annualDividends,
    dividendPerShare,
    currentYield,
    yieldOnCost,
    estimatedYield: currentYield,
    dividendGrowth5y: growth.div_growth_5y ?? holding.div_growth_5y ?? holding.dividend_growth_5y ?? holding.dividend_growth_pct ?? null,
    totalDivs,
    capitalGain,
    capitalGainPct,
    realizedProfit,
    totalProfit,
    totalProfitPct,
    profitBasis,
    shareOfPortfolio,
    paidForItself: paidForItselfRatio(holding, totalDivs, costBasis),
    nextPayment: holding.div_pay_date || '',
    nextPaymentEstimated: !!holding.div_pay_date_estimated,
    exDividend: holding.ex_div_date || '',
    frequency: FREQ_LABELS[String(holding.div_frequency || '').toUpperCase()] || holding.div_frequency || '--',
    nav_erosion_scope: holding.nav_erosion_scope || 'auto',
    nav_benchmark_override: holding.nav_benchmark_override || '',
  }
}

function soldRows(realizedRows, openTickers, categoryLookup, dividendGrowth = {}) {
  const grouped = new Map()

  ;(realizedRows || []).forEach(row => {
    const ticker = String(row.ticker || '').toUpperCase()
    if (!ticker || openTickers.has(ticker)) return

    const current = grouped.get(ticker) || {
      id: `sold-${ticker}`,
      ticker,
      description: '',
      status: 'Sold',
      sold: true,
      categoryId: null,
      categoryName: 'Sold',
      subcategoryId: null,
      subcategoryName: '',
      quantity: 0,
      sharesSold: 0,
      costBasis: 0,
      avgCost: 0,
      currentValue: 0,
      currentPrice: 0,
      annualDividends: 0,
      dividendPerShare: 0,
      currentYield: null,
      yieldOnCost: null,
      estimatedYield: null,
      dividendGrowth5y: null,
      totalDivs: 0,
      capitalGain: 0,
      capitalGainPct: null,
      realizedProfit: 0,
      totalProfit: 0,
      totalProfitPct: null,
      profitBasis: 0,
      shareOfPortfolio: 0,
      nextPayment: '',
      exDividend: '',
      frequency: '--',
      sellDate: '',
      proceeds: 0,
    }

    const sharesSold = num(row.shares_sold)
    const cost = num(row.cost_basis)
    const proceeds = num(row.proceeds)
    current.sharesSold += sharesSold
    current.profitBasis += cost
    current.proceeds += proceeds
    current.totalDivs += num(row.divs_received)
    current.capitalGain += num(row.price_gl)
    current.realizedProfit += num(row.price_gl)
    current.totalProfit += num(row.total_gl)
    current.sellDate = latestDate(current.sellDate, row.sell_date)
    current.currentPrice = num(row.sell_price) || current.currentPrice

    grouped.set(ticker, current)
  })

  return Array.from(grouped.values()).map(row => {
    const lookup = categoryLookup.byTicker.get(row.ticker)
    const growth = dividendGrowth?.[row.ticker] || {}
    const categoryName = lookup?.categoryName || row.categoryName
    const categoryId = lookup?.categoryId ?? row.categoryId
    const subcategoryId = lookup?.subcategoryId ?? row.subcategoryId
    const subcategoryName = lookup?.subcategoryName || row.subcategoryName
    const avgCost = row.sharesSold > 0 ? row.profitBasis / row.sharesSold : 0
    return {
      ...row,
      categoryId,
      categoryName,
      subcategoryId,
      subcategoryName,
      avgCost,
      dividendGrowth5y: growth.div_growth_5y ?? row.dividendGrowth5y,
      capitalGainPct: row.profitBasis > 0 ? row.capitalGain / row.profitBasis : null,
      totalProfitPct: row.profitBasis > 0 ? row.totalProfit / row.profitBasis : null,
      paidForItself: paidForItselfRatio(null, row.totalDivs, row.profitBasis),
    }
  })
}

const COLUMN_DEFS = {
  holding: {
    label: 'Holding',
    className: 'ci-holding-column',
    sortValue: row => row.ticker,
    render: row => <HoldingCell row={row} />,
  },
  grade: {
    label: 'Grade',
    sortValue: row => GRADE_RANK[row.grade] || 0,
    render: row => row.grade ? <GradeBadge grade={row.grade} /> : <span className="ci-muted">--</span>,
  },
  status: {
    label: 'Status',
    sortValue: row => row.status,
    render: row => <span className={`ci-status ${row.sold ? 'sold' : 'open'}`}>{row.status}</span>,
  },
  shares: {
    label: 'Shares',
    align: 'right',
    sortValue: row => row.quantity,
    render: row => <span>{shares(row.quantity)}</span>,
  },
  category: {
    label: 'Category',
    sortValue: row => row.categoryName,
    render: row => hasDefinedCategory(row) ? text(row.categoryName) : '',
  },
  subcategory: {
    label: 'Sub category',
    sortValue: row => row.subcategoryName,
    render: row => hasDefinedSubcategory(row) ? text(row.subcategoryName) : '',
  },
  costBasis: {
    label: 'Cost basis',
    align: 'right',
    sortValue: row => row.costBasis || row.profitBasis,
    render: row => (
      <StackValue
        primary={money(row.costBasis)}
        secondary={money(row.avgCost, { digits: 4 })}
      />
    ),
  },
  avgCost: {
    label: 'Average price paid',
    align: 'right',
    sortValue: row => row.avgCost,
    render: row => money(row.avgCost, { digits: 4 }),
  },
  currentValue: {
    label: 'Current value',
    align: 'right',
    sortValue: row => row.currentValue,
    render: row => (
      <StackValue
        primary={money(row.currentValue)}
        secondary={money(row.currentPrice, { digits: 4 })}
      />
    ),
  },
  currentPrice: {
    label: 'Current share price',
    align: 'right',
    sortValue: row => row.currentPrice,
    render: row => money(row.currentPrice, { digits: 4 }),
  },
  dividends: {
    label: 'Dividends',
    align: 'right',
    sortValue: row => row.annualDividends,
    render: row => (
      <StackValue
        primary={money(row.annualDividends)}
        secondary={`${money(row.dividendPerShare, { digits: 4 })}/share`}
        title="Estimated dividends for the next 12 months. The lower value is annualized dividend per share, not the next single payment."
      />
    ),
  },
  dividendYield: {
    label: 'Dividend yield',
    align: 'right',
    sortValue: row => row.currentYield ?? -1,
    render: row => (
      <StackValue
        primary={pct(row.currentYield)}
        secondary={pct(row.yieldOnCost)}
      />
    ),
  },
  estimatedYield: {
    label: 'Estimated yield',
    align: 'right',
    sortValue: row => row.estimatedYield ?? -1,
    render: row => (
      <StackValue
        primary={pct(row.estimatedYield)}
        secondary="next 12 mo"
      />
    ),
  },
  dividendGrowth: {
    label: 'Dividend growth (5Y)',
    align: 'right',
    sortValue: row => finite(row.dividendGrowth5y) ?? -999,
    render: row => <span className={valueTone(row.dividendGrowth5y)}>{growthDisplay(row.dividendGrowth5y)}</span>,
  },
  totalProfit: {
    label: 'Total profit',
    align: 'right',
    sortValue: row => row.totalProfit,
    render: row => (
      <StackValue
        primary={signedMoney(row.totalProfit)}
        secondary={pct(row.totalProfitPct, { signed: true })}
        tone={valueTone(row.totalProfit)}
      />
    ),
  },
  shareOfPortfolio: {
    label: 'Share in portfolio',
    align: 'right',
    sortValue: row => row.shareOfPortfolio,
    render: row => pct(row.shareOfPortfolio),
  },
  paidForItself: {
    label: 'Paid for itself',
    align: 'right',
    sortValue: row => row.paidForItself ?? -1,
    render: row => (
      <span
        className={pfiTone(row.paidForItself)}
        style={{ fontWeight: finite(row.paidForItself) >= 1 ? 700 : 400 }}
        title="Lifetime distributions received as a percent of original cost"
      >
        {pct(row.paidForItself)}
      </span>
    ),
  },
  nextPayment: {
    label: 'Next payment',
    sortValue: row => row.nextPayment,
    render: row => text(`${row.nextPaymentEstimated ? '~' : ''}${row.nextPayment || ''}`),
  },
  exDividend: {
    label: 'Ex-dividend date',
    sortValue: row => row.exDividend,
    render: row => text(row.exDividend),
  },
  frequency: {
    label: 'Frequency',
    sortValue: row => row.frequency,
    render: row => text(row.frequency),
  },
  divsReceived: {
    label: 'Div. received',
    align: 'right',
    sortValue: row => row.totalDivs,
    render: row => money(row.totalDivs),
  },
  // Price gain on the shares still held. A sold row has no open position, so it
  // shows a dash rather than its realized gain under an "unrealized" heading.
  unrealizedGain: {
    label: 'Unrealized gain',
    align: 'right',
    sortValue: row => (row.sold ? 0 : row.capitalGain),
    render: row => (row.sold
      ? <span className="ci-muted">--</span>
      : <span className={valueTone(row.capitalGain)}>{signedMoney(row.capitalGain)}</span>),
  },
  unrealizedPct: {
    label: 'Unrealized %',
    align: 'right',
    sortValue: row => (row.sold ? 0 : (row.capitalGainPct ?? 0)),
    render: row => (row.sold
      ? <span className="ci-muted">--</span>
      : <span className={valueTone(row.capitalGain)}>{pct(row.capitalGainPct, { signed: true })}</span>),
  },
  capitalGain: {
    label: 'Capital gain',
    align: 'right',
    sortValue: row => row.capitalGain,
    render: row => (
      <StackValue
        primary={signedMoney(row.capitalGain)}
        secondary={pct(row.capitalGainPct, { signed: true })}
        tone={valueTone(row.capitalGain)}
      />
    ),
  },
  realizedProfit: {
    label: 'Realized P&L',
    align: 'right',
    sortValue: row => row.realizedProfit,
    render: row => <span className={valueTone(row.realizedProfit)}>{signedMoney(row.realizedProfit)}</span>,
  },
  nav: {
    label: 'NAV',
    align: 'right',
    sortValue: row => row.navCoverage ?? -1,
    render: row => <NavCell row={row} />,
  },
}

async function readJson(responsePromise) {
  const response = await responsePromise
  const data = await response.json()
  if (!response.ok || data?.error) {
    throw new Error(data?.error || 'Request failed')
  }
  return data
}

// Whichever column the user drags into the first slot is the frozen one, so the
// pin follows the layout instead of staying nailed to Holding.
function cellClass(column, index) {
  return [
    column.className,
    index === 0 ? 'ci-frozen-col' : null,
    column.align === 'right' ? 'ci-number' : null,
  ].filter(Boolean).join(' ') || undefined
}

// The footer only totals the columns that have a total. 'Totals' labels the
// first column, unless that column carries a figure of its own.
function footerValue(key, index, totals, filteredRows) {
  switch (key) {
    case 'shares': return shares(filteredRows.reduce((sum, row) => sum + row.quantity, 0))
    case 'costBasis': return money(totals.costBasis)
    case 'currentValue': return money(totals.currentValue)
    case 'dividends': return money(totals.annualIncome)
    case 'dividendYield':
    case 'estimatedYield': return pct(totals.passiveYield)
    case 'unrealizedGain': return signedMoney(totals.unrealizedGain)
    case 'unrealizedPct': return pct(totals.unrealizedPct, { signed: true })
    case 'totalProfit': return signedMoney(totals.visibleTotalProfit)
    case 'paidForItself': return pct(totals.paidForItself)
    case 'divsReceived': return money(filteredRows.reduce((sum, row) => sum + row.totalDivs, 0))
    default: return index === 0 ? 'Totals' : ''
  }
}

/**
 * One view's table, with its own draggable column order.
 *
 * Rendered with key={view} so switching views remounts it: the layout hook
 * reads its saved order once, on mount, and a live component would otherwise
 * carry the previous view's order into the new view's storage key.
 */
function HoldingsOverviewTable({ view, columns, rows, filteredRows, totals, sortKey, sortDir, onSort }) {
  const layout = useColumnLayout({
    storageKey: COLUMN_LAYOUT_KEY(view),
    columns,
    lockedKeys: LOCKED_COLUMNS,
    adoptNewKeys: saved => insertMissingKeysAfter(saved, ADOPTED_COLUMNS[view] || []),
  })
  const activeColumns = layout.activeColumns

  return (
    <>
      <div className="holdings-column-bar">
        <span className="column-bar-hint">
          Drag any header to move that column, or use <strong>Columns</strong> to reorder and
          hide them. Each view remembers its own layout.
        </span>
        <ColumnCustomizer
          layout={layout}
          detailOf={col => (COLUMN_HELP[col.key] || '').replace('Column: ', '')}
          buttonLabel="Columns"
          hint="Drag a row to reorder, or drag a header on the table itself. Uncheck a column to hide it."
        />
      </div>
      <div className="sticky-table-wrap ci-table-wrap">
        <table className="ci-table">
          <thead>
            <tr>
              {activeColumns.map((column, index) => {
                const key = column.key
                const active = sortKey === key
                const help = COLUMN_HELP[key] || `Column: ${column.label}`
                return (
                  <th
                    key={key}
                    className={layout.dragClass(key, cellClass(column, index))}
                    onClick={() => onSort(key)}
                    title={`${help}\nClick to sort by ${column.label}.\nDrag this header to move the column.`}
                    {...layout.dragHandlers(key)}
                  >
                    <span>{column.label}</span>
                    <small>{active ? (sortDir === 'asc' ? '^' : 'v') : ''}</small>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.id}
                className={`${row.sold ? 'ci-row-sold' : ''}${row.navMeta?.nav_erosion_severity === 'High' ? ' ci-row-nav-high' : ''}`}
              >
                {activeColumns.map((column, index) => (
                  <td key={column.key} className={cellClass(column, index)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                {activeColumns.map((column, index) => (
                  <td key={column.key} className={cellClass(column, index)}>
                    <strong className={
                      column.key === 'totalProfit' ? valueTone(totals.visibleTotalProfit)
                        : column.key === 'paidForItself' ? pfiTone(totals.paidForItself)
                          : column.key === 'unrealizedGain' || column.key === 'unrealizedPct'
                            ? valueTone(totals.unrealizedGain)
                            : ''
                    }>{footerValue(column.key, index, totals, filteredRows)}</strong>
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length === 0 && (
          <div className="ci-empty">No holdings match the current filters.</div>
        )}
      </div>
    </>
  )
}

export function CommonInfoPanel({ embedded = false, onTickerClick, onNavChange, tickerGrades = {} }) {
  const pf = useProfileFetch()
  const { selection, basisMode } = useProfile()
  const [holdings, setHoldings] = useState([])
  const [gainsLosses, setGainsLosses] = useState(null)
  const [categoryData, setCategoryData] = useState({ categories: [], unallocated: [] })
  const [dividendGrowth, setDividendGrowth] = useState({})
  const [coverage, setCoverage] = useState({})
  const [coverageMeta, setCoverageMeta] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('common')
  const [showSold, setShowSold] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [subcategoryId, setSubcategoryId] = useState('')
  const [sortKey, setSortKey] = useState('totalProfit')
  const [sortDir, setSortDir] = useState('desc')
  const searchRef = useRef(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    Promise.all([
      readJson(pf('/api/holdings')),
      readJson(pf('/api/gains-losses/summary')),
      readJson(pf('/api/categories/data')),
    ])
      .then(([holdingRows, glRows, catRows]) => {
        if (!alive) return
        setHoldings(Array.isArray(holdingRows) ? holdingRows : [])
        setGainsLosses(glRows || null)
        setCategoryData(catRows || { categories: [], unallocated: [] })
      })
      .catch(err => {
        if (!alive) return
        setError(err.message || 'Failed to load holdings overview')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [pf, selection, basisMode])

  const growthTickers = useMemo(() => {
    const tickers = new Set()
    holdings.forEach(holding => {
      const ticker = String(holding.ticker || '').trim().toUpperCase()
      if (ticker) tickers.add(ticker)
    })
    ;(gainsLosses?.realized || []).forEach(row => {
      const ticker = String(row.ticker || '').trim().toUpperCase()
      if (ticker) tickers.add(ticker)
    })
    return Array.from(tickers).sort().join(',')
  }, [holdings, gainsLosses])

  useEffect(() => {
    let alive = true
    if (!growthTickers) {
      setDividendGrowth({})
      return () => { alive = false }
    }
    readJson(pf(`/api/holdings/dividend-growth?tickers=${encodeURIComponent(growthTickers)}`))
      .then(data => {
        if (alive) setDividendGrowth(data?.growth || {})
      })
      .catch(() => {
        if (alive) setDividendGrowth({})
      })
    return () => { alive = false }
  }, [pf, growthTickers])

  const refreshCoverage = useCallback(() => {
    return readJson(pf('/api/portfolio-coverage'))
      .then(data => {
        const map = {}
        const meta = {}
        ;(data.results || []).forEach(row => {
          if (row.coverage_ratio != null) map[row.ticker] = row.coverage_ratio
          meta[row.ticker] = {
            nav_tested: !!row.nav_tested,
            benchmark: row.benchmark || null,
            benchmark_valid: row.benchmark_valid !== false,
            nav_erosion_scope: row.nav_erosion_scope || 'auto',
            nav_benchmark_override: row.nav_benchmark_override || '',
            nav_erosion_severity: row.nav_erosion_severity || null,
            price_data_unavailable: !!row.price_data_unavailable,
            warning: row.warning || null,
            raw_nav_erosion_rate: row.raw_nav_erosion_rate,
            distribution_rate_on_starting_nav: row.distribution_rate_on_starting_nav,
            accounting_total_return_rate: row.accounting_total_return_rate,
            raw_payout_gap_ratio: row.raw_payout_gap_ratio,
            overall_nav_erosion_score: row.overall_nav_erosion_score,
            overall_nav_erosion_severity: row.overall_nav_erosion_severity,
            accounting_window_start: row.accounting_window_start,
            accounting_window_end: row.accounting_window_end,
          }
        })
        setCoverage(map)
        setCoverageMeta(meta)
      })
      .catch(() => {})
  }, [pf])

  useEffect(() => {
    refreshCoverage()
  }, [refreshCoverage, selection])

  const updateNavScope = useCallback((ticker, scope, benchmark = '') => {
    const navBenchmark = String(benchmark || '').trim().toUpperCase()
    setHoldings(prev => prev.map(row => (
      row.ticker === ticker
        ? { ...row, nav_erosion_scope: scope, nav_benchmark_override: navBenchmark }
        : row
    )))
    setCoverageMeta(prev => ({
      ...prev,
      [ticker]: {
        ...(prev[ticker] || {}),
        nav_erosion_scope: scope,
        nav_benchmark_override: navBenchmark,
      },
    }))
    pf(`/api/holdings/${ticker}/nav-erosion-scope`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nav_erosion_scope: scope,
        nav_benchmark_override: navBenchmark,
      }),
    })
      .then(() => {
        refreshCoverage()
        onNavChange?.()
      })
      .catch(() => {
        setError(`Could not update ${ticker} NAV test setting.`)
      })
  }, [pf, onNavChange, refreshCoverage])

  const draftNavBenchmark = useCallback((ticker, value) => {
    const next = String(value || '').toUpperCase()
    setHoldings(prev => prev.map(row => (
      row.ticker === ticker ? { ...row, nav_benchmark_override: next } : row
    )))
  }, [])

  const categoryLookup = useMemo(() => buildCategoryLookup(categoryData), [categoryData])

  const allRows = useMemo(() => {
    const totalActiveValue = holdings.reduce((sum, holding) => sum + num(holding.current_value), 0)
    const openRows = holdings.map(holding => activeRow(holding, categoryLookup, totalActiveValue, dividendGrowth))
    const openTickers = new Set(openRows.map(row => row.ticker))
    const closedRows = soldRows(gainsLosses?.realized, openTickers, categoryLookup, dividendGrowth)
    const withNav = (row) => {
      const ticker = row.ticker
      const meta = coverageMeta[ticker] || {}
      return {
        ...row,
        onTickerClick,
        grade: tickerGrades[ticker]?.grade || null,
        navScope: row.sold ? 'skip' : (row.nav_erosion_scope || meta.nav_erosion_scope || 'auto'),
        navBenchmark: row.nav_benchmark_override || meta.nav_benchmark_override || '',
        navBenchmarkInput: row.nav_benchmark_override ?? meta.nav_benchmark_override ?? '',
        navCoverage: coverage[ticker],
        navMeta: meta,
        onNavScope: updateNavScope,
        onNavBenchmarkDraft: draftNavBenchmark,
      }
    }
    const rows = showSold ? [...openRows, ...closedRows] : openRows
    return rows.map(withNav)
  }, [holdings, gainsLosses, categoryLookup, dividendGrowth, showSold, coverage, coverageMeta, onTickerClick, tickerGrades, updateNavScope, draftNavBenchmark])

  const selectedCategory = useMemo(() => {
    if (!categoryId) return null
    return (categoryData.categories || []).find(category => String(category.id) === String(categoryId)) || null
  }, [categoryData, categoryId])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return allRows.filter(row => {
      if (categoryId && String(row.categoryId ?? '') !== String(categoryId)) return false
      if (subcategoryId && String(row.subcategoryId ?? '') !== String(subcategoryId)) return false
      if (!query) return true
      return (
        row.ticker.toLowerCase().includes(query) ||
        String(row.description || '').toLowerCase().includes(query) ||
        String(row.categoryName || '').toLowerCase().includes(query)
      )
    })
  }, [allRows, categoryId, subcategoryId, search])

  // Every column this view can show, in the order the view defines it. Each one
  // carries its own key so the layout hook and the cells do not have to look it
  // back up out of COLUMN_DEFS. The user's saved order is applied downstream.
  const viewColumns = useMemo(() => {
    const hasCategory = filteredRows.some(hasDefinedCategory)
    const hasSubcategory = filteredRows.some(hasDefinedSubcategory)
    return VIEW_COLUMNS[view]
      .filter(key => key !== 'category' || hasCategory)
      .filter(key => key !== 'subcategory' || hasSubcategory)
      .map(key => ({ key, ...COLUMN_DEFS[key] }))
  }, [filteredRows, view])

  const sortedRows = useMemo(() => {
    const column = COLUMN_DEFS[sortKey] || COLUMN_DEFS.holding
    return [...filteredRows].sort((a, b) => {
      const av = column.sortValue ? column.sortValue(a) : a[sortKey]
      const bv = column.sortValue ? column.sortValue(b) : b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredRows, sortKey, sortDir])

  const totals = useMemo(() => {
    const activeRows = filteredRows.filter(row => !row.sold)
    const currentValue = activeRows.reduce((sum, row) => sum + row.currentValue, 0)
    const costBasis = activeRows.reduce((sum, row) => sum + row.costBasis, 0)
    const annualIncome = activeRows.reduce((sum, row) => sum + row.annualDividends, 0)
    const unrealizedGain = activeRows.reduce((sum, row) => sum + row.capitalGain, 0)
    const totalProfit = activeRows.reduce((sum, row) => sum + row.totalProfit, 0)
    const profitBasis = activeRows.reduce((sum, row) => sum + (row.profitBasis || row.costBasis), 0)
    const visibleTotalProfit = filteredRows.reduce((sum, row) => sum + row.totalProfit, 0)
    const passiveYield = currentValue > 0 ? annualIncome / currentValue : null
    const profitPct = profitBasis > 0 ? totalProfit / profitBasis : null
    const pfiRows = filteredRows.filter(row => row.paidForItself != null && (row.profitBasis || row.costBasis) > 0)
    const pfiDivs = pfiRows.reduce((sum, row) => sum + row.totalDivs, 0)
    const pfiCost = pfiRows.reduce((sum, row) => sum + (row.profitBasis || row.costBasis), 0)
    const paidForItself = pfiCost > 0 ? pfiDivs / pfiCost : null
    return {
      currentValue,
      costBasis,
      annualIncome,
      unrealizedGain,
      unrealizedPct: costBasis > 0 ? unrealizedGain / costBasis : null,
      totalProfit,
      visibleTotalProfit,
      profitBasis,
      passiveYield,
      profitPct,
      paidForItself,
    }
  }, [filteredRows])

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(dir => dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'holding' ? 'asc' : 'desc')
    }
  }

  const clearFilters = () => {
    setCategoryId('')
    setSubcategoryId('')
    setSearch('')
    searchRef.current?.focus()
  }

  return (
    <div className={embedded ? 'card common-info-embed' : 'page dashboard common-info-page'} id="holdings-overview">
      <div className="ci-header">
        <div>
          <h2 className={embedded ? 'ci-embed-title' : undefined}>{embedded ? 'Holdings overview' : 'Holdings overview'}</h2>
          <p>
            {embedded
              ? 'Snowball-style views of this account. Assign a NAV benchmark on each row. Edit lots and DRIP on Holdings.'
              : 'Portfolio holdings with forward income, yields, total profit, sold positions, and NAV benchmark assignment.'}
          </p>
        </div>
        <div className="ci-view-tabs" aria-label="Holdings overview views">
          {VIEW_LABELS.map(item => (
            <button
              key={item.key}
              className={`tr-pbtn${view === item.key ? ' tr-pbtn-active' : ''}`}
              onClick={() => setView(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
          {embedded && (
            <NavLink to="/holdings" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.28rem 0.65rem' }}>
              Edit on Holdings
            </NavLink>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="summary-strip ci-summary-strip">
        <MetricCard
          label="Value"
          value={formatMoneyWhole(totals.currentValue, { fallback: '--' })}
          sub={`${formatMoneyWhole(totals.costBasis, { fallback: '--' })} cost basis`}
          note="Open holdings only — cash not included"
          help={SUMMARY_HELP.value}
        />
        <MetricCard
          label="Total profit"
          value={signedMoney(totals.totalProfit, { digits: 0 })}
          sub={`${pct(totals.profitPct, { signed: true })} vs cost basis`}
          note="Open holdings: price G/L + dividends + realized trims"
          tone={valueTone(totals.totalProfit)}
          help={SUMMARY_HELP.totalProfit}
        />
        <MetricCard
          label="Passive income"
          value={pct(totals.passiveYield)}
          sub={`${formatMoneyWhole(totals.annualIncome, { fallback: '--' })} annually`}
          note="Forward yield on holdings — cash not included"
          tone="ci-positive"
          help={SUMMARY_HELP.passiveIncome}
        />
      </div>

      <div className="ci-toolbar">
        <label className="ci-field">
          <span>Category</span>
          <select
            value={categoryId}
            onChange={event => {
              setCategoryId(event.target.value)
              setSubcategoryId('')
            }}
          >
            <option value="">All categories</option>
            {(categoryData.categories || []).map(category => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label className="ci-field">
          <span>Sub category</span>
          <select
            value={subcategoryId}
            disabled={!selectedCategory?.subcategories?.length}
            onChange={event => setSubcategoryId(event.target.value)}
          >
            <option value="">All sub categories</option>
            {(selectedCategory?.subcategories || []).map(subcategory => (
              <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>
            ))}
          </select>
        </label>
        <label className="ci-check">
          <input
            type="checkbox"
            checked={showSold}
            onChange={event => setShowSold(event.target.checked)}
          />
          <span>Show sold</span>
        </label>
        <div className="ci-search">
          <input
            ref={searchRef}
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search..."
            aria-label="Search holdings"
          />
          {(search || categoryId || subcategoryId) && (
            <button type="button" onClick={clearFilters} title="Clear filters">x</button>
          )}
        </div>
      </div>

      <FieldHelp />

      {loading ? (
        <div className="ci-loading"><span className="spinner" /> Loading holdings overview...</div>
      ) : (
        <HoldingsOverviewTable
          key={view}
          view={view}
          columns={viewColumns}
          rows={sortedRows}
          filteredRows={filteredRows}
          totals={totals}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}
    </div>
  )
}

export default function CommonInfo() {
  return <CommonInfoPanel />
}
