---
status: constraint
date: 2026-08-26
amends: ADR-0032
reversal: Reversing it puts verification back on `pull_request`, which re-opens the hole it closed — a PR deletes the acceptance job from its own copy of the workflow and goes green in silence — and touches the dispatch senders in `implement.ts`, `fixer.ts`, `ratify/dispatch.ts` plus `verify.yml`, `review.yml` and `ratify.yml`, along with `.github/`'s place in the immutable set.
---

# An implementation PR's checks fire by repository_dispatch, so the workflow that judges it is always trunk's

Lane 05's implementer opens its PR with the built-in `GITHUB_TOKEN`, then sends a `repository_dispatch` carrying the PR number; verification fires on that dispatch, never on `pull_request`. Such a run always executes the workflow file from the default branch, so the definition judging a pull request can never be a file inside it. `.github/` joins the immutable set — the dispatch is the guarantee, the diff refusal the alarm. Restoring from trunk is a guarantee only if the instruction to restore also comes from trunk.

**Rejected:** `on: pull_request` with a second credential — it still runs the PR's own copy of the workflow; a label trigger — an event caused by the built-in token starts no run; `workflow_dispatch` — correct only while every caller passes `--ref main`.

**Accepted cost.** A dispatch can silently stop arriving, so lane 08 may not merge a pull request with no completed verification run.
