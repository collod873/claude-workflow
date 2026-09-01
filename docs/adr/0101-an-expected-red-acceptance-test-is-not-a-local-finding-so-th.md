---
status: note
date: 2026-08-29
amends: ADR-0010
reversal: Restoring `vitest run` with no argument to the `test` script re-includes `tests/acceptance/` at every gauntlet venue without changing any gate's authority — the set of things that judge acceptance tests is unchanged either way; what returns is the owner locked out of his own repository whenever a slice's test lands ahead of its implementation.
---

# An expected-red acceptance test is not a local finding, so the gauntlet's test slot stops at the code suite

Re-admitted 2026-08-31 as a **note**: this records an amendment that should have been an edit to the ADR it changes, not a constraint
that binds later work.

It changes ADR-0010, which is where the change belonged.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
