import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../context/ThemeContext'
import { themedPlotlyLayout } from '../utils/chartTheme'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { API_BASE } from '../config'
import { formatMoney, formatMoneyCompact } from '../utils/money'

const PERIODS = [
  { value: '5D', label: '5D' },
  { value: '1M', label: '1M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: '3Y', label: '3Y' },
  { value: '5Y', label: '5Y' },
  { value: 'ALL', label: 'Since Inception' },
]

const TABS = [
  'Overview',
  'Fund Basics',
  'Distributions',
  'Pricing Information',
  'Performance',
  'Portfolio Characteristics',
  'About Closed-End Funds',
]

const fmtMoney = (value, digits = 2) => {
  return formatMoney(value, { digits, fallback: '-' })
}

const fmtPct = (value, signed = false) => {
  if (value == null || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  const sign = signed && n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

const fmtNumber = (value) => {
  if (value == null || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString()
}

const fmtAssets = (value) => {
  if (value == null || value === '') return '-'
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return formatMoneyCompact(n * 1e6)
}

const fmtDate = (value) => {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString()
}

const metricClass = (value) => {
  if (value == null || value === '') return ''
  return Number(value) >= 0 ? 'cef-positive' : 'cef-negative'
}

function InfoRow({ label, value }) {
  return (
    <div className="cef-info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DataTable({ rows }) {
  return (
    <div className="cef-table-card">
      <table className="cef-metric-table">
        <thead>
          <tr>
            <th></th>
            <th>Share Price</th>
            <th>NAV</th>
            <th>Premium / Discount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.price}</td>
              <td>{row.nav}</td>
              <td className={metricClass(row.discountRaw)}>{row.discount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FundChart({ detail }) {
  const { isDark } = useTheme()
  const chartRef = useRef(null)

  useEffect(() => {
    if (!detail?.history?.length || !chartRef.current || !window.Plotly) return

    const dates = detail.history.map(row => row.DataDateDisplay || row.DataDate)
    const prices = detail.history.map(row => row.Data)
    const navs = detail.history.map(row => row.NAVData)

    const traces = [
      {
        x: dates,
        y: navs,
        type: 'scatter',
        mode: 'lines',
        name: 'NAV',
        line: { color: '#58c4d8', width: 2.5 },
        hovertemplate: '%{x}<br>NAV: $%{y:.2f}<extra></extra>',
      },
      {
        x: dates,
        y: prices,
        type: 'scatter',
        mode: 'lines',
        name: 'Price',
        line: { color: '#f0c66e', width: 2.5 },
        hovertemplate: '%{x}<br>Price: $%{y:.2f}<extra></extra>',
      },
    ]

    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#16213e',
      plot_bgcolor: '#16213e',
      margin: { l: 56, r: 22, t: 34, b: 52 },
      height: 430,
      xaxis: { gridcolor: '#20324d', type: 'category', tickangle: -35, nticks: 12 },
      yaxis: { title: 'Closing Price ($)', gridcolor: '#20324d', tickprefix: '$' },
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.08 },
      hovermode: 'x unified',
    }

    window.Plotly.newPlot(chartRef.current, traces, themedPlotlyLayout(layout, isDark), { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [detail, isDark])

  return <div ref={chartRef} className="cef-chart" />
}

function TotalReturnChart({ ticker, period }) {
  const { isDark } = useTheme()
  const chartRef = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`${API_BASE}/api/closed-cef/fund/${encodeURIComponent(ticker)}/total-return?period=${encodeURIComponent(period)}`, { cache: 'no-store' })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Could not load total return.')
        if (!cancelled) setData(payload)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ticker, period])

  useEffect(() => {
    if (!data || !chartRef.current || !window.Plotly) return
    const navHasData = Array.isArray(data.nav_dates) && data.nav_dates.length > 0
    const priceHasData = Array.isArray(data.price_dates) && data.price_dates.length > 0
    if (!navHasData && !priceHasData) {
      window.Plotly.purge(chartRef.current)
      return
    }

    const traces = []
    if (navHasData) {
      traces.push({
        x: data.nav_dates,
        y: data.nav_total_return,
        type: 'scatter',
        mode: 'lines',
        name: 'NAV Total Return',
        line: { color: '#58c4d8', width: 2.5 },
        hovertemplate: '%{x}<br>NAV TR: %{y:.2f}%<extra></extra>',
      })
    }
    if (priceHasData) {
      traces.push({
        x: data.price_dates,
        y: data.price_total_return,
        type: 'scatter',
        mode: 'lines',
        name: 'Price Total Return',
        line: { color: '#4dff91', width: 2.5 },
        hovertemplate: '%{x}<br>Price TR: %{y:.2f}%<extra></extra>',
      })
    }

    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#16213e',
      plot_bgcolor: '#16213e',
      margin: { l: 56, r: 22, t: 34, b: 52 },
      height: 320,
      xaxis: { gridcolor: '#20324d', tickangle: -35, nticks: 10 },
      yaxis: { title: 'Total Return (%)', gridcolor: '#20324d', ticksuffix: '%' },
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.12 },
      hovermode: 'x unified',
      shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { dash: 'dot', color: '#556677', width: 1 } }],
    }

    window.Plotly.newPlot(chartRef.current, traces, themedPlotlyLayout(layout, isDark), { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [data, isDark])

  return (
    <section className="cef-chart-panel" style={{ marginTop: 18 }}>
      <h3 style={{ marginBottom: 4 }}>NAV vs Price Total Return</h3>
      <p className="cef-asof">Distributions reinvested. Normalized to 0% at period start.</p>
      {loading && <div className="cef-loading"><span className="spinner" /> Loading total return...</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <div ref={chartRef} className="cef-chart" />
      <p className="cef-note">Total return uses Yahoo Finance distribution history; past performance is no guarantee of future results.</p>
    </section>
  )
}

function PerformanceBarChart({ rows, title, asOf }) {
  const { isDark } = useTheme()
  const chartRef = useRef(null)

  useEffect(() => {
    if (!rows?.length || !chartRef.current || !window.Plotly) return

    const labels = rows.map(r => r.type)
    const num = v => {
      if (v == null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const traces = [
      { name: 'Price', y: rows.map(r => num(r.price_total_return)), marker: { color: '#58c4d8' } },
      { name: 'NAV', y: rows.map(r => num(r.nav_total_return)), marker: { color: '#9bd3dc' } },
      { name: 'Category - Price', y: rows.map(r => num(r.category_price_total_return)), marker: { color: '#f0c66e' } },
      { name: 'Category - NAV', y: rows.map(r => num(r.category_nav_total_return)), marker: { color: '#f5e2a8' } },
    ].map(t => ({
      ...t,
      x: labels,
      type: 'bar',
      text: t.y.map(v => v == null ? '' : `${v.toFixed(2)}%`),
      textposition: 'outside',
      hovertemplate: `${t.name}: %{y:.2f}%<extra></extra>`,
    }))

    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#16213e',
      plot_bgcolor: '#16213e',
      margin: { l: 56, r: 22, t: 34, b: 52 },
      height: 380,
      barmode: 'group',
      xaxis: { gridcolor: '#20324d', type: 'category', categoryorder: 'array', categoryarray: labels },
      yaxis: { title: 'Percent (%)', gridcolor: '#20324d', ticksuffix: '%' },
      legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.18 },
    }

    window.Plotly.newPlot(chartRef.current, traces, themedPlotlyLayout(layout, isDark), { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [rows, isDark])

  return (
    <section className="cef-chart-panel">
      <h3 style={{ marginBottom: 4 }}>{title}</h3>
      {asOf && <p className="cef-asof">{asOf}</p>}
      <div ref={chartRef} className="cef-chart" />
      <p className="cef-note">Past performance is no guarantee of future results.</p>
    </section>
  )
}

function SimpleCharacteristicsTable({ title, asOf, rows, columns }) {
  if (!rows?.length) return null

  return (
    <section className="cef-info-card cef-characteristics-section">
      <h3>{title}</h3>
      {asOf && <p className="cef-asof">{asOf}</p>}
      <table className="cef-characteristics-table">
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${title}-${index}`}>
              {columns.map((column, colIndex) => (
                <td key={column.key} className={colIndex > 0 ? 'cef-right' : ''}>
                  {colIndex === 0 ? (
                    <>
                      <strong>{row[column.key] || '-'}</strong>
                      {row.as_of && <span>{row.as_of}</span>}
                    </>
                  ) : (row[column.key] || '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function AssetAllocationChart({ allocation }) {
  const { isDark } = useTheme()
  const chartRef = useRef(null)
  const rows = allocation?.rows || []

  useEffect(() => {
    if (!rows.length || !chartRef.current || !window.Plotly) return

    const labels = rows.map(row => row.label)
    const values = rows.map(row => Number(row.value) || 0)
    const text = rows.map(row => row.display_value || fmtPct(row.value))

    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#16213e',
      plot_bgcolor: '#16213e',
      height: Math.max(260, rows.length * 72 + 120),
      margin: { l: 100, r: 28, t: 20, b: 52 },
      xaxis: { title: 'Portfolio %', gridcolor: '#20324d', ticksuffix: '%', rangemode: 'tozero' },
      yaxis: { type: 'category', categoryorder: 'array', categoryarray: labels },
      showlegend: false,
    }
    const traces = [{
      x: values,
      y: labels,
      type: 'bar',
      orientation: 'h',
      marker: { color: '#58c4d8', line: { color: '#9bd3dc', width: 1 } },
      text,
      textposition: 'auto',
      hovertemplate: '%{y}: %{x:.2f}%<extra></extra>',
    }]

    window.Plotly.newPlot(chartRef.current, traces, themedPlotlyLayout(layout, isDark), { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [rows, isDark])

  if (!rows.length) return null

  return (
    <section className="cef-info-card cef-characteristics-section">
      <h3>Asset Allocation</h3>
      {allocation?.as_of && <p className="cef-asof">{allocation.as_of}</p>}
      <div ref={chartRef} className="cef-asset-chart" />
    </section>
  )
}

function FundDetail({ ticker }) {
  const [period, setPeriod] = useState('1Y')
  const [tab, setTab] = useState('Overview')
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [performance, setPerformance] = useState(null)
  const [perfLoading, setPerfLoading] = useState(false)
  const [perfError, setPerfError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`${API_BASE}/api/closed-cef/fund/${encodeURIComponent(ticker)}?period=${encodeURIComponent(period)}`, { cache: 'no-store' })
      .then(async r => {
        const data = await r.json()
        if (!r.ok || data.error) throw new Error(data.error || 'Could not load fund details.')
        setDetail(data)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticker, period])

  useEffect(() => {
    if (tab !== 'Performance' || performance || perfLoading) return
    setPerfLoading(true)
    setPerfError('')
    fetch(`${API_BASE}/api/closed-cef/fund/${encodeURIComponent(ticker)}/performance`, { cache: 'no-store' })
      .then(async r => {
        const data = await r.json()
        if (!r.ok || data.error) throw new Error(data.error || 'Could not load performance.')
        setPerformance(data)
      })
      .catch(e => setPerfError(e.message))
      .finally(() => setPerfLoading(false))
  }, [tab, ticker, performance, perfLoading])

  const fund = detail?.fund
  const stats = detail?.period_stats || {}
  const characteristics = detail?.portfolio_characteristics || {}
  const periodLabel = PERIODS.find(item => item.value === period)?.label || period
  const overviewRows = [
    {
      label: 'Current',
      price: fmtMoney(stats.price?.current ?? fund?.price),
      nav: fmtMoney(stats.nav?.current ?? fund?.nav),
      discount: fmtPct(stats.premium_discount?.current ?? fund?.premium_discount),
      discountRaw: stats.premium_discount?.current ?? fund?.premium_discount,
    },
    {
      label: `${periodLabel} Avg`,
      price: fmtMoney(stats.price?.average),
      nav: fmtMoney(stats.nav?.average),
      discount: fmtPct(stats.premium_discount?.average),
      discountRaw: stats.premium_discount?.average,
    },
    {
      label: `${periodLabel} High`,
      price: fmtMoney(stats.price?.high),
      nav: fmtMoney(stats.nav?.high),
      discount: fmtPct(stats.premium_discount?.high),
      discountRaw: stats.premium_discount?.high,
    },
    {
      label: `${periodLabel} Low`,
      price: fmtMoney(stats.price?.low),
      nav: fmtMoney(stats.nav?.low),
      discount: fmtPct(stats.premium_discount?.low),
      discountRaw: stats.premium_discount?.low,
    },
  ]

  return (
    <div className="cef-detail">
      <Link to="/closed-cef-info" className="cef-back-link">Back to CEF list</Link>
      {loading && <div className="cef-loading"><span className="spinner" /> Loading CEF detail...</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!loading && fund && (
        <>
          <div className="cef-detail-header">
            <div>
              <h1>{fund.name}:{fund.ticker}</h1>
              <p>{fund.strategy || fund.category || 'Closed-end fund'}</p>
            </div>
            <a className="btn btn-secondary" href={fund.source_url} target="_blank" rel="noreferrer">Open on CEF Connect</a>
          </div>

          <div className="cef-tabs">
            {TABS.map(item => (
              <button key={item} className={`cef-tab${tab === item ? ' active' : ''}`} onClick={() => setTab(item)}>
                {item}
              </button>
            ))}
          </div>

          {tab === 'Overview' && (
            <div className="cef-detail-grid">
              <section>
                <h2>Overview</h2>
                <p className="cef-asof">As of {fmtDate(fund.last_updated)}</p>
                <DataTable rows={overviewRows} />
                <div className="cef-info-card">
                  <InfoRow label="Distribution Rate" value={fmtPct(fund.distribution_rate_price)} />
                  <InfoRow label="Distribution Amount" value={fmtMoney(fund.distribution_amount, 4)} />
                  <InfoRow label="Distribution Frequency" value={fund.distribution_frequency || '-'} />
                  <InfoRow label="Regular Distribution Type" value={fund.is_managed_distribution ? 'Managed Distribution' : 'Income / Regular'} />
                </div>
              </section>
              <section className="cef-chart-panel">
                <FundChart detail={detail} />
                <div className="cef-periods">
                  {PERIODS.map(item => (
                    <button key={item.value} className={`btn-sm${period === item.value ? ' btn-active' : ''}`} onClick={() => setPeriod(item.value)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="cef-note">Past performance is no guarantee of future results.</p>
                <TotalReturnChart ticker={ticker} period={period} />
              </section>
            </div>
          )}

          {tab === 'Fund Basics' && (
            <div className="cef-card-grid">
              <div className="cef-info-card">
                <InfoRow label="Sponsor" value={fund.sponsor || '-'} />
                <InfoRow label="Category" value={fund.category || '-'} />
                <InfoRow label="Strategy" value={fund.strategy || '-'} />
                <InfoRow label="CUSIP" value={fund.cusip || '-'} />
                <InfoRow label="Inception Date" value={fmtDate(fund.inception_date)} />
              </div>
              <div className="cef-info-card">
                <InfoRow label="Total Assets" value={fmtAssets(fund.total_assets_usd_m)} />
                <InfoRow label="Market Cap" value={fmtAssets(fund.market_cap_usd_m)} />
                <InfoRow label="Expense Ratio" value={fmtPct(fund.expense_ratio)} />
                <InfoRow label="Leverage" value={fund.is_leveraged ? fmtPct(fund.leverage_ratio) : 'No'} />
                <InfoRow label="Average Daily Volume" value={fmtNumber(fund.avg_daily_volume)} />
              </div>
            </div>
          )}

          {tab === 'Distributions' && (
            <div className="cef-card-grid">
              <div className="cef-info-card">
                <InfoRow label="Distribution Rate on Price" value={fmtPct(fund.distribution_rate_price)} />
                <InfoRow label="Distribution Rate on NAV" value={fmtPct(fund.distribution_rate_nav)} />
                <InfoRow label="Current Distribution" value={fmtMoney(fund.distribution_amount, 4)} />
                <InfoRow label="Frequency" value={fund.distribution_frequency || '-'} />
                <InfoRow label="Distribution Date" value={fmtDate(fund.distribution_date)} />
              </div>
              <div className="cef-disclosure">
                <strong>Distribution source note</strong>
                <p>Distribution data is sourced from CEF Connect. Review the fund sponsor site for the most recent source-of-distribution details and Section 19(a) notices where applicable.</p>
              </div>
            </div>
          )}

          {tab === 'Pricing Information' && (
            <div className="cef-detail-grid">
              <section>
                <h2>Pricing Information</h2>
                <DataTable rows={overviewRows} />
                <div className="cef-info-card">
                  <InfoRow label="NAV Ticker" value={fund.nav_ticker || '-'} />
                  <InfoRow label="NAV Published" value={fmtDate(fund.nav_published)} />
                  <InfoRow label="52 Wk Price Avg" value={fmtMoney(fund.price_52wk_avg)} />
                  <InfoRow label="52 Wk Discount Avg" value={fmtPct(fund.discount_52wk_avg)} />
                </div>
              </section>
              <section className="cef-chart-panel">
                <FundChart detail={detail} />
                <div className="cef-periods">
                  {PERIODS.map(item => (
                    <button key={item.value} className={`btn-sm${period === item.value ? ' btn-active' : ''}`} onClick={() => setPeriod(item.value)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <TotalReturnChart ticker={ticker} period={period} />
              </section>
            </div>
          )}

          {tab === 'Performance' && (
            <>
              <div className="cef-card-grid">
                <div className="cef-info-card">
                  <InfoRow label="YTD Return on NAV" value={fmtPct(fund.return_on_nav_ytd, true)} />
                  <InfoRow label="YTD Return on Price" value={fmtPct(fund.return_on_price_ytd, true)} />
                  <InfoRow label="1 Yr Return on NAV" value={fmtPct(fund.return_on_nav_1y, true)} />
                  <InfoRow label="1 Yr Return on Price" value={fmtPct(fund.return_on_price_1y, true)} />
                </div>
                <div className="cef-info-card">
                  <InfoRow label="3 Yr Return on NAV" value={fmtPct(fund.return_on_nav_3y, true)} />
                  <InfoRow label="3 Yr Return on Price" value={fmtPct(fund.return_on_price_3y, true)} />
                  <InfoRow label="5 Yr Return on NAV" value={fmtPct(fund.return_on_nav_5y, true)} />
                  <InfoRow label="5 Yr Return on Price" value={fmtPct(fund.return_on_price_5y, true)} />
                </div>
              </div>

              {perfLoading && <div className="cef-loading"><span className="spinner" /> Loading performance...</div>}
              {perfError && <div className="alert alert-error">{perfError}</div>}
              {performance?.annualized?.length > 0 && (
                <PerformanceBarChart
                  rows={performance.annualized}
                  title="Annualized Total Returns"
                  asOf="Returns for periods less than one year are cumulative rather than annualized."
                />
              )}
              {performance?.calendar?.length > 0 && (
                <PerformanceBarChart
                  rows={performance.calendar}
                  title="Calendar Year Total Returns"
                />
              )}
            </>
          )}

          {tab === 'About Closed-End Funds' && (
            <div className="cef-about">
              <section className="cef-info-card">
                <h2>About Closed-End Funds</h2>
                <h3>What is the difference between Price and NAV?</h3>
                <p>
                  The difference between Price and NAV in a closed-end fund (CEF) comes down to
                  market forces vs. actual underlying value.
                </p>

                <h4>Core Answer</h4>
                <p>
                  <strong>NAV</strong> is the true per-share value of the fund's underlying holdings.
                  <br />
                  <strong>Price</strong> is what investors choose to pay for the fund on the stock exchange.
                </p>
                <p>
                  Because CEFs trade like stocks, price often diverges from NAV, creating premiums and discounts.
                </p>

                <h4>Detailed Breakdown</h4>

                <h5>1. Net Asset Value (NAV) — Intrinsic value</h5>
                <p>NAV is calculated once per day:</p>
                <p className="cef-formula">
                  NAV = (Total Value of Assets − Liabilities) / Shares Outstanding
                </p>
                <p>NAV reflects:</p>
                <ul>
                  <li>The market value of the fund's portfolio</li>
                  <li>Accrued income</li>
                  <li>Expenses and leverage effects</li>
                </ul>
                <p>NAV is not influenced by supply/demand for the fund's shares.</p>

                <h5>2. Market Price — What buyers and sellers agree on</h5>
                <p>CEFs trade on exchanges (NYSE, NASDAQ), so their price is set by:</p>
                <ul>
                  <li>Investor sentiment</li>
                  <li>Distribution yield chasing</li>
                  <li>Fear/greed</li>
                  <li>Liquidity</li>
                  <li>Market volatility</li>
                  <li>Manager reputation</li>
                </ul>
                <p>Price can move independently of NAV.</p>

                <h4>Premiums and Discounts</h4>
                <p>The key concept in CEFs:</p>
                <p className="cef-formula">
                  Premium / Discount = (Price − NAV) / NAV
                </p>
                <p>
                  <strong>Discount (Price &lt; NAV):</strong> You're buying the portfolio for less
                  than it's worth. Common in bond CEFs, high-yield CEFs, and during risk-off markets.
                </p>
                <p>
                  <strong>Premium (Price &gt; NAV):</strong> You're paying more than the underlying
                  assets are worth. Happens when:
                </p>
                <ul>
                  <li>Distribution yield is unusually high</li>
                  <li>Fund has a cult following</li>
                  <li>Managed distribution policy attracts income investors</li>
                </ul>

                <h4>Why CEFs trade away from NAV (unlike ETFs)?</h4>
                <p>
                  ETFs have an arbitrage mechanism (APs) that keeps price ≈ NAV. CEFs do not. Once
                  launched, share count is fixed.
                </p>
                <p>So:</p>
                <ul>
                  <li>No arbitrage</li>
                  <li>No creation/redemption</li>
                  <li>Price floats freely</li>
                </ul>
                <p>This is why CEFs can trade at persistent discounts for years.</p>

                <h4>Practical Example</h4>
                <p>If a CEF has:</p>
                <ul>
                  <li>NAV = $10.00</li>
                  <li>Market Price = $8.50</li>
                </ul>
                <p>Then:</p>
                <p className="cef-formula">
                  Discount = (8.50 − 10.00) / 10.00 = −15%
                </p>
                <p>You're buying the portfolio at a 15% discount.</p>

                <h4>Why this matters for income-focused investors</h4>
                <p>The discount/premium behavior affects:</p>
                <ul>
                  <li><strong>Yield on price</strong> — discounts boost it</li>
                  <li><strong>Future returns</strong> — discount narrowing adds alpha</li>
                  <li><strong>Risk</strong> — wide discounts often signal stress</li>
                </ul>
              </section>
            </div>
          )}

          {tab === 'Portfolio Characteristics' && (
            <div className="cef-characteristics-grid">
              <div>
                <SimpleCharacteristicsTable
                  title="Portfolio Characteristics"
                  rows={characteristics.summary}
                  columns={[
                    { key: 'label' },
                    { key: 'value' },
                  ]}
                />
                <AssetAllocationChart allocation={characteristics.asset_allocation} />
                <SimpleCharacteristicsTable
                  title="Top Sectors"
                  asOf={characteristics.top_sectors?.as_of}
                  rows={characteristics.top_sectors?.rows}
                  columns={[
                    { key: 'label' },
                    { key: 'value' },
                  ]}
                />
              </div>
              <div>
                <SimpleCharacteristicsTable
                  title="Top Holdings"
                  asOf={characteristics.top_holdings?.as_of}
                  rows={characteristics.top_holdings?.rows}
                  columns={[
                    { key: 'holding' },
                    { key: 'value' },
                    { key: 'portfolio_pct' },
                  ]}
                />
                <SimpleCharacteristicsTable
                  title="Country Allocation"
                  asOf={characteristics.country_allocation?.as_of}
                  rows={characteristics.country_allocation?.rows}
                  columns={[
                    { key: 'label' },
                    { key: 'value' },
                  ]}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function ClosedCEFInformation() {
  const { isDark } = useTheme()
  const { ticker } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [strategy, setStrategy] = useState('')
  const [sort, setSort] = useState('ticker')

  const loadPricing = useCallback(() => {
    setLoading(true)
    setError('')
    fetch(`${API_BASE}/api/closed-cef/pricing`, { cache: 'no-store' })
      .then(async r => {
        const payload = await r.json()
        if (!r.ok || payload.error) throw new Error(payload.error || 'Could not load CEF pricing.')
        setData(payload)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!ticker) loadPricing()
  }, [ticker, loadPricing])

  const filteredRows = useMemo(() => {
    const rows = data?.rows || []
    const q = query.trim().toLowerCase()
    const result = rows.filter(row => {
      if (category && row.category !== category) return false
      if (strategy && row.strategy !== strategy) return false
      if (!q) return true
      return [row.ticker, row.name, row.strategy, row.category, row.sponsor]
        .some(value => String(value || '').toLowerCase().includes(q))
    })
    return [...result].sort((a, b) => {
      if (sort === 'discount') return Number(a.premium_discount ?? 999) - Number(b.premium_discount ?? 999)
      if (sort === 'yield') return Number(b.distribution_rate_price ?? -1) - Number(a.distribution_rate_price ?? -1)
      if (sort === 'return') return Number(b.return_on_nav_1y ?? -999) - Number(a.return_on_nav_1y ?? -999)
      return String(a[sort] || '').localeCompare(String(b[sort] || ''))
    })
  }, [data, query, category, strategy, sort])

  if (ticker) {
    return (
      <div className="page cef-page">
        <FundDetail ticker={ticker} />
      </div>
    )
  }

  return (
    <div className="page cef-page">
      <div className="cef-title-row">
        <div>
          <h1>Closed CEF Information</h1>
          <p>Daily closed-end fund pricing, discounts, distributions, and in-app fund detail pages.</p>
        </div>
        <button className="btn btn-primary" onClick={loadPricing} disabled={loading}>Refresh</button>
      </div>

      <div className="cef-controls">
        <label>
          Search
          <input value={query} onChange={e => setQuery(e.target.value.toUpperCase())} placeholder="Ticker, fund, sponsor..." />
        </label>
        <label>
          Category
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(data?.categories || []).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Strategy
          <select value={strategy} onChange={e => setStrategy(e.target.value)}>
            <option value="">All strategies</option>
            {(data?.strategies || []).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={e => setSort(e.target.value)}>
            <option value="ticker">Ticker</option>
            <option value="name">Fund Name</option>
            <option value="discount">Premium / Discount</option>
            <option value="yield">Distribution Rate</option>
            <option value="return">1 Yr Return on NAV</option>
          </select>
        </label>
      </div>

      {loading && <div className="cef-loading"><span className="spinner" /> Loading CEF Connect daily pricing...</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {data && !loading && (
        <>
          <div className="cef-summary-strip">
            <span>{filteredRows.length.toLocaleString()} of {data.total.toLocaleString()} funds</span>
            <span>Updated {fmtDate(data.last_updated)}</span>
            <a href={data.source_url} target="_blank" rel="noreferrer">CEF Connect daily pricing</a>
          </div>

          <div className="cef-table-wrap">
            <table className="cef-list-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Fund Name</th>
                  <th>Strategy</th>
                  <th>Price</th>
                  <th>Change</th>
                  <th>NAV</th>
                  <th>Premium / Discount</th>
                  <th>Distribution Rate</th>
                  <th>Rate on NAV</th>
                  <th>1 Yr NAV Rtn</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={row.ticker}>
                    <td>
                      <button className="cef-ticker-link" onClick={() => navigate(`/closed-cef-info/${encodeURIComponent(row.ticker)}`)}>
                        {row.ticker}
                      </button>
                    </td>
                    <td>{row.name}</td>
                    <td>{row.strategy || row.category || '-'}</td>
                    <td>{fmtMoney(row.price)}</td>
                    <td className={metricClass(row.price_change)}>{fmtMoney(row.price_change)}</td>
                    <td>{fmtMoney(row.nav)}</td>
                    <td className={metricClass(row.premium_discount)}>{fmtPct(row.premium_discount)}</td>
                    <td>{fmtPct(row.distribution_rate_price)}</td>
                    <td>{fmtPct(row.distribution_rate_nav)}</td>
                    <td className={metricClass(row.return_on_nav_1y)}>{fmtPct(row.return_on_nav_1y, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="cef-source-note">
            Data is displayed from CEF Connect. CEF Connect states that its closed-end fund data is supplied by Morningstar and should not be treated as investment advice.
          </p>
        </>
      )}
    </div>
  )
}
