// Price-level overlays for the Stock and ETF Analysis chart:
//   • percent levels — fixed % moves up/down from a reference price
//   • support / resistance — horizontal levels derived from clustered swing pivots

export const PERCENT_LEVEL_OPTIONS = [
  { key: 'u20', pct: 20, color: '#29B6F6' },
  { key: 'u10', pct: 10, color: '#4DD0E1' },
  { key: 'u5', pct: 5, color: '#80DEEA' },
  { key: 'd5', pct: -5, color: '#FFEE58' },
  { key: 'd10', pct: -10, color: '#FFCA28' },
  { key: 'd20', pct: -20, color: '#FFA726' },
  { key: 'd25', pct: -25, color: '#FF7043' },
  { key: 'd40', pct: -40, color: '#F4511E' },
  { key: 'd50', pct: -50, color: '#E040FB' },
]

export const DEFAULT_PERCENT_LEVEL_KEYS = ['u20', 'u10', 'u5', 'd5', 'd10', 'd20']

export const PERCENT_LEVEL_BASES = [
  { value: 'close', label: 'Last close' },
  { value: 'high', label: 'Period high' },
]

export const SUPPORT_COLOR = '#26A69A'
export const RESISTANCE_COLOR = '#EF5350'
export const MAX_SR_PER_SIDE = 5

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const SR_LABEL = /^[SR][1-5]$/

/** Color for an S/R line: the user's pick for that label (S1, R2…), else the side's default. */
export function srLevelColor(label, colors) {
  const custom = colors?.[label]
  if (typeof custom === 'string' && HEX_COLOR.test(custom)) return custom
  return String(label).startsWith('R') ? RESISTANCE_COLOR : SUPPORT_COLOR
}

function sanitizeColorMap(saved, isValidKey) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  const out = {}
  Object.entries(saved).forEach(([key, color]) => {
    if (isValidKey(key) && typeof color === 'string' && HEX_COLOR.test(color)) out[key] = color
  })
  return out
}

/** Keep only S1…S5 / R1…R5 entries holding a #rrggbb color from a saved color map. */
export function sanitizeSrColors(saved) {
  return sanitizeColorMap(saved, key => SR_LABEL.test(key))
}

// Which side(s) of the last close the S/R overlay draws.
export const SR_SIDE_OPTIONS = [
  { value: 'both', label: 'Both' },
  { value: 'support', label: 'Support only' },
  { value: 'resistance', label: 'Resistance only' },
]

/** A saved S/R side choice, or 'both' when it is missing or unknown. */
export function normalizeSrSides(value) {
  return SR_SIDE_OPTIONS.some(o => o.value === value) ? value : 'both'
}

/** Detected S/R levels with the side the user hid emptied out (null stays null). */
export function srLevelsForSides(levels, sides) {
  if (!levels) return null
  const show = normalizeSrSides(sides)
  return {
    ...levels,
    support: show === 'resistance' ? [] : levels.support,
    resistance: show === 'support' ? [] : levels.resistance,
  }
}

/**
 * The S/R labels the menu offers colors for, top of the chart to bottom:
 * R{n}…R1 above price, then S1…S{n} below it — only the side(s) being shown.
 */
export function srColorLabels(perSide, sides = 'both') {
  const n = Number.isInteger(perSide) ? Math.min(MAX_SR_PER_SIDE, Math.max(1, perSide)) : 3
  const show = normalizeSrSides(sides)
  const idx = Array.from({ length: n }, (_, i) => i + 1)
  return [
    ...(show === 'support' ? [] : idx.slice().reverse().map(i => `R${i}`)),
    ...(show === 'resistance' ? [] : idx.map(i => `S${i}`)),
  ]
}

/** Percent move from the last close to a level: negative below it, positive above. */
export function levelDistancePct(price, lastClose) {
  if (!finite(price) || !finite(lastClose) || lastClose <= 0) return null
  return (price / lastClose - 1) * 100
}

/** "-1.45% from close" / "+3.20% from close" / "At close" for an S/R label. */
export function levelDistanceLabel(pct) {
  if (!finite(pct)) return ''
  if (Math.abs(pct) < 0.005) return 'At close'
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}% from close`
}

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

/**
 * Levels for the selected keys, ordered from highest price to lowest. `colors` maps
 * an option key to the user's color for it; keys without one keep their default.
 */
export function percentLevels(basePrice, keys, colors) {
  if (!finite(basePrice) || basePrice <= 0) return []
  const selected = new Set(keys || [])
  return PERCENT_LEVEL_OPTIONS
    .filter(opt => selected.has(opt.key))
    .map(opt => ({ ...opt, color: percentLevelColor(opt.key, colors), price: basePrice * (1 + opt.pct / 100) }))
    .sort((a, b) => b.price - a.price)
}

/** Color for a percent level: the user's pick for that key (u20, d5…), else its default. */
export function percentLevelColor(key, colors) {
  const custom = colors?.[key]
  if (typeof custom === 'string' && HEX_COLOR.test(custom)) return custom
  return PERCENT_LEVEL_OPTIONS.find(o => o.key === key)?.color ?? '#9E9E9E'
}

/** Keep only known percent-level keys holding a #rrggbb color from a saved color map. */
export function sanitizePercentLevelColors(saved) {
  return sanitizeColorMap(saved, key => PERCENT_LEVEL_OPTIONS.some(o => o.key === key))
}

export function percentLevelLabel(pct) {
  return `${pct > 0 ? '+' : ''}${pct}%`
}

export const OFF_HIGH_COLOR = '#B388FF'

/**
 * How far the last close sits below the highest close in the loaded period —
 * closes only, so an intraday spike that didn't hold isn't the yardstick.
 * Returns { high, highIndex, highDate, close, closeIndex, closeDate, pct } where
 * `high` is that highest close and pct <= 0 (e.g. -8.1 for 8.1% below it), or null
 * without usable bars.
 */
export function drawdownFromHigh(records) {
  if (!Array.isArray(records) || !records.length) return null
  let hi = -1
  let last = -1
  records.forEach((r, i) => {
    if (!finite(r?.close)) return
    if (hi < 0 || r.close > records[hi].close) hi = i
    last = i
  })
  if (hi < 0 || records[hi].close <= 0) return null
  const high = records[hi].close
  const close = records[last].close
  return {
    high,
    highIndex: hi,
    highDate: records[hi].date ?? null,
    close,
    closeIndex: last,
    closeDate: records[last].date ?? null,
    pct: Math.min(0, (close / high - 1) * 100),
  }
}

/** "-8.1% from highest close" / "At highest close" for the off-high label. */
export function drawdownLabel(pct) {
  if (!finite(pct)) return ''
  return pct > -0.05 ? 'At highest close' : `${pct.toFixed(1)}% from highest close`
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

const usableRows = (records) => (Array.isArray(records) ? records : [])
  .filter(r => finite(r?.high) && finite(r?.low) && finite(r?.close))

/** Swing pivots plus the period's extreme high / low, clustered and scored. */
function scoredClusters(rows, tolerance, pivotWindow) {
  const n = rows.length
  const window = pivotWindow ?? clamp(Math.round(n / 40), 2, 8)
  const pivots = findPivots(rows, window)

  // The period's extreme high / low always matter, even when they fall inside the
  // unconfirmed window at either edge of the data — except an extreme in the last few
  // bars that price is still sitting on. That's the move in progress (today's low on a
  // breakdown, today's high on a breakout), not a level anything has bounced off yet.
  let hiIdx = 0
  let loIdx = 0
  rows.forEach((r, i) => {
    if (r.high > rows[hiIdx].high) hiIdx = i
    if (r.low < rows[loIdx].low) loIdx = i
  })
  const lastClose = rows[n - 1].close
  const inProgress = (i, price) => i >= n - window && Math.abs(price - lastClose) <= tolerance
  if (!inProgress(hiIdx, rows[hiIdx].high) && !pivots.some(p => Math.abs(p.price - rows[hiIdx].high) <= tolerance)) {
    pivots.push({ index: hiIdx, price: rows[hiIdx].high, kind: 'high' })
  }
  if (!inProgress(loIdx, rows[loIdx].low) && !pivots.some(p => Math.abs(p.price - rows[loIdx].low) <= tolerance)) {
    pivots.push({ index: loIdx, price: rows[loIdx].low, kind: 'low' })
  }

  return clusterPivots(pivots, tolerance).map(c => ({
    ...c,
    lastDate: rows[c.lastIndex]?.date ?? null,
    // More touches = stronger; recent touches matter more than old ones.
    score: c.touches + 1.5 * (c.lastIndex / Math.max(1, n - 1)),
  }))
}

/**
 * Which way price came into a level: true if the most recent close that sat clearly
 * away from it (more than `tolerance`) was above it, false if below, null if price
 * never left the level.
 */
export function approachedFromAbove(rows, price, tolerance) {
  for (let i = rows.length - 2; i >= 0; i -= 1) {
    const c = rows[i]?.close
    if (finite(c) && Math.abs(c - price) > tolerance) return c > price
  }
  return null
}

/**
 * Detect support and resistance levels relative to the last close.
 * Returns { support, resistance, lastClose, tolerance } where each level is
 * { label, price, low, high, touches, lastIndex, lastDate, score, testing, fromHistory,
 * pctFromClose }, nearest-to-price first.
 *
 * A level within `tolerance` of the last close is one price is testing right now: it
 * counts as support when price came down into it and resistance when price rose into
 * it, even if the close sits a hair on the other side.
 *
 * `options.history` is a longer run of bars for the same symbol and bar size. When the
 * loaded period has fewer than `maxPerSide` levels on a side — e.g. price has broken to
 * a new period low, so nothing in the period sits below it — that side is topped up
 * with levels from the longer history (marked `fromHistory`).
 */
export function findSupportResistance(records, options = {}) {
  const empty = { support: [], resistance: [], lastClose: null, tolerance: 0 }
  const rows = usableRows(records)
  const n = rows.length
  if (n < 10) return empty

  const maxPerSide = Math.max(1, options.maxPerSide ?? 3)
  const lastClose = rows[n - 1].close
  const atr = averageTrueRange(rows, 14)
  const tolerance = options.tolerance ?? Math.max(atr * 0.6, lastClose * 0.004)
  const minSeparation = tolerance * 2

  const classify = (c) => {
    if (Math.abs(c.price - lastClose) <= tolerance) {
      const fromAbove = approachedFromAbove(rows, c.price, tolerance)
      if (fromAbove !== null) return { ...c, side: fromAbove ? 'support' : 'resistance', testing: true }
    }
    return { ...c, side: c.price <= lastClose ? 'support' : 'resistance', testing: false }
  }

  // Strongest levels first, skipping any that crowd a stronger level already chosen.
  const fill = (chosen, candidates) => {
    for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
      if (chosen.length >= maxPerSide) break
      if (chosen.some(k => Math.abs(k.price - c.price) < minSeparation)) continue
      chosen.push(c)
    }
    return chosen
  }

  const clusters = scoredClusters(rows, tolerance, options.pivotWindow)
    .map(c => classify({ ...c, fromHistory: false }))
  const chosen = {
    support: fill([], clusters.filter(c => c.side === 'support')),
    resistance: fill([], clusters.filter(c => c.side === 'resistance')),
  }

  const historyRows = usableRows(options.history)
  const short = ['support', 'resistance'].filter(side => chosen[side].length < maxPerSide)
  if (short.length && historyRows.length > n) {
    // Only reach as far from price as the loaded period's own high-low range, so a
    // level from years ago can't flatten the candles.
    let periodHigh = -Infinity
    let periodLow = Infinity
    rows.forEach(r => { periodHigh = Math.max(periodHigh, r.high); periodLow = Math.min(periodLow, r.low) })
    const reach = Math.max(periodHigh - periodLow, tolerance * 4)
    const older = scoredClusters(historyRows, tolerance)
      .filter(c => Math.abs(c.price - lastClose) <= reach)
      .map(c => classify({ ...c, fromHistory: true }))
    short.forEach(side => fill(chosen[side], older.filter(c => c.side === side)))
  }

  // pctFromClose: how far price has to move from the last close to reach the level.
  const support = chosen.support.sort((a, b) => b.price - a.price)
    .map((c, i) => ({ ...c, label: `S${i + 1}`, pctFromClose: levelDistancePct(c.price, lastClose) }))
  const resistance = chosen.resistance.sort((a, b) => a.price - b.price)
    .map((c, i) => ({ ...c, label: `R${i + 1}`, pctFromClose: levelDistancePct(c.price, lastClose) }))

  return { support, resistance, lastClose, tolerance }
}

// Longer history the support / resistance detector can fall back on, by loaded
// period. Intraday 1-minute bars only go back about a week, so 5 Day / 1min has none.
const SR_HISTORY_PERIOD = {
  '1d': '5d', '5d': '1mo',
  '1mo': '6mo', '3mo': '1y', '6mo': '2y', '9mo': '2y', ytd: '2y',
  '1y': '5y', '2y': '5y', '5y': '10y', '10y': 'max',
}

/** The longer period to fetch for support / resistance history, or null if none. */
export function srHistoryPeriod(period, interval) {
  if (period === '5d' && interval === '1m') return null
  return SR_HISTORY_PERIOD[period] ?? null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Feb 11, 2026" for a bar date, "Nov 17 10:30" for an intraday bar. */
export function levelDateLabel(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(date ?? ''))
  if (!m) return ''
  const [, y, mo, d, time] = m
  const head = `${MONTHS[Number(mo) - 1]} ${Number(d)}`
  return time ? `${head} ${time}` : `${head}, ${y}`
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
