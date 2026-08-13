import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultsForGeneralStrategy, fieldsForGeneralStrategy, isIndexOnlyStrategy, riskProfileDefaultsForGeneralStrategy, strategyDefaultsForGeneralStrategy } from './generalOptionScannerConfig.js'

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
  assert.deepEqual([moderate.entry_credit_mode, moderate.delta_preset], ['flat_or_slight_credit', 'balanced'])
  assert.deepEqual([aggressive.entry_credit_mode, aggressive.market_bias], ['credit', 'bullish'])
})
