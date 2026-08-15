import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateExpirationScenario,
  describeExpirationScenario,
  EXPIRATION_SCENARIO_STRATEGIES,
  expirationPayoff,
  expirationScenarioPasses,
  resolveExpirationScenarioSpot,
} from './optionExpirationScenario.js'

const option = (side, type, strike, entryPrice) => ({
  side,
  qty: 1,
  opt_type: type,
  strike,
  entry_price: entryPrice,
})

test('offers the scenario on the requested call, put, and credit spread scanners', () => {
  for (const strategy of ['covered-call', 'cash-secured-put', 'bull-put-spread', 'bear-call-spread']) {
    assert.equal(EXPIRATION_SCENARIO_STRATEGIES.has(strategy), true, strategy)
  }
  assert.equal(EXPIRATION_SCENARIO_STRATEGIES.has('iron-condor'), false)
})

test('resolves all scenario anchor types into an expiration price', () => {
  const context = {
    currentPrice: 100,
    atr14: 4,
    annualizedVolatility: 20,
    targetPrice: 120,
    sma200: 200,
    week52High: 140,
    week52Low: 80,
  }

  assert.deepEqual(
    resolveExpirationScenarioSpot({ reference: 'sma200_pct', amount: 3 }, context, 30),
    { spot: 206, changePct: 106, error: null },
  )
  assert.equal(resolveExpirationScenarioSpot({ reference: 'current_atr', amount: -1.5 }, context, 30).spot, 94)
  assert.ok(Math.abs(resolveExpirationScenarioSpot({ reference: 'current_stddev', amount: 1 }, context, 365).spot - (100 * Math.exp(0.2))) < 1e-9)
  assert.equal(resolveExpirationScenarioSpot({ reference: 'target_pct', amount: 10 }, context, 30).spot, 132)
  assert.equal(resolveExpirationScenarioSpot({ reference: 'week52_high_pct', amount: -10 }, context, 30).spot, 126)
  assert.equal(resolveExpirationScenarioSpot({ reference: 'week52_low_pct', amount: 25 }, context, 30).spot, 100)
})

test('reports unavailable references instead of inventing an anchor price', () => {
  const resolved = resolveExpirationScenarioSpot(
    { reference: 'sma200_pct', amount: 3 },
    { currentPrice: 100 },
    30,
  )
  assert.equal(resolved.spot, null)
  assert.match(resolved.error, /unavailable/i)
})

test('calculates expiration P/L for requested call, put, and vertical spread structures', () => {
  const shortPut = { legs: [option('SELL', 'PUT', 100, 2)] }
  assert.equal(expirationPayoff(shortPut, 90), -800)

  const coveredCall = { legs: [
    { side: 'BUY', qty: 100, opt_type: 'STOCK', entry_price: 100 },
    option('SELL', 'CALL', 110, 2),
  ] }
  assert.equal(expirationPayoff(coveredCall, 120), 1200)

  const bullPut = { legs: [
    option('SELL', 'PUT', 100, 3),
    option('BUY', 'PUT', 95, 1),
  ] }
  assert.equal(expirationPayoff(bullPut, 90), -300)

  const bearCall = { legs: [
    option('SELL', 'CALL', 100, 3),
    option('BUY', 'CALL', 105, 1),
  ] }
  assert.equal(expirationPayoff(bearCall, 110), -300)
})

test('uses scenario P/L on margin as an above or below filter', () => {
  const trade = { legs: [option('SELL', 'PUT', 100, 2)] }
  const scenario = { reference: 'current_pct', amount: -10, marginRule: 'above', marginPct: -9 }
  const result = calculateExpirationScenario(trade, scenario, { currentPrice: 100 }, 30, 10000)
  assert.equal(result.pnl, -800)
  assert.equal(result.pnlOnMarginPct, -8)
  assert.equal(expirationScenarioPasses(result, scenario), true)
  assert.equal(expirationScenarioPasses(result, { ...scenario, marginPct: -7 }), false)
  assert.equal(expirationScenarioPasses(result, { ...scenario, marginRule: 'below', marginPct: -7 }), true)
})

test('describes the reference without duplicating the word from', () => {
  assert.equal(
    describeExpirationScenario({ reference: 'sma200_pct', amount: 3 }),
    '+3% from the MA 200',
  )
  assert.equal(
    describeExpirationScenario({ reference: 'current_atr', amount: -1.5 }),
    '-1.5 ATR from the current price',
  )
})
