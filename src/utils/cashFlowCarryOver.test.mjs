import test from 'node:test'
import assert from 'node:assert/strict'

import {
  carryOverNote,
  copyChangeNote,
  readCarrySelection,
  rememberCarrySelection,
  seedCarrySelections,
} from './cashFlowCarryOver.js'

function useFakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  globalThis.window = {
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
  }
}

const target = (profile_id, state = 'open') => ({ profile_id, name: `P${profile_id}`, state })

test('a remembered choice comes back for the same portfolio only', () => {
  useFakeStorage()
  rememberCarrySelection(2, [3, 4])
  const targets = [target(3), target(4), target(5)]
  assert.deepEqual(readCarrySelection(2, targets), [3, 4])
  assert.deepEqual(readCarrySelection(5, targets), [])
})

test('a portfolio that can no longer take a copy is not ticked', () => {
  useFakeStorage()
  rememberCarrySelection(2, [3, 4, 5, 6])
  // 3 now shares the plan, 4 follows another plan, 5 is no longer listed at all
  // because it was marked Test / non-owned, and 6 is still fine.
  const targets = [target(3, 'shared'), target(4, 'borrowed'), target(6)]
  assert.deepEqual(readCarrySelection(2, targets), [6])
})

test('the first add sets up the other portfolios in the group', () => {
  useFakeStorage()
  seedCarrySelections(1, [2, 3])
  assert.deepEqual(readCarrySelection(2, [target(1), target(3), target(9)]), [1, 3])
  assert.deepEqual(readCarrySelection(3, [target(1), target(2), target(9)]), [1, 2])
  assert.deepEqual(readCarrySelection(9, [target(1), target(2), target(3)]), [])
})

test('seeding never overrides a choice already made, including none', () => {
  useFakeStorage()
  rememberCarrySelection(2, [])
  rememberCarrySelection(3, [4])
  seedCarrySelections(1, [2, 3])
  const targets = [target(1), target(2), target(3), target(4)]
  assert.deepEqual(readCarrySelection(2, targets), [])
  assert.deepEqual(readCarrySelection(3, targets), [4])
})

test('unreadable or blocked storage just means nothing is ticked', () => {
  useFakeStorage({ cash_flow_carry_to_v1: '{not json' })
  assert.deepEqual(readCarrySelection(1, [target(2)]), [])
  useFakeStorage({ cash_flow_carry_to_v1: '[1,2]' })
  assert.deepEqual(readCarrySelection(1, [target(2)]), [])
  globalThis.window = {
    localStorage: {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    },
  }
  assert.deepEqual(readCarrySelection(1, [target(2)]), [])
  assert.doesNotThrow(() => rememberCarrySelection(1, [2]))
})

test('the note says what happened in each portfolio', () => {
  assert.equal(
    carryOverNote([
      { name: 'IRA', status: 'added' },
      { name: 'Roth IRA', status: 'added' },
      { name: 'Joint', status: 'added' },
    ]),
    'Also added to IRA, Roth IRA, and Joint.',
  )
  assert.equal(
    carryOverNote([
      { name: 'IRA', status: 'added' },
      { name: 'Roth IRA', status: 'duplicate' },
      { name: 'Trust', status: 'not_owned' },
    ]),
    'Also added to IRA. Already in Roth IRA, so it was not added again. '
      + 'Not added to Trust: expenses only carry to your own portfolios that keep their own entries.',
  )
  assert.equal(carryOverNote([]), '')
  assert.equal(carryOverNote(), '')
})

test('a change to linked copies reports each one by name', () => {
  const adam = { id: 2, name: 'Adam' }
  const kayden = { id: 3, name: 'Kayden' }
  assert.equal(
    copyChangeNote('updated in', [adam, kayden], [adam, kayden]),
    'Also updated in Adam and Kayden.',
  )
  assert.equal(
    copyChangeNote('deleted from', [adam, kayden], [adam]),
    'Also deleted from Adam. Not changed in Kayden: changes only reach your own portfolios that keep their own entries.',
  )
})

test('saving without changing anything has nothing to report', () => {
  const adam = { id: 2, name: 'Adam' }
  assert.equal(copyChangeNote('updated in', [adam], [], false), '')
  assert.equal(copyChangeNote('updated in', [], []), '')
})
