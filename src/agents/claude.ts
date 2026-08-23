/* Claude Code transcripts. The engine's record is this format's own shape, so the reading here is
   a parse and nothing more -- what makes it an agent like the others is that the walk asks it the
   same questions it asks them, and gets no more from it than from any of them. */

import type { Rate, TranscriptRecord } from "../engine.ts"
import type { Agent, Emit, Reader } from "./index.ts"
import { firstString, lines } from "./jsonl.ts"

/** Its own field, at the top level of every record it writes. */
const SESSION = /"sessionId"\s*:\s*"([^"]+)"/

/** How far into the file the claim reads. A transcript opens with the editor's own state -- a
 *  mode, a permission, a file snapshot -- so the first message can be a dozen records in. */
const CLAIM_LINES = 24

interface ClaudeLine {
  sessionId?: unknown
  uuid?: unknown
  parentUuid?: unknown
  message?: unknown
}

/** Whether Claude Code wrote this file: a record keyed the way it keys every record, or one
 *  carrying the `message` no other agent's format writes. */
function claims(text: string): boolean {
  let seen = 0
  for (const line of lines(text)) {
    if (++seen > CLAIM_LINES) break
    let rec: ClaudeLine
    try {
      rec = JSON.parse(line) as ClaudeLine
    } catch {
      continue
    }
    if (!rec || typeof rec !== "object") continue
    if (typeof rec.sessionId === "string" && rec.sessionId) return true
    if (rec.message && typeof rec.message === "object") return true
    if (typeof rec.uuid === "string" && "parentUuid" in rec) return true
  }
  return false
}

/** $ per 1M tokens, as [input, output]. */
const rates: Record<string, Rate> = {
  "claude-fable-5": [10, 50],
  "claude-mythos-5": [10, 50],
  "claude-opus-5": [5, 25],
  "claude-opus-4": [5, 25], // 4, 4-5, 4-6, 4-7, 4-8 all share this rate
  "claude-sonnet-5": [3, 15],
  "claude-sonnet-4": [3, 15],
  "claude-haiku-4": [1, 5],
  "claude-3-opus": [15, 75], // legacy 3.x cards differ from their tier default
  "claude-3-5-sonnet": [3, 15],
  "claude-3-7-sonnet": [3, 15],
  "claude-3-5-haiku": [0.8, 4],
  "claude-3-haiku": [0.25, 1.25],
  "claude-2": [8, 24],
}

/** The tier word implies the current rate for that tier, for a card published after this one. */
const tiers: ReadonlyArray<readonly [RegExp, Rate]> = [
  [/\bopus\b|opus/, [5, 25]],
  [/sonnet/, [3, 15]],
  [/haiku/, [1, 5]],
  [/fable|mythos/, [10, 50]],
]

/** What the clouds reselling these models add to an id. */
function normalize(id: string): string {
  let m = id.replace(/^publishers\/anthropic\/models\//, "") // Vertex AI
  // Bedrock stacks these: "us.anthropic.claude-…" is a region prefix on a vendor prefix.
  for (let prev: string | null = null; prev !== m;) {
    prev = m
    m = m.replace(/^(anthropic|us|eu|apac|global|gov)\./, "")
  }
  return m
}

/** One line of a transcript, straight through: `false` is a line that would not parse, which the
 *  bill counts rather than passes off as an empty record. */
function readLine(text: string, emit: Emit): boolean {
  let rec: TranscriptRecord | null = null
  try {
    rec = JSON.parse(text) as TranscriptRecord
  } catch {
    return false
  }
  if (rec && typeof rec === "object") emit(rec)
  return true
}

/* Nothing is held between lines, so one reader serves every file. */
const READER: Reader = {
  front: () => false,
  line: readLine,
  end: () => {},
}

export const claude: Agent = {
  name: "Claude Code",
  claims,
  session: (head) => firstString(head, SESSION),
  open: () => READER,
  rates,
  tiers,
  normalize,
  stores: [{ home: ".claude", dirs: ["projects"] }],
}
