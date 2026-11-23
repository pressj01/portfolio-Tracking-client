// Chart builder shared by Compare ETFs and Compare Stocks. Both screens used
// to carry their own copy of this code; the metric menu (Total Return (%),
// Growth of $10K, Dividends (TTM), ...), the right-hand scale and the end-label
// badges now live here once so the two charts behave the same.

import { formatMoney } from './money.js'
import {
  comparerActualCloses,
  comparerEndLabelAxisY,
  comparerLogHoverData,
  comparerReturnModeLabel,
  comparerSeriesColor,
  computeBlendTrace,
  selectComparerTraces,
  shiftColorForReinvest,
  shouldUseComparerLogScale,
} from './comparerTraces.js'
import {
  GROWTH_START_VALUE,
  chartMetricInfo,
  dividendEvents,
  dividendMetricSeries,
  totalReturnDollarSeries,
} from './chartMetrics.js'

export const COMPARER_DIMMED_COLOR = '#7c8595'

const TRACE_STYLES = {
  price: { dash: 'dot', width: 2, label: 'Price' },
  actual: { dash: 'solid', width: 2.6, label: 'Actual Price' },
  pricediv: { dash: 'longdash', width: 2.4, label: 'Price + Divs' },
  blend: { dash: 'dash', width: 2.4, label: '' },
  total: { dash: 'solid', width: 3, label: 'Total Return' },
  drip: { dash: 'solid', width: 3, label: '100% DRIP' },
}

// Intraday (1D/5D) charts hide nights and weekends so the session bars sit
// side by side instead of being joined by long flat overnight lines.
export const INTRADAY_RANGEBREAKS = [
  { bounds: ['sat', 'mon'] },
  { pattern: 'hour', bounds: [16, 9.5] },
]

function dateKey(value) {
  return String(value || '').slice(0, 10)
}

export function normalizeComparerRange(range) {
  if (!range?.[0] || !range?.[1]) return null
  const start = dateKey(range[0])
  const end = dateKey(range[1])
  return start <= end ? [start, end] : [end, start]
}

export function firstVisibleIndex(dates, start, end) {
  if (!dates?.length) return -1
  return dates.findIndex(d => (!start || dateKey(d) >= start) && (!end || dateKey(d) <= end))
}

export function lastVisibleIndex(dates, start, end) {
  if (!dates?.length) return -1
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const d = dateKey(dates[i])
    if ((!start || d >= start) && (!end || d <= end)) return i
  }
  return -1
}

function inWindow(date, start, end) {
  const d = dateKey(date)
  return (!start || d >= start) && (!end || d <= end)
}

export function signedPct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return `${n >= 0 ? '+' : ''}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

// Badge text in whichever of white or near-black contrasts more with the
// line color (WCAG relative luminance; the two tie at about 0.18). The
// Analysis page's pastel comparison colors need dark text.
export function badgeTextColor(background) {
  const text = String(background || '').trim()
  let rgb = null
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1]
    rgb = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16))
  } else {
    const fn = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(text)
    if (fn) rgb = fn.slice(1, 4).map(Number)
  }
  if (!rgb) return '#ffffff'
  const [r, g, b] = rgb.map(channel => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.18 ? '#0b1220' : '#ffffff'
}

function plainText(html) {
  return String(html || '').split(/<br\s*\/?>/i).reduce((longest, line) => {
    const text = line.replace(/<[^>]+>/g, '')
    return text.length > longest.length ? text : longest
  }, '')
}

// End-of-line value badges on the right edge of the plot, nudged apart so
// they never stack on top of each other. Each candidate is
// { y, text, color } in data units; the returned annotations use axis units
// (log10 on a log axis). Also reports the margin the widest badge needs.
export function placeEndLabelBadges(candidates, { visibleYValues = [], axisBase = null, logScaleActive = false, xshift = 4 } = {}) {
  if (!candidates.length) return { annotations: [], width: 0 }
  const scaleY = value => comparerEndLabelAxisY(value, logScaleActive)
  const anchors = [
    ...(axisBase == null ? [] : [scaleY(axisBase)]),
    ...visibleYValues.map(scaleY),
    ...candidates.map(label => scaleY(label.y)),
  ].filter(Number.isFinite)
  const yMin = Math.min(...anchors)
  const yMax = Math.max(...anchors)
  const ySpan = Math.max(logScaleActive ? 0.01 : 1e-6, yMax - yMin)
  // A one-line badge is ~20px tall on a ~380px plot; Compare Stocks adds a
  // CAGR line on MAX/ALL, which doubles it.
  const lines = Math.max(1, ...candidates.map(label => String(label.text || '').split(/<br\s*\/?>/i).length))
  const minGap = ySpan * 0.055 * lines
  const sorted = candidates
    .map(label => ({ ...label, scaledY: scaleY(label.y) }))
    .filter(label => Number.isFinite(label.scaledY))
    .sort((a, b) => a.scaledY - b.scaledY)
  if (!sorted.length) return { annotations: [], width: 0 }
  sorted.forEach((label, index) => {
    label.displayY = index === 0
      ? label.scaledY
      : Math.max(label.scaledY, sorted[index - 1].displayY + minGap)
  })
  const overflow = sorted[sorted.length - 1].displayY - yMax
  if (overflow > 0) {
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const nextY = index === sorted.length - 1
        ? sorted[index].displayY - overflow
        : Math.min(sorted[index].displayY, sorted[index + 1].displayY - minGap)
      sorted[index].displayY = Math.max(yMin, nextY)
    }
  }
  const widest = Math.max(...sorted.map(label => plainText(label.text).length))
  return {
    width: Math.ceil(widest * 7 + 14 + xshift),
    annotations: sorted.map(label => ({
      x: 1,
      xref: 'paper',
      y: label.displayY,
      yref: 'y',
      text: label.text,
      showarrow: false,
      xanchor: 'left',
      xshift,
      align: 'left',
      bgcolor: label.color,
      bordercolor: label.color,
      borderpad: 2,
      font: { color: badgeTextColor(label.color), size: 11, family: label.fontFamily },
    })),
  }
}

// The 1-2-2.5-5 step whose tick count lands closest to `target`.
function niceStep(span, target = 6) {
  const raw = span / target
  if (!(raw > 0) || !Number.isFinite(raw)) return null
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  let best = null
  ;[1, 2, 2.5, 5, 10, 20].forEach(factor => {
    const step = factor * magnitude
    const miss = Math.abs(span / step - target)
    if (best == null || miss < best.miss) best = { step, miss }
  })
  return best.step
}

// Signed percentage ticks ("+25.00%", "0.00%", "−5.00%") for a linear axis
// range. Plotly 3 cannot do this itself: a tick format starting with "+" is
// rejected and the ticks fall back to unformatted numbers.
export function signedPercentTicks(range, { decimals = 2 } = {}) {
  const [lo, hi] = range || []
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null
  const step = niceStep(hi - lo)
  if (!step) return null
  const tickvals = []
  for (let value = Math.ceil(lo / step) * step; value <= hi + step * 1e-9; value += step) {
    tickvals.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)))
    if (tickvals.length > 40) break
  }
  const ticktext = tickvals.map(value => {
    const body = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    const sign = value > 0 ? '+' : value < 0 ? '−' : ''
    return `${sign}${body}%`
  })
  return { tickmode: 'array', tickvals, ticktext }
}

function yearsBetween(start, end) {
  const a = Date.parse(`${dateKey(start)}T00:00:00Z`)
  const b = Date.parse(`${dateKey(end)}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / (365.25 * 24 * 60 * 60 * 1000) : null
}

// Everything the comparer chart needs, from the /api/etf-screen/data payload.
//   variant 'stock' keeps that screen's "Cumulative" titles and CAGR labels.
export function buildComparerChart({
  data,
  symbols = [],
  metric = 'total_pct',
  returnMode = 'total',
  reinvest = 100,
  returnScalePreference = 'auto',
  showReturnLabels = true,
  returnHoverMode = 'x unified',
  showRangeSlider = true,
  activeRange = null,
  fallbackRange = null,
  visibleWindow = [null, null],
  titleWindow = null,
  highlightedSymbol = '',
  divHistory = {},
  scaleRight = true,
  period = '',
  variant = 'etf',
  height = 560,
}) {
  if (!data?.series) return { data: [], layout: {}, logScaleActive: false, notes: [], unit: '' }
  const info = chartMetricInfo(metric)
  const isDividend = info.kind === 'dividend'
  const isDollar = info.kind === 'dollar'
  const isGrowth = metric === 'growth'
  const isPctAxis = info.unit === '%'
  const intraday = Boolean(data.intraday)
  const growthScale = isGrowth ? GROWTH_START_VALUE / 100 : 1
  const effectiveReinvest = Number(reinvest)
  const traces = []
  const labelCandidates = []
  const visibleYValues = []
  const notes = []
  const allDates = Object.values(data.series).flatMap(s => s.dates || [])
  const minDate = allDates.reduce((a, b) => (a < b ? a : b), allDates[0])
  const maxDate = allDates.reduce((a, b) => (a > b ? a : b), allDates[0])
  const effectiveRange = intraday ? null : (activeRange || fallbackRange)
  const [visibleStart, visibleEnd] = visibleWindow

  const autoLogScale = !isDividend && shouldUseComparerLogScale(
    data.series,
    symbols,
    metric === 'total_value' ? 'total' : returnMode,
    visibleStart,
    visibleEnd,
    effectiveReinvest,
  )
  const logScaleActive = !isDividend
    && (returnScalePreference === 'log' || (returnScalePreference === 'auto' && autoLogScale))

  const recordVisible = (dates, ys) => {
    dates.forEach((date, i) => {
      const value = Number(ys[i])
      if (value == null || !Number.isFinite(value) || ys[i] == null) return
      if (inWindow(date, visibleStart, visibleEnd)) visibleYValues.push(value)
    })
  }

  const orderedSymbols = highlightedSymbol && symbols.includes(highlightedSymbol)
    ? [...symbols.filter(s => s !== highlightedSymbol), highlightedSymbol]
    : symbols

  orderedSymbols.forEach((sym) => {
    const idx = symbols.indexOf(sym)
    const series = data.series[sym] || {}
    const dates = series.dates || []
    const isDimmed = highlightedSymbol && highlightedSymbol !== sym
    const baseColor = isDimmed ? COMPARER_DIMMED_COLOR : comparerSeriesColor(idx)
    const labelIdx = lastVisibleIndex(dates, visibleStart, visibleEnd)

    if (isDividend) {
      const events = dividendEvents(divHistory?.[sym], series)
      if (!events.length) notes.push(`${sym} has no dividend history.`)
      const ys = dividendMetricSeries(metric, dates, events, visibleStart)
      if (events.length && metric === 'div_growth_yoy' && !ys.some(value => value != null)) {
        notes.push(`${sym} needs two years of dividends for a year-over-year comparison.`)
      }
      recordVisible(dates, ys)
      const isTtm = metric === 'div_ttm'
      traces.push({
        x: dates,
        y: ys,
        type: 'scatter',
        mode: 'lines',
        name: sym,
        connectgaps: false,
        line: { color: baseColor, width: 2.6, shape: 'hv' },
        hovertemplate: isTtm
          ? `<b>${sym}</b><br>%{x}<br>Dividends (TTM): $%{y:,.4f}<extra></extra>`
          : `<b>${sym}</b><br>%{x}<br>${info.label}: %{y:,.2f}%<extra></extra>`,
      })
      const last = labelIdx >= 0 ? Number(ys[labelIdx]) : NaN
      if (showReturnLabels && ys[labelIdx] != null && Number.isFinite(last)) {
        labelCandidates.push({
          y: last,
          text: isTtm ? formatMoney(last, { convert: false, digits: last < 1 ? 4 : 2 }) : signedPct(last),
          color: baseColor,
        })
      }
      return
    }

    if (isDollar) {
      const values = metric === 'price'
        ? comparerActualCloses(series, data.profiles?.[sym]?.price)
        : totalReturnDollarSeries(series, effectiveReinvest, data.profiles?.[sym]?.price)
      if (!values.length) return
      const style = TRACE_STYLES.actual
      recordVisible(dates, values)
      traces.push({
        x: dates,
        y: values,
        type: 'scatter',
        mode: 'lines',
        name: sym,
        line: { color: baseColor, width: style.width, dash: style.dash },
        hovertemplate: metric === 'price'
          ? `<b>${sym}</b><br>%{x}<br>Share Price: $%{y:,.2f}<extra></extra>`
          : `<b>${sym}</b><br>%{x}<br>Total Return Price: $%{y:,.2f}<extra></extra>`,
      })
      const last = labelIdx >= 0 ? Number(values[labelIdx]) : NaN
      if (showReturnLabels && Number.isFinite(last)) {
        labelCandidates.push({ y: last, text: formatMoney(last, { convert: false }), color: baseColor })
      }
      return
    }

    const traceMap = series.traces || {}
    const divRatio = series.div_ratio
    selectComparerTraces(traceMap, returnMode, effectiveReinvest).forEach(([key, rawValues]) => {
      // Rebuild the blend line locally for the live slider % (exact, not an
      // approximation) so dragging Reinvest never refetches the chart.
      const values = key === 'blend'
        ? (computeBlendTrace(traceMap.price, divRatio, effectiveReinvest / 100) || rawValues)
        : rawValues
      // In Total Return / Both, a partial reinvest shows the blend as the
      // headline line — solid like full DRIP, tinted so it still reads as
      // this fund's line.
      const blendAsTotal = key === 'blend' && ['total', 'both'].includes(returnMode)
      const color = blendAsTotal && !isDimmed ? shiftColorForReinvest(baseColor, effectiveReinvest) : baseColor
      const style = blendAsTotal ? TRACE_STYLES.total : (TRACE_STYLES[key] || TRACE_STYLES.total)
      const baseIdx = firstVisibleIndex(dates, visibleStart, visibleEnd)
      const base = Number(baseIdx >= 0 ? values?.[baseIdx] : values?.[0])
      const normalized = base ? values.map(v => v / base * 100 * growthScale) : values
      const returnValues = normalized.map(v => Number(v) / growthScale - 100)
      const y = logScaleActive || isGrowth ? normalized : returnValues
      recordVisible(dates, y)
      const label = key === 'blend' ? `${effectiveReinvest}% Reinvest` : style.label
      const name = label ? `${sym} (${label})` : sym
      const lineLabel = label || 'Total Return'
      let hovertemplate
      let customdata
      if (isGrowth) {
        customdata = returnValues
        hovertemplate = `<b>${sym}</b><br>%{x}<br>${lineLabel}: $%{y:,.2f} (%{customdata:,.2f}%)<extra></extra>`
      } else if (logScaleActive) {
        customdata = comparerLogHoverData(returnValues, normalized)
        hovertemplate = `<b>${sym}</b><br>%{x}<br>${lineLabel}: %{customdata[0]}<br>Growth of $100: %{customdata[1]}<extra></extra>`
      } else {
        customdata = returnValues
        hovertemplate = `<b>${sym}</b><br>%{x}<br>${lineLabel}: %{y:,.2f}%<extra></extra>`
      }
      traces.push({
        x: dates,
        y,
        type: 'scatter',
        mode: 'lines',
        name,
        customdata,
        // A log axis under a percentage metric plots growth of $100; the
        // export still reports the percentage the metric names.
        exportY: !isGrowth && logScaleActive ? returnValues : undefined,
        line: { color, width: style.width, dash: style.dash },
        hovertemplate,
      })
      if (showReturnLabels && labelIdx >= 0 && Number.isFinite(Number(y[labelIdx]))) {
        let text = isGrowth ? formatMoney(Number(y[labelIdx]), { convert: false, digits: 0 }) : signedPct(returnValues[labelIdx])
        if (variant === 'stock' && !isGrowth && ['max', 'all'].includes(period)) {
          const years = yearsBetween(dates[baseIdx >= 0 ? baseIdx : 0], dates[labelIdx])
          const ending = Number(values?.[labelIdx])
          if (years != null && years >= 1 && base > 0 && ending > 0) {
            text += `<br>${signedPct((Math.pow(ending / base, 1 / years) - 1) * 100)} CAGR`
          }
        }
        labelCandidates.push({ y: Number(y[labelIdx]), text, color })
      }
    })
  })

  let baselineY = null
  if (info.kind === 'return') baselineY = logScaleActive || isGrowth ? 100 * growthScale : 0
  else if (metric === 'div_growth' || metric === 'div_growth_yoy') baselineY = 0
  if (baselineY != null && minDate && maxDate) {
    traces.push({
      x: [minDate, maxDate],
      y: [baselineY, baselineY],
      type: 'scatter',
      mode: 'lines',
      name: 'Baseline',
      line: { color: '#6b7280', width: 1, dash: 'dash' },
      showlegend: false,
      hoverinfo: 'skip',
    })
  }
  const axisBase = metric === 'div_ttm' ? 0 : baselineY

  const badgeShift = scaleRight ? 3 : 6
  const badges = showReturnLabels
    ? placeEndLabelBadges(labelCandidates, { visibleYValues, axisBase, logScaleActive, xshift: badgeShift })
    : { annotations: [], width: 0 }

  // Plotly autoranges y over every point, not just the visible window, so a
  // zoomed chart would stay scaled to the whole series. Fit it to the window.
  let yAxisRange = null
  let visibleAbsMax = 0
  if (visibleYValues.length) {
    const rangeValues = [
      ...(axisBase == null ? [] : [axisBase]),
      ...visibleYValues,
      ...labelCandidates.map(l => l.y),
    ]
    const yLo = Math.min(...rangeValues)
    const yHi = Math.max(...rangeValues)
    visibleAbsMax = Math.max(Math.abs(yLo), Math.abs(yHi))
    if (logScaleActive) {
      const logLo = Math.log10(Math.max(yLo, Number.MIN_VALUE))
      const logHi = Math.log10(Math.max(yHi, Number.MIN_VALUE))
      const pad = Math.max((logHi - logLo) * 0.08, 0.04)
      yAxisRange = [logLo - pad, logHi + pad]
    } else {
      const minPad = metric === 'div_ttm' ? Math.max(Math.abs(yHi) * 0.03, 0.001) : 1
      const pad = Math.max((yHi - yLo) * 0.08, minPad)
      yAxisRange = [yLo - pad, yHi + pad]
    }
  }

  const returnModeLabel = comparerReturnModeLabel(returnMode)
  let baseTitle
  if (metric === 'total_pct') baseTitle = returnMode === 'total' ? 'Total Return (%)' : `${returnModeLabel} (%)`
  else if (metric === 'price_pct') baseTitle = 'Stock Price (%)'
  else if (metric === 'growth') baseTitle = returnMode === 'total' ? 'Growth of $10K' : `Growth of $10K — ${returnModeLabel}`
  else if (metric === 'total_value') baseTitle = 'Total Return Price ($)'
  else if (metric === 'price') baseTitle = 'Stock Price ($)'
  else baseTitle = info.label
  if (variant === 'stock' && (metric === 'total_pct' || metric === 'price_pct')) baseTitle = `Cumulative ${baseTitle}`
  const windowText = titleWindow ? ` — ${titleWindow[0]} → ${titleWindow[1]}` : ''
  const titleText = `${baseTitle}${windowText}${logScaleActive ? ' — Log Scale' : ''}`

  const largeReturnDisplay = isPctAxis && !logScaleActive && visibleAbsMax >= 1000
  const yaxis = {
    type: logScaleActive ? 'log' : 'linear',
    side: scaleRight ? 'right' : 'left',
    automargin: true,
    gridcolor: '#333',
    zerolinecolor: '#555',
    showspikes: true,
    spikemode: 'across',
    separatethousands: true,
    ...(yAxisRange ? { range: yAxisRange, autorange: false } : {}),
  }
  if (isGrowth || isDollar || metric === 'div_ttm') {
    yaxis.tickprefix = '$'
    yaxis.tickformat = isGrowth ? ',.0f' : (metric === 'div_ttm' && visibleAbsMax < 1 ? ',.3f' : ',.2f')
  } else if (logScaleActive) {
    yaxis.tickformat = ',.0f'
  } else {
    yaxis.ticksuffix = '%'
    yaxis.tickformat = largeReturnDisplay ? ',.0f' : ',.2f'
    const signedTicks = signedPercentTicks(yAxisRange, { decimals: largeReturnDisplay ? 0 : 2 })
    if (signedTicks) {
      delete yaxis.ticksuffix
      Object.assign(yaxis, signedTicks)
    }
  }
  // The right-hand scale reads like a quote screen: tick labels only, with the
  // end-value badges sitting on it. On the left the axis keeps its title.
  if (!scaleRight) {
    let axisTitle
    if (isGrowth) axisTitle = logScaleActive ? 'Growth of $10K (log scale)' : 'Value ($)'
    else if (metric === 'total_value') axisTitle = logScaleActive ? 'Total Return Price ($) (log scale)' : 'Total Return Price ($)'
    else if (metric === 'price') axisTitle = logScaleActive ? 'Share Price ($) (log scale)' : 'Share Price ($)'
    else if (metric === 'div_ttm') axisTitle = 'Dividends per Share, TTM ($)'
    else if (isDividend) axisTitle = `${info.label} (%)`
    else if (logScaleActive) axisTitle = 'Growth of $100 (log scale)'
    else axisTitle = `${variant === 'stock' ? 'Cumulative ' : ''}${returnMode === 'total' || metric === 'price_pct' ? info.label.replace(' (%)', '') : returnModeLabel} (%)`
    yaxis.title = { text: axisTitle }
  }

  const margin = scaleRight
    ? { l: 16, r: Math.max(64, badges.width + 8), t: 70, b: 55 }
    : { l: largeReturnDisplay ? 115 : 60, r: Math.max(20, badges.width + 10), t: 70, b: 55 }

  return {
    data: traces,
    logScaleActive,
    notes,
    unit: isGrowth || isDollar || metric === 'div_ttm' ? '$' : '%',
    layout: {
      template: 'plotly_dark',
      paper_bgcolor: '#1e1e2f',
      plot_bgcolor: '#1e1e2f',
      font: { color: '#e0e0e0', size: 12 },
      title: { text: titleText, x: 0.5, font: { size: 20, color: '#e0e0e0' } },
      height,
      margin,
      hovermode: returnHoverMode,
      legend: { orientation: 'h', x: 0, y: 1.08 },
      yaxis,
      xaxis: {
        type: 'date',
        gridcolor: '#333',
        rangeslider: showRangeSlider
          ? { visible: true, bgcolor: '#252540', bordercolor: '#555', borderwidth: 1, thickness: 0.08 }
          : { visible: false },
        ...(intraday ? { rangebreaks: INTRADAY_RANGEBREAKS } : {}),
        ...(effectiveRange ? { range: effectiveRange, autorange: false } : {}),
        showspikes: true,
        spikemode: 'across',
      },
      annotations: badges.annotations,
    },
  }
}
