import test from 'node:test'
import assert from 'node:assert/strict'
import { formatSpotArea, spotAreaSquareMeters } from '../src/shared/spotArea.ts'

test('keeps arbitrary hall size descriptions for display', () => {
  assert.equal(formatSpotArea('2.000 m²'), '2.000 m²')
  assert.equal(formatSpotArea('50 Boulder'), '50 Boulder')
  assert.equal(formatSpotArea('mehrere Räume'), 'mehrere Räume')
})

test('uses only explicit square metre information for area filters', () => {
  assert.equal(spotAreaSquareMeters('2.000 m²'), 2000)
  assert.equal(spotAreaSquareMeters('850 qm'), 850)
  assert.equal(spotAreaSquareMeters('50 Boulder'), null)
  assert.equal(spotAreaSquareMeters('mehrere Wände'), null)
})
