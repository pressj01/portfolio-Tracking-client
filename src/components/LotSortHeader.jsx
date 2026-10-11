// Header cell for the lot tables. The label is a real button so the sort is
// reachable from the keyboard, and aria-sort announces the current order.
export default function LotSortHeader({ column, sort, onSort }) {
  if (column.sortable === false) {
    return <th title={column.tip}>{column.label}</th>
  }
  const active = sort?.key === column.key
  const direction = active ? sort.direction : null
  return (
    <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="mh-lot-sort"
        onClick={() => onSort(column.key)}
        title={`${column.tip ? `${column.tip} ` : ''}Click to sort by ${column.label}.`}
      >
        {column.label}
        <span aria-hidden="true" className={active ? 'is-active' : undefined}>
          {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}
