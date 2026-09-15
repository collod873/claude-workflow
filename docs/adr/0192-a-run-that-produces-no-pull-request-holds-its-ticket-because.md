---
status: constraint
date: 2026-09-14
reversal: a lane run that produces nothing goes back to exiting silently, and the recompute rings the same ticket on every pass with nothing to stop it but a human noticing
---

# A run that produces no pull request holds its ticket, because only a failure reaches the strike ladder

A lane run that answers and changes nothing used to comment and exit 0. Nothing about the tracker
changed, so the recompute read the same standing `accept/issue-N` with no pull request, called the
stage `needs-build` under [ADR-0189](0189-a-ticket-s-stage-is-read-from-its-artifacts-a-standing-branc.md),
and rang the lane again. The strike ladder cannot bound this: it counts runs that *failed*, and
these succeed. #570 burned three Implement runs this way and stopped only when a human applied
`needs-human` by hand.

So an outcome that returns no pull request must leave the ticket somewhere the recompute will not
read as dispatchable: `needs-human`, or a non-zero exit the ladder can count. Silence is the one
thing it may not do.

**Rejected: counting a no-op run as a strike.** A strike means the run died; a ticket that is
already true would then climb a ladder to a decision nobody needs.
