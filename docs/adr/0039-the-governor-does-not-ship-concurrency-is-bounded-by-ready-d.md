# The governor does not ship: concurrency is bounded by ready disjoint slices and a serialised merge

Recorded 2026-08-26.

Status: superseded by ADR-0108

Amends: [ADR-0024](0024-there-is-no-daily-spend-ceiling-and-the-governor-stops-on-qu.md), which left
the queue-depth and WIP limits standing — see "What this amends" below.

`DESIGN.md` §8's governor does not get built. There is no WIP cap, no queue-depth dispatch stop, and
no five-day decision expiry. Implementer concurrency is whatever lane 03 cut as ready disjoint
slices, absorbed by lane 08's single serialised merge. §8 is deleted; the brief survives it and moves
to §8 alone.

## What this amends

[ADR-0024](0024-there-is-no-daily-spend-ceiling-and-the-governor-stops-on-qu.md) struck the third
governor limit and left the other two standing — *"the governor stops on queue depth and WIP alone."*
This strikes both, so the governor has nothing left to enforce and does not ship at all.

`GOAL.md` C7 is **not** amended. The constraint — the owner stays the decider, batched — survives
untouched; what does not survive is the Foundry's mechanism for it. C7's test is *how many times a
day does this interrupt?*, and the brief answers that on its own, since it is the only thing
permitted to reach the owner ([ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md)).

## The evidence

The queue-depth stop and the five-day expiry were inherited from the Foundry draft and never
measured against this owner. Measured on 2026-08-26 over this repo's first 100 issues, 72 of them
closed:

| | |
|---|---|
| Median time to close | **1.5 h** |
| p90 | 44.3 h |
| Maximum, all 72 | **47.1 h** |
| Ever reached the 5-day expiry | **none** |
| Peak simultaneous open issues | **23** — 3× the ~7 cap, with no observable stall |
| Highest single day | 46 created, 30 closed (2026-08-26) |

The owner clears roughly thirty items a day and has never been the bottleneck. A cap sized to his
review rate is sized against a constraint that has never bound.

**A runner-minute ceiling was considered and rejected as an anchor.** The rolling-30-day Actions
figure in `docs/research/actions-billing-2026-08.md` could not be reproduced against a source, and
the owner ruled on 2026-08-26 that minutes are not an input to this decision: if the allowance is
ever actually hit, that is the moment to rethink, and not before. Nothing in this design is sized
against Actions minutes.

## Considered options

- **Keep a WIP cap, re-anchored** — rejected. Two mechanisms already bound implementer count without
  a dial: the number of ready disjoint slices lane 03 has cut, and the single serialised merge that
  absorbs them. A WIP number is a third dial that duplicates both and adds nothing either does not
  already do.
- **Keep the queue-depth stop as insurance** — rejected. It guards an event that 100 issues of
  measurement say does not happen, which is the shape
  [ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) rules against. If
  the owner's answer latency ever changes, that is visible in the same query, for free, with nothing
  built.
- **Delete the governor entirely** — chosen. Work now runs on GitHub-hosted runners
  ([ADR-0002](0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md)), so the
  workstation-load argument that motivated a cap no longer applies either.

## Consequences

**The real throughput ceiling is the serialised merge, and it is now load-bearing.** It stays
serialised: parallel wardens cannot see each other's merges. If it becomes the bottleneck that shows
up as PR wait time, which is countable, and that count is the trigger to revisit.

**Unreviewed work still rots** — trunk moves under it and it rebases badly. That cost is caused by
the serialised merge, so the fix belongs at the merge, not at dispatch. Capping dispatch to avoid it
was treating the symptom at the wrong end.

**Move 9 shrinks to the brief.** "The governor and the brief" is now just the brief.

**[ADR-0037](0037-the-refuter-fleet-is-sized-by-what-the-owner-does-with-survi.md)'s growth counter
keeps its five days.** It sizes lane 07's refuter fleet on findings the owner closed `not planned`
*or left untouched past §8's five-day expiry* — and deleting the expiry left half that trigger
undefined. The duration survives the mechanism: **five days is now a plain measurement of neglect**,
with no re-read and no withdrawal attached. It is better grounded as a measurement than it was as a
mechanism — the longest this repo has ever taken to close an issue is 47.1 h, so untouched-at-five-
days is roughly 2.5× the worst case ever observed, which is what makes it a signal. ADR-0037 is
otherwise unchanged.

**Two other passages referred to deleted machinery** and are corrected in the same range: lane 01's
`parked` verb no longer explains itself by an expiry that does not reach it, and lane 03's W3 note no
longer cites "3–6 concurrent implementers" — the slices it cuts *are* lane 05's concurrency.

**`DESIGN.md` §11's filed question for [#84](https://github.com/collod873/claude-workflow/issues/84)
is answered**, and the ~7 queue cap and five-day expiry stop being unmeasured numbers by ceasing to
exist.
