import assert from 'node:assert/strict'
import test from 'node:test'
import { compareSortValues, nextLotSort, sortByValue, sortLotRows } from './lotTableSort.js'

const lots = [
  { id: 1, transaction_date: '2024-03-01', shares: 10, gain_loss: 250.5, notes: 'b lot' },
  { id: 2, transaction_date: '2022-03-29', shares: 2.5, gain_loss: -11.84, notes: 'A lot' },
  { id: 3, transaction_date: '2023-11-15', shares: 100, gain_loss: 147.71, notes: '' },
]
const columns = [
  { key: 'transaction_date', type: 'date' },
  { key: 'shares', type: 'number' },
  { key: 'gain_loss', type: 'number' },
  { key: 'notes', type: 'string' },
  { key: 'label', type: 'string', value: row => `lot ${row.id}` },
]
const ids = rows => rows.map(row => row.id)

test('no sort leaves the lots in ledger order', () => {
  assert.equal(sortLotRows(lots, null, columns), lots)
  assert.equal(sortLotRows(lots, { key: 'unknown', direction: 'asc' }, columns), lots)
})

test('numbers sort by value, not as text', () => {
  assert.deepEqual(ids(sortLotRows(lots, { key: 'shares', direction: 'asc' }, columns)), [2, 1, 3])
  assert.deepEqual(ids(sortLotRows(lots, { key: 'gain_loss', direction: 'desc' }, columns)), [1, 3, 2])
})

test('dates sort chronologically in both directions', () => {
  assert.deepEqual(ids(sortLotRows(lots, { key: 'transaction_date', direction: 'asc' }, columns)), [2, 3, 1])
  assert.deepEqual(ids(sortLotRows(lots, { key: 'transaction_date', direction: 'desc' }, columns)), [1, 3, 2])
})

test('a blank value stays last whichever way the column is sorted', () => {
  assert.deepEqual(ids(sortLotRows(lots, { key: 'notes', direction: 'asc' }, columns)), [2, 1, 3])
  assert.deepEqual(ids(sortLotRows(lots, { key: 'notes', direction: 'desc' }, columns)), [1, 2, 3])
})

test('a column can sort on a derived value', () => {
  assert.deepEqual(ids(sortLotRows(lots, { key: 'label', direction: 'desc' }, columns)), [3, 2, 1])
})

test('ties keep their incoming order and the input is not mutated', () => {
  const tied = [{ id: 1, v: 5 }, { id: 2, v: 5 }, { id: 3, v: 1 }]
  const sorted = sortByValue(tied, { valueOf: row => row.v, type: 'number', direction: 'desc' })
  assert.deepEqual(ids(sorted), [1, 2, 3])
  assert.deepEqual(ids(tied), [1, 2, 3])
})

test('untyped values compare numerically only when both are numbers', () => {
  const mixed = [{ id: 1, v: 9 }, { id: 2, v: null }, { id: 3, v: 100 }, { id: 4, v: 25 }]
  assert.deepEqual(ids(sortByValue(mixed, { valueOf: row => row.v, direction: 'asc' })), [1, 4, 3, 2])
  assert.deepEqual(ids(sortByValue(mixed, { valueOf: row => row.v, direction: 'desc' })), [3, 4, 1, 2])
  assert.ok(compareSortValues('2024-01-02', '2024-01-10') < 0)
})

test('clicking a column sorts ascending first, then flips', () => {
  const first = nextLotSort(null, 'shares')
  assert.deepEqual(first, { key: 'shares', direction: 'asc' })
  assert.deepEqual(nextLotSort(first, 'shares'), { key: 'shares', direction: 'desc' })
  assert.deepEqual(nextLotSort(nextLotSort(first, 'shares'), 'shares'), { key: 'shares', direction: 'asc' })
  assert.deepEqual(nextLotSort(first, 'notes'), { key: 'notes', direction: 'asc' })
})
