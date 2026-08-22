import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MENU_ORDER,
  MENU_PRESETS,
  NAVIGATION_ITEMS,
  matchingMenuPreset,
  menuIdForPath,
  normalizeHiddenIds,
  normalizeMenuOrder,
  orderMenuItems,
  PROTECTED_MENU_IDS,
  TOP_LEVEL_SCOPE_ID,
  visibleNavigation,
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

test('normalizeHiddenIds drops protected, unknown, and duplicate ids', () => {
  const hidden = normalizeHiddenIds([
    'options',
    'dashboard',
    'menu-control',
    'not-a-page',
    'options',
    'dividend-compare',
  ])
  assert.deepEqual(hidden, ['options', 'dividend-compare'])
  assert.equal(hidden.some(id => PROTECTED_MENU_IDS.has(id)), false)
})

test('income tracker preset hides the Options menu and keeps Dashboard', () => {
  const preset = MENU_PRESETS.find(item => item.id === 'income-tracker')
  const menus = visibleNavigation({}, preset.hidden)
  assert.equal(menus.some(menu => menu.id === 'options'), false)
  assert.equal(menus.some(menu => menu.id === 'dashboard'), true)
  assert.equal(menus.some(menu => menu.id === 'admin'), true)
  assert.equal(matchingMenuPreset(preset.hidden), 'income-tracker')
  assert.equal(matchingMenuPreset([...preset.hidden, 'watchlist']), null)
})

test('hiding every page in a dropdown removes the dropdown', () => {
  const menus = visibleNavigation({}, ['stock-buying-checklist', 'etf-buying-checklist', 'option-income-etf-evaluator'])
  assert.equal(menus.some(menu => menu.id === 'checklists'), false)
})

test('menuIdForPath maps routes, query strings, and CEF detail pages', () => {
  assert.equal(menuIdForPath('/'), 'dashboard')
  assert.equal(menuIdForPath('/growth?tab=lots'), 'growth')
  assert.equal(menuIdForPath('/closed-cef-info/AGD'), 'closed-cef-information')
  assert.equal(menuIdForPath('/div-calendar'), 'dividend-calendar')
})
