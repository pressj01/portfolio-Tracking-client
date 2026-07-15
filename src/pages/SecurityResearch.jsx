import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import { API_BASE } from '../config'
import DistributionHistoryChart from '../components/DistributionHistoryChart'
import { returnVsYield } from '../utils/returnVsYield'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { convertMoneyValue, formatMoney, formatMoneyCompact, getCurrencySymbol } from '../utils/money'

const fmtMoney = (v) => {
  if (v == null) return '-'
  const n = Number(v)
  const abs = Math.abs(n)
  if (abs >= 1e6) return formatMoneyCompact(n, { fallback: '-' })
  return formatMoney(n, { maximumFractionDigits: 2, minimumFractionDigits: 0, fallback: '-' })
}

const fmtNum = (v, d = 2) => v == null ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d })
const fmtPct = (v) => v == null ? '-' : Number(v).toFixed(2) + '%'
const fmtDate = (v) => v || '-'
const fmt = (v) => {
  return formatMoney(v)
}
const fmtAssets = (v) => {
  if (v == null) return '-'
  const n = Number(convertMoneyValue(v))
  if (!Number.isFinite(n)) return '-'
  const abs = Math.abs(n)
  const compact = (value) => value.toLocaleString(undefined, { maximumSignificantDigits: 4 })
  if (abs >= 1e9) return `${getCurrencySymbol()}${compact(n / 1e9)} Billion`
  if (abs >= 1e6) return `${getCurrencySymbol()}${compact(n / 1e6)} Million`
  return getCurrencySymbol() + compact(n)
}
const fmtPctVal = (v) => {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return sign + Number(v).toFixed(2) + '%'
}
const pctClass = (v) => {
  if (v == null) return ''
  return v >= 0 ? 'pct-up' : 'pct-down'
}

// ── ETF closure / small-AUM risk (fund too small to be profitable for the issuer) ──
// Mirrors the dashboard's tiers so a warning reads the same across the app.
const CLOSURE_TIER = {
  high: { rank: 3, label: 'High', color: 'var(--neg)' },
  elevated: { rank: 2, label: 'Elevated', color: 'var(--warning-money)' },
  watch: { rank: 1, label: 'Watch', color: 'var(--warning-text)' },
  ok: { rank: 0, label: 'OK', color: 'var(--pos)' },
  unknown: { rank: -1, label: '?', color: 'var(--text-dim)' },
}
const isAtClosureRisk = (info) => ['watch', 'elevated', 'high'].includes(info?.tier)

// Full closure-risk warning for the ETF lookup detail view. The backend already
// factored in fund size × expense ratio (fee revenue), AUM floors, and a grace
// period for newly launched funds, so we just render its verdict.
function ClosureRiskWarning({ info }) {
  if (!isAtClosureRisk(info)) return null
  const tier = CLOSURE_TIER[info.tier] || CLOSURE_TIER.unknown
  return (
    <div
      className="alert alert-warning"
      role="alert"
      style={{
        display: 'flex',
        gap: '0.7rem',
        alignItems: 'flex-start',
        borderColor: `color-mix(in srgb, ${tier.color} 55%, transparent)`,
        background: `color-mix(in srgb, ${tier.color} 12%, transparent)`,
      }}
    >
      <span style={{ color: tier.color, fontSize: '1.15rem', lineHeight: 1 }}>⚠</span>
      <div>
        <strong style={{ color: tier.color }}>
          {tier.label} closure risk — this fund's assets are small for its running costs.
        </strong>
        <p style={{ margin: '0.3rem 0 0' }}>{info.reason}</p>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
          ETF issuers earn roughly <em>assets × expense ratio</em> per year, so a fund that stays too
          small to cover its costs is a candidate for liquidation — which would force a sale (a
          possible taxable event) and reinvestment. Estimated from fund size and fees, not a closure
          announcement — confirm on the issuer's site. Informational only, not investment advice.
        </p>
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="research-field">
      <span>{label}</span>
      <strong>{value ?? '-'}</strong>
    </div>
  )
}

function ResearchChart({ ticker }) {
  const pf = useProfileFetch()
  const { isDark } = useTheme()
  const chartRef = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError('')
    setData(null)
    const cacheBust = Date.now()
    pf(`/api/ticker-return-1y/${encodeURIComponent(ticker)}?_=${cacheBust}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticker, pf])

  useEffect(() => {
    if (!data || !window.Plotly || !chartRef.current) return
    const ct = chartTheme(isDark)
    const traces = [
      {
        x: data.dates,
        y: data.price_return,
        type: 'scatter',
        mode: 'lines',
        name: 'Price Return',
        line: { color: '#7ecfff', width: 2.5 },
        hovertemplate: '%{y:.2f}%<extra>Price</extra>',
      },
      {
        x: data.dates,
        y: data.total_return || [],
        type: 'scatter',
        mode: 'lines',
        name: 'Total Return',
        line: { color: '#4dff91', width: 2.5 },
        hovertemplate: '%{y:.2f}%<extra>Total</extra>',
      },
    ]
    const layout = {
      template: ct.template,
      paper_bgcolor: ct.surface,
      plot_bgcolor: ct.surface,
      font: { color: ct.font },
      title: { text: `${data.ticker} - One Year Return`, font: { size: 16, color: ct.title } },
      margin: { l: 58, r: 22, t: 56, b: 42 },
      height: 440,
      xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, type: 'date' },
      yaxis: { title: 'Return %', gridcolor: ct.grid, zerolinecolor: ct.zeroline, ticksuffix: '%' },
      legend: { orientation: 'h', y: 1.05, x: 0.5, xanchor: 'center' },
      hovermode: 'x unified',
      shapes: data.dates?.length ? [{
        type: 'line',
        x0: data.dates[0],
        x1: data.dates[data.dates.length - 1],
        y0: 0,
        y1: 0,
        line: { dash: 'dot', color: ct.zeroline, width: 1 },
      }] : [],
    }
    window.Plotly.newPlot(chartRef.current, traces, layout, { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [data, isDark])

  return (
    <section className="research-chart-section" id="annual-chart">
      {loading && <div className="research-loading"><span className="spinner" /> Loading annual return chart...</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <div ref={chartRef} className="research-chart" />
    </section>
  )
}

function AverageReturnChart({ kind, ticker, benchmark }) {
  const pf = useProfileFetch()
  const { isDark } = useTheme()
  const chartRef = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const normalizedBenchmark = useMemo(() => (benchmark || 'SPY').trim().toUpperCase() || 'SPY', [benchmark])

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError('')
    setData(null)
    pf(`/api/security-research/${kind}/${encodeURIComponent(ticker)}/average-return?benchmark=${encodeURIComponent(normalizedBenchmark)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [kind, ticker, normalizedBenchmark, pf])

  useEffect(() => {
    if (!data || !window.Plotly || !chartRef.current) return
    const ct = chartTheme(isDark)

    const labels = (data.periods || []).map(row => row.label)
    const traces = (data.series || []).map((series) => ({
      x: labels,
      y: series.values,
      type: 'bar',
      name: series.name,
      marker: { color: series.color },
      text: (series.values || []).map(v => (v == null ? '' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`)),
      textposition: 'outside',
      hovertemplate: `<b>${series.name}</b><br>%{x}<br>%{y:.2f}%<extra></extra>`,
    }))

    const layout = {
      template: ct.template,
      paper_bgcolor: ct.surface,
      plot_bgcolor: ct.surface,
      font: { color: ct.font },
      title: {
        text: 'Average Return',
        font: { size: 16, color: ct.title },
      },
      barmode: 'group',
      margin: { l: 52, r: 20, t: 64, b: 48 },
      height: 430,
      xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
      yaxis: { title: 'Return %', gridcolor: ct.grid, zerolinecolor: ct.zeroline, ticksuffix: '%' },
      legend: { orientation: 'h', y: 1.08, x: 0.5, xanchor: 'center' },
      hovermode: 'x unified',
    }

    window.Plotly.newPlot(chartRef.current, traces, layout, { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [data, isDark])

  return (
    <section className="research-chart-section" id="average-return-chart">
      {loading && <div className="research-loading"><span className="spinner" /> Loading average return chart...</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {data?.summary && <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>{data.summary}</div>}
      {data?.note && <p className="research-muted" style={{ marginBottom: '0.75rem' }}>{data.note}</p>}
      <div ref={chartRef} className="research-chart" />
    </section>
  )
}

function DistributionChart({ history, ticker, price, source }) {
  const [pctMode, setPctMode] = useState(false)
  const [annual, setAnnual] = useState(false)

  if (!history?.length) return null

  return (
    <section className="research-chart-section" id="distribution-chart">
      <DistributionHistoryChart
        history={history}
        ticker={ticker}
        price={price}
        source={source}
        pctMode={pctMode}
        annual={annual}
        onTogglePctMode={() => { setPctMode(v => !v); setAnnual(false) }}
        onToggleAnnual={() => setAnnual(v => !v)}
        emptyLabel="this symbol"
      />
    </section>
  )
}

function ETFResult({ data, onOpenChart, return1y }) {
  const chartPrice = Number(data.price) > 0 ? data.price : data.nav_price
  const yieldLabel = data.yield_source && data.yield_source !== 'Yahoo Finance'
    ? `${data.target_yield_label || 'Estimated Yield'} (${data.yield_source})`
    : (data.target_yield_label || 'Estimated Yield')

  const rvy = returnVsYield(return1y, data.estimated_yield_pct ?? data.sec_30_day_yield_pct)

  const metrics = [
    ['Issuer', data.issuer],
    ['Category', data.category],
    ['Legal Type', data.legal_type],
    ['Expense Ratio', fmtPct(data.expense_ratio_pct)],
    [data.total_assets_label || 'Total Assets', fmtMoney(data.total_assets)],
    [data.nav_label || 'NAV', fmtMoney(data.nav_price)],
    ['Inception', fmtDate(data.inception_date)],
    ['Dividend Frequency', data.dividend_frequency || '-'],
    [yieldLabel, fmtPct(data.estimated_yield_pct)],
    ['30-Day SEC Yield', fmtPct(data.sec_30_day_yield_pct)],
    ['1Y Ret vs Yield', return1y == null ? '-' : <span style={{ color: rvy?.color || 'var(--p-6f7890)' }} title={rvy ? `1Y Return ${rvy.totalReturnPct?.toFixed(2)}% vs Yield ${rvy.yieldOnCost?.toFixed(2)}% (spread ${rvy.spread?.toFixed(2)}%)` : undefined}>{rvy?.label || '-'}</span>],
    ['TTM Dividend/Share', formatMoney(data.ttm_dividend_per_share, { digits: 4, fallback: '-' })],
    ['Last Dividend', data.last_dividend ? `${fmtMoney(data.last_dividend.amount)} on ${data.last_dividend.date}` : '-'],
    ['Source', (() => {
      const base = data.source_url ? <a href={data.source_url} target="_blank" rel="noreferrer">{data.data_source || 'Source'}</a> : (data.data_source || '-')
      if (data.yield_source && data.yield_source !== data.data_source) return <>{base} + {data.yield_source}</>
      return base
    })()],
  ]

  return (
    <div className="research-result">
      <div className="research-header">
        <div>
          <div className="research-kicker">{data.ticker} - {data.fund_type || 'ETF'}</div>
          <h2>{data.name}</h2>
        </div>
        <button type="button" className="btn btn-primary" onClick={onOpenChart}>Open Annual Chart</button>
      </div>

      <ClosureRiskWarning info={data.closure_risk} />

      <section className="research-section">
        <h3>Name & Description</h3>
        <p>{data.description || data.objective || '-'}</p>
      </section>

      <section className="research-grid">
        {metrics.map(([label, value]) => <Field key={label} label={label} value={value} />)}
      </section>

      <DistributionChart
        history={data.distribution_history}
        ticker={data.ticker}
        price={chartPrice}
        source={data.distribution_source || data.yield_source || data.data_source}
      />

      <section className="research-two-col">
        <div>
          <h3>Top 10 to 25 Holdings</h3>
          {data.top_holdings?.length ? (
            <table className="research-table">
              <thead><tr><th>Symbol</th><th>Name</th><th>Weight</th></tr></thead>
              <tbody>
                {data.top_holdings.map(h => (
                  <tr key={`${h.symbol}-${h.name}`}>
                    <td>{h.symbol}</td>
                    <td>{h.name}</td>
                    <td style={{ textAlign: 'right' }}>{fmtPct(h.weight_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="research-muted">Top holdings were not available for this symbol.</p>}
        </div>

        <div>
          <h3>Allocation</h3>
          {(data.sector_weightings?.length ? data.sector_weightings : data.asset_classes || []).slice(0, 10).map(row => (
            <div key={row.name} className="research-weight-row">
              <span>{row.name}</span>
              <div><i style={{ width: `${Math.min(100, row.weight_pct)}%` }} /></div>
              <strong>{fmtPct(row.weight_pct)}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function StockResult({ data, onOpenChart, return1y }) {
  const valuation = [
    ['Price', fmtMoney(data.price)],
    ['Market Cap', fmtMoney(data.market_cap)],
    ['Enterprise Value', fmtMoney(data.enterprise_value)],
    ['Beta', fmtNum(data.beta)],
    ['Trailing P/E', fmtNum(data.trailing_pe)],
    ['Forward P/E', fmtNum(data.forward_pe)],
    ['Price/Book', fmtNum(data.price_to_book)],
    ['Price/Sales', fmtNum(data.price_to_sales_ttm)],
  ]
  const fundamentals = [
    ['Revenue', fmtMoney(data.revenue)],
    ['Revenue Growth', fmtPct(data.revenue_growth_pct)],
    ['Gross Margin', fmtPct(data.gross_margin_pct)],
    ['Operating Margin', fmtPct(data.operating_margin_pct)],
    ['Profit Margin', fmtPct(data.profit_margin_pct)],
    ['Net Income', fmtMoney(data.net_income)],
    ['Free Cash Flow', fmtMoney(data.free_cash_flow)],
    ['Debt/Equity', fmtNum(data.debt_to_equity)],
  ]
  const rvyStock = returnVsYield(return1y, data.dividend_yield_pct)

  const dividend = [
    ['Dividend Frequency', data.dividend_frequency || '-'],
    ['Dividend Rate', fmtMoney(data.dividend_rate)],
    ['Dividend Yield', fmtPct(data.dividend_yield_pct)],
    ['1Y Ret vs Yield', return1y == null ? '-' : <span style={{ color: rvyStock?.color || 'var(--p-6f7890)' }} title={rvyStock ? `1Y Return ${rvyStock.totalReturnPct?.toFixed(2)}% vs Yield ${rvyStock.yieldOnCost?.toFixed(2)}% (spread ${rvyStock.spread?.toFixed(2)}%)` : undefined}>{rvyStock?.label || '-'}</span>],
    ['Payout Ratio', fmtPct(data.payout_ratio_pct)],
    ['TTM Dividend/Share', formatMoney(data.ttm_dividend_per_share, { digits: 4, fallback: '-' })],
    ['Last Dividend', data.last_dividend ? `${fmtMoney(data.last_dividend.amount)} on ${data.last_dividend.date}` : '-'],
  ]

  return (
    <div className="research-result">
      <div className="research-header">
        <div>
          <div className="research-kicker">{data.ticker} - Stock</div>
          <h2>{data.name}</h2>
          <p className="research-muted">{[data.sector, data.industry, data.exchange].filter(Boolean).join(' - ')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onOpenChart}>Open Annual Chart</button>
      </div>

      <section className="research-section">
        <h3>Business Description</h3>
        <p>{data.business_summary || '-'}</p>
      </section>

      <section className="research-three-col">
        <div>
          <h3>Valuation</h3>
          {valuation.map(([label, value]) => <Field key={label} label={label} value={value} />)}
        </div>
        <div>
          <h3>Fundamentals</h3>
          {fundamentals.map(([label, value]) => <Field key={label} label={label} value={value} />)}
        </div>
        <div>
          <h3>Dividends</h3>
          {dividend.map(([label, value]) => <Field key={label} label={label} value={value} />)}
        </div>
      </section>

      <DistributionChart
        history={data.distribution_history}
        ticker={data.ticker}
        price={data.price}
        source={data.distribution_source || data.yield_source || data.data_source}
      />
    </div>
  )
}

function ETFBrowserSection() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('')
  const [sortKey, setSortKey] = useState('symbol')
  const [funds, setFunds] = useState([])
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [total, setTotal] = useState(0)
  const [selectedTicker, setSelectedTicker] = useState(null)
  const chartRef = useRef(null)

  const handleSearchChange = (value) => {
    setSearchTerm(value.toUpperCase())
    setSelectedTicker(null)
  }

  const handleProviderChange = (value) => {
    setSelectedProvider(value)
    setSearchTerm('')
    setSelectedTicker(null)
    setFunds([])
    setTotal(0)
    setError(null)
    setLoading(Boolean(value))
  }

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/etf-providers`)
        const data = await response.json()
        const providerNames = [...new Set(data.map(p => p.provider))].sort()
        setProviders(providerNames)
      } catch (err) {
        console.error('Error fetching providers:', err)
      }
    }
    fetchProviders()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      const fetchFunds = async () => {
        if (!searchTerm && !selectedProvider) {
          setFunds([])
          setTotal(0)
          return
        }

        setLoading(true)
        setError(null)
        try {
          const params = new URLSearchParams()
          if (searchTerm) params.append('q', searchTerm)
          if (selectedProvider) params.append('provider', selectedProvider)
          params.append('sort', sortKey)

          const response = await fetch(`${API_BASE}/api/etf-funds/search?${params}`)
          if (!response.ok) throw new Error('Failed to fetch ETF funds')
          const data = await response.json()
          setFunds(data.funds || [])
          setTotal(data.total || 0)
        } catch (err) {
          setError(err.message)
          setFunds([])
        } finally {
          setLoading(false)
        }
      }
      fetchFunds()
    }, 500)

    return () => clearTimeout(timer)
  }, [searchTerm, selectedProvider, sortKey])

  const sorted = useMemo(() => {
    if (!funds) return []
    const copy = [...funds]
    copy.sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number') return bVal - aVal
      return String(aVal).localeCompare(String(bVal))
    })
    return copy
  }, [funds, sortKey])

  return (
    <div className="etf-browser" style={{ padding: '1rem' }}>
      <div className="etf-search-controls" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <input
            type="text"
            placeholder="Search ticker or fund name..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              backgroundColor: 'var(--bg)',
              color: 'var(--white)',
              border: '1px solid var(--p-4a5568)',
              borderRadius: '4px',
              fontSize: '0.9rem',
            }}
          />
        </div>

        <div style={{ minWidth: '200px' }}>
          <select
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              backgroundColor: 'var(--bg)',
              color: 'var(--white)',
              border: '1px solid var(--p-4a5568)',
              borderRadius: '4px',
              fontSize: '0.9rem',
            }}
          >
            <option value="">All Providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--neg)', marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'rgba(255, 107, 107, 0.1)', borderRadius: '4px' }}>
          Error: {error}
        </div>
      )}

      {loading && (
        <div style={{ color: 'var(--accent-2)', marginBottom: '1rem' }}>Loading...</div>
      )}

      {!loading && !searchTerm && !selectedProvider && (
        <div style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>
          Search for a ticker, fund name, or select a provider to get started.
        </div>
      )}

      {!loading && (searchTerm || selectedProvider) && sorted.length === 0 && (
        <div style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>
          No funds found matching your criteria.
        </div>
      )}

      {!loading && sorted.length > 0 && sorted[0]?.source === 'yahoo' && (
        <div style={{ color: 'var(--p-ffb74d)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ background: 'var(--p-7b4f00)', padding: '0.15rem 0.5rem', borderRadius: 4, fontWeight: 700 }}>Yahoo Finance</span>
          Not in local database — pulled live from Yahoo Finance
        </div>
      )}

      {sorted.length > 0 && (
        <div className="etf-results" style={{ marginTop: '1rem' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            Showing {sorted.length} of {total} funds
          </div>

          <div className="sticky-table-wrap" style={{ overflowX: 'auto', border: '1px solid var(--p-4a5568)', borderRadius: '4px' }}>
            <table className="etf-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--p-2a2a3e)', borderBottom: '2px solid var(--p-4a5568)' }}>
                  <th onClick={() => setSortKey('symbol')} style={{ ...headerStyle, cursor: 'pointer', minWidth: '80px' }}>
                    Ticker {sortKey === 'symbol' ? '▼' : ''}
                  </th>
                  <th onClick={() => setSortKey('fund_name')} style={{ ...headerStyle, cursor: 'pointer', minWidth: '200px', textAlign: 'left' }}>
                    Fund Name {sortKey === 'fund_name' ? '▼' : ''}
                  </th>
                  <th onClick={() => setSortKey('provider')} style={{ ...headerStyle, cursor: 'pointer', minWidth: '120px' }}>
                    Provider {sortKey === 'provider' ? '▼' : ''}
                  </th>
                  <th onClick={() => setSortKey('assets')} style={{ ...headerStyle, cursor: 'pointer', minWidth: '120px' }}>
                    Assets {sortKey === 'assets' ? '▼' : ''}
                  </th>
                  <th onClick={() => setSortKey('div_yield')} style={{ ...headerStyle, cursor: 'pointer', minWidth: '90px' }}>
                    Div Yield {sortKey === 'div_yield' ? '▼' : ''}
                  </th>
                  <th onClick={() => setSortKey('exp_ratio')} style={{ ...headerStyle, cursor: 'pointer', minWidth: '90px' }}>
                    Exp Ratio {sortKey === 'exp_ratio' ? '▼' : ''}
                  </th>
                  <th onClick={() => setSortKey('change_1y')} style={{ ...headerStyle, cursor: 'pointer', minWidth: '90px' }}>
                    1Y Change {sortKey === 'change_1y' ? '▼' : ''}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((fund, idx) => (
                  <tr
                    key={`${fund.symbol}-${idx}`}
                    style={{
                      backgroundColor: selectedTicker === fund.symbol
                        ? 'var(--p-1e2d45)'
                        : idx % 2 === 0 ? 'var(--bg)' : 'var(--p-16192a)',
                      borderBottom: '1px solid var(--p-4a5568)',
                    }}
                  >
                    <td
                      style={{ ...cellStyle, fontWeight: 700, color: 'var(--accent-bright)', cursor: 'pointer' }}
                      onClick={() => {
                        const next = selectedTicker === fund.symbol ? null : fund.symbol
                        setSelectedTicker(next)
                        if (next) setTimeout(() => chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                      }}
                      title="Click to view 1-year chart"
                    >
                      {fund.symbol}
                    </td>
                    <td
                      style={{ ...cellStyle, textAlign: 'left', cursor: 'pointer', color: 'var(--p-c8d8f0)' }}
                      onClick={() => {
                        const next = selectedTicker === fund.symbol ? null : fund.symbol
                        setSelectedTicker(next)
                        if (next) setTimeout(() => chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
                      }}
                      title="Click to view 1-year chart"
                    >
                      {fund.fund_name}
                    </td>
                    <td style={{ ...cellStyle }}>{fund.provider}</td>
                    <td style={{ ...cellStyle }}>{fmtAssets(fund.assets)}</td>
                    <td style={{ ...cellStyle }}>{fund.div_yield != null ? fmtPctVal(fund.div_yield) : '—'}</td>
                    <td style={{ ...cellStyle }}>{fund.exp_ratio != null ? fmtPctVal(fund.exp_ratio) : '—'}</td>
                    <td style={{ ...cellStyle, color: pctClass(fund.change_1y) || 'inherit' }}>
                      {fund.change_1y != null ? fmtPctVal(fund.change_1y) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedTicker && (
        <div ref={chartRef} style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--accent-2)', fontWeight: 700, fontSize: '1rem' }}>
              {selectedTicker} — 1-Year Return
            </span>
            <button
              onClick={() => setSelectedTicker(null)}
              style={{ background: 'none', border: '1px solid var(--p-4a5568)', color: 'var(--text-dim)', borderRadius: 4, padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              Close
            </button>
          </div>
          <ResearchChart ticker={selectedTicker} />
        </div>
      )}
    </div>
  )
}

const headerStyle = {
  padding: '0.5rem 0.75rem',
  textAlign: 'center',
  color: 'var(--accent-2)',
  fontWeight: 700,
  borderRight: '1px solid var(--p-4a5568)',
}

const cellStyle = {
  padding: '0.5rem 0.75rem',
  textAlign: 'center',
  borderRight: '1px solid var(--p-3a3a4e)',
}

export default function SecurityResearch() {
  const pf = useProfileFetch()
  const [mode, setMode] = useState('lookup')
  const [kind, setKind] = useState('etf')
  const [ticker, setTicker] = useState('')
  const [benchmark, setBenchmark] = useState('SPY')
  const [data, setData] = useState(null)
  const [return1y, setReturn1y] = useState(null)
  const [chartTicker, setChartTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const normalizedTicker = useMemo(() => ticker.trim().toUpperCase(), [ticker])
  const normalizedBenchmark = useMemo(() => benchmark.trim().toUpperCase() || 'SPY', [benchmark])

  useEffect(() => {
    setReturn1y(null)
    if (!data?.ticker) return
    pf(`/api/ticker-return-1y/${encodeURIComponent(data.ticker)}?_=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!d.error && d.total_return?.length) setReturn1y(d.total_return[d.total_return.length - 1])
      })
      .catch(() => {})
  }, [data?.ticker, pf])

  const runLookup = () => {
    if (!normalizedTicker) return
    setLoading(true)
    setError('')
    setData(null)
    setChartTicker('')
    pf(`/api/security-research/${kind}/${encodeURIComponent(normalizedTicker)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  const openChart = () => {
    setChartTicker(data?.ticker || normalizedTicker)
    setTimeout(() => document.getElementById('annual-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') runLookup()
  }

  return (
    <div className="page security-research-page">
      <div className="research-title-row">
        <div>
          <h1>Security Research</h1>
          <p>Look up ETF objectives, holdings, yield data, or stock fundamentals.</p>
        </div>
      </div>

      <div className="research-toolbar">
        <div className="research-tabs">
          <button className={`btn btn-sm${mode === 'lookup' ? ' btn-active' : ''}`} onClick={() => { setMode('lookup') }}>Lookup</button>
          <button className={`btn btn-sm${mode === 'browse' ? ' btn-active' : ''}`} onClick={() => { setMode('browse') }}>Browse</button>
        </div>
        {mode === 'lookup' && (
          <>
            <div className="research-tabs">
              <button className={`btn btn-sm${kind === 'etf' ? ' btn-active' : ''}`} onClick={() => { setKind('etf'); setData(null); setChartTicker('') }}>ETF</button>
              <button className={`btn btn-sm${kind === 'stock' ? ' btn-active' : ''}`} onClick={() => { setKind('stock'); setData(null); setChartTicker('') }}>Stock</button>
            </div>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder={kind === 'etf' ? 'ETF ticker, e.g. SCHD' : 'Stock ticker, e.g. AAPL'}
            />
            <button className="btn btn-primary" onClick={runLookup} disabled={!normalizedTicker || loading}>
              {loading ? 'Loading...' : 'Lookup'}
            </button>
            <input
              value={benchmark}
              onChange={e => setBenchmark(e.target.value.toUpperCase())}
              placeholder="Compare, e.g. SPY"
              title="Benchmark used for the average return panel"
              style={{ maxWidth: '180px' }}
            />
          </>
        )}
      </div>

      {mode === 'lookup' && (
        <>
          {error && <div className="alert alert-error">{error}</div>}
          {loading && <div className="research-loading"><span className="spinner" /> Loading research data...</div>}

          {data?.kind && <AverageReturnChart kind={data.kind} ticker={data?.ticker || normalizedTicker} benchmark={normalizedBenchmark} />}
          {data?.kind === 'etf' && <ETFResult data={data} onOpenChart={openChart} return1y={return1y} />}
          {data?.kind === 'stock' && <StockResult data={data} onOpenChart={openChart} return1y={return1y} />}
          {chartTicker && <ResearchChart ticker={chartTicker} />}
        </>
      )}

      {mode === 'browse' && <ETFBrowserSection />}
    </div>
  )
}
