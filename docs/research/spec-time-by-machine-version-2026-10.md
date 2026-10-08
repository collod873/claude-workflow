# Where a Lumaria Spec's time and Actions minutes go, by Machine version

Researches: [#1232](https://github.com/collod873/claude-workflow/issues/1232)

Child of [#1226](https://github.com/collod873/claude-workflow/issues/1226). Recorded 2026-10-08,
data pulled at 18:40Z. Facts, no rulings.

Sources: every Lumaria Actions run created 2026-10-05 12:53Z to 2026-10-08 18:33Z (983 runs, 9,763
jobs, from the runs and jobs APIs), the `referenced_workflows` SHA each run used, the filtered log of
every `CI` run, the builder transcripts each stage uploads (`machine-logs/fix-<n>.jsonl`, 66 runs),
the timelines of the Spec [Lumaria#902](https://github.com/collod873/Lumaria/issues/902), its 31
tickets and their PRs, GitHub's billing usage API, and the git history of claude-workflow and of
agent-hooks' `live` branch (the one the Machine clones). Lumaria is private: tickets are linked and
named by number, its code is never quoted. Times are UTC.

Already covered, not repeated here: how a Wave ends and its tail waits
([waves-today-2026-10.md](waves-today-2026-10.md)); how fixes crossed the three repos
([cross-repo-fixes-2026-10.md](cross-repo-fixes-2026-10.md)).

## Summary

- **One Spec ran in the window, and no Spec has run on today's Machine.** Lumaria#902 ran Waves 1
  to 10 from 2026-10-06 12:57 to 2026-10-07 15:05 and has been paused since 14:55. The newest
  segment (S4) is Wave 10 alone: 4 tickets, 61 minutes.
- **Since S2, waiting costs more wall time than checking.** In S1, checks were half the Spec's
  wall time: the Builder's, the Machine's, PR CI, main CI and the wave check. From S2 on they are 16
  to 21 %. Owner pauses, tickets held on a label and a PR with nothing running take 64 to 69 %.
- **The same tree is now fully executed once.** Since receipts count in CI (S2 onward), the
  Builder's own `check --full` is the only full run of a merged tree. The Machine's
  `--publish` check, PR CI and main CI then re-check it from receipts in seconds. A new tree, from a
  closer branch update, is what runs uncovered again.
- **About a third of the newest segment's minutes go to jobs that do almost nothing.** GitHub
  bills each job rounded up to the minute, and 78 of S4's 88 Machine jobs ran under 60 s.
  Bookkeeping jobs and builder stand-downs billed 77 of S4's 222 minutes for about 19 minutes of
  runtime.
- **The runner is 2 cores**, read from a run log. The full Check starts every step at once on it,
  so its steps add up to 2.7 to 4.6 times the check's wall time.
- **Since 2026-10-08 17:59 Lumaria's jobs, the Machine's included, run on the owner's PC.** That
  contradicts the standing rule in the map's Notes.

## Segments

Each Machine run's commit is the `referenced_workflows` SHA GitHub recorded for it. The caller file
uses `@main`, so the boundaries are main merges. agent-hooks is cloned from `live` at job start.
The segments split at the changes that move what is measured here: where checks run and what they
cover.

| Segment | Machine commits the runs used | agent-hooks `live` | Lumaria changes that move time | Waves | Window |
| --- | --- | --- | --- | --- | --- |
| S4 (newest) | `4a514b5d` ([#1221](https://github.com/collod873/claude-workflow/pull/1221), stages in the foreground), `83e1546e` | `d59c411` | none | 10 | 10-07 13:41 to 15:30 |
| S3 | `944b259d` (the builder's check runs integration against its own Postgres), `18f127d7`, `0abe2285`, `032905a8` | `6f83666` (a receipt per test file), `c4d5304` | CI build and typecheck caches ([Lumaria#943](https://github.com/collod873/Lumaria/pull/943), [#946](https://github.com/collod873/Lumaria/pull/946)), per-test receipts ([#944](https://github.com/collod873/Lumaria/pull/944)) | 6 to 9 | 10-07 01:34 to 13:41 |
| S2 | `3e085112` (the test step reads the hooks settings), `47093fb2`, `4bc36df0`, `3b5b4c5c`, `2e00a066`, `0cc99b94`, `05f284f9`, `1cc5b52c`, `c68fef17`, `be7cb380`, `596d4fcf` | `b20657a` (a repo's check can fail in CI, and the builder's receipts count there), `f8f4af8`, `97efa3b` | the required check can go red ([Lumaria#923](https://github.com/collod873/Lumaria/pull/923)) | 3 to 5 | 10-06 17:45 to 10-07 01:34 |
| S1 | `873afa7a`, `4193dac7` | `9d4adec` | none | first slice, 1, 2 | 10-06 12:57 to 17:45 |
| after | `69906c87`, `75d4b198`, `412a7b2c`, `a789662b`, `a8013207` | `9f5ff67` (the watchdog watches builders' test runs), `02798db`, `3cb32d6`, `77571f3` | test audit: 118 test files and more dropped ([#986](https://github.com/collod873/Lumaria/pull/986), [#988](https://github.com/collod873/Lumaria/pull/988), [#989](https://github.com/collod873/Lumaria/pull/989)); PC runner (claude-workflow `40584328`) | none | 10-07 15:30 to now |

Wave 2's wave check and slice ran on `3e085112`, and Wave 5's on `944b259d`. Each Wave is counted
in the segment its tickets built under.

## Method

**Wall time** is split by following the critical ticket: in each Wave, the ticket that closed last.
At every second from the Wave note to that ticket's close, its state is read in this order: a
builder job of it running (split by its transcript), its `waiting` label, a `CI` run on its branch
running or queued, then its `building`, `resolving`, `landing`, `queued` or `checking` label. From
its close to the next Wave note, the time goes to the wave check step, the Slicer step, the Spec
being paused, or main CI. Anything left is idle. A builder job is split from its transcript:
`check --full` calls are the Builder's full Check; vitest, tsc, eslint and similar calls are checks
by hand; other tool calls are other tools; the rest of a session is thinking. Time before the first
session is setup. Time outside sessions after it is the Machine's own `check --full --publish`, its
commit, push and log upload.

**Actions minutes** are each hosted job's duration, rounded up to the minute. Summed per UTC day
for 10-05 to 10-08, that gives 3,085 minutes against the billing API's 3,070 for Lumaria.
Self-hosted jobs bill nothing and are listed apart.

## S4 (newest): Wave 10, 4 tickets, under `4a514b5d` and `83e1546e`

Wall time, 61 min, critical ticket [#973](https://github.com/collod873/Lumaria/issues/973):

| Where | min | % |
| --- | --- | --- |
| Ticket waiting: split into #976 (30 min), then on Machine fault [#1223](https://github.com/collod873/claude-workflow/issues/1223) (9 min) | 39 | 64 |
| Builder thinking and other tools | 6.5 | 11 |
| Builder job setup | 4.3 | 7 |
| Builder's full Check | 4.2 | 7 |
| Checks the Builder runs by hand | 3.0 | 5 |
| Machine's check, commit, push | 1.4 | 2 |
| PR CI | 1.1 | 2 |
| Idle and branch update | 1.6 | 3 |
| Wave check, Slicer | 0 | 0 (the Spec was paused before Wave 11 was sliced) |

Actions minutes, 222 billed, all hosted:

| Where | min | % |
| --- | --- | --- |
| Builder jobs, Spec tickets | 105 | 47 |
| Machine bookkeeping jobs (close, strip, ended, asked, which, save) | 50 | 23 |
| Builder stand-downs (a build job that exits in under 2 min) | 27 | 12 |
| PR CI | 17 | 8 |
| Wave check + Slicer (the Wave 10 slice) | 9 | 4 |
| main CI | 7 | 3 |
| CI caches | 7 | 3 |

## S3: Waves 6 to 9, 9 Spec tickets, under `944b259d` to `032905a8`

Wall time, 650 min (10 h 50 min):

| Where | min | % |
| --- | --- | --- |
| Ticket waiting: [#961](https://github.com/collod873/Lumaria/issues/961) on the owner | 349 | 54 |
| Idle: [#968](https://github.com/collod873/Lumaria/issues/968)'s PR open with no CI (88 min), [#947](https://github.com/collod873/Lumaria/issues/947) between runs | 97 | 15 |
| Builder's full Check | 48 | 7 |
| Builder thinking and other tools | 44 | 7 |
| Wave check | 26 | 4 |
| PR CI | 25 | 4 |
| Slicer | 21 | 3 |
| Checks the Builder runs by hand | 15 | 2 |
| Builder job setup | 11 | 2 |
| Merge queue, branch updates | 8 | 1 |
| Machine's check, commit, push | 5 | 1 |
| main CI | 1 | 0 |

Actions minutes, 760 billed:

| Where | min | % |
| --- | --- | --- |
| Builder jobs, Spec tickets | 251 | 33 |
| Machine bookkeeping jobs | 139 | 18 |
| Wave check + Slicer | 68 | 9 |
| Builder stand-downs | 59 | 8 |
| PR CI, Spec tickets | 41 | 5 |
| main CI | 21 | 3 |
| CI caches | 18 | 2 |
| Not the Spec: check tickets #942 to #953 (builders 86, PR CI 11), Dependabot 42, owner branches 24 | 163 | 21 |

## S2: Waves 3 to 5, 8 Spec tickets, under `3e085112` to `be7cb380`

Wall time, 550 min (9 h 10 min):

| Where | min | % |
| --- | --- | --- |
| Owner hold, Spec paused (18:42 to 21:51, 00:40 to 02:51) | 307 | 56 |
| Ticket waiting: [#931](https://github.com/collod873/Lumaria/issues/931) on Machine fault [#1190](https://github.com/collod873/claude-workflow/issues/1190) | 61 | 11 |
| Builder thinking and other tools | 39 | 7 |
| Builder's full Check | 35 | 6 |
| PR CI | 32 | 6 |
| Wave check | 31 | 6 |
| Slicer | 15 | 3 |
| Checks the Builder runs by hand | 13 | 2 |
| Merge queue, branch updates | 6 | 1 |
| Builder job setup | 5 | 1 |
| Machine's check, commit, push, and idle | 4 | 1 |

Actions minutes, 562 billed:

| Where | min | % |
| --- | --- | --- |
| Builder jobs, Spec tickets | 190 | 34 |
| Machine bookkeeping jobs | 92 | 16 |
| PR CI, Spec tickets | 74 | 13 |
| Wave check + Slicer | 43 | 8 |
| Builder stand-downs | 39 | 7 |
| main CI | 10 | 2 |
| Not the Spec: Dependabot 72, owner branches 27, other tickets 15 | 114 | 20 |

## S1 (oldest): first slice, Waves 1 and 2, 10 Spec tickets, under `873afa7a` and `4193dac7`

Wall time, 307 min (5 h 07 min):

| Where | min | % |
| --- | --- | --- |
| PR CI | 70 | 23 |
| Merge queue, branch updates | 53 | 17 |
| Machine's check, commit, push | 34 | 11 |
| Builder thinking and other tools | 32 | 10 |
| Slicer (first slice 10 min, Wave 2 slice 11, Wave 3 slice 8) | 30 | 10 |
| Owner hold, Spec paused (17:14 to 17:48) | 25 | 8 |
| Checks the Builder runs by hand | 20 | 7 |
| Builder's full Check | 15 | 5 |
| Wave check | 14 | 5 |
| Builder job setup | 8 | 3 |
| Idle | 5 | 2 |

Actions minutes, 1,197 billed:

| Where | min | % |
| --- | --- | --- |
| Builder jobs, Spec tickets | 332 | 28 |
| Machine bookkeeping jobs | 270 | 23 |
| PR CI, Spec tickets | 264 | 22 |
| Builder stand-downs | 66 | 6 |
| Wave check + Slicer | 34 | 3 |
| main CI | 23 | 2 |
| Not the Spec: Dependabot 193, owner branches 15 | 208 | 17 |

## Across segments

Builder jobs alone, every Spec builder job counted, not only the critical ticket's:

| Per merged ticket, min | S1 | S2 | S3 | S4 |
| --- | --- | --- | --- | --- |
| Builder thinking and other tools | 9.5 | 9.1 | 9.9 | 8.1 |
| Builder's full Check | 9.2 | 8.8 | 9.3 | 6.7 |
| Checks the Builder runs by hand | 5.2 | 3.5 | 4.6 | 3.5 |
| Machine's check, commit, push | 6.4 | 0.6 | 2.0 | 2.0 |
| Job setup | 2.0 | 1.5 | 2.2 | 3.1 |
| Total builder job | 32.3 | 23.4 | 28.1 | 23.4 |
| Hand-run check commands | 26.8 | 25.8 | 36.2 | 19.5 |
| Spec-attributable Actions minutes | 99 | 56 | 66 | 56 |

The Builder's full Check took a median 8.4 min per run in S1 and S2, and 3.6 min in S3 and 4.7 min
in S4, after the CI caches and per-test receipts. The minutes row counts everything in the window
except the not-the-Spec rows, so it includes a few bookkeeping jobs for other events.

**The one-minute floor.** Machine jobs that ran under 60 s: S1 335 of 355, S2 134 of 147, S3 200 of
223, S4 78 of 88. Bookkeeping jobs and stand-downs together billed 336 minutes for about 76 minutes
of runtime in S1, and 77 for about 19 in S4.

**Dependabot is not the Machine but follows it.** Its grouped npm update ran seven times back to
back from 10-06 14:30 to 18:15, 25 to 40 min each, while Wave 1 and 2 merges moved main (307 billed
minutes over the window, 193 of them in S1).

## How many times the same tree is fully checked

"Executed" means the steps ran. "From receipts" means `~/bin/check` found a receipt for every step
and ran nothing. Counts are per merged Spec ticket.

| | S1 | S2 | S3 | S4 |
| --- | --- | --- | --- | --- |
| Builder's `check --full` runs (none followed by an edit in its session) | 1.2, executed | 1.1, executed | 2.3, executed | 1.5, executed |
| Machine's `check --full --publish` rounds | 1.8, 6.4 min | 1.4, 0.6 min | 2.4, 2.0 min | 2.0, 2.0 min |
| PR CI runs | 2.3, all executed in full, about 12 min each, all red on a step outside the ticket and passed anyway, since the required check could not go red | 1.5: the first reruns integration only (75 to 129 s, the builder's runner had no Postgres), a run after a branch update executes 7 of 8 steps (9 to 11.6 min) | 1.6: 1.0 from receipts, 0.44 executed after a branch update (2.5 to 5.7 min) | 1.5, all from receipts (9 to 11 s) |
| main CI on the merge commit | 1, partly from receipts (under 1 min) | 1, from receipts | 1, from receipts | 1, from receipts (about 5 s) |
| **Full executions of the merged tree** | **2 or more** (Builder, then every PR CI run) | **1, plus integration a second time** | **1** | **1** |

Each Builder's last `check --full` ran with no edit after it. So the Machine's `--publish` check,
the first PR CI run and main CI all see the tree the Builder just checked. Since S2 they find
receipts for it. Even so, PR CI and main CI each bill 1 to 2 minutes for a job that runs no
step. The closer merges
only a PR that is up to date with main. A PR behind main gets a branch update, which makes a new
tree, and that tree runs uncovered in PR CI. That is the one repeated full execution left.

## The runner, and what the full Check's schedule costs on it

- **GitHub-hosted, through 10-08 17:56.** Every job ran on `ubuntu-latest` in the "GitHub Actions"
  runner group. Probe run [37682579395](https://github.com/collod873/Lumaria/actions/runs/37682579395)
  printed `cores=2` (`nproc`, 2026-10-07 20:36). No run log prints memory. GitHub documents this
  runner for private repos as 2 CPU, 8 GB RAM and 14 GB SSD
  ([GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)).
- **The full Check starts every step at once on those 2 cores.** In uncovered runs before the caches
  (S2), 1,535 to 1,975 s of step time ran in 552 to 696 s of wall, with test the longest step at 547
  to 692 s. After the caches (S3), 851 to 1,550 s of step time ran in 219 to 339 s. On 10-07 20:15,
  the last uncovered hosted run, 589 s ran in 222 s. Integration run alone (the other 7 steps from
  receipts) took 75 to 123 s in S2. Inside a full run in the same hours it took 172 to 235 s.
- **The fast check cannot finish on them.** The same probe replayed Wave 10's 17 commits. The fast
  check overran its 8 s budget and was killed on every commit that touched code.
- **Since the test audit, no hosted run has executed the whole Check uncovered.** The 10-08 hosted
  runs executed integration only (118 to 128 s) or nothing. Today's full cost on 2 cores is
  therefore unmeasured.
- **The PC runner, since 2026-10-08.** claude-workflow `40584328` (landed in PR #1259, 18:02) runs an
  enrolled private repo's jobs on `pc`-labelled self-hosted runners when its `CI_RUNNER` variable is
  `pc`. Lumaria's `CI_RUNNER` is `pc` (last set 18:10:22). The first PC job was a dispatched CI on
  main at 17:59:28 ([37820806820](https://github.com/collod873/Lumaria/actions/runs/37820806820)).
  The first Machine job there was `tickets / close` at 18:10:42 (run 37822253179). By 18:37 the PC
  had run 19 jobs: 9 CI `check`, 5 `close`, 4 `which` and 1 `dispatch-rerun`. No Spec ticket has
  built there yet, and none of its checks executed uncovered. The runners are six processes,
  `desktop-7vv7k71-1` to `-6`, in WSL2 on the owner's PC (AMD Ryzen 9 9950X3D; WSL sees 32 logical
  CPUs and 23 GiB). They bill no minutes. The map's Notes say the Machine runs on GitHub Actions so
  his PC never runs it.

## Every stall

A stall here is a Spec ticket, or the Spec, held 5 minutes or more with nothing of its own running.
Waves doc rows are cited, not re-derived.

| When | Seg | What held | Cause | Event that was missing, or that moved it |
| --- | --- | --- | --- | --- |
| 10-06 13:41 to 14:46 | S1 | Wave 1 PRs [#906](https://github.com/collod873/Lumaria/issues/906) (28 min), [#908](https://github.com/collod873/Lumaria/issues/908) (18), [#905](https://github.com/collod873/Lumaria/issues/905) (7), [#904](https://github.com/collod873/Lumaria/issues/904) (10 + 17) in the merge queue and branch updates | Six green PRs at once. The closer merges one up-to-date PR at a time, and each branch update re-ran the full Check in PR CI (about 12 min) because receipts did not count there yet | None missing; receipts counting in CI (`b20657a`, S2) shortened it |
| 10-06 17:14 to 17:48 | S1 | The Spec | Owner paused it "while the machine's conflict and check-time costs are fixed" | The owner taking the label off |
| 10-06 18:42 to 21:51 | S2 | Wave 3 to 4 transition, 3 h 09 min | Owner pause | The owner taking `paused` off |
| 10-06 22:09 to 23:10 | S2 | [#931](https://github.com/collod873/Lumaria/issues/931), the whole of Wave 4 | Its builder rewrote it and filed Machine fault [#1190](https://github.com/collod873/claude-workflow/issues/1190), labelled `waiting` | #1190 closed 22:49. Nothing tells Lumaria a fault merged, so it waited until the owner took `waiting` off 21 min later |
| 10-07 00:40 to 02:51 | S2 | Wave 5 to 6 transition, 2 h 11 min | Owner pause | The owner taking `paused` off |
| 10-07 03:28 to 11:47 | S3 | [#949](https://github.com/collod873/Lumaria/issues/949) and its follow-up [#953](https://github.com/collod873/Lumaria/issues/953), not under the Spec | #953 waited on an agent-hooks fix first filed in claude-workflow (cross-repo fix 9) | The agent-hooks fix (`c4d5304`, 11:27) had no event that reached Lumaria. The owner took `waiting` off #953 at 11:34, and #949 woke when it closed |
| 10-07 05:37 to 11:25 | S3 | [#961](https://github.com/collod873/Lumaria/issues/961), and through it Wave 9 (waves doc, Wave 8) | Builder rewrote the ticket, `waiting` on the owner overnight | An owner ruling; only the @mention comment asked for it |
| 10-07 12:20 to 13:47 | S3 | [#968](https://github.com/collod873/Lumaria/issues/968), and through it Wave 10, 1 h 27 min | Its PR opened at 12:19 in conflict with main: [#969](https://github.com/collod873/Lumaria/issues/969)'s merge at 12:18 touched the same doc file. GitHub runs no `pull_request` workflow on a conflicting PR ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)), so no CI run was ever created. The builder's log says its "PR checks run again"; the merge-tree check from [#1212](https://github.com/collod873/claude-workflow/pull/1212) (in `032905a8`, the commit this build ran) handed nothing back | A CI run, or a hand-back on conflict. It moved when an owner session dispatched the Machine at 13:47 (cross-repo fix 10). The resumed builder merged main, and CI went green at 13:57 |
| 10-07 14:07 to 14:36 | S4 | [#973](https://github.com/collod873/Lumaria/issues/973) | Split. It waits for its piece [#976](https://github.com/collod873/Lumaria/issues/976) | #976 merging, which woke it as designed |
| 10-07 14:40 to 14:49 | S4 | #973 | Waiting on Machine fault [#1223](https://github.com/collod873/claude-workflow/issues/1223) | It was woken at 14:49 by an unrelated merge, before #1223 merged at 16:28. That is the hole the waves doc records, since fixed by [#1241](https://github.com/collod873/claude-workflow/pull/1241) |
| 10-07 14:55 to now | after | The Spec | Owner paused it after GitHub's 90 % minutes email (cross-repo doc, item 7) | The owner taking `paused` off |

## Open

- No Spec has run since `89e87f98`, the change to the Slicer's asks, or on the test-audited Lumaria
  or the PC runner. Every number above predates them. The newest segment is one Wave.
- The Spec's tickets run in parallel, so following the critical ticket is one view of wall time.
  Summing all builder jobs is the other (the cross-segment table).
- Why #1212's merge-tree check missed #968's conflict is not pinned. The build job's log shows no
  conflict hand-back.
