# A spec edit re-fires acceptance for every slice whose test names a criterion the spec no longer carries

Recorded 2026-08-26.

Status: superseded by ADR-0053, ADR-0079

`DESIGN.md` §04 re-fires the acceptance author "for the affected slices only" and never says what
affected means. It means this, mechanically: every acceptance test names the criterion it proves
**verbatim** (§04, W4's endpoint), so a slice is affected when a test it owns names a criterion
string that no longer appears verbatim in the current spec. The trigger is a grep. It costs nothing,
it catches edited and deleted criteria in the same pass, and it reuses a rule that is already
load-bearing rather than inventing a second one that can drift from it.

A criterion **added** to the spec that no test names is deliberately outside this trigger. That is
not a re-acceptance — there may be no slice it belongs to — it is a re-slice, and it routes to lane
03 as its own edge.

## Considered options

- **Re-fire every slice of the PRD** — always correct, and it burns an Opus per untouched slice on
  every spec typo. Rejected on cost, not on correctness.
- **The acceptance author re-reads and judges which slices moved** — rejected. It puts a judgement
  call on the critical path and gives the edge no mechanical trigger, which by `CONTEXT.md`'s own
  definition makes it not an edge.
- **The verbatim-criterion grep** — chosen.

## Consequences

**An in-flight implementer needs no new machinery.** Its slice's regenerated tests merge to trunk;
its open PR goes red against them on rebase — [ADR-0032](0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md)
restores from `main`'s tip precisely so this happens — and the fixer picks it up as an ordinary red
(ADR-0034). Three attempts, then `blocked` with notes, is the correct outcome for a slice whose spec
moved further than a fix can follow: that is the escalation working, not a gap in it. A bespoke
"the spec moved under you" path would be machinery for a case this already covers.

**The verbatim rule stops being a documentation nicety and becomes load-bearing twice.** It is
W4's endpoint *and* it is the re-entry trigger. An acceptance author that paraphrases a criterion
breaks the trigger silently, so the verbatim match is worth checking at authoring time rather than
discovering the first time a spec edit fails to re-fire.
