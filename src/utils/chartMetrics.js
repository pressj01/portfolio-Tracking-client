// What the comparer charts can plot, shared by Compare ETFs, Compare Stocks and
// the Returns tab of Stock and ETF Analysis so the three menus, their axis
// titles and their exports cannot drift apart.
//
// The return-family metrics reuse the existing line modes (Total Return, Both,
// All Three, ...): the metric decides the y-axis unit and the line mode which
// traces are drawn. The dividend metrics chart a trailing-twelve-month
// dividend built from each ticker's full payment history.

import { computeBlendTrace, comparerActualCloses, selectComparerTraces } from './comparerTraces.js'

export const CHART_METRICS = [
  { value: 'total_pct', label: 'Total Return (%)', kind: 'return', unit: '%', desc: 'Dividend-reinvested total return, as a percentage change' },
  { value: 'total_value', label: 'Total Return', kind: 'dollar', unit: '$', desc: 'Dividend-adjusted share price: equals today\'s price, lower in the past by the dividends since reinvested' },
  { value: 'growth', label: 'Growth of $10K', kind: 'return', unit: '$', desc: 'What $10,000 invested at the start would be worth' },
  { value: 'price_pct', label: 'Stock Price (%)', kind: 'return', unit: '%', desc: 'Share price change only, dividends ignored' },
  { value: 'price', label: 'Stock Price', kind: 'dollar', unit: '$', desc: 'Each ticker\'s actual share price in dollars' },
  { value: 'div_ttm', label: 'Dividends (TTM)', kind: 'dividend', unit: '$', desc: 'Dividends paid per share over the trailing twelve months' },
  { value: 'div_growth', label: 'Dividend Growth', kind: 'dividend', unit: '%', desc: 'Change in the trailing-twelve-month dividend since the start of the window' },
  { value: 'div_growth_yoy', label: 'Dividend Growth (YoY)', kind: 'dividend', unit: '%', desc: 'Trailing-twelve-month dividend versus one year earlier' },
]

export const DEFAULT_CHART_METRIC = 'total_pct'
export const GROWTH_START_VALUE = 10000

// Line modes that keep their meaning under a percentage or growth metric.
// Price Only and Actual Price are metrics of their own (Stock Price (%) and
// Stock Price), so choosing them from the line bar switches the metric.
export const RETURN_LINE_MODES = ['total', 'pricediv', 'both', 'all3', 'all4']

const METRIC_BY_VALUE = new Map(CHART_METRICS.map(metric => [metric.value, metric]))

export function chartMetricInfo(metric) {
  return METRIC_BY_VALUE.get(metric) || METRIC_BY_VALUE.get(DEFAULT_CHART_METRIC)
}

export function normalizeChartMetric(metric) {
  return METRIC_BY_VALUE.has(metric) ? metric : DEFAULT_CHART_METRIC
}

export function isDividendMetric(metric) {
  return chartMetricInfo(metric).kind === 'dividend'
}

export function metricUsesLineModes(metric) {
  return metric === 'total_pct' || metric === 'growth'
}

// The return mode the existing trace code should draw for a metric.
export function returnModeForMetric(metric, lineMode = 'total') {
  if (metric === 'price_pct') return 'price'
  if (metric === 'price') return 'actual'
  if (metricUsesLineModes(metric)) return RETURN_LINE_MODES.includes(lineMode) ? lineMode : 'total'
  return 'total'
}

// A click on the line bar: Price Only / Actual Price select their metric, any
// other mode keeps a percentage or growth metric (switching to Total Return
// (%) from one where lines do not apply).
export function applyLineModeChoice(mode, metric) {
  if (mode === 'price') return { metric: 'price_pct', lineMode: null }
  if (mode === 'actual') return { metric: 'price', lineMode: null }
  return {
    metric: metricUsesLineModes(metric) ? metric : 'total_pct',
    lineMode: RETURN_LINE_MODES.includes(mode) ? mode : 'total',
  }
}

export function metricAllowsReinvest(metric, lineMode = 'total') {
  if (metric === 'total_value') return true
  if (!metricUsesLineModes(metric)) return false
  return lineMode !== 'pricediv'
}

function dayKey(value) {
  return String(value || '').slice(0, 10)
}

function dayMs(value) {
  const ms = Date.parse(`${dayKey(value)}T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

// ── Total Return ($) ─────────────────────────────────────────────────────────

// A dividend-adjusted price: the total-return line rescaled so its last point
// equals the last close. That is what "adjusted close" means — today's price,
// with history lowered by every dividend reinvested since.
export function totalReturnDollarSeries(series = {}, reinvestPct = 100, lastPrice = null) {
  const traceMap = series?.traces || {}
  const [[key, raw] = []] = selectComparerTraces(traceMap, 'total', reinvestPct)
  if (!raw?.length) return []
  const values = key === 'blend'
    ? (computeBlendTrace(traceMap.price, series.div_ratio, Number(reinvestPct) / 100) || raw)
    : raw
  const closes = comparerActualCloses(series, lastPrice)
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const trace = Number(values[i])
    const close = Number(closes[i])
    if (Number.isFinite(trace) && trace > 0 && Number.isFinite(close) && close > 0) {
      const scale = close / trace
      return values.map(value => {
        const n = Number(value)
        return Number.isFinite(n) ? n * scale : null
      })
    }
  }
  return []
}

// ── Dividends (TTM) ──────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_MS = 365 * DAY_MS

// Payment events from the dividend-history endpoint, or — when that has not
// arrived — rebuilt from the window's own per-point dividend ratio. The
// fallback only knows payments inside the window, so its early TTM is short.
export function dividendEvents(history = null, series = null) {
  const events = []
  if (history?.dates?.length) {
    history.dates.forEach((date, index) => {
      const t = dayMs(date)
      const amount = Number(history.amounts?.[index])
      if (t != null && Number.isFinite(amount) && amount > 0) events.push({ t, amount })
    })
  } else if (series?.dates?.length && series?.div_ratio?.length) {
    const closes = comparerActualCloses(series)
    series.dates.forEach((date, index) => {
      const ratio = Number(series.div_ratio[index])
      const close = Number(closes[index])
      const t = dayMs(date)
      if (t != null && ratio > 0 && close > 0) events.push({ t, amount: ratio * close })
    })
  }
  events.sort((a, b) => a.t - b.t)
  // One payment per day: Yahoo occasionally repeats an event.
  return events.filter((event, index) => index === 0 || event.t !== events[index - 1].t || event.amount !== events[index - 1].amount)
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// TTM dividend at any date. A plain "payments in the last 365 days" sum jumps
// whenever a payment lands a few days earlier or later than the year before:
// a quarterly payer briefly shows five payments (+25%) or three (−25%), which
// reads as a spike on the TTM chart and a ±25% blip in YoY growth. So each
// date sums the most recent payments up to the count the fund's own cadence
// implies (4 quarterly, 12 monthly, ...), looking back a year plus half a
// payment gap. A fund that stops paying still decays to zero.
function lastEventAtOrBefore(times, ms) {
  if (!times.length || ms < times[0]) return -1
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (times[mid] <= ms) lo = mid
    else hi = mid - 1
  }
  return lo
}

function paymentCadence(events) {
  return events.map((event, index) => {
    const gaps = []
    for (let j = index; j > 0 && events[index].t - events[j - 1].t <= 2 * YEAR_MS; j -= 1) {
      gaps.push(events[j].t - events[j - 1].t)
    }
    const gap = median(gaps.filter(value => value > 0))
    if (!gap) return { count: 1, slack: 46 * DAY_MS }
    return {
      count: Math.max(1, Math.min(52, Math.round(YEAR_MS / gap))),
      slack: Math.min(46 * DAY_MS, gap / 2),
    }
  })
}

export function makeTtmDividendEvaluator(events = []) {
  const times = events.map(event => event.t)
  const perYear = paymentCadence(events)

  return function ttmAt(ms) {
    if (!Number.isFinite(ms)) return 0
    const lo = lastEventAtOrBefore(times, ms)
    if (lo < 0) return 0
    const { count, slack } = perYear[lo]
    const floor = ms - YEAR_MS - slack
    let total = 0
    let used = 0
    for (let i = lo; i >= 0 && used < count && times[i] > floor; i -= 1) {
      total += events[i].amount
      used += 1
    }
    return total
  }
}

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null
}

// TTM dividends per share on each chart date.
export function ttmDividendSeries(dates = [], events = []) {
  const ttmAt = makeTtmDividendEvaluator(events)
  return dates.map(date => {
    const ms = dayMs(date)
    return ms == null ? null : round(ttmAt(ms))
  })
}

// Percent change of the TTM dividend from the first date at or after
// `startDate` that has one, so the visible window always starts at 0%.
export function dividendGrowthSeries(dates = [], events = [], startDate = null) {
  const ttm = ttmDividendSeries(dates, events)
  const startKey = startDate ? dayKey(startDate) : null
  const baseIndex = ttm.findIndex((value, index) => value > 0 && (!startKey || dayKey(dates[index]) >= startKey))
  if (baseIndex < 0) return dates.map(() => null)
  const base = ttm[baseIndex]
  return ttm.map((value, index) => (index < baseIndex || value == null ? null : round((value / base - 1) * 100, 4)))
}

// TTM dividend against the TTM one year earlier. "One year earlier" is the
// same point in the payment cycle — the TTM as of the payment a year's worth
// of payments back — not the calendar date 365 days ago: a payment landing a
// few days off last year's date would otherwise flash a ±25% spike for those
// days. Undefined until the fund has a full prior year of payments.
export function dividendYoYSeries(dates = [], events = []) {
  const ttmAt = makeTtmDividendEvaluator(events)
  const times = events.map(event => event.t)
  const cadence = paymentCadence(events)
  return dates.map(date => {
    const ms = dayMs(date)
    if (ms == null) return null
    const latest = lastEventAtOrBefore(times, ms)
    if (latest < 0) return null
    const { count } = cadence[latest]
    const prior = latest - count
    // The comparison TTM must itself be a full year of payments.
    if (prior < count - 1) return null
    const priorTtm = ttmAt(times[prior])
    if (!(priorTtm > 0)) return null
    return round((ttmAt(ms) / priorTtm - 1) * 100, 4)
  })
}

export function dividendMetricSeries(metric, dates = [], events = [], startDate = null) {
  if (metric === 'div_growth') return dividendGrowthSeries(dates, events, startDate)
  if (metric === 'div_growth_yoy') return dividendYoYSeries(dates, events)
  return ttmDividendSeries(dates, events)
}

// ── Export table ─────────────────────────────────────────────────────────────

// The plotted data as one table: a Date column, then a column per drawn line,
// limited to the visible window. A trace may carry `exportY` (the values in the
// metric's own unit when the axis shows something else, e.g. a log axis
// plotting growth of $100 under a percentage metric) and `exportName`.
// Guide lines (hoverinfo 'skip') and traces flagged `exportSkip` are left out.
export function chartTableFromTraces(traces = [], { start = null, end = null, unit = '' } = {}) {
  const startKey = start ? dayKey(start) : null
  const endKey = end ? dayKey(end) : null
  const columns = []
  const valuesByX = new Map()
  const usable = traces.filter(trace => (
    trace && !trace.exportSkip && trace.hoverinfo !== 'skip'
    && Array.isArray(trace.x) && trace.x.length
  ))
  usable.forEach((trace, column) => {
    const name = trace.exportName || trace.name || `Series ${column + 1}`
    columns.push(unit ? `${name} (${unit})` : name)
    const ys = Array.isArray(trace.exportY) ? trace.exportY : (trace.y || [])
    trace.x.forEach((x, index) => {
      const key = String(x ?? '')
      if (!key) return
      const day = dayKey(key)
      if ((startKey && day < startKey) || (endKey && day > endKey)) return
      const value = Number(ys[index])
      if (!valuesByX.has(key)) valuesByX.set(key, new Array(usable.length).fill(null))
      valuesByX.get(key)[column] = Number.isFinite(value) ? round(value, 4) : null
    })
  })
  const rows = [...valuesByX.keys()]
    .sort()
    .map(key => [key, ...valuesByX.get(key)])
  return { columns: ['Date', ...columns], rows }
}

function delimitedCell(value, delimiter) {
  if (value == null) return ''
  const text = String(value)
  if (delimiter === '\t') return text.replace(/[\t\r\n]+/g, ' ')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function tableToDelimited(table, delimiter = ',') {
  const lines = [table.columns, ...table.rows]
    .map(row => row.map(value => delimitedCell(value, delimiter)).join(delimiter))
  return lines.join(delimiter === '\t' ? '\n' : '\r\n')
}

export function exportFileStem(parts = []) {
  const stem = parts
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return stem || 'chart-data'
}
