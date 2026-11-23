import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyLineModeChoice,
  chartTableFromTraces,
  dividendEvents,
  dividendGrowthSeries,
  dividendYoYSeries,
  metricAllowsReinvest,
  normalizeChartMetric,
  returnModeForMetric,
  tableToDelimited,
  totalReturnDollarSeries,
  ttmDividendSeries,
} from './chartMetrics.js'

const history = (rows) => ({ dates: rows.map(([d]) => d), amounts: rows.map(([, a]) => a) })

test('metric menu maps onto the existing line modes', () => {
  assert.equal(returnModeForMetric('total_pct', 'both'), 'both')
  assert.equal(returnModeForMetric('growth', 'all4'), 'all4')
  assert.equal(returnModeForMetric('price_pct', 'both'), 'price')
  assert.equal(returnModeForMetric('price', 'both'), 'actual')
  assert.equal(returnModeForMetric('div_ttm', 'both'), 'total')
  assert.equal(normalizeChartMetric('nope'), 'total_pct')
})

test('choosing Price Only or Actual Price on the line bar switches the metric', () => {
  assert.deepEqual(applyLineModeChoice('price', 'growth'), { metric: 'price_pct', lineMode: null })
  assert.deepEqual(applyLineModeChoice('actual', 'total_pct'), { metric: 'price', lineMode: null })
  assert.deepEqual(applyLineModeChoice('both', 'growth'), { metric: 'growth', lineMode: 'both' })
  assert.deepEqual(applyLineModeChoice('all3', 'div_ttm'), { metric: 'total_pct', lineMode: 'all3' })
})

test('reinvest applies only where a reinvested line is drawn', () => {
  assert.equal(metricAllowsReinvest('total_pct', 'total'), true)
  assert.equal(metricAllowsReinvest('total_pct', 'pricediv'), false)
  assert.equal(metricAllowsReinvest('total_value'), true)
  assert.equal(metricAllowsReinvest('price_pct'), false)
  assert.equal(metricAllowsReinvest('div_growth'), false)
})

test('total return in dollars ends at the last close', () => {
  const series = {
    dates: ['2026-01-02', '2026-01-03', '2026-01-04'],
    traces: { total: [100, 102, 105], price: [100, 101, 103] },
    div_ratio: [0, 0, 0],
    closes: [50, 50.5, 51.5],
  }
  const values = totalReturnDollarSeries(series, 100)
  assert.equal(values.length, 3)
  assert.ok(Math.abs(values[2] - 51.5) < 1e-9)
  assert.ok(Math.abs(values[0] - 51.5 * 100 / 105) < 1e-9)
})

test('TTM dividends sum the trailing year of a quarterly payer', () => {
  const events = dividendEvents(history([
    ['2024-03-15', 0.5], ['2024-06-14', 0.5], ['2024-09-13', 0.5], ['2024-12-13', 0.5],
    ['2025-03-14', 0.6], ['2025-06-13', 0.6],
  ]))
  const ttm = ttmDividendSeries(['2024-02-01', '2024-12-31', '2025-03-20', '2025-07-01'], events)
  assert.deepEqual(ttm, [0, 2, 2.1, 2.2])
})

test('a payment that arrives a few days early does not count a fifth quarter', () => {
  const events = dividendEvents(history([
    ['2024-03-18', 0.5], ['2024-06-17', 0.5], ['2024-09-16', 0.5], ['2024-12-16', 0.5],
    ['2025-03-12', 0.5],
  ]))
  // On 2025-03-14 a naive 365-day sum still holds 2024-03-18 and adds 2025-03-12.
  assert.deepEqual(ttmDividendSeries(['2025-03-14'], events), [2])
})

test('a late payment does not dip the TTM to three quarters', () => {
  const events = dividendEvents(history([
    ['2024-03-10', 0.5], ['2024-06-10', 0.5], ['2024-09-10', 0.5], ['2024-12-10', 0.5],
    ['2025-03-16', 0.5],
  ]))
  assert.deepEqual(ttmDividendSeries(['2025-03-13'], events), [2])
})

test('a fund that stops paying decays to zero', () => {
  const events = dividendEvents(history([['2023-03-15', 1], ['2023-09-15', 1]]))
  assert.deepEqual(ttmDividendSeries(['2023-10-01', '2025-01-01'], events), [2, 0])
})

test('dividend growth starts at 0% on the first visible date', () => {
  const events = dividendEvents(history([
    ['2024-01-15', 1], ['2024-04-15', 1], ['2024-07-15', 1], ['2024-10-15', 1],
    ['2025-01-15', 1.25],
  ]))
  const growth = dividendGrowthSeries(['2024-12-01', '2025-02-01'], events, '2024-12-01')
  assert.deepEqual(growth, [0, 6.25])
})

test('YoY dividend growth waits for a full prior year', () => {
  const rows = []
  for (let year = 2022; year <= 2025; year += 1) {
    const amount = year === 2025 ? 1.1 : 1
    ;['01', '04', '07', '10'].forEach(month => rows.push([`${year}-${month}-15`, amount]))
  }
  const events = dividendEvents(history(rows))
  const yoy = dividendYoYSeries(['2022-11-01', '2025-11-01'], events)
  assert.equal(yoy[0], null)
  assert.equal(yoy[1], 10)
})

test('YoY does not spike when a payment lands a few days before last year\'s date', () => {
  const events = dividendEvents(history([
    ['2023-03-20', 1], ['2023-06-20', 1], ['2023-09-20', 1], ['2023-12-20', 1],
    ['2024-03-20', 1], ['2024-06-20', 1], ['2024-09-20', 1], ['2024-12-20', 1],
    ['2025-03-17', 1.1],
  ]))
  // 2025-03-18 is 363 days after 2024-03-20: a calendar-date comparison would
  // set this year's new TTM against a prior TTM that has not rolled yet.
  const yoy = dividendYoYSeries(['2025-03-01', '2025-03-18', '2025-03-25'], events)
  assert.deepEqual(yoy, [0, 2.5, 2.5])
})

test('fallback events come from the window when the history has not loaded', () => {
  const events = dividendEvents(null, {
    dates: ['2026-01-02', '2026-01-05'],
    div_ratio: [0, 0.01],
    closes: [20, 20],
  })
  assert.deepEqual(events.map(e => e.amount), [0.2])
})

test('export keeps chart gaps as empty cells instead of zeros', () => {
  const table = chartTableFromTraces([
    { name: 'SCHD', x: ['2026-01-02', '2026-01-05', '2026-01-06'], y: [null, undefined, 2.5] },
  ])
  assert.deepEqual(table.rows, [['2026-01-02', null], ['2026-01-05', null], ['2026-01-06', 2.5]])
  assert.equal(tableToDelimited(table), 'Date,SCHD\r\n2026-01-02,\r\n2026-01-05,\r\n2026-01-06,2.5')
})

test('export table merges lines by date and honors the window', () => {
  const table = chartTableFromTraces([
    { name: 'SPY', x: ['2026-01-02', '2026-01-05', '2026-01-06'], y: [0, 1.234567, 2] },
    { name: 'QQQ', x: ['2026-01-05', '2026-01-06'], y: [5, 6], exportY: [0.5, 0.6] },
    { name: 'Baseline', x: ['2026-01-02', '2026-01-06'], y: [0, 0], hoverinfo: 'skip' },
  ], { start: '2026-01-03', unit: '%' })
  assert.deepEqual(table.columns, ['Date', 'SPY (%)', 'QQQ (%)'])
  assert.deepEqual(table.rows, [['2026-01-05', 1.2346, 0.5], ['2026-01-06', 2, 0.6]])
  assert.equal(tableToDelimited(table), 'Date,SPY (%),QQQ (%)\r\n2026-01-05,1.2346,0.5\r\n2026-01-06,2,0.6')
  assert.equal(tableToDelimited({ columns: ['A, B'], rows: [['x"y']] }), '"A, B"\r\n"x""y"')
})
