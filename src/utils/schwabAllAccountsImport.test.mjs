import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applySchwabDestSelection,
  assignFileAccountToProfile,
  defaultSchwabDestSelection,
  fileAccountForProfile,
  leftoverFileAccounts,
  mergeSchwabDestSelection,
  shouldAutodetectSchwabAllAccounts,
  schwabImportDestinations,
} from './schwabAllAccountsImport.js'

const profiles = [
  { id: 1, name: 'Owner', broker_source: 'schwab' },
  { id: 2, name: 'Roth IRA', broker_source: 'schwab' },
  { id: 3, name: 'IRA', broker_source: 'schwab' },
  { id: 4, name: 'Individual', broker_source: 'schwab' },
  { id: 5, name: 'Jim Fidelity', broker_source: 'fidelity' },
  { id: 6, name: 'Untagged', broker_source: '' },
]

test('does not override the single-account Schwab format for an All-Accounts filename', () => {
  const name = 'All-Accounts-Positions-2026-08-21-141808.csv'
  assert.equal(shouldAutodetectSchwabAllAccounts(name, 'schwab'), false)
  assert.equal(shouldAutodetectSchwabAllAccounts(name, ''), true)
  assert.equal(shouldAutodetectSchwabAllAccounts(name, 'etrade'), true)
})

test('lists Schwab portfolios, not other brokers, untagged accounts, or Owner rollup', () => {
  const destinations = schwabImportDestinations(profiles)
  assert.deepEqual(destinations.map(p => p.name), ['Roth IRA', 'IRA', 'Individual'])
})

test('falls back to untagged portfolios when none are tagged Schwab', () => {
  const destinations = schwabImportDestinations([
    { id: 1, name: 'Owner', broker_source: '' },
    { id: 2, name: 'Roth', broker_source: '' },
    { id: 5, name: 'Jim Fidelity', broker_source: 'fidelity' },
  ])
  assert.deepEqual(destinations.map(p => p.name), ['Roth'])
})

test('keeps Owner when it is the only Schwab-eligible portfolio', () => {
  const destinations = schwabImportDestinations([
    { id: 1, name: 'Owner', broker_source: 'schwab' },
    { id: 5, name: 'Jim Fidelity', broker_source: 'fidelity' },
  ])
  assert.deepEqual(destinations.map(p => p.name), ['Owner'])
})

test('defaults to selecting the listed Schwab destinations', () => {
  const destinations = schwabImportDestinations(profiles)
  assert.deepEqual(defaultSchwabDestSelection(destinations), {
    2: true,
    3: true,
    4: true,
  })
})

test('selects every eligible destination when none are tagged Schwab', () => {
  const destinations = schwabImportDestinations([
    { id: 2, name: 'Roth', broker_source: '' },
    { id: 3, name: 'IRA', broker_source: '' },
  ])
  assert.deepEqual(defaultSchwabDestSelection(destinations), { 2: true, 3: true })
})

test('merge keeps existing checks and defaults new Schwab destinations on', () => {
  const merged = mergeSchwabDestSelection({ 2: false }, [
    { id: 2, name: 'Roth IRA', broker_source: 'schwab' },
    { id: 3, name: 'IRA', broker_source: 'schwab' },
    { id: 6, name: 'Untagged', broker_source: '' },
  ])
  assert.equal(merged[2], false)
  assert.equal(merged[3], true)
  assert.equal(merged[6], false)
})

test('maps suggested file accounts only onto selected destinations', () => {
  const accounts = [
    { account_key: 'num:995', suggested_profile_id: 2 },
    { account_key: 'num:426', suggested_profile_id: 3 },
    { account_key: 'num:730', suggested_profile_id: 4 },
  ]
  const mapped = applySchwabDestSelection(
    { 2: true, 3: false, 4: true },
    accounts,
    {},
  )
  assert.deepEqual(mapped, {
    'num:995': '2',
    'num:426': '',
    'num:730': '4',
  })
})

test('unchecking a destination unmaps its file account and leaves new-portfolio picks', () => {
  const accounts = [
    { account_key: 'num:995', suggested_profile_id: 2 },
    { account_key: 'num:777', suggested_profile_id: null },
  ]
  const mapped = applySchwabDestSelection(
    { 2: false },
    accounts,
    { 'num:995': '2', 'num:777': 'new' },
  )
  assert.equal(mapped['num:995'], '')
  assert.equal(mapped['num:777'], 'new')
})

test('assigning a file account to a destination steals it from the previous destination', () => {
  const next = assignFileAccountToProfile(
    { 'num:995': '2', 'num:426': '3' },
    'num:426',
    2,
  )
  assert.deepEqual(next, {
    'num:995': '',
    'num:426': '2',
  })
})

test('finds the file account mapped to a destination and leftover unmapped accounts', () => {
  const accounts = [
    { account_key: 'num:995', account_label: 'Roth_IRA ...995' },
    { account_key: 'num:426', account_label: 'Standard_IRA ...426' },
    { account_key: 'num:777', account_label: 'Beach House ...777' },
  ]
  const accountMap = { 'num:995': '2', 'num:426': '', 'num:777': 'new' }
  assert.equal(fileAccountForProfile(accounts, accountMap, 2).account_key, 'num:995')
  assert.deepEqual(
    leftoverFileAccounts(accounts, accountMap).map(a => a.account_key),
    ['num:426', 'num:777'],
  )
})
