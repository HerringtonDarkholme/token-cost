# Working in this repo

## Git

**Commit straight to `main` and push.** This project does not use branches, and does not use
pull requests. Do not create a branch to hold a change, do not ask whether to open a PR, and
do not leave work parked on a branch waiting for one.

The default instinct — branch, push the branch, offer a PR — is wrong here and costs a
round trip to undo.

## Before you commit

`pnpm check` — typecheck, build, then all three suites. The build asserts the page is
self-contained, so a change that reaches the network fails here rather than in someone's
browser.
