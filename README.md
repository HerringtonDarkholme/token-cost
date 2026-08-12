# Claude Code cost attribution

Drop in your Claude Code session transcripts; get every dollar traced to whatever put the
tokens in context — per tool, per bash command, per subcommand.

## Run it

```sh
open cost-report.html          # standalone build — no server needed
```

Transcripts are parsed in the page. Nothing is uploaded, and the app makes no network
request with your data. It reads only the files you hand it through the picker or a drop —
it has no filesystem access of its own, and **nothing here points at or serves your
transcripts.**

To work on the source (`index.html` + separate modules) you need a server, because
`file://` blocks ES-module imports:

```sh
python3 -m http.server 8000 --bind 127.0.0.1   # serves only this folder's app files
open http://localhost:8000/
python3 build.py                               # re-inline into cost-report.html after edits
```

Keep it that way: do not put transcripts, symlinks to `~/.claude`, or an index of them
inside this folder. Anything under a served directory is fetchable by any page that can
reach localhost while the server runs.

## Tests

```sh
node test/engine.test.mjs            # synthetic corpus: unknown model, tool, command, tag
node test/render.test.mjs            # every view state, on a synthetic dataset
node test/engine.test.mjs <dir>      # optionally also check a real transcript directory
node test/render.test.mjs <dir>
```

The synthetic suite is the one that matters: it feeds the engine a model id, an MCP tool, a
shell program, a file type and a harness tag that appear nowhere in the source, and asserts
each lands in the right group, drills correctly, and reconciles to the cent. No transcript
directory is discovered automatically — it must be passed in.

## Where your transcripts are

One `.jsonl` per session, one folder per project, under `~/.claude/projects/`. Biggest first:

```sh
du -sh ~/.claude/projects/*/ | sort -rh | head
```

Drop a whole project folder onto the page, or pick individual `.jsonl` files. Multiple files
are combined into one report.

**The folder is hidden**, so file pickers won't show it until you name it. In the Finder
dialog press <kbd>⇧⌘G</kbd> and paste `~/.claude/projects` (or <kbd>⇧⌘.</kbd> to reveal
hidden files); on Windows type `%USERPROFILE%\.claude\projects` into the *File name* box; on
Linux press <kbd>Ctrl</kbd>+<kbd>L</kbd>. Or run `open ~/.claude/projects` and drag a project
onto the page. The upload screen repeats these, since that's where you need them.

## What it computes, and why it isn't just token counts

Billing is **per request**, and each request bills the *entire* input prefix — as fresh input,
cache read, or cache write — plus its own output. So a piece of content doesn't cost its face
value; it costs its token share of **every subsequent request it survives in**. That's carry
cost, and it's why rankings by cost-per-call and by dollars disagree: a command whose output
lands late and gets compacted away can cost less in total than a cheaper one that sits in the
prefix for the rest of the session.

For each request the exact billed cost is read from the transcript's `usage` field, then
allocated across the content already in context, proportional to token share. **Totals are
exact; the split across rows is estimated** from character counts.

## Working on transcripts it has never seen

The engine is built so that an unfamiliar model, tool, MCP server, shell program or harness
tag still lands correctly. Three rules:

1. **Nothing is silently dropped.** Anything unresolved is counted and surfaced.
2. **Buckets are structured records** (`{role, tool, dir, sub}`), never strings re-parsed by
   character offset.
3. **Classification is derived from the data, or from a published spec** — never from a list
   of the things one author happens to use.

Concretely:

| Question | How it's answered |
|---|---|
| What does this model cost? | Normalise the id (Bedrock `us.anthropic.…-v1:0`, Vertex paths, date and `[1m]` suffixes), then exact → longest-prefix → tier keyword. Still unknown ⇒ reported as unpriced, never dropped. Override with `setRates()`. |
| Which cache-write TTL applied? | Read `usage.cache_creation.ephemeral_{1h,5m}_input_tokens`, which the transcript records per request. The UI switch only reprices the residual that lacks a breakdown, and the report states what share that was. |
| Does this program take subcommands? | Learned from the corpus. A real multiplexer's first operand is verb-shaped almost every call (**coverage**) and drawn from a small reused vocabulary (**repetition**). `git` passes with 42 distinct verbs; `grep`, `ls` and `find` fail on coverage because their operand is a path, glob or pattern. Both tests are ratios, so nothing depends on corpus size. |
| Which command in a pipeline is "the" command? | POSIX shell semantics: state-only builtins (`cd`) never count, exec wrappers (`sudo`, `env`, `timeout 5`) are transparent, and a builtin that only emits (`echo`) is outranked by any external command — so `for f in *; do echo $f; rg foo; done` files under `rg`. |
| Is this tool a reader or a writer? | Measured from its own call-args vs results balance. A tool whose cost is ≥70% results is an ingest tool; ≥70% arguments makes it an emit tool. Tools where both directions carry real money are split into two rows instead of hiding one. |
| How big is this content in tokens? | Calibrated, not assumed. Δ(context tokens) between consecutive requests equals the previous turn's `output_tokens` plus the user-side content added since; `usage` reports the first term exactly, so the rest is measurable. Solved by least squares for **two** densities — machine text and prose — and accepted only if both coefficients' standard errors are tight enough to be identified, else pooled into one. |
| How many tokens is this image? | Read the width and height out of the PNG/JPEG/GIF/WebP header and apply the billing formula, rather than a flat constant. Base64 length is meaningless — counting it once inflated a run by 40%. |
| Is this text mine or the harness's? | `isCompactSummary` and `isMeta` are real schema fields. Beyond those, wrapper tags are extracted *from the text* (`<system-reminder>`, `<task-notification>`, …) and each becomes its own row, so an unfamiliar tag is never misfiled as something you typed. Tagged spans are split out of a block, so a reminder appended after a typed message doesn't get billed to you. |

### Groups

Groups are the **role a thing plays in the request cycle** — a property every transcript has —
while membership is derived from measurement:

`Shell commands` · `Tools · content read in` · `Tools · content written out` ·
`Tools · two-way` · `Model output` · `System prompt & tool schemas` · `Harness & reminders` ·
`Images & attachments` · `My typing`

Shell tools drill program → subcommand; file tools drill by extension. Both come from
detecting the *shape* of a tool's input (a `command` string, a path-like field), so a shell or
file tool under any name gets the same treatment.

### Two rows that need care

- **`system prompt + tool schemas`** is one inseparable block. Transcripts record only its
  combined token count — nothing here can split it. Run `/context` in Claude Code for the
  real boundary. It is measured once per session, at the first request, and held fixed;
  recomputing it every turn makes it absorb all estimation error and grow without bound.
- **`assistant prose`** appears twice on purpose: once as generation cost, once (far larger)
  as the same prose re-billed as input on later turns. The ratio is carry cost in miniature.

## Files

| file | what it is |
|---|---|
| `cost-report.html` | standalone build — open directly |
| `index.html` | source page (needs a server) |
| `engine.js` | attribution engine: JSONL → cost tree |
| `views.js` | linked views + ledger table; takes group identity, labels and insights from the engine |
| `style.css` | tokens and layout |
| `build.py` | inlines the above into `cost-report.html` |
| `DESIGN_BRIEF.md` | design constraints and acceptance checks for the report UI |
| `scripts/*.py` | superseded originals — see the note above |

### The older CLI scripts

`scripts/*.py` are the original command-line tools this started as. **They are not equivalent
to the engine any more** — they carry the hardcoded model list, tool names, command lists and
fixed 4-chars-per-token assumption that the JS engine replaced, and they will disagree with
it. Kept for reference, not for use.

## Caveats

- **Transcripts are live, mutable files.** Claude Code rewrites them as sessions compact, so
  the same folder can legitimately yield different totals days apart.
- **Subagent transcripts aren't included.** `isSidechain` exists on records but is always
  `false` in the projects tested, so subagent contexts don't appear.
- **The thinking figure is a residual.** `output_tokens` includes thinking even when no
  thinking block is persisted, so thinking is total output minus the prose and arguments that
  *are* persisted. Its accuracy depends on the calibrated density.
- **Subagent requests are included** where `isSidechain` marks them, and the count is reported.
- **A tool's sub-key comes from its input**, so a `command` field is parsed as a shell
  pipeline (quotes, heredocs, `cd x && …`, loop bodies) and a path field becomes an extension.
