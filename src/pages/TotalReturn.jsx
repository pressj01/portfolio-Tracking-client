import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { prorateAnnualYield, returnVsYield } from '../utils/returnVsYield'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoney, formatMoneyWhole, getCurrencyLabel } from '../utils/money'
import { AccountValueCard } from '../components/AccountReconciliation'
import {
  MIN_PERFORMANCE_DATE,
  PERFORMANCE_PERIODS,
  PERFORMANCE_RANGE_NOTE,
  HOLDINGS_LIFETIME_MATCH_NOTE,
  TRACKER_SCOPE_NOTE,
  OPEN_LOT_SCOPE_NOTE,
  addCustomRangeParams,
  customRangeError,
  isLifetimePerformancePeriod,
  formatAccountingCoverage,
  formatCoverageShortfall,
  formatCoveragePartialTag,
  isCoverageMaterial,
  isCoverageSevere,
  formatPerformanceChartRange,
  formatPerformanceAsOf,
  formatPerformanceDate,
  formatPerformanceRange,
  readSharedPerformanceRange,
  formatClockStamp,
  todayInputValue,
} from '../utils/performancePeriods'
import useSharedPerformanceRange from '../utils/useSharedPerformanceRange'
import {
  fetchHoldingsJson,
  lifetimeTotalReturnPayload,
} from '../utils/lifetimePerformance'
import { loadTrackerCharts, trackerChartsSearchParams } from '../utils/sharedTrackerCharts'

// 30 bright, high-contrast colors for dark backgrounds
const PALETTE = [
  '#7B8CFF','#FF6F61','#2EFDB5','#C98FFF','#FFB86C','#4DE8FF','#FF80A8','#D4FF9A',
  '#FFB3FF','#FFE066','#5AAFEE','#FF9933','#55DD55','#FF5555','#BB99DD','#CC8877',
  '#FF99DD','#BBBBBB','#E0E044','#44DDEE','#C8DDFF','#FFCC88','#AAEE99','#FF9999',
  '#D5C5EE','#DDBBAA','#FFCCEE','#DDDDDD','#EEEE99','#AAEEFF',
]

const fmt = v => formatMoney(v)
const roundForDisplay = v => {
  const number = Number(v)
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null
}
const fmtPct = v => v != null ? `${Number(v).toFixed(2)}%` : '—'
const fmtInt = v => formatMoneyWhole(v)

// Below this, a return percentage is a divide-by-nothing artifact rather than a
// measurement, so the dollars are shown without it.
const MIN_BASIS = 1

const POSITION_VIEWS = [
  { key: 'unrealized', label: 'Unrealized', title: 'Open positions only — market performance over the selected range' },
  { key: 'realized', label: 'Realized', title: 'Closed positions — sales that settled inside the selected range' },
  { key: 'combined', label: 'Combined', title: 'One row per ticker: open performance plus realized sales' },
]

const COMPARISON_RETURN_MODES = [
  { key: 'total', label: 'Total Return', title: 'Full dividend-reinvested total return' },
  { key: 'price', label: 'Price Only', title: 'Share-price change only; distributions are excluded' },
  { key: 'pricediv', label: 'Price + Divs', title: 'Price change plus distributions held as cash' },
  { key: 'both', label: 'Both', title: 'Overlay Total Return and Price Only' },
]
const COMPARISON_TRACE_STYLES = {
  total: { label: 'Total Return', dash: 'solid', width: 3 },
  price: { label: 'Price Only', dash: 'dot', width: 2.2 },
  pricediv: { label: 'Price + Divs', dash: 'longdash', width: 2.5 },
}

const formatComparisonDate = formatPerformanceDate
const formatComparisonRange = formatPerformanceRange

function MetricCard({ label, value, range, className, children }) {
  return (
    <div className={`summary-card ${className || ''}`}>
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '—'}</div>
      {range && (
        <div style={{ marginTop: '0.3rem', color: 'var(--text-dim)', fontSize: '0.72rem', lineHeight: 1.25 }}>
          {range}
        </div>
      )}
      {children}
    </div>
  )
}

export default function TotalReturn() {
  const navigate = useNavigate()
  const pf = useProfileFetch()
  const { selection, basisMode, profileQueryString } = useProfile()
  const { isDark } = useTheme()
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(null)

  const [chartData, setChartData] = useState(null)
  const [chartLoading, setChartLoading] = useState(true)
  const [chartError, setChartError] = useState(null)

  const [sortCol, setSortCol] = useState('total_return_pct')
  const [sortAsc, setSortAsc] = useState(false)
  const [positionView, setPositionView] = useState('unrealized')
  // A Distributions figure nobody can take apart is one nobody can check.
  const [distDetail, setDistDetail] = useState(null)
  const openDistributions = async (ticker) => {
    setDistDetail({ ticker, loading: true })
    try {
      const params = new URLSearchParams({ period: dashboardPeriod })
      addCustomRangeParams(params, dashboardPeriod, customStart, customEnd)
      const res = await pf(`/api/total-return/distributions/${encodeURIComponent(ticker)}?${params}`)
      const data = await res.json()
      setDistDetail({ ticker, ...(data.error ? { error: data.error } : { data }) })
    } catch (err) {
      setDistDetail({ ticker, error: String(err?.message || err) })
    }
  }
  const [rvyMode, setRvyMode] = useState('cur')
  const [scatterReturnMode, setScatterReturnMode] = useState('pct')
  const [initialCustomDates] = useState(() => readSharedPerformanceRange())
  const [dashboardPeriod, setDashboardPeriod] = useState(initialCustomDates.period)
  const [customStart, setCustomStart] = useState(initialCustomDates.start)
  const [customEnd, setCustomEnd] = useState(initialCustomDates.end)

  // Comparison chart state
  const [cmpPortfolio, setCmpPortfolio] = useState(false)
  const [cmpTickers, setCmpTickers] = useState([])
  const [cmpTickerOpen, setCmpTickerOpen] = useState(false)
  const cmpTickerRef = useRef(null)
  const [cmpExtraInput, setCmpExtraInput] = useState('')
  const [cmpExtra, setCmpExtra] = useState('')
  const [cmpMode, setCmpMode] = useState('total')
  const [cmpData, setCmpData] = useState(null)
  const [cmpLoading, setCmpLoading] = useState(false)
  const [cmpError, setCmpError] = useState(null)

  useSharedPerformanceRange(dashboardPeriod, customStart, customEnd, (next) => {
    setDashboardPeriod(next.period)
    setCustomStart(next.start)
    setCustomEnd(next.end)
  })

  const rangeError = customRangeError(dashboardPeriod, customStart, customEnd)

  const dashboardRows = useMemo(() => {
    if (isLifetimePerformancePeriod(dashboardPeriod) && chartData?.performance_rows) {
      return chartData.performance_rows.map(row => ({
        ...row,
        period_range: 'Lifetime',
      }))
    }
    if (!summary?.rows || !chartData?.performance_rows) return []
    const performanceByTicker = new Map(
      chartData.performance_rows.map(row => [String(row.ticker || '').toUpperCase(), row]),
    )
    return summary.rows
      .map(row => {
        const performance = performanceByTicker.get(String(row.ticker || '').toUpperCase())
        return performance
          ? {
              ...row,
              ...performance,
              period_range: formatComparisonRange(
                performance.actual_start_date,
                performance.actual_end_date,
              ),
            }
          : null
      })
      .filter(Boolean)
  }, [summary, chartData, dashboardPeriod])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false)
      if (cmpTickerRef.current && !cmpTickerRef.current.contains(e.target)) setCmpTickerOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch DB summary
  useEffect(() => {
    if (rangeError) {
      setSummary(null)
      setSummaryLoading(false)
      // The range is a page-level condition, reported once above the cards
      // rather than repeated by every data source that just stood down.
      setSummaryError(null)
      return undefined
    }
    let active = true
    setSummaryLoading(true)
    setSummaryError(null)
    setSummary(null)
    // Realized sales are filtered by sell date, so the summary needs the same
    // window as the charts. Open holdings on this payload stay since-purchase.
    const params = new URLSearchParams({ period: dashboardPeriod })
    addCustomRangeParams(params, dashboardPeriod, customStart, customEnd)
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    pf(`/api/total-return/summary?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!active) return
        if (d.error) throw new Error(d.error)
        setSummary(d)
      })
      .catch(e => { if (active) setSummaryError(e.message) })
      .finally(() => { if (active) setSummaryLoading(false) })
    // A superseded range must not paint over the current one. Requests for a
    // wide window outlive the narrow one typed after it and would land last.
    return () => { active = false }
    // `pf` carries the profile/basis query string. It can change without
    // `selection` changing — a legacy 'aggregate' value resolving once the
    // aggregate list loads, or a deleted aggregate falling back to profile 1 —
    // and without it here the page keeps rendering the previous account's data.
  }, [categories, subcategories, selection, basisMode, dashboardPeriod, customStart, customEnd, rangeError, pf])

  // Fetch yfinance charts, or Holdings cost-basis G/L when Life is selected.
  useEffect(() => {
    if (rangeError) {
      setChartData(null)
      setChartLoading(false)
      setChartError(null)
      return undefined
    }
    let active = true
    setChartLoading(true)
    setChartError(null)
    setChartData(null)
    if (isLifetimePerformancePeriod(dashboardPeriod)) {
      fetchHoldingsJson(pf, { categories, subcategories })
        .then(rows => { if (active) setChartData(lifetimeTotalReturnPayload(rows)) })
        .catch(e => { if (active) setChartError(e.message) })
        .finally(() => { if (active) setChartLoading(false) })
      return () => { active = false }
    }
    const params = trackerChartsSearchParams({
      period: dashboardPeriod,
      start: customStart,
      end: customEnd,
      categories,
      subcategories,
    })
    loadTrackerCharts(pf, profileQueryString, params)
      .then(d => { if (active) setChartData(d) })
      .catch(e => { if (active) setChartError(e.message) })
      .finally(() => { if (active) setChartLoading(false) })
    return () => { active = false }
  }, [categories, subcategories, dashboardPeriod, customStart, customEnd, selection, rangeError, pf, profileQueryString])

  // Render Plotly charts with consistent colors across bar + line charts
  useEffect(() => {
    if (!chartData || !window.Plotly) return
    const Plotly = window.Plotly
    const cfg = { responsive: true }
    const ids = []
    const chartRange = formatPerformanceChartRange(
      chartData.requested_start_date,
      chartData.requested_end_date,
      chartData.actual_start_date,
      chartData.actual_end_date,
    )

    // Build a ticker -> color map from the bar chart tickers (sorted by return)
    const colorMap = {}
    const barData = chartData.bar?.data?.[0]
    if (barData?.y) {
      barData.y.forEach((ticker, i) => {
        colorMap[ticker] = PALETTE[i % PALETTE.length]
      })
    }

    // --- Bar chart: color each bar + ticker label to match its line ---
    const barEl = document.getElementById('tr-chart-bar')
    if (barEl && isLifetimePerformancePeriod(dashboardPeriod) && chartData.performance_rows?.length) {
      ids.push('tr-chart-bar')
      const rows = [...chartData.performance_rows]
        .filter(row => row.price_return_pct != null)
        .sort((a, b) => a.price_return_pct - b.price_return_pct)
      const values = rows.map(row => Number(Number(row.price_return_pct).toFixed(2)))
      Plotly.newPlot(barEl, [{
        type: 'bar',
        orientation: 'h',
        x: values,
        y: rows.map(row => row.ticker),
        marker: { color: values.map(value => value >= 0 ? '#4dff91' : '#ff6b6b') },
        text: values.map(value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`),
        textposition: 'outside',
        hovertemplate: '<b>%{y}</b><br>Cost-basis G/L: %{x:+.2f}%<extra></extra>',
      }], themedPlotlyLayout({
        title: 'Holding Cost-Basis G/L % — Lifetime (matches Holdings)',
        xaxis: { title: 'G/L %' },
        yaxis: { automargin: true },
        height: Math.max(420, rows.length * 18),
        margin: { l: 70, r: 90, t: 60, b: 50 },
        paper_bgcolor: '#1a1f2e',
        plot_bgcolor: 'rgba(255,255,255,0.03)',
      }, isDark), cfg)
    } else if (barEl && chartData.bar) {
      ids.push('tr-chart-bar')
      const bar = JSON.parse(JSON.stringify(chartData.bar))
      if (bar.data?.[0]?.y) {
        const tickers = bar.data[0].y
        bar.data[0].marker = {
          ...bar.data[0].marker,
          color: tickers.map(t => colorMap[t] || '#888'),
        }
        // Hide default y-axis labels, replace with colored annotations
        bar.layout.yaxis = {
          ...bar.layout.yaxis,
          showticklabels: false,
        }
        bar.layout.annotations = (bar.layout.annotations || []).concat(
          tickers.map((t, i) => ({
            x: 0, y: t,
            xref: 'paper', yref: 'y',
            xanchor: 'right', yanchor: 'middle',
            text: `<b>${t}</b>`,
            font: { color: colorMap[t] || '#888', size: 11 },
            showarrow: false,
            xshift: -8,
          }))
        )
        // Add left margin for the colored labels
        bar.layout.margin = { ...bar.layout.margin, l: 75 }
      }
      const existingTitle = typeof bar.layout?.title === 'string'
        ? bar.layout.title
        : bar.layout?.title?.text
      bar.layout.title = {
        ...(typeof bar.layout?.title === 'object' ? bar.layout.title : {}),
        text: `${existingTitle || 'Holding Total Return %'}${chartRange ? `<br><sup>${chartRange}</sup>` : ''}`,
      }
      bar.layout.margin = {
        ...bar.layout.margin,
        t: Math.max(Number(bar.layout.margin?.t) || 0, 80),
      }
      Plotly.newPlot(barEl, bar.data, themedPlotlyLayout(bar.layout, isDark), cfg)
    }

    return () => {
      ids.forEach(id => {
        const el = document.getElementById(id)
        if (el) Plotly.purge(el)
      })
    }
  }, [chartData, isDark, dashboardPeriod])

  // Render scatter chart
  useEffect(() => {
    if (!dashboardRows.length || !window.Plotly) return
    const Plotly = window.Plotly
    const el = document.getElementById('tr-chart-scatter')
    if (!el) return

    const rows = dashboardRows
      .map(r => ({
        ...r,
        category_name: r.category_name || 'Other',
        yield_on_cost_pct: roundForDisplay(Number(r.annual_yield_on_cost || 0) * 100),
        purchase_value_num: Number(r.end_value || 0),
        total_return_pct_num: roundForDisplay(r.total_return_pct || 0),
        total_return_dollar_num: Number(r.total_return_dollar || 0),
      }))
      .filter(r => r.ticker)
    const chartRange = formatPerformanceChartRange(
      chartData?.requested_start_date,
      chartData?.requested_end_date,
      chartData?.actual_start_date,
      chartData?.actual_end_date,
    )

    const maxPurchaseValue = Math.max(...rows.map(r => r.purchase_value_num), 0)
    const yKey = scatterReturnMode === 'dollar' ? 'total_return_dollar_num' : 'total_return_pct_num'
    const categories = [...new Set(rows.map(r => r.category_name))]
    const traces = categories.map((category, i) => {
      const group = rows.filter(r => r.category_name === category)
      return {
        x: group.map(r => r.yield_on_cost_pct),
        y: group.map(r => r[yKey]),
        customdata: group.map(r => [r.total_return_pct_num, r.total_return_dollar_num]),
        mode: 'markers+text',
        name: category,
        text: group.map(r => r.ticker),
        textposition: 'top center',
        textfont: { size: 9 },
        marker: {
          size: group.map(r => maxPurchaseValue > 0 ? Math.min(Math.max((r.purchase_value_num / maxPurchaseValue * 35) + 8, 8), 43) : 12),
          opacity: 0.8,
          color: PALETTE[i % PALETTE.length],
        },
        hovertemplate: scatterReturnMode === 'dollar'
          ? '<b>%{text}</b><br>Total Ret: $%{y:,.2f}<br>Total Ret %: %{customdata[0]:+.2f}%<br>Yield on Cost: %{x:.2f}%<extra>' + category + '</extra>'
          : '<b>%{text}</b><br>Total Ret: %{y:+.2f}%<br>Total Ret $: $%{customdata[1]:,.2f}<br>Yield on Cost: %{x:.2f}%<extra>' + category + '</extra>',
      }
    })

    const fig = {
      data: traces,
      layout: {
        title: {
          text: `${scatterReturnMode === 'dollar' ? `Total Return (${getCurrencyLabel()})` : 'Total Return %'} vs Annual Yield on Cost — ${chartData?.period_label || 'Selected Period'}${chartRange ? `<br><sup>${chartRange}</sup>` : ''}`,
          font: { color: '#e0e8f0' },
        },
        template: 'plotly_dark',
        height: 520,
        xaxis: {
          title: { text: 'Annual Yield on Cost (%)', font: { color: '#d0dde8' } },
          tickfont: { color: '#c0cdd8', size: 12 },
          gridcolor: 'rgba(255,255,255,0.08)',
        },
        yaxis: {
          title: {
            text: scatterReturnMode === 'dollar' ? `Total Return (${getCurrencyLabel()})` : 'Total Return (%)',
            font: { color: '#d0dde8' },
          },
          tickfont: { color: '#c0cdd8', size: 12 },
          gridcolor: 'rgba(255,255,255,0.08)',
          tickprefix: scatterReturnMode === 'dollar' ? '$' : undefined,
          ticksuffix: scatterReturnMode === 'pct' ? '%' : undefined,
        },
        legend: { title: { text: 'Category', font: { color: '#d0dde8' } }, font: { color: '#d0dde8', size: 12 } },
        paper_bgcolor: '#1a1f2e',
        plot_bgcolor: 'rgba(255,255,255,0.03)',
        margin: { t: 80, b: 60, l: 80, r: 40 },
        shapes: [{
          type: 'line',
          xref: 'paper',
          x0: 0,
          x1: 1,
          y0: 0,
          y1: 0,
          line: { color: 'gray', width: 1, dash: 'dash' },
          opacity: 0.5,
        }],
      },
    }

    Plotly.newPlot(el, fig.data, themedPlotlyLayout(fig.layout, isDark), { responsive: true })
    return () => { if (el) Plotly.purge(el) }
  }, [dashboardRows, chartData, scatterReturnMode, isDark])

  // Fetch comparison chart data
  useEffect(() => {
    if (!cmpPortfolio && cmpTickers.length === 0 && !cmpExtra) { setCmpData(null); return undefined }
    if (isLifetimePerformancePeriod(dashboardPeriod)) {
      setCmpData(null)
      setCmpLoading(false)
      setCmpError(null)
      return undefined
    }
    if (rangeError) {
      setCmpData(null)
      setCmpLoading(false)
      setCmpError(null)
      return undefined
    }

    const canReuseDashboardPortfolio = (
      cmpPortfolio
      && cmpTickers.length === 0
      && !cmpExtra
      && categories.length === 0
      && subcategories.length === 0
    )
    if (canReuseDashboardPortfolio) {
      const portfolioSeries = chartData?.portfolio_series
      const seriesMatchesPeriod = chartData?.period_key === dashboardPeriod
      if (portfolioSeries && seriesMatchesPeriod) {
        const metrics = chartData.portfolio_metrics || {}
        setCmpError(null)
        setCmpData({
          dates: portfolioSeries.dates,
          price: { PORTFOLIO: portfolioSeries.price },
          pricediv: { PORTFOLIO: portfolioSeries.pricediv },
          total: { PORTFOLIO: portfolioSeries.total },
          tickers: ['PORTFOLIO'],
          labels: { PORTFOLIO: 'Entire Portfolio' },
          portfolio_coverage: {
            transaction_count: metrics.transaction_count || 0,
            fallback_positions: metrics.fallback_positions || 0,
            inferred_opening_positions: metrics.inferred_opening_positions || 0,
            inferred_closing_positions: metrics.inferred_closing_positions || 0,
            split_adjusted_transactions: metrics.split_adjusted_transactions || 0,
            split_adjusted_positions: metrics.split_adjusted_positions || 0,
            missing_market_symbols: metrics.missing_market_symbols || [],
            fallback_date_sources: metrics.fallback_date_sources || {},
          },
          portfolio_method: (
            'Daily time-weighted return from dated BUY/SELL quantities. '
            + 'Trades change portfolio weights without changing the return index.'
          ),
          period_label: chartData.period_label,
          requested_start_date: chartData.requested_start_date,
          requested_end_date: chartData.requested_end_date,
          actual_start_date: metrics.actual_start_date,
          actual_end_date: metrics.actual_end_date,
        })
        setCmpLoading(false)
        return
      }
      if (chartLoading || (chartData?.period_key && !seriesMatchesPeriod)) {
        setCmpLoading(true)
        setCmpError(null)
        setCmpData(null)
        return
      }
    }

    let active = true
    setCmpLoading(true)
    setCmpError(null)
    const params = new URLSearchParams({ period: dashboardPeriod })
    addCustomRangeParams(params, dashboardPeriod, customStart, customEnd)
    if (cmpPortfolio) params.set('portfolio', '1')
    if (cmpTickers.length) params.set('tickers', cmpTickers.join(','))
    if (cmpExtra) params.set('extra', cmpExtra)
    pf(`/api/total-return/compare?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!active) return
        if (d.error) throw new Error(d.error)
        setCmpData(d)
      })
      .catch(e => { if (active) setCmpError(e.message) })
      .finally(() => { if (active) setCmpLoading(false) })
    return () => { active = false }
  }, [
    cmpPortfolio,
    cmpTickers,
    cmpExtra,
    dashboardPeriod,
    customStart,
    customEnd,
    rangeError,
    selection,
    categories,
    subcategories,
    chartData,
    chartLoading,
    pf,
  ])

  // Render comparison chart
  useEffect(() => {
    if (!cmpData || !window.Plotly) return
    const Plotly = window.Plotly
    const el = document.getElementById('tr-chart-compare')
    if (!el) return

    const traceKeys = cmpMode === 'both' ? ['total', 'price'] : [cmpMode]
    const traces = cmpData.tickers.flatMap((ticker, tickerIndex) => {
      const label = cmpData.labels?.[ticker] || ticker
      const isPortfolio = ticker === 'PORTFOLIO'
      const color = isPortfolio ? '#FFD700' : PALETTE[tickerIndex % PALETTE.length]
      return traceKeys.flatMap(key => {
        const values = cmpData[key]?.[ticker]
        if (!values) return []
        const displayValues = values.map(roundForDisplay)
        const style = COMPARISON_TRACE_STYLES[key] || COMPARISON_TRACE_STYLES.total
        const name = traceKeys.length > 1 ? `${label} (${style.label})` : label
        return [{
          x: cmpData.dates,
          y: displayValues,
          customdata: displayValues.map(value => value == null ? null : roundForDisplay(value - 100)),
          name,
          mode: 'lines',
          line: {
            width: style.width + (isPortfolio ? 0.8 : 0),
            color,
            dash: style.dash,
          },
          hovertemplate: `<b>${name}</b><br>%{x}<br>Index: %{y:.2f}<br>Return: %{customdata:+.2f}%<extra></extra>`,
        }]
      })
    })

    // Add 100 baseline
    traces.push({
      x: [cmpData.dates[0], cmpData.dates[cmpData.dates.length - 1]],
      y: [100, 100],
      name: 'Baseline (100)',
      mode: 'lines',
      line: { width: 1, color: '#555', dash: 'dash' },
      showlegend: false,
      hoverinfo: 'skip',
    })

    const comparisonRange = formatPerformanceChartRange(
      cmpData.requested_start_date,
      cmpData.requested_end_date,
      cmpData.actual_start_date,
      cmpData.actual_end_date,
    )
    const modeLabel = cmpMode === 'both'
      ? 'Total Return & Price Only'
      : (COMPARISON_RETURN_MODES.find(mode => mode.key === cmpMode)?.label || 'Return')
    const layout = {
      title: {
        text: `${modeLabel} Comparison — ${cmpData.period_label} (normalized to 100)${comparisonRange ? `<br><sup>${comparisonRange}</sup>` : ''}`,
        font: { color: '#e0e8f0' },
      },
      template: 'plotly_dark',
      paper_bgcolor: '#1a1f2e',
      plot_bgcolor: 'rgba(255,255,255,0.03)',
      xaxis: { title: { text: 'Date', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8', size: 12 }, gridcolor: 'rgba(255,255,255,0.08)' },
      yaxis: { title: { text: 'Normalized (100 = start)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8', size: 12 }, gridcolor: 'rgba(255,255,255,0.08)' },
      height: 550,
      legend: { orientation: 'h', y: -0.15, font: { color: '#d0dde8', size: 12 } },
      hovermode: 'x unified',
      margin: { t: 75, b: 80, l: 60, r: 20 },
    }

    Plotly.newPlot(el, traces, themedPlotlyLayout(layout, isDark), { responsive: true })
    return () => Plotly.purge(el)
  }, [cmpData, cmpMode, isDark])

  const handleCmpExtraSubmit = (e) => {
    e.preventDefault()
    const newTickers = cmpExtraInput.trim().toUpperCase().split(/[\s,]+/).filter(Boolean)
    if (!newTickers.length) return
    setCmpExtra(prev => {
      const existing = prev ? prev.split(',') : []
      const merged = [...new Set([...existing, ...newTickers])]
      return merged.join(',')
    })
    setCmpExtraInput('')
  }

  const enrichedRows = useMemo(() => {
    if (!dashboardRows.length) return []
    return dashboardRows.map(r => {
      // No silent fallback to yield-on-cost when current yield is zero: the
      // badge says which basis is in use, and Gains & Losses reads the selected
      // one straight, so falling back here made the same holding show two
      // different verdicts across the two pages.
      const annualYld = (rvyMode === 'yoc' ? (r.annual_yield_on_cost || 0) : (r.current_annual_yield || 0)) * 100
      // Total Ret % covers the selected window, so the yield it is measured
      // against has to cover that same window. Each row carries its own
      // effective held-period range; fall back to the portfolio's range when a
      // row has none, and withhold the verdict when neither is known.
      const windowYld = (
        prorateAnnualYield(annualYld, r.actual_start_date, r.actual_end_date)
        ?? prorateAnnualYield(annualYld, chartData?.actual_start_date, chartData?.actual_end_date)
      )
      const rvy = r.total_return_pct != null && windowYld != null
        ? returnVsYield(r.total_return_pct, windowYld)
        : null
      return {
        ...r,
        rvy_annual_yield_pct: annualYld,
        ret_vs_yld: rvy,
        ret_vs_yld_sort: rvy ? rvy.spread : -999,
      }
    })
  }, [dashboardRows, rvyMode, chartData])

  const realizedRows = useMemo(() => summary?.realized || [], [summary])
  const realizedTotals = summary?.realized_totals || {}

  // One row per ticker. Open legs carry the period's market performance and
  // closed legs carry the recorded sale, so they are summed in dollars only \u2014
  // the two percentages have different bases and cannot be added.
  const combinedRows = useMemo(() => {
    const byTicker = new Map()
    const entryFor = (row) => {
      const key = String(row.ticker || '').toUpperCase()
      let entry = byTicker.get(key)
      if (!entry) {
        entry = {
          ticker: row.ticker,
          category_name: row.category_name || '',
          net_basis: 0,
          unrealized_total_dollar: 0,
          realized_total_dollar: 0,
          open_distribution_dollar: 0,
          realized_distribution_dollar: 0,
          net_distribution_dollar: 0,
          isOpen: false,
          isClosed: false,
        }
        byTicker.set(key, entry)
      }
      if (!entry.category_name) entry.category_name = row.category_name || ''
      return entry
    }
    enrichedRows.forEach(row => {
      const entry = entryFor(row)
      entry.isOpen = true
      entry.net_basis += row.start_value || 0
      entry.unrealized_total_dollar += row.total_return_dollar || 0
      entry.open_distribution_dollar += row.distribution_dollar || 0
    })
    realizedRows.forEach(row => {
      const entry = entryFor(row)
      entry.isClosed = true
      entry.net_basis += row.start_value || 0
      entry.realized_total_dollar += row.total_return_dollar || 0
      entry.realized_distribution_dollar += row.distribution_dollar || 0
    })
    return [...byTicker.values()].map(entry => {
      const net = entry.unrealized_total_dollar + entry.realized_total_dollar
      // Adding both legs counted the same cash twice. An open row already
      // carries every distribution the ticker paid inside the range, including
      // the ones earned by shares sold during it; the realized leg is that same
      // money apportioned to the lots it left with. Take the open figure when
      // there is one, and the realized figure only for a ticker with no shares
      // left. Either way the range's cash is counted exactly once.
      return {
        ...entry,
        net_distribution_dollar: entry.isOpen
          ? entry.open_distribution_dollar
          : entry.realized_distribution_dollar,
        status: entry.isOpen && entry.isClosed ? 'Open + Closed' : entry.isOpen ? 'Open' : 'Closed',
        net_total_dollar: net,
        // Withheld rather than printed when the basis is missing — see the
        // matching guard in the realized endpoint.
        net_total_pct: entry.net_basis >= MIN_BASIS ? (net / entry.net_basis) * 100 : null,
      }
    })
  }, [enrichedRows, realizedRows])

  const unrealizedColumns = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'category_name', label: 'Category' },
    { key: 'price_paid', label: 'Cost/Share', title: 'Average purchase price of the shares you still hold — the same figure Schwab labels Cost/Share. Not the market price at the start of the range.', fmt, numeric: true },
    { key: 'start_price', label: 'Price at Start', title: 'Market close on the first day of this holding\'s effective range (for YTD, the last session on or before Jan 1). This is not cost basis.', fmt, numeric: true },
    { key: 'end_price', label: 'Current Price', title: 'Market price on the last day of this holding\'s effective range. A range that ends today uses a live quote when available.', fmt, numeric: true },
    { key: 'start_value', label: 'Start Value', fmt, numeric: true },
    { key: 'end_value', label: 'End Value', fmt, numeric: true },
    { key: 'price_return_dollar', label: 'Period Price Return', title: 'This ticker\'s current open lot during the selected range. This contributes to the Open Lots Price Return card, not the Tracker Price Return card. Not cost-basis G/L.', fmt, numeric: true, gl: true },
    { key: 'price_return_pct', label: 'Period Price Ret %', title: 'This ticker\'s current open lot during the selected range. The Open Position Total and Open Lots Price Return card exclude fully closed positions.', fmt: fmtPct, numeric: true, gl: true },
    { key: 'distribution_dollar', label: 'Distributions', title: 'Cash this ticker paid inside the selected range — not since purchase. Estimated payments the refresh job wrote ahead of the real one are excluded. Click a figure to see every payment behind it.', fmt, numeric: true },
    { key: 'total_return_dollar', label: 'Period Total Return', fmt, numeric: true, gl: true },
    { key: 'total_return_pct', label: 'Period Total Ret %', fmt: fmtPct, numeric: true, gl: true },
    { key: 'period_range', label: 'Effective Range' },
    { key: 'ret_vs_yld', label: 'RvY', sortKey: 'ret_vs_yld_sort' },
  ]
  const realizedColumns = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'category_name', label: 'Category' },
    { key: 'sell_date', label: 'Sell Date' },
    { key: 'shares_sold', label: 'Shares', fmt: v => v != null ? Number(v).toFixed(3) : '\u2014', numeric: true },
    { key: 'start_value', label: 'Cost Basis', fmt, numeric: true },
    { key: 'end_value', label: 'Proceeds', fmt, numeric: true },
    { key: 'price_return_dollar', label: 'Price Return', fmt, numeric: true, gl: true },
    { key: 'price_return_pct', label: 'Price Ret %', fmt: fmtPct, numeric: true, gl: true },
    { key: 'distribution_dollar', label: 'Distributions', title: 'Cash the sold shares earned inside the selected range only. It is not their lifetime income — a position sold this year keeps its earlier dividends in the years they were paid. Click a figure to see every payment behind it.', fmt, numeric: true },
    { key: 'total_return_dollar', label: 'Total Return', fmt, numeric: true, gl: true },
    { key: 'total_return_pct', label: 'Total Ret %', fmt: fmtPct, numeric: true, gl: true },
  ]
  const combinedColumns = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'category_name', label: 'Category' },
    { key: 'status', label: 'Status' },
    { key: 'net_basis', label: 'Basis', fmt, numeric: true },
    { key: 'unrealized_total_dollar', label: 'Unreal. Total Return', fmt, numeric: true, gl: true },
    { key: 'realized_total_dollar', label: 'Real. Total Return', fmt, numeric: true, gl: true },
    { key: 'net_distribution_dollar', label: 'Distributions', title: 'Cash the ticker paid inside the selected range, counted once. A ticker both held and partly sold in the range is not the open figure plus the closed one — that would count the same payment twice. Click a figure to see every payment behind it.', fmt, numeric: true },
    { key: 'net_total_dollar', label: 'Net Total Return', fmt, numeric: true, gl: true },
    { key: 'net_total_pct', label: 'Net Ret %', fmt: fmtPct, numeric: true, gl: true },
  ]

  const viewConfig = {
    unrealized: { columns: unrealizedColumns, rows: enrichedRows, defaultSort: 'total_return_pct' },
    realized: { columns: realizedColumns, rows: realizedRows, defaultSort: 'sell_date' },
    combined: { columns: combinedColumns, rows: combinedRows, defaultSort: 'net_total_dollar' },
  }
  const columns = viewConfig[positionView].columns
  const viewRows = viewConfig[positionView].rows
  const numericSortKeys = new Set(
    columns.filter(col => col.numeric).map(col => col.sortKey || col.key),
  )
  numericSortKeys.add('ret_vs_yld_sort')
  const columnAlign = (col) => col.numeric ? 'right' : 'left'

  // Table sorting
  const handleSort = (col) => {
    if (sortCol === col) { setSortAsc(a => !a) }
    else {
      setSortCol(col)
      setSortAsc(!numericSortKeys.has(col) && col !== 'sell_date')
    }
  }

  const switchPositionView = (key) => {
    if (key === positionView) return
    setPositionView(key)
    setSortCol(viewConfig[key].defaultSort)
    setSortAsc(false)
  }

  const sortedRows = useMemo(() => {
    if (!viewRows.length) return []
    if (!sortCol) return viewRows
    const rows = [...viewRows]
    rows.sort((a, b) => {
      let av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      av = String(av).toLowerCase(); bv = String(bv).toLowerCase()
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return rows
  }, [viewRows, sortCol, sortAsc])

  const sortIcon = (col) => {
    if (sortCol !== col) return ' \u21C5'
    return sortAsc ? ' \u25B2' : ' \u25BC'
  }

  // Spells out both sides of the comparison, so the window-scaled yield is not
  // mistaken for the annual one shown elsewhere on the row.
  const rvyTitle = (row) => {
    const rvy = row.ret_vs_yld
    if (!rvy) return 'No comparable return for this range'
    const annual = row.rvy_annual_yield_pct
    const annualNote = annual != null ? ` (${Number(annual).toFixed(2)}% annual)` : ''
    return (
      `Total return ${rvy.totalReturnPct.toFixed(2)}%`
      + ` vs ${rvy.yieldOnCost.toFixed(2)}% yield over this range${annualNote}`
      + ` · spread ${rvy.spread >= 0 ? '+' : ''}${rvy.spread.toFixed(2)}%`
    )
  }

  const missingBasis = (row) => (
    positionView === 'realized'
      ? !!row.basis_missing
      : positionView === 'combined' && (row.net_basis || 0) < MIN_BASIS
  )

  // Start Value is replayed from the open lot, which can invent shares either
  // because the export never contained the opening purchase or because a prior
  // cycle was clipped away. Flag only the first: recording an opening lot
  // fixes a true ledger shortfall, and would double-count a clip-only gap.
  const inferredLot = (row) => (
    positionView === 'unrealized'
      ? (row.inferred_opening_detail || []).find(lot => Number(lot?.shares || 0) > 0) || null
      : null
  )

  const inferredLotNote = (lot, ticker) => {
    const shares = Number(lot.shares || 0)
    const sharesText = shares.toLocaleString(undefined, { maximumFractionDigits: 4 })
    const ledger = Number(lot.ledger_net_shares || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })
    const saved = Number(lot.snapshot_quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })
    const inferredValue = lot.start_value_overstatement
    // The share gap alone does not show how much of the displayed opening value
    // depends on the inference. It is not necessarily an overstatement: a
    // truncated export really can be missing the original purchase.
    const byHowMuch = inferredValue == null
      ? ''
      : ` About ${fmt(inferredValue)} of Start Value comes from this inferred lot`
        + (lot.opening_price ? ` (${sharesText} × ${fmt(lot.opening_price)})` : '')
        + '.'
    return (
      `Start Value includes ${sharesText} shares no transaction accounts for.`
      + byHowMuch
      + ` ${ticker}'s buys and sells net to ${ledger} shares, but the saved holding is ${saved},`
      + ` so the ${sharesText}-share difference was added back as an opening lot dated`
      + ` ${formatPerformanceDate(lot.seed_date) || lot.seed_date} — before this range starts.`
      + ' That is correct if your transaction history begins after you first bought'
      + ` ${ticker}. If the history is complete, the ledger is wrong instead: usually a sale`
      + ' recorded twice or a missing purchase.'
      + ` Click to open ${ticker}'s transactions and correct it.`
    )
  }

  const lifetimeView = isLifetimePerformancePeriod(dashboardPeriod)
  const lifetimeReady = lifetimeView && !!chartData && !chartLoading
  const trackerReady = !!summary && !!chartData && !summaryLoading && !chartLoading

  useEffect(() => {
    if (lifetimeView && positionView !== 'unrealized') setPositionView('unrealized')
  }, [lifetimeView, positionView])

  const allTickers = useMemo(() => (
    [...new Set((
      lifetimeView
        ? (chartData?.performance_rows || [])
        : (summary?.rows || [])
    )
      .map(row => String(row.ticker || '').trim().toUpperCase())
      .filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, undefined, {
        sensitivity: 'base',
        numeric: true,
      }))
  ), [summary, chartData, lifetimeView])

  const t = chartData?.portfolio_metrics || {}
  const openPositionTotals = chartData?.open_position_metrics || t

  // The cards include every position held during the selected period, including
  // positions that were fully closed. The Holdings footer must instead use the
  // open-position replay behind its visible rows; otherwise closed history is
  // silently added to a table that says "Open positions only."
  const combinedTotals = (() => {
    const basis = (openPositionTotals.start_value || 0) + (realizedTotals.start_value || 0)
    const net = (openPositionTotals.total_return_dollar || 0) + (realizedTotals.total_return_dollar || 0)
    return {
      net_basis: basis,
      unrealized_total_dollar: openPositionTotals.total_return_dollar || 0,
      realized_total_dollar: realizedTotals.total_return_dollar || 0,
      // Summed from the rows for the same reason the rows no longer add both
      // legs: a ticker held and partly sold in the range would be counted twice.
      net_distribution_dollar: combinedRows.reduce(
        (sum, row) => sum + (row.net_distribution_dollar || 0), 0,
      ),
      net_total_dollar: net,
      net_total_pct: basis >= MIN_BASIS ? (net / basis) * 100 : null,
    }
  })()

  // The footer replays the same positions the rows do, so it carries the same
  // invented shares and has to admit to them in the same place.
  const footerInferredLots = (openPositionTotals.inferred_opening_detail || [])
    .filter(lot => Number(lot?.shares || 0) > 0)
  const footerInferredShares = footerInferredLots
    .reduce((sum, lot) => sum + Number(lot.shares || 0), 0)
  const footerInferredValue = footerInferredLots
    .reduce((sum, lot) => sum + Number(lot.start_value_overstatement || 0), 0)
  const footerInferredTickers = [...new Set(footerInferredLots.map(lot => lot.ticker))]

  // When positions drop out of the replay for want of price history, the cards
  // keep their normal shape and quietly describe a smaller portfolio than the
  // one being asked about. Carry the weight of what was dropped so the strip
  // can stop presenting a partial reading as this account's return.
  const coverageIsPartial = isCoverageMaterial(t)
  const coverageIsSevere = isCoverageSevere(t)
  const coverageWarning = formatCoverageShortfall(t)
  const coveragePartialTag = formatCoveragePartialTag(t)
  // Past the severe mark the figure is no longer a version of the answer, so it
  // steps out of the headline slot and the card says what it actually is.
  const partialValue = (rendered) => (coverageIsSevere ? 'Partial' : rendered)
  const partialNote = coverageIsPartial
    ? <div className="summary-sub" style={{ color: 'var(--warn, #ffb86c)' }}>{coveragePartialTag}</div>
    : null

  const dashboardRequestedRange = formatComparisonRange(chartData?.requested_start_date, chartData?.requested_end_date)
  const dashboardActualRange = formatComparisonRange(chartData?.actual_start_date, chartData?.actual_end_date)
  const dashboardCardRange = dashboardActualRange || dashboardRequestedRange
  const startValueAsOf = formatPerformanceAsOf(chartData?.actual_start_date) || dashboardCardRange
  // "As of <today> close" is a lie while the session is still running: the last
  // point of the Yahoo series is the live price, re-read on every request. That
  // is the whole reason End Value here and Current Value on Gains & Losses
  // disagree intraday, so name the clock — but keep the date, which is the range
  // the card is reporting and is not what changed.
  const endsToday = chartData?.actual_end_date === todayInputValue()
  const endValueAsOf = formatPerformanceAsOf(
    chartData?.actual_end_date,
    t.priced_at,
  ) || dashboardCardRange
  const spyRange = formatComparisonRange(chartData?.spy_actual_start_date, chartData?.spy_actual_end_date)
  const cmpRequestedRange = formatComparisonRange(cmpData?.requested_start_date, cmpData?.requested_end_date)
  const cmpActualRange = formatComparisonRange(cmpData?.actual_start_date, cmpData?.actual_end_date)

  return (
    <div className="page dashboard tr-page">
      <h1 style={{ marginBottom: '0.5rem' }}>Total Return Dashboard</h1>

      {/* Page-wide filters */}
      <div className="growth-filters" style={{ marginBottom: '1rem' }}>
        {(summary?.categories?.length > 0) && (
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
            <label>Categories</label>
            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
              onClick={() => setCatOpen(o => !o)}>
              {categories.length === 0 && subcategories.length === 0
                ? 'All Holdings'
                : `${categories.length + subcategories.length} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {catOpen && (
              <div className="growth-cat-dropdown">
                <label className="growth-cat-option" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                  <input type="checkbox" checked={categories.length === 0 && subcategories.length === 0}
                    onChange={() => { setCategories([]); setSubcategories([]) }} />
                  <span>All Holdings</span>
                </label>
                {summary.categories.map(c => {
                  const catChecked = categories.includes(String(c.id))
                  const subs = c.subcategories || []
                  return (
                    <React.Fragment key={c.id}>
                      <label className="growth-cat-option">
                        <input type="checkbox" checked={catChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              // Selecting the whole category supersedes any of its
                              // sub-category selections, so clear those.
                              const subIds = subs.map(s => String(s.id))
                              setCategories(prev => [...prev, String(c.id)])
                              setSubcategories(prev => prev.filter(id => !subIds.includes(id)))
                            } else {
                              setCategories(prev => prev.filter(id => id !== String(c.id)))
                            }
                          }} />
                        <span>{c.name}</span>
                      </label>
                      {subs.map(s => (
                        <label key={`sub-${s.id}`} className="growth-cat-option"
                          style={{ paddingLeft: '1.4rem', opacity: catChecked ? 0.5 : 1 }}>
                          <input type="checkbox" disabled={catChecked}
                            checked={catChecked || subcategories.includes(String(s.id))}
                            onChange={e => {
                              if (e.target.checked) setSubcategories(prev => [...prev, String(s.id)])
                              else setSubcategories(prev => prev.filter(id => id !== String(s.id)))
                            }} />
                          <span>{s.name}</span>
                        </label>
                      ))}
                    </React.Fragment>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="growth-filter-group">
          <label>Shared Performance Date Range</label>
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {PERFORMANCE_PERIODS.map(periodOption => (
              <button
                type="button"
                key={periodOption.key}
                className={`tr-pbtn${dashboardPeriod === periodOption.key ? ' tr-pbtn-active' : ''}`}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                title={periodOption.hint}
                onClick={() => setDashboardPeriod(periodOption.key)}
              >
                {periodOption.label}
              </button>
            ))}
          </div>
          <p className="tr-note perf-range-note">{PERFORMANCE_RANGE_NOTE}</p>
          {isLifetimePerformancePeriod(dashboardPeriod) && (
            <div className="alert alert-info" style={{ marginTop: '0.65rem' }}>
              <strong>Matches Holdings:</strong> {HOLDINGS_LIFETIME_MATCH_NOTE}
            </div>
          )}
        </div>

        {dashboardPeriod === 'custom' && (
          <div className="g2-custom-range" role="group" aria-label="Custom dashboard date range">
            <label>
              <span>Start date</span>
              <input
                type="date"
                value={customStart}
                min={MIN_PERFORMANCE_DATE}
                max={customEnd || todayInputValue()}
                onChange={e => setCustomStart(e.target.value)}
              />
            </label>
            <label>
              <span>End date</span>
              <input
                type="date"
                value={customEnd}
                min={customStart || MIN_PERFORMANCE_DATE}
                max={todayInputValue()}
                onChange={e => setCustomEnd(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <details className="tracker-help">
        <summary>What do these cards mean?</summary>
        <p className="tracker-help-footer">
          Every card in the summary strip moves together with the Shared Performance Date Range above —
          unlike Gains &amp; Losses, nothing here is a lifetime figure. All of it comes from one replay of
          your dated buy and sell history, priced at each day&apos;s market observation: a live quote
          when available today, otherwise that day&apos;s close.
        </p>
        <div className="tracker-help-grid">
          <section>
            <h3>Value and return cards</h3>
            <ul>
              <li><strong>Start Value / End Value:</strong> the portfolio&apos;s holdings, priced at the market observation on the first and last day of the range. A current-day end value uses a live quote when available; neither includes cash.</li>
              <li><strong>Account Value:</strong> End Value plus your recorded cash and any open option contracts — the figure that lines up with a broker's net liquidating value. Shown only when there is cash or an open option to add.</li>
              <li><strong>Tracker Price Return:</strong> the dollar change from market price alone over the range for the full portfolio history, including positions fully closed during the range.</li>
              <li><strong>Open Lots Price Return:</strong> the same selected-period price calculation restricted to positions still held now. Fully closed positions are excluded. Choose <strong>Life</strong> instead when comparing current value with the cost basis of shares still held.</li>
              <li><strong>Distributions:</strong> dividends and other distributions actually paid during the range, from broker payment history where available.</li>
              <li><strong>SPY:</strong> the S&amp;P 500's own return over this portfolio's actual market-observation dates, for comparison.</li>
            </ul>
          </section>
          {/* Full width: this is the one distinction worth getting right, and
              splitting it across two half-width boxes would just re-fragment it. */}
          <section className="tracker-help-wide">
            <h3>Dollar Total Return vs. Tracker Total Return %</h3>
            <p>
              These are not the same number expressed two ways — they answer different questions, and
              Total Return ÷ Start Value will not equal Tracker Total Return % whenever you bought or
              sold during the range.
            </p>
            <ul>
              <li>
                <strong>Tracker Total Return ($):</strong> Tracker Price Return plus Distributions — the actual dollars
                your positions gained, including positions fully closed during the range, given the shares you actually held on each day. Buying more
                shares partway through the range means more dollars are exposed to whatever the price
                does afterward, so this is a <em>cash-flow-sensitive dollar result</em>: it reflects how
                much capital was invested and when, not just how the price moved.
              </li>
              <li>
                <strong>Tracker Total Return %:</strong> a daily-compounded, dividend-reinvested index —
                the same one drawn on the chart in Growth's Vs market tab. Each trade re-bases the index
                to the value just before the trade, so a purchase or sale never creates a jump in the
                return itself. This is <em>time-weighted</em>: it measures how the investment performed,
                independent of when money moved in or out.
              </li>
            </ul>
            <p className="tracker-help-note">
              Use Tracker Total Return % to judge performance or compare against a benchmark like SPY —
              it is the figure that should match Dashboard, Growth, and Gains &amp; Losses
              after the close when the account, date range, and holdings scope match.
              Each screen reads live quotes separately, so values can differ intraday. Use Total
              Return ($) to see the actual dollar result of your specific buy and sell timing, which a
              pure percentage cannot show.
            </p>
          </section>
          <section className="tracker-help-wide">
            <h3>Orange Start Value warning and opening-lot repair</h3>
            <p>
              An orange Start Value means the saved holding has more shares than its complete BUY and
              SELL ledger accounts for. To keep the performance history usable, the tracker temporarily
              treats the difference as shares owned before the first recorded transaction. Split history
              is reconciled first so a broker ledger that is already in today&apos;s share units is not
              split-adjusted a second time.
            </p>
            <ol>
              <li>
                <strong>Check the history first.</strong> The repair is appropriate when the export begins
                after the original purchase. If a sale is duplicated or a later purchase is missing,
                correct that transaction instead; adding an opening lot would legitimize the wrong ledger.
              </li>
              <li>
                <strong>Open the warned value.</strong> Clicking it opens that ticker&apos;s transactions on
                Holdings. If you are viewing Owner or an Aggregate, the repair button will tell you which
                underlying account to select. A transaction repair can only be written inside its actual
                account.
              </li>
              <li>
                <strong>Record and verify the lot.</strong> In the named account, <em>Record the opening
                lot</em> adds an ordinary BUY one day before the first saved transaction, using that
                day&apos;s market close as an estimate. The row can then be edited or deleted. Replace the
                estimated date and price with the broker&apos;s figures when you have them.
                After a successful repair, the confirmation shows the transaction-derived average
                cost before and after, then returns here to Total Return.
              </li>
            </ol>
            <p className="tracker-help-note">
              The repair makes the inferred shares visible and brings the transaction ledger back to the
              saved share count; that is the only result it guarantees. It does not prove that the saved
              share count, transaction history, estimated opening date or purchase price, Start Price, or
              Start Value is correct. Start Price is separate market data for the range boundary and is not
              replaced by the repair&apos;s estimated purchase price. A recent Start Value can still be exact
              without lifetime history when the current share count and every trade, transfer, and split
              from that range&apos;s start through today are complete. The repair preserves the holding&apos;s
              original and broker cost-basis fields. The displayed Start Value may stay the same because
              the performance replay was already pricing those shares; in that case the warning disappears
              because the assumption is now a recorded lot, not because shares were removed from the calculation.
            </p>
          </section>
        </div>
        <p className="tracker-help-footer">
          The Categories filter and the Shared Performance Date Range both apply to every card, chart,
          and table on this page.
        </p>
      </details>

      {/* Reported once for the whole page: every data source below stands down
          on the same condition, so per-source alerts would just repeat it. */}
      {rangeError && <div className="alert alert-error">{rangeError}</div>}

      {/* Summary cards */}
      {summaryLoading && !lifetimeView && <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></div>}
      {summaryError && <div className="alert alert-error">{summaryError}</div>}
      {(lifetimeReady || trackerReady) && (
        <>
          <p className="tr-note">
            {lifetimeView ? (
              <>
                <strong>Lifetime:</strong> cost-basis G/L matching the Holdings table
                {dashboardCardRange ? ` (${dashboardCardRange})` : ''}.
                Start Value is what you paid for shares you still hold; End Value is those shares at the current price;
                Price Return is current value minus cost basis.
              </>
            ) : (
              <>
                <strong>{chartData?.period_label || 'Selected period'}:</strong>{' '}
                {dashboardRequestedRange || dashboardActualRange}
                {dashboardRequestedRange && dashboardActualRange && dashboardRequestedRange !== dashboardActualRange
                  ? ` (portfolio observations ${dashboardActualRange})`
                  : ''}
                . Returns are cash-flow adjusted from dated transactions; purchases and sales are not counted as performance.
                {t.inferred_opening_positions > 0
                  ? ` ${t.inferred_opening_positions} pre-existing position${t.inferred_opening_positions === 1 ? ' was' : 's were'} reconciled backward from current shares because the transaction export began after the opening lot.`
                  : ''}
                {formatAccountingCoverage(t) ? ` ${formatAccountingCoverage(t)}` : ''}
                {t.distribution_source ? ` Distribution dollars use ${t.distribution_source.toLowerCase()}.` : ''}
                {' '}Because capital changes during the period, dollar return divided by start value may not equal the time-weighted return percentage.
              </>
            )}
          </p>
          {/* Above the standard note on purpose: nothing below it can be read
              correctly until the reader knows most of the account is missing. */}
          {coverageIsPartial && (
            <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
              <strong>⚠ Partial reading — this is not your account&apos;s return.</strong>
              {' '}{coverageWarning}
              {' '}The excluded tickers are named in the coverage note above. A whole-portfolio
              gap on a short range usually means the price download was throttled or came back
              incomplete rather than that those positions changed — reload the range, and if it
              persists, refresh market data before trusting any figure on this page.
            </div>
          )}
          {!lifetimeView && <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            <strong>Tracker performance standard:</strong> this page is the reference calculation for
            transaction-aware Total Return. Dashboard, Growth (its Dollars, Vs market, and Lots
            tabs), and Gains &amp; Losses use this same calculation for <strong>Tracker Total Return %</strong> when the
            account, date range, and holdings scope match. They should agree after the close; separately
            read live quotes can differ intraday. Lifetime cost-basis G/L and dollar P/L
            answer a different question: where the accounting profit or loss came from.
            {' '}The selected range is remembered across Dashboard, Growth, Total Return, Gains &amp; Losses, and Holdings.
            {t.account_reconciliation && (
              <>
                {' '}<strong>Against your broker:</strong> End Value is the charted positions alone,
                so Start Value plus Price Return and Distributions reconciles to it — a cash balance
                is not a return, and open option contracts live in their own ledger with no history
                to replay. <strong>Account Value</strong> adds both back; that is the card to compare
                with net liquidating value, which already includes your cash.
              </>
            )}
          </div>}
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            {/* Both are single market observations, so each names its own date; the range
                belongs on the cards that actually measure across one. */}
            {/* Say what these measure. Only when something is actually left out,
                so an account with no cash and no options is not told twice that
                it has neither. */}
            <MetricCard label="Start Value" value={partialValue(fmtInt(t.start_value))} range={startValueAsOf}>
              {partialNote}
              {coverageIsSevere && (
                <div className="summary-sub">Would have read {fmtInt(t.start_value)} on the positions that priced</div>
              )}
              {t.account_reconciliation && <div className="summary-sub">Holdings only — no cash</div>}
            </MetricCard>
            <MetricCard label="End Value" value={partialValue(fmtInt(t.end_value))} range={endValueAsOf}>
              {partialNote}
              {coverageIsSevere && (
                <div className="summary-sub">Would have read {fmtInt(t.end_value)} on the positions that priced</div>
              )}
              {t.account_reconciliation && (
                <div className="summary-sub">Holdings only — no cash; see Account Value</div>
              )}
              {/* Without this, the same positions showing two totals on two
                  screens reads as a bug rather than as two reading times. */}
              {endsToday && t.prices_saved_at && (
                <div className="summary-sub">
                  Moves with the market. Gains &amp; Losses shows saved prices from
                  {' '}{formatClockStamp(t.prices_saved_at)}, so it reads lower or higher until the close.
                </div>
              )}
            </MetricCard>
            {/* Its own card rather than a bigger End Value: Start Value plus the
                two return cards has to keep reconciling to End Value, and
                neither cash nor an option mark is a return. */}
            <AccountValueCard
              data={t.account_reconciliation}
              basisLabel={endValueAsOf}
              holdingsNote={endsToday
                ? 'Built on the live End Value above, and the option mark is quoted fresh, so it will not tie to Gains & Losses to the cent until the close.'
                : undefined}
            />
            {/* The tracker cards retain the full portfolio history so they keep
                matching Growth's Vs market tab. The open-lot cards surface the
                already-calculated current-position replay that was previously
                available only in the table footer. */}
            <MetricCard label={lifetimeView ? 'Life Price G/L' : 'Tracker Price Return'} range={dashboardCardRange}
              value={partialValue(
                <span style={{ color: (t.price_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtInt(t.price_return_dollar)}</span>,
              )}>
              {partialNote}
              {coverageIsSevere && (
                <div className="summary-sub">{fmtInt(t.price_return_dollar)} on the positions that priced</div>
              )}
              <div className="summary-sub">{lifetimeView ? 'Matches Holdings Life G/L — current value minus cost basis' : TRACKER_SCOPE_NOTE}</div>
            </MetricCard>
            <MetricCard label={lifetimeView ? 'Life Price G/L %' : 'Tracker Price Return %'} range={dashboardCardRange}
              value={partialValue(
                <span style={{ color: (t.price_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(t.price_return_pct)}</span>,
              )}>
              {partialNote}
              {coverageIsSevere && (
                <div className="summary-sub">{fmtPct(t.price_return_pct)} on the positions that priced</div>
              )}
              <div className="summary-sub">{lifetimeView ? 'Matches Holdings Life G/L %' : TRACKER_SCOPE_NOTE}</div>
              {!lifetimeView && <div className="summary-sub">Same number as Growth Price Return %</div>}
            </MetricCard>
            {!lifetimeView && (
              <MetricCard label="Open Lots Price Return" range={dashboardCardRange}
                value={partialValue(
                  <span style={{ color: (openPositionTotals.price_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtInt(openPositionTotals.price_return_dollar)}</span>,
                )}>
                {partialNote}
                {coverageIsSevere && (
                  <div className="summary-sub">{fmtInt(openPositionTotals.price_return_dollar)} on the positions that priced</div>
                )}
                <div className="summary-sub">Currently held positions only — fully closed positions excluded</div>
                <div className="summary-sub">Selected-period return; choose Life for cost-basis G/L</div>
              </MetricCard>
            )}
            {!lifetimeView && (
              <MetricCard label="Open Lots Price Return %" range={dashboardCardRange}
                value={partialValue(
                  <span style={{ color: (openPositionTotals.price_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(openPositionTotals.price_return_pct)}</span>,
                )}>
                {partialNote}
                {coverageIsSevere && (
                  <div className="summary-sub">{fmtPct(openPositionTotals.price_return_pct)} on the positions that priced</div>
                )}
                <div className="summary-sub">Currently held positions only — fully closed positions excluded</div>
                <div className="summary-sub">Matches the Open lots only table footer</div>
              </MetricCard>
            )}
            <MetricCard label="Distributions" value={partialValue(fmtInt(t.distribution_dollar))} range={dashboardCardRange}>
              {partialNote}
              {coverageIsSevere && (
                <div className="summary-sub">{fmtInt(t.distribution_dollar)} on the positions that priced</div>
              )}
              <div className="summary-sub">{lifetimeView ? 'Lifetime dividends included in this result' : 'Dividends paid during the range'}</div>
            </MetricCard>
            <MetricCard label={lifetimeView ? 'Life Total Return' : 'Tracker Total Return'} range={dashboardCardRange}
              value={partialValue(
                <span style={{ color: (t.total_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtInt(t.total_return_dollar)}</span>,
              )}>
              {partialNote}
              <div className="summary-sub">
                Price {fmtInt(t.price_return_dollar)} + distributions {fmtInt(t.distribution_dollar)}
                {Number(t.realized_return_dollar || 0) !== 0
                  ? ` + realized trims ${fmtInt(t.realized_return_dollar)}`
                  : ''}
              </div>
              {!lifetimeView && <div className="summary-sub">Includes positions fully closed during this range</div>}
            </MetricCard>
            <MetricCard label={lifetimeView ? 'Life Total Return %' : 'Tracker Total Return %'} range={dashboardCardRange}
              value={partialValue(
                <span style={{ color: (t.total_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(t.total_return_pct)}</span>,
              )}>
              {partialNote}
              {coverageIsSevere && (
                <div className="summary-sub">{fmtPct(t.total_return_pct)} on the positions that priced</div>
              )}
              <div className="summary-sub">{lifetimeView ? 'Cost-basis total return, not time-weighted' : 'Time-weighted — timing-neutral performance'}</div>
              <div className="summary-sub">Same calculation as Dashboard, Growth &amp; Gains/Losses{lifetimeView ? '' : '; separately read live quotes can differ until close'}</div>
            </MetricCard>
            {!lifetimeView && (
              <MetricCard label="Open Lots Total Return" range={dashboardCardRange}
                value={partialValue(
                  <span style={{ color: (openPositionTotals.total_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtInt(openPositionTotals.total_return_dollar)}</span>,
                )}>
                {partialNote}
                <div className="summary-sub">
                  Open-lot price {fmtInt(openPositionTotals.price_return_dollar)} + distributions {fmtInt(openPositionTotals.distribution_dollar)}
                </div>
                <div className="summary-sub">Matches the Open lots only table footer</div>
              </MetricCard>
            )}
            {!lifetimeView && (
              <MetricCard label="Open Lots Total Return %" range={dashboardCardRange}
                value={partialValue(
                  <span style={{ color: (openPositionTotals.total_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(openPositionTotals.total_return_pct)}</span>,
                )}>
                {partialNote}
                {coverageIsSevere && (
                  <div className="summary-sub">{fmtPct(openPositionTotals.total_return_pct)} on the positions that priced</div>
                )}
                <div className="summary-sub">Currently held positions only — fully closed positions excluded</div>
                <div className="summary-sub">Matches the Open lots only table footer</div>
              </MetricCard>
            )}
            {chartData?.spy_ret != null && (
              <MetricCard label={`SPY - ${chartData.period_label || '1Y'}`}
                range={spyRange}
                value={<span style={{ color: chartData.spy_ret >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(chartData.spy_ret)}</span>}>
                <div className="summary-sub">Benchmark, compare against Tracker TR %</div>
              </MetricCard>
            )}
          </div>
        </>
      )}

      {/* Charts */}
      {chartLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: 'var(--text-dim)', padding: '0.6rem 0' }}><span className="spinner" /> {lifetimeView ? 'Loading Holdings cost-basis G/L...' : 'Fetching data from Yahoo Finance...'}</div>}
      {chartError && <div className="alert alert-error">{chartError}</div>}

      {chartData && !chartLoading && (
        <>
          <h2 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }}>
            {lifetimeView ? 'Life Price G/L %' : 'Total Return %'} by Ticker <span className="tr-period-inline">— {chartData.period_label}</span>
          </h2>
          <p className="tr-note">
            {lifetimeView
              ? <>Cost-basis G/L % by ticker, the same numbers as the Holdings table. Green = positive, Red = negative.</>
              : <>Portfolio range: <strong>{dashboardCardRange}</strong>. Each holding starts no earlier than the date it was actually held;
            hover a bar for that ticker's effective range. Green = positive, Red = negative. Gold dashed line = SPY.</>}
          </p>
          <div id="tr-chart-bar" style={{ minHeight: '400px', marginBottom: '2rem' }} />
        </>
      )}

      {/* Performance Comparison */}
      {!lifetimeView && <div style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Performance Comparison</h2>
        <p className="tr-note">
          Select the entire portfolio, individual holdings, and/or external tickers to compare side by side. Normalized to 100 at start.
          This chart uses the page-wide Dashboard Date Range above. All starts with the portfolio&apos;s first recorded trade,
          and Custom uses the inclusive dates you enter.
        </p>

        <div className="growth-filters" style={{ marginBottom: '1rem' }}>
          {/* Portfolio and ticker multi-select */}
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={cmpTickerRef}>
            <label>Portfolio &amp; Tickers</label>
            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '160px', textAlign: 'left' }}
              onClick={() => setCmpTickerOpen(o => !o)}>
              {cmpTickers.length + (cmpPortfolio ? 1 : 0) === 0
                ? 'None selected'
                : `${cmpTickers.length + (cmpPortfolio ? 1 : 0)} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{cmpTickerOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {cmpTickerOpen && (
              <div className="growth-cat-dropdown" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', gap: '0.3rem', padding: '0.3rem 0.6rem', borderBottom: '1px solid var(--border)', marginBottom: '0.2rem' }}>
                  <button type="button" className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => { setCmpPortfolio(true); setCmpTickers([...allTickers]) }}>All</button>
                  <button type="button" className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => { setCmpPortfolio(false); setCmpTickers([]) }}>Clear</button>
                </div>
                <label className="growth-cat-option" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.45rem', marginBottom: '0.2rem' }}>
                  <input
                    type="checkbox"
                    checked={cmpPortfolio}
                    onChange={e => setCmpPortfolio(e.target.checked)}
                  />
                  <span><strong>Entire Portfolio</strong></span>
                </label>
                {allTickers.map(t => (
                  <label key={t} className="growth-cat-option">
                    <input type="checkbox" checked={cmpTickers.includes(t)}
                      onChange={e => {
                        if (e.target.checked) setCmpTickers(prev => [...prev, t])
                        else setCmpTickers(prev => prev.filter(x => x !== t))
                      }} />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* External tickers input */}
          <form onSubmit={handleCmpExtraSubmit} className="growth-filter-group">
            <label>External Tickers</label>
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              <input type="text" value={cmpExtraInput} onChange={e => setCmpExtraInput(e.target.value.toUpperCase())}
                placeholder="e.g. SPY QQQ VOO"
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', background: 'var(--p-0d1520)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text)', width: '200px' }} />
              <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}>Add</button>
              {cmpExtra && <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
                onClick={() => { setCmpExtra(''); setCmpExtraInput('') }}>Clear</button>}
            </div>
            {cmpExtra && <div style={{ fontSize: '0.8rem', color: 'var(--accent-bright)', marginTop: '0.25rem' }}>{cmpExtra.split(',').join(', ')}</div>}
          </form>

          <div className="growth-filter-group">
            <label>Shared Performance Date Range</label>
            <div style={{ color: 'var(--accent-bright)', fontSize: '0.85rem', padding: '0.35rem 0' }}>
              {chartData?.period_label || 'Selected period'}{dashboardCardRange ? ` · ${dashboardCardRange}` : ''}
            </div>
          </div>

          {/* Return mode */}
          <div className="growth-filter-group">
            <label>Return Type</label>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {COMPARISON_RETURN_MODES.map(mode => (
                <button
                  type="button"
                  key={mode.key}
                  title={mode.title}
                  className={`tr-pbtn${cmpMode === mode.key ? ' tr-pbtn-active' : ''}`}
                  style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                  onClick={() => setCmpMode(mode.key)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {cmpLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: 'var(--text-dim)', padding: '0.6rem 0' }}><span className="spinner" /> Loading comparison data...</div>}
        {cmpError && <div className="alert alert-error">{cmpError}</div>}
        {cmpData && !cmpLoading && (
          <>
            <p className="tr-note" style={{ marginTop: '-0.35rem', marginBottom: '0.4rem' }}>
              <strong>{cmpData.period_label}:</strong>{' '}
              {cmpRequestedRange || cmpActualRange}
              {cmpRequestedRange && cmpActualRange && cmpRequestedRange !== cmpActualRange
                ? ` (available market observations ${cmpActualRange})`
                : ''}
            </p>
            {cmpPortfolio && cmpData.portfolio_method && (
              <p className="tr-note" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                <strong>Entire Portfolio:</strong> Cash-flow-adjusted daily time-weighted performance from dated transactions.
                Purchases and sales change portfolio weights without being counted as returns.
                {cmpData.portfolio_coverage?.fallback_positions > 0
                  ? ` ${cmpData.portfolio_coverage.fallback_positions} current position${cmpData.portfolio_coverage.fallback_positions === 1 ? '' : 's'} without transaction history begin on their saved purchase date, or their import/snapshot date when no purchase date is available.`
                  : ''}
                {cmpData.portfolio_coverage?.inferred_opening_positions > 0
                  ? ` ${cmpData.portfolio_coverage.inferred_opening_positions} pre-existing position${cmpData.portfolio_coverage.inferred_opening_positions === 1 ? ' was' : 's were'} reconciled from current shares because the transaction export began after the opening lot.`
                  : ''}
                {formatAccountingCoverage(cmpData.portfolio_coverage)
                  ? ` ${formatAccountingCoverage(cmpData.portfolio_coverage)}`
                  : ''}
              </p>
            )}
          </>
        )}
        {!cmpData && !cmpLoading && !cmpError && (!cmpPortfolio && cmpTickers.length === 0 && !cmpExtra) && (
          <p style={{ color: 'var(--p-556677)', fontStyle: 'italic', padding: '2rem 0', textAlign: 'center' }}>Select Entire Portfolio, portfolio tickers, or external tickers to see the comparison chart.</p>
        )}
        <div id="tr-chart-compare" style={{ minHeight: cmpData ? '550px' : '0', marginBottom: '2rem' }} />
      </div>}

      {/* Scatter chart */}
      {!lifetimeView && !chartLoading && dashboardRows.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginTop: '1.5rem', marginBottom: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>
              Total Return {scatterReturnMode === 'dollar' ? getCurrencyLabel() : '%'} vs Yield on Cost <span className="tr-period-inline">— {chartData?.period_label}</span>
            </h2>
            <div className="growth-filter-group" style={{ alignItems: 'flex-start' }}>
              <label>Return View</label>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button className={`tr-pbtn${scatterReturnMode === 'pct' ? ' tr-pbtn-active' : ''}`}
                  style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                  onClick={() => setScatterReturnMode('pct')}>%</button>
                <button className={`tr-pbtn${scatterReturnMode === 'dollar' ? ' tr-pbtn-active' : ''}`}
                  style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                  onClick={() => setScatterReturnMode('dollar')}>{getCurrencyLabel()}</button>
              </div>
            </div>
          </div>
          <p className="tr-note">Range: <strong>{dashboardCardRange}</strong>. Bubble size = ending position value. X = current annual yield on cost.</p>
          <div id="tr-chart-scatter" style={{ minHeight: '520px', marginBottom: '2rem' }} />
        </>
      )}

      {/* Table */}
      {(lifetimeReady || (summary && !summaryLoading && !chartLoading)) && (dashboardRows.length > 0 || realizedRows.length > 0) && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginTop: '1.5rem', marginBottom: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>
              {positionView === 'realized' ? 'Closed Positions' : positionView === 'combined' ? 'Open + Closed Positions' : 'Holdings'}
              {' — '}{chartData?.period_label || 'Selected period'} Total Return Summary
            </h2>
            <div className="growth-filter-group" style={{ alignItems: 'flex-start' }}>
              <label>Positions</label>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {(lifetimeView ? POSITION_VIEWS.filter(view => view.key === 'unrealized') : POSITION_VIEWS).map(view => (
                  <button
                    type="button"
                    key={view.key}
                    title={view.title}
                    className={`tr-pbtn${positionView === view.key ? ' tr-pbtn-active' : ''}`}
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                    onClick={() => switchPositionView(view.key)}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p style={{ color: 'var(--text-dim)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
            Requested range: <strong>{dashboardRequestedRange || dashboardActualRange}</strong>.{' '}
            {positionView === 'unrealized' && (lifetimeView
              ? 'Lifetime cost-basis G/L for open positions — current value minus what you paid. These rows and the Open Position Total match the Holdings table sums.'
              : 'Each row, the Open lots only footer, and the Open Lots Price and Total Return cards are current holdings. Fully closed positions are left out. The Tracker Price and Total Return cards retain positions closed during the range as part of portfolio history. Neither figure is lifetime cost-basis G/L.')}
            {positionView === 'realized' && `Sales that settled inside this range, priced off the recorded buy and sell. Distributions are the dividends those shares earned before the sale.${realizedTotals.sale_count ? ` ${realizedTotals.sale_count} sale${realizedTotals.sale_count === 1 ? '' : 's'}.` : ''}`}
            {positionView === 'combined' && 'Open and closed legs summed per ticker. Net Ret % is money-weighted over basis (period start value plus realized cost), so it will not match the time-weighted Total Ret % in the Unrealized view.'}
            {' '}Click any column header to sort.
          </p>
          {!sortedRows.length && (
            <p style={{ color: 'var(--p-556677)', fontStyle: 'italic', padding: '2rem 0', textAlign: 'center' }}>
              {positionView === 'realized'
                ? 'No sales settled in this range. Widen the Dashboard Date Range, or record sales as SELL transactions.'
                : 'No positions in this range.'}
            </p>
          )}
          {sortedRows.length > 0 && (
          <div className="sticky-table-wrap tr-total-return-table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map(col => {
                    const sk = col.sortKey || col.key
                    if (col.key === 'ret_vs_yld') {
                      return (
                        <th key={col.key} style={{ textAlign: 'center', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none' }} title="Total return vs yield, both measured over the selected range — the annual yield is scaled to that window so short periods stay comparable. Good means total return exceeds yield, Poor means yield exceeds total return.">
                          <span style={{ cursor: 'pointer' }} onClick={() => handleSort(sk)}>RvY{sortIcon(sk)}</span>
                          {' '}
                          <span
                            onClick={() => setRvyMode(m => m === 'yoc' ? 'cur' : 'yoc')}
                            title={rvyMode === 'yoc' ? 'Using Yield on Cost — click to switch to Current Yield' : 'Using Current Yield — click to switch to Yield on Cost'}
                            style={{ fontSize: '0.65rem', background: rvyMode === 'yoc' ? 'var(--p-1a3a5c)' : 'var(--p-1a3a2a)', color: rvyMode === 'yoc' ? 'var(--accent-bright)' : 'var(--pos)', border: `1px solid ${rvyMode === 'yoc' ? 'var(--p-294b73)' : 'var(--p-2a5c3a)'}`, borderRadius: 3, padding: '1px 4px', cursor: 'pointer', fontWeight: 600 }}
                          >
                            {rvyMode === 'yoc' ? 'YOC' : 'CYld'}
                          </span>
                        </th>
                      )
                    }
                    return (
                      <th
                        key={col.key}
                        className={col.key === 'ticker' ? 'tr-frozen-ticker' : undefined}
                        title={col.title}
                        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: columnAlign(col) }}
                        onClick={() => handleSort(sk)}
                      >
                        {col.label}
                        <span style={{ fontSize: '0.7em', marginLeft: '4px', color: sortCol === sk ? 'var(--accent-bright)' : 'var(--text-dim)' }}>
                          {sortIcon(sk)}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, rowIndex) => (
                  <tr key={positionView === 'realized' ? `${row.ticker}-${row.sell_date}-${rowIndex}` : row.ticker}>
                    {columns.map(col => {
                      const val = row[col.key]
                      let display = col.fmt ? col.fmt(val) : (val ?? '')
                      let style = { textAlign: columnAlign(col) }

                      if (col.key === 'ticker') display = <strong>{val}</strong>
                      if (col.key === 'sell_date') display = formatComparisonDate(val) || (val ?? '')
                      if (col.gl) {
                        // A missing value is not a gain — don't paint its
                        // em-dash gain-green.
                        style = {
                          textAlign: 'right',
                          color: val == null ? 'var(--text-dim)' : (val >= 0 ? '#4dff91' : '#ff6b6b'),
                        }
                      }
                      if (missingBasis(row) && (col.key === 'start_value' || col.key === 'net_basis')) {
                        display = <span title="No cost basis on record for these shares, so the return percentage cannot be computed. Usually an unmatched transfer that drained the lot history." style={{ color: 'var(--warn, #ffb86c)' }}>{display} ⚠</span>
                      }
                      if (col.key === 'start_value') {
                        const lot = inferredLot(row)
                        if (lot) {
                          display = (
                            <span
                              role="button"
                              tabIndex={0}
                              title={inferredLotNote(lot, row.ticker)}
                              onClick={() => navigate(`/holdings?txn=${encodeURIComponent(row.ticker)}&return=total-return`)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  navigate(`/holdings?txn=${encodeURIComponent(row.ticker)}&return=total-return`)
                                }
                              }}
                              style={{ color: 'var(--warn, #ffb86c)', cursor: 'pointer' }}
                            >
                              {display} ⚠
                            </span>
                          )
                        }
                      }
                      if ((col.key === 'distribution_dollar' || col.key === 'net_distribution_dollar')
                          && row.ticker) {
                        display = (
                          <span
                            role="button"
                            tabIndex={0}
                            title={`Show the individual payments behind ${row.ticker}'s ${fmt(val)}`}
                            onClick={() => openDistributions(row.ticker)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                openDistributions(row.ticker)
                              }
                            }}
                            style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                          >
                            {display}
                          </span>
                        )
                      }
                      if (col.key === 'ret_vs_yld') {
                        const rvy = row.ret_vs_yld
                        display = rvy ? rvy.label : '—'
                        style = { textAlign: 'center', color: rvy?.color || '#6f7890', fontWeight: 600 }
                      }
                      return (
                        <td
                          key={col.key}
                          className={col.key === 'ticker' ? 'tr-frozen-ticker' : undefined}
                          style={style}
                          title={col.key === 'ret_vs_yld' ? rvyTitle(row) : undefined}
                        >
                          {display}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                  {positionView === 'unrealized' && (
                    <>
                      <td className="tr-frozen-ticker" title={OPEN_LOT_SCOPE_NOTE}><strong>Open lots only</strong></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td style={{ textAlign: 'right' }}>
                        {footerInferredShares > 0
                          ? (
                            <strong
                              title={
                                `This total includes ${footerInferredShares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares`
                                + ` across ${footerInferredTickers.length} position${footerInferredTickers.length === 1 ? '' : 's'}`
                                + ` (${footerInferredTickers.join(', ')}) that no transaction accounts for,`
                                + ` with about ${fmt(footerInferredValue)} of Start Value coming from inferred lots.`
                                + ' See the flagged Start Value cells above.'
                              }
                              style={{ color: 'var(--warn, #ffb86c)' }}
                            >
                              {fmt(openPositionTotals.start_value)} ⚠
                            </strong>
                          )
                          : <strong>{fmt(openPositionTotals.start_value)}</strong>}
                      </td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(openPositionTotals.end_value)}</strong></td>
                      <td style={{ textAlign: 'right', color: (openPositionTotals.price_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(openPositionTotals.price_return_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (openPositionTotals.price_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmtPct(openPositionTotals.price_return_pct)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(openPositionTotals.distribution_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (openPositionTotals.total_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(openPositionTotals.total_return_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (openPositionTotals.total_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmtPct(openPositionTotals.total_return_pct)}</strong></td>
                      <td>{dashboardCardRange}</td>
                      <td></td>
                    </>
                  )}
                  {positionView === 'realized' && (
                    <>
                      <td className="tr-frozen-ticker"><strong>Realized Total</strong></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(realizedTotals.start_value)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(realizedTotals.end_value)}</strong></td>
                      <td style={{ textAlign: 'right', color: (realizedTotals.price_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(realizedTotals.price_return_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (realizedTotals.price_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmtPct(realizedTotals.price_return_pct)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(realizedTotals.distribution_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (realizedTotals.total_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(realizedTotals.total_return_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (realizedTotals.total_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmtPct(realizedTotals.total_return_pct)}</strong></td>
                    </>
                  )}
                  {positionView === 'combined' && (
                    <>
                      <td className="tr-frozen-ticker"><strong>Net Total</strong></td>
                      <td></td>
                      <td></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(combinedTotals.net_basis)}</strong></td>
                      <td style={{ textAlign: 'right', color: (combinedTotals.unrealized_total_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(combinedTotals.unrealized_total_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (combinedTotals.realized_total_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(combinedTotals.realized_total_dollar)}</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(combinedTotals.net_distribution_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (combinedTotals.net_total_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(combinedTotals.net_total_dollar)}</strong></td>
                      <td style={{ textAlign: 'right', color: (combinedTotals.net_total_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmtPct(combinedTotals.net_total_pct)}</strong></td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </>
      )}
      {distDetail && (
        <div className="modal-overlay" onClick={() => setDistDetail(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setDistDetail(null)}>&times;</button>
            <h3 style={{ marginTop: 0 }}>{distDetail.ticker} — Distributions</h3>
            {distDetail.loading && <p>Loading…</p>}
            {distDetail.error && <p style={{ color: 'var(--neg)' }}>{distDetail.error}</p>}
            {distDetail.data && (() => {
              const d = distDetail.data
              const counted = d.payments.filter(p => p.counted)
              const excluded = d.payments.filter(p => !p.counted)
              return (
                <>
                  <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
                    {d.period_label}: {formatPerformanceDate(d.start_date) || d.start_date}
                    {' – '}{formatPerformanceDate(d.end_date) || d.end_date}.
                    {' '}Every payment recorded for {d.ticker}, and why each one is in or out.
                  </p>
                  <table className="data-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Pay date</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ textAlign: 'left' }}>Source</th>
                        <th style={{ textAlign: 'left' }}>Counted?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {counted.map((p, i) => (
                        <tr key={`c${i}`}>
                          <td>{p.payment_date}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(p.amount)}</td>
                          <td style={{ color: 'var(--text-dim)' }}>{p.source || '—'}</td>
                          <td style={{ color: 'var(--pos)' }}>counted</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td><strong>Total shown on the row</strong></td>
                        <td style={{ textAlign: 'right' }}><strong>{fmt(d.counted_total)}</strong></td>
                        <td colSpan={2} />
                      </tr>
                      {excluded.map((p, i) => (
                        <tr key={`x${i}`} style={{ opacity: 0.7 }}>
                          <td>{p.payment_date}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(p.amount)}</td>
                          <td style={{ color: 'var(--text-dim)' }}>{p.source || '—'}</td>
                          <td style={{ color: 'var(--warn, #ffb86c)' }}>{p.excluded_reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {excluded.length > 0 && (
                    <p style={{ color: 'var(--text-dim)' }}>
                      {fmt(d.excluded_total)} across {excluded.length} payment
                      {excluded.length === 1 ? '' : 's'} is deliberately not in this figure.
                      A ledger export lists those rows too, which is why a hand-added
                      total can be larger than what this column shows.
                    </p>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
