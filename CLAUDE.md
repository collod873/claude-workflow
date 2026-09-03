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
- `.claude/contract.json` names what each venue runs
  ([ADR-0056](docs/adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md)); edit a
  slot there rather than teaching `bin/gauntlet` a command.
- New code has to be reachable from a lane, a `bin/` script, or a hook. `npm run lint` runs knip
  with no baseline and fails on anything nothing runs — a test importing it does not count
  ([ADR-0086](docs/adr/0086-a-test-importing-a-thing-is-not-evidence-anything-runs-it-so.md)). Wire it
  to a caller or delete it; if it is genuinely unreachable by design, tag the export `@shell` or
  `@fixture` with a sentence saying why.

## Agent skills

Issue tracker, ticket format, pipeline labels, domain layout → `docs/agents/`.
Check commands → `.claude/contract.json`. What each venue runs → [`docs/agents/venues.md`](docs/agents/venues.md).
