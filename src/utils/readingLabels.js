export const STOCK_READING = {
  strong: 'Strong reading',
  favorable: 'Favorable reading',
  mixed: 'Mixed reading',
  low: 'Low reading',
}

export const FUND_READING = {
  strong: 'Strong reading',
  partial: 'Partial reading',
  low: 'Low reading',
}

const SIGNAL_READING = {
  BUY: 'Bullish',
  SELL: 'Bearish',
  NEUTRAL: 'Neutral',
  HOLD: 'Unchanged',
}

export function signalReading(state) {
  const key = String(state || '').trim().toUpperCase()
  return SIGNAL_READING[key] || (state ?? '')
}

export function plannedActionLabel(action) {
  const key = String(action || '').trim().toLowerCase()
  if (key === 'buy') return 'Increase'
  if (key === 'sell') return 'Decrease'
  if (key === 'hold') return 'Unchanged'
  return signalReading(action)
}

export function fitReading(category) {
  return category === 'Avoid' ? 'Low fit' : category
}

export const TECHNICAL_READINGS_TITLE = 'Technical Readings'
export const STOCK_CHECKLIST_TITLE = 'Stock Checklist'
export const CEF_CHECKLIST_TITLE = 'CEF Checklist Evaluator'
