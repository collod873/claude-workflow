---
status: constraint
date: 2026-10-22
reversal: Tickets would wait on separate review, fix and queue jobs again, each a held state needing its own wake.
---

# A ticket builds, reviews and lands in one run

One run takes a ticket from build to main. The builder builds; a fresh reviewer with the same access
(ADR-0011) reads the ticket, the diff and its commit messages, then fixes what it finds or approves;
`bin/land` runs the full check and merges (ADR-0008); the ticket closes and tickets waiting on it
wake. Nothing goes back to the builder and nothing is reviewed twice. Each ticket lands on its own,
whatever else is landing.

**Rejected: a review job that hands findings back to the builder.** #1384 looped five times in an
hour, and Lumaria's reviewer failed 17 of 19 PRs first time, mostly for a missing file, about 50
minutes each.

**Rejected: the closer's queue, or batched merges.** 13 reviewed green Lumaria PRs sat in the queue
until a session merged them by hand (#1228).
