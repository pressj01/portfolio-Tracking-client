// Target yield for a Portfolio Builder model: is the mix on target, and if
// not, which dollar amounts put it there.
//
// Yields are in percent (8 = 8%). Holdings are { ticker, dollar_amount,
// yieldPct, price, locked }. A locked holding keeps its amount: the Builder
// locks a holding it could not price, whose yield is unknown rather than zero.

// Two yields that print the same at two decimals count as equal.
export const YIELD_TOLERANCE = 0.005

const MIN_AMOUNT = 0.01

const toCents = value => Math.round(value * 100)
const sum = values => values.reduce((s, v) => s + v, 0)
const amountOf = h => (Number.isFinite(Number(h.dollar_amount)) ? Math.max(Number(h.dollar_amount), 0) : 0)
const yieldOf = h => (Number.isFinite(Number(h.yieldPct)) ? Math.max(Number(h.yieldPct), 0) : 0)
const priceOf = h => (Number(h.price) > 0 ? Number(h.price) : null)

// ── Monthly income ↔ yield ──────────────────────────────────────────────────

/** The yield (%) that pays `monthly` a month on `total` invested, or null. */
export function monthlyToYieldPct(monthly, total) {
  const m = Number(monthly)
  const t = Number(total)
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(t) || t <= 0) return null
  return (m * 12 * 100) / t
}

/** The monthly income `yieldPct` pays on `total` invested, or null. */
export function yieldPctToMonthly(yieldPct, total) {
  const y = Number(yieldPct)
  const t = Number(total)
  if (!Number.isFinite(y) || y <= 0 || !Number.isFinite(t) || t <= 0) return null
  return (y * t) / 1200
}

// ── Where the portfolio stands ──────────────────────────────────────────────

/** Weighted yield (%) of the holdings, or null when nothing is invested. */
export function portfolioYield(holdings) {
  const total = sum(holdings.map(amountOf))
  if (!(total > 0)) return null
  return sum(holdings.map(h => amountOf(h) * yieldOf(h))) / total
}

/**
 * Where a portfolio stands against its target yield.
 *
 * status: 'none' (no target or nothing invested), 'met', or 'short'.
 * gapPct is yield minus target, so it is negative when short; incomeShort is
 * the annual income still missing, in the amounts' own currency.
 */
export function yieldTargetStatus(holdings, target) {
  const goal = Number(target)
  const current = portfolioYield(holdings)
  if (!Number.isFinite(goal) || goal <= 0 || current == null) {
    return { status: 'none', yieldPct: current, targetPct: null, gapPct: null, incomeShort: 0 }
  }
  const total = sum(holdings.map(amountOf))
  const gapPct = current - goal
  const met = gapPct >= -YIELD_TOLERANCE
  return {
    status: met ? 'met' : 'short',
    yieldPct: current,
    targetPct: goal,
    gapPct,
    incomeShort: met ? 0 : (total * -gapPct) / 100,
  }
}

/** A max-per-holding percentage, or null when there is no cap. */
function cleanCap(maxWeightPct) {
  const cap = Number(maxWeightPct)
  return Number.isFinite(cap) && cap > 0 && cap < 100 ? cap : null
}

/** Tradable holdings whose weight is above the cap (beyond a rounding hair). */
export function holdingsOverCap(holdings, maxWeightPct) {
  const cap = cleanCap(maxWeightPct)
  const total = sum(holdings.map(amountOf))
  if (cap == null || !(total > 0)) return []
  return holdings
    .filter(h => !h.locked && (amountOf(h) / total) * 100 > cap + 0.05)
    .map(h => ({ ticker: h.ticker, weightPct: (amountOf(h) / total) * 100 }))
}

function prepare(holdings, maxWeightPct) {
  const funded = holdings.filter(h => amountOf(h) > 0)
  const total = sum(funded.map(amountOf))
  const pool = funded
    .filter(h => !h.locked)
    .map(h => ({ ticker: h.ticker, a: amountOf(h), y: yieldOf(h), p: priceOf(h) }))
  const lockedHoldings = funded.filter(h => h.locked)
  const cap = cleanCap(maxWeightPct)
  return {
    total,
    pool,
    poolTotal: sum(pool.map(h => h.a)),
    lockedAmount: sum(lockedHoldings.map(amountOf)),
    lockedIncome: sum(lockedHoldings.map(h => amountOf(h) * yieldOf(h))),
    cap,
    // The cap in dollars: a share of the whole portfolio, locked holdings included.
    limit: cap == null ? Infinity : (total * cap) / 100,
  }
}

// Every tradable dollar placed in yield order (highest first for the top of
// the range, lowest first for the bottom), each holding filled to the cap.
function extreme(pool, poolTotal, limit, highest) {
  const order = pool.map((_, i) => i).sort((i, j) => (highest ? pool[j].y - pool[i].y : pool[i].y - pool[j].y))
  const dollars = pool.map(() => 0)
  let left = poolTotal
  for (const i of order) {
    const take = Math.min(limit, left)
    dollars[i] = take
    left -= take
  }
  return dollars
}

const poolYield = (pool, dollars, poolTotal) => sum(pool.map((h, i) => dollars[i] * h.y)) / poolTotal

/**
 * The yields this portfolio can reach by moving dollars between its tradable
 * holdings, with no holding above the cap. feasible is false when the cap is
 * too low for the holdings to hold every dollar.
 */
export function yieldRange(holdings, maxWeightPct) {
  const s = prepare(holdings, maxWeightPct)
  if (!s.pool.length || !(s.total > 0)) return null
  if (s.pool.length * s.limit < s.poolTotal - 0.005) {
    return { feasible: false, minHoldings: Math.ceil(s.poolTotal / s.limit - 1e-9) }
  }
  const reach = y => (y * s.poolTotal + s.lockedIncome) / s.total
  const top = s.pool.reduce((m, h) => (h.y > m.y ? h : m))
  const bottom = s.pool.reduce((m, h) => (h.y < m.y ? h : m))
  return {
    feasible: true,
    maxYieldPct: reach(poolYield(s.pool, extreme(s.pool, s.poolTotal, s.limit, true), s.poolTotal)),
    minYieldPct: reach(poolYield(s.pool, extreme(s.pool, s.poolTotal, s.limit, false), s.poolTotal)),
    maxTicker: top.ticker,
    minTicker: bottom.ticker,
  }
}

// ── Balancing ───────────────────────────────────────────────────────────────

// Scales `raw` to add up to `budget` dollars with no entry above `limit`: the
// capped entries sit at the limit and the rest share what is left in
// proportion.
function capFill(raw, budget, limit) {
  const out = raw.map(() => 0)
  let free = raw.map((_, i) => i)
  let left = budget
  while (free.length) {
    const weight = sum(free.map(i => raw[i]))
    if (!(weight > 0)) {
      free.forEach(i => { out[i] = left / free.length })
      return out
    }
    const scale = left / weight
    const over = free.filter(i => raw[i] * scale > limit)
    if (!over.length) {
      free.forEach(i => { out[i] = raw[i] * scale })
      return out
    }
    over.forEach(i => { out[i] = limit; left -= limit })
    free = free.filter(i => !over.includes(i))
  }
  return out
}

// Dollars ∝ a_i · exp(θ · y_i), capped. Shifting by the largest exponent keeps
// every term in (0, 1], so a big θ cannot overflow.
function tilt(pool, theta, poolTotal, limit) {
  const peak = Math.max(...pool.map(h => theta * h.y))
  const raw = pool.map(h => h.a * Math.exp(theta * h.y - peak))
  return capFill(raw, poolTotal, limit)
}

function solveTilt(pool, poolGoal, poolTotal, limit) {
  const yieldAt = theta => poolYield(pool, tilt(pool, theta, poolTotal, limit), poolTotal)
  // The tilted yield rises with θ, so bracket the goal and bisect.
  let lo = -1
  let hi = 1
  for (let i = 0; i < 60 && yieldAt(hi) < poolGoal; i += 1) hi *= 2
  for (let i = 0; i < 60 && yieldAt(lo) > poolGoal; i += 1) lo *= 2
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2
    if (yieldAt(mid) < poolGoal) lo = mid
    else hi = mid
  }
  return tilt(pool, (lo + hi) / 2, poolTotal, limit)
}

// Whole cents, every holding kept, and the pool total exact: the rounding
// remainder goes to the largest position still under the cap.
function roundToCents(dollars, poolTotal, limit) {
  const cents = dollars.map(d => Math.max(toCents(d), toCents(MIN_AMOUNT)))
  const room = cents.map((c, i) => (c < toCents(limit) ? i : -1)).filter(i => i >= 0)
  const candidates = room.length ? room : cents.map((_, i) => i)
  const target = candidates.reduce((best, i) => (cents[i] > cents[best] ? i : best), candidates[0])
  cents[target] += toCents(poolTotal) - sum(cents)
  return cents.map(c => c / 100)
}

// Whole shares at each holding's price: round down, then spend what is left a
// share at a time, keeping the yield at or above the goal and every holding
// under the cap. What no share fits into is left over as cash.
function roundToShares(pool, dollars, s, goal) {
  const shares = pool.map((h, i) => Math.max(1, Math.floor(dollars[i] / h.p + 1e-9)))
  const spent = () => sum(pool.map((h, i) => shares[i] * h.p))
  let left = s.poolTotal - spent()
  // A holding kept at one share can overshoot: trim the largest positions.
  while (left < -1e-9) {
    const trim = pool.map((_, i) => i).filter(i => shares[i] > 1)
    if (!trim.length) break
    const i = trim.reduce((best, j) => (shares[j] * pool[j].p > shares[best] * pool[best].p ? j : best))
    shares[i] -= 1
    left += pool[i].p
  }
  const yieldWith = (extra = -1) => {
    const amounts = pool.map((h, i) => (shares[i] + (i === extra ? 1 : 0)) * h.p)
    return (sum(amounts.map((a, i) => a * pool[i].y)) + s.lockedIncome) / (sum(amounts) + s.lockedAmount)
  }
  for (let step = 0; step < 100000; step += 1) {
    const fits = pool.map((_, i) => i).filter(i => (
      pool[i].p <= left + 1e-9 && (shares[i] + 1) * pool[i].p <= s.limit + 0.005
    ))
    if (!fits.length) break
    let pick
    if (yieldWith() < goal) {
      // Below the goal: the highest yielder that fits, the cheaper on a tie.
      pick = fits.reduce((best, i) => (
        pool[i].y > pool[best].y || (pool[i].y === pool[best].y && pool[i].p < pool[best].p) ? i : best))
    } else {
      // At the goal: the holding furthest below its balanced amount, if a share
      // of it keeps the goal.
      const keep = fits.filter(i => yieldWith(i) >= goal)
      if (!keep.length) break
      pick = keep.reduce((best, i) => (
        dollars[i] - shares[i] * pool[i].p > dollars[best] - shares[best] * pool[best].p ? i : best))
    }
    shares[pick] += 1
    left -= pool[pick].p
  }
  return { amounts: pool.map((h, i) => toCents(shares[i] * h.p) / 100), shares, cash: Math.max(left, 0) }
}

/**
 * Dollar amounts that bring the portfolio's yield to `target`, keeping every
 * holding and, unless `wholeShares` is set, the total invested.
 *
 * Of the many mixes that hit the target, this is the one closest to the
 * current mix: each holding is scaled by exp(θ · its yield), the smallest
 * (relative-entropy) departure from today's weights. Higher-yielding holdings
 * grow, lower-yielding ones shrink, and holdings with the same yield keep
 * their proportions to each other. With `maxWeightPct`, no tradable holding
 * ends above that share of the portfolio; a holding already above it is
 * brought down to it.
 *
 * `wholeShares` rounds each traded holding to whole shares at its `price`.
 * The dollars no share fits into are reported as `cash` and leave the total,
 * and the yield lands at or a little above the target where whole shares
 * allow it.
 *
 * Returns { ok: true, holdings, changes, yieldPct, moved, total, cash }, where
 * changes lists { ticker, from, to, shares } for each tradable holding and
 * moved is the dollars taken out of holdings, or { ok: false, reason, ... }
 * with reason 'no_target', 'no_holdings', 'no_price', 'cap_too_low' (with
 * minHoldings), 'no_spread', 'above_max', or 'below_min' (with the range).
 */
export function balanceToTargetYield(holdings, target, { maxWeightPct = null, wholeShares = false } = {}) {
  const goal = Number(target)
  if (!Number.isFinite(goal) || goal <= 0) return { ok: false, reason: 'no_target' }

  const s = prepare(holdings, maxWeightPct)
  const { pool, poolTotal, limit } = s
  if (!pool.length || !(s.total > 0)) return { ok: false, reason: 'no_holdings' }
  if (wholeShares && pool.some(h => h.p == null)) return { ok: false, reason: 'no_price' }

  const range = yieldRange(holdings, maxWeightPct)
  if (!range.feasible) return { ok: false, reason: 'cap_too_low', minHoldings: range.minHoldings, cap: s.cap }
  const bounds = { ...range, cap: s.cap }
  // What the tradable holdings must yield for the whole portfolio to hit the goal.
  const poolGoal = (goal * s.total - s.lockedIncome) / poolTotal
  const spread = Math.max(...pool.map(h => h.y)) - Math.min(...pool.map(h => h.y))

  let dollars
  if (spread < 1e-9) {
    // Nothing to trade between: only a cap can change anything.
    if (Math.abs(range.maxYieldPct - goal) > YIELD_TOLERANCE) return { ok: false, reason: 'no_spread', ...bounds }
    dollars = capFill(pool.map(h => h.a), poolTotal, limit)
  } else if (goal >= range.maxYieldPct - 1e-9) {
    // The very top of the range: every holding filled to the cap in yield
    // order. Without a cap that is everything in one fund, so it is refused.
    if (s.cap == null || goal > range.maxYieldPct + YIELD_TOLERANCE) return { ok: false, reason: 'above_max', ...bounds }
    dollars = extreme(pool, poolTotal, limit, true)
  } else if (goal <= range.minYieldPct + 1e-9) {
    if (s.cap == null || goal < range.minYieldPct - YIELD_TOLERANCE) return { ok: false, reason: 'below_min', ...bounds }
    dollars = extreme(pool, poolTotal, limit, false)
  } else {
    dollars = solveTilt(pool, poolGoal, poolTotal, limit)
  }

  let amounts
  let shares = null
  let cash = 0
  if (wholeShares) {
    ({ amounts, shares, cash } = roundToShares(pool, dollars, s, goal))
  } else {
    amounts = roundToCents(dollars, poolTotal, limit)
  }

  const next = new Map(pool.map((h, i) => [h.ticker, amounts[i]]))
  const result = holdings.map(h => ({
    ticker: h.ticker,
    dollar_amount: next.has(h.ticker) ? next.get(h.ticker) : amountOf(h),
  }))
  const yieldPct = portfolioYield(result.map((r, i) => ({ ...r, yieldPct: holdings[i].yieldPct })))
  // A target right at the edge can need a holding smaller than one cent.
  if (!wholeShares && Math.abs(yieldPct - goal) > YIELD_TOLERANCE) {
    return { ok: false, reason: goal > yieldPct ? 'above_max' : 'below_min', ...bounds }
  }
  const changes = pool.map((h, i) => ({
    ticker: h.ticker, from: h.a, to: amounts[i], shares: shares ? shares[i] : null,
  }))
  return {
    ok: true,
    holdings: result,
    changes,
    yieldPct,
    moved: sum(changes.map(c => Math.max(c.from - c.to, 0))),
    total: sum(result.map(r => r.dollar_amount)),
    cash,
  }
}
