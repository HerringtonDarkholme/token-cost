# Claude Code cost attribution

Drop in your Claude Code session transcripts; get every dollar traced to whatever put the
tokens in context — per tool, per bash command, per subcommand.

## Run it

Open the deployed page, or build the standalone file yourself:

```sh
pnpm install && pnpm build
open cost-report.html          # standalone build — no server needed
```

`cost-report.html` is build output, not something the repo carries.

Transcripts are parsed in the page. Nothing is uploaded, and the app makes no network
request with your data. It reads only the files you hand it through the picker or a drop —
it has no filesystem access of its own, and **nothing here points at or serves your
transcripts.** Handing over a folder hands over its contents to *the page*, not to a server:
the build gate fails if anything in here reaches the network at all.

The one thing that ever leaves is what you choose to post. *Share to X* renders the card to
your clipboard and opens a composer with a caption already written — one of six, drawn at
random. A caption quotes figures, and at most the names of widely known programs (`git`,
`sed`, `cat`): never a command you ran, a file path, or an MCP server, since those are named
after your employer as often as not. Covering the amounts with the eye covers them in the
caption too. Nothing is posted until you press the button in X's own composer.

## Developing

The source is React 19 and TypeScript, so it needs a dev server — `file://` blocks module
imports. Vite provides one, with Fast Refresh:

```sh
pnpm install
pnpm dev              # http://127.0.0.1:8000
pnpm format           # oxfmt, which owns everything under src/
pnpm typecheck        # tsc --noEmit, the only thing that judges types
pnpm build            # bundle + inline everything into dist/ and cost-report.html
pnpm check            # format, lint, typecheck, build, then all three test suites
```

`pnpm build` writes `dist/index.html` — what Vercel serves — and copies it to
`cost-report.html` at the root, the same bytes as a file you can double-click. It bundles to a single
classic (non-module) inline script, because a `type="module"` script is fetched under module
rules that a `file://` page cannot rely on. The build then asserts the result is genuinely
self-contained — no `<script src>`, no stylesheet link, no absolute URL, no CSS `@import` —
and fails rather than ship a page that would reach the network when opened.

## Deploy

Vercel serves `dist/`, built from source on each push — so nothing generated is committed
and there is no artifact to keep in sync. `vercel.json` states what the Vite preset would
otherwise infer, so the deploy does not depend on detection.

```sh
pnpm dlx vercel          # first run links the project, then deploys a preview
pnpm dlx vercel --prod
```

Connecting the repo in the Vercel dashboard builds the same way.

It stays a static page with no backend, which is what keeps the privacy claim above true
when it is hosted rather than opened from disk: there is nothing on the server side to send
a transcript to. The one thing hosting changes is that the page now arrives over the
network — the assertion in `vite.config.ts` still holds, so what arrives is one file that
makes no further requests.

Nothing type-checks as a side effect of bundling: Vite and Node both *erase* types rather
than verify them, so `pnpm typecheck` is the only step that will tell you a type is wrong.
`tsconfig.json` sets `erasableSyntaxOnly`, which bans the constructs Node's stripper cannot
handle (enums, namespaces, parameter properties) — that is what keeps the engine and model
suites runnable as plain `node` scripts. Relative imports carry their real `.ts` / `.tsx`
extension for the same reason: Node does no extension guessing, so `./engine.ts` is the one
specifier both it and Vite accept.

The split between `src/model.ts` and the components is the one worth knowing about. Everything
that has to *reconcile* — folding, drill-down, the ledger walk — is plain functions with no
React and no DOM, so it can be asserted directly and run against a real transcript
directory with nothing in between. The `.tsx` files only draw.

The second split is hover. It lives in its own store slice rather than in `ViewState`,
because it changes on every block the pointer crosses while nothing about the shareable
view depends on it. The mosaic, the sunburst, the panels and the table each read the hovered
key once and hand each column, sector, panel and row two primitives — whether anything is
hovered, and the hovered key if it falls inside *that* one — so those components are
`memo`'d on values that change for the block entered and the block left, not for all of
them. Highlighting still comes from one store, so the views cannot disagree about what is
hovered; it just no longer re-renders the header, the strip, the footnotes and the whole
ledger to move a highlight.

The card's chart has two forms of the same tree, and the mosaic is the one that leads: area
on a common baseline is the honest comparison, and the thesis is written against it. The
sunburst answers the other question — how deep the money goes — by putting the drill-down
itself on screen, one ring per level. Both are laid out from `model.ts`, both hover from the
one store, and both mark the re-billed-prose block, so the toggle changes the picture and
nothing else. A hovered arc lights its own ancestors back to the centre, which is the one
thing the mosaic cannot show. The card carries a fixed ratio per chart — 16:9 for the
mosaic, 4:3 for the sunburst — because the card is the part people screenshot, and a disc
in a wide band comes out small.

The dev server binds `127.0.0.1` deliberately. Do not put transcripts, symlinks to
`~/.claude`, or an index of them inside this folder: anything under a served directory is
fetchable by any page that can reach localhost while the server runs.

## Tests

```sh
pnpm test                            # all three suites
pnpm test:engine                     # synthetic corpus: unknown model, tool, command, tag
pnpm test:model                      # folding, drill-down and reconciliation, no DOM
pnpm test:render                     # every view state, rendered into a real DOM

node test/engine.test.ts <dir>       # optionally also check a real transcript directory
node test/model.test.ts <dir>
TRANSCRIPT_DIR=<dir> pnpm test:render
```

The engine and model suites are plain Node scripts with no test-runner dependency: Node
runs the TypeScript directly by stripping the types, so there is no build step and nothing
between you and the assertion. The render suite is the exception — JSX needs a transform
and components need a DOM — so it runs under Vitest with happy-dom, and takes its
directory from the environment instead of `argv`. No transcript directory is discovered
automatically; it must be passed in.

The synthetic engine suite is the one that matters most: it feeds the engine a model id, an
MCP tool, a shell program, a file type and a harness tag that appear nowhere in the source,
and asserts each lands in the right group, drills correctly, and reconciles to the cent.
The model suite makes the same reconciliation claim about what the page actually *draws* —
folded rows included, at every drill level, under both TTL lenses.

## Where your transcripts are

One `.jsonl` per session, one folder per project, under `~/.claude/projects/`. Biggest first:

```sh
du -sh ~/.claude/projects/*/ | sort -rh | head
```

The page asks for the whole `~/.claude/projects` folder, or one project's folder inside it —
everything you hand it is combined into a single report. Loose `.jsonl` files dragged in still
work; there just isn't a button for it, because picking files means defeating a hidden dotfile
*and* multi-selecting dozens of identically-named transcripts.

**The folder is hidden**, so file pickers won't show it until you name it. In the Finder
dialog press <kbd>⇧⌘G</kbd> and paste `~/.claude/projects` (or <kbd>⇧⌘.</kbd> to reveal
hidden files); on Windows type `%USERPROFILE%\.claude\projects` into the *Folder* box; on
Linux press <kbd>Ctrl</kbd>+<kbd>L</kbd>. Or run `open ~/.claude/projects` and drag the folder
onto the page. The empty card carries whichever of those three applies to you, beside the
button that opens the dialog it describes — it guesses from the user agent and shows that one
line, and the platform beside it is a button that walks to the next when the guess is wrong.

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

- **`system prompt + tool schemas`** is one inseparable block. It is not measured but
  inferred: the residual after everything the transcript *does* record, which carries no
  seam between the two halves — no record type holds the system prompt or a tool schema.
  Run `/context` in Claude Code for the real boundary. It is measured once per session, at
  the first request, and held fixed; recomputing it every turn makes it absorb all
  estimation error and grow without bound. Being fused, it does not open: `kidsOf` in
  `model.ts` withholds a lone child that splits no further, so the mosaic column, the
  sunburst ring, the panel and the chevron all decline together rather than promising a
  breakdown and re-printing the row at 100%.
- **`assistant prose`** appears twice on purpose: once as generation cost, once (far larger)
  as the same prose re-billed as input on later turns. The ratio is carry cost in miniature.

## Files

| file | what it is |
|---|---|
| `index.html` | document shell and Vite entry (needs the dev server) |
| `vercel.json` | the deploy: `pnpm build`, serve `dist/` |
| `src/engine.ts` | attribution engine: JSONL → cost tree. No React, no DOM |
| `src/model.ts` | view model: folding, drill-down, the ledger walk, the sunburst's ring geometry, the palette, the share captions. No React, no DOM |
| `src/store.ts` | view state, held outside the tree so the URL hash and the tests can drive it; hover is a separate slice |
| `src/context.ts` | the one context the report's components read: dataset, state, palette, formatters |
| `src/main.tsx` | entry: mounts `<App>` |
| `src/App.tsx` | the turn: which face the card shows, and the exit phase in between; owns the theme attribute |
| `src/Page.tsx` | the page itself — shell, toolbar, card, header — which outlives both faces, so the frame can tween rather than being replaced |
| `src/Motion.tsx` | the three transition primitives: the panel that slides in, the figure that re-enters digit by digit, the copy that swaps |
| `src/Upload.tsx` | the empty face: folder picker, drop target, hand-off to the engine; the per-platform way into the hidden folder, and the help under the card |
| `src/Report.tsx` | the full face: thesis strip, the picture, breakdown section, footnotes |
| `src/Mosaic.tsx` | the primary chart — column width = share of bill — and the hover readout |
| `src/Sunburst.tsx` | the same tree as rings — arc = share of the ring inside it — with a legend for the names the arcs have no room for |
| `src/Panels.tsx` | the same data ranked and labelled instead of packed |
| `src/Ledger.tsx` | the table, where identity does not rest on colour |
| `src/Toolbar.tsx` | TTL lens, the eye that covers amounts, theme, copy chart, share on X, and the reset back to an empty card |
| `src/Seg.tsx`, `src/Tip.tsx` | the segmented control every lens switch is made of, with its travelling pill; and the hint the controls whose face is a symbol hang off |
| `src/Share.tsx` | the card as a PNG — copied on its own, or copied and handed to an X composer with a caption written |
| `src/snapshot.ts` | the card rasterised in the page, through `<foreignObject>` and a canvas — no library, nothing fetched |
| `src/style.css` | tokens and layout |
| `vite.config.ts` | build: bundles and inlines everything into `cost-report.html`, and asserts it is self-contained |
| `vitest.config.ts` | the render suite only — deliberately without the build plugins, so tests can never write the deliverable |
| `tsconfig.json` | type-checking only — `noEmit`; Vite and Node do the erasing |
| `DESIGN_BRIEF.md` | design constraints and acceptance checks for the report UI |

### Reading the numbers from a terminal

There is no CLI, but there doesn't need to be one: Node runs the engine's TypeScript directly,
so a few lines get you any view of the data you want.

```sh
node --input-type=module -e '
  import { readdirSync, readFileSync } from "node:fs";
  import { join } from "node:path";
  import { analyze } from "./src/engine.ts";
  const dir = process.argv[1];
  const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"))
    .map(name => ({ name, text: readFileSync(join(dir, name), "utf8") }));
  for (const g of analyze(files).datasets["1h"].groups)
    console.log(g.name.padEnd(34), "$" + g.cost.toFixed(2).padStart(8));
' ~/.claude/projects/<project>
```

This project began as a set of Python CLI scripts; they were removed once the engine
outgrew them. They read the same exact totals out of `usage`, but split them using a
hardcoded command list and a flat 4-chars-per-token estimate, so their per-row numbers
disagree with the engine's — measurably, not theoretically. `git show c624680:scripts/` has
them if you want to look.

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
