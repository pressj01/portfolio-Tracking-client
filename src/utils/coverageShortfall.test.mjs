import test from 'node:test'
import assert from 'node:assert/strict'

import {
  coverageSeverity,
  isCoverageMaterial,
  isCoverageSevere,
  formatCoverageShortfall,
  formatCoveragePartialTag,
} from './performancePeriods.js'

// The screens react to the backend's grade rather than re-deriving one, so
// these lock the reading of that grade, not the threshold behind it.
const metrics = (shortfall) => ({ coverage_shortfall: shortfall })

test('no shortfall payload reads as full coverage', () => {
  assert.equal(coverageSeverity(undefined), 'none')
  assert.equal(coverageSeverity({}), 'none')
  assert.equal(isCoverageMaterial(metrics(null)), false)
  assert.equal(formatCoverageShortfall(metrics(null)), '')
})

test('an immaterial gap never raises a warning', () => {
  const immaterial = metrics({
    is_material: false,
    severity: 'none',
    excluded_weight: 0.004,
    excluded_positions: 1,
    excluded_value: 500,
    covered_value: 1000000,
  })

  assert.equal(isCoverageMaterial(immaterial), false)
  assert.equal(formatCoverageShortfall(immaterial), '')
  assert.equal(formatCoveragePartialTag(immaterial), '')
})

test('a material gap warns but still leads with the figure', () => {
  const material = metrics({
    is_material: true,
    severity: 'material',
    excluded_weight: 0.06,
    excluded_positions: 3,
    excluded_value: 60000,
    covered_value: 940000,
  })

  assert.equal(coverageSeverity(material), 'material')
  assert.equal(isCoverageMaterial(material), true)
  assert.equal(isCoverageSevere(material), false)

  const warning = formatCoverageShortfall(material)
  // Under 10% keeps a decimal, so a 2% shortfall cannot round down to 0%.
  assert.match(warning, /6\.0% of this portfolio/)
  assert.match(warning, /3 positions worth \$60,000 left out/)
  assert.match(warning, /leaving \$940,000 measured/)
  assert.match(warning, /partial reading/)
})

test('a severe gap demotes the figure out of the headline', () => {
  // The shape of the reported bug: a $5.66M book measured on $5,963.
  const severe = metrics({
    is_material: true,
    severity: 'severe',
    excluded_weight: 0.998947,
    excluded_positions: 264,
    excluded_value: 5655391,
    covered_value: 5963,
  })

  assert.equal(coverageSeverity(severe), 'severe')
  assert.equal(isCoverageSevere(severe), true)

  const warning = formatCoverageShortfall(severe)
  assert.match(warning, />99% of this portfolio/)
  assert.match(warning, /264 positions/)
  assert.match(warning, /not this account's return|partial reading/i)

  assert.match(formatCoveragePartialTag(severe), /Partial/)
})

test('a single excluded position is described in the singular', () => {
  const single = metrics({
    is_material: true,
    severity: 'material',
    excluded_weight: 0.15,
    excluded_positions: 1,
    excluded_value: 15000,
    covered_value: 85000,
  })

  assert.match(formatCoverageShortfall(single), /1 position worth/)
  assert.doesNotMatch(formatCoverageShortfall(single), /1 positions/)
})

test('small material weights keep a decimal so 2% does not read as 0%', () => {
  const small = metrics({
    is_material: true,
    severity: 'material',
    excluded_weight: 0.023,
    excluded_positions: 2,
    excluded_value: 2300,
    covered_value: 97700,
  })

  assert.match(formatCoverageShortfall(small), /2\.3% of this portfolio/)
})
