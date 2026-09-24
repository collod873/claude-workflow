- Commit messages: **why**, not what. No em dash (`bin/land` refuses one).
- `main` takes no direct push. Commit, then run `bin/land` in the background: it rebases and
  waits until its PR merges or fails.
- Name anything, a term, a file, a commit subject, in `CONTEXT.md` words; a wrong one is fixed there.
- **Code carries no prose.** No comments, docstrings or headers, in any language, tests included.
  The why goes in the commit message, or `CONTEXT.md` where it is the vocabulary; name things so
  the code says the rest. `src/prose.proc.test.ts` holds it at zero.
- New code is a part in `src/parts.ts` or reachable from `bin/`. knip runs with no baseline, and
  a test importing a thing is not a caller: wire it to one or delete it.
- `bin/check` is the full gate: pre-push and every PR. Mid-session, run `~/bin/check`;
  check-gate waits on it.
- Session hooks live in `collod873/agent-hooks`, not here.
- A worktree's `node_modules` links to the main checkout's: `rm node_modules && npm ci` before
  editing packages.
