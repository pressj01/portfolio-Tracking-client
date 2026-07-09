import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { formatMoney, formatMoneyWhole } from '../utils/money'

const VIEW_COLUMNS = {
  common: [
    'holding', 'shares', 'avgCost', 'currentPrice', 'category', 'subcategory', 'costBasis', 'currentValue', 'dividends',
    'dividendYield', 'estimatedYield', 'dividendGrowth', 'totalProfit', 'shareOfPortfolio',
  ],
  general: [
    'holding', 'status', 'shares', 'category', 'subcategory',
    'avgCost', 'currentPrice', 'costBasis', 'currentValue', 'shareOfPortfolio',
  ],
  dividends: [
    'holding', 'shares', 'category', 'subcategory', 'currentValue', 'dividends', 'dividendYield',
    'estimatedYield', 'dividendGrowth', 'nextPayment', 'exDividend', 'frequency',
  ],
  returns: [
    'holding', 'category', 'subcategory', 'costBasis', 'currentValue', 'divsReceived',
    'capitalGain', 'realizedProfit', 'totalProfit', 'shareOfPortfolio',
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

const SUMMARY_HELP = {
  value: 'Summary card: current market value of the open holdings shown after filters. The lower line is their active cost basis.',
  totalProfit: 'Summary card: price gain or loss plus dividends received plus realized profit or loss from sold shares. The lower line is the return percentage against the available profit basis.',
  passiveIncome: 'Summary card: estimated forward annual dividends divided by current value. The lower line is the next-12-month dividend estimate.',
}

const COLUMN_HELP = {
  holding: 'Column: security name and ticker. Sold rows are marked Sold and shown with a line through the name.',
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
  nextPayment: 'Column: next listed dividend payment date.',
  exDividend: 'Column: the listed ex-dividend date.',
  frequency: 'Column: dividend payment frequency.',
  divsReceived: 'Column: lifetime dividends recorded for the holding or sold transaction group.',
  capitalGain: 'Column: current value minus cost basis for open holdings; proceeds minus cost for sold rows.',
  realizedProfit: 'Column: profit or loss already locked in from shares that were sold.',
}

const HELP_ITEMS = [
  { kind: 'Summary card', label: 'Value', body: SUMMARY_HELP.value.replace('Summary card: ', '') },
  { kind: 'Summary card', label: 'Total profit', body: SUMMARY_HELP.totalProfit.replace('Summary card: ', '') },
  { kind: 'Summary card', label: 'Passive income', body: SUMMARY_HELP.passiveIncome.replace('Summary card: ', '') },
  { kind: 'Table column', label: 'Holding', body: COLUMN_HELP.holding.replace('Column: ', '') },
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
  { kind: 'Table column', label: 'Next payment', body: COLUMN_HELP.nextPayment.replace('Column: ', '') },
  { kind: 'Table column', label: 'Ex-dividend date', body: COLUMN_HELP.exDividend.replace('Column: ', '') },
  { kind: 'Table column', label: 'Frequency', body: COLUMN_HELP.frequency.replace('Column: ', '') },
  { kind: 'Table column', label: 'Div. received', body: COLUMN_HELP.divsReceived.replace('Column: ', '') },
  { kind: 'Table column', label: 'Capital gain', body: COLUMN_HELP.capitalGain.replace('Column: ', '') },
  { kind: 'Table column', label: 'Realized P&L', body: COLUMN_HELP.realizedProfit.replace('Column: ', '') },
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

function MetricCard({ label, value, sub, tone, help }) {
  return (
    <div className="summary-card ci-metric-card" title={help}>
      <div className="summary-label">{label}</div>
      <div className={`summary-value ${tone || ''}`}>{value}</div>
      {sub && <div className="summary-sub">{sub}</div>}
    </div>
  )
}

function FieldHelp() {
  const fields = [
    ['Value', 'Current market value of the open holdings shown after filters. The lower line is their active cost basis.'],
    ['Total profit', 'Price gain or loss plus dividends received plus realized profit or loss from sold shares. The lower line is the return percentage against the available profit basis.'],
    ['Passive income', 'Estimated forward annual dividends divided by current value. The lower line is the next-12-month dividend estimate.'],
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
    ['Next payment', 'Next listed dividend payment date.'],
    ['Ex-dividend date', 'The listed ex-dividend date.'],
    ['Frequency', 'Dividend payment frequency.'],
    ['Div. received', 'Lifetime dividends recorded for the holding or sold transaction group.'],
    ['Capital gain', 'Current value minus cost basis for open holdings; proceeds minus cost for sold rows.'],
    ['Realized P&L', 'Profit or loss already locked in from shares that were sold.'],
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
          {row.ticker}
          {row.sold && <em>Sold</em>}
        </span>
      </div>
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
  const totalDivs = num(holding.total_return_divs_component ?? holding.total_divs_received)
  const realizedProfit = num(holding.total_return_realized_component ?? holding.realized_gains)
  const capitalGain = num(holding.gain_or_loss)
  const capitalGainPct = costBasis > 0 ? capitalGain / costBasis : null
  const totalProfit = capitalGain + totalDivs + realizedProfit
  const profitBasis = num(holding.total_return_basis) || costBasis
  const totalProfitPct = profitBasis > 0 ? totalProfit / profitBasis : null
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
    nextPayment: holding.div_pay_date || '',
    exDividend: holding.ex_div_date || '',
    frequency: FREQ_LABELS[String(holding.div_frequency || '').toUpperCase()] || holding.div_frequency || '--',
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
  nextPayment: {
    label: 'Next payment',
    sortValue: row => row.nextPayment,
    render: row => text(row.nextPayment),
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
}

async function readJson(responsePromise) {
  const response = await responsePromise
  const data = await response.json()
  if (!response.ok || data?.error) {
    throw new Error(data?.error || 'Request failed')
  }
  return data
}

export default function CommonInfo() {
  const pf = useProfileFetch()
  const { selection, basisMode } = useProfile()
  const [holdings, setHoldings] = useState([])
  const [gainsLosses, setGainsLosses] = useState(null)
  const [categoryData, setCategoryData] = useState({ categories: [], unallocated: [] })
  const [dividendGrowth, setDividendGrowth] = useState({})
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
        setError(err.message || 'Failed to load CommonInfo')
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

  const categoryLookup = useMemo(() => buildCategoryLookup(categoryData), [categoryData])

  const allRows = useMemo(() => {
    const totalActiveValue = holdings.reduce((sum, holding) => sum + num(holding.current_value), 0)
    const openRows = holdings.map(holding => activeRow(holding, categoryLookup, totalActiveValue, dividendGrowth))
    const openTickers = new Set(openRows.map(row => row.ticker))
    const closedRows = soldRows(gainsLosses?.realized, openTickers, categoryLookup, dividendGrowth)
    return showSold ? [...openRows, ...closedRows] : openRows
  }, [holdings, gainsLosses, categoryLookup, dividendGrowth, showSold])

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

  const visibleColumns = useMemo(() => {
    const hasCategory = filteredRows.some(hasDefinedCategory)
    const hasSubcategory = filteredRows.some(hasDefinedSubcategory)
    return VIEW_COLUMNS[view]
      .filter(key => key !== 'category' || hasCategory)
      .filter(key => key !== 'subcategory' || hasSubcategory)
      .map(key => COLUMN_DEFS[key])
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
    const totalProfit = filteredRows.reduce((sum, row) => sum + row.totalProfit, 0)
    const profitBasis = filteredRows.reduce((sum, row) => sum + (row.profitBasis || row.costBasis), 0)
    const passiveYield = currentValue > 0 ? annualIncome / currentValue : null
    const profitPct = profitBasis > 0 ? totalProfit / profitBasis : null
    return { currentValue, costBasis, annualIncome, totalProfit, profitBasis, passiveYield, profitPct }
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
    <div className="page dashboard common-info-page">
      <div className="ci-header">
        <div>
          <h1>CommonInfo</h1>
          <p>Portfolio holdings with forward income, yields, total profit, and sold positions.</p>
        </div>
        <div className="ci-view-tabs" aria-label="CommonInfo views">
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
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="summary-strip ci-summary-strip">
        <MetricCard
          label="Value"
          value={formatMoneyWhole(totals.currentValue, { fallback: '--' })}
          sub={`${formatMoneyWhole(totals.costBasis, { fallback: '--' })} cost basis`}
          help={SUMMARY_HELP.value}
        />
        <MetricCard
          label="Total profit"
          value={signedMoney(totals.totalProfit, { digits: 0 })}
          sub={`${pct(totals.profitPct, { signed: true })} total`}
          tone={valueTone(totals.totalProfit)}
          help={SUMMARY_HELP.totalProfit}
        />
        <MetricCard
          label="Passive income"
          value={pct(totals.passiveYield)}
          sub={`${formatMoneyWhole(totals.annualIncome, { fallback: '--' })} annually`}
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
        <div className="ci-loading"><span className="spinner" /> Loading CommonInfo...</div>
      ) : (
        <div className="sticky-table-wrap ci-table-wrap">
          <table className="ci-table">
            <thead>
              <tr>
                {visibleColumns.map(column => {
                  const key = Object.entries(COLUMN_DEFS).find(([, value]) => value === column)?.[0]
                  const active = sortKey === key
                  const help = COLUMN_HELP[key] || `Column: ${column.label}`
                  return (
                    <th
                      key={key}
                      className={`${column.className || ''} ${column.align === 'right' ? 'ci-number' : ''}`}
                      onClick={() => handleSort(key)}
                      title={`${help}\nClick to sort by ${column.label}.`}
                    >
                      <span>{column.label}</span>
                      <small>{active ? (sortDir === 'asc' ? '^' : 'v') : ''}</small>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => (
                <tr key={row.id} className={row.sold ? 'ci-row-sold' : ''}>
                  {visibleColumns.map(column => {
                    const key = Object.entries(COLUMN_DEFS).find(([, value]) => value === column)?.[0]
                    return (
                      <td
                        key={key}
                        className={`${column.className || ''} ${column.align === 'right' ? 'ci-number' : ''}`}
                      >
                        {column.render(row)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            {sortedRows.length > 0 && (
              <tfoot>
                <tr>
                  {visibleColumns.map((column, index) => {
                    const key = Object.entries(COLUMN_DEFS).find(([, value]) => value === column)?.[0]
                    let value = ''
                    if (index === 0) value = 'Totals'
                    if (key === 'shares') value = shares(filteredRows.reduce((sum, row) => sum + row.quantity, 0))
                    if (key === 'costBasis') value = money(totals.costBasis)
                    if (key === 'currentValue') value = money(totals.currentValue)
                    if (key === 'dividends') value = money(totals.annualIncome)
                    if (key === 'dividendYield' || key === 'estimatedYield') value = pct(totals.passiveYield)
                    if (key === 'totalProfit') value = signedMoney(totals.totalProfit)
                    return (
                      <td key={key} className={column.align === 'right' ? 'ci-number' : ''}>
                        <strong className={key === 'totalProfit' ? valueTone(totals.totalProfit) : ''}>{value}</strong>
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            )}
          </table>
          {sortedRows.length === 0 && (
            <div className="ci-empty">No holdings match the current filters.</div>
          )}
        </div>
      )}
    </div>
  )
}
