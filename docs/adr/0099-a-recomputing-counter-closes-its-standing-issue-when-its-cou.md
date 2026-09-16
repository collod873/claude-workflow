---
status: constraint
date: 2026-08-29
reversal: Leaving a recomputing counter's standing issue open at zero means `reportUnreachable` and the missing-trailer counter return early again, and a report nothing can clear stays open to be acted on by whoever reads it.
---

# A recomputing counter closes its standing issue when its count reaches zero

A counter that recomputes its whole set every run knows when the set is empty, and then closes its
standing issue with a comment. The unreachable-slice report in
`dispatch/reconcile.ts` and the missing-trailer counter are this shape. A counter that sees one item
at a time, like the lost-dispatch counter, never holds the set and must not close on its own clean
run. A report over a time window retires only on evidence its subject recovered ([ADR-0117](0117-a-standing-report-speaks-only-on-evidence-it-has-not-already.md)).

An open report nothing can clear is a park with an issue number: one named two slices unreachable,
both delivered within the hour, and it stayed open because the zero path returned before reaching it.

Closing never retires the mechanism; a later nonzero count files again. A failed close is retried by the next
recompute.

**Rejected: closing standing reports by hand.** Every report a mechanism opens outlives its truth
until someone notices.
