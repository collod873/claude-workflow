---
status: constraint
date: 2026-09-16
amends: ADR-0034, ADR-0038, ADR-0119
reversal: Restoring a gap route means building the reader first — a lane that wakes on the label, amends a PRD that is still open, and re-fires acceptance on the slices left — and then a second classification in lane 07's review and a second stop route in the fixer, all for a case that, measured, arrives after its PRD has already closed.
---

# An unclear spec reaches the owner on the pull request and no label routes it, because a route needs a reader that runs

`spec/gap` promised lane 02 would amend the spec. That reader was never built,
and lane 07 reviews a merged diff, so a single-slice PRD has closed before any
gap is filed. Every gap ever filed waited on the owner as a separate issue, and
one in eight named something still worth changing.

So lane 07 reviews correctness alone, and a fixer that stops making progress
labels the ticket `needs-human` and puts the tests that never moved on the pull
request. The spec still wins by construction: an implementer does not settle an
ambiguity by editing the test.

A later route that hands work to another lane names the lane that reads it, and
that lane runs before the route lands.

**Rejected: building the amendment reader.** A new lane edge and an Opus run
per gap, which helps only a multi-slice PRD still in flight.
