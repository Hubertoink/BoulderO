export function dialogViewportHeight(visualViewportHeight, layoutViewportHeight) {
  const visualHeight = Number.isFinite(visualViewportHeight) && visualViewportHeight > 0 ? visualViewportHeight : 0
  const layoutHeight = Number.isFinite(layoutViewportHeight) && layoutViewportHeight > 0 ? layoutViewportHeight : 0
  if (!visualHeight) return layoutHeight

  // Edge for Android can reserve only its bottom browser controls from the
  // visual viewport while the keyboard is open. Use that small difference so
  // a bottom sheet reaches the browser edge; retain the visual viewport when
  // a browser leaves the full layout viewport behind the keyboard.
  const browserControlsHeight = layoutHeight - visualHeight
  return browserControlsHeight > 0 && browserControlsHeight <= 120 ? layoutHeight : visualHeight
}
