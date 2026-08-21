/* Codex rollouts, translated into the record shape the walk already reads, so one engine prices
   both stores. */

import type { ContentBlock, TranscriptRecord, Usage } from "./engine.ts"

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

/** What has to be known before the first line is priced: a rollout can bill a request before it
 *  writes down which model made it, and it says whose session it is only at the top. Stops at the
 *  first model, which a rollout names within its first few lines. */
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
    if (c.type === "input_image") out.push({ type: "image" })
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

/** Read one rollout as the transcript records it would have been. */
export function* codexRecords(text: string): Generator<TranscriptRecord> {
  const { model: named, sidechain } = ahead(text)
  let model = named
  /* The two halves of a request, held because a rollout writes the token count last: what the
     assistant produced, and the tool output it drew. */
  let blocks: ContentBlock[] = []
  let results: ContentBlock[] = []
  let stamp = ""
  /* The cumulative counters, for the rollouts that report a running total and no per-call one. */
  let prevTotal: number | null = null,
    prevIn = 0,
    prevCached = 0,
    prevOut = 0,
    prevWrite = 0,
    prevReason = 0

  /** The billed turn, then the output it drew -- the order a transcript writes them in, which is
   *  what keeps a tool result out of the context of the request that called for it. */
  const flush = (u: CodexUsage): TranscriptRecord[] => {
    const out: TranscriptRecord[] = []
    const reasoning = num(u.reasoning_output_tokens)
    /* Codex encrypts its reasoning but still counts it, so the block is sized by the count rather
       than by text there is none of. */
    if (reasoning > 0) blocks.push({ type: "thinking", tokens: reasoning })
    out.push({
      timestamp: stamp,
      isSidechain: sidechain,
      message: { role: "assistant", model, usage: usageOf(u), content: blocks },
    })
    if (results.length) out.push({ timestamp: stamp, message: { role: "user", content: results } })
    blocks = []
    results = []
    return out
  }

  for (const line of lines(text)) {
    let rec: CodexLine
    try {
      rec = JSON.parse(line) as CodexLine
    } catch {
      continue
    }
    if (!rec || typeof rec !== "object") continue
    if (typeof rec.timestamp === "string") stamp = rec.timestamp
    const p = rec.payload
    if (!p || typeof p !== "object") continue

    if (rec.type === "turn_context" || rec.type === "session_meta") {
      if (typeof p.model === "string" && p.model) model = p.model
      continue
    }

    /* Compaction rewrites the prefix, which the walk has to be told about or it will read the
       rewrite as content that arrived. */
    if (rec.type === "compacted") {
      yield {
        timestamp: stamp,
        isCompactSummary: true,
        message: { role: "user", content: [{ type: "text", text: str(p.message) }] },
      }
      continue
    }

    if (rec.type === "event_msg" && p.type === "token_count") {
      const info = p.info
      if (!info) continue
      const total = info.total_token_usage
      /* A rollout can write the same event twice, and the running total is what tells a repeat
         from a request. Without one there is nothing to compare, and counting a rare repeat is
         the better error: the alternative drops every request after the first. */
      if (total) {
        const cum = num(total.total_tokens)
        if (prevTotal !== null && cum === prevTotal) continue
        prevTotal = cum
      }
      let u = info.last_token_usage
      if (!u && total) {
        u = {
          input_tokens: num(total.input_tokens) - prevIn,
          cached_input_tokens: num(total.cached_input_tokens) - prevCached,
          cache_write_input_tokens: num(total.cache_write_input_tokens) - prevWrite,
          output_tokens: num(total.output_tokens) - prevOut,
          reasoning_output_tokens: num(total.reasoning_output_tokens) - prevReason,
        }
      }
      if (total) {
        prevIn = num(total.input_tokens)
        prevCached = num(total.cached_input_tokens)
        prevOut = num(total.output_tokens)
        prevWrite = num(total.cache_write_input_tokens)
        prevReason = num(total.reasoning_output_tokens)
      }
      if (!u) continue
      yield* flush(u)
      continue
    }

    /* An MCP call arrives as one event carrying both halves, so both are made here. */
    if (rec.type === "event_msg" && p.type === "mcp_tool_call_end") {
      const inv = p.invocation
      const server = str(inv?.server),
        tool = str(inv?.tool)
      if (!server || !tool) continue
      const id = str(p.call_id)
      const args = inv?.arguments
      blocks.push({
        type: "tool_use",
        id,
        name: `mcp__${server}__${tool}`,
        input: args && typeof args === "object" ? (args as Record<string, unknown>) : {},
      })
      results.push({
        type: "tool_result",
        tool_use_id: id,
        content: JSON.stringify(p.result ?? ""),
      })
      continue
    }

    if (rec.type !== "response_item") continue

    switch (p.type) {
      case "message": {
        const content = blocksOf(p.content)
        if (!content.length) break
        if (p.role === "assistant") blocks.push(...content)
        // A developer message is the harness talking, not the reader.
        else
          yield { timestamp: stamp, isMeta: p.role !== "user", message: { role: "user", content } }
        break
      }
      /* Traffic between agents, which is neither of them talking to the reader. */
      case "agent_message": {
        const content = blocksOf(p.content)
        if (content.length)
          yield { timestamp: stamp, isMeta: true, message: { role: "user", content } }
        break
      }
      case "function_call":
      case "custom_tool_call":
        blocks.push({
          type: "tool_use",
          id: str(p.call_id),
          name: str(p.name) || "(unnamed tool)",
          input: argsOf(p),
        })
        break
      case "function_call_output":
      case "custom_tool_call_output":
        results.push({
          type: "tool_result",
          tool_use_id: str(p.call_id),
          content: str(p.output) || JSON.stringify(p.output ?? ""),
        })
        break
      case "web_search_call":
        blocks.push({
          type: "tool_use",
          id: str(p.call_id),
          name: "web_search",
          input: { query: str(p.action?.query) },
        })
        break
      default:
        break
    }
  }

  /* A session read mid-flight ends with a turn nothing billed: it is still context, so it is
     still held, and the walk charges it nothing. */
  if (blocks.length) yield { timestamp: stamp, message: { role: "assistant", content: blocks } }
  if (results.length) yield { timestamp: stamp, message: { role: "user", content: results } }
}
