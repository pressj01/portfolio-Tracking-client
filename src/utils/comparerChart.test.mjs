import assert from 'node:assert/strict'
import test from 'node:test'
import { buildComparerChart } from './comparerChart.js'
import { chartMetricInfo } from './chartMetrics.js'

const symbols = ['TDAQ', 'QQQI', 'QQQ', 'GPIQ', 'OVL']
const series = Object.fromEntries(symbols.map(symbol => [symbol, {
  dates: ['2025-09-04', '2026-11-25'],
  closes: [50, 52.5],
  traces: { price: [100, 105], pricediv: [100, 108], blend: [100, 109], drip: [100, 110] },
}]))

test('comparer legends start below the title at normal and fullscreen heights', () => {
  for (const variant of ['etf', 'stock']) {
    for (const height of [560, 900]) {
      const { layout } = buildComparerChart({ data: { series }, symbols, variant, height })
      assert.equal(layout.title.yref, 'container')
      assert.equal(layout.title.yanchor, 'top')
      assert.equal(layout.title.y, 1)
      assert.equal(layout.legend.yref, 'container')
      assert.equal(layout.legend.yanchor, 'top')
      const legendTop = (1 - layout.legend.y) * height
      assert.ok(legendTop >= layout.title.pad.t + layout.title.font.size + 12)
      assert.ok(layout.margin.t >= legendTop + 24)
      assert.notEqual(layout.margin.autoexpand, false)
    }
  }
})

test('adjusted price is labeled consistently and retains the actual ending price', () => {
  assert.equal(chartMetricInfo('total_value').label, 'Dividend-Adjusted Price ($)')
  for (const variant of ['etf', 'stock']) {
    const chart = buildComparerChart({ data: { series }, symbols, metric: 'total_value', variant, scaleRight: false })
    assert.equal(chart.layout.title.text, 'Dividend-Adjusted Price ($)')
    assert.equal(chart.layout.yaxis.title.text, 'Dividend-Adjusted Price ($)')
    assert.match(chart.data[0].hovertemplate, /Dividend-Adjusted Price:/)
    assert.ok(Math.abs(chart.data[0].y.at(-1) - 52.5) < 1e-9)
  }
})

test('right-axis ticks have their own column only when endpoint badges are shown', () => {
  for (const metric of ['price', 'total_value', 'total_pct']) {
    const options = { data: { series }, symbols, metric }
    const { layout } = buildComparerChart(options)
    assert.ok(layout.annotations.length > 0)
    const expectedBadgeWidth = Math.max(...layout.annotations.map(a => a.text.length * 7 + 14 + a.xshift))
    assert.ok(layout.yaxis.ticklabelstandoff > expectedBadgeWidth * 1.6)
    assert.ok(layout.margin.r >= layout.yaxis.ticklabelstandoff + 64)

    const hidden = buildComparerChart({ ...options, showReturnLabels: false }).layout
    assert.equal(hidden.yaxis.ticklabelstandoff, 0)
    assert.equal(hidden.margin.r, 64)
    assert.equal(hidden.annotations.length, 0)

    const left = buildComparerChart({ ...options, scaleRight: false }).layout
    assert.equal(left.yaxis.ticklabelstandoff, 0)
    assert.ok(left.annotations.length > 0)
  }
})
