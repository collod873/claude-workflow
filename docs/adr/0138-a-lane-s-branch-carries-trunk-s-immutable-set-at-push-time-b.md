---
status: constraint
date: 2026-09-02
reversal: Reversing it means deleting `alignImmutableSetWithTrunk`, its call in `run-ratify.ts` and its fixture test, and accepting that any `.github/` commit landing on trunk mid-run refuses the batch's push and burns the whole run — plus finding another answer for every lane that later pushes a branch the same way.
---

# A lane's branch carries trunk's immutable set at push time, because a GITHUB_TOKEN push is refused when it does not

A lane branches where it was dispatched and pushes minutes later. On a push GitHub compares the
ref's workflow files against trunk's **directly**, not against the merge base its pull request
view uses. If trunk gained a `.github/` change inside that window, the branch's older copy reads
as creating a workflow and the push is refused. No permissions block grants the `workflows` scope,
and [ADR-0053](0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md) buys no
identity that could hold one. The lane's own commits need not touch `.github/` at all:
[#324](https://github.com/collod873/claude-workflow/issues/324) died this way with eleven minutes
of model spent.

So the pushed tip carries trunk's copy of that set, fetched fresh. It cannot conflict: no batch
may edit the set, so nothing of the branch's is lost.

Rebasing onto trunk was the alternative, rejected because this lane keeps the index as scratch
and never moves `HEAD` (`commitWorkingTree`) — the one state `git rebase` refuses to run in.
