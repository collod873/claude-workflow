---
status: superseded
date: 2026-08-31
superseded_by: ADR-0127
reversal: Removing the refusal is an edit to `acceptance/push-gate.ts` and its prompt rule, but what it readmits cannot be retracted: an acceptance test asserting on `vitest.config.ts` or anything under `.github/` lands on `main` as the permanent contract for its criterion, unsatisfiable by every diff the Immutability job allows and repairable only by the owner's hand.
---

# An acceptance test may not turn on a file no pull request may change

`acceptance/push-gate.ts` refuses a freshly authored acceptance test whose source names a path in the immutable set other than `tests/acceptance/` itself — `vitest.config.ts` or anything under `.github/`. The Immutability job forbids every pull request from touching those, so an assertion about their contents returns the same verdict before the ticket is built and after it merges.

"Can any diff satisfy this test?" is undecidable; this is the slice needing no judgement, because the verdict is fixed by the set of diffs that job allows. Lane 04's tests land on `main` unreviewed and become law, and #272's threw a clean `AssertionError` against every possible implementation — which the gate's error-name classifier cannot see.

**Rejected:** a model judging satisfiability, a guess at an undecidable question where a wrong refusal costs the run. Banning file reads from acceptance tests — often the only route to a rule stated in a config or prompt.
