/** Native scroll position, independent of keyboard focus or an open tool. */
export function sessionReaderPosition(scrollHeight: number, clientHeight: number, scrollTop: number, contentBottom: number | null = scrollHeight) {
  // The native scroll range also includes welcome content and writer padding.
  // Only an actual message/decision below the readable viewport is "newer".
  const end = contentBottom === null ? 0 : Math.min(scrollHeight, Math.max(0, contentBottom));
  const remaining = Math.max(0, end - clientHeight - Math.max(0, scrollTop));
  const newerOutsideView = end > clientHeight && remaining >= 72;
  return { following: !newerOutsideView, newerOutsideView };
}
