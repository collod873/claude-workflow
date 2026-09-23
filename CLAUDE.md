- Changing the machine: read [the charter](docs/agents/charter.md) and run `bin/machine-page`;
  the layer rulings sit in `docs/agents/layers/`.
- Commit messages: **why**, not what. No em dash (`bin/land` refuses one).
- `main` takes no direct push, the owner's included. Commit locally, then `bin/land` opens a PR
  and merges it, or leaves auto-merge on while checks run.
- Name anything, a term, a file, a commit's subject, in `CONTEXT.md` words; a wrong one is fixed there.
- **Code carries no prose.** No comments, docstrings or headers, in any language, tests included.
  The why goes in the commit message, or `CONTEXT.md` where it is the vocabulary; name things so
  the code says the rest. `src/prose.proc.test.ts` holds it at zero.
- New code is a part in `src/parts.ts`, or reachable from a `bin/` script. `bin/check`
  runs knip with no baseline; a test importing a thing is not evidence anything runs it.
  Wire it to a caller or delete it.
- `bin/check` is the full gate: pre-push and every PR. Mid-session, run `~/bin/check`;
  check-gate waits on it.
- This repo holds no session hooks: every hook that fires in a session lives in
  `collod873/agent-hooks`.
