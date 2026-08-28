import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CORE_INDEX_TICKERS,
  defaultsForGeneralStrategy,
  fieldsForGeneralStrategy,
  GENERAL_STRATEGY_CONFIG,
  isIndexOnlyStrategy,
  MAX_OPTION_DTE,
  MIN_OPTION_DTE,
  riskProfileDefaultsForGeneralStrategy,
  setupAppliesToStrategy,
  setupDefaultsForGeneralStrategy,
  setupsForGeneralStrategy,
  strategyDefaultsForGeneralStrategy,
  updateDteFilters,
} from './generalOptionScannerConfig.js'

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
  assert.equal(open.exclude_earnings_before_expiry, false)
  assert.equal(open.min_market_cap, 0)
  assert.equal(open.min_open_interest, 0)
  assert.equal(open.min_skew_rank, 0)
  assert.equal(open.max_skew_rank, 100)
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
  assert.equal(cautious.exclude_earnings_before_expiry, true)
  assert.equal(moderate.exclude_earnings_before_expiry, true)
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
  assert.equal(cautious.exclude_earnings_before_expiry, true)
  assert.equal(aggressive.exclude_earnings_before_expiry, false)
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
  assert.equal(pullback.exclude_earnings_before_expiry, true)

  const rally = setupDefaultsForGeneralStrategy('bear-call-spread', 'rally_downtrend')
  assert.equal(rally.market_trend, 'downtrend')
  assert.equal(rally.recent_move_direction, 'up')

  const rich = setupDefaultsForGeneralStrategy('iron-condor', 'high_iv')
  assert.equal(rich.min_iv_rank, 40)
  assert.equal(rich.min_volatility_score, 50)
  assert.equal(rich.exclude_earnings_before_expiry, true)

  const cheap = setupDefaultsForGeneralStrategy('long-put', 'cheap_iv')
  assert.equal(cheap.max_iv_rank, 50)
  assert.equal(cheap.max_volatility_score, 50)
  assert.equal(cheap.min_iv_rank, 0)

  const weeklies = setupDefaultsForGeneralStrategy('covered-call', 'weeklies')
  assert.deepEqual([weeklies.min_dte, weeklies.target_dte, weeklies.max_dte], [5, 10, 14])

  const monthlies = setupDefaultsForGeneralStrategy('bull-put-spread', 'monthlies')
  assert.deepEqual([monthlies.min_dte, monthlies.target_dte, monthlies.max_dte], [21, 35, 45])

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

test('long-dated unbalanced profiles use index universes and opening-cash bands', () => {
  assert.equal(isIndexOnlyStrategy('unbalanced-butterfly'), true)
  assert.equal(isIndexOnlyStrategy('iron-butterfly'), false)
  const open = defaultsForGeneralStrategy('unbalanced-put-condor')
  const cautious = riskProfileDefaultsForGeneralStrategy('unbalanced-butterfly', 'risk_averse')
  const moderate = riskProfileDefaultsForGeneralStrategy('unbalanced-put-condor', 'moderate')
  const aggressive = riskProfileDefaultsForGeneralStrategy('double-hedge-put-butterfly', 'aggressive')
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
