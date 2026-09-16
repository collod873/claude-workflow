---
status: constraint
date: 2026-09-14
supersedes: ADR-0165, ADR-0186
reversal: Restoring either shortcut means re-adding `dispatchReadySlices` and the `ready` flag it computed — the payload field, `READY` in both acceptance jobs, `deps.ready`, and to-tickets' `dispatch-requests` output with its `DISPATCH_REQUESTS_PATH` handoff and `collect-dispatch` step — and re-accepting that a slice reaches lane 04, and a ticket lane 05, only if one ring arrived at one moment.
---

# The reconciler is the only sender of acceptance-wanted and ticket-ready, so a ticket that misses a ring is picked up by the next recompute

ADR-0084 ruled readiness is recomputed, not pushed. Two senders of each ring outlived it:
to-tickets rang `acceptance-wanted` per published slice, acceptance rang `ticket-ready` for the
slice it authored. Both restate a rule the reconciler already holds, and neither can be re-read. A
ring fires at a moment; a recompute reads a state.

A lane that finishes pokes `run-ended` under `always()` and names no successor. A later lane may
not ring another lane; it may only make the reconciler read. The `ready` flag, which told
acceptance whether to ring lane 05, has no reader and is gone.

**Rejected: keeping a shortcut as a fast path beside the recompute.** Two senders of one ring are
two rules that can disagree, and the shortcut is the one nobody reads when a wave stalls.

**Accepted cost.** A minute more at each hand-off, and still no floor under the doors carrying a poke.
