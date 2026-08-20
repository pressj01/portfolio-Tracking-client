import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_GROWTH_TAB,
  parseGrowthTab,
  resolveGrowthTab,
} from './growthWorkspace.js'

test('parseGrowthTab accepts canonical ids and aliases', () => {
  assert.equal(parseGrowthTab('dollars'), 'dollars')
  assert.equal(parseGrowthTab('vs-market'), 'vs-market')
  assert.equal(parseGrowthTab('lots'), 'lots')
  assert.equal(parseGrowthTab('growth-2'), 'dollars')
  assert.equal(parseGrowthTab('market'), 'vs-market')
  assert.equal(parseGrowthTab('gains-losses'), 'lots')
  assert.equal(parseGrowthTab('nope'), null)
  assert.equal(parseGrowthTab(''), null)
})

test('resolveGrowthTab prefers the URL, then storage, then dollars', () => {
  assert.equal(resolveGrowthTab({ searchTab: 'lots', storedTab: 'vs-market' }), 'lots')
  assert.equal(resolveGrowthTab({ storedTab: 'vs-market' }), 'vs-market')
  assert.equal(resolveGrowthTab({}), DEFAULT_GROWTH_TAB)
  assert.equal(resolveGrowthTab({ searchTab: 'unknown' }), DEFAULT_GROWTH_TAB)
})
