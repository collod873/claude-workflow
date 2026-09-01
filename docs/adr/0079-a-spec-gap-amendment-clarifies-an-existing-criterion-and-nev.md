---
status: constraint
date: 2026-08-27
amends: ADR-0033
reversal: Reversing means designing and building incremental re-slicing in lane 03 — how a plan diffs against published sub-issues, what becomes of a slice whose criteria moved underneath it — and accepting a re-slice while N implementers are in flight, which is the parked-work failure ADR-0011 and ADR-0068 exist to forbid.
---

# A spec-gap amendment clarifies an existing criterion and never adds one, so nothing re-slices

A `spec/gap` amendment may clarify a criterion the spec already carries and may not add one. Clarification re-fires the acceptance author through ADR-0033's verbatim grep; new scope is a follow-up idea entering at lane 00.

ADR-0033 routed an added criterion to lane 03 "as its own edge", and that route is gone: ADR-0062 moved lane 03's trigger onto lane 02's dispatch, and `to-tickets.yml` refuses a PRD that already has sub-issues. An amendment arrives mid-run by construction, so adding a criterion re-slices in flight — ADR-0068's and ADR-0011's failure mode, parking N implementers.

**Rejected:** teaching lane 03 incremental slicing, an undecided design on the critical path; filing an issue for the owner to re-slice, which is the same in-flight re-slice by hand.

**Accepted cost.** The spec author must refuse a gap repairable only by new scope and file an ordinary idea naming the slice that surfaced it.
