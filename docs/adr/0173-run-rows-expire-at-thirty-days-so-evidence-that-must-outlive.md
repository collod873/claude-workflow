---
status: constraint
date: 2026-09-09
reversal: Pruned rows are gone, and nothing can reconstruct the denominators a durable finding rests its argument on once they age out.
---

# Run rows expire at thirty days, so evidence that must outlive them moves to docs/research

Every hook writes a JSONL run row (`_hook.LOG_RETENTION_DAYS`), and those rows are pruned at
thirty days. They are evidence with an expiry: enough to answer "how often did this guard fire
last month", never enough to answer it about last year.

A finding that must survive is copied into `docs/research/` with the numbers stated in prose.
That is the moment evidence becomes a record, and it is the only durable form: a venue budget or
a fast-check ruling that cites a firing rate exists as a fact only because it was written down
before the rows behind it aged out.

**Rejected: keeping rows indefinitely.** The busiest hook on a workstation fires tens of
thousands of times a month; unbounded retention buys storage no reader ever queries.

Imported from collod873/agent-skills ADR-0040 on 2026-09-09; that repo no longer carries the
ruling.
