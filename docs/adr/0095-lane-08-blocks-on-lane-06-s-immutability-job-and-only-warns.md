# Lane 08 blocks on lane 06's immutability job and only warns on its acceptance job

Recorded 2026-08-28.

Status: superseded by ADR-0104

`verify.yml` and `integrate.yml` fire on the same `implementation-opened` dispatch, in parallel, and
until #197 nothing made the merge actor read the verifier's answer: run 33227183464 finished failure
while run 33227183471 merged the same pull request. The two jobs in `verify.yml` do not mean the same
thing, so lane 08 does not treat them alike. **`Immutability` blocks the merge outright** — it is the
alarm that a diff touched `tests/acceptance/`, `vitest.config.ts` or `.github/`
([ADR-0053](0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md),
[ADR-0054](0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md)), and a diff that
can silence a check has invalidated whatever lane 08's own gauntlet just said about it.
**`Restore and run acceptance` does not bind**, and lane 08 comments on the pull request instead.

## Considered options

Blocking on the acceptance job too was the obvious reading and is the wrong one *today*: lane 04's
first-authoring is unwired (#201), so no acceptance test names any criterion a dispatch carries and
that job refuses on the empty set for every pull request there is. Binding on it stops the chain
dead without catching anything. Merging over it silently was the status quo and is what #197 was
filed on — the merge was not wrong, the not-looking was. Warning on the pull request is the third
option: the red is on the record, at the artefact a person would look at, rather than in a run log
nobody reads. When #201 lands, this is the ruling to revisit.

## Consequences

Absence is a refusal, not a pass. Lane 08 merges only on an `Immutability` job that *completed*
reporting success; queued, running, skipped and cancelled all refuse, because `verify.yml` skips that
job on its `push: main` runs and waves the skip through in its own downstream `if:` — a reading that
is right for a job in the same run and wrong for a lane deciding whether to merge.

The two runs are joined by `github.sha`, which is the only fact they share that the Actions API will
answer on: a dispatch run's `pull_requests` is empty and the pull request's own head commit carries
no check runs at all, so neither `gh pr checks` nor `--json statusCheckRollup` can see lane 06 from
here. Two implementers dispatching off the same trunk tip are therefore indistinguishable, and lane
08 takes the strictest verdict among them — a crossed immutable set anywhere on that commit holds
every merge on it. The verdict is read last, immediately before the merge, so that a lane running in
parallel has had this lane's whole rebase and gauntlet to finish in.
