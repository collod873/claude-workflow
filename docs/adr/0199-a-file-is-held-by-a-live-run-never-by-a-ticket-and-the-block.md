---
status: constraint
date: 2026-09-16
reversal: Going back means a scheduling fact is stored as a permanent dependency again, so any ticket that stalls holds every later ticket whose claim touches its files until someone deletes edges by hand, and a writer re-deriving them undoes the deletion on its next pass.
---

# A file is held by a live run, never by a ticket, and the blocked-by graph has one writer, lane 03

Two claims overlapping is a scheduling fact: don't edit these files at the same time. It stops being
true when the run doing the editing ends. A `blockedBy` edge says one ticket must land before
another, until someone removes it. So the reconciler writes nothing for an overlap: for one pass it
skips a ready ticket whose `## Files claimed` overlaps a live run's ticket or one dispatched earlier
that pass. Lane 08's rebase-and-gauntlet catches what claims miss. This extends
[ADR-0189](0189-a-ticket-s-stage-is-read-from-its-artifacts-a-standing-branc.md)'s "a live run is
the claim" to files, and holds [ADR-0069](0069-the-dependency-graph-is-lane-03-s-output-and-read-only-downs.md):
lane 03 is the only writer, and `edge-writer-gate.test.ts` holds that.

**Rejected: #559's reconciler wiring, a `blockedBy` edge for every overlapping pair, lower number blocking higher.** It picked direction by age, re-derived deleted edges every pass, and chained #600 behind the stuck #538 it was filed to unstick.
