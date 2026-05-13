import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Plot from 'react-plotly.js'
import { useProfileFetch } from '../context/ProfileContext'

const PERIODS = [
  { value: '1mo', label: '1M' },
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: '2y', label: '2Y' },
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
  { key: 'price', label: 'Stock Price' },
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
  { key: 'fifty_two_week_high', label: '52 Week High' },
  { key: 'fifty_two_week_low', label: '52 Week Low' },
  { key: 'issuer', label: 'Issuer' },
  { key: 'category', label: 'Category' },
  { key: 'max_drawdown', label: 'Max Drawdown' },
]

const DEFAULT_COLUMNS = ['symbol', 'name', 'price', 'change_pct', 'assets', 'expense_ratio', 'pe_ratio', 'expected_dividend_yield', 'dividend_yield', 'volume', 'dollar_volume', 'open', 'return_1y']
const AVERAGE_PERIOD_ORDER = ['1 Month', 'YTD', '1 Year', '5 Years', '10 Years', 'Inception']

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
  const [data, setData] = useState(null)
  const [averageData, setAverageData] = useState(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const loadSeqRef = useRef(0)
  const reinvestRef = useRef(reinvest)
  const [holdings, setHoldings] = useState({})
  const [holdingsLoadedNonce, setHoldingsLoadedNonce] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_COLUMNS)
  const [showDistributionChart, setShowDistributionChart] = useState(true)
  const [distributionSymbol, setDistributionSymbol] = useState('')
  const [downloadStatus, setDownloadStatus] = useState('')

  const resetReturnRange = useCallback(() => {
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
    if (!value) { setReturnXRange([null, null]); return }
    const s = which === 'start' ? value : (returnXRange[0] || dataDateBounds[0])
    const e = which === 'end' ? value : (returnXRange[1] || dataDateBounds[1])
    if (s && e) setReturnXRange(normalizeReturnRange([s, e]) || [s, e])
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
    pf(`/api/etf-screen/data?ticker=${encodeURIComponent(primary)}&period=${period}&mode=${returnMode}&reinvest=${reinvest}&extra=${encodeURIComponent(extra.join(','))}&refresh=${refreshNonce}`)
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
  }, [pf, tickers, period, returnMode, reinvest, refreshNonce])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    resetReturnRange()
  }, [period, returnMode, reinvest, resetReturnRange])

  useEffect(() => {
    const symbols = tickers.map(normalize).filter(Boolean)
    let cancelled = false
    symbols.forEach(sym => {
      if (holdingsLoadedNonce[sym] === refreshNonce) return
      pf(`/api/security-research/etf/${encodeURIComponent(sym)}?refresh=${refreshNonce}`)
        .then(r => r.json())
        .then(d => {
          if (cancelled || d.error) return
          setHoldings(prev => ({ ...prev, [sym]: d.top_holdings || [] }))
          setHoldingsLoadedNonce(prev => ({ ...prev, [sym]: refreshNonce }))
        })
        .catch(() => {})
    })
    return () => { cancelled = true }
  }, [tickers, holdingsLoadedNonce, pf, refreshNonce])

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
    const [visibleStart, visibleEnd] = visibleDateRange(data, returnXRange, showRangeSlider)

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
    return {
      data: traces,
      layout: {
        template: 'plotly_dark',
        paper_bgcolor: '#1e1e2f',
        plot_bgcolor: '#1e1e2f',
        font: { color: '#e0e0e0', size: 12 },
        title: { text: 'Total Return (%)', x: 0.5, font: { size: 20, color: '#e0e0e0' } },
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
  }, [data, symbols, reinvest, returnPctMode, showReturnLabels, returnHoverMode, showRangeSlider, returnXRange, dataDateBounds])

  const rows = useMemo(() => {
    const profiles = data?.profiles || {}
    const stats = data?.stats || {}
    return symbols.map(sym => ({
      symbol: sym,
      ...(profiles[sym] || {}),
      return_1y: profiles[sym]?.return_1y ?? stats[sym]?.total_ret,
      max_drawdown: profiles[sym]?.max_drawdown ?? stats[sym]?.max_drawdown,
    }))
  }, [data, symbols])

  const activeColumns = COLUMNS.filter(col => col.locked || visibleColumns.includes(col.key))
  const filteredColumns = COLUMNS.filter(col => !search || col.label.toLowerCase().includes(search.toLowerCase()))

  const format = (key, value) => {
    if (value == null || value === '') return '-'
    if (['price', 'open', 'fifty_two_week_high', 'fifty_two_week_low', 'pe_ratio'].includes(key)) return number(value)
    if (['assets', 'volume', 'dollar_volume'].includes(key)) return compact(value)
    if (['expense_ratio', 'dividend_yield', 'expected_dividend_yield'].includes(key)) return ratioPct(value)
    if (['change_pct', 'return_1y', 'max_drawdown'].includes(key)) return pct(value)
    return value
  }

  const distributionChart = useMemo(() => {
    const profile = data?.profiles?.[distributionSymbol] || {}
    const history = Array.isArray(profile.distribution_history) ? profile.distribution_history : []
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const byMonth = new Map()

    history.forEach(item => {
      const amount = Number(item?.amount)
      const parts = String(item?.date || '').slice(0, 10).split('-')
      if (!Number.isFinite(amount) || amount <= 0 || parts.length < 2) return
      const year = Number(parts[0])
      const month = Number(parts[1])
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return
      const key = `${year}-${String(month).padStart(2, '0')}`
      byMonth.set(key, (byMonth.get(key) || 0) + amount)
    })

    const monthly = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-36)
      .map(([key, amount]) => {
        const [year, month] = key.split('-').map(Number)
        return {
          label: `${monthNames[month - 1]} ${String(year).slice(-2)}`,
          amount: Number(amount.toFixed(4)),
        }
      })
    const values = monthly.map(item => item.amount)
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

    return {
      hasData: values.length > 0,
      source: profile.distribution_source || profile.expected_yield_source || '',
      layout: {
        template: 'plotly_dark',
        paper_bgcolor: '#16213e',
        plot_bgcolor: '#16213e',
        font: { color: '#e0e8f5', size: 12 },
        title: { text: `${distributionSymbol || 'ETF'} - Distribution History`, x: 0.5, font: { size: 18, color: '#e0e8f5' } },
        height: 360,
        margin: { l: 58, r: 36, t: 58, b: 72 },
        bargap: 0.18,
        yaxis: {
          tickprefix: '$',
          gridcolor: '#293a5f',
          zerolinecolor: '#6a7892',
          fixedrange: true,
        },
        xaxis: {
          gridcolor: '#1c2a4b',
          tickangle: -45,
          fixedrange: true,
        },
        showlegend: false,
      },
      data: values.length ? [{
        x: monthly.map(item => item.label),
        y: values,
        type: 'bar',
        marker: {
          color: values.map(value => value >= average ? '#62f27b' : '#82c7f5'),
          line: { color: 'rgba(255, 255, 255, 0.12)', width: 1 },
        },
        hovertemplate: `<b>${distributionSymbol}</b><br>%{x}<br>$%{y:.4f}<extra></extra>`,
      }] : [],
    }
  }, [data, distributionSymbol])

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
        marker: { color: COLORS[idx % COLORS.length] },
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

  const downloadAverageReturns = useCallback(() => {
    const exportSymbols = averageData?.symbols?.length ? averageData.symbols : symbols
    if (!exportSymbols.length || !averageTablePeriods.length) return
    const escapeCsv = value => {
      const text = value == null ? '' : String(value)
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const headers = ['Symbol', ...averageTablePeriods.map(p => `${p.label === 'YTD' ? 'Year-to-date' : p.label} Return (%)`)]
    const lines = [
      headers.map(escapeCsv).join(','),
      ...exportSymbols.map(sym => [
        sym,
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
  }, [averageData, averageTablePeriods, symbols])

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
          {PERIODS.map(p => (
              <button key={p.value} className={`btn btn-sm${period === p.value ? ' btn-active' : ''}`} onClick={() => { setPeriod(p.value); resetReturnRange() }}>{p.label}</button>
          ))}
          {dataDateBounds[0] && (
            <>
              <span className="etfc-date-sep">|</span>
              <input type="date" className="range-date-input" value={rangeStart} min={dataDateBounds[0]} max={rangeEnd}
                onChange={e => handleRangeDateChange('start', e.target.value)} title="Start date" />
              <span className="range-date-arrow">→</span>
              <input type="date" className="range-date-input" value={rangeEnd} min={rangeStart} max={dataDateBounds[1]}
                onChange={e => handleRangeDateChange('end', e.target.value)} title="End date" />
              {(returnXRange[0] || returnXRange[1]) && (
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
            layout={chart.layout}
            config={{ responsive: true, displayModeBar: true, displaylogo: false }}
            useResizeHandler
            style={{ width: '100%' }}
            onRelayout={(e) => {
              if (e?.['xaxis.autorange']) { setReturnXRange([null, null]); return }
              const range = e?.['xaxis.range'] || (e?.['xaxis.range[0]'] && e?.['xaxis.range[1]'] ? [e['xaxis.range[0]'], e['xaxis.range[1]']] : null)
              const next = normalizeReturnRange(range)
              if (next) {
                setReturnXRange(prev => (prev[0] === next[0] && prev[1] === next[1] ? prev : next))
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
          <>
            <div className="etfc-distribution-toolbar">
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
              {distributionChart.source && (
                <span className="etfc-distribution-source">Source: {distributionChart.source}</span>
              )}
            </div>
            {distributionChart.hasData ? (
              <Plot
                data={distributionChart.data}
                layout={distributionChart.layout}
                config={{ responsive: true, displayModeBar: false }}
                useResizeHandler
                style={{ width: '100%' }}
              />
            ) : (
              <div className="etfc-empty etfc-distribution-empty">
                No distribution history available for {distributionSymbol || 'this ETF'}.
              </div>
            )}
          </>
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
                  {activeColumns.map(col => (
                    <td key={col.key} style={['change_pct', 'return_1y', 'max_drawdown'].includes(col.key) ? { color: pctColor(row[col.key]) } : undefined}>
                      {col.key === 'symbol' ? <strong>{row.symbol}</strong> : format(col.key, row[col.key])}
                    </td>
                  ))}
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
        <Plot data={averageChart.data} layout={averageChart.layout} config={{ responsive: true, displayModeBar: false }} useResizeHandler style={{ width: '100%' }} />
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
                    <td><span className="etfc-series-swatch" style={{ background: COLORS[idx % COLORS.length] }} />{sym}</td>
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
          ))}
        </div>
      </section>}
    </div>
  )
}
