/** Leave the reader usable while the list is resized or the window gets narrower. */
export function getMailListWidthBounds(workspaceWidth: number, classic: boolean) {
  const min = 300
  const readerAndGutter = classic ? 360 : 376
  const max = Math.max(min, Math.min(600, Math.floor(workspaceWidth - readerAndGutter)))
  return { min, max }
}

export function clampMailListWidth(value: number, workspaceWidth: number, classic: boolean) {
  const { min, max } = getMailListWidthBounds(workspaceWidth, classic)
  return Math.round(Math.max(min, Math.min(value, max)))
}
