---
status: superseded
date: 2026-09-03
superseded_by: ADR-0148
amends: ADR-0140
reversal: Reversing it means putting the band back to 25%, and with it a committed budget only the faster half of the `ubuntu-latest` pool can clear — the state of 2026-09-03, when every Verify on `main` went red against a number a quicker runner had written four hours earlier and nothing in the system could raise.
---

# The timing deadband is 50%, because it spans a runner pool rather than a runner

ADR-0140 gave a venue its own last green time plus a margin, and 25% was sized against one
runner's variance. The number never stays on one runner: lane 05 writes it from whichever
`ubuntu-latest` it drew, Verify reads it on another, and that pool is unlike hardware. This suite,
unchanged, measured 70.3s, 57.5s and 74.4s there in one day — a 29% spread under a 25% band. The
57.5s sample became the committed budget, so the first Verify judged against one went red, and so
would every later one.

50% covers the pool and still refuses a check that has doubled. It is the deadband both ways, so
the ratchet down is now sluggish: a suite that gets 30% faster keeps its budget until it halves.
Accepted — a budget too tight reports everything, and nobody reads that.

**Rejected:** a high-water mark, which needs samples only lane 05 can take.
