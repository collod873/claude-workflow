# A discovery widens a run by landing on trunk, and the trigger is the compiler rather than a count

Recorded 2026-08-26.

When slice A discovers something B..N all need, A lands it on trunk in its own commit. B..N absorb it
on rebase or go red against it, and the fixer clears the red as an ordinary failure
([ADR-0041](0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md)).

**Nothing re-slices a run in flight**, no run pauses, and no count escalates. The widening mechanism
already exists and is already mechanical.

## The tension in the question is a false one

[#112](https://github.com/collod873/claude-workflow/issues/112) framed it as
[ADR-0042](0042-a-seam-question-does-not-block-the-implementer-reads-on-and.md) leaving the
implementer's knowledge with **no actuator** — it goes into a count that diagnoses lane 03 later,
rather than into anything that acts now.

That reads ADR-0042 one word too wide. It ruled that a seam question **does not block**. It never
ruled that a discovery does not **ship**. The implementer already holds the only actuator this design
permits — a commit on trunk — and
[#98](https://github.com/collod873/claude-workflow/issues/98) already ruled trunk the **only** channel
by which a discovery reaches the rest of a fleet. What ADR-0042 withheld was the power to *stall*, not
the power to *act*. There is no gap to fill.

## The four discovery kinds, each routed

| Kind | Route |
|---|---|
| The spec is wrong or ambiguous | `spec/gap` fires lane 02 ([ADR-0034](0034-spec-gap-fires-the-spec-author-and-an-acceptance-test-an-imp.md)); the amendment re-fires acceptance for affected slices ([ADR-0033](0033-a-spec-edit-re-fires-acceptance-for-every-slice-whose-test-n.md)); new tests hit trunk; in-flight PRs go red; the fixer takes it. No human, no pause |
| A plain defect in merged code | Its own ticket, fixed on trunk, everyone rebases. Nothing new |
| The seam is in the wrong place | **Deliberately unrouted and absorbed** — ADR-0042. The implementer reads on, records it, and the count diagnoses lane 03 rather than this run |
| Slice A discovers what B..N need | **Routed, and it always was.** A lands it on trunk; B..N absorb on rebase or go red; the fixer clears it. This ruling states it rather than adding it |

## Against ADR-0011's parking test

Three shapes were weighed in #98's grilling.

- **Stop the run and re-slice.** Refused. It parks work only the owner can clear, which is exactly the
  ground [ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md) covers and the reason
  the governor died ([ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)).
  Worse here than there: the governor parked items at the top of the pipeline, where the owner is
  already spending minutes; this parks N implementers mid-flight, and the only agent that can clear a
  red without him is the fixer, which a pause switches off.
- **Nothing re-slices; the run finishes as cut.** Accepted, and it is not the cheap option it was
  described as. Its stated price — N times the waste, plus merge conflicts — is the price of the
  *unwidened* version. With A landing the shared thing on trunk, B..N pay one rebase each.
- **A lands it in its own PR and the others absorb it.** Accepted. No pause, no new mechanism.

## The trigger is not a count, because it does not need to be

#98's grilling proposed escalating to a real re-slice on a count — the same shared thing discovered by
two implementers in one run — *so widening is mechanical rather than a judgement call.* The instinct
is right and the mechanism is unnecessary: **widening is already mechanical, and no agent judges
anything.** A lands a commit. `git rebase` and the test suite decide what that means for B..N. The
compiler is the trigger, and it is free, deterministic, and already built.

A count would also fail
[ADR-0064](0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md)'s bar on its own
measurement. The only corpus available is this repo's four sliced PRDs — **34 sibling slices** — and
across them the same shape was never discovered twice in one run. Nor is there a real corpus coming:
the signal it would read is the out-of-brief read, and **this repo has opened zero pull requests,
ever**. Deferring an unspecified mechanism to a lane that does not exist is the permanent exception
[ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) rules against, and it
is precisely how parity died in
[ADR-0065](0065-parity-and-correction-do-not-survive-their-own-history-so-se.md).

**Nothing new is measured, because the number already exists.** ADR-0042's out-of-brief reads by module
is a sizing measurement placed in ADR-0042 by ADR-0065, and it is exactly the falsification condition
for this ruling: a rising count says the seam manifest is systematically wrong, which is the world in
which absorbing rather than re-slicing stops being cheap.

## Considered options

- **Let A open a PR that B..N are told to wait for.** Rejected — that is the pause, dressed as
  coordination, and it makes an implementer the thing the fleet coordinates through instead of the
  repo (#98).
- **Have lane 03 re-slice on a dispatch from lane 05.** Rejected. Lane 03 refuses a PRD that already
  has sub-issues (§03), so re-slicing means deleting live tickets under running implementers. The
  refusal is right and the run is the wrong place to relax it.
- **Ship the escalation count now and size it later.** Rejected on ADR-0064's clause and on ADR-0031's.

## Consequences

**A run's width is fixed at slice time and its content is not.** Lane 03 decides how many implementers
run ([ADR-0039](0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md)); trunk decides
what each of them is building against. Those are different questions and only the first is a plan.

**The fixer absorbs one more class**, and it was already shaped for it: a rebase conflict and a red
suite are the same event to it, and ADR-0041's no-progress exit bounds both.

**The honest limit.** All 34 slices this repo has cut were implemented by hand, sequentially, because
lane 05 does not exist. The disjointness this ruling leans on has never been stress-tested by actual
concurrent agents, and that is the argument *for* the cheap answer rather than against it: the
expensive one would be sized on a corpus that does not exist. The world that reopens this is
duplicated work landing in trunk faster than the proposed lens surfaces it — the same signal §08
already stakes the merge warden's absence on.
