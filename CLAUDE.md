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
