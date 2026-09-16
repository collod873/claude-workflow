---
status: constraint
date: 2026-09-16
reversal: Dropping this returns the slicer to guessing repo-relative roots from names spelled out in its prompt instead of reading `repoTopLevel()`, so its claims can again resolve to a root `validatePathsAreRooted` disagrees with, and the rooting rule goes back to the venue it had to be repaired away from at every stage that repeats the guess.
---

# A stage carries a resolution to the next stage and leaves it to rediscover a judgment

`repoTopLevel()` (`render-body.ts:78`) is the reference case: one function supplies both the set the slice prompt is handed and the set `validatePathsAreRooted` checks a claim against, so the two cannot disagree and the slicer stops guessing. That resolution carried is what let the rooting rule leave refused: the fact it needed stopped being rediscovered.

Carriage is not free, so it is not the default. A **resolution** — a set read off the tree, a token already resolved — is carried, because withholding it makes downstream reopen a question with no new information to answer it. A **judgment** — what a diff means, which slice is a tracer — is not, because carrying it substitutes upstream's read for downstream's independent one, and independent judgments checking each other is the acceptance/implement design, not a gap.

**Rejected: carry unless impossible.** Makes every stage a superset of upstream's knowledge, with no interface and no budget.
