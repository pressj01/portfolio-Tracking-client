import assert from 'node:assert/strict'
import test from 'node:test'

import {
  blackScholesOptionValue,
  scannerLegVolatility,
  scannerTradePayoff,
} from './generalScannerPayoff.js'

const assertClose = (actual, expected, tolerance = 1e-7) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  )
}

test('the default compact graph preserves each butterfly leg IV', () => {
  const spot = 100
  const dte = 180
  const rate = 0.0375
  const dividendYield = 0.01
  const specs = [
    { side: 'BUY', qty: 1, strike: 95, iv: 0.20 },
    { side: 'SELL', qty: 2, strike: 80, iv: 0.26 },
    { side: 'BUY', qty: 1, strike: 60, iv: 0.34 },
  ]
  const legs = specs.map(leg => ({
    ...leg,
    opt_type: 'PUT',
    entry_price: blackScholesOptionValue(
      'PUT', spot, leg.strike, dte / 365, leg.iv, rate, dividendYield,
    ),
  }))

  assertClose(scannerTradePayoff({ legs }, spot, dte, {
    baseIvPct: (20 + 26 + 34) / 3,
    selectedIvPct: (20 + 26 + 34) / 3,
    rate,
    dividendYield,
  }), 0)
})

test('the IV control applies a parallel point shift without flattening skew', () => {
  assertClose(scannerLegVolatility({ iv: 0.20 }, 25, 30), 0.25)
  assertClose(scannerLegVolatility({ iv: 0.35 }, 25, 30), 0.40)
})

test('expiration payoff ignores volatility and uses the exact entry prices', () => {
  const trade = { legs: [
    { side: 'BUY', qty: 1, opt_type: 'PUT', strike: 100, entry_price: 8, iv: 0.2 },
    { side: 'SELL', qty: 1, opt_type: 'PUT', strike: 90, entry_price: 4, iv: 0.3 },
  ] }
  assertClose(scannerTradePayoff(trade, 80, 0, { baseIvPct: 25, selectedIvPct: 75 }), 600)
  assertClose(scannerTradePayoff(trade, 110, 0, { baseIvPct: 25, selectedIvPct: 5 }), -400)
})

