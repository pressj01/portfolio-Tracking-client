// Shared technical-indicator math for price charts.
//
// Stock and ETF Analysis (ETFScreen) and the Put Selling Scanner's price popup
// both draw from here so the same ticker shows the same MACD, RSI, and moving
// averages on either screen. ETFScreen's indicator registry delegates to these
// functions rather than keeping a second copy.

/** Simple moving average with warm-up: plots from bar 0 using a partial window. */
export function sma(values, period) {
  const result = new Array(values.length).fill(null)
  for (let i = 0; i < values.length; i++) {
    const window = Math.min(period, i + 1)
    let sum = 0
    for (let j = i - window + 1; j <= i; j++) sum += values[j]
    result[i] = sum / window
  }
  return result
}

/** Exponential moving average seeded with the first value so it starts at bar 0. */
export function ema(values, period) {
  const result = new Array(values.length).fill(null)
  if (!values.length) return result
  const k = 2 / (period + 1)
  let prev = values[0]
  result[0] = prev
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    result[i] = prev
  }
  return result
}

/**
 * MACD line, signal line, and histogram.
 * Returns Plotly traces for a lower panel plus a panel title.
 */
export function computeMacd(records, params = {}) {
  const { fast = 12, slow = 26, signal = 9 } = params
  const closes = records.map(r => r.close)
  const dates = records.map(r => r.date)
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const macdLine = closes.map((_, i) => emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null)
  const macdValid = macdLine.filter(v => v != null)
  const signalFull = ema(macdValid, signal)
  const signalLine = new Array(closes.length).fill(null)
  let si = 0
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] != null) { signalLine[i] = signalFull[si] || null; si++ }
  }
  const histogram = closes.map((_, i) => macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null)
  const histColors = histogram.map(v => v != null && v >= 0 ? '#26A69A' : '#EF5350')
  return {
    mainTraces: [],
    subTraces: [
      { x: dates, y: histogram, type: 'bar', name: 'Histogram', marker: { color: histColors }, showlegend: false },
      { x: dates, y: macdLine, type: 'scatter', mode: 'lines', name: 'MACD', line: { color: '#2962FF', width: 1.5 } },
      { x: dates, y: signalLine, type: 'scatter', mode: 'lines', name: 'Signal', line: { color: '#FF6D00', width: 1.5 } },
    ],
    subTitle: `MACD (${fast},${slow},${signal})`,
  }
}

/** Wilder RSI with 70/30 guide lines. Returns Plotly traces for a lower panel. */
export function computeRsi(records, params = {}) {
  const { period = 14 } = params
  const dates = records.map(r => r.date)
  const closes = records.map(r => r.close)
  const rsi = new Array(closes.length).fill(null)
  if (closes.length < 2) return { mainTraces: [], subTraces: [], subTitle: '' }
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    if (i <= period) {
      avgGain += gain / period
      avgLoss += loss / period
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    }
  }
  return {
    mainTraces: [],
    subTraces: [
      { x: dates, y: rsi, type: 'scatter', mode: 'lines', name: `RSI ${period}`, line: { color: '#AB47BC', width: 1.5 }, showlegend: false },
      { x: [dates[0], dates[dates.length - 1]], y: [70, 70], type: 'scatter', mode: 'lines', line: { color: '#ef5350', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
      { x: [dates[0], dates[dates.length - 1]], y: [30, 30], type: 'scatter', mode: 'lines', line: { color: '#26A69A', width: 1, dash: 'dash' }, showlegend: false, hoverinfo: 'skip' },
    ],
    subTitle: `RSI (${period})`,
  }
}

/**
 * Plotly rangebreaks that close the weekend/holiday gaps on a daily series, so
 * Friday's candle sits beside Monday's the way thinkorswim draws it. Weekly and
 * monthly series are left alone — their wider cadence is intentional.
 */
export function tradingSessionRangeBreaks(dates) {
  const gapDays = dates.slice(1)
    .map((date, index) => (new Date(date) - new Date(dates[index])) / 86400000)
    .filter(gap => Number.isFinite(gap) && gap > 0)
    .sort((a, b) => a - b)
  const medianGapDays = gapDays.length ? gapDays[Math.floor(gapDays.length / 2)] : null
  const breaks = []
  if (medianGapDays == null || medianGapDays >= 4) return breaks

  breaks.push({ bounds: ['sat', 'mon'] })
  // Only daily data gets whole-day holiday breaks; intraday medians are sub-day.
  if (medianGapDays >= 0.75) {
    const key = (v) => String(v).slice(0, 10)
    const presentDates = new Set(dates.map(key))
    const firstDay = new Date(`${key(dates[0])}T00:00:00Z`)
    const lastDay = new Date(`${key(dates[dates.length - 1])}T00:00:00Z`)
    const missingWeekdays = []
    for (const day = new Date(firstDay); day <= lastDay; day.setUTCDate(day.getUTCDate() + 1)) {
      const weekday = day.getUTCDay()
      const iso = day.toISOString().slice(0, 10)
      if (weekday !== 0 && weekday !== 6 && !presentDates.has(iso)) missingWeekdays.push(iso)
    }
    if (missingWeekdays.length) breaks.push({ values: missingWeekdays, dvalue: 86400000 })
  }
  return breaks
}
