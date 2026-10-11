const isMissing = value => value == null || value === ''

const compareText = (left, right) => (
  String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
)

/**
 * Compare two present cell values. `type` is 'number', 'date' or 'string'; with
 * no type a pair of numbers compares numerically and anything else as text.
 */
export function compareSortValues(left, right, type) {
  if (type === 'number') return Number(left) - Number(right)
  if (type === 'date') {
    const leftTime = Date.parse(left)
    const rightTime = Date.parse(right)
    return Number.isNaN(leftTime) || Number.isNaN(rightTime)
      ? compareText(left, right)
      : leftTime - rightTime
  }
  if (type == null && typeof left === 'number' && typeof right === 'number') return left - right
  return compareText(left, right)
}

/**
 * Stable sort on a derived value. A blank value sorts last in both directions:
 * a row with nothing to compare is not the smallest row, and flipping the
 * arrow should not float it to the top. Ties keep the order the rows came in.
 */
export function sortByValue(rows, { valueOf, type, direction = 'asc' }) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((a, b) => {
      const aMissing = isMissing(a.value)
      const bMissing = isMissing(b.value)
      if (aMissing && bMissing) return a.index - b.index
      if (aMissing) return 1
      if (bMissing) return -1
      const comparison = compareSortValues(a.value, b.value, type)
      if (comparison === 0) return a.index - b.index
      return direction === 'asc' ? comparison : -comparison
    })
    .map(entry => entry.row)
}

/**
 * Sort lot rows by one of `columns` ({ key, type, value? }). `sort` is
 * { key, direction }; with no sort the rows keep their ledger order.
 */
export function sortLotRows(rows, sort, columns) {
  if (!Array.isArray(rows)) return []
  const column = sort?.key ? columns.find(col => col.key === sort.key) : null
  if (!column) return rows
  return sortByValue(rows, {
    valueOf: column.value || (row => row[column.key]),
    type: column.type,
    direction: sort.direction,
  })
}

// First click sorts ascending; clicking the active column again flips it.
export const nextLotSort = (current, key) => ({
  key,
  direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc',
})
