import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeTickerLists,
  normalizePortfolioHoldings,
  readSavedTickers,
  uniqueTickers,
} from './comparerTickerLibrary.js'

test('normalizes and de-duplicates comparer tickers in their original order', () => {
  assert.deepEqual(uniqueTickers([' spy ', 'QQQ', 'spy', '', null]), ['SPY', 'QQQ'])
  assert.deepEqual(mergeTickerLists(['SPY'], ['qqq', 'SPY'], ['DIA']), ['SPY', 'QQQ', 'DIA'])
})

test('normalizes portfolio rows and merges duplicate aggregate holdings', () => {
  assert.deepEqual(normalizePortfolioHoldings([
    { ticker: ' spy ', current_value: 100, categories: ['Core'] },
    { ticker: 'SPY', current_value: 50, categories: ['Index', 'Core'], description: 'S&P 500 ETF' },
    { ticker: 'qqq', current_value: '75', categories: [] },
    { ticker: '', current_value: 20 },
  ]), [
    { ticker: 'SPY', current_value: 150, categories: ['Core', 'Index'], description: 'S&P 500 ETF' },
    { ticker: 'QQQ', current_value: 75, categories: [], description: '' },
  ])
})

test('reads saved tickers defensively from storage', () => {
  const storage = { getItem: () => '[" spy ","QQQ","SPY"]' }
  assert.deepEqual(readSavedTickers('saved', storage), ['SPY', 'QQQ'])
  assert.deepEqual(readSavedTickers('saved', { getItem: () => '{broken' }), [])
})
