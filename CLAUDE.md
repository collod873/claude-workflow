Collin, 2026-10-07, on what this repo is for: "file a random spec in Lumaria that runs efficiently
... built to a high quality coding standard and extremely quickly. It should do only what is
necessary. And at the proper time, in order to prevent bad quality code. It shouldn't even get
stuck." Every session here serves that line; `docs/buckets.md` holds what still breaks it.

- Commit messages: **why**, not what. No em dash.
- `main` takes no direct push. Commit, then run `bin/land` in the background: it rebases and
  waits until its PR merges or fails.
- Name anything, a term, a file, a commit subject, in `CONTEXT.md` words; a wrong one is fixed there.
- `docs/adr/` is the owner's. Never create, edit or supersede an ADR unless Collin asks for it in
  that session.
- **Code carries no prose.** No comments, docstrings or headers, in any language, tests included.
  The why goes in the commit message, or `CONTEXT.md` where it is the vocabulary; name things so
  the code says the rest.
- New code is a part in `src/parts.ts`, a stage in its own `src/<stage>.part.ts`, or reachable from
  `bin/`. knip runs with no baseline, and a test importing a thing is not a caller: wire it to one
  or delete it.
- Fix a failure at its cause before adding a gate.
- Before proposing any fix, bucket the failures and name the one change that prevents the bucket.
  A lone failure is fixed where it is and grows no system around it.
- The repo holds no runner, only its steps in `.claude/contract.json`. Mid-session, run
  `~/bin/check`, the fast check check-gate waits on; `~/bin/check --full` is the full check,
  which pre-push and the PR's `check` job run.
- Session hooks live in `collod873/agent-hooks`, not here.
- A worktree's `node_modules` links to the main checkout's: `rm node_modules && npm ci` before
  editing packages.
