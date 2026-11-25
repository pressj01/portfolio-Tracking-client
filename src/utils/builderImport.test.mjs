import test from 'node:test'
import assert from 'node:assert/strict'
import { describeImport, suggestImportName } from './builderImport.js'

const money = v => `$${Number(v).toFixed(2)}`

test('an unused name is kept as the file gave it', () => {
  assert.equal(suggestImportName('Income Model', ['Growth']), 'Income Model')
})

test('a taken name gets an (imported) suffix, without regard to case', () => {
  assert.equal(suggestImportName('Income Model', ['income model']), 'Income Model (imported)')
  assert.equal(
    suggestImportName('Income Model', ['Income Model', 'Income Model (imported)']),
    'Income Model (imported 2)',
  )
})

test('a file with no name still gets one', () => {
  assert.equal(suggestImportName('  ', []), 'Imported portfolio')
  assert.equal(suggestImportName(null), 'Imported portfolio')
})

test('the prompt lists the holdings, the settings, and asks for a name', () => {
  const text = describeImport({
    holdings: [{ ticker: 'AAA', dollar_amount: 1200 }, { ticker: 'BBB', dollar_amount: 1800 }],
    total: 3000,
    starting_balance: 5000,
    target_monthly_income: 35,
    max_weight_pct: 40,
    currency: 'USD',
    has_settings: true,
    skipped: [],
    warnings: [],
  }, 'model.xlsx', money)
  assert.match(text, /^model\.xlsx: 2 holdings, \$3000\.00 in all\./)
  assert.match(text, /starting balance \$5000\.00, target income \$35\.00 a month, max 40% per holding/)
  assert.doesNotMatch(text, /CSV/)
  assert.match(text, /\nName for the new model portfolio:$/)
})

test('a CSV says it brings holdings only; a conversion and skipped rows are named', () => {
  const text = describeImport({
    holdings: [{ ticker: 'AAA', dollar_amount: 100 }],
    total: 100,
    currency: 'CAD',
    rate: 1.37,
    rate_source: 'current',
    has_settings: false,
    skipped: Array.from({ length: 8 }, (_, i) => ({ ticker: `X${i}`, reason: 'has no amount above zero' })),
    warnings: [],
  }, 'model.csv', money)
  assert.match(text, /1 holding, \$100\.00/)
  assert.match(text, /CSV carries the holdings only/)
  assert.match(text, /in CAD, read back to US dollars at today's rate \(1\.37\)/)
  assert.match(text, /Left out 8 rows: X0 has no amount above zero;.*; and 2 more\./)
})
