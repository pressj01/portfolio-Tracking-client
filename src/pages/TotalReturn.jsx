import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { returnVsYield } from '../utils/returnVsYield'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { formatMoney, formatMoneyWhole, getCurrencyLabel } from '../utils/money'

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

const PREVIOUS_CALENDAR_YEAR = new Date().getFullYear() - 1
const COMPARISON_PERIODS = [
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: '5y', label: '5Y' },
  { key: '10y', label: '10Y' },
  { key: 'max', label: 'ALL/MAX' },
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

const formatComparisonDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`
}

const formatComparisonRange = (start, end) => {
  const startLabel = formatComparisonDate(start)
  const endLabel = formatComparisonDate(end)
  return startLabel && endLabel ? `${startLabel}–${endLabel}` : ''
}

function MetricCard({ label, value, range, className }) {
  return (
    <div className={`summary-card ${className || ''}`}>
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '—'}</div>
      {range && (
        <div style={{ marginTop: '0.3rem', color: 'var(--text-dim)', fontSize: '0.72rem', lineHeight: 1.25 }}>
          {range}
        </div>
      )}
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
  const [rvyMode, setRvyMode] = useState('cur')
  const [scatterReturnMode, setScatterReturnMode] = useState('pct')
  const [dashboardPeriod, setDashboardPeriod] = useState('1y')
  const [dashboardCalendarYear, setDashboardCalendarYear] = useState(String(PREVIOUS_CALENDAR_YEAR))

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
    setSummaryLoading(true)
    setSummaryError(null)
    const params = new URLSearchParams()
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    pf(`/api/total-return/summary?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setSummary(d)
      })
      .catch(e => setSummaryError(e.message))
      .finally(() => setSummaryLoading(false))
  }, [categories, subcategories, selection, basisMode])

  // Fetch yfinance charts
  useEffect(() => {
    setChartLoading(true)
    setChartError(null)
    setChartData(null)
    const params = new URLSearchParams({ period: dashboardPeriod })
    if (categories.length) params.set('category', categories.join(','))
    if (subcategories.length) params.set('subcategory', subcategories.join(','))
    pf(`/api/total-return/charts?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setChartData(d)
      })
      .catch(e => setChartError(e.message))
      .finally(() => setChartLoading(false))
  }, [categories, subcategories, dashboardPeriod, selection])

  // Render Plotly charts with consistent colors across bar + line charts
  useEffect(() => {
    if (!chartData || !window.Plotly) return
    const Plotly = window.Plotly
    const cfg = { responsive: true }
    const ids = []

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
          text: `${scatterReturnMode === 'dollar' ? `Total Return (${getCurrencyLabel()})` : 'Total Return %'} vs Annual Yield on Cost — ${chartData?.period_label || 'Selected Period'}`,
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
  }, [dashboardRows, chartData?.period_label, scatterReturnMode, isDark])

  // Fetch comparison chart data
  useEffect(() => {
    if (!cmpPortfolio && cmpTickers.length === 0 && !cmpExtra) { setCmpData(null); return }

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

    setCmpLoading(true)
    setCmpError(null)
    const params = new URLSearchParams({ period: dashboardPeriod })
    if (cmpPortfolio) params.set('portfolio', '1')
    if (cmpTickers.length) params.set('tickers', cmpTickers.join(','))
    if (cmpExtra) params.set('extra', cmpExtra)
    pf(`/api/total-return/compare?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setCmpData(d)
      })
      .catch(e => setCmpError(e.message))
      .finally(() => setCmpLoading(false))
  }, [
    cmpPortfolio,
    cmpTickers,
    cmpExtra,
    dashboardPeriod,
    selection,
    categories,
    subcategories,
    chartData,
    chartLoading,
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

    const comparisonRange = formatComparisonRange(
      cmpData.requested_start_date || cmpData.actual_start_date,
      cmpData.requested_end_date || cmpData.actual_end_date,
    )
    const modeLabel = cmpMode === 'both'
      ? 'Total Return & Price Only'
      : (COMPARISON_RETURN_MODES.find(mode => mode.key === cmpMode)?.label || 'Return')
    const layout = {
      title: {
        text: `${modeLabel} Comparison — ${cmpData.period_label}${comparisonRange ? ` · ${comparisonRange}` : ''} (normalized to 100)`,
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
      margin: { t: 50, b: 80, l: 60, r: 20 },
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

  const handleCalendarYearSubmit = (e) => {
    e.preventDefault()
    const year = Number(dashboardCalendarYear)
    const currentYear = new Date().getFullYear()
    if (!Number.isInteger(year) || year < 1900 || year > currentYear) return
    setDashboardPeriod(String(year))
  }

  // Table sorting
  const handleSort = (col) => {
    if (sortCol === col) { setSortAsc(a => !a) }
    else {
      setSortCol(col)
      const numCols = ['start_value', 'end_value', 'price_return_dollar', 'price_return_pct', 'distribution_dollar', 'total_return_dollar', 'total_return_pct', 'ret_vs_yld_sort']
      setSortAsc(!numCols.includes(col))
    }
  }

  const enrichedRows = useMemo(() => {
    if (!dashboardRows.length) return []
    return dashboardRows.map(r => {
      const primaryYld = rvyMode === 'yoc' ? (r.annual_yield_on_cost || 0) : (r.current_annual_yield || 0)
      const yld = (primaryYld || (r.annual_yield_on_cost || 0)) * 100
      const rvy = r.total_return_pct != null ? returnVsYield(r.total_return_pct, yld) : null
      return { ...r, ret_vs_yld: rvy, ret_vs_yld_sort: rvy ? rvy.spread : -999 }
    })
  }, [dashboardRows, rvyMode])

  const sortedRows = useMemo(() => {
    if (!enrichedRows.length) return []
    if (!sortCol) return enrichedRows
    const rows = [...enrichedRows]
    rows.sort((a, b) => {
      let av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      av = String(av).toLowerCase(); bv = String(bv).toLowerCase()
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return rows
  }, [enrichedRows, sortCol, sortAsc])

  const sortIcon = (col) => {
    if (sortCol !== col) return ' \u21C5'
    return sortAsc ? ' \u25B2' : ' \u25BC'
  }

  const allTickers = useMemo(() => summary?.rows?.map(r => r.ticker) || [], [summary])

  const columns = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'category_name', label: 'Category' },
    { key: 'start_value', label: 'Start Value', fmt },
    { key: 'end_value', label: 'End Value', fmt },
    { key: 'price_return_dollar', label: 'Price Return', fmt },
    { key: 'price_return_pct', label: 'Price Ret %', fmt: fmtPct },
    { key: 'distribution_dollar', label: 'Distributions', fmt },
    { key: 'total_return_dollar', label: 'Total Return', fmt },
    { key: 'total_return_pct', label: 'Total Ret %', fmt: fmtPct },
    { key: 'period_range', label: 'Effective Range' },
    { key: 'ret_vs_yld', label: 'RvY', sortKey: 'ret_vs_yld_sort' },
  ]
  const numericColumns = new Set([
    'start_value',
    'end_value',
    'price_return_dollar',
    'price_return_pct',
    'distribution_dollar',
    'total_return_dollar',
    'total_return_pct',
  ])
  const columnAlign = (key) => numericColumns.has(key) ? 'right' : 'left'

  const t = chartData?.portfolio_metrics || {}
  const dashboardRequestedRange = formatComparisonRange(chartData?.requested_start_date, chartData?.requested_end_date)
  const dashboardActualRange = formatComparisonRange(chartData?.actual_start_date, chartData?.actual_end_date)
  const dashboardCardRange = dashboardActualRange || dashboardRequestedRange
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
          <label>Dashboard Date Range</label>
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {COMPARISON_PERIODS.map(periodOption => (
              <button
                type="button"
                key={periodOption.key}
                className={`tr-pbtn${dashboardPeriod === periodOption.key ? ' tr-pbtn-active' : ''}`}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                onClick={() => setDashboardPeriod(periodOption.key)}
              >
                {periodOption.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleCalendarYearSubmit} className="growth-filter-group">
          <label htmlFor="tr-dashboard-calendar-year">Calendar Year</label>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <input
              id="tr-dashboard-calendar-year"
              type="number"
              min="1900"
              max={new Date().getFullYear()}
              step="1"
              required
              value={dashboardCalendarYear}
              onChange={e => setDashboardCalendarYear(e.target.value)}
              style={{ width: '6.5rem', padding: '0.25rem 0.45rem', fontSize: '0.8rem' }}
            />
            <button
              type="submit"
              className={`tr-pbtn tr-pbtn-year${dashboardPeriod === dashboardCalendarYear ? ' tr-pbtn-active' : ''}`}
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.8rem' }}
            >
              View
            </button>
          </div>
        </form>
      </div>

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
            {t.distribution_source ? ` Distribution dollars use ${t.distribution_source.toLowerCase()}.` : ''}
            {' '}Because capital changes during the period, dollar return divided by start value may not equal the time-weighted return percentage.
          </p>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <MetricCard label="Start Value" value={fmtInt(t.start_value)} range={dashboardCardRange} />
            <MetricCard label="End Value" value={fmtInt(t.end_value)} range={dashboardCardRange} />
            <MetricCard label="Price Return" range={dashboardCardRange}
              value={<span style={{ color: (t.price_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtInt(t.price_return_dollar)}</span>} />
            <MetricCard label="Distributions" value={fmtInt(t.distribution_dollar)} range={dashboardCardRange} />
            <MetricCard label="Total Return" range={dashboardCardRange}
              value={<span style={{ color: (t.total_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtInt(t.total_return_dollar)}</span>} />
            <MetricCard label="Total Return %" range={dashboardCardRange}
              value={<span style={{ color: (t.total_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(t.total_return_pct)}</span>} />
            {chartData?.spy_ret != null && (
              <MetricCard label={`SPY - ${chartData.period_label || '1Y'}`}
                range={spyRange}
                value={<span style={{ color: chartData.spy_ret >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{fmtPct(chartData.spy_ret)}</span>} />
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
          This chart uses the page-wide Dashboard Date Range above. Rolling periods use broker-style calendar date-to-date boundaries;
          the calendar-year choice covers January 1 through December 31.
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
            <label>Dashboard Date Range</label>
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
      {summary && !summaryLoading && !chartLoading && dashboardRows.length > 0 && (
        <>
          <h2 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }}>Holdings — {chartData?.period_label} Total Return Summary</h2>
          <p style={{ color: 'var(--text-dim)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
            Requested range: <strong>{dashboardRequestedRange || dashboardActualRange}</strong>. Each row lists its effective held-period range. Click any column header to sort.
          </p>
          <div className="sticky-table-wrap" style={{ maxHeight: '70vh' }}>
            <table>
              <thead>
                <tr>
                  {columns.map(col => {
                    const sk = col.sortKey || col.key
                    if (col.key === 'ret_vs_yld') {
                      return (
                        <th key={col.key} style={{ textAlign: 'center', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none' }} title="Total return vs yield — Good means total return exceeds yield, Poor means yield exceeds total return">
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
                      <th key={col.key} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: columnAlign(col.key) }} onClick={() => handleSort(sk)}>
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
                {sortedRows.map(row => (
                  <tr key={row.ticker}>
                    {columns.map(col => {
                      const val = row[col.key]
                      let display = col.fmt ? col.fmt(val) : (val ?? '')
                      let style = { textAlign: columnAlign(col.key) }

                      if (col.key === 'ticker') display = <strong>{val}</strong>
                      if (col.key === 'price_return_dollar' || col.key === 'price_return_pct' || col.key === 'total_return_dollar' || col.key === 'total_return_pct') {
                        style = { textAlign: 'right', color: (val || 0) >= 0 ? '#4dff91' : '#ff6b6b' }
                      }
                      if (col.key === 'ret_vs_yld') {
                        const rvy = row.ret_vs_yld
                        display = rvy ? rvy.label : '—'
                        style = { textAlign: 'center', color: rvy?.color || '#6f7890', fontWeight: 600 }
                      }
                      return <td key={col.key} style={style} title={col.key === 'ret_vs_yld' && row.ret_vs_yld ? `Spread: ${row.ret_vs_yld.spread.toFixed(2)}%` : undefined}>{display}</td>
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                  <td colSpan={2}><strong>Portfolio Total</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{fmt(t.start_value)}</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{fmt(t.end_value)}</strong></td>
                  <td style={{ textAlign: 'right', color: (t.price_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(t.price_return_dollar)}</strong></td>
                  <td style={{ textAlign: 'right', color: (t.price_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmtPct(t.price_return_pct)}</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{fmt(t.distribution_dollar)}</strong></td>
                  <td style={{ textAlign: 'right', color: (t.total_return_dollar || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmt(t.total_return_dollar)}</strong></td>
                  <td style={{ textAlign: 'right', color: (t.total_return_pct || 0) >= 0 ? 'var(--pos)' : 'var(--neg)' }}><strong>{fmtPct(t.total_return_pct)}</strong></td>
                  <td>{dashboardCardRange}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
