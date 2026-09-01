---
status: note
date: 2026-08-25
reversal: Undoing it is resetting a timeout number in `vitest.config.ts`; what the entry actually carries is a measurement — 0.8s on the workstation against 10.1s on a two-core runner — plus a caution about diagnosing a red before raising its budget, neither of which binds later design.
---

# A test's timeout is sized for the slowest venue it runs in, never the fastest

Re-admitted 2026-08-31 as a **note**: this records a measurement of how the system actually behaved, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
