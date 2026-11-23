// Toolbar menus for the comparer charts — the metric picker, Saved
// comparisons, Options and Download — plus useChartTools, which wires their
// actions (print, full screen, CSV / Excel / Google Sheets / PNG) to a chart.
// Used by Compare ETFs, Compare Stocks and the Stock and ETF Analysis Returns
// tab so the three screens offer the same tools.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useProfileFetch } from '../context/ProfileContext'
import { CHART_METRICS, chartMetricInfo } from '../utils/chartMetrics'
import {
  downloadChartImage,
  downloadTableCsv,
  downloadTableExcel,
  printChart,
  sendTableToGoogleSheets,
  toggleElementFullscreen,
} from '../utils/chartActions'

function Chevron() {
  return (
    <svg className="ctb-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.8 2.2a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3L5.6 13.4 2 14l.6-3.6 8.2-8.2Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M6.2 4V2.6h3.6V4M4 4l.7 9.4h6.6L12 4M6.6 6.5v4.6M9.4 6.5v4.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2v8M4.8 7 8 10.2 11.2 7M2.5 12.5v1h11v-1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// A button that opens a floating menu; clicking outside or pressing Escape
// closes it. `children` may be a function receiving close().
export function ToolbarDropdown({ label, icon = null, children, align = 'left', className = '', menuClassName = '', title, disabled = false, onOpen }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = useCallback(() => setOpen(false), [])
  const toggle = () => {
    if (disabled) return
    if (!open) onOpen?.()
    setOpen(!open)
  }

  return (
    <div className={`ctb-dropdown ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={`ctb-trigger${open ? ' is-open' : ''}`}
        onClick={toggle}
        title={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
        <span>{label}</span>
        {!icon && <Chevron />}
      </button>
      {open && (
        <div className={`ctb-menu ctb-menu-${align} ${menuClassName}`} role="menu">
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

export function ChartMetricMenu({ metric, onChange, metrics = CHART_METRICS }) {
  const active = chartMetricInfo(metric)
  return (
    <ToolbarDropdown label={active.label} className="ctb-metric" title={active.desc}>
      {close => metrics.map(option => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={option.value === active.value}
          className={`ctb-item${option.value === active.value ? ' is-active' : ''}`}
          title={option.desc}
          onClick={() => { onChange(option.value); close() }}
        >
          {option.label}
        </button>
      ))}
    </ToolbarDropdown>
  )
}

function SavedRow({ item, onLoad, onRename, onDelete, subtitle }) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState(item.name)
  const inputRef = useRef(null)

  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commit = async () => {
    const next = name.trim()
    if (!next || next === item.name) { setName(item.name); setEditing(false); return }
    const ok = await onRename(item, next)
    if (ok) setEditing(false)
  }

  if (editing) {
    return (
      <div className="ctb-saved-row is-editing">
        <input
          ref={inputRef}
          value={name}
          maxLength={120}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.stopPropagation(); setName(item.name); setEditing(false) }
          }}
          aria-label="Comparison name"
        />
        <button type="button" className="ctb-text-btn" onClick={commit}>Save</button>
        <button type="button" className="ctb-text-btn" onClick={() => { setName(item.name); setEditing(false) }}>Cancel</button>
      </div>
    )
  }

  return (
    <div className="ctb-saved-row">
      <button type="button" className="ctb-saved-load" onClick={() => onLoad(item)} title={`Load ${item.symbols.join(', ')}`}>
        <span className="ctb-saved-name">{item.name}</span>
        <span className="ctb-saved-sub">{subtitle}</span>
      </button>
      {confirming ? (
        <span className="ctb-saved-confirm">
          <button type="button" className="ctb-text-btn is-danger" onClick={() => onDelete(item)}>Delete</button>
          <button type="button" className="ctb-text-btn" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <span className="ctb-saved-actions">
          <button type="button" className="ctb-icon-btn" title="Rename" aria-label={`Rename ${item.name}`} onClick={() => setEditing(true)}><PencilIcon /></button>
          <button type="button" className="ctb-icon-btn" title="Delete" aria-label={`Delete ${item.name}`} onClick={() => setConfirming(true)}><TrashIcon /></button>
        </span>
      )}
    </div>
  )
}

// Saved comparisons live in the app database (one list per screen), so they
// survive restarts and updates and travel with database backups.
export function SavedComparisonsMenu({ scope, current, onLoad, describe }) {
  const pf = useProfileFetch()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    setError('')
    pf(`/api/saved-comparisons?scope=${encodeURIComponent(scope)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setItems(d.items || [])
      })
      .catch(e => { setItems(prev => prev || []); setError(e.message || 'Could not load saved comparisons.') })
  }, [pf, scope])

  const save = async () => {
    if (!current?.symbols?.length || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await pf('/api/saved-comparisons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, ...current }),
      })
      const d = await response.json()
      if (!response.ok || d.error) throw new Error(d.error || 'Could not save this comparison.')
      setItems(prev => [d.item, ...(prev || [])])
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const rename = async (item, name) => {
    setError('')
    try {
      const response = await pf(`/api/saved-comparisons/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await response.json()
      if (!response.ok || d.error) throw new Error(d.error || 'Could not rename.')
      setItems(prev => (prev || []).map(entry => (entry.id === item.id ? d.item : entry)))
      return true
    } catch (e) {
      setError(e.message)
      return false
    }
  }

  const remove = async (item) => {
    setError('')
    try {
      const response = await pf(`/api/saved-comparisons/${item.id}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        const d = await response.json().catch(() => ({}))
        throw new Error(d.error || 'Could not delete.')
      }
      setItems(prev => (prev || []).filter(entry => entry.id !== item.id))
    } catch (e) {
      setError(e.message)
    }
  }

  const canSave = Boolean(current?.symbols?.length)
  return (
    <ToolbarDropdown label="Saved" className="ctb-saved" align="right" menuClassName="ctb-saved-menu" onOpen={refresh}>
      {close => (
        <>
          <button
            type="button"
            className="ctb-item ctb-save-current"
            onClick={save}
            disabled={!canSave || busy}
            title={canSave ? `Save ${current.symbols.join(', ')}` : 'Add tickers to save a comparison'}
          >
            <span className="ctb-plus" aria-hidden="true">+</span> {busy ? 'Saving…' : 'Save Current Comparison'}
          </button>
          <div className="ctb-sep" />
          {items == null && <div className="ctb-empty">Loading…</div>}
          {items?.length === 0 && <div className="ctb-empty">No saved comparisons yet.</div>}
          {items?.map(item => (
            <SavedRow
              key={item.id}
              item={item}
              subtitle={describe ? describe(item) : chartMetricInfo(item.metric).label}
              onLoad={(entry) => { onLoad(entry); close() }}
              onRename={rename}
              onDelete={remove}
            />
          ))}
          {error && <div className="ctb-error">{error}</div>}
        </>
      )}
    </ToolbarDropdown>
  )
}

function Switch({ checked }) {
  return <span className={`ctb-switch${checked ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
}

// toggles: [{ key, label, checked, onChange, disabled, title }]
// groups:  [[{ key, label, onClick, disabled, title }], ...] — divided sections
export function ChartOptionsMenu({ toggles = [], groups = [] }) {
  return (
    <ToolbarDropdown label="Options" className="ctb-options" align="right" menuClassName="ctb-options-menu">
      {close => (
        <>
          {toggles.map(toggle => (
            <button
              key={toggle.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={Boolean(toggle.checked)}
              className="ctb-item ctb-toggle"
              disabled={toggle.disabled}
              title={toggle.title}
              onClick={() => toggle.onChange(!toggle.checked)}
            >
              <span>{toggle.label}</span>
              <Switch checked={Boolean(toggle.checked) && !toggle.disabled} />
            </button>
          ))}
          {groups.filter(group => group.length).map((group, index) => (
            <div key={index} className="ctb-group">
              {(toggles.length > 0 || index > 0) && <div className="ctb-sep" />}
              {group.map(action => (
                <button
                  key={action.key}
                  type="button"
                  className="ctb-item"
                  disabled={action.disabled}
                  title={action.title}
                  onClick={() => { close(); action.onClick() }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </ToolbarDropdown>
  )
}

export function ChartDownloadMenu({ actions = [], disabled = false }) {
  return (
    <ToolbarDropdown label="Download" icon={<DownloadIcon />} className="ctb-download" align="right" disabled={disabled}>
      {close => actions.map(action => (
        <button
          key={action.key}
          type="button"
          className="ctb-item"
          disabled={action.disabled}
          onClick={() => { close(); action.onClick() }}
        >
          {action.label}
        </button>
      ))}
    </ToolbarDropdown>
  )
}

// Wires the Options / Download actions to one chart.
//   graphDivRef  — the Plotly graph div (set from onInitialized / onUpdate)
//   cardRef      — the element that goes full screen
//   getTable     — () => { columns, rows } of what is plotted
//   fileStem     — file name without extension
export function useChartTools({ graphDivRef, cardRef, getTable, fileStem, sheetName = 'Chart Data', printTitle = '' }) {
  const [status, setStatus] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // When the browser will not grant real full screen (an embedded view can
  // hold the request forever), the chart is maximized over the window instead.
  const [maximized, setMaximized] = useState(false)
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight))
  const timerRef = useRef(null)

  const say = useCallback((text, tone = 'ok', ms = 6000) => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setStatus(text ? { text, tone } : null)
    if (text && ms) timerRef.current = window.setTimeout(() => setStatus(null), ms)
  }, [])

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])

  useEffect(() => {
    const sync = () => {
      const real = Boolean(cardRef.current && document.fullscreenElement === cardRef.current)
      setIsFullscreen(real)
      if (real) setMaximized(false)
      setViewportHeight(window.innerHeight)
    }
    document.addEventListener('fullscreenchange', sync)
    window.addEventListener('resize', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      window.removeEventListener('resize', sync)
    }
  }, [cardRef])

  useEffect(() => {
    const card = cardRef.current
    if (!maximized || !card) return undefined
    // Plotly re-measures its container only on a window resize event.
    const remeasure = () => window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    card.classList.add('ctb-maximized')
    document.body.classList.add('ctb-maximized-open')
    remeasure()
    const onKey = (event) => { if (event.key === 'Escape') setMaximized(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      card.classList.remove('ctb-maximized')
      document.body.classList.remove('ctb-maximized-open')
      document.removeEventListener('keydown', onKey)
      remeasure()
    }
  }, [maximized, cardRef])

  const withTable = useCallback(() => {
    const table = getTable()
    if (!table?.rows?.length) {
      say('There is no chart data to export yet.', 'warn')
      return null
    }
    return table
  }, [getTable, say])

  const downloadCsv = useCallback(() => {
    const table = withTable()
    if (!table) return
    say(`Downloaded ${downloadTableCsv(table, fileStem)}`)
  }, [withTable, fileStem, say])

  const downloadExcel = useCallback(async () => {
    const table = withTable()
    if (!table) return
    say('Building the Excel file…', 'ok', 0)
    try {
      say(`Downloaded ${await downloadTableExcel(table, { stem: fileStem, sheet: sheetName })}`)
    } catch (e) {
      say(e.message || 'Excel export failed.', 'error')
    }
  }, [withTable, fileStem, sheetName, say])

  const downloadSheets = useCallback(async () => {
    const table = withTable()
    if (!table) return
    const copied = await sendTableToGoogleSheets(table)
    say(copied
      ? `Copied ${table.rows.length.toLocaleString()} rows. A new Google Sheet is opening in your browser: click cell A1 and paste (Ctrl+V).`
      : 'Could not copy to the clipboard. Use Download to CSV and import the file into Google Sheets (File → Import).',
    copied ? 'ok' : 'error', 15000)
  }, [withTable, say])

  const downloadImage = useCallback(async () => {
    try {
      say(`Downloaded ${await downloadChartImage(graphDivRef.current, fileStem)}`)
    } catch (e) {
      say(e.message || 'Image export failed.', 'error')
    }
  }, [graphDivRef, fileStem, say])

  const print = useCallback(async () => {
    try {
      await printChart(graphDivRef.current, printTitle)
    } catch (e) {
      say(e.message || 'Printing failed.', 'error')
    }
  }, [graphDivRef, printTitle, say])

  const fullscreen = useCallback(async () => {
    if (maximized) { setMaximized(false); return }
    if (document.fullscreenElement) {
      try { await document.exitFullscreen() } catch { /* already left */ }
      return
    }
    const card = cardRef.current
    if (!card) return
    const outcome = await Promise.race([
      toggleElementFullscreen(card).then(() => 'granted', () => 'refused'),
      new Promise(resolve => window.setTimeout(() => resolve('no answer'), 800)),
    ])
    if (outcome !== 'granted' && document.fullscreenElement !== card) setMaximized(true)
  }, [cardRef, maximized])

  return {
    status,
    clearStatus: () => say(null),
    isFullscreen: isFullscreen || maximized,
    fullscreenHeight: Math.max(360, viewportHeight - 24),
    downloadCsv,
    downloadExcel,
    downloadSheets,
    downloadImage,
    print,
    fullscreen,
  }
}

export function ChartToolStatus({ status, onDismiss }) {
  if (!status) return null
  return (
    <div className={`ctb-status is-${status.tone}`} role="status">
      <span>{status.text}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  )
}

export function chartDownloadActions(tools) {
  return [
    { key: 'excel', label: 'Download to Excel', onClick: tools.downloadExcel },
    { key: 'csv', label: 'Download to CSV', onClick: tools.downloadCsv },
    { key: 'sheets', label: 'Download to Google Sheets', onClick: tools.downloadSheets },
    { key: 'image', label: 'Download Image', onClick: tools.downloadImage },
  ]
}

// The Options menu's action sections, in the order the menu shows them.
export function chartOptionGroups(tools) {
  return [
    [
      { key: 'print', label: 'Print', onClick: tools.print },
      { key: 'fullscreen', label: tools.isFullscreen ? 'Exit full screen' : 'View full screen', onClick: tools.fullscreen },
    ],
    chartDownloadActions(tools).slice(0, 3),
    chartDownloadActions(tools).slice(3),
  ]
}
