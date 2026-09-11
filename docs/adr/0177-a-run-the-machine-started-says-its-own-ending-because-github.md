---
status: constraint
date: 2026-09-10
reversal: Dropping the `run-ended` tail puts every bot-started lane's death back on a `workflow_run` door GitHub never opens for it, so a capped Implement run's claim waits for a push or a hand label again.
amends: ADR-0165
---

# A run the machine started says its own ending, because GitHub starts nothing from a bot-started run's completion

ADR-0165 rests on `workflow_run: completed` reaching the reconciler for every ending. It reaches
it only for endings a person set in motion. A run the machine starts by `repository_dispatch`
under `GITHUB_TOKEN` runs as `github-actions[bot]`, and GitHub's recursion guard starts no
workflow from that run's completion: every reconciler wake by `workflow_run` on 2026-09-10 had a
human actor, and no bot-started run was followed by one (#445).

So a lane that holds a claim ends by sending `run-ended` from an `always()` step, carrying the
run id and nothing else. The reconciler still reads the conclusion and the claim for itself; the
ring says only "read now". The ladder and the single connector are unchanged.

**Rejected: dispatching every lane under a personal token so its runs carry a human actor.**
One PAT in every enrolled repository, held by the jobs that spend a model, to buy back an event
one step already sends.
