# Working in this repo

## Git

**Commit straight to `main` and push.** This project does not use branches, and does not use
pull requests. Do not create a branch to hold a change, do not ask whether to open a PR, and
do not leave work parked on a branch waiting for one.

The default instinct — branch, push the branch, offer a PR — is wrong here and costs a
round trip to undo.

## Before you commit

`pnpm check` — format, lint, typecheck, build, then all three suites. The build asserts the
page is self-contained, so a change that reaches the network fails here rather than in
someone's browser.

The app lives in `src/` — the `.ts`, the `.tsx` and `style.css`. What stays at the root is
the things that address it from outside: `index.html`, the two Vite configs, `tsconfig.json`,
`vercel.json`. The suites stay in `test/` as a peer of `src/` rather than inside it, because
two of the three run as plain `node` scripts against a real transcript directory.

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
