/* What a pageview is allowed to say. Kept apart from the component that sends one, because both
   answers below are plain functions over strings and the suite that guards them runs under bare
   `node`, where a `.tsx` would not parse. */

/** What the address carries that Vercel may not be told. Two things, and the second is the one
 *  worth spelling out: the drill path is built from the *reader's own* line-item names, so
 *  `/report/shell-commands/git` is harmless but the next one along is
 *  `/report/tools-content-read-in/acmeinternal-fetch-ledger` -- an in-house MCP server, named
 *  after somebody's employer. That is the exact class of name the share captions refuse to
 *  carry, and a pageview is no more entitled to it. The hash is the other: a report handed over
 *  by the CLI rides in it.
 *
 *  So a view is reported as the face it is -- the empty card, or the report -- and the drill
 *  below it is dropped. */
/** It answers with one of exactly two strings, and that is the point: a filter that rewrites what
 *  it recognises still ships whatever it failed to recognise, while a whitelist of the two faces
 *  the page actually has cannot emit a name it was never given. */
export function scrub(url: string): string {
  try {
    return /(^|\/)report(\/|$)/.test(new URL(url).pathname) ? "/report" : "/"
  } catch {
    /* Not parseable as an address is not something to guess at. */
    return "/"
  }
}

/** Whether this copy of the page is the hosted one. Two answers to give, and neither is a guess:
 *  the standalone build is opened from disk, where there is no network to reach and a promise
 *  that it never does; and it is named `cost-report.html`, which is what tells it apart from the
 *  deployed page when somebody serves it themselves. `store.ts` reads the same `.html` to decide
 *  whether the address can hold a path at all. */
export function hosted(protocol: string, pathname: string): boolean {
  return /^https?:$/.test(protocol) && !/\.html?$/i.test(pathname)
}
