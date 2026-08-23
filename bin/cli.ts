#!/usr/bin/env node
/* Runs the same engine the page runs, on the transcripts already on this machine, then hands the
   answer to the page through the one place a URL never reaches a server: its fragment. */

import { execFile } from "node:child_process"
import { createReadStream, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, join } from "node:path"
import { gzipSync } from "node:zlib"
import {
  closeWalk,
  drainFile,
  endText,
  openFile,
  openWalk,
  pushText,
  report,
  skipFile,
} from "../src/core/engine.ts"
import { AGENTS, SIDECAR_NAMES } from "../src/core/agents/index.ts"

/** Where the report is read. The override lets `pnpm dev`, or somebody's own copy, stand in for
 *  the deployed page, which is how the hand-off is tested against the working tree. */
const REPORT_URL = process.env.TOKEN_BILLING_URL || "https://token-billing.vercel.app/"

/** Every folder any agent keeps its sessions in, each agent having said where. An agent added to
 *  `src/core/agents/` is read here without being named here. */
const STORES = AGENTS.flatMap((a) =>
  (a.stores ?? []).flatMap((store) => {
    const root = (store.env && process.env[store.env]) || join(homedir(), store.home)
    return store.dirs.map((d) => join(root, d))
  }),
)

/** Windows caps a `cmd` command line at 8191 characters, which a big corpus can exceed on its own;
 *  past this the address goes through a file -- see `handOff`. */
const MAX_URL_ARG = 7800

/** Paths only: the contents are read one at a time below, a real store running to hundreds of
 *  megabytes. */
function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    let dirent = e.isDirectory()
    if (e.isSymbolicLink()) {
      /* A link is followed, but a broken one is skipped rather than allowed to end the run. */
      try {
        dirent = statSync(p).isDirectory()
      } catch {
        continue
      }
    }
    if (dirent) walk(p, out)
    else if (e.name.endsWith(".jsonl") && !SIDECAR_NAMES.has(e.name)) out.push(p)
  }
}

/** The platform's way to hand a URL to the default browser -- `start` is a shell builtin, so it
 *  alone goes through `cmd`. */
function open(target: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]]
  execFile(cmd, args, (err) => {
    if (err) console.error(`could not open a browser -- open this yourself:\n${target}`)
  })
}

/** A URL too long for a command line goes over as a file that redirects to it, so no shell has to
 *  carry it. Written `0600` because it holds the report. */
function handOff(url: string): void {
  if (url.length <= MAX_URL_ARG) {
    open(url)
    return
  }
  const file = join(tmpdir(), `token-billing-${process.pid}.html`)
  writeFileSync(
    file,
    `<!doctype html><meta charset="utf-8"><title>Opening your report…</title>` +
      `<script>location.replace(${JSON.stringify(url)})</script>`,
    { mode: 0o600 },
  )
  console.error(`the report is large, so it goes via ${file}`)
  open(file)
}

/** Where a report is handed over: `/open` fetches the charts and none of the folder-reading half.
 *  A URL that names a file is somebody's standalone copy, which has no routes. */
function importUrl(base: string, payload: string): string {
  const at = base.replace(/#.*$/, "")
  const door = /\.html?$/i.test(at) ? at : at.replace(/\/*$/, "/") + "open"
  return `${door}#d=${payload}`
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  /* Printing rather than opening is what a machine reached over SSH needs, and how the hand-off is
     tested without a browser. */
  const print = argv.includes("--print") || argv.includes("-p")
  const named = argv.filter((a) => !a.startsWith("-"))
  /* With nothing named, every store is read and a missing one is not a failure. */
  const dirs = named.length ? named : STORES
  const where = dirs.join(", ")
  const paths: string[] = []
  const failed: string[] = []
  for (const d of dirs) {
    try {
      walk(d, paths)
    } catch (e) {
      failed.push(`could not read ${d}: ${(e as Error).message}`)
    }
  }
  if (!paths.length) {
    if (failed.length) for (const f of failed) console.error(f)
    else console.error(`no .jsonl sessions under ${where}`)
    process.exitCode = 1
    return
  }

  /* One chunk of one transcript at a time, which is why this drives the walk rather than calling
     `analyze` on file contents: a rollout can run past what a JS string holds. */
  const progress = !!process.stderr.isTTY
  const w = openWalk()
  let read = 0
  for (const p of paths) {
    const fw = openFile(w, basename(p), statSync(p).size)
    try {
      /* oxlint-disable-next-line no-await-in-loop -- one chunk at a time is the point of it. */
      for await (const chunk of createReadStream(p, { encoding: "utf8", highWaterMark: 1 << 20 })) {
        pushText(fw, chunk as string)
        drainFile(fw)
      }
      endText(fw)
      drainFile(fw)
    } catch (e) {
      /* Counted, not just printed: a total that is short has to say so in the page too. */
      skipFile(w)
      console.error(`skipped ${basename(p)}: ${(e as Error).message}`)
      continue
    }
    read++
    /* Only where something is watching: piped into a file this is one line per twenty-five
       files. */
    if (progress && (read % 25 === 0 || read === paths.length)) {
      process.stderr.write(`\r\u001b[Kreading ${read} / ${paths.length}`)
    }
  }
  if (progress) process.stderr.write("\r\u001b[K")

  let data
  try {
    const closed = closeWalk(w)
    if (!closed.scanned.filesUsed) {
      console.error(`nothing readable under ${where}`)
      process.exitCode = 1
      return
    }
    data = report(closed.scanned, closed.alloc)
  } catch (e) {
    console.error((e as Error).message)
    process.exitCode = 1
    return
  }
  if (!data.requests) {
    console.error(
      `${paths.length} session(s) read, but nothing in them was billed -- is ${where} really a ` +
        `session folder for one of ${AGENTS.map((a) => a.name).join(", ")}?`,
    )
    process.exitCode = 1
    return
  }

  const payload = gzipSync(Buffer.from(JSON.stringify(data), "utf8")).toString("base64url")
  const url = importUrl(REPORT_URL, payload)
  if (print) {
    /* The URL alone on stdout so it can be piped; what it cost goes to stderr. */
    console.error(
      `$${data.datasets["1h"].total.toFixed(2)} across ${data.requests} requests, ` +
        `${data.sessions} session(s)`,
    )
    console.log(url)
    return
  }
  console.log(
    `$${data.datasets["1h"].total.toFixed(2)} across ${data.requests} requests, ` +
      `${data.sessions} session(s) -- opening ${REPORT_URL}`,
  )
  handOff(url)
}

await main()
