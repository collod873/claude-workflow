# Workflow

A Claude Code + GitHub workflow system.

## Conventions

- Commit messages explain **why**, not what.
- Keep local-only state out of git (see `.gitignore`).
- Use the vocabulary in `CONTEXT.md`. If a term there is wrong, change it there — don't work
  around it.
- Decisions go in `docs/adr/`, created with `bin/new-adr "<the ruling as a sentence>"`. Format and
  the bar for writing one are in `docs/adr/README.md`. Never edit an old ADR to reflect a new
  decision; write a new one that says what it amends.
- A change that moves the definition of green moves `.claude/contract.json` in the **same commit**.
  The contract is what every gate and every drain reads instead of inferring one; a contract that
  lags the repo it describes is worse than none, because it is believed.

## Agent skills

Issue tracker, ticket format, triage labels, domain layout → `docs/agents/`.
Check commands → `.claude/contract.json`.
