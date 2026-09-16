---
status: constraint
date: 2026-08-26
supersedes: ADR-0061
reversal: Firing lane 03 on `prd` again slices every spec before the critic has read it, holding the dispatch on a non-zero count parks specs behind a reader nothing summons, and dropping `sliceable` before the dispatch blinds `watchdog/lost-dispatch.ts`, which counts a lost dispatch from that label.
---

# The prd label fires the critic, and the slicer is dispatched whatever the open-question count

`prd` means *this is a spec*, never *slice it*. Lane 02's author and critic run as stages in one
chain, so the critic has read a spec before it publishes. The owner putting `prd` on a spec written
in session enters lane 02 at the critic alone.

Lane 03 fires only on the `prd-sliceable` dispatch, and `sliceable` is written first as the durable
trace a lost dispatch is counted from. `prd` keeps its other readers, which all take it to mean a
spec.

Every spec dispatches. The author still raises intent it would otherwise invent as a numbered open
question, but a non-zero count only adds `questions-open` beside `sliceable`; nothing holds the spec
for an answer, because nothing summons anyone to give one.

**Rejected: a zero count as the gate.** A spec held for a reader who is not coming never slices, and
nothing says so.
