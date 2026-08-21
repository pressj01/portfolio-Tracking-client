const OTHER_SKIP = new Set(['skip', 'new', ''])

export const isSchwabBrokerSource = (value) => (
  String(value || '').trim().toLowerCase() === 'schwab'
)

export const isOtherBrokerSource = (value) => {
  const broker = String(value || '').trim().toLowerCase()
  return Boolean(broker) && broker !== 'schwab'
}

export const shouldAutodetectSchwabAllAccounts = (fileName, selectedFormat) => (
  selectedFormat !== 'schwab'
  && /all[-_\s]?accounts/i.test(String(fileName || ''))
)

const profileId = (profile) => String(profile?.id)

export const schwabImportDestinations = (profiles) => {
  const list = profiles || []
  const schwab = list.filter(profile => isSchwabBrokerSource(profile.broker_source))
  const schwabOthers = schwab.filter(profile => Number(profile.id) !== 1)
  // Owner is a rollup when other Schwab portfolios exist, so it is not an
  // import target until it is the only Schwab portfolio.
  if (schwabOthers.length) return schwabOthers
  if (schwab.length) return schwab
  // No portfolio is tagged Charles Schwab yet; offer untagged ones so the
  // first All-Accounts import still has somewhere to land.
  const untagged = list.filter(profile => !isOtherBrokerSource(profile.broker_source))
  const untaggedOthers = untagged.filter(profile => Number(profile.id) !== 1)
  return untaggedOthers.length ? untaggedOthers : untagged
}

export const defaultSchwabDestSelection = (destinations) => {
  const list = destinations || []
  const tagged = list.filter(profile => isSchwabBrokerSource(profile.broker_source))
  const pickFrom = tagged.length ? tagged : list
  const picked = new Set(pickFrom.map(profileId))
  return Object.fromEntries(list.map(profile => [profileId(profile), picked.has(profileId(profile))]))
}

export const mergeSchwabDestSelection = (current, destinations) => {
  const next = { ...(current || {}) }
  const list = destinations || []
  const hasSchwabTagged = list.some(profile => isSchwabBrokerSource(profile.broker_source))
  for (const profile of list) {
    const key = profileId(profile)
    if (key in next) continue
    next[key] = hasSchwabTagged ? isSchwabBrokerSource(profile.broker_source) : true
  }
  return next
}

export const fileAccountForProfile = (accounts, accountMap, destId) => {
  const pid = String(destId)
  return (accounts || []).find(account => String(accountMap?.[account.account_key] || '') === pid) || null
}

export const leftoverFileAccounts = (accounts, accountMap) => (
  (accounts || []).filter((account) => {
    const value = accountMap?.[account.account_key]
    return value == null || OTHER_SKIP.has(String(value))
  })
)

const selectedProfileIds = (destSelected) => new Set(
  Object.entries(destSelected || {})
    .filter(([, on]) => on)
    .map(([id]) => String(id))
)

export const applySchwabDestSelection = (destSelected, accounts, accountMap) => {
  const nextMap = { ...(accountMap || {}) }
  const selectedIds = selectedProfileIds(destSelected)

  for (const account of accounts || []) {
    if (!(account.account_key in nextMap) || nextMap[account.account_key] == null) {
      nextMap[account.account_key] = ''
    }
  }

  for (const [accountKey, value] of Object.entries(nextMap)) {
    if (value === 'new' || value === 'skip' || value === '' || value == null) continue
    if (!selectedIds.has(String(value))) nextMap[accountKey] = ''
  }

  const claimed = new Set(
    Object.values(nextMap)
      .filter(value => value && value !== 'new' && value !== 'skip')
      .map(value => String(value))
  )

  for (const account of accounts || []) {
    const suggested = account.suggested_profile_id != null
      ? String(account.suggested_profile_id)
      : ''
    if (!suggested || !selectedIds.has(suggested) || claimed.has(suggested)) continue
    const current = nextMap[account.account_key]
    if (current && current !== 'skip') continue
    nextMap[account.account_key] = suggested
    claimed.add(suggested)
  }

  return nextMap
}

export const assignFileAccountToProfile = (accountMap, accountKey, destId) => {
  const next = { ...(accountMap || {}) }
  const pid = destId == null || destId === '' ? '' : String(destId)
  if (pid) {
    for (const [key, value] of Object.entries(next)) {
      if (String(value) === pid) next[key] = ''
    }
  }
  if (accountKey) next[accountKey] = pid
  return next
}
