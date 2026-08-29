# Lane 06 judges the pull request rather than trunk, and both of its jobs now bind on lane 08's merge

Recorded 2026-08-29.

Amends: ADR-0095

Two rulings, from one pull request that merged while the job meant to judge it was failing:

1. `verify.yml`'s `Restore and run acceptance` checks out the pull request under test before it
   restores `tests/acceptance/` over it. Until now it judged trunk.
2. Lane 08 binds on that job's verdict, and waits for it rather than reading it once.

## The job was judging the wrong tree

`restore-and-run-acceptance` opens with `actions/checkout@v4` carrying no `ref:`. On a
`repository_dispatch` there is no ref to infer — the event names no branch — so the checkout lands
on the default branch:

```
git checkout --progress --force -B main refs/remotes/origin/main
```

Every step after it then describes `main`. The restore-from-tip that ADR-0032 makes the whole
guarantee restores trunk's `tests/acceptance/` onto trunk's own working tree, and the vitest run
grades trunk's implementation. The pull request's diff is never present.

This is not a job that is merely wrong sometimes. It is wrong in both directions at once:

- A slice that is correctly built **fails**, because trunk does not carry the implementation yet.
  That is what happened to PR #244 — three test files red in CI, the same three green locally
  against the branch.
- A slice that is **not** built passes the moment its ticket happens to be implemented on trunk by
  any other route, because that is the only tree the job ever looks at.

The fix resolves the head branch from the payload's PR URL, which the dispatch already carries, and
checks it out before the restore. Nothing about the sender changes and a dispatch sent before this
ruling still works — the alternative, adding a branch to `client_payload`, would have made every
in-flight dispatch unjudgeable.

## The verdict now binds

ADR-0095 ruled that `Restore and run acceptance` warns and does not block, because lane 04's
first-authoring was unwired (#201): no acceptance test named any criterion a dispatch carried, the
job refused on the empty set, and it was red for every pull request in the fleet. Binding on it
would have stopped the chain rather than caught anything. That ruling named its own expiry —
*"when #201 lands and that job starts meaning something, this ruling is the thing to revisit"* —
and #201 has landed. Lane 04 authors real tests, and trunk carries them.

So a red one now means the slice's own acceptance tests do not pass against the diff, which is the
one thing this lane exists not to merge. `Immutability` already blocked; both halves of lane 06 now
do.

Note what the two rulings would have done in combination if taken one at a time. Binding on the job
*before* fixing the checkout would have refused every correctly-built pull request in the fleet,
because the job fails whenever trunk lacks the implementation — which is always, for work not yet
merged. The order is not incidental.

## Why the verdict is waited for and not merely read

ADR-0095's read happens deliberately late — after the rebase and the gauntlet — because
`Immutability` is a checkout-free string comparison that finishes in seconds, so by then it has
always concluded. `Restore and run acceptance` is a checkout, an `npm ci` and a vitest run: the same
order of minutes lane 08 spends on its own work. Which of the two finishes first is a genuine race.

A single read would settle that race by refusing whichever pull request happened to lose it, and
`unjudged` is a refusal (ADR-0054). While the job only warned, losing meant a comment; now it means
a merge that does not happen and that nothing retries. So lane 08 re-reads until the job concludes,
bounded at roughly ten minutes, and `integrate.yml`'s `timeout-minutes` goes to 30 to hold the wait.
Giving up leaves the verdict `unjudged`, which refuses — the direction whose cost is a merge that
waits rather than a merge that should not have happened.

## What this cost, once

PR #244 merged at 23:09:48 while lane 06's acceptance job was failing at 23:08:30. The merge was
correct on its facts — the branch's tests did pass, verified locally — but nothing in the pipeline
established that. Both jobs ran in parallel off the same dispatch, one judged the wrong tree, and
the other was not listening to it. The gate decided nothing.
