---
status: constraint
date: 2026-08-30
amends: ADR-0094
reversal: Putting the doorbell back before the close means reordering lane 08's merge tail, deleting lane 05's post-claim state read and the fakes that answer it, and accepting again that every merge re-dispatches the ticket it just merged, withholds that ticket's successors and exits green, so the stalled wave is invisible in the run list.
---

# The doorbell rings after the close it announces, and a lane handed a closed ticket refuses it

Lane 08 closes the ticket, then rings `graph-changed`. A doorbell announces a graph state and fires once that state is true: readiness is *defined* as every blocker closed, so ringing first asks the reconciler who is unblocked at the one moment guaranteed to precede the answer changing. Every merge re-dispatched the ticket it had just merged, withheld its successors, and exited green — the stalled wave was invisible.

Lane 05 also refuses a dispatch naming a closed ticket: one `gh issue view --json state` after the claim, exiting green with the claim released. Green, not red — red would summon Recover to rebuild a finished ticket — and loud where the wasted run was silent.

**Rejected:** ringing before the close so successors need not wait on the ticket's own `check:` commands (ADR-0094). If that latency matters, move the close off the critical path rather than announce something false.
