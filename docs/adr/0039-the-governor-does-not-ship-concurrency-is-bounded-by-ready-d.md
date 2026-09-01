---
status: superseded
date: 2026-08-26
amends: ADR-0024
superseded_by: ADR-0108
reversal: Reinstating the governor means building a WIP cap, a queue-depth dispatch stop and a five-day decision expiry against 100 issues of measurement saying none of them ever bound, and re-anchoring ADR-0037's growth trigger that inherited the five days as a plain measurement; ADR-0108 has already replaced the ruling.
---

# The governor does not ship: concurrency is bounded by ready disjoint slices and a serialised merge

Superseded by ADR-0108. Re-admitted 2026-08-31: the ruling this file carried no longer
governs, and the successor states what replaced it.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
