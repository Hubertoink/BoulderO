import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesSpotSearch, spotSearchLocation, spotSearchMeta } from '../src/shared/spotSearch.js'

const svn = { name: 'SVN e.V. München', district: '81737 München', address: 'Fritz-Erler-Straße 3' }

test('city searches ignore whitespace, accents, and a leading postal code', () => {
  assert.equal(matchesSpotSearch(svn, 'München'), true)
  assert.equal(matchesSpotSearch(svn, 'Munchen '), true)
})

test('search results show the city without a leading postal code', () => {
  assert.equal(spotSearchLocation(svn), 'München')
  assert.equal(spotSearchMeta(svn), 'München')
})
