---
status: constraint
date: 2026-09-14
reversal: the recompute goes back to reading a lane's output on main, where no lane writes it, and every ticket that finishes a lane goes invisible to the dispatcher at the next door
---

# A ticket's stage is read from its artifacts; a standing branch is not a claim

[ADR-0084](0084-readiness-is-recomputed-rather-than-pushed-so-a-merge-announ.md) made the branch ref the claim, so a duplicate
dispatch was free. It also made a finished lane indistinguishable from a working one: acceptance
pushes its test to `implement/issue-N` and the ticket reads as somebody's work forever. Under
[ADR-0188](0188-the-reconciler-is-the-only-sender-of-acceptance-wanted-and-t.md), which left the
recompute as the only sender, that stalls every ticket at acceptance. The strike ladder does not
catch it, because the run succeeded.

A live run is the claim. Position is read from what a lane must produce to have succeeded — a
branch carrying commits, an open pull request — never from a label, a ring, or a run's own report.
Each later door is a row, not new logic.

**Rejected: restoring acceptance's direct ring to implement.** It re-creates the shortcut ADR-0188
outlawed, and leaves the same blind spot at verify and integrate.
