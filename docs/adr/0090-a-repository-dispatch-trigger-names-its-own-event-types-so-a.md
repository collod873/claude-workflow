---
status: note
date: 2026-08-28
reversal: Dropping `types:` from the eight dispatch workflows only widens what each wakes on, so nothing downstream breaks; what is lost is a run history that can distinguish 'fired and skipped' from 'never fired', plus the `RECONCILE_DISPATCH_ACTIONS` list and its test.
---

# A repository_dispatch trigger names its own event types, so an unrelated lane's dispatch cannot fill this lane's history with skipped runs

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
