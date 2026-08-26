# spec/gap fires the spec author, and an acceptance test an implementer cannot pass is an ordinary red

Recorded 2026-08-26.

`DESIGN.md` §04 invents a `spec/gap` label and names nobody who reads it, which by `CONTEXT.md`'s
definition of **Edge** makes it not an edge — a label with no event behind it is a note. It gets a
reader: **`spec/gap` fires lane 02's spec author** to amend the spec. The loop closes on itself —
the merged amendment fires ADR-0033's re-entry trigger, which regenerates the affected tests, which
unblocks the slice. The owner reads it only when the spec author refuses, arriving through the
governor's queue (§8) like anything else, so the normal path has no human on it.

**Where the spec and a test disagree and neither is obviously wrong, the spec wins by construction.**
The test was authored from the spec and nothing else, so a disagreement is either a defect in the
test or an ambiguity in the spec, and neither is the implementer's to settle. It files `spec/gap`,
a native blocked-by edge lands on its slice, and the slice goes `blocked` until the loop above
returns.

**An implementer that cannot pass an acceptance test is not a separate escalation.** §04 says it
"can only fail, escalate, and land in the queue as blocked" and §05 gives the fixer three attempts
then `blocked`; #78 called that an overlap. It is one path written down twice. An implementer that
cannot pass a test produces a red PR, a red PR is the fixer's trigger, and the fixer takes its
normal three attempts — bound by the same immutable set
([ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md)), so its attempts
are constrained to implementation. There is no second budget and no second escalation path.

## Consequences

**Nothing is sized differently for an acceptance red.** A fixer facing a failing acceptance test
gets the same three attempts it gets for a lint failure. Giving it fewer would be a number nobody
holds evidence for, and the cap's own justification (§05: uncapped fixers grind against a wall for
eleven hours) does not distinguish the kinds of red.

**`spec/gap` is a lane-02 trigger, so it is not free.** Amending it means an Opus spec-author run
plus an acceptance re-fire per affected slice. That is the price of not letting an implementer
resolve an ambiguity by guessing, which is the failure this whole lane exists to make impossible.
