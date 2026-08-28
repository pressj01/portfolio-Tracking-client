export const MIN_OPTION_DTE = 0
export const MAX_OPTION_DTE = 1095

export function updateDteFilters(current, key, rawValue) {
  if (rawValue == null || rawValue === '') return current
  const value = Math.min(MAX_OPTION_DTE, Math.max(MIN_OPTION_DTE, Math.round(Number(rawValue))))
  if (!Number.isFinite(value)) return current

  const next = { ...current, [key]: value }
  const minimum = Number(next.min_dte)
  const target = Number(next.target_dte)
  const maximum = Number(next.max_dte)

  if (key === 'min_dte') {
    if (!Number.isFinite(target) || target < value) next.target_dte = value
    if (!Number.isFinite(maximum) || maximum < value) next.max_dte = value
  } else if (key === 'target_dte') {
    if (!Number.isFinite(minimum) || value < minimum) next.min_dte = value
    if (!Number.isFinite(maximum) || value > maximum) next.max_dte = value
  } else if (key === 'max_dte') {
    if (!Number.isFinite(minimum) || minimum > value) next.min_dte = value
    if (!Number.isFinite(target) || target > value) next.target_dte = value
  }

  return next
}

const COMMON = {
  risk_profile: 'open',
  symbols: '',
  index_tickers: 'SPY,QQQ,IWM',
  universe: 'large_cap',
  include_stocks: true,
  include_index_etfs: true,
  include_sector_etfs: false,
  include_commodity_etfs: false,
  min_total_option_volume: 5000,
  min_iv_rank: 0,
  max_iv_rank: 100,
  min_iv_rv: -100,
  max_iv_rv: 100,
  min_iv_rv_rank: 0,
  max_iv_rv_rank: 100,
  min_rv_rank: 0,
  max_rv_rank: 100,
  min_volatility_score: 0,
  max_volatility_score: 100,
  reference_delta_mode: 'none',
  min_reference_delta: 0,
  max_reference_delta: 100,
  stock_score_fundamental_min: 1,
  stock_score_fundamental_max: 10,
  stock_score_growth_min: 1,
  stock_score_growth_max: 10,
  stock_score_technical_min: 1,
  stock_score_technical_max: 10,
  market_trend: 'any',
  underlying_trend: 'any',
  recent_move_direction: 'any',
  recent_move_lookback: 5,
  min_abs_recent_move_pct: 0,
  technical_rsi_min: 0,
  technical_rsi_max: 100,
  min_dte: 7,
  max_dte: 45,
  target_dte: 30,
  max_results: 100,
  include_near_matches: true,
  exclude_earnings_before_expiry: false,
  min_market_cap: 0,
  fund_min_aum: 0,
  min_avg_dollar_volume: 0,
  min_open_interest: 0,
  min_skew_rank: 0,
  max_skew_rank: 100,
}

// The supplied Samurai examples remain available as the per-strategy preset,
// but discovery scans should not begin with every quality/risk opinion active.
// Construction inputs such as DTE and moneyness still come from the strategy.
const OPEN_FILTERS = {
  risk_profile: 'open',
  min_total_option_volume: 0,
  min_iv_rank: 0,
  max_iv_rank: 100,
  min_iv_rv: -100,
  max_iv_rv: 100,
  min_iv_rv_rank: 0,
  max_iv_rv_rank: 100,
  min_rv_rank: 0,
  max_rv_rank: 100,
  min_volatility_score: 0,
  max_volatility_score: 100,
  reference_delta_mode: 'none',
  min_reference_delta: 0,
  max_reference_delta: 100,
  market_trend: 'any',
  underlying_trend: 'any',
  recent_move_direction: 'any',
  min_abs_recent_move_pct: 0,
  technical_rsi_min: 0,
  technical_rsi_max: 100,
  max_bid_ask_spread: null,
  min_return_pct: 0,
  min_annualized_return_pct: 0,
  min_prob_max_profit: 0,
  max_prob_max_loss: 100,
  require_positive_expected_value: false,
  min_profit_ratio_pct: 0,
  max_profit_ratio_pct: null,
  min_max_profit_dollars: 0,
  min_max_loss_dollars: 0,
  max_max_loss_dollars: null,
  max_abs_position_delta: 100,
  iron_condor_shape: 'any',
  butterfly_shape: 'any',
  exclude_earnings_before_expiry: false,
  min_market_cap: 0,
  fund_min_aum: 0,
  min_avg_dollar_volume: 0,
  min_open_interest: 0,
  min_skew_rank: 0,
  max_skew_rank: 100,
}

export const GENERAL_RISK_PROFILES = {
  risk_averse: { label: 'Risk Averse', shortBand: [5, 15], longBand: [60, 75], target: 10 },
  moderate: { label: 'Moderate', shortBand: [15, 20], longBand: [45, 60], target: 17.5 },
  aggressive: { label: 'Aggressive', shortBand: [30, 50], longBand: [25, 45], target: 40 },
}

const SHORT_DELTA_STRATEGIES = new Set([
  'covered-call', 'cash-secured-put', 'naked-call', 'bull-put-spread',
  'bear-call-spread', 'short-strangle', 'long-call-calendar',
  'long-put-calendar', 'long-call-diagonal', 'long-put-diagonal', 'collar',
  'call-ratio-spread', 'put-ratio-spread', 'iron-condor', 'put-call-condor',
])

const LONG_DELTA_STRATEGIES = new Set([
  'long-call', 'long-put', 'married-put', 'married-call',
  'bull-call-spread', 'bear-put-spread',
])

export const INDEX_ONLY_STRATEGIES = new Set([
  'unbalanced-butterfly',
  'unbalanced-put-condor',
  'double-hedge-put-butterfly',
  'road-trip-butterfly',
  'sixty-forty-twenty-fly',
])

export function isIndexOnlyStrategy(strategy) {
  return INDEX_ONLY_STRATEGIES.has(strategy)
}

const BULLISH_PULLBACK_STRATEGIES = new Set([
  'covered-call', 'cash-secured-put', 'bull-put-spread', 'bull-call-spread',
  'long-call', 'married-put',
])

const BEARISH_RALLY_STRATEGIES = new Set([
  'naked-call', 'bear-call-spread', 'bear-put-spread', 'long-put', 'married-call',
])

const PREMIUM_SELLING_STRATEGIES = new Set([
  'covered-call', 'cash-secured-put', 'naked-call', 'bull-put-spread',
  'bear-call-spread', 'short-strangle', 'short-straddle', 'collar',
  'call-ratio-spread', 'put-ratio-spread', 'iron-condor', 'iron-butterfly',
  'put-call-condor', 'call-butterfly', 'put-butterfly',
])

const PREMIUM_BUYING_STRATEGIES = new Set([
  'long-call', 'long-put', 'married-put', 'married-call',
  'bull-call-spread', 'bear-put-spread', 'long-straddle', 'long-strangle',
  'long-call-calendar', 'long-put-calendar', 'long-call-diagonal', 'long-put-diagonal',
])

const CALENDAR_OR_DIAGONAL = new Set([
  'long-call-calendar', 'long-put-calendar', 'long-call-diagonal', 'long-put-diagonal',
])

const HOLDINGS_SETUP_STRATEGIES = new Set([
  'covered-call', 'collar', 'married-put',
])

export const CORE_INDEX_TICKERS = 'SPY,QQQ,IWM'

export const GENERAL_SETUP_PRESETS = [
  {
    key: 'my_holdings',
    label: 'My holdings',
    title: 'Scan only names you already own. For covered calls, collars, and married puts.',
  },
  {
    key: 'pullback_uptrend',
    label: 'Pullback uptrend',
    title: 'Uptrend with a short-term pullback. For cash-secured puts, bull put spreads, covered calls, and other bullish structures.',
  },
  {
    key: 'rally_downtrend',
    label: 'Rally downtrend',
    title: 'Downtrend with a short-term bounce. For bear call spreads, naked calls, long puts, and other bearish structures.',
  },
  {
    key: 'high_iv',
    label: 'High IV',
    title: 'Sell expensive options: higher IV Rank, skip earnings, tighter spreads. For credit and short-premium trades.',
  },
  {
    key: 'cheap_iv',
    label: 'Cheap IV',
    title: 'Buy cheaper options: cap IV Rank and Volatility score. For debit and long-premium trades.',
  },
  {
    key: 'weeklies',
    label: 'Weeklies',
    title: 'Target 5–14 DTE listed expirations. Hidden for long-dated and calendar structures whose construction needs more time.',
  },
  {
    key: 'monthlies',
    label: 'Monthlies',
    title: 'Target 21–45 DTE, the conventional monthly window. Hidden for long-dated index structures.',
  },
  {
    key: 'core_indexes',
    label: 'Core indexes',
    title: 'Scan only SPY, QQQ, and IWM.',
  },
]

export function setupAppliesToStrategy(setupKey, strategy) {
  strategy = String(strategy || '').trim()
  if (!strategy) return false
  if (setupKey === 'my_holdings') return HOLDINGS_SETUP_STRATEGIES.has(strategy)
  if (setupKey === 'pullback_uptrend') return BULLISH_PULLBACK_STRATEGIES.has(strategy)
  if (setupKey === 'rally_downtrend') return BEARISH_RALLY_STRATEGIES.has(strategy)
  if (setupKey === 'high_iv') return PREMIUM_SELLING_STRATEGIES.has(strategy)
  if (setupKey === 'cheap_iv') return PREMIUM_BUYING_STRATEGIES.has(strategy)
  if (setupKey === 'weeklies') {
    return !INDEX_ONLY_STRATEGIES.has(strategy)
      && !CALENDAR_OR_DIAGONAL.has(strategy)
      && strategy !== 'put-call-condor'
  }
  if (setupKey === 'monthlies') return !INDEX_ONLY_STRATEGIES.has(strategy)
  if (setupKey === 'core_indexes') return strategy !== 'put-call-condor'
  return false
}

export function setupsForGeneralStrategy(strategy) {
  return GENERAL_SETUP_PRESETS.filter(preset => setupAppliesToStrategy(preset.key, strategy))
}

const field = (key, label, options = {}) => ({ key, label, type: 'number', ...options })

const INCOME_FIELDS = [
  field('min_moneyness_pct', 'Moneyness from', { suffix: '%', step: 1 }),
  field('max_moneyness_pct', 'Moneyness to', { suffix: '%', step: 1 }),
  field('max_bid_ask_spread', 'Bid/ask spread below', { prefix: '$', step: 0.05, min: 0 }),
  field('min_return_pct', 'Return above', { suffix: '%', step: 0.25, min: 0 }),
  field('min_annualized_return_pct', 'Annualized return above', { suffix: '%', step: 1, min: 0 }),
]

const VERTICAL_FIELDS = [
  field('min_moneyness_pct', 'Moneyness from', { suffix: '%', step: 1 }),
  field('max_moneyness_pct', 'Moneyness to', { suffix: '%', step: 1 }),
  field('max_bid_ask_spread', 'Single-leg bid/ask below', { prefix: '$', step: 0.05, min: 0 }),
  field('min_prob_max_profit', 'Prob. max profit above', { suffix: '%', step: 1, min: 0, max: 100 }),
  field('max_prob_max_loss', 'Prob. max loss up to', { suffix: '%', step: 1, min: 0, max: 100 }),
  { key: 'require_positive_expected_value', label: 'Expected value', type: 'select', options: [['false', 'Any'], ['true', 'Profitable']] },
  field('min_profit_ratio_pct', 'Profit ratio from', { suffix: '%', step: 5, min: 0 }),
  field('max_profit_ratio_pct', 'Profit ratio to', { suffix: '%', step: 25, min: 0 }),
  field('min_max_profit_dollars', 'Max profit above', { prefix: '$', step: 25, min: 0 }),
  field('min_max_loss_dollars', 'Max loss from', { prefix: '$', step: 50, min: 0 }),
  field('max_max_loss_dollars', 'Max loss to', { prefix: '$', step: 50, min: 0 }),
]

const RANGE_FIELDS = [
  field('min_moneyness_pct', 'Moneyness from', { suffix: '%', step: 1 }),
  field('max_moneyness_pct', 'Moneyness to', { suffix: '%', step: 1 }),
  field('max_abs_position_delta', 'Position delta ±', { step: 1, min: 0, max: 100 }),
  field('min_prob_max_profit', 'Prob. max profit above', { suffix: '%', step: 1, min: 0, max: 100 }),
  field('max_prob_max_loss', 'Prob. max loss up to', { suffix: '%', step: 1, min: 0, max: 100 }),
  { key: 'require_positive_expected_value', label: 'Expected value', type: 'select', options: [['false', 'Any'], ['true', 'Profitable']] },
  field('min_profit_ratio_pct', 'Profit ratio from', { suffix: '%', step: 5, min: 0 }),
  field('max_profit_ratio_pct', 'Profit ratio to', { suffix: '%', step: 25, min: 0 }),
  field('min_max_profit_dollars', 'Max profit above', { prefix: '$', step: 25, min: 0 }),
  field('min_max_loss_dollars', 'Max loss from', { prefix: '$', step: 50, min: 0 }),
  field('max_max_loss_dollars', 'Max loss to', { prefix: '$', step: 50, min: 0 }),
]

const DIRECTIONAL_FIELDS = [
  field('min_moneyness_pct', 'Moneyness from', { suffix: '%', step: 1 }),
  field('max_moneyness_pct', 'Moneyness to', { suffix: '%', step: 1 }),
  field('max_bid_ask_spread', 'Bid/ask spread below', { prefix: '$', step: 0.05, min: 0 }),
  field('min_prob_max_profit', 'Prob. max profit above', { suffix: '%', step: 1, min: 0, max: 100 }),
  field('max_prob_max_loss', 'Prob. max loss up to', { suffix: '%', step: 1, min: 0, max: 100 }),
  { key: 'require_positive_expected_value', label: 'Expected value', type: 'select', options: [['false', 'Any'], ['true', 'Profitable']] },
  field('min_max_profit_dollars', 'Max profit above', { prefix: '$', step: 25, min: 0 }),
  field('min_max_loss_dollars', 'Max loss from', { prefix: '$', step: 50, min: 0 }),
  field('max_max_loss_dollars', 'Max loss to', { prefix: '$', step: 50, min: 0 }),
]

const CALENDAR_FIELDS = [
  field('min_moneyness_pct', 'Near-leg moneyness from', { suffix: '%', step: 1 }),
  field('max_moneyness_pct', 'Near-leg moneyness to', { suffix: '%', step: 1 }),
  field('far_target_dte', 'Far expiration target', { suffix: 'DTE', step: 1, min: 1 }),
  field('min_expiration_gap_days', 'Minimum expiration gap', { suffix: 'days', step: 1, min: 1 }),
  field('max_bid_ask_spread', 'Bid/ask spread below', { prefix: '$', step: 0.05, min: 0 }),
  field('min_prob_max_profit', 'Prob. max profit above', { suffix: '%', step: 1, min: 0, max: 100 }),
  field('max_prob_max_loss', 'Prob. max loss up to', { suffix: '%', step: 1, min: 0, max: 100 }),
  { key: 'require_positive_expected_value', label: 'Expected value', type: 'select', options: [['false', 'Any'], ['true', 'Profitable']] },
  field('max_max_loss_dollars', 'Max loss to', { prefix: '$', step: 50, min: 0 }),
]

const ADVANCED_FIELDS = [
  field('max_abs_position_delta', 'Position delta ±', { step: 1, min: 0, max: 100 }),
  field('min_max_loss_dollars', 'Max loss from', { prefix: '$', step: 50, min: 0 }),
  field('max_max_loss_dollars', 'Max loss to', { prefix: '$', step: 50, min: 0 }),
]

const choice = (key, label, options) => ({ key, label, type: 'select', options })
const yesNo = (key, label) => choice(key, label, [['false', 'No'], ['true', 'Yes']])
const text = (key, label, options = {}) => ({ key, label, type: 'text', ...options })

const PUT_CALL_CONDOR_FIELDS = [
  choice('option_side', 'Condor side', [['both', 'Put and Call'], ['put', 'Put only'], ['call', 'Call only']]),
  choice('placement_mode', 'Upper spread placement', [['slightly_otm', 'Slightly OTM'], ['atm', 'At the money']]),
  field('debit_otm_pct', 'Placement below stock', { suffix: '%', step: 0.25, min: 0 }),
  field('max_risk_dollars', 'Risk budget', { prefix: '$', step: 25, min: 25 }),
  field('credit_short_delta', 'Credit short delta', { step: 0.01, min: 0.01, max: 0.49 }),
  field('target_upper_credit_dollars', 'Target upper credit', { prefix: '$', step: 5, min: 0 }),
  field('max_upper_credit_dollars', 'Maximum upper credit', { prefix: '$', step: 5, min: 0 }),
  field('min_open_interest', 'Minimum open interest', { step: 10, min: 0 }),
]

const UNBALANCED_CONDOR_FIELDS = [
  choice('delta_preset', 'Delta preset', [['all', 'All'], ['15/5', 'Conservative (15/5)'], ['20/10', 'Balanced (20/10)'], ['25/15', 'Aggressive (25/15)']]),
  field('bought_width', 'Bought spread width', { prefix: '$', step: 0.5, min: 0.5 }),
  field('sold_width', 'Sold spread width', { prefix: '$', step: 0.5, min: 0.5 }),
  field('bought_quantity', 'Bought quantity', { step: 1, min: 1 }),
  field('sold_quantity', 'Sold quantity', { step: 1, min: 1 }),
  field('delta_tolerance', 'Leg delta tolerance', { step: 0.005, min: 0.005, max: 0.2 }),
  field('target_position_delta', 'Target position delta', { step: 0.5, min: -100, max: 100 }),
  field('position_delta_tolerance', 'Position delta tolerance', { step: 0.5, min: 0 }),
  field('width_tolerance_pct', 'Width tolerance', { suffix: '%', step: 1, min: 0 }),
  field('min_open_interest', 'Minimum open interest', { step: 10, min: 0 }),
  yesNo('require_upside_credit', 'Require upside credit'),
]

const UNBALANCED_BUTTERFLY_FIELDS = [
  choice('upper_long_delta', 'Upper long delta', [['both', 'Both presets'], ['20', '20 delta'], ['25', '25 delta']]),
  choice('market_bias', 'Market bias', [['neutral', 'Neutral'], ['bullish', 'Bullish'], ['bearish', 'Bearish']]),
  field('tranche_quantity', 'Tranche quantity', { step: 1, min: 1 }),
  field('delta_tolerance', 'Leg delta tolerance', { step: 0.005, min: 0.005, max: 0.2 }),
  field('target_theta_dollars', 'Target theta / day', { prefix: '$', step: 5 }),
  field('theta_tolerance_dollars', 'Theta tolerance', { prefix: '$', step: 5, min: 0 }),
  field('uel_tolerance_dollars', 'Upper expiration-line tolerance', { prefix: '$', step: 25, min: 0 }),
  field('min_lower_wing_ratio', 'Minimum lower-wing ratio', { step: 0.05, min: 1 }),
  field('min_open_interest', 'Minimum open interest', { step: 10, min: 0 }),
]

const DOUBLE_HEDGE_FIELDS = [
  choice('market_bias', 'Market bias', [['neutral', 'Neutral'], ['bullish', 'Bullish'], ['bearish', 'Bearish']]),
  field('tranche_quantity', 'Upper-long quantity', { step: 1, min: 1 }),
  field('delta_tolerance', 'Leg delta tolerance', { step: 0.0025, min: 0.0025, max: 0.1 }),
  field('min_theta_dollars', 'Minimum theta / day', { prefix: '$', step: 5 }),
  field('min_t0_minus_20_dollars', 'Minimum T+0 at −20%', { prefix: '$', step: 100 }),
  field('uel_tolerance_dollars', 'Upper expiration-line tolerance', { prefix: '$', step: 25, min: 0 }),
  field('min_lower_wing_ratio', 'Minimum lower-wing ratio', { step: 0.05, min: 1 }),
  field('min_open_interest', 'Minimum open interest', { step: 10, min: 0 }),
  choice('price_signal', 'Price signal', [['unconfirmed', 'Unconfirmed'], ['favorable', 'Favorable'], ['unfavorable', 'Unfavorable']]),
  choice('concavity_signal', 'Concavity signal', [['unconfirmed', 'Unconfirmed'], ['favorable', 'Favorable'], ['unfavorable', 'Unfavorable']]),
  choice('skew_signal', 'Skew signal', [['unconfirmed', 'Unconfirmed'], ['favorable', 'Favorable'], ['unfavorable', 'Unfavorable']]),
  field('campaign_planned_capital_dollars', 'Campaign capital', { prefix: '$', step: 5000, min: 0 }),
  field('planned_capital_per_tranche_dollars', 'Capital per tranche', { prefix: '$', step: 500, min: 0 }),
  field('open_tranches', 'Open tranches', { step: 1, min: 0 }),
]

const ROAD_TRIP_FIELDS = [
  choice('market_bias', 'Market bias', [['neutral', 'Neutral'], ['bullish', 'Bullish'], ['bearish', 'Bearish']]),
  field('tranche_quantity', 'Tranche quantity', { step: 1, min: 1 }),
  field('upper_offset_pct', 'Upper long below spot', { suffix: '%', step: 0.25, min: 0 }),
  field('offset_tolerance_pct', 'Placement tolerance', { suffix: '%', step: 0.25, min: 0 }),
  field('upper_wing_pct', 'Upper wing width', { suffix: '%', step: 0.25, min: 0 }),
  field('lower_wing_pct', 'Lower wing width', { suffix: '%', step: 0.25, min: 0 }),
  field('wing_tolerance_pct', 'Wing tolerance', { suffix: '%', step: 0.25, min: 0 }),
  field('min_lower_wing_ratio', 'Minimum lower-wing ratio', { step: 0.05, min: 1 }),
  field('max_debit_to_margin_pct', 'Debit / margin maximum', { suffix: '%', step: 0.5, min: 0 }),
  field('min_theta_dollars', 'Minimum theta / day', { prefix: '$', step: 1 }),
  field('profit_target_low_pct', 'Profit target from', { suffix: '%', step: 1, min: 0 }),
  field('profit_target_high_pct', 'Profit target to', { suffix: '%', step: 1, min: 0 }),
  field('max_loss_pct', 'Management max loss', { suffix: '%', step: 1, min: 0 }),
  field('exit_days_before_expiration', 'Exit before expiration', { suffix: 'days', step: 1, min: 0 }),
  field('hands_off_days', 'Hands-off period', { suffix: 'days', step: 1, min: 0 }),
  yesNo('require_favorable_entry_timing', 'Require favorable entry timing'),
  field('min_open_interest', 'Minimum open interest', { step: 10, min: 0 }),
]

const SIXTY_FORTY_TWENTY_FIELDS = [
  field('quantity', 'Structure quantity', { step: 1, min: 1 }),
  field('delta_tolerance', 'Leg delta tolerance', { step: 0.005, min: 0.005, max: 0.2 }),
  field('max_abs_net_delta', 'Maximum net delta ±', { step: 0.5, min: 0 }),
  field('delta_theta_caution_pct', 'Delta/theta caution', { suffix: '%', step: 5, min: 0 }),
  field('delta_theta_exit_pct', 'Delta/theta exit', { suffix: '%', step: 5, min: 0 }),
  field('exit_dte', 'Planned exit', { suffix: 'DTE', step: 1, min: 1 }),
  field('min_open_interest', 'Minimum open interest', { step: 10, min: 0 }),
  field('max_bid_ask_pct', 'Maximum bid/ask spread', { suffix: '%', step: 1, min: 0 }),
]

export const GENERAL_FILTER_HELP = {
  min_reference_delta: 'Lowest allowed absolute delta for the strategy\'s primary option leg. For covered calls, cash-secured puts, credit spreads, condors, calendars, and ratio spreads this is the short leg. A value of 10 means 0.10 delta.',
  max_reference_delta: 'Highest allowed absolute delta for the strategy\'s primary option leg. Lower short-option deltas are generally farther out of the money and have a higher chance of expiring worthless, but probability estimates are not guarantees.',
  min_moneyness_pct: 'Sets the lowest allowed strike distance from the stock price. Negative values are below the stock price; positive values are above it.',
  max_moneyness_pct: 'Sets the highest allowed strike distance from the stock price. It works with the lower moneyness value to define the strike-search range.',
  max_bid_ask_spread: 'Rejects option legs whose ask-minus-bid spread is wider than this dollar amount. Tighter spreads generally indicate better liquidity and more realistic fills.',
  min_return_pct: 'Requires at least this estimated return for the position over the selected expiration period.',
  min_annualized_return_pct: 'Requires the position return, scaled to a one-year rate, to meet this minimum. Annualizing a very short trade can produce a large-looking number.',
  min_prob_max_profit: 'Keeps structures whose modeled probability of finishing in the maximum-profit region is at least this percentage.',
  max_prob_max_loss: 'Rejects structures whose modeled probability of finishing in the maximum-loss region exceeds this percentage.',
  require_positive_expected_value: 'When set to Profitable, keeps only structures with modeled expected value above zero. Expected value weights expiration payoffs by their estimated probabilities.',
  min_profit_ratio_pct: 'Sets the minimum maximum-profit ÷ maximum-loss ratio. For example, 25% means $25 of maximum profit for each $100 of maximum loss.',
  max_profit_ratio_pct: 'Sets the upper bound for maximum-profit ÷ maximum-loss. This can exclude unusual quotes that create implausibly large ratios.',
  min_max_profit_dollars: 'Requires at least this much theoretical maximum profit at expiration for one complete strategy unit.',
  min_max_loss_dollars: 'Sets the smallest acceptable theoretical maximum loss at expiration. Leave it at zero if no lower risk bound is needed.',
  max_max_loss_dollars: 'Defines the most you are willing to lose on one complete trade at expiration, based on the selected pricing assumption.',
  max_abs_position_delta: 'Limits the absolute net delta of the complete position. A smaller value favors positions with less immediate directional exposure.',
  iron_condor_shape: 'Any allows all valid condors. Balanced requires equal put- and call-wing widths. Riskless Up or Down requires the collected credit to cover the loss on that side.',
  construction: 'Chooses the iron-condor construction: classic balanced, a directional tilt, a ratio, a Weirdor, the Jeep, or every supported variation.',
  variant_tickers: 'Underlyings used for non-standard iron-condor constructions. The default core set is SPY, QQQ, and IWM because the ratio and hedged forms need deep index-grade chains.',
  variant_width_pct: 'Target width of a non-standard iron-condor wing as a percentage of the underlying price.',
  tilt_strength: 'Controls how far a directional variant shifts its strikes toward the selected market view.',
  ratio_contracts: 'Number of contracts used on the heavier side of a ratio construction.',
  restrict_variants_to_core: 'When enabled, non-standard constructions use only the core index underlyings listed above.',
  butterfly_shape: 'Any allows all valid butterflies. Balanced requires matching wings; Riskless Up or Down requires the entry credit and wing geometry to remove expiration loss on that side.',
  option_side: 'Chooses whether the condor engine may build put condors, call condors, or compare both.',
  placement_mode: 'Controls where the upper spread is centered relative to the current stock price.',
  debit_otm_pct: 'Sets how far below the stock price the debit portion should be placed, measured as a percentage of the stock price.',
  max_risk_dollars: 'Caps the planned dollar risk for one complete structure.',
  credit_short_delta: 'Targets this absolute delta for the short option in the credit spread. Lower deltas are normally farther out of the money.',
  target_upper_credit_dollars: 'Preferred credit received from the upper spread. Candidates nearest this amount rank more favorably.',
  max_upper_credit_dollars: 'Rejects candidates whose upper-spread credit exceeds this amount, helping avoid distorted or overly risky quotes.',
  min_open_interest: 'Requires each relevant option leg to have at least this many open contracts.',
  delta_preset: 'Selects the saved conservative, balanced, or aggressive leg-delta pattern. All lets the scanner compare every available preset.',
  bought_width: 'Target strike width of the debit spread that is purchased.',
  sold_width: 'Target strike width of the credit spread that is sold.',
  bought_quantity: 'Number of purchased spread units in the unbalanced structure.',
  sold_quantity: 'Number of sold spread units in the unbalanced structure.',
  delta_tolerance: 'Maximum permitted difference between a target leg delta and the listed contract delta.',
  target_position_delta: 'Desired net delta for the complete position after all leg quantities are applied.',
  position_delta_tolerance: 'Allows the actual position delta to differ from the target by this amount.',
  width_tolerance_pct: 'Allows listed strike widths to differ from the requested widths by this percentage.',
  require_upside_credit: 'When enabled, the upper side must produce a net credit instead of a debit.',
  entry_credit_mode: 'Controls the opening cash flow for the index-only long-dated structures: debit or zero, zero through a small credit, or a positive credit.',
  upper_long_delta: 'Chooses the target delta for the upper long option, or compares both supported target presets.',
  market_bias: 'Applies the strategy engine’s neutral, bullish, or bearish placement preference.',
  tranche_quantity: 'Number of complete strategy units modeled for one entry tranche.',
  target_theta_dollars: 'Preferred daily time-decay benefit for the complete position.',
  theta_tolerance_dollars: 'Allows actual daily theta to differ from the target by this dollar amount.',
  min_theta_dollars: 'Requires at least this much modeled daily theta for the complete position.',
  uel_tolerance_dollars: 'Limits how far the upper expiration payoff line may be from the strategy’s target flat-line value.',
  min_lower_wing_ratio: 'Requires the lower wing to be at least this multiple of the upper wing. Values above 1 create an unbalanced fly.',
  min_t0_minus_20_dollars: 'Requires the modeled current-day payoff after a 20% underlying decline to stay above this dollar amount.',
  price_signal: 'Filters by the strategy’s price-entry signal. Unconfirmed does not require a favorable or unfavorable reading.',
  concavity_signal: 'Filters by the strategy’s volatility-surface concavity signal.',
  skew_signal: 'Filters by the strategy’s put/call volatility-skew signal.',
  campaign_planned_capital_dollars: 'Total capital reserved for the full multi-entry campaign.',
  planned_capital_per_tranche_dollars: 'Capital intended for each separate campaign entry.',
  open_tranches: 'Number of campaign tranches already open; used to enforce the remaining capital plan.',
  upper_offset_pct: 'Targets the upper long strike this percentage below the current stock price.',
  offset_tolerance_pct: 'Allows the actual upper-long placement to differ from its target by this percentage.',
  upper_wing_pct: 'Targets the upper butterfly wing width as a percentage of the stock price.',
  lower_wing_pct: 'Targets the lower butterfly wing width as a percentage of the stock price.',
  wing_tolerance_pct: 'Allows an actual wing width to differ from its target by this percentage.',
  max_debit_to_margin_pct: 'Caps the entry debit as a percentage of the position’s modeled margin requirement.',
  profit_target_low_pct: 'Lower end of the planned profit-taking range, measured against the strategy’s risk or capital basis.',
  profit_target_high_pct: 'Upper end of the planned profit-taking range.',
  max_loss_pct: 'Management stop threshold expressed as a percentage of the strategy’s risk or capital basis.',
  exit_days_before_expiration: 'Plans to close the position this many calendar days before expiration.',
  hands_off_days: 'Initial period after entry during which the management plan avoids adjustments.',
  require_favorable_entry_timing: 'When enabled, candidates must also pass the strategy engine’s entry-timing signal.',
  quantity: 'Number of complete 60/40/20 structures modeled in the trade.',
  max_abs_net_delta: 'Rejects structures whose total directional delta is farther from zero than this limit.',
  delta_theta_caution_pct: 'Flags the position when absolute delta reaches this percentage of theta.',
  delta_theta_exit_pct: 'Sets the planned exit threshold for the absolute delta-to-theta relationship.',
  exit_dte: 'Plans to exit when this many days remain before expiration.',
  max_bid_ask_pct: 'Rejects legs whose bid/ask width is larger than this percentage of the option mid price.',
  far_target_dte: 'For calendars and diagonals, this is the preferred days to expiration for the long back-month option.',
  min_expiration_gap_days: 'Requires at least this many calendar days between the short front-month option and the long back-month option.',
}

export function helpForGeneralField(fieldDefinition) {
  return fieldDefinition.help || GENERAL_FILTER_HELP[fieldDefinition.key]
    || `Controls the ${fieldDefinition.label.toLowerCase()} rule used to build and filter this strategy.`
}

export const GENERAL_STRATEGY_CONFIG = {
  'covered-call': {
    bidAsk: 'Conservative (use bid/ask values)',
    defaults: { min_moneyness_pct: -15, max_moneyness_pct: 15, max_bid_ask_spread: 0.5, min_return_pct: 1, min_annualized_return_pct: 5 },
    fields: INCOME_FIELDS,
  },
  'cash-secured-put': {
    bidAsk: 'Conservative (use bid/ask values)',
    defaults: { market_trend: 'uptrend', underlying_trend: 'uptrend', recent_move_direction: 'down', min_moneyness_pct: -15, max_moneyness_pct: 15, max_bid_ask_spread: 0.5, min_return_pct: 1, min_annualized_return_pct: 5 },
    fields: INCOME_FIELDS,
  },
  'naked-call': {
    bidAsk: 'Conservative (use bid/ask values)',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -2, max_moneyness_pct: 15, max_bid_ask_spread: 0.5, min_prob_max_profit: 50, max_prob_max_loss: 100, require_positive_expected_value: false, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: null },
    fields: DIRECTIONAL_FIELDS,
  },
  'long-call': {
    bidAsk: 'Conservative (use bid/ask values)',
    defaults: { max_iv_rank: 75, min_moneyness_pct: -15, max_moneyness_pct: 15, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 100, require_positive_expected_value: false, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: DIRECTIONAL_FIELDS,
  },
  'long-put': {
    bidAsk: 'Conservative (use bid/ask values)',
    defaults: { max_iv_rank: 75, min_moneyness_pct: -15, max_moneyness_pct: 15, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 100, require_positive_expected_value: false, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: DIRECTIONAL_FIELDS,
  },
  'married-put': {
    bidAsk: 'Conservative (use bid/ask values)',
    defaults: { max_iv_rank: 75, min_moneyness_pct: -15, max_moneyness_pct: 0, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 100, require_positive_expected_value: false, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 1500 },
    fields: DIRECTIONAL_FIELDS,
  },
  'married-call': {
    bidAsk: 'Conservative (use bid/ask values)',
    defaults: { max_iv_rank: 75, min_moneyness_pct: 0, max_moneyness_pct: 15, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 100, require_positive_expected_value: false, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 1500 },
    fields: DIRECTIONAL_FIELDS,
  },
  'bull-put-spread': {
    bidAsk: '25% price improvement',
    defaults: { market_trend: 'uptrend', underlying_trend: 'uptrend', recent_move_direction: 'down', min_iv_rank: 20, min_moneyness_pct: -25, max_moneyness_pct: 0, max_bid_ask_spread: 0.5, min_prob_max_profit: 60, max_prob_max_loss: 20, require_positive_expected_value: false, min_profit_ratio_pct: 20, max_profit_ratio_pct: 500, min_max_profit_dollars: 50, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: VERTICAL_FIELDS,
  },
  'bear-call-spread': {
    bidAsk: 'Mid',
    defaults: { min_iv_rank: 20, min_moneyness_pct: 0, max_moneyness_pct: 25, max_bid_ask_spread: 0.5, min_prob_max_profit: 50, max_prob_max_loss: 30, require_positive_expected_value: true, min_profit_ratio_pct: 50, max_profit_ratio_pct: 500, min_max_profit_dollars: 50, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: VERTICAL_FIELDS,
  },
  'bear-put-spread': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 0, max_iv_rank: 75, min_moneyness_pct: -100, max_moneyness_pct: 0, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 80, require_positive_expected_value: true, min_profit_ratio_pct: 100, max_profit_ratio_pct: 1500, min_max_profit_dollars: 50, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: VERTICAL_FIELDS,
  },
  'bull-call-spread': {
    bidAsk: '25% price improvement',
    defaults: { max_iv_rank: 75, min_moneyness_pct: -15, max_moneyness_pct: 15, max_bid_ask_spread: 0.5, min_prob_max_profit: 50, max_prob_max_loss: 10, require_positive_expected_value: false, min_profit_ratio_pct: 20, max_profit_ratio_pct: 500, min_max_profit_dollars: 50, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: VERTICAL_FIELDS,
  },
  'long-straddle': {
    bidAsk: '25% price improvement',
    defaults: { max_iv_rank: 75, min_moneyness_pct: -2, max_moneyness_pct: 2, max_abs_position_delta: 20, min_prob_max_profit: 25, max_prob_max_loss: 100, require_positive_expected_value: false, min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 1000 },
    fields: RANGE_FIELDS,
  },
  'long-strangle': {
    bidAsk: '25% price improvement',
    defaults: { max_iv_rank: 75, min_moneyness_pct: -15, max_moneyness_pct: 15, max_abs_position_delta: 20, min_prob_max_profit: 25, max_prob_max_loss: 100, require_positive_expected_value: false, min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 1000 },
    fields: RANGE_FIELDS,
  },
  'short-straddle': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -2, max_moneyness_pct: 2, max_abs_position_delta: 20, min_prob_max_profit: 50, max_prob_max_loss: 100, require_positive_expected_value: true, min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 50, min_max_loss_dollars: 0, max_max_loss_dollars: null },
    fields: RANGE_FIELDS,
  },
  'short-strangle': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -15, max_moneyness_pct: 15, max_abs_position_delta: 20, min_prob_max_profit: 50, max_prob_max_loss: 100, require_positive_expected_value: true, min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 50, min_max_loss_dollars: 0, max_max_loss_dollars: null },
    fields: RANGE_FIELDS,
  },
  'call-butterfly': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -2, max_moneyness_pct: 15, max_abs_position_delta: 10, min_prob_max_profit: 30, max_prob_max_loss: 90, require_positive_expected_value: true, butterfly_shape: 'balanced', min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: [...RANGE_FIELDS, { key: 'butterfly_shape', label: 'Butterfly shape', type: 'select', options: [['any', 'Any'], ['balanced', 'Balanced'], ['riskless_up', 'Riskless up'], ['riskless_down', 'Riskless down']] }],
  },
  'put-butterfly': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -15, max_moneyness_pct: 0, max_abs_position_delta: 10, min_prob_max_profit: 30, max_prob_max_loss: 90, require_positive_expected_value: true, butterfly_shape: 'balanced', min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: [...RANGE_FIELDS, { key: 'butterfly_shape', label: 'Butterfly shape', type: 'select', options: [['any', 'Any'], ['balanced', 'Balanced'], ['riskless_up', 'Riskless up'], ['riskless_down', 'Riskless down']] }],
  },
  'iron-condor': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -20, max_moneyness_pct: 20, max_abs_position_delta: 10, min_prob_max_profit: 60, max_prob_max_loss: 90, require_positive_expected_value: true, iron_condor_shape: 'balanced', construction: 'balanced', market_bias: 'neutral', variant_width_pct: 5, tilt_strength: 0.25, ratio_contracts: 2, variant_tickers: 'SPY,QQQ,IWM', restrict_variants_to_core: true, min_profit_ratio_pct: 0, max_profit_ratio_pct: 500, min_max_profit_dollars: 100, min_max_loss_dollars: 300, max_max_loss_dollars: 1000 },
    fields: [
      ...RANGE_FIELDS,
      { key: 'iron_condor_shape', label: 'Iron Condor shape', type: 'select', options: [['any', 'Any'], ['balanced', 'Balanced'], ['riskless_up', 'Riskless up'], ['riskless_down', 'Riskless down']] },
      choice('construction', 'Structure', [
        ['balanced', 'Balanced'], ['strike_tilt', 'Strike tilt'], ['ratio_tilt', 'Ratio tilt'],
        ['risk_ratio', 'Centred ratio'], ['weirdor_ratio', 'Weirdor'],
        ['weirdor_hedged', 'Weirdor (hedged)'], ['jeep', 'Jeep'], ['all', 'All variations'],
      ]),
      choice('market_bias', 'Market view', [['neutral', 'Neutral'], ['bullish', 'Bullish'], ['bearish', 'Bearish']]),
      text('variant_tickers', 'Variant tickers', { placeholder: 'SPY, QQQ, IWM' }),
      field('variant_width_pct', 'Variant width', { suffix: '% spot', step: 0.25, min: 0.5, max: 25 }),
      field('tilt_strength', 'Tilt strength', { step: 0.05, min: 0, max: 0.75 }),
      field('ratio_contracts', 'Ratio contracts', { step: 1, min: 2, max: 5 }),
      yesNo('restrict_variants_to_core', 'Core index variants only'),
    ],
  },
  'iron-butterfly': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -15, max_moneyness_pct: 15, max_abs_position_delta: 10, min_prob_max_profit: 30, max_prob_max_loss: 90, require_positive_expected_value: true, butterfly_shape: 'balanced', min_profit_ratio_pct: 0, max_profit_ratio_pct: 500, min_max_loss_dollars: 0, max_max_loss_dollars: 500 },
    fields: [...RANGE_FIELDS, { key: 'butterfly_shape', label: 'Butterfly shape', type: 'select', options: [['any', 'Any'], ['balanced', 'Balanced'], ['riskless_up', 'Riskless up'], ['riskless_down', 'Riskless down']] }],
  },
  'long-call-calendar': {
    bidAsk: '25% price improvement',
    defaults: { max_iv_rank: 75, min_dte: 14, target_dte: 30, max_dte: 60, min_moneyness_pct: -5, max_moneyness_pct: 5, far_target_dte: 90, min_expiration_gap_days: 21, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 90, require_positive_expected_value: true, max_max_loss_dollars: 1000 },
    fields: CALENDAR_FIELDS,
  },
  'long-put-calendar': {
    bidAsk: '25% price improvement',
    defaults: { max_iv_rank: 75, min_dte: 14, target_dte: 30, max_dte: 60, min_moneyness_pct: -5, max_moneyness_pct: 5, far_target_dte: 90, min_expiration_gap_days: 21, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 90, require_positive_expected_value: true, max_max_loss_dollars: 1000 },
    fields: CALENDAR_FIELDS,
  },
  'long-call-diagonal': {
    bidAsk: '25% price improvement',
    defaults: { max_iv_rank: 75, min_dte: 14, target_dte: 30, max_dte: 60, min_moneyness_pct: -10, max_moneyness_pct: 10, far_target_dte: 90, min_expiration_gap_days: 21, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 90, require_positive_expected_value: true, max_max_loss_dollars: 1000 },
    fields: CALENDAR_FIELDS,
  },
  'long-put-diagonal': {
    bidAsk: '25% price improvement',
    defaults: { max_iv_rank: 75, min_dte: 14, target_dte: 30, max_dte: 60, min_moneyness_pct: -10, max_moneyness_pct: 10, far_target_dte: 90, min_expiration_gap_days: 21, max_bid_ask_spread: 0.5, min_prob_max_profit: 25, max_prob_max_loss: 90, require_positive_expected_value: true, max_max_loss_dollars: 1000 },
    fields: CALENDAR_FIELDS,
  },
  'collar': {
    bidAsk: '25% price improvement',
    defaults: { min_moneyness_pct: -15, max_moneyness_pct: 15, max_abs_position_delta: 100, min_prob_max_profit: 25, max_prob_max_loss: 90, require_positive_expected_value: false, min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 0, min_max_loss_dollars: 0, max_max_loss_dollars: 1500 },
    fields: RANGE_FIELDS,
  },
  'call-ratio-spread': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -2, max_moneyness_pct: 15, max_abs_position_delta: 100, min_prob_max_profit: 40, max_prob_max_loss: 100, require_positive_expected_value: false, min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 50, min_max_loss_dollars: 0, max_max_loss_dollars: null },
    fields: RANGE_FIELDS,
  },
  'put-ratio-spread': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, min_moneyness_pct: -15, max_moneyness_pct: 0, max_abs_position_delta: 100, min_prob_max_profit: 40, max_prob_max_loss: 100, require_positive_expected_value: false, min_profit_ratio_pct: 0, max_profit_ratio_pct: 1500, min_max_profit_dollars: 50, min_max_loss_dollars: 0, max_max_loss_dollars: 2500 },
    fields: RANGE_FIELDS,
  },
  'unbalanced-butterfly': {
    bidAsk: '25% price improvement',
    defaults: { min_iv_rank: 25, target_dte: 160, min_dte: 120, max_dte: 240, min_moneyness_pct: -100, max_moneyness_pct: 0, max_abs_position_delta: 10, min_prob_max_profit: 30, max_prob_max_loss: 90, require_positive_expected_value: true, butterfly_shape: 'balanced', min_profit_ratio_pct: 0, max_profit_ratio_pct: 500, min_max_loss_dollars: 0, max_max_loss_dollars: 500, upper_long_delta: 'both', market_bias: 'neutral', tranche_quantity: 4, delta_tolerance: 0.035, target_theta_dollars: 20, theta_tolerance_dollars: 15, uel_tolerance_dollars: 250, min_lower_wing_ratio: 1.05, min_open_interest: 0 },
    fields: [...RANGE_FIELDS, { key: 'butterfly_shape', label: 'Butterfly shape', type: 'select', options: [['any', 'Any'], ['balanced', 'Balanced'], ['riskless_up', 'Riskless up'], ['riskless_down', 'Riskless down']] }, ...UNBALANCED_BUTTERFLY_FIELDS],
  },
  'put-call-condor': { bidAsk: '25% price improvement', defaults: { target_dte: 42, min_dte: 30, max_dte: 60, option_side: 'both', placement_mode: 'slightly_otm', debit_otm_pct: 0.5, max_risk_dollars: 200, credit_short_delta: 0.15, target_upper_credit_dollars: 10, max_upper_credit_dollars: 25, min_open_interest: 0 }, fields: PUT_CALL_CONDOR_FIELDS },
  'unbalanced-put-condor': { bidAsk: '25% price improvement', defaults: { target_dte: 160, min_dte: 120, max_dte: 240, delta_preset: 'all', bought_width: 5, sold_width: 10, bought_quantity: 1, sold_quantity: 1, delta_tolerance: 0.04, target_position_delta: 0, position_delta_tolerance: 2, width_tolerance_pct: 20, min_open_interest: 0, require_upside_credit: false }, fields: UNBALANCED_CONDOR_FIELDS },
  'double-hedge-put-butterfly': { bidAsk: 'Mid', defaults: { target_dte: 200, min_dte: 160, max_dte: 230, market_bias: 'neutral', tranche_quantity: 4, delta_tolerance: 0.02, min_theta_dollars: 10, min_t0_minus_20_dollars: -10000, uel_tolerance_dollars: 250, min_lower_wing_ratio: 1.05, min_open_interest: 0, price_signal: 'unconfirmed', concavity_signal: 'unconfirmed', skew_signal: 'unconfirmed', campaign_planned_capital_dollars: 150000, planned_capital_per_tranche_dollars: 12500, open_tranches: 0 }, fields: DOUBLE_HEDGE_FIELDS },
  'road-trip-butterfly': { bidAsk: 'Mid', defaults: { target_dte: 77, min_dte: 70, max_dte: 85, market_bias: 'neutral', tranche_quantity: 5, upper_offset_pct: 1.25, offset_tolerance_pct: 0.75, upper_wing_pct: 2.25, lower_wing_pct: 2.75, wing_tolerance_pct: 1, min_lower_wing_ratio: 1.05, max_debit_to_margin_pct: 5, min_theta_dollars: 1, profit_target_low_pct: 7, profit_target_high_pct: 15, max_loss_pct: 5, exit_days_before_expiration: 17, hands_off_days: 25, require_favorable_entry_timing: false, min_open_interest: 0 }, fields: ROAD_TRIP_FIELDS },
  'sixty-forty-twenty-fly': { bidAsk: 'Mid', defaults: { target_dte: 70, min_dte: 60, max_dte: 80, quantity: 1, delta_tolerance: 0.03, max_abs_net_delta: 5, delta_theta_caution_pct: 50, delta_theta_exit_pct: 60, exit_dte: 30, min_open_interest: 0, max_bid_ask_pct: 35 }, fields: SIXTY_FORTY_TWENTY_FIELDS },
}

export function strategyDefaultsForGeneralStrategy(strategy) {
  const config = GENERAL_STRATEGY_CONFIG[strategy] || GENERAL_STRATEGY_CONFIG['iron-condor']
  const result = { ...COMMON, bid_ask_level: config.bidAsk, ...config.defaults }
  if (isIndexOnlyStrategy(strategy)) {
    Object.assign(result, {
      include_stocks: false,
      include_index_etfs: true,
      include_sector_etfs: false,
      entry_credit_mode: 'any',
      entry_credit_max_points: 0.5,
    })
  }
  return result
}

export function defaultsForGeneralStrategy(strategy) {
  return { ...strategyDefaultsForGeneralStrategy(strategy), ...OPEN_FILTERS }
}

export function riskProfileDefaultsForGeneralStrategy(strategy, profileKey) {
  const profile = GENERAL_RISK_PROFILES[profileKey] || GENERAL_RISK_PROFILES.moderate
  const config = GENERAL_STRATEGY_CONFIG[strategy] || GENERAL_STRATEGY_CONFIG['iron-condor']
  const result = strategyDefaultsForGeneralStrategy(strategy)
  const fieldKeys = new Set(config.fields.map(item => item.key))
  const isShortDelta = SHORT_DELTA_STRATEGIES.has(strategy)
  const isLongDelta = LONG_DELTA_STRATEGIES.has(strategy)
  const deltaBand = isShortDelta ? profile.shortBand : isLongDelta ? profile.longBand : [0, 100]
  const intensity = profileKey === 'risk_averse' ? 0 : profileKey === 'aggressive' ? 2 : 1
  const quality = [
    { fundamental: 6, growth: 5, technical: 6, volume: 5000 },
    { fundamental: 5, growth: 4, technical: 5, volume: 2500 },
    { fundamental: 3, growth: 3, technical: 4, volume: 1000 },
  ][intensity]

  Object.assign(result, {
    risk_profile: profileKey,
    reference_delta_mode: isShortDelta ? 'short' : isLongDelta ? 'long' : 'none',
    min_reference_delta: deltaBand[0],
    max_reference_delta: deltaBand[1],
    min_total_option_volume: quality.volume,
    stock_score_fundamental_min: quality.fundamental,
    stock_score_fundamental_max: 10,
    stock_score_growth_min: quality.growth,
    stock_score_growth_max: 10,
    stock_score_technical_min: quality.technical,
    stock_score_technical_max: 10,
    min_market_cap: [10e9, 5e9, 2e9][intensity],
    fund_min_aum: [2e9, 500e6, 200e6][intensity],
    min_avg_dollar_volume: [50e6, 25e6, 10e6][intensity],
    min_open_interest: [250, 100, 0][intensity],
    min_skew_rank: 0,
    max_skew_rank: 100,
  })

  if (PREMIUM_SELLING_STRATEGIES.has(strategy)) {
    result.min_iv_rank = [40, 25, 15][intensity]
    result.max_iv_rank = 100
    result.min_volatility_score = [50, 35, 0][intensity]
    result.max_volatility_score = 100
    result.exclude_earnings_before_expiry = true
    if (intensity === 0) result.bid_ask_level = 'Conservative (use bid/ask values)'
  } else if (PREMIUM_BUYING_STRATEGIES.has(strategy)) {
    result.min_iv_rank = 0
    result.max_iv_rank = [50, 75, 100][intensity]
    result.min_volatility_score = 0
    result.max_volatility_score = [50, 70, 100][intensity]
    result.exclude_earnings_before_expiry = intensity === 0
  } else {
    result.exclude_earnings_before_expiry = intensity === 0
  }

  if (BULLISH_PULLBACK_STRATEGIES.has(strategy)) {
    Object.assign(result, intensity === 0
      ? { market_trend: 'uptrend', underlying_trend: 'uptrend', recent_move_direction: 'down', min_abs_recent_move_pct: 0.5, technical_rsi_min: 35, technical_rsi_max: 60 }
      : intensity === 1
        ? { market_trend: 'any', underlying_trend: 'uptrend', recent_move_direction: 'any', min_abs_recent_move_pct: 0, technical_rsi_min: 30, technical_rsi_max: 70 }
        : { market_trend: 'any', underlying_trend: 'any', recent_move_direction: 'any', min_abs_recent_move_pct: 0, technical_rsi_min: 0, technical_rsi_max: 100 })
  } else if (BEARISH_RALLY_STRATEGIES.has(strategy)) {
    Object.assign(result, intensity === 0
      ? { market_trend: 'downtrend', underlying_trend: 'downtrend', recent_move_direction: 'up', min_abs_recent_move_pct: 0.5, technical_rsi_min: 40, technical_rsi_max: 65 }
      : intensity === 1
        ? { market_trend: 'any', underlying_trend: 'downtrend', recent_move_direction: 'any', min_abs_recent_move_pct: 0, technical_rsi_min: 30, technical_rsi_max: 70 }
        : { market_trend: 'any', underlying_trend: 'any', recent_move_direction: 'any', min_abs_recent_move_pct: 0, technical_rsi_min: 0, technical_rsi_max: 100 })
  } else {
    Object.assign(result, { market_trend: 'any', underlying_trend: 'any', recent_move_direction: 'any', min_abs_recent_move_pct: 0, technical_rsi_min: intensity === 0 ? 25 : 0, technical_rsi_max: intensity === 0 ? 75 : 100 })
  }

  if (fieldKeys.has('max_bid_ask_spread')) result.max_bid_ask_spread = [0.35, 0.5, 0.75][intensity]
  if (fieldKeys.has('max_max_loss_dollars') && result.max_max_loss_dollars != null) {
    result.max_max_loss_dollars = [500, 1000, 2500][intensity]
  }
  if (fieldKeys.has('require_positive_expected_value')) {
    result.require_positive_expected_value = intensity === 0 ? true : intensity === 2 ? false : Boolean(result.require_positive_expected_value)
  }
  if (fieldKeys.has('min_prob_max_profit')) {
    if (isShortDelta) result.min_prob_max_profit = [65, 55, 40][intensity]
    else if (isLongDelta) result.min_prob_max_profit = [35, 25, 15][intensity]
  }
  if (fieldKeys.has('max_prob_max_loss')) {
    if (isShortDelta) result.max_prob_max_loss = [25, 40, 60][intensity]
    else if (isLongDelta) result.max_prob_max_loss = [70, 85, 100][intensity]
  }
  if (fieldKeys.has('max_abs_position_delta') && !isShortDelta && !isLongDelta) {
    result.max_abs_position_delta = [10, 20, 100][intensity]
  }

  if (strategy === 'put-call-condor') result.credit_short_delta = profile.target / 100
  if (strategy === 'unbalanced-put-condor') result.delta_preset = ['15/5', '20/10', '25/15'][intensity]
  if (isIndexOnlyStrategy(strategy)) {
    Object.assign(result, {
      entry_credit_mode: ['debit_or_flat', 'flat_or_slight_credit', 'credit'][intensity],
      entry_credit_max_points: 0.5,
    })
    if (fieldKeys.has('market_bias')) result.market_bias = ['bearish', 'neutral', 'bullish'][intensity]
    if (fieldKeys.has('upper_long_delta')) result.upper_long_delta = ['20', 'both', '25'][intensity]
    if (fieldKeys.has('delta_preset')) result.delta_preset = ['15/5', '20/10', '25/15'][intensity]
    if (fieldKeys.has('target_position_delta')) result.target_position_delta = [-1, 0, 0][intensity]
    if (fieldKeys.has('require_upside_credit')) result.require_upside_credit = intensity === 2
    if (strategy === 'road-trip-butterfly' && fieldKeys.has('upper_offset_pct')) {
      result.upper_offset_pct = [2, 1.25, 0.75][intensity]
    }
  }
  return result
}

export function setupDefaultsForGeneralStrategy(strategy, setupKey) {
  if (!setupAppliesToStrategy(setupKey, strategy)) {
    return defaultsForGeneralStrategy(strategy)
  }
  const result = riskProfileDefaultsForGeneralStrategy(strategy, 'moderate')
  result.risk_profile = setupKey
  const config = GENERAL_STRATEGY_CONFIG[strategy] || GENERAL_STRATEGY_CONFIG['iron-condor']
  const fieldKeys = new Set(config.fields.map(item => item.key))

  if (setupKey === 'pullback_uptrend') {
    Object.assign(result, {
      market_trend: 'uptrend',
      underlying_trend: 'uptrend',
      recent_move_direction: 'down',
      recent_move_lookback: 5,
      min_abs_recent_move_pct: 1,
      technical_rsi_min: 30,
      technical_rsi_max: 55,
    })
  } else if (setupKey === 'rally_downtrend') {
    Object.assign(result, {
      market_trend: 'downtrend',
      underlying_trend: 'downtrend',
      recent_move_direction: 'up',
      recent_move_lookback: 5,
      min_abs_recent_move_pct: 1,
      technical_rsi_min: 45,
      technical_rsi_max: 70,
    })
  } else if (setupKey === 'high_iv') {
    result.min_iv_rank = 40
    result.max_iv_rank = 100
    result.min_volatility_score = 50
    result.max_volatility_score = 100
    result.exclude_earnings_before_expiry = true
    if (fieldKeys.has('max_bid_ask_spread')) result.max_bid_ask_spread = 0.35
    result.min_total_option_volume = Math.max(Number(result.min_total_option_volume) || 0, 2500)
  } else if (setupKey === 'cheap_iv') {
    result.min_iv_rank = 0
    result.max_iv_rank = 50
    result.min_volatility_score = 0
    result.max_volatility_score = 50
  } else if (setupKey === 'weeklies') {
    result.min_dte = 5
    result.target_dte = 10
    result.max_dte = 14
  } else if (setupKey === 'monthlies') {
    result.min_dte = 21
    result.target_dte = 35
    result.max_dte = 45
  } else if (setupKey === 'core_indexes') {
    result.symbols = ''
    result.include_stocks = false
    result.include_index_etfs = true
    result.include_sector_etfs = false
    result.include_commodity_etfs = false
    result.index_tickers = CORE_INDEX_TICKERS
  } else if (setupKey === 'my_holdings') {
    result.symbols = ''
    result.universe = 'holdings'
    result.include_stocks = true
    result.include_index_etfs = false
    result.include_sector_etfs = false
    result.include_commodity_etfs = false
    result.require_shares_held = strategy === 'covered-call'
    result.respect_cost_basis = strategy === 'covered-call'
  }
  return result
}

export function fieldsForGeneralStrategy(strategy) {
  return GENERAL_STRATEGY_CONFIG[strategy]?.fields || ADVANCED_FIELDS
}
