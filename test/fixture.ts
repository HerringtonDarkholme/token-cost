/* The corpus the view suites run against.

   Synthetic by default, so the views are covered without touching anyone's transcripts and
   without a directory being discovered automatically. Pass a real one when you want to see
   the views survive real data -- `TRANSCRIPT_DIR=~/.claude/projects/<project>`. */

import fs from "node:fs"
import path from "node:path"
import type { RawFile } from "../src/engine.ts"

export function readDir(dir: string): RawFile[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") }))
}

/** A corpus with enough shape to reach every view: several groups, shell programs that
 *  take subcommands, files of more than one extension, a harness tag, and typed text.
 *
 *  `acme-deploy` and the `acmeinternal` MCP server are here to stand for the names a caption
 *  must never say out loud -- an in-house CLI and a server named after somebody's employer.
 *  They are also the most expensive things in the corpus, so a caption that names leaves by
 *  cost alone reaches for one of them first, and the suite catches it.
 *
 *  `recordTtl` is the one thing about a transcript that changes what the page *offers* rather
 *  than what it says: a request records which cache-write TTL applied, and one written before
 *  the field existed does not. Both shapes are real, so both are here -- the default is the
 *  modern one, and the switch that reprices what was not recorded is only reachable from the
 *  other. See `Toolbar`. */
export function synthetic({ recordTtl = true }: { recordTtl?: boolean } = {}): RawFile[] {
  const L: string[] = []
  const written = (n: number): Record<string, number> | undefined =>
    recordTtl ? { ephemeral_1h_input_tokens: n, ephemeral_5m_input_tokens: 0 } : undefined
  const progs: Array<[string, string[]]> = [
    ["git", ["diff", "log", "status", "commit"]],
    ["docker", ["build", "run", "ps"]],
    ["acme-deploy", ["push", "rollback", "status"]],
  ]
  for (let k = 0; k < 30; k++) {
    const [prog, verbs] = progs[k % progs.length]
    L.push(
      JSON.stringify({
        sessionId: "s",
        timestamp: "2026-05-01T00:00:00Z",
        message: {
          role: "assistant",
          model: "claude-opus-5",
          usage: {
            input_tokens: 4,
            cache_read_input_tokens: 9000 + k * 800,
            cache_creation_input_tokens: 300,
            output_tokens: 260,
            cache_creation: written(300),
          },
          content: [
            { type: "text", text: "considering the change ".repeat(12) },
            {
              type: "tool_use",
              id: "b" + k,
              name: "Bash",
              input: { command: `${prog} ${verbs[k % verbs.length]} --flag` },
            },
          ],
        },
      }),
    )
    L.push(
      JSON.stringify({
        sessionId: "s",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "b" + k,
              content: "output line ".repeat(prog === "acme-deploy" ? 1100 : 400),
            },
          ],
        },
      }),
    )
    L.push(
      JSON.stringify({
        sessionId: "s",
        timestamp: "2026-05-01T00:00:00Z",
        message: {
          role: "assistant",
          model: "claude-opus-5",
          usage: {
            input_tokens: 4,
            cache_read_input_tokens: 12000 + k * 800,
            cache_creation_input_tokens: 300,
            output_tokens: 200,
            cache_creation: written(300),
          },
          content: [
            {
              type: "tool_use",
              id: "r" + k,
              name: "Read",
              input: { file_path: `/a/b${k}.${["ts", "py", "md"][k % 3]}` },
            },
          ],
        },
      }),
    )
    L.push(
      JSON.stringify({
        sessionId: "s",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "r" + k, content: "source ".repeat(600) }],
        },
      }),
    )
    L.push(
      JSON.stringify({
        sessionId: "s",
        timestamp: "2026-05-01T00:00:00Z",
        message: {
          role: "assistant",
          model: "claude-opus-5",
          usage: {
            input_tokens: 4,
            cache_read_input_tokens: 15000 + k * 800,
            cache_creation_input_tokens: 300,
            output_tokens: 120,
            cache_creation: written(300),
          },
          content: [
            {
              type: "tool_use",
              id: "m" + k,
              name: "mcp__acmeinternal__fetch_ledger",
              input: { query: `entry ${k}` },
            },
          ],
        },
      }),
    )
    L.push(
      JSON.stringify({
        sessionId: "s",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "m" + k, content: "ledger row ".repeat(1400) },
          ],
        },
      }),
    )
    L.push(
      JSON.stringify({
        sessionId: "s",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "<system-reminder>reminder body ".repeat(20) + "</system-reminder>",
            },
            { type: "text", text: "carry on please" },
          ],
        },
      }),
    )
  }
  return [{ name: "synthetic.jsonl", text: L.join("\n") }]
}

export function corpus(dir?: string): RawFile[] {
  return dir ? readDir(dir) : synthetic()
}
