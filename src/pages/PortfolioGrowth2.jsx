import React, { useState, useEffect, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'

const PERIODS = ['7d', '1m', '3m', '6m', 'YTD', '1y', '5y', 'all']
const PERIOD_LABELS = { '7d': '7d', '1m': '1m', '3m': '3m', '6m': '6m', 'YTD': 'YTD', '1y': '1y', '5y': '5y', 'all': 'all' }

function TickerFilter({ tickers, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const allSelected = selected.length === 0
  const toggleTicker = (t) => {
    if (selected.includes(t)) {
      onChange(selected.filter(x => x !== t))
    } else {
      onChange([...selected, t])
    }
  }

  return (
    <div className="growth-filter-group" style={{ position: 'relative' }} ref={ref}>
      <label>Tickers</label>
      <button
        className="btn btn-secondary"
        style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
        onClick={() => setOpen(o => !o)}
      >
        {allSelected ? `All (${tickers.length})` : `${selected.length} of ${tickers.length}`}
        <span style={{ float: 'right', marginLeft: '0.5rem' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="growth-cat-dropdown" style={{ maxHeight: '400px', minWidth: '200px' }}>
          <label className="growth-cat-option" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.4rem', marginBottom: '0.2rem' }}>
            <input type="checkbox" checked={allSelected} onChange={() => onChange([])} />
            <span>All Tickers</span>
          </label>
          {tickers.map(t => (
            <label key={t} className="growth-cat-option">
              <input
                type="checkbox"
                checked={allSelected || selected.includes(t)}
                onChange={() => {
                  if (allSelected) {
                    onChange(tickers.filter(x => x !== t))
                  } else {
                    toggleTicker(t)
                  }
                }}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function Toggle({ label, value, onChange, tooltip }) {
  return (
    <div className="g2-toggle-row">
      <span className="g2-toggle-label">
        {label}
        {tooltip && <span className="g2-tooltip-icon" title={tooltip}>&#9432;</span>}
      </span>
      <button
        className={`g2-toggle ${value ? 'g2-toggle-on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        <span className="g2-toggle-knob" />
      </button>
    </div>
  )
}

function TabButtons({ options, value, onChange }) {
  return (
    <div className="g2-tab-btns">
      {options.map(o => (
        <button
          key={o.value}
          className={`g2-tab-btn${value === o.value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function PortfolioGrowth2() {
  const pf = useProfileFetch()
  const { selection } = useProfile()
  const { isDark } = useTheme()

  // Shared state
  const [period, setPeriod] = useState('1y')
  const [selectedTickers, setSelectedTickers] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Chart 1 controls
  const [showCostBasis, setShowCostBasis] = useState(true)
  const [showTrades, setShowTrades] = useState(false)

  // Chart 2 controls
  const [profitMode, setProfitMode] = useState('dollar')
  const [groupProfitSource, setGroupProfitSource] = useState(true)
  const [plBasis, setPlBasis] = useState('selected_period')
  const [groupBy, setGroupBy] = useState('none')

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      period: period.toLowerCase(),
      profit_mode: profitMode,
      pl_basis: plBasis,
      show_trades: showTrades ? 'true' : 'false',
      show_cost_basis: showCostBasis ? 'true' : 'false',
      group_profit_source: groupProfitSource ? 'true' : 'false',
      group_by: groupBy,
    })
    if (selectedTickers.length > 0) {
      params.set('tickers', selectedTickers.join(','))
    }
    pf(`/api/growth-2/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [period, selectedTickers, profitMode, plBasis, showTrades, showCostBasis, groupProfitSource, groupBy, selection])

  // ── Chart 1: Portfolio Value ──
  useEffect(() => {
    if (!data || !window.Plotly) return
    const Plotly = window.Plotly
    const ct = chartTheme(isDark)
    const el = document.getElementById('g2-value-chart')
    if (!el) return

    const traces = [
      {
        x: data.dates, y: data.portfolio_value, name: 'Portfolio',
        line: { color: '#7ecfff', width: 2 },
        hovertemplate: '$%{y:,.2f}<extra>Portfolio</extra>',
        fill: 'tozeroy', fillcolor: 'rgba(126,207,255,0.08)',
      },
    ]
    if (showCostBasis) {
      traces.push({
        x: data.dates, y: data.invested, name: 'Invested',
        line: { color: '#ff9800', width: 2, dash: 'dot' },
        hovertemplate: '$%{y:,.2f}<extra>Invested</extra>',
      })
    }

    if (showTrades && data.trade_points?.length) {
      const buys = data.trade_points.filter(p => p.type === 'BUY')
      const sells = data.trade_points.filter(p => p.type === 'SELL')
      if (buys.length) {
        traces.push({
          x: buys.map(p => p.date), y: buys.map(p => p.value),
          mode: 'markers', name: 'Buy',
          marker: { color: '#4dff91', size: 8, symbol: 'triangle-up' },
          hovertemplate: '%{text}<extra>Buy</extra>',
          text: buys.map(p => `${p.ticker}: ${p.shares} @ ${formatMoney(p.price)}`),
        })
      }
      if (sells.length) {
        traces.push({
          x: sells.map(p => p.date), y: sells.map(p => p.value),
          mode: 'markers', name: 'Sell',
          marker: { color: '#ff5252', size: 8, symbol: 'triangle-down' },
          hovertemplate: '%{text}<extra>Sell</extra>',
          text: sells.map(p => `${p.ticker}: ${p.shares} @ ${formatMoney(p.price)}`),
        })
      }
    }

    Plotly.newPlot(el, traces, {
      template: ct.template,
      paper_bgcolor: ct.paper,
      plot_bgcolor: ct.plot,
      font: { color: ct.font },
      height: 420,
      title: { text: 'Portfolio value', font: { size: 16, color: ct.title } },
      margin: { l: 60, r: 20, t: 50, b: 50 },
      hovermode: 'x unified',
      legend: { orientation: 'h', y: -0.12, xanchor: 'center', x: 0.5, font: { size: 11 } },
      xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
      yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, tickformat: '$,.0f', title: '' },
    }, { responsive: true })

    return () => { if (document.getElementById('g2-value-chart')) Plotly.purge(el) }
  }, [data, showCostBasis, showTrades, isDark])

  // ── Chart 2: Portfolio Performance ──
  useEffect(() => {
    if (!data || !window.Plotly) return
    const Plotly = window.Plotly
    const ct = chartTheme(isDark)
    const el = document.getElementById('g2-perf-chart')
    if (!el) return

    const perf = data.performance
    const unit = data.profit_unit
    const fmt = unit === '%' ? '.2f' : '$,.2f'
    const suffix = unit === '%' ? '%' : ''
    const prefix = unit === '$' ? '$' : ''

    // Determine if optional series have meaningful values (> 1% of total P&L range)
    const totalRange = Math.max(...perf.total.map(Math.abs).filter(v => v != null), 1)
    const isNonTrivial = (arr) => arr && Math.max(...arr.map(v => Math.abs(v || 0))) > totalRange * 0.01

    const traces = []
    if (groupProfitSource) {
      traces.push(
        { x: data.dates, y: perf.capital_gain, name: 'Capital gain', line: { color: '#7ecfff', width: 2 }, hovertemplate: `${prefix}%{y:${fmt}}${suffix}<extra>Capital gain</extra>` },
        { x: data.dates, y: perf.dividends, name: 'Dividends', line: { color: '#ff9800', width: 2 }, hovertemplate: `${prefix}%{y:${fmt}}${suffix}<extra>Dividends</extra>` },
      )
      if (isNonTrivial(perf.realized_pl)) {
        traces.push({ x: data.dates, y: perf.realized_pl, name: 'Realized P&L', line: { color: '#4dff91', width: 2 }, hovertemplate: `${prefix}%{y:${fmt}}${suffix}<extra>Realized P&L</extra>` })
      }
      if (isNonTrivial(perf.fees)) {
        traces.push({ x: data.dates, y: perf.fees, name: 'Fee', line: { color: '#e040fb', width: 1.5 }, hovertemplate: `${prefix}%{y:${fmt}}${suffix}<extra>Fee</extra>` })
      }
    }
    traces.push(
      { x: data.dates, y: perf.total, name: 'Total', line: { color: groupProfitSource ? '#b0bec5' : '#7ecfff', width: groupProfitSource ? 1.5 : 2.5, dash: groupProfitSource ? 'dot' : undefined }, hovertemplate: `${prefix}%{y:${fmt}}${suffix}<extra>Total</extra>` },
    )

    Plotly.newPlot(el, traces, {
      template: ct.template,
      paper_bgcolor: ct.paper,
      plot_bgcolor: ct.plot,
      font: { color: ct.font },
      height: 420,
      title: { text: 'Portfolio performance', font: { size: 16, color: ct.title } },
      margin: { l: 60, r: 20, t: 50, b: 50 },
      hovermode: 'x unified',
      legend: { orientation: 'h', y: -0.12, xanchor: 'center', x: 0.5, font: { size: 11 } },
      xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline },
      yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, tickformat: fmt, tickprefix: prefix, ticksuffix: suffix, title: '' },
    }, { responsive: true })

    return () => { if (document.getElementById('g2-perf-chart')) Plotly.purge(el) }
  }, [data, groupProfitSource, profitMode, isDark])

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '1rem' }}>Portfolio Growth 2</h1>

      {/* ── Shared filters ── */}
      <div className="growth-filters">
        <div className="growth-filter-group">
          <label>Period</label>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {PERIODS.map(p => (
              <button
                key={p}
                className={`tab${period === p ? ' active' : ''}`}
                onClick={() => setPeriod(p)}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        {data?.tickers?.length > 0 && (
          <TickerFilter
            tickers={data.tickers}
            selected={selectedTickers}
            onChange={setSelectedTickers}
          />
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          {/* ── Chart 1: Portfolio Value ── */}
          <div className="g2-chart-section">
            <div className="g2-chart-area">
              <div id="g2-value-chart" className="g2-chart-box" />
            </div>
            <div className="g2-chart-controls">
              <Toggle label="Show cost basis" value={showCostBasis} onChange={setShowCostBasis} tooltip="Show the total invested amount line" />
              <Toggle label="Show trades" value={showTrades} onChange={(v) => { setShowTrades(v) }} />
            </div>
          </div>

          {/* ── Chart 2: Portfolio Performance ── */}
          <div className="g2-chart-section">
            <div className="g2-chart-area">
              <div id="g2-perf-chart" className="g2-chart-box" />
            </div>
            <div className="g2-chart-controls">
              <TabButtons
                options={[{ value: 'pct', label: 'Total profit, %' }, { value: 'dollar', label: 'Total profit, amount' }]}
                value={profitMode}
                onChange={setProfitMode}
              />

              <div className="g2-control-row">
                <span className="g2-control-label">Group by</span>
                <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="g2-select">
                  <option value="none">No grouping</option>
                  <option value="ticker">Ticker</option>
                  <option value="category">Category</option>
                </select>
              </div>

              <Toggle label="Group by the profit source" value={groupProfitSource} onChange={setGroupProfitSource} />

              <div className="g2-pl-control">
                <div className="g2-control-label g2-pl-label">Calculate P/L for:</div>
                <TabButtons
                  options={[{ value: 'selected_period', label: 'Selected period' }, { value: 'first_trade', label: 'From the first trade' }]}
                  value={plBasis}
                  onChange={setPlBasis}
                />
                <div className="g2-hint">
                  {plBasis === 'selected_period'
                    ? 'P/L is calculated relative to the portfolio value at the beginning of the period.'
                    : 'P/L is calculated relative to total invested cost basis (purchase price).'}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
