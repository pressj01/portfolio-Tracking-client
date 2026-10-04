import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { axisTicks, niceCeiling, yearTickStep } from '../utils/dividendGoal'

// Projection line that glides toward a target as its inputs change.
//
// Plotly redraws from scratch on every update, so a changed input would just
// snap to its new shape. Here the series, the target and both axis scales are
// tweened together, which is what lets you watch the line close in on (or pull
// away from) the goal while you type.

const MARGIN = { top: 12, right: 58, bottom: 28, left: 60 }
const MORPH_MS = 650
const REVEAL_MS = 1000
const YEAR_LABEL_WIDTH = 62

const lerp = (a, b, t) => a + (b - a) * t
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function skipMotion() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true
  // A hidden window never gets animation frames, so a tween would stall on its
  // first frame. Land on the result instead.
  if (document.hidden) return true
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

function runTween(duration, onFrame) {
  if (skipMotion()) {
    onFrame(1)
    return () => {}
  }
  let raf = 0
  let startedAt = null
  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    onFrame(1)
  }
  const tick = (now) => {
    if (settled) return
    if (startedAt == null) startedAt = now
    const t = (now - startedAt) / duration
    if (t >= 1) {
      settle()
      return
    }
    onFrame(t)
    raf = requestAnimationFrame(tick)
  }
  onFrame(0)
  raf = requestAnimationFrame(tick)
  // Frames stop if the window is hidden part-way through; finish regardless.
  const guard = setTimeout(settle, duration + 400)
  return () => {
    settled = true
    cancelAnimationFrame(raf)
    clearTimeout(guard)
  }
}

function buildFrame(nominal, real, target) {
  const points = (nominal || []).map(v => Number(v) || 0)
  const realPoints = Array.isArray(real) && real.length ? real.map(v => Number(v) || 0) : null
  const goal = Number(target) > 0 ? Number(target) : null
  const peak = Math.max(0, ...points, ...(realPoints || []), goal || 0)
  return {
    nominal: points,
    real: realPoints,
    target: goal,
    yMax: niceCeiling(peak * 1.04),
    xMax: Math.max(1, points.length - 1),
  }
}

function blendSeries(from, to, t) {
  const size = Math.max(from.length, to.length)
  const out = new Array(size)
  for (let i = 0; i < size; i++) {
    // A year being added grows out of the old end point; a year being dropped
    // holds still while the shrinking axis carries it off the right edge.
    const a = i < from.length ? from[i] : (from[from.length - 1] ?? 0)
    const b = i < to.length ? to[i] : a
    out[i] = lerp(a, b, t)
  }
  return out
}

function blendFrame(from, to, t) {
  let real = null
  if (to.real) real = blendSeries(from.real || from.nominal, to.real, t)
  else if (from.real) real = blendSeries(from.real, to.nominal, t)
  return {
    nominal: blendSeries(from.nominal, to.nominal, t),
    real,
    target: to.target == null ? null : (from.target == null ? to.target : lerp(from.target, to.target, t)),
    yMax: lerp(from.yMax, to.yMax, t),
    xMax: lerp(from.xMax, to.xMax, t),
  }
}

const frameSignature = (frame) => [
  frame.xMax,
  frame.yMax,
  frame.target == null ? '' : frame.target.toFixed(2),
  frame.nominal.map(v => v.toFixed(2)).join(','),
  frame.real ? frame.real.map(v => v.toFixed(2)).join(',') : '',
].join('|')

function valueAt(values, position) {
  if (!values.length) return 0
  const i = clamp(Math.floor(position), 0, values.length - 1)
  const next = Math.min(values.length - 1, i + 1)
  return lerp(values[i], values[next], clamp(position - i, 0, 1))
}

export default function GoalProjectionChart({
  nominal,
  real = null,
  target = null,
  markerYear = null,
  nominalLabel = 'Nominal value',
  realLabel = 'Today’s dollars',
  targetLabel = 'Target',
  formatTick = (value) => String(Math.round(value)),
  formatValue = (value) => String(Math.round(value)),
  replayKey = 0,
  ariaLabel = 'Projection chart',
}) {
  const plotRef = useRef(null)
  const clipId = `dc-goal-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const fillId = `${clipId}-fill`
  const [size, setSize] = useState({ width: 720, height: 340 })
  const goal = buildFrame(nominal, real, target)
  const signature = frameSignature(goal)
  const [frame, setFrame] = useState(goal)
  const frameRef = useRef(frame)
  const [reveal, setReveal] = useState(() => (skipMotion() ? 1 : 0))
  const [hoverYear, setHoverYear] = useState(null)

  useLayoutEffect(() => {
    const el = plotRef.current
    if (!el) return undefined
    const measure = () => {
      // Use layout dimensions instead of getBoundingClientRect(). The latter
      // includes ancestor transforms/display scaling and can report a much
      // shorter box than the CSS layout actually reserves, leaving the SVG
      // compressed at the top of a tall chart container.
      const nextWidth = el.clientWidth
      const nextHeight = el.clientHeight
      if (!(nextWidth > 0 && nextHeight > 0)) return
      setSize(prev => (
        Math.abs(prev.width - nextWidth) < 0.5 && Math.abs(prev.height - nextHeight) < 0.5
          ? prev
          : { width: nextWidth, height: nextHeight }
      ))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (observer) observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Morph from whatever is on screen right now, so an edit made mid-animation
  // continues from the line's current position instead of jumping back.
  useEffect(() => {
    const from = frameRef.current
    const to = goal
    if (from === to) return undefined
    return runTween(MORPH_MS, (t) => {
      const next = t >= 1 ? to : blendFrame(from, to, easeOutCubic(t))
      frameRef.current = next
      setFrame(next)
    })
    // `goal` is rebuilt every render; its signature is what actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Draw the line in from the left on first show and on every replay.
  useEffect(() => runTween(REVEAL_MS, (t) => setReveal(easeInOutCubic(t))), [replayKey])

  const { width, height } = size
  const plotW = Math.max(40, width - MARGIN.left - MARGIN.right)
  const plotH = Math.max(40, height - MARGIN.top - MARGIN.bottom)
  const right = MARGIN.left + plotW
  const baseY = MARGIN.top + plotH
  const xOf = (year) => MARGIN.left + (year / frame.xMax) * plotW
  const yOf = (value) => baseY - (Math.max(0, value) / frame.yMax) * plotH
  const linePath = (values) => values
    .map((v, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join('')

  const { step: yStep, ticks: yTicks } = axisTicks(frame.yMax)
  const yearSpan = Math.ceil(frame.xMax - 1e-6)
  const xStep = yearTickStep(yearSpan, Math.floor(plotW / YEAR_LABEL_WIDTH))
  const xTicks = []
  for (let year = 0; year <= yearSpan; year += xStep) {
    if (xOf(year) <= right + 0.5) xTicks.push(year)
  }

  const nominalPath = linePath(frame.nominal)
  const lastIndex = frame.nominal.length - 1
  const areaPath = lastIndex >= 0
    ? `${nominalPath}L${xOf(lastIndex).toFixed(1)},${baseY}L${xOf(0).toFixed(1)},${baseY}Z`
    : ''

  // The end dot rides the tip of the line while it draws in.
  const tipYear = Math.min(reveal * frame.xMax, goal.nominal.length - 1)
  const judged = frame.real || frame.nominal
  const showMarker = markerYear != null
    && markerYear > 0
    && markerYear < judged.length
    && markerYear <= tipYear + 1e-6
    && xOf(markerYear) <= right + 0.5

  const lastYear = goal.nominal.length - 1
  const hovered = hoverYear == null ? null : clamp(hoverYear, 0, lastYear)
  const hoverJudged = hovered == null ? null : (goal.real || goal.nominal)[hovered]
  const endpointNominal = valueAt(frame.nominal, frame.xMax)
  const endpointReal = frame.real ? valueAt(frame.real, frame.xMax) : null
  const endpointSummaryOpacity = clamp((reveal - 0.72) / 0.28, 0, 1)

  const moveTo = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!(bounds.width > 0)) return
    const ratio = (event.clientX - bounds.left) / bounds.width
    setHoverYear(clamp(Math.round(ratio * lastYear), 0, lastYear))
  }

  const onKeyDown = (event) => {
    const current = hovered == null ? lastYear : hovered
    const moves = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: lastYear }
    if (!(event.key in moves)) return
    event.preventDefault()
    setHoverYear(clamp(moves[event.key], 0, lastYear))
  }

  const tooltipOnLeft = hovered != null && xOf(hovered) > MARGIN.left + plotW * 0.6

  return (
    <div className="dc-goal-chart">
      <div
        className="dc-goal-end-summary"
        style={{ opacity: endpointSummaryOpacity }}
        aria-label={`Ending projected values at Year ${lastYear}`}
      >
        <span className="dc-goal-end-summary-title">Year {lastYear} ending</span>
        <span className="dc-goal-end-summary-item">
          <i className="dc-goal-key nominal" aria-hidden="true" />
          <span>{nominalLabel}</span>
          <strong>{formatValue(endpointNominal)}</strong>
        </span>
        {endpointReal != null && (
          <span className="dc-goal-end-summary-item">
            <i className="dc-goal-key real" aria-hidden="true" />
            <span>{realLabel}</span>
            <strong>{formatValue(endpointReal)}</strong>
          </span>
        )}
      </div>
      <div
        className="dc-goal-plot"
        ref={plotRef}
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use the left and right arrow keys to read each year.`}
        onKeyDown={onKeyDown}
        onFocus={() => setHoverYear(prev => (prev == null ? lastYear : prev))}
        onBlur={() => setHoverYear(null)}
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
          <defs>
            <clipPath id={clipId}>
              <rect x={MARGIN.left} y={0} width={Math.max(0, plotW * reveal)} height={height} />
            </clipPath>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="dc-goal-fill-top" />
              <stop offset="100%" className="dc-goal-fill-bottom" />
            </linearGradient>
          </defs>

          {yTicks.map(tick => (
            <g key={tick}>
              <line className="dc-goal-grid" x1={MARGIN.left} x2={right} y1={yOf(tick)} y2={yOf(tick)} />
              <text className="dc-goal-tick" x={MARGIN.left - 8} y={yOf(tick)} textAnchor="end" dominantBaseline="middle">
                {formatTick(tick, yStep, yTicks[yTicks.length - 1])}
              </text>
            </g>
          ))}
          {xTicks.map(year => (
            <text key={year} className="dc-goal-tick" x={xOf(year)} y={baseY + 18} textAnchor="middle">
              Year {year}
            </text>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {areaPath && <path d={areaPath} fill={`url(#${fillId})`} />}
            {frame.real && <path className="dc-goal-line dc-goal-line-real" d={linePath(frame.real)} />}
            {nominalPath && <path className="dc-goal-line dc-goal-line-nominal" d={nominalPath} />}
          </g>

          {frame.target != null && (
            <g>
              <line className="dc-goal-line dc-goal-line-target" x1={MARGIN.left} x2={right} y1={yOf(frame.target)} y2={yOf(frame.target)} />
              <text className="dc-goal-target-label" x={right + 7} y={yOf(frame.target)} dominantBaseline="middle">
                {targetLabel}
              </text>
            </g>
          )}

          {showMarker && (
            <circle className="dc-goal-marker" cx={xOf(markerYear)} cy={yOf(judged[markerYear])} r={5.5} />
          )}
          {lastIndex >= 0 && reveal > 0 && (
            <circle
              className="dc-goal-tip"
              cx={Math.min(right, xOf(tipYear))}
              cy={yOf(valueAt(frame.nominal, tipYear))}
              r={4.5}
            />
          )}
          {hovered != null && (
            <g>
              <line className="dc-goal-crosshair" x1={xOf(hovered)} x2={xOf(hovered)} y1={MARGIN.top} y2={baseY} />
              {goal.real && <circle className="dc-goal-hover-dot real" cx={xOf(hovered)} cy={yOf(goal.real[hovered])} r={4} />}
              <circle className="dc-goal-hover-dot nominal" cx={xOf(hovered)} cy={yOf(goal.nominal[hovered])} r={4} />
            </g>
          )}

          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={moveTo}
            onPointerDown={moveTo}
            onPointerLeave={() => setHoverYear(null)}
          />
        </svg>

        {hovered != null && (
          <div
            className={`dc-goal-tooltip${tooltipOnLeft ? ' on-left' : ''}`}
            style={{ left: xOf(hovered), top: MARGIN.top + 6 }}
            role="status"
          >
            <div className="dc-goal-tooltip-title">Year {hovered}</div>
            <div className="dc-goal-tooltip-row">
              <i className="dc-goal-key nominal" aria-hidden="true" />
              <strong>{formatValue(goal.nominal[hovered])}</strong>
              <span>{nominalLabel}</span>
            </div>
            {goal.real && (
              <div className="dc-goal-tooltip-row">
                <i className="dc-goal-key real" aria-hidden="true" />
                <strong>{formatValue(goal.real[hovered])}</strong>
                <span>{realLabel}</span>
              </div>
            )}
            {goal.target != null && (
              <div className="dc-goal-tooltip-row">
                <i className="dc-goal-key target" aria-hidden="true" />
                <strong>{formatValue(goal.target)}</strong>
                <span>{targetLabel} · {Math.round((hoverJudged / goal.target) * 100)}% there</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="dc-goal-legend">
        <span><i className="dc-goal-key nominal" aria-hidden="true" />{nominalLabel}</span>
        {goal.real && <span><i className="dc-goal-key real" aria-hidden="true" />{realLabel}</span>}
        {goal.target != null && <span><i className="dc-goal-key target" aria-hidden="true" />{targetLabel}</span>}
      </div>
    </div>
  )
}
