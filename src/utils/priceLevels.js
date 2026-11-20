// Price-level overlays for the Stock and ETF Analysis chart:
//   • percent levels — fixed % moves up/down from a reference price
//   • support / resistance — horizontal levels derived from clustered swing pivots

export const PERCENT_LEVEL_OPTIONS = [
  { key: 'u20', pct: 20, color: '#29B6F6' },
  { key: 'u10', pct: 10, color: '#4DD0E1' },
  { key: 'd10', pct: -10, color: '#FFCA28' },
  { key: 'd20', pct: -20, color: '#FFA726' },
  { key: 'd25', pct: -25, color: '#FF7043' },
  { key: 'd40', pct: -40, color: '#F4511E' },
  { key: 'd50', pct: -50, color: '#E040FB' },
]

export const DEFAULT_PERCENT_LEVEL_KEYS = ['u20', 'u10', 'd10', 'd20']

export const PERCENT_LEVEL_BASES = [
  { value: 'close', label: 'Last close' },
  { value: 'high', label: 'Period high' },
]

export const SUPPORT_COLOR = '#26A69A'
export const RESISTANCE_COLOR = '#EF5350'

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** Reference price for percent levels: last close, or the highest high in the loaded period. */
export function percentLevelBase(records, base = 'close') {
  if (!Array.isArray(records) || !records.length) return null
  if (base === 'high') {
    let max = -Infinity
    for (const r of records) if (finite(r?.high) && r.high > max) max = r.high
    return Number.isFinite(max) ? max : null
  }
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (finite(records[i]?.close)) return records[i].close
  }
  return null
}

/** Levels for the selected keys, ordered from highest price to lowest. */
export function percentLevels(basePrice, keys) {
  if (!finite(basePrice) || basePrice <= 0) return []
  const selected = new Set(keys || [])
  return PERCENT_LEVEL_OPTIONS
    .filter(opt => selected.has(opt.key))
    .map(opt => ({ ...opt, price: basePrice * (1 + opt.pct / 100) }))
    .sort((a, b) => b.price - a.price)
}

export function percentLevelLabel(pct) {
  return `${pct > 0 ? '+' : ''}${pct}%`
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Average true range over the last `period` bars (falls back to high-low). */
export function averageTrueRange(records, period = 14) {
  const n = records.length
  if (!n) return 0
  const start = Math.max(1, n - period)
  let sum = 0
  let count = 0
  for (let i = start; i < n; i += 1) {
    const { high, low } = records[i]
    const prevClose = records[i - 1]?.close
    if (!finite(high) || !finite(low)) continue
    const tr = finite(prevClose)
      ? Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
      : high - low
    sum += tr
    count += 1
  }
  if (!count && finite(records[0]?.high) && finite(records[0]?.low)) return records[0].high - records[0].low
  return count ? sum / count : 0
}

/** Swing highs / lows: a bar whose high (low) is the extreme of the `window` bars on each side. */
export function findPivots(records, window) {
  const pivots = []
  const n = records.length
  for (let i = window; i < n - window; i += 1) {
    const h = records[i].high
    const l = records[i].low
    if (finite(h)) {
      let isHigh = true
      for (let j = i - window; j <= i + window && isHigh; j += 1) {
        if (j === i) continue
        const other = records[j].high
        // Strictly greater than bars to the left, >= bars to the right: a flat top counts once.
        if (finite(other) && (j < i ? other >= h : other > h)) isHigh = false
      }
      if (isHigh) pivots.push({ index: i, price: h, kind: 'high' })
    }
    if (finite(l)) {
      let isLow = true
      for (let j = i - window; j <= i + window && isLow; j += 1) {
        if (j === i) continue
        const other = records[j].low
        if (finite(other) && (j < i ? other <= l : other < l)) isLow = false
      }
      if (isLow) pivots.push({ index: i, price: l, kind: 'low' })
    }
  }
  return pivots
}

/** Group pivots whose prices sit within `tolerance` of the running cluster average. */
export function clusterPivots(pivots, tolerance) {
  const sorted = [...pivots].sort((a, b) => a.price - b.price)
  const clusters = []
  let current = null
  for (const p of sorted) {
    if (current && p.price - current.mean <= tolerance) {
      current.members.push(p)
      current.mean = current.members.reduce((s, m) => s + m.price, 0) / current.members.length
    } else {
      current = { members: [p], mean: p.price }
      clusters.push(current)
    }
  }
  return clusters.map(c => {
    const prices = c.members.map(m => m.price)
    return {
      price: c.mean,
      low: Math.min(...prices),
      high: Math.max(...prices),
      touches: c.members.length,
      lastIndex: Math.max(...c.members.map(m => m.index)),
      highs: c.members.filter(m => m.kind === 'high').length,
      lows: c.members.filter(m => m.kind === 'low').length,
    }
  })
}

/**
 * Detect support and resistance levels relative to the last close.
 * Returns { support, resistance, lastClose, tolerance } where each level is
 * { label, price, low, high, touches, lastIndex, score }, nearest-to-price first.
 */
export function findSupportResistance(records, options = {}) {
  const empty = { support: [], resistance: [], lastClose: null, tolerance: 0 }
  const rows = (Array.isArray(records) ? records : []).filter(r => finite(r?.high) && finite(r?.low) && finite(r?.close))
  const n = rows.length
  if (n < 10) return empty

  const maxPerSide = Math.max(1, options.maxPerSide ?? 3)
  const window = options.pivotWindow ?? clamp(Math.round(n / 40), 2, 8)
  const lastClose = rows[n - 1].close
  const atr = averageTrueRange(rows, 14)
  const tolerance = options.tolerance ?? Math.max(atr * 0.6, lastClose * 0.004)

  const pivots = findPivots(rows, window)

  // The period's extreme high / low always matter, even when they fall inside the
  // unconfirmed window at either edge of the data.
  let hiIdx = 0
  let loIdx = 0
  rows.forEach((r, i) => {
    if (r.high > rows[hiIdx].high) hiIdx = i
    if (r.low < rows[loIdx].low) loIdx = i
  })
  if (!pivots.some(p => Math.abs(p.price - rows[hiIdx].high) <= tolerance)) {
    pivots.push({ index: hiIdx, price: rows[hiIdx].high, kind: 'high' })
  }
  if (!pivots.some(p => Math.abs(p.price - rows[loIdx].low) <= tolerance)) {
    pivots.push({ index: loIdx, price: rows[loIdx].low, kind: 'low' })
  }

  const clusters = clusterPivots(pivots, tolerance).map(c => ({
    ...c,
    // More touches = stronger; recent touches matter more than old ones.
    score: c.touches + 1.5 * (c.lastIndex / Math.max(1, n - 1)),
  }))

  // Strongest levels first, skipping any that crowd a stronger level already chosen.
  const minSeparation = tolerance * 2
  const pick = (list, nearestFirst) => {
    const chosen = []
    for (const c of [...list].sort((a, b) => b.score - a.score)) {
      if (chosen.length >= maxPerSide) break
      if (chosen.some(k => Math.abs(k.price - c.price) < minSeparation)) continue
      chosen.push(c)
    }
    return chosen.sort(nearestFirst)
  }

  const support = pick(clusters.filter(c => c.price <= lastClose), (a, b) => b.price - a.price)
    .map((c, i) => ({ ...c, label: `S${i + 1}` }))
  const resistance = pick(clusters.filter(c => c.price > lastClose), (a, b) => a.price - b.price)
    .map((c, i) => ({ ...c, label: `R${i + 1}` }))

  return { support, resistance, lastClose, tolerance }
}

/**
 * Spread label positions so no two are closer than `gap` (same units as the values),
 * keeping them at or below `max` where possible. Returns positions in input order.
 */
export function spreadLabelPositions(values, gap, max = Infinity) {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = order.map(o => o.v)
  for (let k = 1; k < out.length; k += 1) out[k] = Math.max(out[k], out[k - 1] + gap)
  const overflow = out.length ? out[out.length - 1] - max : 0
  if (overflow > 0) {
    out[out.length - 1] -= overflow
    for (let k = out.length - 2; k >= 0; k -= 1) out[k] = Math.min(out[k], out[k + 1] - gap)
  }
  const result = new Array(values.length)
  order.forEach((o, k) => { result[o.i] = out[k] })
  return result
}
