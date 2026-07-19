import test from 'node:test'
import assert from 'node:assert/strict'

import { assignBrokerImportSides, mapBrokerOptionUnderlying, parseBrokerOptionDescriptor } from './brokerOptions.js'

test('mixed unsigned NDX import builds a covered call and protective put debit spread', () => {
  const parsed = [
    'NDX 260821C31250000',
    'NDX 260821P26800000',
    'NDX 260821P28775000',
  ].map(line => parseBrokerOptionDescriptor(line, 'SELL'))

  const assigned = assignBrokerImportSides(parsed, 'covered-call-protection')

  assert.deepEqual(assigned.map(leg => [leg.optType, leg.strike, leg.side]), [
    ['CALL', 31250, 'SELL'],
    ['PUT', 26800, 'SELL'],
    ['PUT', 28775, 'BUY'],
  ])
})

test('signed quantities override inferred sides', () => {
  const parsed = [
    '+2 NDX 260821C31250000',
    '-3 NDX 260821P28775000',
  ].map(line => parseBrokerOptionDescriptor(line, 'SELL'))

  const assigned = assignBrokerImportSides(parsed, 'covered-call-protection')

  assert.deepEqual(assigned.map(leg => [leg.qty, leg.side, leg.sideExplicit]), [
    [2, 'BUY', true],
    [3, 'SELL', true],
  ])
})

test('CBTX broker symbols use the BTC option chain and scaled strikes', () => {
  const parsed = parseBrokerOptionDescriptor('CBTX US 08/21/26 C1490', 'SELL')
  const proxy = mapBrokerOptionUnderlying(parsed.underlying)

  assert.deepEqual(parsed, {
    underlying: 'CBTX',
    expiration: '2026-08-21',
    optType: 'CALL',
    strike: 1490,
    qty: 1,
    side: 'SELL',
    sideExplicit: false,
  })
  assert.deepEqual(proxy, { ticker: 'BTC', divisor: 50 })
  assert.equal(parsed.strike / proxy.divisor, 29.8)
})

test('weekly and mini Bitcoin index roots use the corresponding BTC scale', () => {
  assert.deepEqual(mapBrokerOptionUnderlying('cbtxw'), { ticker: 'BTC', divisor: 50 })
  assert.deepEqual(mapBrokerOptionUnderlying('MBTX'), { ticker: 'BTC', divisor: 5 })
  assert.deepEqual(mapBrokerOptionUnderlying('MBTXW'), { ticker: 'BTC', divisor: 5 })
})
