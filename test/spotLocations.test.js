import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSpotLocations, matchingSpotLocations } from '../src/shared/spotLocations.ts'

const spots = [
  { id: 'stuttgart-north', district: '70174 Stuttgart', address: 'Nordstraße 1', position: [48.79, 9.18] },
  { id: 'stuttgart-south', district: 'Stuttgart', address: 'Südstraße 2, Stuttgart', position: [48.75, 9.16] },
  { id: 'hameln', district: '31785 Hameln', address: 'Weserstraße 3, Hameln', position: [52.10, 9.36] },
  { id: 'mannheim-demo', district: 'Jungbusch', address: 'Hafenstraße 18, Mannheim', position: [49.49, 8.45] },
]

test('groups hall locations and keeps their exact spot ids', () => {
  const locations = buildSpotLocations(spots)
  const stuttgart = locations.find((location) => location.name === 'Stuttgart')

  assert.deepEqual(stuttgart?.spotIds, ['stuttgart-north', 'stuttgart-south'])
  assert.ok(Math.abs(stuttgart.position[0] - 48.77) < 0.000001)
  assert.ok(Math.abs(stuttgart.position[1] - 9.17) < 0.000001)
})

test('uses a city from the address as a location alias for legacy spots', () => {
  const locations = buildSpotLocations(spots)
  assert.deepEqual(locations.find((location) => location.name === 'Mannheim')?.spotIds, ['mannheim-demo'])
})

test('only suggests locations represented by halls', () => {
  const locations = buildSpotLocations(spots)

  assert.equal(matchingSpotLocations(locations, 'Stutt').at(0)?.name, 'Stuttgart')
  assert.deepEqual(matchingSpotLocations(locations, 'Amsterdam'), [])
})
