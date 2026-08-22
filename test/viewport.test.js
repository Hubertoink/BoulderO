import test from 'node:test'
import assert from 'node:assert/strict'
import { dialogViewportHeight, keyboardViewportOpen } from '../src/shared/viewport.js'

test('fills a small Android browser-controls inset below a dialog', () => {
  assert.equal(dialogViewportHeight(640, 704), 704)
})

test('does not extend a dialog behind an overlaid keyboard', () => {
  assert.equal(dialogViewportHeight(460, 844), 460)
})

test('uses the visual viewport when both viewport measurements agree', () => {
  assert.equal(dialogViewportHeight(640, 640), 640)
})

test('detects a keyboard only for a focused text entry and a large viewport reduction', () => {
  assert.equal(keyboardViewportOpen(460, 844, true), true)
  assert.equal(keyboardViewportOpen(460, 844, false), false)
})

test('does not mistake Android browser controls for the keyboard', () => {
  assert.equal(keyboardViewportOpen(780, 844, true), false)
  assert.equal(keyboardViewportOpen(844, 844, true), false)
})
