/* The example: a corpus nobody typed, written as transcript lines rather than as a finished
   `Analysis`, so it is priced by the same walk a real folder gets. */

import type { RawFile } from "./engine.ts"

/** The two densities the corpus is written to, so the walk's own least-squares fit recovers them
 *  and the footnote reports a measured figure rather than the fallback. */
const CODE_CPT = 3.6
const TEXT_CPT = 4.4

/** System prompt and tool schemas, which is what the first request of a session reads out as the
 *  part of its context nothing else accounts for. */
const PREAMBLE = 12800

const MODEL = "claude-opus-5"

/** Deterministic, because the example has to be the same bill every time it is asked for -- a
 *  figure that moved between two reloads would read as a live number. */
function rng(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0
  return (): number => {
    s = (s ^ (s << 13)) >>> 0
    s = (s ^ (s >>> 17)) >>> 0
    s = (s ^ (s << 5)) >>> 0
    return s / 0x100000000
  }
}

const pick = <T>(r: () => number, xs: readonly T[]): T =>
  xs[Math.floor(r() * xs.length) % xs.length]
const between = (r: () => number, lo: number, hi: number): number =>
  Math.round(lo + r() * (hi - lo))

/** Text of about `chars` characters, drawn line by line from a pool: one string repeated would
 *  give the density fit a corpus of one sample wearing many hats. */
function fill(r: () => number, pool: readonly string[], chars: number): string {
  let s = ""
  while (s.length < chars) s += pick(r, pool) + "\n"
  return s.slice(0, Math.max(1, chars))
}

/* The vocabulary. None of it is anyone's project: the repo it describes is a small parser with a
   web front end, invented for the purpose. */

const PROSE = [
  "Reading the lexer first, since that is where the split happens.",
  "That confirms it — the trailing newline is consumed before `trim` ever sees the line.",
  "Two call sites depend on the old behaviour, so I will fix the lexer and update both.",
  "The test is green now. Running the whole suite to be sure nothing else leaned on it.",
  "This is the third place the same guard is written out by hand; folding them into one helper.",
  "The queue drains in order, so the race has to be upstream of it.",
  "Checking whether the router remounts the panel on every keystroke.",
  "It does, and that is the flicker. Memoising on the two primitives the panel actually reads.",
  "Nothing in the changelog covers this, so I will add a line.",
  "Formatting, then the typecheck, then the suites.",
]

const THINK = [
  "The stack points at the lexer but the symptom shows up in the parser, so the question is which of the two owns the newline.",
  "If the guard moves into the helper, the two call sites that pass a null need a default rather than a branch.",
  "Worth checking whether the fixture covers the empty-input case before claiming the suite proves anything.",
  "The remount is cheap on its own; it is the layout read inside the effect that costs, so memoising the props is the fix.",
]

const TYPED = [
  "the parser drops the trailing newline on the last record — can you find where",
  "run the tests",
  "fold those three guards into one helper",
  "why does the panel flicker when i type in the filter box",
  "ok ship it",
  "add a changelog line for that",
  "what does the queue do if two drains overlap",
  "look at the open issues on the tracker and tell me which of them this closes",
  "here is the screenshot — the header wraps at that width",
  "commit and push",
]

const REMINDER = [
  "The user has opened a new file. Contents may have changed since you last read it.",
  "Todo list has been updated. Continue with the current task.",
  "This context may or may not be relevant to your task. Do not respond to it directly.",
]

const SRC_LINES = [
  "export function splitLines(input: string): string[] {",
  "  const out: string[] = []",
  "  let at = 0",
  "  for (let i = 0; i < input.length; i++) {",
  "    if (input.charCodeAt(i) !== 10) continue",
  "    out.push(input.slice(at, i))",
  "    at = i + 1",
  "  }",
  "  if (at < input.length) out.push(input.slice(at))",
  "  return out",
  "}",
  "",
  "/** The record as the wire hands it over, before any of it is trusted. */",
  "export interface RawRecord {",
  "  id: string",
  "  at: number",
  "  body: string | null",
  "}",
]

const DIFF_LINES = [
  "diff --git a/src/lexer.ts b/src/lexer.ts",
  "index 4a1c9e2..7bd0f31 100644",
  "--- a/src/lexer.ts",
  "+++ b/src/lexer.ts",
  "@@ -41,7 +41,7 @@ export function splitLines(input: string): string[] {",
  "-  if (at < input.length) out.push(input.slice(at))",
  "+  if (at <= input.length) out.push(input.slice(at))",
  "   return out",
  " }",
]

const TEST_LINES = [
  " ✓ src/parser.test.ts (18 tests) 41ms",
  " ✓ src/queue.test.ts (9 tests) 12ms",
  "   ✓ splitLines > keeps the trailing empty record",
  "   ✓ splitLines > handles input with no newline at all",
  "   ✓ drain > preserves order across two overlapping drains",
  " Test Files  2 passed (2)",
  "      Tests  27 passed (27)",
  "   Duration  611ms",
]

const GREP_LINES = [
  "src/lexer.ts:44:  if (at < input.length) out.push(input.slice(at))",
  "src/parser.ts:112:  const lines = splitLines(body)",
  "src/parser.test.ts:87:  assert.deepEqual(splitLines('a\\nb\\n'), ['a', 'b', ''])",
  "src/queue.ts:31:  const lines = splitLines(chunk)",
]

const LOG_LINES = [
  "7bd0f31 Fold the trailing newline into the lexer rather than the parser",
  "4a1c9e2 Give the queue one drain and make the second one wait",
  "9c2e814 Memoise the panel on the two primitives it reads",
  "1f30ab7 Add the empty-input case to the parser fixture",
]

const ISSUE_LINES = [
  '{"id":"PAR-118","title":"Trailing newline dropped on the last record","state":"In Progress"}',
  '{"id":"PAR-121","title":"Filter box flickers the panel on every keystroke","state":"Todo"}',
  '{"id":"PAR-104","title":"Queue drains out of order under concurrent writes","state":"Done"}',
]

const WEB_LINES = [
  "The specification requires that a line terminator at the end of the input does not itself",
  "introduce a further record; implementations differ, and the widely deployed behaviour is to",
  "emit a final empty record only where the producer wrote one deliberately.",
  "See section 4.2, which is normative, and appendix C, which is not.",
]

/* The moves. A move is one tool call and the result it comes back with, and its weight is how
   often the work in question actually reaches for it. */

interface Move {
  w: number
  tool: string
  arg: (r: () => number) => Record<string, unknown>
  /** Result size, in characters. */
  out: (r: () => number) => number
  pool: readonly string[]
}

const PATHS = [
  "src/lexer.ts",
  "src/parser.ts",
  "src/parser.test.ts",
  "src/queue.ts",
  "src/queue.test.ts",
  "src/panel.tsx",
  "src/router.tsx",
  "src/table.tsx",
  "src/tokens.css",
  "src/panel.css",
  "docs/format.md",
  "README.md",
  "CHANGELOG.md",
  "package.json",
  "tsconfig.json",
]

const COMMANDS: ReadonlyArray<[cmd: string, lo: number, hi: number, pool: readonly string[]]> = [
  ["git status --short", 200, 900, DIFF_LINES],
  ["git diff -- src/lexer.ts", 900, 4600, DIFF_LINES],
  ["git diff --stat", 300, 1200, DIFF_LINES],
  ["git log --oneline -15", 700, 1600, LOG_LINES],
  ["git add -A", 40, 90, LOG_LINES],
  ['git commit -m "Fold the trailing newline into the lexer"', 200, 600, LOG_LINES],
  ["git push", 300, 700, LOG_LINES],
  ["pnpm test", 1100, 7000, TEST_LINES],
  ["pnpm test parser", 500, 2000, TEST_LINES],
  ["pnpm build", 600, 2500, TEST_LINES],
  ["pnpm lint", 200, 3000, TEST_LINES],
  ["pnpm install", 400, 1500, TEST_LINES],
  ["rg -n splitLines src", 300, 1800, GREP_LINES],
  ["rg -n 'trailing newline' src docs", 200, 1300, GREP_LINES],
  ["node --test test/lexer.test.js", 300, 1400, TEST_LINES],
]

const MOVES: readonly Move[] = [
  {
    w: 26,
    tool: "Bash",
    arg: (r) => {
      const [cmd] = pick(r, COMMANDS)
      return { command: cmd, description: "Run it" }
    },
    out: (r) => between(r, 300, 4200),
    pool: TEST_LINES,
  },
  {
    w: 22,
    tool: "Read",
    arg: (r) => ({ file_path: "/repo/" + pick(r, PATHS) }),
    out: (r) => between(r, 1200, 11000),
    pool: SRC_LINES,
  },
  {
    w: 9,
    tool: "Edit",
    arg: (r) => ({
      file_path: "/repo/" + pick(r, PATHS),
      old_string: fill(r, SRC_LINES, between(r, 300, 2200)),
      new_string: fill(r, SRC_LINES, between(r, 400, 2600)),
    }),
    out: () => 90,
    pool: SRC_LINES,
  },
  {
    w: 4,
    tool: "Write",
    arg: (r) => ({
      file_path: "/repo/" + pick(r, PATHS),
      content: fill(r, SRC_LINES, between(r, 1200, 6000)),
    }),
    out: () => 70,
    pool: SRC_LINES,
  },
  {
    w: 8,
    tool: "Grep",
    arg: (r) => ({
      pattern: pick(r, ["splitLines", "drain\\(", "trailing", "useMemo"]),
      path: "src",
    }),
    out: (r) => between(r, 400, 2600),
    pool: GREP_LINES,
  },
  {
    w: 4,
    tool: "Glob",
    arg: () => ({ pattern: "src/**/*.{ts,tsx}" }),
    out: (r) => between(r, 300, 1400),
    pool: PATHS,
  },
  {
    w: 3,
    tool: "WebFetch",
    arg: () => ({
      url: "https://example.invalid/spec/line-terminators",
      prompt: "What does it say about a terminator at end of input?",
    }),
    out: (r) => between(r, 3000, 12000),
    pool: WEB_LINES,
  },
  {
    w: 4,
    tool: "mcp__tracker__list_issues",
    arg: (r) => ({ query: pick(r, ["parser", "queue", "panel"]), limit: 25 }),
    out: (r) => between(r, 1200, 5000),
    pool: ISSUE_LINES,
  },
  {
    w: 2,
    tool: "mcp__tracker__update_issue",
    arg: (r) => ({
      id: pick(r, ["PAR-118", "PAR-121"]),
      state: "Done",
      comment: fill(r, PROSE, between(r, 300, 1400)),
    }),
    out: () => 120,
    pool: ISSUE_LINES,
  },
  {
    w: 5,
    tool: "TodoWrite",
    arg: (r) => ({
      todos: fill(r, TYPED, between(r, 400, 1600))
        .split("\n")
        .slice(0, 6),
    }),
    out: () => 60,
    pool: PROSE,
  },
]

const TOTAL_W = MOVES.reduce((s, m) => s + m.w, 0)

function move(r: () => number, boost: string | null): Move {
  /* The session's own subject, given a second draw: a debugging session reaches for the shell far
     more often than the average of all of them does. */
  if (boost && r() < 0.4) {
    const only = MOVES.filter((m) => m.tool.startsWith(boost))
    if (only.length) return pick(r, only)
  }
  let n = r() * TOTAL_W
  for (const m of MOVES) {
    n -= m.w
    if (n <= 0) return m
  }
  return MOVES[0]
}

/** One session, as the lines of one `.jsonl` file. */
function session(seed: number, reqs: number, startedAt: number, boost: string | null): string {
  const r = rng(seed)
  const sid = `${seed.toString(16).padStart(8, "0")}-4c1f-4b2a-9d33-${(seed * 7919).toString(16).padStart(12, "0").slice(-12)}`
  const lines: string[] = []
  const push = (o: unknown): number => lines.push(JSON.stringify(o))

  let ctx = PREAMBLE
  let prevCtx = 0
  let at = startedAt
  let n = 0

  const user = (content: unknown[]): void => {
    push({
      sessionId: sid,
      type: "user",
      timestamp: new Date(at).toISOString(),
      message: { role: "user", content },
    })
  }

  const opening = pick(r, TYPED)
  user([{ type: "text", text: opening }])
  ctx += opening.length / TEXT_CPT

  for (let i = 0; i < reqs; i++) {
    at += between(r, 12000, 90000)

    const m = move(r, boost)
    const args = m.arg(r)
    const argChars = JSON.stringify(args).length
    const proseText = fill(r, PROSE, between(r, 120, 700))
    /* Not every turn thinks, which is what leaves the thinking share a figure rather than a
       constant. */
    const thinkText = r() < 0.35 ? fill(r, THINK, between(r, 300, 1600)) : ""

    const outTokens = Math.round(
      proseText.length / TEXT_CPT + thinkText.length / TEXT_CPT + argChars / CODE_CPT,
    )

    const ctxTokens = Math.round(ctx)
    const inp = 4
    const cr = prevCtx
    const cw = Math.max(0, ctxTokens - cr - inp)
    /* A third of the requests leave the write's TTL unrecorded, which is the whole reason the
       toolbar offers a lens over it. */
    const recorded = r() < 0.67
    const long = r() < 0.3

    const content: unknown[] = []
    if (thinkText) content.push({ type: "thinking", thinking: thinkText, signature: "sig" })
    content.push({ type: "text", text: proseText })
    const useId = `t_${seed}_${n++}`
    content.push({ type: "tool_use", id: useId, name: m.tool, input: args })

    push({
      sessionId: sid,
      type: "assistant",
      timestamp: new Date(at).toISOString(),
      message: {
        role: "assistant",
        model: MODEL,
        content,
        usage: {
          input_tokens: inp,
          cache_read_input_tokens: cr,
          cache_creation_input_tokens: cw,
          output_tokens: outTokens,
          ...(recorded
            ? {
                cache_creation: long
                  ? { ephemeral_1h_input_tokens: cw, ephemeral_5m_input_tokens: 0 }
                  : { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: cw },
              }
            : {}),
        },
      },
    })

    prevCtx = ctxTokens
    ctx += outTokens

    const result = fill(r, m.pool, m.out(r))
    user([{ type: "tool_result", tool_use_id: useId, content: result }])
    ctx += result.length / CODE_CPT

    /* What the reader put in between two tool calls: their own words, whatever the harness
       injected alongside them, and now and then a pasted screenshot. */
    if (r() < 0.16) {
      const said = pick(r, TYPED)
      const blocks: unknown[] = []
      if (r() < 0.5) {
        const note = `<system-reminder>${fill(r, REMINDER, between(r, 200, 900))}</system-reminder>`
        blocks.push({ type: "text", text: note })
        ctx += note.length / TEXT_CPT
      }
      if (r() < 0.12) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
        })
        ctx += 1500
      }
      blocks.push({ type: "text", text: said })
      ctx += said.length / TEXT_CPT
      user(blocks)
    }
  }

  return lines.join("\n")
}

/** How the nine sessions differ. The lengths are what set the thesis -- prose is re-billed once
 *  per later request in the same session, so short sessions would argue the opposite. */
const SESSIONS: ReadonlyArray<[reqs: number, day: number, hour: number, boost: string | null]> = [
  [95, 0, 9, "Bash"],
  [62, 0, 15, "Read"],
  [128, 1, 10, null],
  [41, 2, 11, "mcp__tracker"],
  [88, 3, 9, "Edit"],
  [74, 4, 14, "Bash"],
  [116, 5, 10, "Read"],
  [55, 7, 16, null],
  [97, 8, 9, null],
]

/** A Monday, and not this one: the report shows the span in days, so the date itself is only ever
 *  arithmetic. */
const DAY_ONE = Date.UTC(2026, 4, 4, 0, 0, 0)

/** The example, one lazily-built file per session, so the intake can walk it a transcript at a
 *  time exactly as it walks a folder. */
export function sampleFiles(): ReadonlyArray<{ name: string; build: () => string }> {
  return SESSIONS.map(([reqs, day, hour, boost], i) => {
    const seed = 0x5eed01 + i * 977
    const startedAt = DAY_ONE + day * 86400000 + hour * 3600000
    return {
      name: `${(seed >>> 0).toString(16).padStart(8, "0")}-4c1f-4b2a-9d33-${(i + 1).toString().padStart(12, "0")}.jsonl`,
      build: () => session(seed, reqs, startedAt, boost),
    }
  })
}

/** The same corpus in one go, for callers that are not drawing a progress column. */
export function sampleCorpus(): RawFile[] {
  return sampleFiles().map((f) => ({ name: f.name, text: f.build() }))
}
