# Workflow

## Conventions

- Before adding, changing or ruling on any part of the machine, read [`docs/agents/charter.md`](docs/agents/charter.md).

- Commit messages explain **why**, not what, and carry no em dash (`core/bin/land` refuses one).
- `main` takes no direct push, the owner's included
  ([One ticket ruling](docs/agents/layers/one-ticket.md)). Commit locally, then run `core/bin/land`: it
  opens a PR from your commits and merges it, or leaves auto-merge on while checks run.
- Naming a thing, a term, a file or a commit's subject: read `CONTEXT.md` first and use its words. A
  term there that is wrong gets changed there.
- **Code carries no prose.** No comments, no docstrings, no explanatory headers, in any language,
  tests included ([ADR-0151](docs/adr/0151-code-carries-no-prose-the-why-lives-in-docs-adr-and-context.md)).
  The why goes in the commit message, or `CONTEXT.md` where it is the vocabulary; name things so
  the code says the rest. `core/prose.proc.test.ts` holds it at zero and keeps what a machine reads,
  knip's `@shell`/`@fixture` tags capped at five lines.
- New code is a part in `core/parts.ts`, or reachable from a `bin/` script or a hook. `core/check`
  runs knip with no baseline and fails on anything nothing runs; a test importing it does not count
  ([ADR-0086](docs/adr/0086-a-test-importing-a-thing-is-not-evidence-anything-runs-it-so.md)). Wire it
  to a caller or delete it; if it is genuinely unreachable by design, tag the export `@shell` or
  `@fixture` with a sentence saying why.
- `core/check` is the New core's whole gate, run by `.husky/pre-push`. The Old machine's checks never
  read `core/` ([`docs/agents/core-boundary.md`](docs/agents/core-boundary.md)).

## Where to look

The charter, the layer rulings and what separates the two machines → `docs/agents/`.
The New core's checks → `core/check`. The Old machine's → `npm test`, `npm run lint`,
`npm run typecheck`.
