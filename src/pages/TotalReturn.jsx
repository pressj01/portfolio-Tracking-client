import React, { useState, useEffect, useRef, useMemo } from 'react'
import { API_BASE } from '../config'

// 30 bright, high-contrast colors for dark backgrounds
const PALETTE = [
  '#7B8CFF','#FF6F61','#2EFDB5','#C98FFF','#FFB86C','#4DE8FF','#FF80A8','#D4FF9A',
  '#FFB3FF','#FFE066','#5AAFEE','#FF9933','#55DD55','#FF5555','#BB99DD','#CC8877',
  '#FF99DD','#BBBBBB','#E0E044','#44DDEE','#C8DDFF','#FFCC88','#AAEE99','#FF9999',
  '#D5C5EE','#DDBBAA','#FFCCEE','#DDDDDD','#EEEE99','#AAEEFF',
]

const fmt = v => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
const fmtPct = v => v != null ? `${Number(v).toFixed(2)}%` : '—'
const fmtInt = v => v != null ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'

function MetricCard({ label, value, className }) {
  return (
    <div className={`summary-card ${className || ''}`}>
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value ?? '—'}</div>
    </div>
  )
}

export default function TotalReturn() {
  const [categories, setCategories] = useState([])
  const [catOpen, setCatOpen] = useState(false)
  const catRef = useRef(null)

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(null)

  const [chartData, setChartData] = useState(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState(null)

  const [sortCol, setSortCol] = useState('total_return_pct')
  const [sortAsc, setSortAsc] = useState(false)

  // Comparison chart state
  const [cmpTickers, setCmpTickers] = useState([])
  const [cmpTickerOpen, setCmpTickerOpen] = useState(false)
  const cmpTickerRef = useRef(null)
  const [cmpExtraInput, setCmpExtraInput] = useState('')
  const [cmpExtra, setCmpExtra] = useState('')
  const [cmpPeriod, setCmpPeriod] = useState('1y')
  const [cmpMode, setCmpMode] = useState('total') // 'price' or 'total'
  const [cmpData, setCmpData] = useState(null)
  const [cmpLoading, setCmpLoading] = useState(false)
  const [cmpError, setCmpError] = useState(null)

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
    fetch(`${API_BASE}/api/total-return/summary?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setSummary(d)
      })
      .catch(e => setSummaryError(e.message))
      .finally(() => setSummaryLoading(false))
  }, [categories])

  // Fetch yfinance charts
  useEffect(() => {
    setChartLoading(true)
    setChartError(null)
    const params = new URLSearchParams({ period: '1y' })
    if (categories.length) params.set('category', categories.join(','))
    fetch(`${API_BASE}/api/total-return/charts?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setChartData(d)
      })
      .catch(e => setChartError(e.message))
      .finally(() => setChartLoading(false))
  }, [categories])

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
      Plotly.newPlot(barEl, bar.data, bar.layout, cfg)
    }

    return () => {
      ids.forEach(id => {
        const el = document.getElementById(id)
        if (el) Plotly.purge(el)
      })
    }
  }, [chartData])

  // Render scatter chart
  useEffect(() => {
    if (!summary?.scatter || !window.Plotly) return
    const Plotly = window.Plotly
    const el = document.getElementById('tr-chart-scatter')
    if (!el) return
    const fig = JSON.parse(summary.scatter)
    Plotly.newPlot(el, fig.data, fig.layout, { responsive: true })
    return () => { if (el) Plotly.purge(el) }
  }, [summary])

  // Fetch comparison chart data
  useEffect(() => {
    if (cmpTickers.length === 0 && !cmpExtra) { setCmpData(null); return }
    setCmpLoading(true)
    setCmpError(null)
    const params = new URLSearchParams({ period: cmpPeriod })
    if (cmpTickers.length) params.set('tickers', cmpTickers.join(','))
    if (cmpExtra) params.set('extra', cmpExtra)
    fetch(`${API_BASE}/api/total-return/compare?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setCmpData(d)
      })
      .catch(e => setCmpError(e.message))
      .finally(() => setCmpLoading(false))
  }, [cmpTickers, cmpExtra, cmpPeriod])

  // Render comparison chart
  useEffect(() => {
    if (!cmpData || !window.Plotly) return
    const Plotly = window.Plotly
    const el = document.getElementById('tr-chart-compare')
    if (!el) return

    const series = cmpMode === 'total' ? cmpData.total : cmpData.price
    const traces = cmpData.tickers.filter(t => series[t]).map((t, i) => ({
      x: cmpData.dates,
      y: series[t],
      name: t,
      mode: 'lines',
      line: { width: 2.5, color: PALETTE[i % PALETTE.length] },
      hovertemplate: `<b>${t}</b><br>%{x}<br>${cmpMode === 'total' ? 'Total' : 'Price'} Return: %{y:.1f}<extra></extra>`,
    }))

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

    const layout = {
      title: `${cmpMode === 'total' ? 'Total Return' : 'Price Return'} Comparison — ${cmpData.period_label} (normalized to 100)`,
      template: 'plotly_dark',
      paper_bgcolor: '#1a1f2e',
      plot_bgcolor: 'rgba(255,255,255,0.03)',
      xaxis: { title: { text: 'Date', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8', size: 12 }, gridcolor: 'rgba(255,255,255,0.08)' },
      yaxis: { title: { text: 'Normalized (100 = start)', font: { color: '#d0dde8' } }, tickfont: { color: '#c0cdd8', size: 12 }, gridcolor: 'rgba(255,255,255,0.08)' },
      height: 550,
      legend: { orientation: 'h', y: -0.15, font: { color: '#d0dde8', size: 12 } },
      title: { font: { color: '#e0e8f0' } },
      hovermode: 'x unified',
      margin: { t: 50, b: 80, l: 60, r: 20 },
    }

    Plotly.newPlot(el, traces, layout, { responsive: true })
    return () => Plotly.purge(el)
  }, [cmpData, cmpMode])

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

  // Table sorting
  const handleSort = (col) => {
    if (sortCol === col) { setSortAsc(a => !a) }
    else {
      setSortCol(col)
      const numCols = ['quantity', 'price_paid', 'current_price', 'purchase_value', 'current_value', 'gain_or_loss', 'price_return_pct', 'total_divs_received', 'total_return_dollar', 'total_return_pct']
      setSortAsc(!numCols.includes(col))
    }
  }

  const sortedRows = useMemo(() => {
    if (!summary?.rows) return []
    if (!sortCol) return summary.rows
    const rows = [...summary.rows]
    rows.sort((a, b) => {
      let av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
      av = String(av).toLowerCase(); bv = String(bv).toLowerCase()
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return rows
  }, [summary, sortCol, sortAsc])

  const sortIcon = (col) => {
    if (sortCol !== col) return ' \u21C5'
    return sortAsc ? ' \u25B2' : ' \u25BC'
  }

  const allTickers = useMemo(() => summary?.rows?.map(r => r.ticker) || [], [summary])

  const columns = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'category_name', label: 'Category' },
    { key: 'quantity', label: 'Shares', fmt: v => v != null ? Number(v).toFixed(3) : '—' },
    { key: 'price_paid', label: 'Price Paid', fmt: v => v != null ? `$${Number(v).toFixed(4)}` : '—' },
    { key: 'current_price', label: 'Curr Price', fmt: v => v != null ? `$${Number(v).toFixed(4)}` : '—' },
    { key: 'purchase_value', label: 'Invested', fmt },
    { key: 'current_value', label: 'Curr Value', fmt },
    { key: 'gain_or_loss', label: 'Price G/L', fmt },
    { key: 'price_return_pct', label: 'Price Ret %', fmt: fmtPct },
    { key: 'total_divs_received', label: 'Divs Rcvd', fmt },
    { key: 'total_return_dollar', label: 'Total Ret $', fmt },
    { key: 'total_return_pct', label: 'Total Ret %', fmt: fmtPct },
  ]

  const t = summary?.totals || {}

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '0.5rem' }}>Total Return Dashboard</h1>

      {/* Filters row — only show category filter when categories are defined */}
      {(summary?.categories?.length > 0) && (
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
                {summary.categories.map(c => (
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
      {summaryLoading && <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /></div>}
      {summaryError && <div className="alert alert-error">{summaryError}</div>}
      {summary && !summaryLoading && (
        <>
          <p className="tr-note">Summary shows <strong>all-time since purchase</strong> figures. Charts below are live from Yahoo Finance.</p>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <MetricCard label="Total Invested" value={fmtInt(t.total_invested)} />
            <MetricCard label="Current Value" value={fmtInt(t.current_value)} />
            <MetricCard label="Price Gain / Loss" value={<span style={{ color: (t.price_gl || 0) >= 0 ? '#4dff91' : '#ff6b6b' }}>{fmtInt(t.price_gl)}</span>} />
            <MetricCard label="Total Divs Received" value={fmtInt(t.total_divs)} />
            <MetricCard label="Total Return $" value={<span style={{ color: (t.total_return_dollar || 0) >= 0 ? '#4dff91' : '#ff6b6b' }}>{fmtInt(t.total_return_dollar)}</span>} />
            <MetricCard label="Total Return %" value={<span style={{ color: (t.total_return_pct || 0) >= 0 ? '#4dff91' : '#ff6b6b' }}>{fmtPct(t.total_return_pct)}</span>} />
            {chartData?.spy_ret != null && (
              <MetricCard label={`SPY - ${chartData.period_label || '1Y'}`}
                value={<span style={{ color: chartData.spy_ret >= 0 ? '#4dff91' : '#ff6b6b' }}>{fmtPct(chartData.spy_ret)}</span>} />
            )}
          </div>
        </>
      )}

      {/* Charts */}
      {chartLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: '#8899aa', padding: '0.6rem 0' }}><span className="spinner" /> Fetching data from Yahoo Finance...</div>}
      {chartError && <div className="alert alert-error">{chartError}</div>}

      {chartData && !chartLoading && (
        <>
          <h2 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }}>
            Total Return % by Ticker <span className="tr-period-inline">— {chartData.period_label}</span>
          </h2>
          <p className="tr-note">Green = positive, Red = negative. Gold dashed line = SPY.</p>
          <div id="tr-chart-bar" style={{ minHeight: '400px', marginBottom: '2rem' }} />
        </>
      )}

      {/* Performance Comparison */}
      <div style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Performance Comparison</h2>
        <p className="tr-note">Select portfolio tickers and/or add external tickers to compare side by side. Normalized to 100 at start.</p>

        <div className="growth-filters" style={{ marginBottom: '1rem' }}>
          {/* Portfolio ticker multi-select */}
          <div className="growth-filter-group" style={{ position: 'relative' }} ref={cmpTickerRef}>
            <label>Portfolio Tickers</label>
            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '160px', textAlign: 'left' }}
              onClick={() => setCmpTickerOpen(o => !o)}>
              {cmpTickers.length === 0 ? 'None selected' : `${cmpTickers.length} selected`}
              <span style={{ float: 'right', marginLeft: '0.5rem' }}>{cmpTickerOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {cmpTickerOpen && (
              <div className="growth-cat-dropdown" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', gap: '0.3rem', padding: '0.3rem 0.6rem', borderBottom: '1px solid #0f3460', marginBottom: '0.2rem' }}>
                  <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => setCmpTickers([...allTickers])}>All</button>
                  <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => setCmpTickers([])}>Clear</button>
                </div>
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
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', background: '#0d1520', border: '1px solid #0f3460', borderRadius: '4px', color: '#e0e0e0', width: '200px' }} />
              <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}>Add</button>
              {cmpExtra && <button type="button" className="btn btn-secondary" style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
                onClick={() => { setCmpExtra(''); setCmpExtraInput('') }}>Clear</button>}
            </div>
            {cmpExtra && <div style={{ fontSize: '0.8rem', color: '#7ecfff', marginTop: '0.25rem' }}>{cmpExtra.split(',').join(', ')}</div>}
          </form>

          {/* Period */}
          <div className="growth-filter-group">
            <label>Period</label>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {[
                { key: '3mo', label: '3M' }, { key: '6mo', label: '6M' }, { key: '9mo', label: '9M' },
                { key: '1y', label: '1Y' }, { key: '2y', label: '2Y' }, { key: '3y', label: '3Y' },
                { key: '4y', label: '4Y' }, { key: '5y', label: '5Y' },
              ].map(p => (
                <button key={p.key} className={`tr-pbtn${cmpPeriod === p.key ? ' tr-pbtn-active' : ''}`}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                  onClick={() => setCmpPeriod(p.key)}>{p.label}</button>
              ))}
            </div>
          </div>

          {/* Price vs Total Return toggle */}
          <div className="growth-filter-group">
            <label>Return Type</label>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button className={`tr-pbtn${cmpMode === 'price' ? ' tr-pbtn-active' : ''}`}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                onClick={() => setCmpMode('price')}>Price</button>
              <button className={`tr-pbtn${cmpMode === 'total' ? ' tr-pbtn-active' : ''}`}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                onClick={() => setCmpMode('total')}>Total Return</button>
            </div>
          </div>
        </div>

        {cmpLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: '#8899aa', padding: '0.6rem 0' }}><span className="spinner" /> Loading comparison data...</div>}
        {cmpError && <div className="alert alert-error">{cmpError}</div>}
        {!cmpData && !cmpLoading && !cmpError && (cmpTickers.length === 0 && !cmpExtra) && (
          <p style={{ color: '#556677', fontStyle: 'italic', padding: '2rem 0', textAlign: 'center' }}>Select portfolio tickers or add external tickers to see the comparison chart.</p>
        )}
        <div id="tr-chart-compare" style={{ minHeight: cmpData ? '550px' : '0', marginBottom: '2rem' }} />
      </div>

      {/* Scatter chart */}
      {summary?.scatter && (
        <>
          <h2 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }}>
            Total Return % vs Yield on Cost <span className="tr-period-inline">— Since Purchase</span>
          </h2>
          <p className="tr-note">Bubble size = position size. X = annual yield on cost. All-time data.</p>
          <div id="tr-chart-scatter" style={{ minHeight: '520px', marginBottom: '2rem' }} />
        </>
      )}

      {/* Table */}
      {summary && !summaryLoading && summary.rows.length > 0 && (
        <>
          <h2 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }}>Holdings — All-Time Total Return Summary</h2>
          <p style={{ color: '#8899aa', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Click any column header to sort.</p>
          <div className="sticky-table-wrap" style={{ maxHeight: '70vh' }}>
            <table>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={col.key} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => handleSort(col.key)}>
                      {col.label}
                      <span style={{ fontSize: '0.7em', marginLeft: '4px', color: sortCol === col.key ? '#7ecfff' : '#8899aa' }}>
                        {sortIcon(col.key)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(row => (
                  <tr key={row.ticker}>
                    {columns.map(col => {
                      const val = row[col.key]
                      const isNum = typeof val === 'number'
                      let display = col.fmt ? col.fmt(val) : (val ?? '')
                      let style = isNum ? { textAlign: 'right' } : {}

                      if (col.key === 'ticker') display = <strong>{val}</strong>
                      if (col.key === 'gain_or_loss' || col.key === 'price_return_pct' || col.key === 'total_return_dollar' || col.key === 'total_return_pct') {
                        style = { textAlign: 'right', color: (val || 0) >= 0 ? '#4dff91' : '#ff6b6b' }
                      }
                      return <td key={col.key} style={style}>{display}</td>
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #0f3460', background: '#16213e' }}>
                  <td colSpan={5}><strong>Portfolio Total</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{fmt(t.total_invested)}</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{fmt(t.current_value)}</strong></td>
                  <td style={{ textAlign: 'right', color: (t.price_gl || 0) >= 0 ? '#4dff91' : '#ff6b6b' }}><strong>{fmt(t.price_gl)}</strong></td>
                  <td></td>
                  <td style={{ textAlign: 'right' }}><strong>{fmt(t.total_divs)}</strong></td>
                  <td style={{ textAlign: 'right', color: (t.total_return_dollar || 0) >= 0 ? '#4dff91' : '#ff6b6b' }}><strong>{fmt(t.total_return_dollar)}</strong></td>
                  <td style={{ textAlign: 'right', color: (t.total_return_pct || 0) >= 0 ? '#4dff91' : '#ff6b6b' }}><strong>{fmtPct(t.total_return_pct)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
