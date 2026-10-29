/** Resolve the active modal by stacking contexts, then document order. */
export function isTopModal(dialog: HTMLElement): boolean {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"]'))
    .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
  const layer = (element: HTMLElement) => {
    const indices: number[] = []
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      const value = Number.parseInt(getComputedStyle(parent).zIndex, 10)
      if (Number.isFinite(value)) indices.unshift(value)
    }
    return indices
  }
  let top: HTMLElement | undefined
  let topLayer: number[] = []
  for (const candidate of dialogs) {
    const candidateLayer = layer(candidate)
    let difference = 0
    for (let index = 0; index < Math.max(topLayer.length, candidateLayer.length); index++) {
      difference = (candidateLayer[index] || 0) - (topLayer[index] || 0)
      if (difference) break
    }
    if (!top || difference > 0 || (difference === 0 && !!(top.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING))) {
      top = candidate
      topLayer = candidateLayer
    }
  }
  return top === dialog
}

/** Restore a trigger only when another modal does not currently own focus. */
export function restoreModalFocus(previous: HTMLElement | null): void {
  if (!previous?.isConnected) return
  const previousModal = previous.closest<HTMLElement>('[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"]')
  if (previousModal && isTopModal(previousModal)) previous.focus()
  else if (!Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"]'))
    .some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')) previous.focus()
}
