# The refuter fleet is sized by what the owner does with surviving findings, not by its own kill rate

Recorded 2026-08-26.

The counter that resizes lane 07's refuter fleet reads **the fate of the findings that survived it**,
not how many it killed. It fires on a lane 07 finding issue **closing**, and it is two-sided:

| Direction | Threshold | What it does |
|---|---|---|
| **Grow** | 3 surviving findings closed `not planned`, or left untouched past §8's five-day expiry | Files an issue proposing a second refuter |
| **Delete** | 20 findings reaching the refuter with **zero** ever refuted | Files an issue proposing the fleet's deletion |

Both **file an issue and never act**, per §6's rule that every lens and counter produces issues and
never notifications. A declined proposal re-proposes only when its count has **grown**, inheriting
[ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md)'s two-site shape so
the counter cannot nag.

## Why the kill rate is the wrong number

A kill rate measures the refuter against itself. It cannot distinguish a fleet that is filtering
well from one that is **laundering** — killing enough to look busy while what survives still reads
as noise. The owner said as much about a shipped lane one lane earlier, on
[#83](https://github.com/collod873/claude-workflow/issues/83):

> *"do we actually need to output anything? Not sure the audit flags are actually helpful to me a
> non dev."*

The refuters are the **queue-length mechanism** (§07), so the only verdict that means anything is
whether the surviving finding was worth the space it took in a queue capped at ~7. That verdict is
the owner's, it is already recorded, and it costs nothing to read.

## Why this evidence exists already

Lane 07 produces **issues**, never notifications. So a surviving finding's fate is on the tracker:
a `not_planned` close is a false alarm the owner declined to act on, and an issue still open past
the brief's five-day expiry is one he declined to act on without saying so.

§6 already designs this counter. It is the **fourth free counter** — flagged rather than built,
counting `not_planned` closes on issues carrying `## Acceptance criteria`, and parked behind the
other three *"because they have volume and it should have none; the first time it has any is the
finding."* This ADR points it at lane 07 and gives it its first real job. No new machinery: it is
evidence class 6 (the tracker) crossed with class 9 (the owner's behaviour), both of which §6's
coverage ledger already says are countable and therefore free.

## Considered options

- **Count refuted findings, per `DESIGN.md` §12 ⚠#5.** Rejected as the primary signal for the reason
  above, but **kept as the delete trigger**: a fleet that has never once refuted anything in 20
  findings is not filtering, whatever the survivors' fate.
- **A grading session over lane 07's output, as ADR-0019 ran over the transcript corpus.** Rejected.
  It is a ritual, and C4 says a ritual dies by month three. The tracker already holds the grade.
- **One threshold for both directions, N=20 as in ADR-0017 and ADR-0031.** Rejected, and this is the
  one place this ADR departs from the house number. Twenty false alarms is roughly three times the
  entire C7 queue cap arriving as noise before anything reacts — the mechanism would only fire long
  after the damage it exists to prevent. The two directions have opposite costs, so they get
  opposite thresholds: **adding** a refuter is a prompt edit and ADR-0019 already established that
  reversibility licenses acting on thin data, while **deleting** a filter is the direction where
  being wrong is expensive and silent.

## Consequences

This is [ADR-0031](0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md)'s shape,
with the one difference lane 07 forces: **the count is two-sided.** Lane 01's refuter can only fail
by being silent; lane 07's can fail by being silent *or* by killing everything, because it stands
between the owner and a lane that costs 2 Opus per PR to run. A one-sided count would leave the more
expensive failure unwatched.

It also satisfies §6's standing demand — *everything that claims to catch something is asked whether
it ever did, at the event that would add another of its kind* — with a firing event that happens on
its own. That was ADR-0031's whole finding, and the defect it names is live one more time in this
ticket's own subject: **nothing on §10's build order schedules lane 07 at all**, so the lane this
counter watches has no move to be built in. That is filed as its own build-order issue.
