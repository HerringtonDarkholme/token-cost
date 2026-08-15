/* Cost attribution engine for Claude Code transcripts. Runs entirely client-side.
 *
 * METHOD -- "carry cost". Billing is per request, and each request bills the ENTIRE
 * input prefix (fresh input + cache read + cache write) plus its own output. So a piece
 * of content does not cost its face value; it costs its token share of every subsequent
 * request it survives in. For each request we take the exact billed cost from `usage`,
 * then allocate it across the content already in context, proportional to token share.
 * Totals are exact; the split across rows is an estimate.
 *
 * DESIGN RULES -- this file must work for transcripts it has never seen:
 *   1. Nothing is silently dropped. An unknown model, tool, tag or command is counted
 *      and surfaced, never skipped.
 *   2. Buckets are structured records ({role, tool, dir, sub}), never strings that get
 *      re-parsed by character offset.
 *   3. Classification is derived from the data (measured ratios, learned vocabulary,
 *      calibrated constants) or from a documented, published spec (POSIX shell
 *      builtins, the Anthropic rate card, the transcript schema). It is never a list
 *      of the things one particular author happens to use.
 *
 * ONE PASS. The walk is fed one file at a time -- open, one per file, close -- because a folder
 * of transcripts is bigger than a page should hold at once, and because a caller that gets the
 * frame back between files can say where it has got to. analyze() is the same thing in one call
 * for callers that already hold everything.
 *   openWalk/walkOne/closeWalk -- read each transcript exactly once; see `the walk`.
 *   billedSoFar()-- the running total, mid-walk, for a caller that wants to show it.
 *   price()      -- O(keys), so any TTL assumption or rate card is free to re-apply.
 *   buildTree()  -- decides direction splits and grouping from the measured costs.
 *   report()     -- arithmetic on the accumulators; walks nothing.
 *
 * ON THE TYPES. Transcript records are untrusted JSON from a schema that evolves without
 * asking us. So the record shapes below are open interfaces of optional fields, not closed
 * discriminated unions: rule 1 says an unfamiliar block type must still be counted, and a
 * union would force a cast at exactly the places that handle the unfamiliar case. The
 * strictness that pays off here is on the shapes this file OWNS -- buckets, trees,
 * datasets -- which are exact.
 */

/* ------------------------------------------------------------------- data in --
 * What the caller hands us, and the transcript shapes we read out of it.
 */

/** One uploaded transcript: a filename and its raw JSONL text. */
export interface RawFile {
  name: string
  text: string
}

export interface ImageSource {
  type?: string
  media_type?: string
  data?: string
}

/** A content block. Every field is optional on purpose -- see "ON THE TYPES" above. */
export interface ContentBlock {
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

export interface Message {
  role?: string
  model?: string
  usage?: Usage
  content?: unknown
}

/** One JSONL line. `isCompactSummary`, `isMeta` and `isSidechain` are real schema fields. */
export interface TranscriptRecord {
  message?: Message
  timestamp?: string
  sessionId?: string
  isCompactSummary?: boolean
  isMeta?: boolean
  isSidechain?: boolean
}

/* ------------------------------------------------------------------ pricing --
 * A rate card, not a model whitelist. Keys are matched exactly, then by longest
 * prefix, then by tier keyword; anything still unresolved is reported as unpriced
 * rather than dropped. Rates are $ per 1M tokens, [input, output].
 * Override or extend at runtime with setRates() -- no source edit required.
 */

/** $ per 1M tokens, as [input, output]. */
export type Rate = [input: number, output: number]

export const RATES: Record<string, Rate> = {
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
/* Last resort before giving up: the tier word implies the current rate for that tier. */
const TIERS: Array<[RegExp, Rate]> = [
  [/\bopus\b|opus/, [5, 25]],
  [/sonnet/, [3, 15]],
  [/haiku/, [1, 5]],
  [/fable|mythos/, [10, 50]],
]

/** Which cache-write multiplier a TTL implies. */
export type TtlAssumption = "1h" | "5m"

export const CACHE_READ_MULT = 0.1
export const CACHE_WRITE_MULT: Record<TtlAssumption, number> = { "1h": 2.0, "5m": 1.25 }

export function setRates(partial: Record<string, Rate>): void {
  Object.assign(RATES, partial)
}

/** Strip the decorations cloud vendors and release dates add, so one card serves all. */
export function normalizeModel(id: unknown): string {
  let m = String(id || "")
    .toLowerCase()
    .trim()
  m = m.replace(/\[[^\]]*\]/g, "") // context-window suffix: [1m]
  m = m.replace(/^publishers\/anthropic\/models\//, "") // Vertex AI
  // Bedrock stacks these: "us.anthropic.claude-…" is a region prefix on a vendor prefix.
  for (let prev: string | null = null; prev !== m;) {
    prev = m
    m = m.replace(/^(anthropic|us|eu|apac|global|gov)\./, "")
  }
  m = m.replace(/[:@]\d+(\.\d+)?$/, "") // :0, @1
  m = m.replace(/-v\d+$/, "") // -v1
  m = m.replace(/[-@](\d{8}|\d{6})$/, "") // -20250219 / @250219
  m = m.replace(/-latest$/, "")
  return m.replace(/-+$/, "")
}

/** The outcome of pricing a model id. `basis` explains the match so the UI can show its
 *  work; `rate` is null when nothing matched. Never throws, never returns undefined. */
export interface RateResolution {
  rate: Rate | null
  basis: string
  id: string
}

export function resolveRate(model: unknown): RateResolution {
  const raw = String(model || "")
  if (!raw) return { rate: null, basis: "missing", id: raw }
  // Claude Code writes <synthetic> for records it produced locally with no API call.
  if (raw.startsWith("<")) return { rate: null, basis: "synthetic", id: raw }
  const id = normalizeModel(raw)
  const exact = RATES[id]
  if (exact) return { rate: exact, basis: "exact", id }
  let best: string | null = null
  for (const k of Object.keys(RATES)) {
    if (id.startsWith(k) && (!best || k.length > best.length)) best = k
  }
  if (best) return { rate: RATES[best], basis: "prefix:" + best, id }
  for (const [re, rate] of TIERS) if (re.test(id)) return { rate, basis: "tier", id }
  return { rate: null, basis: "unpriced", id }
}

/* ------------------------------------------------------- shell interpretation --
 * The sets below are the shell language, not a taste list: POSIX special builtins
 * and reserved words. Everything program-specific (which commands take subcommands,
 * which ones matter) is learned from the corpus as it is read.
 */
const KEYWORDS = new Set([
  "for",
  "while",
  "until",
  "if",
  "elif",
  "case",
  "esac",
  "select",
  "function",
  "do",
  "done",
  "then",
  "else",
  "fi",
  "in",
  "{",
  "}",
  "[[",
  "]]",
  "time",
])
/** Builtins that only change shell state -- they are never "the command that ran". */
const STATE_ONLY = new Set([
  "cd",
  "export",
  "set",
  "unset",
  "shopt",
  "alias",
  "unalias",
  "pushd",
  "popd",
  "dirs",
  "umask",
  "local",
  "readonly",
  "declare",
  "typeset",
  "source",
  ".",
  "eval",
  "trap",
  "hash",
  "ulimit",
  "shift",
  "getopts",
  "let",
])
/** Builtins that exec another command in place -- transparent, skip to the real one. */
const EXEC_WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "nohup",
  "command",
  "builtin",
  "exec",
  "time",
  "timeout",
  "stdbuf",
  "nice",
  "ionice",
  "setsid",
  "unbuffer",
  "script",
  "xargs",
  "watch",
])
/** Builtins that emit but do no work -- outranked by any external command present. */
const NO_WORK = new Set([
  "echo",
  "printf",
  "true",
  "false",
  ":",
  "test",
  "[",
  "read",
  "wait",
  "times",
  "sleep",
  "pwd",
  "type",
  "jobs",
  "kill",
  "trap",
])

/** Split a shell string on top-level | || && ; and newlines, honouring quotes,
 *  parens/brackets/braces, and skipping heredoc bodies entirely. */
export function splitSegments(cmd: string): string[] {
  const segs: string[] = []
  let buf = "",
    i = 0,
    depth = 0
  let quote: string | null = null,
    pending: string | null = null
  const n = cmd.length
  while (i < n) {
    const c = cmd[i]
    if (quote) {
      if (c === "\\" && quote === '"') {
        buf += cmd.slice(i, i + 2)
        i += 2
        continue
      }
      if (c === quote) quote = null
      buf += c
      i++
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      buf += c
      i++
      continue
    }
    // `<<TAG` only *arms* a heredoc: the rest of THIS line is still part of the pipeline
    // (`cat <<EOF | grep x`), and the body starts at the next newline. Recording it as
    // pending keeps both halves right; consuming the line immediately loses the pipe, and
    // resuming into the same buffer afterwards silently welds the next command onto this
    // one (which is how `python3 - <<PY … PY` + `grep foo` became "python3 grep").
    if (cmd.startsWith("<<", i) && cmd[i + 2] !== "<") {
      let j = i + 2
      if (cmd[j] === "-") j++
      while (j < n && /\s/.test(cmd[j])) j++
      let q: string | null = null
      if (cmd[j] === "'" || cmd[j] === '"') {
        q = cmd[j]
        j++
      }
      let tag = ""
      while (j < n && (/[\w-]/.test(cmd[j]) || (q && cmd[j] !== q))) {
        tag += cmd[j]
        j++
      }
      if (q && cmd[j] === q) j++
      if (tag) {
        pending = tag
        i = j
        continue
      }
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++
      buf += c
      i++
      continue
    }
    if (c === ")" || c === "]" || c === "}") {
      depth = Math.max(0, depth - 1)
      buf += c
      i++
      continue
    }
    if (depth === 0) {
      if (cmd.startsWith("&&", i) || cmd.startsWith("||", i)) {
        segs.push(buf)
        buf = ""
        i += 2
        continue
      }
      if (c === "|" || c === ";") {
        segs.push(buf)
        buf = ""
        i++
        continue
      }
      if (c === "\n") {
        segs.push(buf)
        buf = ""
        i++
        if (pending !== null) {
          // skip the heredoc body, then carry on
          while (i < n) {
            const nl = cmd.indexOf("\n", i)
            const line = cmd.slice(i, nl === -1 ? n : nl).trim()
            i = nl === -1 ? n : nl + 1
            if (line === pending) break
          }
          pending = null
        }
        continue
      }
    }
    buf += c
    i++
  }
  segs.push(buf)
  return segs.map((s) => s.trim()).filter(Boolean)
}

/** Could this word be a subcommand verb? A bare lowercase-ish token -- not a flag,
 *  path, filename, number, URL or variable. Whether it IS one is decided by the corpus. */
function isVerbShaped(w: string): boolean {
  return (
    !!w &&
    w.length <= 24 &&
    /^[a-z][a-z0-9]*([-_:][a-z0-9]+)*$/.test(w) &&
    !/^\d/.test(w) &&
    !KEYWORDS.has(w)
  )
}

/** One resolved pipeline segment.
 *  `rank` orders candidates for labelling a whole invocation: 0 = external command
 *  (real work), 1 = builtin that emits but does no work, 2 = state-only builtin. */
export interface Segment {
  prog: string
  verb: string | null
  rank: number
}

export function resolveSegment(seg: string): Segment | null {
  const words = seg.replace(/[()]/g, " ").split(/\s+/).filter(Boolean)
  if (!words.length || words[0].startsWith("#")) return null // comment line
  let idx = 0,
    wrapped = false
  while (idx < words.length) {
    const w = words[idx]
    if (/^[A-Za-z_]\w*=/.test(w)) {
      idx++
      continue
    } // VAR=value prefix
    if (EXEC_WRAPPERS.has(w)) {
      idx++
      wrapped = true
      continue
    } // sudo/env/timeout/...
    if (KEYWORDS.has(w)) return null // control flow, not a command
    // A wrapper takes its own options before the command it execs: `timeout 5 kubectl`,
    // `xargs -n1 grep`, `nice -n10 cargo`. Skip flags and duration/count values.
    // (A flag whose value is a bare word -- `sudo -u alice cmd` -- still resolves to the
    // value; that needs per-wrapper arity, so it is reported as-is rather than guessed.)
    if (wrapped && (w.startsWith("-") || /^\d+(\.\d+)?[smhd]?$/.test(w))) {
      idx++
      continue
    }
    break
  }
  if (idx >= words.length) return null
  const prog = (words[idx].split("/").pop() || "").replace(/^[$(]+/, "").replace(/^["']|["']$/g, "")
  if (!prog || prog.startsWith("-") || prog.startsWith("$")) return null
  const rank = STATE_ONLY.has(prog) ? 2 : NO_WORK.has(prog) ? 1 : 0
  let verb: string | null = null
  for (const w of words.slice(idx + 1)) {
    if (w.startsWith("-")) continue // flags are not verbs
    if (isVerbShaped(w)) verb = w
    break // only the first operand
  }
  return { prog, verb, rank }
}

/** Every (program, candidate-verb) pair a Bash invocation contains -- the raw material
 *  the walk aggregates to learn which programs actually dispatch subcommands. */
export function shellCandidates(cmd: string): Segment[] {
  return splitSegments(cmd)
    .map(resolveSegment)
    .filter((s): s is Segment => s !== null)
}

/** Which segment of a command line is doing the real work. Lowest rank wins, and the first
 *  of a tie: a pipeline's payload is the thing that is not a builtin. */
function pickSegment(cands: readonly Segment[]): Segment | null {
  let pick: Segment | null = null
  for (const c of cands) if (!pick || c.rank < pick.rank) pick = c
  return pick
}

/** Label an invocation: pick the segment doing real work, then apply the learned
 *  vocabulary to decide whether its second token is a subcommand.
 *  @param dispatchers programs the walk observed dispatching subcommands */
export function labelShell(
  cmd: string,
  dispatchers?: Set<string> | null,
): { prog: string; verb: string | null } {
  const pick = pickSegment(shellCandidates(cmd))
  if (!pick) return { prog: "(no command)", verb: null }
  const verb = pick.verb && dispatchers && dispatchers.has(pick.prog) ? pick.verb : null
  return { prog: pick.prog, verb }
}

/* ------------------------------------------------------------- content sizing --
 * Token counts are estimated from character length. The divisor is CALIBRATED per
 * dataset rather than assumed, using an identity that holds exactly:
 *
 *   Δ(context tokens) between consecutive requests
 *     = the previous turn's output_tokens  +  the user-side content added since
 *
 * The first term is reported exactly by `usage`, so subtracting it isolates content
 * that IS fully persisted in the transcript (tool results and typed text) from content
 * that is not (thinking text, which is replaced by a signature). Regressing against the
 * raw delta instead charges invisible thinking tokens to visible characters and lands
 * near 2.2 chars/token -- below anything real text can be.
 *
 * TWO densities, not one. Machine text (tool output, JSON arguments, source) tokenises
 * far denser than prose, so a single constant is wrong for one of them no matter which
 * value it takes. Each interval contributes one equation
 *
 *   userTokens = codeChars * a  +  textChars * b        (a = 1/density, per class)
 *
 * and the whole dataset is solved for [a, b] by least squares. Falls back to a pooled
 * single density when there is not enough of one class to identify both.
 */
const CPT_FALLBACK = 4.0,
  CPT_MIN = 1.5,
  CPT_MAX = 12.0
const clampCpt = (v: number): number => Math.min(CPT_MAX, Math.max(CPT_MIN, v))

/** Chars-per-token, per content class, plus how it was arrived at. */
export interface Density {
  code: number
  text: number
  basis: "least-squares" | "pooled" | "default"
  pooled: number
  relSE?: [number, number] | null
}

/** Cross-product accumulators for the two-class least-squares fit. */
interface Accum {
  cc: number
  ct: number
  tt: number
  cy: number
  ty: number
  yy: number
  n: number
  code: number
  text: number
  tok: number
}

/** Least squares for userTokens = code*a + text*b, returned as densities (chars/token).
 *
 *  Whether the two classes can be told apart is decided by the STANDARD ERROR of each
 *  fitted coefficient, not by a threshold on how much of each class happens to be
 *  present. If one class is too sparse or too collinear with the other to pin down, its
 *  error bar blows up and the fit is rejected in favour of a single pooled density --
 *  automatically, and for the actual reason. A share-of-corpus floor would instead reject
 *  perfectly identifiable fits (this was measured: a corpus with only 3% prose still
 *  yields collinearity of 0.0004, i.e. cleanly separable).
 *
 *  Note there is no assumption about which class is denser. Harness-injected "text" is
 *  often markdown and config rather than prose, and does measure denser than tool output
 *  in some corpora; encoding a prior about that would just be another hardcoded opinion.
 */
const MAX_REL_SE = 0.25
function solveDensities(S: Accum): Density | null {
  const { cc, ct, tt, cy, ty, yy, n, code, text, tok } = S
  if (n < 20 || tok <= 0) return null
  const pooled = clampCpt((code + text) / tok)
  const fallback: Density = { code: pooled, text: pooled, basis: "pooled", pooled, relSE: null }
  const det = cc * tt - ct * ct
  if (!(det > 0)) return fallback

  const a = (cy * tt - ty * ct) / det,
    b = (ty * cc - cy * ct) / det
  if (!(a > 0) || !(b > 0)) return fallback
  // Residual sum of squares, then the usual (X'X)^-1 * sigma^2 coefficient variances.
  const rss = yy - 2 * a * cy - 2 * b * ty + a * a * cc + 2 * a * b * ct + b * b * tt
  if (!(rss >= 0) || n <= 2) return fallback
  const s2 = rss / (n - 2)
  const seA = Math.sqrt((s2 * tt) / det),
    seB = Math.sqrt((s2 * cc) / det)
  const relSE: [number, number] = [seA / a, seB / b]
  if (relSE[0] > MAX_REL_SE || relSE[1] > MAX_REL_SE) return fallback
  return { code: clampCpt(1 / a), text: clampCpt(1 / b), basis: "least-squares", pooled, relSE }
}

/** Characters of billable text in a content block. Images are excluded here and
 *  sized separately -- they bill by pixel dimensions, so their base64 length is
 *  meaningless (counting it once inflated a run by 40%). */
export function charsOf(block: unknown): number {
  if (typeof block === "string") return block.length
  if (Array.isArray(block)) return block.reduce<number>((n, b) => n + charsOf(b), 0)
  if (!block || typeof block !== "object") return 0
  const b = block as ContentBlock
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
  const b = block as ContentBlock
  if (b.type === "text") return b.text || ""
  if (b.type === "tool_result") return textOf(b.content)
  return ""
}

/* Image tokens from real dimensions. Anthropic bills roughly (w*h)/750 tokens and caps
 * long edges at 1568px, so a decoded header beats any flat constant. Only the first few
 * KB are decoded; unparseable or absent data falls back to a mid-size estimate. */
const IMAGE_FALLBACK = 1500,
  IMAGE_CAP = 1600
function b64Bytes(data: unknown, limit: number): Uint8Array | null {
  try {
    const clean = String(data)
      .replace(/^data:[^,]*,/, "")
      .replace(/[^A-Za-z0-9+/=]/g, "")
    const slice = clean.slice(0, Math.ceil(limit / 3) * 4)
    const bin =
      typeof atob === "function"
        ? atob(slice.replace(/=+$/, ""))
        : Buffer.from(slice, "base64").toString("binary")
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** Pixel dimensions decoded from an image header. */
export interface ImageDims {
  w: number
  h: number
}

export function imageDims(b: ContentBlock | null | undefined): ImageDims | null {
  const src = (b && b.source) || {}
  if (src.type === "url" || !src.data) return null
  const B = b64Bytes(src.data, 65536)
  if (!B || B.length < 24) return null
  const be16 = (i: number) => (B[i] << 8) | B[i + 1]
  const be32 = (i: number) => ((B[i] << 24) | (B[i + 1] << 16) | (B[i + 2] << 8) | B[i + 3]) >>> 0
  if (B[0] === 0x89 && B[1] === 0x50) return { w: be32(16), h: be32(20) } // PNG IHDR
  if (B[0] === 0x47 && B[1] === 0x49) return { w: B[6] | (B[7] << 8), h: B[8] | (B[9] << 8) } // GIF
  if (B[0] === 0xff && B[1] === 0xd8) {
    // JPEG: find SOFn
    let i = 2
    while (i + 9 < B.length) {
      if (B[i] !== 0xff) {
        i++
        continue
      }
      const mk = B[i + 1]
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc)
        return { h: be16(i + 5), w: be16(i + 7) }
      if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd9)) {
        i += 2
        continue
      }
      i += 2 + be16(i + 2)
    }
    return null
  }
  if (B[8] === 0x57 && B[9] === 0x45 && B[10] === 0x42 && B[11] === 0x50) {
    // WEBP
    const le16 = (i: number) => B[i] | (B[i + 1] << 8)
    if (B[15] === 0x58)
      return {
        w: (B[24] | (B[25] << 8) | (B[26] << 16)) + 1,
        h: (B[27] | (B[28] << 8) | (B[29] << 16)) + 1,
      }
    if (B[15] === 0x20) return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff }
    return null
  }
  return null
}
function imageTokens(b: ContentBlock): number {
  const d = imageDims(b)
  if (!d || !d.w || !d.h || d.w > 20000 || d.h > 20000) return IMAGE_FALLBACK
  const scale = Math.min(1, 1568 / Math.max(d.w, d.h)) // long edge is clamped
  return Math.max(1, Math.min(IMAGE_CAP, Math.round((d.w * scale * d.h * scale) / 750)))
}

/* -------------------------------------------------------------------- records --
 * A bucket is a record, and its key is derived from the record. Nothing downstream
 * parses a label by character offset.
 */

/** Where a piece of content sits in the request cycle. */
export type Role = "preamble" | "harness" | "typed" | "assistant" | "tool" | "image"

/** A cost bucket, as a record. Its key is derived from it by keyOf(). */
export interface Bucket {
  role: Role
  tool?: string
  dir?: "call" | "result"
  sub?: string | null
  kind?: string
  shell?: boolean
}

const keyOf = (r: Bucket): string =>
  [r.role, r.tool || "", r.dir || "", r.sub || "", r.kind || ""].join(" ")

/** Harness-injected user content, identified structurally where the schema allows and
 *  by its own wrapper tag otherwise -- so an unfamiliar tag becomes its own row instead
 *  of being misfiled as something the human typed. */
const TAG_SPAN = /<([a-z][a-z0-9_-]*)>([\s\S]*?)<\/\1>/gi
const TAG_OPEN = /^\s*<([a-z][a-z0-9_-]*)>/i

/** One span of a user block, attributed to whoever actually produced it. */
export interface UserSpan {
  role: "harness" | "typed"
  sub: string | null
  chars: number
}

/** Split one user block into harness-injected spans and whatever is left, which is what
 *  the human actually typed.
 *
 *  Injected content is not always the whole block: a harness routinely appends reminders
 *  after a typed message, so matching only a tag at position 0 charges those characters to
 *  the human. Tag names are read out of the text rather than compared against a list, so a
 *  wrapper this build has never seen still gets its own row. */
export function classifyUserBlock(text: string, rec?: TranscriptRecord): UserSpan[] {
  if (rec && rec.isCompactSummary === true)
    return [{ role: "harness", sub: "compaction summary", chars: text.length }]
  const out: UserSpan[] = []
  let covered = 0
  TAG_SPAN.lastIndex = 0
  for (let m: RegExpExecArray | null; (m = TAG_SPAN.exec(text));) {
    out.push({ role: "harness", sub: "<" + m[1].toLowerCase() + ">", chars: m[0].length })
    covered += m[0].length
  }
  const rest = text.length - covered
  if (rest > 0) {
    // An unterminated wrapper still identifies the block it opens.
    const open = out.length ? null : TAG_OPEN.exec(text)
    if (open) out.push({ role: "harness", sub: "<" + open[1].toLowerCase() + ">", chars: rest })
    else if (rec && rec.isMeta === true)
      out.push({ role: "harness", sub: "harness metadata", chars: rest })
    else out.push({ role: "typed", sub: null, chars: rest })
  }
  return out
}

/** What a tool call says about itself. Detected by FIELD SHAPE, not by tool name, so it works
 *  for a shell tool or file tool nobody has registered:
 *    - a `command`-ish string  -> the program it runs, and the word after it
 *    - a path-ish string       -> the file extension
 *
 *  `verb` is that word after the program, and it stays a *candidate*: whether it is a
 *  subcommand or an operand is a question about the whole corpus, and the corpus has not been
 *  read yet when this is asked. See `Slot`.
 *
 *  `cands` is the raw material for that same question -- every (program, candidate verb) pair
 *  in the command line -- handed back rather than left to be recomputed, because the walk needs
 *  both answers about the same string and splitting a command line is not free. */
const PATH_FIELDS = ["file_path", "filePath", "path", "notebook_path", "notebookPath", "file"]
interface ToolKey {
  sub: string | null
  verb: string | null
  shell: boolean
  cands: readonly Segment[]
}
const NO_KEY: ToolKey = { sub: null, verb: null, shell: false, cands: [] }
function readTool(input: unknown): ToolKey {
  if (!input || typeof input !== "object") return NO_KEY
  const rec = input as Record<string, unknown>
  for (const f of ["command", "cmd", "script", "shell_command"]) {
    const v = rec[f]
    if (typeof v === "string" && v.trim()) {
      const cands = shellCandidates(v)
      const pick = pickSegment(cands)
      if (!pick) return { sub: "(no command)", verb: null, shell: true, cands }
      return { sub: pick.prog, verb: pick.verb, shell: true, cands }
    }
  }
  for (const f of PATH_FIELDS) {
    const v = rec[f]
    if (typeof v === "string" && v.trim()) {
      const base = v.split(/[\\/]/).pop() || ""
      const dot = base.lastIndexOf(".")
      const ext = dot > 0 ? base.slice(dot).toLowerCase() : "(no extension)"
      return { sub: ext.length <= 12 ? "*" + ext : "(other)", verb: null, shell: false, cands: [] }
    }
  }
  return NO_KEY
}

/** Display name for a tool. MCP's `mcp__<server>__<tool>` is a protocol convention,
 *  so it is parsed generically -- no gateway-specific prefix is stripped by name. */
export function toolDisplay(tool: string): string {
  if (!tool.startsWith("mcp__")) return tool
  const p = tool.split("__").filter(Boolean)
  return p.length >= 3 ? `${p[1]} · ${p.slice(2).join("__")}` : tool
}

/* ------------------------------------------------------------------- the walk --
 * One pass. Every transcript is opened once, parsed once, and let go of.
 *
 * It used to be two, and the second one existed for two constants. A first pass calibrated
 * chars-per-token and learned which programs dispatch subcommands; a second re-read every file
 * to spend them. That is the folder off the disk twice and -- far more expensive -- a few
 * hundred megabytes of JSON.parse twice, to reach numbers the first walk had already gone past.
 *
 * What actually needs the calibration is only the SPLIT. The bill itself is arithmetic on
 * `usage` and a published rate: it needs no constant this file fits, so it is added up as the
 * files go by and is exact from the first one -- which is what lets a caller show a total that
 * climbs while the folder is being read, rather than a figure that sits at nothing until the
 * end. What is deferred is the attribution, and it is deferred as measurements rather than as
 * text: each piece of content that enters a context keeps its bucket and its character count,
 * and each request keeps what it cost and how big the context it paid for was. Nothing else is
 * kept, and the transcript is dropped at the end of the file it came out of.
 *
 * That held half is smaller than what it came from by two orders of magnitude. Measured on a
 * real store: 363MB of transcript leaves about 96,000 of these records and 10MB of memory at
 * the end of the read. So reading the folder once and holding the measurements beats reading it
 * twice and holding nothing.
 */
const SESSION_RE = /"sessionId"\s*:\s*"([^"]+)"/

/** A copy of `s` that no longer points at whatever it was cut out of.
 *
 *  A substring is a VIEW, not a copy: V8 records it as a pointer to the original string and two
 *  offsets. So keeping a 36-character session id out of a transcript keeps the whole
 *  megabyte the id was found in, and keeping one per file keeps the folder -- which is exactly
 *  what a walk that holds one transcript at a time is written to avoid. Measured on a real
 *  store: 331 files, 363MB of text, all of it still resident at the end of the read because a
 *  `Set` of ids was holding it. Concatenating and re-slicing forces the characters to be
 *  copied, and the transcript goes when the file does. */
const detach = (s: string): string => (" " + s).slice(1)

/* Which programs dispatch subcommands is LEARNED, because any list of them is a list of
 * one author's toolchain. Three properties separate a real multiplexer from a program
 * that merely takes an argument, and all three are needed:
 *
 *   coverage  -- `git`/`docker`/`poetry` are called with a verb-shaped first operand
 *                nearly every time. `ls`, `rm`, `find`, `grep` are usually given a path,
 *                glob, quoted string or flag instead, so their coverage is low.
 *   repetition-- a verb vocabulary is closed and reused: distinct/observed is tiny for
 *                `git` (~10 verbs over hundreds of calls) and near 1.0 for `grep`, whose
 *                operand is a different search pattern almost every time.
 * State-only and no-work builtins (`cd`, `echo`) are excluded outright: their operand is
 * a path or a string, never a subcommand.
 *
 * Both thresholds are scale-free ratios on purpose. An absolute cap on vocabulary size
 * would be one more arbitrary constant, and it misfires immediately: `git` is used with 42
 * distinct subcommands in the corpus this was tested on, so a "max 40 verbs" rule would
 * reject the most obvious dispatcher there is.
 */
const DISPATCH_MIN_CALLS = 5,
  DISPATCH_MIN_COVERAGE = 0.6,
  DISPATCH_MAX_RATIO = 0.5

/** What the corpus turned out to be: how many files were worth reading, and the constants that
 *  could not be known until all of them had been. A count rather than the files themselves,
 *  because holding them is the thing this is written to avoid -- see the walk, above. */
export interface Scanned {
  filesUsed: number
  duplicatesDropped: number
  badLines: number
  dispatchers: Set<string>
  density: Density
  densitySamples: number
  densityCalibrated: boolean
}

/** A bucket the walk has met, and the one thing about it the walk cannot settle: whether the
 *  word after a program is a subcommand or an operand, which is a question about the corpus
 *  rather than about the call. Slots are interned, so a hundred thousand context additions
 *  carry an index each rather than a record each. */
interface Slot {
  rec: Bucket
  /** The candidate subcommand, or `null` where there is no question to answer. */
  verb: string | null
}

/** Content that entered a context, held until there is a density to size it with: which slot
 *  it belongs to, how much of it there was, and what that measurement is in. Characters,
 *  except for images -- they bill by pixel dimensions, so they arrive already in tokens. */
interface Add {
  slot: number
  amt: number
  cls: "code" | "text" | "tokens"
}

/** A request that was billed. What it cost is already exact; what it cost *for* is not, so the
 *  context it paid for is recorded as a position in the file's additions rather than as a
 *  share of anything. The output split is held as characters for the same reason the input is. */
interface Charge {
  /** How many of the file's additions were in context when this request was made. */
  at: number
  ctxTokens: number
  /** TTL-invariant input cost, TTL-dependent input cost, output cost. */
  f: number
  v: number
  outCost: number
  /** Output tokens, which is what the split of the output cost is a split of. */
  outTokens: number
  proseChars: number
  argsChars: number
}

/** One file's half of the deferral. Per file, because a context is per session: the map the
 *  additions build up is thrown away at the end of each one. */
interface Held {
  adds: Add[]
  charges: Charge[]
}

/** The walk, mid-flight.
 *
 *  It is fed one file at a time rather than handed the corpus, and that is the whole point of
 *  it being shaped this way: a few hundred megabytes of transcript is a few hundred megabytes
 *  of JavaScript string, twice that in memory, and reading the lot before starting means the
 *  page holds all of it while it works. Fed a file at a time it holds one -- and the caller
 *  gets the event loop back between them, which is what lets a progress display be something
 *  other than a lie. */
export interface Walk {
  seen: Set<string>
  /** prog -> {calls, withVerb, set:Set<verb>} */
  verbs: Map<string, { calls: number; withVerb: number; set: Set<string> }>
  /** Accumulators for the two-class least-squares fit described above. */
  S: Accum
  filesUsed: number
  duplicatesDropped: number
  badLines: number
  /** The interned buckets, and the index each one was given. */
  slots: Slot[]
  slotAt: Map<string, number>
  /** What each file left to be scored once the corpus had been read. */
  held: Held[]
  /* Everything below needs no calibration, so it is final the moment the file is read. */
  billed: { f: number; v: number; out: number }
  /** raw id -> {n, basis, rate} */
  models: Map<string, ModelSighting>
  /** raw id -> requests skipped from pricing */
  unpriced: Map<string, number>
  ttl: TtlTokens
  requests: number
  sessions: number
  sidechainRequests: number
  tMin: number | null
  tMax: number | null
  firstCtx: number[]
}

/** The preamble -- system prompt and tool schemas -- is slot 0. It is the one bucket that is
 *  not measured from anything in the transcript, so nothing can add to it and it needs no
 *  interning; every file's first request finds it already there. */
const PRE_REC: Bucket = { role: "preamble" }
const PRE_SLOT = 0

/** The three things output is split into. Fixed buckets, so their keys are worth having once. */
const OUT_RECS: readonly Bucket[] = [
  { role: "assistant", kind: "thinking" },
  { role: "assistant", kind: "prose" },
  { role: "assistant", kind: "tool-args" },
]
const OUT_KEYS = OUT_RECS.map(keyOf)

/** A slot is a bucket plus its unanswered question, so it is keyed by both. The separator is
 *  the one character a tool name, a path or a program cannot contain. */
const slotKey = (rec: Bucket, verb: string | null): string => keyOf(rec) + "\u0000" + (verb || "")

export function openWalk(): Walk {
  return {
    seen: new Set(),
    verbs: new Map(),
    S: { cc: 0, ct: 0, tt: 0, cy: 0, ty: 0, yy: 0, n: 0, code: 0, text: 0, tok: 0 },
    filesUsed: 0,
    duplicatesDropped: 0,
    badLines: 0,
    slots: [{ rec: PRE_REC, verb: null }],
    slotAt: new Map([[slotKey(PRE_REC, null), PRE_SLOT]]),
    held: [],
    billed: { f: 0, v: 0, out: 0 },
    models: new Map(),
    unpriced: new Map(),
    ttl: { "1h": 0, "5m": 0, unknown: 0 },
    requests: 0,
    sessions: 0,
    sidechainRequests: 0,
    tMin: null,
    tMax: null,
    firstCtx: [],
  }
}

/** Note content that has entered the context. Nothing is sized here -- that is the point --
 *  but nothing empty is kept either: a block of no characters costs nothing under any density,
 *  and a transcript is full of them. */
function hold(
  st: Walk,
  h: Held,
  rec: Bucket,
  verb: string | null,
  amt: number,
  cls: Add["cls"],
): void {
  if (!(amt > 0)) return
  const k = slotKey(rec, verb)
  let slot = st.slotAt.get(k)
  if (slot === undefined) {
    slot = st.slots.length
    st.slots.push({ rec, verb })
    st.slotAt.set(k, slot)
  }
  h.adds.push({ slot, amt, cls })
}

/** Read one file into `st`. `false` means it was a duplicate of one already read -- the answer
 *  goes back to the caller because the caller is the one keeping count of what it handed over.
 *
 *  Two jobs at once, on one parse of each line: what this file *costs*, which is exact, and
 *  what it *teaches* -- the calibration samples and the dispatcher vote -- which is only worth
 *  anything once every other file has voted too. */
export function walkOne(st: Walk, f: RawFile): boolean {
  const m = SESSION_RE.exec(f.text || "")
  const id = detach((m ? m[1] : f.name) + "::" + (f.text || "").length)
  if (st.seen.has(id)) {
    st.duplicatesDropped++
    return false
  }
  st.seen.add(id)
  st.filesUsed++

  const { verbs, S, billed, models, unpriced, ttl, firstCtx } = st
  const h: Held = { adds: [], charges: [] }
  st.held.push(h)

  /* Per file, and thrown away with it: what the calibration is measuring across the interval
     between two requests, what the tool calls in this session were called, and whether this
     session has been counted yet. */
  let prevTokens: number | null = null,
    prevOut = 0,
    codeChars = 0,
    textChars = 0,
    dirty = false,
    sawRequest = false
  const toolOf = new Map<
    string,
    { tool: string; sub: string | null; verb: string | null; shell: boolean }
  >()

  for (const line of f.text.split("\n")) {
    const s = line.trim()
    if (!s) continue
    let rec: TranscriptRecord
    try {
      rec = JSON.parse(s) as TranscriptRecord
    } catch {
      st.badLines++
      continue
    }
    if (typeof rec.timestamp === "string") {
      const t = Date.parse(rec.timestamp)
      if (!isNaN(t)) {
        if (st.tMin === null || t < st.tMin) st.tMin = t
        if (st.tMax === null || t > st.tMax) st.tMax = t
      }
    }
    const msg = rec.message
    if (!msg || typeof msg !== "object") continue
    let content: ContentBlock[]
    if (typeof msg.content === "string") content = [{ type: "text", text: msg.content }]
    else if (Array.isArray(msg.content)) content = msg.content as ContentBlock[]
    else content = []

    if (msg.role === "assistant") {
      const u = msg.usage || {}
      const inp = u.input_tokens || 0
      const cr = u.cache_read_input_tokens || 0
      const cw = u.cache_creation_input_tokens || 0
      const out = u.output_tokens || 0
      const ctxTokens = inp + cr + cw

      if (ctxTokens) {
        // Δcontext − previous output_tokens == tokens for the user-side content we
        // can actually measure. Anything invisible is accounted for by the first term.
        const chars = codeChars + textChars
        if (prevTokens !== null && !dirty && chars > 400) {
          const y = ctxTokens - prevTokens - prevOut
          // Keep only physically plausible observations; a delta outside this band
          // means the prefix was rewritten, not appended to.
          if (y > 50 && chars / y >= CPT_MIN / 2 && chars / y <= CPT_MAX * 2) {
            const c = codeChars,
              t = textChars
            S.cc += c * c
            S.ct += c * t
            S.tt += t * t
            S.cy += c * y
            S.ty += t * y
            S.yy += y * y
            S.code += c
            S.text += t
            S.tok += y
            S.n++
          }
        }
        prevTokens = ctxTokens
        prevOut = out
        codeChars = 0
        textChars = 0
        dirty = false
      }

      const { rate, basis } = resolveRate(msg.model)
      if (msg.model) {
        const e = models.get(msg.model) || { n: 0, basis, rate }
        e.n++
        models.set(msg.model, e)
      }

      if (rate && ctxTokens) {
        st.requests++
        if (rec.isSidechain === true) st.sidechainRequests++
        if (!sawRequest) {
          st.sessions++
          sawRequest = true
          firstCtx.push(ctxTokens)
        }
        const [pIn, pOut] = rate

        // The transcript records the cache-write TTL split per request. Use it, and
        // only fall back to an assumed multiplier for the residual it omits.
        const cc =
          u.cache_creation && typeof u.cache_creation === "object" ? u.cache_creation : null
        let w1 = 0,
          w5 = 0
        if (cc) {
          w1 = cc.ephemeral_1h_input_tokens || 0
          w5 = cc.ephemeral_5m_input_tokens || 0
          if (w1 + w5 > cw) {
            const k = cw / (w1 + w5)
            w1 *= k
            w5 *= k
          } // trust the total
        }
        const wUnknown = Math.max(0, cw - w1 - w5)
        ttl["1h"] += w1
        ttl["5m"] += w5
        ttl.unknown += wUnknown

        const fixedIn =
          (inp * pIn +
            cr * pIn * CACHE_READ_MULT +
            w1 * pIn * CACHE_WRITE_MULT["1h"] +
            w5 * pIn * CACHE_WRITE_MULT["5m"]) /
          1e6
        const varIn = (wUnknown * pIn) / 1e6
        const outCost = (out * pOut) / 1e6
        billed.f += fixedIn
        billed.v += varIn
        billed.out += outCost

        // What the output was spent on, in characters. Thinking text is not persisted (only
        // a signature), so it is the remainder after the prose and tool arguments we can see
        // -- which is a subtraction in tokens, and so has to wait for the density too.
        let proseChars = 0,
          argsChars = 0
        for (const b of content) {
          if (!b || typeof b !== "object") continue
          if (b.type === "text") proseChars += (b.text || "").length
          else if (b.type === "tool_use") argsChars += JSON.stringify(b.input || {}).length
        }
        h.charges.push({
          at: h.adds.length,
          ctxTokens,
          f: fixedIn,
          v: varIn,
          outCost,
          outTokens: out,
          proseChars,
          argsChars,
        })
      } else if (ctxTokens && basis !== "synthetic") {
        const model = msg.model || "(no model field)"
        unpriced.set(model, (unpriced.get(model) || 0) + 1)
      }

      // This assistant message now becomes part of the context for later requests.
      for (const b of content) {
        if (!b || typeof b !== "object") continue
        if (b.type === "text") {
          hold(
            st,
            h,
            { role: "assistant", kind: "prose-carried" },
            null,
            (b.text || "").length,
            "text",
          )
        } else if (b.type === "thinking" || b.type === "redacted_thinking") {
          hold(st, h, { role: "assistant", kind: "thinking-carried" }, null, charsOf(b), "text")
        } else if (b.type === "tool_use") {
          const tool = b.name || "(unnamed tool)"
          const t = readTool(b.input)
          // The dispatcher vote, from the same reading of the command line. Builtins never
          // dispatch, so they are not asked.
          for (const c of t.cands) {
            if (c.rank !== 0) continue
            let e = verbs.get(c.prog)
            if (!e) {
              e = { calls: 0, withVerb: 0, set: new Set() }
              verbs.set(c.prog, e)
            }
            e.calls++
            if (c.verb) {
              e.withVerb++
              e.set.add(c.verb)
            }
          }
          if (b.id) toolOf.set(b.id, { tool, sub: t.sub, verb: t.verb, shell: t.shell })
          hold(
            st,
            h,
            { role: "tool", tool, dir: "call", sub: t.sub, shell: t.shell },
            t.verb,
            JSON.stringify(b.input || {}).length,
            "code",
          )
        }
      }
    } else if (msg.role === "user") {
      // Compaction rewrites the prefix, so deltas across it are not calibration data.
      if (rec.isCompactSummary === true) dirty = true
      for (const b of content) {
        /* Two questions of the same block, and they are not the same question: what it is
           worth is which bucket it belongs to, what it is *for* here is whether it is text
           this file can measure against the token delta. An image is neither -- it is context
           with no characters in it, so the interval it sits in stops being calibration data. */
        const bt = b && typeof b === "object" ? b.type : "text"
        if (bt === "tool_result") {
          const chars = charsOf(b)
          codeChars += chars
          const t = (b.tool_use_id ? toolOf.get(b.tool_use_id) : undefined) || {
            tool: "(unmatched tool result)",
            sub: null,
            verb: null,
            shell: false,
          }
          hold(
            st,
            h,
            { role: "tool", tool: t.tool, dir: "result", sub: t.sub, shell: t.shell },
            t.verb,
            chars,
            "code",
          )
        } else if (bt === "image") {
          dirty = true
          hold(st, h, { role: "image", kind: "image" }, null, imageTokens(b), "tokens")
        } else if (bt === "document") {
          hold(st, h, { role: "image", kind: "document" }, null, charsOf(b), "code")
        } else {
          textChars += charsOf(b)
          for (const part of classifyUserBlock(textOf(b), rec))
            hold(st, h, { role: part.role, sub: part.sub }, null, part.chars, "text")
        }
      }
    }
  }
  return true
}

/* ------------------------------------------------------------------ the score --
 * Spend the two constants: allocate every request's exact billed cost across the content
 * that was in its context. Two accumulators per key: `f` is TTL-invariant, `v` scales with
 * whatever multiplier is assumed for cache writes whose TTL the transcript did not record.
 * So re-pricing costs O(keys), not another walk.
 */

/** Per-bucket cost accumulators. `f` is TTL-invariant, `v` scales with the assumption. */
export interface AccEntry {
  rec: Bucket
  f: number
  v: number
  out: number
}

export interface ModelSighting {
  n: number
  basis: string
  rate: Rate | null
}

export interface TtlTokens {
  "1h": number
  "5m": number
  unknown: number
}

export interface Allocation {
  acc: Map<string, AccEntry>
  billed: { f: number; v: number; out: number }
  requests: number
  sessions: number
  sidechainRequests: number
  models: Map<string, ModelSighting>
  unpriced: Map<string, number>
  ttl: TtlTokens
  days: number | null
  spanFrom: number | null
  spanTo: number | null
  firstCtx: number[]
}

function bump(
  acc: Map<string, AccEntry>,
  key: string,
  rec: Bucket,
  f: number,
  v: number,
  out: number,
): void {
  let e = acc.get(key)
  if (!e) {
    e = { rec, f: 0, v: 0, out: 0 }
    acc.set(key, e)
  }
  e.f += f
  e.v += v
  e.out += out
}

/** Score one file, now that the corpus has spoken. `home` sends each slot to the one that
 *  owns its final bucket, which is what puts `git` back together with `git` once the vote has
 *  said that whatever followed it was an operand rather than a subcommand. */
function score(
  h: Held,
  code: number,
  text: number,
  home: readonly number[],
  recs: readonly Bucket[],
  keys: readonly string[],
  acc: Map<string, AccEntry>,
): void {
  const ctx = new Map<number, number>() // slot -> estimated tokens in context
  let preamble: number | null = null,
    at = 0
  for (const ch of h.charges) {
    for (; at < ch.at; at++) {
      const a = h.adds[at]
      const slot = home[a.slot]
      const t = a.cls === "code" ? a.amt / code : a.cls === "text" ? a.amt / text : a.amt
      ctx.set(slot, (ctx.get(slot) || 0) + t)
    }

    // Preamble (system prompt + tool schemas) is measured ONCE per session, at the
    // first request, where almost no conversation exists yet. Holding it fixed
    // matters: char-based sizing undercounts, and a preamble recomputed every turn
    // would absorb the entire shortfall and grow without bound.
    let mine = 0
    for (const v of ctx.values()) mine += v
    if (preamble === null) preamble = Math.max(0, ch.ctxTokens - mine)
    const body = Math.max(0, ch.ctxTokens - preamble)
    const shares: Array<[number, number]> = []
    let denom = 0
    if (mine > 0) {
      const k = body / mine
      for (const [slot, v] of ctx) {
        const t = v * k
        shares.push([slot, t])
        denom += t
      }
    }
    const pre = Math.min(preamble, ch.ctxTokens)
    if (pre > 0) {
      shares.push([PRE_SLOT, pre])
      denom += pre
    }
    for (const [slot, t] of denom > 0 ? shares : [])
      bump(acc, keys[slot], recs[slot], ch.f * (t / denom), ch.v * (t / denom), 0)

    const prose = ch.proseChars / text,
      args = ch.argsChars / code
    const think = Math.max(0, ch.outTokens - prose - args)
    const d2 = prose + args + think
    if (d2 > 0) {
      for (const [i, part] of [think, prose, args].entries())
        bump(acc, OUT_KEYS[i], OUT_RECS[i], 0, 0, (ch.outCost * part) / d2)
    }
  }
}

/** Close the walk: judge which programs dispatch subcommands, fit the densities, and spend
 *  both on everything that was held back. Nothing is read again -- this is arithmetic over the
 *  measurements, which is why it is a beat at the end rather than a second pass. */
export function closeWalk(st: Walk): { scanned: Scanned; alloc: Allocation } {
  const dispatchers = new Set<string>()
  for (const [prog, e] of st.verbs) {
    if (e.calls < DISPATCH_MIN_CALLS || e.set.size < 2) continue
    if (e.withVerb / e.calls < DISPATCH_MIN_COVERAGE) continue
    if (e.set.size / e.withVerb > DISPATCH_MAX_RATIO) continue
    dispatchers.add(prog)
  }
  const fit = solveDensities(st.S)
  const scanned: Scanned = {
    filesUsed: st.filesUsed,
    duplicatesDropped: st.duplicatesDropped,
    badLines: st.badLines,
    dispatchers,
    density: fit || {
      code: CPT_FALLBACK,
      text: CPT_FALLBACK,
      basis: "default",
      pooled: CPT_FALLBACK,
    },
    densitySamples: st.S.n,
    densityCalibrated: !!fit,
  }

  /* A candidate verb is a subcommand only if its program was seen dispatching. Slots that
     lose the vote collapse onto each other -- `grep foo` and `grep bar` are both `grep` -- so
     they are pointed at whichever of them was met first before anything is scored. */
  const recs = st.slots.map((s) =>
    s.verb && s.rec.sub && dispatchers.has(s.rec.sub)
      ? { ...s.rec, sub: s.rec.sub + " " + s.verb }
      : s.rec,
  )
  const keys = recs.map(keyOf)
  const first = new Map<string, number>()
  const home = keys.map((k, i) => {
    const j = first.get(k)
    if (j !== undefined) return j
    first.set(k, i)
    return i
  })

  const acc = new Map<string, AccEntry>()
  for (const h of st.held)
    score(h, scanned.density.code, scanned.density.text, home, recs, keys, acc)

  const { tMin, tMax } = st
  const days =
    tMin !== null && tMax !== null ? Math.max(1, Math.round((tMax - tMin) / 86400000)) : null
  return {
    scanned,
    alloc: {
      acc,
      billed: st.billed,
      requests: st.requests,
      sessions: st.sessions,
      sidechainRequests: st.sidechainRequests,
      models: st.models,
      unpriced: st.unpriced,
      ttl: st.ttl,
      days,
      spanFrom: tMin,
      spanTo: tMax,
      firstCtx: st.firstCtx,
    },
  }
}

/* ---------------------------------------------------------------------- price --
 * Apply a rate for the cache writes whose TTL was not recorded. O(keys).
 */

export interface PricedRow {
  rec: Bucket
  cost: number
  isOutput: boolean
}

export interface Priced {
  rows: PricedRow[]
  input: number
  output: number
  total: number
}

/** The bill as far as the walk has got, for a walk that is still going.
 *
 *  `price` below is the same arithmetic on a finished `Allocation`; this one reads the live
 *  accumulator instead, so the page can put a figure on screen between files. It is exact --
 *  the total is the one thing that never waited for the calibration -- and it is the total
 *  only: the rows are not summed, because nothing is drawing them yet. */
export function billedSoFar(st: Walk, ttlAssumption: TtlAssumption = "1h"): number {
  const mult = CACHE_WRITE_MULT[ttlAssumption] ?? CACHE_WRITE_MULT["1h"]
  return st.billed.f + st.billed.v * mult + st.billed.out
}

export function price(alloc: Allocation, ttlAssumption: TtlAssumption = "1h"): Priced {
  const mult = CACHE_WRITE_MULT[ttlAssumption] ?? CACHE_WRITE_MULT["1h"]
  const rows: PricedRow[] = []
  for (const e of alloc.acc.values()) {
    const c = e.f + e.v * mult + e.out
    if (c > 0) rows.push({ rec: e.rec, cost: c, isOutput: e.out > 0 && e.f === 0 && e.v === 0 })
  }
  return {
    rows,
    input: alloc.billed.f + alloc.billed.v * mult,
    output: alloc.billed.out,
    total: alloc.billed.f + alloc.billed.v * mult + alloc.billed.out,
  }
}

/* ----------------------------------------------------------------- the report --
 * Groups are defined by ROLE IN THE REQUEST CYCLE -- a structural property every
 * transcript has. Membership is then derived from measured cost, so a tool, command,
 * harness tag or MCP server this file has never heard of still lands correctly.
 */

/** The nine stable group identities. Views key their palette off these, so they are a
 *  contract: a group keeps its hue when the reader drills in or switches lens. */
export type GroupId =
  | "shell"
  | "ingest"
  | "emit"
  | "twoway"
  | "output"
  | "preamble"
  | "harness"
  | "media"
  | "typed"

export interface GroupDef {
  id: GroupId
  name: string
  short: string
}

export const GROUPS: GroupDef[] = [
  { id: "shell", name: "Shell commands", short: "Shell" },
  { id: "ingest", name: "Tools · content read in", short: "Read in" },
  { id: "emit", name: "Tools · content written out", short: "Written out" },
  { id: "twoway", name: "Tools · two-way", short: "Two-way" },
  { id: "output", name: "Model output", short: "Output" },
  { id: "preamble", name: "System prompt & tool schemas", short: "System prompt" },
  { id: "harness", name: "Harness & reminders", short: "Harness" },
  { id: "media", name: "Images & attachments", short: "Media" },
  { id: "typed", name: "My typing", short: "My typing" },
]

/** A tool is shown as one row, or split into call/result rows, depending on whether
 *  BOTH directions carry real money. Measured per tool -- no list of tool names. */
const SPLIT_MIN_SHARE = 0.12
/** Above this share of a tool's cost in one direction, that direction defines its role. */
const DOMINANT = 0.7

const round = (v: number): number => Math.round(v * 100) / 100
const sumBy = <T>(arr: T[], f: (x: T) => number): number => arr.reduce((s, x) => s + f(x), 0)

/* The tree the views render. Children always sum to their parent, at every level. */

export interface TreeChild {
  name: string
  cost: number
}

export interface TreeItem {
  name: string
  cost: number
  children: TreeChild[] | null
}

export interface TreeGroup {
  id: GroupId
  name: string
  short: string
  cost: number
  items: TreeItem[]
}

/** Figures the views quote, measured here so no view needs a hand-written list of
 *  "commands that read" versus "commands that write". */
export interface Insights {
  fixed: number
  harness: number
  thinking: number
  proseGen: number
  proseCarry: number
  ingest: number
  emit: number
  mcp: number
  typed: number
}

/** One fully priced view of the corpus, under one TTL assumption. */
export interface Dataset {
  total: number
  input: number
  output: number
  requests: number
  sessions: number
  days: number | null
  groups: TreeGroup[]
  accounted: number
  insights: Insights
}

export function buildTree(alloc: Allocation, ttlAssumption: TtlAssumption = "1h"): Dataset {
  const priced = price(alloc, ttlAssumption)

  /* A two-level accumulator: group -> item -> optional child. Every branch below feeds
   * the same structure, so no group needs bespoke assembly code. */
  const bucket = new Map<GroupId, Map<string, { cost: number; kids: Map<string, number> }>>()
  const put = (gid: GroupId, item: string, child: string | null, cost: number): void => {
    if (!(cost > 0)) return
    let items = bucket.get(gid)
    if (!items) {
      items = new Map()
      bucket.set(gid, items)
    }
    let e = items.get(item)
    if (!e) {
      e = { cost: 0, kids: new Map() }
      items.set(item, e)
    }
    e.cost += cost
    if (child) e.kids.set(child, (e.kids.get(child) || 0) + cost)
  }

  // 1. Fold tool rows into per-tool direction and sub-key totals; place the rest by role.
  // tool -> {call, result, shell, subs:Map(sub -> cost)}
  const tools = new Map<
    string,
    { call: number; result: number; shell: boolean; subs: Map<string, number> }
  >()
  for (const { rec, cost } of priced.rows) {
    switch (rec.role) {
      case "tool": {
        const name = rec.tool || "(unnamed tool)"
        let t = tools.get(name)
        if (!t) {
          t = { call: 0, result: 0, shell: false, subs: new Map() }
          tools.set(name, t)
        }
        if (rec.shell) t.shell = true
        t[rec.dir === "call" ? "call" : "result"] += cost
        if (rec.sub) t.subs.set(rec.sub, (t.subs.get(rec.sub) || 0) + cost)
        break
      }
      case "preamble":
        put("preamble", "system prompt + tool schemas", null, cost)
        break
      case "harness":
        put("harness", rec.sub || "harness", null, cost)
        break
      case "typed":
        put("typed", "your typed messages", null, cost)
        break
      case "image":
        put(
          "media",
          rec.kind === "document" ? "attached documents" : "images / screenshots",
          null,
          cost,
        )
        break
      case "assistant": {
        const kind = rec.kind || ""
        put("output", OUT_NAMES[kind] || kind || "(output)", null, cost)
        break
      }
      default:
        put("twoway", "(unclassified)", null, cost)
    }
  }

  // 2. Place each tool by its own measured direction balance, and give it a second level
  //    from whatever sub-keys its inputs yielded. Both are derived, not looked up.
  for (const [tool, t] of tools) {
    const total = t.call + t.result
    if (total <= 0) continue
    const resultShare = t.result / total
    const gid: GroupId = t.shell
      ? "shell"
      : resultShare >= DOMINANT
        ? "ingest"
        : resultShare <= 1 - DOMINANT
          ? "emit"
          : "twoway"
    const disp = toolDisplay(tool)
    const subTotal = sumBy([...t.subs.values()], (c) => c)

    if (t.shell) {
      // Shell: the sub-key is "prog" or "prog verb", so the program is the item and the
      // full command the child. One row per program regardless of which tool ran it.
      for (const [sub, c] of t.subs) {
        const prog = sub.split(" ")[0]
        put(gid, prog, sub, c)
      }
      put(gid, "(no command parsed)", null, total - subTotal)
    } else if (t.subs.size > 1 && subTotal / total >= 0.8) {
      // Enough of this tool's cost carries a sub-key to make a meaningful second level.
      for (const [sub, c] of t.subs) put(gid, disp, sub, c)
      put(gid, disp, "(no path parsed)", total - subTotal)
    } else if (Math.min(t.call, t.result) / total >= SPLIT_MIN_SHARE) {
      // Both directions carry real money, so one merged row would hide the story --
      // and drilling a single-child row renders a degenerate 100% block.
      put(gid, disp + " · results", null, t.result)
      put(gid, disp + " · call args", null, t.call)
    } else {
      put(gid, disp, null, total)
    }
  }

  // 3. Emit the tree in the declared group order, largest first within each level.
  const groups: TreeGroup[] = []
  for (const def of GROUPS) {
    const items = bucket.get(def.id)
    if (!items || !items.size) continue
    const list: TreeItem[] = [...items]
      .map(([name, e]) => {
        const kids: TreeChild[] = [...e.kids]
          .map(([n, c]) => ({ name: n, cost: round(c) }))
          .sort((a, b) => b.cost - a.cost)
        return { name, cost: round(e.cost), children: kids.length > 1 ? kids : null }
      })
      .sort((a, b) => b.cost - a.cost)
    groups.push({
      id: def.id,
      name: def.name,
      short: def.short,
      cost: round(sumBy(list, (i) => i.cost)),
      items: list,
    })
  }
  groups.sort((a, b) => b.cost - a.cost)

  // 4. Insights, measured -- so the views layer never needs a hand-written list of
  //    "commands that read" versus "commands that write".
  const gcost = (id: GroupId): number => (groups.find((g) => g.id === id) || { cost: 0 }).cost
  const outItems = (groups.find((g) => g.id === "output") || { items: [] as TreeItem[] }).items
  const oc = (n: string): number => (outItems.find((i) => i.name === n) || { cost: 0 }).cost
  const all = [...tools.values()]
  const ingest = sumBy(all, (t) => t.result)
  const emit = sumBy(all, (t) => t.call)
  const mcp = sumBy(
    priced.rows.filter((r) => r.rec.role === "tool" && String(r.rec.tool).startsWith("mcp__")),
    (r) => r.cost,
  )

  return {
    total: priced.total,
    input: priced.input,
    output: priced.output,
    requests: alloc.requests,
    sessions: alloc.sessions,
    days: alloc.days,
    groups,
    accounted: round(sumBy(groups, (g) => g.cost)),
    insights: {
      fixed: gcost("preamble"),
      harness: gcost("harness"),
      thinking: oc(OUT_NAMES.thinking),
      proseGen: oc(OUT_NAMES.prose),
      proseCarry: oc(OUT_NAMES["prose-carried"]),
      ingest: round(ingest),
      emit: round(emit),
      mcp: round(mcp),
      typed: gcost("typed"),
    },
  }
}

const OUT_NAMES: Record<string, string> = {
  thinking: "thinking",
  prose: "assistant prose (generated)",
  "tool-args": "tool-call arguments",
  "prose-carried": "assistant prose (re-billed as input)",
  "thinking-carried": "thinking blocks (re-billed as input)",
}

/* ------------------------------------------------------------------ top level --
 * One scan, one allocation, then a priced tree per TTL assumption -- and the
 * assumption only affects the cache writes whose TTL the transcript omitted.
 */

export interface ModelReport {
  id: string
  requests: number
  basis: string
  rate: Rate | null
}

/** Reserved for callers that want to parameterise a run. Rates are overridden through
 *  setRates(), so there is nothing to pass here yet; the parameter exists so adding one
 *  later is not a breaking change. */
export interface AnalyzeOptions {}

/** Everything the report needs: one dataset per TTL lens, plus how it was derived. */
export interface Analysis {
  datasets: Record<TtlAssumption, Dataset>
  requests: number
  sessions: number
  days: number | null
  spanFrom: number | null
  spanTo: number | null
  filesUsed: number
  duplicatesDropped: number
  badLines: number
  models: ModelReport[]
  unpriced: Record<string, number>
  density: Density
  densityCalibrated: boolean
  densitySamples: number
  dispatchers: string[]
  ttlTokens: TtlTokens
  ttlMeasuredShare: number
  preambleRange: [number, number] | null
  warnings: string[]
  groupDefs: GroupDef[]
}

/** The bill, out of what the walk accumulated. Nothing here walks a transcript again -- it is
 *  arithmetic on the accumulators -- so it is the same call whether the walk was fed the corpus
 *  at once or a file at a time. */
export function report(scanned: Scanned, alloc: Allocation): Analysis {
  const datasets = {} as Record<TtlAssumption, Dataset>
  for (const t of ["1h", "5m"] as const) datasets[t] = buildTree(alloc, t)

  const wTotal = alloc.ttl["1h"] + alloc.ttl["5m"] + alloc.ttl.unknown
  const warnings: string[] = []
  if (alloc.unpriced.size) {
    const n = [...alloc.unpriced.values()].reduce((a, b) => a + b, 0)
    warnings.push(
      `${n.toLocaleString("en-US")} request(s) used a model with no known rate ` +
        `(${[...alloc.unpriced.keys()].join(", ")}) and are excluded from the total.`,
    )
  }
  if (!scanned.densityCalibrated) {
    warnings.push(
      `Not enough clean samples to calibrate token sizing, so the ` +
        `${CPT_FALLBACK} chars/token default is in use and row splits are rougher ` +
        `than usual. Totals are unaffected.`,
    )
  } else if (scanned.density.basis === "pooled") {
    warnings.push(
      `Token sizing calibrated to a single pooled density ` +
        `(${scanned.density.code.toFixed(2)} chars/token); there was not enough of one ` +
        `content class to separate prose from machine text.`,
    )
  }
  if (scanned.badLines) warnings.push(`${scanned.badLines} unparseable line(s) skipped.`)
  if (alloc.sidechainRequests) {
    warnings.push(
      `${alloc.sidechainRequests.toLocaleString("en-US")} subagent request(s) ` +
        `included (isSidechain).`,
    )
  }

  return {
    datasets,
    requests: alloc.requests,
    sessions: alloc.sessions,
    days: alloc.days,
    spanFrom: alloc.spanFrom,
    spanTo: alloc.spanTo,
    filesUsed: scanned.filesUsed,
    duplicatesDropped: scanned.duplicatesDropped,
    badLines: scanned.badLines,
    models: [...alloc.models]
      .map(([id, e]) => ({ id, requests: e.n, basis: e.basis, rate: e.rate }))
      .sort((a, b) => b.requests - a.requests),
    unpriced: Object.fromEntries(alloc.unpriced),
    density: scanned.density,
    densityCalibrated: scanned.densityCalibrated,
    densitySamples: scanned.densitySamples,
    dispatchers: [...scanned.dispatchers].sort(),
    ttlTokens: alloc.ttl,
    ttlMeasuredShare: wTotal > 0 ? 1 - alloc.ttl.unknown / wTotal : 1,
    preambleRange: alloc.firstCtx.length
      ? [Math.min(...alloc.firstCtx), Math.max(...alloc.firstCtx)]
      : null,
    warnings,
    groupDefs: GROUPS,
  }
}

/** The whole thing in one call, for callers that already hold every file: the tests, and any
 *  script with a directory in hand. The page does not use it -- it drives the walk itself so
 *  that it can say where it has got to. */
export function analyze(rawFiles: RawFile[], _opts: AnalyzeOptions = {}): Analysis {
  const w = openWalk()
  for (const f of rawFiles) walkOne(w, f)
  const { scanned, alloc } = closeWalk(w)
  if (!scanned.filesUsed) throw new Error("no readable transcript files")
  return report(scanned, alloc)
}
