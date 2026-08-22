import test from 'node:test'
import assert from 'node:assert/strict'
import { dialogViewportHeight } from '../src/shared/viewport.js'

test('fills a small Android browser-controls inset below a dialog', () => {
  assert.equal(dialogViewportHeight(640, 704), 704)
})

test('does not extend a dialog behind an overlaid keyboard', () => {
  assert.equal(dialogViewportHeight(460, 844), 460)
})

test('uses the visual viewport when both viewport measurements agree', () => {
  assert.equal(dialogViewportHeight(640, 640), 640)
})
