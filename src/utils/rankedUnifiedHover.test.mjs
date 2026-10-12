import assert from 'node:assert/strict'
import test from 'node:test'
import { rankHoverRows, rankUnifiedHoverBox } from './rankedUnifiedHover.js'

// Plotly stacks rows from the top of the box, each translated to the centre of
// its slot. Lay the given rows out the same way, in trace order.
function plotlyLayout(specs, top = 21.6) {
  let cursor = top
  return specs.map(({ value, height = 49.8 }) => {
    const center = cursor + height / 2
    cursor += height
    return { center, height, value }
  })
}

// A stand-in for the SVG legend Plotly draws the box as.
function fakeBox(specs, { groups = 1 } = {}) {
  let writes = 0
  const rows = plotlyLayout(specs).map((row, index) => {
    const spec = specs[index]
    let transform = `translate(1,${row.center})`
    return {
      symbol: spec.symbol,
      classList: { contains: name => name === 'traces' },
      __data__: 'datum' in spec
        ? spec.datum
        : [{ height: row.height, eventData: [{ curveNumber: index, y: spec.value }] }],
      getAttribute: name => (name === 'transform' ? transform : null),
      setAttribute(name, value) {
        if (name !== 'transform') return
        transform = value
        writes += 1
      },
      redraw() { transform = `translate(1,${row.center})` },
      get center() { return Number(/,([-\d.]+)\)/.exec(transform)[1]) },
    }
  })
  const group = { children: rows }
  return {
    rows,
    get writes() { return writes },
    // Top-to-bottom reading order, which is what the user actually sees.
    read: () => [...rows].sort((a, b) => a.center - b.center).map(row => row.symbol),
    layer: { querySelectorAll: () => Array.from({ length: groups }, () => group) },
  }
}

const crossed = [
  { symbol: 'SPY', value: 10.77 },
  { symbol: 'QQQ', value: 15.65 },
  { symbol: 'SCHD', value: 8.98 },
  { symbol: 'TLT', value: -1.53 },
  { symbol: 'XLE', value: 0.85 },
]

test('stacks rows from the highest value to the lowest', () => {
  const rows = plotlyLayout(crossed)
  const centers = rankHoverRows(rows)
  const order = crossed
    .map((spec, index) => ({ symbol: spec.symbol, center: centers[index] }))
    .sort((a, b) => a.center - b.center)
    .map(row => row.symbol)
  assert.deepEqual(order, ['QQQ', 'SPY', 'SCHD', 'XLE', 'TLT'])
  // Same slots, just reassigned: the box neither grows nor shifts.
  assert.deepEqual(
    [...centers].sort((a, b) => a - b).map(c => c.toFixed(2)),
    rows.map(row => row.center.toFixed(2)),
  )
})

test('keeps the trace order for equal values', () => {
  const centers = rankHoverRows(plotlyLayout([{ value: 1.13 }, { value: 3.87 }, { value: 1.13 }]))
  assert.ok(centers[1] < centers[0])
  assert.ok(centers[0] < centers[2])
})

test('rows of different heights are re-stacked without overlapping', () => {
  const rows = plotlyLayout([
    { value: 1, height: 20 },
    { value: 3, height: 50 },
    { value: 2, height: 30 },
  ], 10)
  const centers = rankHoverRows(rows)
  // value 3 (50 tall) on top: 10..60, then value 2 (30): 60..90, then value 1 (20): 90..110
  assert.deepEqual(centers, [100, 35, 75])
})

test('leaves the box alone when a row cannot be ranked', () => {
  assert.equal(rankHoverRows([]), null)
  assert.equal(rankHoverRows(plotlyLayout([{ value: 5 }])), null)
  assert.equal(rankHoverRows(plotlyLayout([{ value: 5 }, { value: Number.NaN }])), null)
  assert.equal(rankHoverRows([{ center: 10, height: 0, value: 1 }, { center: 30, height: 20, value: 2 }]), null)
})

test('ranks the rows Plotly drew in trace order', () => {
  const box = fakeBox(crossed)
  assert.deepEqual(box.read(), ['SPY', 'QQQ', 'SCHD', 'TLT', 'XLE'])
  rankUnifiedHoverBox(box.layer)
  assert.deepEqual(box.read(), ['QQQ', 'SPY', 'SCHD', 'XLE', 'TLT'])
})

test('re-ranks after Plotly repaints the box on the same date', () => {
  const box = fakeBox(crossed)
  rankUnifiedHoverBox(box.layer)
  // A mouse move over the same date: Plotly rewrites every row back into trace
  // order and fires no plotly_hover event.
  box.rows.forEach(row => row.redraw())
  assert.deepEqual(box.read(), ['SPY', 'QQQ', 'SCHD', 'TLT', 'XLE'])
  rankUnifiedHoverBox(box.layer)
  assert.deepEqual(box.read(), ['QQQ', 'SPY', 'SCHD', 'XLE', 'TLT'])
})

test('a second pass over a ranked box writes nothing', () => {
  const box = fakeBox(crossed)
  rankUnifiedHoverBox(box.layer)
  const afterFirst = box.writes
  assert.ok(afterFirst > 0)
  rankUnifiedHoverBox(box.layer)
  assert.equal(box.writes, afterFirst)
  assert.deepEqual(box.read(), ['QQQ', 'SPY', 'SCHD', 'XLE', 'TLT'])
})

test('does nothing when Plotly markup is not what it expects', () => {
  const noDatum = fakeBox([{ symbol: 'A', value: 1, datum: undefined }, { symbol: 'B', value: 2 }])
  rankUnifiedHoverBox(noDatum.layer)
  assert.equal(noDatum.writes, 0)

  const grouped = fakeBox(crossed, { groups: 2 })
  rankUnifiedHoverBox(grouped.layer)
  assert.equal(grouped.writes, 0)

  const nullValue = fakeBox([{ symbol: 'A', value: null }, { symbol: 'B', value: 2 }])
  rankUnifiedHoverBox(nullValue.layer)
  assert.equal(nullValue.writes, 0)

  assert.doesNotThrow(() => rankUnifiedHoverBox(null))
  assert.doesNotThrow(() => rankUnifiedHoverBox({}))
})
