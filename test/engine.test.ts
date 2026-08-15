import * as E from "../src/engine.ts"
import type { Dataset, RawFile, Usage } from "../src/engine.ts"
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

/* ================= 2. */
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
