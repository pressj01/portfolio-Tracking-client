// The comparer fetches one complete trace bundle so switching return modes is
// a local display operation instead of another market-data request.
export function selectComparerTraces(traceMap = {}, mode = 'total') {
  const total = traceMap.total ?? traceMap.drip
  const entries = {
    price: traceMap.price,
    pricediv: traceMap.pricediv,
    blend: traceMap.blend,
    drip: traceMap.drip ?? traceMap.total,
    total,
  }

  const keysByMode = {
    total: ['total'],
    price: ['price'],
    pricediv: ['pricediv'],
    both: ['total', 'price'],
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
  ratioThreshold = 50,
) {
  let minWealth = Infinity
  let maxWealth = -Infinity
  let found = false

  symbols.forEach(sym => {
    const series = seriesBySymbol[sym]
    const dates = series?.dates || []
    selectComparerTraces(series?.traces || {}, mode).forEach(([, values]) => {
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

export function comparerStatsForMode(series = {}, fallback = {}, mode = 'total') {
  const traceMap = series.traces || {}
  // The multi-line modes historically report the blended return as their
  // headline statistic even though the price line is drawn first.
  const statsKeyByMode = {
    total: traceMap.total != null ? 'total' : 'drip',
    price: 'price',
    pricediv: 'pricediv',
    both: traceMap.total != null ? 'total' : 'drip',
    all3: 'blend',
    all4: 'blend',
  }
  const statsKey = statsKeyByMode[mode]
  const selectedValues = traceMap[statsKey]
    || selectComparerTraces(traceMap, mode)[0]?.[1]
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
