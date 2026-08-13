# Working in this repo

## Git

**Commit straight to `main` and push.** This project does not use branches, and does not use
pull requests. Do not create a branch to hold a change, do not ask whether to open a PR, and
do not leave work parked on a branch waiting for one.

The default instinct — branch, push the branch, offer a PR — is wrong here and costs a
round trip to undo.

## Before you commit

`pnpm check` — lint, typecheck, build, then all three suites. The build asserts the page is
self-contained, so a change that reaches the network fails here rather than in someone's
browser.

The lint is oxlint, and it is a gate rather than advice: `.oxlintrc.json` is expected to stay
at zero findings. Every rule it turns off carries the reason in a comment beside it, so if a
new finding is a false positive, silence it the same way — with the argument written down, or
at the one site with `// oxlint-disable-next-line <rule>` and a comment saying why. Reaching
for `-A` on the command line to get a commit out is not the move.
