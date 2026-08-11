import React, { useState, useEffect, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme, hoverLastPoint } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'
import {
  MIN_PERFORMANCE_DATE,
  PERFORMANCE_PERIODS,
  PERFORMANCE_RANGE_NOTE,
  customRangeError,
  formatAccountingCoverage,
  formatPerformanceChartRange,
  formatPerformanceRange,
  readSharedPerformanceRange,
  todayInputValue,
  writeSharedPerformanceRange,
} from '../utils/performancePeriods'

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
  const [initialCustomDates] = useState(() => readSharedPerformanceRange())
  const [period, setPeriod] = useState(initialCustomDates.period)
  const [customStart, setCustomStart] = useState(initialCustomDates.start)
  const [customEnd, setCustomEnd] = useState(initialCustomDates.end)
  const [selectedTickers, setSelectedTickers] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    writeSharedPerformanceRange(period, customStart, customEnd)
  }, [period, customStart, customEnd])

  // Chart 1 controls
  const [showCostBasis, setShowCostBasis] = useState(true)
  const [showTrades, setShowTrades] = useState(false)

  // Chart 2 controls
  const [profitMode, setProfitMode] = useState('dollar')
  const [groupProfitSource, setGroupProfitSource] = useState(true)
  const [groupBy, setGroupBy] = useState('none')
  const rangeError = customRangeError(period, customStart, customEnd)
  const cardRange = data
    ? formatPerformanceRange(data.actual_start_date, data.actual_end_date)
    : ''
  const trackerCardRange = data
    ? formatPerformanceRange(
        data.tracker_actual_start_date || data.actual_start_date,
        data.tracker_actual_end_date || data.actual_end_date,
      )
    : ''

  useEffect(() => {
    if (rangeError) {
      setData(null)
      setLoading(false)
      setError(rangeError)
      return undefined
    }
    let active = true
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      period: period.toLowerCase(),
      profit_mode: profitMode,
      show_trades: showTrades ? 'true' : 'false',
      show_cost_basis: showCostBasis ? 'true' : 'false',
      group_profit_source: groupProfitSource ? 'true' : 'false',
      group_by: groupBy,
    })
    if (selectedTickers.length > 0) {
      params.set('tickers', selectedTickers.join(','))
    }
    if (period === 'custom') {
      params.set('start_date', customStart)
      params.set('end_date', customEnd)
    }
    pf(`/api/growth-2/data?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!active) return
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    // A superseded range must not paint over the current one: a request for a
    // wide window outlives the narrow one typed after it and would land last.
    return () => { active = false }
  }, [period, customStart, customEnd, rangeError, selectedTickers, profitMode, showTrades, showCostBasis, groupProfitSource, groupBy, selection])

  // ── Chart 1: Portfolio Value ──
  useEffect(() => {
    if (!data || !window.Plotly) return
    const Plotly = window.Plotly
    const ct = chartTheme(isDark)
    const chartRange = formatPerformanceChartRange(
      data.requested_start_date,
      data.requested_end_date,
      data.actual_start_date,
      data.actual_end_date,
    )
    const el = document.getElementById('g2-value-chart')
    if (!el) return
    // Open the unified hover box on the last date so the current value reads
    // without hovering. Guarded: cleanup can purge the plot before newPlot lands.
    let cancelled = false

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
      title: { text: `Portfolio value${chartRange ? `<br><sup>${chartRange}</sup>` : ''}`, font: { size: 16, color: ct.title } },
      margin: { l: 80, r: 20, t: 70, b: 50 },
      hovermode: 'x unified',
      legend: { orientation: 'h', y: -0.12, xanchor: 'center', x: 0.5, font: { size: 11 } },
      xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, automargin: true },
      yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, tickformat: '$,.0f', title: '', automargin: true },
    }, { responsive: true }).then(() => { if (!cancelled) hoverLastPoint(el) })

    return () => {
      cancelled = true
      if (document.getElementById('g2-value-chart')) Plotly.purge(el)
    }
  }, [data, showCostBasis, showTrades, isDark])

  // ── Chart 2: Portfolio Performance ──
  useEffect(() => {
    if (!data || !window.Plotly) return
    const Plotly = window.Plotly
    const ct = chartTheme(isDark)
    const chartRange = formatPerformanceChartRange(
      data.requested_start_date,
      data.requested_end_date,
      data.tracker_actual_start_date,
      data.tracker_actual_end_date,
    )
    const el = document.getElementById('g2-perf-chart')
    if (!el) return
    let cancelled = false

    const perf = data.performance
    const performanceDates = data.performance_dates || data.dates
    const unit = data.profit_unit
    const isPct = unit === '%'
    // Keep the currency/percent sign out of the d3 number format and supply it
    // via prefix/suffix only — otherwise the '$' in the format plus tickprefix
    // render a doubled/inconsistent sign. Hover shows 2 decimals for both units;
    // the axis keeps 2 decimals for % but drops cents on dollar ticks.
    const hoverFmt = isPct ? '.2f' : ',.2f'
    const axisFmt = isPct ? '.2f' : ',.0f'
    const suffix = isPct ? '%' : ''
    const prefix = isPct ? '' : '$'

    // Determine if optional series have meaningful values (> 1% of total P&L range)
    const totalRange = Math.max(...perf.total.map(Math.abs).filter(v => v != null), 1)
    const isNonTrivial = (arr) => arr && Math.max(...arr.map(v => Math.abs(v || 0))) > totalRange * 0.01

    const traces = []
    if (groupProfitSource) {
      traces.push(
        { x: performanceDates, y: perf.capital_gain, name: 'Price return', line: { color: '#7ecfff', width: 2 }, hovertemplate: `${prefix}%{y:${hoverFmt}}${suffix}<extra>Price return</extra>` },
        { x: performanceDates, y: perf.dividends, name: 'Distributions', line: { color: '#ff9800', width: 2 }, hovertemplate: `${prefix}%{y:${hoverFmt}}${suffix}<extra>Distributions</extra>` },
      )
      if (isNonTrivial(perf.realized_pl)) {
        traces.push({ x: performanceDates, y: perf.realized_pl, name: 'Realized P&L', line: { color: '#4dff91', width: 2 }, hovertemplate: `${prefix}%{y:${hoverFmt}}${suffix}<extra>Realized P&L</extra>` })
      }
      if (isNonTrivial(perf.fees)) {
        traces.push({ x: performanceDates, y: perf.fees, name: 'Fee', line: { color: '#e040fb', width: 1.5 }, hovertemplate: `${prefix}%{y:${hoverFmt}}${suffix}<extra>Fee</extra>` })
      }
    }
    traces.push(
      { x: performanceDates, y: perf.total, name: 'Tracker total return', line: { color: groupProfitSource ? '#b0bec5' : '#7ecfff', width: groupProfitSource ? 1.5 : 2.5, dash: groupProfitSource ? 'dot' : undefined }, hovertemplate: `${prefix}%{y:${hoverFmt}}${suffix}<extra>Tracker total return</extra>` },
    )

    Plotly.newPlot(el, traces, {
      template: ct.template,
      paper_bgcolor: ct.paper,
      plot_bgcolor: ct.plot,
      font: { color: ct.font },
      height: 420,
      title: { text: `Transaction-aware return${chartRange ? `<br><sup>${chartRange}</sup>` : ''}`, font: { size: 16, color: ct.title } },
      margin: { l: 80, r: 20, t: 70, b: 50 },
      hovermode: 'x unified',
      legend: { orientation: 'h', y: -0.12, xanchor: 'center', x: 0.5, font: { size: 11 } },
      xaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, automargin: true },
      yaxis: { gridcolor: ct.grid, zerolinecolor: ct.zeroline, tickformat: axisFmt, tickprefix: prefix, ticksuffix: suffix, title: '', automargin: true },
    }, { responsive: true }).then(() => { if (!cancelled) hoverLastPoint(el) })

    return () => {
      cancelled = true
      if (document.getElementById('g2-perf-chart')) Plotly.purge(el)
    }
  }, [data, groupProfitSource, profitMode, isDark])

  return (
    <div className="page dashboard">
      <h1 style={{ marginBottom: '1rem' }}>Portfolio Growth 2</h1>

      {/* ── Shared filters ── */}
      <div className="growth-filters">
        <div className="growth-filter-group">
          <label>Shared Performance Date Range</label>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {PERFORMANCE_PERIODS.map(option => (
              <button
                key={option.key}
                className={`tab${period === option.key ? ' active' : ''}`}
                onClick={() => setPeriod(option.key)}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="tr-note perf-range-note">{PERFORMANCE_RANGE_NOTE}</p>
        </div>
        {period === 'custom' && (
          <div className="g2-custom-range" role="group" aria-label="Custom date range">
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
        {data?.tickers?.length > 0 && (
          <TickerFilter
            tickers={data.tickers}
            selected={selectedTickers}
            onChange={setSelectedTickers}
          />
        )}
      </div>

      <details className="g2-help">
        <summary>What are these charts showing?</summary>
        <p className="g2-help-footer">
          <strong>One tracker return across the app:</strong> Tracker Total Return % uses the same
          transaction-aware, dividend-reinvested index as Growth &amp; Performance and Total Return when
          the account, date range, and holdings scope match. The dollar card and return chart use
          the same cash-flow-adjusted ledger, so purchases and sales never appear as gains or losses.
        </p>
        <div className="g2-help-grid">
          <section>
            <h3>Portfolio value</h3>
            <p>
              The blue line estimates what the selected holdings were worth on each date using current
              share quantities and Yahoo Finance adjusted closing prices. A holding begins at its first
              known purchase or transaction date, so it is not projected backward into years before you
              owned it.
            </p>
            <ul>
              <li><strong>Portfolio:</strong> combined estimated market value of the selected holdings.</li>
              <li><strong>Invested:</strong> recorded cost basis, added when each holding first enters the timeline.</li>
              <li><strong>Trade markers:</strong> recorded buys and sells when Show trades is enabled.</li>
            </ul>
            <p className="g2-help-note">
              This is a historical estimate based on today's open share quantities, not a reconstructed
              account balance with historical cash and share-count changes.
            </p>
          </section>
          <section>
            <h3>Transaction-aware return</h3>
            <p>
              This chart explains the same return used by the Total Return Dashboard. Buys and sells
              change the shares being measured after the trade date; they do not create profit or loss.
            </p>
            <ul>
              <li><strong>Price return:</strong> cumulative market-price gain or loss while each position was held.</li>
              <li><strong>Distributions:</strong> actual broker payments, with Yahoo history only where broker history is unavailable.</li>
              <li><strong>Tracker total return:</strong> price return plus distributions in amount mode; the shared dividend-reinvested return in percent mode.</li>
            </ul>
            <p className="g2-help-note">
              Switch between amount and percent to change the Y-axis units. The amount reconciles to
              Total Return dollars; the percent reconciles to Tracker Total Return %.
            </p>
          </section>
        </div>
        <p className="g2-help-footer">
          Period and ticker filters apply to both charts. Custom start and end dates are inclusive.
        </p>
      </details>

      {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && !loading && (
        <>
          <p className="tr-note" style={{ marginTop: 0 }}>
            <strong>{data.period_label}:</strong>{' '}
            {formatPerformanceRange(data.actual_start_date, data.actual_end_date)}
            {data.requested_start_date && data.actual_start_date !== data.requested_start_date
              ? ` (requested from ${formatPerformanceRange(data.requested_start_date, data.requested_end_date)})`
              : ''}.
            {' The value chart begins when current-position history is available; the return card and chart use the tracker range shown on them.'}
            {formatAccountingCoverage(data.tracker_coverage)
              ? ` ${formatAccountingCoverage(data.tracker_coverage)}`
              : ''}
          </p>
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            <strong>Reconcile this page:</strong> use <strong>Tracker Total Return %</strong> to compare
            this portfolio with Growth &amp; Performance and Total Return. It is the shared return measure.
            <strong> Tracker Total Return $</strong> is the matching cash-flow-adjusted dollar result:
            price return plus distributions, without treating deposits, purchases, or sales as performance.
            {' '}The selected range is remembered across all five tracking screens, including Gains &amp; Losses.
          </div>
          <div className="summary-strip" style={{ marginBottom: '1rem' }}>
            <div className="summary-card">
              <div className="summary-label">Estimated Start Value</div>
              <div className="summary-value">{formatMoney(data.summary?.start_value)}</div>
              {cardRange && <div className="summary-sub">Range: {cardRange}</div>}
            </div>
            <div className="summary-card">
              <div className="summary-label">Estimated End Value</div>
              <div className="summary-value">{formatMoney(data.summary?.end_value)}</div>
              {data.summary?.cash_value > 0 && (
                <div className="summary-sub">Includes {formatMoney(data.summary.cash_value)} cash</div>
              )}
              {cardRange && <div className="summary-sub">Range: {cardRange}</div>}
            </div>
            <div className="summary-card">
              <div className="summary-label">Tracker Total Return $</div>
              <div className="summary-value">{formatMoney(data.summary?.total_profit_amount)}</div>
              <div className="summary-sub">
                Price {formatMoney(data.summary?.price_return_amount)} + distributions {formatMoney(data.summary?.distribution_amount)}
              </div>
              {trackerCardRange && <div className="summary-sub">Range: {trackerCardRange}</div>}
            </div>
            <div className="summary-card">
              <div className="summary-label">Tracker Total Return %</div>
              <div className="summary-value">
                {data.summary?.total_return_pct != null ? `${Number(data.summary.total_return_pct).toFixed(2)}%` : '—'}
              </div>
              <div className="summary-sub">Same return standard as Growth &amp; Total Return</div>
              {trackerCardRange && <div className="summary-sub">Range: {trackerCardRange}</div>}
            </div>
          </div>
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
                options={[{ value: 'pct', label: 'Tracker return, %' }, { value: 'dollar', label: 'Tracker return, amount' }]}
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

            </div>
          </div>
        </>
      )}
    </div>
  )
}
