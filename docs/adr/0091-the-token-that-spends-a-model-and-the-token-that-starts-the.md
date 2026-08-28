# The token that spends a model and the token that starts the next lane are separate, so a lane needing both is two jobs

Recorded 2026-08-28.

`POST /repos/{owner}/{repo}/dispatches` needs the Contents **write** permission, and a
`permissions:` block replaces the default token rather than adding to it. Lane 02 and lane 03 each
declared `contents: read` — correctly, because each runs a model and
[ADR-0053](0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md) is careful about
what such a job may write — and then ended by sending a `repository_dispatch`. Both hand-offs of
the intended run 403'd, each after reporting a successful publish, because the dispatch is the last
thing either does ([#181](https://github.com/collod873/claude-workflow/issues/181)). The fix is not
a wider token. `permissions:` is per **job**, so a lane that needs to spend a model *and* start the
next lane is two jobs: the model job keeps `contents: read`, and a second job with `contents: write`
and no model in it carries out what the first one decided.

## Consequences

What a model job decides has to survive a job boundary, because the two run on different machines.
`shared/dispatch-request.ts` is that seam for a dispatch: a sender says what it wants sent, and
whether that is posted now or written to `DISPATCH_REQUESTS_PATH` as one JSON body per line is a
fact about the venue, set by the workflow, never by the caller. `dispatch/reconcile.ts`,
`shape-accept.yml` and `integrate.yml` already hold write tokens and send now, unchanged.

Lane 04 is the same rule about a push rather than a dispatch, and it needs more than a line of
JSON. `acceptance/push-gate.ts` gains a `Landing`: at `"commit"` it stops after the commit, and
`acceptance.yml` carries the commits over as a `git format-patch` series that a `contents: write`
job replays with `git am --3way`. The gate still decides what may land — the split moves who lands
it. One behaviour does change: a multi-slice re-fire is now all-or-nothing, because a slice the gate
refuses throws while the earlier slices' commits are still unpushed, where before each had already
gone to `main` on its own.

Ordering guarantees stated in terms of *this lane wrote X before it dispatched* survive intact,
because both still happen in the model job — `applyGate` writes `sliceable` before it asks for a
dispatch, so [ADR-0062](0062-the-prd-label-fires-the-critic-and-a-zero-open-question-coun.md)'s
durable trace for a lost dispatch is exactly what it was. What changes is that the trace can now
also be left by the dispatch job failing, which is a case `lost-dispatch-counter.yml` already
covers and did not previously have a way to see.
