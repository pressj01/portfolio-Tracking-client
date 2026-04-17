import React, { useState, useEffect, useCallback } from 'react'
import { useProfileFetch } from '../context/ProfileContext'

const TABS = [
  { key: 'overview', label: 'Descriptive' },
  { key: 'fundamental', label: 'Fundamental' },
  { key: 'technical', label: 'Technical' },
  { key: 'etf', label: 'ETF' },
]

const REFRESH_CHUNK_SIZE = 40
const REFRESH_LOCK_RETRY_LIMIT = 3
const REFRESH_LOCK_RETRY_DELAY_MS = 1500

const SIGNAL_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'top_gainers', label: 'Top Gainers' },
  { value: 'top_losers', label: 'Top Losers' },
  { value: 'new_high', label: 'New High' },
  { value: 'new_low', label: 'New Low' },
  { value: 'most_volatile', label: 'Most Volatile' },
  { value: 'most_active', label: 'Most Active' },
  { value: 'unusual_volume', label: 'Unusual Volume' },
  { value: 'overbought', label: 'Overbought' },
  { value: 'oversold', label: 'Oversold' },
  { value: 'price_above_sma20', label: 'Price Above SMA20' },
  { value: 'price_above_sma50', label: 'Price Above SMA50' },
  { value: 'price_above_sma200', label: 'Price Above SMA200' },
  { value: 'golden_cross_setup', label: 'SMA50 Above SMA200' },
  { value: 'death_cross_setup', label: 'SMA50 Below SMA200' },
]

const TAB_COLUMNS = {
  overview: [
    { key: 'ticker', label: 'Ticker', sortable: true },
    { key: 'name', label: 'Company', sortable: true },
    { key: 'sector', label: 'Sector', sortable: true },
    { key: 'industry', label: 'Industry', sortable: true },
    { key: 'country', label: 'Country', sortable: true },
    { key: 'market_cap', label: 'Market Cap', sortable: true, fmt: 'cap' },
    { key: 'price', label: 'Price', sortable: true, fmt: 'price' },
    { key: 'change_pct', label: 'Change %', sortable: true, fmt: 'pct', color: true },
    { key: 'volume', label: 'Volume', sortable: true, fmt: 'vol' },
    { key: 'asset_type', label: 'Type', sortable: true },
  ],
  fundamental: [
    { key: 'ticker', label: 'Ticker', sortable: true },
    { key: 'name', label: 'Company', sortable: true },
    { key: 'pe_ratio', label: 'P/E', sortable: true, fmt: 'dec2' },
    { key: 'forward_pe', label: 'Fwd P/E', sortable: true, fmt: 'dec2' },
    { key: 'peg_ratio', label: 'PEG', sortable: true, fmt: 'dec2' },
    { key: 'ps_ratio', label: 'P/S', sortable: true, fmt: 'dec2' },
    { key: 'pb_ratio', label: 'P/B', sortable: true, fmt: 'dec2' },
    { key: 'dividend_yield', label: 'Div Yield %', sortable: true, fmt: 'pct' },
    { key: 'eps', label: 'EPS', sortable: true, fmt: 'price' },
    { key: 'profit_margin', label: 'Margin %', sortable: true, fmt: 'pct' },
    { key: 'roe', label: 'ROE %', sortable: true, fmt: 'pct' },
    { key: 'debt_to_equity', label: 'D/E', sortable: true, fmt: 'dec2' },
    { key: 'current_ratio', label: 'Curr Ratio', sortable: true, fmt: 'dec2' },
    { key: 'beta', label: 'Beta', sortable: true, fmt: 'dec2' },
  ],
  technical: [
    { key: 'ticker', label: 'Ticker', sortable: true },
    { key: 'name', label: 'Company', sortable: true },
    { key: 'price', label: 'Price', sortable: true, fmt: 'price' },
    { key: 'change_pct', label: 'Change %', sortable: true, fmt: 'pct', color: true },
    { key: 'sma_20', label: 'SMA 20', sortable: true, fmt: 'price' },
    { key: 'sma_50', label: 'SMA 50', sortable: true, fmt: 'price' },
    { key: 'sma_200', label: 'SMA 200', sortable: true, fmt: 'price' },
    { key: 'rsi_14', label: 'RSI 14', sortable: true, fmt: 'dec2' },
    { key: 'macd_line', label: 'MACD', sortable: true, fmt: 'dec4' },
    { key: 'macd_signal', label: 'Signal', sortable: true, fmt: 'dec4' },
    { key: 'macd_hist', label: 'MACD Hist', sortable: true, fmt: 'dec4', color: true },
    { key: 'stoch_k', label: 'Stoch %K', sortable: true, fmt: 'dec2' },
    { key: 'stoch_d', label: 'Stoch %D', sortable: true, fmt: 'dec2' },
    { key: 'week52_high', label: '52W High', sortable: true, fmt: 'price' },
    { key: 'week52_low', label: '52W Low', sortable: true, fmt: 'price' },
    { key: 'avg_volume', label: 'Avg Vol', sortable: true, fmt: 'vol' },
    { key: 'volume', label: 'Volume', sortable: true, fmt: 'vol' },
  ],
  etf: [
    { key: 'ticker', label: 'Ticker', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'etf_strategy', label: 'Strategy', sortable: true },
    { key: 'etf_cap_size', label: 'Cap Size', sortable: true },
    { key: 'etf_category', label: 'Category', sortable: true },
    { key: 'price', label: 'Price', sortable: true, fmt: 'price' },
    { key: 'change_pct', label: 'Change %', sortable: true, fmt: 'pct', color: true },
    { key: 'dividend_yield', label: 'Div Yield %', sortable: true, fmt: 'pct' },
    { key: 'expense_ratio', label: 'Exp Ratio %', sortable: true, fmt: 'dec4' },
    { key: 'aum', label: 'AUM', sortable: true, fmt: 'cap' },
    { key: 'volume', label: 'Volume', sortable: true, fmt: 'vol' },
  ],
}

function fmtVal(v, fmt) {
  if (v == null) return '\u2014'
  if (fmt === 'cap') {
    const n = Number(v)
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
    return n.toLocaleString()
  }
  if (fmt === 'vol') {
    const n = Number(v)
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
    return n.toLocaleString()
  }
  if (fmt === 'price') return Number(v).toFixed(2)
  if (fmt === 'pct') return Number(v).toFixed(2) + '%'
  if (fmt === 'dec2') return Number(v).toFixed(2)
  if (fmt === 'dec4') return Number(v).toFixed(4)
  return String(v)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const RANGE_FILTERS = [
  { key: 'market_cap', label: 'Market Cap', presets: [
    { label: 'Any', min: '', max: '' },
    { label: 'Mega (>200B)', min: 200e9, max: '' },
    { label: 'Large (10-200B)', min: 10e9, max: 200e9 },
    { label: 'Mid (2-10B)', min: 2e9, max: 10e9 },
    { label: 'Small (300M-2B)', min: 300e6, max: 2e9 },
    { label: 'Micro (<300M)', min: '', max: 300e6 },
  ]},
  { key: 'price', label: 'Price $' },
  { key: 'pe_ratio', label: 'P/E' },
  { key: 'forward_pe', label: 'Fwd P/E' },
  { key: 'dividend_yield', label: 'Div Yield %' },
  { key: 'beta', label: 'Beta' },
  { key: 'rsi_14', label: 'RSI', presets: [
    { label: 'Any', min: '', max: '' },
    { label: 'Overbought (>70)', min: 70, max: '' },
    { label: 'Oversold (<30)', min: '', max: 30 },
    { label: 'Neutral (30-70)', min: 30, max: 70 },
  ]},
  { key: 'change_pct', label: 'Change %' },
  { key: 'profit_margin', label: 'Margin %' },
  { key: 'roe', label: 'ROE %' },
  { key: 'debt_to_equity', label: 'D/E Ratio' },
  { key: 'volume', label: 'Volume' },
]

const SECTORS = [
  'Basic Materials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive',
  'Energy', 'Financial Services', 'Healthcare', 'Industrials', 'Real Estate', 'Technology', 'Utilities',
]

const INDUSTRIES = [
  // Technology
  'Software - Application', 'Software - Infrastructure', 'Semiconductors', 'Semiconductor Equipment & Materials',
  'Information Technology Services', 'Electronic Components', 'Computer Hardware', 'Scientific & Technical Instruments',
  'Consumer Electronics', 'Solar', 'Communication Equipment',
  // Healthcare
  'Biotechnology', 'Drug Manufacturers - General', 'Drug Manufacturers - Specialty & Generic',
  'Medical Devices', 'Medical Instruments & Supplies', 'Diagnostics & Research', 'Health Information Services',
  'Medical Care Facilities', 'Pharmaceutical Retailers', 'Healthcare Plans',
  // Financial Services
  'Banks - Diversified', 'Banks - Regional', 'Insurance - Diversified', 'Insurance - Life',
  'Insurance - Property & Casualty', 'Asset Management', 'Capital Markets', 'Financial Data & Stock Exchanges',
  'Credit Services', 'Insurance Brokers', 'Mortgage Finance',
  // Consumer Cyclical
  'Internet Retail', 'Auto Manufacturers', 'Restaurants', 'Home Improvement Retail',
  'Travel Services', 'Apparel Retail', 'Specialty Retail', 'Residential Construction',
  'Leisure', 'Auto Parts', 'Footwear & Accessories', 'Gambling', 'Lodging', 'Packaging & Containers',
  // Consumer Defensive
  'Household & Personal Products', 'Packaged Foods', 'Beverages - Non-Alcoholic', 'Beverages - Brewers',
  'Tobacco', 'Discount Stores', 'Grocery Stores', 'Farm Products', 'Food Distribution',
  // Industrials
  'Aerospace & Defense', 'Railroads', 'Building Products & Equipment', 'Specialty Industrial Machinery',
  'Farm & Heavy Construction Machinery', 'Industrial Distribution', 'Waste Management',
  'Conglomerates', 'Trucking', 'Engineering & Construction', 'Airlines', 'Rental & Leasing Services',
  // Energy
  'Oil & Gas Integrated', 'Oil & Gas E&P', 'Oil & Gas Midstream', 'Oil & Gas Equipment & Services',
  'Oil & Gas Refining & Marketing', 'Uranium',
  // Communication Services
  'Internet Content & Information', 'Entertainment', 'Telecom Services',
  'Electronic Gaming & Multimedia', 'Advertising Agencies', 'Broadcasting', 'Publishing',
  // Basic Materials
  'Specialty Chemicals', 'Gold', 'Copper', 'Steel', 'Aluminum', 'Building Materials',
  'Agricultural Inputs', 'Lumber & Wood Production', 'Paper & Paper Products',
  // Real Estate
  'REIT - Diversified', 'REIT - Industrial', 'REIT - Retail', 'REIT - Residential',
  'REIT - Office', 'REIT - Healthcare Facilities', 'REIT - Hotel & Motel', 'REIT - Specialty',
  'REIT - Mortgage', 'Real Estate Services', 'Real Estate - Development',
  // Utilities
  'Utilities - Regulated Electric', 'Utilities - Regulated Gas', 'Utilities - Diversified',
  'Utilities - Renewable', 'Utilities - Independent Power Producers',
  // ETF
  'Exchange Traded Fund',
].sort()

const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Switzerland',
  'Netherlands', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Spain', 'Italy', 'Belgium',
  'Japan', 'China', 'Hong Kong', 'Taiwan', 'South Korea', 'India', 'Singapore',
  'Australia', 'New Zealand', 'Brazil', 'Mexico', 'Israel', 'South Africa', 'Argentina',
]

const ETF_STRATEGIES = [
  'BDC', 'Blend', 'Bonds', 'CEF', 'Commodity', 'Dividend', 'Growth',
  'International', 'Loans', 'Options Income', 'Other', 'Preferred',
  'Real Estate', 'Sector', 'Target Date', 'Value',
]

const ETF_CAP_SIZES = [
  'Large Cap', 'Mid Cap', 'Small Cap', 'Micro Cap', 'All Cap',
]

const SMA20_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'price_above', label: 'Price above SMA20' },
  { value: 'price_below', label: 'Price below SMA20' },
  { value: 'price_crossed_above', label: 'Price crossed SMA20' },
  { value: 'price_10pct_above', label: 'Price 10% above SMA20' },
  { value: 'price_10pct_below', label: 'Price 10% below SMA20' },
  { value: 'price_20pct_above', label: 'Price 20% above SMA20' },
  { value: 'price_20pct_below', label: 'Price 20% below SMA20' },
  { value: 'price_30pct_below', label: 'Price 30% below SMA20' },
  { value: 'price_50pct_above', label: 'Price 50% above SMA20' },
  { value: 'price_50pct_below', label: 'Price 50% below SMA20' },
]

const SMA50_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'price_above', label: 'Price above SMA50' },
  { value: 'price_below', label: 'Price below SMA50' },
  { value: 'price_10pct_above', label: 'Price 10% above SMA50' },
  { value: 'price_10pct_below', label: 'Price 10% below SMA50' },
  { value: 'price_20pct_above', label: 'Price 20% above SMA50' },
  { value: 'price_20pct_below', label: 'Price 20% below SMA50' },
  { value: 'price_30pct_below', label: 'Price 30% below SMA50' },
  { value: 'price_50pct_above', label: 'Price 50% above SMA50' },
  { value: 'price_50pct_below', label: 'Price 50% below SMA50' },
  { value: 'sma20_above', label: 'SMA20 above SMA50' },
  { value: 'sma20_below', label: 'SMA20 below SMA50' },
  { value: 'sma20_cross_above', label: 'SMA20 crossed above SMA50' },
  { value: 'sma20_cross_below', label: 'SMA20 crossed below SMA50' },
]

const SMA200_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'price_above', label: 'Price above SMA200' },
  { value: 'price_below', label: 'Price below SMA200' },
  { value: 'price_10pct_above', label: 'Price 10% above SMA200' },
  { value: 'price_10pct_below', label: 'Price 10% below SMA200' },
  { value: 'price_20pct_above', label: 'Price 20% above SMA200' },
  { value: 'price_20pct_below', label: 'Price 20% below SMA200' },
  { value: 'price_30pct_below', label: 'Price 30% below SMA200' },
  { value: 'price_50pct_above', label: 'Price 50% above SMA200' },
  { value: 'price_50pct_below', label: 'Price 50% below SMA200' },
  { value: 'sma50_above', label: 'SMA50 above SMA200' },
  { value: 'sma50_below', label: 'SMA50 below SMA200' },
  { value: 'sma50_cross_above', label: 'SMA50 crossed above SMA200 (Golden Cross)' },
  { value: 'sma50_cross_below', label: 'SMA50 crossed below SMA200 (Death Cross)' },
  { value: 'sma20_above', label: 'SMA20 above SMA200' },
  { value: 'sma20_below', label: 'SMA20 below SMA200' },
]

const SMA_ALIGNMENT_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '20_above_50_above_200', label: 'SMA20 > SMA50 > SMA200 (Bullish)' },
  { value: '20_below_50_below_200', label: 'SMA20 < SMA50 < SMA200 (Bearish)' },
  { value: 'price_above_all', label: 'Price above all SMAs' },
  { value: 'price_below_all', label: 'Price below all SMAs' },
]

const MACD_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'bullish', label: 'MACD above Signal' },
  { value: 'bearish', label: 'MACD below Signal' },
  { value: 'bullish_cross', label: 'MACD Histogram positive' },
  { value: 'bearish_cross', label: 'MACD Histogram negative' },
  { value: 'positive', label: 'MACD Line positive' },
  { value: 'negative', label: 'MACD Line negative' },
]

const STOCH_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'overbought', label: 'Overbought (>80)' },
  { value: 'oversold', label: 'Oversold (<20)' },
  { value: 'bullish', label: '%K above %D (Bullish)' },
  { value: 'bearish', label: '%K below %D (Bearish)' },
  { value: 'neutral', label: 'Neutral (20-80)' },
]

export default function GeneralScanner() {
  const pf = useProfileFetch()
  const [tab, setTab] = useState('overview')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const [sortCol, setSortCol] = useState('ticker')
  const [sortDir, setSortDir] = useState('asc')
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  // Chart popup state
  const [chartTicker, setChartTicker] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('1y')
  const [chartLoading, setChartLoading] = useState(false)

  // Filter state
  const [assetType, setAssetType] = useState('')
  const [sector, setSector] = useState('')
  const [industry, setIndustry] = useState('')
  const [country, setCountry] = useState('')
  const [etfStrategy, setEtfStrategy] = useState('')
  const [etfCapSize, setEtfCapSize] = useState('')
  const [rangeFilters, setRangeFilters] = useState({})
  const [sma20Filter, setSma20Filter] = useState('')
  const [sma50Filter, setSma50Filter] = useState('')
  const [sma200Filter, setSma200Filter] = useState('')
  const [smaAlignment, setSmaAlignment] = useState('')
  const [macdFilter, setMacdFilter] = useState('')
  const [stochFilter, setStochFilter] = useState('')
  const [signal, setSignal] = useState('')
  const [filterOptions, setFilterOptions] = useState({ sectors: [], industries: [], countries: [], etf_strategies: [], etf_cap_sizes: [] })

  // Universe management
  const [showUniverse, setShowUniverse] = useState(false)
  const [universeInput, setUniverseInput] = useState('')
  const [universeType, setUniverseType] = useState('Stock')
  const [universe, setUniverse] = useState([])
  const [pullInput, setPullInput] = useState('')
  const [pullType, setPullType] = useState('Stock')
  const [activeTickers, setActiveTickers] = useState([])
  const [presets, setPresets] = useState({})
  const [showFilters, setShowFilters] = useState(true)
  const [refreshProgress, setRefreshProgress] = useState('')

  // Load universe & presets on mount; auto-load default universe if empty
  useEffect(() => {
    pf('/api/general-scanner/presets').then(r => r.json()).then(d => setPresets(d.presets || {}))
    pf('/api/general-scanner/universe').then(r => r.json()).then(d => {
      setUniverse(d.rows || [])
      if ((d.rows || []).length === 0) {
        // Auto-load default universe
        pf('/api/general-scanner/auto-load', { method: 'POST' })
          .then(r => r.json())
          .then(res => {
            if (res.loaded > 0) {
              pf('/api/general-scanner/universe').then(r => r.json()).then(d2 => setUniverse(d2.rows || []))
            }
          })
      }
    })
  }, [pf])

  const fetchData = useCallback((options = {}) => {
    const tickersToUse = Array.isArray(options.tickers) ? options.tickers : activeTickers
    const pageToUse = options.page ?? page
    const isEtfContext = tab === 'etf' || assetType === 'ETF'
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    params.set('page', pageToUse)
    params.set('per_page', perPage)
    params.set('sort', sortCol)
    params.set('dir', sortDir)
    if (assetType) params.set('asset_type', assetType)
    if (sector) params.set('sector', sector)
    if (industry) params.set('industry', industry)
    if (country) params.set('country', country)
    if (etfStrategy) params.set('etf_strategy', etfStrategy)
    if (etfCapSize) params.set('etf_cap_size', etfCapSize)
    if (signal) params.set('signal', signal)
    if (tickersToUse.length) params.set('tickers', tickersToUse.join(','))
    for (const [k, v] of Object.entries(rangeFilters)) {
      if (isEtfContext && k === 'market_cap') continue
      if (v.min !== '' && v.min !== undefined) params.set(`${k}_min`, v.min)
      if (v.max !== '' && v.max !== undefined) params.set(`${k}_max`, v.max)
    }
    if (sma20Filter) params.set('sma20_filter', sma20Filter)
    if (sma50Filter) params.set('sma50_filter', sma50Filter)
    if (sma200Filter) params.set('sma200_filter', sma200Filter)
    if (smaAlignment) params.set('sma_alignment', smaAlignment)
    if (macdFilter) params.set('macd_filter', macdFilter)
    if (stochFilter) params.set('stoch_filter', stochFilter)
    pf(`/api/general-scanner/scan?${params}`)
      .then(r => r.json())
      .then(d => {
        setRows(d.rows || [])
        setTotal(d.total || 0)
        setPages(d.pages || 1)
        setFilterOptions(d.filters || { sectors: [], industries: [], countries: [] })
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pf, page, perPage, sortCol, sortDir, tab, assetType, sector, industry, country, etfStrategy, etfCapSize, signal, activeTickers, rangeFilters, sma20Filter, sma50Filter, sma200Filter, smaAlignment, macdFilter, stochFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  const handleRefresh = async (force = false) => {
    const wasAdHoc = activeTickers.length > 0
    setRefreshing(true)
    setRefreshProgress(
      wasAdHoc
        ? (force ? 'Returning to saved universe and force refreshing data in batches...' : 'Returning to saved universe and refreshing data in batches...')
        : (force ? 'Force refreshing data from Yahoo Finance in batches...' : 'Fetching data from Yahoo Finance in batches...')
    )
    try {
      let offset = 0
      let total = null
      const summary = { refreshed: 0, info_fetched: 0, info_skipped: 0, errors: 0 }

      while (true) {
        const totalLabel = total == null ? universe.length || '...' : total
        const start = offset + 1
        const end = Math.min(offset + REFRESH_CHUNK_SIZE, Number(totalLabel) || offset + REFRESH_CHUNK_SIZE)
        setRefreshProgress(`Refreshing tickers ${start}-${end} of ${totalLabel}...`)

        const params = new URLSearchParams()
        params.set('offset', offset)
        params.set('limit', REFRESH_CHUNK_SIZE)
        if (force) params.set('force', 'true')

        let d = null
        for (let attempt = 0; attempt <= REFRESH_LOCK_RETRY_LIMIT; attempt += 1) {
          const response = await pf(`/api/general-scanner/refresh?${params.toString()}`, { method: 'POST' })
          const text = await response.text()
          try {
            d = text ? JSON.parse(text) : {}
          } catch {
            const isLockPage = text?.toLowerCase().includes('sqlite3.operationalerror: database is locked')
            if (isLockPage && attempt < REFRESH_LOCK_RETRY_LIMIT) {
              setRefreshProgress(`Database is busy. Retrying tickers ${start}-${end}...`)
              await sleep(REFRESH_LOCK_RETRY_DELAY_MS)
              continue
            }
            throw new Error(text?.slice(0, 200) || `HTTP ${response.status}`)
          }
          const lockMessage = `${d.error || ''} ${d.detail || ''}`.toLowerCase()
          const shouldRetry = response.status === 503 && lockMessage.includes('database') && lockMessage.includes('busy')
          if (response.ok && d.ok) break
          if (shouldRetry && attempt < REFRESH_LOCK_RETRY_LIMIT) {
            setRefreshProgress(`Database is busy. Retrying tickers ${start}-${end}...`)
            await sleep(REFRESH_LOCK_RETRY_DELAY_MS)
            continue
          }
          throw new Error(d.error || d.detail || `HTTP ${response.status}`)
        }

        total = d.total ?? total ?? 0
        summary.refreshed += d.refreshed || 0
        summary.info_fetched += d.info_fetched || 0
        summary.info_skipped += d.info_skipped || 0
        summary.errors += d.errors?.length || 0

        const processed = d.processed || REFRESH_CHUNK_SIZE
        offset += processed
        if (!d.has_more || processed === 0) break
      }

      let msg = `Refreshed ${summary.refreshed} tickers`
      if (summary.info_fetched) msg += `, ${summary.info_fetched} info loaded`
      if (summary.info_skipped) msg += ` (${summary.info_skipped} cached)`
      if (summary.errors) msg += ` (${summary.errors} errors)`
      if (wasAdHoc) {
        setActiveTickers([])
        setPage(1)
        msg += '. Switched back to saved universe'
      }
      setRefreshProgress(msg)
      fetchData({ tickers: [], page: wasAdHoc ? 1 : page })
    } catch (e) {
      setRefreshProgress(`Error: ${e.message}`)
    } finally {
      setRefreshing(false)
    }
  }

  const addTickers = () => {
    const tickers = universeInput.split(/[\s,;]+/).filter(Boolean)
    if (!tickers.length) return
    setRefreshProgress(`Adding ${tickers.length} ticker${tickers.length !== 1 ? 's' : ''} to universe...`)
    pf('/api/general-scanner/universe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, asset_type: universeType }),
    })
      .then(async r => {
        if (!r.ok) {
          const text = await r.text()
          const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim()
          throw new Error(`HTTP ${r.status} ${r.statusText}${snippet ? ` — ${snippet}` : ''}`)
        }
        const ct = r.headers.get('content-type') || ''
        if (!ct.includes('application/json')) {
          const text = await r.text()
          const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim()
          throw new Error(`Expected JSON but got ${ct || 'unknown content-type'}${snippet ? ` — ${snippet}` : ''}`)
        }
        return r.json()
      })
      .then(d => {
        if (d && d.ok === false) {
          throw new Error(d.error || 'Server returned ok=false')
        }
        setUniverseInput('')
        setActiveTickers([])
        setRefreshProgress(`Added ${d?.added ?? tickers.length} ticker${tickers.length !== 1 ? 's' : ''} to universe`)
        return pf('/api/general-scanner/universe')
          .then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} while reloading universe`)
            return r.json()
          })
          .then(d2 => setUniverse(d2.rows || []))
      })
      .catch(e => {
        console.error('addTickers failed:', e)
        setRefreshProgress(`Error adding tickers: ${e.message}`)
      })
  }

  const pullTickersNow = (force = false) => {
    const tickers = pullInput.split(/[\s,;]+/).filter(Boolean).map(t => t.toUpperCase())
    if (!tickers.length) return
    setRefreshing(true)
    setRefreshProgress(`Pulling ${tickers.length} ticker${tickers.length !== 1 ? 's' : ''} from Yahoo Finance...`)
    pf('/api/general-scanner/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, asset_type: pullType, force }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setActiveTickers(tickers)
          setPullInput('')
          let msg = `Pulled ${d.refreshed} ticker${d.refreshed !== 1 ? 's' : ''} for ad hoc scan`
          if (d.errors?.length) msg += ` (${d.errors.length} errors)`
          setRefreshProgress(msg)
          setPage(1)
          fetchData()
        } else {
          setRefreshProgress(`Error: ${d.error || 'Unable to pull tickers'}`)
        }
      })
      .catch(e => setRefreshProgress(`Error: ${e.message}`))
      .finally(() => setRefreshing(false))
  }

  const loadPreset = (key) => {
    const tickers = presets[key]
    if (!tickers) return
    const at = key === 'popular_etfs' ? 'ETF' : 'Stock'
    pf('/api/general-scanner/universe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, asset_type: at }),
    })
      .then(r => r.json())
      .then(() => pf('/api/general-scanner/universe').then(r => r.json()).then(d => setUniverse(d.rows || [])))
  }

  const removeTickers = (tickers) => {
    pf('/api/general-scanner/universe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    })
      .then(r => r.json())
      .then(() => {
        pf('/api/general-scanner/universe').then(r => r.json()).then(d => setUniverse(d.rows || []))
        fetchData()
      })
  }

  const clearAllTickers = () => {
    if (universe.length === 0) return
    removeTickers(universe.map(u => u.ticker))
  }

  const resetToDefaults = () => {
    const confirmed = window.prompt(
      'Reset the General Scanner to defaults?\n\nThis will remove your current saved scanner universe and clear cached scanner data before reloading the default list.\n\nType RESET to continue.'
    )
    if ((confirmed || '').trim().toUpperCase() !== 'RESET') return

    pf('/api/general-scanner/auto-load?force=true', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          pf('/api/general-scanner/universe').then(r => r.json()).then(d2 => setUniverse(d2.rows || []))
          setRefreshProgress(`Loaded ${d.loaded} default tickers. Click Refresh Data to fetch prices.`)
        }
      })
  }

  const saveAsDefaults = () => {
    pf('/api/general-scanner/save-defaults', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setRefreshProgress(`Saved ${d.count} tickers as defaults for all users.`)
        }
      })
  }

  const setRangeFilter = (key, field, val) => {
    setRangeFilters(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: val },
    }))
    setPage(1)
  }

  const applyPresetRange = (key, min, max) => {
    setRangeFilters(prev => ({
      ...prev,
      [key]: { min: min === '' ? '' : min, max: max === '' ? '' : max },
    }))
    setPage(1)
  }

  const resetFilters = () => {
    setAssetType('')
    setSector('')
    setIndustry('')
    setCountry('')
    setEtfStrategy('')
    setEtfCapSize('')
    setSignal('')
    setRangeFilters({})
    setSma20Filter('')
    setSma50Filter('')
    setSma200Filter('')
    setSmaAlignment('')
    setMacdFilter('')
    setStochFilter('')
    setPage(1)
  }

  // Chart popup loader
  const openChart = (ticker) => {
    setChartTicker(ticker)
    setChartPeriod('1y')
    setChartLoading(true)
  }

  useEffect(() => {
    if (!chartTicker) return
    setChartLoading(true)
    pf(`/api/general-scanner/chart/${chartTicker}?period=${chartPeriod}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) return
        const el = document.getElementById('scanner-chart-popup')
        if (el && window.Plotly) {
          window.Plotly.newPlot(el, d.fig_data, { ...d.fig_layout, autosize: true }, { responsive: true })
        }
      })
      .catch(() => {})
      .finally(() => setChartLoading(false))
    return () => {
      const el = document.getElementById('scanner-chart-popup')
      if (el && window.Plotly) window.Plotly.purge(el)
    }
  }, [chartTicker, chartPeriod, pf])

  const columns = TAB_COLUMNS[tab] || TAB_COLUMNS.overview
  const activeFilterChips = []

  if (assetType) activeFilterChips.push({ key: 'assetType', label: `Type: ${assetType}` })
  if (sector) activeFilterChips.push({ key: 'sector', label: `Sector: ${sector}` })
  if (industry) activeFilterChips.push({ key: 'industry', label: `Industry: ${industry}` })
  if (country) activeFilterChips.push({ key: 'country', label: `Country: ${country}` })
  if (etfStrategy) activeFilterChips.push({ key: 'etfStrategy', label: `ETF Strategy: ${etfStrategy}` })
  if (etfCapSize) activeFilterChips.push({ key: 'etfCapSize', label: `ETF Cap: ${etfCapSize}` })
  if (signal) activeFilterChips.push({ key: 'signal', label: `Signal: ${SIGNAL_OPTIONS.find(o => o.value === signal)?.label || signal}` })
  if (sma20Filter) activeFilterChips.push({ key: 'sma20Filter', label: `20D SMA: ${SMA20_OPTIONS.find(o => o.value === sma20Filter)?.label || sma20Filter}` })
  if (sma50Filter) activeFilterChips.push({ key: 'sma50Filter', label: `50D SMA: ${SMA50_OPTIONS.find(o => o.value === sma50Filter)?.label || sma50Filter}` })
  if (sma200Filter) activeFilterChips.push({ key: 'sma200Filter', label: `200D SMA: ${SMA200_OPTIONS.find(o => o.value === sma200Filter)?.label || sma200Filter}` })
  if (smaAlignment) activeFilterChips.push({ key: 'smaAlignment', label: `SMA Align: ${SMA_ALIGNMENT_OPTIONS.find(o => o.value === smaAlignment)?.label || smaAlignment}` })
  if (macdFilter) activeFilterChips.push({ key: 'macdFilter', label: `MACD: ${MACD_OPTIONS.find(o => o.value === macdFilter)?.label || macdFilter}` })
  if (stochFilter) activeFilterChips.push({ key: 'stochFilter', label: `Stoch: ${STOCH_OPTIONS.find(o => o.value === stochFilter)?.label || stochFilter}` })
  for (const rf of RANGE_FILTERS) {
    const range = rangeFilters[rf.key]
    if (!range) continue
    const hasMin = range.min !== '' && range.min !== undefined
    const hasMax = range.max !== '' && range.max !== undefined
    if (hasMin || hasMax) {
      activeFilterChips.push({
        key: `range:${rf.key}`,
        label: `${rf.label}: ${hasMin ? range.min : 'min'} - ${hasMax ? range.max : 'max'}`,
      })
    }
  }

  const clearChip = (key) => {
    if (key === 'assetType') setAssetType('')
    else if (key === 'sector') setSector('')
    else if (key === 'industry') setIndustry('')
    else if (key === 'country') setCountry('')
    else if (key === 'etfStrategy') setEtfStrategy('')
    else if (key === 'etfCapSize') setEtfCapSize('')
    else if (key === 'signal') setSignal('')
    else if (key === 'sma20Filter') setSma20Filter('')
    else if (key === 'sma50Filter') setSma50Filter('')
    else if (key === 'sma200Filter') setSma200Filter('')
    else if (key === 'smaAlignment') setSmaAlignment('')
    else if (key === 'macdFilter') setMacdFilter('')
    else if (key === 'stochFilter') setStochFilter('')
    else if (key.startsWith('range:')) {
      const rangeKey = key.split(':')[1]
      setRangeFilters(prev => {
        const next = { ...prev }
        delete next[rangeKey]
        return next
      })
    }
    setPage(1)
  }

  return (
    <div className="page-container">
      <div style={{
        marginBottom: '1rem',
        padding: '1rem 1.1rem',
        border: '1px solid #30363d',
        borderRadius: '8px',
        background: 'linear-gradient(135deg, #111827 0%, #0f1724 55%, #121a2a 100%)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>General Scanner</h2>
            <div style={{ marginTop: '0.35rem', color: '#8b949e', fontSize: '0.9rem' }}>
              Finviz-style market screener for your custom universe or one-off ticker pulls, with descriptive, fundamental, technical, and ETF views.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', color: '#9fb0c3', fontSize: '0.85rem' }}>
            <span>{activeTickers.length ? 'Ad Hoc' : 'Universe'}: <strong style={{ color: '#e6edf3' }}>{activeTickers.length || universe.length}</strong></span>
            <span>Results: <strong style={{ color: '#e6edf3' }}>{total}</strong></span>
            <span>View: <strong style={{ color: '#e6edf3' }}>{TABS.find(t => t.key === tab)?.label}</strong></span>
          </div>
        </div>
      </div>

      <div style={{
        marginBottom: '1rem',
        padding: '0.9rem',
        border: '1px solid #30363d',
        borderRadius: '8px',
        background: '#11161f',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
          <div style={{ color: '#c9d1d9', fontWeight: 600 }}>Pull Stocks or ETFs Without Saving Them</div>
          {activeTickers.length > 0 && (
            <button className="btn btn-sm" onClick={() => { setActiveTickers([]); setPage(1) }}>
              Back to Saved Universe
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={pullInput}
            onChange={e => setPullInput(e.target.value.toUpperCase())}
            placeholder="Enter tickers to pull now, e.g. AAPL MSFT QQQ SPYI"
            style={{ flex: 1, minWidth: '280px' }}
            onKeyDown={e => e.key === 'Enter' && pullTickersNow(false)}
          />
          <select value={pullType} onChange={e => setPullType(e.target.value)}>
            <option value="Stock">Stock</option>
            <option value="ETF">ETF</option>
          </select>
          <button className="btn btn-sm btn-primary" onClick={() => pullTickersNow(false)} disabled={refreshing}>
            Pull Now
          </button>
          <button className="btn btn-sm" onClick={() => pullTickersNow(true)} disabled={refreshing}>
            Force Pull
          </button>
        </div>
        <div style={{ marginTop: '0.45rem', color: '#8b949e', fontSize: '0.8rem' }}>
          This fetches data into scanner cache for a one-off screen without adding those tickers to the saved universe.
        </div>
      </div>

      <div style={{
        marginBottom: '1rem',
        padding: '0.75rem 0.9rem',
        border: '1px solid #2c3440',
        borderRadius: '8px',
        background: '#11161f',
      }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#8b949e', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Filters</span>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '999px',
                border: tab === t.key ? '1px solid #58a6ff' : '1px solid #30363d',
                background: tab === t.key ? '#17263e' : '#0f141c',
                color: tab === t.key ? '#8ec5ff' : '#9aa7b4',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', color: '#8b949e', fontSize: '0.82rem' }}>
            {signal
              ? <>Signal <strong style={{ color: '#d0d7de' }}>{SIGNAL_OPTIONS.find(o => o.value === signal)?.label || signal}</strong></>
              : <>Order by <strong style={{ color: '#d0d7de' }}>{(TAB_COLUMNS[tab] || []).find(c => c.key === sortCol)?.label || sortCol}</strong> {sortDir === 'asc' ? 'asc' : 'desc'}</>}
          </span>
        </div>
      </div>

      {/* Universe Management Toggle */}
      <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => setShowUniverse(u => !u)}>
          {showUniverse ? 'Hide' : 'Universe'} ({universe.length})
        </button>
        <button className="btn btn-sm" onClick={() => setShowFilters(f => !f)}>
          {showFilters ? 'Hide' : 'Show'} Filters
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => handleRefresh(false)} disabled={refreshing}>
          Refresh Data
        </button>
        <button className="btn btn-sm" onClick={() => handleRefresh(true)} disabled={refreshing}
          style={{ borderColor: '#da8b45', color: '#da8b45' }}
          title="Re-fetch all ticker info from Yahoo Finance (ignores cache)">
          Force Refresh
        </button>
        {!refreshing && refreshProgress && <span style={{ fontSize: '0.85rem', color: '#8899aa' }}>{refreshProgress}</span>}
      </div>

      {activeFilterChips.length > 0 && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.75rem 0.9rem',
          border: '1px solid #30363d',
          borderRadius: '8px',
          background: '#0f141c',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <div style={{ color: '#c9d1d9', fontSize: '0.9rem' }}>Active filters</div>
            <button className="btn btn-sm" onClick={resetFilters}>Clear All Filters</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
            {activeFilterChips.map(chip => (
              <span key={chip.key} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.28rem 0.55rem',
                borderRadius: '999px',
                background: '#17202d',
                border: '1px solid #30435a',
                color: '#c7d3e0',
                fontSize: '0.8rem',
              }}>
                {chip.label}
                <button
                  onClick={() => clearChip(chip.key)}
                  style={{ background: 'none', border: 'none', color: '#ff8a8a', cursor: 'pointer', padding: 0, fontSize: '0.95rem', lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Refresh overlay with spinner */}
      {refreshing && (
        <div style={{
          background: 'rgba(13,17,23,0.85)', border: '1px solid #30363d', borderRadius: '8px',
          padding: '2rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '1rem',
        }}>
          <div style={{
            width: '48px', height: '48px', border: '4px solid #21262d',
            borderTopColor: '#58a6ff', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <div style={{ color: '#c9d1d9', fontSize: '1rem', fontWeight: 500 }}>{refreshProgress}</div>
          <div style={{ color: '#8b949e', fontSize: '0.85rem' }}>
            This may take a few minutes for {universe.length} tickers...
          </div>
        </div>
      )}

      {/* Universe Panel */}
      {showUniverse && (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '1rem', marginBottom: '1rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0' }}>Ticker Universe</h4>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <input
              value={universeInput}
              onChange={e => setUniverseInput(e.target.value)}
              placeholder="Enter tickers (comma or space separated)"
              style={{ flex: 1, minWidth: '200px' }}
              onKeyDown={e => e.key === 'Enter' && addTickers()}
            />
            <select value={universeType} onChange={e => setUniverseType(e.target.value)}>
              <option value="Stock">Stock</option>
              <option value="ETF">ETF</option>
            </select>
            <button className="btn btn-sm btn-primary" onClick={addTickers}>Add</button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', color: '#8899aa', alignSelf: 'center' }}>Presets:</span>
            {Object.keys(presets).map(k => (
              <button key={k} className="btn btn-sm" onClick={() => loadPreset(k)}>
                {k.replace(/_/g, ' ')}
              </button>
            ))}
            <button className="btn btn-sm" onClick={resetToDefaults}>
              Reset to Defaults
            </button>
            <button className="btn btn-sm" style={{ color: '#3fb950' }} onClick={saveAsDefaults}>
              Save as Defaults
            </button>
            <button className="btn btn-sm" style={{ marginLeft: 'auto', color: '#f85149' }} onClick={clearAllTickers}>
              Clear All
            </button>
          </div>
          {universe.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
              {universe.map(u => (
                <span key={u.ticker} style={{
                  background: '#21262d', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem',
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                }}>
                  {u.ticker}
                  <span style={{ cursor: 'pointer', color: '#f85149', fontWeight: 'bold' }}
                    onClick={() => removeTickers([u.ticker])}>&times;</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters Panel */}
      {showFilters && (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <h4 style={{ margin: 0 }}>Screen Filters</h4>
              <div style={{ color: '#8b949e', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                Descriptive, fundamental, technical, and ETF fields organized in a tighter Finviz-style layout.
              </div>
            </div>
            <button className="btn btn-sm" onClick={resetFilters}>Reset All</button>
          </div>

          {/* Dropdown filters */}
          <div style={{ color: '#7d8590', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.45rem' }}>
            Descriptive
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem' }}>
              Signal
              <select value={signal} onChange={e => { setSignal(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                {SIGNAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              Type
              <select value={assetType} onChange={e => { setAssetType(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                <option value="">Any</option>
                <option value="Stock">Stock</option>
                <option value="ETF">ETF</option>
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              Sector
              <select value={sector} onChange={e => { setSector(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                <option value="">Any</option>
                {[...new Set([...SECTORS, ...filterOptions.sectors])].sort().map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              Industry
              <select value={industry} onChange={e => { setIndustry(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                <option value="">Any</option>
                {[...new Set([...INDUSTRIES, ...filterOptions.industries])].sort().map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              Country
              <select value={country} onChange={e => { setCountry(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                <option value="">Any</option>
                {[...new Set([...COUNTRIES, ...filterOptions.countries])].sort().map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              ETF Strategy
              <select value={etfStrategy} onChange={e => { setEtfStrategy(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                <option value="">Any</option>
                {[...new Set([...ETF_STRATEGIES, ...filterOptions.etf_strategies])].sort().map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              ETF Cap Size
              <select value={etfCapSize} onChange={e => { setEtfCapSize(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                <option value="">Any</option>
                {[...new Set([...ETF_CAP_SIZES, ...filterOptions.etf_cap_sizes])].sort().map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          {/* Range filters */}
          <div style={{ color: '#7d8590', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.45rem' }}>
            Fundamental
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {RANGE_FILTERS.map(rf => (
              <div key={rf.key} style={{ fontSize: '0.8rem' }}>
                <div style={{ marginBottom: '2px' }}>{rf.label}</div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {rf.presets ? (
                    <select
                      style={{ flex: 1 }}
                      value={JSON.stringify({ min: rangeFilters[rf.key]?.min ?? '', max: rangeFilters[rf.key]?.max ?? '' })}
                      onChange={e => {
                        const v = JSON.parse(e.target.value)
                        applyPresetRange(rf.key, v.min, v.max)
                      }}
                    >
                      {rf.presets.map((p, i) => (
                        <option key={i} value={JSON.stringify({ min: p.min, max: p.max })}>{p.label}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        type="number" placeholder="Min" style={{ width: '80px' }}
                        value={rangeFilters[rf.key]?.min ?? ''}
                        onChange={e => setRangeFilter(rf.key, 'min', e.target.value)}
                      />
                      <span>-</span>
                      <input
                        type="number" placeholder="Max" style={{ width: '80px' }}
                        value={rangeFilters[rf.key]?.max ?? ''}
                        onChange={e => setRangeFilter(rf.key, 'max', e.target.value)}
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Technical indicator filters (Finviz-style dropdowns) */}
          <div style={{ color: '#7d8590', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.45rem' }}>
            Technical
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem' }}>
              20-Day SMA
              <select value={sma20Filter} onChange={e => { setSma20Filter(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                {SMA20_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              50-Day SMA
              <select value={sma50Filter} onChange={e => { setSma50Filter(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                {SMA50_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              200-Day SMA
              <select value={sma200Filter} onChange={e => { setSma200Filter(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                {SMA200_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              SMA Alignment
              <select value={smaAlignment} onChange={e => { setSmaAlignment(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                {SMA_ALIGNMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              MACD
              <select value={macdFilter} onChange={e => { setMacdFilter(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                {MACD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '0.8rem' }}>
              Slow Stochastic
              <select value={stochFilter} onChange={e => { setStochFilter(e.target.value); setPage(1) }} style={{ width: '100%' }}>
                {STOCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '0.5rem',
        padding: '0.7rem 0.9rem',
        border: '1px solid #30363d',
        borderRadius: '8px 8px 0 0',
        background: '#121923',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ color: '#c9d1d9', fontSize: '0.9rem', fontWeight: 600 }}>
            {TABS.find(t => t.key === tab)?.label} View
          </div>
          {TABS.map(t => (
            <button
              key={`results-tab-${t.key}`}
              onClick={() => { setTab(t.key); setPage(1) }}
              style={{
                padding: '0.35rem 0.7rem',
                borderRadius: '999px',
                border: tab === t.key ? '1px solid #58a6ff' : '1px solid #30363d',
                background: tab === t.key ? '#17263e' : '#0f141c',
                color: tab === t.key ? '#8ec5ff' : '#9aa7b4',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.82rem', color: '#8b949e' }}>
          <span>{total > 0 ? `${total} result${total !== 1 ? 's' : ''}` : 'No results'}</span>
          <span>Page {page} / {pages}</span>
          <span>{perPage} per page</span>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Results Table */}
      <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #30363d', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
        <table className="data-table" style={{ width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'right', position: 'sticky', top: 0, zIndex: 3, background: '#13203a' }}>#</th>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={{
                    cursor: col.sortable ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none',
                    textAlign: col.fmt ? 'right' : undefined,
                    position: 'sticky', top: 0, zIndex: 3, background: '#13203a',
                  }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  {col.label}
                  {sortCol === col.key && (sortDir === 'asc' ? ' \u25B4' : ' \u25BE')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} style={{ textAlign: 'center', padding: '2rem', color: '#8899aa' }}>
                {universe.length === 0
                  ? 'Add tickers to your universe to get started'
                  : 'No results. Try refreshing data or adjusting filters.'}
              </td></tr>
            ) : rows.map((row, idx) => (
              <tr key={row.ticker}>
                <td style={{ color: '#8899aa', textAlign: 'right' }}>{(page - 1) * perPage + idx + 1}</td>
                {columns.map(col => {
                  const val = row[col.key]
                  const display = fmtVal(val, col.fmt)
                  let color = undefined
                  if (col.color && val != null) {
                    color = Number(val) > 0 ? '#3fb950' : Number(val) < 0 ? '#f85149' : undefined
                  }
                  if (col.key === 'rsi_14' && val != null) {
                    color = Number(val) > 70 ? '#f85149' : Number(val) < 30 ? '#3fb950' : undefined
                  }
                  if (col.key === 'stoch_k' && val != null) {
                    color = Number(val) > 80 ? '#f85149' : Number(val) < 20 ? '#3fb950' : undefined
                  }
                  if (col.key === 'ticker') {
                    return (
                      <td key={col.key} style={{
                        whiteSpace: 'nowrap', cursor: 'pointer', color: '#58a6ff',
                      }} onClick={() => openChart(row.ticker)}>
                        {display}
                      </td>
                    )
                  }
                  return (
                    <td key={col.key} style={{
                      color, whiteSpace: 'nowrap',
                      textAlign: col.fmt ? 'right' : undefined,
                    }}>
                      {display}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(1)}>&laquo;</button>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&lsaquo;</button>
          <span style={{ fontSize: '0.85rem' }}>Page {page} / {pages}</span>
          <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>&rsaquo;</button>
          <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(pages)}>&raquo;</button>
          <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }} style={{ marginLeft: '0.5rem' }}>
            {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      )}

      {/* Technical Chart Popup */}
      {chartTicker && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={(e) => { if (e.target === e.currentTarget) setChartTicker(null) }}>
          <div style={{
            background: '#0e1117', border: '1px solid #30363d', borderRadius: '8px',
            width: '95vw', maxWidth: '1200px', maxHeight: '95vh', overflow: 'auto',
            padding: '1rem', position: 'relative',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <h3 style={{ margin: 0, color: '#e0e8f5' }}>{chartTicker} Technical Analysis</h3>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {['3mo', '6mo', '1y', '2y', '5y'].map(p => (
                    <button key={p} className="btn btn-sm"
                      style={chartPeriod === p ? { background: '#1f6feb', color: '#fff', borderColor: '#1f6feb' } : {}}
                      onClick={() => setChartPeriod(p)}>
                      {p}
                    </button>
                  ))}
                </div>
                {chartLoading && <span style={{ color: '#8899aa', fontSize: '0.85rem' }}>Loading...</span>}
              </div>
              <button onClick={() => setChartTicker(null)}
                style={{ background: 'none', border: 'none', color: '#8899aa', fontSize: '1.5rem', cursor: 'pointer', padding: '0 8px' }}>
                &times;
              </button>
            </div>
            <div id="scanner-chart-popup" style={{ width: '100%', minHeight: '780px' }} />
          </div>
        </div>
      )}
    </div>
  )
}
