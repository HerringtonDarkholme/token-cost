# Working in this repo

## Never commit this machine

**No username, no home directory, no local path.** This repo is public. Nothing that goes
into it — source, comments, test fixtures, docs, commit messages — may carry the account
name or a path off the machine it was written on: not `/Users/<name>/…`, not the
dash-flattened `-Users-<name>-code-…` form Claude Code gives a project folder, not
`%USERPROFILE%` expanded.

The examples this repo is full of — transcript paths, project folder names — are exactly
where this leaks, because the real one is right there in the shell. Invent the example.
`~/.claude/projects` for the folder, a made-up name like `-Users-me-code-thing` for a
project inside it.

Scan the diff for `/Users/` and for the account name before every commit. Getting it out
afterwards means an amend and a force push.

## Comments

**One sentence.** Say why the code is the way it is — the constraint or the trap. Do not
narrate the design or explain the domain at essay length.

No file-header manifestos, no section banners, no numbered design rules. A decision that
needs a paragraph belongs in this file or the commit message, not on top of the function.

## Git

**Commit straight to `main` and push.** This project does not use branches, and does not use
pull requests. Do not create a branch to hold a change, do not ask whether to open a PR, and
do not leave work parked on a branch waiting for one.

The default instinct — branch, push the branch, offer a PR — is wrong here and costs a
round trip to undo.

## Before you commit

`pnpm check` — format, lint, typecheck, both page builds, the CLI build, then all three suites.
`build` is the deployed page, which is code-split; `build:standalone` is the double-clickable
`cost-report.html`, and that one asserts the document is self-contained — so a change that
reaches the network fails here rather than in someone's browser.

The app lives in `src/` — the `.ts`, the `.tsx` and `style.css`. What stays at the root is
the things that address it from outside: `index.html`, the three Vite configs, `tsconfig.json`,
`vercel.json`. The suites stay in `test/` as a peer of `src/` rather than inside it, because
two of the three run as plain `node` scripts against a real transcript directory.

`src/agents/` holds one file per agent the bill reads — `claude.ts`, `codex.ts`, `grok.ts` — behind
the `Agent` contract in `index.ts`: claim a file, read its lines, price its models, say where its
sessions live. `engine.ts` names no agent. It asks the registry whose file this is and reads what
comes back, so a fourth agent is a file in that folder and a line in `AGENTS` — not an edit to the
walk, the CLI's store list, or the rate card.

Claude is one entry in that list and gets no privileges: it claims its files by its own markers
like the others do, and a file no agent claims is not a transcript rather than a Claude one. Keep
it that way — the pull towards "everything else is Claude" is what this folder exists to stop.

The formatter is oxfmt, and it owns everything under `src/`: run `pnpm format` and commit
what it gives you rather than arguing with it in review. `pnpm check` runs `oxfmt --check`,
so an unformatted file fails the gate. The markdown and `index.html` are left out — they are
hand-composed in shapes oxfmt would flatten — and `.oxfmtrc.json` says which and why. Do not
reach for the aligned-by-hand column trick; it will not survive the next `pnpm format`.

The lint is oxlint, and it is a gate rather than advice: `.oxlintrc.json` is expected to stay
at zero findings. Every rule it turns off carries the reason in a comment beside it, so if a
new finding is a false positive, silence it the same way — with the argument written down, or
at the one site with `// oxlint-disable-next-line <rule>` and a comment saying why. Reaching
for `-A` on the command line to get a commit out is not the move.

One wrinkle now that a formatter runs first: `oxlint-disable-next-line` points at a line
number, and which line a violation lands on is oxfmt's decision, not yours. If the construct
you are silencing spans more than one line, use a `oxlint-disable` / `oxlint-enable` pair
around it instead — see the digit spans in `Report.tsx`.
