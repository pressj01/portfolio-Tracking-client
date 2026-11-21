// Candlestick-pattern finders for the Stock and ETF Analysis chart. Each finder reads
// the loaded OHLC bars (oldest first) and returns the patterns it sees, in bar indexes,
// for the chart to mark. The shapes follow the usual textbook descriptions (IG's
// "16 candlestick patterns every trader should know" and Thomas Bulkowski's
// thepatternsite.com). "Long" and "small" candles are measured against the ticker's
// own typical candle (the median body and median high-low range of the loaded bars,
// in percent), so the same rules work at any price and on any bar size.
//
// Odds: every pattern carries the share of tests in which it played out the way it
// points, from Bulkowski's published results, blended with how that pattern did
// earlier in the loaded bars. "Played out" uses Bulkowski's own test: after the
// pattern, price closes above the pattern's top (bullish) before it closes below its
// bottom (bearish). These are past results, not forecasts.

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

export const CANDLE_BULLISH_COLOR = '#00E676'
export const CANDLE_BEARISH_COLOR = '#FF5252'
const CANDLE_BULLISH_FILL = 'rgba(0, 230, 118, 0.13)'
const CANDLE_BEARISH_FILL = 'rgba(255, 82, 82, 0.13)'

// `published`: the percent of Bulkowski's tests in which price broke out the way the
// pattern points. For several patterns that is under 50%: his tests found they more
// often went the other way, which `study` (his wording) says.
export const CANDLE_PATTERN_TYPES = [
  { key: 'hammer', label: 'Hammer', code: 'H', bias: 'bullish', signal: 'Bullish reversal', bars: 1, published: 60, study: 'Bullish reversal 60% of the time' },
  { key: 'inv_hammer', label: 'Inverted Hammer', code: 'IH', bias: 'bullish', signal: 'Bullish reversal', bars: 1, published: 35, study: 'Bearish continuation 65% of the time' },
  { key: 'bull_engulfing', label: 'Bullish Engulfing', code: 'BE', bias: 'bullish', signal: 'Bullish reversal', bars: 2, published: 63, study: 'Bullish reversal 63% of the time' },
  { key: 'piercing', label: 'Piercing Line', code: 'PL', bias: 'bullish', signal: 'Bullish reversal', bars: 2, published: 64, study: 'Bullish reversal 64% of the time' },
  { key: 'morning_star', label: 'Morning Star', code: 'MS', bias: 'bullish', signal: 'Bullish reversal', bars: 3, published: 78, study: 'Bullish reversal 78% of the time' },
  { key: 'three_soldiers', label: 'Three White Soldiers', code: '3WS', bias: 'bullish', signal: 'Bullish reversal', bars: 3, published: 82, study: 'Bullish reversal 82% of the time' },
  { key: 'tweezer_bottom', label: 'Tweezer Bottom', code: 'TB', bias: 'bullish', signal: 'Bullish reversal', bars: 2, published: 48, study: 'Bearish continuation 52% of the time' },
  { key: 'bull_harami', label: 'Bullish Harami', code: 'BH', bias: 'bullish', signal: 'Bullish reversal', bars: 2, published: 53, study: 'Bullish reversal 53% of the time' },
  { key: 'rising_three', label: 'Rising Three Methods', code: 'R3M', bias: 'bullish', signal: 'Bullish continuation', bars: 5, published: 74, study: 'Bullish continuation 74% of the time' },
  { key: 'hanging_man', label: 'Hanging Man', code: 'HM', bias: 'bearish', signal: 'Bearish reversal', bars: 1, published: 41, study: 'Bullish continuation 59% of the time' },
  { key: 'shooting_star', label: 'Shooting Star', code: 'SS', bias: 'bearish', signal: 'Bearish reversal', bars: 1, published: 59, study: 'Bearish reversal 59% of the time' },
  { key: 'bear_engulfing', label: 'Bearish Engulfing', code: 'BE', bias: 'bearish', signal: 'Bearish reversal', bars: 2, published: 79, study: 'Bearish reversal 79% of the time' },
  { key: 'dark_cloud', label: 'Dark Cloud Cover', code: 'DCC', bias: 'bearish', signal: 'Bearish reversal', bars: 2, published: 60, study: 'Bearish reversal 60% of the time' },
  { key: 'evening_star', label: 'Evening Star', code: 'ES', bias: 'bearish', signal: 'Bearish reversal', bars: 3, published: 72, study: 'Bearish reversal 72% of the time' },
  { key: 'three_crows', label: 'Three Black Crows', code: '3BC', bias: 'bearish', signal: 'Bearish reversal', bars: 3, published: 78, study: 'Bearish reversal 78% of the time' },
  { key: 'tweezer_top', label: 'Tweezer Top', code: 'TT', bias: 'bearish', signal: 'Bearish reversal', bars: 2, published: 44, study: 'Bullish continuation 56% of the time' },
  { key: 'bear_harami', label: 'Bearish Harami', code: 'BH', bias: 'bearish', signal: 'Bearish reversal', bars: 2, published: 47, study: 'Bullish continuation 53% of the time' },
  { key: 'falling_three', label: 'Falling Three Methods', code: 'F3M', bias: 'bearish', signal: 'Bearish continuation', bars: 5, published: 71, study: 'Bearish continuation 71% of the time' },
].map(t => ({
  ...t,
  arrow: t.bias === 'bullish' ? '▲' : '▼',
  color: t.bias === 'bullish' ? CANDLE_BULLISH_COLOR : CANDLE_BEARISH_COLOR,
  fill: t.bias === 'bullish' ? CANDLE_BULLISH_FILL : CANDLE_BEARISH_FILL,
}))

export const ALL_CANDLE_PATTERN_KEYS = CANDLE_PATTERN_TYPES.map(t => t.key)
export const CANDLE_PATTERN_SOURCE = 'Thomas Bulkowski, thepatternsite.com'

export function candlePatternType(key) {
  return CANDLE_PATTERN_TYPES.find(t => t.key === key) || null
}

/**
 * Saved pattern choices: known keys only. Every pattern starts unticked, so nothing
 * saved (or anything unusable) means none; the user picks the ones to hunt for.
 */
export function sanitizeCandlePatternKeys(saved) {
  if (!Array.isArray(saved)) return []
  return ALL_CANDLE_PATTERN_KEYS.filter(k => saved.includes(k))
}

// The "only show odds of at least" choices, in percent (0 = any).
export const CANDLE_MIN_ODDS_OPTIONS = [0, 50, 60, 70]

export function sanitizeCandleMinOdds(saved) {
  const n = Number(saved)
  return CANDLE_MIN_ODDS_OPTIONS.includes(n) ? n : 0
}

// How many earlier finds on the chart weigh as much as the published figure. With 20,
// a chart's own record moves the odds a little after a few finds and counts for half
// once 20 of that pattern have played out one way or the other.
export const CANDLE_ODDS_PRIOR_WEIGHT = 20

/** Published odds blended with the chart's own record, in percent. */
export function blendCandleOdds(publishedPct, wins, resolved, weight = CANDLE_ODDS_PRIOR_WEIGHT) {
  const n = Math.max(0, resolved || 0)
  return ((publishedPct / 100) * weight + Math.max(0, wins || 0)) / (weight + n) * 100
}

// ── Bars ─────────────────────────────────────────────────────────────────────

/**
 * One candle per record, or null when it can't be read (no open, no close). A high
 * below the body or a low above it is widened to the body.
 */
function toCandles(records) {
  return records.map(r => {
    const o = r?.open
    const c = r?.close
    if (!finite(o) || !finite(c) || o <= 0 || c <= 0) return null
    const top = Math.max(o, c)
    const bot = Math.min(o, c)
    const h = finite(r.high) ? Math.max(r.high, top) : top
    const l = finite(r.low) && r.low > 0 ? Math.min(r.low, bot) : bot
    return {
      o, h, l, c, top, bot,
      body: top - bot,
      range: h - l,
      upper: h - top,
      lower: bot - l,
      white: c > o,
      black: c < o,
      bodyPct: Math.log(top / bot), // body size in log (≈ percent) terms
      rangePct: Math.log(h / l),
    }
  })
}

const median = (values) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// The trend leading into a pattern: the 5 bars before it fell (or rose) by at least
// one typical bar range, and the last of them closed below (above) the 10-bar
// average. Fewer than 10 earlier bars: no call.
const TREND_BARS = 5
const TREND_AVG_BARS = 10
const TREND_MIN_RANGES = 1

function makeTrend(candles, unitRange) {
  const logc = candles.map(b => (b ? Math.log(b.c) : NaN))
  return (start) => {
    const last = start - 1
    const first = last - TREND_BARS
    if (first < 0 || last + 1 < TREND_AVG_BARS) return null
    if (!finite(logc[last]) || !finite(logc[first])) return null
    const window = logc.slice(last - TREND_AVG_BARS + 1, last + 1).filter(finite)
    if (window.length < TREND_AVG_BARS - 2) return null
    const avg = window.reduce((a, b) => a + b, 0) / window.length
    const move = logc[last] - logc[first]
    if (move <= -TREND_MIN_RANGES * unitRange && logc[last] < avg) return 'down'
    if (move >= TREND_MIN_RANGES * unitRange && logc[last] > avg) return 'up'
    return 'flat'
  }
}

// ── Pattern rules ────────────────────────────────────────────────────────────
// Each rule gets the candles ending at bar `i` (b1 oldest) and returns true on a match.

function makeRules(candles, unit) {
  const { body: unitBody, range: unitRange } = unit
  const trend = makeTrend(candles, unitRange)
  const long = (b) => b.bodyPct >= 1.2 * unitBody
  const small = (b) => b.bodyPct <= 0.6 * unitBody
  const mid = (b) => (b.o + b.c) / 2
  // Hammer shape: a small body at the top of a full-sized candle, a lower wick at
  // least twice the body and most of the range, and little or no upper wick.
  const hammerShape = (b) => b.range > 0 && b.rangePct >= 0.7 * unitRange
    && b.body <= 0.35 * b.range && b.lower >= 2 * b.body && b.lower >= 0.6 * b.range && b.upper <= 0.12 * b.range
  // The same upside down: inverted hammer and shooting star.
  const starShape = (b) => b.range > 0 && b.rangePct >= 0.7 * unitRange
    && b.body <= 0.35 * b.range && b.upper >= 2 * b.body && b.upper >= 0.6 * b.range && b.lower <= 0.12 * b.range
  const lowestLow = (from, to) => {
    let lo = Infinity
    for (let k = Math.max(0, from); k <= to; k += 1) if (candles[k]) lo = Math.min(lo, candles[k].l)
    return lo
  }
  const highestHigh = (from, to) => {
    let hi = -Infinity
    for (let k = Math.max(0, from); k <= to; k += 1) if (candles[k]) hi = Math.max(hi, candles[k].h)
    return hi
  }
  const sameLevel = (a, b) => Math.abs(Math.log(a / b)) <= 0.1 * unitRange

  return {
    hammer: (i, [b]) => trend(i) === 'down' && hammerShape(b),
    hanging_man: (i, [b]) => trend(i) === 'up' && hammerShape(b),
    inv_hammer: (i, [b]) => trend(i) === 'down' && starShape(b),
    shooting_star: (i, [b]) => trend(i) === 'up' && starShape(b),

    bull_engulfing: (i, [b1, b2]) => trend(i - 1) === 'down' && b1.black && b2.white
      && b2.o <= b1.c && b2.c >= b1.o && b2.body > b1.body && b2.bodyPct >= 0.5 * unitBody,
    bear_engulfing: (i, [b1, b2]) => trend(i - 1) === 'up' && b1.white && b2.black
      && b2.o >= b1.c && b2.c <= b1.o && b2.body > b1.body && b2.bodyPct >= 0.5 * unitBody,

    // Opens below the black candle's close, closes past the middle of its body but not
    // above its open (that would be an engulfing).
    piercing: (i, [b1, b2]) => trend(i - 1) === 'down' && b1.black && long(b1) && b2.white
      && b2.o < b1.c && b2.c > mid(b1) && b2.c < b1.o,
    dark_cloud: (i, [b1, b2]) => trend(i - 1) === 'up' && b1.white && long(b1) && b2.black
      && b2.o > b1.c && b2.c < mid(b1) && b2.c > b1.o,

    // A long candle, a small one whose body gaps beyond it, then a strong candle the
    // other way closing at least halfway back into the first candle's body.
    morning_star: (i, [b1, b2, b3]) => trend(i - 2) === 'down' && b1.black && long(b1)
      && small(b2) && b2.top < b1.c && b3.white && b3.bodyPct >= 0.8 * unitBody && b3.c >= mid(b1),
    evening_star: (i, [b1, b2, b3]) => trend(i - 2) === 'up' && b1.white && long(b1)
      && small(b2) && b2.bot > b1.c && b3.black && b3.bodyPct >= 0.8 * unitBody && b3.c <= mid(b1),

    // Three strong candles the same way, each closing further on and near its own
    // extreme, each opening inside the last one's body (or just past its close, since
    // today's stocks often open at or a touch beyond the prior close); not at the end
    // of a run the same way.
    three_soldiers: (i, [b1, b2, b3]) => {
      const t = trend(i - 2)
      if (!t || t === 'up') return false
      const opensIn = (b, p) => b.o >= p.o && b.o <= p.c + 0.25 * p.body
      return [b1, b2, b3].every(b => b.white && b.bodyPct >= 0.9 * unitBody && b.upper <= 0.25 * b.range)
        && b2.c > b1.c && b3.c > b2.c && opensIn(b2, b1) && opensIn(b3, b2)
    },
    three_crows: (i, [b1, b2, b3]) => {
      const t = trend(i - 2)
      if (!t || t === 'down') return false
      const opensIn = (b, p) => b.o <= p.o && b.o >= p.c - 0.25 * p.body
      return [b1, b2, b3].every(b => b.black && b.bodyPct >= 0.9 * unitBody && b.lower <= 0.25 * b.range)
        && b2.c < b1.c && b3.c < b2.c && opensIn(b2, b1) && opensIn(b3, b2)
    },

    // A down candle then an up candle with matching lows that are the lowest of the
    // last several bars (a bottom), and the mirror image at a top.
    tweezer_bottom: (i, [b1, b2]) => trend(i - 1) === 'down' && b1.black && b2.white
      && b1.bodyPct >= 0.3 * unitBody && b2.bodyPct >= 0.3 * unitBody
      && sameLevel(b1.l, b2.l) && Math.min(b1.l, b2.l) <= lowestLow(i - 7, i - 2),
    tweezer_top: (i, [b1, b2]) => trend(i - 1) === 'up' && b1.white && b2.black
      && b1.bodyPct >= 0.3 * unitBody && b2.bodyPct >= 0.3 * unitBody
      && sameLevel(b1.h, b2.h) && Math.max(b1.h, b2.h) >= highestHigh(i - 7, i - 2),

    // A long candle, then a small opposite-colored one whose body sits inside it.
    bull_harami: (i, [b1, b2]) => trend(i - 1) === 'down' && b1.black && long(b1) && b2.white
      && b2.o >= b1.c && b2.c <= b1.o && b2.body <= 0.6 * b1.body,
    bear_harami: (i, [b1, b2]) => trend(i - 1) === 'up' && b1.white && long(b1) && b2.black
      && b2.o <= b1.c && b2.c >= b1.o && b2.body <= 0.6 * b1.body,

    // A long candle with the trend, three small candles drifting against it with their
    // bodies inside the first candle's range, then a long candle closing past the first.
    rising_three: (i, [b1, b2, b3, b4, b5]) => trend(i - 4) === 'up' && b1.white && long(b1)
      && [b2, b3, b4].every(b => b.body <= 0.6 * b1.body && b.top <= b1.h && b.bot >= b1.l)
      && [b2, b3, b4].filter(b => b.black).length >= 2
      && b5.white && b5.bodyPct >= unitBody && b5.c > b1.c,
    falling_three: (i, [b1, b2, b3, b4, b5]) => trend(i - 4) === 'down' && b1.black && long(b1)
      && [b2, b3, b4].every(b => b.body <= 0.6 * b1.body && b.top <= b1.h && b.bot >= b1.l)
      && [b2, b3, b4].filter(b => b.white).length >= 2
      && b5.black && b5.bodyPct >= unitBody && b5.c < b1.c,
  }
}

// ── Outcome ──────────────────────────────────────────────────────────────────

/**
 * Bulkowski's test: the first close above the pattern's top or below its bottom after
 * it ends. `worked` when that close is the way the pattern points, `failed` when it is
 * the other way, `pending` while neither has happened in the loaded bars.
 */
function outcomeOf(candles, find) {
  for (let j = find.endIndex + 1; j < candles.length; j += 1) {
    const b = candles[j]
    if (!b) continue
    const dir = b.c > find.top ? 'up' : b.c < find.bottom ? 'down' : null
    if (!dir) continue
    const worked = (dir === 'up') === (find.bias === 'bullish')
    return { result: worked ? 'worked' : 'failed', direction: dir, index: j, bars: j - find.endIndex }
  }
  return { result: 'pending', direction: null, index: null, bars: null }
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Every candlestick pattern in the loaded bars, oldest first. Each find has its bars
 * (startIndex..endIndex), the pattern's top and bottom price, how it played out, and
 * `odds`: published and chart-record odds for its type (shared by every find of that
 * type, so the menu and each label agree).
 */
export function findCandlestickPatterns(records, { weight = CANDLE_ODDS_PRIOR_WEIGHT } = {}) {
  if (!Array.isArray(records) || records.length < TREND_AVG_BARS + 1) return []
  const candles = toCandles(records)
  const valid = candles.filter(b => b && b.range > 0)
  if (valid.length < TREND_AVG_BARS + 1) return []
  const unit = {
    body: median(valid.map(b => b.bodyPct)),
    range: median(valid.map(b => b.rangePct)),
  }
  if (!(unit.range > 0)) return []
  // A ticker whose bars rarely move between open and close still needs a usable
  // "typical body" for long / small.
  unit.body = Math.max(unit.body, 0.25 * unit.range)

  const rules = makeRules(candles, unit)
  const finds = []
  const lastEnd = {}
  for (let i = 0; i < candles.length; i += 1) {
    for (const type of CANDLE_PATTERN_TYPES) {
      const start = i - type.bars + 1
      if (start < 0) continue
      const group = candles.slice(start, i + 1)
      if (group.some(b => !b)) continue
      // One find per stretch of bars: four white soldiers in a row is one pattern.
      if (lastEnd[type.key] != null && start <= lastEnd[type.key]) continue
      if (!rules[type.key](i, group)) continue
      lastEnd[type.key] = i
      const find = {
        key: type.key,
        label: type.label,
        code: type.code,
        arrow: type.arrow,
        bias: type.bias,
        signal: type.signal,
        color: type.color,
        fill: type.fill,
        startIndex: start,
        endIndex: i,
        top: Math.max(...group.map(b => b.h)),
        bottom: Math.min(...group.map(b => b.l)),
      }
      find.outcome = outcomeOf(candles, find)
      finds.push(find)
    }
  }

  const record = {}
  finds.forEach(f => {
    const r = record[f.key] || (record[f.key] = { wins: 0, resolved: 0 })
    if (f.outcome.result !== 'pending') r.resolved += 1
    if (f.outcome.result === 'worked') r.wins += 1
  })
  finds.forEach(f => {
    const type = candlePatternType(f.key)
    const { wins, resolved } = record[f.key]
    f.odds = {
      pct: blendCandleOdds(type.published, wins, resolved, weight),
      published: type.published,
      study: type.study,
      wins,
      resolved,
    }
  })
  return finds
}

/** Per pattern type: how many were found and their odds (for the menu). */
export function summarizeCandlePatterns(finds) {
  const out = {}
  finds.forEach(f => {
    const s = out[f.key] || (out[f.key] = { count: 0, oddsPct: f.odds.pct, wins: f.odds.wins, resolved: f.odds.resolved })
    s.count += 1
  })
  return out
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

/**
 * Where each find's label goes: how many px past the usual arrow length it moves out
 * so it doesn't land on a label already placed. Bullish labels hang below the
 * pattern's low and bearish ones sit above its high. Positions are worked out in
 * pixels: `axisValue(find)` is the label's anchor in price-axis units (log10 prices
 * on a log axis) and `unitsPerPx` converts them; without a usable scale every anchor
 * counts as level, and labels simply stack. A label reaches `halfBars(find)` bars
 * either side of its bar (by default about 1.25% of the bars). `obstacles` are other
 * labels already on the chart ({ from, to } in bar indexes, `box` [low, high] in the
 * same px units); they are only used with a usable scale. Returns one offset per find,
 * in input order (oldest first, so earlier labels keep the spot nearest their bars).
 */
export function placeCandleLabels(finds, {
  barCount, axisValue = () => NaN, unitsPerPx = 0, arrowPx = 16, labelPx = 15, gapPx = 2, maxLevels = 8,
  halfBars = () => Math.max(1, barCount * 0.0125), obstacles = [],
}) {
  const step = labelPx + gapPx
  const fixed = unitsPerPx > 0 ? obstacles.filter(o => finite(o.from) && finite(o.to) && o.box) : []
  const placed = [...fixed]
  const hits = (list, from, to, b) => list.some(q => q.from < to && from < q.to
    && q.box[0] < b[1] + gapPx && b[0] < q.box[1] + gapPx)
  return finds.map(f => {
    const v = unitsPerPx > 0 ? axisValue(f) : NaN
    const base = finite(v) ? v / unitsPerPx : 0
    const up = f.bias === 'bearish'
    const half = halfBars(f)
    const from = f.endIndex - half
    const to = f.endIndex + half
    // The first level whose label is clear and whose arrow doesn't cut through another
    // label on the chart; failing that, the first whose label is clear. (An arrow
    // passing behind a neighboring code is fine: inner codes are drawn on top.)
    let pick = null
    let fallback = null
    for (let k = 0; k <= maxLevels && pick == null; k += 1) {
      const off = k * step
      const near = up ? base + arrowPx + off : base - arrowPx - off // the edge nearest the bars
      const box = up ? [near, near + labelPx] : [near - labelPx, near]
      if (hits(placed, from, to, box)) continue
      const arrow = up ? [base, near] : [near, base]
      if (!hits(fixed, f.endIndex - 0.1, f.endIndex + 0.1, arrow)) pick = { off, box }
      else if (!fallback) fallback = { off, box }
    }
    let chosen = pick || fallback
    if (!chosen) {
      const off = maxLevels * step
      const near = up ? base + arrowPx + off : base - arrowPx - off
      chosen = { off, box: up ? [near, near + labelPx] : [near - labelPx, near] }
    }
    placed.push({ from, to, box: chosen.box })
    return chosen.off
  })
}

const pctText = (v) => `${Math.round(v)}%`

/**
 * Hover text for a find's label, as lines (Plotly HTML). `dateLabel` turns a chart
 * date into display text.
 */
export function candlePatternHover(find, dates, dateLabel = (d) => String(d)) {
  const bullish = find.bias === 'bullish'
  const when = find.startIndex === find.endIndex
    ? dateLabel(dates[find.endIndex])
    : `${dateLabel(dates[find.startIndex])} to ${dateLabel(dates[find.endIndex])}`
  const { odds, outcome } = find
  const lines = [
    `<b>${find.arrow} ${find.label}</b> (${find.signal.toLowerCase()})`,
    when,
    `Chance of the expected move: <b>${pctText(odds.pct)}</b>`,
  ]
  // Plotly aligns an annotation's hover text to whichever side the box opens on, so
  // these lines carry no bullets or indents that would only read well on the left.
  lines.push(odds.published < 50
    ? `From published tests: ${pctText(odds.published)} (tested as: ${odds.study.toLowerCase()})`
    : `From published tests: ${pctText(odds.published)}`)
  lines.push(odds.resolved
    ? `From this chart: ${odds.wins} of ${odds.resolved} played out (${pctText(100 * odds.wins / odds.resolved)})`
    : 'From this chart: none has played out yet')
  const at = outcome.index != null ? dateLabel(dates[outcome.index]) : ''
  const later = outcome.bars === 1 ? 'next bar' : `${outcome.bars} bars later`
  if (outcome.result === 'worked') {
    lines.push(`This one: <b>played out</b>, closed ${bullish ? 'above' : 'below'} the pattern ${at} (${later})`)
  } else if (outcome.result === 'failed') {
    lines.push(`This one: <b>did not play out</b>, closed ${bullish ? 'below' : 'above'} the pattern ${at} (${later})`)
  } else {
    lines.push('This one: <b>not decided yet</b>, no close beyond the pattern since')
  }
  lines.push(bullish
    ? '<i>Expected move: a close above the pattern\'s high before a close below its low</i>'
    : '<i>Expected move: a close below the pattern\'s low before a close above its high</i>')
  return lines
}

const pad2 = (v) => String(v).padStart(2, '0')

/** A chart date ('YYYY-MM-DD' or 'YYYY-MM-DD HH:MM[:SS]') as a time, read as UTC. */
function chartDateMs(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(date || ''))
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
}

// In Plotly's own date format (no time at midnight, no seconds when zero), so a box's
// corners read back from the chart unchanged and the chart can tell its shapes apart
// from the ones the user drew.
function chartDateString(ms) {
  const d = new Date(ms)
  const day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  const [h, m, s] = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
  if (!h && !m && !s) return day
  return `${day} ${pad2(h)}:${pad2(m)}${s ? `:${pad2(s)}` : ''}`
}

/**
 * The x span of a box around bars start..end: half a bar beyond each end, so the box
 * edges fall between candles. The chart hides weekends and holidays on daily bars, so
 * a box's left edge sits half a bar after the previous bar rather than half a bar
 * before its own (which could land in a hidden weekend and be pulled to the bar).
 */
export function candleBoxX(dates, start, end) {
  const times = dates.map(chartDateMs)
  const gaps = []
  for (let k = 1; k < times.length; k += 1) {
    const g = times[k] - times[k - 1]
    if (finite(g) && g > 0) gaps.push(g)
  }
  const step = median(gaps) || 86400000
  const daily = step >= 0.75 * 86400000
  const t0 = times[start]
  const t1 = times[end]
  if (!finite(t0) || !finite(t1)) return null
  const prev = start > 0 ? times[start - 1] : NaN
  const left = daily && finite(prev) ? prev + step / 2 : t0 - step / 2
  return { x0: chartDateString(left), x1: chartDateString(t1 + step / 2) }
}
