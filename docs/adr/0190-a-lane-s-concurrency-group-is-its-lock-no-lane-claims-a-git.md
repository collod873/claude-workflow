---
status: constraint
date: 2026-09-14
amends: ADR-0084
reversal: a hand-rolled lease comes back — creation timestamps, a 90-minute timeout, takeover and release — to duplicate what `concurrency` already enforces, and the branch goes back to meaning two things at once
---

# A lane's concurrency group is its lock; no lane claims a git ref

`implement/issue-N` was both the lock and the deliverable, so no reader could tell which it was
looking at. The recompute read a standing branch as "busy" and lost the ticket
([ADR-0189](0189-a-ticket-s-stage-is-read-from-its-artifacts-a-standing-branc.md)). Implement read
acceptance's own test commit as a live claim and stood down, so #570 was rung three times and
built nothing.

Every lane already carries `concurrency: <lane>-<issue>, cancel-in-progress: false`. That lock is
owned by the platform, releases when the run ends, and queues a duplicate instead of racing it.
`claim.ts` hand-rolled a worse one out of a ref, which has no owner and no expiry — hence the
timestamps, the timeout, the takeover, the release. It is deleted, and knip keeps it deleted. No
lane may delete a branch it did not finish: that branch carries the acceptance test.

**Rejected: teaching `assessClaim` to recognise acceptance's commits.** A third proxy for the
question two already answered wrongly.
