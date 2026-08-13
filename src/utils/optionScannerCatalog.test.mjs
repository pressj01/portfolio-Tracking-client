import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generalScannerRoute,
  OPTION_SCANNER_GROUPS,
  OPTION_SCANNERS,
  isOptionScannerPath,
  optionScannerForPath,
} from './optionScannerCatalog.js'

const expectedRoutes = [
  '/covered-call-scanner',
  '/put-selling-scanner',
  '/bull-put-spread-scanner',
  '/bear-call-spread-scanner',
  '/bear-put-spread-scanner',
  '/iron-condor-scanner',
  '/iron-butterfly-scanner',
  '/unbalanced-butterfly-scanner',
  '/put-call-condor-scanner',
  '/unbalanced-put-condor-scanner',
  '/double-hedge-put-butterfly-scanner',
  '/road-trip-butterfly-scanner',
  '/sixty-forty-twenty-fly-scanner',
]

test('catalog includes the 13 legacy screens and the complete 32-strategy menu', () => {
  assert.equal(OPTION_SCANNERS.length, 32)
  assert.deepEqual(
    [...OPTION_SCANNERS.map(scanner => scanner.route).filter(Boolean)].sort(),
    [...expectedRoutes].sort(),
  )
  assert.equal(new Set(OPTION_SCANNERS.map(scanner => scanner.key)).size, OPTION_SCANNERS.length)
  assert.equal(new Set(OPTION_SCANNERS.map(scanner => scanner.route).filter(Boolean)).size, expectedRoutes.length)
  for (const key of ['naked-call', 'bull-call-spread', 'long-straddle', 'call-butterfly', 'long-call-calendar', 'collar', 'put-ratio-spread']) {
    assert.ok(OPTION_SCANNERS.some(scanner => scanner.key === key), `${key} is missing`)
  }
})

test('catalog retains the four strategy families used by the launcher', () => {
  assert.deepEqual(
    OPTION_SCANNER_GROUPS.map(group => group.label),
    ['Single-Leg', 'Vertical Spreads', 'Volatility', 'Advanced'],
  )
  assert.ok(OPTION_SCANNER_GROUPS.every(group => group.scanners.length > 0))
})

test('legacy put-condor route resolves to the current combined scanner', () => {
  assert.equal(optionScannerForPath('/put-condor-scanner')?.key, 'put-call-condor')
  assert.equal(optionScannerForPath('/put-call-condor-scanner?side=call')?.key, 'put-call-condor')
  assert.equal(isOptionScannerPath('/option-dashboard'), false)
})

test('new scanner links preserve the selected strategy', () => {
  assert.equal(generalScannerRoute('covered-call'), '/general-option-scanner?strategy=covered-call')
  assert.equal(generalScannerRoute('iron-butterfly'), '/general-option-scanner?strategy=iron-butterfly')
})
