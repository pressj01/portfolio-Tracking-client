// Saved table layouts are two key lists — the display order, and the keys the
// user switched off — never the column objects themselves. A layout written
// before a column existed still resolves, and the new column joins the end
// instead of the whole saved layout being discarded as unrecognised.

export const EMPTY_LAYOUT = { order: [], hidden: [] }

const stringKeys = (value) => (
  Array.isArray(value)
    ? [...new Set(value.filter(key => typeof key === 'string' && key))]
    : []
)

export function normalizeLayout(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const order = stringKeys(value.order)
  const hidden = stringKeys(value.hidden)
  if (!order.length && !hidden.length) return null
  return { order, hidden }
}

// The Dashboard used to save a bare list of the visible column ids. That list is
// already an order, so it converts straight across and the user keeps the
// selection they had before reordering existed.
export function layoutFromVisibleKeys(visibleKeys, allKeys) {
  const visible = stringKeys(visibleKeys).filter(key => allKeys.includes(key))
  if (!visible.length) return null
  const hidden = allKeys.filter(key => !visible.includes(key))
  return { order: [...visible, ...hidden], hidden }
}

export function parseLayout(raw, migrate) {
  if (!raw) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return normalizeLayout(parsed) || (migrate ? normalizeLayout(migrate(parsed)) : null)
}

const sameKeys = (left, right) => (
  left.length === right.length && left.every((key, index) => key === right[index])
)

export function sameLayout(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  return sameKeys(left.order, right.order) && sameKeys(left.hidden, right.hidden)
}

// Saved keys first, then every key the saved order has never seen.
export function orderKeys(allKeys, savedOrder = []) {
  const known = new Set(allKeys)
  const saved = savedOrder.filter(key => known.has(key))
  const seen = new Set(saved)
  return [...saved, ...allKeys.filter(key => !seen.has(key))]
}

// Put newly added columns next to a related one instead of dumping them at the
// end of a layout that was saved before they existed. Keys already in `order`
// stay where the user put them.
export function insertMissingKeysAfter(layout, insertions = []) {
  const order = [...(layout?.order || [])]
  // An empty order means "definition order", which already puts a new column
  // where its definition says. Inserting into it would turn that into a partial
  // explicit order whose only entry is the new key — first place in the table.
  if (!order.length) return layout
  let changed = false
  for (const item of insertions) {
    const key = item?.key
    if (!key || order.includes(key)) continue
    const after = order.indexOf(item.after)
    if (after >= 0) order.splice(after + 1, 0, key)
    else order.push(key)
    changed = true
  }
  if (!changed) return layout
  return { order, hidden: [...(layout?.hidden || [])] }
}

// Drop `fromKey` where `toKey` currently sits. Dragging left lands on the target
// and pushes it right; dragging right lands just past it — the behaviour a drag
// reads as, in both directions.
export function moveKey(keys, fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return keys
  const from = keys.indexOf(fromKey)
  const to = keys.indexOf(toKey)
  if (from < 0 || to < 0) return keys
  const next = [...keys]
  next.splice(from, 1)
  next.splice(next.indexOf(toKey) + (from < to ? 1 : 0), 0, fromKey)
  return next
}

/**
 * Apply a saved layout to a column definition list.
 *
 * Returns the full list in display order plus the visible subset. A locked key
 * can never be hidden, and an empty result falls back to the first column — a
 * table with no columns is a broken screen, not a preference.
 */
export function resolveColumns(columns, layout, { keyField = 'key', lockedKeys = [] } = {}) {
  const byKey = new Map(columns.map(col => [col?.[keyField], col]))
  const ordered = orderKeys([...byKey.keys()], layout?.order || []).map(key => byKey.get(key))
  const locked = new Set(lockedKeys)
  const hiddenKeys = new Set((layout?.hidden || []).filter(key => !locked.has(key) && byKey.has(key)))
  const visible = ordered.filter(col => !hiddenKeys.has(col?.[keyField]))
  return {
    ordered,
    visible: visible.length ? visible : ordered.slice(0, 1),
    hiddenKeys,
  }
}
