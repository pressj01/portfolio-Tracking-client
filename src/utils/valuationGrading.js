// Presentation helpers for the Stock Valuation (DCF) screen.
//
// The heavy lifting — DCF, multiples, the blended intrinsic value, the verdict,
// and the per-metric pass/warn/fail badges — is computed server-side
// (backend/valuation.py). This module only maps those results to colours and
// formats numbers for display.

import { formatMoney } from './money'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Server badges are already 'pass' | 'warn' | 'fail' | 'info'; this guards anything else.
export const toneClass = (badge) =>
  badge === 'pass' || badge === 'warn' || badge === 'fail' ? badge : 'info'

// Format a scorecard row value given its unit ('x' multiple, '%' percent, '' raw).
export function formatRowValue(row) {
  const v = num(row?.value)
  if (v === null) return 'n/a'
  if (row.unit === 'x') return `${v.toFixed(2)}×`
  if (row.unit === '%') return `${v.toFixed(2)}%`
  return v.toFixed(2)
}

export function formatBenchmark(row) {
  const b = num(row?.benchmark)
  if (b === null) return null
  if (row.unit === 'x') return `${b.toFixed(2)}×`
  if (row.unit === '%') return `${b.toFixed(2)}%`
  return b.toFixed(2)
}

// A per-share intrinsic value / price, in USD (money.js converts to CAD on display).
export const formatPrice = (v) => formatMoney(v, { fallback: 'n/a' })

export const formatPct = (v, digits = 1) => {
  const n = num(v)
  return n === null ? 'n/a' : `${n.toFixed(digits)}%`
}

// Assumptions arrive as fractions (0.105 = 10.5%); show as a percent string.
export const fracToPct = (v, digits = 1) => {
  const n = num(v)
  return n === null ? '' : (n * 100).toFixed(digits)
}

export const pctToFrac = (v) => {
  const n = num(v)
  return n === null ? null : n / 100
}
