// Broker Import is a checklist, not a format encyclopedia.
// Positions snapshot first, then transactions, then refresh.
// Broker All-Accounts is an optional multi-account file when the export contains account identity.
// Snowball formats are a migration path only — they are not a workflow step.

export const NO_FORMAT = ''

export const IMPORT_BROKERS = [
  {
    id: 'schwab',
    label: 'Charles Schwab',
    source: 'schwab',
    positionsFormat: 'schwab',
    positionsMultiFormat: 'schwab_all_accounts',
    transactionsFormat: 'schwab_transactions',
  },
  {
    id: 'etrade',
    label: 'E*TRADE',
    source: 'etrade',
    positionsFormat: 'etrade',
    transactionsFormat: 'etrade_transactions',
  },
  {
    id: 'fidelity',
    label: 'Fidelity',
    source: 'fidelity',
    positionsFormat: 'fidelity',
    positionsMultiFormat: 'fidelity_all_accounts',
    transactionsFormat: 'fidelity_transactions',
  },
  {
    id: 'robinhood',
    label: 'Robinhood',
    source: 'robinhood',
    positionsFormat: 'robinhood',
    transactionsFormat: 'robinhood_transactions',
  },
  {
    id: 'shear_group',
    label: 'Shear Group',
    source: 'shear_group',
    positionsFormat: 'shear_group',
    positionsMultiFormat: 'shear_group_all_accounts',
    transactionsFormat: 'shear_group_activity',
    transactionsMultiFormat: 'shear_group_all_accounts_activity',
  },
  {
    id: 'interactive_brokers',
    label: 'Interactive Brokers',
    source: 'interactive_brokers',
    positionsFormat: 'interactive_brokers',
    transactionsFormat: 'interactive_brokers_transactions',
  },
]

export const TXN_FORMATS = [
  { value: 'schwab', label: 'Charles Schwab (Positions)' },
  { value: 'schwab_all_accounts', label: 'Charles Schwab (All Accounts Positions)' },
  { value: 'schwab_transactions', label: 'Charles Schwab (Transactions)' },
  { value: 'etrade', label: 'E*Trade (Positions)' },
  { value: 'etrade_transactions', label: 'E*Trade (Transactions)' },
  { value: 'fidelity', label: 'Fidelity (Positions)' },
  { value: 'fidelity_all_accounts', label: 'Fidelity (All Accounts Positions)' },
  { value: 'fidelity_transactions', label: 'Fidelity (Transactions)' },
  { value: 'robinhood', label: 'Robinhood (Positions PDF)' },
  { value: 'robinhood_transactions', label: 'Robinhood (Transactions)' },
  { value: 'shear_group', label: 'Shear Group (Positions)' },
  { value: 'shear_group_all_accounts', label: 'Shear Group (All Accounts Positions)' },
  { value: 'shear_group_activity', label: 'Shear Group (Activity)' },
  { value: 'shear_group_all_accounts_activity', label: 'Shear Group (All Accounts Activity)' },
  { value: 'interactive_brokers', label: 'Interactive Brokers (Positions)' },
  { value: 'interactive_brokers_transactions', label: 'Interactive Brokers (Transactions)' },
  { value: 'portfolio_export', label: 'Portfolio Export (Holdings + Transactions)' },
  { value: 'generic_transactions', label: 'Generic Transactions' },
  { value: 'snowball_holdings', label: 'Snowball Holdings (Migration)' },
  { value: 'snowball_categories', label: 'Snowball Categories' },
  { value: 'snowball', label: 'Snowball Transactions' },
]

export const POSITIONS_FORMATS = new Set([
  'schwab',
  'schwab_all_accounts',
  'etrade',
  'fidelity',
  'fidelity_all_accounts',
  'robinhood',
  'shear_group',
  'shear_group_all_accounts',
  'interactive_brokers',
  'snowball_holdings',
])

export const TRANSACTION_FORMATS = new Set([
  'generic_transactions',
  'snowball',
  'schwab_transactions',
  'etrade_transactions',
  'fidelity_transactions',
  'robinhood_transactions',
  'shear_group_activity',
  'shear_group_all_accounts_activity',
  'interactive_brokers_transactions',
])

export const MULTI_ACCOUNT_FORMATS = new Set([
  'schwab_all_accounts',
  'fidelity_all_accounts',
  'shear_group_all_accounts',
  'shear_group_all_accounts_activity',
])

export const SNOWBALL_FORMATS = new Set([
  'snowball_holdings',
  'snowball_categories',
  'snowball',
])

export const IMPORT_STEPS = [
  {
    id: 'positions',
    kicker: 'Step 1',
    label: 'Positions',
    detail: 'Current shares and cost basis for this account',
  },
  {
    id: 'transactions',
    kicker: 'Step 2',
    label: 'Transactions',
    detail: 'Dividends, DRIP, and lots — after positions',
  },
  {
    id: 'refresh',
    kicker: 'Step 3',
    label: 'Refresh',
    detail: 'Optional: update prices and dividend fields',
  },
]

const formatIndex = Object.fromEntries(TXN_FORMATS.map((item) => [item.value, item.label]))

export const formatLabel = (value) => formatIndex[value] || value

// Only Broker Import can be pinned. The generic, app-export and Snowball
// formats each own a tab, so pinning one would send Broker Import elsewhere.
export const isPinnableFormat = (value) => (
  value !== 'generic_transactions'
  && value !== 'portfolio_export'
  && !SNOWBALL_FORMATS.has(value)
  && TXN_FORMATS.some((item) => item.value === value)
)

export function brokerById(brokerId) {
  return IMPORT_BROKERS.find((broker) => broker.id === brokerId) || null
}

export function brokerIdFromSource(source) {
  const normalized = String(source || '').trim().toLowerCase()
  return IMPORT_BROKERS.find((broker) => broker.source === normalized)?.id || ''
}

export function describeWorkflow(format) {
  const value = String(format || '').trim()
  const broker = IMPORT_BROKERS.find((item) => (
    value === item.positionsFormat
    || value === item.positionsMultiFormat
    || value === item.transactionsFormat
    || value === item.transactionsMultiFormat
  ))
  if (broker) {
    const role = value === broker.transactionsFormat || value === broker.transactionsMultiFormat
      ? 'transactions'
      : 'positions'
    return {
      brokerId: broker.id,
      role,
      schwabAllAccounts: value === broker.positionsMultiFormat || value === broker.transactionsMultiFormat,
      kind: role,
    }
  }
  if (SNOWBALL_FORMATS.has(value)) {
    return { brokerId: '', role: 'migration', schwabAllAccounts: false, kind: 'migration' }
  }
  if (value === 'generic_transactions') {
    return { brokerId: '', role: 'transactions', schwabAllAccounts: false, kind: 'generic' }
  }
  if (value === 'portfolio_export') {
    return { brokerId: '', role: 'other', schwabAllAccounts: false, kind: 'other' }
  }
  return { brokerId: '', role: '', schwabAllAccounts: false, kind: '' }
}

export function formatForWorkflow({ brokerId, role, schwabAllAccounts = false } = {}) {
  if (role === 'refresh' || role === 'other' || role === 'migration') return NO_FORMAT
  const broker = brokerById(brokerId)
  if (!broker) return NO_FORMAT
  if (role === 'transactions' && schwabAllAccounts && broker.transactionsMultiFormat) {
    return broker.transactionsMultiFormat
  }
  if (role === 'transactions') return broker.transactionsFormat
  if (role === 'positions' && schwabAllAccounts && broker.positionsMultiFormat) {
    return broker.positionsMultiFormat
  }
  if (role === 'positions') return broker.positionsFormat
  return NO_FORMAT
}

export function formatForAccountSelection({
  brokerSource,
  fallbackFormat = NO_FORMAT,
  isRollup = false,
} = {}) {
  if (isRollup) return NO_FORMAT

  const brokerId = brokerIdFromSource(brokerSource)
  if (brokerId) return formatForWorkflow({ brokerId, role: 'positions' })

  if (!isPinnableFormat(fallbackFormat)) return NO_FORMAT
  const fallbackWorkflow = describeWorkflow(fallbackFormat)
  if (fallbackWorkflow.schwabAllAccounts && fallbackWorkflow.brokerId) {
    return formatForWorkflow({
      brokerId: fallbackWorkflow.brokerId,
      role: fallbackWorkflow.role,
      schwabAllAccounts: false,
    })
  }
  return fallbackFormat
}

export function isRollupImportTarget({ profile, ownerSourceCount = 0, isAggregate = false } = {}) {
  const isOwner = profile?.is_owner ?? Number(profile?.id) === 1
  return isAggregate || (Boolean(isOwner) && ownerSourceCount > 0)
}

export function needsPositionsSnapshotFirst(format) {
  return TRANSACTION_FORMATS.has(String(format || '').trim())
}

export function completedWorkflowSteps(format, { navOnly = false, exportScope = 'both' } = {}) {
  if (navOnly) return []
  const value = String(format || '').trim()
  if (value === 'portfolio_export') {
    // A scoped app-export run only completes the half it actually imported.
    if (exportScope === 'positions') return ['positions']
    if (exportScope === 'transactions') return ['transactions']
    return ['positions', 'transactions']
  }
  const role = describeWorkflow(value).role
  return role === 'positions' || role === 'transactions' ? [role] : []
}

export function nextWorkflowStepAfterImport(currentStep, completedSteps, autoAdvance = false) {
  if (!autoAdvance || !Array.isArray(completedSteps)) return ''
  if (currentStep === 'positions' && completedSteps.includes('positions')) return 'transactions'
  if (currentStep === 'transactions' && completedSteps.includes('transactions')) return 'refresh'
  return ''
}

// "Automatically continue to the next step" is a standing choice: the same
// Positions -> Transactions -> Refresh run happens on every import. It lived
// only in page state, so it was unticked again on each launch and each time
// the Import page was left and reopened.
export const AUTO_ADVANCE_STORAGE_KEY = 'portfolio_importAutoAdvance'

export function readAutoAdvancePreference(storage) {
  try {
    return storage?.getItem(AUTO_ADVANCE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeAutoAdvancePreference(storage, enabled) {
  if (!storage) return false
  try {
    storage.setItem(AUTO_ADVANCE_STORAGE_KEY, enabled ? '1' : '0')
    return true
  } catch {
    // A blocked localStorage only costs the preference, not the import.
    return false
  }
}

export function formatImportDetail(detail = {}) {
  const failed = detail.ok === false ? 'FAILED - ' : ''
  const source = detail.account_label || detail.source_sheet || ''
  const target = detail.profile_name || ''
  const route = source && target && source !== target
    ? `${source} -> ${target}`
    : source || target || 'Import'
  return `  ${failed}${route}: ${detail.message || ''}`
}

// A positions import keeps a holding's existing share count when the file shows
// a large drop that no recorded sale explains. The import names each one it kept;
// these read that list and build the re-send of the same file that takes the
// broker's count instead.
export function preservedQuantityItems(data = {}, fallbackProfileName = '') {
  return (data?.preserved_quantity || []).map((item) => ({
    ...item,
    profile_name: item.profile_name || fallbackProfileName,
  }))
}

// An All-Accounts re-send reuses the routing the first import applied (so an
// account that opened a new portfolio goes back to it instead of opening
// another) and skips every account that is not being corrected.
export function brokerCountRetryFields(items = [], appliedAccountMap = null) {
  const fields = {
    accept_broker_quantity: JSON.stringify(
      items.map(({ profile_id: profileId, ticker }) => ({ profile_id: profileId, ticker })),
    ),
  }
  if (appliedAccountMap) {
    const ids = new Set(items.map((item) => Number(item.profile_id)))
    fields.account_map = JSON.stringify(Object.fromEntries(
      Object.entries(appliedAccountMap).map(([key, pid]) => [
        key,
        ids.has(Number(pid)) ? pid : 'skip',
      ]),
    ))
  }
  return fields
}

export function isPositionsFormat(format) {
  return POSITIONS_FORMATS.has(String(format || '').trim())
}

export function isSnowballFormat(format) {
  return SNOWBALL_FORMATS.has(String(format || '').trim())
}

export function workflowStepForFormat(format, currentStep) {
  if (currentStep === 'refresh') return 'refresh'
  if (isSnowballFormat(format)) return 'migration'
  const role = describeWorkflow(format).role
  if (role === 'positions' || role === 'transactions') return role
  if (role === 'other' || role === 'migration') return currentStep || 'positions'
  return currentStep || 'positions'
}
