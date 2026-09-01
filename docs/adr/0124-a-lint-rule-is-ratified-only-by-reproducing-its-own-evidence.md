---
status: constraint
date: 2026-08-31
reversal: Dropping the trial deletes the detached-worktree harness and the fallback-entry requirement from the `mechanise` verdict schema, and collapses the per-finding spawn-and-commit structure a demotion depends on — after which lint rules enter `eslint.config.js` unproven, with every site they justified already refactored, and are caught only sweeps later by ADR-0003's standing question.
---

# A lint rule is ratified only by reproducing its own evidence

When the ratifier mechanises a finding, the harness runs the rule it just authored against the tree as it stood **before** that finding's site fixes, in a detached worktree staged inside the repository. The rule must flag every site the observation carries; one that misses a site is demoted: its edits reverted, and the prose entry the verdict already supplied lands instead.

The threshold is the observed failure, not a number anyone chose: a PROPOSED finding reaches the ratifier only by clearing the two-site gate, so it arrives carrying a prediction the rule did not get to choose. ADR-0003's standing "did it ever fire?" still stands, but an exit measured in sweeps learns too late that a rule was wrong when written.

**Accepted cost.** A `mechanise` verdict must carry its fallback entry, and each finding needs its own spawn and commit so a demotion discards one finding's edits.
