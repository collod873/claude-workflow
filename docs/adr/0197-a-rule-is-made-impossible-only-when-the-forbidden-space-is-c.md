---
status: constraint
date: 2026-09-16
reversal: Dropping this lets any closed-looking set climb to impossible regardless of who sees the failure or when, so a check on state that changes without a reviewed commit - the filesystem, a run's output - gets forced into a type that cannot track it, and a rule kept at this rung by repeated refusals stops being read as evidence it belongs at repaired instead.
---

# A rule earns impossible only when its set is closed by deliberate act and a wrong exclusion fails at authoring time

`plan-schema.ts` (ADR-0081) is the clean case: a malformed plan fails at the API boundary, in front of the stage that wrote it. `immutable-set.json` closes the same way, by a reviewed commit, but its refusal once named only the set's members; `render-body.ts:63` and `bin/gauntlet`'s venue list now name the file and editing act - the exit an excluded case is owed.

Closure in the world is most of the test: membership changes only by deliberate act. Claimed paths fail it - the filesystem isn't enumerable by commit, so rooting stays at repaired. Fire count runs opposite to intuition: repeated refusals argue for repaired; silence in a closed world promotes, silence in an open one deletes (ADR-0003).

**Rejected: fire count alone decides the climb.** A quiet rule earns nothing without a closed, authoring-time failure behind it; a loud one argues people keep needing the excluded case.
