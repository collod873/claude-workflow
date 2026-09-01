---
status: note
date: 2026-08-29
amends: ADR-0039
reversal: Restoring a fixed `implement` group means changing the concurrency key in `implement.yml` and the assertion in `implement.test.ts`; the standing rule is ADR-0039's, which this record only re-establishes after an undocumented drift, and the platform fact about `cancel-in-progress` it states is true whatever this repo does.
---

# Implementer concurrency is keyed per ticket, because a fixed group cancels queued waves

Re-admitted 2026-08-31 as a **note**: this records a change record — what was added, moved or retired, not a constraint
that binds later work.

It changes ADR-0039, which is where the change belonged.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
