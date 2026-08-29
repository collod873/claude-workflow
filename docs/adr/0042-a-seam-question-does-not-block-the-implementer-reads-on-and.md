# A seam question does not block: the implementer reads on and leaves a countable trace

Recorded 2026-08-26.

Status: superseded by ADR-0103

An implementer that finds it needs to read outside its brief **reads what it needs and carries on**.
It does not file a blocking `seam/question`, does not surrender its slice, and nobody is dispatched
to answer it. It records that it went outside its brief and which module it read. That record is a
count, and the count is the finding.

## What this amends

`DESIGN.md` §05, which ruled that *"needing to read another module means the interface is wrong,
which is a `seam/question` issue, not its call to fix."* The diagnosis stands; the remedy does not.

## The argument

The brief is deliberately narrow — the ticket, the seam manifest, the module's `CONTEXT.md`, the
failing tests, and **not** the repo — because an implementer that reads broadly couples broadly. A
blocking `seam/question` was the enforcement: stop, file, wait for the manifest to be amended.

Nothing downstream catches bad coupling, and it is worth being precise about why, because the
obvious answer is wrong:

- **The seam lens does not exist.** It was dropped in
  [ADR-0019](0019-violation-and-proposed-survive-proposed-is-gated-by-the-two.md) — one finding
  across 28 sessions, and that one stale.
- **The violation lens has nothing to check.** It enforces already-ratified prose rules;
  `CODING_STANDARDS.md` carries no rule about module boundaries, so there is nothing for it to fire
  on.
- **The proposed lens needs two sites** and generalises to a rule rather than naming a coupling.

So this is *not* the merge-warden case
([ADR-0040](0040-lane-08-merges-without-a-model-and-the-semantic-conflict-cla.md)), where a measured
mechanism already covered the class one moment later. Here nothing covers it.

**But the same evidence that says nothing catches it says it barely happens.** The seam lens produced
one finding in 28 sessions because this class does not arrive. A mandatory round trip — file, release
the slot, re-fire lane 03's seam picker, re-dispatch — pays a certain cost on every occurrence to
prevent an event measured at roughly one in twenty-eight.

## Considered options

- **Block and re-fire lane 03's seam picker** — rejected. The picker owns the manifest and is the
  right answerer, so the routing was correct; the cost is what fails. It also holds a slice across
  two dispatches for a fault the evidence says is rare.
- **Route it to the owner** — rejected outright. He holds no better information than the picker does,
  and it converts an interface defect into a decision on his desk.
- **Read on, leave a trace** — chosen. Free, non-blocking, and it produces the number that would
  justify reinstating a block.

## Consequences

**The finding is about lane 03, not lane 05.** A rising count does not say *this implementer coupled
badly*; it says **the seam manifest is systematically wrong**, which is a slicer defect that no
per-implementer refusal would ever have surfaced. That is the diagnosis the blocking design could not
produce, because a blocked implementer files one issue and the pattern never accumulates anywhere.

**A good seam manifest is what keeps the count near zero**, which makes the count a live measure of
lane 03's output quality rather than a defect log.

**Coupling is unwatched until the count says otherwise.** Accepted deliberately: reinstating a
mechanism is cheap, and the number to watch is in place from the first run.
