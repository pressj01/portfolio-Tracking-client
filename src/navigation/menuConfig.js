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
    link('split-view', 'Split View', '/split-screen', { title: 'Show two pages side by side, sharing one date range' }),
    link('holdings', 'Holdings', '/holdings'),
    link('common-info', 'CommonInfo', '/common-info'),
    link('categories', 'Categories', '/categories'),
    link('holding-targets', 'Holding Targets', '/holding-targets'),
    link('growth', 'Growth', '/growth'),
    link('portfolio-growth-2', 'Portfolio Growth 2', '/growth-2'),
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
