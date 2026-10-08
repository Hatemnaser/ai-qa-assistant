/** A side tool must never leave less than 480px for the actual conversation. */
export function sessionToolsUseDrawer(containerWidth: number, viewportWidth: number, forceDrawer = false): boolean {
  return forceDrawer || viewportWidth <= 991 || containerWidth - 320 < 480;
}
