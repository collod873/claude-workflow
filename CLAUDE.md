Collin, 2026-10-07, on what this repo is for: "file a random spec in Lumaria that runs efficiently
... built to a high quality coding standard and extremely quickly. It should do only what is
necessary. And at the proper time, in order to prevent bad quality code. It shouldn't even get
stuck." Every session here serves that line.

## Fixing the machine

A failure the machine hit, such as a stuck ticket, a red run or a wrong verdict, reaches a fix
only through `docs/buckets.md`:

1. Open `docs/buckets.md` and name the row whose cause the failure shares. Done when you can quote
   that row, or have read every row and none holds it.
2. No row holds it: add the row with the failure as its evidence, and bring the row to Collin
   instead of a fix.
3. A row holds it: build that row's prevention at its cause, before any gate.
4. In the same change, add the failure to the row's evidence and move its state.

Unsticking one ticket by hand, with a rerun or a label, is operating the machine, not changing
it, and needs no row.

## Changing code

- Name anything, a term, a file, a commit subject, in `CONTEXT.md` words; a wrong one is fixed there.
- New code is a part in `src/parts.ts`, a stage in its own `src/<stage>.part.ts`, or reachable from
  `bin/`. knip runs with no baseline and counts no test as a caller: wire it to one or delete it.
- The why goes in the commit message, or in `CONTEXT.md` when it is vocabulary. Commit messages
  carry no em dash.
- Mid-session, run `~/bin/check`, the fast check check-gate waits on; `~/bin/check --full` is what
  pre-push and the PR's `check` job run. Both read their steps from `.claude/contract.json`.
- Land a commit with `bin/land` in the background: it rebases and waits until its PR merges or
  fails. `main` takes no direct push.
- A worktree's `node_modules` links to the main checkout's: `rm node_modules && npm ci` before
  editing packages.

## Owned elsewhere

- `docs/adr/` changes only when Collin asks for it in that session.
- Session hooks live in `collod873/agent-hooks`.
