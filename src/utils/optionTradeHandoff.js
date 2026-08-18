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
const entryPrice = leg => num(leg?.entry_price) ?? num(leg?.mid) ?? num(leg?.ask) ?? num(leg?.bid) ?? 0

const optionLeg = (leg, side, optType, expiration, strike, qty = 1) => {
  const value = num(strike) ?? num(leg?.strike)
  if (!value || value <= 0 || !expiration) return null
  return {
    side,
    qty: Math.max(1, Math.round(num(qty) ?? 1)),
    opt_type: optType,
    strike: value,
    expiration,
    entry_price: entryPrice(leg),
    iv: num(leg?.iv) ?? 0.2,
    delta: num(leg?.delta),
    quote_source: leg?.quote_source || null,
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

const signedStockLeg = (leg) => ({
  side: Number(leg?.qty) < 0 ? 'SELL' : 'BUY',
  qty: Math.max(1, Math.abs(Math.round(num(leg?.qty) ?? 1))),
  opt_type: 'STOCK',
  strike: 0,
  expiration: '',
  entry_price: entryPrice(leg),
  iv: null,
  delta: num(leg?.delta) ?? 1,
  quote_source: leg?.quote_source || null,
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

const genericLegTrade = (kind, row) => {
  if (!Array.isArray(row?.legs) || !row.legs.length) return null
  return trade(row, String(kind || 'option strategy').replaceAll('-', ' '), row.legs.map(leg => {
    if (String(leg?.option_type).toLowerCase() === 'stock') return signedStockLeg(leg)
    return optionLeg(
      leg,
      Number(leg?.qty) < 0 ? 'SELL' : 'BUY',
      String(leg?.option_type || '').toUpperCase(),
      leg?.expiration || row?.expiration,
      leg?.strike,
      Math.abs(Number(leg?.qty) || 1),
    )
  }))
}

// One builder per scanner. Each reads the scanner's own result shape and returns
// the legs in the order the trade is actually written.
const BUILDERS = {
  'cash-secured-put': row => {
    const put = row?.put
    if (!put) return null
    return trade(row, 'cash-secured put', [
      optionLeg(
        put,
        'SELL',
        'PUT',
        put.expiration || row.expiration || row._general?.expiration,
        put.strike,
      ),
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
  //
  // Variants carry their own signed-quantity leg list, which is the only shape
  // that survives the trip: a ratio'd or hedged structure is four to ten legs at
  // unequal counts, and rebuilding it from the four named strikes would draw a
  // 1:1 condor the scanner never suggested — with a max loss off by the ratio.
  'iron-condor': row => {
    const condor = row?.spread
    if (!condor) return null
    const label = condor.variant_label
      ? `${condor.variant_label.toLowerCase()}${
          condor.direction && condor.direction !== 'neutral' ? ` (${condor.direction})` : ''
        }`
      : 'iron condor'

    if (Array.isArray(condor.legs) && condor.legs.length) {
      return trade(row, label, condor.legs.map(leg => optionLeg(
        leg,
        leg.qty > 0 ? 'BUY' : 'SELL',
        leg.option_type === 'call' ? 'CALL' : 'PUT',
        condor.expiration,
        leg.strike,
        Math.abs(leg.qty),
      )))
    }

    return trade(row, label, [
      optionLeg(condor.put_leg_long, 'BUY', 'PUT', condor.expiration, condor.put_long_strike),
      optionLeg(condor.put_leg_short, 'SELL', 'PUT', condor.expiration, condor.put_short_strike),
      optionLeg(condor.call_leg_short, 'SELL', 'CALL', condor.expiration, condor.call_short_strike),
      optionLeg(condor.call_leg_long, 'BUY', 'CALL', condor.expiration, condor.call_long_strike),
    ])
  },

  'unbalanced-put-condor': row => {
    if (!row?.expiration) return null
    return trade(row, 'unbalanced put condor', [
      optionLeg(row.upper_long_leg, 'BUY', 'PUT', row.expiration, row.upper_long_strike, row.bought_quantity),
      optionLeg(row.upper_short_leg, 'SELL', 'PUT', row.expiration, row.upper_short_strike, row.bought_quantity),
      optionLeg(row.lower_short_leg, 'SELL', 'PUT', row.expiration, row.lower_short_strike, row.sold_quantity),
      optionLeg(row.lower_long_leg, 'BUY', 'PUT', row.expiration, row.lower_long_strike, row.sold_quantity),
    ])
  },

  'put-condor': row => {
    if (!row?.expiration) return null
    return trade(row, 'put condor', [
      optionLeg(row.upper_long_leg, 'BUY', 'PUT', row.expiration, row.upper_long_strike),
      optionLeg(row.upper_short_leg, 'SELL', 'PUT', row.expiration, row.upper_short_strike),
      optionLeg(row.lower_short_leg, 'SELL', 'PUT', row.expiration, row.lower_short_strike),
      optionLeg(row.lower_long_leg, 'BUY', 'PUT', row.expiration, row.lower_long_strike),
    ])
  },

  'call-condor': row => {
    if (!row?.expiration) return null
    return trade(row, 'call condor', [
      optionLeg(row.debit_long_leg, 'BUY', 'CALL', row.expiration, row.debit_long_strike),
      optionLeg(row.debit_short_leg, 'SELL', 'CALL', row.expiration, row.debit_short_strike),
      optionLeg(row.credit_short_leg, 'SELL', 'CALL', row.expiration, row.credit_short_strike),
      optionLeg(row.credit_long_leg, 'BUY', 'CALL', row.expiration, row.credit_long_strike),
    ])
  },

  'put-call-condor': row => {
    if (!row?.expiration || !Array.isArray(row.legs)) return null
    return trade(row, 'put / call condor', row.legs.map(leg => optionLeg(
      leg,
      Number(leg.qty) > 0 ? 'BUY' : 'SELL',
      String(leg.option_type).toUpperCase(),
      leg.expiration || row.expiration,
      leg.strike,
      Math.abs(Number(leg.qty) || 1),
    )))
  },

  'unbalanced-butterfly': row => {
    if (!row?.expiration) return null
    return trade(row, 'unbalanced butterfly', [
      optionLeg(row.upper_long_leg, 'BUY', 'PUT', row.expiration, row.upper_long_strike, row.upper_long_quantity),
      optionLeg(row.body_short_leg, 'SELL', 'PUT', row.expiration, row.body_short_strike, row.body_short_quantity),
      optionLeg(row.lower_long_leg, 'BUY', 'PUT', row.expiration, row.lower_long_strike, row.lower_long_quantity),
    ])
  },

  'double-hedge-put-butterfly': row => {
    if (!row?.expiration) return null
    return trade(row, 'double-hedge put butterfly', [
      optionLeg(row.upper_long_leg, 'BUY', 'PUT', row.expiration, row.upper_long_strike, row.upper_long_quantity),
      optionLeg(row.body_short_leg, 'SELL', 'PUT', row.expiration, row.body_short_strike, row.body_short_quantity),
      optionLeg(row.lower_long_leg, 'BUY', 'PUT', row.expiration, row.lower_long_strike, row.lower_long_quantity),
    ])
  },

  'road-trip-butterfly': row => {
    if (!row?.expiration) return null
    return trade(row, 'road trip butterfly', [
      optionLeg(row.upper_long_leg, 'BUY', 'PUT', row.expiration, row.upper_long_strike, row.upper_long_quantity),
      optionLeg(row.body_short_leg, 'SELL', 'PUT', row.expiration, row.body_short_strike, row.body_short_quantity),
      optionLeg(row.lower_long_leg, 'BUY', 'PUT', row.expiration, row.lower_long_strike, row.lower_long_quantity),
    ])
  },

  'iron-butterfly': row => {
    const butterfly = row
    if (!butterfly?.expiration) return null
    if (Array.isArray(butterfly.legs) && butterfly.legs.length) {
      return trade(row, 'iron butterfly', butterfly.legs.map(leg => optionLeg(
        leg,
        leg.qty > 0 ? 'BUY' : 'SELL',
        leg.option_type === 'call' ? 'CALL' : 'PUT',
        butterfly.expiration,
        leg.strike,
        Math.abs(leg.qty),
      )))
    }
    return trade(row, 'iron butterfly', [
      optionLeg(butterfly.put_long_leg, 'BUY', 'PUT', butterfly.expiration, butterfly.put_long_strike),
      optionLeg(butterfly.put_short_leg, 'SELL', 'PUT', butterfly.expiration, butterfly.body_strike),
      optionLeg(butterfly.call_short_leg, 'SELL', 'CALL', butterfly.expiration, butterfly.body_strike),
      optionLeg(butterfly.call_long_leg, 'BUY', 'CALL', butterfly.expiration, butterfly.call_long_strike),
    ])
  },

  'sixty-forty-twenty-fly': row => {
    if (!row?.expiration) return null
    return trade(row, '60/40/20 fly', [
      optionLeg(row.upper_long_leg, 'BUY', 'PUT', row.expiration, row.upper_long_strike, row.upper_long_quantity),
      optionLeg(row.body_short_leg, 'SELL', 'PUT', row.expiration, row.body_short_strike, row.body_short_quantity),
      optionLeg(row.lower_long_leg, 'BUY', 'PUT', row.expiration, row.lower_long_strike, row.lower_long_quantity),
    ])
  },
}

/** The suggested trade as risk-graph legs, or null when the row has no option trade. */
export function buildScannerTrade(kind, row) {
  const build = BUILDERS[kind]
  if (!row?.ticker) return null
  const built = build ? build(row) : genericLegTrade(kind, row)
  // A partial structure would draw a payoff the scanner never suggested.
  if (!built) return null
  const fixedExpected = {
    'bull-put-spread': 2,
    'bear-put-spread': 2,
    'bear-call-spread': 2,
    'iron-condor': 4,
    'iron-butterfly': 4,
    'put-condor': 4,
    'call-condor': 4,
    'put-call-condor': 8,
    'unbalanced-put-condor': 4,
    'unbalanced-butterfly': 3,
    'double-hedge-put-butterfly': 3,
    'road-trip-butterfly': 3,
    'sixty-forty-twenty-fly': 3,
  }[kind]
  // Quantity-aware condor variants can contain four, six, or more actual legs.
  // Validate against the backend's complete leg list instead of rejecting every
  // non-four-leg structure (which disabled both Risk graph and Save trade).
  const expected = kind === 'iron-condor' && Array.isArray(row?.spread?.legs)
    ? row.spread.legs.length
    : fixedExpected
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

const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = num(value)
    if (parsed != null) return parsed
  }
  return null
}

/** Preserve the scanner's position-level probability model for Strategy Lab. */
export function buildScannerProbabilitySummary(row) {
  const meta = row?._general || {}
  const spread = row?.spread || {}
  const schedule = [meta.probability_schedule, spread.probability_schedule, row?.probability_schedule]
    .find(value => Array.isArray(value)) || []
  const capture = [meta.profit_capture, spread.profit_capture, row?.profit_capture]
    .find(value => Array.isArray(value?.targets) && value.targets.length) || null
  const expiration = schedule.find(point => (
    point?.kind === 'expiration' || Number(point?.remaining_dte) === 0
  )) || {}
  const success = firstNumber(
    meta.prob_success,
    spread.prob_profit,
    row?.prob_profit,
    row?.probability_profit_pct,
    expiration.probability_success_pct,
  )
  const failure = firstNumber(
    meta.prob_failure,
    spread.prob_loss,
    row?.prob_loss,
    row?.probability_loss_pct,
    expiration.probability_failure_pct,
    success == null ? null : 100 - success,
  )
  const otm = firstNumber(meta.prob_otm, spread.prob_otm, row?.prob_otm)
  const itm = firstNumber(meta.prob_itm, otm == null ? null : 100 - otm)
  const directTouch = firstNumber(meta.prob_touch, spread.prob_touch, row?.prob_touch)
  const touch = firstNumber(directTouch, itm == null ? null : Math.min(100, 2 * itm))
  const summary = {
    prob_success: success,
    prob_failure: failure,
    prob_otm: otm,
    prob_itm: itm,
    prob_touch: touch,
    prob_touch_estimated: Boolean(meta.prob_touch_estimated || (directTouch == null && touch != null)),
    prob_touch_put: firstNumber(meta.prob_touch_put, spread.prob_touch_put, row?.prob_touch_put),
    prob_touch_call: firstNumber(meta.prob_touch_call, spread.prob_touch_call, row?.prob_touch_call),
    prob_max_profit: firstNumber(meta.prob_max_profit, spread.prob_max_profit, row?.prob_max_profit),
    prob_max_loss: firstNumber(meta.prob_max_loss, spread.prob_max_loss, row?.prob_max_loss),
    probability_schedule: schedule,
    profit_capture: capture,
  }
  return schedule.length || capture || [success, failure, otm, itm, touch, summary.prob_touch_put,
    summary.prob_touch_call, summary.prob_max_profit, summary.prob_max_loss].some(value => value != null)
    ? summary
    : null
}

/** Convert a scanner result into the saved-strategy API shape. */
export function buildScannerStrategyPayload(kind, row, source) {
  const built = buildScannerTrade(kind, row)
  if (!built) return null
  const usesEstimatedPrices = built.legs.some(
    leg => leg.quote_source && leg.quote_source !== 'live_bid_ask',
  )
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
    notes: `${source ? `Suggested by the ${source}.` : 'Saved from an option scanner.'}${
      usesEstimatedPrices ? ' Entry prices are recent-trade estimates; verify live bid/ask before trading.' : ''
    }`,
    origin: 'scanner',
    scanner_kind: kind,
    scanner_source: source || null,
    scanner_key: row?.scanner_variant
      ? `${scannerTradeKey(kind, built.ticker)}:${String(row.scanner_variant).toLowerCase()}`
      : scannerTradeKey(kind, built.ticker),
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
  const probabilities = buildScannerProbabilitySummary(row)
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
      ...built, kind, source, probabilities, return_to: returnTo || null, staged_at: Date.now(),
    }))
    return true
  } catch {
    return false
  }
}

/** Net opening fill price after allocated opening fees. */
const trackedEntryPrice = leg => {
  const openings = (leg?.executions || []).filter(execution => ['BTO', 'STO'].includes(execution.action))
  const contracts = openings.reduce((sum, execution) => sum + Math.max(0, Number(execution.contracts) || 0), 0)
  if (!contracts) return 0
  const multiplier = Math.max(1, Number(leg?.multiplier) || 100)
  const gross = openings.reduce(
    (sum, execution) => sum + (Math.max(0, Number(execution.price) || 0) * Math.max(0, Number(execution.contracts) || 0) * multiplier),
    0,
  )
  const fees = openings.reduce((sum, execution) => sum + Math.abs(Number(execution.fees) || 0), 0)
  const net = leg.position_side === 'SHORT' ? gross - fees : gross + fees
  return Math.max(0, net / (contracts * multiplier))
}

/** Convert a permanent ledger trade into the Strategy Lab risk-graph shape. */
export function buildTrackedTrade(row) {
  const ticker = String(row?.underlying || '').trim().toUpperCase()
  const allLegs = Array.isArray(row?.legs) ? row.legs : []
  if (!ticker || !allLegs.length) return null
  const openTrade = String(row?.status || '').toUpperCase() === 'OPEN'
  const sourceLegs = openTrade
    ? allLegs.filter(leg => Math.max(0, Number(leg?.open_contracts) || 0) > 0)
    : allLegs
  if (!sourceLegs.length) return null
  const optionLegs = sourceLegs.map(leg => {
    const optionType = String(leg?.option_type || '').toUpperCase()
    const side = String(leg?.position_side || '').toUpperCase()
    const strike = num(leg?.strike)
    const expiration = String(leg?.expiration || '').slice(0, 10)
    const qty = openTrade ? num(leg?.open_contracts) : num(leg?.contracts)
    if (!['CALL', 'PUT'].includes(optionType) || !['LONG', 'SHORT'].includes(side) || !strike || !expiration || !qty) return null
    return {
      side: side === 'LONG' ? 'BUY' : 'SELL',
      qty: Math.max(1, Math.round(qty)),
      opt_type: optionType,
      strike,
      expiration,
      entry_price: trackedEntryPrice(leg),
      iv: 0.2,
      delta: null,
      quote_source: 'actual_fill',
    }
  }).filter(Boolean)
  if (optionLegs.length !== sourceLegs.length) return null
  const stock = row?.stock_position
  const stockShares = Math.max(0, num(stock?.shares) ?? 0)
  const stockBasis = num(stock?.cost_basis) ?? num(stock?.current_price) ?? 0
  const stockHoldingLeg = stockShares > 0 ? {
    side: 'BUY',
    qty: stockShares,
    opt_type: 'STOCK',
    strike: 0,
    expiration: '',
    entry_price: stockBasis,
    iv: null,
    delta: 1,
    quote_source: 'account_holding',
  } : null
  const legs = stockHoldingLeg ? [stockHoldingLeg, ...optionLegs] : optionLegs
  const label = String(row?.strategy_type || 'tracked option trade').trim()
  return {
    ticker,
    name: `${ticker} ${label}`,
    label,
    spot: null,
    legs,
    source: 'Option Trade Ledger',
    entry_source: 'actual_fills',
    tracked_trade_id: row?.id ?? null,
    tracked_trade_status: row?.status || null,
    stock_coverage: stock ? {
      shares: stockShares,
      portfolio_shares: num(stock.portfolio_shares) ?? 0,
      required_shares: num(stock.required_shares) ?? 0,
      shortfall_shares: num(stock.shortfall_shares) ?? 0,
      covered: Boolean(stock.covered),
      cost_basis_source: stock.cost_basis_source || null,
    } : null,
  }
}

/** Apply current chain IV/Greeks without replacing the trade's actual entry fills. */
export function hydrateTrackedTradeLegs(legs, chainsByExpiration) {
  if (!Array.isArray(legs) || !chainsByExpiration) return legs
  let changed = false
  const hydrated = legs.map(leg => {
    if (String(leg?.opt_type || '').toUpperCase() === 'STOCK') return leg
    const chain = chainsByExpiration[leg?.expiration]
    const contracts = String(leg?.opt_type || '').toUpperCase() === 'PUT'
      ? chain?.puts || []
      : chain?.calls || []
    const contract = contracts.find(item => Number(item?.strike) === Number(leg?.strike))
    const marketIv = num(contract?.iv)
    if (!contract || marketIv == null || marketIv <= 0) return leg
    const marketDelta = num(contract.delta)
    const marketPrice = num(contract.mid) ?? num(contract.last)
    if (
      Number(leg.iv) === marketIv
      && leg.delta === marketDelta
      && leg.market_price === marketPrice
      && leg.iv_source === 'live_chain'
    ) return leg
    changed = true
    return {
      ...leg,
      iv: marketIv,
      delta: marketDelta,
      market_price: marketPrice,
      iv_source: 'live_chain',
    }
  })
  return changed ? hydrated : legs
}

/** Stage an account trade for Strategy Lab and preserve a return path. */
export function stageTrackedTrade(row, returnTo = '/option-trades') {
  const built = buildTrackedTrade(row)
  if (!built) return false
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
      ...built,
      return_to: returnTo,
      staged_at: Date.now(),
    }))
    return true
  } catch {
    return false
  }
}

/** Read and clear a staged trade. Consumed once; a reload starts clean. */
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
