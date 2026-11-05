// Header cell for the lot tables. The label is a real button so the sort is
// reachable from the keyboard, and aria-sort announces the current order.
// `column.display` (optional) is what the cell shows, e.g. a label split over
// two lines; `column.label` stays the plain-text name used in the tooltip.
export default function LotSortHeader({ column, sort, onSort, style }) {
  if (column.sortable === false) {
    return <th title={column.tip} style={style}>{column.display ?? column.label}</th>
  }
  const active = sort?.key === column.key
  const direction = active ? sort.direction : null
  return (
    <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} style={style}>
      <button
        type="button"
        className="mh-lot-sort"
        onClick={() => onSort(column.key)}
        title={`${column.tip ? `${column.tip} ` : ''}Click to sort by ${column.label}.`}
      >
        {column.display ?? column.label}
        <span aria-hidden="true" className={active ? 'is-active' : undefined}>
          {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}
