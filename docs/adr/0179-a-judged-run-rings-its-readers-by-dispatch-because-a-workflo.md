---
status: constraint
date: 2026-09-10
reversal: Putting Review and Fixer back on `workflow_run: [Verify]` returns Review to a lane that has never run and Fixer to hearing only its dispatch, with a skipped run per Verify to show for the door.
---

# A judged run rings its readers by dispatch, because a workflow_run door never opens for a run the machine started

ADR-0177 named the guard for the reconciler: a run the machine starts by `repository_dispatch`
runs as `github-actions[bot]`, and GitHub starts no workflow from its completion. Review and
Fixer listened on `workflow_run: [Verify]` for exactly those runs. The door opened only for
push-started runs, which both gates excluded: Review never ran once, Fixer heard only its
`fixer-needed` dispatch (#456).

So a judged run rings its readers itself: `verify.yml` sends `fixer-needed` when red and
`review-wanted` when green, carrying the pull request's head and the `main` commit it judged,
and both readers' `workflow_run` doors are gone: a door that cannot open reads as a live path
and costs a skipped run per Verify. The bypass counter keeps its door; it counts push-started
runs, which open it.

**Rejected: dispatching under a personal token.** Every run attributed to the owner, a PAT in
every enrolled repository, to buy an event two tail jobs already send.
