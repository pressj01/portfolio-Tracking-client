import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { useProfile, useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme, hoverLastPoint } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'
import AccountReconciliation from '../components/AccountReconciliation'
import {
  MIN_PERFORMANCE_DATE,
  PERFORMANCE_PERIODS,
  PERFORMANCE_RANGE_NOTE,
  customRangeError,
  formatAccountingCoverage,
  formatPerformanceChartRange,
  formatPerformanceDate,
  formatPerformanceRange,
  readSharedPerformanceRange,
  todayInputValue,
  writeSharedPerformanceRange,
} from '../utils/performancePeriods'

function TickerFilter({ tickers, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // The applied selection uses [] for "all", but the dropdown needs an explicit
  // list so the All Tickers box has something to clear — otherwise unchecking it
  // is a no-op and picking one ticker means unchecking every other one by hand.
  const applied = useMemo(
    () => (selected.length ? tickers.filter(t => selected.includes(t)) : tickers),
    [selected, tickers],
  )
  // Checkbox clicks edit a draft; only Apply reloads the charts, so building a
  // selection costs one fetch instead of one per box ticked.
  const [draft, setDraft] = useState(applied)
  // Resync during render rather than in an effect: an applied selection that
  // changed underneath us (new range, new account) must not leave a stale draft.
  const [syncedApplied, setSyncedApplied] = useState(applied)
  if (syncedApplied !== applied) {
    setSyncedApplied(applied)
    setDraft(applied)
  }

  const closeAndReset = useCallback(() => {
    setOpen(false)
    setDraft(applied)
  }, [applied])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) closeAndReset() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [closeAndReset])

  const allSelected = selected.length === 0
  const allDrafted = draft.length === tickers.length
  const dirty = draft.length !== applied.length || draft.some(t => !applied.includes(t))

  const toggleTicker = (t) => {
    setDraft(d => (d.includes(t) ? d.filter(x => x !== t) : tickers.filter(x => d.includes(x) || x === t)))
  }

  const apply = () => {
    if (!draft.length) return
    onChange(allDrafted ? [] : draft)
    setOpen(false)
  }

  return (
    <div className="growth-filter-group" style={{ position: 'relative' }} ref={ref}>
      <label>Tickers</label>
      <button
        className="btn btn-secondary"
        style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', minWidth: '140px', textAlign: 'left' }}
        onClick={() => (open ? closeAndReset() : setOpen(true))}
      >
        {allSelected ? `All (${tickers.length})` : `${selected.length} of ${tickers.length}`}
        <span style={{ float: 'right', marginLeft: '0.5rem' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="growth-cat-dropdown growth-ticker-dropdown" style={{ maxHeight: '400px', minWidth: '220px' }}>
          <div className="growth-ticker-head">
            <label className="growth-cat-option">
              <input
                type="checkbox"
                checked={allDrafted}
                ref={el => { if (el) el.indeterminate = !allDrafted && draft.length > 0 }}
                onChange={() => setDraft(allDrafted ? [] : tickers)}
              />
              <span>All Tickers</span>
            </label>
          </div>
          <div className="growth-ticker-list">
            {tickers.map(t => (
              <label key={t} className="growth-cat-option">
                <input
                  type="checkbox"
                  checked={draft.includes(t)}
                  onChange={() => toggleTicker(t)}
                />
                <span>{t}</span>
              </label>
            ))}
          </div>
          <div className="growth-ticker-actions">
            <span className="growth-ticker-count">{draft.length} of {tickers.length}</span>
            <button className="btn btn-secondary" onClick={closeAndReset}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={apply}
              disabled={!draft.length || !dirty}
              title={!draft.length ? 'Select at least one ticker' : undefined}
            >
              Apply
            </button>
          </div>
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
  const rangeError = customRangeError(period, customStart, customEnd)
  // Start and End Value are single closes, so they carry their own as-of date.
  // Printing the whole range on them read as if each number spanned the period.
  const startValueDate = data ? formatPerformanceDate(data.actual_start_date) : ''
  const endValueDate = data ? formatPerformanceDate(data.actual_end_date) : ''
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
    // `pf` carries the profile/basis query string and can change without
    // `selection` doing so, which otherwise leaves this page on the previous
    // account's data — and stops the cost-basis toggle from taking effect.
  }, [period, customStart, customEnd, rangeError, selectedTickers, profitMode, showTrades, showCostBasis, groupProfitSource, selection, pf])

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

    // A transaction-aware return has exactly two components: price movement and
    // distributions. Realized P&L and fees are not separate lines here — a sale
    // reweights the portfolio rather than booking a gain into the index — and
    // the endpoint no longer sends them.
    const traces = []
    if (groupProfitSource) {
      traces.push(
        { x: performanceDates, y: perf.capital_gain, name: 'Price return', line: { color: '#7ecfff', width: 2 }, hovertemplate: `${prefix}%{y:${hoverFmt}}${suffix}<extra>Price return</extra>` },
        { x: performanceDates, y: perf.dividends, name: 'Distributions', line: { color: '#ff9800', width: 2 }, hovertemplate: `${prefix}%{y:${hoverFmt}}${suffix}<extra>Distributions</extra>` },
      )
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

      <details className="tracker-help">
        <summary>What are these charts showing?</summary>
        <p className="tracker-help-footer">
          <strong>One tracker return across the app:</strong> Tracker Total Return % uses the same
          transaction-aware, dividend-reinvested index as Growth &amp; Performance and Total Return when
          the account, date range, and holdings scope match. The dollar card and return chart use
          the same cash-flow-adjusted ledger, so purchases and sales never appear as gains or losses.
        </p>
        <div className="tracker-help-grid">
          <section>
            <h3>Portfolio value</h3>
            <p>
              The blue line is the share count actually held on each date, replayed from your dated
              buy and sell history, priced at that day's close. It comes from the same calculation as
              the return card below it, so Start Value and End Value reconcile with Total Return and
              Gains &amp; Losses.
            </p>
            <ul>
              <li><strong>Portfolio:</strong> market value of the shares held on each date, plus recorded cash.</li>
              <li><strong>Invested:</strong> recorded cost basis, added when each holding first enters the timeline.</li>
              <li><strong>Trade markers:</strong> recorded buys and sells when Show trades is enabled.</li>
            </ul>
            <p className="tracker-help-note">
              Start Value is the portfolio's real opening balance for the range, not today's share
              counts priced backward. It differs from Total Return only by any recorded cash balance,
              which this chart includes and that page does not. Each figure is a single close, so
              each carries its own as-of date rather than the whole range.
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
            <p className="tracker-help-note">
              Switch between amount and percent to change the Y-axis units. The amount reconciles to
              Total Return dollars; the percent reconciles to Tracker Total Return %.
            </p>
          </section>
          {/* Full width: this one is about both cards, not about either chart. */}
          <section className="tracker-help-wide">
            <h3>Reconciling to your broker</h3>
            <p>
              End Value is the shares you hold priced at the latest close, plus your recorded cash. A
              broker's net liquidating value already includes that cash, so adding the two together
              double counts it.
            </p>
            <ul>
              <li>
                <strong>Open options:</strong> shown beside End Value only when the account is
                carrying open contracts, marked at the current bid/ask mid. Short spreads mark
                negative, because closing them costs money — that is why a broker can read lower than
                this page.
              </li>
              <li>
                <strong>Account:</strong> End Value plus that mark. This is the figure to compare
                against net liquidating value. Total Return and Gains &amp; Losses show it as its own
                Account Value card, because their headline figures leave cash out and this one
                does not.
              </li>
            </ul>
            <p className="tracker-help-note">
              Option positions live in the separate option trade ledger and have no history in this
              replay, so they never touch the value chart, the invested line, or either return card —
              they are a present-day reconciliation only. Legs the option chain cannot quote are
              listed rather than marked at zero, which would read as a free short. A small residual
              against your broker is normal: this page uses the last traded price at load time, and a
              broker marks its own realtime feed at the moment you look.
            </p>
          </section>
        </div>
        <p className="tracker-help-footer">
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
            {' The value chart and the return card share one replayed series, so both use the tracker range shown on them.'}
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
              <div className="summary-label">Start Value</div>
              <div className="summary-value">{formatMoney(data.summary?.start_value)}</div>
              {/* Cash is a present-day balance carried across the whole line, so
                  it is in this figure too — say so here rather than only on End
                  Value, where it used to look like an end-of-period addition. */}
              {data.summary?.cash_value > 0 && (
                <div className="summary-sub">Includes {formatMoney(data.summary.cash_value)} cash (current balance)</div>
              )}
              {startValueDate && <div className="summary-sub">As of {startValueDate} close</div>}
            </div>
            <div className="summary-card">
              <div className="summary-label">End Value</div>
              <div className="summary-value">{formatMoney(data.summary?.end_value)}</div>
              {data.summary?.cash_value > 0 && (
                <div className="summary-sub">Includes {formatMoney(data.summary.cash_value)} cash (current balance)</div>
              )}
              {endValueDate && <div className="summary-sub">As of {endValueDate} close</div>}
              <AccountReconciliation data={data.summary?.account_reconciliation} />
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

              <Toggle label="Group by the profit source" value={groupProfitSource} onChange={setGroupProfitSource} />

            </div>
          </div>
        </>
      )}
    </div>
  )
}
