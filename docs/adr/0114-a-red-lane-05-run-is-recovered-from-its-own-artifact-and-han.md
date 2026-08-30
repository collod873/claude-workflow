# A red lane 05 run is recovered from its own artifact and handed to Verify, and the third recovery of one ticket reaches the owner

Recorded 2026-08-30.

When `Implement` completes red, a lane that spends no model reads the run's `implementer-answer-<n>`
artifact, lands it on the ticket's branch, opens the pull request and dispatches `Verify` — exactly
the tail the failed run never reached. A red run with no artifact is re-dispatched as `ticket-ready`.
Either way the lane leaves one marked comment on the ticket, and at the third such comment it stops,
labels the ticket `needs-human` and assigns the owner instead.

## Why

Measured over the seven days to 2026-08-30: 22 failed runs, 7 of them `Implement`, and not one
automatic repair or retry. The fixer — the repo's only repair — listens to `Verify` alone, and a
lane 05 run that dies before its push never reaches `Verify`. Its work survives only as the artifact
[ADR-0103](0103-what-a-lane-05-run-built-is-a-question-only-git-can-answer-s.md) keeps, which until
now had exactly one reader: a person, in a session, rebuilding a branch by hand (#277). The
reconciler already re-dispatches an unstarted slice, but only on `session-captured` — so the retry
that existed waited for the owner to show up. That is
[ADR-0011](0011-a-refusal-ships-only-once-something-can-clear-it.md)'s order — feedback, repair,
refusal — with the middle rung missing.

`workflow_run` on `Implement` is the trigger, and this **extends** rather than amends
[ADR-0049](0049-the-run-watchdog-sweeps-on-session-end-because-workflow-run.md): that ruling rejects
`workflow_run` for a workflow file GitHub cannot parse, whose run carries no name to filter on. A red
`Implement` run is a named run of a parsed file, which is the case `fixer.yml` already relies on. The
event fires only when work happened, so [ADR-0004](0004-a-clock-may-release-a-batch-but-may-never-originate-work.md)
needs no exception.

The cap is [ADR-0041](0041-the-fixer-stops-when-it-stops-making-progress-with-three-att.md)'s three,
counted off the ticket's own comments rather than any new state, and it is a ceiling across every
door a ticket can take — a deterministic red that recovery cannot fix costs at most three runs and
then arrives as an assigned issue naming them, instead of as a red row in Actions nobody reads.

## Consequences

The push that lands a recovered answer bypasses the runner's pre-push gauntlet (`HUSKY=0`). That is
not a gate bypass: [ADR-0063](0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md)
counts red reaching `main`, and a recovered branch is judged by `Verify` before lane 08 can merge
it. The whole point is that the judging happens where the fixer can see it.

Three repairs landed with it, because the same week's reds showed the recovery would otherwise be
recovering into the same wall. `bin/clone-gate --prune-baseline` joins lane 05's regenerate list
(`regenerate-artifacts.ts`) — pruning cannot admit a clone, so a run that paid off a duplicate is
no longer refused for the stale receipt. The acceptance lane judges its push to `main` by
`bin/gauntlet push` before pushing (`acceptance/land-gate.ts`), since a `GITHUB_TOKEN` push fires
no `Verify`, and it may add a baseline entry for a clone lying wholly inside `tests/acceptance/` —
the one growth the ratchet permits, recorded in `docs/agents/clone-gate.md` rule 5, because nobody
else may touch those files. And the fixer, lane 08's rebase conflict and this lane escalate through
one `shared/needs-human.ts`: the `blocked` label two of them applied never existed in this repo, so
every escalation before today threw.

Recovery does not diagnose. A red whose cause is the ticket, the spec or a test is recovered, judged
red again, and reaches the owner at the cap with the evidence attached. The doors that route those
causes to their own authors are a later decision; this ruling only guarantees nothing goes cold and
nothing goes silent.
