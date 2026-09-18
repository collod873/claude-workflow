# Where the acceptance lane's wall clock goes

Research for [#568](https://github.com/collod873/claude-workflow/issues/568)'s probe run and the
three runner probes that followed it. Captured 2026-09-14.

**Question.** A human applies `to-build`; the implementer starts 4m40s later. The model is 6.6s of
that. Where is the rest, and which of it is buying something?

## The baseline, end to end

Probe ticket #568, acceptance run
[34850197997](https://github.com/collod873/claude-workflow/actions/runs/34850197997), green.
`to-build` at 13:34:51 → `ticket-ready` rung at 13:39:31.

| Segment | Cost | Note |
|---|---|---|
| `to-build` label → acceptance run created | 48s | reconcile wakes on `issue labeled`, then dispatches `acceptance-wanted`; three concurrent reconcile runs were cancelled first |
| job setup: 2 checkouts, `npm ci` ×2, install Claude Code | 18s | implement pays this again |
| `acceptance.ts` start → `· session started` | 5.7s | |
| author model session | **6.6s**, 2 turns, **$0.1678** | `claude-sonnet-5` |
| `· done in 6.6s` → `pushed`, no output at all | **3m07s** | |
| post-job + "Wake the reconciler in 3s" | ~11s | |

Whole run 3m52s, $0.17. Against the never-measured projection of 2–3 min / sub-$1: money beat it
6×, wall clock missed by a minute. **The model is 3% of the run.**

## Splitting the 3m07s

The silent segment is `judgeAuthoredBatch` (the authored batch under vitest, then the stop venue
per authored path) followed by `commitAuthoredBatch`. Reading alone could not separate them:
reproducing #568's batch on a 32-core workstation, one `bin/gauntlet stop` was 2.6s, and two of
those cannot be 3m07s.

So the segments were re-run on a hosted runner, in the acceptance job's own shape - machine
checkout, `target/` checkout, both dependency installs - by a throwaway `push`-triggered workflow
on a branch, no model and no ticket. Runs
[34861283016](https://github.com/collod873/claude-workflow/actions/runs/34861283016),
[34861514916](https://github.com/collod873/claude-workflow/actions/runs/34861514916),
[34862461031](https://github.com/collod873/claude-workflow/actions/runs/34862461031).
`ubuntu-latest`, `availableParallelism` **4**, so `vitest.config.ts`'s
`floor(availableParallelism() / 2)` gives the suite **2 workers**.

| Phase | On the runner |
|---|---|
| the authored batch under vitest (`runVitestJson`) | 1–2s |
| stop venue, first authored path | 6–8s |
| stop venue, second authored path | 2–5s |
| **`npm run check`, the push venue** | **122s, 149s, 169s** |

The two-file loop in `turnVenueVerdict` is ~11s of the 187s. It re-runs an identical whole-tree
check per path, because the `stop` venue recomputes its own file list from `git status` and ignores
the path it is handed (`bin/gauntlet:37-42`); worth deduplicating, worth nothing in wall clock.

**The push venue is the segment**, and nothing in the lane asks for it. `npm ci` runs `prepare`,
which installs husky and sets `core.hooksPath` in the CI checkout - confirmed on the runner as
`…/target/.git/../.husky/_` - so `commitAuthoredBatch`'s `git push` fires `.husky/pre-push`, which
runs `npm run check`. Its output is discarded; a red one surfaces only as "pushing failed".

## What the push venue spends it on

Slots run concurrently, so the venue's wall clock is its slowest slot's. Timed one at a time on the
same runner:

| Slot | Cost |
|---|---|
| `typecheck` | 1s |
| `lint` | 5s |
| **`test`** | **95s** |
| `clones` | 4s |
| `adrs` | 0s |

`test` is the venue. 196 test files, 161.7s of test CPU across 2 workers. The other four slots
together are 10s.

## What that buys

The same branch is re-gated in full by the implementer before any pull request opens
([ADR-0157](../adr/0157-the-implementer-s-checkout-is-its-answer-and-the-push-gate-r.md): the wire
runs `bin/gauntlet push` on the target checkout, then pushes `--no-verify`). So the acceptance
push's 150s re-certifies a machine that `main` already certified, to vet one or two new test files
that the batch run and the stop venue have already collected, typechecked, linted and run.

That is the same duplication ADR-0157 measured on the implement lane at "95 seconds each", from the
same cause: husky running the gate again on push.

## Left on the table

- **`vitest.config.ts` halves worker count**: 16 on a 32-core workstation, 2 on a 4-core runner,
  which is why the suite is 95s there. The halving is deliberate - the orphaned comment above the
  config blames oversubscription for manufacturing Lumaria's `booking-embed-panel` and
  `eslint-boundaries` failures - and
  [verification-boundaries-2026-08](verification-boundaries-2026-08.md) records why a flaky gate is
  worse than a slow one. Unmeasured on CI.
- **48s from label to dispatch**, including three cancelled reconcile runs: `dispatch-reconcile`
  holds one concurrency group with `cancel-in-progress: false`, and GitHub keeps only one pending
  run per group, so an event burst cancels its own predecessors. The survivor still pays a cold
  job start.
- **18s of job setup paid twice**, once by acceptance and again by implement.
- Lane budgets (`acceptance: 24` min, `implement: 80` min) are nowhere near binding at these
  numbers.
