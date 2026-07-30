// Scanner → Options page handoff.
//
// Every option scanner ends at one concrete suggested trade. This turns that
// suggestion into risk-graph legs and parks it in sessionStorage so the Options
// page can pick it up on its next mount and draw both the P/L profile and the
// price chart with the strikes marked on it.

const HANDOFF_KEY = 'optionScannerTradeHandoff'
// Long enough to survive the navigation, short enough that a trade left behind in
// an old tab never loads against quotes that have since moved.
const HANDOFF_MAX_AGE_MS = 5 * 60 * 1000

// Number(null) and Number('') are both 0, so the null check has to come first —
// otherwise a missing cost basis or a missing mid reads as a real zero and the
// ?? fallbacks below never fire.
const num = value => {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Every scanner quotes its credit, debit, breakeven and max loss off the mid, so
// the risk graph has to enter at the mid too — entering at the natural bid/ask
// would contradict the card the user just clicked.
const entryPrice = leg => num(leg?.mid) ?? num(leg?.ask) ?? num(leg?.bid) ?? 0

const optionLeg = (leg, side, optType, expiration, strike) => {
  const value = num(strike) ?? num(leg?.strike)
  if (!value || value <= 0 || !expiration) return null
  return {
    side,
    qty: 1,
    opt_type: optType,
    strike: value,
    expiration,
    entry_price: entryPrice(leg),
    iv: num(leg?.iv) ?? 0.2,
    delta: num(leg?.delta),
  }
}

const stockLeg = (qty, basis) => ({
  side: 'BUY',
  qty,
  opt_type: 'STOCK',
  strike: 0,
  expiration: '',
  entry_price: num(basis) ?? 0,
  iv: null,
  delta: 1,
})

const trade = (row, label, legs) => {
  const built = legs.filter(Boolean)
  if (!built.length) return null
  return {
    ticker: String(row?.ticker || '').toUpperCase(),
    name: `${row?.ticker} ${label}`,
    label,
    spot: num(row?.price),
    legs: built,
  }
}

// One builder per scanner. Each reads the scanner's own result shape and returns
// the legs in the order the trade is actually written.
const BUILDERS = {
  'cash-secured-put': row => {
    const put = row?.put
    if (!put) return null
    return trade(row, 'cash-secured put', [
      optionLeg(put, 'SELL', 'PUT', put.expiration, put.strike),
    ])
  },

  // The short call on its own is not the position — the shares are what make the
  // risk graph a covered call instead of a naked short call.
  'covered-call': row => {
    const call = row?.call
    if (!call) return null
    return trade(row, 'covered call', [
      stockLeg(100, num(row?.cost_basis) ?? num(row?.price)),
      optionLeg(call, 'SELL', 'CALL', call.expiration, call.strike),
    ])
  },

  'bull-put-spread': row => {
    const spread = row?.spread
    if (!spread) return null
    return trade(row, 'bull put spread', [
      optionLeg(spread.short_leg, 'SELL', 'PUT', spread.expiration, spread.short_strike),
      optionLeg(spread.long_leg, 'BUY', 'PUT', spread.expiration, spread.long_strike),
    ])
  },

  'bear-put-spread': row => {
    const spread = row?.spread
    if (!spread) return null
    return trade(row, 'bear put spread', [
      optionLeg(spread.long_leg, 'BUY', 'PUT', spread.expiration, spread.long_strike),
      optionLeg(spread.short_leg, 'SELL', 'PUT', spread.expiration, spread.short_strike),
    ])
  },

  'bear-call-spread': row => {
    const spread = row?.spread
    if (!spread) return null
    return trade(row, 'bear call spread', [
      optionLeg(spread.short_leg, 'SELL', 'CALL', spread.expiration, spread.short_strike),
      optionLeg(spread.long_leg, 'BUY', 'CALL', spread.expiration, spread.long_strike),
    ])
  },

  // The condor scanner returns its structure under `spread`, the same key the
  // two-leg screens use — not `condor`.
  'iron-condor': row => {
    const condor = row?.spread
    if (!condor) return null
    return trade(row, 'iron condor', [
      optionLeg(condor.put_leg_long, 'BUY', 'PUT', condor.expiration, condor.put_long_strike),
      optionLeg(condor.put_leg_short, 'SELL', 'PUT', condor.expiration, condor.put_short_strike),
      optionLeg(condor.call_leg_short, 'SELL', 'CALL', condor.expiration, condor.call_short_strike),
      optionLeg(condor.call_leg_long, 'BUY', 'CALL', condor.expiration, condor.call_long_strike),
    ])
  },
}

/** The suggested trade as risk-graph legs, or null when the row has no option trade. */
export function buildScannerTrade(kind, row) {
  const build = BUILDERS[kind]
  if (!build || !row?.ticker) return null
  const built = build(row)
  // A partial structure would draw a payoff the scanner never suggested.
  if (!built) return null
  const expected = { 'bull-put-spread': 2, 'bear-put-spread': 2, 'bear-call-spread': 2, 'iron-condor': 4 }[kind]
  if (expected && built.legs.length !== expected) return null
  return built
}

export function hasScannerTrade(kind, row) {
  return Boolean(buildScannerTrade(kind, row))
}

export function scannerTradeKey(kind, ticker) {
  const normalizedKind = String(kind || '').trim().toLowerCase()
  const normalizedTicker = String(ticker || '').trim().toUpperCase()
  return normalizedKind && normalizedTicker ? `${normalizedKind}:${normalizedTicker}` : ''
}

/** Convert a scanner result into the saved-strategy API shape. */
export function buildScannerStrategyPayload(kind, row, source) {
  const built = buildScannerTrade(kind, row)
  if (!built) return null
  const expirations = built.legs
    .filter(leg => leg.opt_type !== 'STOCK' && leg.expiration)
    .map(leg => leg.expiration)
    .sort()
  const expiration = expirations[expirations.length - 1]
  if (!expiration) return null
  return {
    name: `${built.name} · ${expiration}`,
    underlying: built.ticker,
    model: 'black-scholes',
    rate: 0.0375,
    notes: source ? `Suggested by the ${source}.` : 'Saved from an option scanner.',
    origin: 'scanner',
    scanner_kind: kind,
    scanner_source: source || null,
    scanner_key: scannerTradeKey(kind, built.ticker),
    legs: built.legs.map((leg, index) => ({
      group_id: 0,
      included: true,
      side: leg.side,
      qty: Math.max(1, Number(leg.qty) || 1),
      opt_type: leg.opt_type,
      strike: Number(leg.strike) || 0,
      expiration: leg.expiration || '',
      entry_price: Number(leg.entry_price) || 0,
      iv_override: leg.opt_type === 'STOCK' ? null : (num(leg.iv) ?? 0.2),
      sort_order: index,
    })),
  }
}

/**
 * Park a built trade for the Options page. Returns false when nothing was staged.
 *
 * `returnTo` is the route the user is leaving, so the Options page can offer a way
 * back to the scanner that sent them.
 */
export function stageScannerTrade(kind, row, source, returnTo) {
  const built = buildScannerTrade(kind, row)
  if (!built) return false
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
      ...built, kind, source, return_to: returnTo || null, staged_at: Date.now(),
    }))
    return true
  } catch {
    return false
  }
}

/** Read and clear a staged trade. Consumed once — a reload starts clean. */
export function takeScannerTrade() {
  let raw = null
  try {
    raw = sessionStorage.getItem(HANDOFF_KEY)
    sessionStorage.removeItem(HANDOFF_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.ticker || !Array.isArray(parsed.legs) || !parsed.legs.length) return null
    if (Date.now() - Number(parsed.staged_at || 0) > HANDOFF_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}
