# Design brief — the cost-attribution report

Constraints and acceptance criteria for the report UI. This is a working design doc, not a
one-shot prompt: it describes what the page must hold true for **any** transcripts a reader
uploads, not for one particular dataset.

---

## 1. What you're designing

A single self-contained HTML page that answers one question for the person operating it:
**"I spent this much on Claude Code — on what, and what do I change on Monday?"**

The reader is the engineer who paid the bill. They are technical, skeptical, and have about
ten seconds before they decide the page is either useful or decoration. This is an
instrument, not an article: it is scanned and operated, not read top to bottom.

The page has no data of its own. The reader drops in `.jsonl` session transcripts — a whole
project folder or individual files — and everything is parsed in the browser. **Design for
the upload, not for a sample.** Nothing ships with numbers baked in.

## 2. The data is whatever they upload

`analyze()` in `engine.ts` turns raw files into a strict tree: groups → items → children,
where children always sum to their parent. Shell tools drill program → subcommand; file
tools drill by extension. The nine groups are fixed in `GROUPS` (`engine.ts`), and are roles
in the request cycle rather than categories of thing:

`Shell commands` · `Tools · content read in` · `Tools · content written out` ·
`Tools · two-way` · `Model output` · `System prompt & tool schemas` · `Harness & reminders` ·
`Images & attachments` · `My typing`

Everything else about the shape is unknown until the file lands. The design has to survive
all of it:

| what varies | what the design must do |
|---|---|
| **Group count.** A run with no MCP tools, no images, or no shell calls yields fewer than nine groups. | Never assume nine, and never reserve dead space for an absent one. Layout is driven by what's present. |
| **Leaf count.** Tens of line items, or many hundreds. | Fold small items into an explicit labelled "other" — never silently omit. The fold threshold is relative, not a fixed row count. |
| **Magnitude.** A single session worth a few dollars, or months of work worth thousands. | No hardcoded axis maxima or currency widths. Scale-independent. |
| **Labels.** Drawn from the reader's own commands, filenames and tool names — arbitrary length, arbitrary characters. | Escape everything, truncate with the full value available on hover, and never let a long label break the grid. |
| **Unpriced models.** An unrecognised model id is reported as unpriced, never dropped. | Show that state explicitly. A total that silently excludes requests is a lie. |
| **Empty and degenerate states.** No files yet, one file, a group with a single line item. | Each gets a real designed state, not a blank region. |

Two rows need special care, and both are structural rather than incidental:

- **`system prompt + tool schemas`** is one inseparable block — transcripts record only its
  combined token count. Present it as fixed overhead paid on every request, not as something
  drillable into parts it cannot be split into.
- **`assistant prose`** appears twice on purpose: once as generation cost, once (far larger)
  as the same prose re-billed as input on later turns. The design must make that read as
  deliberate, not as a duplicate row.

## 3. The one concept the design must teach

**Cost here is carry cost, not face value.** Billing is per request, and every request
re-bills the entire context prefix. A tool result costs its token size × the number of later
requests it survives in. This is why a command that runs often can cost less than one that
runs rarely with larger output, and why "my typing" — the thing the reader actually did —
tends to land near the bottom of their own bill.

If a reader leaves understanding only this, the page worked. If the design presents these as
ordinary category totals, it failed, however pretty it is.

Two corollaries the graphics should carry without being read: **reading dominates writing**
(finding code costs more than changing it), and **input economics dwarf output economics**
(thinking can be most of the output tokens while output is a small share of the bill).
State these as mechanisms the reader can verify in their own numbers — never as fixed
figures, which belong to no dataset the page will ever see again.

## 4. Hard constraints — non-negotiable

- **One file.** The build (`pnpm build`, configured in `vite.config.ts`) bundles and inlines
  everything into `cost-report.html` so it opens by double-click. It emits a classic inline
  script rather than `type="module"`, because module scripts load under rules a `file://`
  page cannot rely on. No CDN scripts, no external stylesheets,
  **no webfont URLs**, no remote images, no `fetch`. Inline everything. A non-system typeface
  must be a `@font-face` data URI or it doesn't ship — do not link a font and hope, it fails
  silently to a fallback.
- **It is a complete document.** `<!doctype html>`, `<html lang>`, `<head>`, `<body>`, and a
  `<title>` — it is opened directly from disk, not wrapped by a host page.
- **No network, ever.** Transcripts are private. The page must make no request with the
  reader's data, and must not be the reason a transcript leaves their machine.
- **Theme-aware, three states.** An explicit choice stamps `data-theme="dark"` or `"light"`
  on the root; the default "system" setting stamps *nothing*, so most viewers hit the
  un-stamped document where only `prefers-color-scheme` separates the two. Define the full
  light palette on bare `:root`; redefine only tokens under
  `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`;
  redefine again under `:root[data-theme="dark"]`. Never declare a color whose only
  definition lives inside a media or `[data-theme]` block — that is the classic
  unreadable-page bug. Give `body` an explicit token background.
- **Categorical color caps at 8 hues.** Assign in fixed order, never cycled. A 9th category
  is never an invented hue — fold it or give it a deliberate neutral. **Color follows the
  entity, never its rank**: a group keeps its hue when the reader drills in, switches view,
  or changes TTL.
- **Sequential = one hue light→dark** for any magnitude encoding. Never a rainbow.
- **A table view must exist**, because several palette hues fall below 3:1 contrast on a
  light ground and identity must never rest on color alone.
- **Accessibility.** Keyboard-operable controls with visible focus, `aria-expanded` on
  disclosures, respect `prefers-reduced-motion`, wide content scrolls in its own
  `overflow-x: auto` container so the page body never scrolls sideways.
- **`tabular-nums` on every figure.** This is a ledger; columns of dollars must align.

## 5. Interaction — required behavior

- **Progressive disclosure through three levels**: group → item → subcommand, with a
  breadcrumb back out. `Shell commands` → `git` → `git diff` must work.
- **The TTL switch recomputes the whole page**, not just a label. The two scenarios are
  `1h` (cache writes at 2× input) and `5m` (1.25×), per `CACHE_WRITE_MULT`. It should feel
  like a lens on the same truth, not a filter — it is a fact about billing, not about the
  reader's behavior.
- **Charts and table are one instrument, not two.** Hovering a mark highlights its row;
  hovering a row highlights its mark.
- **Search across all levels**, auto-revealing matches.
- **Default state is open.** A reader should not have to click to see the breakdown.
- **Amounts can be hidden** for screen-sharing without collapsing the layout.

## 6. Visual latitude

You have real freedom on palette, type, and composition. Two constraints on taste:

**Avoid the current AI-design house style** — warm cream `#F4F1EA` with a serif display and
terracotta accent; near-black with one acid-green pop; purple-to-blue gradient hero; Inter or
Space Grotesk as the safe face; emoji section markers; everything centered; uniformly rounded
cards with an accent rail.

**Ground it in the subject.** This is metering, accounting, telemetry — instruments, ledgers,
meters, invoices, oscilloscopes. That vocabulary is where a distinctive and *appropriate*
direction comes from. Utilitarian and precise beats decorative here; spend boldness in
exactly one place and keep the rest quiet.

Failure modes worth naming, because the page has fallen into them before: leading with a
wide stacked bar carrying nine numbers (low information per pixel — lead with something
denser); offering five chart types behind a switcher as equal peers (nothing is then the
point — have a primary view with a thesis and make alternates secondary); rendering every
group as equally important (use emphasis: highlight one, recede the rest); and burying the
carry-cost mechanism in body copy nobody reads.

## 7. Acceptance checks — verify before declaring done

Run these against `node test/render.test.ts`, which exercises every view state on a
synthetic dataset. Don't eyeball them:

1. **Every displayed level reconciles.** Rendered children sum to their parent, at every
   drill level, in every view, under both TTL scenarios.
2. **No `var(undefined)`, `NaN`, or `undefined` in any generated markup.** (An `indexOf`
   miss returning `-1` used to index a palette array and emit `fill="var(undefined)"` —
   guard your lookups.)
3. **Scan the stylesheet** for any color declared only inside a media or `[data-theme]`
   block. There must be none.
4. **No nested interactive elements** — a `<button>` inside a `<button>` is invalid and
   breaks click handling.
5. **Both themes render legibly**, and the accent works on both grounds.
6. **Validate any categorical palette** against the actual surface colors rather than
   reasoning about it.
7. **Degenerate uploads render.** A single session, a group with one line item, and a run
   with an unpriced model each produce a sane page.
8. **The build stays self-contained** — `pnpm build` fails loudly if the output carries a
   `<script src>`, a stylesheet link, an absolute URL, a CSS `@import`, or a
   `type="module"` script, because each of those breaks or leaks under `file://`.
9. **`pnpm typecheck` is clean.** Neither Vite nor Node checks types — both only erase
   them — so a wrong type ships silently unless this is run. `pnpm check` runs all three.
