/* Codex rollouts, translated into the record shape the walk already reads, so one engine prices
   every store. */

import type { ContentBlock, TranscriptRecord, Usage } from "../engine.ts"

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

/** Walked by index rather than `split("\n")` for the reason the transcript walk is: a store is
 *  hundreds of megabytes, and the split builds every line before the first one is read. */
function* lines(text: string): Generator<string> {
  for (let i = 0, n = text.length; i < n;) {
    let end = text.indexOf("\n", i)
    if (end === -1) end = n
    let from = i
    i = end + 1
    while (from < end && text.charCodeAt(from) <= 32) from++
    if (from === end) continue
    yield text.slice(from, end)
  }
}

/* Structural, never a check on `originator`: that field is the client's own name for itself, and
   every editor driving `codex app-server` writes a different one into the same format. */
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

/** How far into a line the envelope's own keys can reach: a timestamp, an ordinal on the newer
 *  versions, a type, then the payload. */
const ENVELOPE = 320
const PAYLOAD = '"payload":{'

/** A string value out of the envelope of a line nothing has parsed. The envelope holds only the
 *  keys a rollout puts before its payload, none of whose values carry an escape, so a plain search
 *  cannot land inside something nested or stop short of the end of a value. */
function envelopeValue(env: string, key: string): string {
  const open = `"${key}":"`
  const at = env.indexOf(open)
  if (at === -1) return ""
  const from = at + open.length
  const end = env.indexOf('"', from)
  return end === -1 ? "" : env.slice(from, end)
}

/** One string value out of an unparsed line: the span of its own literal, handed to `JSON.parse`
 *  on its own. Only where `key` is the first key at `at`, because a search further in could find
 *  the same name nested inside a value. */
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

/* A rollout returns a screenshot inside the tool output, as a base64 data URL running to tens of
   megabytes. This is the shape it writes, and anything else falls through to the parse. */
const SHOT_AT = '"output":[{"type":"input_image","image_url":"'

/** How far into such a line the reader looks: past the envelope, and far enough into the picture
 *  for the header that gives its size -- a PNG says so in its first two dozen bytes, and what is
 *  handed on gets scrubbed character by character, so a generous window is not a free one. */
const SHOT_LOOK = 1 << 13

/** A tool output that is a screenshot rather than text: the line's timestamp, and enough of the
 *  front of the image to read its dimensions off. `null` for every other line and for one shaped
 *  in a way this cannot read, both of which go on to be parsed whole. */
function screenshot(line: string): { stamp: string; data: string } | null {
  const look = line.length > SHOT_LOOK ? line.slice(0, SHOT_LOOK) : line
  const at = look.indexOf(SHOT_AT)
  if (at === -1) return null
  const from = at + SHOT_AT.length
  /* Base64 carries no quote, so the first one after the URL closes it -- and where the picture is
     longer than the window there is none, which is what the prefix is for. */
  let end = look.indexOf('"', from)
  if (end === -1) end = look.length
  return { stamp: envelopeValue(look.slice(0, at), "timestamp"), data: look.slice(from, end) }
}

/** A compaction's timestamp and message, taken off the front of the line. `null` for every other
 *  line and for a compaction shaped in a way this cannot read, both of which go on to be parsed
 *  whole. */
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
 *  writes down which model made it, and it says whose session it is only at the top. Stops at the
 *  first model, which a rollout names within its first few lines -- and where the head handed over
 *  does not reach one, `codexLine` picks it up off the `turn_context` that opens the turn, which a
 *  rollout writes before the count that bills it. */
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

/** OpenAI counts cached tokens inside `input_tokens`, and has no cache TTL to choose -- so the
 *  writes are declared as the short ones, where the report's TTL toggle cannot move them. */
function usageOf(u: CodexUsage): Usage {
  const inp = num(u.input_tokens)
  const cached = Math.min(num(u.cached_input_tokens), inp)
  const write = num(u.cache_write_input_tokens)
  return {
    input_tokens: inp - cached,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: write,
    cache_creation: { ephemeral_5m_input_tokens: write },
    output_tokens: num(u.output_tokens),
  }
}

/** The text blocks of a rollout message, whichever direction it was going. */
function blocksOf(content: unknown): ContentBlock[] {
  if (!Array.isArray(content))
    return typeof content === "string" ? [{ type: "text", text: content }] : []
  const out: ContentBlock[] = []
  for (const b of content) {
    if (!b || typeof b !== "object") continue
    const c = b as { type?: string; text?: string }
    if (c.type === "input_image")
      out.push({
        type: "image",
        /* Sized off its own header where it carries one, so a thumbnail is not charged as a
           full-page capture. */
        ...(typeof (b as { image_url?: string }).image_url === "string"
          ? { source: { data: (b as { image_url?: string }).image_url } }
          : {}),
      })
    else if (typeof c.text === "string" && c.text) out.push({ type: "text", text: c.text })
  }
  return out
}

/* The newest shell tool takes JavaScript rather than a command line, so the command has to be
   lifted back out of the source it was written into. */
const JS_CMD = /"?\bcmd"?\s*:\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g

/** The commands a sandbox script runs, and the script with those literals taken out of it -- so
 *  the call is labelled by what it ran and still sized by everything that was sent. */
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

/** How many records the reader holds while it waits to be told which model made them. A rollout
 *  usually names one in its first line or two, and where it does not this is what stops the wait
 *  from becoming the whole file. */
const HELD_MAX = 4096

/** Where a rollout stands part way through: what it has said about the session, and the two halves
 *  of a request it is holding until the line that bills them. */
export interface CodexState {
  model: string
  sidechain: boolean
  /* What the assistant produced, and the tool output it drew -- held because a rollout writes the
     token count last. */
  blocks: ContentBlock[]
  results: ContentBlock[]
  stamp: string
  /* The cumulative counters, for the rollouts that report a running total and no per-call one. */
  prevTotal: number | null
  prevIn: number
  prevCached: number
  prevOut: number
  prevWrite: number
  prevReason: number
  /** Records made before the rollout named the model that prices them, `null` once it has. Two of
   *  a real store's thousand rollouts bill a request tens of megabytes before they name one, which
   *  is far too deep to hold the file open for. */
  held: TranscriptRecord[] | null
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

/** What the walk reads. A rollout is read straight through into one of these rather than into a
 *  generator per line, because a big one has a record every few hundred bytes. */
type Out = (rec: TranscriptRecord) => void

/** Let the backlog go, with the model it was waiting for written into it. */
function release(s: CodexState, out: Out): void {
  const held = s.held
  s.held = null
  if (!held) return
  for (const rec of held) {
    const m = rec.message
    if (m && m.role === "assistant" && !m.model && s.model) m.model = s.model
    out(rec)
  }
}

/** One record on its way to the walk, or into the backlog if there is still no model to price it
 *  with. */
function give(s: CodexState, rec: TranscriptRecord, out: Out): void {
  const held = s.held
  if (!held) {
    out(rec)
    return
  }
  held.push(rec)
  // Waited long enough: a rollout this far in without naming a model is not going to name one.
  if (held.length > HELD_MAX) release(s, out)
}

/** The billed turn, then the output it drew -- the order a transcript writes them in, which is
 *  what keeps a tool result out of the context of the request that called for it. */
function flush(s: CodexState, u: CodexUsage, out: Out): void {
  const reasoning = num(u.reasoning_output_tokens)
  /* Codex encrypts its reasoning but still counts it, so the block is sized by the count rather
     than by text there is none of. */
  if (reasoning > 0) s.blocks.push({ type: "thinking", tokens: reasoning })
  const blocks = s.blocks,
    results = s.results
  s.blocks = []
  s.results = []
  give(
    s,
    {
      timestamp: s.stamp,
      isSidechain: s.sidechain,
      message: { role: "assistant", model: s.model, usage: usageOf(u), content: blocks },
    },
    out,
  )
  if (results.length)
    give(s, { timestamp: s.stamp, message: { role: "user", content: results } }, out)
}

/** The payload's own type, where the payload names it first -- which is how a rollout writes an
 *  event and a response item. Empty where it does not, and then the parse decides. */
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
  /* A rollout can write the same event twice, and the running total is what tells a repeat from a
     request. Without one there is nothing to compare, and counting a rare repeat is the better
     error: the alternative drops every request after the first. */
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
  s.blocks.push({
    type: "tool_use",
    id,
    name: `mcp__${server}__${tool}`,
    input: args && typeof args === "object" ? (args as Record<string, unknown>) : {},
  })
  s.results.push({ type: "tool_result", tool_use_id: id, content: JSON.stringify(p.result ?? "") })
}

const onMessage: Handler = (s, p, out) => {
  const content = blocksOf(p.content)
  if (!content.length) return
  if (p.role === "assistant") s.blocks.push(...content)
  // A developer message is the harness talking, not the reader.
  else
    give(
      s,
      { timestamp: s.stamp, isMeta: p.role !== "user", message: { role: "user", content } },
      out,
    )
}

/** Traffic between agents, which is neither of them talking to the reader. */
const onAgentMessage: Handler = (s, p, out) => {
  const content = blocksOf(p.content)
  if (content.length)
    give(s, { timestamp: s.stamp, isMeta: true, message: { role: "user", content } }, out)
}

const onCall: Handler = (s, p) => {
  s.blocks.push({
    type: "tool_use",
    id: str(p.call_id),
    name: str(p.name) || "(unnamed tool)",
    input: argsOf(p),
  })
}

const onOutput: Handler = (s, p) => {
  s.results.push({
    type: "tool_result",
    tool_use_id: str(p.call_id),
    content: str(p.output) || JSON.stringify(p.output ?? ""),
  })
}

const onWebSearch: Handler = (s, p) => {
  s.blocks.push({
    type: "tool_use",
    id: str(p.call_id),
    name: "web_search",
    input: { query: str(p.action?.query) },
  })
}

/* One list rather than two: these keys are what `read` consults to decide whether a line is worth
   parsing at all, so a payload handled here is read and one that is absent is put down where it
   lies. Nearly a third of what a real store still parses is records nothing below asks for. */
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

/** One line of a rollout, as the transcript records it would have been. */
export function codexLine(s: CodexState, line: string, out: Out): void {
  read(s, line, out)
  /* The line that named the model is the line the backlog was waiting for. */
  if (s.held && s.model) release(s, out)
}

/** The records the reader needs only the front of, which are also the two biggest a rollout
 *  writes: a compaction, whose rewritten prefix is a third of a real store's bytes and which
 *  nothing here reads, and a screenshot, of which only the header saying how big the picture is
 *  matters. `true` when the front was enough and the rest of the line can go unread -- which is
 *  what lets a line spanning chunks be read without being put back together. */
export function codexFront(s: CodexState, front: string, out: Out): boolean {
  const head = front.length > ENVELOPE ? front.slice(0, ENVELOPE) : front
  const at = head.indexOf(PAYLOAD)
  if (at <= 0) return false
  const kind = envelopeValue(head.slice(0, at), "type")
  if (kind === "compacted") {
    /* The walk has to be told a compaction happened or it will read the rewrite as content that
       arrived; what the rewrite says is nothing to do with the bill. */
    const cut = compaction(front)
    if (!cut) return false
    if (cut.stamp) s.stamp = cut.stamp
    give(
      s,
      {
        timestamp: s.stamp,
        isCompactSummary: true,
        message: { role: "user", content: [{ type: "text", text: cut.message }] },
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
  s.results.push({ type: "image", source: { data: shot.data } })
  return true
}

function read(s: CodexState, line: string, out: Out): void {
  if (codexFront(s, line, out)) return
  const head = line.length > ENVELOPE ? line.slice(0, ENVELOPE) : line
  const at = head.indexOf(PAYLOAD)
  if (at > 0) {
    const env = head.slice(0, at)
    const kind = envelopeValue(env, "type")
    if (kind === "event_msg" || kind === "response_item") {
      const sub = payloadType(head, at)
      /* Nothing below asks for this one, so it is put down where it lies -- `JSON.parse` builds
         every string in a record before anything gets to ignore them. */
      if (sub && !(kind === "event_msg" ? EVENTS : ITEMS).has(sub)) {
        const ts = envelopeValue(env, "timestamp")
        if (ts) s.stamp = ts
        return
      }
    }
  }
  let rec: CodexLine
  try {
    rec = JSON.parse(line) as CodexLine
  } catch {
    return
  }
  if (!rec || typeof rec !== "object") return
  if (typeof rec.timestamp === "string") s.stamp = rec.timestamp
  const p = rec.payload
  if (!p || typeof p !== "object") return

  if (rec.type === "turn_context" || rec.type === "session_meta") {
    if (typeof p.model === "string" && p.model) s.model = p.model
    return
  }

  // The fallback for a compaction `compaction` could not read the front of.
  if (rec.type === "compacted") {
    give(
      s,
      {
        timestamp: s.stamp,
        isCompactSummary: true,
        message: { role: "user", content: [{ type: "text", text: str(p.message) }] },
      },
      out,
    )
    return
  }

  const table = rec.type === "event_msg" ? EVENTS : rec.type === "response_item" ? ITEMS : null
  const handler = table?.get(str(p.type))
  if (handler) handler(s, p, out)
}

/** A session read mid-flight ends with a turn nothing billed: it is still context, so it is still
 *  held, and the walk charges it nothing. Whatever was waiting on a model that never came goes out
 *  here too, unpriced, which is what the bill has to admit to. */
export function codexEnd(s: CodexState, out: Out): void {
  if (s.blocks.length) {
    give(s, { timestamp: s.stamp, message: { role: "assistant", content: s.blocks } }, out)
    s.blocks = []
  }
  if (s.results.length) {
    give(s, { timestamp: s.stamp, message: { role: "user", content: s.results } }, out)
    s.results = []
  }
  if (s.held) release(s, out)
}
