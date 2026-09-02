---
status: constraint
date: 2026-09-02
reversal: Reversing it means hardcoding per-venue milliseconds in `bin/gauntlet` again, deleting `timing-baseline.ts` with its committed and gitignored baselines and lane 05's generator entry, un-deriving vitest's `maxWorkers`, and returning the stop venue to a hand-kept file list — and every enrolled repository goes back to being held to this repo's guess about someone else's suite.
---

# A venue's budget is its own last green time plus a margin, never a number declared for it

Every venue records per-check wall time into a **timing baseline**; its budget is its own last green
time plus 25%, so an enrolled repository inherits its own history rather than a figure written for
it.

The margin is a deadband: a run tightens the baseline only by beating it by more than 25%, so one
lucky fast run cannot set a bar the next honest run fails. Budgets do not travel between machines —
the committed baseline is the runner's, written only by lane 05's regenerate step; every other
machine writes a gitignored one. A margin absorbs a runner's own variance, tens of percent, never
the 8× between two cores and thirty-two.

**Rejected:** keying entries by core count, a key every enrolled repository would share; one wide
margin for every machine, catching only catastrophe.

**Accepted cost.** One suite run per implementation on the runner. Turn and stop report; push
refuses.
