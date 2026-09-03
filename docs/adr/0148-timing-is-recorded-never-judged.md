---
status: constraint
date: 2026-09-03
amends: ADR-0147
reversal: Reversing it means a wall-clock number measured in one place again refuses a push in another — the shape of 2026-09-03, when one unchanged venue measured 57.5s where it was recorded and 88.3s and 89.4s where it was judged, and three landings in a row went red on nothing their diffs had done.
---

# Timing is recorded, never judged

ADR-0147 widened the deadband to 50% because `ubuntu-latest` is a pool. The next landing went red
anyway: the two Verify runs judging it agreed within 1.2% while missing the committed budget by
53%, each naming a different check as slowest-over. Machine draw does not do that. The split is
contextual — lane 05 records the venue inside its own job, Verify runs it cold — and nothing in the
number says which.

A gate that fires on where it ran teaches its reader to rerun until green: a runner cycle to learn
nothing.

So CI records durations as an artifact and never judges; the committed baselines and the band go
with it. One wall remains, on the workstation: the stop venue's hard 5 s ceiling, which only drops
test files to a later venue and never fails.

**Rejected:** a third widening, which raises a bar measuring the wrong thing.
