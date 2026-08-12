import React, { useState } from 'react'

/**
 * Dropdown panel that drives a table's column layout: a checkbox per column and
 * one ordered, draggable list. Pair it with useColumnLayout — pass that hook's
 * whole return value as `layout`.
 *
 * The list is in display order rather than grouped, because the order IS the
 * setting being edited here; `groupOf` keeps any grouping visible as a tag.
 */
export default function ColumnCustomizer({
  layout,
  labelOf = col => col.label,
  detailOf,
  groupOf,
  buttonLabel = 'Columns',
  presets,
  hint = 'Drag a row to reorder, or drag a header on the table itself. Uncheck a column to hide it.',
}) {
  const [search, setSearch] = useState('')
  const { columns, keyField } = layout
  const query = search.trim().toLowerCase()
  const matches = query
    ? columns.filter(col => (
      `${labelOf(col) || ''} ${detailOf?.(col) || ''}`.toLowerCase().includes(query)
    ))
    : columns
  const shownCount = columns.length - layout.hiddenCount

  return (
    <details className="column-picker">
      <summary>
        {buttonLabel}
        <span>{shownCount}/{columns.length}</span>
      </summary>
      <div className="column-picker-panel">
        <div className="column-picker-actions">
          {(presets || []).map(preset => (
            <button
              key={preset.label}
              type="button"
              title={preset.tip}
              onClick={() => layout.applyPreset(preset.keys)}
            >
              {preset.label}
            </button>
          ))}
          <button type="button" onClick={layout.showAllColumns}>Show all</button>
          <button type="button" onClick={layout.resetLayout}>Reset order &amp; visibility</button>
        </div>
        <p className="column-picker-hint">{hint}</p>
        <input
          className="column-picker-search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search columns..."
        />
        <div className="column-picker-list">
          {matches.map(col => {
            const key = col[keyField]
            const locked = layout.isLocked(key)
            const position = columns.indexOf(col)
            const group = groupOf?.(col)
            const detail = detailOf?.(col)
            return (
              <div
                key={key}
                className={layout.dragClass(key, 'column-picker-row')}
                {...layout.dragHandlers(key)}
              >
                <span className="column-picker-handle" title="Drag to reorder">⠿</span>
                <label className="column-picker-check">
                  <input
                    type="checkbox"
                    checked={!layout.isHidden(key)}
                    disabled={locked}
                    onChange={() => layout.toggleColumn(key)}
                  />
                  <span>
                    <strong>
                      {labelOf(col)}
                      {locked && <em className="column-picker-tag">always on</em>}
                      {group && <em className="column-picker-tag">{group}</em>}
                    </strong>
                    {detail && <small>{detail}</small>}
                  </span>
                </label>
                <span className="column-picker-move">
                  <button
                    type="button"
                    title="Move earlier"
                    disabled={position <= 0}
                    onClick={() => layout.moveColumnBy(key, -1)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    title="Move later"
                    disabled={position < 0 || position >= columns.length - 1}
                    onClick={() => layout.moveColumnBy(key, 1)}
                  >
                    ▼
                  </button>
                </span>
              </div>
            )
          })}
          {!matches.length && (
            <p className="column-picker-empty">No columns match &ldquo;{search}&rdquo;.</p>
          )}
        </div>
      </div>
    </details>
  )
}
