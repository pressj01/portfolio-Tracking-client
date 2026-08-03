import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildScannerStrategyPayload,
  buildScannerTrade,
  buildTrackedTrade,
} from './optionTradeHandoff.js'

const expiration = '2026-09-11'
const quote = (role, optionType, strike, qty) => ({
  role,
  option_type: optionType,
  strike,
  qty,
  mid: 1.25,
  iv: 0.22,
  delta: optionType === 'put' ? -0.15 : 0.15,
  quote_source: 'last_trade_estimate',
})

const jeepRow = {
  ticker: 'SPY',
  price: 747.03,
  spread: {
    expiration,
    variant: 'jeep',
    variant_label: 'Jeep',
    direction: 'neutral',
    legs: [
      quote('put_long', 'put', 655, 4),
      quote('put_short', 'put', 690, -4),
      quote('call_short', 'call', 774, -1),
      quote('call_long', 'call', 811, 1),
      quote('front_debit_long', 'put', 745, 4),
      quote('front_debit_short', 'put', 725, -4),
    ],
  },
}

test('builds every leg of a six-leg iron-condor variant for the risk graph', () => {
  const trade = buildScannerTrade('iron-condor', jeepRow)

  assert.ok(trade)
  assert.equal(trade.legs.length, 6)
  assert.deepEqual(trade.legs.map(leg => leg.qty), [4, 4, 1, 1, 4, 4])
  assert.deepEqual(trade.legs.map(leg => leg.side), [
    'BUY', 'SELL', 'SELL', 'BUY', 'BUY', 'SELL',
  ])
})

test('still refuses a partial variant handoff', () => {
  const broken = {
    ...jeepRow,
    spread: {
      ...jeepRow.spread,
      legs: jeepRow.spread.legs.map((leg, index) => (
        index === 4 ? { ...leg, strike: null } : leg
      )),
    },
  }

  assert.equal(buildScannerTrade('iron-condor', broken), null)
})

test('six-leg variants can also be saved from the scanner', () => {
  const payload = buildScannerStrategyPayload(
    'iron-condor',
    jeepRow,
    'Iron Condor Scanner',
  )

  assert.ok(payload)
  assert.equal(payload.legs.length, 6)
  assert.match(payload.notes, /recent-trade estimates/i)
})

test('builds the complete 60/40/20 fly for Strategy Lab', () => {
  const row = {
    ticker: 'SPY',
    price: 650,
    expiration,
    upper_long_strike: 660,
    body_short_strike: 640,
    lower_long_strike: 610,
    upper_long_quantity: 2,
    body_short_quantity: 4,
    lower_long_quantity: 2,
    upper_long_leg: quote('upper_long', 'put', 660, 2),
    body_short_leg: quote('body_short', 'put', 640, -4),
    lower_long_leg: quote('lower_long', 'put', 610, 2),
  }

  const trade = buildScannerTrade('sixty-forty-twenty-fly', row)

  assert.ok(trade)
  assert.equal(trade.label, '60/40/20 fly')
  assert.deepEqual(trade.legs.map(leg => leg.side), ['BUY', 'SELL', 'BUY'])
  assert.deepEqual(trade.legs.map(leg => leg.qty), [2, 4, 2])
})

test('builds the complete three-strike iron butterfly for Strategy Lab', () => {
  const row = {
    ticker: 'SPY',
    price: 100,
    expiration,
    body_strike: 100,
    legs: [
      quote('put_long', 'put', 90, 1),
      quote('put_short', 'put', 100, -1),
      quote('call_short', 'call', 100, -1),
      quote('call_long', 'call', 110, 1),
    ],
  }

  const trade = buildScannerTrade('iron-butterfly', row)

  assert.ok(trade)
  assert.equal(trade.label, 'iron butterfly')
  assert.deepEqual(trade.legs.map(leg => leg.side), ['BUY', 'SELL', 'SELL', 'BUY'])
  assert.deepEqual(trade.legs.map(leg => leg.qty), [1, 1, 1, 1])
  assert.deepEqual(trade.legs.map(leg => leg.strike), [90, 100, 100, 110])
})

test('preserves unequal tracked quantities and net opening fills', () => {
  const executions = (action, contracts, price, fees) => [{ action, contracts, price, fees }]
  const trade = buildTrackedTrade({
    id: 41,
    underlying: 'SPY',
    strategy_type: '60/40/20 Butterfly',
    status: 'OPEN',
    legs: [
      { position_side: 'LONG', option_type: 'PUT', expiration, strike: 660, contracts: 2, open_contracts: 2, multiplier: 100, executions: executions('BTO', 2, 0.30, 1.30) },
      { position_side: 'SHORT', option_type: 'PUT', expiration, strike: 640, contracts: 4, open_contracts: 4, multiplier: 100, executions: executions('STO', 4, 1.00, 2.60) },
      { position_side: 'LONG', option_type: 'PUT', expiration, strike: 610, contracts: 2, open_contracts: 2, multiplier: 100, executions: executions('BTO', 2, 0.20, 1.30) },
    ],
  })

  assert.ok(trade)
  assert.deepEqual(trade.legs.map(leg => leg.qty), [2, 4, 2])
  assert.deepEqual(trade.legs.map(leg => leg.side), ['BUY', 'SELL', 'BUY'])
  assert.ok(Math.abs(trade.legs[0].entry_price - 0.3065) < 0.000001)
  assert.ok(Math.abs(trade.legs[1].entry_price - 0.9935) < 0.000001)
})

test('adds linked account stock to a tracked covered-call risk graph', () => {
  const trade = buildTrackedTrade({
    id: 42,
    underlying: 'QQQ',
    strategy_type: 'Covered Call',
    status: 'OPEN',
    stock_position: {
      shares: 100,
      portfolio_shares: 150,
      required_shares: 100,
      shortfall_shares: 0,
      covered: true,
      cost_basis: 475.25,
      cost_basis_source: 'broker',
    },
    legs: [{
      position_side: 'SHORT', option_type: 'CALL', expiration, strike: 520,
      contracts: 1, open_contracts: 1, multiplier: 100,
      executions: [{ action: 'STO', contracts: 1, price: 1.50, fees: 0.65 }],
    }],
  })

  assert.ok(trade)
  assert.equal(trade.legs[0].opt_type, 'STOCK')
  assert.equal(trade.legs[0].qty, 100)
  assert.equal(trade.legs[0].entry_price, 475.25)
  assert.equal(trade.legs[1].opt_type, 'CALL')
  assert.equal(trade.stock_coverage.covered, true)
})
