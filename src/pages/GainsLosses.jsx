import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { prorateAnnualYield, returnVsYield } from '../utils/returnVsYield'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoney, formatMoneyWhole } from '../utils/money'
import { AccountValueCard } from '../components/AccountReconciliation'
import ColumnCustomizer from '../components/ColumnCustomizer'
import { useColumnLayout } from '../utils/useColumnLayout'
import {
  MIN_PERFORMANCE_DATE,
  PERFORMANCE_PERIODS,
  PERFORMANCE_RANGE_NOTE,
  addCustomRangeParams,
  customRangeError,
  formatAccountingCoverage,
  formatPerformanceChartRange,
  formatPerformanceDate,
  formatPerformanceRange,
  readSharedPerformanceRange,
  todayInputValue,
  writeSharedPerformanceRange,
} from '../utils/performancePeriods'

const fmt = v => formatMoney(v)
const fmtPct = v => v != null ? `${Number(v).toFixed(2)}%` : '\u2014'
const fmtInt = v => formatMoneyWhole(v)
// A missing value is not a gain. Without the null check an absent Tracker TR %
// renders its em-dash in gain-green, which reads as a positive result.
const glColor = v => (v == null ? 'var(--text-dim)' : (v >= 0 ? '#4dff91' : '#ff6b6b'))

function MetricCard({ label, value, range, className, children }) {
  return (
    <div className={`summary-card ${className || ''}`}>
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '\u2014'}</div>
      {range && <div className="summary-sub">{range}</div>}
      {children}
    </div>
  )
}

// Column definitions sit at module scope so a saved layout resolves against a
// stable list. Ticker is locked: it is the row identity, and on the Realized
// tab it also carries the expander for the individual sells.
const GL_LOCKED_COLS = ['ticker']

const UNREALIZED_COLS = [
  { key: 'ticker', label: 'Ticker', locked: true, tip: 'Stock or ETF ticker symbol' },
  { key: 'description', label: 'Description', tip: 'Full name of the holding' },
  { key: 'quantity', label: 'Shares', tip: 'Number of shares currently held', fmt: v => v != null ? Number(v).toFixed(3) : '\u2014', numeric: true },
  { key: 'price_paid', label: 'Price Paid', tip: 'Average cost per share at time of purchase', fmt: v => formatMoney(v, { digits: 4 }), numeric: true },
  { key: 'current_price', label: 'Curr Price', tip: 'Latest market price per share', fmt: v => formatMoney(v, { digits: 4 }), numeric: true },
  { key: 'purchase_value', label: 'Invested', tip: 'Total amount invested (price paid \u00d7 shares)', fmt, numeric: true },
  { key: 'current_value', label: 'Curr Value', tip: 'Current market value (current price \u00d7 shares)', fmt, numeric: true },
  { key: 'price_gl', label: 'Price G/L', tip: 'Gain or loss based on price change only (current value \u2212 invested)', fmt, gl: true },
  { key: 'price_gl_pct', label: 'Price G/L %', tip: 'Price gain/loss as a percentage of amount invested', fmt: fmtPct, gl: true },
  { key: 'divs_received', label: 'Divs Rcvd', tip: 'Total lifetime dividends received from this holding', fmt, numeric: true },
  { key: 'total_gl', label: 'Lifetime Total G/L', tip: 'Lifetime cost-basis gain or loss including all recorded dividends (price G/L + dividends received)', fmt, gl: true },
  { key: 'total_gl_pct', label: 'Lifetime G/L %', tip: 'Lifetime total gain/loss as a percentage of amount invested; this accounting figure is not controlled by the performance date range', fmt: fmtPct, gl: true },
  { key: 'period_total_return_pct', label: 'Tracker TR %', tip: 'Transaction-aware Total Return for the shared performance date range; this is the figure that matches Total Return', fmt: fmtPct, gl: true },
  { key: 'period_range', label: 'Effective Range', tip: 'Actual market-observation dates used for this holding' },
  { key: 'ret_vs_yld', label: 'RvY', tip: 'Total return vs yield, both measured over the selected range — the annual yield is scaled to that window so short periods stay comparable. Good means total return exceeds yield, Poor means yield exceeds total return.', rvy: true },
]

const REALIZED_COLS = [
  { key: 'ticker', label: 'Ticker', locked: true, tip: 'Stock or ETF ticker symbol' },
  { key: 'sell_date', label: 'Sell Date', sortKey: 'sell_date_sort', tip: 'Date the shares were sold — a grouped row shows the range from first to last sell' },
  { key: 'buy_price', label: 'Buy Price', tip: 'Price per share when originally purchased', fmt, numeric: true },
  { key: 'sell_price', label: 'Sell Price', tip: 'Price per share when sold', fmt, numeric: true },
  { key: 'shares_sold', label: 'Shares', tip: 'Number of shares sold in this transaction', fmt: v => v != null ? Number(v).toFixed(3) : '\u2014', numeric: true },
  { key: 'cost_basis', label: 'Cost Basis', tip: 'Total cost of shares sold (buy price \u00d7 shares)', fmt, numeric: true },
  { key: 'proceeds', label: 'Proceeds', tip: 'Total sale amount received (sell price \u00d7 shares)', fmt, numeric: true },
  { key: 'price_gl', label: 'Price G/L', tip: 'Gain or loss based on price change only (proceeds \u2212 cost basis)', fmt, gl: true },
  { key: 'price_gl_pct', label: 'Price G/L %', tip: 'Price gain/loss as a percentage of cost basis', fmt: fmtPct, gl: true },
  { key: 'divs_received', label: 'Divs Rcvd', tip: 'Dividends received while holding the shares before selling', fmt, numeric: true },
  { key: 'total_gl', label: 'Total G/L', tip: 'Total gain or loss including dividends (price G/L + dividends received)', fmt, gl: true },
  { key: 'total_gl_pct', label: 'Total G/L %', tip: 'Total gain/loss as a percentage of cost basis', fmt: fmtPct, gl: true },
]

const COMBINED_COLS = [
  { key: 'ticker', label: 'Ticker', locked: true, tip: 'Stock or ETF ticker symbol' },
  { key: 'description', label: 'Description', tip: 'Full name of the holding' },
  { key: 'status', label: 'Status', tip: 'Open = currently held, Closed = fully sold, Open + Closed = partially sold' },
  { key: 'unrealized_price_gl', label: 'Unreal. Price G/L', tip: 'Unrealized gain/loss on shares still held (price change only)', fmt, gl: true },
  { key: 'unrealized_divs', label: 'Unreal. Divs', tip: 'Dividends received on shares still held', fmt, numeric: true },
  { key: 'unrealized_total_gl', label: 'Unreal. Total G/L', tip: 'Unrealized gain/loss including dividends on shares still held', fmt, gl: true },
  { key: 'realized_price_gl', label: 'Real. Price G/L', tip: 'Realized gain/loss from sold shares (price change only)', fmt, gl: true },
  { key: 'realized_divs', label: 'Real. Divs', tip: 'Dividends received on shares that were sold', fmt, numeric: true },
  { key: 'realized_total_gl', label: 'Real. Total G/L', tip: 'Realized gain/loss including dividends from sold shares', fmt, gl: true },
  { key: 'net_price_gl', label: 'Net Price G/L', tip: 'Combined unrealized + realized price gain/loss', fmt, gl: true },
  { key: 'net_divs', label: 'Net Divs', tip: 'Total dividends received (unrealized + realized)', fmt, numeric: true },
  { key: 'net_total_gl', label: 'Net Total G/L', tip: 'Combined total gain/loss across all open and closed positions', fmt, gl: true },
]

export default function GainsLosses() {
  const pf = useProfileFetch()
  const { selection, basisMode } = useProfile()
  const { isDark } = useTheme()
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [chartData, setChartData] = useState(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState(null)
  const [initialPerformanceRange] = useState(() => readSharedPerformanceRange())
  const [period, setPeriod] = useState(initialPerformanceRange.period)
  const [customStart, setCustomStart] = useState(initialPerformanceRange.start)
  const [customEnd, setCustomEnd] = useState(initialPerformanceRange.end)

  const [tab, setTab] = useState('unrealized')
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(false)
  const [rvyMode, setRvyMode] = useState('cur')
  const [expandedRealized, setExpandedRealized] = useState({})

  useEffect(() => {
    writeSharedPerformanceRange(period, customStart, customEnd)
  }, [period, customStart, customEnd])

  const rangeError = customRangeError(period, customStart, customEnd)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (catRef.current && !catRef.current.contains(e.target)) setCatOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch summary data
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    pf(`/api/gains-losses/summary?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!active) return
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [categories, subcategories, selection, basisMode, pf])

  // Selected-period performance is read from the same two endpoints as the
  // Total Return page. That makes "Tracker Total Return" a single calculation,
  // while the separate lifetime accounting summary above remains cost-basis
  // gain/loss rather than being silently redefined by a date button.
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
    const params = new URLSearchParams({ period })
    addCustomRangeParams(params, period, customStart, customEnd)
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    Promise.all([
      pf(`/api/total-return/charts?${params}`).then(r => r.json()),
      pf(`/api/total-return/summary?${params}`).then(r => r.json()),
    ])
      .then(([performance, periodSummary]) => {
        if (!active) return
        if (performance.error) throw new Error(performance.error)
        if (periodSummary.error) throw new Error(periodSummary.error)
        setChartData({
          ...performance,
          realized_rows: periodSummary.realized || [],
        })
      })
      .catch(e => { if (active) setChartError(e.message) })
      .finally(() => { if (active) setChartLoading(false) })
    return () => { active = false }
  }, [period, customStart, customEnd, rangeError, categories, subcategories, selection, basisMode, pf])

  // Render Plotly charts
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
    const withChartRange = title => chartRange ? `${title}<br><sup>${chartRange}</sup>` : title

    // Chart 1: the exact transaction-aware index used on Total Return, shifted
    // from a 100 baseline to percentage return for a familiar G/L view.
    const timeEl = document.getElementById('gl-chart-time')
    const portfolioSeries = chartData.portfolio_series
    if (timeEl && portfolioSeries?.dates?.length) {
      ids.push('gl-chart-time')
      const priceReturns = (portfolioSeries.price || []).map(value => (
        value == null ? null : Number((Number(value) - 100).toFixed(2))
      ))
      const totalReturns = (portfolioSeries.total || []).map(value => (
        value == null ? null : Number((Number(value) - 100).toFixed(2))
      ))
      const traces = [
        {
          x: portfolioSeries.dates, y: priceReturns,
          name: 'Price Return', mode: 'lines',
          line: { width: 2.5, color: '#7B8CFF' },
          fill: 'tozeroy', fillcolor: 'rgba(123,140,255,0.1)',
          hovertemplate: '<b>Price Return</b><br>%{x}<br>%{y:+.2f}%<extra></extra>',
        },
        {
          x: portfolioSeries.dates, y: totalReturns,
          name: 'Tracker Total Return', mode: 'lines',
          line: { width: 2.5, color: '#2EFDB5' },
          fill: 'tozeroy', fillcolor: 'rgba(46,253,181,0.08)',
          hovertemplate: '<b>Tracker Total Return</b><br>%{x}<br>%{y:+.2f}%<extra></extra>',
        },
      ]
      // Zero line
      traces.push({
        x: [portfolioSeries.dates[0], portfolioSeries.dates[portfolioSeries.dates.length - 1]],
        y: [0, 0], mode: 'lines',
        line: { width: 1, color: '#555', dash: 'dash' },
        showlegend: false, hoverinfo: 'skip',
      })
      const layout = {
        title: { text: withChartRange(`Portfolio Return \u2014 ${chartData.period_label}`), font: { color: '#e0e8f0' } },
        template: 'plotly_dark',
        paper_bgcolor: '#1a1f2e', plot_bgcolor: 'rgba(255,255,255,0.03)',
        xaxis: { tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)' },
        yaxis: { title: { text: 'Return (%)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)', ticksuffix: '%', tickformat: ',.2f' },
        height: 450, hovermode: 'x unified',
        legend: { orientation: 'h', y: -0.12, font: { color: '#d0dde8' } },
        margin: { t: 70, b: 60, l: 80, r: 20 },
      }
      Plotly.newPlot(timeEl, traces, themedPlotlyLayout(layout, isDark), cfg)
    }

    // Chart 2: selected-period return by ticker, from the same performance rows
    // rendered on Total Return.
    const barEl = document.getElementById('gl-chart-bar')
    if (barEl && chartData.performance_rows?.length) {
      ids.push('gl-chart-bar')
      const sorted = [...chartData.performance_rows].sort((a, b) => (a.total_return_pct || 0) - (b.total_return_pct || 0))
      const tickers = sorted.map(r => r.ticker)
      const priceVals = sorted.map(r => Number(Number(r.price_return_pct || 0).toFixed(2)))
      const totalVals = sorted.map(r => Number(Number(r.total_return_pct || 0).toFixed(2)))
      const barTraces = [
        {
          y: tickers, x: priceVals, type: 'bar', orientation: 'h',
          name: 'Price Return', marker: { color: '#7B8CFF' },
          text: priceVals.map(value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`),
          textposition: 'outside', cliponaxis: false,
          hovertemplate: '<b>%{y}</b><br>Price Return: %{x:+.2f}%<extra></extra>',
        },
        {
          y: tickers, x: totalVals, type: 'bar', orientation: 'h',
          name: 'Tracker Total Return', marker: { color: '#2EFDB5' },
          text: totalVals.map(value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`),
          textposition: 'outside', cliponaxis: false,
          hovertemplate: '<b>%{y}</b><br>Tracker Total Return: %{x:+.2f}%<extra></extra>',
        },
      ]
      const barHeight = Math.max(400, tickers.length * 32 + 80)
      const barLayout = {
        title: { text: withChartRange(`Price Return vs Tracker Total Return by Ticker \u2014 ${chartData.period_label}`), font: { color: '#e0e8f0' } },
        template: 'plotly_dark', barmode: 'group',
        paper_bgcolor: '#1a1f2e', plot_bgcolor: 'rgba(255,255,255,0.03)',
        xaxis: { title: { text: 'Return (%)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)', ticksuffix: '%', tickformat: ',.2f', automargin: true },
        yaxis: { tickfont: { color: '#c0cdd8', size: 11 }, automargin: true },
        height: barHeight,
        legend: { orientation: 'h', y: -0.08, font: { color: '#d0dde8' } },
        margin: { t: 70, b: 50, l: 80, r: 20 },
      }
      Plotly.newPlot(barEl, barTraces, themedPlotlyLayout(barLayout, isDark), cfg)
    }

    // Chart 3: selected-period winners vs losers.
    const watEl = document.getElementById('gl-chart-waterfall')
    if (watEl && chartData.performance_rows?.length) {
      ids.push('gl-chart-waterfall')
      const sorted = [...chartData.performance_rows].sort((a, b) => (b.total_return_pct || 0) - (a.total_return_pct || 0))
      const tickers = sorted.map(r => r.ticker)
      const vals = sorted.map(r => Number(Number(r.total_return_pct || 0).toFixed(2)))
      const colors = vals.map(v => v >= 0 ? '#4dff91' : '#ff6b6b')
      const watTraces = [{
        x: tickers, y: vals, type: 'bar',
        marker: { color: colors },
        text: vals.map(value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`),
        textposition: 'outside', cliponaxis: false,
        hovertemplate: '<b>%{x}</b><br>Tracker Total Return: %{y:+.2f}%<extra></extra>',
        showlegend: false,
      }]
      const watLayout = {
        title: { text: withChartRange(`Winners vs Losers \u2014 Tracker Total Return (${chartData.period_label})`), font: { color: '#e0e8f0' } },
        template: 'plotly_dark',
        paper_bgcolor: '#1a1f2e', plot_bgcolor: 'rgba(255,255,255,0.03)',
        xaxis: { tickfont: { color: '#c0cdd8', size: 10 }, tickangle: -45 },
        yaxis: { title: { text: 'Total Return (%)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)', ticksuffix: '%', tickformat: ',.2f', automargin: true },
        height: 400,
        margin: { t: 70, b: 100, l: 80, r: 20 },
      }
      Plotly.newPlot(watEl, watTraces, themedPlotlyLayout(watLayout, isDark), cfg)
    }

    // Chart 4: Realized gains timeline
    const realEl = document.getElementById('gl-chart-realized')
    if (realEl && chartData.realized_rows?.length) {
      ids.push('gl-chart-realized')
      const events = chartData.realized_rows
      const realTraces = [{
        x: events.map(e => e.sell_date),
        y: events.map(e => e.total_return_dollar),
        text: events.map(e => e.ticker),
        type: 'bar',
        marker: { color: events.map(e => e.total_return_dollar >= 0 ? '#4dff91' : '#ff6b6b') },
        hovertemplate: '<b>%{text}</b><br>%{x}<br>Total G/L: $%{y:,.2f}<extra></extra>',
        showlegend: false,
      }]
      const realLayout = {
        title: { text: withChartRange(`Realized Gains Timeline \u2014 sales inside ${chartData.period_label}`), font: { color: '#e0e8f0' } },
        template: 'plotly_dark',
        paper_bgcolor: '#1a1f2e', plot_bgcolor: 'rgba(255,255,255,0.03)',
        xaxis: { title: { text: 'Sell Date', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)' },
        yaxis: { title: { text: 'Total G/L ($)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)', tickprefix: '$', separatethousands: true },
        height: 380,
        margin: { t: 70, b: 60, l: 80, r: 20 },
      }
      Plotly.newPlot(realEl, realTraces, themedPlotlyLayout(realLayout, isDark), cfg)
    }

    return () => {
      ids.forEach(id => {
        const el = document.getElementById(id)
        if (el) Plotly.purge(el)
      })
    }
  }, [chartData, isDark])

  // Table sorting
  const handleSort = (col) => {
    if (sortCol === col) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(false) }
  }

  const sortIcon = (col) => {
    if (sortCol !== col) return ' \u21C5'
    return sortAsc ? ' \u25B2' : ' \u25BC'
  }

  const sortRows = (rows) => {
    if (!sortCol || !rows) return rows
    const sorted = [...rows]
    sorted.sort((a, b) => {
      let av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      av = String(av).toLowerCase(); bv = String(bv).toLowerCase()
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return sorted
  }

  // Reset sort and lot expansion when changing tabs
  useEffect(() => { setSortCol(null); setExpandedRealized({}) }, [tab])

  const toggleLots = (ticker) => setExpandedRealized(prev => {
    const next = { ...prev }
    if (next[ticker]) delete next[ticker]
    else next[ticker] = true
    return next
  })

  const t = data?.totals || {}
  const periodMetrics = chartData?.portfolio_metrics || {}
  const performanceRange = formatPerformanceRange(
    chartData?.actual_start_date || chartData?.requested_start_date,
    chartData?.actual_end_date || chartData?.requested_end_date,
  )
  // Start and End Value are single closes; the range belongs on the cards that
  // measure across one.
  const periodAsOf = (value) => {
    const label = formatPerformanceDate(value)
    return label ? `As of ${label} close` : performanceRange
  }
  const performanceByTicker = useMemo(() => new Map(
    (chartData?.performance_rows || []).map(row => [
      String(row.ticker || '').trim().toUpperCase(),
      row,
    ]),
  ), [chartData])
  const extremePerformanceRows = useMemo(() => {
    const lifetimeByTicker = new Map(
      (data?.unrealized || []).map(row => [
        String(row.ticker || '').trim().toUpperCase(),
        row,
      ]),
    )
    return (chartData?.performance_rows || [])
      .filter(row => Math.abs(Number(row.total_return_pct || 0)) >= 500)
      .map(row => ({
        ...row,
        lifetime_gl_pct: lifetimeByTicker.get(
          String(row.ticker || '').trim().toUpperCase(),
        )?.total_gl_pct,
      }))
      .sort((left, right) => (
        Math.abs(Number(right.total_return_pct || 0))
        - Math.abs(Number(left.total_return_pct || 0))
      ))
  }, [chartData, data])

  const enrichedUnrealized = useMemo(() => {
    if (!data?.unrealized) return []
    return data.unrealized.map(r => {
      const performance = performanceByTicker.get(String(r.ticker || '').trim().toUpperCase())
      const annualYld = rvyMode === 'yoc' ? (r.annual_yield_on_cost || 0) * 100 : (r.current_annual_yield || 0) * 100
      const comparableReturn = performance?.total_return_pct
      // Tracker TR % covers the shared performance range, so the yield it is
      // compared against is scaled to that same window — otherwise a 7D return
      // is measured against a full year of income and always reads Poor.
      const windowYld = (
        prorateAnnualYield(annualYld, performance?.actual_start_date, performance?.actual_end_date)
        ?? prorateAnnualYield(annualYld, chartData?.actual_start_date, chartData?.actual_end_date)
      )
      const rvy = comparableReturn != null && windowYld != null
        ? returnVsYield(comparableReturn, windowYld)
        : null
      return {
        ...r,
        rvy_annual_yield_pct: annualYld,
        period_total_return_pct: comparableReturn,
        period_total_return_dollar: performance?.total_return_dollar,
        period_range: formatPerformanceRange(
          performance?.actual_start_date,
          performance?.actual_end_date,
        ),
        ret_vs_yld: rvy,
        ret_vs_yld_sort: rvy ? rvy.spread : -999,
      }
    })
  }, [data, performanceByTicker, rvyMode, chartData])

  // Spells out both sides of the comparison, so the window-scaled yield is not
  // mistaken for the annual one.
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

  // One realized row per ticker. A ticker sold in many fills (weekly assignments,
  // DRIP lots) otherwise floods the tab with hundreds of near-identical rows, so
  // the individual sells move behind an expander and the row shows their roll-up.
  // Weighted buy/sell price is exact: each source row's cost is buy_price x shares,
  // so total cost / total shares reproduces the per-share price.
  const groupedRealized = useMemo(() => {
    const rows = data?.realized || []
    const byTicker = new Map()
    rows.forEach(r => {
      if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, [])
      byTicker.get(r.ticker).push(r)
    })
    return Array.from(byTicker.entries()).map(([ticker, lots]) => {
      const sum = key => lots.reduce((acc, r) => acc + (Number(r[key]) || 0), 0)
      const shares = sum('shares_sold')
      const cost = sum('cost_basis')
      const proceeds = sum('proceeds')
      const priceGl = sum('price_gl')
      const divs = sum('divs_received')
      const totalGl = sum('total_gl')
      const dates = lots.map(r => r.sell_date).filter(Boolean).sort()
      const first = dates[0] || ''
      const last = dates[dates.length - 1] || ''
      return {
        ticker,
        lots,
        lot_count: lots.length,
        sell_date: first && last && first !== last ? `${first} → ${last}` : first,
        sell_date_sort: last,
        buy_price: shares ? cost / shares : 0,
        sell_price: shares ? proceeds / shares : 0,
        shares_sold: shares,
        cost_basis: cost,
        proceeds,
        price_gl: priceGl,
        price_gl_pct: cost ? (priceGl / cost) * 100 : 0,
        divs_received: divs,
        total_gl: totalGl,
        total_gl_pct: cost ? (totalGl / cost) * 100 : 0,
      }
    })
  }, [data])

  const multiLotTickers = groupedRealized.filter(r => r.lot_count > 1).map(r => r.ticker)
  const allLotsExpanded = multiLotTickers.length > 0
    && multiLotTickers.every(ticker => expandedRealized[ticker])
  const toggleAllLots = () => setExpandedRealized(
    allLotsExpanded ? {} : Object.fromEntries(multiLotTickers.map(ticker => [ticker, true]))
  )
  const realizedLotCount = groupedRealized.reduce((acc, r) => acc + r.lot_count, 0)

  // One saved layout per tab. The three tables answer different questions and
  // share barely any columns, so a single shared layout would be meaningless.
  const unrealizedLayout = useColumnLayout({
    storageKey: 'gains-losses-columns-unrealized-v1',
    columns: UNREALIZED_COLS,
    lockedKeys: GL_LOCKED_COLS,
  })
  const realizedLayout = useColumnLayout({
    storageKey: 'gains-losses-columns-realized-v1',
    columns: REALIZED_COLS,
    lockedKeys: GL_LOCKED_COLS,
  })
  const combinedLayout = useColumnLayout({
    storageKey: 'gains-losses-columns-combined-v1',
    columns: COMBINED_COLS,
    lockedKeys: GL_LOCKED_COLS,
  })

  const tabConfig = {
    unrealized: { layout: unrealizedLayout, rows: enrichedUnrealized },
    realized: { layout: realizedLayout, rows: groupedRealized },
    combined: { layout: combinedLayout, rows: data?.combined },
  }
  const columnLayout = tabConfig[tab].layout
  const activeCols = columnLayout.activeColumns
  const activeRows = sortRows(tabConfig[tab].rows || [])

  // Shared by the roll-up row and its expanded lot rows so the two always use the
  // same columns and formatting — the lots sit in the parent table rather than a
  // nested one, which keeps them aligned and avoids inheriting the sticky header.
  const renderCells = (row, isLot = false) => activeCols.map(col => {
    const val = row[col.key]
    let display = col.fmt ? col.fmt(val) : (val ?? '')
    let style = (col.numeric || col.gl) ? { textAlign: 'right' } : {}
    if (col.key === 'ticker') {
      if (isLot) {
        display = <span className="gl-lot-marker">↳</span>
        style = { paddingLeft: '1.6rem' }
      } else if (tab === 'realized') {
        const expandable = row.lot_count > 1
        display = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <span
              onClick={expandable ? () => toggleLots(row.ticker) : undefined}
              title={expandable ? `Show/hide the ${row.lot_count} individual sells` : undefined}
              style={{
                width: '12px', fontSize: '0.7rem', userSelect: 'none',
                opacity: expandable ? 0.7 : 0,
                cursor: expandable ? 'pointer' : 'default',
              }}
            >
              {expandedRealized[row.ticker] ? '▼' : '▶'}
            </span>
            <strong>{val}</strong>
            {expandable && <span className="gl-lot-count">&times;{row.lot_count}</span>}
          </span>
        )
      } else {
        display = <strong>{val}</strong>
      }
    }
    if (col.gl) style = { ...style, textAlign: 'right', color: glColor(val) }
    if (col.rvy) {
      const rvy = row.ret_vs_yld
      display = rvy ? rvy.label : '—'
      style = { textAlign: 'center', color: rvy?.color || '#6f7890', fontWeight: 600 }
    }
    return (
      <td
        key={col.key}
        style={style}
        title={col.rvy ? rvyTitle(row) : undefined}
      >
        {display}
      </td>
    )
  })

  // Footer totals are keyed by column rather than by position. The old fixed
  // colSpan plus positional cells misaligned silently the moment a column was
  // hidden or moved. The Combined tab has never had a totals row.
  const footerTotals = {
    unrealized: {
      purchase_value: { value: t.unrealized_invested },
      current_value: { value: t.unrealized_value },
      price_gl: { value: t.unrealized_price_gl, gl: true },
      divs_received: { value: t.unrealized_divs },
      total_gl: { value: t.unrealized_total_gl, gl: true },
      period_total_return_pct: { value: periodMetrics.total_return_pct, gl: true, format: fmtPct },
      period_range: { value: performanceRange, text: true },
    },
    realized: {
      cost_basis: { value: t.realized_cost },
      proceeds: { value: t.realized_proceeds },
      price_gl: { value: t.realized_price_gl, gl: true },
      divs_received: { value: t.realized_divs },
      total_gl: { value: t.realized_total_gl, gl: true },
    },
  }[tab]

  const renderFooter = () => {
    if (!footerTotals) return null
    const label = tab === 'realized' ? 'Total' : 'Portfolio Total'
    // The label spans the leading run of columns with nothing to total, which is
    // exactly what the default Ticker-through-Shares layout looks like.
    let leading = 0
    while (leading < activeCols.length && !footerTotals[activeCols[leading].key]) leading += 1
    let labelPlaced = leading > 0
    const cells = leading > 0
      ? [<td key="__label" colSpan={leading}><strong>{label}</strong></td>]
      : []
    activeCols.slice(leading).forEach(col => {
      const cell = footerTotals[col.key]
      if (!cell) {
        // Every label column was dragged behind a total, so the heading takes the
        // first spare cell instead and the row still reads as one.
        cells.push(<td key={col.key}>{labelPlaced ? null : <strong>{label}</strong>}</td>)
        labelPlaced = true
        return
      }
      if (cell.text) {
        cells.push(<td key={col.key}>{cell.value}</td>)
        return
      }
      const format = cell.format || fmt
      cells.push(
        <td key={col.key} style={{ textAlign: 'right', color: cell.gl ? glColor(cell.value) : undefined }}>
          <strong>{format(cell.value)}</strong>
        </td>
      )
    })
    return (
      <tfoot>
        <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>{cells}</tr>
      </tfoot>
    )
  }

  const renderTable = () => {
    if (!activeRows.length) {
      return <p style={{ color: 'var(--p-556677)', fontStyle: 'italic', padding: '2rem 0', textAlign: 'center' }}>
        {tab === 'realized' ? 'No sold positions recorded. Add sales in the Watchlist page.' : 'No data available.'}
      </p>
    }

    return (
      <div className="sticky-table-wrap" style={{ maxHeight: '70vh' }}>
        <table>
          <thead>
            <tr>
              {activeCols.map(col => {
                const sk = col.rvy ? 'ret_vs_yld_sort' : (col.sortKey || col.key)
                const headerTip = `${col.tip || col.label}\u000a\u000aDrag this header to reorder the columns.`
                if (col.rvy) {
                  return (
                    <th
                      key={col.key}
                      title={headerTip}
                      className={columnLayout.dragClass(col.key)}
                      style={{ textAlign: 'center', whiteSpace: 'nowrap', cursor: 'grab', userSelect: 'none' }}
                      {...columnLayout.dragHandlers(col.key)}
                    >
                      <span style={{ cursor: 'pointer' }} onClick={() => handleSort(sk)}>RvY{sortIcon(sk)}</span>
                      {' '}
                      <span
                        onClick={() => setRvyMode(m => m === 'yoc' ? 'cur' : 'yoc')}
                        title={rvyMode === 'yoc' ? 'Using Yield on Cost \u2014 click to switch to Current Yield' : 'Using Current Yield \u2014 click to switch to Yield on Cost'}
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
                    title={headerTip}
                    className={columnLayout.dragClass(col.key)}
                    style={{ cursor: 'grab', userSelect: 'none', whiteSpace: 'nowrap', textAlign: (col.numeric || col.gl) ? 'right' : undefined }}
                    onClick={() => handleSort(sk)}
                    {...columnLayout.dragHandlers(col.key)}
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
            {activeRows.map((row, i) => (
              <React.Fragment key={`${row.ticker}-${i}`}>
                <tr>{renderCells(row)}</tr>
                {tab === 'realized' && expandedRealized[row.ticker] && row.lots?.length > 1
                  && row.lots.map((lot, j) => (
                    <tr key={`${row.ticker}-${i}-lot-${j}`} className="gl-lot-row">
                      {renderCells(lot, true)}
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
          {renderFooter()}
        </table>
      </div>
    )
  }

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '0.5rem' }}>Gains & Losses</h1>

      {/* Page-wide holdings and performance filters */}
      <div className="growth-filters" style={{ marginBottom: '1rem' }}>
        {(data?.categories?.length > 0) && (
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
                {data.categories.map(c => {
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
            {PERFORMANCE_PERIODS.map(option => (
              <button
                type="button"
                key={option.key}
                className={`tr-pbtn${period === option.key ? ' tr-pbtn-active' : ''}`}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                title={option.hint}
                onClick={() => setPeriod(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="tr-note perf-range-note">{PERFORMANCE_RANGE_NOTE}</p>
        </div>

        {period === 'custom' && (
          <div className="g2-custom-range" role="group" aria-label="Custom gains and losses performance date range">
            <label>
              <span>Start date</span>
              <input
                type="date"
                value={customStart}
                min={MIN_PERFORMANCE_DATE}
                max={customEnd || todayInputValue()}
                onChange={event => setCustomStart(event.target.value)}
              />
            </label>
            <label>
              <span>End date</span>
              <input
                type="date"
                value={customEnd}
                min={customStart || MIN_PERFORMANCE_DATE}
                max={todayInputValue()}
                onChange={event => setCustomEnd(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <details className="tracker-help">
        <summary>What do these cards mean?</summary>
        <p className="tracker-help-footer">
          <strong>Two different questions, both called "gains and losses":</strong> the top strip is a
          period return — it resets to whatever the Shared Performance Date Range is set to, and it is
          the same transaction-aware calculation used on Total Return. The bottom strip is lifetime
          cost-basis accounting — invested vs. current value since the day each holding was bought,
          unaffected by the date range above.
        </p>
        <div className="tracker-help-grid">
          <section>
            <h3>Selected-period cards</h3>
            <p>Everything in this row moves when you change the Shared Performance Date Range.</p>
            <ul>
              <li><strong>Start Value / End Value:</strong> the portfolio's holdings, priced at the close on the first and last day of the range. Neither includes cash.</li>
              <li><strong>Account Value:</strong> End Value plus your recorded cash and any open option contracts — the figure that lines up with a broker's net liquidating value. Shown only when there is cash or an open option to add.</li>
              <li><strong>Price Return:</strong> the dollar change from market price alone over the range, ignoring dividends.</li>
              <li><strong>Distributions:</strong> dividends and other distributions actually paid during the range, from broker payment history where available.</li>
              <li><strong>Total Return:</strong> Price Return plus Distributions — the dollar version of Tracker Total Return %.</li>
              <li><strong>Tracker Total Return %:</strong> the shared, dividend-reinvested percentage return. This is the number that should match Total Return, Dashboard, Growth &amp; Performance, and Portfolio Growth 2 when the account, holdings filter, and date range match.</li>
            </ul>
            <p className="tracker-help-note">
              Buys and sells during the range change what is being measured, not the return itself — a
              purchase or sale is never counted as a gain or loss here.
            </p>
          </section>
          <section>
            <h3>Lifetime cost-basis cards</h3>
            <p>This row ignores the date range. Each figure runs from the day a holding was first bought.</p>
            <p className="tracker-help-note" style={{ margin: '0 0 0.55rem', paddingTop: 0, borderTop: 'none' }}>
              <strong>Cost basis</strong> is what you originally paid for shares you still own — price
              paid × shares, not today's value. It is the baseline every gain/loss figure on this row is
              measured against, and it follows the <strong>Basis</strong> selector in the top nav: Original
              cost uses your recorded purchase price, Broker adjusted cost uses your broker's adjusted
              figure (wash sales, corporate actions) when one is on file. Switching that selector changes
              every number below without changing what you actually hold.
            </p>
            <ul>
              <li><strong>Total Invested:</strong> your total cost basis — the sum of price paid × shares across every holding you currently own.</li>
              <li><strong>Current Value:</strong> those same holdings at today's market price. Does not include cash.</li>
              <li><strong>Account Value:</strong> Current Value plus cash and any open option contracts — compare this one against your broker, not Current Value.</li>
              <li><strong>Unrealized G/L:</strong> gain or loss on shares you still hold. <em>Price Only</em> ignores dividends; <em>Price + Divs</em> adds every dividend received while holding those shares.</li>
              <li><strong>Realized G/L:</strong> the same split, but for shares you have already sold — the gain or loss is locked in at the sale.</li>
              <li><strong>Combined G/L:</strong> Unrealized plus Realized — your total cost-basis result across everything you have ever owned, sold or not.</li>
            </ul>
            <p className="tracker-help-note">
              This is cost-basis accounting, not a time-weighted return: a holding bought ten years ago
              and one bought last week both count their full gain, so this row cannot be compared
              directly against Tracker Total Return %.
            </p>
          </section>
          {/* Full width: this is about all three tables, not one card strip. */}
          <section className="tracker-help-wide">
            <h3>Unrealized / Realized / Combined tables</h3>
            <p>
              The tabs below break the same lifetime accounting down by ticker. <strong>Unrealized</strong>
              lists what you currently hold; <strong>Realized</strong> lists closed sales, grouped one row
              per ticker with the individual sells available behind the expand arrow when there is more
              than one; <strong>Combined</strong> shows both sides side by side for every ticker you have
              ever owned. <strong>RvY</strong> (Return vs. Yield, Unrealized tab only) compares each
              holding's Tracker Total Return % for the selected range against its yield scaled to that
              same window — Good means the total return beat the income, Poor means the income alone beat
              the total return.
            </p>
          </section>
        </div>
        <p className="tracker-help-footer">
          <strong>Choosing and ordering columns:</strong> each of the three tables keeps its own
          layout. The <strong>Columns</strong> button beside the tabs switches columns on and off, and
          you can drag a row in that panel &mdash; or a header on the table itself &mdash; to reorder
          them. Ticker always stays on, and the layout is saved on this machine, so it survives a
          restart.
        </p>
        <p className="tracker-help-footer">
          The Categories filter narrows every card, table, and chart on this screen to the selected
          holdings. The Shared Performance Date Range only moves the selected-period cards, the charts
          below, and the period-scoped columns in the tables (Tracker TR %, Effective Range, RvY) — it
          does not change the Lifetime Cost-Basis cards or the rest of the table columns, which always
          run from each holding's original purchase date.
        </p>
      </details>

      {rangeError && <div className="alert alert-error">{rangeError}</div>}

      {chartLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: 'var(--text-dim)', padding: '0.6rem 0' }}><span className="spinner" /> Loading shared-period performance...</div>}
      {chartError && <div className="alert alert-error">{chartError}</div>}
      {chartData && !chartLoading && (
        <>
          <p className="tr-note">
            <strong>{chartData.period_label} performance:</strong>{' '}
            {performanceRange || 'effective dates unavailable'}. The figures below come from the same
            transaction-aware calculation as Total Return; purchases and sales change portfolio weights
            without being counted as returns.
            {formatAccountingCoverage(periodMetrics)
              ? ` ${formatAccountingCoverage(periodMetrics)}`
              : ''}
          </p>
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            <strong>Reconciliation figure:</strong> <strong>Tracker Total Return %</strong> is the value
            that should match Total Return, Dashboard, Growth &amp; Performance, and Portfolio Growth 2
            when the account, holdings filter, and shared date range match. Lifetime G/L below answers
            a different cost-basis accounting question.
          </div>
          <div className="summary-strip" style={{ marginBottom: '1.25rem' }}>
            <MetricCard label="Start Value" value={fmtInt(periodMetrics.start_value)}
              range={periodAsOf(chartData?.actual_start_date)}>
              {periodMetrics.account_reconciliation && <div className="summary-sub">Holdings only — no cash</div>}
            </MetricCard>
            <MetricCard label="End Value" value={fmtInt(periodMetrics.end_value)}
              range={periodAsOf(chartData?.actual_end_date)}>
              {periodMetrics.account_reconciliation && (
                <div className="summary-sub">Holdings only — no cash; see Account Value</div>
              )}
            </MetricCard>
            <AccountValueCard data={periodMetrics.account_reconciliation}
              basisLabel={periodAsOf(chartData?.actual_end_date)} />
            <MetricCard label="Price Return" range={performanceRange}
              value={<span style={{ color: glColor(periodMetrics.price_return_dollar) }}>{fmtInt(periodMetrics.price_return_dollar)}</span>}>
              <div className="summary-sub">Market price only, dividends excluded</div>
            </MetricCard>
            <MetricCard label="Distributions" value={fmtInt(periodMetrics.distribution_dollar)} range={performanceRange}>
              <div className="summary-sub">Dividends paid during the range</div>
            </MetricCard>
            <MetricCard label="Total Return" range={performanceRange}
              value={<span style={{ color: glColor(periodMetrics.total_return_dollar) }}>{fmtInt(periodMetrics.total_return_dollar)}</span>}>
              <div className="summary-sub">Price Return + Distributions</div>
            </MetricCard>
            <MetricCard label="Tracker Total Return %" range={performanceRange}
              value={<span style={{ color: glColor(periodMetrics.total_return_pct) }}>{fmtPct(periodMetrics.total_return_pct)}</span>}>
              <div className="summary-sub">Matches Total Return &amp; Dashboard</div>
            </MetricCard>
          </div>
        </>
      )}

      {/* Lifetime cost-basis accounting */}
      {loading && <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}
      {data && !loading && (
        <>
          <h2 style={{ marginBottom: '0.25rem' }}>Lifetime Cost-Basis G/L</h2>
          <p className="tr-note">
            These invested, current-value, realized, and combined figures are lifetime accounting totals.
            They are intentionally not changed by the performance date range; use Tracker TR % above and
            in the Unrealized table for a period-to-period return comparison.
            {t.account_reconciliation && (
              <>
                {' '}Current Value counts holdings only. <strong>Account Value</strong> beside it adds
                your cash balance and any open option contracts, which are tracked in their own
                ledger — that is the figure to compare with a broker's net liquidating value, which
                already includes your cash.
              </>
            )}
          </p>
          <div className="summary-strip" style={{ marginBottom: '0.5rem' }}>
            <MetricCard label="Total Invested" value={fmtInt(t.unrealized_invested)}>
              <div className="summary-sub">What you paid for shares you still hold</div>
              <div className="summary-sub">
                Cost basis · {basisMode === 'broker_adjusted' ? 'broker adjusted' : 'original'}
              </div>
            </MetricCard>
            <MetricCard label="Current Value" value={fmtInt(t.unrealized_value)}>
              {t.account_reconciliation ? (
                <div className="summary-sub">Holdings only — no cash; see Account Value</div>
              ) : (
                <div className="summary-sub">Those same shares at today's price</div>
              )}
            </MetricCard>
            {/* Current Value counts holdings only; this is the whole account. */}
            <AccountValueCard data={t.account_reconciliation} />
            <MetricCard label="Unrealized G/L (Price Only)" value={<span style={{ color: glColor(t.unrealized_price_gl) }}>{fmtInt(t.unrealized_price_gl)}</span>}>
              <div className="summary-sub">Current Value − Total Invested</div>
            </MetricCard>
            <MetricCard label="Unrealized G/L (Price + Divs)" value={<span style={{ color: glColor(t.unrealized_total_gl) }}>{fmtInt(t.unrealized_total_gl)}</span>}>
              <div className="summary-sub">Same, plus dividends received while held</div>
            </MetricCard>
          </div>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <MetricCard label="Realized G/L (Price Only)" value={<span style={{ color: glColor(t.realized_price_gl) }}>{fmtInt(t.realized_price_gl)}</span>}>
              <div className="summary-sub">Proceeds − cost basis, shares already sold</div>
            </MetricCard>
            <MetricCard label="Realized G/L (Price + Divs)" value={<span style={{ color: glColor(t.realized_total_gl) }}>{fmtInt(t.realized_total_gl)}</span>}>
              <div className="summary-sub">Same, plus dividends received before the sale</div>
            </MetricCard>
            <MetricCard label="Combined G/L (Price Only)" value={<span style={{ color: glColor(t.combined_price_gl) }}>{fmtInt(t.combined_price_gl)}</span>}>
              <div className="summary-sub">Unrealized + Realized, price only</div>
            </MetricCard>
            <MetricCard label="Combined G/L (Price + Divs)" value={<span style={{ color: glColor(t.combined_total_gl) }}>{fmtInt(t.combined_total_gl)}</span>}>
              <div className="summary-sub">Lifetime result: everything you've ever owned</div>
            </MetricCard>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {[
              { key: 'unrealized', label: 'Unrealized' },
              { key: 'realized', label: 'Realized' },
              { key: 'combined', label: 'Combined' },
            ].map(t => (
              <button key={t.key}
                className={`tr-pbtn${tab === t.key ? ' tr-pbtn-active' : ''}`}
                style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}
                onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
            {tab === 'realized' && multiLotTickers.length > 0 && (
              <>
                <button
                  className="btn btn-secondary"
                  style={{ marginLeft: '0.75rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                  onClick={toggleAllLots}
                >
                  {allLotsExpanded ? 'Collapse all lots' : 'Expand all lots'}
                </button>
                <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  {groupedRealized.length} ticker{groupedRealized.length === 1 ? '' : 's'} &middot;{' '}
                  {realizedLotCount} sell{realizedLotCount === 1 ? '' : 's'}
                </span>
              </>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span className="column-bar-hint" style={{ marginRight: 0 }}>
                Each tab&apos;s columns are customizable &mdash; use <strong>Columns</strong> to choose
                which ones show, and drag a header to reorder them.
              </span>
              <ColumnCustomizer
                layout={columnLayout}
                detailOf={col => col.tip}
                buttonLabel="Columns"
              />
            </div>
          </div>

          {renderTable()}
        </>
      )}

      {/* Charts section */}
      <h2 style={{ marginTop: '2rem', marginBottom: '0.25rem' }}>Selected-Period Performance Charts</h2>
      <p className="tr-note">
        These charts use the Shared Performance Date Range above and the same transaction-aware
        return series as Total Return. The realized timeline includes only sales inside that range.
      </p>
      {extremePerformanceRows.length > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
          <strong>Percentage outlier:</strong>{' '}
          {extremePerformanceRows.map((row, index) => (
            <React.Fragment key={row.ticker}>
              {index > 0 ? '; ' : ''}
              <strong>{row.ticker}</strong> {fmtPct(row.total_return_pct)} for {chartData?.period_label}
              {' '}({fmt(row.total_return_dollar)} in period return
              {row.lifetime_gl_pct != null ? `; ${fmtPct(row.lifetime_gl_pct)} lifetime cost-basis G/L` : ''})
            </React.Fragment>
          ))}.
          {' '}A sub-cent security can move hundreds or thousands of percent from a tiny starting quote
          while remaining an almost-total lifetime loss. This period percentage does not mean the investment
          recovered; verify the effective dates and market quotes if the move looks stale or erroneous.
        </div>
      )}

      <div id="gl-chart-time" style={{ minHeight: chartData?.portfolio_series?.dates?.length ? '450px' : '0', marginBottom: '2rem' }} />
      <div id="gl-chart-bar" style={{ minHeight: chartData?.performance_rows?.length ? '400px' : '0', marginBottom: '2rem' }} />
      <div id="gl-chart-waterfall" style={{ minHeight: chartData?.performance_rows?.length ? '400px' : '0', marginBottom: '2rem' }} />
      {chartData?.realized_rows?.length > 0 && (
        <div id="gl-chart-realized" style={{ minHeight: '380px', marginBottom: '2rem' }} />
      )}
      {chartData && !chartLoading && !chartData.realized_rows?.length && (
        <p style={{ color: 'var(--p-556677)', fontStyle: 'italic', textAlign: 'center', marginBottom: '2rem' }}>No realized sales occurred inside the selected performance range.</p>
      )}
    </div>
  )
}
