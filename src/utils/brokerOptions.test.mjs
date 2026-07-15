import test from 'node:test'
import assert from 'node:assert/strict'

import { assignBrokerImportSides, parseBrokerOptionDescriptor } from './brokerOptions.js'

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
