---
status: note
date: 2026-08-29
reversal: Undoing it means deleting the actionlint step from `bin/gauntlet push` and its test and restoring the global exit-2 reading in the gauntlet runner; `verify.yml` keeps its own `Lint workflow files` step either way, so what is lost is the earlier venue, not the check.
---

# The push venue lints workflow files, and only the ones that differ from trunk

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
