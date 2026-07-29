import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Plot from './ThemedPlot'
import { useProfileFetch } from '../context/ProfileContext'
import { useTheme } from '../context/ThemeContext'
import { chartTheme } from '../utils/chartTheme'
import { formatMoney } from '../utils/money'
import { sma, computeMacd, computeRsi, tradingSessionRangeBreaks } from '../utils/chartIndicators'

const PERIODS = [
  { value: '3mo', label: '3M' }, { value: '6mo', label: '6M' },
  { value: 'ytd', label: 'YTD' }, { value: '1y', label: '1Y' },
  { value: '2y', label: '2Y' }, { value: '5y', label: '5Y' },
]

const MA_CONFIG = [
  { period: 50, color: '#FF6B35' },
  { period: 200, color: '#2EC4B6' },
]

// Panel heights, price pane first. Matches the Analysis screen's proportions.
const PRICE_WEIGHT = 3
const PANEL_WEIGHT = 1

export default function PriceChartModal({ ticker, onClose, initialPeriod = '1y' }) {
  const pf = useProfileFetch()
  const { isDark } = useTheme()
  const [period, setPeriod] = useState(initialPeriod)
  const [chartType, setChartType] = useState('candlestick')
  const [records, setRecords] = useState([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    setLoading(true)
    setError('')
    // Same endpoint and mode the Stock and ETF Analysis price chart uses, so the
    // popup shows exactly the series that screen would draw.
    pf(`/api/etf-screen/data?ticker=${encodeURIComponent(ticker)}&period=${period}&mode=ohlcv`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.error) { setError(d.error); setRecords([]) }
        else { setRecords(d.records || []); setName(d.name || d.ticker || '') }
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pf, ticker, period])

  const { data, layout } = useMemo(() => {
    if (!records.length) return { data: [], layout: {} }
    const ct = chartTheme(isDark)
    const dates = records.map(r => r.date)
    const closes = records.map(r => r.close)
    const hasVolume = records.some(r => r.volume > 0)

    const traces = []

    if (chartType === 'candlestick') {
      traces.push({
        x: dates,
        open: records.map(r => r.open), high: records.map(r => r.high),
        low: records.map(r => r.low), close: closes,
        type: 'candlestick', name: ticker,
        increasing: { line: { color: '#26A69A' } },
        decreasing: { line: { color: '#EF5350' } },
        xaxis: 'x', yaxis: 'y', hoverinfo: 'skip',
      })
      // Invisible overlay so every bar gets a consistent OHLC hover box.
      traces.push({
        x: dates, y: closes, type: 'scatter', mode: 'markers',
        marker: { size: 0.1, color: 'rgba(0,0,0,0)' }, showlegend: false,
        hovertemplate: records.map(r =>
          `<b>%{x|%a %b %d, %Y}</b><br>O: ${formatMoney(r.open)}<br>H: ${formatMoney(r.high)}<br>L: ${formatMoney(r.low)}<br>C: ${formatMoney(r.close)}<extra></extra>`),
        xaxis: 'x', yaxis: 'y',
      })
    } else {
      traces.push({
        x: dates, y: closes, type: 'scatter', mode: 'lines', name: ticker,
        line: { color: '#2196F3', width: 2 }, xaxis: 'x', yaxis: 'y',
      })
    }

    // Moving averages on the price pane.
    MA_CONFIG.forEach(({ period: maPeriod, color }) => {
      traces.push({
        x: dates, y: sma(closes, maPeriod), type: 'scatter', mode: 'lines',
        name: `SMA ${maPeriod}`, line: { color, width: 1.5 },
        xaxis: 'x', yaxis: 'y',
      })
    })

    const macd = computeMacd(records)
    const rsi = computeRsi(records)

    // Panel order below price: volume (when present), MACD, RSI.
    const panels = []
    if (hasVolume) {
      panels.push({
        title: 'Volume',
        traces: [{
          x: dates, y: records.map(r => r.volume || 0), type: 'bar', name: 'Volume',
          marker: { color: records.map(r => r.close >= r.open ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)') },
          showlegend: false,
        }],
      })
    }
    panels.push({ title: macd.subTitle, traces: macd.subTraces })
    panels.push({ title: rsi.subTitle, traces: rsi.subTraces })

    panels.forEach((panel, i) => {
      const axisIdx = i + 2
      panel.traces.forEach(t => traces.push({ ...t, xaxis: 'x', yaxis: `y${axisIdx}` }))
    })

    // Stack the domains top-down with a small gap between panes.
    const totalWeight = PRICE_WEIGHT + panels.length * PANEL_WEIGHT
    const gap = 0.03
    const domains = []
    let cursor = 1
    const priceH = PRICE_WEIGHT / totalWeight
    domains.push([cursor - priceH + gap / 2, cursor])
    cursor -= priceH
    panels.forEach((_, i) => {
      const h = PANEL_WEIGHT / totalWeight
      const top = cursor
      const bottom = cursor - h + (i < panels.length - 1 ? gap / 2 : 0)
      domains.push([Math.max(0, bottom), top - gap / 2])
      cursor -= h
    })

    const spike = { showspikes: true, spikemode: 'across', spikethickness: 1, spikecolor: '#888', spikedash: 'dot' }

    const built = {
      paper_bgcolor: ct.paper, plot_bgcolor: ct.plot,
      font: { color: ct.font, size: 12 },
      margin: { l: 62, r: 24, t: 28, b: 34 },
      height: 420 + panels.length * 130,
      showlegend: true,
      legend: { orientation: 'h', y: 1.06, x: 0.5, xanchor: 'center', font: { size: 11 } },
      hovermode: 'closest',
      dragmode: 'zoom',
      xaxis: {
        type: 'date', rangeslider: { visible: false },
        rangebreaks: tradingSessionRangeBreaks(dates),
        gridcolor: ct.grid, hoverformat: '%a %b %d, %Y',
        tickfont: { size: 9, color: ct.font }, ...spike,
      },
      // Plotly 3.x dropped the bare-string shorthand for axis titles; only the
      // { text } form renders, and unlabelled stacked panes are unreadable.
      yaxis: {
        title: { text: 'Price', font: { size: 11 } },
        domain: domains[0], gridcolor: ct.grid, tickprefix: '$', ...spike,
      },
    }

    // themedPlotlyLayout only reaches yaxis1-3, so every panel axis is themed
    // here explicitly — otherwise a 4th pane keeps dark grid lines in light mode.
    panels.forEach((panel, i) => {
      built[`yaxis${i + 2}`] = {
        title: { text: panel.title, font: { size: 11 } },
        domain: domains[i + 1], gridcolor: ct.grid, ...spike,
      }
    })

    return { data: traces, layout: built }
  }, [records, chartType, isDark, ticker])

  const stop = useCallback((e) => e.stopPropagation(), [])
  if (!ticker) return null

  const btn = (active) => ({
    padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer',
    background: active ? 'var(--accent-bright)' : 'var(--surface-inset)',
    color: active ? 'var(--black)' : 'var(--text-muted)',
    border: '1px solid var(--border)', borderRadius: '4px',
    fontWeight: active ? 700 : 500,
  })

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="modal-content"
        onClick={stop}
        style={{ maxWidth: '1150px', width: '95vw', background: 'var(--surface-sunken)' }}
      >
        <button className="modal-close" onClick={onClose}>&times;</button>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <h2 style={{ margin: 0, color: 'var(--accent-bright)' }}>{ticker}</h2>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{name}</span>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            Price · SMA 50/200 · MACD · RSI
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          {PERIODS.map(p => (
            <button key={p.value} style={btn(period === p.value)} onClick={() => setPeriod(p.value)}>
              {p.label}
            </button>
          ))}
          <span style={{ width: '0.75rem' }} />
          <button style={btn(chartType === 'candlestick')} onClick={() => setChartType('candlestick')}>Candles</button>
          <button style={btn(chartType === 'line')} onClick={() => setChartType('line')}>Line</button>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        {loading && (
          <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
        )}

        {!loading && !error && records.length > 0 && (
          <Plot
            data={data}
            layout={layout}
            config={{ responsive: true, displayModeBar: true, displaylogo: false, scrollZoom: true }}
            useResizeHandler
            style={{ width: '100%' }}
          />
        )}

        {!loading && !error && !records.length && (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '2rem' }}>
            No price history available for {ticker}.
          </p>
        )}
      </div>
    </div>
  )
}
