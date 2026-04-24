import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'

const fmtMoney = (v) => {
  if (v == null) return '-'
  const n = Number(v)
  const abs = Math.abs(n)
  if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const fmtNum = (v, d = 2) => v == null ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d })
const fmtPct = (v) => v == null ? '-' : Number(v).toFixed(2) + '%'
const fmtDate = (v) => v || '-'

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
  const chartRef = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError('')
    setData(null)
    pf(`/api/ticker-return-1y/${encodeURIComponent(ticker)}`)
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
        y: (data.total_return || []).map(v => v == null ? null : v + 0.15),
        type: 'scatter',
        mode: 'lines',
        name: 'Total Return',
        line: { color: '#4dff91', width: 2.5 },
        hovertemplate: '%{customdata:.2f}%<extra>Total</extra>',
        customdata: data.total_return,
      },
    ]
    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#16213e',
      plot_bgcolor: '#16213e',
      title: { text: `${data.ticker} - One Year Return`, font: { size: 16, color: '#e0e8f5' } },
      margin: { l: 58, r: 22, t: 56, b: 42 },
      height: 440,
      xaxis: { gridcolor: '#1a2a3e', type: 'date' },
      yaxis: { title: 'Return %', gridcolor: '#1a2a3e', ticksuffix: '%' },
      legend: { orientation: 'h', y: 1.05, x: 0.5, xanchor: 'center' },
      hovermode: 'x unified',
      shapes: data.dates?.length ? [{
        type: 'line',
        x0: data.dates[0],
        x1: data.dates[data.dates.length - 1],
        y0: 0,
        y1: 0,
        line: { dash: 'dot', color: '#556677', width: 1 },
      }] : [],
    }
    window.Plotly.newPlot(chartRef.current, traces, layout, { responsive: true, displayModeBar: false })
    return () => { if (chartRef.current) window.Plotly.purge(chartRef.current) }
  }, [data])

  return (
    <section className="research-chart-section" id="annual-chart">
      {loading && <div className="research-loading"><span className="spinner" /> Loading annual return chart...</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <div ref={chartRef} className="research-chart" />
    </section>
  )
}

function ETFResult({ data, onOpenChart }) {
  const metrics = [
    ['Issuer', data.issuer],
    ['Category', data.category],
    ['Legal Type', data.legal_type],
    ['Expense Ratio', fmtPct(data.expense_ratio_pct)],
    [data.total_assets_label || 'Total Assets', fmtMoney(data.total_assets)],
    [data.nav_label || 'NAV', fmtMoney(data.nav_price)],
    ['Inception', fmtDate(data.inception_date)],
    ['Dividend Frequency', data.dividend_frequency || '-'],
    [data.target_yield_label || 'Estimated Yield', fmtPct(data.estimated_yield_pct)],
    ['30-Day SEC Yield', fmtPct(data.sec_30_day_yield_pct)],
    ['TTM Dividend/Share', data.ttm_dividend_per_share == null ? '-' : '$' + fmtNum(data.ttm_dividend_per_share, 4)],
    ['Last Dividend', data.last_dividend ? `${fmtMoney(data.last_dividend.amount)} on ${data.last_dividend.date}` : '-'],
    ['Source', data.source_url ? <a href={data.source_url} target="_blank" rel="noreferrer">{data.data_source || 'Source'}</a> : data.data_source],
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

      <section className="research-section">
        <h3>Name & Description</h3>
        <p>{data.description || data.objective || '-'}</p>
      </section>

      <section className="research-grid">
        {metrics.map(([label, value]) => <Field key={label} label={label} value={value} />)}
      </section>

      <section className="research-two-col">
        <div>
          <h3>Top Holdings</h3>
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

function StockResult({ data, onOpenChart }) {
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
  const dividend = [
    ['Dividend Frequency', data.dividend_frequency || '-'],
    ['Dividend Rate', fmtMoney(data.dividend_rate)],
    ['Dividend Yield', fmtPct(data.dividend_yield_pct)],
    ['Payout Ratio', fmtPct(data.payout_ratio_pct)],
    ['TTM Dividend/Share', data.ttm_dividend_per_share == null ? '-' : '$' + fmtNum(data.ttm_dividend_per_share, 4)],
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
    </div>
  )
}

export default function SecurityResearch() {
  const pf = useProfileFetch()
  const [kind, setKind] = useState('etf')
  const [ticker, setTicker] = useState('')
  const [data, setData] = useState(null)
  const [chartTicker, setChartTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const normalizedTicker = useMemo(() => ticker.trim().toUpperCase(), [ticker])

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
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="research-loading"><span className="spinner" /> Loading research data...</div>}

      {data?.kind === 'etf' && <ETFResult data={data} onOpenChart={openChart} />}
      {data?.kind === 'stock' && <StockResult data={data} onOpenChart={openChart} />}
      {chartTicker && <ResearchChart ticker={chartTicker} />}
    </div>
  )
}
