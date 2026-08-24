/* Claude Code transcripts, turned into the turns the walk reads: the nesting, the field names and
   the cache-TTL bookkeeping below are this format's, and stop here. */

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

/** How far into the file the claim reads: a transcript opens with the editor's own state, so the
 *  first message can be a dozen records in. */
const CLAIM_LINES = 24

/** Whether Claude Code wrote this file: a record keyed the way it keys every record, or one
 *  carrying the `message` no other format writes. */
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

/** Characters of billable content in a block, which for this format is a question about nesting. */
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

/** What the request was billed. Where the two cache lives do not add up to the total written, the
 *  total is the figure to trust. */
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

/** What the model produced. A stray string in the list is not output and is left out. */
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

/* A record that bills nothing still dates the session, so it goes over as an empty turn rather
   than being dropped -- and they all share one empty list. */
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
 *  than passing off as an empty record. */
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
  mark: [
    "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
  ],
  claims,
  session: (head) => firstString(head, SESSION),
  open: () => READER,
  rates,
  tiers,
  normalize,
  stores: [{ home: ".claude", dirs: ["projects"] }],
}
