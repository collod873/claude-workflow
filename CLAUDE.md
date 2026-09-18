- Changing the machine: read [the charter](docs/agents/charter.md) and run `core/bin/machine-page`;
  the layer rulings sit in `docs/agents/layers/`.
- Commit messages: **why**, not what. No em dash (`core/bin/land` refuses one).
- `main` takes no direct push, the owner's included. Commit locally, then `core/bin/land` opens a PR
  and merges it, or leaves auto-merge on while checks run.
- Name anything, a term, a file, a commit's subject, in `CONTEXT.md` words; a wrong one is fixed there.
- **Code carries no prose.** No comments, docstrings or headers, in any language, tests included
  (ADR-0151). The why goes in the commit message, or `CONTEXT.md` where it is the vocabulary; name
  things so the code says the rest. `core/prose.proc.test.ts` holds it at zero.
- New code is a part in `core/parts.ts`, or reachable from a `bin/` script or a hook. `core/check`
  runs knip with no baseline; a test importing a thing is not evidence anything runs it (ADR-0086).
  Wire it to a caller or delete it; unreachable by design takes an `@shell` or `@fixture` tag saying
  why, five lines at most.
- `core/check` is the New core's gate, run by `.husky/pre-push` and every PR. `.claude/` and `bin/`
  are judged by `npm test`, `npm run lint` and `npm run typecheck`, which nothing fires: run them by
  hand ([boundary](docs/agents/core-boundary.md)).
- `core/` imports none of the Old machine and is ruled by it anyway: the hooks under `.claude/` fire
  in every session, core ones included, from `~/.agents/workflow`, a read only clone of `main`
  pulled at SessionStart. A hook edited here binds once it lands and a new session starts.
