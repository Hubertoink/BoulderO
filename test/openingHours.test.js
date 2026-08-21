import test from 'node:test'
import assert from 'node:assert/strict'
import { formatOpeningHours } from '../src/shared/openingHours.js'

test('groups consecutive weekdays with identical opening hours', () => {
  assert.equal(
    formatOpeningHours('Mo 10-22:30; Di 10-22:30; Mi 10-22:30; Do 10-22:30; Fr 10-22:30; Sa 10-21; So 10-21'),
    'Mo–Fr 10:00–22:30 · Sa–So 10:00–21:00',
  )
})

test('keeps differing weekdays separate and supports German weekday names', () => {
  assert.equal(
    formatOpeningHours('Montag 14-22; Dienstag 10-22; Mittwoch 14-22; Donnerstag 10-22; Freitag 10-22; Samstag 11-20; Sonntag 11-20'),
    'Mo 14:00–22:00 · Di 10:00–22:00 · Mi 14:00–22:00 · Do–Fr 10:00–22:00 · Sa–So 11:00–20:00',
  )
})

test('leaves unrecognised or already condensed opening hours intact', () => {
  assert.equal(formatOpeningHours('Mo–Fr 10:00–22:00'), 'Mo–Fr 10:00–22:00')
  assert.equal(formatOpeningHours('07:00–23:00'), '07:00–23:00')
})
