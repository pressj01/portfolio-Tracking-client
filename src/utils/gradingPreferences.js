export const GRADING_PREFERENCES_KEY = 'portfolioGradingPreferences.v1'
export const GRADING_PREFERENCES_EVENT = 'portfolio-grading-preferences-changed'

export const DEFAULT_GRADING_PREFERENCES = Object.freeze({
  stock: {
    blendWeights: { fundamental: 60, technical: 40 },
    groupWeights: {
      valuation: 1,
      profitability: 1,
      growth: 1,
      health: 1,
      trend: 1,
      momentum: 1,
      oscillators: 1,
      volume: 1,
    },
    badgeBands: { pass: 80, warn: 50 },
    fundamentalBands: {
      lowerExcellent: 0.8,
      lowerGood: 1.0,
      lowerFair: 1.3,
      lowerWeak: 1.6,
      higherExcellent: 1.2,
      higherGood: 1.0,
      higherFair: 0.7,
      higherWeak: 0.4,
    },
    metricScores: {
      excellent: 100,
      good: 85,
      lowerFair: 64,
      lowerWeak: 46,
      higherFair: 62,
      higherWeak: 44,
      poor: 28,
    },
    signalScores: { buy: 90, neutral: 60, sell: 25 },
    technicalThresholds: {
      trendBufferPct: 1,
      rsiBuyBelow: 30,
      rsiSellAbove: 70,
      stochasticBuyBelow: 20,
      stochasticSellAbove: 80,
      obvNeutralBandPct: 0,
    },
    rangeBands: { best: 30, good: 50, fair: 70, weak: 85 },
    rangeScores: { best: 90, good: 75, fair: 55, weak: 40, poor: 28 },
    verdictBands: { strongBuy: 75, strongFundamental: 70, buy: 60, hold: 45 },
  },
  signals: {
    thresholds: {
      aoZeroBuffer: 0,
      rsiBuyBelow: 30,
      rsiSellAbove: 70,
      smaBufferPct: 1,
      majorityPct: 50,
      navBuyMaxRatio: 0.25,
      navSellAboveRatio: 0.75,
      navHardDeclinePct: 50,
    },
    weights: { ao: 1, rsi: 1, macd: 1, sma50: 1, sma200: 1, nav: 1 },
  },
})

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_GRADING_PREFERENCES))

const finite = (value, fallback, min, max) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const normalizedObject = (source, defaults, min, max) => Object.fromEntries(
  Object.entries(defaults).map(([key, fallback]) => [
    key,
    finite(source?.[key], fallback, min, max),
  ]),
)

export function normalizeGradingPreferences(saved = {}) {
  const defaults = cloneDefaults()
  const stock = saved?.stock || {}
  const signals = saved?.signals || {}

  return {
    stock: {
      blendWeights: normalizedObject(stock.blendWeights, defaults.stock.blendWeights, 0, 100),
      groupWeights: normalizedObject(stock.groupWeights, defaults.stock.groupWeights, 0, 10),
      badgeBands: normalizedObject(stock.badgeBands, defaults.stock.badgeBands, 0, 100),
      fundamentalBands: normalizedObject(stock.fundamentalBands, defaults.stock.fundamentalBands, 0, 10),
      metricScores: normalizedObject(stock.metricScores, defaults.stock.metricScores, 0, 100),
      signalScores: normalizedObject(stock.signalScores, defaults.stock.signalScores, 0, 100),
      technicalThresholds: normalizedObject(stock.technicalThresholds, defaults.stock.technicalThresholds, 0, 100),
      rangeBands: normalizedObject(stock.rangeBands, defaults.stock.rangeBands, 0, 100),
      rangeScores: normalizedObject(stock.rangeScores, defaults.stock.rangeScores, 0, 100),
      verdictBands: normalizedObject(stock.verdictBands, defaults.stock.verdictBands, 0, 100),
    },
    signals: {
      thresholds: normalizedObject(signals.thresholds, defaults.signals.thresholds, 0, 100),
      weights: normalizedObject(signals.weights, defaults.signals.weights, 0, 10),
    },
  }
}

export function loadGradingPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(GRADING_PREFERENCES_KEY)
    return normalizeGradingPreferences(raw ? JSON.parse(raw) : {})
  } catch {
    return normalizeGradingPreferences()
  }
}

export function saveGradingPreferences(preferences, storage = globalThis.localStorage) {
  const normalized = normalizeGradingPreferences(preferences)
  try {
    storage?.setItem(GRADING_PREFERENCES_KEY, JSON.stringify(normalized))
    globalThis.dispatchEvent?.(new CustomEvent(GRADING_PREFERENCES_EVENT, { detail: normalized }))
  } catch {
    // Private browsing or a storage policy may make persistence unavailable.
  }
  return normalized
}

export function resetGradingPreferences(storage = globalThis.localStorage) {
  const defaults = normalizeGradingPreferences()
  try {
    storage?.removeItem(GRADING_PREFERENCES_KEY)
    globalThis.dispatchEvent?.(new CustomEvent(GRADING_PREFERENCES_EVENT, { detail: defaults }))
  } catch {
    // Best-effort local preference reset.
  }
  return defaults
}
