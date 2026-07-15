import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../config'
import { useTheme } from '../context/ThemeContext'
import { assignBrokerImportSides, parseBrokerOptionDescriptor } from '../utils/brokerOptions'
import { chartTheme } from '../utils/chartTheme'
import { resizeOptionStructure } from '../utils/optionsStrategy'
import GreekSurfaceExplorer from '../components/GreekSurfaceExplorer'

const TODAY = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

const fmt = (value, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const money = (value, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
const signedMoney = value => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `${Number(value) > 0 ? '+' : ''}${money(value)}`
const percent = (value, digits = 1) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `${(Number(value) * 100).toFixed(digits)}%`
const formatExpiration = expiration => {
  if (!expiration) return '—'
  const value = new Date(`${expiration}T00:00:00`)
  return Number.isNaN(value.getTime())
    ? expiration
    : value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}
const formatShortDate = value => {
  if (!value) return '—'
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime())
    ? value
    : `${parsed.getMonth() + 1}/${parsed.getDate()}/${String(parsed.getFullYear()).slice(-2)}`
}
const daysBetween = (start, end) => {
  const a = new Date(`${start}T00:00:00`)
  const b = new Date(`${end}T00:00:00`)
  return Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) ? 0 : Math.max(0, Math.round((b - a) / 86400000))
}
const addDays = (dateString, days) => {
  const value = new Date(`${dateString}T00:00:00`)
  value.setDate(value.getDate() + Number(days || 0))
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
  return value.toISOString().slice(0, 10)
}
const uniqueId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const OPTION_CHAIN_COLUMN_PREF_KEY = 'options_chain_visible_columns_v1'
const CHAIN_COLUMNS = [
  { id: 'last', label: 'Last', name: 'Last price', tip: 'Most recent traded option price' },
  { id: 'mid', label: 'Mark', name: 'Mark / midpoint', tip: 'Midpoint of the bid and ask' },
  { id: 'delta', label: 'Delta', name: 'Delta', tip: 'Approximate option-price change for a $1 underlying move' },
  { id: 'gamma', label: 'Gamma', name: 'Gamma', tip: 'Approximate change in delta for a $1 underlying move' },
  { id: 'theta', label: 'Theta', name: 'Theta per day', tip: 'Estimated one-day time decay per share' },
  { id: 'vega', label: 'Vega', name: 'Vega per volatility point', tip: 'Approximate price change for a one-point IV move' },
  { id: 'rho', label: 'Rho', name: 'Rho per rate point', tip: 'Approximate price change for a one-point interest-rate move' },
  { id: 'prob_otm', label: 'Prob OTM', name: 'Probability OTM', tip: 'Delta-based first-order probability of expiring out of the money' },
  { id: 'iv', label: 'IV', name: 'Implied volatility', tip: 'Market-implied annualized volatility' },
  { id: 'volume', label: 'Volume', name: 'Volume', tip: 'Contracts traded today' },
  { id: 'open_interest', label: 'Open Int', name: 'Open interest', tip: 'Open contracts reported by the market' },
  { id: 'bid', label: 'Bid', name: 'Bid', tip: 'Highest displayed buyer; click to add a simulated sell' },
  { id: 'ask', label: 'Ask', name: 'Ask', tip: 'Lowest displayed seller; click to add a simulated buy' },
]
const DEFAULT_CHAIN_COLUMNS = ['last', 'delta', 'prob_otm', 'iv', 'bid', 'ask']
const CHAIN_COLUMN_PRESETS = {
  Basic: DEFAULT_CHAIN_COLUMNS,
  Greeks: ['bid', 'ask', 'iv', 'delta', 'gamma', 'theta', 'vega', 'rho'],
  Liquidity: ['bid', 'ask', 'mid', 'last', 'volume', 'open_interest', 'iv'],
  All: CHAIN_COLUMNS.map(column => column.id),
}
const standardNormalCdf = value => {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(Number(value)) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * erf)
}
const expirationSeriesLabel = expiration => {
  const value = new Date(`${expiration}T00:00:00`)
  if (Number.isNaN(value.getTime())) return ''
  const day = value.getDate()
  return value.getDay() === 5 && day >= 15 && day <= 21 ? 'Monthly' : 'Weekly'
}
const isStockLeg = leg => String(leg?.opt_type || '').toUpperCase() === 'STOCK'
const modeledLegIv = (leg, globalAdjustment = 0) => Math.max(
  0.0001,
  (Number(leg.iv) || 0.2)
    + (Number(leg.iv_adjustment) || 0) / 100
    + (Number(globalAdjustment) || 0) / 100,
)
const contractEntryPrice = (contract, side, fallback = 0) => Number(
  (side === 'BUY' ? contract?.ask : contract?.bid)
  || contract?.mid
  || contract?.last
  || fallback
  || 0,
)
// Cash-settled index options aren't in our data, so map them to the liquid ETF
// proxy and scale the strike to the proxy's price grid (SPY≈SPX/10, etc.).
const INDEX_PROXY_MAP = {
  SPX: { ticker: 'SPY', divisor: 10 },
  SPXW: { ticker: 'SPY', divisor: 10 },
  RUT: { ticker: 'IWM', divisor: 10 },
  RUTW: { ticker: 'IWM', divisor: 10 },
  RTY: { ticker: 'IWM', divisor: 10 },
  NDX: { ticker: 'QQQ', divisor: 40 },
  NDXP: { ticker: 'QQQ', divisor: 40 },
  NASDAQ: { ticker: 'QQQ', divisor: 40 },
  NQ: { ticker: 'QQQ', divisor: 40 },
}
const BROKER_IMPORT_EXAMPLE = 'NDX 260821C31250000\nNDX 260821P26800000\nNDX 260821P28775000'
const mapBrokerUnderlying = symbol => INDEX_PROXY_MAP[String(symbol).toUpperCase()]
  || { ticker: String(symbol).toUpperCase(), divisor: 1 }

async function fetchJson(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error(`Request failed (${response.status})`)
  }
  if (!response.ok || data?.error) throw new Error(data?.error || `Request failed (${response.status})`)
  return data
}

function RiskChart({ result, evaluationDate, strikeStructure, positionStrikes, onResizeStructure, onAdjustProbabilityBoundary }) {
  const ref = useRef(null)
  const { isDark } = useTheme()
  const [hover, setHover] = useState(null)

  useEffect(() => {
    if (!ref.current || !window.Plotly || !result?.curves?.today?.length) return undefined
    const ct = chartTheme(isDark)
    const evaluation = result.curves.today
    const expiration = result.curves.expiration || []
    const daySteps = result.curves.day_steps || []
    const horizonDate = result.curves.expiration_date || result.analysis_horizon
    const horizonName = result.mixed_expirations && horizonDate
      ? `First expiration · ${formatExpiration(horizonDate)}`
      : 'At expiration'
    const displayEvaluationDate = result.eval_date || evaluationDate
    const evaluationShortDate = formatShortDate(displayEvaluationDate)
    const horizonShortDate = formatShortDate(horizonDate)
    const allPnlValues = [...evaluation, ...expiration].map(point => Number(point.pnl)).filter(Number.isFinite)
    const pnlSpan = allPnlValues.length ? Math.max(...allPnlValues) - Math.min(...allPnlValues) : 1
    const strikeTickHalfHeight = Math.max(pnlSpan * 0.018, 1)
    const dayStepTraces = daySteps.map((step, index) => ({
      x: step.curve.map(point => point.s),
      y: step.curve.map(point => point.pnl),
      type: 'scatter',
      mode: 'lines',
      name: index === 0 ? `${result.day_step}-day steps` : step.date,
      legendgroup: 'day-steps',
      showlegend: index === 0,
      line: { color: `rgba(126, 207, 255, ${Math.min(0.72, 0.28 + index * 0.07)})`, width: 1.4 },
      hoverinfo: 'skip',
    }))
    const traces = [
      {
        x: expiration.map(point => point.s),
        y: expiration.map(point => point.pnl),
        type: 'scatter',
        mode: 'lines',
        name: horizonName,
        line: { color: '#20c7c7', width: 3 },
        hoverinfo: 'skip',
      },
      ...dayStepTraces,
      {
        x: evaluation.map(point => point.s),
        y: evaluation.map(point => point.pnl),
        customdata: evaluation.map((point, index) => [point.pnl, expiration[index]?.pnl]),
        type: 'scatter',
        mode: 'lines',
        name: displayEvaluationDate,
        line: { color: '#d46adf', width: 3 },
        hovertemplate: `<b>Underlying %{x:$,.2f}</b><br>${displayEvaluationDate} · P/L open: %{customdata[0]:$,.2f}<br>${horizonName}: %{customdata[1]:$,.2f}<extra></extra>`,
      },
    ]
    const probability = result.probability_range
    const probabilityMode = String(probability?.probability_mode || 'ITM').toUpperCase()
    const probabilityColors = {
      ITM: { line: '#35d07f', fill: 'rgba(53, 208, 127, 0.13)' },
      OTM: { line: '#f0b429', fill: 'rgba(240, 180, 41, 0.13)' },
      TOUCH: { line: '#d46adf', fill: 'rgba(212, 106, 223, 0.13)' },
    }
    const probabilityColor = probabilityColors[probabilityMode] || probabilityColors.ITM
    const shapes = []
    const interactiveHandles = []
    const probabilityLineAnnotations = []
    const annotationTag = color => ({
      showarrow: false,
      captureevents: false,
      bgcolor: 'rgba(0, 0, 0, 0)',
      borderwidth: 0,
      borderpad: 1,
      font: { color, size: 10 },
    })
    if (probability && Number(probability.high) > Number(probability.low)) {
      shapes.push({
        type: 'rect', x0: probability.low, x1: probability.high, y0: 0, y1: 1, yref: 'paper',
        editable: false, fillcolor: probabilityColor.fill, line: { width: 0 }, layer: 'below',
      })
      shapes.push({
        type: 'line', x0: probability.anchor_strike, x1: probability.anchor_strike, y0: 0, y1: 1, yref: 'paper',
        editable: false,
        line: { color: '#7ecfff', width: 2, dash: 'dot' },
      })
      probabilityLineAnnotations.push({
        x: probability.anchor_strike,
        y: 1.02,
        yref: 'paper',
        text: `<b>Reference strike</b> · $${fmt(probability.anchor_strike)}`,
        xanchor: 'center',
        yanchor: 'bottom',
        ...annotationTag('#7ecfff'),
      })
      ;[
        { edge: 'low', value: probability.low, label: probability.lower_label },
        { edge: 'high', value: probability.high, label: probability.upper_label },
      ].forEach(handle => {
        const handleColor = probability.range_mode === 'probability'
          ? probabilityColor.line
          : String(handle.label).endsWith('ITM') ? '#35d07f' : '#f0b429'
        interactiveHandles.push({ ...handle, kind: 'probability', shapeIndex: shapes.length })
        shapes.push({
          type: 'line', x0: handle.value, x1: handle.value, y0: 0, y1: 1, yref: 'paper',
          editable: true,
          line: { color: handleColor, width: 2.5, dash: 'dash' },
        })
        probabilityLineAnnotations.push({
          x: handle.value,
          y: 1.02,
          yref: 'paper',
          text: `<b>${handle.label}</b> · $${fmt(handle.value)}`,
          xanchor: handle.edge === 'low' ? 'right' : 'left',
          yanchor: 'bottom',
          ...annotationTag(handleColor),
        })
      })
    }
    shapes.push(
      { type: 'line', x0: evaluation[0].s, x1: evaluation[evaluation.length - 1].s, y0: 0, y1: 0, editable: false, line: { color: ct.zeroline, width: 1 } },
      { type: 'line', x0: result.spot, x1: result.spot, y0: 0, y1: 1, yref: 'paper', editable: false, line: { color: '#f0b429', width: 1.5, dash: 'dot' } },
      ...(result.breakevens || []).map(value => ({
        type: 'line', x0: value, x1: value, y0: 0, y1: 1, yref: 'paper',
        editable: false, line: { color: '#ff6b6b', width: 1, dash: 'dash' },
      })),
      ...(positionStrikes || []).map(value => ({
        type: 'line', x0: value, x1: value, y0: -strikeTickHalfHeight, y1: strikeTickHalfHeight,
        editable: false, line: { color: '#ff5d6c', width: 2.5 },
      })),
    )
    const resizeHandles = strikeStructure ? [
      { edge: 'low', value: strikeStructure.low },
      { edge: 'high', value: strikeStructure.high },
    ] : []
    const structureLineAnnotations = []
    resizeHandles.forEach(handle => {
      interactiveHandles.push({ ...handle, kind: 'structure', shapeIndex: shapes.length })
      shapes.push({
        type: 'line', x0: handle.value, x1: handle.value, y0: 0, y1: 1, yref: 'paper',
        editable: true,
        line: { color: '#7ecfff', width: 4, dash: 'dot' },
      })
      structureLineAnnotations.push({
        x: handle.value,
        y: 1.18,
        yref: 'paper',
        text: `<b>↔ ${handle.edge === 'low' ? 'Low' : 'High'} strike</b> · $${fmt(handle.value)}`,
        xanchor: handle.edge === 'low' ? 'right' : 'left',
        yanchor: 'bottom',
        ...annotationTag('#7ecfff'),
      })
    })
    const annotations = [
      {
        x: result.spot, y: 1.26, yref: 'paper',
        text: `<b>${result.underlying || 'Underlying'} current</b> · $${fmt(result.spot)}`,
        xanchor: 'center', yanchor: 'bottom', ...annotationTag('#f0b429'),
      },
      ...(result.breakevens || []).map((value, index, values) => ({
        x: value, y: 1.10, yref: 'paper', text: `<b>B/E</b> · $${fmt(value)}`,
        xanchor: index < values.length / 2 ? 'right' : 'left', yanchor: 'bottom',
        ...annotationTag('#ff8a8a'),
      })),
      ...probabilityLineAnnotations,
      ...structureLineAnnotations,
    ]
    const chartElement = ref.current
    let mounted = true
    const handleRelayout = update => {
      const shapeKey = Object.keys(update || {}).find(key => /^shapes\[(\d+)\](?:\.x[01])?$/.test(key))
      if (!shapeKey) return
      const match = shapeKey.match(/^shapes\[(\d+)\]/)
      const shapeIndex = Number(match?.[1])
      const handle = interactiveHandles.find(item => item.shapeIndex === shapeIndex)
      if (!handle) return
      const shapeUpdate = update[`shapes[${shapeIndex}]`]
      const nextValue = Number(update[`shapes[${shapeIndex}].x0`] ?? update[`shapes[${shapeIndex}].x1`] ?? shapeUpdate?.x0 ?? shapeUpdate?.x1)
      if (!Number.isFinite(nextValue)) return
      if (handle.kind === 'probability') onAdjustProbabilityBoundary?.(handle.edge, nextValue)
      else onResizeStructure?.(handle.edge, nextValue)
    }
    // Interpolate the P/L on a curve for any underlying price so the readout
    // moves smoothly between the sampled points rather than snapping to them.
    const interpolatePnl = (curve, price) => {
      if (!curve.length) return null
      if (price <= curve[0].s) return curve[0].pnl
      const last = curve[curve.length - 1]
      if (price >= last.s) return last.pnl
      let low = 0
      let high = curve.length - 1
      while (high - low > 1) {
        const mid = (low + high) >> 1
        if (curve[mid].s <= price) low = mid
        else high = mid
      }
      const a = curve[low]
      const b = curve[high]
      const span = b.s - a.s || 1
      return a.pnl + ((price - a.s) / span) * (b.pnl - a.pnl)
    }
    // Custom thinkorswim-style crosshair: a price tag pinned to the x-axis and
    // a color-coded date/P&L legend that track the cursor across the graph.
    const handlePointerMove = event => {
      const fullLayout = chartElement?._fullLayout
      const xAxis = fullLayout?.xaxis
      const yAxis = fullLayout?.yaxis
      if (!xAxis || !yAxis || typeof xAxis.p2d !== 'function') return
      const rect = chartElement.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const plotLeft = xAxis._offset
      const plotRight = xAxis._offset + xAxis._length
      const plotTop = yAxis._offset
      const plotBottom = yAxis._offset + yAxis._length
      if (px < plotLeft || px > plotRight || py < plotTop || py > plotBottom) {
        setHover(null)
        return
      }
      const underlying = xAxis.p2d(px - plotLeft)
      const todayPnl = interpolatePnl(evaluation, underlying)
      const expiryPnl = interpolatePnl(expiration, underlying)
      setHover({
        x: px,
        top: plotTop,
        bottom: plotBottom,
        left: plotLeft,
        price: fmt(underlying, 2),
        markers: [
          { color: '#d46adf', y: Number.isFinite(todayPnl) ? yAxis._offset + yAxis.d2p(todayPnl) : null },
          { color: '#20c7c7', y: Number.isFinite(expiryPnl) ? yAxis._offset + yAxis.d2p(expiryPnl) : null },
        ],
        rows: [
          { color: '#d46adf', label: evaluationShortDate, value: signedMoney(todayPnl) },
          { color: '#20c7c7', label: horizonShortDate, value: signedMoney(expiryPnl) },
        ],
      })
    }
    const handlePointerLeave = () => setHover(null)
    const plotPromise = window.Plotly.react(chartElement, traces, {
      template: ct.template,
      paper_bgcolor: ct.surface,
      plot_bgcolor: ct.plot,
      font: { color: ct.font, family: 'Inter, system-ui, sans-serif' },
      margin: { l: 70, r: 25, t: 130, b: 55 },
      height: 520,
      hovermode: 'x unified',
      hoverdistance: -1,
      spikedistance: -1,
      hoverlabel: {
        bgcolor: ct.surface,
        bordercolor: ct.grid,
        font: { color: ct.title, size: 12 },
        align: 'left',
      },
      legend: { orientation: 'h', x: 0, y: 1.34 },
      xaxis: {
        title: 'Underlying price', gridcolor: ct.grid, tickprefix: '$', zerolinecolor: ct.zeroline,
        autorange: false,
        range: [evaluation[0].s, evaluation[evaluation.length - 1].s],
      },
      yaxis: { title: 'Profit / Loss', gridcolor: ct.grid, tickprefix: '$', zerolinecolor: ct.zeroline },
      shapes,
      annotations,
    }, {
      responsive: true,
      displaylogo: false,
      // Per-shape `editable` keeps only boundary lines draggable. Plotly's
      // global shapePosition edit mode also captures the shaded rectangle and
      // prevents P/L hover events from reaching the traces beneath it.
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    })
    Promise.resolve(plotPromise).then(() => {
      if (!mounted) return
      if (chartElement?.on) chartElement.on('plotly_relayout', handleRelayout)
      chartElement?.addEventListener('mousemove', handlePointerMove)
      chartElement?.addEventListener('mouseleave', handlePointerLeave)
    })
    return () => {
      mounted = false
      if (chartElement?.removeListener) chartElement.removeListener('plotly_relayout', handleRelayout)
      chartElement?.removeEventListener('mousemove', handlePointerMove)
      chartElement?.removeEventListener('mouseleave', handlePointerLeave)
      setHover(null)
      if (chartElement) window.Plotly.purge(chartElement)
    }
  }, [result, evaluationDate, isDark, strikeStructure, positionStrikes, onResizeStructure, onAdjustProbabilityBoundary])

  const evaluationLabel = formatShortDate(result?.eval_date || evaluationDate)
  const horizonLabel = formatShortDate(result?.curves?.expiration_date || result?.analysis_horizon)

  return (
    <div className="opt-risk-chart-shell">
      <div className="opt-risk-readout" aria-hidden="true">
        <span className="opt-risk-readout-price opt-risk-readout-current"><small>{result?.underlying || 'Underlying'} current</small><strong>{fmt(result?.spot)}</strong></span>
        {hover && <span className="opt-risk-readout-price opt-risk-readout-hover"><small>Cursor</small><strong>{hover.price}</strong></span>}
        <span className="opt-risk-readout-chip" style={{ borderColor: '#d46adf' }}>
          <span className="opt-risk-readout-swatch" style={{ background: '#d46adf' }} />
          <small style={{ color: '#d46adf' }}>{evaluationLabel}</small>
          <strong>{hover ? hover.rows[0].value : '—'}</strong>
        </span>
        <span className="opt-risk-readout-chip" style={{ borderColor: '#20c7c7' }}>
          <span className="opt-risk-readout-swatch" style={{ background: '#20c7c7' }} />
          <small style={{ color: '#20c7c7' }}>{horizonLabel}</small>
          <strong>{hover ? hover.rows[1].value : '—'}</strong>
        </span>
        {!hover && <span className="opt-risk-readout-hint">Move across the graph to read the price and P/L</span>}
      </div>
      <div className="opt-risk-chart-frame">
        <div ref={ref} className="opt-risk-chart" role="img" aria-label="Option strategy profit and loss graph with draggable probability and strike handles" />
        {hover && (
          <div className="opt-risk-crosshair" aria-hidden="true">
            <span className="opt-risk-crosshair-line" style={{ left: `${hover.x}px`, top: `${hover.top}px`, height: `${hover.bottom - hover.top}px` }} />
            {hover.markers.map((marker, index) => (
              Number.isFinite(marker.y) && marker.y >= hover.top && marker.y <= hover.bottom
                ? <span key={index} className="opt-risk-crosshair-dot" style={{ left: `${hover.x}px`, top: `${marker.y}px`, borderColor: marker.color }} />
                : null
            ))}
            <span className="opt-risk-price-tag" style={{ left: `${hover.x}px`, top: `${hover.bottom}px` }}>{hover.price}</span>
          </div>
        )}
      </div>
    </div>
  )
}

const optionMoneyness = (leg, spot) => {
  const strike = Number(leg?.strike)
  const current = Number(spot)
  const optType = String(leg?.opt_type || '').toUpperCase()
  if (!strike || !current || !['CALL', 'PUT'].includes(optType)) return null
  const signedDistance = optType === 'CALL' ? current - strike : strike - current
  const percentDistance = Math.abs(signedDistance) / current * 100
  const status = percentDistance < 0.01 ? 'ATM' : signedDistance > 0 ? 'ITM' : 'OTM'
  return {
    strike,
    optType,
    status,
    percentDistance,
    dollarDistance: Math.abs(current - strike),
    relativePosition: strike >= current ? 'above' : 'below',
  }
}

function BrokerMoneynessChart({ ticker, spot, legs, records, chartType }) {
  const ref = useRef(null)
  const { isDark } = useTheme()
  const moneynessRows = useMemo(() => legs.map(leg => ({ leg, value: optionMoneyness(leg, spot) })).filter(row => row.value), [legs, spot])

  useEffect(() => {
    if (!ref.current || !window.Plotly || !records?.length || !moneynessRows.length) return undefined
    const ct = chartTheme(isDark)
    const dates = records.map(row => row.date)
    const firstDate = dates[0]
    const lastDate = dates.at(-1)
    const statusColors = { ITM: '#35d07f', OTM: '#f0b429', ATM: '#7ecfff' }
    const priceTrace = chartType === 'line'
      ? {
          x: dates,
          y: records.map(row => row.close),
          type: 'scatter',
          mode: 'lines',
          name: `${ticker} close`,
          line: { color: '#2196F3', width: 2 },
          customdata: records.map(row => [row.open, row.high, row.low, row.close]),
          hovertemplate: '<b>%{x|%a %b %d, %Y}</b><br>Open %{customdata[0]:$,.2f}<br>High %{customdata[1]:$,.2f}<br>Low %{customdata[2]:$,.2f}<br>Close %{customdata[3]:$,.2f}<extra></extra>',
        }
      : {
          x: dates,
          open: records.map(row => row.open),
          high: records.map(row => row.high),
          low: records.map(row => row.low),
          close: records.map(row => row.close),
          type: 'candlestick',
          name: ticker,
          increasing: { line: { color: '#26A69A' } },
          decreasing: { line: { color: '#EF5350' } },
          hoverinfo: 'skip',
        }
    const ohlcHoverTrace = {
      x: dates,
      y: records.map(row => row.close),
      customdata: records.map(row => [row.open, row.high, row.low, row.close]),
      type: 'scatter',
      mode: 'markers',
      marker: { size: 0.1, color: 'rgba(0,0,0,0)' },
      showlegend: false,
      hovertemplate: '<b>%{x|%a %b %d, %Y}</b><br>Open %{customdata[0]:$,.2f}<br>High %{customdata[1]:$,.2f}<br>Low %{customdata[2]:$,.2f}<br>Close %{customdata[3]:$,.2f}<extra></extra>',
    }
    const strikeTraces = moneynessRows.map(({ leg, value }) => {
      const color = statusColors[value.status]
      const label = `${leg.side} ${leg.qty} ${value.optType} $${fmt(value.strike)} · ${fmt(value.percentDistance, 1)}% ${value.status}`
      return {
        x: [firstDate, lastDate],
        y: [value.strike, value.strike],
        type: 'scatter',
        mode: 'lines',
        name: label,
        line: { color, width: 2, dash: leg.side === 'SELL' ? 'dash' : 'dot' },
        hovertemplate: `<b>${label}</b><br>${money(value.dollarDistance)} ${value.relativePosition} ${ticker} current<br>Expires ${formatExpiration(leg.expiration)}<extra></extra>`,
      }
    })
    const currentTrace = {
      x: [firstDate, lastDate],
      y: [spot, spot],
      type: 'scatter',
      mode: 'lines',
      name: `${ticker} current ${money(spot)}`,
      line: { color: '#7ecfff', width: 2.5, dash: 'solid' },
      hovertemplate: `<b>${ticker} current</b><br>${money(spot)}<extra></extra>`,
    }
    const values = [
      ...records.flatMap(row => [Number(row.low), Number(row.high)]),
      ...moneynessRows.map(row => row.value.strike),
      Number(spot),
    ].filter(Number.isFinite)
    const yLow = Math.min(...values)
    const yHigh = Math.max(...values)
    const yPad = Math.max((yHigh - yLow) * 0.08, 1)
    const annotations = moneynessRows.map(({ leg, value }) => {
      const color = statusColors[value.status]
      return {
        x: 1.01,
        xref: 'paper',
        y: value.strike,
        yref: 'y',
        text: `<b>${fmt(value.strike)} ${value.optType}</b> · ${fmt(value.percentDistance, 1)}% ${value.status}`,
        showarrow: false,
        xanchor: 'left',
        yanchor: 'middle',
        bgcolor: ct.surface,
        bordercolor: color,
        borderwidth: 1,
        borderpad: 3,
        font: { color, size: 10 },
      }
    })
    const gapDays = dates.slice(1).map((value, index) => (new Date(value) - new Date(dates[index])) / 86400000).filter(Number.isFinite)
    const rangebreaks = gapDays.length && Math.min(...gapDays) < 4 ? [{ bounds: ['sat', 'mon'] }] : []
    const traces = [priceTrace, ...(chartType === 'candlestick' ? [ohlcHoverTrace] : []), currentTrace, ...strikeTraces]
    window.Plotly.react(ref.current, traces, {
      template: ct.template,
      paper_bgcolor: ct.surface,
      plot_bgcolor: ct.plot,
      font: { color: ct.font, family: 'Inter, system-ui, sans-serif' },
      margin: { l: 70, r: 230, t: 55, b: 55 },
      height: 540,
      hovermode: 'closest',
      hoverlabel: { bgcolor: ct.surface, bordercolor: ct.grid, font: { color: ct.title, size: 12 }, align: 'left' },
      legend: { orientation: 'h', x: 0, y: 1.12, font: { size: 10 } },
      xaxis: {
        type: 'date',
        title: 'Date',
        rangeslider: { visible: false },
        rangebreaks,
        gridcolor: ct.grid,
        showspikes: true,
        spikemode: 'across',
        spikecolor: ct.zeroline,
        spikedash: 'dot',
      },
      yaxis: {
        title: `${ticker} price`,
        tickprefix: '$',
        range: [yLow - yPad, yHigh + yPad],
        gridcolor: ct.grid,
        zerolinecolor: ct.zeroline,
        showspikes: true,
        spikemode: 'across',
        spikecolor: ct.zeroline,
        spikedash: 'dot',
      },
      annotations,
      uirevision: `${ticker}-${chartType}`,
    }, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] })
    const chartElement = ref.current
    return () => { if (chartElement) window.Plotly.purge(chartElement) }
  }, [ticker, spot, records, chartType, moneynessRows, isDark])

  return <div ref={ref} className="opt-broker-price-chart" role="img" aria-label={`${ticker} historical price chart with option strike and moneyness lines`} />
}

function QuoteMetric({ label, value, tone }) {
  return (
    <div className="opt-quote-metric">
      <span>{label}</span>
      <strong className={tone ? `opt-${tone}` : ''}>{value}</strong>
    </div>
  )
}

function SummaryMetric({ label, value, tone, helper }) {
  return (
    <div className="opt-summary-metric">
      <span>{label}</span>
      <strong className={tone ? `opt-${tone}` : ''}>{value}</strong>
      {helper && <small>{helper}</small>}
    </div>
  )
}

function ChainButton({ value, side, onClick, title }) {
  if (value == null) return <span>—</span>
  return <button type="button" className={`opt-chain-price opt-chain-${side.toLowerCase()}`} onClick={onClick} title={title}>{fmt(value)}</button>
}

function emptyCells(count, className) {
  return Array.from({ length: count }, (_, index) => <td key={index} className={className}>—</td>)
}

function formatChainValue(contract, columnId) {
  const value = contract?.[columnId]
  if (columnId === 'iv' || columnId === 'prob_otm') return percent(value)
  if (columnId === 'volume' || columnId === 'open_interest') return fmt(value, 0)
  if (columnId === 'gamma') return fmt(value, 4)
  if (['delta', 'theta', 'vega', 'rho'].includes(columnId)) return fmt(value, 3)
  return fmt(value)
}

function ChainCells({ contract, itm, onAdd, optType, columns }) {
  const className = itm ? `opt-itm opt-itm-${optType.toLowerCase()}` : ''
  if (!contract) return <>{emptyCells(columns.length, className)}</>
  return (
    <>
      {columns.map(column => (
        <td key={column.id} className={className} title={column.tip}>
          {column.id === 'bid'
            ? <ChainButton value={contract.bid} side="SELL" onClick={() => onAdd(contract, optType, 'SELL')} title={`Sell this ${optType.toLowerCase()} at the bid`} />
            : column.id === 'ask'
              ? <ChainButton value={contract.ask} side="BUY" onClick={() => onAdd(contract, optType, 'BUY')} title={`Buy this ${optType.toLowerCase()} at the ask`} />
              : formatChainValue(contract, column.id)}
        </td>
      ))}
    </>
  )
}

export default function OptionTradingTools() {
  const [workspace, setWorkspace] = useState('trades')
  const [tickerInput, setTickerInput] = useState('SPY')
  const [ticker, setTicker] = useState('SPY')
  const [marketRefresh, setMarketRefresh] = useState(0)
  const [quote, setQuote] = useState(null)
  const [expirations, setExpirations] = useState([])
  const [selectedExpiration, setSelectedExpiration] = useState('')
  const [chain, setChain] = useState(null)
  const [monthChains, setMonthChains] = useState({})
  const [chainTargetLegId, setChainTargetLegId] = useState(null)
  const [expandedTradeExpiration, setExpandedTradeExpiration] = useState('')
  const [marketLoading, setMarketLoading] = useState(false)
  const [chainLoading, setChainLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [strikeRange, setStrikeRange] = useState('20')
  const [chainColumnIds, setChainColumnIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPTION_CHAIN_COLUMN_PREF_KEY) || 'null')
      const validIds = new Set(CHAIN_COLUMNS.map(column => column.id))
      const selected = Array.isArray(saved) ? saved.filter(id => validIds.has(id)) : []
      return selected.length ? selected : DEFAULT_CHAIN_COLUMNS
    } catch {
      return DEFAULT_CHAIN_COLUMNS
    }
  })

  const [legs, setLegs] = useState([])
  const [strategyId, setStrategyId] = useState(null)
  const [strategyName, setStrategyName] = useState('Untitled strategy')
  const [notes, setNotes] = useState('')
  const [savedStrategies, setSavedStrategies] = useState([])
  const [saveStatus, setSaveStatus] = useState('')

  const [model, setModel] = useState('black-scholes')
  const [ratePct, setRatePct] = useState(3.75)
  const [evaluationDate, setEvaluationDate] = useState(TODAY)
  const [volatilityShift, setVolatilityShift] = useState(0)
  const [showProbabilityRange, setShowProbabilityRange] = useState(true)
  const [probabilityAnchorId, setProbabilityAnchorId] = useState('')
  const [probabilityRangeMode, setProbabilityRangeMode] = useState('moneyness')
  const [probabilityMode, setProbabilityMode] = useState('ITM')
  const [probabilityMassPct, setProbabilityMassPct] = useState(68.27)
  const [itmRangePct, setItmRangePct] = useState(10)
  const [otmRangePct, setOtmRangePct] = useState(10)
  const [priceRangePct, setPriceRangePct] = useState(35)
  const [dayStep, setDayStep] = useState(0)
  const [sliceOffsets, setSliceOffsets] = useState([-15, 0, 15])
  const [risk, setRisk] = useState(null)
  const [riskLoading, setRiskLoading] = useState(false)
  const [riskError, setRiskError] = useState('')
  const riskRequestId = useRef(0)
  const chainCardRef = useRef(null)
  const expirationBrowserRef = useRef(null)
  const expandedChainWrapRef = useRef(null)

  const [brokerImportText, setBrokerImportText] = useState('')
  const [brokerImportMode, setBrokerImportMode] = useState('covered-call-protection')
  const [brokerImportBusy, setBrokerImportBusy] = useState(false)
  const [brokerImportError, setBrokerImportError] = useState('')
  const [brokerImportSummary, setBrokerImportSummary] = useState('')
  const [brokerImportPreview, setBrokerImportPreview] = useState([])
  const [brokerChartPeriod, setBrokerChartPeriod] = useState('6mo')
  const [brokerChartType, setBrokerChartType] = useState('candlestick')
  const [brokerChartRecords, setBrokerChartRecords] = useState([])
  const [brokerChartLoading, setBrokerChartLoading] = useState(false)
  const [brokerChartError, setBrokerChartError] = useState('')
  const [brokerChartRefresh, setBrokerChartRefresh] = useState(0)

  const loadSavedStrategies = useCallback(() => {
    return fetchJson('/api/options/strategies')
      .then(setSavedStrategies)
      .catch(error => setSaveStatus(error.message))
  }, [])

  useEffect(() => { loadSavedStrategies() }, [loadSavedStrategies])
  useEffect(() => {
    try { localStorage.setItem(OPTION_CHAIN_COLUMN_PREF_KEY, JSON.stringify(chainColumnIds)) } catch { /* optional preference */ }
  }, [chainColumnIds])

  const visibleChainColumns = useMemo(
    () => CHAIN_COLUMNS.filter(column => chainColumnIds.includes(column.id)),
    [chainColumnIds],
  )
  const mirroredPutColumns = useMemo(() => [...visibleChainColumns].reverse(), [visibleChainColumns])
  const toggleChainColumn = id => setChainColumnIds(previous => {
    if (previous.includes(id)) {
      const next = previous.filter(value => value !== id)
      return next.length ? next : previous
    }
    return [...previous, id]
  })

  useEffect(() => {
    if (!ticker) return undefined
    let cancelled = false
    setMarketLoading(true)
    setMarketError('')
    setQuote(null)
    setExpirations([])
    setSelectedExpiration('')
    setChain(null)
    setMonthChains({})
    setChainTargetLegId(null)
    setExpandedTradeExpiration('')
    Promise.all([
      fetchJson(`/api/options/quote?ticker=${encodeURIComponent(ticker)}`),
      fetchJson(`/api/options/expirations?ticker=${encodeURIComponent(ticker)}`),
    ])
      .then(([quoteData, expirationData]) => {
        if (cancelled) return
        setQuote(quoteData)
        const values = expirationData.expirations || []
        setExpirations(values)
        const learningExpiration = values.find(expiration => daysBetween(TODAY(), expiration) >= 21)
          || values.find(expiration => expiration > TODAY())
          || values[0]
        setSelectedExpiration(learningExpiration || '')
      })
      .catch(error => { if (!cancelled) setMarketError(error.message) })
      .finally(() => { if (!cancelled) setMarketLoading(false) })
    return () => { cancelled = true }
  }, [ticker, marketRefresh])

  useEffect(() => {
    if (!ticker || !selectedExpiration) return undefined
    let cancelled = false
    setChainLoading(true)
    setMarketError('')
    fetchJson(`/api/options/chain?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(selectedExpiration)}`)
      .then(data => {
        if (cancelled) return
        setChain(data)
        setMonthChains(previous => ({ ...previous, [selectedExpiration]: data }))
      })
      .catch(error => { if (!cancelled) setMarketError(error.message) })
      .finally(() => { if (!cancelled) setChainLoading(false) })
    return () => { cancelled = true }
  }, [ticker, selectedExpiration, marketRefresh])

  const loadMonthChain = useCallback(async expiration => {
    if (!ticker || !expiration) return null
    if (monthChains[expiration]) return monthChains[expiration]
    const data = await fetchJson(`/api/options/chain?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(expiration)}`)
    setMonthChains(previous => ({ ...previous, [expiration]: data }))
    return data
  }, [ticker, monthChains])

  const chainRows = useMemo(() => {
    if (!chain) return []
    const byStrike = new Map()
    ;(chain.calls || []).forEach(call => byStrike.set(call.strike, { strike: call.strike, call, put: null }))
    ;(chain.puts || []).forEach(put => {
      const row = byStrike.get(put.strike) || { strike: put.strike, call: null, put: null }
      row.put = put
      byStrike.set(put.strike, row)
    })
    const rows = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike)
    if (strikeRange === 'all' || !chain.spot) return rows
    const band = Number(strikeRange) / 100
    return rows.filter(row => row.strike >= chain.spot * (1 - band) && row.strike <= chain.spot * (1 + band))
  }, [chain, strikeRange])

  useEffect(() => {
    if (!expandedTradeExpiration || chainLoading || !chainRows.length) return undefined

    const frameId = window.requestAnimationFrame(() => {
      const browser = expirationBrowserRef.current
      const chainWrap = expandedChainWrapRef.current
      if (!browser || !chainWrap) return

      // Changing the strike filter can add many rows above the browser's
      // current scroll anchor. Keep the expanded expiration fully visible.
      const expirationRow = chainWrap.closest('.opt-expiration-series')?.querySelector('.opt-expiration-row')
      if (expirationRow) {
        const browserRect = browser.getBoundingClientRect()
        const rowRect = expirationRow.getBoundingClientRect()
        browser.scrollTop += rowRect.top - browserRect.top
      }

      // A broad range should still open around the actionable part of the
      // chain rather than jumping to the lowest listed strike.
      const atmRow = chainWrap.querySelector('.opt-atm-row')
      if (atmRow) {
        const chainRect = chainWrap.getBoundingClientRect()
        const atmRect = atmRow.getBoundingClientRect()
        chainWrap.scrollTop += atmRect.top - chainRect.top - ((chainWrap.clientHeight - atmRect.height) / 2)
      } else {
        chainWrap.scrollTop = 0
      }
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [chainLoading, chainRows.length, expandedTradeExpiration, strikeRange])

  const spot = Number(quote?.last || chain?.spot || 0)
  const activeLegs = useMemo(() => legs.filter(leg => (
    leg.included
    && Number(leg.qty) > 0
    && (isStockLeg(leg) || (leg.expiration && Number(leg.strike) > 0))
  )), [legs])
  const activeOptionLegs = useMemo(() => activeLegs.filter(leg => !isStockLeg(leg)), [activeLegs])
  const greekPositionLegs = useMemo(() => activeLegs.map(leg => ({
    id: leg.local_id,
    side: leg.side,
    qty: Math.max(1, Number(leg.qty) || 1),
    opt_type: leg.opt_type,
    strike: isStockLeg(leg) ? 0 : Number(leg.strike),
    expiration: isStockLeg(leg) ? '' : leg.expiration,
    entry_price: Number(leg.entry_price) || 0,
    iv: isStockLeg(leg) ? 0 : modeledLegIv(leg, volatilityShift),
  })), [activeLegs, volatilityShift])
  const greekPositionStrikeChoices = useMemo(() => Object.fromEntries(activeOptionLegs.map(leg => {
    const legChain = monthChains[leg.expiration]
      || (chain?.expiration === leg.expiration ? chain : null)
    const source = String(leg.opt_type).toUpperCase() === 'PUT' ? legChain?.puts : legChain?.calls
    const strikes = [...new Set((source || []).map(contract => Number(contract.strike)).filter(value => value > 0))]
      .sort((a, b) => a - b)
    return [leg.local_id, strikes]
  })), [activeOptionLegs, monthChains, chain])
  const chainTargetLeg = useMemo(() => legs.find(leg => leg.local_id === chainTargetLegId) || null, [legs, chainTargetLegId])
  useEffect(() => {
    if (workspace !== 'moneyness' || !ticker || !activeOptionLegs.length) return undefined
    const controller = new AbortController()
    setBrokerChartLoading(true)
    setBrokerChartError('')
    fetchJson(`/api/etf-screen/data?ticker=${encodeURIComponent(ticker)}&period=${encodeURIComponent(brokerChartPeriod)}&mode=ohlcv&interval=1d`, { signal: controller.signal })
      .then(data => setBrokerChartRecords(data.records || []))
      .catch(error => {
        if (error.name !== 'AbortError') {
          setBrokerChartError(error.message)
          setBrokerChartRecords([])
        }
      })
      .finally(() => { if (!controller.signal.aborted) setBrokerChartLoading(false) })
    return () => controller.abort()
  }, [workspace, ticker, activeOptionLegs.length, brokerChartPeriod, brokerChartRefresh])
  useEffect(() => {
    const missingExpirations = [...new Set(activeOptionLegs.map(leg => leg.expiration).filter(expiration => expiration && !monthChains[expiration]))]
    missingExpirations.forEach(expiration => {
      loadMonthChain(expiration).catch(error => setMarketError(error.message))
    })
  }, [activeOptionLegs, monthChains, loadMonthChain])
  const probabilityAnchor = useMemo(
    () => activeOptionLegs.find(leg => leg.local_id === probabilityAnchorId) || activeOptionLegs[0] || null,
    [activeOptionLegs, probabilityAnchorId],
  )
  const positionStrikes = useMemo(
    () => [...new Set(activeOptionLegs.map(leg => Number(leg.strike)).filter(Number.isFinite))].sort((a, b) => a - b),
    [activeOptionLegs],
  )
  const probabilityRange = useMemo(() => {
    const strike = Number(probabilityAnchor?.strike)
    if (!strike) return null
    const itmPct = Math.max(1, Number(itmRangePct) || 1)
    const otmPct = Math.max(1, Number(otmRangePct) || 1)
    const isCall = String(probabilityAnchor.opt_type).toUpperCase() === 'CALL'
    return {
      low: strike * (1 - (isCall ? otmPct : itmPct) / 100),
      high: strike * (1 + (isCall ? itmPct : otmPct) / 100),
      anchor_strike: strike,
      opt_type: isCall ? 'CALL' : 'PUT',
      itm_pct: itmPct,
      otm_pct: otmPct,
      lower_label: `${isCall ? otmPct : itmPct}% ${isCall ? 'OTM' : 'ITM'}`,
      upper_label: `${isCall ? itmPct : otmPct}% ${isCall ? 'ITM' : 'OTM'}`,
      iv: modeledLegIv(probabilityAnchor, volatilityShift),
      range_mode: probabilityRangeMode,
      probability_mode: probabilityMode,
      range_pct: Math.min(99.9, Math.max(1, Number(probabilityMassPct) || 68.27)),
    }
  }, [probabilityAnchor, itmRangePct, otmRangePct, volatilityShift, probabilityRangeMode, probabilityMode, probabilityMassPct])
  const strikeStructure = useMemo(() => {
    const strikes = [...new Set(activeLegs.filter(leg => !isStockLeg(leg)).map(leg => Number(leg.strike)).filter(Number.isFinite))].sort((a, b) => a - b)
    if (strikes.length < 2) return null
    const low = strikes[0]
    const high = strikes.at(-1)
    return { low, high, center: (low + high) / 2 }
  }, [activeLegs])
  const activeExpirations = useMemo(
    () => [...new Set(activeLegs.filter(leg => !isStockLeg(leg)).map(leg => leg.expiration).filter(Boolean))].sort(),
    [activeLegs],
  )
  const analysisHorizon = useMemo(() => {
    const earliest = activeExpirations[0] || selectedExpiration || TODAY()
    return earliest < TODAY() ? TODAY() : earliest
  }, [activeExpirations, selectedExpiration])
  const hasMixedExpirations = activeExpirations.length > 1
  const evolutionDays = daysBetween(TODAY(), analysisHorizon)
  const evaluationOffset = Math.min(evolutionDays, daysBetween(TODAY(), evaluationDate))

  useEffect(() => {
    if (evaluationDate > analysisHorizon) setEvaluationDate(analysisHorizon)
    else if (evaluationDate < TODAY()) setEvaluationDate(TODAY())
  }, [analysisHorizon, evaluationDate])

  const setBoundedEvaluationDate = value => {
    if (!value) return
    setEvaluationDate(value > analysisHorizon ? analysisHorizon : value < TODAY() ? TODAY() : value)
  }

  useEffect(() => {
    const requestId = ++riskRequestId.current
    if (!activeLegs.length || !spot) {
      setRisk(null)
      setRiskError('')
      setRiskLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setRisk(null)
    setRiskLoading(true)
    setRiskError('')
    const timer = setTimeout(() => {
      const range = Math.max(5, Number(priceRangePct) || 35) / 100
      const rangeDollars = spot * range
      const optionStrikes = activeLegs.filter(leg => !isStockLeg(leg)).map(leg => Number(leg.strike)).filter(value => Number.isFinite(value) && value > 0)
      const lowestStrike = optionStrikes.length ? Math.min(...optionStrikes) : spot
      const highestStrike = optionStrikes.length ? Math.max(...optionStrikes) : spot
      const scenarioLow = Math.max(0.01, Math.min(spot - rangeDollars, lowestStrike - rangeDollars))
      const scenarioHigh = Math.max(spot + rangeDollars, highestStrike + rangeDollars)
      fetchJson('/api/options/risk-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          underlying: ticker,
          model,
          rate: (Number(ratePct) || 0) / 100,
          div_yield: Number(quote?.div_yield || 0),
          spot_override: spot,
          eval_date: evaluationDate,
          day_step: Number(dayStep) || 0,
          price_range: { low: scenarioLow, high: scenarioHigh, steps: 241 },
          price_slices: sliceOffsets.map(offset => ({ s: spot * (1 + Number(offset) / 100) })),
          probability_range: showProbabilityRange && probabilityRange
            ? { enabled: true, ...probabilityRange }
            : { enabled: false },
          legs: activeLegs.map(leg => ({
            side: leg.side,
            qty: Math.max(1, Number(leg.qty) || 1),
            opt_type: leg.opt_type,
            strike: isStockLeg(leg) ? 0 : Number(leg.strike),
            expiration: isStockLeg(leg) ? '' : leg.expiration,
            entry_price: Number(leg.entry_price) || 0,
            iv: isStockLeg(leg) ? 0 : modeledLegIv(leg, volatilityShift),
          })),
        }),
        })
        .then(data => {
          if (activeLegs.some(isStockLeg) && !data.supported_leg_types?.includes('stock')) {
            throw new Error('The running risk engine does not support stock legs yet. Restart the backend, then analyze the position again.')
          }
          if (requestId === riskRequestId.current) setRisk(data)
        })
        .catch(error => {
          if (error.name !== 'AbortError' && requestId === riskRequestId.current) setRiskError(error.message)
        })
        .finally(() => {
          if (requestId === riskRequestId.current) setRiskLoading(false)
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [activeLegs, spot, ticker, model, ratePct, quote?.div_yield, evaluationDate, priceRangePct, dayStep, sliceOffsets, volatilityShift, showProbabilityRange, probabilityRange])

  const submitTicker = event => {
    event.preventDefault()
    const next = tickerInput.trim().toUpperCase()
    if (!next) return
    if (next === ticker) setMarketRefresh(value => value + 1)
    else setTicker(next)
  }

  const makeLeg = useCallback((contract, optType, side, qty = 1) => ({
    local_id: uniqueId(),
    included: true,
    side,
    qty,
    opt_type: optType,
    strike: Number(contract?.strike || spot || 0),
    expiration: selectedExpiration,
    entry_price: contractEntryPrice(contract, side),
    iv: Number(contract?.iv || 0.2),
    iv_adjustment: 0,
    delta: contract?.delta ?? null,
  }), [selectedExpiration, spot])

  const addLeg = useCallback((contract, optType, side) => {
    const replacingTarget = Boolean(chainTargetLegId && legs.some(leg => leg.local_id === chainTargetLegId))
    setLegs(previous => {
      if (!chainTargetLegId || !previous.some(leg => leg.local_id === chainTargetLegId)) {
        return [...previous, makeLeg(contract, optType, side)]
      }
      return previous.map(leg => leg.local_id === chainTargetLegId ? {
        ...makeLeg(contract, optType, side, leg.qty),
        local_id: leg.local_id,
        included: leg.included,
        iv_adjustment: leg.iv_adjustment ?? 0,
      } : leg)
    })
    setChainTargetLegId(null)
    if (replacingTarget) setWorkspace('risk')
  }, [chainTargetLegId, legs, makeLeg])

  const makeStockLeg = useCallback((side = 'BUY', qty = 100, basis = spot) => ({
    local_id: uniqueId(),
    included: true,
    side,
    qty,
    opt_type: 'STOCK',
    strike: 0,
    expiration: '',
    entry_price: Number(basis) || 0,
    iv: null,
    iv_adjustment: 0,
    delta: 1,
  }), [spot])

  const addStockLeg = useCallback(() => {
    setLegs(previous => [...previous, makeStockLeg()])
  }, [makeStockLeg])

  const updateLeg = (id, field, value) => setLegs(previous => previous.map(leg => leg.local_id === id ? { ...leg, [field]: value } : leg))
  const setLegIncluded = (id, included) => updateLeg(id, 'included', included)
  const removeLeg = id => {
    setLegs(previous => previous.filter(leg => leg.local_id !== id))
    if (chainTargetLegId === id) setChainTargetLegId(null)
  }

  const toggleTradeExpiration = expiration => {
    if (expandedTradeExpiration === expiration) {
      setExpandedTradeExpiration('')
      return
    }
    setExpandedTradeExpiration(expiration)
    setSelectedExpiration(expiration)
  }
  const optionContracts = (expiration, optType, chainData = monthChains[expiration]) => (
    [...(String(optType).toUpperCase() === 'PUT' ? chainData?.puts || [] : chainData?.calls || [])]
      .sort((a, b) => Number(a.strike) - Number(b.strike))
  )
  const applyContractToLeg = (id, contract, patch = {}) => {
    if (!contract) return
    setLegs(previous => previous.map(leg => {
      if (leg.local_id !== id) return leg
      const side = patch.side || leg.side
      return {
        ...leg,
        ...patch,
        side,
        strike: Number(contract.strike),
        entry_price: contractEntryPrice(contract, side, leg.entry_price),
        iv: Number(contract.iv || leg.iv || 0.2),
        delta: contract.delta ?? leg.delta ?? null,
      }
    }))
  }
  const changeLegStrike = (leg, strikeValue) => {
    const contract = optionContracts(leg.expiration, leg.opt_type).find(item => Number(item.strike) === Number(strikeValue))
    if (contract) applyContractToLeg(leg.local_id, contract)
    else updateLeg(leg.local_id, 'strike', strikeValue)
  }
  const changeLegSide = (leg, side) => {
    const contract = optionContracts(leg.expiration, leg.opt_type).find(item => Number(item.strike) === Number(leg.strike))
    if (contract) applyContractToLeg(leg.local_id, contract, { side })
    else updateLeg(leg.local_id, 'side', side)
  }
  const changeLegExpiration = async (leg, expiration) => {
    updateLeg(leg.local_id, 'expiration', expiration)
    try {
      const monthChain = await loadMonthChain(expiration)
      const contracts = optionContracts(expiration, leg.opt_type, monthChain)
      if (!contracts.length) return
      const nearest = contracts.reduce((best, contract) => (
        Math.abs(Number(contract.strike) - Number(leg.strike)) < Math.abs(Number(best.strike) - Number(leg.strike)) ? contract : best
      ), contracts[0])
      applyContractToLeg(leg.local_id, nearest, { expiration })
    } catch (error) {
      setMarketError(error.message)
    }
  }
  const changeLegType = async (leg, optType) => {
    if (optType === 'STOCK') {
      setLegs(previous => previous.map(item => item.local_id === leg.local_id ? {
        ...item, opt_type: 'STOCK', strike: 0, expiration: '', entry_price: spot, iv: null, delta: 1,
      } : item))
      return
    }
    const expiration = leg.expiration || selectedExpiration
    updateLeg(leg.local_id, 'opt_type', optType)
    try {
      const monthChain = await loadMonthChain(expiration)
      const contracts = optionContracts(expiration, optType, monthChain)
      if (!contracts.length) return
      const target = Number(leg.strike) || spot
      const nearest = contracts.reduce((best, contract) => (
        Math.abs(Number(contract.strike) - target) < Math.abs(Number(best.strike) - target) ? contract : best
      ), contracts[0])
      applyContractToLeg(leg.local_id, nearest, { opt_type: optType, expiration })
    } catch (error) {
      setMarketError(error.message)
    }
  }
  const openLegChain = leg => {
    if (!leg.expiration) return
    setSelectedExpiration(leg.expiration)
    setExpandedTradeExpiration(leg.expiration)
    setChainTargetLegId(leg.local_id)
    setWorkspace('trades')
    setTimeout(() => chainCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  const resizeLegStructure = useCallback((edge, proposedStrike) => {
    setLegs(previous => resizeOptionStructure(previous, { edge, proposedStrike, chain, selectedExpiration }))
  }, [chain, selectedExpiration])

  const adjustProbabilityBoundary = useCallback((edge, proposedPrice) => {
    const anchorStrike = Number(probabilityAnchor?.strike)
    if (!anchorStrike || !Number.isFinite(proposedPrice)) return
    if (probabilityRangeMode === 'probability') {
      const probability = risk?.probability_range
      const horizonYears = daysBetween(TODAY(), probability?.date) / 365
      const sigma = Number(probability?.iv)
      if (!spot || !horizonYears || !sigma || proposedPrice <= 0) return
      const drift = Math.log(spot) + (((Number(ratePct) || 0) / 100) - Number(quote?.div_yield || 0) - 0.5 * sigma * sigma) * horizonYears
      const z = (Math.log(proposedPrice) - drift) / (sigma * Math.sqrt(horizonYears))
      const cumulative = standardNormalCdf(z)
      const nextRange = edge === 'low' ? 1 - 2 * cumulative : 2 * cumulative - 1
      setProbabilityMassPct(Math.round(Math.min(99.9, Math.max(1, nextRange * 100)) * 100) / 100)
      return
    }
    const isCall = String(probabilityAnchor.opt_type).toUpperCase() === 'CALL'
    const percentFromStrike = edge === 'low'
      ? (1 - proposedPrice / anchorStrike) * 100
      : (proposedPrice / anchorStrike - 1) * 100
    const nextPercent = Math.max(1, Math.round(percentFromStrike * 10) / 10)
    if ((edge === 'low' && isCall) || (edge === 'high' && !isCall)) setOtmRangePct(nextPercent)
    else setItmRangePct(nextPercent)
  }, [probabilityAnchor, probabilityRangeMode, risk, spot, ratePct, quote?.div_yield])

  const setAnalysisIvPct = value => {
    if (!probabilityAnchor) return
    const desiredIvPct = Math.max(0.01, Number(value) || 0.01)
    const anchorIvBeforeGlobalShift = modeledLegIv(probabilityAnchor, 0) * 100
    setVolatilityShift(Math.round((desiredIvPct - anchorIvBeforeGlobalShift) * 100) / 100)
  }

  const nearestContract = useCallback((type, target, offset = 0) => {
    const contracts = [...(type === 'CALL' ? chain?.calls || [] : chain?.puts || [])].sort((a, b) => a.strike - b.strike)
    if (!contracts.length) return null
    let index = contracts.reduce((best, contract, current) => Math.abs(contract.strike - target) < Math.abs(contracts[best].strike - target) ? current : best, 0)
    index = Math.max(0, Math.min(contracts.length - 1, index + offset))
    return contracts[index]
  }, [chain])

  const applyTemplate = type => {
    if (!chain || !spot) return
    const atmCall = nearestContract('CALL', spot)
    const atmPut = nearestContract('PUT', spot)
    let next = []
    let name = strategyName
    if (type === 'long-call' && atmCall) {
      next = [makeLeg(atmCall, 'CALL', 'BUY')]
      name = `${ticker} long call`
    } else if (type === 'bull-call' && atmCall) {
      const shortCall = nearestContract('CALL', atmCall.strike, 2)
      next = [makeLeg(atmCall, 'CALL', 'BUY'), makeLeg(shortCall, 'CALL', 'SELL')]
      name = `${ticker} bull call spread`
    } else if (type === 'bear-put' && atmPut) {
      const shortPut = nearestContract('PUT', atmPut.strike, -2)
      next = [makeLeg(atmPut, 'PUT', 'BUY'), makeLeg(shortPut, 'PUT', 'SELL')]
      name = `${ticker} bear put spread`
    } else if (type === 'straddle' && atmCall && atmPut) {
      next = [makeLeg(atmCall, 'CALL', 'BUY'), makeLeg(atmPut, 'PUT', 'BUY')]
      name = `${ticker} long straddle`
    } else if (type === 'bull-put-credit' && atmPut) {
      const shortPut = nearestContract('PUT', spot, -2)
      const longPut = nearestContract('PUT', spot, -4)
      next = [makeLeg(longPut, 'PUT', 'BUY'), makeLeg(shortPut, 'PUT', 'SELL')]
      name = `${ticker} bull put credit spread`
    } else if (type === 'bear-call-credit' && atmCall) {
      const shortCall = nearestContract('CALL', spot, 2)
      const longCall = nearestContract('CALL', spot, 4)
      next = [makeLeg(shortCall, 'CALL', 'SELL'), makeLeg(longCall, 'CALL', 'BUY')]
      name = `${ticker} bear call credit spread`
    } else if (type === 'iron-condor' && atmCall && atmPut) {
      const shortPut = nearestContract('PUT', spot, -2)
      const longPut = nearestContract('PUT', spot, -4)
      const shortCall = nearestContract('CALL', spot, 2)
      const longCall = nearestContract('CALL', spot, 4)
      next = [
        makeLeg(longPut, 'PUT', 'BUY'), makeLeg(shortPut, 'PUT', 'SELL'),
        makeLeg(shortCall, 'CALL', 'SELL'), makeLeg(longCall, 'CALL', 'BUY'),
      ]
      name = `${ticker} iron condor`
    } else if (type === 'covered-call' && atmCall) {
      const shortCall = nearestContract('CALL', spot, 2) || atmCall
      next = [makeStockLeg('BUY', 100), makeLeg(shortCall, 'CALL', 'SELL')]
      name = `${ticker} covered call`
    }
    setLegs(next.filter(Boolean))
    setStrategyName(name)
    setStrategyId(null)
    setChainTargetLegId(null)
    setWorkspace('risk')
  }

  const importBrokerTrades = useCallback(async (destination = 'risk') => {
    const targetWorkspace = destination === 'moneyness' ? 'moneyness' : 'risk'
    const lines = brokerImportText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (!lines.length) {
      setBrokerImportError('Enter at least one broker option line.')
      return
    }
    const defaultSide = brokerImportMode === 'buy' ? 'BUY' : 'SELL'
    const parsedLines = lines.map(line => ({ line, parsed: parseBrokerOptionDescriptor(line, defaultSide) }))
    const unparsed = parsedLines.filter(item => !item.parsed)
    const parsed = assignBrokerImportSides(
      parsedLines.filter(item => item.parsed).map(item => item.parsed),
      brokerImportMode,
    )
    if (!parsed.length) {
      setBrokerImportError('Could not read any lines. Example: SPX US 08/21/26 C7645')
      setBrokerImportSummary('')
      setBrokerImportPreview([])
      return
    }
    const mapped = parsed.map(leg => {
      const proxy = mapBrokerUnderlying(leg.underlying)
      return {
        leg,
        proxyTicker: proxy.ticker,
        divisor: proxy.divisor,
        scaledStrike: leg.strike / proxy.divisor,
        mappedFrom: proxy.divisor !== 1 || proxy.ticker !== leg.underlying ? leg.underlying : null,
      }
    })
    const proxyTicker = mapped[0].proxyTicker
    const usable = mapped.filter(item => item.proxyTicker === proxyTicker)
    const skipped = mapped.filter(item => item.proxyTicker !== proxyTicker)
    setBrokerImportBusy(true)
    setBrokerImportError('')
    try {
      const expirationData = await fetchJson(`/api/options/expirations?ticker=${encodeURIComponent(proxyTicker)}`)
      const available = expirationData.expirations || []
      if (!available.length) throw new Error(`No option expirations are available for ${proxyTicker}.`)
      const dayGap = (a, b) => Math.abs((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000)
      const snapExpiration = target => available.reduce(
        (best, expiration) => (dayGap(target, expiration) < dayGap(target, best) ? expiration : best),
        available[0],
      )
      const neededExpirations = [...new Set(usable.map(item => snapExpiration(item.leg.expiration)))]
      const chains = {}
      for (const expiration of neededExpirations) {
        chains[expiration] = await fetchJson(`/api/options/chain?ticker=${encodeURIComponent(proxyTicker)}&expiration=${encodeURIComponent(expiration)}`)
      }
      const preview = []
      const builtOptionLegs = usable.map(item => {
        const expiration = snapExpiration(item.leg.expiration)
        const chainData = chains[expiration]
        const contracts = (item.leg.optType === 'PUT' ? chainData?.puts : chainData?.calls) || []
        const nearest = contracts.length
          ? contracts.reduce((best, contract) => (
              Math.abs(Number(contract.strike) - item.scaledStrike) < Math.abs(Number(best.strike) - item.scaledStrike) ? contract : best
            ), contracts[0])
          : null
        const strike = nearest ? Number(nearest.strike) : item.scaledStrike
        preview.push({
          source: `${item.mappedFrom ? `${item.leg.underlying}→${proxyTicker}` : proxyTicker} ${item.leg.optType === 'PUT' ? 'P' : 'C'}${fmt(item.leg.strike, item.leg.strike >= 100 ? 0 : 2)}`,
          proxy: `${item.leg.side} ${item.leg.qty} ${proxyTicker} ${formatExpiration(expiration)} ${fmt(strike)} ${item.leg.optType}`,
        })
        return {
          local_id: uniqueId(),
          included: true,
          side: item.leg.side,
          qty: item.leg.qty,
          opt_type: item.leg.optType,
          strike,
          expiration,
          entry_price: nearest ? contractEntryPrice(nearest, item.leg.side) : 0,
          iv: Number(nearest?.iv || 0.2),
          iv_adjustment: 0,
          delta: nearest?.delta ?? null,
        }
      })
      const coveringShares = ['covered-call', 'covered-call-protection'].includes(brokerImportMode)
        ? builtOptionLegs.reduce((total, leg) => (
            leg.side === 'SELL' && leg.opt_type === 'CALL'
              ? total + Math.max(1, Number(leg.qty) || 1) * 100
              : total
          ), 0)
        : 0
      const proxySpot = Object.values(chains).map(chainItem => Number(chainItem?.spot)).find(Number.isFinite) || 0
      const coveringStockLeg = coveringShares ? makeStockLeg('BUY', coveringShares, proxySpot) : null
      if (coveringStockLeg) {
        preview.push({
          source: 'COVERAGE',
          proxy: `BUY ${coveringShares} ${proxyTicker} shares · covers ${coveringShares / 100} short call contract(s)`,
        })
      }
      const builtLegs = coveringStockLeg ? [coveringStockLeg, ...builtOptionLegs] : builtOptionLegs
      setMonthChains(previous => ({ ...previous, ...chains }))
      setLegs(builtLegs)
      setTicker(proxyTicker)
      setTickerInput(proxyTicker)
      setStrategyId(null)
      setStrategyName(brokerImportMode === 'covered-call-protection'
        ? `${mapped[0].mappedFrom || proxyTicker} covered call + put protection`
        : `${mapped[0].mappedFrom || proxyTicker} broker import`)
      setChainTargetLegId(null)
      setBrokerImportPreview(preview)
      const notes = []
      if (skipped.length) notes.push(`${skipped.length} leg(s) on other underlyings were skipped`)
      if (unparsed.length) notes.push(`${unparsed.length} line(s) could not be read`)
      const coverageSummary = coveringShares ? ` + ${coveringShares} covering shares` : ''
      setBrokerImportSummary(`Loaded ${builtOptionLegs.length} option leg(s)${coverageSummary} on ${proxyTicker}${notes.length ? ` · ${notes.join('; ')}` : ''}.`)
      setWorkspace(targetWorkspace)
    } catch (error) {
      setBrokerImportError(error.message)
      setBrokerImportSummary('')
      setBrokerImportPreview([])
    } finally {
      setBrokerImportBusy(false)
    }
  }, [brokerImportText, brokerImportMode, makeStockLeg])

  const netDebit = useMemo(() => activeLegs.reduce((total, leg) => {
    const direction = leg.side === 'BUY' ? 1 : -1
    const unitMultiplier = isStockLeg(leg) ? 1 : 100
    return total + direction * Math.max(1, Number(leg.qty) || 1) * Number(leg.entry_price || 0) * unitMultiplier
  }, 0), [activeLegs])

  const saveStrategy = async () => {
    if (!strategyName.trim() || !legs.length) {
      setSaveStatus('Add at least one leg and name the strategy before saving.')
      return
    }
    setSaveStatus('Saving…')
    const payload = {
      name: strategyName.trim(), underlying: ticker, model, rate: (Number(ratePct) || 0) / 100, notes,
      legs: legs.map((leg, index) => ({
        group_id: 0, included: leg.included, side: leg.side, qty: Number(leg.qty) || 1,
        opt_type: leg.opt_type, strike: isStockLeg(leg) ? 0 : Number(leg.strike), expiration: isStockLeg(leg) ? '' : leg.expiration,
        entry_price: Number(leg.entry_price) || 0, iv_override: isStockLeg(leg) ? null : modeledLegIv(leg), sort_order: index,
      })),
    }
    try {
      if (strategyId) {
        await fetchJson(`/api/options/strategies/${strategyId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        setSaveStatus(`Updated ${payload.name}`)
      } else {
        const created = await fetchJson('/api/options/strategies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        setStrategyId(created.id)
        setSaveStatus(`Saved ${payload.name}`)
      }
      await loadSavedStrategies()
    } catch (error) {
      setSaveStatus(error.message)
    }
  }

  const loadStrategy = (strategy, targetWorkspace = 'risk') => {
    setStrategyId(strategy.id)
    setStrategyName(strategy.name)
    setTicker(strategy.underlying)
    setTickerInput(strategy.underlying)
    setModel(strategy.model || 'black-scholes')
    setRatePct(Number(strategy.rate ?? 0.0375) * 100)
    setNotes(strategy.notes || '')
    setLegs((strategy.legs || []).map(leg => ({
      local_id: uniqueId(), included: Boolean(leg.included), side: leg.side, qty: leg.qty,
      opt_type: leg.opt_type, strike: leg.strike, expiration: leg.expiration,
      entry_price: leg.entry_price ?? 0, iv: isStockLeg(leg) ? null : leg.iv_override ?? 0.2, iv_adjustment: 0, delta: isStockLeg(leg) ? 1 : null,
    })))
    setEvaluationDate(TODAY())
    setVolatilityShift(0)
    setChainTargetLegId(null)
    setWorkspace(targetWorkspace)
    setSaveStatus(`Loaded ${strategy.name}`)
  }

  const deleteStrategy = async strategy => {
    if (!window.confirm(`Delete “${strategy.name}”?`)) return
    try {
      await fetchJson(`/api/options/strategies/${strategy.id}`, { method: 'DELETE' })
      if (strategy.id === strategyId) setStrategyId(null)
      setSaveStatus(`Deleted ${strategy.name}`)
      await loadSavedStrategies()
    } catch (error) {
      setSaveStatus(error.message)
    }
  }

  const newStrategy = () => {
    setStrategyId(null)
    setStrategyName('Untitled strategy')
    setNotes('')
    setLegs([])
    setEvaluationDate(TODAY())
    setVolatilityShift(0)
    setChainTargetLegId(null)
    setSaveStatus('New strategy')
    setWorkspace('trades')
  }

  const changeTone = Number(quote?.change || 0) >= 0 ? 'positive' : 'negative'

  return (
    <div className="page opt-page">
      <div className="opt-page-header">
        <div>
          <div className="opt-eyebrow">Strategy laboratory</div>
          <h1>Options</h1>
          <p>Build multi-leg simulated trades, study their risk profile, and move the analysis date forward to see how time and volatility reshape the position.</p>
        </div>
        <div className="opt-learning-badge"><strong>Learning mode</strong><span>Modeled results — no orders are placed</span></div>
      </div>

      <section className="opt-market-bar card">
        <form onSubmit={submitTicker} className="opt-symbol-form">
          <label><span>Underlying</span><input value={tickerInput} onChange={event => setTickerInput(event.target.value.toUpperCase())} aria-label="Options underlying symbol" /></label>
          <button type="submit" className="btn btn-primary">Load chain</button>
          <button type="button" className="btn btn-secondary" onClick={() => setMarketRefresh(value => value + 1)}>Refresh</button>
        </form>
        {quote && (
          <div className="opt-quote-strip">
            <div className="opt-symbol-name"><strong>{quote.ticker}</strong><span>{quote.name || 'Underlying'}</span></div>
            <QuoteMetric label="Last" value={money(quote.last)} />
            <QuoteMetric label="Change" value={`${Number(quote.change || 0) >= 0 ? '+' : ''}${fmt(quote.change)} (${Number(quote.change_pct || 0) >= 0 ? '+' : ''}${fmt(quote.change_pct)}%)`} tone={changeTone} />
            <QuoteMetric label="Bid / Ask" value={`${fmt(quote.bid)} / ${fmt(quote.ask)}`} />
            <QuoteMetric label="Open" value={money(quote.open)} />
            <QuoteMetric label="Day range" value={`${fmt(quote.low)} – ${fmt(quote.high)}`} />
            <QuoteMetric label="Volume" value={fmt(quote.volume, 0)} />
          </div>
        )}
        {(marketLoading || chainLoading) && <div className="opt-loading-line"><span /> Loading live market data…</div>}
        {marketError && <div className="opt-error">{marketError}</div>}
      </section>

      <div className="opt-command-row">
        <div className="opt-workspace-tabs" role="tablist" aria-label="Options workspace">
          <button type="button" className={workspace === 'trades' ? 'active' : ''} onClick={() => setWorkspace('trades')}>Simulated Trade</button>
          <button type="button" className={workspace === 'risk' ? 'active' : ''} onClick={() => setWorkspace('risk')}>Risk Profile</button>
          <button type="button" className={workspace === 'moneyness' ? 'active' : ''} onClick={() => setWorkspace('moneyness')}>Price &amp; Moneyness</button>
          <button type="button" className={workspace === 'greeks' ? 'active' : ''} onClick={() => setWorkspace('greeks')}>Greek Surfaces</button>
        </div>
        {workspace !== 'greeks' && <div className="opt-save-actions">
          <button type="button" className="btn btn-secondary" onClick={newStrategy}>New</button>
          <button type="button" className="btn btn-primary" onClick={saveStrategy} disabled={!legs.length}>{strategyId ? 'Update strategy' : 'Save strategy'}</button>
          {saveStatus && <span>{saveStatus}</span>}
        </div>}
      </div>

      {workspace !== 'greeks' && <section className="opt-strategy-meta card">
        <label className="opt-name-field"><span>Strategy name</span><input value={strategyName} onChange={event => setStrategyName(event.target.value)} /></label>
        <label><span>Pricing model</span><select value={model} onChange={event => setModel(event.target.value)}><option value="black-scholes">Black–Scholes</option><option value="bjerksund-stensland">Bjerksund–Stensland</option></select></label>
        <label><span>Rate</span><div className="opt-suffix-input"><input type="number" step="0.05" value={ratePct} onChange={event => setRatePct(event.target.value)} /><b>%</b></div></label>
        <label className="opt-notes-field"><span>Learning notes</span><input value={notes} onChange={event => setNotes(event.target.value)} placeholder="What are you testing?" /></label>
        <label><span>Saved scenarios</span><select aria-label="Saved strategy" value={strategyId == null ? '' : String(strategyId)} onChange={event => { const saved = savedStrategies.find(item => String(item.id) === event.target.value); if (saved) loadStrategy(saved) }}><option value="" disabled>Select a saved strategy…</option>{savedStrategies.map(item => <option key={item.id} value={item.id}>{item.name} · {item.underlying}</option>)}</select></label>
        {strategyId && <button type="button" className="opt-delete-saved" onClick={() => { const saved = savedStrategies.find(item => item.id === strategyId); if (saved) deleteStrategy(saved) }}>Delete strategy</button>}
      </section>}

      {workspace === 'greeks' ? (
        <GreekSurfaceExplorer
          ticker={ticker}
          quote={quote}
          chain={chain}
          expirations={expirations}
          selectedExpiration={selectedExpiration}
          onSelectExpiration={setSelectedExpiration}
          chainLoading={chainLoading}
          marketLoading={marketLoading}
          model={model}
          onModelChange={setModel}
          ratePct={ratePct}
          onRateChange={setRatePct}
          positionLegs={greekPositionLegs}
          positionStrikeChoices={greekPositionStrikeChoices}
          positionName={strategyName}
          savedPositions={savedStrategies}
          selectedPositionId={strategyId}
          onLoadSavedPosition={strategy => loadStrategy(strategy, 'greeks')}
          onBuildPositionTemplate={template => { applyTemplate(template); setWorkspace('greeks') }}
          onPositionStrikeChange={(id, strikeValue) => {
            const leg = legs.find(item => item.local_id === id)
            if (leg) changeLegStrike(leg, strikeValue)
          }}
          onEditPosition={() => setWorkspace('trades')}
        />
      ) : workspace === 'trades' ? (
        <>
          <section className="card opt-broker-import">
            <div className="opt-section-heading">
              <div><span>Broker trade import</span><h2>Paste calls and puts to build both charts</h2></div>
            </div>
            <p className="opt-broker-help">
              One trade per line, e.g. <code>NDX 260821C31250000</code>. In covered call + put protection mode, unsigned calls are sold and covered with 100 long proxy shares per contract; the highest put is bought and the lower put is sold as a debit spread. Cash-settled index options map to liquid ETF proxies — <strong>SPX→SPY</strong>, <strong>RUT→IWM</strong>, <strong>NDX→QQQ</strong> — and strikes scale to the proxy. A signed quantity always overrides the inferred side: <code>+2</code> buys two and <code>-2</code> sells two.
            </p>
            <textarea
              className="opt-broker-input"
              value={brokerImportText}
              onChange={event => setBrokerImportText(event.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="Paste broker option positions here — one position per line"
              aria-label="Broker option trades to import"
            />
            <div className="opt-broker-actions">
              <label className="opt-broker-mode">
                <span>Import unsigned lines as</span>
                <select value={brokerImportMode} onChange={event => setBrokerImportMode(event.target.value)} aria-label="Broker option position type">
                  <option value="covered-call-protection">Covered call + put protection</option>
                  <option value="covered-call">Sold covered calls</option>
                  <option value="sell">Sold options — no shares</option>
                  <option value="buy">Bought options</option>
                </select>
              </label>
              <button type="button" className="btn btn-secondary" onClick={() => { setBrokerImportText(BROKER_IMPORT_EXAMPLE); setBrokerImportMode('covered-call-protection'); setBrokerImportError('') }} disabled={brokerImportBusy}>Use covered + put example</button>
              <button type="button" className="btn btn-primary" onClick={() => importBrokerTrades('risk')} disabled={brokerImportBusy}>
                {brokerImportBusy ? 'Building…' : 'Build risk graph'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => brokerImportText.trim() ? importBrokerTrades('moneyness') : setWorkspace('moneyness')} disabled={brokerImportBusy || (!brokerImportText.trim() && !activeOptionLegs.length)}>
                {brokerImportText.trim() ? 'Build & open price chart' : 'Open Price & Moneyness'}
              </button>
              {brokerImportSummary && <span className="opt-broker-summary">{brokerImportSummary}</span>}
            </div>
            {brokerImportError && <div className="opt-error">{brokerImportError}</div>}
            {!!brokerImportPreview.length && (
              <ul className="opt-broker-preview">
                {brokerImportPreview.map((row, index) => (
                  <li key={index}><code>{row.source}</code><span aria-hidden="true">→</span><strong>{row.proxy}</strong></li>
                ))}
              </ul>
            )}
          </section>

          <section ref={chainCardRef} className="card opt-chain-card opt-simulated-trades">
            <div className="opt-section-heading">
              <div><span>Add simulated trades</span><h2>Open an expiration to choose a strike</h2></div>
              <div className="opt-chain-controls">
                <label><span>Strikes</span><select value={strikeRange} onChange={event => setStrikeRange(event.target.value)}><option value="10">ATM ±10%</option><option value="20">ATM ±20%</option><option value="40">ATM ±40%</option><option value="all">All strikes</option></select></label>
                <details className="opt-chain-column-picker">
                  <summary>Columns <span>{visibleChainColumns.length}</span></summary>
                  <div className="opt-chain-column-panel">
                    <div className="opt-chain-column-presets">
                      {Object.entries(CHAIN_COLUMN_PRESETS).map(([name, ids]) => <button key={name} type="button" onClick={() => setChainColumnIds(ids)}>{name}</button>)}
                    </div>
                    <div className="opt-chain-column-options">
                      {CHAIN_COLUMNS.map(column => (
                        <label key={column.id} title={column.tip}>
                          <input type="checkbox" checked={chainColumnIds.includes(column.id)} onChange={() => toggleChainColumn(column.id)} />
                          <span><strong>{column.label}</strong><small>{column.name}</small></span>
                        </label>
                      ))}
                    </div>
                    <small className="opt-chain-columns-saved">Selections save automatically on this device.</small>
                  </div>
                </details>
              </div>
            </div>
            {chainTargetLeg && <div className="opt-chain-target"><span>Replacing <strong>{chainTargetLeg.side} {chainTargetLeg.qty} {ticker} {formatExpiration(chainTargetLeg.expiration)} {fmt(chainTargetLeg.strike)} {chainTargetLeg.opt_type}</strong>. Click a bid or ask in the opened chain.</span><button type="button" onClick={() => setChainTargetLegId(null)}>Cancel</button></div>}
            <div className="opt-expiration-browser" ref={expirationBrowserRef}>
              {expirations.map(expiration => {
                const expanded = expandedTradeExpiration === expiration
                const dte = daysBetween(TODAY(), expiration)
                return <div key={expiration} className={`opt-expiration-series${expanded ? ' expanded' : ''}`}>
                  <button type="button" className="opt-expiration-row" onClick={() => toggleTradeExpiration(expiration)} aria-expanded={expanded}>
                    <span aria-hidden="true">{expanded ? '▾' : '›'}</span>
                    <strong>{formatExpiration(expiration)}</strong>
                    <small>{dte} DTE</small>
                    <em>{expirationSeriesLabel(expiration)}</em>
                  </button>
                  {expanded && <div className="opt-expiration-chain">
                    <div className="opt-chain-help"><span className="opt-buy-dot" /> Click an ask to buy <span className="opt-sell-dot" /> Click a bid to sell</div>
                    {chainLoading ? <div className="opt-loading-line"><span /> Loading {formatExpiration(expiration)} chain…</div> : <div className="opt-chain-wrap" ref={expandedChainWrapRef}>
                      <table className="opt-chain-table">
                        <thead><tr><th colSpan={visibleChainColumns.length} className="opt-call-head">Calls</th><th className="opt-strike-head">Strike</th><th colSpan={visibleChainColumns.length} className="opt-put-head">Puts</th></tr><tr>{visibleChainColumns.map(column => <th key={`call-${column.id}`} title={column.tip}>{column.label}</th>)}<th className="opt-strike-head">Price</th>{mirroredPutColumns.map(column => <th key={`put-${column.id}`} title={column.tip}>{column.label}</th>)}</tr></thead>
                        <tbody>
                          {chainRows.map(row => <tr key={row.strike} className={Math.abs(row.strike - spot) === Math.min(...chainRows.map(item => Math.abs(item.strike - spot))) ? 'opt-atm-row' : ''}><ChainCells contract={row.call} itm={row.strike < spot} onAdd={addLeg} optType="CALL" columns={visibleChainColumns} /><td className="opt-strike-cell">{fmt(row.strike, row.strike >= 100 ? 0 : 1)}</td><ChainCells contract={row.put} itm={row.strike > spot} onAdd={addLeg} optType="PUT" columns={mirroredPutColumns} /></tr>)}
                          {!chainRows.length && !chainLoading && <tr><td colSpan={visibleChainColumns.length * 2 + 1} className="opt-empty-row">No option contracts are available in this range.</td></tr>}
                        </tbody>
                      </table>
                    </div>}
                  </div>}
                </div>
              })}
              {!expirations.length && !marketLoading && <div className="opt-empty-row">No expirations are available for {ticker}.</div>}
            </div>
          </section>

          <section className="card opt-templates">
            <div><span>Quick learning templates</span><small>Templates replace the simulated legs below using contracts near the current price.</small></div>
            <div><button onClick={() => applyTemplate('covered-call')}>Covered call</button><button onClick={() => applyTemplate('long-call')}>Long call</button><button onClick={() => applyTemplate('bull-call')}>Bull call spread</button><button onClick={() => applyTemplate('bear-put')}>Bear put spread</button><button onClick={() => applyTemplate('straddle')}>Long straddle</button><button onClick={() => applyTemplate('iron-condor')}>Iron condor</button></div>
          </section>
        </>
      ) : workspace === 'moneyness' ? (
        <section className="card opt-broker-chart-workspace">
          <div className="opt-section-heading">
            <div><span>Broker position chart</span><h2>{ticker} price and option moneyness</h2></div>
            <div className="opt-broker-chart-controls">
              <div className="opt-period-buttons" role="group" aria-label="Price chart period">
                {[['1mo', '1M'], ['3mo', '3M'], ['6mo', '6M'], ['1y', '1Y']].map(([value, label]) => <button key={value} type="button" className={brokerChartPeriod === value ? 'active' : ''} onClick={() => setBrokerChartPeriod(value)}>{label}</button>)}
              </div>
              <div className="opt-period-buttons" role="group" aria-label="Price chart type">
                <button type="button" className={brokerChartType === 'line' ? 'active' : ''} onClick={() => setBrokerChartType('line')}>Line</button>
                <button type="button" className={brokerChartType === 'candlestick' ? 'active' : ''} onClick={() => setBrokerChartType('candlestick')}>Candle</button>
              </div>
              <button type="button" onClick={() => setBrokerChartRefresh(value => value + 1)} disabled={brokerChartLoading || !activeOptionLegs.length}>Refresh</button>
            </div>
          </div>
          {!activeOptionLegs.length ? (
            <div className="opt-risk-empty"><strong>Add or import an option position first.</strong><span>The chart will place every active call and put strike against the underlying price history.</span><button className="btn btn-primary" onClick={() => setWorkspace('trades')}>Open simulated trade</button></div>
          ) : (
            <>
              <div className="opt-moneyness-summary">
                <div className="opt-moneyness-current"><small>{ticker} current</small><strong>{money(spot)}</strong></div>
                {activeOptionLegs.map(leg => {
                  const value = optionMoneyness(leg, spot)
                  if (!value) return null
                  return <div key={leg.local_id} className={`opt-moneyness-position ${value.status.toLowerCase()}`}>
                    <span><strong>{leg.side} {leg.qty}</strong> {value.optType} {money(value.strike)}</span>
                    <b>{fmt(value.percentDistance, 1)}% {value.status}</b>
                    <small>{money(value.dollarDistance)} {value.relativePosition} current · {formatExpiration(leg.expiration)}</small>
                  </div>
                })}
              </div>
              {brokerChartLoading && <div className="opt-calculating">Loading {brokerChartPeriod.toUpperCase()} technical price history…</div>}
              {brokerChartError && <div className="opt-error">{brokerChartError}</div>}
              {!!brokerChartRecords.length && <BrokerMoneynessChart ticker={ticker} spot={spot} legs={activeOptionLegs} records={brokerChartRecords} chartType={brokerChartType} />}
            </>
          )}
        </section>
      ) : (
        <section className="card opt-risk-workspace">
          <div className="opt-risk-controls">
            <label><span>Analysis date</span><input type="date" min={TODAY()} max={analysisHorizon} value={evaluationDate} onInput={event => setBoundedEvaluationDate(event.target.value)} onChange={event => setBoundedEvaluationDate(event.target.value)} /></label>
            <label className="opt-time-slider"><span>Move through time · day {evaluationOffset} of {evolutionDays}</span><input type="range" min="0" max={evolutionDays} value={evaluationOffset} onInput={event => setBoundedEvaluationDate(addDays(TODAY(), event.target.value))} onChange={event => setBoundedEvaluationDate(addDays(TODAY(), event.target.value))} /></label>
            <label><span>Global vol adjustment</span><div className="opt-suffix-input"><input type="number" step="0.5" value={volatilityShift} onChange={event => setVolatilityShift(event.target.value)} title="Add or subtract volatility points from every leg" /><b>pts</b></div></label>
            <label><span>Price range</span><div className="opt-suffix-input"><input type="number" min="5" max="100" value={priceRangePct} onChange={event => setPriceRangePct(event.target.value)} /><b>±%</b></div></label>
            <label><span>Day-step lines</span><select value={dayStep} onChange={event => setDayStep(Number(event.target.value))}><option value="0">Off</option><option value="1">Every day</option><option value="3">Every 3 days</option><option value="5">Every 5 days</option><option value="7">Every 7 days</option><option value="14">Every 14 days</option></select></label>
          </div>
          <div className="opt-probability-controls">
            <label className="opt-probability-toggle"><span>Probability shading</span><strong><input type="checkbox" checked={showProbabilityRange} onChange={event => setShowProbabilityRange(event.target.checked)} disabled={!activeOptionLegs.length} /> Show range</strong></label>
            <label><span>Reference option</span><select value={probabilityAnchor?.local_id || ''} onChange={event => setProbabilityAnchorId(event.target.value)} disabled={!activeOptionLegs.length}>{activeOptionLegs.map(leg => <option key={leg.local_id} value={leg.local_id}>{leg.opt_type} {fmt(leg.strike)} · {formatExpiration(leg.expiration)}</option>)}</select></label>
            <label><span>Range type</span><select value={probabilityRangeMode} onChange={event => setProbabilityRangeMode(event.target.value)} disabled={!probabilityAnchor}><option value="moneyness">Moneyness</option><option value="probability">Probability</option></select></label>
            <label><span>Prob mode</span><select value={probabilityMode} onChange={event => setProbabilityMode(event.target.value)} disabled={!probabilityAnchor}><option value="ITM">ITM</option><option value="OTM">OTM</option><option value="TOUCH">Touch</option></select></label>
            {probabilityRangeMode === 'probability'
              ? <label><span>Probability range</span><div className="opt-suffix-input"><input type="number" min="1" max="99.9" step="0.01" value={probabilityMassPct} onChange={event => setProbabilityMassPct(event.target.value)} onBlur={event => setProbabilityMassPct(Math.min(99.9, Math.max(1, Number(event.target.value) || 68.27)))} disabled={!probabilityAnchor} /><b>%</b></div></label>
              : <>
                <label><span>In the money</span><div className="opt-suffix-input"><input type="number" min="1" step="1" value={itmRangePct} onChange={event => setItmRangePct(event.target.value)} onBlur={event => setItmRangePct(Math.max(1, Number(event.target.value) || 1))} disabled={!probabilityAnchor} /><b>%</b></div></label>
                <label><span>Out of the money</span><div className="opt-suffix-input"><input type="number" min="1" step="1" value={otmRangePct} onChange={event => setOtmRangePct(event.target.value)} onBlur={event => setOtmRangePct(Math.max(1, Number(event.target.value) || 1))} disabled={!probabilityAnchor} /><b>%</b></div></label>
              </>}
            <label><span>Analysis volatility</span><div className="opt-suffix-input"><input type="number" min="0.01" step="0.5" value={probabilityAnchor ? (modeledLegIv(probabilityAnchor, volatilityShift) * 100).toFixed(2) : ''} onChange={event => setAnalysisIvPct(event.target.value)} disabled={!probabilityAnchor} title="Sets the effective IV for the reference leg and shifts every option leg by the same number of volatility points" /><b>%</b></div></label>
            <div className="opt-probability-readout">
              {risk?.probability_range ? <>
                <span className={probabilityMode === 'ITM' ? 'selected itm' : ''}><small>Probability ITM</small><strong>{fmt(risk.probability_range.probability_itm_pct, 1)}%</strong></span>
                <span className={probabilityMode === 'OTM' ? 'selected otm' : ''}><small>Probability OTM</small><strong>{fmt(risk.probability_range.probability_otm_pct, 1)}%</strong></span>
                <span className={probabilityMode === 'TOUCH' ? 'selected touch' : ''}><small>Probability touch</small><strong>{fmt(risk.probability_range.probability_touch_pct, 1)}%</strong></span>
                <span><small>Inside shaded range</small><strong>{fmt(risk.probability_range.inside_pct, 1)}%</strong></span>
                <em>{probabilityRangeMode === 'probability' ? 'Drag either boundary or type the probability range.' : 'Drag either boundary or type the ITM and OTM percentages.'}</em>
              </> : <em>{activeOptionLegs.length ? 'Probability updates with date and volatility.' : 'Add an option leg to show a probability range.'}</em>}
            </div>
            {risk?.probability_range && <div className="opt-moneyness-key">
              <span className={risk.probability_range.range_mode === 'probability' ? 'tail' : String(risk.probability_range.lower_label).endsWith('ITM') ? 'itm' : 'otm'}><strong>{risk.probability_range.lower_label}</strong>{money(risk.probability_range.low)}</span>
              <span className="atm"><strong>Reference strike</strong>{money(risk.probability_range.anchor_strike)}</span>
              <span className={risk.probability_range.range_mode === 'probability' ? 'tail' : String(risk.probability_range.upper_label).endsWith('ITM') ? 'itm' : 'otm'}><strong>{risk.probability_range.upper_label}</strong>{money(risk.probability_range.high)}</span>
            </div>}
          </div>
          {hasMixedExpirations && <div className="opt-horizon-note"><strong>Mixed expirations:</strong> analysis ends at the first expiration, {formatExpiration(analysisHorizon)}. Later-dated legs retain their remaining modeled time value.</div>}
          {riskLoading && <div className="opt-calculating">Repricing every leg…</div>}
          {riskError && <div className="opt-error">{riskError}</div>}
          {!activeLegs.length ? <div className="opt-risk-empty"><strong>{legs.length ? 'No legs are included in the risk graph.' : 'Add positions to build a risk profile.'}</strong><span>{legs.length ? 'Check Use for each leg you want included in the graph and risk totals.' : 'Add stock, use the option chain, or choose a learning template, then return here.'}</span>{!legs.length && <button className="btn btn-primary" onClick={() => setWorkspace('trades')}>Open simulated trade</button>}</div> : risk && (
            <>
              <div className="opt-summary-grid">
                <SummaryMetric label="Entry" value={netDebit >= 0 ? `${money(netDebit)} debit` : `${money(Math.abs(netDebit))} credit`} />
                <SummaryMetric
                  label={risk.max_profit_unlimited || risk.theoretical_max_profit != null ? 'Max profit' : 'Range max profit'}
                  value={risk.max_profit_unlimited ? 'Unlimited' : money(risk.theoretical_max_profit ?? risk.max_profit)}
                  tone="positive"
                  helper={risk.max_profit_unlimited || risk.theoretical_max_profit != null ? 'At expiration' : 'Within displayed prices'}
                />
                <SummaryMetric
                  label={risk.max_loss_unlimited || risk.theoretical_max_loss != null ? 'Max loss' : 'Range max loss'}
                  value={risk.max_loss_unlimited ? 'Unlimited' : money(risk.theoretical_max_loss ?? risk.max_loss)}
                  tone="negative"
                  helper={risk.max_loss_unlimited || risk.theoretical_max_loss != null ? 'At expiration' : 'Within displayed prices'}
                />
                <SummaryMetric label="Breakeven" value={(risk.breakevens || []).length ? risk.breakevens.map(value => fmt(value)).join(' · ') : 'None in range'} />
                <SummaryMetric label="Delta" value={fmt(risk.portfolio_greeks?.delta, 2)} />
                <SummaryMetric label="Theta / day" value={fmt(risk.portfolio_greeks?.theta, 2)} tone={Number(risk.portfolio_greeks?.theta) >= 0 ? 'positive' : 'negative'} />
                <SummaryMetric label="Vega / point" value={fmt(risk.portfolio_greeks?.vega, 2)} />
              </div>
              {!!positionStrikes.length && <div className="opt-position-strikes"><strong>Position strikes</strong>{positionStrikes.map(strike => <span key={strike}>{money(strike)}</span>)}</div>}
              {strikeStructure && <div className="opt-structure-drag-hint"><span aria-hidden="true">↔</span><span>Drag either blue strike handle to widen or narrow the entire structure around <strong>{money(strikeStructure.center)}</strong>.</span></div>}
              <RiskChart result={risk} evaluationDate={evaluationDate} strikeStructure={strikeStructure} positionStrikes={positionStrikes} onResizeStructure={resizeLegStructure} onAdjustProbabilityBoundary={adjustProbabilityBoundary} />
              <div className="opt-slice-heading"><div><span>Price slices</span><h3>Greeks and modeled P/L at selected prices</h3></div><div className="opt-slice-inputs">{sliceOffsets.map((offset, index) => <label key={index}><input type="number" value={offset} onChange={event => setSliceOffsets(values => values.map((value, current) => current === index ? Number(event.target.value) : value))} /><span>%</span></label>)}</div></div>
              <div className="opt-table-wrap"><table className="opt-slices-table"><thead><tr><th>Underlying</th><th>Move</th><th>Delta</th><th>Gamma</th><th>Theta</th><th>Vega</th><th>P/L open</th><th>1-day theta</th></tr></thead><tbody>{(risk.price_slices || []).map((slice, index) => <tr key={`${slice.s}-${index}`}><td>{money(slice.s)}</td><td>{Number(sliceOffsets[index]) > 0 ? '+' : ''}{sliceOffsets[index]}%</td><td>{fmt(slice.delta, 3)}</td><td>{fmt(slice.gamma, 4)}</td><td>{fmt(slice.theta, 2)}</td><td>{fmt(slice.vega, 2)}</td><td className={Number(slice.pnl_open) >= 0 ? 'opt-positive' : 'opt-negative'}>{signedMoney(slice.pnl_open)}</td><td className={Number(slice.pnl_day) >= 0 ? 'opt-positive' : 'opt-negative'}>{signedMoney(slice.pnl_day)}</td></tr>)}</tbody></table></div>
            </>
          )}
        </section>
      )}

      {workspace !== 'greeks' && <section className="card opt-legs-card">
        <div className="opt-section-heading">
          <div><span>Positions and simulated trades</span><h2>{legs.length ? `${activeLegs.length} of ${legs.length} active · ${ticker}` : 'No simulated trades'}</h2></div>
          <div className="opt-leg-actions"><button type="button" onClick={addStockLeg} disabled={!spot}>+ Add stock</button><button type="button" onClick={() => { const contract = nearestContract('CALL', spot); if (contract) addLeg(contract, 'CALL', 'BUY') }}>+ Add ATM call</button><button type="button" onClick={() => { const contract = nearestContract('PUT', spot); if (contract) addLeg(contract, 'PUT', 'BUY') }}>+ Add ATM put</button><button type="button" onClick={() => setWorkspace('risk')} disabled={!legs.length}>Analyze risk</button></div>
        </div>
        <div className="opt-table-wrap">
          <table className="opt-legs-table"><thead><tr><th>Use</th><th>Side</th><th>Qty</th><th>Symbol</th><th>Expiration</th><th>Strike</th><th>Type</th><th>Entry / basis</th><th>Market IV</th><th>Vol Adj</th><th>Modeled IV</th><th>Delta</th><th /></tr></thead><tbody>
            {legs.map(leg => {
              const stockLeg = isStockLeg(leg)
              const legLabel = stockLeg ? `${ticker} stock` : `${ticker} ${leg.strike} ${leg.opt_type}`
              const contracts = stockLeg ? [] : optionContracts(leg.expiration, leg.opt_type)
              const strikeInChain = contracts.some(contract => Number(contract.strike) === Number(leg.strike))
              return <tr key={leg.local_id} className={`${leg.side === 'BUY' ? 'opt-buy-leg' : 'opt-sell-leg'}${leg.included ? '' : ' opt-leg-disabled'}`}>
                <td><input type="checkbox" checked={leg.included} onChange={event => setLegIncluded(leg.local_id, event.target.checked)} aria-label={`${leg.included ? 'Exclude' : 'Include'} ${legLabel} from risk graph`} title="Include this leg in the risk graph" /></td>
                <td><select value={leg.side} onChange={event => changeLegSide(leg, event.target.value)}><option>BUY</option><option>SELL</option></select></td>
                <td><input type="number" min="1" value={leg.qty} onChange={event => updateLeg(leg.local_id, 'qty', event.target.value)} title={stockLeg ? 'Number of shares' : 'Number of option contracts'} /></td>
                <td><strong>{ticker}</strong></td>
                <td>{stockLeg ? <span className="opt-not-applicable">—</span> : <select value={leg.expiration} onChange={event => changeLegExpiration(leg, event.target.value)}>{!expirations.includes(leg.expiration) && <option value={leg.expiration}>{formatExpiration(leg.expiration)}</option>}{expirations.map(expiration => <option key={expiration} value={expiration}>{formatExpiration(expiration)}</option>)}</select>}</td>
                <td>{stockLeg ? <span className="opt-not-applicable">—</span> : contracts.length ? <select className="opt-strike-select" value={String(leg.strike)} onChange={event => changeLegStrike(leg, event.target.value)} aria-label={`${legLabel} strike`}>{!strikeInChain && <option value={String(leg.strike)}>{fmt(leg.strike)} · custom</option>}{contracts.map(contract => <option key={contract.strike} value={String(contract.strike)}>{fmt(contract.strike)}</option>)}</select> : <input type="number" step="0.5" value={leg.strike} onChange={event => updateLeg(leg.local_id, 'strike', event.target.value)} title="Chain is loading; manual strike entry remains available" />}</td>
                <td><select value={leg.opt_type} onChange={event => changeLegType(leg, event.target.value)}><option>CALL</option><option>PUT</option><option>STOCK</option></select></td>
                <td><input type="number" min="0" step="0.01" value={leg.entry_price} onChange={event => updateLeg(leg.local_id, 'entry_price', event.target.value)} title={stockLeg ? 'Stock cost basis per share' : 'Option premium per share'} /></td>
                <td>{stockLeg ? <span className="opt-not-applicable">—</span> : percent(leg.iv)}</td>
                <td>{stockLeg ? <span className="opt-not-applicable">—</span> : <div className="opt-inline-suffix"><input type="number" step="0.5" value={leg.iv_adjustment ?? 0} onChange={event => updateLeg(leg.local_id, 'iv_adjustment', event.target.value)} aria-label={`${legLabel} volatility adjustment`} title="Manual volatility-point adjustment for this leg" /><span>pts</span></div>}</td>
                <td title={stockLeg ? undefined : 'Market IV plus the leg and global volatility adjustments'}>{stockLeg ? <span className="opt-not-applicable">—</span> : percent(modeledLegIv(leg, volatilityShift))}</td>
                <td>{fmt(leg.delta, 3)}</td>
                <td><div className="opt-row-actions">{!stockLeg && <button className="opt-open-chain" type="button" onClick={() => openLegChain(leg)} aria-label={`Open ${formatExpiration(leg.expiration)} option chain for ${legLabel}`} title="Open this expiration and replace the leg from the chain">Chain</button>}<button className="opt-remove-leg" type="button" onClick={() => removeLeg(leg.local_id)} aria-label="Remove leg">×</button></div></td>
              </tr>
            })}
            {!legs.length && <tr><td colSpan="13" className="opt-empty-row">Add stock, click a bid or ask in the chain, or start with a learning template.</td></tr>}
          </tbody><tfoot><tr><td colSpan="7">Net entry</td><td className={netDebit <= 0 ? 'opt-positive' : ''}>{netDebit >= 0 ? `${money(netDebit)} debit` : `${money(Math.abs(netDebit))} credit`}</td><td colSpan="5" /></tr></tfoot></table>
        </div>
      </section>}

      <div className="opt-disclaimer"><strong>Educational modeling only.</strong> Quotes can be delayed or incomplete. Greeks and theoretical values are estimates, exclude commissions and assignment effects, and are not investment advice.</div>
    </div>
  )
}
