/* Every agent the bill reads, behind one set of questions: which files are yours, how do they
   read, what do your models cost. */

import type { Rate, Turn } from "../engine.ts"
import { claude } from "./claude.ts"
import { codex } from "./codex.ts"
import { grok } from "./grok.ts"

/** Where a turn goes once a reader has one. */
export type Emit = (turn: Turn) => void

/** One file, part way read: made per file, so a reader holds format state for one session only. */
export interface Reader {
  /** The front of a line: `true` where that was all this reader wanted. */
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
  /** The mark it is known by, as path data in a 24-unit box -- data rather than markup, so this
   *  side still draws nothing. */
  mark: readonly string[]
  /** How much larger than the others its mark has to be set to read as their size: a thin diagonal
   *  fills its box with white space where a solid mark fills it with ink. */
  markScale?: number
  /** Whether this agent wrote the file -- a positive test for its own markers, so no agent is
   *  another's fallback. */
  claims(head: string): boolean
  /** A file in its session folder that is not the billed conversation. */
  sidecar?(head: string): boolean
  /** The names it gives those, for a caller that has the name before the bytes. */
  sidecarNames?: ReadonlySet<string>
  /** Which session the file records, so two copies of one session are read once. */
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

/** Which agent wrote this file, asked in list order so a file answering to two is settled. */
export function agentFor(head: string): Agent | null {
  for (const a of AGENTS) if (a.claims(head)) return a
  return null
}

/** Every agent's sidecar names, for callers that filter a listing before reading it. */
export const SIDECAR_NAMES: ReadonlySet<string> = ((): ReadonlySet<string> => {
  const all = new Set<string>()
  for (const a of AGENTS) if (a.sidecarNames) for (const n of a.sidecarNames) all.add(n)
  return all
})()

/** One agent as the empty card asks for it: what to call it, the folder to point at, and the mark
 *  that says whose that folder is. */
export interface Folder {
  name: string
  /** The folder in three parts, written the way the reader would type it -- split so the page can
   *  set the vendor's own word apart from the path around it. */
  head: string
  brand: string
  tail: string
  mark: readonly string[]
  markScale?: number
}

/** The ask, in registry order, so a fourth agent joins the sentence by being registered rather
 *  than by being written into it. */
export const AGENT_FOLDERS: readonly Folder[] = AGENTS.flatMap((a) => {
  const store = a.stores?.[0]
  if (!store) return []
  const dot = store.home.startsWith(".")
  return [
    {
      name: a.name,
      head: dot ? "~/." : "~/",
      brand: dot ? store.home.slice(1) : store.home,
      tail: `/${store.dirs[0]}/`,
      mark: a.mark,
      markScale: a.markScale,
    },
  ]
})
