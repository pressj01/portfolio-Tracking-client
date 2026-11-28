import test from 'node:test'
import assert from 'node:assert/strict'
import { groupModelsByAccount, modelHoldingCount, modelOptionLabel } from './builderModels.js'

const model = (id, profileId, accountName, current = false, extra = {}) => ({
  id, name: `Model ${id}`, profile_id: profileId, account_name: accountName,
  current_account: current, holding_count: 2, total_value: 1500, ...extra,
})

test('models group under the account each is saved in, in the order listed', () => {
  const groups = groupModelsByAccount([
    model(1, 1, 'Owner', true),
    model(2, 1, 'Owner', true),
    model(3, 21, 'Adam'),
    model(4, 6, 'Pressj04'),
    model(5, 21, 'Adam'),
  ])
  assert.deepEqual(groups.map(g => g.accountName), ['Owner', 'Adam', 'Pressj04'])
  assert.deepEqual(groups.map(g => g.models.map(m => m.id)), [[1, 2], [3, 5], [4]])
  assert.equal(groups[0].current, true)
  assert.equal(groups[1].current, false)
})

test('a list from an older backend without account fields stays one group', () => {
  const groups = groupModelsByAccount([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].accountName, 'Unknown account')
  assert.deepEqual(groupModelsByAccount(null), [])
})

test('option labels name the holdings count and value', () => {
  assert.equal(modelHoldingCount({ holding_count: 1 }), '1 holding')
  assert.equal(modelHoldingCount({}), '0 holdings')
  const label = modelOptionLabel(model(7, 1, 'Owner', true))
  assert.match(label, /^Model 7 · 2 holdings · /)
  assert.match(label, /1,500/)
})
