# A repository_dispatch trigger names its own event types, so an unrelated lane's dispatch cannot fill this lane's history with skipped runs

Recorded 2026-08-28.

Eight workflows in this repo fire on `repository_dispatch` and, until now, every one of them left
`types:` off. Each carried the same note for it: the filter is per-workflow rather than per-job, so
a list here has to track whatever action a sibling ever adds. That is true, and it is the wrong
thing to optimise. Unfiltered, one dispatch starts a run of *every* dispatch-triggered workflow and
all but one of them skip — a single `session-captured` from the capture hook woke Spec, To-Tickets,
Implement, Integrate and Verify, none of which has an opinion about it. So each `repository_dispatch:`
now names its own action, and the job-level `if` stays as the scope rule that holds the YAML to the
constant its sender reads.

## Consequences

The run history becomes readable, which is the whole point. `#183` measured the six acting lanes at
65 runs and zero successes and could not say which of them had ever been *asked* to do anything,
because "fired and skipped" and "never fired" produce the same row. A lane with `types:` produces a
run only when someone sent it work, so its history answers that question directly, and #188's
criteria are stated against it — "to-tickets has a successful run whose event is
`repository_dispatch`" is only a meaningful sentence once a to-tickets run implies a to-tickets
dispatch.

The cost lands where the old note said it would: `dispatch-reconcile.yml` genuinely listens for two
actions and now lists both, and a lane that grows a third door has to add it in two places. That is
what `reconcile.test.ts` holding the list to `RECONCILE_DISPATCH_ACTIONS` is for. The failure mode is
also the safe direction — a missing entry means the lane does not fire, which is visible as work not
happening, rather than firing on something it should have ignored.

`review.yml` is not dispatch-triggered and is affected anyway. It gated on
`workflow_run.event == 'repository_dispatch'` to avoid reviewing the empty range of a trunk-tip
Verify run, which made it read as a dispatch-triggered workflow to any sweep of this rule. It now
states the same condition from the other side — not the push run — which is equivalent because
`verify.yml` has exactly two doors, and `review.test.ts` asserts that premise rather than trusting
it.
