---
status: note
date: 2026-08-31
reversal: Sending a `no-progress` stop back to `needs-human` alone means changing the routing in `runFixer` and retiring `shared/spec-gap.ts`'s second caller; the `FailureSignature` comparison that discriminates the two stops was already computed and stays either way.
---

# A fixer that stops making no progress files spec/gap rather than only calling the owner

Re-admitted 2026-08-31 as a **note**: this records an implementation note — how a tool or lane behaves, not a constraint
that binds later work.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
