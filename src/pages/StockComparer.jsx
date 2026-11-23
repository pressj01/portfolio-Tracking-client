import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Plot from '../components/ThemedPlot'
import { useProfileFetch } from '../context/ProfileContext'
import DistributionHistoryChart from '../components/DistributionHistoryChart'
import YieldOnCostChart from '../components/YieldOnCostChart'
import { approxYieldFromCurrentDistributions } from '../utils/approxYield'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoney, formatMoneyCompact } from '../utils/money'
import { comparerSeriesColor } from '../utils/comparerTraces'
import ComparerTickerLibrary from '../components/ComparerTickerLibrary'
import { uniqueTickers } from '../utils/comparerTickerLibrary'
import { buildComparerChart } from '../utils/comparerChart'
import {
  applyLineModeChoice,
  chartMetricInfo,
  chartTableFromTraces,
  exportFileStem,
  isDividendMetric,
  metricAllowsReinvest,
  normalizeChartMetric,
  returnModeForMetric,
  RETURN_LINE_MODES,
} from '../utils/chartMetrics'
import {
  ChartDownloadMenu,
  ChartMetricMenu,
  ChartOptionsMenu,
  ChartToolStatus,
  SavedComparisonsMenu,
  chartDownloadActions,
  chartOptionGroups,
  useChartTools,
} from '../components/ChartToolbar'
import { readStoredFlag, storeFlag } from '../utils/chartActions'

const PERIODS = [
  { value: '1d', label: '1D' },
  { value: '5d', label: '5D' },
  { value: '1mo', label: '1M' },
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: '2y', label: '2Y' },
  { value: '3y', label: '3Y' },
  { value: '4y', label: '4Y' },
  { value: '5y', label: '5Y' },
  { value: '10y', label: '10Y' },
  { value: 'max', label: 'MAX' },
  { value: 'all', label: 'ALL' },
]

const RETURN_MODES = [
  { value: 'total', label: 'Total Return' },
  { value: 'price', label: 'Price Only' },
  { value: 'actual', label: 'Actual Price' },
  { value: 'pricediv', label: 'Price + Divs' },
  { value: 'both', label: 'Both' },
  { value: 'all3', label: 'All Three' },
  { value: 'all4', label: 'All Four' },
]

const COLUMNS = [
  { key: 'symbol', label: 'Symbol', locked: true },
  { key: 'name', label: 'Company Name', locked: true },
  { key: 'price', label: 'Stock Price' },
  { key: 'change_pct', label: '% Change' },
  { key: 'market_cap', label: 'Market Cap' },
  { key: 'pe_ratio', label: 'PE Ratio' },
  { key: 'forward_pe', label: 'Forward PE' },
  { key: 'peg_ratio', label: 'PEG Ratio' },
  { key: 'dividend_yield', label: 'Div. Yield' },
  { key: 'dividend_growth', label: 'Div. Growth' },
  { key: 'volume', label: 'Volume' },
  { key: 'dollar_volume', label: 'Dollar Vol.' },
  { key: 'open', label: 'Open' },
  { key: 'return_1y', label: 'CAGR 1Y' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'profit_margin', label: 'Profit Margin' },
  { key: 'beta', label: 'Beta' },
  { key: 'sharpe', label: 'Sharpe' },
  { key: 'sortino', label: 'Sortino' },
  { key: 'eps', label: 'EPS (TTM)' },
  { key: 'payout_ratio', label: 'Payout Ratio' },
  { key: 'debt_to_equity', label: 'Debt/Equity' },
  { key: 'fifty_two_week_high', label: '52 Week High' },
  { key: 'fifty_two_week_low', label: '52 Week Low' },
  { key: 'sector', label: 'Sector' },
  { key: 'industry', label: 'Industry' },
  { key: 'max_drawdown', label: 'Max Drawdown' },
]

const DEFAULT_COLUMNS = ['symbol', 'name', 'price', 'change_pct', 'market_cap', 'pe_ratio', 'forward_pe', 'peg_ratio', 'dividend_yield', 'dividend_growth', 'volume', 'dollar_volume', 'open', 'return_1y']
const AVERAGE_PERIOD_ORDER = ['1 Month', 'YTD', '1 Year', '5 Years', '10 Years', '15 Years', '20 Years']

function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '-'
  const n = Number(v)
  return `${n >= 0 ? '+' : ''}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

function pctColor(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  return n >= 0 ? '#2f9d55' : '#d94b4b'
}

function compact(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

function compactMoney(value) {
  return formatMoneyCompact(value, { minCompact: 1e3 })
}

function number(value, digits = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function ratioPct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(2)}%`
}

// For fields already expressed as percentages by the backend (e.g. 0.88 = 0.88%, 45 = 45%)
function pctFixed(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n.toFixed(2)}%`
}

function normalize(value) {
  return String(value || '').trim().toUpperCase()
}

function dateKey(value) {
  return String(value || '').slice(0, 10)
}

function normalizeReturnRange(range) {
  if (!range?.[0] || !range?.[1]) return null
  const start = dateKey(range[0])
  const end = dateKey(range[1])
  return start <= end ? [start, end] : [end, start]
}

function visibleDateRange(data, range, useRange = false) {
  const activeRange = useRange ? normalizeReturnRange(range) : null
  if (activeRange) return activeRange
  const dates = Object.values(data?.series || {}).flatMap(s => s.dates || [])
  if (!dates.length) return [null, null]
  return [
    dates.reduce((a, b) => a < b ? a : b),
    dates.reduce((a, b) => a > b ? a : b),
  ]
}

function yearsAgoDateKey(endDate, years) {
  const dt = new Date(`${dateKey(endDate)}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return null
  dt.setUTCFullYear(dt.getUTCFullYear() - years)
  return dt.toISOString().slice(0, 10)
}

function totalReturnForYears(series, years) {
  const dates = series?.dates || []
  const values = series?.traces?.total || series?.traces?.drip || series?.traces?.blend || series?.traces?.pricediv || series?.traces?.price || []
  if (dates.length < 2 || values.length < 2) return null
  const endIdx = values.length - 1
  const startKey = yearsAgoDateKey(dates[endIdx], years)
  if (!startKey || dateKey(dates[0]) > startKey) return null
  const startIdx = dates.findIndex(date => dateKey(date) >= startKey)
  if (startIdx < 0 || startIdx >= endIdx) return null
  const base = Number(values[startIdx])
  const last = Number(values[endIdx])
  if (!Number.isFinite(base) || !Number.isFinite(last) || base <= 0) return null
  return Number((((last / base) ** (1 / years) - 1) * 100).toFixed(2))
}

function longReturnPeriodsFromHistory(historyData, symbols) {
  return [
    {
      label: '15 Years',
      returns: Object.fromEntries(symbols.map(sym => [sym, totalReturnForYears(historyData?.series?.[sym], 15)])),
    },
    {
      label: '20 Years',
      returns: Object.fromEntries(symbols.map(sym => [sym, totalReturnForYears(historyData?.series?.[sym], 20)])),
    },
  ]
}

const FUNDAMENTAL_ROWS = [
  { label: 'Market Cap', key: 'market_cap', fmt: 'compact' },
  { label: 'Enterprise Value', key: 'enterprise_value', fmt: 'compact' },
  { label: 'Revenue', key: 'revenue', fmt: 'compact' },
  { label: 'Net Income', key: 'net_income', fmt: 'compact' },
  { label: 'Free Cash Flow', key: 'free_cash_flow', fmt: 'compact' },
  { label: 'EBITDA', key: 'ebitda', fmt: 'compact' },
  { label: 'Trailing PE', key: 'trailing_pe', fmt: 'number' },
  { label: 'Forward PE', key: 'forward_pe', fmt: 'number' },
  { label: 'PEG Ratio', key: 'peg_ratio', fmt: 'number' },
  { label: 'Price/Book', key: 'price_to_book', fmt: 'number' },
  { label: 'Price/Sales', key: 'price_to_sales_ttm', fmt: 'number' },
  { label: 'Beta', key: 'beta', fmt: 'number' },
  { label: 'Gross Margin', key: 'gross_margin_pct', fmt: 'pctFixed' },
  { label: 'Operating Margin', key: 'operating_margin_pct', fmt: 'pctFixed' },
  { label: 'Profit Margin', key: 'profit_margin_pct', fmt: 'pctFixed' },
  { label: 'Rev. Growth', key: 'revenue_growth_pct', fmt: 'pctFixed' },
  { label: 'Div. Yield', key: 'dividend_yield_pct', fmt: 'pctFixed' },
  { label: 'Payout Ratio', key: 'payout_ratio_pct', fmt: 'pctFixed' },
  { label: 'Div. Growth', key: 'dividend_growth_pct', fmt: 'pctFixed' },
  { label: 'Total Cash', key: 'total_cash', fmt: 'compact' },
  { label: 'Total Debt', key: 'total_debt', fmt: 'compact' },
  { label: 'Debt/Equity', key: 'debt_to_equity', fmt: 'number' },
  { label: '52-Wk Low', key: 'fifty_two_week_low', fmt: 'money' },
  { label: '52-Wk High', key: 'fifty_two_week_high', fmt: 'money' },
]

function fmtFundamental(value, fmt) {
  if (value == null || value === '') return '-'
  if (fmt === 'compact') return compactMoney(value)
  if (fmt === 'pctFixed') return pctFixed(value)
  if (fmt === 'money') return formatMoney(value)
  return number(value)
}

export default function StockComparer() {
  const pf = useProfileFetch()
  const { isDark } = useTheme()
  const [tickers, setTickers] = useState([])
  const [highlightedSymbol, setHighlightedSymbol] = useState('')
  const [input, setInput] = useState('')
  const inputRef = useRef(null)
  const [period, setPeriod] = useState('6mo')
  // The metric menu picks the y-axis (Total Return (%), Growth of $10K,
  // Dividends (TTM), ...); lineMode picks which return lines a percentage or
  // growth metric draws (Total Return, Both, All Three, ...).
  const [metric, setMetric] = useState('total_pct')
  const [lineMode, setLineMode] = useState('total')
  const returnMode = returnModeForMetric(metric, lineMode)
  const [reinvest, setReinvest] = useState(100)
  const [showReturnLabels, setShowReturnLabels] = useState(true)
  const [returnHoverMode, setReturnHoverMode] = useState('x unified')
  const [returnScalePreference, setReturnScalePreference] = useState('auto')
  const [showRangeSlider, setShowRangeSlider] = useState(true)
  const [showDatePicker, setShowDatePicker] = useState(() => readStoredFlag('comparer-date-picker', true))
  const [scaleRight, setScaleRight] = useState(() => readStoredFlag('comparer-scale-right', true))
  const [fullWidth, setFullWidth] = useState(() => readStoredFlag('comparer-full-width', false))
  const [divHistory, setDivHistory] = useState({})
  const graphDivRef = useRef(null)
  const chartCardRef = useRef(null)
  const [returnXRange, setReturnXRange] = useState([null, null])
  // Committed custom data window from the date inputs (overrides `period` on the
  // server). Separate from returnXRange (the volatile range-slider zoom, which
  // Plotly resets to null on autorange) so the window survives a refetch.
  const [fetchRange, setFetchRange] = useState(null)
  const [data, setData] = useState(null)
  const [averageData, setAverageData] = useState(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const loadSeqRef = useRef(0)
  const reinvestRef = useRef(reinvest)
  const [stockData, setStockData] = useState({})
  const stockDataLoadedRef = useRef({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('stockcomparer-columns'))
      if (Array.isArray(saved)) {
        const valid = COLUMNS.map(c => c.key)
        const cleaned = saved.filter(k => valid.includes(k))
        if (cleaned.length) return cleaned
      }
    } catch { /* ignore malformed storage */ }
    return DEFAULT_COLUMNS
  })
  const [showDistributionChart, setShowDistributionChart] = useState(true)
  const [showYieldOnCost, setShowYieldOnCost] = useState(true)
  const [distributionSymbol, setDistributionSymbol] = useState('')
  const [distPctMode, setDistPctMode] = useState(false)
  const [distAnnual, setDistAnnual] = useState(false)

  // Persist column selection so it survives app restarts.
  useEffect(() => {
    try { localStorage.setItem('stockcomparer-columns', JSON.stringify(visibleColumns)) } catch { /* ignore */ }
  }, [visibleColumns])
  useEffect(() => { storeFlag('comparer-date-picker', showDatePicker) }, [showDatePicker])
  useEffect(() => { storeFlag('comparer-scale-right', scaleRight) }, [scaleRight])
  useEffect(() => { storeFlag('comparer-full-width', fullWidth) }, [fullWidth])

  const resetReturnRange = useCallback(() => {
    setFetchRange(null)
    setReturnXRange([null, null])
  }, [])

  const dataDateBounds = useMemo(() => {
    if (!data?.series) return [null, null]
    const dateSeries = Object.values(data.series)
      .map(s => (s.dates || []).map(dateKey).filter(Boolean))
      .filter(dates => dates.length)
    const allDates = dateSeries.flat()
    if (!allDates.length) return [null, null]
    const earliestDate = allDates.reduce((a, b) => a < b ? a : b)
    const commonStart = dateSeries
      .map(dates => dates.reduce((a, b) => a < b ? a : b))
      .reduce((a, b) => a > b ? a : b)
    const latestDate = allDates.reduce((a, b) => a > b ? a : b)
    // A fund whose series has a single observation (transient Yahoo failure,
    // or a fund that listed today) makes the common window zero-width, which
    // collapses the date axis — fall back to full history in that case.
    const useCommonStart = period === 'max' && !fetchRange && commonStart < latestDate
    return [useCommonStart ? commonStart : earliestDate, latestDate]
  }, [data, period, fetchRange])

  const rangeStart = returnXRange[0] || dataDateBounds[0] || ''
  const rangeEnd = returnXRange[1] || dataDateBounds[1] || ''

  const handleRangeDateChange = useCallback((which, value) => {
    if (!value) { setFetchRange(null); setReturnXRange([null, null]); return }
    const s = which === 'start' ? value : (returnXRange[0] || dataDateBounds[0])
    const e = which === 'end' ? value : (returnXRange[1] || dataDateBounds[1])
    if (s && e) {
      const next = normalizeReturnRange([s, e]) || [s, e]
      // fetchRange triggers a re-fetch over the window (load depends on it);
      // returnXRange sets the initial on-chart view.
      setFetchRange(next)
      setReturnXRange(next)
    }
  }, [returnXRange, dataDateBounds])

  useEffect(() => {
    reinvestRef.current = reinvest
  }, [reinvest])

  const load = useCallback(() => {
    const symbols = tickers.map(normalize).filter(Boolean)
    const loadSeq = loadSeqRef.current + 1
    loadSeqRef.current = loadSeq
    if (!symbols.length) {
      setData(null)
      setAverageData(null)
      setError('')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const [primary, ...extra] = symbols
    const fr = normalizeReturnRange(fetchRange)
    const rangeParam = fr ? `&start=${fr[0]}&end=${fr[1]}` : ''
    const requestPeriod = period === 'all' ? 'max' : period
    // Reinvest is fixed here — the blend line is rebuilt client-side from the
    // per-point dividend ratios, so the slider never triggers a refetch.
    pf(`/api/etf-screen/data?ticker=${encodeURIComponent(primary)}&period=${requestPeriod}&mode=all4&reinvest=100&extra=${encodeURIComponent(extra.join(','))}&refresh=${refreshNonce}&defer_details=1${rangeParam}`)
      .then(r => r.json())
      .then(d => {
        if (loadSeqRef.current !== loadSeq) return
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => {
        if (loadSeqRef.current !== loadSeq) return
        setData(null)
        setError(e.message)
      })
      .finally(() => {
        if (loadSeqRef.current === loadSeq) setLoading(false)
      })
  }, [pf, tickers, period, refreshNonce, fetchRange])

  useEffect(() => { load() }, [load])

  // The dividend metrics need each ticker's full payment history (a TTM value
  // on the window's first day sums the year before it), fetched only once a
  // dividend metric is chosen. Refresh drops it so it is fetched again.
  useEffect(() => {
    if (!isDividendMetric(metric)) return undefined
    const missing = tickers.map(normalize).filter(sym => sym && !divHistory[sym])
    if (!missing.length) return undefined
    let cancelled = false
    pf(`/api/etf-screen/dividends?tickers=${encodeURIComponent(missing.join(','))}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled || d.error || !d.series) return
        setDivHistory(prev => ({ ...prev, ...d.series }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pf, metric, tickers, divHistory])

  useEffect(() => {
    resetReturnRange()
  }, [period, resetReturnRange])

  useEffect(() => {
    const symbols = tickers.map(normalize).filter(Boolean)
    const readySymbols = symbols.filter(sym => data?.series?.[sym])
    if (!readySymbols.length) return
    // Track in-flight/loaded symbols in a ref (not `stockData` state) so this
    // effect does NOT re-run every time a sibling symbol resolves. Depending on
    // `stockData` here would re-fire a duplicate request for every symbol still
    // in flight each time another one lands. The ref is cleared on failure so a
    // later ticker change can retry.
    readySymbols.forEach(sym => {
      if (stockDataLoadedRef.current[sym] === refreshNonce) return
      stockDataLoadedRef.current[sym] = refreshNonce
      pf(`/api/security-research/stock/${encodeURIComponent(sym)}?refresh=${refreshNonce}`)
        .then(r => r.json())
        .then(d => {
          if (!d.error) setStockData(prev => ({ ...prev, [sym]: d }))
          else delete stockDataLoadedRef.current[sym]
        })
        .catch(() => { delete stockDataLoadedRef.current[sym] })
    })
  }, [tickers, pf, refreshNonce, data])

  useEffect(() => {
    const requestedSymbols = tickers.map(normalize).filter(Boolean)
    if (!requestedSymbols.length) {
      setAverageData(null)
      return
    }
    if (requestedSymbols.some(sym => !data?.series?.[sym])) return

    let cancelled = false
    setAverageData(null)
    const [primary, ...extra] = requestedSymbols

    async function loadAverageReturns() {
      try {
        const avgResp = await pf(`/api/security-research/stock/average-returns?tickers=${encodeURIComponent(requestedSymbols.join(','))}&refresh=${refreshNonce}`)
        const result = await avgResp.json()
        if (cancelled) return
        if (result.error || !result.periods?.length) {
          setAverageData(null)
          return
        }

        let periods = (result.periods || []).filter(period => period.label !== 'Inception')
        const hasLongPeriods = periods.some(period => period.label === '15 Years') && periods.some(period => period.label === '20 Years')
        if (!hasLongPeriods) {
          const historyResp = await pf(`/api/etf-screen/data?ticker=${encodeURIComponent(primary)}&period=max&mode=all4&reinvest=100&extra=${encodeURIComponent(extra.join(','))}&refresh=${refreshNonce}&defer_details=1`)
          const history = await historyResp.json()
          if (cancelled) return
          if (!history.error) {
            const existingLabels = new Set(periods.map(period => period.label))
            const longPeriods = longReturnPeriodsFromHistory(history, result.symbols || requestedSymbols)
              .filter(period => !existingLabels.has(period.label))
              .filter(period => Object.values(period.returns || {}).some(value => value != null))
            periods = [...periods, ...longPeriods]
          }
        }

        setAverageData({
          symbols: result.symbols || requestedSymbols,
          periods,
          summary: result.summary,
        })
      } catch {
        if (!cancelled) setAverageData(null)
      }
    }

    loadAverageReturns()

    return () => { cancelled = true }
  }, [pf, tickers, refreshNonce, data])

  const addTickerSymbols = useCallback((nextSymbols) => {
    const normalized = uniqueTickers(nextSymbols)
    if (!normalized.length) return
    setTickers(prev => uniqueTickers([...prev, ...normalized]))
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const addTickers = () => {
    const symbols = input.split(/[\s,]+/).map(normalize).filter(Boolean)
    if (!symbols.length) {
      inputRef.current?.focus()
      return
    }
    addTickerSymbols(symbols)
    setInput('')
  }

  const removeTicker = (sym) => {
    setTickers(prev => prev.filter(t => t !== sym))
    setHighlightedSymbol(prev => prev === sym ? '' : prev)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const toggleHighlight = useCallback((sym) => {
    setHighlightedSymbol(prev => prev === sym ? '' : sym)
  }, [])

  const symbols = useMemo(() => tickers.map(normalize).filter(Boolean), [tickers])
  // Reinvest applies wherever a reinvested line is drawn (Total Return lines,
  // Growth of $10K, Total Return price); price-only views ignore it.
  const reinvestDisabled = !metricAllowsReinvest(metric, lineMode)
  const metricInfo = chartMetricInfo(metric)
  const chooseMetric = useCallback((next) => {
    setMetric(normalizeChartMetric(next))
  }, [])
  const chooseLineMode = useCallback((mode) => {
    const choice = applyLineModeChoice(mode, metric)
    setMetric(choice.metric)
    if (choice.lineMode) setLineMode(choice.lineMode)
  }, [metric])
  const refreshComparison = useCallback(() => {
    if (!symbols.length) return
    const currentReinvest = reinvestRef.current
    setRefreshNonce(value => value + 1)
    setReinvest(currentReinvest)
    setDivHistory({})
  }, [symbols.length])

  const compareTitle = useMemo(() => {
    if (!symbols.length) return 'Compare Stocks'
    if (symbols.length === 1) return `Compare Stocks: ${symbols[0]}`
    return `Compare Stocks: ${symbols.join(' vs. ')}`
  }, [symbols])

  // 1D/5D charts plot time-stamped intraday bars; a custom date window or a
  // range-slider zoom is day-granular, so it does not apply to them.
  const intraday = Boolean(data?.intraday)

  // The window the chart is actually showing — typed dates, a range-slider
  // zoom, or the full data bounds. Shared with the yield-on-cost chart so both
  // rebase on the same first visible close.
  const visibleWindow = useMemo(() => {
    const fallbackRange = dataDateBounds[0] && dataDateBounds[1] ? dataDateBounds : null
    const zoom = intraday ? null : normalizeReturnRange(returnXRange)
    return visibleDateRange(data, zoom || fallbackRange, true)
  }, [data, returnXRange, dataDateBounds, intraday])

  // The export reads whatever chart is current when a menu item is clicked.
  const latestChartRef = useRef(null)
  const getChartTable = useCallback(() => {
    const current = latestChartRef.current
    if (!current?.chart?.data?.length) return null
    return chartTableFromTraces(current.chart.data, {
      start: current.intraday ? null : current.visibleWindow[0],
      end: current.intraday ? null : current.visibleWindow[1],
      unit: current.chart.unit,
    })
  }, [])
  const chartTools = useChartTools({
    graphDivRef,
    cardRef: chartCardRef,
    getTable: getChartTable,
    fileStem: exportFileStem(['stock-compare', ...symbols, metricInfo.label.replace(/[()$%]/g, ''), new Date().toISOString().slice(0, 10)]),
    sheetName: metricInfo.label,
    printTitle: `${compareTitle} — ${metricInfo.label}`,
  })
  const { isFullscreen } = chartTools
  const chartHeight = isFullscreen ? chartTools.fullscreenHeight - 70 : 560

  const chart = useMemo(() => {
    const activeReturnRange = intraday ? null : normalizeReturnRange(returnXRange)
    return buildComparerChart({
      data,
      symbols,
      metric,
      returnMode,
      reinvest,
      returnScalePreference,
      showReturnLabels,
      returnHoverMode,
      showRangeSlider,
      activeRange: activeReturnRange,
      fallbackRange: dataDateBounds[0] && dataDateBounds[1] ? dataDateBounds : null,
      visibleWindow,
      titleWindow: intraday ? null : (activeReturnRange || normalizeReturnRange(fetchRange)),
      highlightedSymbol,
      divHistory,
      scaleRight,
      period,
      variant: 'stock',
      height: chartHeight,
    })
  }, [data, symbols, metric, returnMode, reinvest, returnScalePreference, showReturnLabels, returnHoverMode, showRangeSlider, returnXRange, dataDateBounds, fetchRange, highlightedSymbol, visibleWindow, divHistory, scaleRight, period, intraday, chartHeight])
  useEffect(() => {
    latestChartRef.current = { chart, visibleWindow, intraday }
  }, [chart, visibleWindow, intraday])
  const rememberGraphDiv = useCallback((_figure, graphDiv) => { graphDivRef.current = graphDiv }, [])

  const loadSavedComparison = useCallback((item) => {
    const settings = item.settings || {}
    setTickers(uniqueTickers(item.symbols))
    setHighlightedSymbol('')
    setMetric(normalizeChartMetric(item.metric))
    if (RETURN_LINE_MODES.includes(settings.lineMode)) setLineMode(settings.lineMode)
    if (PERIODS.some(p => p.value === settings.period)) setPeriod(settings.period)
    if (Number.isFinite(Number(settings.reinvest))) setReinvest(Math.max(0, Math.min(100, Number(settings.reinvest))))
    resetReturnRange()
  }, [resetReturnRange])
  const describeSaved = useCallback((item) => {
    const periodLabel = PERIODS.find(p => p.value === item.settings?.period)?.label
    return [chartMetricInfo(item.metric).label, periodLabel].filter(Boolean).join(' · ')
  }, [])

  const optionToggles = [
    { key: 'labels', label: 'Labels', checked: showReturnLabels, onChange: setShowReturnLabels, title: 'Value badges at the end of each line' },
    { key: 'datepicker', label: 'Date Picker', checked: showDatePicker, onChange: setShowDatePicker, title: 'Start and end date inputs beside the periods' },
    { key: 'slider', label: 'Range Slider', checked: showRangeSlider, onChange: (v) => { setShowRangeSlider(v); resetReturnRange() } },
    {
      key: 'log',
      label: chart.logScaleActive && returnScalePreference === 'auto' ? 'Log Scale (Auto)' : 'Log Scale',
      checked: chart.logScaleActive,
      disabled: isDividendMetric(metric),
      onChange: (v) => setReturnScalePreference(v ? 'log' : 'linear'),
      title: returnScalePreference === 'auto' && chart.logScaleActive ? 'Turned on automatically because the visible range is extreme' : 'Logarithmic growth scale',
    },
    { key: 'hover', label: 'Unified Hover', checked: returnHoverMode === 'x unified', onChange: (v) => setReturnHoverMode(v ? 'x unified' : 'closest'), title: 'One hover box listing every line at the hovered date' },
    { key: 'side', label: 'Scale on Right', checked: scaleRight, onChange: setScaleRight, title: 'Show the value scale on the right-hand side of the chart' },
  ]

  const yieldOnCostEntries = useMemo(() => symbols
    .map((sym, idx) => ({
      symbol: sym,
      series: data?.series?.[sym],
      color: comparerSeriesColor(idx),
      // Stock research reports cadence as dividend_frequency; the comparison
      // payload calls the same thing distribution_frequency.
      frequency: stockData[sym]?.dividend_frequency
        ?? data?.profiles?.[sym]?.distribution_frequency,
      dimmed: Boolean(highlightedSymbol && highlightedSymbol !== sym),
    }))
    .filter(entry => entry.series), [symbols, data, stockData, highlightedSymbol])

  const rows = useMemo(() => {
    const profiles = data?.profiles || {}
    const stats = data?.stats || {}
    return symbols.map(sym => {
      const profile = profiles[sym] || {}
      const research = stockData[sym] || {}
      // Prefer the fund-site expected yield, then the distribution-derived
      // approx yield, before Yahoo's reported dividend_yield (unreliable for
      // option-income funds — e.g. SPYI shows 0.50% vs a real ~12%).
      const bestYield = profile.expected_dividend_yield
        ?? approxYieldFromCurrentDistributions(profile)
        ?? profile.dividend_yield
      return {
        symbol: sym,
        ...profile,
        dividend_yield: bestYield,
        market_cap: research.market_cap || profile.assets,
        forward_pe: research.forward_pe,
        peg_ratio: research.peg_ratio,
        revenue: research.revenue,
        profit_margin: research.profit_margin_pct,
        beta: profile.beta ?? research.beta,
        beta_benchmark: profile.beta_benchmark ?? null,
        sharpe: profile.sharpe,
        sortino: profile.sortino,
        eps: research.eps,
        payout_ratio: research.payout_ratio_pct,
        debt_to_equity: research.debt_to_equity,
        sector: research.sector,
        industry: research.industry,
        dividend_growth: research.dividend_growth_pct,
        return_1y: profile.return_1y ?? stats[sym]?.total_ret,
        max_drawdown: profile.max_drawdown ?? stats[sym]?.max_drawdown,
      }
    })
  }, [data, symbols, stockData])

  useEffect(() => {
    if (symbols.length && !symbols.includes(distributionSymbol)) {
      setDistributionSymbol(symbols[0])
    }
  }, [symbols, distributionSymbol])

  const distributionResearch = stockData[distributionSymbol] || {}

  const activeColumns = COLUMNS.filter(col => col.locked || visibleColumns.includes(col.key))
  const filteredColumns = COLUMNS.filter(col => !search || col.label.toLowerCase().includes(search.toLowerCase()))

  const format = (key, value) => {
    if (value == null || value === '') return '-'
    if (['price', 'open', 'fifty_two_week_high', 'fifty_two_week_low', 'eps'].includes(key)) return formatMoney(value)
    if (['pe_ratio', 'forward_pe', 'peg_ratio', 'beta', 'sharpe', 'sortino', 'debt_to_equity'].includes(key)) return number(value)
    if (['market_cap', 'dollar_volume', 'revenue'].includes(key)) return compactMoney(value)
    if (key === 'volume') return compact(value)
    if (['dividend_yield'].includes(key)) return ratioPct(value)
    if (['profit_margin', 'payout_ratio', 'dividend_growth'].includes(key)) return pctFixed(value)
    if (['change_pct', 'return_1y', 'max_drawdown'].includes(key)) return pct(value)
    return value
  }

  const averageChart = useMemo(() => {
    const periods = averageData?.periods || []
    const averageSymbols = averageData?.symbols?.length ? averageData.symbols : symbols
    const periodByLabel = new Map(periods.map(p => [p.label, p]))
    const available = AVERAGE_PERIOD_ORDER.map(label => periodByLabel.get(label) || { label, returns: {} })
    return {
      data: averageSymbols.map((sym, idx) => ({
        x: available.map(p => p.label),
        y: available.map(p => p.returns?.[sym] ?? null),
        type: 'bar',
        name: sym,
        marker: { color: comparerSeriesColor(idx) },
        text: available.map(p => p.returns?.[sym] == null ? '' : `${p.returns[sym].toFixed(2)}%`),
        textposition: 'outside',
        hovertemplate: `<b>${sym}</b><br>%{x}: %{y:.2f}%<extra></extra>`,
      })),
      layout: {
        template: 'plotly_dark',
        paper_bgcolor: '#16213e',
        plot_bgcolor: '#16213e',
        font: { color: '#e0e8f5' },
        barmode: 'group',
        height: 390,
        margin: { l: 55, r: 50, t: 25, b: 55 },
        yaxis: { ticksuffix: '%', gridcolor: '#293a5f', zerolinecolor: '#6a7892' },
        xaxis: { gridcolor: '#16213e' },
        legend: { orientation: 'h', x: 0, y: -0.18 },
      },
    }
  }, [averageData, symbols])

  const averageTablePeriods = useMemo(() => {
    const periodByLabel = new Map((averageData?.periods || []).map(p => [p.label, p]))
    return AVERAGE_PERIOD_ORDER
      .filter(label => label !== '1 Month')
      .map(label => periodByLabel.get(label) || { label, returns: {} })
  }, [averageData])

  const customRangeActive = !intraday && !!(returnXRange[0] || returnXRange[1] || fetchRange)

  return (
    <div className={`page etf-comparer-page${fullWidth ? ' etfc-full-width' : ''}`}>
      <div className="etfc-breadcrumb">Home » Stocks » Compare</div>
      <div className="etfc-title-row">
        <h1>{compareTitle}</h1>
        <button
          type="button"
          className="etfc-width-toggle"
          onClick={() => setFullWidth(v => !v)}
          title={fullWidth ? 'Return to the standard page width' : 'Use the full window width'}
        >
          {fullWidth ? '« Standard Width' : 'Full Width »'}
        </button>
      </div>

      <div className="etfc-toolbar">
        <div className="etfc-chip-input" onClick={() => inputRef.current?.focus()}>
          {tickers.map((sym, idx) => (
            <span
              key={sym}
              className={`etfc-chip${highlightedSymbol === sym ? ' etfc-chip-highlighted' : ''}`}
              style={{ borderColor: comparerSeriesColor(idx) }}
            >
              <button
                type="button"
                className="etfc-chip-symbol"
                onClick={(e) => { e.stopPropagation(); toggleHighlight(sym) }}
                title={highlightedSymbol === sym ? 'Click to show all tickers' : 'Click to highlight this ticker on the chart'}
              >
                {sym}
              </button>
              <button onClick={(e) => { e.stopPropagation(); removeTicker(sym) }}>×</button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTickers() } }}
            placeholder="Add Stocks..."
            autoComplete="off"
          />
          <button className="btn btn-sm" onClick={addTickers}>Add</button>
        </div>
        <div className="ctb-bar">
          <ChartMetricMenu metric={metric} onChange={chooseMetric} />
          <SavedComparisonsMenu
            scope="stock"
            current={{ symbols, metric, settings: { period, lineMode, reinvest } }}
            onLoad={loadSavedComparison}
            describe={describeSaved}
          />
          <ChartOptionsMenu toggles={optionToggles} groups={chartOptionGroups(chartTools)} />
        </div>
      </div>

      <ComparerTickerLibrary
        symbols={symbols}
        storageKey="stockcomparer-saved-tickers"
        securityLabel="stocks"
        onAddSymbols={addTickerSymbols}
      />

      {error && <div className="etf-error">{error}</div>}
      {loading && <div className="etfc-loading">Loading stock comparison...</div>}

      <div className="etfc-return-controls">
        <div className="etfc-mode-bar" title="Which return lines a percentage or growth chart draws">
          {RETURN_MODES.map(m => (
            <button
              key={m.value}
              className={`btn btn-sm${returnMode === m.value && !isDividendMetric(metric) && metric !== 'total_value' ? ' btn-active' : ''}`}
              onClick={() => chooseLineMode(m.value)}
              title={m.value === 'actual' ? "Chart each stock's actual share price in dollars, not a relative return" : undefined}
            >{m.label}</button>
          ))}
        </div>
        <div className={`etfc-reinvest${reinvestDisabled ? ' is-disabled' : ''}`}>
          <label>Reinvest: <strong>{reinvest}%</strong></label>
          <input type="range" min="0" max="100" value={reinvest} onChange={e => setReinvest(Number(e.target.value))} disabled={reinvestDisabled} />
          <input type="number" min="0" max="100" value={reinvest} onChange={e => setReinvest(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} disabled={reinvestDisabled} />
        </div>
        <div className="etfc-chart-options">
          <span>Chart</span>
          <button type="button" className="btn btn-sm" onClick={refreshComparison} disabled={!symbols.length || loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
          <span className="etfc-metric-note">{metricInfo.desc}</span>
        </div>
      </div>

      {symbols.length === 0 ? (
        <section className="etfc-section etfc-empty">
          Add stocks above to build a comparison.
        </section>
      ) : (
        <section className="etfc-section etfc-chart-card ctb-chart-card" ref={chartCardRef}>
          <div className="etfc-range-bar">
            <div className="etfc-periods">
              {PERIODS.map(p => (
                // A custom date window overrides the period, so don't show a
                // period button as selected while one is active.
                <button key={p.value} className={`btn btn-sm${period === p.value && !customRangeActive ? ' btn-active' : ''}`} onClick={() => { setPeriod(p.value); resetReturnRange() }}>{p.label}</button>
              ))}
              {showDatePicker && dataDateBounds[0] && (
                <>
                  <span className="etfc-date-sep">|</span>
                  <input type="date" className="range-date-input" value={rangeStart} max={rangeEnd}
                    onChange={e => handleRangeDateChange('start', e.target.value)} title="Start date" />
                  <span className="range-date-arrow">→</span>
                  <input type="date" className="range-date-input" value={rangeEnd} min={rangeStart}
                    onChange={e => handleRangeDateChange('end', e.target.value)} title="End date" />
                  {customRangeActive && (
                    <button className="btn btn-sm" onClick={resetReturnRange} title="Clear custom dates">&times;</button>
                  )}
                </>
              )}
            </div>
            <div className="ctb-bar">
              {isFullscreen && (
                <button type="button" className="ctb-trigger" onClick={chartTools.fullscreen}>Exit Full Screen</button>
              )}
              <ChartDownloadMenu actions={chartDownloadActions(chartTools)} disabled={!chart.data.length} />
            </div>
          </div>
          <ChartToolStatus status={chartTools.status} onDismiss={chartTools.clearStatus} />
          {chart.notes?.length > 0 && <div className="etfc-chart-notes">{chart.notes.join(' ')}</div>}
          <Plot
            data={chart.data}
            layout={themedPlotlyLayout(chart.layout, isDark)}
            config={{ responsive: true, displayModeBar: true, displaylogo: false }}
            useResizeHandler
            style={{ width: '100%', height: chartHeight }}
            rankUnifiedHover
            onInitialized={rememberGraphDiv}
            onUpdate={rememberGraphDiv}
            onRelayout={(e) => {
              if (intraday) return
              if (e?.['xaxis.autorange']) { setReturnXRange([null, null]); return }
              const range = e?.['xaxis.range'] || (e?.['xaxis.range[0]'] && e?.['xaxis.range[1]'] ? [e['xaxis.range[0]'], e['xaxis.range[1]']] : null)
              const next = normalizeReturnRange(range)
              if (next) {
                setReturnXRange(prev => {
                  if (prev[0] === next[0] && prev[1] === next[1]) return prev
                  if (!prev[0] && !prev[1] && next[0] === dataDateBounds[0] && next[1] === dataDateBounds[1]) return prev
                  return next
                })
              }
            }}
          />
        </section>
      )}

      {symbols.length > 0 && <section className="etfc-section">
        <div className="etfc-section-head">
          <h2>Comparison</h2>
          <div className="etfc-menu-wrap">
            <button className="btn btn-sm" onClick={() => setMenuOpen(o => !o)}>Indicators {menuOpen ? '▲' : '▼'}</button>
            {menuOpen && (
              <div className="etfc-menu">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search indicators..." />
                <div className="etfc-menu-options">
                  {filteredColumns.map(col => (
                    <label key={col.key}>
                      <input
                        type="checkbox"
                        checked={col.locked || visibleColumns.includes(col.key)}
                        disabled={col.locked}
                        onChange={e => {
                          if (e.target.checked) setVisibleColumns(prev => [...new Set([...prev, col.key])])
                          else setVisibleColumns(prev => prev.filter(k => k !== col.key))
                        }}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
                <button onClick={() => setVisibleColumns(DEFAULT_COLUMNS)}>Reset Selection</button>
              </div>
            )}
          </div>
        </div>
        <div className="etfc-table-wrap">
          <table className="etfc-table">
            <thead>
              <tr>{activeColumns.map(col => <th key={col.key}>{col.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.symbol}>
                  {activeColumns.map(col => {
                    if (col.key === 'beta') {
                      const bm = row.beta_benchmark
                      return (
                        <td key={col.key} title={bm ? `Beta regressed against ${bm} (best-fitting benchmark)` : undefined}>
                          {format('beta', row.beta)}
                          {bm && row.beta != null && (
                            <span style={{ color: 'var(--p-6f7890)', fontSize: '0.8em', marginLeft: 4 }}>vs {bm}</span>
                          )}
                        </td>
                      )
                    }
                    return (
                      <td key={col.key} style={['change_pct', 'return_1y', 'max_drawdown'].includes(col.key) ? { color: pctColor(row[col.key]) } : undefined}>
                        {col.key === 'symbol' ? <strong>{row.symbol}</strong> : format(col.key, row[col.key])}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}

      {symbols.length > 0 && <section className="etfc-section">
        <div className="etfc-section-head">
          <h2>Average Return</h2>
          <button className="btn btn-sm">Download ▼</button>
        </div>
        {averageData?.summary && (
          <div className="etfc-note">
            {averageData.summary} These numbers are adjusted for stock splits and assume dividends are reinvested.
          </div>
        )}
        <Plot data={averageChart.data} layout={themedPlotlyLayout(averageChart.layout, isDark)} config={{ responsive: true, displayModeBar: false }} useResizeHandler style={{ width: '100%', height: 390 }} />
        {averageData?.periods?.length > 0 && (
          <div className="etfc-average-table-wrap">
            <table className="etfc-average-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  {averageTablePeriods
                    .map(p => <th key={p.label}>{p.label === 'YTD' ? 'Year-to-date' : p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(averageData.symbols || symbols).map((sym, idx) => (
                  <tr key={sym}>
                    <td><span className="etfc-series-swatch" style={{ background: comparerSeriesColor(idx) }} />{sym}</td>
                    {averageTablePeriods
                      .map(p => <td key={p.label}>{pct(p.returns?.[sym])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {symbols.length > 0 && <section className="etfc-section">
        <div className="etfc-section-head">
          <h2>Yield on Cost</h2>
          <button className="btn btn-sm" onClick={() => setShowYieldOnCost(v => !v)}>
            {showYieldOnCost ? 'Hide Chart' : 'Show Chart'}
          </button>
        </div>
        {showYieldOnCost && (
          <YieldOnCostChart
            entries={yieldOnCostEntries}
            visibleStart={visibleWindow[0]}
            visibleEnd={visibleWindow[1]}
            hovermode={returnHoverMode}
            emphasis="growth"
          />
        )}
      </section>}

      {symbols.length > 0 && <section className="etfc-section etfc-distribution-section">
        <div className="etfc-section-head">
          <h2>Distribution History</h2>
          <button className="btn btn-sm" onClick={() => setShowDistributionChart(v => !v)}>
            {showDistributionChart ? 'Hide Chart' : 'Show Chart'}
          </button>
        </div>
        {showDistributionChart && (
          <DistributionHistoryChart
            history={distributionResearch.distribution_history}
            ticker={distributionSymbol}
            price={distributionResearch.price}
            frequency={distributionResearch.dividend_frequency}
            source={distributionResearch.yield_source || distributionResearch.data_source || ''}
            pctMode={distPctMode}
            annual={distAnnual}
            onTogglePctMode={() => { setDistPctMode(v => !v); setDistAnnual(false) }}
            onToggleAnnual={() => setDistAnnual(v => !v)}
            emptyLabel="this stock"
            showEstimatedYield
            toolbarStart={
              <div className="etfc-distribution-tabs" aria-label="Distribution history ticker">
                {symbols.map((sym, idx) => (
                  <button
                    key={sym}
                    type="button"
                    className={`btn btn-sm${distributionSymbol === sym ? ' btn-active' : ''}`}
                    style={{ borderColor: comparerSeriesColor(idx) }}
                    onClick={() => setDistributionSymbol(sym)}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            }
          />
        )}
      </section>}

      {symbols.length > 0 && <section className="etfc-section">
        <div className="etfc-section-head">
          <h2>Key Fundamentals</h2>
        </div>
        <div className="etfc-holdings-grid">
          {symbols.map(sym => {
            const research = stockData[sym] || {}
            const name = research.name || rows.find(r => r.symbol === sym)?.name || sym
            return (
              <div key={sym} className="etfc-holdings-card stc-fundamentals-card">
                <h3>{sym} - {name}</h3>
                <table>
                  <thead>
                    <tr><th>Metric</th><th>Value</th></tr>
                  </thead>
                  <tbody>
                    {FUNDAMENTAL_ROWS.map(row => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{fmtFundamental(research[row.key], row.fmt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      </section>}
    </div>
  )
}

