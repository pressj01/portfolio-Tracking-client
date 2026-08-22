import { MENU_LINKS } from '../navigation/menuConfig.js'

export const PALETTE_EVENT = 'open-command-palette'

export function openCommandPalette() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PALETTE_EVENT))
}

export function paletteShortcutLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl+K'
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'
}

export function isPaletteToggle(event) {
  if (!event || event.altKey || event.shiftKey) return false
  const key = String(event.key || '').toLowerCase()
  return key === 'k' && (event.ctrlKey || event.metaKey)
}

const PAGE_KEYWORDS = {
  dashboard: ['home', 'overview'],
  'action-center': ['inbox', 'todo', 'tasks'],
  growth: ['growth 2', 'portfolio growth 2', 'performance', 'vs market', 'dollars'],
  'gains-losses': ['lots', 'g&l', 'gains'],
  'total-return': ['return', 'performance'],
  'dividend-ledger': ['payments', 'paid', 'daily', 'weekly', 'monthly'],
  'dividend-calendar': ['div calendar', 'pay date'],
  dividends: ['yield', 'safety', 'payout'],
  'dividend-history': ['history', 'paid'],
  'dividend-compare': ['compare dividends'],
  'retirement-readiness': ['cover my life', 'retirement'],
  'cash-flow': ['expenses', 'sustainability', 'budget'],
  'safe-withdrawal': ['swr', 'withdrawal'],
  'income-simulator': ['income sim'],
  'income-growth': ['income growth'],
  'growth-income-freedom': ['freedom', 'retirement'],
  'menu-control': ['nav', 'menu', 'hide', 'preset'],
  holdings: ['positions', 'lots'],
  'security-research': ['research', 'lookup', 'ticker'],
  'closed-cef-information': ['cef', 'discount', 'nav'],
  'general-option-scanner': ['gos', 'scanner'],
  import: ['schwab', 'upload'],
}

export function matchQuery(query, texts) {
  const tokens = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return { matched: true, score: 0 }
  const hay = texts.filter(Boolean).join(' \n ').toLowerCase()
  let score = 0
  for (const token of tokens) {
    const idx = hay.indexOf(token)
    if (idx < 0) return { matched: false, score: 0 }
    score += Math.min(token.length, 12) * 4
    if (idx === 0 || hay[idx - 1] === '\n') score += 10
  }
  return { matched: true, score }
}

export function pageCatalogItems(hiddenIds = []) {
  const hidden = new Set(hiddenIds)
  return MENU_LINKS.map(link => ({
    id: `page:${link.id}`,
    type: 'page',
    label: link.label,
    hint: hidden.has(link.id) ? `${link.menuLabel} · Hidden` : link.menuLabel,
    path: link.path,
    hidden: hidden.has(link.id),
    keywords: PAGE_KEYWORDS[link.id] || [],
  }))
}

export function actionCatalogItems({ isRefreshing = false, basisMode = 'original', profiles = [], aggregates = [] } = {}) {
  const actions = [
    {
      id: 'action:refresh',
      type: 'action',
      label: isRefreshing ? 'Refresh prices (running…)' : 'Refresh prices & dividends',
      hint: 'Action',
      action: 'refresh',
      keywords: ['yahoo', 'market', 'update'],
    },
    {
      id: 'action:import',
      type: 'action',
      label: 'Open Import',
      hint: 'Action',
      action: 'navigate',
      path: '/import',
      keywords: ['schwab', 'upload', 'broker'],
    },
    {
      id: 'action:help',
      type: 'action',
      label: 'Open Help',
      hint: 'Action',
      action: 'navigate',
      path: '/help',
      keywords: ['docs', 'guide'],
    },
    {
      id: 'action:menu-control',
      type: 'action',
      label: 'Open Menu Control',
      hint: 'Action',
      action: 'navigate',
      path: '/menu-control',
      keywords: ['hide', 'preset', 'nav'],
    },
    {
      id: 'action:basis-original',
      type: 'action',
      label: 'Use original cost basis',
      hint: basisMode === 'original' ? 'Current' : 'Action',
      action: 'basis',
      basisMode: 'original',
      keywords: ['basis'],
    },
    {
      id: 'action:basis-broker',
      type: 'action',
      label: 'Use broker-adjusted cost basis',
      hint: basisMode === 'broker_adjusted' ? 'Current' : 'Action',
      action: 'basis',
      basisMode: 'broker_adjusted',
      keywords: ['basis', 'schwab'],
    },
  ]

  profiles.filter(profile => !profile.hidden_from_selector).forEach(profile => {
    actions.push({
      id: `action:profile-${profile.id}`,
      type: 'action',
      label: `Switch portfolio: ${profile.name}`,
      hint: 'Portfolio',
      action: 'profile',
      selection: `p:${profile.id}`,
      keywords: ['portfolio', profile.name],
    })
  })

  aggregates.filter(aggregate => !aggregate.hidden_from_selector).forEach(aggregate => {
    actions.push({
      id: `action:aggregate-${aggregate.id}`,
      type: 'action',
      label: `Switch aggregate: ${aggregate.name}`,
      hint: 'Portfolio',
      action: 'profile',
      selection: `a:${aggregate.id}`,
      keywords: ['aggregate', aggregate.name],
    })
  })

  return actions
}

export function tickerCatalogItems(tickers = []) {
  const seen = new Set()
  const items = []
  tickers.forEach(entry => {
    const ticker = String(entry.ticker || '').trim().toUpperCase()
    if (!ticker || seen.has(ticker)) return
    seen.add(ticker)
    items.push({
      id: `ticker:${ticker}`,
      type: 'ticker',
      label: ticker,
      hint: entry.source === 'watchlist' ? 'Watchlist' : 'Holding',
      action: 'research',
      ticker,
      keywords: [entry.name, entry.source].filter(Boolean),
    })
  })
  return items
}

function itemHaystack(item) {
  return [
    item.label,
    item.hint,
    item.path,
    item.hidden ? 'hidden' : '',
    ...(item.keywords || []),
  ]
}

const EMPTY_PAGE_IDS = new Set([
  'page:dashboard',
  'page:action-center',
  'page:holdings',
  'page:growth',
  'page:dividends',
  'page:import',
  'page:help',
  'page:menu-control',
])

export function searchCatalog(query, { pages = [], actions = [], tickers = [] } = {}) {
  const q = String(query || '').trim()
  const scored = []
  const consider = (item, boost) => {
    const { matched, score } = matchQuery(q, itemHaystack(item))
    if (!matched) return
    scored.push({ ...item, score: score + boost })
  }

  if (!q) {
    actions.slice(0, 4).forEach(item => scored.push({ ...item, score: 20 }))
    pages.filter(item => EMPTY_PAGE_IDS.has(item.id)).forEach(item => scored.push({ ...item, score: 10 }))
    return scored
  }

  actions.forEach(item => consider(item, 6))
  pages.forEach(item => consider(item, item.hidden ? 2 : 8))
  tickers.forEach(item => consider(item, /^[A-Z0-9.-]{1,8}$/i.test(q) ? 14 : 4))

  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  return scored.slice(0, 30)
}
