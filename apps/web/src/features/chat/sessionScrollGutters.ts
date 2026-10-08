/** Physical insets: RTL scrollbars need not be on the same side in every browser. */
export function sessionScrollGutters(metrics: {
  offsetWidth: number;
  clientWidth: number;
  clientLeft: number;
  borderLeft: number;
  borderRight: number;
  overflowing: boolean;
  rtl: boolean;
}) {
  const width = Math.max(0, metrics.offsetWidth - metrics.clientWidth - metrics.borderLeft - metrics.borderRight);
  if (width > 0) {
    const left = Math.min(width, Math.max(0, metrics.clientLeft - metrics.borderLeft));
    return { left, right: width - left };
  }
  // Overlay scrollbars occupy no layout width. Keep their edge clear of the
  // dock too; do not hide or replace the browser's native scrolling controls.
  const overlayClearance = metrics.overflowing ? 16 : 0;
  return { left: metrics.rtl ? overlayClearance : 0, right: metrics.rtl ? 0 : overlayClearance };
}
