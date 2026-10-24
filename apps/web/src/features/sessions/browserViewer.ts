/** Signed viewer capabilities stay in memory and must never become resource metadata. */
export function safeBrowserViewerUrl(value: string, pageOrigin: string): string | null {
  try {
    const url = new URL(value), page = new URL(pageOrigin);
    const localFixture = page.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(page.hostname)
      && url.protocol === 'http:' && url.hostname === page.hostname;
    if ((url.protocol !== 'https:' && !localFixture) || url.username || url.password || url.pathname !== '/open' || url.search || !url.hash) return null;
    return url.href;
  } catch { return null; }
}
