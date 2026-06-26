import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Plot from '../components/ThemedPlot'
import { useProfileFetch } from '../context/ProfileContext'
import DistributionHistoryChart from '../components/DistributionHistoryChart'
import { returnVsYield } from '../utils/returnVsYield'
import { approxYieldFromCurrentDistributions } from '../utils/approxYield'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoney, formatMoneyCompact } from '../utils/money'

const PERIODS = [
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
]

const RETURN_MODES = [
  { value: 'total', label: 'Total Return' },
  { value: 'price', label: 'Price Only' },
  { value: 'pricediv', label: 'Price + Divs' },
  { value: 'both', label: 'Both' },
  { value: 'all3', label: 'All Three' },
  { value: 'all4', label: 'All Four' },
]

const COLORS = ['#2f7df6', '#ef7426', '#26a69a', '#b39ddb', '#ffb74d', '#4dd0e1', '#f06292']

const TRACE_STYLES = {
  price: { dash: 'dot', width: 2, label: 'Price' },
  pricediv: { dash: 'longdash', width: 2.4, label: 'Price + Divs' },
  blend: { dash: 'dash', width: 2.4, label: '' },
  total: { dash: 'solid', width: 3, label: 'Total Return' },
  drip: { dash: 'solid', width: 3, label: '100% DRIP' },
}

const COLUMNS = [
  { key: 'symbol', label: 'Symbol', locked: true },
  { key: 'name', label: 'Fund Name', locked: true },
  { key: 'price', label: 'ETF Price' },
  { key: 'change_pct', label: '% Change' },
  { key: 'assets', label: 'Assets' },
  { key: 'expense_ratio', label: 'Exp. Ratio' },
  { key: 'pe_ratio', label: 'PE Ratio' },
  { key: 'expected_dividend_yield', label: 'Expected Div. Yield' },
  { key: 'expected_yield_source', label: 'Expected Yield Source' },
  { key: 'dividend_yield', label: 'Div. Yield' },
  { key: 'volume', label: 'Volume' },
  { key: 'dollar_volume', label: 'Dollar Vol.' },
  { key: 'open', label: 'Open' },
  { key: 'return_1y', label: 'CAGR 1Y' },
  { key: 'beta', label: 'Beta' },
  { key: 'approx_delta', label: 'Approx. Delta (↑/↓)' },
  { key: 'sharpe', label: 'Sharpe' },
  { key: 'sortino', label: 'Sortino' },
  { key: 'fifty_two_week_high', label: '52 Week High' },
  { key: 'fifty_two_week_low', label: '52 Week Low' },
  { key: 'issuer', label: 'Issuer' },
  { key: 'category', label: 'Category' },
  { key: 'max_drawdown', label: 'Max Drawdown' },
  { key: 'ret_vs_yld', label: 'Ret vs Yld' },
]

const DEFAULT_COLUMNS = ['symbol', 'name', 'price', 'change_pct', 'assets', 'expense_ratio', 'pe_ratio', 'expected_dividend_yield', 'dividend_yield', 'volume', 'dollar_volume', 'open', 'return_1y', 'approx_delta', 'ret_vs_yld']
const AVERAGE_PERIOD_ORDER = ['1 Month', 'YTD', '1 Year', '5 Years', '10 Years', 'Common History', 'Inception']

function pct(v) {
  if (v == null || Number.isNaN(Number(v))) return '-'
  const n = Number(v)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
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

function positiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
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

function yieldPct(value) {
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

function firstVisibleIndex(dates, start, end) {
  if (!dates?.length) return -1
  return dates.findIndex(d => (!start || dateKey(d) >= start) && (!end || dateKey(d) <= end))
}

function lastVisibleIndex(dates, start, end) {
  if (!dates?.length) return -1
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dateKey(dates[i])
    if ((!start || d >= start) && (!end || d <= end)) return i
  }
  return -1
}

export default function ETFComparer() {
  const pf = useProfileFetch()
  const { isDark } = useTheme()
  const [tickers, setTickers] = useState([])
  const [input, setInput] = useState('')
  const inputRef = useRef(null)
  const [period, setPeriod] = useState('6mo')
  const [returnMode, setReturnMode] = useState('total')
  const [reinvest, setReinvest] = useState(100)
  const [showReturnLabels, setShowReturnLabels] = useState(true)
  const [returnHoverMode, setReturnHoverMode] = useState('x unified')
  const [returnPctMode, setReturnPctMode] = useState(true)
  const [showRangeSlider, setShowRangeSlider] = useState(true)
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
  const [holdings, setHoldings] = useState({})
  const holdingsLoadedRef = useRef({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('etfcomparer-columns'))
      if (Array.isArray(saved)) {
        const valid = COLUMNS.map(c => c.key)
        const cleaned = saved.filter(k => valid.includes(k))
        if (cleaned.length) return cleaned
      }
    } catch { /* ignore malformed storage */ }
    return DEFAULT_COLUMNS
  })
  const [showDistributionChart, setShowDistributionChart] = useState(true)
  const [distributionSymbol, setDistributionSymbol] = useState('')
  const [distPctMode, setDistPctMode] = useState(false)
  const [distAnnual, setDistAnnual] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState('')

  // Persist column selection so it survives app restarts.
  useEffect(() => {
    try { localStorage.setItem('etfcomparer-columns', JSON.stringify(visibleColumns)) } catch { /* ignore */ }
  }, [visibleColumns])

  const resetReturnRange = useCallback(() => {
    setFetchRange(null)
    setReturnXRange([null, null])
  }, [])

  const dataDateBounds = useMemo(() => {
    if (!data?.series) return [null, null]
    const allDates = Object.values(data.series).flatMap(s => s.dates || [])
    if (!allDates.length) return [null, null]
    return [dateKey(allDates.reduce((a, b) => a < b ? a : b)), dateKey(allDates.reduce((a, b) => a > b ? a : b))]
  }, [data])

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
    pf(`/api/etf-screen/data?ticker=${encodeURIComponent(primary)}&period=${period}&mode=${returnMode}&reinvest=${reinvest}&extra=${encodeURIComponent(extra.join(','))}&refresh=${refreshNonce}${rangeParam}`)
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
  }, [pf, tickers, period, returnMode, reinvest, refreshNonce, fetchRange])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    resetReturnRange()
  }, [period, resetReturnRange])

  useEffect(() => {
    const symbols = tickers.map(normalize).filter(Boolean)
    // `active` is only flipped off when the inputs below genuinely change
    // (new tickers / manual refresh). It must NOT depend on per-symbol load
    // state — otherwise a fast sibling (e.g. SGOV) completing would cancel a
    // slower in-flight fetch (e.g. CSHI's ~2.6s NEOS scrape) and drop its
    // successful result, leaving "No holdings data available".
    let active = true
    symbols.forEach(sym => {
      if (holdingsLoadedRef.current[sym] === refreshNonce) return
      pf(`/api/security-research/etf/${encodeURIComponent(sym)}?refresh=${refreshNonce}`)
        .then(r => r.json())
        .then(d => {
          if (!active || d.error) return
          const topHoldings = d.top_holdings || []
          if (topHoldings.length) {
            holdingsLoadedRef.current[sym] = refreshNonce
            setHoldings(prev => ({ ...prev, [sym]: topHoldings }))
          } else {
            setHoldings(prev => ({ ...prev, [sym]: [] }))
          }
        })
        .catch(() => {})
    })
    return () => { active = false }
  }, [tickers, pf, refreshNonce])

  useEffect(() => {
    const requestedSymbols = tickers.map(normalize).filter(Boolean)
    if (!requestedSymbols.length) {
      setAverageData(null)
      return
    }

    let cancelled = false
    setAverageData(null)
    pf(`/api/security-research/etf/average-returns?tickers=${encodeURIComponent(requestedSymbols.join(','))}&refresh=${refreshNonce}`)
      .then(r => r.json())
      .then(result => {
        if (cancelled) return
        if (result.error || !result.periods?.length) {
          setAverageData(null)
          return
        }
        setAverageData({
          symbols: result.symbols || requestedSymbols,
          periods: result.periods,
          summary: result.summary,
          inception_meta: result.inception_meta || {},
          common_history: result.common_history || null,
        })
      })
      .catch(() => {
        if (!cancelled) setAverageData(null)
      })

    return () => { cancelled = true }
  }, [pf, tickers, refreshNonce])

  const addTickers = () => {
    const symbols = input.split(/[\s,]+/).map(normalize).filter(Boolean)
    if (!symbols.length) {
      inputRef.current?.focus()
      return
    }
    setTickers(prev => [...new Set([...prev, ...symbols])])
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const removeTicker = (sym) => {
    setTickers(prev => prev.filter(t => t !== sym))
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const symbols = useMemo(() => tickers.map(normalize).filter(Boolean), [tickers])

  useEffect(() => {
    if (!symbols.length) {
      setDistributionSymbol('')
      return
    }
    setDistributionSymbol(prev => symbols.includes(prev) ? prev : symbols[0])
  }, [symbols])

  const reinvestDisabled = !['all3', 'all4'].includes(returnMode)
  const refreshComparison = useCallback(() => {
    if (!symbols.length) return
    const currentReinvest = reinvestRef.current
    setRefreshNonce(value => value + 1)
    setReinvest(currentReinvest)
  }, [symbols.length])

  const compareTitle = useMemo(() => {
    if (!symbols.length) return 'Compare ETFs'
    if (symbols.length === 1) return `Compare ETFs: ${symbols[0]}`
    return `Compare ETFs: ${symbols.join(' vs. ')}`
  }, [symbols])

  const chart = useMemo(() => {
    if (!data?.series) return { data: [], layout: {} }
    const traces = []
    const annotations = []
    const labelCandidates = []
    const visibleYValues = []
    const allDates = Object.values(data.series).flatMap(s => s.dates || [])
    const minDate = allDates.reduce((a, b) => a < b ? a : b)
    const maxDate = allDates.reduce((a, b) => a > b ? a : b)
    const activeReturnRange = normalizeReturnRange(returnXRange)
    const fallbackRange = dataDateBounds[0] && dataDateBounds[1] ? dataDateBounds : null
    const effectiveReturnRange = activeReturnRange || fallbackRange
    // Rebasing, end labels and y-scaling always follow the active window (typed
    // dates or slider) so the chart visually aligns with the date set.
    const [visibleStart, visibleEnd] = visibleDateRange(data, returnXRange, true)
    const titleWindow = activeReturnRange || normalizeReturnRange(fetchRange)

    symbols.forEach((sym, idx) => {
      const dates = data.series[sym]?.dates || []
      const traceMap = data.series[sym]?.traces || {}
      Object.entries(traceMap).forEach(([key, values]) => {
        const color = COLORS[idx % COLORS.length]
        const style = TRACE_STYLES[key] || TRACE_STYLES.total
        const baseIdx = firstVisibleIndex(dates, visibleStart, visibleEnd)
        const labelIdx = lastVisibleIndex(dates, visibleStart, visibleEnd)
        const base = Number(baseIdx >= 0 ? values?.[baseIdx] : values?.[0])
        const y = base ? values.map(v => returnPctMode ? (v / base - 1) * 100 : v / base * 100) : values
        dates.forEach((date, i) => {
          const value = Number(y[i])
          if (!Number.isFinite(value)) return
          const keyDate = dateKey(date)
          if ((!visibleStart || keyDate >= visibleStart) && (!visibleEnd || keyDate <= visibleEnd)) {
            visibleYValues.push(value)
          }
        })
        const label = key === 'blend' ? `${reinvest}%` : style.label
        const name = label ? `${sym} (${label})` : sym
        traces.push({
          x: dates,
          y,
          type: 'scatter',
          mode: 'lines',
          name,
          line: { color, width: style.width, dash: style.dash },
          hovertemplate: returnPctMode
            ? `<b>${sym}</b><br>%{x}<br>${label || 'Total Return'}: %{y:.2f}%<extra></extra>`
            : `<b>${sym}</b><br>%{x}<br>${label || 'Total Return'}: %{y:.2f}<extra></extra>`,
        })
        if (showReturnLabels && labelIdx >= 0) {
          const last = y[labelIdx]
          if (Number.isFinite(Number(last))) {
            labelCandidates.push({
              y: Number(last),
              text: returnPctMode ? pct(last) : number(last),
              color,
            })
          }
        }
      })
    })
    if (showReturnLabels && labelCandidates.length) {
      const axisBase = returnPctMode ? 0 : 100
      const yMin = Math.min(axisBase, ...visibleYValues, ...labelCandidates.map(label => label.y))
      const yMax = Math.max(axisBase, ...visibleYValues, ...labelCandidates.map(label => label.y))
      const ySpan = Math.max(1, yMax - yMin)
      const minLabelGap = Math.max(ySpan * 0.04, returnPctMode ? 0.45 : 1.5)
      const sortedLabels = [...labelCandidates].sort((a, b) => a.y - b.y)

      sortedLabels.forEach((label, index) => {
        label.displayY = index === 0
          ? label.y
          : Math.max(label.y, sortedLabels[index - 1].displayY + minLabelGap)
      })

      const overflow = sortedLabels[sortedLabels.length - 1].displayY - yMax
      if (overflow > 0) {
        for (let index = sortedLabels.length - 1; index >= 0; index -= 1) {
          const nextY = index === sortedLabels.length - 1
            ? sortedLabels[index].displayY - overflow
            : Math.min(sortedLabels[index].displayY, sortedLabels[index + 1].displayY - minLabelGap)
          sortedLabels[index].displayY = Math.max(yMin, nextY)
        }
      }

      sortedLabels.forEach(label => {
        annotations.push({
          x: 1,
          xref: 'paper',
          y: label.displayY,
          text: label.text,
          showarrow: false,
          xanchor: 'left',
          xshift: 8,
          font: { color: label.color, size: 11 },
        })
      })
    }
    traces.push({
      x: [minDate, maxDate],
      y: [returnPctMode ? 0 : 100, returnPctMode ? 0 : 100],
      type: 'scatter',
      mode: 'lines',
      name: 'Baseline',
      line: { color: '#6b7280', width: 1, dash: 'dash' },
      showlegend: false,
      hoverinfo: 'skip',
    })
    // Constrain the y-axis to the visible date window. Plotly autoranges y over
    // all trace data (not just the x-visible portion), so without this the curve
    // stays scaled to the full series and looks misaligned after zooming.
    let yAxisRange = null
    if (visibleYValues.length) {
      const axisBase = returnPctMode ? 0 : 100
      const labelYs = labelCandidates.map(l => l.y)
      const yLo = Math.min(axisBase, ...visibleYValues, ...labelYs)
      const yHi = Math.max(axisBase, ...visibleYValues, ...labelYs)
      const pad = Math.max((yHi - yLo) * 0.08, 1)
      yAxisRange = [yLo - pad, yHi + pad]
    }
    const titleText = titleWindow ? `Total Return — ${titleWindow[0]} → ${titleWindow[1]}` : 'Total Return (%)'
    return {
      data: traces,
      layout: {
        template: 'plotly_dark',
        paper_bgcolor: '#1e1e2f',
        plot_bgcolor: '#1e1e2f',
        font: { color: '#e0e0e0', size: 12 },
        title: { text: titleText, x: 0.5, font: { size: 20, color: '#e0e0e0' } },
        height: 560,
        margin: { l: 55, r: 70, t: 70, b: 55 },
        hovermode: returnHoverMode,
        legend: { orientation: 'h', x: 0, y: 1.08 },
        yaxis: {
          title: returnPctMode ? 'Total Return (%)' : 'Normalized Return (100 = start)',
          ticksuffix: returnPctMode ? '%' : '',
          gridcolor: '#333',
          zerolinecolor: '#555',
          showspikes: true,
          spikemode: 'across',
          ...(yAxisRange ? { range: yAxisRange, autorange: false } : {}),
        },
        xaxis: {
          type: 'date',
          gridcolor: '#333',
          rangeslider: showRangeSlider ? { visible: true, bgcolor: '#252540', bordercolor: '#555', borderwidth: 1, thickness: 0.08 } : { visible: false },
          ...(effectiveReturnRange ? { range: effectiveReturnRange, autorange: false } : {}),
          showspikes: true,
          spikemode: 'across',
        },
        annotations,
      },
    }
  }, [data, symbols, reinvest, returnPctMode, showReturnLabels, returnHoverMode, showRangeSlider, returnXRange, dataDateBounds, fetchRange])

  const rows = useMemo(() => {
    const profiles = data?.profiles || {}
    const stats = data?.stats || {}
    return symbols.map(sym => {
      const rtn1y = profiles[sym]?.return_1y ?? stats[sym]?.total_ret
      const yldRaw = profiles[sym]?.expected_dividend_yield ?? profiles[sym]?.dividend_yield
      const yldPct = yldRaw != null ? (Math.abs(yldRaw) <= 1 ? yldRaw * 100 : yldRaw) : null
      const rvy = returnVsYield(rtn1y, yldPct)
      // Yahoo's reported dividend_yield is unreliable for option-income ETFs
      // (e.g. SPYI shows 0.50% vs a real ~12%). Prefer the fund-site expected
      // yield, then the distribution-derived approx yield, before falling back.
      const bestYield = profiles[sym]?.expected_dividend_yield
        ?? approxYieldFromCurrentDistributions(profiles[sym])
        ?? profiles[sym]?.dividend_yield
      return {
        symbol: sym,
        ...(profiles[sym] || {}),
        return_1y: rtn1y,
        max_drawdown: profiles[sym]?.max_drawdown ?? stats[sym]?.max_drawdown,
        ret_vs_yld: rvy,
        dividend_yield: bestYield,
      }
    })
  }, [data, symbols])

  const activeColumns = COLUMNS.filter(col => col.locked || visibleColumns.includes(col.key))
  const filteredColumns = COLUMNS.filter(col => !search || col.label.toLowerCase().includes(search.toLowerCase()))

  const format = (key, value) => {
    if (value == null || value === '') return '-'
    if (['price', 'open', 'fifty_two_week_high', 'fifty_two_week_low'].includes(key)) return formatMoney(value)
    if (['pe_ratio', 'beta', 'sharpe', 'sortino'].includes(key)) return number(value)
    if (['assets', 'dollar_volume'].includes(key)) return compactMoney(value)
    if (key === 'volume') return compact(value)
    if (['expense_ratio', 'dividend_yield', 'expected_dividend_yield'].includes(key)) return ratioPct(value)
    if (['change_pct', 'return_1y', 'max_drawdown'].includes(key)) return pct(value)
    return value
  }

  const distributionProfile = data?.profiles?.[distributionSymbol] || {}

  const averageChart = useMemo(() => {
    const periods = averageData?.periods || []
    const averageSymbols = averageData?.symbols?.length ? averageData.symbols : symbols
    const inceptionMeta = averageData?.inception_meta || {}
    const periodByLabel = new Map(periods.map(p => [p.label, p]))
    const available = AVERAGE_PERIOD_ORDER.map(label => periodByLabel.get(label) || { label, returns: {} })
    return {
      data: averageSymbols.map((sym, idx) => ({
        x: available.map(p => p.label),
        y: available.map(p => p.returns?.[sym] ?? null),
        type: 'bar',
        name: sym,
        marker: { color: COLORS[idx % COLORS.length] },
        // On the Inception bar, append each fund's own span (e.g. "1.9y") since
        // those windows differ per fund and aren't directly comparable.
        text: available.map(p => {
          const v = p.returns?.[sym]
          if (v == null) return ''
          const base = `${v.toFixed(2)}%`
          const yrs = inceptionMeta[sym]?.years
          return p.label === 'Inception' && yrs != null ? `${base}<br>${yrs}y` : base
        }),
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

  const averageSymbols = useMemo(
    () => averageData?.symbols?.length ? averageData.symbols : symbols,
    [averageData, symbols],
  )
  const aumBySymbol = useMemo(() => {
    const profiles = data?.profiles || {}
    return Object.fromEntries(symbols.map(sym => [sym, positiveNumber(profiles[sym]?.assets)]))
  }, [data, symbols])
  const approxYieldBySymbol = useMemo(() => {
    const profiles = data?.profiles || {}
    return Object.fromEntries(symbols.map(sym => [sym, approxYieldFromCurrentDistributions(profiles[sym])]))
  }, [data, symbols])

  const downloadAverageReturns = useCallback(() => {
    const exportSymbols = averageSymbols
    if (!exportSymbols.length || !averageTablePeriods.length) return
    const escapeCsv = value => {
      const text = value == null ? '' : String(value)
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const headers = ['Symbol', 'AUM', 'Approx yield (%)', ...averageTablePeriods.map(p => `${p.label === 'YTD' ? 'Year-to-date' : p.label} Return (%)`)]
    const lines = [
      headers.map(escapeCsv).join(','),
      ...exportSymbols.map(sym => [
        sym,
        aumBySymbol[sym] == null || Number.isNaN(Number(aumBySymbol[sym])) ? '' : Number(aumBySymbol[sym]),
        approxYieldBySymbol[sym] == null || Number.isNaN(Number(approxYieldBySymbol[sym])) ? '' : Number(approxYieldBySymbol[sym]).toFixed(2),
        ...averageTablePeriods.map(p => {
          const value = p.returns?.[sym]
          return value == null || Number.isNaN(Number(value)) ? '' : Number(value).toFixed(2)
        }),
      ].map(escapeCsv).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `etf-average-returns-${exportSymbols.join('-') || 'comparison'}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setDownloadStatus(`Downloaded ${a.download}`)
    window.setTimeout(() => setDownloadStatus(''), 4000)
  }, [approxYieldBySymbol, aumBySymbol, averageSymbols, averageTablePeriods])

  return (
    <div className="page etf-comparer-page">
      <div className="etfc-breadcrumb">Home » ETFs » Compare</div>
      <div className="etfc-title-row">
        <h1>{compareTitle}</h1>
        <span>Full Width »</span>
      </div>

      <div className="etfc-toolbar">
        <div className="etfc-chip-input" onClick={() => inputRef.current?.focus()}>
          {tickers.map((sym, idx) => (
            <span key={sym} className="etfc-chip" style={{ borderColor: COLORS[idx % COLORS.length] }}>
              {sym}
              <button onClick={() => removeTicker(sym)}>×</button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTickers() } }}
            placeholder="Add ETFs..."
            autoComplete="off"
          />
          <button className="btn btn-sm" onClick={addTickers}>Add</button>
        </div>
        <div className="etfc-periods">
          <select className="etfc-select" value={returnMode} onChange={e => setReturnMode(e.target.value)}>
            {RETURN_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          {PERIODS.map(p => {
            // A custom date window overrides the period, so don't show a period
            // button as selected while one is active.
            const customActive = !!(returnXRange[0] || returnXRange[1] || fetchRange)
            return (
              <button key={p.value} className={`btn btn-sm${period === p.value && !customActive ? ' btn-active' : ''}`} onClick={() => { setPeriod(p.value); resetReturnRange() }}>{p.label}</button>
            )
          })}
          {dataDateBounds[0] && (
            <>
              <span className="etfc-date-sep">|</span>
              <input type="date" className="range-date-input" value={rangeStart} max={rangeEnd}
                onChange={e => handleRangeDateChange('start', e.target.value)} title="Start date" />
              <span className="range-date-arrow">→</span>
              <input type="date" className="range-date-input" value={rangeEnd} min={rangeStart}
                onChange={e => handleRangeDateChange('end', e.target.value)} title="End date" />
              {(returnXRange[0] || returnXRange[1] || fetchRange) && (
                <button className="btn btn-sm" onClick={resetReturnRange} title="Clear custom dates">&times;</button>
              )}
            </>
          )}
        </div>
      </div>

      {error && <div className="etf-error">{error}</div>}
      {loading && <div className="etfc-loading">Loading ETF comparison...</div>}

      <div className="etfc-return-controls">
        <div className="etfc-mode-bar">
          {RETURN_MODES.map(m => (
            <button key={m.value} className={`btn btn-sm${returnMode === m.value ? ' btn-active' : ''}`} onClick={() => setReturnMode(m.value)}>{m.label}</button>
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
          <button className={`btn btn-sm${returnPctMode ? ' btn-active' : ''}`} onClick={() => setReturnPctMode(v => !v)}>Return %</button>
          <button className={`btn btn-sm${showReturnLabels ? ' btn-active' : ''}`} onClick={() => setShowReturnLabels(v => !v)}>End Labels</button>
          <button className={`btn btn-sm${returnHoverMode === 'x unified' ? ' btn-active' : ''}`} onClick={() => setReturnHoverMode(m => m === 'x unified' ? 'closest' : 'x unified')}>Unified Hover</button>
          <button className={`btn btn-sm${showRangeSlider ? ' btn-active' : ''}`} onClick={() => { setShowRangeSlider(v => !v); resetReturnRange() }}>Range Slider</button>
        </div>
      </div>

      {symbols.length === 0 ? (
        <section className="etfc-section etfc-empty">
          Add ETFs above to build a comparison.
        </section>
      ) : (
        <section className="etfc-section etfc-chart-card">
          <Plot
            data={chart.data}
            layout={themedPlotlyLayout(chart.layout, isDark)}
            config={{ responsive: true, displayModeBar: true, displaylogo: false }}
            useResizeHandler
            style={{ width: '100%', height: 560 }}
            onRelayout={(e) => {
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

      {symbols.length > 0 && <section className="etfc-section etfc-distribution-section">
        <div className="etfc-section-head">
          <h2>Distribution History</h2>
          <button className="btn btn-sm" onClick={() => setShowDistributionChart(v => !v)}>
            {showDistributionChart ? 'Hide Chart' : 'Show Chart'}
          </button>
        </div>
        {showDistributionChart && (
          <DistributionHistoryChart
            history={distributionProfile.distribution_history}
            ticker={distributionSymbol}
            price={distributionProfile.price}
            source={distributionProfile.distribution_source || distributionProfile.expected_yield_source || ''}
            pctMode={distPctMode}
            annual={distAnnual}
            onTogglePctMode={() => { setDistPctMode(v => !v); setDistAnnual(false) }}
            onToggleAnnual={() => setDistAnnual(v => !v)}
            emptyLabel="this ETF"
            showEstimatedYield
            toolbarStart={
              <div className="etfc-distribution-tabs" aria-label="Distribution history ticker">
                {symbols.map((sym, idx) => (
                  <button
                    key={sym}
                    type="button"
                    className={`btn btn-sm${distributionSymbol === sym ? ' btn-active' : ''}`}
                    style={{ borderColor: COLORS[idx % COLORS.length] }}
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
                    if (col.key === 'ret_vs_yld') {
                      const rvy = row.ret_vs_yld
                      return (
                        <td key={col.key} style={{ color: rvy?.color || 'var(--p-6f7890)', textAlign: 'center' }}
                          title={rvy ? `1Y Return ${rvy.totalReturnPct?.toFixed(2)}% vs Yield ${rvy.yieldOnCost?.toFixed(2)}% (spread ${rvy.spread?.toFixed(2)}%)` : undefined}>
                          {rvy?.label || '-'}
                        </td>
                      )
                    }
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
                    if (col.key === 'approx_delta') {
                      const up = row.delta_up, dn = row.delta_down, bm = row.beta_benchmark
                      const has = up != null || dn != null
                      return (
                        <td key={col.key} style={{ whiteSpace: 'nowrap' }}
                          title={has
                            ? `Approximate effective delta vs ${bm || 'underlying'} — sensitivity on up-days (↑) vs down-days (↓), from return regression. NOT the fund's true option delta; for option-income funds ↑<↓ signals capped upside.`
                            : undefined}>
                          {has ? (
                            <>
                              <span style={{ color: 'var(--p-2f9d55)' }}>↑{number(up)}</span>
                              <span style={{ color: 'var(--p-6f7890)', margin: '0 3px' }}>/</span>
                              <span style={{ color: 'var(--p-d94b4b)' }}>↓{number(dn)}</span>
                            </>
                          ) : '-'}
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
          <div className="etfc-download-actions">
            {downloadStatus && <span>{downloadStatus}</span>}
            <button className="btn btn-sm" onClick={downloadAverageReturns} disabled={!averageData?.periods?.length}>Download CSV</button>
          </div>
        </div>
        {averageData?.summary && (
          <div className="etfc-note">
            {averageData.summary} These numbers are adjusted for stock splits and assume dividends are reinvested.
          </div>
        )}
        <Plot data={averageChart.data} layout={themedPlotlyLayout(averageChart.layout, isDark)} config={{ responsive: true, displayModeBar: false }} useResizeHandler style={{ width: '100%', height: 390 }} />
        {averageData?.common_history && (
          <div className="etfc-note" style={{ fontSize: '0.82em', color: 'var(--p-9aa7c2)' }}>
            <strong>Common History</strong> compares every fund over the identical window since the latest
            inception ({averageData.common_history.start} → {averageData.common_history.end},{' '}
            {averageData.common_history.years}y{averageData.common_history.annualized ? ', annualized' : ', cumulative'}).
            The <strong>Inception</strong> bars instead use each fund's own start date, so their spans differ
            (shown as the “Ny” label on each bar) and are <em>not</em> directly comparable.
          </div>
        )}
        {averageData?.periods?.length > 0 && (
          <div className="etfc-average-table-wrap">
            <table className="etfc-average-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>AUM</th>
                  <th>Approx yield</th>
                  {averageTablePeriods
                    .map(p => <th key={p.label}>{p.label === 'YTD' ? 'Year-to-date' : p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {averageSymbols.map((sym, idx) => (
                  <tr key={sym}>
                    <td><span className="etfc-series-swatch" style={{ background: COLORS[idx % COLORS.length] }} />{sym}</td>
                    <td>{compactMoney(aumBySymbol[sym])}</td>
                    <td>{yieldPct(approxYieldBySymbol[sym])}</td>
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
          <h2>Top 10 to 25 Holdings</h2>
        </div>
        <div className="etfc-holdings-grid">
          {symbols.map(sym => (
            <div key={sym} className="etfc-holdings-card">
              <h3>{sym} - {(rows.find(r => r.symbol === sym)?.name || sym)}</h3>
              <div className="etfc-holdings-table-wrap">
              <table>
                <thead>
                  <tr><th>No.</th><th>Symbol</th><th>Name</th><th>Weight</th></tr>
                </thead>
                <tbody>
                  {(holdings[sym] || []).slice(0, 25).map((h, idx) => (
                    <tr key={`${h.symbol}-${idx}`}>
                      <td>{idx + 1}</td>
                      <td className="etfc-holding-symbol">{h.symbol}</td>
                      <td>{h.name}</td>
                      <td>{h.weight_pct != null ? `${Number(h.weight_pct).toFixed(2)}%` : '-'}</td>
                    </tr>
                  ))}
                  {!(holdings[sym] || []).length && (
                    <tr><td colSpan={4}>No holdings data available.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      </section>}
    </div>
  )
}

