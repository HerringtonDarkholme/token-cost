#!/usr/bin/env node
/* Runs the same engine the page runs, on the transcripts already on this machine, then hands
   the answer to the deployed page through the one place a URL never reaches a server: its
   fragment. Gzipped and base64url'd, since the analysis is JSON and an address bar is not. */

import { execFile } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, join } from "node:path"
import { gzipSync } from "node:zlib"
import { closeWalk, openWalk, report, walkOne } from "../src/engine.ts"

const REPORT_URL = "https://token-billing.vercel.app/"

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

function main(): void {
  const dir = process.argv[2] ?? join(homedir(), ".claude", "projects")
  const paths: string[] = []
  try {
    walk(dir, paths)
  } catch (e) {
    console.error(`could not read ${dir}: ${(e as Error).message}`)
    process.exitCode = 1
    return
  }
  if (!paths.length) {
    console.error(`no .jsonl transcripts under ${dir}`)
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
      console.error(`nothing readable under ${dir}`)
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
      `${paths.length} transcript(s) read, but nothing in them was billed -- ` +
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
  handOff(`${REPORT_URL}#d=${payload}`)
}

main()
