/**
 * Two screens side by side inside one window.
 *
 * Opening a second copy of the app compares two screens, but the two copies do
 * not share anything: the portfolio selector, the basis mode and — the reason
 * this page exists — the shared performance date range are all per-window, so
 * the left chart and the right chart quietly answer different questions. Two
 * panes in one window sit under the same providers, so picking a range on one
 * side moves the other side with it.
 *
 * The panes are for reading. Each renders a real screen, so its own filters and
 * toggles work, but links that navigate leave the split page the way they would
 * anywhere else.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE_GROUPS, isKnownPagePath, pageElement, pathnameOf } from '../pageCatalog'

const SPLIT_STATE_KEY = 'portfolio_split_view_v1'
const DEFAULT_LEFT = '/'
const DEFAULT_RIGHT = '/total-return'
// Below this the pane is too narrow to read a table in, and dragging past it
// reads as "close this side" rather than a size anyone wanted.
const MIN_PANE_FRACTION = 0.15

const clampRatio = (value) => {
  const ratio = Number(value)
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(1 - MIN_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, ratio))
}

const readSplitState = () => {
  const fallback = {
    left: DEFAULT_LEFT,
    right: DEFAULT_RIGHT,
    orientation: 'vertical',
    ratio: 0.5,
  }
  if (typeof window === 'undefined') return fallback
  try {
    const saved = JSON.parse(window.localStorage.getItem(SPLIT_STATE_KEY) || '{}')
    return {
      // A stored path outlives a rename, and an unmatched path renders an empty
      // pane that looks like a page still loading.
      left: isKnownPagePath(saved.left) ? saved.left : fallback.left,
      right: isKnownPagePath(saved.right) ? saved.right : fallback.right,
      orientation: saved.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      ratio: clampRatio(saved.ratio),
    }
  } catch {
    return fallback
  }
}

// Plotly sizes a chart to its container when the window resizes, not when a
// container resizes, so charts stay at the old pane width until something tells
// them to re-measure. The charts in this app are already `responsive: true`, so
// borrowing that listener is enough — no per-chart wiring.
const remeasureCharts = () => {
  if (typeof window === 'undefined') return
  window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
}

function PagePicker({ value, onChange, side }) {
  return (
    <select
      className="split-picker"
      value={pathnameOf(value)}
      onChange={(e) => onChange(side, e.target.value)}
      aria-label={`${side === 'left' ? 'First' : 'Second'} page`}
    >
      {PAGE_GROUPS.map(section => (
        <optgroup key={section.group} label={section.group}>
          {section.pages.map(page => (
            <option key={page.path} value={page.path}>{page.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

// Only reachable if a saved page was renamed out from under a stored pane. An
// empty pane is indistinguishable from one that is still loading, so say so.
function PaneFallback() {
  return (
    <div className="page">
      <p style={{ color: 'var(--text-dim-2)' }}>
        That page is no longer available. Pick another one above.
      </p>
    </div>
  )
}

export default function SplitScreen() {
  const [state, setState] = useState(readSplitState)
  const shellRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const vertical = state.orientation === 'vertical'

  useEffect(() => {
    try {
      window.localStorage.setItem(SPLIT_STATE_KEY, JSON.stringify(state))
    } catch {
      // Best effort: storage can be disabled by policy.
    }
  }, [state])

  const setPane = useCallback((side, path) => {
    setState(prev => (prev[side] === path ? prev : { ...prev, [side]: path }))
    remeasureCharts()
  }, [])

  const swap = useCallback(() => {
    setState(prev => ({ ...prev, left: prev.right, right: prev.left }))
    remeasureCharts()
  }, [])

  const setOrientation = useCallback((orientation) => {
    setState(prev => ({ ...prev, orientation }))
    remeasureCharts()
  }, [])

  useEffect(() => {
    if (!dragging) return undefined
    const onMove = (e) => {
      const rect = shellRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = vertical
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height
      setState(prev => ({ ...prev, ratio: clampRatio(ratio) }))
    }
    // Re-measuring charts on every mouse move would relayout a dozen Plotly
    // canvases per drag; the panes themselves resize live and the charts catch
    // up when the drag ends.
    const onUp = () => { setDragging(false); remeasureCharts() }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, vertical])

  const firstSize = `${(state.ratio * 100).toFixed(2)}%`

  return (
    <div className="split-page">
      <div className="split-toolbar">
        <h1>Split View</h1>
        <p>
          Pick a page for each side. Both panes share this window&apos;s portfolio, basis mode and
          performance date range, so changing the range on one side moves the other with it.
        </p>
        <div className="split-toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={swap} title="Swap the two pages">
            {'⇄'} Swap
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setOrientation(vertical ? 'horizontal' : 'vertical')}
            title={vertical ? 'Stack the panes top and bottom' : 'Place the panes side by side'}
          >
            {vertical ? '▤ Stack' : '▥ Side by side'}
          </button>
        </div>
      </div>

      <div
        ref={shellRef}
        className={`split-shell${vertical ? '' : ' is-horizontal'}${dragging ? ' is-dragging' : ''}`}
        style={vertical
          ? { gridTemplateColumns: `${firstSize} 8px 1fr` }
          : { gridTemplateRows: `${firstSize} 8px 1fr` }}
      >
        <section className="split-pane">
          <header className="split-pane-head">
            <PagePicker value={state.left} onChange={setPane} side="left" />
          </header>
          <div className="split-pane-body">
            {pageElement(state.left) || <PaneFallback />}
          </div>
        </section>

        <div
          className="split-divider"
          role="separator"
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          title="Drag to resize — double-click to even them out"
          onMouseDown={(e) => { e.preventDefault(); setDragging(true) }}
          onDoubleClick={() => { setState(prev => ({ ...prev, ratio: 0.5 })); remeasureCharts() }}
        />

        <section className="split-pane">
          <header className="split-pane-head">
            <PagePicker value={state.right} onChange={setPane} side="right" />
          </header>
          <div className="split-pane-body">
            {pageElement(state.right) || <PaneFallback />}
          </div>
        </section>
      </div>
    </div>
  )
}
