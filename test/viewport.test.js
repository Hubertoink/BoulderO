import test from 'node:test'
import assert from 'node:assert/strict'
import { dialogViewportHeight, visualViewportBottomOffset } from '../src/shared/viewport.js'

test('fills a small Android browser-controls inset below a dialog', () => {
  assert.equal(dialogViewportHeight(640, 704), 704)
})

test('does not extend a dialog behind an overlaid keyboard', () => {
  assert.equal(dialogViewportHeight(460, 844), 460)
})

test('uses the visual viewport when both viewport measurements agree', () => {
  assert.equal(dialogViewportHeight(640, 640), 640)
})

test('moves a fixed bottom bar into a visible Android browser-controls inset', () => {
  assert.equal(visualViewportBottomOffset(704, 640, 0), 64)
})

test('moves a fixed bottom bar above an overlaid keyboard', () => {
  assert.equal(visualViewportBottomOffset(460, 844, 0), -384)
})

test('includes visual viewport scrolling when device-fixing a bottom bar', () => {
  assert.equal(visualViewportBottomOffset(640, 704, 96), 32)
})
