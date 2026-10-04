- Commit messages: **why**, not what. No em dash.
- `main` takes no direct push. Commit, then run `bin/land` in the background: it rebases and
  waits until its PR merges or fails.
- Name anything, a term, a file, a commit subject, in `CONTEXT.md` words; a wrong one is fixed there.
- **Code carries no prose.** No comments, docstrings or headers, in any language, tests included.
  The why goes in the commit message, or `CONTEXT.md` where it is the vocabulary; name things so
  the code says the rest.
- New code is a part in `src/parts.ts`, a stage in its own `src/<stage>.part.ts`, or reachable from
  `bin/`. knip runs with no baseline, and a test importing a thing is not a caller: wire it to one
  or delete it.
- Fix a failure at its cause before adding a gate.
- The repo holds no runner, only its steps in `.claude/contract.json`. Mid-session, run
  `~/bin/check`, the fast check check-gate waits on; `~/bin/check --full` is the full check,
  which pre-push and the PR's `check` job run.
- Session hooks live in `collod873/agent-hooks`, not here.
- A worktree's `node_modules` links to the main checkout's: `rm node_modules && npm ci` before
  editing packages.
