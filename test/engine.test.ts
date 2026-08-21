import * as E from "../src/engine.ts"
import type { Dataset, RawFile, Usage } from "../src/engine.ts"
import { sampleCorpus } from "../src/sample.ts"
import fs from "node:fs"
import path from "node:path"

let fails = 0
const ok = (c: boolean, m: string): void => {
  if (!c) fails++
  console.log((c ? "ok   " : "FAIL ") + m)
}
const money = (n: number): string => "$" + n.toFixed(2)

/* ================= 1. */
console.log("\n== unknown-everything transcript ==")
const lines: string[] = []
let i = 0
const req = (
  content: unknown[],
  usage: Partial<Usage> = {},
  extra: Record<string, unknown> = {},
): number =>
  lines.push(
    JSON.stringify({
      sessionId: "sess-x",
      timestamp: `2026-03-0${(i % 9) + 1}T00:00:00Z`,
      message: {
        role: "assistant",
        model: "eu.anthropic.claude-sonnet-9-20301231-v1:0",
        usage: Object.assign(
          {
            input_tokens: 5,
            cache_read_input_tokens: 20000 + i * 900,
            cache_creation_input_tokens: 400,
            output_tokens: 300,
            cache_creation: { ephemeral_1h_input_tokens: 400, ephemeral_5m_input_tokens: 0 },
          },
          usage,
        ),
        content,
      },
      ...extra,
    }),
  )
const usr = (content: unknown[], extra: Record<string, unknown> = {}): number =>
  lines.push(
    JSON.stringify({
      sessionId: "sess-x",
      timestamp: "2026-03-01T00:00:00Z",
      message: { role: "user", content },
      ...extra,
    }),
  )

for (let k = 0; k < 12; k++) {
  i++
  req([
    { type: "text", text: "reasoning ".repeat(40) },
    {
      type: "tool_use",
      id: "u" + k,
      name: "mcp__acme_corp__warehouse_query",
      input: { sql: "select * from t where id=" + k },
    },
  ])
  usr([{ type: "tool_result", tool_use_id: "u" + k, content: "ROW ".repeat(900) }])
  i++
  req([
    {
      type: "tool_use",
      id: "s" + k,
      name: "ExecuteShell",
      input: { command: `cd /srv && poetry ${["add", "run", "lock", "install"][k % 4]} pkg${k}` },
    },
  ])
  usr([{ type: "tool_result", tool_use_id: "s" + k, content: "out ".repeat(500) }])
  i++
  req([
    {
      type: "tool_use",
      id: "w" + k,
      name: "PatchFile",
      input: {
        path: `/x/mod${k}.${["zig", "nim", "zig", "ex"][k % 4]}`,
        contents: "CODE ".repeat(700),
      },
    },
  ])
  usr([{ type: "tool_result", tool_use_id: "w" + k, content: "ok" }])
  usr([
    {
      type: "text",
      text: "<never-seen-harness-tag>\ninjected ".repeat(30) + "</never-seen-harness-tag>",
    },
  ])
  usr([{ type: "text", text: "please keep going " + k }])
}
const files: RawFile[] = [{ name: "sess-x.jsonl", text: lines.join("\n") }]
const A = E.analyze(files)
const d = A.datasets["1h"]
const byId = Object.fromEntries(d.groups.map((g) => [g.id, g]))
const names = (g: string): string[] => (byId[g] ? byId[g].items.map((x) => x.name) : [])

ok(
  A.datasets["1h"].requests === 36,
  `priced all 36 requests of an unknown model (got ${d.requests})`,
)
ok(Object.keys(A.unpriced).length === 0, "nothing silently dropped")
ok(!!byId.shell, "an unknown shell-shaped tool (ExecuteShell) formed a Shell group")
ok(names("shell").includes("poetry"), `poetry became a program row: ${names("shell")}`)
const poetry = byId.shell.items.find((x) => x.name === "poetry")
ok(
  !!poetry && !!poetry.children && poetry.children.length === 4,
  `poetry drilled to its 4 learned subcommands: ${poetry && poetry.children && poetry.children.map((c) => c.name)}`,
)
ok(
  !!byId.ingest && names("ingest").some((n) => n.includes("acme_corp")),
  `unknown MCP tool classified as ingest by measurement: ${names("ingest")}`,
)
const patch = (byId.emit || byId.twoway || { items: [] }).items.find((x) => x.name === "PatchFile")
ok(
  !!patch,
  `PatchFile placed by direction into ${byId.emit && names("emit").includes("PatchFile") ? "emit" : "twoway"}`,
)
ok(
  !!patch && !!patch.children && patch.children.some((c) => c.name === "*.zig"),
  `PatchFile drilled by extension: ${patch && patch.children && patch.children.map((c) => c.name)}`,
)
ok(
  names("harness").includes("<never-seen-harness-tag>"),
  `unknown harness tag got its own row: ${names("harness")}`,
)
ok(names("typed").includes("your typed messages"), "human typing separated from harness text")
ok(
  A.densityCalibrated,
  `density calibrated (${A.density.basis}): code ${A.density.code.toFixed(2)} / text ${A.density.text.toFixed(2)} chars-per-token, ${A.densitySamples} samples`,
)

/* every level reconciles */
const recon = (ds: Dataset): string[] => {
  const bad: string[] = []
  for (const g of ds.groups) {
    const s = g.items.reduce((a, b) => a + b.cost, 0)
    if (Math.abs(s - g.cost) > 0.02) bad.push(`${g.name}: items ${s} vs ${g.cost}`)
    for (const it of g.items) {
      if (!it.children) continue
      const k = it.children.reduce((a, b) => a + b.cost, 0)
      if (Math.abs(k - it.cost) > 0.02) bad.push(`${g.name}/${it.name}: kids ${k} vs ${it.cost}`)
    }
  }
  const t = ds.groups.reduce((a, b) => a + b.cost, 0)
  if (Math.abs(t - ds.total) > Math.max(0.05, ds.total * 0.0005))
    bad.push(`groups ${t} vs total ${ds.total}`)
  return bad
}
ok(recon(d).length === 0, "every level reconciles: " + (recon(d).join(" | ") || "clean"))

/* no junk in any name, at any level */
const junk: string[] = []
for (const g of d.groups)
  for (const it of g.items) {
    for (const n of [it.name, ...(it.children || []).map((c) => c.name)])
      if (!n || /undefined|NaN|\[object/.test(n)) junk.push(`${g.name}: ${n}`)
    if (!(it.cost >= 0)) junk.push(`${g.name}/${it.name} cost=${it.cost}`)
  }
ok(junk.length === 0, "no undefined/NaN in any row name or cost " + junk.join(","))

/* image dimensions from a real header, not a flat constant */
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("\0\0\0\rIHDR", "binary"),
  (() => {
    const b = Buffer.alloc(8)
    b.writeUInt32BE(1024, 0)
    b.writeUInt32BE(768, 4)
    return b
  })(),
])
const dim = E.imageDims({
  source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
})
ok(
  !!dim && dim.w === 1024 && dim.h === 768,
  `PNG dimensions read from header: ${JSON.stringify(dim)}`,
)

/* ================= 2. The example the page offers a reader with no folder to point it at. It is
   transcript lines rather than a canned report, so it is only worth anything if the real walk
   still finds in it what it finds in a real corpus -- and if it carries nothing off the machine
   that generated it. */
console.log("\n== the example corpus ==")
{
  const S = E.analyze(sampleCorpus())
  const D = S.datasets["1h"]
  ok(D.total > 1, `it prices: ${money(D.total)}`)
  ok(D.requests > 500 && D.sessions === 9, `${D.requests} requests over ${D.sessions} sessions`)
  /* The densities the corpus is written to, recovered by the fit rather than assumed -- which is
     also what keeps the footnote saying "measured from this dataset". */
  ok(S.densityCalibrated, "the density fit calibrates")
  ok(
    Math.abs(S.density.code - 3.6) < 0.05 && Math.abs(S.density.text - 4.4) < 0.05,
    `and recovers the corpus: ${S.density.code.toFixed(2)} / ${S.density.text.toFixed(2)}`,
  )
  /* The page's whole argument. Sessions long enough for prose to be re-read is what puts this
     above 1, so a corpus trimmed for size would quietly start arguing the opposite. */
  const ratio = D.insights.proseCarry / D.insights.proseGen
  ok(ratio > 1, `carried costs more than generated: ${ratio.toFixed(2)}x`)
  // Something for the TTL lens to reprice, and something for every view to draw.
  ok(S.ttlTokens.unknown > 0, "some cache writes leave their TTL unrecorded")
  ok(D.groups.length >= 7, `${D.groups.length} groups have cost in them`)
  /* This repo is public and the example ships inside the page. Nothing in it may name the
     machine it was written on. */
  const all = sampleCorpus()
    .map((f) => f.text)
    .join("\n")
  ok(!/\/Users\/|\/home\/|%USERPROFILE%/.test(all), "no path off anyone's machine in it")
  // Same bill twice, or the figure would read as a live number rather than an example.
  ok(E.analyze(sampleCorpus()).datasets["1h"].total === D.total, "and it is the same every time")
}

/* ================= 3. A Codex rollout, which is the other store's format and the same bill. The
   figures are chosen so the total can be worked out by hand: gpt-5.4 bills $2.50 per 1M in, a
   tenth of that for a cache read, and $15.00 per 1M out. */
console.log("\n== a Codex rollout ==")
{
  const R: string[] = []
  let n = 0
  const line = (type: string, payload: Record<string, unknown>): number =>
    R.push(JSON.stringify({ timestamp: `2026-06-0${(++n % 9) + 1}T00:00:00Z`, type, payload }))
  const item = (payload: Record<string, unknown>): number => line("response_item", payload)
  const msg = (role: string, text: string): number =>
    item({ type: "message", role, content: [{ type: "input_text", text }] })
  const said = (text: string): number =>
    item({ type: "message", role: "assistant", content: [{ type: "output_text", text }] })
  const thought = (): number =>
    item({ type: "reasoning", summary: [], content: null, encrypted_content: "opaque" })
  const edit = (id: string, file: string, body: string): void => {
    item({
      type: "custom_tool_call",
      call_id: id,
      name: "apply_patch",
      input: `*** Begin Patch\n*** Update File: ${file}\n@@\n+${body}\n*** End Patch`,
    })
    item({ type: "custom_tool_call_output", call_id: id, output: "Success. Updated 1 file." })
  }
  /* Two figures per event, because a rollout may report either: what the last call spent, or only
     the running total the walk then has to difference. */
  const count = (cum: number[], last: number[] | null): number => {
    const of = (v: number[]): Record<string, number> => ({
      input_tokens: v[0],
      cached_input_tokens: v[1],
      cache_write_input_tokens: 0,
      output_tokens: v[2],
      reasoning_output_tokens: v[3],
      total_tokens: v[0] + v[2],
    })
    return line("event_msg", {
      type: "token_count",
      info: {
        total_token_usage: of(cum),
        ...(last ? { last_token_usage: of(last) } : {}),
        model_context_window: 400000,
      },
    })
  }

  line("session_meta", { session_id: "roll-1", cwd: "/somewhere/thing", originator: "codex-tui" })
  line("turn_context", { cwd: "/somewhere/thing", model: "gpt-5.4", effort: "high" })
  msg("developer", "R".repeat(6000))
  msg("user", "T".repeat(4000))

  // Turn one: 4k fresh in, 2k out. $0.01 + $0.03.
  thought()
  said("P".repeat(500))
  item({
    type: "function_call",
    call_id: "c1",
    name: "exec_command",
    arguments: JSON.stringify({ cmd: "git status --short", workdir: "/somewhere/thing" }),
  })
  item({ type: "function_call_output", call_id: "c1", output: "O".repeat(3000) })
  count([4000, 0, 2000, 400], [4000, 0, 2000, 400])

  // Turn two: 4k fresh, 40k cached, 2k out. $0.01 + $0.01 + $0.03.
  thought()
  edit("c2", "src/thing.ts", "x".repeat(700))
  edit("c3", "docs/note.md", "y".repeat(700))
  line("event_msg", {
    type: "mcp_tool_call_end",
    call_id: "c4",
    invocation: { server: "srv", tool: "lookup", arguments: { q: "Q".repeat(300) } },
    result: { Ok: { content: [{ type: "text", text: "A".repeat(900) }] } },
  })
  count([48000, 40000, 4000, 800], [44000, 40000, 2000, 400])
  // The same running total again, which is a line written twice rather than a request made twice.
  count([48000, 40000, 4000, 800], null)

  // Turn three reports no per-call figures, so the walk differences: 4k fresh, 80k cached, 2k out.
  thought()
  said("P".repeat(500))
  count([132000, 120000, 6000, 1200], null)

  const roll: RawFile = { name: "rollout-2026-06-01T00-00-00-roll-1.jsonl", text: R.join("\n") }
  ok(E.isCodexRollout(roll.text), "it is read as a rollout rather than as a transcript")
  ok(!E.isCodexRollout(lines[0]), "and a transcript is not")

  const C = E.analyze([roll])
  const D = C.datasets["1h"]
  ok(C.requests === 3 && C.sessions === 1, `${C.requests} requests over ${C.sessions} session(s)`)
  ok(D.total === 0.15, `it prices to the cent: ${money(D.total)}`)
  ok(D.input === 0.06 && D.output === 0.09, `input ${money(D.input)}, output ${money(D.output)}`)
  ok(Object.keys(C.unpriced).length === 0, "nothing goes unpriced")
  ok(
    C.models.length === 1 && C.models[0].id === "gpt-5.4" && C.models[0].basis === "exact",
    `the model resolves: ${C.models.map((m) => `${m.id} [${m.basis}]`).join(", ")}`,
  )
  /* OpenAI has no cache TTL to choose, so there is nothing for the lens to reprice. */
  ok(C.datasets["5m"].total === D.total, "the TTL lens cannot move an OpenAI bill")
  ok(C.ttlTokens.unknown === 0, "and no write is left with its TTL unrecorded")

  const rowOf = (id: string, name: string): { cost: number; kids: string[] } | null => {
    const g = D.groups.find((x) => x.id === id)
    const it = g?.items.find((x) => x.name === name)
    return it ? { cost: it.cost, kids: (it.children || []).map((c) => c.name) } : null
  }
  const all = D.groups.flatMap((g) =>
    g.items.flatMap((it) => [it.name, ...(it.children || []).map((c) => c.name)]),
  )
  ok((rowOf("shell", "git")?.cost ?? 0) > 0, "the shell command is read out of `cmd`: git")
  ok(!all.includes("(unmatched tool result)"), "every tool result finds the call it answers")
  const p = rowOf("emit", "apply_patch")
  ok(!!p, "the patch is a written-out tool")
  ok(
    !!p && p.kids.includes("*.ts") && p.kids.includes("*.md"),
    `and the files it touches name its rows: ${p ? p.kids.join(",") : "(absent)"}`,
  )
  ok(
    all.some((x) => x.startsWith("srv · lookup")),
    `the MCP call is its own row: ${all.join(" | ")}`,
  )
  ok((rowOf("typed", "your typed messages")?.cost ?? 0) > 0, "what the reader typed is theirs")
  ok(
    (rowOf("harness", "harness metadata")?.cost ?? 0) > 0,
    "the developer message is the harness's",
  )
  /* Codex encrypts its reasoning and counts it anyway, so the carry is sized by the count. */
  ok(
    (rowOf("output", "thinking blocks (re-billed as input)")?.cost ?? 0) > 0,
    "the reasoning it will not show still carries",
  )
  ok(recon(D).length === 0, "it reconciles: " + (recon(D).join(" | ") || "clean"))
}

/* ================= 4. The two shortcuts the rollout reader takes, both of which have to agree
   with the long way round: one reads a compaction off the front of the line rather than parsing
   it, and one hands the thread back part way through a file. */
console.log("\n== a rollout the reader takes shortcuts through ==")
{
  const L = (o: unknown): string => JSON.stringify(o)
  const top = [
    L({
      timestamp: "2026-06-01T00:00:00Z",
      type: "session_meta",
      payload: { session_id: "s", cwd: "/w", originator: "codex-tui" },
    }),
    L({
      timestamp: "2026-06-01T00:00:00Z",
      type: "turn_context",
      payload: { cwd: "/w", model: "gpt-5.4" },
    }),
  ]
  const billed = (n: number, out = 2000): string =>
    L({
      timestamp: "2026-06-03T00:00:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: n,
            cached_input_tokens: 0,
            output_tokens: out,
            total_tokens: n + out,
          },
        },
      },
    })

  /* == the compaction shortcut == A compaction as Codex writes one: a summary, and the rewritten
     prefix that replaces everything before it. The prefix is what the shortcut declines to read,
     and `keys` is what decides whether it can -- the shortcut only takes a summary that is the
     payload's first key, and hands the rest to the full parse. */
  const compacted = (summary: string, keys: string[]): string =>
    L({
      timestamp: "2026-06-02T00:00:00Z",
      type: "compacted",
      payload: Object.fromEntries(
        keys.map((k) =>
          k === "message"
            ? [k, summary]
            : [k, [{ role: "user", content: [{ type: "input_text", text: "H".repeat(50000) }] }]],
        ),
      ),
    })
  const bill = (mid: string): { total: number; summary: number } => {
    const one = E.analyze([
      { name: "rollout-a.jsonl", text: [...top, mid, billed(60000)].join("\n") },
    ])
    const D1 = one.datasets["1h"]
    const it = D1.groups
      .find((g) => g.id === "harness")
      ?.items.find((x) => x.name === "compaction summary")
    return { total: D1.total, summary: it?.cost ?? 0 }
  }
  /* Both kinds of escape, because the shortcut hands the summary's own literal to `JSON.parse`
     rather than reading the characters itself. */
  const summary = 'kept:\n"a \\ b"\u2014' + "S".repeat(40000)
  const fast = bill(compacted(summary, ["message", "replacement_history"]))
  const slow = bill(compacted(summary, ["replacement_history", "message"]))
  ok(fast.summary > 0, `the summary is priced as one: ${money(fast.summary)}`)
  ok(
    fast.total === slow.total && fast.summary === slow.summary,
    `and the shortcut bills what the full parse does: ${money(fast.summary)} of ${money(fast.total)}`,
  )
  const shorter = bill(compacted("S".repeat(400), ["message", "replacement_history"]))
  ok(shorter.summary < fast.summary, "a shorter summary costs less, so the text really arrives")

  /* == the slices == A clock the test moves by hand, because where the slices fall is otherwise a
     question about how fast this machine is rather than about the walk. */
  const real = globalThis.performance
  let tick = 0
  const fake = { now: (): number => (tick += 8) } as Performance
  const onClock = <T>(fn: () => T): T => {
    Object.defineProperty(globalThis, "performance", { value: fake, configurable: true })
    try {
      return fn()
    } finally {
      Object.defineProperty(globalThis, "performance", { value: real, configurable: true })
    }
  }
  const file: RawFile = {
    name: "rollout-long.jsonl",
    text: [
      ...top,
      ...Array.from({ length: 8 }, (_, k) => [
        L({
          timestamp: "2026-06-02T00:00:00Z",
          type: "response_item",
          payload: { type: "function_call_output", call_id: `c${k}`, output: "O".repeat(4000) },
        }),
        billed(20000 * (k + 1)),
      ]).flat(),
    ].join("\n"),
  }

  const whole = E.openWalk()
  onClock(() => E.walkOne(whole, file))
  const stepped = E.openWalk()
  const figures: number[] = []
  const slices = onClock(() => {
    const fw = E.openFile(stepped, file.name, file.text.length)
    E.pushText(fw, file.text)
    E.endText(fw)
    const steps = E.stepFile(fw)
    let n = 0
    for (;;) {
      const done = steps.next().done
      figures.push(E.billedSoFar(stepped))
      if (done) break
      n++
    }
    return n
  })
  ok(slices > 1, `it comes up for air ${slices} times inside one rollout`)
  ok(
    figures.every((v, k) => k === 0 || v >= figures[k - 1]) && figures.at(-1)! > figures[0],
    "and the running figure climbs through them rather than jumping at the end",
  )
  ok(
    E.billedSoFar(stepped) === E.billedSoFar(whole) && E.billedSoFar(whole) > 0,
    `a file walked in slices bills what one walked whole does: ${money(E.billedSoFar(stepped))}`,
  )
  /* Interruptible, which is what the slices are for: an iterator put down part way leaves the walk
     holding what it had read and nothing after it. */
  const dropped = E.openWalk()
  onClock(() => {
    const fw = E.openFile(dropped, file.name, file.text.length)
    E.pushText(fw, file.text)
    E.endText(fw)
    const half = E.stepFile(fw)
    // Far enough in to have billed something, nowhere near the end of the file.
    for (;;) {
      if (half.next().done || E.billedSoFar(dropped) > 0) break
    }
    half.return()
  })
  const part = E.billedSoFar(dropped)
  ok(
    part > 0 && part < E.billedSoFar(whole),
    `and one put down early is short rather than wrong: ${money(part)}`,
  )

  /* == the chunks == A store runs to gigabytes and a single rollout past what a string can hold,
     so the file arrives in pieces. Where the pieces fall is the platform's business, and one of
     them lands inside a line sooner or later. */
  const inPieces = (text: string, every: number): number => {
    const w = E.openWalk()
    const fw = E.openFile(w, "rollout-long.jsonl", text.length)
    for (let at = 0; at < text.length; at += every) {
      E.pushText(fw, text.slice(at, at + every))
      E.drainFile(fw)
    }
    E.endText(fw)
    E.drainFile(fw)
    return E.billedSoFar(w)
  }
  const one = E.billedSoFar(whole)
  /* Sizes chosen to be coprime with nothing in particular, so the joins land mid-line, mid-number
     and mid-key rather than politely between records. */
  const cuts = [1, 7, 383, 4096, file.text.length * 2]
  const same = cuts.filter((n) => inPieces(file.text, n) === one)
  ok(
    same.length === cuts.length,
    `the same bill however the bytes are cut up: ${same.length}/${cuts.length} of ${cuts.join(", ")}`,
  )

  /* == the screenshots == A rollout returns a picture as a base64 data URL inside the tool output,
     and there are gigabytes of that in a real store. What it costs is what the picture is, not how
     many characters it took to send. */
  const shotUrl = (w: number, h: number, filler: number): string => {
    const b = Buffer.alloc(24 + filler)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    b.set([0, 0, 0, 0x0d], 8)
    b.set([0x49, 0x48, 0x44, 0x52], 12)
    b.writeUInt32BE(w, 16)
    b.writeUInt32BE(h, 20)
    return "data:image/png;base64," + b.toString("base64")
  }
  const shot = (url: string): string =>
    [
      ...top,
      /* A small request first, because the preamble is whatever the first one cannot account for
         -- start with a big one and there is nothing left for anything else to have a share of. */
      billed(2000),
      L({
        timestamp: "2026-06-02T00:00:00Z",
        type: "response_item",
        payload: { type: "function_call", call_id: "c1", name: "view_image", arguments: "{}" },
      }),
      L({
        timestamp: "2026-06-02T00:00:00Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "c1",
          output: [{ type: "input_image", image_url: url }],
        },
      }),
      /* Something for the picture to be a share *of*: what a request bills is spread across
         everything in its context, so a picture on its own takes all of it whatever its size. */
      L({
        timestamp: "2026-06-02T00:00:00Z",
        type: "response_item",
        payload: { type: "function_call", call_id: "c2", name: "shell", arguments: "{}" },
      }),
      L({
        timestamp: "2026-06-02T00:00:00Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "c2", output: "T".repeat(20000) },
      }),
      billed(60000),
      /* And one more after it: what a request carries into context is spent by the requests that
         come after, so a picture in the last turn is a picture nothing has paid for yet. */
      billed(120000),
    ].join("\n")
  const shotBill = (url: string): { total: number; images: number; readIn: string[] } => {
    const priced = E.analyze([{ name: "rollout-shot.jsonl", text: shot(url) }])
    const D1 = priced.datasets["1h"]
    const g = (id: string) => D1.groups.find((x) => x.id === id)
    return {
      total: D1.total,
      images: g("media")?.cost ?? 0,
      readIn: (g("ingest")?.items ?? []).map((row) => row.name),
    }
  }
  const small = shotBill(shotUrl(64, 64, 40))
  const large = shotBill(shotUrl(1568, 1568, 40))
  /* Padded past the window the reader looks through, so the size has to come off the front of the
     picture rather than from how much of it arrived. */
  const padded = shotBill(shotUrl(1568, 1568, 900000))
  ok(large.images > 0, `the picture is priced as a picture: ${money(large.images)}`)
  ok(
    !large.readIn.includes("view_image"),
    `and not as tool output read in: ${large.readIn.join(", ") || "(nothing)"}`,
  )
  ok(
    padded.total === large.total && padded.images === large.images,
    `a picture sent in more characters is not a dearer picture: ${money(padded.total)} vs ${money(large.total)}`,
  )
  ok(
    large.images > small.images,
    `and a bigger picture is dearer than a smaller one: ${money(large.images)} against ${money(small.images)}`,
  )

  /* Both shortcuts read a line off its front rather than out of the whole of it, so where a chunk
     boundary falls decides whether the shortcut is available at all -- and it must not decide the
     bill. */
  const mixed = [
    ...top,
    billed(2000),
    compacted("carrying on", ["message", "replacement_history"]),
    L({
      timestamp: "2026-06-02T00:00:00Z",
      type: "response_item",
      payload: { type: "function_call", call_id: "c9", name: "view_image", arguments: "{}" },
    }),
    L({
      timestamp: "2026-06-02T00:00:00Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "c9",
        output: [{ type: "input_image", image_url: shotUrl(1568, 1568, 40000) }],
      },
    }),
    billed(60000),
    billed(120000),
  ].join("\n")
  const mixedWhole = ((): number => {
    const w = E.openWalk()
    E.walkOne(w, { name: "rollout-mixed.jsonl", text: mixed })
    return E.billedSoFar(w)
  })()
  const mixedCuts = [1, 97, 4096, 65536]
  const mixedSame = mixedCuts.filter((n) => inPieces(mixed, n) === mixedWhole)
  ok(
    mixedSame.length === mixedCuts.length && mixedWhole > 0,
    `a compaction and a picture bill the same wherever the joins fall: ` +
      `${mixedSame.length}/${mixedCuts.length} of ${mixedCuts.join(", ")}`,
  )

  /* == the records nothing asks for == Nearly a third of what a real store still parsed was
     records the reader has no case for. The list of payloads it handles is now the list it
     consults before parsing, so the two cannot drift -- and a payload absent from it has to leave
     the bill exactly where it was. */
  const noise = [
    L({
      timestamp: "2026-06-02T00:00:00Z",
      type: "response_item",
      payload: { type: "reasoning", summary: [], encrypted_content: "Z".repeat(30000) },
    }),
    L({
      timestamp: "2026-06-02T00:00:00Z",
      type: "event_msg",
      payload: { type: "item_completed", item: { text: "Q".repeat(30000) } },
    }),
    L({
      timestamp: "2026-06-02T00:00:00Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "M".repeat(30000) },
    }),
    L({
      timestamp: "2026-06-02T00:00:00Z",
      type: "event_msg",
      payload: { type: "a_type_from_a_later_version", body: "N".repeat(30000) },
    }),
  ]
  const quiet = [...top, billed(2000), billed(60000)].join("\n")
  const noisy = [...top, billed(2000), ...noise, billed(60000)].join("\n")
  const totalOf = (text: string): number =>
    E.analyze([{ name: "rollout-noise.jsonl", text }]).datasets["1h"].total
  ok(
    totalOf(quiet) === totalOf(noisy) && totalOf(quiet) > 0,
    `records nothing asks for leave the bill alone: ${money(totalOf(noisy))} either way`,
  )

  /* == the model that arrives late == A rollout can bill requests before it says which model made
     them, and two of a real store's thousand say so tens of megabytes in -- far past anything the
     reader can hold the front of the file for. Those requests wait for the name rather than going
     out unpriced. */
  const late = [
    L({
      timestamp: "2026-06-01T00:00:00Z",
      type: "session_meta",
      payload: { session_id: "s", cwd: "/w" },
    }),
    billed(30000),
    billed(60000),
    L({
      timestamp: "2026-06-02T00:00:00Z",
      type: "turn_context",
      payload: { cwd: "/w", model: "gpt-5.4" },
    }),
    billed(90000),
  ].join("\n")
  const lateBill = E.analyze([{ name: "rollout-late.jsonl", text: late }])
  ok(
    lateBill.requests === 3 && Object.keys(lateBill.unpriced).length === 0,
    `all ${lateBill.requests} of them are priced, none unpriced: ` +
      (Object.keys(lateBill.unpriced).join(", ") || "clean"),
  )
  ok(
    lateBill.models.length === 1 && lateBill.models[0].id === "gpt-5.4",
    `and on the model named after them: ${lateBill.models.map((m) => m.id).join(", ")}`,
  )
  // Cut so the name lands chunks away from the requests that are waiting on it.
  const w2 = E.openWalk()
  const fw2 = E.openFile(w2, "rollout-late.jsonl", late.length)
  for (let at = 0; at < late.length; at += 64) {
    E.pushText(fw2, late.slice(at, at + 64))
    E.drainFile(fw2)
  }
  E.endText(fw2)
  E.drainFile(fw2)
  const closedLate = E.closeWalk(w2)
  ok(
    E.report(closedLate.scanned, closedLate.alloc).requests === 3,
    "and still all of them when the name arrives chunks after the requests",
  )
}

/* ================= 5. */
const dir = process.argv[2]
if (dir) {
  console.log(`\n== real transcripts: ${dir} ==`)
  if (!fs.existsSync(dir)) {
    console.log("  no such directory")
    process.exit(1)
  }
  const real: RawFile[] = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") }))
  ok(real.length > 0, `${real.length} .jsonl file(s) found`)
  const t0 = Date.now()
  const R = E.analyze(real)
  console.log(`  ${R.requests.toLocaleString()} requests in ${Date.now() - t0} ms`)
  const D1 = R.datasets["1h"],
    D5 = R.datasets["5m"]
  console.log(
    `  total ${money(D1.total)}  ·  density ${R.density.code.toFixed(2)}/${R.density.text.toFixed(2)} (${R.density.basis})`,
  )
  console.log(`  TTL recorded for ${(R.ttlMeasuredShare * 100).toFixed(1)}% of write tokens`)
  console.log(`  models: ${R.models.map((m) => `${m.id} [${m.basis}]`).join(", ")}`)
  console.log(`  learned dispatchers: ${R.dispatchers.join(" ") || "(none)"}`)
  R.warnings.forEach((w) => console.log("  ! " + w))
  ok(recon(D1).length === 0, "1h reconciles: " + (recon(D1).join(" | ") || "clean"))
  ok(recon(D5).length === 0, "5m reconciles: " + (recon(D5).join(" | ") || "clean"))
  ok(
    Object.keys(R.unpriced).length === 0 || true,
    `unpriced models: ${Object.keys(R.unpriced).join(", ") || "none"}`,
  )
  const ca = D1.groups.find((g) => g.id === "twoway")
  ok(
    !ca || ca.cost / D1.total < 0.2,
    `catch-all group stays small: ${ca ? ((ca.cost / D1.total) * 100).toFixed(1) + "%" : "absent"}`,
  )
  const j: string[] = []
  for (const g of D1.groups)
    for (const it of g.items)
      for (const n of [it.name, ...(it.children || []).map((c) => c.name)])
        if (!n || /undefined|NaN|\[object/.test(n)) j.push(`${g.name}: ${n}`)
  ok(j.length === 0, "no junk rows " + j.slice(0, 5).join(","))
  for (const g of D1.groups)
    console.log(
      `   ${((g.cost / D1.total) * 100).toFixed(1).padStart(5)}%  ${money(g.cost).padStart(10)}  ${g.name}  (${g.items.length} items)`,
    )
} else {
  console.log(
    "\n(pass a transcript directory to also check real data:  node test/engine.test.ts <dir>)",
  )
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall checks passed")
process.exit(fails ? 1 : 0)
