import { useMemo, useState } from 'react'
import { nextLotSort, sortLotRows } from './lotTableSort'

/**
 * Column sorting for a plain data table, built on the lot tables' helpers so
 * every sortable table in the app behaves alike: first click ascending, a
 * second click flips it, blanks stay at the bottom either way, and ties keep
 * the order the rows arrived in.
 *
 * `columns` is [{ key, type: 'number'|'date'|'string', value?: row => any }].
 * With no `initialSort` the rows keep their incoming order until a heading is
 * clicked. Render headings with <LotSortHeader column sort onSort />.
 */
export default function useTableSort(rows, columns, initialSort = null) {
  const [sort, setSort] = useState(initialSort)
  const sorted = useMemo(
    () => sortLotRows(Array.isArray(rows) ? rows : [], sort, columns),
    [rows, sort, columns],
  )
  const onSort = key => setSort(current => nextLotSort(current, key))
  return { sorted, sort, onSort, setSort }
}
