import React, { useState, useEffect, useRef, useMemo } from 'react'
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
  addCustomRangeParams,
  customRangeError,
  formatAccountingCoverage,
  formatPerformanceChartRange,
  formatPerformanceAsOf,
  formatPerformanceDate,
  formatPerformanceRange,
  readSharedPerformanceRange,
  formatClockStamp,
  todayInputValue,
} from '../utils/performancePeriods'
import useSharedPerformanceRange from '../utils/useSharedPerformanceRange'

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
  const pf = useProfileFetch()
  const { selection, basisMode } = useProfile()
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
  }, [summary, chartData])

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

  // Fetch yfinance charts
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
    const params = new URLSearchParams({ period: dashboardPeriod })
    addCustomRangeParams(params, dashboardPeriod, customStart, customEnd)
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    pf(`/api/total-return/charts?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!active) return
        if (d.error) throw new Error(d.error)
        setChartData(d)
      })
      .catch(e => { if (active) setChartError(e.message) })
      .finally(() => { if (active) setChartLoading(false) })
    return () => { active = false }
  }, [categories, subcategories, dashboardPeriod, customStart, customEnd, selection, rangeError, pf])

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
    if (barEl && chartData.bar) {
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
  }, [chartData, isDark])

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
      entry.net_distribution_dollar += row.distribution_dollar || 0
    })
    realizedRows.forEach(row => {
      const entry = entryFor(row)
      entry.isClosed = true
      entry.net_basis += row.start_value || 0
      entry.realized_total_dollar += row.total_return_dollar || 0
      entry.net_distribution_dollar += row.distribution_dollar || 0
    })
    return [...byTicker.values()].map(entry => {
      const net = entry.unrealized_total_dollar + entry.realized_total_dollar
      return {
        ...entry,
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
    { key: 'start_value', label: 'Start Value', fmt, numeric: true },
    { key: 'end_value', label: 'End Value', fmt, numeric: true },
    { key: 'price_return_dollar', label: 'Period Price Return', title: 'Market-price dollars gained or lost during the selected date range; this is not current cost-basis gain/loss.', fmt, numeric: true, gl: true },
    { key: 'price_return_pct', label: 'Period Price Ret %', title: 'Time-weighted price return for the selected date range; Fidelity/Snowball current-position gain/loss uses cost basis instead.', fmt: fmtPct, numeric: true, gl: true },
    { key: 'distribution_dollar', label: 'Distributions', fmt, numeric: true },
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
    { key: 'distribution_dollar', label: 'Distributions', fmt, numeric: true },
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
    { key: 'net_distribution_dollar', label: 'Distributions', fmt, numeric: true },
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

  const allTickers = useMemo(() => (
    [...new Set((summary?.rows || [])
      .map(row => String(row.ticker || '').trim().toUpperCase())
      .filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, undefined, {
        sensitivity: 'base',
        numeric: true,
      }))
  ), [summary])

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
      net_distribution_dollar: (openPositionTotals.distribution_dollar || 0) + (realizedTotals.distribution_dollar || 0),
      net_total_dollar: net,
      net_total_pct: basis >= MIN_BASIS ? (net / basis) * 100 : null,
    }
  })()

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
    <div className="page dashboard">
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
              <li><strong>Price Return:</strong> the dollar change from market price alone over the range, ignoring dividends.</li>
              <li><strong>Distributions:</strong> dividends and other distributions actually paid during the range, from broker payment history where available.</li>
              <li><strong>SPY:</strong> the S&amp;P 500's own return over this portfolio's actual market-observation dates, for comparison.</li>
            </ul>
          </section>
          {/* Full width: this is the one distinction worth getting right, and
              splitting it across two half-width boxes would just re-fragment it. */}
          <section className="tracker-help-wide">
            <h3>Total Return vs. Tracker Total Return %</h3>
            <p>
              These are not the same number expressed two ways — they answer different questions, and
              Total Return ÷ Start Value will not equal Tracker Total Return % whenever you bought or
              sold during the range.
            </p>
            <ul>
              <li>
                <strong>Total Return ($):</strong> Price Return plus Distributions — the actual dollars
                your position gained, given the shares you actually held on each day. Buying more
                shares partway through the range means more dollars are exposed to whatever the price
                does afterward, so this is a <em>cash-flow-sensitive dollar result</em>: it reflects how
                much capital was invested and when, not just how the price moved.
              </li>
              <li>
                <strong>Tracker Total Return %:</strong> a daily-compounded, dividend-reinvested index —
                the same one drawn on the Growth &amp; Performance chart. Each trade re-bases the index
                to the value just before the trade, so a purchase or sale never creates a jump in the
                return itself. This is <em>time-weighted</em>: it measures how the investment performed,
                independent of when money moved in or out.
              </li>
            </ul>
            <p className="tracker-help-note">
              Use Tracker Total Return % to judge performance or compare against a benchmark like SPY —
              it is the figure that should match Dashboard, Growth &amp; Performance, Portfolio Growth 2,
              and Gains &amp; Losses after the close when the account, date range, and holdings scope match.
              Each screen reads live quotes separately, so values can differ intraday. Use Total
              Return ($) to see the actual dollar result of your specific buy and sell timing, which a
              pure percentage cannot show.
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
      {summaryLoading && <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></div>}
      {summaryError && <div className="alert alert-error">{summaryError}</div>}
      {summary && chartData && !summaryLoading && !chartLoading && (
        <>
          <p className="tr-note">
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
          </p>
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            <strong>Tracker performance standard:</strong> this page is the reference calculation for
            transaction-aware Total Return. Dashboard, Growth &amp; Performance, Portfolio Growth 2,
            and Gains &amp; Losses use this same calculation for <strong>Tracker Total Return %</strong> when the
            account, date range, and holdings scope match. They should agree after the close; separately
            read live quotes can differ intraday. Lifetime cost-basis G/L and dollar P/L
            answer a different question: where the accounting profit or loss came from.
            {' '}The selected range is remembered across all five tracking screens.
            {t.account_reconciliation && (
              <>
                {' '}<strong>Against your broker:</strong> End Value is the charted positions alone,
                so Start Value plus Price Return and Distributions reconciles to it — a cash balance
                is not a return, and open option contracts live in their own ledger with no history
                to replay. <strong>Account Value</strong> adds both back; that is the card to compare
                with net liquidating value, which already includes your cash.
              </>
            )}
          </div>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            {/* Both are single market observations, so each names its own date; the range
                belongs on the cards that actually measure across one. */}
            {/* Say what these measure. Only when something is actually left out,
                so an account with no cash and no options is not told twice that
                it has neither. */}
            <MetricCard label="Start Value" value={fmtInt(t.start_value)} range={startValueAsOf}>
              {t.account_reconciliation && <div className="summary-sub">Holdings only — no cash</div>}
            </MetricCard>
            <MetricCard label="End Value" value={fmtInt(t.end_value)} range={endValueAsOf}>
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
            {/* Price Return, Price Return % and Tracker Total Return % appear in
                this order on Growth & Performance too, so the two screens can be
                read side by side without hunting for the matching card. */}
            <MetricCard label="Price Return" range={dashboardCardRange}
              value={<span style={{ color: (t.price_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtInt(t.price_return_dollar)}</span>}>
              <div className="summary-sub">Whole portfolio history; market price only</div>
            </MetricCard>
            <MetricCard label="Price Return %" range={dashboardCardRange}
              value={<span style={{ color: (t.price_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(t.price_return_pct)}</span>}>
              <div className="summary-sub">Whole portfolio history; time-weighted</div>
              <div className="summary-sub">Compare with Growth &amp; Performance</div>
            </MetricCard>
            <MetricCard label="Distributions" value={fmtInt(t.distribution_dollar)} range={dashboardCardRange}>
              <div className="summary-sub">Dividends paid during the range</div>
            </MetricCard>
            <MetricCard label="Total Return" range={dashboardCardRange}
              value={<span style={{ color: (t.total_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtInt(t.total_return_dollar)}</span>}>
              <div className="summary-sub">Price Return + Distributions, in dollars</div>
              <div className="summary-sub">Dollar result — reflects your buy/sell timing</div>
            </MetricCard>
            <MetricCard label="Tracker Total Return %" range={dashboardCardRange}
              value={<span style={{ color: (t.total_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(t.total_return_pct)}</span>}>
              <div className="summary-sub">Time-weighted — timing-neutral performance</div>
              <div className="summary-sub">Same calculation as Dashboard, Growth &amp; Gains/Losses; separately read live quotes can differ until close</div>
            </MetricCard>
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
      {chartLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: 'var(--text-dim)', padding: '0.6rem 0' }}><span className="spinner" /> Fetching data from Yahoo Finance...</div>}
      {chartError && <div className="alert alert-error">{chartError}</div>}

      {chartData && !chartLoading && (
        <>
          <h2 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }}>
            Total Return % by Ticker <span className="tr-period-inline">— {chartData.period_label}</span>
          </h2>
          <p className="tr-note">
            Portfolio range: <strong>{dashboardCardRange}</strong>. Each holding starts no earlier than the date it was actually held;
            hover a bar for that ticker's effective range. Green = positive, Red = negative. Gold dashed line = SPY.
          </p>
          <div id="tr-chart-bar" style={{ minHeight: '400px', marginBottom: '2rem' }} />
        </>
      )}

      {/* Performance Comparison */}
      <div style={{ marginTop: '1.5rem' }}>
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
      </div>

      {/* Scatter chart */}
      {!chartLoading && dashboardRows.length > 0 && (
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
      {summary && !summaryLoading && !chartLoading && (dashboardRows.length > 0 || realizedRows.length > 0) && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginTop: '1.5rem', marginBottom: '0.25rem' }}>
            <h2 style={{ margin: 0 }}>
              {positionView === 'realized' ? 'Closed Positions' : positionView === 'combined' ? 'Open + Closed Positions' : 'Holdings'}
              {' — '}{chartData?.period_label || 'Selected period'} Total Return Summary
            </h2>
            <div className="growth-filter-group" style={{ alignItems: 'flex-start' }}>
              <label>Positions</label>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {POSITION_VIEWS.map(view => (
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
            {positionView === 'unrealized' && 'Open positions only. Each row lists its current open-lot range (the same lot Gains & Losses uses after a full sale and re-buy). Period Price Return is selected-period market performance, not the current cost-basis G/L shown by a Fidelity positions screen or Snowball. The footer excludes fully closed positions; the tracker cards above retain them as part of the portfolio history.'}
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
                      <th key={col.key} title={col.title} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: columnAlign(col) }} onClick={() => handleSort(sk)}>
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
                      if (col.key === 'ret_vs_yld') {
                        const rvy = row.ret_vs_yld
                        display = rvy ? rvy.label : '—'
                        style = { textAlign: 'center', color: rvy?.color || '#6f7890', fontWeight: 600 }
                      }
                      return <td key={col.key} style={style} title={col.key === 'ret_vs_yld' ? rvyTitle(row) : undefined}>{display}</td>
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                  {positionView === 'unrealized' && (
                    <>
                      <td colSpan={2}><strong>Open Position Total</strong></td>
                      <td style={{ textAlign: 'right' }}><strong>{fmt(openPositionTotals.start_value)}</strong></td>
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
                      <td colSpan={4}><strong>Realized Total</strong></td>
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
                      <td colSpan={3}><strong>Net Total</strong></td>
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
    </div>
  )
}
