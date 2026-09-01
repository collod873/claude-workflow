---
status: note
date: 2026-08-25
reversal: The entry declares its own undoing the least costly thing in the spec: the writer and reader of the notes ref, plus re-homing whatever notes exist, which are ordinary git objects — nothing else in #36 depends on the storage mechanism, and exactly one module cites it.
---

# Observations live in git notes on their own ref, keyed to the commit they describe

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
