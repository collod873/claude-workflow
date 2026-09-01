---
status: note
date: 2026-08-28
amends: ADR-0056
reversal: Undoing it means republishing `stop.cmd` in the contract slot and dropping the `# check-command:` line plus the certification test that runs the published slot against a failing tree; the slot semantics live in ADR-0056, which this correction belonged inside, and the 0.020s-vs-6.070s measurement stays true either way.
---

# A contract slot names a check a reader can run, never a hook entry point

Re-admitted 2026-08-31 as a **note**: this records an amendment that should have been an edit to the ADR it changes, not a constraint
that binds later work.

It changes ADR-0056, which is where the change belonged.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
