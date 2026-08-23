/* Claude Code transcripts. What the walk reads is a turn, and this is where a record Claude Code
   wrote on disk becomes one -- the nesting, the field names and the cache-TTL bookkeeping below are
   this format's, and stop here. */

import type { Block, Rate, Spend, Turn } from "../engine.ts"
import { imageTokens } from "./image.ts"
import type { Agent, Emit, Reader } from "./index.ts"
import { firstString, lines } from "./jsonl.ts"

/* --- the shape on disk --- */

export interface ImageSource {
  type?: string
  media_type?: string
  data?: string
}

/** One content block, as this format writes it. */
export interface WireBlock {
  type?: string
  text?: string
  thinking?: string
  data?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  content?: unknown
  tool_use_id?: string
  source?: ImageSource
}

export interface CacheCreation {
  ephemeral_1h_input_tokens?: number
  ephemeral_5m_input_tokens?: number
}

export interface Usage {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  output_tokens?: number
  cache_creation?: CacheCreation | null
}

interface WireMessage {
  role?: string
  model?: string
  usage?: Usage
  content?: unknown
}

/** One JSONL line. */
interface WireRecord {
  message?: WireMessage
  timestamp?: string
  sessionId?: unknown
  uuid?: unknown
  parentUuid?: unknown
  isCompactSummary?: boolean
  isMeta?: boolean
  isSidechain?: boolean
}

/** Its own field, at the top level of every record it writes. */
const SESSION = /"sessionId"\s*:\s*"([^"]+)"/

/** How far into the file the claim reads. A transcript opens with the editor's own state -- a
 *  mode, a permission, a file snapshot -- so the first message can be a dozen records in. */
const CLAIM_LINES = 24

/** Whether Claude Code wrote this file: a record keyed the way it keys every record, or one
 *  carrying the `message` no other agent's format writes. */
function claims(text: string): boolean {
  let seen = 0
  for (const line of lines(text)) {
    if (++seen > CLAIM_LINES) break
    let rec: WireRecord
    try {
      rec = JSON.parse(line) as WireRecord
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

/* --- reading it --- */

/** Characters of billable content in a block, which for this format is a question about what the
 *  block nests. */
function charsOf(block: unknown): number {
  if (typeof block === "string") return block.length
  if (Array.isArray(block)) return block.reduce<number>((n, b) => n + charsOf(b), 0)
  if (!block || typeof block !== "object") return 0
  const b = block as WireBlock
  switch (b.type) {
    case "text":
      return (b.text || "").length
    case "thinking":
      return (b.thinking || "").length
    case "redacted_thinking":
      return (b.data || "").length
    case "tool_use":
      return JSON.stringify(b.input || {}).length
    case "tool_result":
      return charsOf(b.content)
    case "image":
      return 0
    case "document":
      return 0
    default:
      return JSON.stringify(block).length
  }
}

function textOf(block: unknown): string {
  if (typeof block === "string") return block
  if (Array.isArray(block)) return block.map(textOf).join("")
  if (!block || typeof block !== "object") return ""
  const b = block as WireBlock
  if (b.type === "text") return b.text || ""
  if (b.type === "tool_result") return textOf(b.content)
  return ""
}

/* Its own spelling for an MCP tool: the server and the tool in one name, under a prefix. */
const MCP = "mcp__"

/** The server a tool came from, and the tool, out of the one name this format writes them in. */
function toolOf(name: string): { tool: string; server?: string } {
  if (!name.startsWith(MCP)) return { tool: name }
  const p = name.split("__").filter(Boolean)
  return p.length >= 3 ? { tool: p.slice(2).join("__"), server: p[1] } : { tool: name }
}

/** The picture itself, or nothing where the block only points at one. */
function imageData(b: WireBlock): unknown {
  const src = b.source
  if (!src || src.type === "url") return undefined
  return src.data
}

/** What the request was billed. The two cache lives are recorded per request; where they do not add
 *  up to the total written, the total is the figure to trust. */
function spendOf(u: Usage): Spend {
  const cw = u.cache_creation_input_tokens || 0
  const cc = u.cache_creation && typeof u.cache_creation === "object" ? u.cache_creation : null
  let w1 = 0,
    w5 = 0
  if (cc) {
    w1 = cc.ephemeral_1h_input_tokens || 0
    w5 = cc.ephemeral_5m_input_tokens || 0
    if (w1 + w5 > cw) {
      const k = cw / (w1 + w5)
      w1 *= k
      w5 *= k
    }
  }
  return {
    fresh: u.input_tokens || 0,
    cached: u.cache_read_input_tokens || 0,
    write1h: w1,
    write5m: w5,
    writeUnknown: Math.max(0, cw - w1 - w5),
    out: u.output_tokens || 0,
  }
}

/** A message's content as a list of blocks, a string standing for one text block. */
function contentOf(content: unknown): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }]
  return Array.isArray(content) ? content : []
}

/** What the model produced. Anything it did not write itself -- a stray string in the list -- is
 *  not output and is left out. */
function modelBlocks(content: unknown[]): Block[] {
  const out: Block[] = []
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue
    const b = raw as WireBlock
    if (b.type === "text") out.push({ kind: "text", chars: (b.text || "").length })
    else if (b.type === "thinking" || b.type === "redacted_thinking")
      out.push({ kind: "reasoning", chars: charsOf(b) })
    else if (b.type === "tool_use") {
      const { tool, server } = toolOf(b.name || "")
      out.push({
        kind: "call",
        chars: JSON.stringify(b.input || {}).length,
        tool,
        server,
        id: b.id,
        input: b.input,
      })
    }
  }
  return out
}

/** Everything on the other side of the request: tool output, pictures, and whatever was typed. */
function userBlocks(content: unknown[]): Block[] {
  const out: Block[] = []
  for (const raw of content) {
    const b = raw && typeof raw === "object" ? (raw as WireBlock) : null
    const kind = b ? b.type : "text"
    if (kind === "tool_result" && b)
      out.push({ kind: "result", chars: charsOf(b), id: b.tool_use_id })
    else if (kind === "image" && b)
      out.push({ kind: "image", chars: 0, tokens: imageTokens(imageData(b)) })
    else if (kind === "document" && b) out.push({ kind: "document", chars: charsOf(b) })
    else out.push({ kind: "text", chars: charsOf(raw), text: textOf(raw) })
  }
  return out
}

/* A record that bills nothing and carries nothing still dates the session, so it goes over as a
   turn with nothing in it rather than being dropped -- and they all share one empty list. */
const NONE: Block[] = []

/** One record, as the turn the walk reads. */
function toTurn(rec: WireRecord): Turn {
  const msg = rec.message
  if (!msg || typeof msg !== "object") return { at: rec.timestamp, by: "user", blocks: NONE }
  if (msg.role === "assistant")
    return {
      at: rec.timestamp,
      by: "model",
      model: msg.model,
      spend: msg.usage ? spendOf(msg.usage) : undefined,
      blocks: modelBlocks(contentOf(msg.content)),
      subagent: rec.isSidechain === true,
    }
  if (msg.role === "user")
    return {
      at: rec.timestamp,
      by: "user",
      blocks: userBlocks(contentOf(msg.content)),
      compacted: rec.isCompactSummary === true,
      harness: rec.isMeta === true,
    }
  return { at: rec.timestamp, by: "user", blocks: NONE }
}

/** One line of a transcript. `false` is a line that would not parse, which the bill counts rather
 *  than passes off as an empty record. */
function readLine(text: string, emit: Emit): boolean {
  let rec: WireRecord | null = null
  try {
    rec = JSON.parse(text) as WireRecord
  } catch {
    return false
  }
  if (rec && typeof rec === "object") emit(toTurn(rec))
  return true
}

/* Nothing is held between lines, so one reader serves every file. */
const READER: Reader = {
  front: () => false,
  line: readLine,
  end: () => {},
}

/* --- what it costs --- */

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
