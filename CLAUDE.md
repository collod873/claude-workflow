# Workflow

A Claude Code + GitHub workflow system.

## Conventions

- Commit messages explain **why**, not what.
- Keep local-only state out of git (see `.gitignore`).
- Use the vocabulary in `CONTEXT.md`. If a term there is wrong, change it there — don't work
  around it.
- Decisions go in `docs/adr/`, drafted with `bin/new-adr "<the ruling as a sentence>"` and landed
  with `bin/new-adr --land <draft>` — the land is what claims the number
  ([ADR-0080](docs/adr/0080-an-adr-number-is-claimed-when-the-adr-lands-not-when-it-is-d.md)). Format and
  the bar for writing one are in `docs/adr/README.md`. Never edit an old ADR to reflect a new
  decision; write a new one that says what it amends.
- `.claude/contract.json` is generated, not hand-maintained — `bin/gauntlet push` runs
  `regenerate && diff` and fails when the committed file disagrees with a fresh probe
  ([ADR-0056](docs/adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md)).
- New code has to be reachable from a lane, a `bin/` script, or a hook. `bin/gauntlet push` fails
  on anything nothing runs — a test importing it does not count
  ([ADR-0086](docs/adr/0086-a-test-importing-a-thing-is-not-evidence-anything-runs-it-so.md)). Wire it
  to a caller or delete it; if it is genuinely unreachable by design, tag the export `@shell` or
  `@fixture` with a sentence saying why. When you clear standing debt, drop it from the baseline:
  `node .Workflow/agent-workflows/shared/wiring-baseline.ts update .`

## Agent skills

Issue tracker, ticket format, pipeline labels, domain layout → `docs/agents/`.
Check commands → `.claude/contract.json`.
