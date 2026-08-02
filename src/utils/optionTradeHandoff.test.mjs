import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildScannerStrategyPayload,
  buildScannerTrade,
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
