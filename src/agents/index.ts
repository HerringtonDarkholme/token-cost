/* Every agent the bill reads, behind the one set of questions the walk asks all of them: which
   files are yours, how do they read, what do your models cost. A fourth agent is a file in this
   folder and a line in the list below -- the engine names none of them. */

import type { Rate, TranscriptRecord } from "../engine.ts"
import { claude } from "./claude.ts"
import { codex } from "./codex.ts"
import { grok } from "./grok.ts"

/** Where a record goes once a reader has one. */
export type Emit = (rec: TranscriptRecord) => void

/** One file, part way read. Made per file, so a reader may hold whatever its format needs across
 *  the lines of one session and nothing wider. */
export interface Reader {
  /** The front of a line, offered before the rest of it is collected: `true` where the front was
   *  all this reader wanted, and the rest may go unread. */
  front(part: string, emit: Emit): boolean
  /** One whole line. `false` is a line that would not parse, which the bill owns up to. */
  line(text: string, emit: Emit): boolean
  /** No more lines: whatever the reader is still holding leaves here. */
  end(emit: Emit): void
}

/** Where an agent keeps its sessions: a root under the home directory unless the agent's own
 *  variable moves it, and the folders to read under that root. */
export interface Store {
  home: string
  env?: string
  dirs: string[]
}

/** One agent, as the walk sees it. */
export interface Agent {
  /** How the bill names it. */
  name: string
  /** Whether this agent wrote the file, judged from its front. Every claim is a positive test for
   *  markers of its own format, so no agent is anyone else's fallback. */
  claims(head: string): boolean
  /** A file in its session folder that is not the billed conversation. */
  sidecar?(head: string): boolean
  /** The names it gives those, for a caller that has the name before the bytes. */
  sidecarNames?: ReadonlySet<string>
  /** Which session the file records, so two copies of one session are read once. Agents that name
   *  no session are told apart by name and length instead. */
  session?(head: string): string | null
  open(head: string): Reader
  /** $ per 1M tokens for the models it bills. */
  rates: Record<string, Rate>
  /** Decorations its model ids carry that no rate card spells. */
  normalize?(id: string): string
  /** Last resort where no card matches: a word in the id implies a rate. */
  tiers?: ReadonlyArray<readonly [RegExp, Rate]>
  /** Where its sessions sit on a disk. */
  stores?: Store[]
}

export const AGENTS: readonly Agent[] = [claude, codex, grok]

/** Which agent wrote this file, or null for one none of them did. Asked in list order, which
   settles a file that somehow answers to two. */
export function agentFor(head: string): Agent | null {
  for (const a of AGENTS) if (a.claims(head)) return a
  return null
}

/** Every agent's sidecar names, for the callers that filter a folder listing before reading any
 *  of it. */
export const SIDECAR_NAMES: ReadonlySet<string> = ((): ReadonlySet<string> => {
  const all = new Set<string>()
  for (const a of AGENTS) if (a.sidecarNames) for (const n of a.sidecarNames) all.add(n)
  return all
})()
