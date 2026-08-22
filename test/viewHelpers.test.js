import test from 'node:test'
import assert from 'node:assert/strict'
import { formatPlanDateRange, formatVisitTimeRange, timeInputValue } from '../src/shared/viewHelpers.ts'

test('normalizes database times for time inputs', () => {
  assert.equal(timeInputValue('18:05:00'), '18:05')
  assert.equal(timeInputValue(null), '')
})

test('formats visit time ranges for journal and feed', () => {
  assert.equal(formatVisitTimeRange('18:05:00', '20:30:00'), '18:05–20:30 Uhr')
  assert.equal(formatVisitTimeRange('18:05:00', null), '18:05 Uhr')
  assert.equal(formatVisitTimeRange(null, null), '')
})

test('includes the end time in planned visit ranges', () => {
  const start = new Date(2026, 7, 22, 18, 0)
  const end = new Date(2026, 7, 22, 20, 30)
  assert.match(formatPlanDateRange(start, end), /18:00–20:30 Uhr$/)
})
