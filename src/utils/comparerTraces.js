// Series identity for the ETF and stock comparers. The old seven-color list
// wrapped as soon as an eighth ticker was added, so a nine-fund comparison drew
// two blue lines and two orange ones — the chips, the swatches, and the chart
// all lied about which fund was which.
//
// These fourteen are a selected set, not hand-picked: every slot clears 3:1 on
// both the dark chart surface (#0e1117) and the light one (#ffffff), because a
// single palette has to serve both themes and the ticker chips sit on white in
// either. Verified with the data-viz validator in both modes — worst adjacent
// pair ΔE 11.3 under deuteranopia (target 8), 21.6 unsimulated (floor 15), and
// every one of the 91 pairs stays at or above 15.1 unsimulated, so no two lines
// on screen collapse together for a full-color reader. Past six series no
// fourteen-color set can stay dichromat-safe; identity there leans on the
// legend, the end labels, and the swatch column, which is why those stay on.
export const COMPARER_SERIES_COLORS = [
  '#0059f9', // blue
  '#ef6100', // orange
  '#00a1c0', // cyan
  '#12a100', // green
  '#ff308e', // pink
  '#8e551f', // brown
  '#8182ff', // periwinkle
  '#b50097', // magenta
  '#007245', // forest
  '#d34df0', // orchid
  '#a79433', // olive
  '#8732e1', // violet
  '#cc0034', // crimson
  '#006c9f', // deep teal
]

function mixHex(hex, toward, amount) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex))
  if (!match) return hex
  const src = parseInt(match[1], 16)
  const dst = parseInt(String(toward).replace('#', ''), 16)
  const t = Math.max(0, Math.min(1, amount))
  const chan = shift => {
    const a = (src >> shift) & 255
    const b = (dst >> shift) & 255
    return Math.round(a + (b - a) * t)
  }
  return `#${((chan(16) << 16) | (chan(8) << 8) | chan(0)).toString(16).padStart(6, '0')}`
}

// Beyond the fourteenth ticker the palette has to repeat, so shift the lap's
// lightness instead of handing back a pixel-identical color: a 15th fund reads
// as a lighter blue next to the 1st, not as the same line twice. Odd laps
// lighten (they land on the dark chart), even laps darken.
export function comparerSeriesColor(index) {
  const n = COMPARER_SERIES_COLORS.length
  const i = Number.isFinite(Number(index)) && Number(index) >= 0 ? Math.floor(Number(index)) : 0
  const base = COMPARER_SERIES_COLORS[i % n]
  const lap = Math.floor(i / n)
  if (lap === 0) return base
  return lap % 2 ? mixHex(base, '#ffffff', 0.42) : mixHex(base, '#0b0f18', 0.38)
}

// In Total Return / Both, a partial reinvest is drawn as a solid line just
// like full DRIP, but tinted so it still reads as a variant of the fund's own
// line. The tint lifts the fund color toward white in proportion to how far
// below 100% the reinvest sits — full DRIP is unchanged, lower % is lighter.
export function shiftColorForReinvest(hex, reinvestPct = 100) {
  const pct = Number(reinvestPct)
  if (!Number.isFinite(pct) || pct >= 100) return hex
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex))
  if (!match) return hex
  const int = parseInt(match[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  const t = Math.max(0, Math.min(1, (100 - pct) / 100)) * 0.4
  const mix = c => Math.round(c + (255 - c) * t)
  const out = (mix(r) << 16) | (mix(g) << 8) | mix(b)
  return `#${out.toString(16).padStart(6, '0')}`
}

// Rebuild the blended reinvestment line for an arbitrary reinvest fraction from
// the normalized price trace and the per-point dividend/price ratio the backend
// ships alongside it. This is an exact reproduction of the server's
// _blend_price_drip walk, so moving the Reinvest slider is a local recompute
// (no refetch, no chart blink) instead of another market-data round-trip.
export function computeBlendTrace(priceTrace = [], divRatio = [], frac = 1) {
  const f = Math.max(0, Math.min(1, Number(frac)))
  if (!Array.isArray(priceTrace) || !priceTrace.length || !Array.isArray(divRatio) || !divRatio.length) {
    return null
  }
  let shares = 1
  let cash = 0
  const out = new Array(priceTrace.length)
  for (let i = 0; i < priceTrace.length; i += 1) {
    const p = Number(priceTrace[i])
    const y = Number(divRatio[i]) || 0
    if (y > 0 && Number.isFinite(p)) {
      cash += y * p * shares * (1 - f)
      shares += y * shares * f
    }
    out[i] = Number((shares * p + cash).toFixed(4))
  }
  return out
}

// The comparer fetches one complete trace bundle so switching return modes is
// a local display operation instead of another market-data request.
export function selectComparerTraces(traceMap = {}, mode = 'total', reinvestPct = 100) {
  const total = traceMap.total ?? traceMap.drip
  const entries = {
    price: traceMap.price,
    pricediv: traceMap.pricediv,
    blend: traceMap.blend,
    drip: traceMap.drip ?? traceMap.total,
    total,
  }

  // A partial reinvest % points the Total Return line at the blended trace,
  // so Total Return/Both honor the slider instead of always assuming full DRIP.
  const totalKey = Number(reinvestPct) < 100 && entries.blend != null ? 'blend' : 'total'

  const keysByMode = {
    total: [totalKey],
    price: ['price'],
    pricediv: ['pricediv'],
    both: [totalKey, 'price'],
    all3: ['price', 'blend', 'drip'],
    all4: ['price', 'pricediv', 'blend', 'drip'],
  }
  const keys = keysByMode[mode] || keysByMode.total
  const selected = keys
    .filter(key => entries[key] != null)
    .map(key => [key, entries[key]])

  // Be tolerant of an older backend during a development hot reload.
  return selected.length ? selected : Object.entries(traceMap)
}

// Keep comparer headings aligned with the traces selected by each return mode.
// This is shared by the ETF and stock comparers so their chart and axis titles
// cannot drift apart when modes are added or renamed.
export function comparerReturnModeLabel(mode = 'total') {
  const labels = {
    total: 'Total Return',
    price: 'Price Only',
    pricediv: 'Price + Dividends',
    both: 'Total Return & Price Only',
    all3: 'Price Only, Reinvested & Total Return',
    all4: 'Price Only, Price + Dividends, Reinvested & Total Return',
  }
  return labels[mode] || labels.total
}

export function shouldUseComparerLogScale(
  seriesBySymbol = {},
  symbols = Object.keys(seriesBySymbol),
  mode = 'total',
  visibleStart = null,
  visibleEnd = null,
  reinvestPct = 100,
  ratioThreshold = 50,
) {
  let minWealth = Infinity
  let maxWealth = -Infinity
  let found = false

  symbols.forEach(sym => {
    const series = seriesBySymbol[sym]
    const dates = series?.dates || []
    selectComparerTraces(series?.traces || {}, mode, reinvestPct).forEach(([, values]) => {
      let baseIdx = -1
      for (let i = 0; i < values.length; i += 1) {
        const day = String(dates[i] || '').slice(0, 10)
        if (visibleStart && day < visibleStart) continue
        if (visibleEnd && day > visibleEnd) break
        const value = Number(values[i])
        if (Number.isFinite(value) && value > 0) {
          baseIdx = i
          break
        }
      }
      if (baseIdx < 0) return
      const base = Number(values[baseIdx])
      for (let i = baseIdx; i < values.length; i += 1) {
        const day = String(dates[i] || '').slice(0, 10)
        if (visibleEnd && day > visibleEnd) break
        const value = Number(values[i])
        const wealth = value / base * 100
        if (!Number.isFinite(wealth) || wealth <= 0) continue
        found = true
        minWealth = Math.min(minWealth, wealth)
        maxWealth = Math.max(maxWealth, wealth)
      }
    })
  })

  return found && minWealth > 0 && maxWealth / minWealth >= ratioThreshold
}

function fixedGrouped(value, signed = false) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  const [integer, fraction] = Math.abs(number).toFixed(2).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = number < 0 ? '-' : (signed ? '+' : '')
  return `${sign}${grouped}.${fraction}`
}

// Plotly can expose raw floating-point precision from customdata in unified
// hover on a logarithmic axis. Preformat the two displayed values so the ETF
// comparer, stock comparer, and Stock and ETF Analysis page stay consistent
// with the two-decimal linear hover.
export function comparerLogHoverData(returnValues = [], normalizedValues = []) {
  return returnValues.map((returnValue, index) => [
    `${fixedGrouped(returnValue, true)}%`,
    fixedGrouped(normalizedValues[index]),
  ])
}

// Plotly annotations use axis-range coordinates rather than trace-data
// coordinates. Those are identical on a linear axis, but a log axis expects
// log10(value). Passing the raw growth value (for example 77 instead of 1.89)
// positions the end label far outside the plot and makes it appear missing.
export function comparerEndLabelAxisY(value, logScaleActive = false) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return logScaleActive
    ? Math.log10(Math.max(number, Number.MIN_VALUE))
    : number
}

function rounded(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null
}

export function comparerStatsForMode(series = {}, fallback = {}, mode = 'total', reinvestPct = 100) {
  const traceMap = series.traces || {}
  // The multi-line modes historically report the blended return as their
  // headline statistic even though the price line is drawn first. A partial
  // reinvest % moves the Total Return headline onto the blended trace too.
  const totalStatsKey = Number(reinvestPct) < 100 && traceMap.blend != null
    ? 'blend'
    : (traceMap.total != null ? 'total' : 'drip')
  const statsKeyByMode = {
    total: totalStatsKey,
    price: 'price',
    pricediv: 'pricediv',
    both: totalStatsKey,
    all3: 'blend',
    all4: 'blend',
  }
  const statsKey = statsKeyByMode[mode]
  const selectedValues = traceMap[statsKey]
    || selectComparerTraces(traceMap, mode, reinvestPct)[0]?.[1]
    || []
  const priceValues = traceMap.price || []
  const traceReturn = values => {
    const first = Number(values[0])
    const last = Number(values[values.length - 1])
    return Number.isFinite(first) && first > 0 && Number.isFinite(last)
      ? (last / first - 1) * 100
      : null
  }

  const totalRet = traceReturn(selectedValues)
  const priceRet = traceReturn(priceValues)
  let runningMax = -Infinity
  let maxDrawdown = null
  selectedValues.forEach(raw => {
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return
    runningMax = Math.max(runningMax, value)
    const drawdown = (value / runningMax - 1) * 100
    maxDrawdown = maxDrawdown == null ? drawdown : Math.min(maxDrawdown, drawdown)
  })

  const dates = series.dates || []
  const startMs = Date.parse(dates[0])
  const endMs = Date.parse(dates[dates.length - 1])
  const days = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? (endMs - startMs) / (24 * 60 * 60 * 1000)
    : 0
  const years = days / 365.25
  const annualized = totalRet != null && totalRet > -100 && days > 30 && years > 0
    ? ((1 + totalRet / 100) ** (1 / years) - 1) * 100
    : null

  const resolvedTotal = totalRet ?? fallback.total_ret ?? null
  const resolvedPrice = priceRet ?? fallback.price_ret ?? null
  return {
    ...fallback,
    total_ret: rounded(resolvedTotal),
    price_ret: rounded(resolvedPrice),
    div_contrib: rounded(
      resolvedTotal != null && resolvedPrice != null
        ? resolvedTotal - resolvedPrice
        : fallback.div_contrib,
    ),
    annualized: rounded(annualized ?? fallback.annualized),
    max_drawdown: rounded(maxDrawdown ?? fallback.max_drawdown),
  }
}
