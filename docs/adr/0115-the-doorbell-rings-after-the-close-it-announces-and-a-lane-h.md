# The doorbell rings after the close it announces, and a lane handed a closed ticket refuses it

Recorded 2026-08-30.

Amends [ADR-0094](0094-lane-08-closes-the-ticket-it-merged-and-a-ticket-that-will-n.md), whose
"Considered options" rejected closing before the doorbell so successors would not queue behind the
ticket author's own `check:` commands. The latency argument was real; what it bought was worse:
readiness is *defined* as every blocker closed (`shared/ready-set.ts`), so ringing before the close
asks the reconciler "who is unblocked?" at the one moment guaranteed to precede the answer changing.
The close takes minutes and the reconciler needs thirty seconds — the doorbell essentially cannot
win. Observed on #272's merge and again on #274's (#279): every merge re-dispatched the ticket it
had just merged, withheld that ticket's successors, and the wasted run exited green, so the stalled
wave was invisible from the run list.

The ruling, in two halves:

- **Lane 08 closes the ticket, then rings `graph-changed`.** The doorbell announces a graph state;
  it fires once that state is true. If the close's latency ever genuinely matters, the fix is to
  move the close off the critical path, not to announce something false.
- **Lane 05 refuses a dispatch naming a closed ticket** — a cheap `gh issue view --json state`
  after the claim and before the brief, exiting green with the claim released. The refusal is the
  belt for every future ordering mistake of this shape, and it is loud where the wasted model run
  was silent: the run says "refused the stale dispatch" instead of "nothing to build."

A refusal, not a failure, on the lane-05 side: red there would summon Recover (ADR-0114) to rebuild
a ticket that is already done. Green-with-a-reason is the same shape as `already-claimed`.

## Consequences

The close is now on the doorbell's critical path — successors wait the minutes the ticket's own
criteria take. That cost is accepted until it is measured to matter. The state read adds one `gh`
call to every implement run. `simulateClaimRef`-based fakes answer it for free; the pinned
`readTicket` argv (`--json title,body`) is untouched — the guard reads state on its own argv
precisely because three other lanes' fakes route on that pin.
