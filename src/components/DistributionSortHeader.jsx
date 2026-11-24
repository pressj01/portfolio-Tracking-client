/** Consistent click/keyboard sorting for tables in the Distributions workspace. */
export default function DistributionSortHeader({ column, sort, onSort, className = '' }) {
  const active = sort?.key === column.key
  return <th scope="col" className={`${column.text ? 'dist-left' : ''} ${className}`.trim()}
    aria-sort={active ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
    <button type="button" className="dist-sort" onClick={() => onSort(column.key)} title={`${column.tip ? `${column.tip} ` : ''}Click to sort by ${column.label}.`}>
      <span>{column.display ?? column.label}</span><span className={`dist-sort-indicator${active ? ' is-active' : ''}`} aria-hidden="true">{active ? sort.direction === 'asc' ? '▲' : '▼' : '↕'}</span>
    </button>
  </th>
}
