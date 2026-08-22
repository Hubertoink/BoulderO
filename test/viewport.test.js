import test from 'node:test'
import assert from 'node:assert/strict'
import { dialogViewportHeight } from '../src/shared/viewport.js'

test('stops above Android browser controls', () => {
  assert.equal(dialogViewportHeight(639, 704), 639)
})

test('does not extend a dialog behind an overlaid keyboard', () => {
  assert.equal(dialogViewportHeight(460, 844), 460)
})

test('uses the visual viewport when both viewport measurements agree', () => {
  assert.equal(dialogViewportHeight(640, 640), 640)
})

test('falls back to the layout viewport without a visual viewport', () => {
  assert.equal(dialogViewportHeight(undefined, 704), 704)
})
