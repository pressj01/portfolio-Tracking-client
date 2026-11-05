import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSubcategoryTree,
  expandSubcategorySelection,
  holdingInSubcategories,
  indentedName,
  rollUpCategoryTree,
  subtreeIds,
  formatShare,
  moveId,
  nextSort,
  normalizeGroupOrder,
  normalizeSort,
  orderGroups,
  shareLines,
  sharePct,
  sortRows,
} from './categoryHierarchy.js'

const groups = [
  { id: 1, name: 'Metals', actual_value: 500, monthly_income: 0 },
  { id: 2, name: 'anchors', actual_value: 900, monthly_income: 40 },
  { id: 3, name: 'Boosters', actual_value: 900, monthly_income: 90 },
]

test('"My order" keeps the saved order the categories arrived in', () => {
  assert.deepEqual(orderGroups(groups, 'custom').map(g => g.id), [1, 2, 3])
})

test('name order ignores case', () => {
  assert.deepEqual(orderGroups(groups, 'name').map(g => g.name), ['anchors', 'Boosters', 'Metals'])
})

test('value order is largest first, ties broken by name', () => {
  assert.deepEqual(orderGroups(groups, 'value').map(g => g.id), [2, 3, 1])
})

test('income order is largest first', () => {
  assert.deepEqual(orderGroups(groups, 'income').map(g => g.id), [3, 2, 1])
})

test('ordering never mutates the input list', () => {
  const input = [...groups]
  orderGroups(input, 'name')
  assert.deepEqual(input.map(g => g.id), [1, 2, 3])
})

test('an unknown order falls back to the saved order', () => {
  assert.equal(normalizeGroupOrder('bogus'), 'custom')
  assert.deepEqual(orderGroups(groups, 'bogus').map(g => g.id), [1, 2, 3])
})

test('moving an id up or down swaps it with its neighbour', () => {
  assert.deepEqual(moveId([1, 2, 3], 2, -1), [2, 1, 3])
  assert.deepEqual(moveId([1, 2, 3], 2, 1), [1, 3, 2])
})

test('moving past either end, or a missing id, is not a move', () => {
  assert.equal(moveId([1, 2, 3], 1, -1), null)
  assert.equal(moveId([1, 2, 3], 3, 1), null)
  assert.equal(moveId([1, 2, 3], 9, 1), null)
})

test('sharePct has no answer without a whole', () => {
  assert.equal(sharePct(5, 0), null)
  assert.equal(sharePct(5, null), null)
  assert.equal(sharePct(25, 100), 25)
})

test('a position in a sub-category gets portfolio, category and sub-category shares', () => {
  const lines = shareLines(70, [
    { label: 'portfolio', total: 1000 },
    { label: 'Metals', total: 200 },
    { label: 'Gold', total: 100 },
  ])
  assert.deepEqual(lines.map(line => formatShare(line)), ['7.0% of portfolio', '35.0% of Metals', '70.0% of Gold'])
})

test('a level with no total is left out instead of showing 0%', () => {
  const lines = shareLines(70, [
    { label: 'portfolio', total: 1000 },
    { label: 'Metals', total: 200 },
    { label: 'Gold', total: null },
  ])
  assert.deepEqual(lines.map(l => l.label), ['portfolio', 'Metals'])
})

test('clicking the active column flips it; a new column starts in its natural direction', () => {
  const textKeys = ['ticker']
  assert.deepEqual(nextSort({ key: 'value', direction: 'desc' }, 'value', { textKeys }), { key: 'value', direction: 'asc' })
  assert.deepEqual(nextSort({ key: 'value', direction: 'desc' }, 'ticker', { textKeys }), { key: 'ticker', direction: 'asc' })
  assert.deepEqual(nextSort({ key: 'ticker', direction: 'asc' }, 'income', { textKeys }), { key: 'income', direction: 'desc' })
})

test('a stored sort for a column that no longer exists falls back', () => {
  const fallback = { key: 'ticker', direction: 'asc' }
  assert.deepEqual(normalizeSort({ key: 'gone', direction: 'asc' }, ['ticker'], fallback), fallback)
  assert.deepEqual(normalizeSort({ key: 'ticker', direction: 'sideways' }, ['ticker'], fallback), fallback)
  assert.deepEqual(normalizeSort({ key: 'ticker', direction: 'desc' }, ['ticker'], fallback), { key: 'ticker', direction: 'desc' })
})

test('rows sort by number or text, and blanks stay last both ways', () => {
  const rows = [
    { ticker: 'b', value: 10 },
    { ticker: 'A', value: null },
    { ticker: 'c', value: 30 },
  ]
  const accessors = { ticker: r => r.ticker, value: r => r.value }
  assert.deepEqual(sortRows(rows, { key: 'value', direction: 'desc' }, accessors).map(r => r.ticker), ['c', 'b', 'A'])
  assert.deepEqual(sortRows(rows, { key: 'value', direction: 'asc' }, accessors).map(r => r.ticker), ['b', 'c', 'A'])
  assert.deepEqual(sortRows(rows, { key: 'ticker', direction: 'asc' }, accessors).map(r => r.ticker), ['A', 'b', 'c'])
})

test('an unknown sort column leaves the rows as they were', () => {
  const rows = [{ ticker: 'b' }, { ticker: 'a' }]
  assert.deepEqual(sortRows(rows, { key: 'nope', direction: 'asc' }, {}).map(r => r.ticker), ['b', 'a'])
})

// Metals › Gold › Miners › Juniors, Metals › Silver
const nested = [
  { id: 1, name: 'Gold', parent_id: null, sort_order: 0 },
  { id: 2, name: 'Silver', parent_id: null, sort_order: 1 },
  { id: 3, name: 'Miners', parent_id: 1, sort_order: 0 },
  { id: 4, name: 'Juniors', parent_id: 3, sort_order: 0 },
]

test('the tree nests sub-categories to any depth, with depth and path', () => {
  const { roots, ordered, byId } = buildSubcategoryTree(nested)
  assert.deepEqual(roots.map(n => n.name), ['Gold', 'Silver'])
  assert.deepEqual(ordered.map(n => `${n.depth}:${n.name}`), ['0:Gold', '1:Miners', '2:Juniors', '0:Silver'])
  assert.deepEqual(byId.get('4').path.map(n => n.name), ['Gold', 'Miners'])
})

test('children follow sort_order, so a local move shows before the server answers', () => {
  const moved = nested.map(s => (s.id === 1 ? { ...s, sort_order: 5 } : s))
  assert.deepEqual(buildSubcategoryTree(moved).roots.map(n => n.name), ['Silver', 'Gold'])
})

test('a missing parent or a cycle never hides a sub-category', () => {
  const broken = [
    { id: 1, name: 'A', parent_id: 2 },
    { id: 2, name: 'B', parent_id: 1 },
    { id: 3, name: 'C', parent_id: 99 },
  ]
  const { ordered } = buildSubcategoryTree(broken)
  assert.deepEqual(ordered.map(n => n.name).sort(), ['A', 'B', 'C'])
})

test('selecting a parent sub-category also selects everything nested under it', () => {
  assert.deepEqual([...expandSubcategorySelection(nested, ['3'])].sort(), ['3', '4'])
  assert.deepEqual([...expandSubcategorySelection(nested, [1])].sort(), ['1', '3', '4'])
  assert.deepEqual([...subtreeIds(buildSubcategoryTree(nested).byId.get('2'))], ['2'])
})

test('option labels indent one step per level', () => {
  assert.equal(indentedName({ name: 'Juniors', depth: 2 }), '      Juniors')
  assert.equal(indentedName({ name: 'Gold', depth: 0 }), 'Gold')
})

test('holdings roll up every level; unknown or missing sub-categories are unassigned', () => {
  const tickers = [
    { ticker: 'GDXJ', subcategory_id: 4, current_value: 100, monthly_income: 1 },
    { ticker: 'GDX', subcategory_id: 3, current_value: 200, monthly_income: 2 },
    { ticker: 'GLD', subcategory_id: 1, current_value: 300, monthly_income: 0 },
    { ticker: 'SLV', subcategory_id: 2, current_value: 50, monthly_income: 0 },
    { ticker: 'CPER', subcategory_id: null, current_value: 25, monthly_income: 0 },
    { ticker: 'OLD', subcategory_id: 77, current_value: 5, monthly_income: 0 },
  ]
  const tree = rollUpCategoryTree(nested, tickers)
  const gold = tree.byId.get('1')
  assert.equal(gold.value, 600)
  assert.equal(gold.income, 3)
  assert.deepEqual(gold.direct.map(t => t.ticker), ['GLD'])
  assert.deepEqual(gold.all.map(t => t.ticker).sort(), ['GDX', 'GDXJ', 'GLD'])
  assert.equal(tree.byId.get('3').value, 300)
  assert.deepEqual(tree.unassigned.map(t => t.ticker), ['CPER', 'OLD'])
})

test('a holding matches a selected sub-category at any level above it', () => {
  const holding = { ticker: 'GDXJ', subcategory_id: 4, subcategory_path_ids: [1, 3, 4] }
  assert.equal(holdingInSubcategories(holding, ['1']), true)
  assert.equal(holdingInSubcategories(holding, [3]), true)
  assert.equal(holdingInSubcategories(holding, ['2']), false)
  assert.equal(holdingInSubcategories(holding, []), false)
  // Rows from before paths existed still match their own sub-category.
  assert.equal(holdingInSubcategories({ subcategory_id: 4 }, ['4']), true)
})
