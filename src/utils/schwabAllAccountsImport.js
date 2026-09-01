const OTHER_SKIP = new Set(['skip', 'new', ''])

export const isBrokerSource = (value, brokerSource) => (
  String(value || '').trim().toLowerCase() === String(brokerSource || '').trim().toLowerCase()
)

export const isSchwabBrokerSource = (value) => isBrokerSource(value, 'schwab')

export const isOtherBrokerSource = (value) => {
  const broker = String(value || '').trim().toLowerCase()
  return Boolean(broker) && broker !== 'schwab'
}

export const shouldAutodetectSchwabAllAccounts = (fileName, selectedFormat) => (
  selectedFormat !== 'schwab'
  && !String(selectedFormat || '').startsWith('fidelity')
  && /all[-_\s]?accounts/i.test(String(fileName || ''))
)

const profileId = (profile) => String(profile?.id)

export const brokerImportDestinations = (profiles, brokerSource) => {
  // Owner is a rollup, never a broker import destination. This applies even
  // when it is the only visible selection: the first broker account must be
  // created as a normal portfolio instead of being written into profile 1.
  const list = (profiles || []).filter(profile => Number(profile.id) !== 1 && !profile.is_owner)
  const brokerProfiles = list.filter(profile => isBrokerSource(profile.broker_source, brokerSource))
  if (brokerProfiles.length) return brokerProfiles
  // No portfolio is tagged with this broker yet; offer untagged ones so the
  // first All-Accounts import still has somewhere to land.
  const untagged = list.filter(profile => !String(profile.broker_source || '').trim())
  return untagged
}

export const schwabImportDestinations = (profiles) => brokerImportDestinations(profiles, 'schwab')

export const defaultBrokerDestSelection = (destinations, brokerSource) => {
  const list = destinations || []
  const tagged = list.filter(profile => isBrokerSource(profile.broker_source, brokerSource))
  const pickFrom = tagged.length ? tagged : list
  const picked = new Set(pickFrom.map(profileId))
  return Object.fromEntries(list.map(profile => [profileId(profile), picked.has(profileId(profile))]))
}

export const defaultSchwabDestSelection = (destinations) => (
  defaultBrokerDestSelection(destinations, 'schwab')
)

// Settings key holding the user's saved All-Accounts destination picks, as a
// JSON array of profile ids.
export const SCHWAB_DEFAULT_DESTINATIONS_KEY = 'schwab_import_default_destinations'
export const FIDELITY_DEFAULT_DESTINATIONS_KEY = 'fidelity_import_default_destinations'
export const SHEAR_GROUP_DEFAULT_DESTINATIONS_KEY = 'shear_group_import_default_destinations'

const DEFAULT_DESTINATION_KEYS = {
  schwab: SCHWAB_DEFAULT_DESTINATIONS_KEY,
  fidelity: FIDELITY_DEFAULT_DESTINATIONS_KEY,
  shear_group: SHEAR_GROUP_DEFAULT_DESTINATIONS_KEY,
}

export const defaultDestinationsKeyForBroker = (brokerSource) => (
  DEFAULT_DESTINATION_KEYS[String(brokerSource || '').trim().toLowerCase()]
  || SCHWAB_DEFAULT_DESTINATIONS_KEY
)

export const parseSavedDestinationIds = (raw) => {
  if (raw == null || raw === '') return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return null
    return parsed.map(String)
  } catch {
    // A hand-edited or corrupted value falls back to the built-in default
    // rather than blocking the import.
    return null
  }
}

export const serializeDestinationIds = (destSelected) => JSON.stringify(
  Object.entries(destSelected || {})
    .filter(([, on]) => on)
    .map(([id]) => String(id))
    .sort((a, b) => Number(a) - Number(b)),
)

// Saved picks win over the broker-source default, but only for portfolios that
// still exist — a deleted portfolio's id must not resurrect as a checked row.
export const savedBrokerDestSelection = (destinations, savedIds) => {
  const list = destinations || []
  if (!savedIds || !list.length) return null
  const saved = new Set(savedIds.map(String))
  const anyStillPresent = list.some(profile => saved.has(profileId(profile)))
  if (!anyStillPresent) return null
  return Object.fromEntries(list.map(profile => [profileId(profile), saved.has(profileId(profile))]))
}

export const savedSchwabDestSelection = savedBrokerDestSelection

export const destSelectionMatchesSaved = (destSelected, savedIds) => (
  savedIds != null && serializeDestinationIds(destSelected) === JSON.stringify(
    savedIds.map(String).sort((a, b) => Number(a) - Number(b)),
  )
)

export const mergeBrokerDestSelection = (current, destinations, brokerSource) => {
  const next = { ...(current || {}) }
  const list = destinations || []
  const hasBrokerTagged = list.some(profile => isBrokerSource(profile.broker_source, brokerSource))
  for (const profile of list) {
    const key = profileId(profile)
    if (key in next) continue
    next[key] = hasBrokerTagged ? isBrokerSource(profile.broker_source, brokerSource) : true
  }
  return next
}

export const mergeSchwabDestSelection = (current, destinations) => (
  mergeBrokerDestSelection(current, destinations, 'schwab')
)

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

export const applyBrokerDestSelection = (destSelected, accounts, accountMap) => {
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

export const applySchwabDestSelection = applyBrokerDestSelection

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
