---
status: superseded
date: 2026-08-26
superseded_by: ADR-0088
reversal: Moving the reconciler to a daily cron needs an exception to ADR-0004 and puts it on the same Actions delivery path the outage throttles; ADR-0088 has already replaced the ruling.
---

# The close gate's reconciler rides session end, because a cron is throttled by the same outage it exists to survive

Superseded by ADR-0088. Re-admitted 2026-08-31: the ruling this file carried no longer
governs, and the successor states what replaced it.

The number and filename are kept unchanged because they are cited from issues and
permalinks that cannot be edited from this repo.
