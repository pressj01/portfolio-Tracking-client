import test from 'node:test'
import assert from 'node:assert/strict'

import {
  actionCatalogItems,
  isPaletteToggle,
  matchQuery,
  pageCatalogItems,
  searchCatalog,
  tickerCatalogItems,
} from './commandPalette.js'

test('matchQuery requires every token and scores a prefix higher', () => {
  assert.equal(matchQuery('div cal', ['Dividend Calendar', 'Portfolio']).matched, true)
  assert.equal(matchQuery('zzz', ['Dividend Calendar']).matched, false)
  const prefix = matchQuery('growth', ['Growth'])
  const buried = matchQuery('growth', ['Portfolio Growth & Income'])
  assert.ok(prefix.score > buried.score)
})

test('page catalog marks hidden pages without dropping them', () => {
  const pages = pageCatalogItems(['dividend-compare'])
  const hidden = pages.find(page => page.id === 'page:dividend-compare')
  const visible = pages.find(page => page.id === 'page:dashboard')
  assert.equal(hidden.hidden, true)
  assert.match(hidden.hint, /Hidden/)
  assert.equal(visible.hidden, false)
  assert.ok(pages.some(page => page.id === 'page:growth'))
})

test('searchCatalog finds hidden pages and tickers', () => {
  const pages = pageCatalogItems(['dividend-compare'])
  const tickers = tickerCatalogItems([
    { ticker: 'SCHD', source: 'holding' },
    { ticker: 'schd', source: 'watchlist' },
  ])
  const actions = actionCatalogItems({})
  const hiddenHits = searchCatalog('compare hidden', { pages, actions, tickers })
  assert.ok(hiddenHits.some(item => item.id === 'page:dividend-compare'))
  const tickerHits = searchCatalog('schd', { pages, actions, tickers })
  assert.equal(tickerHits.filter(item => item.type === 'ticker').length, 1)
  assert.equal(tickerHits.find(item => item.type === 'ticker').action, 'research')
  assert.equal(tickerHits.find(item => item.type === 'ticker').ticker, 'SCHD')
})

test('empty query shows a short list of actions and home pages', () => {
  const results = searchCatalog('', {
    pages: pageCatalogItems([]),
    actions: actionCatalogItems({}),
    tickers: tickerCatalogItems([{ ticker: 'SCHD' }]),
  })
  assert.ok(results.some(item => item.type === 'action'))
  assert.ok(results.some(item => item.id === 'page:dashboard'))
  assert.equal(results.some(item => item.type === 'ticker'), false)
})

test('isPaletteToggle accepts Ctrl/Cmd+K and ignores Shift', () => {
  assert.equal(isPaletteToggle({ key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), true)
  assert.equal(isPaletteToggle({ key: 'K', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }), true)
  assert.equal(isPaletteToggle({ key: 'k', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }), false)
})
