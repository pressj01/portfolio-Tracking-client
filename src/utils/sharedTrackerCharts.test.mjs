import assert from 'node:assert/strict'
import test from 'node:test'
import {
  invalidateSharedTrackerCharts,
  loadTrackerCharts,
  peekTrackerCharts,
  trackerChartsCacheKey,
  trackerChartsSearchParams,
} from './sharedTrackerCharts.js'

function fakePf(payload, { calls } = { calls: { n: 0 } }) {
  return async () => {
    calls.n += 1
    await Promise.resolve()
    return {
      ok: true,
      json: async () => payload,
    }
  }
}

test('the same profile and period share one in-flight charts request', async () => {
  invalidateSharedTrackerCharts()
  const calls = { n: 0 }
  const params = trackerChartsSearchParams({ period: 'ytd' })
  const key = trackerChartsCacheKey('profile_id=1&basis_mode=original', params)
  const pf = fakePf({ portfolio_metrics: { price_return_pct: -4.15 } }, { calls })
  const first = loadTrackerCharts(pf, 'profile_id=1&basis_mode=original', params)
  const second = loadTrackerCharts(pf, 'profile_id=1&basis_mode=original', params)
  const [a, b] = await Promise.all([first, second])
  assert.equal(calls.n, 1)
  assert.equal(a, b)
  assert.equal(a.portfolio_metrics.price_return_pct, -4.15)
  assert.equal(peekTrackerCharts(key).portfolio_metrics.price_return_pct, -4.15)
})

test('a later caller reuses the cached payload without another request', async () => {
  invalidateSharedTrackerCharts()
  const calls = { n: 0 }
  const params = trackerChartsSearchParams({ period: 'ytd' })
  const pf = fakePf({ portfolio_metrics: { price_return_pct: -4.15 } }, { calls })
  await loadTrackerCharts(pf, 'profile_id=1&basis_mode=original', params)
  const again = await loadTrackerCharts(pf, 'profile_id=1&basis_mode=original', params)
  assert.equal(calls.n, 1)
  assert.equal(again.portfolio_metrics.price_return_pct, -4.15)
})

test('a different period does not reuse the YTD payload', async () => {
  invalidateSharedTrackerCharts()
  const calls = { n: 0 }
  const pf = fakePf({ portfolio_metrics: { price_return_pct: 1 } }, { calls })
  await loadTrackerCharts(pf, 'profile_id=1&basis_mode=original', trackerChartsSearchParams({ period: 'ytd' }))
  await loadTrackerCharts(pf, 'profile_id=1&basis_mode=original', trackerChartsSearchParams({ period: '1y' }))
  assert.equal(calls.n, 2)
})
