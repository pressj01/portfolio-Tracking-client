const link = (id, label, path, options = {}) => ({
  id,
  kind: 'link',
  label,
  path,
  ...options,
})

const dropdown = (id, label, items) => ({ id, kind: 'dropdown', label, items })

const groupedDropdown = (id, label, groups) => ({
  id,
  kind: 'grouped-dropdown',
  label,
  groups,
})

export const NAVIGATION_ITEMS = [
  link('dashboard', 'Dashboard', '/'),
  link('action-center', 'Action Center', '/action-center'),
  dropdown('options', 'Options', [
    link('option-dashboard', 'Options Dashboard', '/option-dashboard'),
    link('option-probability-calculator', 'Probability Calculator', '/option-probability-calculator'),
    link('option-trades', 'Option Trades', '/option-trades'),
    link('option-trades-import', 'Import Option Trades', '/option-trades/import'),
    link('strategy-lab', 'Strategy Lab', '/options'),
    link('general-option-scanner', 'General Option Scanner', '/general-option-scanner'),
    link('option-education', 'Option Strategy Education', '/option-education'),
    link('option-greeks', 'Understanding the Greeks', '/option-greeks'),
  ]),
  dropdown('portfolio', 'Portfolio', [
    link('split-view', 'Split View', '/split-screen', { title: 'Show two pages side by side. Each pane can use a different account; they still share one date range' }),
    link('holdings', 'Holdings', '/holdings'),
    link('categories', 'Categories', '/categories'),
    link('holding-targets', 'Holding Targets', '/holding-targets'),
    link('growth', 'Growth', '/growth'),
    link('retirement-readiness', 'Retirement Readiness', '/retirement-readiness'),
    link('cash-flow', 'Cash Flow & Sustainability', '/cash-flow'),
    link('dividends', 'Dividends', '/dividends'),
    link('dividend-ledger', 'Daily, Weekly & Monthly Payments', '/dividend-ledger'),
    link('dividend-calendar', 'Dividend Calendar', '/div-calendar'),
    link('earnings-calendar', 'Earnings Calendar', '/earnings-calendar'),
    link('dividend-compare', 'Dividend Compare', '/div-compare'),
    link('dividend-history', 'Dividend History', '/dividend-history'),
    link('reinvestment-impact', 'Reinvestment Impact', '/reinvestment-impact'),
    link('total-return', 'Total Return', '/total-return'),
    link('gains-losses', 'Gains & Losses', '/gains-losses'),
    link('safe-withdrawal', 'Safe Withdrawal', '/safe-withdrawal'),
    link('dividend-calculator', 'Dividend Calculator', '/dividend-calculator'),
    link('watchlist', 'Watchlist', '/watchlist'),
  ]),
  dropdown('checklists', 'Checklists', [
    link('stock-buying-checklist', 'Stock Buying Checklist', '/stock-buying-checklist'),
    link('etf-buying-checklist', 'Non Income ETF Checklist Evaluator', '/etf-buying-checklist-evaluator'),
    link('option-income-etf-evaluator', 'Option-Income ETF Evaluator', '/option-income-etf-evaluator'),
  ]),
  groupedDropdown('analysis', 'Analysis', [
    {
      id: 'research-compare',
      label: 'Research & Compare',
      items: [
        link('security-research', 'Security Research', '/security-research'),
        link('stock-etf-analysis', 'Stock and ETF Analysis', '/etf-screen'),
        link('etf-comparer', 'ETF Comparer', '/etf-comparer'),
        link('stock-comparer', 'Stock Comparer', '/stock-comparer'),
        link('stock-valuation', 'Stock Valuation (DCF)', '/stock-valuation'),
        link('distribution-compare', 'Distribution Compare', '/dist-compare'),
      ],
    },
    {
      id: 'screeners-signals',
      label: 'Screeners & Signals',
      items: [
        link('general-scanner', 'General Scanner', '/general-scanner'),
        link('single-strategy-scanner', 'Single Strategy Scanner', '/scanner'),
        link('buy-sell-signals', 'Buy / Sell Signals', '/buy-sell-signals'),
      ],
    },
    {
      id: 'income-nav-risk',
      label: 'Income & NAV Risk',
      items: [
        link('nav-erosion', 'NAV Erosion', '/nav-erosion'),
        link('nav-erosion-screener', 'NAV Erosion Screener', '/nav-erosion-portfolio'),
        link('drip-cash-analyzer', 'DRIP vs. Cash Analyzer', '/drip-score'),
        link('income-simulator', 'Income Simulator', '/income-sim'),
        link('income-growth', 'Income Growth', '/income-growth'),
      ],
    },
    {
      id: 'portfolio-diagnostics',
      label: 'Portfolio Diagnostics',
      items: [
        link('portfolio-analytics', 'Portfolio Analytics', '/analytics'),
        link('diversification', 'Diversification', '/diversification', { end: true }),
        link('sector-exposure', 'Sector Exposure', '/diversification/sectors'),
        link('fund-definitions', 'Fund Definitions', '/fund-definitions'),
        link('correlation-matrix', 'Correlation Matrix', '/correlation'),
        link('consolidation-analysis', 'Consolidation Analysis', '/consolidation'),
        link('macro-regime-dashboard', 'Macro Regime Dashboard', '/macro-dashboard'),
      ],
    },
    {
      id: 'planning-optimization',
      label: 'Planning & Optimization',
      items: [
        link('growth-income-freedom', 'Growth & Income Freedom', '/growth-income-freedom'),
        link('portfolio-builder', 'Portfolio Builder', '/portfolio-builder'),
        link('portfolio-tester', 'Portfolio Tester', '/portfolio-tester'),
        link('rebalance-wizard', 'Rebalance Wizard', '/rebalance-wizard'),
      ],
    },
  ]),
  dropdown('cefs', "CEF's", [
    link('closed-cef-information', 'Closed CEF Information', '/closed-cef-info'),
    link('cef-buying-guide', 'What to Look For When Buying CEFs', '/cef-buying-guide'),
    link('cef-checklist-evaluator', 'CEF Buying Checklist Evaluator', '/cef-buying-checklist-evaluator'),
    link('cef-income-etf-guide', 'CEFs & Income ETFs: A Guide', '/cef-vs-income-etf'),
  ]),
  dropdown('taxes', 'Taxes', [
    link('annual-tax-report', 'Annual Tax Report', '/tax-report'),
    link('tax-loss-harvest', 'Tax-Loss Harvest', '/tax-loss'),
    link('blended-yield', 'Blended Yield', '/blended-yield'),
  ]),
  dropdown('admin', 'Admin', [
    link('import', 'Import', '/import'),
    link('export', 'Export', '/export'),
    link('etf-provider-update', 'ETF Provider Update', '/etf-provider-update'),
    link('portfolios', 'Portfolios', '/portfolios'),
    link('menu-control', 'Menu Control', '/menu-control'),
    link('settings', 'Settings', '/settings'),
    link('help', 'Help', '/help'),
  ]),
]

export const TOP_LEVEL_SCOPE_ID = 'top-level'

export const groupOrderScopeId = (menuId) => `${menuId}:groups`
export const groupItemsScopeId = (menuId, groupId) => `${menuId}:${groupId}`

export function menuOrderScopes() {
  const scopes = [{
    id: TOP_LEVEL_SCOPE_ID,
    label: 'Top navigation',
    description: 'Dashboard, Action Center, and the dropdown menus.',
    items: NAVIGATION_ITEMS,
  }]

  NAVIGATION_ITEMS.forEach(menu => {
    if (menu.kind === 'dropdown') {
      scopes.push({
        id: menu.id,
        label: `${menu.label} menu`,
        description: `Items shown inside the ${menu.label} dropdown.`,
        items: menu.items,
      })
    }

    if (menu.kind === 'grouped-dropdown') {
      scopes.push({
        id: groupOrderScopeId(menu.id),
        label: `${menu.label} groups`,
        description: `Section headings shown inside the ${menu.label} dropdown.`,
        items: menu.groups,
      })
      menu.groups.forEach(group => {
        scopes.push({
          id: groupItemsScopeId(menu.id, group.id),
          label: `${menu.label} — ${group.label}`,
          description: `Items shown in the ${group.label} section.`,
          items: group.items,
        })
      })
    }
  })

  return scopes
}

export const MENU_ORDER_SCOPES = menuOrderScopes()

export const DEFAULT_MENU_ORDER = Object.fromEntries(
  MENU_ORDER_SCOPES.map(scope => [scope.id, scope.items.map(item => item.id)]),
)

export function normalizeMenuOrder(savedOrder) {
  const source = savedOrder && typeof savedOrder === 'object' && !Array.isArray(savedOrder)
    ? savedOrder
    : {}

  return Object.fromEntries(MENU_ORDER_SCOPES.map(scope => {
    const defaultIds = DEFAULT_MENU_ORDER[scope.id]
    const allowed = new Set(defaultIds)
    const seen = new Set()
    const savedIds = Array.isArray(source[scope.id]) ? source[scope.id] : []
    const orderedIds = savedIds.filter(id => {
      if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
    defaultIds.forEach(id => {
      if (!seen.has(id)) orderedIds.push(id)
    })
    return [scope.id, orderedIds]
  }))
}

export function orderMenuItems(items, scopeId, menuOrder) {
  const byId = new Map(items.map(item => [item.id, item]))
  const ids = normalizeMenuOrder(menuOrder)[scopeId] || items.map(item => item.id)
  return ids.map(id => byId.get(id)).filter(Boolean)
}

// Pages the nav must always keep so Menu Control, Settings, Help, and the home
// screen stay reachable without relying on the command palette.
export const PROTECTED_MENU_IDS = new Set([
  'dashboard',
  'admin',
  'menu-control',
  'settings',
  'help',
])

export const MENU_LINKS = []
export const MENU_ID_BY_PATH = new Map()

function indexNavigation() {
  const hideable = []
  const registerLink = (item, menuLabel) => {
    MENU_LINKS.push({
      id: item.id,
      label: item.label,
      path: item.path,
      menuLabel,
      title: item.title || '',
    })
    MENU_ID_BY_PATH.set(item.path, item.id)
    if (!PROTECTED_MENU_IDS.has(item.id)) hideable.push(item.id)
  }

  NAVIGATION_ITEMS.forEach(menu => {
    if (menu.kind === 'link') {
      registerLink(menu, 'Main')
      return
    }
    if (!PROTECTED_MENU_IDS.has(menu.id)) hideable.push(menu.id)
    if (menu.kind === 'dropdown') {
      menu.items.forEach(item => registerLink(item, menu.label))
    }
    if (menu.kind === 'grouped-dropdown') {
      menu.groups.forEach(group => {
        group.items.forEach(item => registerLink(item, `${menu.label} · ${group.label}`))
      })
    }
  })
  return hideable
}

export const HIDEABLE_MENU_IDS = indexNavigation()
const HIDEABLE_MENU_ID_SET = new Set(HIDEABLE_MENU_IDS)

export function isMenuIdProtected(id) {
  return PROTECTED_MENU_IDS.has(id)
}

export function normalizeHiddenIds(hidden) {
  const source = Array.isArray(hidden) ? hidden : []
  const seen = new Set()
  const ordered = []
  source.forEach(id => {
    if (typeof id !== 'string' || !HIDEABLE_MENU_ID_SET.has(id) || seen.has(id)) return
    seen.add(id)
    ordered.push(id)
  })
  return ordered
}

export const MENU_PRESETS = [
  {
    id: 'income-tracker',
    label: 'Income tracker',
    description: 'Dividends, payments, and retirement income. Hides options tools and most research scanners.',
    hidden: [
      'options',
      'stock-buying-checklist',
      'etf-buying-checklist',
      'option-income-etf-evaluator',
      'general-scanner',
      'single-strategy-scanner',
      'buy-sell-signals',
      'stock-valuation',
      'stock-comparer',
      'etf-comparer',
      'stock-etf-analysis',
      'distribution-compare',
      'portfolio-builder',
      'portfolio-tester',
      'rebalance-wizard',
      'correlation-matrix',
      'consolidation-analysis',
      'macro-regime-dashboard',
      'diversification',
      'sector-exposure',
      'fund-definitions',
      'portfolio-analytics',
    ],
  },
  {
    id: 'cef-analyst',
    label: 'CEF analyst',
    description: 'CEFs, NAV erosion, and income research. Hides options overlay and retirement simulators.',
    hidden: [
      'options',
      'stock-buying-checklist',
      'etf-buying-checklist',
      'option-income-etf-evaluator',
      'retirement-readiness',
      'cash-flow',
      'safe-withdrawal',
      'dividend-calculator',
      'earnings-calendar',
      'income-simulator',
      'income-growth',
      'growth-income-freedom',
      'general-scanner',
      'single-strategy-scanner',
      'buy-sell-signals',
      'stock-valuation',
      'stock-comparer',
      'portfolio-builder',
      'portfolio-tester',
      'rebalance-wizard',
      'correlation-matrix',
      'consolidation-analysis',
      'macro-regime-dashboard',
      'diversification',
      'sector-exposure',
      'fund-definitions',
      'portfolio-analytics',
    ],
  },
  {
    id: 'options-overlay',
    label: 'Options overlay',
    description: 'Options dashboard, trades, and scanners. Hides CEF guides and most dividend calendars.',
    hidden: [
      'cefs',
      'stock-buying-checklist',
      'etf-buying-checklist',
      'retirement-readiness',
      'cash-flow',
      'safe-withdrawal',
      'dividend-calculator',
      'dividend-compare',
      'dividend-history',
      'dividend-calendar',
      'dividend-ledger',
      'dividends',
      'earnings-calendar',
      'reinvestment-impact',
      'income-simulator',
      'income-growth',
      'growth-income-freedom',
      'nav-erosion',
      'nav-erosion-screener',
      'drip-cash-analyzer',
      'etf-comparer',
      'stock-comparer',
      'stock-valuation',
      'distribution-compare',
      'blended-yield',
    ],
  },
].map(preset => ({ ...preset, hidden: normalizeHiddenIds(preset.hidden) }))

export const MENU_PRESET_IDS = new Set(MENU_PRESETS.map(preset => preset.id))

export function normalizePreset(value) {
  if (value == null || value === '' || value === 'none') return null
  return MENU_PRESET_IDS.has(value) ? value : null
}

export function matchingMenuPreset(hiddenIds) {
  const normalized = normalizeHiddenIds(hiddenIds).slice().sort()
  const match = MENU_PRESETS.find(preset => {
    const target = preset.hidden.slice().sort()
    return target.length === normalized.length && target.every((id, index) => id === normalized[index])
  })
  return match?.id || null
}

export function menuIdForPath(path) {
  const pathname = String(path || '/').split('?')[0].split('#')[0]
  if (pathname === '/') return 'dashboard'
  if (pathname.startsWith('/closed-cef-info')) return 'closed-cef-information'
  if (MENU_ID_BY_PATH.has(pathname)) return MENU_ID_BY_PATH.get(pathname)
  const prefixed = MENU_LINKS
    .filter(link => link.path !== '/' && pathname.startsWith(`${link.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return prefixed?.id || null
}

export function hiddenPathSet(hiddenIds) {
  const hidden = new Set(normalizeHiddenIds(hiddenIds))
  return new Set(MENU_LINKS.filter(link => hidden.has(link.id)).map(link => link.path))
}

export function visibleNavigation(menuOrder, hiddenIds) {
  const hidden = new Set(normalizeHiddenIds(hiddenIds))
  return orderMenuItems(NAVIGATION_ITEMS, TOP_LEVEL_SCOPE_ID, menuOrder)
    .map(menu => {
      if (hidden.has(menu.id)) return null
      if (menu.kind === 'link') return menu
      if (menu.kind === 'dropdown') {
        const items = orderMenuItems(menu.items, menu.id, menuOrder).filter(item => !hidden.has(item.id))
        if (!items.length) return null
        return { ...menu, items }
      }
      const groups = orderMenuItems(menu.groups, groupOrderScopeId(menu.id), menuOrder)
        .map(group => ({
          ...group,
          items: orderMenuItems(group.items, groupItemsScopeId(menu.id, group.id), menuOrder)
            .filter(item => !hidden.has(item.id)),
        }))
        .filter(group => group.items.length)
      if (!groups.length) return null
      return { ...menu, groups }
    })
    .filter(Boolean)
}
