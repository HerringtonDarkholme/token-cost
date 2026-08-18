/* The CLI's half of the round trip is a few lines of `gzipSync` + base64url, reproduced here
   rather than imported from `bin/cli.ts`, which also wants to run `open()` on the way out. */

import { gzipSync } from "node:zlib"
import { analyze } from "../src/engine.ts"
import { decodeImport, readImport, stripImport } from "../src/transfer.ts"
import { synthetic } from "./fixture.ts"

let fails = 0
const ok = (c: boolean, m: string): void => {
  if (!c) fails++
  console.log((c ? "ok   " : "FAIL ") + m)
}

const data = analyze(synthetic())
const encode = (): string =>
  gzipSync(Buffer.from(JSON.stringify(data), "utf8")).toString("base64url")

console.log("\n== CLI -> URL fragment -> page ==")

const payload = encode()
ok(readImport(`#ttl=5m&d=${payload}`) === payload, "the payload rides the hash under its own key")
ok(readImport("#ttl=5m") === null, "a hash with no payload reads as none")
ok(stripImport(`#ttl=5m&d=${payload}`) === "#ttl=5m", "stripping it leaves the view settings")
ok(stripImport(`#d=${payload}`) === "", "and leaves nothing when it was the only key")

const back = await decodeImport(payload)
ok(
  JSON.stringify(back) === JSON.stringify(data),
  "gzip + base64url round-trips the analysis exactly",
)
ok((await decodeImport("not a real payload")) === null, "a payload that isn't one decodes to null")

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall checks passed")
process.exit(fails ? 1 : 0)
