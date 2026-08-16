import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MENU_ORDER,
  NAVIGATION_ITEMS,
  normalizeMenuOrder,
  orderMenuItems,
  TOP_LEVEL_SCOPE_ID,
} from './menuConfig.js'

test('a partial saved order keeps known IDs and appends new menu items', () => {
  const normalized = normalizeMenuOrder({
    options: ['option-greeks', 'obsolete-item', 'option-dashboard', 'option-greeks'],
  })

  assert.deepEqual(normalized.options.slice(0, 2), ['option-greeks', 'option-dashboard'])
  assert.equal(normalized.options.includes('obsolete-item'), false)
  assert.equal(new Set(normalized.options).size, DEFAULT_MENU_ORDER.options.length)
  assert.deepEqual(
    normalized.options.slice(2),
    DEFAULT_MENU_ORDER.options.filter(id => !['option-greeks', 'option-dashboard'].includes(id)),
  )
})

test('invalid saved values fall back to the built-in order', () => {
  const normalized = normalizeMenuOrder({ options: 'not-an-array' })

  assert.deepEqual(normalized.options, DEFAULT_MENU_ORDER.options)
})

test('top-level navigation is returned in the customized order', () => {
  const custom = normalizeMenuOrder({
    [TOP_LEVEL_SCOPE_ID]: ['admin', 'dashboard'],
  })
  const ordered = orderMenuItems(NAVIGATION_ITEMS, TOP_LEVEL_SCOPE_ID, custom)

  assert.deepEqual(ordered.slice(0, 2).map(item => item.id), ['admin', 'dashboard'])
  assert.equal(ordered.length, NAVIGATION_ITEMS.length)
})
