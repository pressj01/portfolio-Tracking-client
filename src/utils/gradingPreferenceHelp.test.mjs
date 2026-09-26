import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_GRADING_PREFERENCES } from './gradingPreferences.js'
import { GRADING_PREFERENCE_HELP, gradingPreferenceHelp } from './gradingPreferenceHelp.js'

function leafPaths(value, prefix = []) {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = [...prefix, key]
    return child && typeof child === 'object' ? leafPaths(child, path) : [path.join('.')]
  })
}

test('every grading formula input has one matching help entry', () => {
  assert.deepEqual(
    leafPaths(GRADING_PREFERENCE_HELP).sort(),
    leafPaths(DEFAULT_GRADING_PREFERENCES).sort(),
  )
})

test('formula help is detailed and retrievable by preference path', () => {
  for (const path of leafPaths(DEFAULT_GRADING_PREFERENCES)) {
    const help = gradingPreferenceHelp(...path.split('.'))
    assert.equal(typeof help, 'string', `${path} help should be text`)
    assert.ok(help.length >= 140, `${path} help is too brief`)
  }
})
