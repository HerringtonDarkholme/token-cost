/* The arithmetic behind the views, with no renderer in the way. */

import { analyze, type Dataset } from "../src/engine.ts"
import { LANGS } from "../src/i18n.ts"
import {
  fold,
  focusOf,
  kidsOf,
  ledger,
  palette,
  postLength,
  postText,
  postVariants,
  POST_MAX,
  rowIsOpen,
  sunburst,
  SUN_RINGS,
  vouched,
  type CostNode,
} from "../src/model.ts"
import { corpus } from "./fixture.ts"

let fails = 0
const ok = (c: boolean, m: string): void => {
  if (!c) fails++
  console.log((c ? "ok   " : "FAIL ") + m)
}
const sum = (l: CostNode[]): number => l.reduce((a, n) => a + n.cost, 0)
/** Folding rounds its "other" row to the cent, and the engine's own split carries a little float
 *  noise, so equality is to the cent plus a hair proportional to the magnitude. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.02 + Math.abs(b) * 0.001
/** Angles are computed, not accumulated from the data, so they compare exactly. */
const closeDeg = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6

const data = analyze(corpus(process.argv[2]))
console.log(`\n== model · ${data.requests} requests · ${data.filesUsed} file(s) ==`)

for (const ttl of ["1h", "5m"] as const) {
  const d: Dataset = data.datasets[ttl]
  console.log(`\n-- ${ttl} lens --`)

  /* 1. */
  let foldOk = true
  for (const g of d.groups) {
    if (!near(sum(fold(g.items, g.cost)), sum(g.items))) foldOk = false
    for (const it of g.items)
      if (it.children && !near(sum(fold(it.children, it.cost)), sum(it.children))) foldOk = false
  }
  ok(foldOk, "folding preserves the total at every level")

  /* 2. */
  const L = ledger(d, [], {}, "")
  ok(
    near(L.recon, d.total),
    `root ledger reconciles: $${L.recon.toFixed(2)} vs $${d.total.toFixed(2)}`,
  )

  /* 3. */
  const paths: string[][] = [[]]
  for (const g of d.groups) {
    paths.push([g.name])
    const kid = g.items.find((i) => i.children && i.children.length > 1)
    if (kid) paths.push([g.name, kid.name])
  }
  let reconOk = true,
    checked = 0
  for (const path of paths) {
    const rows = ledger(d, path, {}, "").rows
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r.hasKids || !r.open) continue
      let kids = 0
      for (let j = i + 1; j < rows.length && rows[j].depth > r.depth; j++)
        if (rows[j].depth === r.depth + 1) kids += rows[j].node.cost
      checked++
      if (!near(kids, r.node.cost)) {
        reconOk = false
        console.log(
          `     ${path.join(" › ") || "all"} :: ${r.node.name} — ` +
            `children $${kids.toFixed(2)} vs $${r.node.cost.toFixed(2)}`,
        )
      }
    }
  }
  ok(reconOk, `children sum to parent (${checked} parent rows across ${paths.length} drill paths)`)

  /* 3b. */
  let leafOk = true
  const restated = (where: string, what: string): void => {
    leafOk = false
    console.log(`     ${where} :: ${what}`)
  }
  for (const path of paths) {
    const where = path.join(" › ") || "all"
    for (const r of ledger(d, path, {}, "").rows) {
      const k = kidsOf(r.node)
      if (k && k.length === 1 && !kidsOf(k[0]))
        restated(where, `row ${r.node.name} — lone leaf ${k[0].name}`)
    }
    for (const b of sunburst(focusOf(d, path))) {
      for (const a of b.arcs) {
        const kids = b.arcs.filter((x) => x.ring === a.ring + 1 && x.key === a.key + "›" + x.name)
        if (kids.length !== 1) continue
        const grand = b.arcs.some(
          (x) => x.ring === a.ring + 2 && x.key.startsWith(kids[0].key + "›"),
        )
        if (!grand && closeDeg(kids[0].a1 - kids[0].a0, a.a1 - a.a0))
          restated(where, `arc ${a.name} — ring ${a.ring + 1} restates it and stops`)
      }
    }
  }
  ok(leafOk, "a lone child is drawn only when it splits further")

  /* 4. */
  ok(focusOf(d, ["no such group"]).groupName === null, "unknown drill path falls back to the root")
  ok(
    focusOf(d, [d.groups[0].name, "no such item"]).node.name === d.groups[0].name,
    "unknown item falls back to its group",
  )

  /* 5. */
  ok(
    ledger(d, [], {}, "zzzzzznope").rows.length === 0,
    "a query that matches nothing yields no rows",
  )
  const probe = (d.groups[0].items[0]?.name || d.groups[0].name).slice(0, 4).toLowerCase()
  const hits = ledger(d, [], {}, probe).rows
  const matches = (n: string): boolean => n.toLowerCase().includes(probe)
  let relevant = hits.length > 0
  for (let i = 0; i < hits.length; i++) {
    if (matches(hits[i].node.name)) continue
    let descendant = false
    for (let j = i + 1; j < hits.length && hits[j].depth > hits[i].depth; j++)
      if (matches(hits[j].node.name)) descendant = true
    if (!descendant) relevant = false
  }
  ok(relevant, `“${probe}” shows only matches and their ancestors (${hits.length} rows)`)

  /* 6. */
  const pal = palette(data, d)
  ok(
    d.groups.every((g) => /^var\(--c[1-8]\)$|^var\(--cn\)$/.test(pal.hue(g.name))),
    "every group gets a palette token, a 9th takes the neutral",
  )
  ok(pal.hue("something never seen") === "var(--cn)", "an unknown group is neutral, not undefined")

  /* 7. */
  let sunOk = true,
    arcs = 0
  for (const path of paths) {
    const at = focusOf(d, path)
    const tree = sunburst(at)
    if (!tree.length) continue
    const total = tree.reduce((s, b) => s + b.cost, 0)
    let cursor = 0
    for (const b of tree) {
      const root = b.arcs[0]
      /* Ring 0 is laid end to end around the whole circle, in order, with no gaps -- and a level
         that rounds to nothing anywhere is split evenly rather than drawn away. */
      if (!closeDeg(root.a0, cursor)) sunOk = false
      if (!closeDeg(root.a1 - root.a0, total > 0 ? (b.cost / total) * 360 : 360 / tree.length))
        sunOk = false
      cursor = root.a1

      const seen = new Set<string>()
      for (const a of b.arcs) {
        arcs++
        if (a.ring >= SUN_RINGS || seen.has(a.key)) sunOk = false // keys are React keys too
        seen.add(a.key)
        const kids = b.arcs.filter(
          (k) =>
            k.ring === a.ring + 1 &&
            k.key.startsWith(a.key + "›") &&
            !k.key.slice(a.key.length + 1).includes("›"),
        )
        if (!kids.length) continue
        if (!closeDeg(kids[0].a0, a.a0) || !closeDeg(kids[kids.length - 1].a1, a.a1)) sunOk = false
        for (let i = 1; i < kids.length; i++)
          if (!closeDeg(kids[i].a0, kids[i - 1].a1)) sunOk = false
      }
    }
    if (!closeDeg(cursor, 360)) sunOk = false
  }
  ok(
    sunOk,
    `sunburst rings tile exactly and sweep with cost (${arcs} arcs over ${paths.length} paths)`,
  )
}

/* 8. */
ok(rowIsOpen({}, "k›0", 0) === true, "top-level rows default open")
ok(rowIsOpen({}, "k›1", 1) === false, "deeper rows default closed")
ok(rowIsOpen({ "k›0": false }, "k›0", 0) === false, "an explicit toggle overrides the default")

/* 9. */
{
  const dd = data.datasets["1h"]
  const home = "https://a-fairly-long-deployment-name.example.vercel.app/"
  const open = postVariants(dd, false, home),
    masked = postVariants(dd, true, home)
  const both = [...open, ...masked]

  ok(
    open.length > 0 && masked.length > 0,
    `every dataset yields a caption (${open.length} open / ${masked.length} masked)`,
  )
  ok(
    both.every((s) => postLength(s) <= POST_MAX),
    `every caption fits a post (longest ${Math.max(...both.map(postLength))} of ${POST_MAX})`,
  )
  ok(
    !both.some((s) => /undefined|NaN|\$0\.00|\b0(\.0)?%/.test(s)),
    "no caption has a hole, or quotes a figure that rounded away to nothing",
  )
  ok(!masked.some((s) => s.includes("$")), "covering the amounts keeps money out of every caption")
  ok(
    open.every((s) => s.endsWith(home)),
    "the invitation survives whatever else has to be cut",
  )
  ok(
    !postVariants(dd, false).some((s) => /yours|https?:/i.test(s)),
    "with nowhere to point, the invitation is dropped rather than left dangling",
  )

  /* A caption may name a leaf, and a leaf name is the reader's own shell history: an internal
     CLI or a deploy script with a hostname in it. */
  const unvouched = dd.groups
    .filter((g) => ["shell", "ingest", "emit", "twoway"].includes(g.id))
    .flatMap((g) => g.items.filter((i) => !vouched(g.id, i.name)))
  ok(unvouched.length > 0, `the corpus contains names that may not be posted (${unvouched.length})`)
  ok(
    !unvouched.some((i) => both.some((s) => s.includes(i.name))),
    `an in-house CLI or MCP server is charted but never posted (${unvouched.map((i) => i.name).join(", ")})`,
  )

  /* The draw only ever lands on a caption that was built, for any fraction including the
     endpoints -- an out-of-range index here would ship `undefined` into the composer. */
  ok(
    [0, 0.25, 0.5, 0.999, 1].every((p) => open.includes(postText(dd, false, home, p))),
    "the random draw always lands on one of the built captions",
  )

  /* And every claim above, in every language the page speaks. */
  for (const { value: l, label } of LANGS) {
    const covered = postVariants(dd, true, home, l)
    const all = [...postVariants(dd, false, home, l), ...covered]
    const longest = Math.max(...all.map(postLength))
    ok(
      all.length > 0 && longest <= POST_MAX,
      `${label}: every caption fits a post (longest ${longest} of ${POST_MAX})`,
    )
    ok(!all.some((s) => /undefined|NaN|\$0\.00/.test(s)), `${label}: no caption has a hole`)
    ok(
      !covered.some((s) => s.includes("$")),
      `${label}: covering the amounts keeps money out of every caption`,
    )
    ok(
      postVariants(dd, false, null, l).every((s) => !s.includes(home)),
      `${label}: with nowhere to point, the invitation is dropped`,
    )
  }
}

console.log(fails ? `\n${fails} MODEL FAILURE(S)` : "\nmodel clean")
process.exit(fails ? 1 : 0)
