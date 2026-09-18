- Changing the machine: read [`docs/agents/charter.md`](docs/agents/charter.md) and run
  `core/bin/machine-page`; the layer rulings sit in `docs/agents/layers/`.
- Commit messages: **why**, not what. No em dash (`core/bin/land` refuses one).
- `main` takes no direct push, the owner's included. Commit locally, then `core/bin/land` opens a PR
  from your commits and merges it, or leaves auto-merge on while checks run.
- Naming anything, a term, a file, a commit's subject: `CONTEXT.md` words. A term there that is
  wrong gets changed there.
- **Code carries no prose.** No comments, no docstrings, no headers, in any language, tests included
  ([ADR-0151](docs/adr/0151-code-carries-no-prose-the-why-lives-in-docs-adr-and-context.md)). The why
  goes in the commit message, or `CONTEXT.md` where it is the vocabulary; name things so the code
  says the rest. `core/prose.proc.test.ts` holds it at zero, keeping what a machine reads.
- New code is a part in `core/parts.ts`, or reachable from a `bin/` script or a hook. `core/check`
  runs knip with no baseline; a test importing a thing is not evidence anything runs it
  ([ADR-0086](docs/adr/0086-a-test-importing-a-thing-is-not-evidence-anything-runs-it-so.md)). Wire
  it to a caller or delete it; unreachable by design takes an `@shell` or `@fixture` tag with a
  sentence saying why, five lines at most.
- `core/check` is the New core's whole gate, run by `.husky/pre-push` and every PR. `.claude/` and
  `bin/` are the Old machine's, judged by `npm test`, `npm run lint` and `npm run typecheck`, which
  nothing fires: run them by hand ([boundary](docs/agents/core-boundary.md)).
