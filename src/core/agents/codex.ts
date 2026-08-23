/* Codex rollouts, translated into the records the walk already reads. */

import type { Block, Rate, Spend, Turn } from "../engine.ts"
import { imageTokens } from "./image.ts"
import type { Agent, Reader } from "./index.ts"
import { lines } from "./jsonl.ts"

/** What a rollout's `token_count` event says it spent. */
interface CodexUsage {
  input_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

/** The half of a rollout line that carries the content; the rest is the envelope. */
interface CodexPayload {
  type?: string
  role?: string
  model?: string
  name?: string
  call_id?: string
  content?: unknown
  arguments?: unknown
  input?: unknown
  output?: unknown
  message?: unknown
  thread_source?: string
  action?: { query?: unknown }
  invocation?: { server?: unknown; tool?: unknown; arguments?: unknown }
  result?: unknown
  info?: { last_token_usage?: CodexUsage; total_token_usage?: CodexUsage }
}

/** One JSONL line of a rollout. */
interface CodexLine {
  type?: string
  timestamp?: string
  payload?: CodexPayload
}

/* Structural, never a check on `originator`: every editor driving `codex app-server` writes its
   own name into the same format. */
const CODEX_TYPES = new Set(["session_meta", "turn_context", "response_item", "event_msg"])

/** Whether this file is a Codex rollout rather than a Claude Code transcript. */
export function isCodexRollout(text: string): boolean {
  let seen = 0
  for (const line of lines(text)) {
    if (++seen > 3) break
    let rec: CodexLine
    try {
      rec = JSON.parse(line) as CodexLine
    } catch {
      continue
    }
    if (!rec || typeof rec !== "object") continue
    // A transcript record carries a `message`; a rollout carries a `payload` and never both.
    if ("message" in rec) return false
    const p: unknown = rec.payload
    if (rec.type && CODEX_TYPES.has(rec.type) && p && typeof p === "object" && !Array.isArray(p))
      return true
  }
  return false
}

const num = (v: unknown): number => (typeof v === "number" && v > 0 ? v : 0)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** How far into a line the envelope's keys reach: timestamp, ordinal, type, then the payload. */
const ENVELOPE = 320
const PAYLOAD = '"payload":{'

/** A string value out of the envelope of a line nothing has parsed. No envelope value carries an
 *  escape, so a plain search cannot land inside something nested. */
function envelopeValue(env: string, key: string): string {
  const open = `"${key}":"`
  const at = env.indexOf(open)
  if (at === -1) return ""
  const from = at + open.length
  const end = env.indexOf('"', from)
  return end === -1 ? "" : env.slice(from, end)
}

/** One string value out of an unparsed line, handed to `JSON.parse` on its own. Only where `key`
 *  is the first key at `at`: a search further in could find the same name nested in a value. */
function quoted(line: string, at: number, key: string): string | null {
  const open = `"${key}":"`
  if (!line.startsWith(open, at)) return null
  const from = at + open.length - 1
  for (let i = from + 1, n = line.length; i < n; i++) {
    const c = line.charCodeAt(i)
    if (c === 92) i++
    else if (c === 34) {
      try {
        return JSON.parse(line.slice(from, i + 1)) as string
      } catch {
        return null
      }
    }
  }
  return null
}

/* A screenshot arrives inside the tool output as a base64 data URL running to tens of megabytes;
   anything else falls through to the parse. */
const SHOT_AT = '"output":[{"type":"input_image","image_url":"'

/** How far in the reader looks: past the envelope and into the picture's header, which a PNG
 *  writes in its first two dozen bytes. */
const SHOT_LOOK = 1 << 13

/** A tool output that is a screenshot: the timestamp, and enough of the picture to read its
 *  size. `null` for anything else, which goes on to be parsed whole. */
function screenshot(line: string): { stamp: string; data: string } | null {
  const look = line.length > SHOT_LOOK ? line.slice(0, SHOT_LOOK) : line
  const at = look.indexOf(SHOT_AT)
  if (at === -1) return null
  const from = at + SHOT_AT.length
  /* Base64 carries no quote, so the first one after the URL closes it -- and a picture longer
     than the window has none, which is what the prefix is for. */
  let end = look.indexOf('"', from)
  if (end === -1) end = look.length
  return { stamp: envelopeValue(look.slice(0, at), "timestamp"), data: look.slice(from, end) }
}

/** A compaction's timestamp and message off the front of the line. `null` for anything else,
 *  which goes on to be parsed whole. */
function compaction(line: string): { stamp: string; message: string } | null {
  const head = line.length > ENVELOPE ? line.slice(0, ENVELOPE) : line
  const at = head.indexOf(PAYLOAD)
  if (at <= 0) return null
  const env = head.slice(0, at)
  if (!env.includes('"type":"compacted"')) return null
  const message = quoted(line, at + PAYLOAD.length, "message")
  return message === null ? null : { stamp: envelopeValue(env, "timestamp"), message }
}

/** What has to be known before the first line is priced: a rollout can bill a request before it
 *  names the model, and says whose session it is only at the top. Stops at the first model, with
 *  `codexLine` picking it up off a later `turn_context` where the head does not reach one. */
function ahead(text: string): { model: string; sidechain: boolean } {
  let model = "",
    sidechain = false
  for (const line of lines(text)) {
    const meta = line.includes('"session_meta"')
    if (meta && line.includes('"thread_source":"subagent"')) sidechain = true
    if (!meta && !line.includes('"turn_context"')) continue
    const m = /"model"\s*:\s*"([^"]+)"/.exec(line)
    if (m) {
      model = m[1]
      break
    }
  }
  return { model, sidechain }
}

/** OpenAI counts cached tokens inside `input_tokens` and has no TTL to choose, so the writes are
 *  declared short, where the report's toggle cannot move them. */
function spendOf(u: CodexUsage): Spend {
  const inp = num(u.input_tokens)
  const cached = Math.min(num(u.cached_input_tokens), inp)
  const write = num(u.cache_write_input_tokens)
  return {
    fresh: inp - cached,
    cached,
    write1h: 0,
    write5m: write,
    writeUnknown: 0,
    out: num(u.output_tokens),
  }
}

/** The blocks of a rollout message, whichever direction it was going. */
function blocksOf(content: unknown): Block[] {
  if (!Array.isArray(content))
    return typeof content === "string"
      ? [{ kind: "text", chars: content.length, text: content }]
      : []
  const out: Block[] = []
  for (const b of content) {
    if (!b || typeof b !== "object") continue
    const c = b as { type?: string; text?: string; image_url?: string }
    if (c.type === "input_image")
      /* Sized off its own header, so a thumbnail is not charged as a full-page capture. */
      out.push({
        kind: "image",
        chars: 0,
        tokens: imageTokens(typeof c.image_url === "string" ? c.image_url : undefined),
      })
    else if (typeof c.text === "string" && c.text)
      out.push({ kind: "text", chars: c.text.length, text: c.text })
  }
  return out
}

/* The newest shell tool takes JavaScript, so the command is lifted back out of the source. */
const JS_CMD = /"?\bcmd"?\s*:\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g

/** The commands a sandbox script runs, and the script without those literals -- labelled by what
 *  it ran, still sized by everything that was sent. */
function execArgs(src: string): Record<string, unknown> {
  const cmds: string[] = []
  const rest = src.replace(JS_CMD, (all, lit: string) => {
    let body: string
    try {
      body = lit[0] === "`" ? lit.slice(1, -1) : (JSON.parse(lit) as string)
    } catch {
      return all
    }
    if (!body.trim()) return all
    cmds.push(body)
    return ""
  })
  return cmds.length ? { cmd: cmds.join("\n"), js: rest } : { js: src }
}

/** The first file a patch touches, which is the only label an `apply_patch` carries. */
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m

/** What a tool call sent, as an object the walk can read a program or a path out of. */
function argsOf(p: CodexPayload): Record<string, unknown> {
  const name = str(p.name)
  const raw = p.arguments ?? p.input
  if (typeof raw === "string") {
    if (name === "apply_patch") {
      const f = PATCH_FILE.exec(raw)
      return f ? { patch: raw, file_path: f[1].trim() } : { patch: raw }
    }
    if (name === "exec" || name === "js") return execArgs(raw)
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>
    } catch {
      /* Not JSON, so it is the argument. */
    }
    return { input: raw }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  return {}
}

/** How many records the reader holds while waiting to be told the model. A rollout usually names
 *  one in its first lines; this stops the wait becoming the whole file. */
const HELD_MAX = 4096

/** Where a rollout stands part way through: what it said about the session, and the two halves
 *  of a request it holds until the line that bills them. */
export interface CodexState {
  model: string
  sidechain: boolean
  /* What the assistant produced and the output it drew, held because the token count comes last. */
  blocks: Block[]
  results: Block[]
  stamp: string
  /* The cumulative counters, for the rollouts that report a running total and no per-call one. */
  prevTotal: number | null
  prevIn: number
  prevCached: number
  prevOut: number
  prevWrite: number
  prevReason: number
  /** Records made before the rollout named the model that prices them, `null` once it has: two
   *  of a real store's thousand bill tens of megabytes first. */
  held: Turn[] | null
}

/** Open a rollout on as much of its front as the reader has been handed. */
export function codexOpen(head: string): CodexState {
  const { model, sidechain } = ahead(head)
  return {
    model,
    sidechain,
    blocks: [],
    results: [],
    stamp: "",
    prevTotal: null,
    prevIn: 0,
    prevCached: 0,
    prevOut: 0,
    prevWrite: 0,
    prevReason: 0,
    held: model ? null : [],
  }
}

/** What the walk reads. Straight into one of these rather than a generator per line, because a
 *  big rollout has a record every few hundred bytes. */
type Out = (turn: Turn) => void

/** Let the backlog go, with the model it was waiting for written into it. */
function release(s: CodexState, out: Out): void {
  const held = s.held
  s.held = null
  if (!held) return
  for (const turn of held) {
    if (turn.by === "model" && !turn.model && s.model) turn.model = s.model
    out(turn)
  }
}

/** One record on its way to the walk, or into the backlog while there is no model to price it. */
function give(s: CodexState, turn: Turn, out: Out): void {
  const held = s.held
  if (!held) {
    out(turn)
    return
  }
  held.push(turn)
  // Waited long enough: a rollout this far in without naming a model is not going to name one.
  if (held.length > HELD_MAX) release(s, out)
}

/** The billed turn, then the output it drew -- the order that keeps a tool result out of the
 *  context of the request that called for it. */
function flush(s: CodexState, u: CodexUsage, out: Out): void {
  const reasoning = num(u.reasoning_output_tokens)
  /* Codex encrypts its reasoning but still counts it, so the block is sized by the count. */
  if (reasoning > 0) s.blocks.push({ kind: "reasoning", chars: 0, tokens: reasoning })
  const blocks = s.blocks,
    results = s.results
  s.blocks = []
  s.results = []
  give(
    s,
    {
      at: s.stamp,
      by: "model",
      model: s.model,
      spend: spendOf(u),
      blocks,
      subagent: s.sidechain,
    },
    out,
  )
  if (results.length) give(s, { at: s.stamp, by: "user", blocks: results }, out)
}

/** The payload's own type, where the payload names it first. Empty otherwise, and then the parse
 *  decides. */
const TYPE = '"type":"'
function payloadType(head: string, at: number): string {
  const from = at + PAYLOAD.length
  if (!head.startsWith(TYPE, from)) return ""
  const open = from + TYPE.length
  const shut = head.indexOf('"', open)
  return shut === -1 ? "" : head.slice(open, shut)
}

/** The two payloads that carry tool output, which is where a screenshot arrives. */
const OUTPUTS = new Set(["function_call_output", "custom_tool_call_output"])

/** What the reader does with one payload. */
type Handler = (s: CodexState, p: CodexPayload, out: Out) => void

/** A billed request, which is the one event the bill cannot do without. */
const onCount: Handler = (s, _p, out) => {
  const info = _p.info
  if (!info) return
  const total = info.total_token_usage
  /* A rollout can write the same event twice, and the running total is what tells a repeat from
     a request. Counting a rare repeat is the better error: the alternative drops every request
     after the first. */
  if (total) {
    const cum = num(total.total_tokens)
    if (s.prevTotal !== null && cum === s.prevTotal) return
    s.prevTotal = cum
  }
  let u = info.last_token_usage
  if (!u && total) {
    u = {
      input_tokens: num(total.input_tokens) - s.prevIn,
      cached_input_tokens: num(total.cached_input_tokens) - s.prevCached,
      cache_write_input_tokens: num(total.cache_write_input_tokens) - s.prevWrite,
      output_tokens: num(total.output_tokens) - s.prevOut,
      reasoning_output_tokens: num(total.reasoning_output_tokens) - s.prevReason,
    }
  }
  if (total) {
    s.prevIn = num(total.input_tokens)
    s.prevCached = num(total.cached_input_tokens)
    s.prevOut = num(total.output_tokens)
    s.prevWrite = num(total.cache_write_input_tokens)
    s.prevReason = num(total.reasoning_output_tokens)
  }
  if (!u) return
  flush(s, u, out)
}

/** An MCP call arrives as one event carrying both halves, so both are made here. */
const onMcp: Handler = (s, p) => {
  const inv = p.invocation
  const server = str(inv?.server),
    tool = str(inv?.tool)
  if (!server || !tool) return
  const id = str(p.call_id)
  const args = inv?.arguments
  const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {}
  s.blocks.push({ kind: "call", chars: JSON.stringify(input).length, id, tool, server, input })
  const result = JSON.stringify(p.result ?? "")
  s.results.push({ kind: "result", chars: result.length, id })
}

const onMessage: Handler = (s, p, out) => {
  const content = blocksOf(p.content)
  if (!content.length) return
  if (p.role === "assistant") s.blocks.push(...content)
  // A developer message is the harness talking, not the reader.
  else give(s, { at: s.stamp, by: "user", blocks: content, harness: p.role !== "user" }, out)
}

/** Traffic between agents, which is neither of them talking to the reader. */
const onAgentMessage: Handler = (s, p, out) => {
  const content = blocksOf(p.content)
  if (content.length) give(s, { at: s.stamp, by: "user", blocks: content, harness: true }, out)
}

const onCall: Handler = (s, p) => {
  const input = argsOf(p)
  s.blocks.push({
    kind: "call",
    chars: JSON.stringify(input).length,
    id: str(p.call_id),
    tool: str(p.name) || "(unnamed tool)",
    input,
  })
}

const onOutput: Handler = (s, p) => {
  const text = str(p.output) || JSON.stringify(p.output ?? "")
  s.results.push({ kind: "result", chars: text.length, id: str(p.call_id) })
}

const onWebSearch: Handler = (s, p) => {
  const input = { query: str(p.action?.query) }
  s.blocks.push({
    kind: "call",
    chars: JSON.stringify(input).length,
    id: str(p.call_id),
    tool: "web_search",
    input,
  })
}

/* One list rather than two: these keys are what decide whether a line is worth parsing at all, and
   nearly a third of what a real store parses is records nothing below asks for. */
const EVENTS = new Map<string, Handler>([
  ["token_count", onCount],
  ["mcp_tool_call_end", onMcp],
])
const ITEMS = new Map<string, Handler>([
  ["message", onMessage],
  ["agent_message", onAgentMessage],
  ["function_call", onCall],
  ["custom_tool_call", onCall],
  ["function_call_output", onOutput],
  ["custom_tool_call_output", onOutput],
  ["web_search_call", onWebSearch],
])

/** One line of a rollout. `false` is a line that would not parse, which the bill owns up to. */
export function codexLine(s: CodexState, line: string, out: Out): boolean {
  const parsed = read(s, line, out)
  /* The line that named the model is the line the backlog was waiting for. */
  if (s.held && s.model) release(s, out)
  return parsed
}

/** The records only the front is needed of, which are the two biggest a rollout writes: a
 *  compaction, whose rewrite is a third of a real store's bytes and which nothing reads, and a
 *  screenshot, of which only the size header matters. `true` leaves the rest of the line unread. */
export function codexFront(s: CodexState, front: string, out: Out): boolean {
  const head = front.length > ENVELOPE ? front.slice(0, ENVELOPE) : front
  const at = head.indexOf(PAYLOAD)
  if (at <= 0) return false
  const kind = envelopeValue(head.slice(0, at), "type")
  if (kind === "compacted") {
    /* The walk has to be told a compaction happened; what the rewrite says is nothing to the
       bill. */
    const cut = compaction(front)
    if (!cut) return false
    if (cut.stamp) s.stamp = cut.stamp
    give(
      s,
      {
        at: s.stamp,
        by: "user",
        blocks: [{ kind: "text", chars: cut.message.length, text: cut.message }],
        compacted: true,
      },
      out,
    )
    return true
  }
  if (kind !== "response_item" && kind !== "event_msg") return false
  if (!OUTPUTS.has(payloadType(head, at))) return false
  const shot = screenshot(front)
  if (!shot) return false
  if (shot.stamp) s.stamp = shot.stamp
  s.results.push({ kind: "image", chars: 0, tokens: imageTokens(shot.data) })
  return true
}

function read(s: CodexState, line: string, out: Out): boolean {
  if (codexFront(s, line, out)) return true
  const head = line.length > ENVELOPE ? line.slice(0, ENVELOPE) : line
  const at = head.indexOf(PAYLOAD)
  if (at > 0) {
    const env = head.slice(0, at)
    const kind = envelopeValue(env, "type")
    if (kind === "event_msg" || kind === "response_item") {
      const sub = payloadType(head, at)
      /* Put down where it lies: `JSON.parse` builds every string in a record before anything can
         ignore them. */
      if (sub && !(kind === "event_msg" ? EVENTS : ITEMS).has(sub)) {
        const ts = envelopeValue(env, "timestamp")
        if (ts) s.stamp = ts
        return true
      }
    }
  }
  let rec: CodexLine
  try {
    rec = JSON.parse(line) as CodexLine
  } catch {
    return false
  }
  if (!rec || typeof rec !== "object") return true
  if (typeof rec.timestamp === "string") s.stamp = rec.timestamp
  const p = rec.payload
  if (!p || typeof p !== "object") return true

  if (rec.type === "turn_context" || rec.type === "session_meta") {
    if (typeof p.model === "string" && p.model) s.model = p.model
    return true
  }

  // The fallback for a compaction `compaction` could not read the front of.
  if (rec.type === "compacted") {
    const text = str(p.message)
    give(
      s,
      {
        at: s.stamp,
        by: "user",
        blocks: [{ kind: "text", chars: text.length, text }],
        compacted: true,
      },
      out,
    )
    return true
  }

  const table = rec.type === "event_msg" ? EVENTS : rec.type === "response_item" ? ITEMS : null
  const handler = table?.get(str(p.type))
  if (handler) handler(s, p, out)
  return true
}

/** A session read mid-flight ends with a turn nothing billed: still context, so still held and
 *  charged nothing. Whatever waited on a model that never came goes out here unpriced. */
export function codexEnd(s: CodexState, out: Out): void {
  if (s.blocks.length) {
    give(s, { at: s.stamp, by: "model", model: s.model, blocks: s.blocks }, out)
    s.blocks = []
  }
  if (s.results.length) {
    give(s, { at: s.stamp, by: "user", blocks: s.results }, out)
    s.results = []
  }
  if (s.held) release(s, out)
}

/** $ per 1M tokens, as [input, output]. Cached input is a tenth of input on every card OpenAI
 *  publishes, which is the engine's default. */
const rates: Record<string, Rate> = {
  "gpt-5": [1.25, 10],
  "gpt-5-mini": [0.25, 2],
  "gpt-5-nano": [0.05, 0.4],
  "gpt-5-pro": [15, 120],
  "gpt-5.1": [1.25, 10],
  "gpt-5.2": [1.75, 14],
  "gpt-5.2-pro": [21, 168],
  "gpt-5.3": [1.75, 14],
  "gpt-5.4": [2.5, 15],
  "gpt-5.4-mini": [0.75, 4.5],
  "gpt-5.4-nano": [0.2, 1.25],
  "gpt-5.4-pro": [30, 180],
  "gpt-5.5": [5, 30],
  "gpt-5.5-pro": [30, 180],
  "gpt-5.6": [5, 30],
  "gpt-5.6-luna": [0.2, 1.2],
  "gpt-5.6-luna-pro": [30, 180],
  "gpt-5.6-sol": [5, 30],
  "gpt-5.6-sol-pro": [30, 180],
  "gpt-5.6-terra": [2, 12],
  "gpt-5.6-terra-pro": [30, 180],
  "codex-mini": [1.5, 6],
  /* The reviewer Codex runs by itself, on the card it shares with gpt-5.4. */
  "codex-auto-review": [2.5, 15],
}

export const codex: Agent = {
  name: "Codex",
  claims: isCodexRollout,
  open(head: string): Reader {
    const s = codexOpen(head)
    return {
      front: (part, emit) => codexFront(s, part, emit),
      line: (text, emit) => codexLine(s, text, emit),
      end: (emit) => codexEnd(s, emit),
    }
  },
  rates,
  stores: [{ home: ".codex", env: "CODEX_HOME", dirs: ["sessions", "archived_sessions"] }],
}
