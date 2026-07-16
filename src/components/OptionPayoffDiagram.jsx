import React from 'react'

const YMIN = -2.5
const YMAX = 2.5
const WIDTH = 320
const HEIGHT = 176
const PADX = 26
const PADY_TOP = 22
const PADY_BOTTOM = 34
const PLOT_W = WIDTH - PADX * 2
const PLOT_H = HEIGHT - PADY_TOP - PADY_BOTTOM

const toPx = (x, y) => ({
  px: PADX + (x / 10) * PLOT_W,
  py: PADY_TOP + (1 - (y - YMIN) / (YMAX - YMIN)) * PLOT_H,
})

function zeroCrossings(points) {
  const crossings = []
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[i + 1]
    if (y1 === 0) crossings.push(x1)
    else if ((y1 < 0 && y2 > 0) || (y1 > 0 && y2 < 0)) {
      crossings.push(x1 + (0 - y1) * (x2 - x1) / (y2 - y1))
    }
  }
  const last = points[points.length - 1]
  if (last[1] === 0) crossings.push(last[0])
  return [...new Set(crossings.map(v => Math.round(v * 100) / 100))]
}

function zonePolygons(points) {
  const zones = []
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[i + 1]
    if ((y1 >= 0 && y2 >= 0) || (y1 <= 0 && y2 <= 0)) {
      zones.push({ color: y1 + y2 >= 0 ? 'pos' : 'neg', poly: [[x1, y1], [x2, y2], [x2, 0], [x1, 0]] })
    } else {
      const xc = x1 + (0 - y1) * (x2 - x1) / (y2 - y1)
      zones.push({ color: y1 > 0 ? 'pos' : 'neg', poly: [[x1, y1], [xc, 0], [x1, 0]] })
      zones.push({ color: y2 > 0 ? 'pos' : 'neg', poly: [[xc, 0], [x2, y2], [x2, 0]] })
    }
  }
  return zones
}

const pointsAttr = poly => poly.map(([x, y]) => {
  const { px, py } = toPx(x, y)
  return `${px.toFixed(1)},${py.toFixed(1)}`
}).join(' ')

/**
 * Illustrative, qualitative 2D line diagram on a 0–10 (x) by roughly -2.5..2.5 (y) grid;
 * x=5 always represents the current underlying price / at-the-money point. Used both for
 * option-strategy P&L-at-expiration shapes and for Greek-value-vs-price curves.
 */
export default function OptionPayoffDiagram({
  points, continuesLeft, continuesRight, strikeMarkers = [], title,
  centerLabel = 'Current price', zeroCrossLabel = 'BE',
  positiveLabel = 'Profit', negativeLabel = 'Loss', showZeroCrossings = true,
}) {
  const zones = zonePolygons(points)
  const breakevens = showZeroCrossings ? zeroCrossings(points).filter(x => x > 0.15 && x < 9.85) : []
  const linePath = points.map((p, i) => {
    const { px, py } = toPx(p[0], p[1])
    return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`
  }).join(' ')
  const zeroY = toPx(0, 0).py
  const nowX = toPx(5, 0).px
  const first = points[0]
  const lastPoint = points[points.length - 1]

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="opt-edu-payoff" role="img" aria-label={title || 'Option strategy payoff diagram'}>
      {zones.map((zone, i) => (
        <polygon key={i} points={pointsAttr(zone.poly)} className={`opt-edu-payoff-zone opt-edu-payoff-zone--${zone.color}`} />
      ))}
      <line x1={PADX} y1={zeroY} x2={WIDTH - PADX} y2={zeroY} className="opt-edu-payoff-axis" />
      <line x1={nowX} y1={PADY_TOP - 6} x2={nowX} y2={HEIGHT - PADY_BOTTOM + 6} className="opt-edu-payoff-now" />
      <text x={nowX} y={PADY_TOP - 10} className="opt-edu-payoff-nowlabel" textAnchor="middle">{centerLabel}</text>
      {breakevens.map((x, i) => {
        const { px } = toPx(x, 0)
        return (
          <g key={`be-${i}`}>
            <line x1={px} y1={zeroY - 6} x2={px} y2={zeroY + 6} className="opt-edu-payoff-be-tick" />
            <text x={px} y={zeroY + 20} className="opt-edu-payoff-belabel" textAnchor="middle">{zeroCrossLabel}</text>
          </g>
        )
      })}
      {strikeMarkers.map((marker, i) => {
        const { px } = toPx(marker.x, YMIN)
        return <text key={`strike-${i}`} x={px} y={HEIGHT - 6} className="opt-edu-payoff-strikelabel" textAnchor="middle">{marker.label}</text>
      })}
      <path d={linePath} className="opt-edu-payoff-line" fill="none" />
      {continuesLeft && (
        <text x={PADX + 4} y={toPx(first[0], first[1]).py + (first[1] >= 0 ? -8 : 16)} className="opt-edu-payoff-continues" textAnchor="start">
          {first[1] >= 0 ? '↑ unlimited' : '↓ unlimited'}
        </text>
      )}
      {continuesRight && (
        <text x={WIDTH - PADX - 4} y={toPx(lastPoint[0], lastPoint[1]).py + (lastPoint[1] >= 0 ? -8 : 16)} className="opt-edu-payoff-continues" textAnchor="end">
          {lastPoint[1] >= 0 ? '↑ unlimited' : '↓ unlimited'}
        </text>
      )}
      <text x={PADX} y={13} className="opt-edu-payoff-axislabel">{positiveLabel}</text>
      <text x={PADX} y={HEIGHT - PADY_BOTTOM + 30} className="opt-edu-payoff-axislabel opt-edu-payoff-axislabel--loss">{negativeLabel}</text>
    </svg>
  )
}
