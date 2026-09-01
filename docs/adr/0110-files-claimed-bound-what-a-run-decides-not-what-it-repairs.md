---
status: constraint
date: 2026-08-29
amends: ADR-0107
reversal: Undoing it strips `implement.ts` of its post-answer regeneration, re-narrows the implementer prompt, deletes the generated-artifact list held level between `bin/gauntlet` and `regenerate-artifacts.ts` and the test pinning the wiring-baseline exclusion — and returns the estate to discarding whole paid runs whose work was correct, which it did twice in one day at roughly $6 each.
---

# Files claimed bound what a run decides, not what it repairs

A ticket's Files claimed bounds what a run may *choose*, not what it may *repair*. Two repairs sit outside it. A generated artifact the change made stale: the wrapper regenerates it after the answer and before the commit; its content is a function of the tree, so there is no decision to protect and the implementer is never told. A test the change itself turned red, where the fixture is wrong and the assertion right: this stays with the model, since "make the test pass" is how tests get weakened — never under `tests/acceptance/`, never the assertion, and every widened file named in the summary.

**Rejected:** widening tickets, which would need lane 03 to read the whole repo. A sibling ticket, which pays a run to learn what the run already knew.

**Accepted cost.** A commit may carry files its ticket does not name; an unexplained one is a defect.
