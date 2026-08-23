/* What a pageview is allowed to say. */

/** The address minus what Vercel may not be told: the drill path is built from the reader's own
 *  line-item names, and one of those is somebody's in-house MCP server. The origin rides along
 *  because Vercel's ingest 400s a bare path. */
export function scrub(url: string): string | null {
  try {
    const at = new URL(url)
    return at.origin + (/(^|\/)report(\/|$)/.test(at.pathname) ? "/report" : "/")
  } catch {
    /* Not parseable as an address is not something to guess at. */
    return null
  }
}

/** Whether this copy is the hosted one: the standalone is opened from disk, or served under its
 *  own `cost-report.html` name. */
export function hosted(protocol: string, pathname: string): boolean {
  return /^https?:$/.test(protocol) && !/\.html?$/i.test(pathname)
}
