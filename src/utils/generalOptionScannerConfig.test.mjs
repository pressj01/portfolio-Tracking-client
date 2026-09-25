import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CORE_INDEX_TICKERS,
  defaultsForGeneralStrategy,
  DOUBLE_HEDGE_SIZES,
  doubleHedgeCashFlowText,
  earningsInTradeState,
  effectiveGeneralFilters,
  favorableSkewFilters,
  fieldsForGeneralStrategy,
  GENERAL_STRATEGY_CONFIG,
  helpForGeneralField,
  isIndexOnlyStrategy,
  isStructureChoice,
  MAX_OPTION_DTE,
  MIN_OPTION_DTE,
  riskProfileDefaultsForGeneralStrategy,
  setupAppliesToStrategy,
  setupDefaultsForGeneralStrategy,
  setupsForGeneralStrategy,
  strategyDefaultsForGeneralStrategy,
  updateDteFilters,
  updateStrategyFilter,
} from './generalOptionScannerConfig.js'

const DOUBLE_HEDGE = 'double-hedge-put-butterfly'
const perPositionRules = filters => ({
  theta: filters.min_theta_dollars,
  t0: filters.min_t0_minus_20_dollars,
  capital: filters.planned_capital_per_tranche_dollars,
  amount: filters.upper_line_amount_dollars,
})

test('every strategy receives the shared DTE filter values', () => {
  for (const strategy of Object.keys(GENERAL_STRATEGY_CONFIG)) {
    const filters = defaultsForGeneralStrategy(strategy)
    assert.equal(Number.isFinite(filters.min_dte), true, `${strategy} minimum DTE`)
    assert.equal(Number.isFinite(filters.target_dte), true, `${strategy} target DTE`)
    assert.equal(Number.isFinite(filters.max_dte), true, `${strategy} maximum DTE`)
    assert.ok(filters.min_dte >= MIN_OPTION_DTE, `${strategy} minimum is supported`)
    assert.ok(filters.max_dte <= MAX_OPTION_DTE, `${strategy} maximum is supported`)
  }
})

test('DTE filters support same-day through three-year expirations', () => {
  let filters = { min_dte: 7, target_dte: 30, max_dte: 45 }
  filters = updateDteFilters(filters, 'target_dte', MIN_OPTION_DTE)
  assert.deepEqual(filters, { min_dte: 0, target_dte: 0, max_dte: 45 })
  filters = updateDteFilters(filters, 'max_dte', MIN_OPTION_DTE)
  assert.deepEqual(filters, { min_dte: 0, target_dte: 0, max_dte: 0 })
  filters = updateDteFilters(filters, 'target_dte', MAX_OPTION_DTE)
  assert.deepEqual(filters, { min_dte: 0, target_dte: 1095, max_dte: 1095 })
  filters = updateDteFilters(filters, 'min_dte', MAX_OPTION_DTE)
  assert.deepEqual(filters, { min_dte: 1095, target_dte: 1095, max_dte: 1095 })
})

test('credit vertical presets retain their different directional rules', () => {
  const bull = strategyDefaultsForGeneralStrategy('bull-put-spread')
  const bear = strategyDefaultsForGeneralStrategy('bear-call-spread')
  assert.deepEqual([bull.min_moneyness_pct, bull.max_moneyness_pct], [-25, 0])
  assert.deepEqual([bear.min_moneyness_pct, bear.max_moneyness_pct], [0, 25])
  assert.equal(bull.min_prob_max_profit, 60)
  assert.equal(bear.min_prob_max_profit, 50)
})

test('bear put preset matches the Samurai-style risk and IV bounds', () => {
  const preset = strategyDefaultsForGeneralStrategy('bear-put-spread')
  assert.equal(preset.max_iv_rank, 75)
  assert.equal(preset.max_moneyness_pct, 0)
  assert.equal(preset.min_prob_max_profit, 25)
  assert.equal(preset.max_prob_max_loss, 80)
  assert.equal(preset.min_profit_ratio_pct, 100)
  assert.equal(preset.max_profit_ratio_pct, 1500)
  assert.equal(preset.min_max_profit_dollars, 50)
  assert.equal(preset.max_max_loss_dollars, 500)
})

test('strategy changes replace the strategy-specific input schema', () => {
  const income = fieldsForGeneralStrategy('covered-call').map(field => field.key)
  const condor = fieldsForGeneralStrategy('iron-condor').map(field => field.key)
  assert.ok(income.includes('min_return_pct'))
  assert.ok(!income.includes('iron_condor_shape'))
  assert.ok(condor.includes('iron_condor_shape'))
})

test('shared scan defaults separate core indexes from commodities', () => {
  const defaults = defaultsForGeneralStrategy('covered-call')
  assert.equal(defaults.index_tickers, 'SPY,QQQ,IWM')
  assert.equal(defaults.include_index_etfs, true)
  assert.equal(defaults.include_commodity_etfs, false)
})

test('iron condor exposes every supported construction', () => {
  const fields = fieldsForGeneralStrategy('iron-condor')
  const construction = fields.find(field => field.key === 'construction')
  const values = construction.options.map(([value]) => value)
  assert.deepEqual(values, ['balanced', 'strike_tilt', 'ratio_tilt', 'risk_ratio', 'weirdor_ratio', 'weirdor_hedged', 'jeep', 'all'])
  assert.equal(strategyDefaultsForGeneralStrategy('iron-condor').variant_tickers, 'SPY,QQQ,IWM')
})

test('bull call preset matches the supplied Samurai-style debit spread screen', () => {
  const preset = strategyDefaultsForGeneralStrategy('bull-call-spread')
  assert.equal(preset.max_iv_rank, 75)
  assert.deepEqual([preset.min_moneyness_pct, preset.max_moneyness_pct], [-15, 15])
  assert.equal(preset.min_prob_max_profit, 50)
  assert.equal(preset.max_prob_max_loss, 10)
  assert.equal(preset.require_positive_expected_value, false)
  assert.deepEqual([preset.min_profit_ratio_pct, preset.max_profit_ratio_pct], [20, 500])
  assert.equal(preset.min_max_profit_dollars, 50)
  assert.equal(preset.max_max_loss_dollars, 500)
})

test('call and put butterflies use directional moneyness with probability controls', () => {
  const call = strategyDefaultsForGeneralStrategy('call-butterfly')
  const put = strategyDefaultsForGeneralStrategy('put-butterfly')
  assert.deepEqual([call.min_moneyness_pct, call.max_moneyness_pct], [-2, 15])
  assert.deepEqual([put.min_moneyness_pct, put.max_moneyness_pct], [-15, 0])
  assert.equal(call.min_prob_max_profit, 30)
  assert.equal(call.butterfly_shape, 'balanced')
  assert.ok(fieldsForGeneralStrategy('call-butterfly').some(field => field.key === 'butterfly_shape'))
})

test('calendar strategies expose the second expiration controls', () => {
  const keys = fieldsForGeneralStrategy('long-call-calendar').map(field => field.key)
  assert.ok(keys.includes('far_target_dte'))
  assert.ok(keys.includes('min_expiration_gap_days'))
})

test('new scans start open while keeping construction defaults', () => {
  const open = defaultsForGeneralStrategy('bull-put-spread')
  assert.deepEqual([open.min_moneyness_pct, open.max_moneyness_pct], [-25, 0])
  assert.equal(open.bid_ask_level, '25% price improvement')
  assert.equal(open.market_trend, 'any')
  assert.equal(open.underlying_trend, 'any')
  assert.equal(open.recent_move_direction, 'any')
  assert.equal(open.min_total_option_volume, 0)
  assert.equal(open.min_iv_rank, 0)
  assert.equal(open.min_prob_max_profit, 0)
  assert.equal(open.max_prob_max_loss, 100)
  assert.equal(open.max_max_loss_dollars, null)
  assert.equal(open.earnings_in_trade, 'any')
  assert.equal(open.exclude_earnings_before_expiry, false)
  assert.equal(open.require_earnings_before_expiry, false)
  assert.equal(open.min_market_cap, 0)
  assert.equal(open.min_open_interest, 0)
  assert.equal(open.min_skew_rank, 0)
  assert.equal(open.max_skew_rank, 100)
  assert.equal(open.min_put_skew_rank, 0)
  assert.equal(open.max_put_skew_rank, 100)
  assert.equal(open.min_call_skew_rank, 0)
  assert.equal(open.max_call_skew_rank, 100)
  assert.equal(open.include_near_matches, true)
})

test('short-premium risk profiles use the requested delta bands', () => {
  const cautious = riskProfileDefaultsForGeneralStrategy('bull-put-spread', 'risk_averse')
  const moderate = riskProfileDefaultsForGeneralStrategy('bull-put-spread', 'moderate')
  const aggressive = riskProfileDefaultsForGeneralStrategy('bull-put-spread', 'aggressive')
  assert.deepEqual([cautious.min_reference_delta, cautious.max_reference_delta], [5, 15])
  assert.deepEqual([moderate.min_reference_delta, moderate.max_reference_delta], [15, 20])
  assert.deepEqual([aggressive.min_reference_delta, aggressive.max_reference_delta], [30, 50])
  assert.equal(cautious.reference_delta_mode, 'short')
  assert.equal(cautious.market_trend, 'uptrend')
  assert.equal(cautious.underlying_trend, 'uptrend')
  assert.equal(cautious.recent_move_direction, 'down')
  assert.equal(cautious.min_iv_rank, 40)
  assert.equal(moderate.min_iv_rank, 25)
  assert.equal(aggressive.min_iv_rank, 15)
  assert.equal(cautious.earnings_in_trade, 'skip')
  assert.equal(cautious.exclude_earnings_before_expiry, true)
  assert.equal(moderate.exclude_earnings_before_expiry, true)
  assert.equal(aggressive.earnings_in_trade, 'skip')
  assert.equal(cautious.include_near_matches, true)
  assert.equal(moderate.include_near_matches, true)
  assert.equal(aggressive.include_near_matches, true)
  assert.deepEqual(favorableSkewFilters('bull-put-spread', 0), {
    min_skew_rank: 60, max_skew_rank: 100,
    min_put_skew_rank: 60, max_put_skew_rank: 100,
    min_call_skew_rank: 0, max_call_skew_rank: 100,
  })
  assert.equal(moderate.min_put_skew_rank, 50)
  assert.equal(moderate.min_skew_rank, 50)
  assert.equal(cautious.min_market_cap, 10e9)
  assert.equal(moderate.min_avg_dollar_volume, 25e6)
  assert.equal(cautious.min_open_interest, 250)
  assert.equal(cautious.bid_ask_level, 'Conservative (use bid/ask values)')
  assert.ok(cautious.min_max_profit_dollars >= 40)
})

test('long-premium risk profiles cap IV Rank instead of requiring rich IV', () => {
  const cautious = riskProfileDefaultsForGeneralStrategy('long-call', 'risk_averse')
  const moderate = riskProfileDefaultsForGeneralStrategy('long-put', 'moderate')
  const aggressive = riskProfileDefaultsForGeneralStrategy('bull-call-spread', 'aggressive')
  assert.equal(cautious.max_iv_rank, 50)
  assert.equal(moderate.max_iv_rank, 75)
  assert.equal(aggressive.max_iv_rank, 100)
  assert.equal(cautious.min_iv_rank, 0)
  assert.equal(cautious.earnings_in_trade, 'skip')
  assert.equal(cautious.exclude_earnings_before_expiry, true)
  assert.equal(aggressive.earnings_in_trade, 'skip')
  assert.equal(aggressive.exclude_earnings_before_expiry, true)
  assert.equal(aggressive.require_earnings_before_expiry, false)
})

test('long debit profiles invert delta sensibly while replacing every setting', () => {
  const cautious = riskProfileDefaultsForGeneralStrategy('long-call', 'risk_averse')
  const aggressive = riskProfileDefaultsForGeneralStrategy('long-call', 'aggressive')
  assert.equal(cautious.reference_delta_mode, 'long')
  assert.deepEqual([cautious.min_reference_delta, cautious.max_reference_delta], [60, 75])
  assert.deepEqual([aggressive.min_reference_delta, aggressive.max_reference_delta], [25, 45])
  assert.equal(cautious.stock_score_fundamental_min, 6)
  assert.equal(aggressive.stock_score_fundamental_min, 3)
})

test('setup presets only apply to matching trade types', () => {
  assert.equal(setupAppliesToStrategy('pullback_uptrend', 'cash-secured-put'), true)
  assert.equal(setupAppliesToStrategy('pullback_uptrend', 'bear-call-spread'), false)
  assert.equal(setupAppliesToStrategy('rally_downtrend', 'bear-call-spread'), true)
  assert.equal(setupAppliesToStrategy('rally_downtrend', 'cash-secured-put'), false)
  assert.equal(setupAppliesToStrategy('high_iv', 'iron-condor'), true)
  assert.equal(setupAppliesToStrategy('high_iv', 'long-call'), false)
  assert.equal(setupAppliesToStrategy('cheap_iv', 'long-call'), true)
  assert.equal(setupAppliesToStrategy('cheap_iv', 'cash-secured-put'), false)
  assert.equal(setupAppliesToStrategy('weeklies', 'covered-call'), true)
  assert.equal(setupAppliesToStrategy('weeklies', 'unbalanced-butterfly'), false)
  assert.equal(setupAppliesToStrategy('weeklies', 'long-call-calendar'), false)
  assert.equal(setupAppliesToStrategy('weeklies', 'put-call-condor'), false)
  assert.equal(setupAppliesToStrategy('monthlies', 'bull-put-spread'), true)
  assert.equal(setupAppliesToStrategy('monthlies', 'road-trip-butterfly'), false)
  assert.equal(setupAppliesToStrategy('core_indexes', 'iron-condor'), true)
  assert.equal(setupAppliesToStrategy('core_indexes', 'put-call-condor'), false)
  assert.equal(setupAppliesToStrategy('my_holdings', 'covered-call'), true)
  assert.equal(setupAppliesToStrategy('my_holdings', 'collar'), true)
  assert.equal(setupAppliesToStrategy('my_holdings', 'married-put'), true)
  assert.equal(setupAppliesToStrategy('my_holdings', 'cash-secured-put'), false)
  assert.equal(setupAppliesToStrategy('my_holdings', 'iron-condor'), false)
  assert.deepEqual(
    setupsForGeneralStrategy('covered-call').map(preset => preset.key),
    ['my_holdings', 'pullback_uptrend', 'high_iv', 'weeklies', 'monthlies', 'core_indexes'],
  )
  assert.deepEqual(
    setupsForGeneralStrategy('unbalanced-butterfly').map(preset => preset.key),
    ['core_indexes'],
  )
})

test('setup presets start from Moderate and overlay the named setup', () => {
  const pullback = setupDefaultsForGeneralStrategy('cash-secured-put', 'pullback_uptrend')
  assert.equal(pullback.risk_profile, 'pullback_uptrend')
  assert.equal(pullback.market_trend, 'uptrend')
  assert.equal(pullback.underlying_trend, 'uptrend')
  assert.equal(pullback.recent_move_direction, 'down')
  assert.equal(pullback.min_reference_delta, 15)
  assert.equal(pullback.earnings_in_trade, 'skip')
  assert.equal(pullback.exclude_earnings_before_expiry, true)
  assert.equal(pullback.min_put_skew_rank, 50)
  assert.equal(pullback.include_near_matches, true)

  const rally = setupDefaultsForGeneralStrategy('bear-call-spread', 'rally_downtrend')
  assert.equal(rally.market_trend, 'downtrend')
  assert.equal(rally.recent_move_direction, 'up')
  assert.equal(rally.earnings_in_trade, 'skip')
  assert.equal(rally.min_call_skew_rank, 50)
  assert.equal(rally.max_skew_rank, 50)

  const rich = setupDefaultsForGeneralStrategy('iron-condor', 'high_iv')
  assert.equal(rich.min_iv_rank, 40)
  assert.equal(rich.min_volatility_score, 50)
  assert.equal(rich.exclude_earnings_before_expiry, true)
  assert.equal(rich.min_put_skew_rank, 50)
  assert.equal(rich.min_call_skew_rank, 50)

  const cheap = setupDefaultsForGeneralStrategy('long-put', 'cheap_iv')
  assert.equal(cheap.max_iv_rank, 50)
  assert.equal(cheap.max_volatility_score, 50)
  assert.equal(cheap.min_iv_rank, 0)
  assert.equal(cheap.earnings_in_trade, 'skip')
  assert.equal(cheap.max_put_skew_rank, 50)

  const weeklies = setupDefaultsForGeneralStrategy('covered-call', 'weeklies')
  assert.deepEqual([weeklies.min_dte, weeklies.target_dte, weeklies.max_dte], [5, 10, 14])
  assert.equal(weeklies.earnings_in_trade, 'skip')
  assert.equal(weeklies.min_call_skew_rank, 50)
  assert.equal(weeklies.max_skew_rank, 50)

  const monthlies = setupDefaultsForGeneralStrategy('bull-put-spread', 'monthlies')
  assert.deepEqual([monthlies.min_dte, monthlies.target_dte, monthlies.max_dte], [21, 35, 45])
  assert.equal(monthlies.min_put_skew_rank, 50)
  assert.equal(monthlies.earnings_in_trade, 'skip')

  const indexes = setupDefaultsForGeneralStrategy('iron-condor', 'core_indexes')
  assert.equal(indexes.include_stocks, false)
  assert.equal(indexes.include_index_etfs, true)
  assert.equal(indexes.index_tickers, CORE_INDEX_TICKERS)
  assert.equal(indexes.symbols, '')

  const fallback = setupDefaultsForGeneralStrategy('long-call', 'high_iv')
  assert.equal(fallback.risk_profile, 'open')

  const holdings = setupDefaultsForGeneralStrategy('covered-call', 'my_holdings')
  assert.equal(holdings.risk_profile, 'my_holdings')
  assert.equal(holdings.universe, 'holdings')
  assert.equal(holdings.include_stocks, true)
  assert.equal(holdings.include_index_etfs, false)
  assert.equal(holdings.require_shares_held, true)
  assert.equal(holdings.respect_cost_basis, true)
  assert.equal(holdings.symbols, '')

  const collarHoldings = setupDefaultsForGeneralStrategy('collar', 'my_holdings')
  assert.equal(collarHoldings.universe, 'holdings')
  assert.equal(collarHoldings.require_shares_held, false)
})

test('AIC scans use index universes without debit-only opening-cash bands', () => {
  assert.equal(isIndexOnlyStrategy('fourteen-day-aic'), true)
  assert.equal(isIndexOnlyStrategy('monthly-aic'), true)
  const fourteen = defaultsForGeneralStrategy('fourteen-day-aic')
  const monthly = strategyDefaultsForGeneralStrategy('monthly-aic')
  const cautious = riskProfileDefaultsForGeneralStrategy('fourteen-day-aic', 'risk_averse')
  assert.equal(fourteen.include_stocks, false)
  assert.equal(fourteen.target_dte, 32)
  assert.equal(fourteen.put_credit_qty, 4)
  assert.equal(monthly.target_dte, 45)
  assert.equal(monthly.put_credit_qty, 10)
  assert.equal(monthly.exit_remaining_dte, 14)
  assert.equal(cautious.entry_credit_mode, 'any')
  assert.equal(setupAppliesToStrategy('monthlies', 'monthly-aic'), true)
  assert.equal(setupAppliesToStrategy('weeklies', 'fourteen-day-aic'), false)
})

test('long-dated unbalanced profiles use index universes and opening-cash bands', () => {
  assert.equal(isIndexOnlyStrategy('unbalanced-butterfly'), true)
  assert.equal(isIndexOnlyStrategy('iron-butterfly'), false)
  const open = defaultsForGeneralStrategy('unbalanced-put-condor')
  const cautious = riskProfileDefaultsForGeneralStrategy('unbalanced-butterfly', 'risk_averse')
  const moderate = riskProfileDefaultsForGeneralStrategy('unbalanced-put-condor', 'moderate')
  const aggressive = riskProfileDefaultsForGeneralStrategy('road-trip-butterfly', 'aggressive')
  assert.equal(open.include_stocks, false)
  assert.equal(open.entry_credit_mode, 'any')
  assert.deepEqual([cautious.entry_credit_mode, cautious.upper_long_delta, cautious.market_bias], ['debit_or_flat', '20', 'bearish'])
  assert.deepEqual([moderate.entry_credit_mode, moderate.delta_preset], ['flat_or_slight_credit', '20/10'])
  assert.deepEqual([aggressive.entry_credit_mode, aggressive.market_bias], ['credit', 'bullish'])
})

test('long-dated strategy editors use the scanner engines\' supported delta values', () => {
  const condorPreset = fieldsForGeneralStrategy('unbalanced-put-condor')
    .find(field => field.key === 'delta_preset')
  const butterflyDelta = fieldsForGeneralStrategy('unbalanced-butterfly')
    .find(field => field.key === 'upper_long_delta')

  assert.deepEqual(condorPreset.options.map(([value]) => value), ['all', '15/5', '20/10', '25/15'])
  assert.deepEqual(butterflyDelta.options.map(([value]) => value), ['both', '20', '25'])
})

test('put/call spread and selling presets skip earnings and require favorable skew', () => {
  assert.deepEqual(earningsInTradeState('require'), {
    earnings_in_trade: 'require',
    exclude_earnings_before_expiry: false,
    require_earnings_before_expiry: true,
  })

  for (const strategy of ['bull-put-spread', 'bear-put-spread', 'cash-secured-put']) {
    const moderate = riskProfileDefaultsForGeneralStrategy(strategy, 'moderate')
    assert.equal(moderate.earnings_in_trade, 'skip', strategy)
    assert.equal(moderate.include_near_matches, true, strategy)
    assert.equal(moderate.min_put_skew_rank, 50, strategy)
    assert.equal(moderate.min_skew_rank, 50, strategy)
  }

  for (const strategy of ['bear-call-spread', 'bull-call-spread', 'covered-call', 'naked-call']) {
    const moderate = riskProfileDefaultsForGeneralStrategy(strategy, 'moderate')
    assert.equal(moderate.earnings_in_trade, 'skip', strategy)
    assert.equal(moderate.min_call_skew_rank, 50, strategy)
    assert.equal(moderate.max_skew_rank, 50, strategy)
  }

  const condor = riskProfileDefaultsForGeneralStrategy('iron-condor', 'aggressive')
  assert.equal(condor.earnings_in_trade, 'skip')
  assert.equal(condor.min_put_skew_rank, 40)
  assert.equal(condor.min_call_skew_rank, 40)
})

test('double-hedge ratio size is chosen from 1 / −2 / +2 upward', () => {
  const size = fieldsForGeneralStrategy(DOUBLE_HEDGE).find(field => field.key === 'tranche_quantity')
  assert.equal(size.type, 'select')
  assert.deepEqual(size.options.slice(0, 4), [
    ['1', '1 / −2 / +2'],
    ['2', '2 / −4 / +4'],
    ['3', '3 / −6 / +6'],
    ['4', '4 / −8 / +8'],
  ])
  assert.equal(size.options.length, DOUBLE_HEDGE_SIZES.length)
})

test('double-hedge defaults are unchanged at the CC4 base size', () => {
  const open = defaultsForGeneralStrategy(DOUBLE_HEDGE)
  assert.equal(open.structure_variant, 'cc4')
  assert.equal(open.tranche_quantity, 4)
  assert.deepEqual([open.min_dte, open.target_dte, open.max_dte], [160, 200, 230])
  assert.deepEqual(perPositionRules(open), { theta: 10, t0: -10000, capital: 12500, amount: 300 })
  assert.deepEqual([open.upper_line_mode, open.upper_line_amount_dollars], ['debit', 300])
})

test('a double-hedge debit or credit choice survives presets and scales with size', () => {
  const choices = { structure_variant: '100dte', tranche_quantity: 4, upper_line_mode: 'credit', upper_line_amount_dollars: 40 }
  for (const filters of [
    defaultsForGeneralStrategy(DOUBLE_HEDGE, choices),
    riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'risk_averse', choices),
    riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'aggressive', choices),
    setupDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'core_indexes', choices),
  ]) {
    assert.deepEqual([filters.upper_line_mode, filters.upper_line_amount_dollars], ['credit', 40])
  }
  // Without a choice, a preset starts at a $300 debit per 4 / −8 / +8.
  const two = riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'moderate', { structure_variant: '100dte', tranche_quantity: 2 })
  assert.deepEqual([two.upper_line_mode, two.upper_line_amount_dollars], ['debit', 150])
  // A new size keeps the same debit per unit.
  const doubled = updateStrategyFilter(DOUBLE_HEDGE, { ...two, upper_line_amount_dollars: 200 }, 'tranche_quantity', '4')
  assert.equal(doubled.upper_line_amount_dollars, 400)
  assert.equal(isStructureChoice(DOUBLE_HEDGE, 'upper_line_mode'), true)
  assert.equal(isStructureChoice(DOUBLE_HEDGE, 'upper_line_amount_dollars'), true)
})

test('every double-hedge starting point and setup keeps the chosen plan and size', () => {
  const choices = { structure_variant: '100dte', tranche_quantity: '2' }
  const presets = {
    open: defaultsForGeneralStrategy(DOUBLE_HEDGE, choices),
    risk_averse: riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'risk_averse', choices),
    moderate: riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'moderate', choices),
    aggressive: riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'aggressive', choices),
    core_indexes: setupDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'core_indexes', choices),
  }
  for (const [name, filters] of Object.entries(presets)) {
    assert.equal(filters.structure_variant, '100dte', name)
    assert.equal(filters.tranche_quantity, 2, name)
    assert.deepEqual([filters.min_dte, filters.target_dte, filters.max_dte], [80, 100, 120], name)
    assert.equal(filters.min_t0_minus_20_dollars, -5000, name)
    assert.equal(filters.upper_line_amount_dollars, 150, name)
  }
  // The preset's own rules still apply on top of the kept structure.
  assert.equal(presets.risk_averse.risk_profile, 'risk_averse')
  assert.equal(presets.risk_averse.min_open_interest, 250)
  assert.equal(presets.aggressive.min_open_interest, 0)
  assert.equal(presets.core_indexes.risk_profile, 'core_indexes')

  const cc4Small = riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'moderate', { tranche_quantity: 1 })
  assert.equal(cc4Small.structure_variant, 'cc4')
  assert.deepEqual([cc4Small.min_dte, cc4Small.target_dte, cc4Small.max_dte], [160, 200, 230])
  assert.deepEqual(perPositionRules(cc4Small), { theta: 2.5, t0: -2500, capital: 3125, amount: 75 })
})

test('choosing a double-hedge size rescales rules quoted for the whole position', () => {
  const base = { ...riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'moderate'), min_theta_dollars: 15 }
  const halved = updateStrategyFilter(DOUBLE_HEDGE, base, 'tranche_quantity', '2')
  assert.equal(halved.tranche_quantity, 2)
  // A custom $15 per 4 / −8 / +8 stays the same per unit.
  assert.deepEqual(perPositionRules(halved), { theta: 7.5, t0: -5000, capital: 6250, amount: 150 })
  assert.equal(halved.min_dte, base.min_dte)

  const cleared = updateStrategyFilter(DOUBLE_HEDGE, { ...base, min_theta_dollars: null }, 'tranche_quantity', '8')
  assert.equal(cleared.min_theta_dollars, null, 'a cleared rule is left to the scanner default')
  assert.equal(cleared.min_t0_minus_20_dollars, -20000)

  const unchanged = updateStrategyFilter('road-trip-butterfly', { tranche_quantity: 5, min_theta_dollars: 1 }, 'tranche_quantity', 10)
  assert.deepEqual(unchanged, { tranche_quantity: 10, min_theta_dollars: 1 })
})

test('choosing a double-hedge plan brings its expiration window and keeps the size', () => {
  const two = updateStrategyFilter(DOUBLE_HEDGE, defaultsForGeneralStrategy(DOUBLE_HEDGE), 'tranche_quantity', '2')
  const hundred = updateStrategyFilter(DOUBLE_HEDGE, two, 'structure_variant', '100dte')
  assert.equal(hundred.structure_variant, '100dte')
  assert.equal(hundred.tranche_quantity, 2)
  assert.deepEqual([hundred.min_dte, hundred.target_dte, hundred.max_dte], [80, 100, 120])
  assert.equal(hundred.min_t0_minus_20_dollars, two.min_t0_minus_20_dollars)

  const back = updateStrategyFilter(DOUBLE_HEDGE, hundred, 'structure_variant', 'cc4')
  assert.deepEqual([back.min_dte, back.target_dte, back.max_dte], [160, 200, 230])
  assert.equal(isStructureChoice(DOUBLE_HEDGE, 'structure_variant'), true)
  assert.equal(isStructureChoice(DOUBLE_HEDGE, 'tranche_quantity'), true)
  assert.equal(isStructureChoice(DOUBLE_HEDGE, 'min_theta_dollars'), false)
  assert.equal(isStructureChoice('road-trip-butterfly', 'tranche_quantity'), false)
})

test('the 30/12/3 plan hides the CC4-only rules, and neither plan uses a preset cash-flow rule', () => {
  const keys = filters => fieldsForGeneralStrategy(DOUBLE_HEDGE, filters).map(field => field.key)
  assert.deepEqual(keys({ structure_variant: '100dte' }), [
    'structure_variant', 'tranche_quantity', 'upper_line_mode', 'upper_line_amount_dollars',
    'delta_tolerance', 'min_t0_minus_20_dollars', 'min_lower_wing_ratio', 'min_open_interest',
  ])
  // CC4 balances its hedge to the bias band, so it has no debit/credit choice.
  // CC4 takes the same debit/credit choice, plus its document-only rules.
  const cc4Keys = keys({ structure_variant: 'cc4' })
  assert.equal(cc4Keys.includes('upper_line_mode'), true)
  assert.equal(cc4Keys.length, fieldsForGeneralStrategy(DOUBLE_HEDGE).length)
  assert.equal(cc4Keys.includes('market_bias'), false)
  const bias = fieldsForGeneralStrategy(DOUBLE_HEDGE).find(field => field.key === 'price_signal')
  assert.match(helpForGeneralField(bias), /CC4 plan only/)

  const aggressive = riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'aggressive', { structure_variant: '100dte' })
  assert.equal(aggressive.entry_credit_mode, 'credit', 'the preset keeps its own rule')
  assert.equal(effectiveGeneralFilters(DOUBLE_HEDGE, aggressive).entry_credit_mode, 'any')
  const cc4 = riskProfileDefaultsForGeneralStrategy(DOUBLE_HEDGE, 'aggressive')
  assert.equal(cc4.entry_credit_mode, 'credit', 'the preset keeps its own rule')
  assert.equal(effectiveGeneralFilters(DOUBLE_HEDGE, cc4).entry_credit_mode, 'any')

  // Open Filters' hidden ±100 cap would reject a large 30/12/3 (−12 per unit).
  const open = defaultsForGeneralStrategy(DOUBLE_HEDGE, { structure_variant: '100dte', tranche_quantity: 10 })
  assert.equal(open.max_abs_position_delta, 100)
  assert.equal(effectiveGeneralFilters(DOUBLE_HEDGE, open).max_abs_position_delta, null)
  const condor = defaultsForGeneralStrategy('iron-condor')
  assert.equal(effectiveGeneralFilters('iron-condor', condor), condor)
})

test('structure choices only carry through presets for the double hedge', () => {
  const butterfly = riskProfileDefaultsForGeneralStrategy('unbalanced-butterfly', 'moderate', { tranche_quantity: 2 })
  assert.equal(butterfly.tranche_quantity, 4)
  assert.equal(butterfly.structure_variant, undefined)
})

test('the double-hedge plan, ratio and debit/credit are toolbar choices beside the starting points', () => {
  const fields = fieldsForGeneralStrategy(DOUBLE_HEDGE)
  assert.deepEqual(
    fields.filter(field => field.toolbar).map(field => [field.key, field.toolbar]),
    [['structure_variant', 'buttons'], ['tranche_quantity', 'select'], ['upper_line_mode', 'buttons'], ['upper_line_amount_dollars', 'number']],
  )
  const plan = fields.find(field => field.key === 'structure_variant')
  assert.deepEqual(plan.options.map(([, label]) => label), ['CC4 · 200 DTE · 25/15/2.5Δ', '100 DTE · 30/12/3Δ'])
  assert.ok(plan.optionHelp['100dte'].includes('30-delta'))
})

test('both double-hedge plans report their debit or credit as the opening cash flow', () => {
  assert.equal(doubleHedgeCashFlowText(DOUBLE_HEDGE, { structure_variant: '100dte', upper_line_mode: 'debit', upper_line_amount_dollars: 1200 }), 'Debit up to $1,200')
  assert.equal(doubleHedgeCashFlowText(DOUBLE_HEDGE, { structure_variant: '100dte', upper_line_mode: 'credit', upper_line_amount_dollars: 0 }), 'Credit of at least $0')
  assert.equal(doubleHedgeCashFlowText(DOUBLE_HEDGE, { structure_variant: 'cc4', upper_line_mode: 'debit', upper_line_amount_dollars: 300 }), 'Debit up to $300')
  assert.equal(doubleHedgeCashFlowText('unbalanced-butterfly', { structure_variant: '100dte' }), null)
})
