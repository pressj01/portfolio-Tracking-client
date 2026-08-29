// Cash is a dated snapshot, never a live balance.
//
// A broker import writes it and it then stands untouched until the next import
// overwrites it. On a book of weekly payers settling on staggered days,
// something lands nearly every business day, so the stored figure is usually a
// few days behind — and a bare dollar amount reads as current, which is exactly
// how a routine import lag gets mistaken for a broken number.
//
// So every screen that shows cash shows the day it was written. These helpers
// exist so the account card and the Manage Portfolios table word it the same
// way rather than drifting apart.

const DAY_MS = 24 * 60 * 60 * 1000

const parseStamp = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const cashAgeDays = (value, now = Date.now()) => {
  const stamp = parseStamp(value)
  if (!stamp) return null
  // Floored whole days, so only a stamp written today reads as today.
  return Math.max(0, Math.floor((now - stamp.getTime()) / DAY_MS))
}

export const cashOriginLabel = (source) => (
  String(source || '').trim().toLowerCase() === 'manual' ? 'entered by hand' : 'as imported'
)

// The short line under a Manage Portfolios cash cell.
export const cashRowStamp = (profile, now = Date.now()) => {
  if (!profile) return ''
  const stamp = parseStamp(profile.cash_updated_at)
  if (!Number(profile.cash_value || 0) && !stamp) return ''
  if (!stamp) return 'date unknown'
  const days = cashAgeDays(profile.cash_updated_at, now)
  const date = stamp.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
  const origin = cashOriginLabel(profile.cash_source)
  if (days === 0) return `${origin} today`
  return `${origin} ${date} · ${days} day${days === 1 ? '' : 's'} ago`
}

// Hover text on the same cell, saying what a click does and what an import does.
export const cashRowTitle = (profile) => {
  const origin = cashOriginLabel(profile && profile.cash_source)
  return (
    `Cash ${origin}. Click to enter today's balance. `
    + 'The next broker import overwrites whatever is here — it is the more '
    + 'accurate figure for its own day.'
  )
}
