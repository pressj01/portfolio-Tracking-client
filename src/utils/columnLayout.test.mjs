import assert from 'node:assert/strict'
import test from 'node:test'
import {
  layoutFromVisibleKeys,
  moveKey,
  normalizeLayout,
  orderKeys,
  parseLayout,
  resolveColumns,
  sameLayout,
} from './columnLayout.js'

const cols = ['a', 'b', 'c', 'd'].map(key => ({ key, label: key.toUpperCase() }))

test('a column added after the layout was saved joins the end instead of vanishing', () => {
  const { ordered, visible } = resolveColumns(cols, { order: ['c', 'a'], hidden: [] })

  assert.deepEqual(ordered.map(col => col.key), ['c', 'a', 'b', 'd'])
  assert.deepEqual(visible.map(col => col.key), ['c', 'a', 'b', 'd'])
})

test('a key saved for a column that no longer exists is dropped, not rendered', () => {
  const { ordered } = resolveColumns(cols, { order: ['gone', 'b'], hidden: ['also_gone'] })

  assert.deepEqual(ordered.map(col => col.key), ['b', 'a', 'c', 'd'])
})

test('hiding respects locked keys and never empties the table', () => {
  const layout = { order: [], hidden: ['a', 'b', 'c', 'd'] }
  const { visible } = resolveColumns(cols, layout, { lockedKeys: ['a'] })

  assert.deepEqual(visible.map(col => col.key), ['a'])

  const noLock = resolveColumns(cols, layout)
  assert.deepEqual(noLock.visible.map(col => col.key), ['a'])
})

test('a hidden column keeps its position for when it is switched back on', () => {
  const layout = { order: ['d', 'c', 'b', 'a'], hidden: ['c'] }
  const { visible } = resolveColumns(cols, layout)
  assert.deepEqual(visible.map(col => col.key), ['d', 'b', 'a'])

  const reshown = resolveColumns(cols, { ...layout, hidden: [] })
  assert.deepEqual(reshown.visible.map(col => col.key), ['d', 'c', 'b', 'a'])
})

test('dragging left lands on the target, dragging right lands past it', () => {
  assert.deepEqual(moveKey(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'b', 'c'])
  assert.deepEqual(moveKey(['a', 'b', 'c', 'd'], 'a', 'c'), ['b', 'c', 'a', 'd'])
})

test('a no-op drag returns the original array so no re-render is triggered', () => {
  const keys = ['a', 'b', 'c']

  assert.equal(moveKey(keys, 'b', 'b'), keys)
  assert.equal(moveKey(keys, null, 'b'), keys)
  assert.equal(moveKey(keys, 'b', 'missing'), keys)
})

test('the legacy visible-id list converts without losing the saved selection', () => {
  const migrated = layoutFromVisibleKeys(['c', 'a'], ['a', 'b', 'c', 'd'])

  assert.deepEqual(migrated, { order: ['c', 'a', 'b', 'd'], hidden: ['b', 'd'] })

  const { visible } = resolveColumns(cols, migrated)
  assert.deepEqual(visible.map(col => col.key), ['c', 'a'])
})

test('parseLayout falls back to the migration only for an unrecognised shape', () => {
  const migrate = raw => layoutFromVisibleKeys(raw, ['a', 'b', 'c', 'd'])

  assert.deepEqual(parseLayout('["b"]', migrate), { order: ['b', 'a', 'c', 'd'], hidden: ['a', 'c', 'd'] })
  assert.deepEqual(parseLayout('{"order":["b"],"hidden":[]}', migrate), { order: ['b'], hidden: [] })
  assert.equal(parseLayout('not json', migrate), null)
  assert.equal(parseLayout('', migrate), null)
})

test('normalizeLayout rejects junk and de-duplicates keys', () => {
  assert.equal(normalizeLayout(null), null)
  assert.equal(normalizeLayout(['a']), null)
  assert.equal(normalizeLayout({ order: [], hidden: [] }), null)
  assert.deepEqual(
    normalizeLayout({ order: ['a', 'a', 7, '', 'b'], hidden: ['c'] }),
    { order: ['a', 'b'], hidden: ['c'] },
  )
})

test('orderKeys and sameLayout support the cross-window sync', () => {
  assert.deepEqual(orderKeys(['a', 'b', 'c'], ['c']), ['c', 'a', 'b'])
  assert.equal(sameLayout({ order: ['a'], hidden: [] }, { order: ['a'], hidden: [] }), true)
  assert.equal(sameLayout({ order: ['a'], hidden: [] }, { order: ['b'], hidden: [] }), false)
  assert.equal(sameLayout({ order: [], hidden: ['a'] }, { order: [], hidden: [] }), false)
})
