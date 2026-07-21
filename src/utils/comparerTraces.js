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
