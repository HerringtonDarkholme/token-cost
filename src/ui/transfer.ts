/* Getting a report from the CLI into this page without either end talking to a server: the
   analysis rides in the URL fragment, which the browser never sends anywhere, gzipped and
   base64url'd so a corpus's worth of distinct tools and shells still fits an address bar. */

import type { Analysis } from "../core/engine.ts"
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

/** The root a `/open` address came in from, or nothing when this is the page itself. The CLI sends
 *  its report to that door so the page fetches the report's own face and never the folder-reading
 *  one; the door is then left behind rather than kept, since the address the reader ends up holding
 *  has to be one that means something a second time. */
export function landing(path: string): string | undefined {
  return /\/open\/?$/.test(path) ? path.replace(/\/open\/?$/, "/") : undefined
}

let pending: string | null = null

/** Lift the payload out of the address, and do it before the first render -- which is the whole
 *  reason this is a module-level box rather than something the App reads for itself. The page
 *  writes the address from an effect inside `Page`, effects run child first, and that write goes
 *  out from the default state: an App that waited for its own effect would be handed a hash the
 *  component below it had already cleared. `main.tsx` reads the view settings a line later for
 *  exactly the same reason. */
export function takeImport(land?: string): void {
  pending = readImport(location.hash)
  if (!pending && !land) return
  try {
    history.replaceState(
      null,
      "",
      (land ?? location.pathname) + location.search + stripImport(location.hash),
    )
  } catch {
    /* file:// can refuse */
  }
}

export function pendingImport(): string | null {
  return pending
}

/** Enough of the shape to know the page can draw it. A fragment is editable by hand and survives
 *  a paste into a chat window, so what comes back is checked rather than trusted: the failure to
 *  catch here is not an attack, it is a truncated URL rendering as a blank card. */
function isAnalysis(v: unknown): v is Analysis {
  if (!v || typeof v !== "object") return false
  const a = v as Analysis
  if (typeof a.requests !== "number" || !Array.isArray(a.groupDefs)) return false
  if (!a.datasets || typeof a.datasets !== "object") return false
  return (["1h", "5m"] as const).every((t) => {
    const d = a.datasets[t]
    return !!d && typeof d.total === "number" && Array.isArray(d.groups)
  })
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
    const parsed: unknown = JSON.parse(await new Response(stream).text())
    return isAnalysis(parsed) ? parsed : null
  } catch {
    return null
  }
}
