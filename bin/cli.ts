#!/usr/bin/env node
/* Runs the same engine the page runs, on the transcripts already on this machine, then hands
   the answer to the deployed page through the one place a URL never reaches a server: its
   fragment. Gzipped and base64url'd, since the analysis is JSON and an address bar is not. */

import { execFile } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, join } from "node:path"
import { gzipSync } from "node:zlib"
import { closeWalk, openWalk, report, skipFile, walkOne } from "../src/engine.ts"

/** Where the report is read. The override is what lets `pnpm dev`, or a copy of the page someone
 *  hosts themselves, stand in for the deployed one -- which is how the hand-off gets tested
 *  against the working tree rather than against whatever is currently in production. */
const REPORT_URL = process.env.TOKEN_BILLING_URL || "https://token-billing.vercel.app/"

/** The two stores, and where each agent keeps its sessions. `CODEX_HOME` is Codex's own override
 *  for the second one. */
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex")
const STORES = [
  join(homedir(), ".claude", "projects"),
  join(CODEX_HOME, "sessions"),
  join(CODEX_HOME, "archived_sessions"),
]

/** Windows caps a `cmd` command line at 8191 characters, which a corpus with enough distinct
 *  tools in it can exceed on its own. Past this the address goes through a file instead of
 *  through the shell -- see `handOff`. */
const MAX_URL_ARG = 7800

/** Paths only. The contents are read one at a time below, because a real `~/.claude/projects`
 *  runs to hundreds of megabytes and holding it as JS strings costs twice that. */
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
    else if (e.name.endsWith(".jsonl")) out.push(p)
  }
}

/** The platform's own way to hand a URL to whatever browser is already the default -- `start` is
 *  a shell builtin rather than a program, so it alone goes through `cmd`. */
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

/** A URL too long to survive a command line is handed over as a file that redirects to it: the
 *  browser then reads the address out of a document rather than out of `argv`, and no shell has
 *  to carry it. Written `0600` because it holds the report. */
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

/** Where a report is handed over: `/open` fetches the charts and none of the folder-reading half
 *  of the page, so the door is worth naming rather than landing on the front. A URL that names a
 *  file is somebody's standalone copy, which has no routes to send anything to. */
function importUrl(base: string, payload: string): string {
  const at = base.replace(/#.*$/, "")
  const door = /\.html?$/i.test(at) ? at : at.replace(/\/*$/, "/") + "open"
  return `${door}#d=${payload}`
}

function main(): void {
  const argv = process.argv.slice(2)
  /* Printing rather than opening is what a machine you reached over SSH needs, and it is how the
     hand-off is tested without a browser being taken over to do it. */
  const print = argv.includes("--print") || argv.includes("-p")
  const named = argv.filter((a) => !a.startsWith("-"))
  /* With nothing named, both stores are read and a missing one is not a failure: most machines run
     one of the two agents rather than both. */
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

  /* One transcript held at a time, which is the whole reason this drives the walk itself rather
     than calling `analyze` on a list of file contents. */
  const progress = !!process.stderr.isTTY
  const w = openWalk()
  let read = 0
  for (const p of paths) {
    try {
      walkOne(w, { name: basename(p), text: readFileSync(p, "utf8") })
    } catch (e) {
      /* Counted, not just printed: the report rides into the page over a URL, and a total that is
         short has to say so there too. */
      skipFile(w)
      console.error(`skipped ${basename(p)}: ${(e as Error).message}`)
      continue
    }
    read++
    /* A rewritten line, and only where something is watching: piped into a file this would be
       one line per twenty-five transcripts. */
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
      `${paths.length} session(s) read, but nothing in them was billed -- is ${where} really ` +
        `a Claude Code projects folder or a Codex sessions folder?`,
    )
    process.exitCode = 1
    return
  }

  const payload = gzipSync(Buffer.from(JSON.stringify(data), "utf8")).toString("base64url")
  const url = importUrl(REPORT_URL, payload)
  if (print) {
    /* The URL alone on stdout, so it can be piped. What it cost goes to stderr with the rest of
       the narration. */
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

main()
