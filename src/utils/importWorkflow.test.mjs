import test from 'node:test'
import assert from 'node:assert/strict'

import {
  IMPORT_BROKERS,
  IMPORT_STEPS,
  TXN_FORMATS,
  describeWorkflow,
  formatForWorkflow,
  formatImportDetail,
  brokerIdFromSource,
  completedWorkflowSteps,
  needsPositionsSnapshotFirst,
  isPositionsFormat,
  isSnowballFormat,
  workflowStepForFormat,
  isPinnableFormat,
} from './importWorkflow.js'

test('keeps the 17 brokerage import formats', () => {
  assert.equal(TXN_FORMATS.length, 17)
  assert.deepEqual(TXN_FORMATS.map((item) => item.value), [
    'schwab',
    'schwab_all_accounts',
    'schwab_transactions',
    'etrade',
    'etrade_transactions',
    'fidelity',
    'fidelity_all_accounts',
    'fidelity_transactions',
    'robinhood',
    'robinhood_transactions',
    'shear_group',
    'shear_group_activity',
    'portfolio_export',
    'generic_transactions',
    'snowball_holdings',
    'snowball_categories',
    'snowball',
  ])
})

test('Schwab and Fidelity have All-Accounts positions formats', () => {
  const multi = IMPORT_BROKERS.filter((broker) => broker.positionsMultiFormat)
  assert.deepEqual(multi.map((broker) => broker.id), ['schwab', 'fidelity'])
  assert.equal(formatForWorkflow({
    brokerId: 'etrade',
    role: 'positions',
    schwabAllAccounts: true,
  }), 'etrade')
  assert.equal(formatForWorkflow({
    brokerId: 'shear_group',
    role: 'positions',
    schwabAllAccounts: true,
  }), 'shear_group')
  assert.equal(formatForWorkflow({
    brokerId: 'fidelity',
    role: 'positions',
    schwabAllAccounts: true,
  }), 'fidelity_all_accounts')
})

test('Schwab All-Accounts is a positions format, not transactions', () => {
  assert.deepEqual(describeWorkflow('schwab_all_accounts'), {
    brokerId: 'schwab',
    role: 'positions',
    schwabAllAccounts: true,
    kind: 'positions',
  })
  assert.equal(isPositionsFormat('schwab_all_accounts'), true)
  assert.equal(needsPositionsSnapshotFirst('schwab_all_accounts'), false)
  assert.equal(formatForWorkflow({
    brokerId: 'schwab',
    role: 'transactions',
    schwabAllAccounts: true,
  }), 'schwab_transactions')
})

test('Fidelity All Accounts follows the same positions workflow', () => {
  assert.deepEqual(describeWorkflow('fidelity_all_accounts'), {
    brokerId: 'fidelity',
    role: 'positions',
    schwabAllAccounts: true,
    kind: 'positions',
  })
  assert.equal(isPositionsFormat('fidelity_all_accounts'), true)
  assert.equal(needsPositionsSnapshotFirst('fidelity_all_accounts'), false)
})

test('broker + role resolve to the single-account formats', () => {
  assert.equal(formatForWorkflow({ brokerId: 'schwab', role: 'positions' }), 'schwab')
  assert.equal(formatForWorkflow({
    brokerId: 'schwab',
    role: 'positions',
    schwabAllAccounts: true,
  }), 'schwab_all_accounts')
  assert.equal(formatForWorkflow({ brokerId: 'fidelity', role: 'transactions' }), 'fidelity_transactions')
  assert.equal(formatForWorkflow({ brokerId: 'shear_group', role: 'transactions' }), 'shear_group_activity')
})

test('transaction formats need a positions snapshot first', () => {
  assert.equal(needsPositionsSnapshotFirst('schwab_transactions'), true)
  assert.equal(needsPositionsSnapshotFirst('etrade_transactions'), true)
  assert.equal(needsPositionsSnapshotFirst('shear_group_activity'), true)
  assert.equal(needsPositionsSnapshotFirst('generic_transactions'), true)
  assert.equal(needsPositionsSnapshotFirst('schwab'), false)
  assert.equal(needsPositionsSnapshotFirst('snowball_categories'), false)
})

test('maps a portfolio broker source onto the checklist broker', () => {
  assert.equal(brokerIdFromSource('schwab'), 'schwab')
  assert.equal(brokerIdFromSource('E*TRADE'), '')
  assert.equal(brokerIdFromSource('etrade'), 'etrade')
  assert.equal(brokerIdFromSource(''), '')
  assert.equal(brokerIdFromSource('snowball'), '')
})

test('refresh is a step, not a format', () => {
  assert.equal(workflowStepForFormat('schwab', 'refresh'), 'refresh')
  assert.equal(workflowStepForFormat('schwab_transactions', 'positions'), 'transactions')
})

test('only completed imports advance the checklist', () => {
  assert.deepEqual(completedWorkflowSteps('schwab'), ['positions'])
  assert.deepEqual(completedWorkflowSteps('schwab_transactions'), ['transactions'])
  assert.deepEqual(completedWorkflowSteps('portfolio_export'), ['positions', 'transactions'])
  assert.deepEqual(completedWorkflowSteps('snowball_holdings'), [])
  assert.deepEqual(completedWorkflowSteps('schwab', { navOnly: true }), [])
})

test('formats both multi-account and app-export result details', () => {
  assert.equal(formatImportDetail({
    ok: false,
    account_label: 'Roth ...995',
    profile_name: 'Roth IRA',
    message: 'Account did not match',
  }), '  FAILED - Roth ...995 -> Roth IRA: Account did not match')
  assert.equal(formatImportDetail({
    source_sheet: 'Portfolio Export',
    profile_name: 'Owner',
    message: 'Imported 10 holdings',
  }), '  Portfolio Export -> Owner: Imported 10 holdings')
})

test('Snowball is a migration path, not a checklist step', () => {
  assert.deepEqual(IMPORT_STEPS.map((step) => step.id), ['positions', 'transactions', 'refresh'])
  assert.equal(isSnowballFormat('snowball_categories'), true)
  assert.equal(isSnowballFormat('snowball_holdings'), true)
  assert.equal(isSnowballFormat('snowball'), true)
  assert.equal(isSnowballFormat('schwab'), false)
  assert.deepEqual(describeWorkflow('snowball_categories'), {
    brokerId: '',
    role: 'migration',
    schwabAllAccounts: false,
    kind: 'migration',
  })
  assert.equal(workflowStepForFormat('snowball_categories', 'positions'), 'migration')
  assert.equal(formatForWorkflow({ brokerId: 'schwab', role: 'migration' }), '')
})

test('generic transactions cannot be pinned as the brokerage default', () => {
  assert.equal(isPinnableFormat('generic_transactions'), false)
  assert.equal(isPinnableFormat('snowball_holdings'), false)
  assert.equal(isPinnableFormat('schwab'), true)
})
