/* What a pageview is allowed to say. The drill path is built from the reader's own line-item
   names, so this suite is the thing standing between an in-house MCP server and Vercel. */

import { analyze } from "../src/core/engine.ts"
import { hosted, scrub } from "../src/core/analytics.ts"
import { pathFor } from "../src/ui/store.ts"

import { synthetic } from "./fixture.ts"

let fails = 0
const ok = (c: boolean, m: string): void => {
  if (!c) fails++
  console.log((c ? "ok   " : "FAIL ") + m)
}

console.log("\n== what a pageview may say ==")

const B = "https://token-billing.vercel.app"
ok(scrub(`${B}/`) === `${B}/`, "the empty card is the empty card")
ok(scrub(`${B}/report`) === `${B}/report`, "the report is the report")
ok(scrub(`${B}/report/shell-commands`) === `${B}/report`, "a group drill collapses to /report")
ok(
  scrub(`${B}/report/tools-content-read-in/acmeinternal-fetch-ledger`) === `${B}/report`,
  "and so does the item under it, which is where the employer's name would have been",
)
ok(scrub(`${B}/report/?q=acme#t=dark`) === `${B}/report`, "the query and the hash are dropped")
ok(!scrub(`${B}/#d=H4sIAAAA`)?.includes("d="), "a report handed over by the CLI never rides along")
ok(scrub("not a url at all") === null, "an address that will not parse reports nothing at all")

/* The shape Vercel's ingest will take: anything short of a whole address comes back a 400 and the
   view is dropped on the floor, so the two faces are checked for the front of one and not just the
   back. */
ok(/^https?:\/\//.test(scrub(`${B}/`) || ""), "the empty card goes out as a whole address")
ok(/^https?:\/\//.test(scrub(`${B}/report/git`) || ""), "and so does the report")

/* The real thing rather than a hand-written path: every name the tree can produce, run through
   the address the page would put it in, and asserted to come back saying nothing. */
const data = analyze(synthetic())
const d = data.datasets["1h"]
const names: string[] = []
for (const g of d.groups) {
  names.push(g.name)
  for (const it of g.items) names.push(it.name)
}
const leaked = names.filter((n) => {
  const out = scrub(B + pathFor(true, [n]))
  return out !== `${B}/report`
})
ok(
  leaked.length === 0,
  `every one of the corpus's ${names.length} names scrubs away (${leaked.slice(0, 3).join(", ") || "none left"})`,
)

/* The second level too, since that is the one that names a subcommand or an extension. */
const deep: (string | null)[] = []
for (const g of d.groups)
  for (const it of g.items)
    for (const c of it.children || []) deep.push(scrub(B + pathFor(true, [it.name, c.name])))
ok(
  deep.length > 0 && deep.every((p) => p === `${B}/report`),
  `and all ${deep.length} second-level drills with it`,
)

console.log("\n== which copies report at all ==")
ok(hosted("https:", "/") === true, "the deployed page does")
ok(hosted("https:", "/report/git") === true, "and so does a drill into it")
ok(hosted("file:", "/Downloads/cost-report.html") === false, "a file on disk does not")
ok(hosted("http:", "/cost-report.html") === false, "nor the standalone served over http")
ok(hosted("https:", "/anything/cost-report.HTML") === false, "whatever case it is spelled in")

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall checks passed")
process.exit(fails ? 1 : 0)
