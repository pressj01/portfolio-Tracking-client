export function normalizeTicker(value) {
  return String(value || '').trim().toUpperCase()
}

export function uniqueTickers(values) {
  return [...new Set((values || []).map(normalizeTicker).filter(Boolean))]
}

export function mergeTickerLists(...lists) {
  return uniqueTickers(lists.flat())
}

export function normalizePortfolioHoldings(rows) {
  const holdings = new Map()

  for (const row of rows || []) {
    const ticker = normalizeTicker(row?.ticker)
    if (!ticker) continue

    const existing = holdings.get(ticker)
    const currentValue = Number(row?.current_value)
    const categories = Array.isArray(row?.categories)
      ? row.categories.map(value => String(value || '').trim()).filter(Boolean)
      : []

    if (existing) {
      existing.current_value += Number.isFinite(currentValue) ? currentValue : 0
      existing.categories = [...new Set([...existing.categories, ...categories])]
      if (!existing.description && row?.description) existing.description = String(row.description)
      continue
    }

    holdings.set(ticker, {
      ticker,
      description: String(row?.description || '').trim(),
      categories: [...new Set(categories)],
      current_value: Number.isFinite(currentValue) ? currentValue : 0,
    })
  }

  return [...holdings.values()]
}

export function readSavedTickers(storageKey, storage = globalThis.localStorage) {
  try {
    return uniqueTickers(JSON.parse(storage?.getItem(storageKey) || '[]'))
  } catch {
    return []
  }
}
