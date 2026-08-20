export const GROWTH_TABS = [
  {
    id: 'dollars',
    label: 'Dollars',
    title: 'What is the account worth, and does it match the broker?',
  },
  {
    id: 'vs-market',
    label: 'Vs market',
    title: 'Did these holdings beat the benchmark?',
  },
  {
    id: 'lots',
    label: 'Lots',
    title: 'Where did the dollars come from after buys, sells, and a full sale plus rebuy?',
  },
]

export const DEFAULT_GROWTH_TAB = 'dollars'

export const GROWTH_TAB_STORAGE_KEY = 'growth_workspace_tab_v1'

const GROWTH_TAB_IDS = new Set(GROWTH_TABS.map(tab => tab.id))

const GROWTH_TAB_ALIASES = {
  'growth-2': 'dollars',
  dollar: 'dollars',
  value: 'dollars',
  market: 'vs-market',
  'vs market': 'vs-market',
  vs_market: 'vs-market',
  growth: 'vs-market',
  performance: 'vs-market',
  gains: 'lots',
  'gains-losses': 'lots',
  gl: 'lots',
}

export function parseGrowthTab(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (GROWTH_TAB_IDS.has(raw)) return raw
  return GROWTH_TAB_ALIASES[raw] || null
}

export function readStoredGrowthTab() {
  if (typeof window === 'undefined') return null
  try {
    return parseGrowthTab(window.localStorage.getItem(GROWTH_TAB_STORAGE_KEY))
  } catch {
    return null
  }
}

export function persistGrowthTab(tab) {
  const id = parseGrowthTab(tab)
  if (!id || typeof window === 'undefined') return id
  try {
    window.localStorage.setItem(GROWTH_TAB_STORAGE_KEY, id)
  } catch {
    // best-effort
  }
  return id
}

export function resolveGrowthTab({ searchTab, storedTab } = {}) {
  return parseGrowthTab(searchTab) || parseGrowthTab(storedTab) || DEFAULT_GROWTH_TAB
}
