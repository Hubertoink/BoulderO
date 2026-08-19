export function isEntryVisible({ viewerId, ownerId, visibility, blocked = false, followsOwner = false, ownerFollowsViewer = false }) {
  if (viewerId === ownerId) return true
  if (blocked) return false
  if (visibility === 'public') return true
  if (visibility === 'followers') return followsOwner
  return visibility === 'friends' && followsOwner && ownerFollowsViewer
}

export function areMutualFollowers({ blocked = false, firstFollowsSecond = false, secondFollowsFirst = false }) {
  return !blocked && firstFollowsSecond && secondFollowsFirst
}
