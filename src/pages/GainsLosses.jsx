import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'

const PALETTE = [
  '#7B8CFF','#FF6F61','#2EFDB5','#C98FFF','#FFB86C','#4DE8FF','#FF80A8','#D4FF9A',
  '#FFB3FF','#FFE066','#5AAFEE','#FF9933','#55DD55','#FF5555','#BB99DD','#CC8877',
]

const fmt = v => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u2014'
const fmtPct = v => v != null ? `${Number(v).toFixed(2)}%` : '\u2014'
const fmtInt = v => v != null ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '\u2014'
const glColor = v => (v || 0) >= 0 ? '#4dff91' : '#ff6b6b'

function MetricCard({ label, value, className }) {
  return (
    <div className={`summary-card ${className || ''}`}>
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '\u2014'}</div>
    </div>
  )
}

export default function GainsLosses() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const [categories, setCategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [chartData, setChartData] = useState(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('1y')

  const [tab, setTab] = useState('unrealized')
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(false)

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
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (categories.length) params.set('category', categories.join(','))
    pf(`/api/gains-losses/summary?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [categories, selection])

  // Fetch chart data
  useEffect(() => {
    setChartLoading(true)
    setChartError(null)
    const params = new URLSearchParams({ period: chartPeriod })
    if (categories.length) params.set('category', categories.join(','))
    pf(`/api/gains-losses/chart?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setChartData(d)
      })
      .catch(e => setChartError(e.message))
      .finally(() => setChartLoading(false))
  }, [chartPeriod, categories, selection])

  // Render Plotly charts
  useEffect(() => {
    if (!chartData || !window.Plotly) return
    const Plotly = window.Plotly
    const cfg = { responsive: true }
    const ids = []

    // Chart 1: Cumulative G/L over time
    const timeEl = document.getElementById('gl-chart-time')
    if (timeEl && chartData.dates?.length) {
      ids.push('gl-chart-time')
      const traces = [
        {
          x: chartData.dates, y: chartData.price_gl,
          name: 'Price G/L', mode: 'lines',
          line: { width: 2.5, color: '#7B8CFF' },
          fill: 'tozeroy', fillcolor: 'rgba(123,140,255,0.1)',
          hovertemplate: '<b>Price G/L</b><br>%{x}<br>$%{y:,.0f}<extra></extra>',
        },
        {
          x: chartData.dates, y: chartData.total_gl,
          name: 'Total G/L (+ Divs)', mode: 'lines',
          line: { width: 2.5, color: '#2EFDB5' },
          fill: 'tozeroy', fillcolor: 'rgba(46,253,181,0.08)',
          hovertemplate: '<b>Total G/L</b><br>%{x}<br>$%{y:,.0f}<extra></extra>',
        },
      ]
      // Zero line
      traces.push({
        x: [chartData.dates[0], chartData.dates[chartData.dates.length - 1]],
        y: [0, 0], mode: 'lines',
        line: { width: 1, color: '#555', dash: 'dash' },
        showlegend: false, hoverinfo: 'skip',
      })
      const layout = {
        title: { text: `Portfolio Cumulative G/L \u2014 ${chartData.period_label}`, font: { color: '#e0e8f0' } },
        template: 'plotly_dark',
        paper_bgcolor: '#1a1f2e', plot_bgcolor: 'rgba(255,255,255,0.03)',
        xaxis: { tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)' },
        yaxis: { title: { text: 'Gain / Loss ($)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)', tickprefix: '$', separatethousands: true },
        height: 450, hovermode: 'x unified',
        legend: { orientation: 'h', y: -0.12, font: { color: '#d0dde8' } },
        margin: { t: 50, b: 60, l: 80, r: 20 },
      }
      Plotly.newPlot(timeEl, traces, layout, cfg)
    }

    // Chart 2: Grouped bar - Price G/L vs Total G/L by ticker
    const barEl = document.getElementById('gl-chart-bar')
    if (barEl && chartData.ticker_gl?.length) {
      ids.push('gl-chart-bar')
      const sorted = [...chartData.ticker_gl].sort((a, b) => (a.total_gl || 0) - (b.total_gl || 0))
      const tickers = sorted.map(r => r.ticker)
      const priceVals = sorted.map(r => r.price_gl || 0)
      const totalVals = sorted.map(r => r.total_gl || 0)
      const barTraces = [
        {
          y: tickers, x: priceVals, type: 'bar', orientation: 'h',
          name: 'Price G/L', marker: { color: '#7B8CFF' },
          hovertemplate: '<b>%{y}</b><br>Price G/L: $%{x:,.2f}<extra></extra>',
        },
        {
          y: tickers, x: totalVals, type: 'bar', orientation: 'h',
          name: 'Total G/L (+ Divs)', marker: { color: '#2EFDB5' },
          hovertemplate: '<b>%{y}</b><br>Total G/L: $%{x:,.2f}<extra></extra>',
        },
      ]
      const barHeight = Math.max(400, tickers.length * 32 + 80)
      const barLayout = {
        title: { text: 'Price G/L vs Total G/L by Ticker', font: { color: '#e0e8f0' } },
        template: 'plotly_dark', barmode: 'group',
        paper_bgcolor: '#1a1f2e', plot_bgcolor: 'rgba(255,255,255,0.03)',
        xaxis: { title: { text: 'Gain / Loss ($)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)', tickprefix: '$', separatethousands: true },
        yaxis: { tickfont: { color: '#c0cdd8', size: 11 }, automargin: true },
        height: barHeight,
        legend: { orientation: 'h', y: -0.08, font: { color: '#d0dde8' } },
        margin: { t: 50, b: 50, l: 80, r: 20 },
      }
      Plotly.newPlot(barEl, barTraces, barLayout, cfg)
    }

    // Chart 3: Winners vs Losers waterfall
    const watEl = document.getElementById('gl-chart-waterfall')
    if (watEl && chartData.ticker_gl?.length) {
      ids.push('gl-chart-waterfall')
      const sorted = [...chartData.ticker_gl].sort((a, b) => (b.total_gl || 0) - (a.total_gl || 0))
      const tickers = sorted.map(r => r.ticker)
      const vals = sorted.map(r => r.total_gl || 0)
      const colors = vals.map(v => v >= 0 ? '#4dff91' : '#ff6b6b')
      const watTraces = [{
        x: tickers, y: vals, type: 'bar',
        marker: { color: colors },
        hovertemplate: '<b>%{x}</b><br>Total G/L: $%{y:,.2f}<extra></extra>',
        showlegend: false,
      }]
      const watLayout = {
        title: { text: 'Winners vs Losers \u2014 Total G/L by Ticker', font: { color: '#e0e8f0' } },
        template: 'plotly_dark',
        paper_bgcolor: '#1a1f2e', plot_bgcolor: 'rgba(255,255,255,0.03)',
        xaxis: { tickfont: { color: '#c0cdd8', size: 10 }, tickangle: -45 },
        yaxis: { title: { text: 'Total G/L ($)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)', tickprefix: '$', separatethousands: true },
        height: 400,
        margin: { t: 50, b: 100, l: 80, r: 20 },
      }
      Plotly.newPlot(watEl, watTraces, watLayout, cfg)
    }

    // Chart 4: Realized gains timeline
    const realEl = document.getElementById('gl-chart-realized')
    if (realEl && chartData.realized_events?.length) {
      ids.push('gl-chart-realized')
      const events = chartData.realized_events
      const realTraces = [{
        x: events.map(e => e.date),
        y: events.map(e => e.total_gl),
        text: events.map(e => e.ticker),
        type: 'bar',
        marker: { color: events.map(e => e.total_gl >= 0 ? '#4dff91' : '#ff6b6b') },
        hovertemplate: '<b>%{text}</b><br>%{x}<br>Total G/L: $%{y:,.2f}<extra></extra>',
        showlegend: false,
      }]
      const realLayout = {
        title: { text: 'Realized Gains Timeline', font: { color: '#e0e8f0' } },
        template: 'plotly_dark',
        paper_bgcolor: '#1a1f2e', plot_bgcolor: 'rgba(255,255,255,0.03)',
        xaxis: { title: { text: 'Sell Date', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)' },
        yaxis: { title: { text: 'Total G/L ($)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8' }, gridcolor: 'rgba(255,255,255,0.08)', tickprefix: '$', separatethousands: true },
        height: 380,
        margin: { t: 50, b: 60, l: 80, r: 20 },
      }
      Plotly.newPlot(realEl, realTraces, realLayout, cfg)
    }

    return () => {
      ids.forEach(id => {
        const el = document.getElementById(id)
        if (el) Plotly.purge(el)
      })
    }
  }, [chartData])

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

  // Reset sort when changing tabs
  useEffect(() => { setSortCol(null) }, [tab])

  const t = data?.totals || {}

  const unrealizedCols = [
    { key: 'ticker', label: 'Ticker', tip: 'Stock or ETF ticker symbol' },
    { key: 'description', label: 'Description', tip: 'Full name of the holding' },
    { key: 'quantity', label: 'Shares', tip: 'Number of shares currently held', fmt: v => v != null ? Number(v).toFixed(3) : '\u2014', numeric: true },
    { key: 'price_paid', label: 'Price Paid', tip: 'Average cost per share at time of purchase', fmt: v => v != null ? `$${Number(v).toFixed(4)}` : '\u2014', numeric: true },
    { key: 'current_price', label: 'Curr Price', tip: 'Latest market price per share', fmt: v => v != null ? `$${Number(v).toFixed(4)}` : '\u2014', numeric: true },
    { key: 'purchase_value', label: 'Invested', tip: 'Total amount invested (price paid \u00d7 shares)', fmt, numeric: true },
    { key: 'current_value', label: 'Curr Value', tip: 'Current market value (current price \u00d7 shares)', fmt, numeric: true },
    { key: 'price_gl', label: 'Price G/L', tip: 'Gain or loss based on price change only (current value \u2212 invested)', fmt, gl: true },
    { key: 'price_gl_pct', label: 'Price G/L %', tip: 'Price gain/loss as a percentage of amount invested', fmt: fmtPct, gl: true },
    { key: 'divs_received', label: 'Divs Rcvd', tip: 'Total lifetime dividends received from this holding', fmt, numeric: true },
    { key: 'total_gl', label: 'Total G/L', tip: 'Total gain or loss including dividends (price G/L + dividends received)', fmt, gl: true },
    { key: 'total_gl_pct', label: 'Total G/L %', tip: 'Total gain/loss as a percentage of amount invested', fmt: fmtPct, gl: true },
  ]

  const realizedCols = [
    { key: 'ticker', label: 'Ticker', tip: 'Stock or ETF ticker symbol' },
    { key: 'sell_date', label: 'Sell Date', tip: 'Date the shares were sold' },
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

  const combinedCols = [
    { key: 'ticker', label: 'Ticker', tip: 'Stock or ETF ticker symbol' },
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

  const tabConfig = {
    unrealized: { cols: unrealizedCols, rows: data?.unrealized },
    realized: { cols: realizedCols, rows: data?.realized },
    combined: { cols: combinedCols, rows: data?.combined },
  }
  const activeCols = tabConfig[tab].cols
  const activeRows = sortRows(tabConfig[tab].rows || [])

  const renderTable = () => {
    if (!activeRows.length) {
      return <p style={{ color: '#556677', fontStyle: 'italic', padding: '2rem 0', textAlign: 'center' }}>
        {tab === 'realized' ? 'No sold positions recorded. Add sales in the Watchlist page.' : 'No data available.'}
      </p>
    }

    return (
      <div className="sticky-table-wrap" style={{ maxHeight: '70vh' }}>
        <table>
          <thead>
            <tr>
              {activeCols.map(col => (
                <th key={col.key} title={col.tip} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: (col.numeric || col.gl) ? 'right' : undefined }} onClick={() => handleSort(col.key)}>
                  {col.label}
                  <span style={{ fontSize: '0.7em', marginLeft: '4px', color: sortCol === col.key ? '#7ecfff' : '#8899aa' }}>
                    {sortIcon(col.key)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeRows.map((row, i) => (
              <tr key={`${row.ticker}-${i}`}>
                {activeCols.map(col => {
                  const val = row[col.key]
                  let display = col.fmt ? col.fmt(val) : (val ?? '')
                  let style = (col.numeric || col.gl) ? { textAlign: 'right' } : {}
                  if (col.key === 'ticker') display = <strong>{val}</strong>
                  if (col.gl) style = { textAlign: 'right', color: glColor(val) }
                  return <td key={col.key} style={style}>{display}</td>
                })}
              </tr>
            ))}
          </tbody>
          {tab === 'unrealized' && (
            <tfoot>
              <tr style={{ borderTop: '2px solid #0f3460', background: '#16213e' }}>
                <td colSpan={5}><strong>Portfolio Total</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{fmt(t.unrealized_invested)}</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{fmt(t.unrealized_value)}</strong></td>
                <td style={{ textAlign: 'right', color: glColor(t.unrealized_price_gl) }}><strong>{fmt(t.unrealized_price_gl)}</strong></td>
                <td></td>
                <td style={{ textAlign: 'right' }}><strong>{fmt(t.unrealized_divs)}</strong></td>
                <td style={{ textAlign: 'right', color: glColor(t.unrealized_total_gl) }}><strong>{fmt(t.unrealized_total_gl)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          )}
          {tab === 'realized' && (
            <tfoot>
              <tr style={{ borderTop: '2px solid #0f3460', background: '#16213e' }}>
                <td colSpan={5}><strong>Total</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{fmt(t.realized_cost)}</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{fmt(t.realized_proceeds)}</strong></td>
                <td style={{ textAlign: 'right', color: glColor(t.realized_price_gl) }}><strong>{fmt(t.realized_price_gl)}</strong></td>
                <td></td>
                <td style={{ textAlign: 'right' }}><strong>{fmt(t.realized_divs)}</strong></td>
                <td style={{ textAlign: 'right', color: glColor(t.realized_total_gl) }}><strong>{fmt(t.realized_total_gl)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    )
  }

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '0.5rem' }}>Gains & Losses</h1>

      {/* Category filter */}
      {(data?.categories?.length > 0) && (
        <div className="growth-filters" style={{ marginBottom: '1rem' }}>
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={catRef}>
            <label>Categories</label>
            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
              onClick={() => setCatOpen(o => !o)}>
              {categories.length === 0 ? 'All Holdings' : `${categories.length} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{catOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {catOpen && (
              <div className="growth-cat-dropdown">
                <label className="growth-cat-option" style={{ borderBottom: '1px solid #0f3460', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
                  <input type="checkbox" checked={categories.length === 0} onChange={() => setCategories([])} />
                  <span>All Holdings</span>
                </label>
                {data.categories.map(c => (
                  <label key={c.id} className="growth-cat-option">
                    <input type="checkbox" checked={categories.includes(String(c.id))}
                      onChange={e => {
                        if (e.target.checked) setCategories(prev => [...prev, String(c.id)])
                        else setCategories(prev => prev.filter(id => id !== String(c.id)))
                      }} />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary cards */}
      {loading && <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}
      {data && !loading && (
        <>
          <div className="summary-strip" style={{ marginBottom: '0.5rem' }}>
            <MetricCard label="Total Invested" value={fmtInt(t.unrealized_invested)} />
            <MetricCard label="Current Value" value={fmtInt(t.unrealized_value)} />
            <MetricCard label="Unrealized Price G/L" value={<span style={{ color: glColor(t.unrealized_price_gl) }}>{fmtInt(t.unrealized_price_gl)}</span>} />
            <MetricCard label="Unrealized Total G/L" value={<span style={{ color: glColor(t.unrealized_total_gl) }}>{fmtInt(t.unrealized_total_gl)}</span>} />
          </div>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <MetricCard label="Realized Price G/L" value={<span style={{ color: glColor(t.realized_price_gl) }}>{fmtInt(t.realized_price_gl)}</span>} />
            <MetricCard label="Realized Total G/L" value={<span style={{ color: glColor(t.realized_total_gl) }}>{fmtInt(t.realized_total_gl)}</span>} />
            <MetricCard label="Combined Price G/L" value={<span style={{ color: glColor(t.combined_price_gl) }}>{fmtInt(t.combined_price_gl)}</span>} />
            <MetricCard label="Combined Total G/L" value={<span style={{ color: glColor(t.combined_total_gl) }}>{fmtInt(t.combined_total_gl)}</span>} />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
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
          </div>

          {renderTable()}
        </>
      )}

      {/* Charts section */}
      <h2 style={{ marginTop: '2rem', marginBottom: '0.5rem' }}>Charts</h2>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { key: '3mo', label: '3M' }, { key: '6mo', label: '6M' },
          { key: '1y', label: '1Y' }, { key: '2y', label: '2Y' },
          { key: '3y', label: '3Y' }, { key: '5y', label: '5Y' },
        ].map(p => (
          <button key={p.key}
            className={`tr-pbtn${chartPeriod === p.key ? ' tr-pbtn-active' : ''}`}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
            onClick={() => setChartPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {chartLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: '#8899aa', padding: '0.6rem 0' }}><span className="spinner" /> Fetching data from Yahoo Finance...</div>}
      {chartError && <div className="alert alert-error">{chartError}</div>}

      <div id="gl-chart-time" style={{ minHeight: chartData?.dates ? '450px' : '0', marginBottom: '2rem' }} />
      <div id="gl-chart-bar" style={{ minHeight: chartData?.ticker_gl?.length ? '400px' : '0', marginBottom: '2rem' }} />
      <div id="gl-chart-waterfall" style={{ minHeight: chartData?.ticker_gl?.length ? '400px' : '0', marginBottom: '2rem' }} />
      {chartData?.realized_events?.length > 0 && (
        <div id="gl-chart-realized" style={{ minHeight: '380px', marginBottom: '2rem' }} />
      )}
      {chartData && !chartLoading && !chartData.realized_events?.length && (
        <p style={{ color: '#556677', fontStyle: 'italic', textAlign: 'center', marginBottom: '2rem' }}>No realized sales to chart. Record sales in the Watchlist page.</p>
      )}
    </div>
  )
}
