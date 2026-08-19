import test from 'node:test'
import assert from 'node:assert/strict'
import { areMutualFollowers, isEntryVisible } from '../api/visibility.js'

test('owners can always view their own entries', () => {
  assert.equal(isEntryVisible({ viewerId: 'a', ownerId: 'a', visibility: 'private', blocked: true }), true)
})

test('a block prevents access regardless of entry visibility', () => {
  assert.equal(isEntryVisible({ viewerId: 'a', ownerId: 'b', visibility: 'public', blocked: true }), false)
})

test('followers-only entries require an outgoing accepted follow', () => {
  assert.equal(isEntryVisible({ viewerId: 'a', ownerId: 'b', visibility: 'followers', followsOwner: true }), true)
  assert.equal(isEntryVisible({ viewerId: 'a', ownerId: 'b', visibility: 'followers', ownerFollowsViewer: true }), false)
})

test('friends-only entries require a mutual, unblocked relationship', () => {
  assert.equal(isEntryVisible({ viewerId: 'a', ownerId: 'b', visibility: 'friends', followsOwner: true, ownerFollowsViewer: true }), true)
  assert.equal(isEntryVisible({ viewerId: 'a', ownerId: 'b', visibility: 'friends', followsOwner: true }), false)
  assert.equal(areMutualFollowers({ firstFollowsSecond: true, secondFollowsFirst: true }), true)
  assert.equal(areMutualFollowers({ blocked: true, firstFollowsSecond: true, secondFollowsFirst: true }), false)
})
