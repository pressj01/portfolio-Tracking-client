// Chart-pattern finders for the Stock and ETF Analysis chart. Each finder reads the
// loaded bars (oldest first) and returns the patterns it can see, in bar indexes, for
// the chart to draw. All the geometry is done on log prices, so a 5% swing counts the
// same at $20 as at $500, and sizes are measured in multiples of the ticker's typical
// bar range (the median true range of the loaded bars). The rules are textbook
// shapes found in past prices, not forecasts.
//
// Bearish shapes are found by running the bullish finder on the price series turned
// upside down (highs become lows), so each pair shares one set of rules.

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

export const PATTERN_TYPES = [
  { key: 'hs', label: 'Head & Shoulders', short: 'Head & Shoulders', group: 'Reversal', bias: 'bearish', color: '#FF6E40' },
  { key: 'ihs', label: 'Inverse Head & Shoulders', short: 'Inv Head & Shoulders', group: 'Reversal', bias: 'bullish', color: '#40C4FF' },
  { key: 'vbottom', label: 'V Bottom', short: 'V Bottom', group: 'Reversal', bias: 'bullish', color: '#64FFDA' },
  { key: 'asc_up', label: 'Ascending Triangle (uptrend)', short: 'Asc Triangle', group: 'Triangles', bias: 'bullish', color: '#EEFF41' },
  { key: 'asc_down', label: 'Ascending Triangle (downtrend)', short: 'Asc Triangle', group: 'Triangles', bias: 'bullish', color: '#FFAB40' },
  { key: 'bull_flag', label: 'Bull Flag', short: 'Bull Flag', group: 'Flags & Pennants', bias: 'bullish', color: '#69F0AE' },
  { key: 'bear_flag', label: 'Bear Flag', short: 'Bear Flag', group: 'Flags & Pennants', bias: 'bearish', color: '#FF5252' },
  { key: 'bull_pennant', label: 'Bull Pennant', short: 'Bull Pennant', group: 'Flags & Pennants', bias: 'bullish', color: '#448AFF' },
  { key: 'bear_pennant', label: 'Bear Pennant', short: 'Bear Pennant', group: 'Flags & Pennants', bias: 'bearish', color: '#FF4081' },
]

export const PATTERN_GROUPS = ['Reversal', 'Triangles', 'Flags & Pennants']
export const ALL_PATTERN_KEYS = PATTERN_TYPES.map(t => t.key)

export function patternType(key) {
  return PATTERN_TYPES.find(t => t.key === key) || null
}

/** Saved pattern choices: known keys only; anything unusable means every pattern. */
export function sanitizePatternKeys(saved) {
  if (!Array.isArray(saved)) return [...ALL_PATTERN_KEYS]
  return ALL_PATTERN_KEYS.filter(k => saved.includes(k))
}

// ── Series helpers ───────────────────────────────────────────────────────────

/** Log highs, lows and closes; a bar missing a high or low uses its close. */
function toSeries(records) {
  const n = records.length
  const hi = new Array(n).fill(NaN)
  const lo = new Array(n).fill(NaN)
  const cl = new Array(n).fill(NaN)
  for (let i = 0; i < n; i += 1) {
    const r = records[i]
    const c = r?.close
    if (!finite(c) || c <= 0) continue
    const h = finite(r.high) && r.high >= c ? r.high : c
    const l = finite(r.low) && r.low > 0 && r.low <= c ? r.low : c
    hi[i] = Math.log(Math.max(h, c))
    lo[i] = Math.log(Math.min(l, c))
    cl[i] = Math.log(c)
  }
  return { n, hi, lo, cl }
}

/** The same series upside down: a top becomes a bottom, a fall becomes a rise. */
function mirror(s) {
  return { n: s.n, hi: s.lo.map(v => -v), lo: s.hi.map(v => -v), cl: s.cl.map(v => -v) }
}

const median = (values) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Median true range in log units: the ticker's typical bar size. */
function typicalBarRange(s) {
  const ranges = []
  for (let i = 0; i < s.n; i += 1) {
    if (!finite(s.hi[i]) || !finite(s.lo[i])) continue
    const pc = i > 0 ? s.cl[i - 1] : NaN
    ranges.push(finite(pc) ? Math.max(s.hi[i], pc) - Math.min(s.lo[i], pc) : s.hi[i] - s.lo[i])
  }
  const m = median(ranges)
  if (m > 0) return m
  const moves = []
  for (let i = 1; i < s.n; i += 1) {
    if (finite(s.cl[i]) && finite(s.cl[i - 1])) moves.push(Math.abs(s.cl[i] - s.cl[i - 1]))
  }
  return median(moves) || 0.001
}

/**
 * Alternating swing highs and lows. A swing is confirmed once price reverses by at
 * least `minSwing` from it; the last, unconfirmed extreme comes last, `provisional`.
 */
function zigzag(s, minSwing) {
  const pts = []
  let dir = 0
  let hi = null
  let lo = null
  for (let i = 0; i < s.n; i += 1) {
    const h = s.hi[i]
    const l = s.lo[i]
    if (!finite(h) || !finite(l)) continue
    if (!hi) {
      hi = { index: i, price: h }
      lo = { index: i, price: l }
      continue
    }
    if (dir >= 0 && h > hi.price) hi = { index: i, price: h }
    if (dir <= 0 && l < lo.price) lo = { index: i, price: l }
    if (dir === 0) {
      // Undecided: once the highest high and lowest low so far are a swing apart,
      // whichever came first is the first swing, and price is heading to the other.
      if (hi.price - lo.price >= minSwing) {
        if (hi.index < lo.index) {
          pts.push({ ...hi, kind: 'high' })
          dir = -1
        } else {
          pts.push({ ...lo, kind: 'low' })
          dir = 1
        }
      }
    } else if (dir === 1) {
      if (i > hi.index && hi.price - l >= minSwing) {
        pts.push({ ...hi, kind: 'high' })
        dir = -1
        lo = { index: i, price: l }
      }
    } else if (i > lo.index && h - lo.price >= minSwing) {
      pts.push({ ...lo, kind: 'low' })
      dir = 1
      hi = { index: i, price: h }
    }
  }
  if (dir === 1) pts.push({ ...hi, kind: 'high', provisional: true })
  if (dir === -1) pts.push({ ...lo, kind: 'low', provisional: true })
  return pts
}

/** Least-squares line through (x, y) points: { slope, at(x) }. */
function fitLine(xs, ys) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  return { slope, at: (x) => my + slope * (x - mx) }
}

/** Straight line through two points, extended either way. */
const lineThrough = (a, b) => (x) => a.price + (b.price - a.price) * (x - a.index) / (b.index - a.index)

const pct = (logMove) => (Math.exp(logMove) - 1) * 100

// Swing sizes (× typical bar range) the swing-based finders look at, so small and
// large versions of a shape are both found; overlapping finds are thinned afterwards.
const SWING_SCALES = [2, 3, 4.5]

// ── Head and shoulders (top) ─────────────────────────────────────────────────

function headAndShoulders(s, swings, atr) {
  const out = []
  for (let k = 0; k + 4 < swings.length; k += 1) {
    const [h1, l1, h2, l2, h3] = swings.slice(k, k + 5)
    if (h1.kind !== 'high' || h3.provisional) continue
    const neck = lineThrough(l1, l2)
    const height = h2.price - neck(h2.index)
    if (height < 3 * atr) continue
    // The head stands clear of both shoulders, and both shoulders clear the neckline.
    if (h2.price - Math.max(h1.price, h3.price) < Math.max(0.1 * height, 0.5 * atr)) continue
    if (h1.price - neck(h1.index) < 0.3 * height || h3.price - neck(h3.index) < 0.3 * height) continue
    // Shoulders of similar height, a neckline that isn't steep, and halves of similar width.
    if (Math.abs(h1.price - h3.price) > 0.4 * height) continue
    if (Math.abs(l2.price - l1.price) > 0.4 * height) continue
    const left = h2.index - h1.index
    const right = h3.index - h2.index
    if (Math.max(left, right) > 2 * Math.min(left, right)) continue
    // Price climbed into the left shoulder from at or below the neckline.
    let start = -1
    for (let i = Math.max(0, h1.index - left); i < h1.index; i += 1) {
      if (finite(s.lo[i]) && (start < 0 || s.lo[i] < s.lo[start])) start = i
    }
    if (start < 0 || s.lo[start] > neck(start)) continue
    // Confirmed by the first close through the neckline after the right shoulder; a
    // high above the head first voids the pattern.
    const maxWait = Math.max(left, right)
    let breakIdx = -1
    let voided = false
    for (let i = h3.index + 1; i < s.n && i <= h3.index + maxWait; i += 1) {
      if (s.hi[i] > h2.price) { voided = true; break }
      if (s.cl[i] < neck(i)) { breakIdx = i; break }
    }
    if (voided) continue
    if (breakIdx < 0 && s.n - 1 > h3.index + maxWait) continue
    const end = breakIdx >= 0 ? breakIdx : s.n - 1
    out.push({
      family: 'hs',
      startIndex: h1.index,
      endIndex: end,
      status: breakIdx >= 0 ? 'confirmed' : 'forming',
      size: height,
      outline: [h1, l1, h2, l2, h3, { index: end, price: s.cl[end] }],
      lines: [{ role: 'neckline', pts: [l1, l2, { index: end, price: neck(end) }] }],
      tags: [
        { ...h1, text: 'LS', side: 'above' },
        { ...h2, text: 'H', side: 'above' },
        { ...h3, text: 'RS', side: 'above' },
      ],
      labelAt: { index: h2.index, price: h2.price, side: 'above', shift: 14 },
      target: breakIdx >= 0 ? neck(breakIdx) - height : null,
      summary: `Head ${pct(height).toFixed(1)}% above the neckline`,
    })
  }
  return out
}

// ── V bottom ────────────────────────────────────────────────────────────────

function vBottoms(s, swings, atr) {
  const out = []
  for (let k = 1; k < swings.length; k += 1) {
    const top = swings[k - 1]
    const low = swings[k]
    if (low.kind !== 'low' || low.provisional) continue
    const drop = top.price - low.price
    const down = low.index - top.index
    // A steep fall of at least 6 typical bars' range...
    if (drop < 6 * atr || down < 2 || drop / down < 0.4 * atr) continue
    // ...then a climb back three quarters of the way, about as fast as it fell.
    const maxUp = Math.max(Math.ceil(down * 1.5), down + 5)
    const goal = low.price + 0.75 * drop
    let rIdx = -1
    let undercut = false
    for (let i = low.index + 1; i < s.n && i <= low.index + maxUp; i += 1) {
      if (s.lo[i] < low.price) { undercut = true; break }
      if (s.cl[i] >= goal) { rIdx = i; break }
    }
    if (undercut) continue
    let status = 'confirmed'
    if (rIdx < 0) {
      // Still climbing at the last bar: show it once half the fall is back.
      const last = s.n - 1
      if (last > low.index + maxUp || s.cl[last] < low.price + 0.5 * drop) continue
      status = 'forming'
    }
    const end = rIdx >= 0 ? rIdx : s.n - 1
    // A V has no shelf at the bottom: only a few bars trade near the low.
    let nearLow = 0
    for (let i = top.index; i <= end; i += 1) if (s.lo[i] <= low.price + 0.2 * drop) nearLow += 1
    if (nearLow > Math.max(3, 0.25 * (end - top.index + 1))) continue
    const back = s.cl[end] - low.price
    out.push({
      family: 'vbottom',
      startIndex: top.index,
      endIndex: end,
      status,
      size: drop,
      outline: [top, low, { index: end, price: s.cl[end] }],
      lines: [],
      tags: [],
      labelAt: { index: low.index, price: low.price, side: 'below', shift: 6 },
      target: null,
      summary: `Fell ${Math.abs(pct(-drop)).toFixed(1)}% in ${down} bars, then won back ${Math.round(back / drop * 100)}% of it in ${end - low.index}`,
    })
  }
  return out
}

// ── Ascending triangle ───────────────────────────────────────────────────────

/** Did the closes of bars [from, to] trend up or down into the pattern, measured against its height? */
function priorTrend(s, from, to, height) {
  if (to - from < 5) return null
  const xs = []
  const ys = []
  for (let i = from; i <= to; i += 1) {
    if (finite(s.cl[i])) { xs.push(i); ys.push(s.cl[i]) }
  }
  if (xs.length < 5) return null
  const change = fitLine(xs, ys).slope * (to - from)
  if (change >= 0.5 * height) return 'up'
  if (change <= -0.5 * height) return 'down'
  return null
}

function ascendingTriangles(s, swings, atr) {
  const out = []
  let k = 0
  while (k < swings.length) {
    // Grow the longest run of swings from k with flat highs and rising lows.
    const highs = []
    const lows = []
    let best = -1
    for (let e = k; e < swings.length; e += 1) {
      const p = swings[e]
      if (p.kind === 'high') highs.push(p)
      else lows.push(p)
      const hiPrices = highs.map(h => h.price)
      const top = hiPrices.length ? Math.max(...hiPrices) : null
      const bottom = lows.length ? lows[0].price : null
      const height = top != null && bottom != null ? top - bottom : null
      const flatTol = Math.max(0.8 * atr, height ? 0.12 * height : 0)
      const flat = hiPrices.length < 2 || top - Math.min(...hiPrices) <= flatTol
      const rising = lows.every((l, i) => i === 0 || l.price - lows[i - 1].price >= 0.25 * atr)
      if (!flat || !rising) break
      if (highs.length >= 2 && lows.length >= 2) best = e
    }
    if (best < 0) { k += 1; continue }
    const run = swings.slice(k, best + 1)
    const runHighs = run.filter(p => p.kind === 'high')
    const runLows = run.filter(p => p.kind === 'low')
    const level = runHighs.reduce((a, h) => a + h.price, 0) / runHighs.length
    const firstLow = runLows[0]
    const lastLow = runLows[runLows.length - 1]
    const height = level - firstLow.price
    const first = run[0].index
    const last = run[run.length - 1].index
    const support = lineThrough(firstLow, lastLow)
    const slope = (lastLow.price - firstLow.price) / (lastLow.index - firstLow.index)
    const valid = height >= 2.5 * atr && last - first >= 8 && slope > 0
      && lastLow.price - firstLow.price >= 0.3 * height
    if (!valid) { k += 1; continue }
    const apex = firstLow.index + height / slope
    // Breakout: the first close above the flat top or below the rising line.
    let breakIdx = -1
    let status = null
    for (let i = last + 1; i < s.n && i <= Math.ceil(apex); i += 1) {
      if (s.cl[i] > level + 0.1 * atr) { breakIdx = i; status = 'confirmed'; break }
      if (s.cl[i] < support(i)) { breakIdx = i; status = 'failed'; break }
    }
    if (!status) {
      if (s.n - 1 > apex) { k += 1; continue }
      status = 'forming'
    }
    const window = Math.min(60, Math.max(10, last - first))
    const trend = priorTrend(s, Math.max(0, first - window), first, height)
    if (!trend) { k += 1; continue }
    const end = breakIdx >= 0 ? breakIdx : s.n - 1
    out.push({
      family: 'asc',
      key: trend === 'up' ? 'asc_up' : 'asc_down',
      startIndex: first,
      endIndex: end,
      status,
      size: height,
      outline: [],
      lines: [
        { role: 'resistance', pts: [{ index: runHighs[0].index, price: level }, { index: end, price: level }] },
        { role: 'support', pts: [firstLow, { index: end, price: support(end) }] },
      ],
      tags: [],
      labelAt: { index: Math.round((first + end) / 2), price: level, side: 'above', shift: 6 },
      target: status === 'confirmed' ? level + height : null,
      summary: `${runHighs.length} tops at the same level, ${runLows.length} rising lows, after a ${trend === 'up' ? 'rise' : 'fall'}`,
    })
    k = best
  }
  return out
}

// ── Flags and pennants (bullish) ─────────────────────────────────────────────

/**
 * Boundary lines of the consolidation in bars [from, to]: the upper through its swing
 * highs (from the top on), the lower through its swing lows, as a chartist draws them,
 * each pushed out just enough to hold every bar. With fewer than two swings on a side,
 * that line fits every bar instead.
 */
function consolidationLines(s, from, to) {
  const xs = []
  const upX = [from]
  const upY = [s.hi[from]]
  const loX = []
  const loY = []
  for (let i = from; i <= to; i += 1) {
    if (!finite(s.hi[i]) || !finite(s.lo[i])) continue
    xs.push(i)
    if (i > from && i < to) {
      if (s.hi[i] >= s.hi[i - 1] && s.hi[i] >= s.hi[i + 1]) { upX.push(i); upY.push(s.hi[i]) }
      if (s.lo[i] <= s.lo[i - 1] && s.lo[i] <= s.lo[i + 1]) { loX.push(i); loY.push(s.lo[i]) }
    }
  }
  const upFit = upX.length >= 2 ? fitLine(upX, upY) : fitLine(xs, xs.map(i => s.hi[i]))
  const loFit = loX.length >= 2 ? fitLine(loX, loY) : fitLine(xs, xs.map(i => s.lo[i]))
  let upOff = -Infinity
  let loOff = Infinity
  xs.forEach(x => {
    upOff = Math.max(upOff, s.hi[x] - upFit.at(x))
    loOff = Math.min(loOff, s.lo[x] - loFit.at(x))
  })
  return {
    upper: (x) => upFit.at(x) + upOff,
    lower: (x) => loFit.at(x) + loOff,
    upSlope: upFit.slope,
    loSlope: loFit.slope,
  }
}

/** 'flag', 'pennant' or null for the consolidation [top, end] after a rise. */
function consolidationShape(lines, top, end, pole) {
  const w0 = lines.upper(top) - lines.lower(top)
  const w1 = lines.upper(end) - lines.lower(end)
  if (!(w0 > 0) || w0 > 0.6 * pole.move) return null
  const poleSlope = pole.move / pole.bars
  const mid = (lines.upSlope + lines.loSlope) / 2
  if (lines.upSlope < 0 && lines.loSlope > 0 && w1 <= 0.6 * w0 && Math.abs(mid) <= 0.35 * poleSlope) return 'pennant'
  const ratio = w1 / w0
  if (ratio > 0.6 && ratio <= 1.5 && mid <= 0.1 * poleSlope && mid >= -0.6 * poleSlope) return 'flag'
  return null
}

function flagsAndPennants(s, atr) {
  const out = []
  for (let top = 2; top + 4 < s.n; top += 1) {
    const h = s.hi[top]
    if (!finite(h) || !(h >= s.hi[top - 1] && h >= s.hi[top - 2] && h > s.hi[top + 1] && h > s.hi[top + 2])) continue
    // The pole: a steep rise of at least 4 typical bars' range into this top, from the
    // lowest point of up to 20 bars before it.
    let pole = null
    let runMin = Infinity
    for (let st = top - 1; st >= Math.max(0, top - 20); st -= 1) {
      if (!(s.lo[st] < runMin)) continue
      runMin = s.lo[st]
      const move = h - s.lo[st]
      const bars = top - st
      if (move < 4 * atr || move / bars < 0.5 * atr) continue
      const score = move / Math.sqrt(bars)
      if (!pole || score > pole.score) pole = { start: st, move, bars, score }
    }
    if (!pole) continue
    // The consolidation: at least 5 bars after the top, until a close breaks out above
    // it. It may give back at most half the pole and may not make a new high on the
    // way. A dip under the lower line isn't a failure on its own (a short window's
    // lines are rough); giving back more than half the pole is.
    const maxLen = Math.min(30, Math.max(10, 4 * pole.bars))
    let low = Infinity
    for (let j = top + 1; j < s.n && j <= top + maxLen; j += 1) {
      if (s.hi[j] > h) break
      low = Math.min(low, s.lo[j])
      if (h - low > 0.5 * pole.move) break
      if (j - top < 5) continue
      const lines = consolidationLines(s, top, j)
      const next = j + 1
      if (next < s.n) {
        if (!(s.cl[next] > lines.upper(next))) continue
        const shape = consolidationShape(lines, top, j, pole)
        if (shape) out.push(flagPattern(s, pole, top, j, next, lines, shape, 'confirmed'))
        break
      }
      const shape = consolidationShape(lines, top, j, pole)
      if (shape) out.push(flagPattern(s, pole, top, j, j, lines, shape, 'forming'))
    }
  }
  return out
}

function flagPattern(s, pole, top, end, breakIdx, lines, shape, status) {
  return {
    family: 'cont',
    shape,
    startIndex: pole.start,
    endIndex: breakIdx,
    status,
    size: pole.move,
    outline: [],
    lines: [
      { role: 'pole', pts: [{ index: pole.start, price: s.lo[pole.start] }, { index: top, price: s.hi[top] }], width: 3 },
      { role: 'upper', pts: [{ index: top, price: lines.upper(top) }, { index: end, price: lines.upper(end) }] },
      { role: 'lower', pts: [{ index: top, price: lines.lower(top) }, { index: end, price: lines.lower(end) }] },
    ],
    tags: [],
    labelAt: { index: top, price: s.hi[top], side: 'above', shift: 6 },
    target: status === 'confirmed' ? s.cl[breakIdx] + pole.move : null,
    summary: `Pole ${pct(pole.move).toFixed(1)}% in ${pole.bars} bars, then ${end - top} bars of ${shape === 'flag' ? 'drift' : 'narrowing range'}`,
  }
}

// ── Putting it together ──────────────────────────────────────────────────────

const overlapShare = (a, b) => {
  const lo = Math.max(a.startIndex, b.startIndex)
  const hi = Math.min(a.endIndex, b.endIndex)
  if (hi < lo) return 0
  const shorter = Math.min(a.endIndex - a.startIndex, b.endIndex - b.startIndex) || 1
  return (hi - lo) / shorter
}

/** Keep one of each set of overlapping finds of a family: confirmed first, then the biggest. */
function thin(found) {
  const rank = { confirmed: 0, failed: 1, forming: 2 }
  const sorted = [...found].sort((a, b) => (rank[a.status] - rank[b.status]) || (b.size - a.size))
  const kept = []
  sorted.forEach(p => {
    if (!kept.some(k => k.family === p.family && overlapShare(k, p) > 0.5)) kept.push(p)
  })
  return kept.sort((a, b) => a.startIndex - b.startIndex)
}

/** Back to real prices: undo the log, and the flip for patterns found upside down. */
function toPrices(p, flipped) {
  const price = (v) => Math.exp(flipped ? -v : v)
  const pt = (q) => ({ ...q, price: price(q.price) })
  const sideFlip = (side) => (flipped ? (side === 'above' ? 'below' : 'above') : side)
  return {
    ...p,
    outline: p.outline.map(pt),
    lines: p.lines.map(l => ({ ...l, pts: l.pts.map(pt) })),
    tags: p.tags.map(t => ({ ...pt(t), side: sideFlip(t.side) })),
    labelAt: { ...pt(p.labelAt), side: sideFlip(p.labelAt.side) },
    target: p.target == null ? null : price(p.target),
  }
}

/**
 * Every chart pattern the finders can see in `records` (oldest first), as
 * { id, key, name, short, color, bias, status, startIndex, endIndex, outline, lines,
 * tags, labelAt, target, summary } with real prices. `status` is 'confirmed' (broke out the
 * way the pattern points), 'forming' (no breakout yet at the last bar) or, for
 * triangles only, 'failed' (broke out the other way).
 */
export function findChartPatterns(records) {
  if (!Array.isArray(records) || records.length < 10) return []
  const up = toSeries(records)
  const down = mirror(up)
  const atr = typicalBarRange(up)
  const found = []
  const add = (list, flipped, keyFor) => list.forEach(p => {
    const key = keyFor(p)
    const type = patternType(key)
    found.push({ ...toPrices(p, flipped), key, family: `${p.family}${flipped ? '-down' : ''}`, type })
  })
  SWING_SCALES.forEach(scale => {
    const upSwings = zigzag(up, scale * atr)
    const downSwings = zigzag(down, scale * atr)
    add(headAndShoulders(down, downSwings, atr), true, () => 'ihs')
    add(headAndShoulders(up, upSwings, atr), false, () => 'hs')
    add(vBottoms(up, upSwings, atr), false, () => 'vbottom')
    add(ascendingTriangles(up, upSwings, atr), false, p => p.key)
  })
  add(flagsAndPennants(up, atr), false, p => (p.shape === 'flag' ? 'bull_flag' : 'bull_pennant'))
  add(flagsAndPennants(down, atr), true, p => (p.shape === 'flag' ? 'bear_flag' : 'bear_pennant'))
  return thin(found).map(p => ({
    id: `${p.key}-${p.startIndex}-${p.endIndex}`,
    key: p.key,
    name: p.type.label,
    short: p.type.short,
    color: p.type.color,
    bias: p.type.bias,
    status: p.status,
    startIndex: p.startIndex,
    endIndex: p.endIndex,
    outline: p.outline,
    lines: p.lines,
    tags: p.tags,
    labelAt: p.labelAt,
    target: p.target,
    summary: p.summary,
  }))
}
