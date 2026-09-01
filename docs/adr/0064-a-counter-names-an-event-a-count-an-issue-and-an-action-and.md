---
status: constraint
date: 2026-08-26
reversal: Dropping the bar re-opens §6 to *countable, therefore free*, the argument that took three counters to ten in four days; it also unhouses the sizing measurements now living inside ADR-0039, 0041, 0042, 0052, 0056 and 0070, and removes the only audit event the counter set has.
---

# A counter names an event, a count, an issue and an action, and is measured against the history it would have read

A counter enters `DESIGN.md` §6 only if its admitting ADR names four things: the **event** that fires it, the **count** at which it acts, the **issue** it files, and the **action** that issue proposes. A number naming no action is a **sizing measurement** — the query that would say a decision was wrong. It gets no §6 row and no build, and lives in the ADR whose decision it sizes. Before it is built, a counter is measured against the history it would have read: zero in a corpus that exists is a cut, zero because the corpus does not exist yet a deferral. The audit event is the next counter's admission, which asks every existing one whether it has filed.

**Rejected:** *countable, therefore free* — no stopping condition, and counting is free where the owner's attention is not; a cap on the count of counters; auditing on a clock.
