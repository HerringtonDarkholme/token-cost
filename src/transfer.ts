/* Getting a report from the CLI into this page without either end talking to a server: the
   analysis rides in the URL fragment, which the browser never sends anywhere, gzipped and
   base64url'd so a corpus's worth of distinct tools and shells still fits an address bar. */

import type { Analysis } from "./engine.ts"
import { parseHash } from "./store.ts"

/** The one hash key that is not a view setting. */
const KEY = "d"

export function readImport(hash: string): string | null {
  return parseHash(hash)[KEY] || null
}

/** The hash with `d=...` removed, keeping whatever view settings rode alongside it -- so the
 *  address bar is left holding what a folder drop would have written, not the payload that got
 *  it there. */
export function stripImport(hash: string): string {
  const h = (hash || "").replace(/^#/, "")
  const kept = h.split("&").filter((kv) => kv && !kv.startsWith(`${KEY}=`))
  return kept.length ? "#" + kept.join("&") : ""
}

/** `payload` as the CLI wrote it: JSON, gzipped, base64url. `null` for anything that fails to
 *  come back as an `Analysis` -- a stray or hand-edited hash is not this page's business to
 *  explain. */
export async function decodeImport(payload: string): Promise<Analysis | null> {
  try {
    const std = payload.replace(/-/g, "+").replace(/_/g, "/")
    const bin = atob(std)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
    const json = await new Response(stream).text()
    return JSON.parse(json) as Analysis
  } catch {
    return null
  }
}
