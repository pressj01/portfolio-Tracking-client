import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { NavLink } from 'react-router-dom'

const fmt = (v) => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v) => (v == null ? '—' : (Number(v) * 100).toFixed(2) + '%')

function SummaryCard({ label, value, sub, color, className }) {
  return (
    <div className={`summary-card ${className || ''}`}>
      <div className="summary-label">{label}</div>
      <div className="summary-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="summary-sub">{sub}</div>}
    </div>
  )
}

function GradeBadge({ grade, large }) {
  if (!grade || grade === 'N/A') return <span className={`grade-badge grade-na ${large ? 'grade-lg' : ''}`}>N/A</span>
  const letter = grade[0]
  const cls = letter === 'A' ? 'grade-a' : letter === 'B' ? 'grade-b' : letter === 'C' ? 'grade-c' : letter === 'D' ? 'grade-d' : 'grade-f'
  return <span className={`grade-badge ${cls} ${large ? 'grade-lg' : ''}`}>{grade}</span>
}

function UpcomingDividends({ events }) {
  if (!events || events.length === 0) {
    return (
      <div className="upcoming-dividends card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <h3 style={{ color: '#90caf9', marginBottom: '0.5rem', fontSize: '1rem' }}>Upcoming Dividends This Week</h3>
        <p style={{ color: '#8899aa', fontSize: '0.85rem' }}>No ex-dividend dates in the next 7 days.</p>
      </div>
    )
  }

  const totalEst = events.reduce((s, e) => s + e.est_payment, 0)

  return (
    <div className="upcoming-dividends card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ color: '#90caf9', margin: 0, fontSize: '1rem' }}>Upcoming Dividends This Week</h3>
        <span style={{ color: '#4dff91', fontWeight: 700, fontSize: '0.95rem' }}>Est. Total: {fmt(totalEst)}</span>
      </div>
      <div className="upcoming-grid">
        {events.map((e, i) => (
          <div key={i} className="upcoming-event" style={{ borderLeft: `3px solid ${e.color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#7ecfff', fontWeight: 700 }}>{e.ticker}</span>
              <span className="upcoming-freq" style={{ color: e.color }}>{e.freq_label}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#8899aa', marginTop: '0.2rem' }}>
              Ex: {e.ex_weekday} {new Date(e.ex_date + 'T00:00').toLocaleDateString()}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#8899aa' }}>
              Pay: ~{e.pay_weekday} {new Date(e.pay_date + 'T00:00').toLocaleDateString()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', color: '#90a4ae' }}>${e.amount}/share</span>
              <span style={{ fontSize: '0.85rem', color: '#4dff91', fontWeight: 600 }}>{fmt(e.est_payment)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TickerModal({ ticker, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(null)
    fetch(`/api/ticker-return/${ticker}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticker])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (!data || !window.Plotly) return
    const el = document.getElementById('ticker-chart')
    if (!el) return

    const traces = [
      {
        x: data.dates, y: data.price_return,
        mode: 'lines', name: 'Price Return %',
        line: { color: '#7ecfff', width: 2 },
        hovertemplate: '%{y:.2f}%<extra>Price</extra>',
      },
      {
        x: data.dates, y: data.total_return,
        mode: 'lines', name: 'Total Return %',
        line: { color: '#4dff91', width: 2 },
        fill: 'tonexty', fillcolor: 'rgba(77,255,145,0.08)',
        hovertemplate: '%{y:.2f}%<extra>Total</extra>',
      },
    ]
    const layout = {
      template: 'plotly_dark',
      paper_bgcolor: '#0e1117', plot_bgcolor: '#0e1117',
      title: { text: `${data.ticker} — Return Since Purchase`, font: { size: 16, color: '#e0e8f5' } },
      xaxis: { title: '', gridcolor: '#1a2233' },
      yaxis: { title: 'Return %', gridcolor: '#1a2233', ticksuffix: '%' },
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 12 } },
      margin: { l: 50, r: 20, t: 60, b: 40 },
      hovermode: 'x unified',
      shapes: [{ type: 'line', x0: data.dates[0], x1: data.dates[data.dates.length - 1], y0: 0, y1: 0, line: { dash: 'dot', color: '#556677', width: 1 } }],
    }
    window.Plotly.newPlot(el, traces, layout, { responsive: true })
    return () => { if (el) window.Plotly.purge(el) }
  }, [data])

  if (!ticker) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
        {error && <div className="alert alert-error">{error}</div>}
        {data && (
          <>
            <h2 style={{ color: '#7ecfff', marginBottom: '0.25rem' }}>{data.ticker} — {data.description}</h2>
            <p style={{ color: '#8899aa', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Purchased {new Date(data.purchase_date).toLocaleDateString()} at {fmt(data.price_paid)}
            </p>
            <div id="ticker-chart" style={{ height: '400px' }} />
          </>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshStatus, setRefreshStatus] = useState(null)
  const [gradeStatus, setGradeStatus] = useState(null)
  const [tickerGrades, setTickerGrades] = useState({})
  const [portfolioGrade, setPortfolioGrade] = useState({})
  const [upcomingDivs, setUpcomingDivs] = useState([])
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [modalTicker, setModalTicker] = useState(null)

  useEffect(() => {
    fetch('/api/holdings')
      .then(res => res.json())
      .then(data => {
        setHoldings(data)
        setLoading(false)
        if (data.length > 0) {
          // Fetch upcoming dividends immediately (no refresh needed)
          fetch('/api/upcoming-dividends')
            .then(r => r.json())
            .then(d => { if (Array.isArray(d)) setUpcomingDivs(d) })
            .catch(() => {})

          setRefreshStatus('Updating prices & dividends...')
          fetch('/api/refresh', { method: 'POST' })
            .then(r => r.json())
            .then(r => {
              setRefreshStatus(r.message)
              return fetch('/api/holdings')
            })
            .then(r => r.json())
            .then(updated => {
              setHoldings(updated)
              setGradeStatus('Loading risk grades...')
              return fetch('/api/portfolio-summary/data')
            })
            .then(r => r.json())
            .then(g => {
              if (g.ticker_grades) setTickerGrades(g.ticker_grades)
              if (g.portfolio_grade) setPortfolioGrade(g.portfolio_grade)
              setGradeStatus('Grades loaded.')
              setTimeout(() => setGradeStatus(null), 3000)
            })
            .catch(() => setGradeStatus('Grade loading failed.'))
        }
      })
      .catch(() => setLoading(false))
  }, [])

  // Derived totals
  const totals = useMemo(() => {
    if (!holdings.length) return {}
    const sum = (key) => holdings.reduce((s, h) => s + (h[key] || 0), 0)
    const purchaseValue = sum('purchase_value')
    const currentValue = sum('current_value')
    const gainLoss = sum('gain_or_loss')
    const totalDivs = sum('total_divs_received')
    const ytdDivs = sum('ytd_divs')
    const monthlyIncome = sum('approx_monthly_income')
    const annualIncome = sum('estim_payment_per_year')
    const currentMonthIncome = sum('current_month_income')

    let avgYoc = 0
    const valid = holdings.filter(h => h.purchase_value > 0 && h.annual_yield_on_cost != null)
    if (valid.length) {
      const wSum = valid.reduce((s, h) => s + h.purchase_value, 0)
      avgYoc = valid.reduce((s, h) => s + h.annual_yield_on_cost * h.purchase_value, 0) / wSum
    }

    const currentYield = currentValue ? (annualIncome / currentValue) : 0
    const priceReturn = purchaseValue ? (gainLoss / purchaseValue) : 0
    const totalReturn = purchaseValue ? ((gainLoss + totalDivs) / purchaseValue) : 0

    return { ytdDivs, monthlyIncome, annualIncome, currentValue, avgYoc, currentYield, priceReturn, totalReturn, purchaseValue, currentMonthIncome }
  }, [holdings])

  // Enrich holdings with computed fields
  const enrichedHoldings = useMemo(() => {
    return holdings
      .filter(h => h.purchase_value > 0 && h.quantity > 0)
      .map(h => {
        const pv = h.purchase_value || 0
        const gl = h.gain_or_loss || 0
        const td = h.total_divs_received || 0
        const cv = h.current_value || 0
        const totalCv = totals.currentValue || 1
        return {
          ...h,
          price_return_pct: pv ? (gl / pv) : 0,
          total_return_pct: pv ? ((gl + td) / pv) : 0,
          pct_of_account: totalCv ? (cv / totalCv) : 0,
        }
      })
  }, [holdings, totals])

  // Sorting
  const sorted = useMemo(() => {
    if (!sortCol) return enrichedHoldings
    return [...enrichedHoldings].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      if (typeof av === 'string') {
        av = (av || '').toLowerCase()
        bv = (bv || '').toLowerCase()
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      av = av || 0
      bv = bv || 0
      return sortAsc ? av - bv : bv - av
    })
  }, [enrichedHoldings, sortCol, sortAsc])

  const handleSort = useCallback((col) => {
    setSortAsc(prev => sortCol === col ? !prev : (typeof enrichedHoldings[0]?.[col] === 'string'))
    setSortCol(col)
  }, [sortCol, enrichedHoldings])

  const SortHeader = ({ col, children, align }) => (
    <th
      onClick={() => handleSort(col)}
      style={{ cursor: 'pointer', textAlign: align || 'left', userSelect: 'none' }}
    >
      {children} {sortCol === col ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  const gradeColor = (v) => v >= 0 ? '#4dff91' : '#ff6b6b'
  const pfiVal = (v) => v == null ? 0 : v * 100
  const pfiColor = (v) => { const p = pfiVal(v); return p >= 100 ? '#4dff91' : p >= 50 ? '#ffd700' : undefined }

  const currentMonth = new Date().toLocaleString('default', { month: 'long' })

  if (loading) {
    return <div className="page" style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
  }

  if (!holdings.length) {
    return (
      <div className="page">
        <h1>Portfolio Dashboard</h1>
        <div className="card">
          <p>No holdings yet. Go to <NavLink to="/import">Import</NavLink> to upload your spreadsheet, or <NavLink to="/holdings">Manage Holdings</NavLink> to add manually.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page dashboard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: 0 }}>Portfolio Dashboard</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {refreshStatus && (
            <span className="alert alert-info" style={{ margin: 0, padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>
              {refreshStatus}
            </span>
          )}
          {gradeStatus && (
            <span className="alert alert-info" style={{ margin: 0, padding: '0.3rem 0.7rem', fontSize: '0.8rem' }}>
              {gradeStatus === 'Loading risk grades...' && <span className="spinner" style={{ width: 14, height: 14, marginRight: 6 }} />}
              {gradeStatus}
            </span>
          )}
        </div>
      </div>

      {/* Summary Cards Strip */}
      <div className="summary-strip">
        <SummaryCard
          className="summary-card-grade"
          label="Portfolio Grade"
          value={portfolioGrade.overall ? <GradeBadge grade={portfolioGrade.overall} large /> : '—'}
          sub={portfolioGrade.score != null ? `Score: ${portfolioGrade.score}` : null}
        />
        <SummaryCard label="Ulcer Index" value={portfolioGrade.ulcer_index ?? '—'} />
        <SummaryCard label="Calmar Ratio" value={portfolioGrade.calmar ?? '—'} />
        <SummaryCard label="Omega Ratio" value={portfolioGrade.omega ?? '—'} />
        <SummaryCard label="Sortino Ratio" value={portfolioGrade.sortino ?? '—'} />
        <SummaryCard label="Sharpe Ratio" value={portfolioGrade.sharpe ?? '—'} />
        <SummaryCard label="YTD Dividends" value={fmt(totals.ytdDivs)} color="#4dff91" />
        <SummaryCard label={`${currentMonth} Income`} value={fmt(totals.currentMonthIncome)} color="#4dff91" />
        <SummaryCard label="Est. Monthly Income" value={fmt(totals.monthlyIncome)} color="#4dff91" />
        <SummaryCard label="Est. Annual Income" value={fmt(totals.annualIncome)} color="#4dff91" />
        <SummaryCard label="Portfolio Value" value={fmt(totals.currentValue)} color="#7ecfff" />
        <SummaryCard label="Avg Yield on Cost" value={pct(totals.avgYoc)} />
        <SummaryCard label="Current Yield" value={pct(totals.currentYield)} />
        <SummaryCard
          label="Price Return"
          value={pct(totals.priceReturn)}
          color={gradeColor(totals.priceReturn)}
        />
        <SummaryCard
          label="Total Return"
          value={pct(totals.totalReturn)}
          color={gradeColor(totals.totalReturn)}
        />
      </div>

      {/* Grade Thresholds (collapsible) */}
      <details className="card" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
        <summary style={{ cursor: 'pointer', color: '#90caf9', fontWeight: 500 }}>Grade Thresholds Guide</summary>
        <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
          <table style={{ fontSize: '0.8rem' }}>
            <thead>
              <tr><th>Metric</th><th>What It Measures</th><th>A</th><th>B</th><th>C</th><th>D</th><th>F</th><th>Weight</th></tr>
            </thead>
            <tbody>
              <tr><td>Ulcer Index</td><td>Drawdown depth &amp; duration (lower = better)</td><td>&le;3</td><td>&le;7</td><td>&le;12</td><td>&le;20</td><td>&gt;20</td><td>20%</td></tr>
              <tr><td>Calmar</td><td>Return / max drawdown</td><td>&ge;1.5</td><td>&ge;1.0</td><td>&ge;0.5</td><td>&ge;0.2</td><td>&lt;0.2</td><td>20%</td></tr>
              <tr><td>Omega</td><td>Gains vs losses</td><td>&ge;2.0</td><td>&ge;1.5</td><td>&ge;1.2</td><td>&ge;1.0</td><td>&lt;1.0</td><td>15%</td></tr>
              <tr><td>Sortino</td><td>Return per downside risk</td><td>&ge;2.0</td><td>&ge;1.5</td><td>&ge;1.0</td><td>&ge;0.5</td><td>&lt;0.5</td><td>12%</td></tr>
              <tr><td>Sharpe</td><td>Return per unit of risk</td><td>&ge;1.5</td><td>&ge;1.0</td><td>&ge;0.5</td><td>&ge;0.0</td><td>&lt;0</td><td>8%</td></tr>
              <tr><td>Max Drawdown</td><td>Worst peak-to-trough</td><td>&le;10%</td><td>&le;20%</td><td>&le;30%</td><td>&le;40%</td><td>&gt;40%</td><td>10%</td></tr>
              <tr><td>Down Capture</td><td>Loss vs benchmark</td><td>&le;80%</td><td>&le;90%</td><td>&le;100%</td><td>&le;120%</td><td>&gt;120%</td><td>5%</td></tr>
              <tr><td>Diversification</td><td>Effective # holdings</td><td>&ge;20</td><td>&ge;12</td><td>&ge;6</td><td>&ge;3</td><td>&lt;3</td><td>10%</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Upcoming Dividends This Week */}
      <UpcomingDividends events={upcomingDivs} />

      {/* Holdings Table */}
      <div className="holdings-table-wrap">
        <table className="holdings-table">
          <thead>
            <tr>
              <SortHeader col="ticker">Ticker</SortHeader>
              <SortHeader col="description">Desc</SortHeader>
              <SortHeader col="category">Cat</SortHeader>
              <SortHeader col="div_frequency" align="center">Freq</SortHeader>
              <SortHeader col="purchase_date">Purchased</SortHeader>
              <SortHeader col="quantity" align="right">Qty</SortHeader>
              <SortHeader col="price_paid" align="right">Paid</SortHeader>
              <SortHeader col="current_price" align="right">Price</SortHeader>
              <SortHeader col="pct_of_account" align="right">%Acct</SortHeader>
              <SortHeader col="gain_or_loss_percentage" align="right">G/L%</SortHeader>
              <SortHeader col="price_return_pct" align="right">PrRtn</SortHeader>
              <SortHeader col="total_return_pct" align="right">TotRtn</SortHeader>
              <SortHeader col="current_annual_yield" align="right">CurYld</SortHeader>
              <SortHeader col="annual_yield_on_cost" align="right">YOC</SortHeader>
              <SortHeader col="ytd_divs" align="right">YTD</SortHeader>
              <SortHeader col="current_month_income" align="right">{currentMonth}</SortHeader>
              <SortHeader col="approx_monthly_income" align="right">Mo$</SortHeader>
              <SortHeader col="estim_payment_per_year" align="right">Yr$</SortHeader>
              <SortHeader col="paid_for_itself" align="right">PFI%</SortHeader>
              <th style={{ textAlign: 'center' }}>Grd</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(h => {
              const g = tickerGrades[h.ticker]
              return (
                <tr key={h.ticker}>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); setModalTicker(h.ticker) }}
                      style={{ color: '#7ecfff', fontWeight: 600 }}
                    >
                      {h.ticker}
                    </a>
                  </td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.description}</td>
                  <td>{h.category || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{h.div_frequency || '—'}</td>
                  <td>{h.purchase_date ? new Date(h.purchase_date).toLocaleDateString() : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{h.quantity}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(h.price_paid)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(h.current_price)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(h.pct_of_account)}</td>
                  <td style={{ textAlign: 'right', color: gradeColor(h.gain_or_loss_percentage) }}>{pct(h.gain_or_loss_percentage)}</td>
                  <td style={{ textAlign: 'right', color: gradeColor(h.price_return_pct) }}>{pct(h.price_return_pct)}</td>
                  <td style={{ textAlign: 'right', color: gradeColor(h.total_return_pct) }}>{pct(h.total_return_pct)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(h.current_annual_yield)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(h.annual_yield_on_cost)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.ytd_divs)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.current_month_income)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.approx_monthly_income)}</td>
                  <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(h.estim_payment_per_year)}</td>
                  <td style={{ textAlign: 'right', color: pfiColor(h.paid_for_itself), fontWeight: pfiVal(h.paid_for_itself) >= 100 ? 700 : 400 }}>
                    {h.paid_for_itself == null ? '—' : (h.paid_for_itself * 100).toFixed(2) + '%'}
                  </td>
                  <td style={{ textAlign: 'center' }}>{g ? <GradeBadge grade={g.grade} /> : '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid #0f3460' }}>
              <td colSpan={14} style={{ textAlign: 'right' }}>Totals</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.ytdDivs)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.currentMonthIncome)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.monthlyIncome)}</td>
              <td style={{ textAlign: 'right', color: '#4dff91' }}>{fmt(totals.annualIncome)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Ticker Modal */}
      {modalTicker && <TickerModal ticker={modalTicker} onClose={() => setModalTicker(null)} />}
    </div>
  )
}
