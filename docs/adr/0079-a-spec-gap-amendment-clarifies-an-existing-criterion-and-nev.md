# A spec-gap amendment clarifies an existing criterion and never adds one, so nothing re-slices

Recorded 2026-08-27.

Amends: ADR-0033

[ADR-0033](0033-a-spec-edit-re-fires-acceptance-for-every-slice-whose-test-n.md)'s last paragraph
routes a criterion *added* to a spec with no test naming it to lane 03 "as its own edge." That route
no longer exists. [ADR-0062](0062-the-prd-label-fires-the-critic-and-a-zero-open-question-coun.md)
moved lane 03's trigger off the `prd` label and onto lane 02's `repository_dispatch`, and
`to-tickets.yml` independently refuses a PRD that already has sub-issues — its documented escape
hatch is closing or detaching the existing children by hand, a deliberate act. So the amending run
cannot dispatch and the owner cannot re-label: ADR-0033 names an edge with no mechanism under it.

The repair is to remove the case rather than build the route. **A `spec/gap` amendment may clarify a
criterion the spec already carries and may not add one.** Clarification re-fires the acceptance
author through ADR-0033's verbatim grep, which is untouched. Genuine new scope is a follow-up idea
and enters at lane 00, where every other new requirement enters.

## Why the route was not worth building

**An added criterion mid-run is a re-slice in flight.** That is the ground
[ADR-0068](0068-a-discovery-widens-a-run-by-landing-on-trunk-and-the-trigger.md) already stands on:
re-slicing parks N implementers mid-flight while switching off the one thing that clears a red
without the owner, which is
[ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md)'s failure mode and the reason
the governor died. A `spec/gap` amendment arriving from lane 04 or lane 07 arrives *during* a run by
construction — that is when the tests and the reviewers exist to find the gap.

**The gap `spec/gap` names is ambiguity, not absence.** `DESIGN.md` §04 rules that where a test and
the spec disagree the **spec wins by construction**, because the test was authored from the spec and
nothing else. A defect of that shape is a criterion admitting two implementations, which a
clarification fixes in place. A criterion the spec never carried at all is not a disagreement with a
test — no test names it — so it was never in `spec/gap`'s class.

**Teaching lane 03 incremental slicing is a design, not a delta.** It has to answer which existing
sub-issues cover which criteria, how a plan diffs against issues already published, and what happens
to a slice whose criteria moved underneath it. None of that is decided, and buying it here would put
an undecided mechanism on the critical path of a spec whose point is that nothing undecided reaches
an implementer.

## Considered options

- **The amending run dispatches, and lane 03's sub-issue refusal learns to accept an amendment
  dispatch that slices only uncovered criteria.** Rejected: it is the incremental-slicing design
  above, and it re-slices in flight against ADR-0068.
- **The amending run files an issue naming the uncovered criteria and the owner re-slices
  deliberately.** Rejected: it keeps the case alive at the cost of an owner touch, and the owner's
  only correct move is to close or detach the run's children — which is a re-slice in flight
  performed by hand.
- **A `spec/gap` amendment may not add a criterion.** Chosen. No new machinery, no in-flight
  re-slice, and it matches what `spec/gap` already is.

## Consequences

**The spec author gains a refusal.** Fired by `spec/gap`, it amends the criterion the gap names and
nothing else. Where the gap can only be repaired by a criterion the spec does not carry, it refuses
the amendment and files an ordinary idea for the missing scope, naming the slice that surfaced it.
That refusal is the amendment lane's whole escalation path.

**ADR-0033's grep re-entry is now the only re-entry.** A merged amendment re-fires the acceptance
author for the slices whose tests name a criterion the spec no longer carries verbatim, and there is
no second trigger beside it. The blocked-by edge on the slice clears when the amendment merges.

**A slice can still be wrong about its scope, and that is a lane 03 finding.** A gap that keeps
resolving into new scope says the slicer cut against criteria that were never determinate — the same
shape as ADR-0042's out-of-brief count, which diagnoses lane 03 rather than the lane that reported
it. Nothing counts this yet; it is a sizing measurement waiting for traffic, and this repository has
produced no `spec/gap` at all.
