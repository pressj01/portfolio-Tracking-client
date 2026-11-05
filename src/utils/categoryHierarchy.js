// Pure helpers behind the Categories screen and the Dashboard's Portfolio
// overview: the order categories and sub-categories are listed in, sorting
// position rows by a column, and the labeled "% of portfolio / % of category /
// % of sub-category" shares. No React here, so node --test can cover it.

// How the category and sub-category cards are listed. "custom" is the saved
// order (sort_order, changed with the Move up / Move down buttons).
export const GROUP_ORDER_MODES = [
  { key: 'custom', label: 'My order' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'value', label: 'Value (largest first)' },
  { key: 'income', label: 'Income (largest first)' },
]

export const DEFAULT_GROUP_ORDER = 'custom'

export function normalizeGroupOrder(mode) {
  return GROUP_ORDER_MODES.some(option => option.key === mode) ? mode : DEFAULT_GROUP_ORDER
}

const compareText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, {
  numeric: true,
  sensitivity: 'base',
})

// Lists categories (or one category's sub-categories) in the chosen mode.
// "custom" keeps the order they arrived in, which is the saved order.
export function orderGroups(groups, mode, { valueKey = 'actual_value', incomeKey = 'monthly_income' } = {}) {
  const list = Array.isArray(groups) ? [...groups] : []
  const byName = (a, b) => compareText(a?.name, b?.name)
  const byNumber = key => (a, b) => (Number(b?.[key]) || 0) - (Number(a?.[key]) || 0) || byName(a, b)
  switch (normalizeGroupOrder(mode)) {
    case 'name': return list.sort(byName)
    case 'value': return list.sort(byNumber(valueKey))
    case 'income': return list.sort(byNumber(incomeKey))
    default: return list
  }
}

// The saved order after moving one id up (delta -1) or down (delta +1).
// Returns null when the move would go past either end or the id is missing.
export function moveId(ids, id, delta) {
  const list = Array.isArray(ids) ? [...ids] : []
  const from = list.findIndex(item => String(item) === String(id))
  const to = from + Number(delta)
  if (from < 0 || !Number.isInteger(to) || to < 0 || to >= list.length || to === from) return null
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
  return list
}

// part as a % of whole, or null when there is no whole to divide by.
export function sharePct(part, whole) {
  const total = Number(whole)
  if (!Number.isFinite(total) || total <= 0) return null
  return (Number(part) || 0) / total * 100
}

// One labeled share per level, e.g. [{ label: 'portfolio', pct: 4.2 },
// { label: 'Metals', pct: 35 }, { label: 'Gold', pct: 70 }]. Levels with no
// total are dropped, so a row outside a sub-category simply has no third line.
export function shareLines(part, levels) {
  return (Array.isArray(levels) ? levels : [])
    .map(level => ({ label: level?.label, pct: sharePct(part, level?.total) }))
    .filter(line => line.label && line.pct != null)
}

export function formatShare(line, digits = 1) {
  return `${line.pct.toFixed(digits)}% of ${line.label}`
}

// Clicking the active column flips its direction; clicking a new column starts
// it in that column's natural direction (text A→Z, numbers largest first).
export function nextSort(current, key, { textKeys = [] } = {}) {
  if (current?.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key, direction: textKeys.includes(key) ? 'asc' : 'desc' }
}

export function normalizeSort(sort, validKeys, fallback) {
  if (sort && validKeys.includes(sort.key) && (sort.direction === 'asc' || sort.direction === 'desc')) {
    return { key: sort.key, direction: sort.direction }
  }
  return fallback
}

const isBlank = value => value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))

// Sorts rows by the column in `sort`. `accessors` maps a column key to a
// function returning that row's value. Blank values sort last in either
// direction; ties keep their incoming order.
export function sortRows(rows, sort, accessors = {}) {
  const list = Array.isArray(rows) ? [...rows] : []
  const read = accessors?.[sort?.key]
  if (typeof read !== 'function') return list
  const sign = sort.direction === 'asc' ? 1 : -1
  return list
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      const aBlank = isBlank(a.value)
      const bBlank = isBlank(b.value)
      if (aBlank || bBlank) return aBlank === bBlank ? a.index - b.index : (aBlank ? 1 : -1)
      const diff = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : compareText(a.value, b.value)
      return diff * sign || a.index - b.index
    })
    .map(entry => entry.row)
}

// ── Nested sub-categories ───────────────────────────────────────────────────
// Sub-categories nest to any depth: each has a parent_id (null = directly
// under its category). The API lists them in tree order with a depth.

// Builds the tree. Children keep (sort_order, name) order, so a local re-order
// shows correctly before the server answers. A sub whose parent is missing (or
// that sits in a cycle) is treated as top level, so every sub appears once.
export function buildSubcategoryTree(subs) {
  const list = Array.isArray(subs) ? subs : []
  const byId = new Map()
  list.forEach(sub => byId.set(String(sub.id), { ...sub, children: [] }))
  const parentKey = node => {
    const key = node.parent_id == null ? null : String(node.parent_id)
    return key != null && byId.has(key) && key !== String(node.id) ? key : null
  }
  // Break cycles: walk up from each node; a node that meets itself is a root.
  byId.forEach(node => {
    const seen = new Set([String(node.id)])
    let key = parentKey(node)
    while (key != null) {
      if (seen.has(key)) { node.parent_id = null; break }
      seen.add(key)
      key = parentKey(byId.get(key))
    }
  })
  const roots = []
  byId.forEach(node => {
    const key = parentKey(node)
    if (key == null) {
      node.parent_id = null
      roots.push(node)
    } else {
      byId.get(key).children.push(node)
    }
  })
  const bySortOrder = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || compareText(a.name, b.name)
  const finish = (nodes, depth, path) => {
    nodes.sort(bySortOrder)
    nodes.forEach(node => {
      node.depth = depth
      node.path = path // ancestors, top first (not including the node)
      finish(node.children, depth + 1, [...path, node])
    })
  }
  finish(roots, 0, [])
  const ordered = []
  const walk = nodes => nodes.forEach(node => { ordered.push(node); walk(node.children) })
  walk(roots)
  return { roots, byId, ordered }
}

// The node's id plus every id nested under it.
export function subtreeIds(node) {
  const ids = new Set()
  const walk = n => { ids.add(String(n.id)); n.children.forEach(walk) }
  if (node) walk(node)
  return ids
}

// For client-side filters: the selected sub-category ids plus everything
// nested under them, as strings.
export function expandSubcategorySelection(subs, selectedIds) {
  const wanted = new Set((selectedIds || []).map(String))
  if (!wanted.size) return wanted
  const { byId } = buildSubcategoryTree(subs)
  const out = new Set()
  wanted.forEach(id => {
    const node = byId.get(id)
    if (node) subtreeIds(node).forEach(x => out.add(x))
    else out.add(id)
  })
  return out
}

// For /api/holdings rows: true when the holding sits in one of the selected
// sub-categories or in one nested inside it (subcategory_path_ids is its
// whole chain, top first).
export function holdingInSubcategories(holding, selectedIds) {
  const selected = (selectedIds || []).map(String)
  if (!selected.length || !holding) return false
  const chain = Array.isArray(holding.subcategory_path_ids) && holding.subcategory_path_ids.length
    ? holding.subcategory_path_ids
    : (holding.subcategory_id != null ? [holding.subcategory_id] : [])
  return chain.some(id => selected.includes(String(id)))
}

// "  Name" with a non-breaking indent per level, for <option> labels.
export function indentedName(sub) {
  return `${'   '.repeat(Math.max(0, Number(sub?.depth) || 0))}${sub?.name ?? ''}`
}

// Rolls a category's holdings up its sub-category tree. `tickers` need
// current_value and monthly_income (or the keys given). Each node gets
// direct (its own holdings), all (its whole branch), value and income for
// the branch. Holdings with no (or an unknown) sub-category are `unassigned`.
export function rollUpCategoryTree(subs, tickers, { valueKey = 'current_value', incomeKey = 'monthly_income' } = {}) {
  const tree = buildSubcategoryTree(subs)
  const unassigned = []
  tree.byId.forEach(node => { node.direct = [] })
  ;(tickers || []).forEach(t => {
    const node = t?.subcategory_id == null ? null : tree.byId.get(String(t.subcategory_id))
    if (node) node.direct.push(t)
    else unassigned.push(t)
  })
  const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r?.[key]) || 0), 0)
  const roll = node => {
    node.children.forEach(roll)
    node.all = [...node.direct, ...node.children.flatMap(child => child.all)]
    node.value = sum(node.all, valueKey)
    node.income = sum(node.all, incomeKey)
  }
  tree.roots.forEach(roll)
  return { ...tree, unassigned }
}

// Browser storage can be missing or throw (private window, cleared data), so
// these never let a storage failure break the page.
export function readStoredJson(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function writeStoredJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Non-critical: the choice just isn't remembered next time.
  }
}
