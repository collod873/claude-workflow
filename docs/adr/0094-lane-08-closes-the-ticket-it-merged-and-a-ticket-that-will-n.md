---
status: constraint
date: 2026-08-28
reversal: Letting a refused close redden lane 08 reports a landed merge as failed and invites the next dispatch to merge it again, and moving the close into a workflow step means re-deriving the ticket and commit range `integrate.ts` already holds.
---

# Lane 08 closes the ticket it merged, and a ticket that will not close never reddens the merge

After merging, lane 08 runs `bin/close-ticket` for the ticket the pull request body names on its
`Ticket: #N` line, then rings `graph-changed` ([ADR-0115](0115-the-doorbell-rings-after-the-close-it-announces-and-a-lane-h.md)). A refused close leaves the ticket open with a
comment naming the merge and what `close-ticket` reported, and leaves the lane green.

Without it the chain could open, build and merge a ticket but not finish one, and the tracker showed
shipped work as unstarted. The close runs after `gh pr merge` has put the commit on trunk, and no
verdict about a criterion can take that back.

Cause is not modelled. A failed criterion, a ticket with nothing checkable and a script that could
not run all end the same way: the ticket open, and saying so on the ticket.

**Rejected: a red lane on a refused close.** It says the merge failed, and the next dispatch tries to
merge it again.
