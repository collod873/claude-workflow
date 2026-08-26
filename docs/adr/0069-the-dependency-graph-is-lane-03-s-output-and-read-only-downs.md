# The dependency graph is lane 03's output and read-only downstream, and a concurrent claim collision is detected at the merge and diagnoses the slicer

Recorded 2026-08-26.

**No implementer may add a blocked-by edge.** The dependency graph is lane 03's statement about the
run, published as native GitHub edges and read back to verify (§03). Anything downstream reads it and
nothing downstream writes it.

**A claimed-file collision between concurrent slices has three readers with three different jobs**, and
they are not alternatives: the **fixer** repairs it now, **lane 08** is where it is detected, and
**lane 03** is what it diagnoses.

## Why the implementer cannot write the graph

The obvious reason is that an implementer which can re-block the fleet can stall the run, and stalling
is what [ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md) and
[ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md) between them forbid.
The load-bearing reason is narrower and survives even if stalling were acceptable.

[ADR-0042](0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md) rules that the
out-of-brief read count is *"a finding about lane 03, not lane 05."* That is only true while the graph
is lane 03's alone. The moment lane 05 can edit it, a wrong graph is no longer evidence of anything —
it may be lane 03's mistake or lane 05's repair, and no reader can tell which. **An implementer that
can fix the graph destroys the measurement that says the graph needs fixing.**
[ADR-0068](0068-a-discovery-widens-a-run-by-landing-on-trunk-and-the-trigger.md) removes the motive
anyway: A ships the shared thing on trunk, so it never needs to block B to deliver it.

## The measurement, and it corrects the question

Graded across this repo's four sliced PRDs — **34 sibling slices**, 11, 9, 7 and 7 — on 2026-08-26.

**Lane 03's disjointness holds as a plan, 34 for 34.** Fourteen pairs of slices claim a file in common,
and **every one of the fourteen carries a blocked-by edge between them**. Not one overlapping pair was
left concurrently ready.

**But `## Files claimed` is unreliable as a statement of what a slice writes.** Eleven of the 34 —
**32%** — touched a file they did not claim. Of those eleven, exactly **one** wrote into a *concurrent*
sibling's claimed set: slice [#15](https://github.com/collod873/claude-workflow/issues/15) wrote
`.Workflow/agent-workflows/to-tickets/to-tickets.ts`, claimed by
[#18](https://github.com/collod873/claude-workflow/issues/18), both in PRD
[#13](https://github.com/collod873/claude-workflow/issues/13)'s first ready wave with no edge between
them. **Zero in the three PRDs since.**

Those are two different claims and only the second is what W3 needs. `## Files claimed` is a poor
prediction of *what this slice writes* and a good one of *what no concurrent sibling writes*.

**Which is why the naive counter must not ship.** Counting out-of-claim writes would have filed
**eleven** issues against **one** real collision — 91% noise, against the 22% that
[ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md) measured and
[ADR-0035](0035-lane-07-ships-with-one-refuter-and-a-refusal-that-names-no-r.md) sized a fleet down
over. An out-of-claim write that lands on a serialised neighbour costs nothing and is not a finding.
The event worth counting is the **concurrent** collision, and that is a merge conflict, not a write.

## The three readers

**The fixer repairs it.** A conflict between two concurrent PRs is a red, and
[ADR-0041](0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md)'s no-progress exit
already bounds it. Nothing new.

**Lane 08 detects it**, and can only detect it this way. §08 gives it no model
([ADR-0040](0040-lane-08-merges-without-a-model-and-the-semantic-conflict-cla.md)) and it is the one
serialised point every PR passes, so the detection is the git-level conflict itself — free, exact, and
already produced. It is the merge-time complement to W3 that §08 already describes; this names what it
complements W3 *with*.

**Lane 03 is diagnosed by it**, which is ADR-0042's shape applied to the boundary rather than to the
seam: the lane that drew the line is the lane a crossed line is evidence about. One collision in 34
slices is the same order as the one-finding-in-28-sessions that retired the seam lens, so it earns a
record and not a mechanism.

## Considered options

- **Let lane 03 refuse the run when claims overlap.** Rejected as already true and already enforced —
  all fourteen overlapping pairs carry an edge. A gate for a thing that has never failed is
  [ADR-0036](0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md)'s refused finding.
- **Make the collision a lane 08 refusal rather than a detection.** Rejected: it refuses a merge that
  git has already refused, and adds a second definition of conflict for the two to disagree about.
- **Count out-of-claim writes.** Rejected on the 91% measured above.
- **Let an implementer add an edge but not remove one.** Rejected. Adding is the stalling direction;
  removal was never the risk.

## Consequences

**`## Files claimed` keeps its job and loses a job it was being read for.** It is lane 03's
disjointness statement, not a write permission, and no gate should be built that treats a write outside
it as a violation.

**Nothing new is built and nothing new is counted.** The one number this touches is ADR-0042's, already
placed there by ADR-0065.

**The measurement is repeatable and cheap**, which is what makes this decision falsifiable: the same
comparison of claimed files against the commits that reference each slice, re-run after lane 05 has
produced runs of its own. **The number to watch is whether the concurrent-collision rate stays near
1 in 34 once the slices are implemented by parallel agents rather than by hand** — every one of these
34 was worked sequentially by the owner, so the graph has never been stress-tested by the concurrency
it exists to make safe.
