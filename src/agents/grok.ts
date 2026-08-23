/* Grok `updates.jsonl`, translated into the record shape the walk already reads. */

import type { ContentBlock, TranscriptRecord, Usage } from "../engine.ts"

/** Companion jsonl files in a Grok session directory: they are not the billed conversation. */
export const GROK_SIDECARS = new Set([
  "chat_history.jsonl",
  "events.jsonl",
  "rewind_points.jsonl",
  "hunk_records.jsonl",
  "prompt_history.jsonl",
  "btw_history.jsonl",
  "feedback.jsonl",
])

/** What `turn_completed` says the prompt spent, summed across every model call in it. */
interface GrokUsage {
  inputTokens?: number
  outputTokens?: number
  cachedReadTokens?: number
  /** Read by nobody: xAI counts the write inside `inputTokens` and prices it as input. */
  cacheCreationTokens?: number
  reasoningTokens?: number
  modelUsage?: Record<string, GrokUsage>
}

interface GrokToolMeta {
  name?: string
  kind?: string
  namespace?: string
  input?: unknown
}

interface GrokUpdateMeta {
  modelId?: string
  "x.ai/tool"?: GrokToolMeta
}

interface GrokContent {
  type?: string
  text?: string
  content?: unknown
}

interface GrokRawOutput {
  output_for_prompt?: unknown
}

interface GrokUpdate {
  sessionUpdate?: string
  content?: unknown
  toolCallId?: string
  title?: string
  rawInput?: unknown
  rawOutput?: GrokRawOutput
  usage?: GrokUsage
  _meta?: GrokUpdateMeta
}

interface GrokParams {
  sessionId?: string
  update?: GrokUpdate
  _meta?: { totalTokens?: number }
}

interface GrokLine {
  method?: string
  timestamp?: unknown
  type?: string
  message?: unknown
  params?: GrokParams
  hunkId?: unknown
  is_bash?: unknown
  btwSessionId?: unknown
  file_snapshots?: unknown
}

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

const GROK_METHODS = new Set(["session/update", "_x.ai/session/update"])

/** Whether this file is a Grok `updates.jsonl` rather than a Claude transcript or a Codex rollout. */
export function isGrokSession(text: string): boolean {
  let seen = 0
  for (const line of lines(text)) {
    if (++seen > 3) break
    let rec: GrokLine
    try {
      rec = JSON.parse(line) as GrokLine
    } catch {
      continue
    }
    if (!rec || typeof rec !== "object") continue
    if ("message" in rec) return false
    const method = rec.method
    const update = rec.params?.update
    if (
      typeof method === "string" &&
      GROK_METHODS.has(method) &&
      update &&
      typeof update === "object" &&
      typeof update.sessionUpdate === "string"
    )
      return true
  }
  return false
}

/* Named for the loop that writes them, so no other store's records answer to one -- a plain
   `system` or `user` is Claude Code's word too, and taking it as proof here dropped the
   transcript. */
const EVENT_TYPES = new Set(["turn_started", "phase_changed", "loop_started", "first_token"])
const OWN_KEYS = ["hunkId", "is_bash", "btwSessionId", "file_snapshots"]

/** A jsonl file that lives next to `updates.jsonl` and must not be walked as a transcript. Only
 *  what Grok alone writes counts: a false yes here drops a priced transcript, and a false no
 *  costs one unbilled empty file. */
export function isGrokSidecar(text: string): boolean {
  let seen = 0
  for (const line of lines(text)) {
    if (++seen > 3) break
    let rec: GrokLine
    try {
      rec = JSON.parse(line) as GrokLine
    } catch {
      continue
    }
    if (!rec || typeof rec !== "object") continue
    if ("message" in rec) return false
    if (typeof rec.method === "string" && GROK_METHODS.has(rec.method)) return false
    const t = rec.type
    if (typeof t === "string" && EVENT_TYPES.has(t)) return true
    if (OWN_KEYS.some((k) => k in rec)) return true
  }
  return false
}

const num = (v: unknown): number => (typeof v === "number" && v > 0 ? v : 0)
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/** ACP names the extra bag `_meta`; read by string so the identifier is not ours. */
function metaBag(o: object | undefined): Record<string, unknown> | undefined {
  if (!o) return undefined
  const m = (o as Record<string, unknown>)["_meta"]
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : undefined
}

const LOOK = 800
const UPDATE_AT = '"sessionUpdate":"'

function updateType(front: string): string {
  const at = front.indexOf(UPDATE_AT)
  if (at === -1 || at > LOOK) return ""
  const from = at + UPDATE_AT.length
  const end = front.indexOf('"', from)
  return end === -1 ? "" : front.slice(from, end)
}

/* Hooks, plans and recaps are not billed content; skipping the parse is what keeps a store of
   them from becoming a third of the walk. */
const SKIP_UPDATES = new Set([
  "hook_execution",
  "plan",
  "session_recap",
  "retry_state",
  "current_mode_update",
  "task_backgrounded",
  "task_completed",
  "rewind_marker",
])

function stampOf(ts: unknown): string {
  if (typeof ts === "string" && ts) return ts
  if (typeof ts === "number" && ts > 0) {
    const ms = ts < 1e12 ? ts * 1000 : ts
    const d = new Date(ms)
    return isNaN(d.getTime()) ? "" : d.toISOString()
  }
  return ""
}

function ahead(text: string): string {
  for (const line of lines(text)) {
    const m = /"modelId"\s*:\s*"([^"]+)"/.exec(line)
    if (m) return m[1]
  }
  return ""
}

/** xAI counts cached tokens inside `inputTokens`, the same way OpenAI does -- so the write is
 *  already in there at the plain input price, and declaring it again would bill it twice. */
function usageOf(u: GrokUsage): Usage {
  const inp = num(u.inputTokens)
  const cached = Math.min(num(u.cachedReadTokens), inp)
  return {
    input_tokens: inp - cached,
    cache_read_input_tokens: cached,
    output_tokens: num(u.outputTokens),
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map(textOf).join("")
  if (!content || typeof content !== "object") return ""
  const c = content as GrokContent
  if (typeof c.text === "string") return c.text
  if (c.content !== undefined) return textOf(c.content)
  return ""
}

function modelFromUsage(u: GrokUsage): string {
  const mu = u.modelUsage
  if (!mu || typeof mu !== "object") return ""
  let best = "",
    bestIn = -1
  for (const [id, part] of Object.entries(mu)) {
    const n = num(part?.inputTokens)
    if (n > bestIn) {
      bestIn = n
      best = id
    }
  }
  return best
}

/** Built-in tools live in `grok_build`; anything else is an MCP server. */
function toolMeta(u: GrokUpdate): GrokToolMeta | undefined {
  const tool = metaBag(u)?.["x.ai/tool"]
  return tool && typeof tool === "object" ? (tool as GrokToolMeta) : undefined
}

function toolName(u: GrokUpdate): string {
  const tool = toolMeta(u)
  const name = str(tool?.name) || str(u.title) || "(unnamed tool)"
  const ns = str(tool?.namespace)
  if (ns && ns !== "grok_build") return `mcp__${ns}__${name}`
  return name
}

function argsOf(u: GrokUpdate): Record<string, unknown> {
  const raw = u.rawInput ?? toolMeta(u)?.input
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>
    } catch {
      /* Not JSON, so it is the argument. */
    }
    return { input: raw }
  }
  return {}
}

function resultText(u: GrokUpdate): string {
  const prompt = u.rawOutput?.output_for_prompt
  if (typeof prompt === "string" && prompt) return prompt
  return textOf(u.content)
}

type Out = (rec: TranscriptRecord) => void

interface Call {
  blocks: ContentBlock[]
  results: Map<string, string>
  ctx: number
  stamp: string
  rec?: TranscriptRecord
}

export interface GrokState {
  model: string
  stamp: string
  ctx: number
  user: string
  call: Call | null
  pending: Call[]
}

export function grokOpen(head: string): GrokState {
  return {
    model: ahead(head),
    stamp: "",
    ctx: 0,
    user: "",
    call: null,
    pending: [],
  }
}

function openCall(s: GrokState): Call {
  if (!s.call) s.call = { blocks: [], results: new Map(), ctx: s.ctx, stamp: s.stamp }
  return s.call
}

function closeCall(s: GrokState): void {
  const c = s.call
  if (!c) return
  s.call = null
  if (!c.blocks.length && !c.results.size) return
  if (s.ctx > c.ctx) c.ctx = s.ctx
  if (s.stamp) c.stamp = s.stamp
  s.pending.push(c)
}

function emitUser(s: GrokState, out: Out): void {
  const text = s.user
  s.user = ""
  if (!text) return
  out({
    timestamp: s.stamp,
    message: { role: "user", content: [{ type: "text", text }] },
  })
}

function share(total: number, weights: number[], i: number, used: number): number {
  const last = i === weights.length - 1
  if (last) return Math.max(0, total - used)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!(sum > 0) || !(total > 0)) return 0
  return Math.round((total * weights[i]) / sum)
}

/** The prompt bills every model call as one total, so the walk splits that total by each call's
 *  context size -- which is what `_meta.totalTokens` recorded as the call went out. */
function applyUsage(s: GrokState, u: GrokUsage): void {
  const calls = s.pending
  /* A turn whose only output was an update the walk skips still spent the prompt, so it gets a
     call of its own to carry the usage rather than dropping it. */
  if (!calls.length) calls.push({ blocks: [], results: new Map(), ctx: s.ctx, stamp: s.stamp })
  const n = calls.length
  const model = modelFromUsage(u) || s.model
  if (model) s.model = model
  const inp = num(u.inputTokens)
  const cached = Math.min(num(u.cachedReadTokens), inp)
  const outTok = num(u.outputTokens)
  const reason = num(u.reasoningTokens)
  const weights = calls.map((c) => (c.ctx > 0 ? c.ctx : 1))
  let usedIn = 0,
    usedC = 0,
    usedO = 0,
    usedR = 0
  for (let i = 0; i < n; i++) {
    const c = calls[i]
    const iN = share(inp, weights, i, usedIn)
    const cN = share(cached, weights, i, usedC)
    const oN = share(outTok, weights, i, usedO)
    const rN = share(reason, weights, i, usedR)
    usedIn += iN
    usedC += cN
    usedO += oN
    usedR += rN
    if (rN > 0) {
      const think = c.blocks.find((b) => b.type === "thinking")
      if (think) think.tokens = rN
      else c.blocks.unshift({ type: "thinking", tokens: rN })
    }
    c.rec = {
      timestamp: c.stamp || s.stamp,
      message: {
        role: "assistant",
        model: s.model,
        usage: usageOf({ inputTokens: iN, cachedReadTokens: cN, outputTokens: oN }),
        content: c.blocks,
      },
    }
  }
}

function emitPending(s: GrokState, out: Out): void {
  const pending = s.pending
  s.pending = []
  for (const c of pending) {
    if (c.rec) out(c.rec)
    else if (c.blocks.length)
      out({
        timestamp: c.stamp || s.stamp,
        message: { role: "assistant", model: s.model, content: c.blocks },
      })
    for (const [id, text] of c.results)
      out({
        timestamp: c.stamp || s.stamp,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: id, content: text }],
        },
      })
  }
}

function findCall(s: GrokState, id: string): Call | null {
  if (s.call?.blocks.some((b) => b.type === "tool_use" && b.id === id)) return s.call
  for (let i = s.pending.length - 1; i >= 0; i--) {
    const c = s.pending[i]
    if (c.blocks.some((b) => b.type === "tool_use" && b.id === id) || c.results.has(id)) return c
  }
  return s.call || s.pending[s.pending.length - 1] || null
}

export function grokFront(_s: GrokState, front: string, _out: Out): boolean {
  const kind = updateType(front.length > LOOK ? front.slice(0, LOOK) : front)
  return SKIP_UPDATES.has(kind)
}

export function grokLine(s: GrokState, line: string, out: Out): void {
  if (grokFront(s, line, out)) return
  let rec: GrokLine
  try {
    rec = JSON.parse(line) as GrokLine
  } catch {
    return
  }
  if (!rec || typeof rec !== "object") return
  const ts = stampOf(rec.timestamp)
  if (ts) s.stamp = ts
  const p = rec.params
  if (!p || typeof p !== "object") return
  const ctx = metaBag(p)?.totalTokens
  if (typeof ctx === "number" && ctx > 0) s.ctx = ctx
  const u = p.update
  if (!u || typeof u !== "object") return
  const kind = str(u.sessionUpdate)
  const model = str(metaBag(u)?.modelId)
  if (model) s.model = model

  if (kind === "user_message_chunk") {
    /* A new prompt without `turn_completed` still has to leave in transcript order, or the next
       user line would be billed as if it arrived before the call it followed. */
    closeCall(s)
    emitPending(s, out)
    const text = textOf(u.content)
    if (text) s.user += text
    return
  }

  if (kind === "agent_thought_chunk" || kind === "agent_message_chunk") {
    emitUser(s, out)
    const call = s.call
    if (call && call.blocks.some((b) => b.type === "tool_use")) closeCall(s)
    const text = textOf(u.content)
    if (!text) return
    const cur = openCall(s)
    if (kind === "agent_thought_chunk") {
      const last = cur.blocks[cur.blocks.length - 1]
      if (last && last.type === "thinking") last.thinking = (last.thinking || "") + text
      else cur.blocks.push({ type: "thinking", thinking: text })
    } else {
      const last = cur.blocks[cur.blocks.length - 1]
      if (last && last.type === "text") last.text = (last.text || "") + text
      else cur.blocks.push({ type: "text", text })
    }
    return
  }

  if (kind === "tool_call") {
    emitUser(s, out)
    const cur = openCall(s)
    const id = str(u.toolCallId)
    cur.blocks.push({ type: "tool_use", id, name: toolName(u), input: argsOf(u) })
    return
  }

  if (kind === "tool_call_update") {
    emitUser(s, out)
    if (s.call && s.call.blocks.some((b) => b.type === "tool_use")) closeCall(s)
    const id = str(u.toolCallId)
    const text = resultText(u)
    if (!id || !text) return
    const call = findCall(s, id)
    if (call) call.results.set(id, text)
    return
  }

  if (kind === "turn_completed") {
    emitUser(s, out)
    closeCall(s)
    if (u.usage) applyUsage(s, u.usage)
    emitPending(s, out)
  }
}

export function grokEnd(s: GrokState, out: Out): void {
  emitUser(s, out)
  closeCall(s)
  emitPending(s, out)
}
