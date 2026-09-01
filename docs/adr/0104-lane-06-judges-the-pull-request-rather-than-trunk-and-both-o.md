---
status: constraint
date: 2026-08-29
amends: ADR-0095
reversal: Reversing means lane 08 merging again without lane 06's acceptance verdict and pointing the verify job's checkout back at the default branch, which grades trunk rather than the diff — wrong in both directions at once — and the merge that motivated this ruling landed with the gate deciding nothing.
---

# Lane 06 judges the pull request rather than trunk, and both of its jobs now bind on lane 08's merge

From one pull request that merged while the job judging it was failing:

1. `verify.yml`'s `Restore and run acceptance` checks out the pull request under test before restoring `tests/acceptance/` over it. With no `ref:` on a `repository_dispatch` the checkout landed on `main`, grading trunk — failing every correctly built slice and passing any slice trunk already implemented. The head branch is resolved from the payload's PR URL.
2. Lane 08 binds on that verdict and re-reads until the job concludes, bounded near ten minutes. ADR-0095 let it only warn because lane 04 was unwired; that has landed. The job is a checkout, an `npm ci` and a vitest run, so a single read would settle a genuine race by refusing whichever pull request lost it.

**Accepted cost.** Giving up leaves the verdict `unjudged`, which refuses (ADR-0054) — a merge that waits rather than one that should not have happened.
