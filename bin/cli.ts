#!/usr/bin/env node
/* Runs the same engine the page runs, on the transcripts already on this machine, then hands
   the answer to the deployed page through the one place a URL never reaches a server: its
   fragment. Gzipped and base64url'd, since the analysis is JSON and an address bar is not. */

import { execFile } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { analyze, type RawFile } from "../src/engine.ts"

const REPORT_URL = "https://token-billing.vercel.app/"

function walk(dir: string, out: RawFile[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith(".jsonl")) out.push({ name, text: readFileSync(p, "utf8") })
  }
}

/** The platform's own way to hand a URL to whatever browser is already the default -- `start` is
 *  a shell builtin rather than a program, so it alone goes through `cmd`. */
function open(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]]
  execFile(cmd, args, (err) => {
    if (err) console.error(`could not open a browser -- open this yourself:\n${url}`)
  })
}

function main(): void {
  const dir = process.argv[2] ?? join(homedir(), ".claude", "projects")
  const files: RawFile[] = []
  try {
    walk(dir, files)
  } catch (e) {
    console.error(`could not read ${dir}: ${(e as Error).message}`)
    process.exitCode = 1
    return
  }
  if (!files.length) {
    console.error(`no .jsonl transcripts under ${dir}`)
    process.exitCode = 1
    return
  }

  let data
  try {
    data = analyze(files)
  } catch (e) {
    console.error((e as Error).message)
    process.exitCode = 1
    return
  }
  if (!data.requests) {
    console.error(
      `${files.length} transcript(s) read, but nothing in them was billed -- ` +
        `is ${dir} really a Claude Code projects folder?`,
    )
    process.exitCode = 1
    return
  }

  const payload = gzipSync(Buffer.from(JSON.stringify(data), "utf8")).toString("base64url")
  console.log(
    `$${data.datasets["1h"].total.toFixed(2)} across ${data.requests} requests, ` +
      `${data.sessions} session(s) -- opening ${REPORT_URL}`,
  )
  open(`${REPORT_URL}#d=${payload}`)
}

main()
