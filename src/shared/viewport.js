export function dialogViewportHeight(visualViewportHeight, layoutViewportHeight) {
  const visualHeight = Number.isFinite(visualViewportHeight) && visualViewportHeight > 0 ? visualViewportHeight : 0
  const layoutHeight = Number.isFinite(layoutViewportHeight) && layoutViewportHeight > 0 ? layoutViewportHeight : 0
  // Browser controls and an on-screen keyboard can both cover the layout
  // viewport. The visual viewport is the only area the user can actually see,
  // so dialogs must stop at its edge instead of extending behind those controls.
  return visualHeight || layoutHeight
}
