---
status: constraint
date: 2026-08-26
supersedes: ADR-0024
reversal: Reinstating a governor means building a WIP cap, a queue-depth dispatch stop or a decision expiry against 100 issues of measurement saying none ever bound, or re-keying `implement.yml`'s per-ticket concurrency group to a fixed one that Actions silently thins to one running and one pending.
---

# The governor does not ship: concurrency is bounded by ready disjoint slices and a serialised merge

There is no WIP cap, no queue-depth dispatch stop and no decision expiry. Implementer concurrency is
however many ready disjoint slices lane 03 cut: `implement.yml` keys its group per ticket, and lane
08's single fixed `integrate` group serialises the merge, which is the throughput ceiling. If that
binds, it shows as pull-request wait time, and the fix belongs at the merge, not at dispatch. Runner
minutes are not a design input.

Over this repo's first 100 issues the median close was 1.5 h, none reached five days, and 23 open at
once against a ~7 cap never stalled.

A fixed implement group is this governor set to one, and worse: Actions keeps one pending run per
group and cancels the rest, so a wave silently loses slices.

**Rejected: a re-anchored WIP cap.** A third dial duplicating the slicer's graph and the serialised
merge.
