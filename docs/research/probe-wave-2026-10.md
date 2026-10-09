# One Wave of Lumaria#902 on today's Machine

Researches: [#1267](https://github.com/collod873/claude-workflow/issues/1267)

Child of [#1226](https://github.com/collod873/claude-workflow/issues/1226). Recorded 2026-10-09,
data pulled at 00:32Z. Facts, no rulings. Measured the way
[spec-time-by-machine-version-2026-10.md](spec-time-by-machine-version-2026-10.md) measured S1 to
S4, so its tables line up with theirs.

Sources: every Lumaria Actions run created from the resume (2026-10-08 23:11:41Z) to 00:32Z (80
runs, their jobs and every attempt of the one red run, from the runs and jobs APIs), the
`referenced_workflows` SHA each run used, the job logs of every builder, closer, Slicer and `CI`
job, the builder transcripts and hook logs each stage uploads (`machine-logs`), the timelines of
the Spec [Lumaria#902](https://github.com/collod873/Lumaria/issues/902), its three Wave 11 tickets
and their PRs, and the git history of claude-workflow and of agent-hooks' `live` branch. Lumaria is
private: tickets are linked by number and described by role, its code is never quoted. Times are
UTC.

## Summary

- **Wave 11 took 70 min from its note to its last close, and 44 of them were stalls.** The Slicer
  filed three tickets in 5.7 min. All three were built and green by 23:35, 18 min after the Wave
  note. Two Machine faults then held the Wave, with an owner pause inside the first, until its
  last close at 00:27. Without them it would have ended at about 23:40.
- **The PC runner's `gh` stalled the Wave.** Lumaria's jobs ran on the PC, whose `/usr/bin/gh`
  was Ubuntu's 2.46. It has no `gh pr update-branch` and no `gh pr checks --json`. So the closer
  could neither close a merged ticket nor bring a green PR up to date. Hosted runners carry a
  current `gh`. Fixed by hand at about 00:15 and in the Machine by `cc8f36d5`.
- **A merged ticket whose closer run failed is closed by nothing.** Taking `stuck` off it runs
  Resume, which finds the PR merged and stands down. Only a re-run of the failed closer run closed
  it. Filed as [#1276](https://github.com/collod873/claude-workflow/issues/1276).
- **A stage failure does reach its run's result, when the closer exits red.** The closer's red
  exit turned run [37859063869](https://github.com/collod873/Lumaria/actions/runs/37859063869) red.
  Rerun by dispatch re-ran it once, and the second red marked #1011 `stuck`. That is the first
  `stuck` on a Lumaria ticket. The closer's failed branch updates, by contrast, were logged as
  "will be tried again" in green jobs, and nothing tried again.
- **On the PC the full Check takes about a minute, and CI spends longer on caches than on
  checking.** The Builder's full Check took 57 to 90 s against a hosted S4 median of 4.7 min. A PR
  CI run after a branch update executed 8 of 9 steps in 74 and 83 s. The cache save and pnpm store
  steps around it took 79 to 114 s each.
- **No reviewer judged any of the three PRs.** A foreign repo's closer requires `check` alone, so
  every PR merged on Check, including one of about 9,200 added lines (7,600 of them a generated
  schema snapshot).

## The probe

| | |
| --- | --- |
| Spec | [Lumaria#902](https://github.com/collod873/Lumaria/issues/902), paused since 2026-10-07 14:55 |
| Wave | 11: three tickets, [#1009](https://github.com/collod873/Lumaria/issues/1009), [#1010](https://github.com/collod873/Lumaria/issues/1010), [#1011](https://github.com/collod873/Lumaria/issues/1011) |
| Machine commit at resume | `88d4f637`, the commit every run used to 00:13; runs from 00:19 used `6184cc09` (the merge of `cc8f36d5`, the PC runner's `gh`) |
| agent-hooks `live` | `23295bd`, unchanged through the Wave |
| Lumaria `CI_RUNNER` | `pc` (set 2026-10-08 18:10:22); 4 of 6 PC runners online at resume |
| Runner of every job | the PC runners `desktop-7vv7k71-1` to `-4`; no job ran hosted |
| Resumed | 23:11:41, by taking `paused` off the Spec |
| Wave note | 23:17:22 |
| Last close | #1009 at 00:27:24 |
| Paused again | 00:27:39, 15 s after the last close. The re-slice's Slicer opened at 00:29:21, read `paused` and stood down, so no Wave 12 was sliced |

Lumaria's `main` before the Wave was `1c23d0a6`. The test audit, `89e87f98` (the Slicer change),
the wake fix ([#1262](https://github.com/collod873/claude-workflow/issues/1262)) and the PC runner
are all in. So this is the first Wave on each of them.

**What marks the Wave's end.** Wave 10's tickets had all closed during the pause, and its note
moved no sentence. So the resume ran no wave check and went straight to the slice. Wave 11's note
also moved no sentence. A Wave ends at the `issues: closed` of the last ticket under the Spec,
when no open follow-up of one remains (`stillOpen`, `src/wave.ts`). The `ended` job then queues
`reslice`. With no moves, its first model step is the Slicer, which reads `paused` when it opens.
A watcher polled every 30 s. It added `paused` once every Wave 11 ticket was closed and no issue
filed since the resume was open.

## Wall time

Wave note to the last close, 70.0 min, critical ticket [#1009](https://github.com/collod873/Lumaria/issues/1009)
(it closed last):

| Where | min | % |
| --- | --- | --- |
| Ticket held by a Machine fault: the PC runner's `gh` cannot branch-update its PR (23:35:26 to the owner's pause) | 29.9 | 43 |
| Builder thinking and other tools | 11.1 | 16 |
| Owner pause of the Spec while the fault was fixed (00:05:17 to 00:12:10) | 6.9 | 10 |
| Ticket held, nothing re-runs the closer (00:12:10 to 00:18:59) | 6.8 | 10 |
| PR CI (2.3 min first run, 3.4 min after the branch update) | 5.7 | 8 |
| Merge queue, branch updates | 5.4 | 8 |
| Builder's full Check | 1.5 | 2 |
| Checks the Builder runs by hand | 1.3 | 2 |
| Machine's check, commit, push, log upload | 0.8 | 1 |
| Builder job setup | 0.7 | 1 |
| Wave check, Slicer at the end | 0 | 0 (paused 15 s after the last close) |

Percentages are rounded and sum to 101. Before the Wave note, the transition from Wave 10 took 5.7
min: no wave check (Wave 10 moved no sentence), 36 s of job setup and a 4.9 min Slicer. The
Slicer hired twice (15 turns, then 2) and no round came back for the Spec's size. In S2 a slice
took 2.5 to 4.4 min.

The owner's pause held only the Spec. Its tickets were held by the fault the whole time, so the
pause row is a split of the fault's hold, not extra wait.

## Actions minutes

Every job ran on a PC runner, so the Wave billed 0 minutes. Hosted, each job rounds up to the
minute, so the same jobs would have billed 129:

| Where | min if hosted | % | runtime, min |
| --- | --- | --- | --- |
| Machine bookkeeping jobs (close, strip, ended, asked, which, resumed, rerun, dispatch-rerun) | 41 | 32 | 9.9 |
| Builder jobs, Spec tickets | 31 | 24 | 29.6 |
| Builder stand-downs (a build job that exits in under 2 min) | 18 | 14 | 4.2 |
| PR CI | 16 | 12 | 13.0 |
| main CI | 8 | 6 | 6.8 |
| CI caches | 8 | 6 | 4.6 |
| Slicer (and the re-slice that stood down) | 7 | 5 | 6.7 |

64 of the Wave's 77 Machine and CI jobs ran under 60 s. The stalls added jobs: the two red closer
attempts, two reruns, the resume and stand-down runs at 00:12, and the re-run at 00:19.

## Across segments

Builder jobs alone, every Spec builder job counted, not only the critical ticket's. S1 to S4 are
copied from the S1 to S4 doc and ran hosted. The probe ran on the PC.

| Per merged ticket, min | S1 | S2 | S3 | S4 | Probe |
| --- | --- | --- | --- | --- | --- |
| Builder thinking and other tools | 9.5 | 9.1 | 9.9 | 8.1 | 5.2 |
| Builder's full Check | 9.2 | 8.8 | 9.3 | 6.7 | 1.2 |
| Checks the Builder runs by hand | 5.2 | 3.5 | 4.6 | 3.5 | 0.5 |
| Machine's check, commit, push | 6.4 | 0.6 | 2.0 | 2.0 | 0.5 |
| Job setup | 2.0 | 1.5 | 2.2 | 3.1 | 0.8 |
| Total builder job | 32.3 | 23.4 | 28.1 | 23.4 | 9.9 |
| Hand-run check commands | 26.8 | 25.8 | 36.2 | 19.5 | 5.0 |
| Spec-attributable Actions minutes | 99 | 56 | 66 | 56 | 0 billed (43 if hosted) |

The probe's total builder job includes 1.7 min of log upload per ticket. Two of the three builder
jobs sat the full 120 s of the stage-logs step's wait for `capture.py` processes, and the third
waited 11 s. That wait uses `pgrep -f` across the whole machine. On the PC, which runs several jobs
and the owner's own sessions at once, it likely waits on other jobs' captures; this is not proven
from the logs. The three tickets differ in size: #1011 was a one-file change (5.4 min job), #1010 a
mid-size one (8.7 min), and #1009 the largest, with a schema migration (15.5 min). A ticket's
thinking time also depends on the ticket, not only on the runner.

## How many times the same tree is fully checked

"Executed" means the steps ran. "From receipts" means `~/bin/check` found a receipt for every step
and ran nothing. Counts are per merged Spec ticket.

| | S4 | Probe |
| --- | --- | --- |
| Builder's `check --full` runs | 1.5, executed | 1.3: four runs. Three executed 8 of 9 steps, with per-test receipts cutting the test step to 9 to 45 of about 270 tests and integration to 1 to 88 of about 88. The fourth found every receipt |
| Machine's `check --full --publish` rounds | 2.0, 2.0 min | 1.0, 13 to 22 s, from receipts |
| PR CI runs | 1.5, all from receipts (9 to 11 s) | 1.7: the first run of each 8 of 9 from receipts (17 to 33 s; treewide re-ran); the two runs after a branch update executed 8 of 9 steps (74 and 83 s) |
| main CI on the merge commit | 1, from receipts (about 5 s) | 1: 20 to 32 s, from receipts but treewide on two of three |
| **Full executions of the merged tree** | **1** | **1.7**: 1 for #1011, 2 each for #1010 and #1009 (Builder, then PR CI on the branch-updated tree) |

The repeated execution is the one the S1 to S4 doc names: a PR behind main gets a branch update,
and the new tree runs uncovered in PR CI. Here two of three PRs were behind, because all three
were green within 18 min and merged one at a time. Receipts made on the PC count in CI on the PC.
The receipt lines name `DESKTOP-7VV7K71` as the host.

## The runner, and check times against hosted

- **Every job ran on the PC runners**, `desktop-7vv7k71-1` to `-4` (20, 19, 13 and 24 jobs). Two of
  six were offline. Its CPU is a Ryzen 9 9950X3D, and WSL sees 32 logical CPUs. The hosted runner is
  2 cores.
- **Builder's full Check: 57 to 90 s on the PC, against a hosted median of 4.7 min in S4** and 3.6
  min in S3. Its steps add up to 2.6 to 3.3 times its wall time. On the same PC, lint took 39 to 71 s
  inside a builder and 38 to 47 s in CI. Builders, CI and the owner's sessions share the box.
- **An uncovered Check: 74 to 83 s on the PC.** The last hosted uncovered run took 222 s
  (2026-10-07 20:15). That was before the test audit, so the trees differ. A hosted run after a
  branch update took 2.5 to 5.7 min in S3. No hosted run has executed today's Lumaria Check
  uncovered, so its hosted time is still unmeasured.
- **CI's cache steps cost more than the Check on the PC.** Handing build and typecheck caches to
  `ci-caches.yml` took 79 s, saving them 114 s, and the pnpm store's post step 106 to 109 s. The
  Check step in the same jobs took 17 to 84 s. PR CI jobs took 68 to 204 s and main CI 55 to 283 s.
  The CI caches workflow's `save` job ran 113 and 146 s when it had caches to save.
- **The fast check overran its 8 s budget once even on the PC**: typecheck took 8.0 s in #1011's
  first turn-end check.

## Every stall

A stall here is a Spec ticket, or the Spec, held 5 minutes or more with nothing of its own running.

| When | What held | Cause | Event that was missing, or that moved it |
| --- | --- | --- | --- |
| 23:24:03 to 00:19:32 (55 min) | [#1011](https://github.com/collod873/Lumaria/issues/1011), its PR merged at 23:22:21 | The closer on `Push to main` runs `gh pr checks --json completedAt` to read when the merged PR's checks ended. The PC runner's `/usr/bin/gh` 2.46 has no `--json` there, so the closer logged that it could not read them, left #1011 open and exited red. Rerun by dispatch re-ran it once (23:27:05, red again) and marked #1011 `stuck` at 23:27:39 | A closer run on a `gh` that can read checks. Moved by a current `gh` put on the PC by hand at about 00:15 (then `cc8f36d5`, landed at 00:13:36 as `6184cc09`), `stuck` taken off at 00:12, and the main session re-running the failed run at 00:18:59. It closed #1011 at 00:19:32 |
| 23:27:08 to 00:19:19 (52 min) | [#1010](https://github.com/collod873/Lumaria/issues/1010), green and `queued`, its PR behind main | The closer's branch update runs `gh pr update-branch`, unknown to `gh` 2.46. It logged "could not be brought up to date with main, and will be tried again" and ended green. A retry needs another closer run, and none came | The same re-run, whose closer brought the PR up to date at 00:19:19 |
| 23:35:26 to 00:18:59 (43 min) | [#1009](https://github.com/collod873/Lumaria/issues/1009), green and `queued`, its PR behind main | As #1010. From 00:18:59 to 00:23:10 it waited its turn behind #1010 in the merge queue, by design | As #1010; its branch update came at 00:23:10, after #1010 merged |
| 00:05:17 to 00:12:10 (7 min) | The Spec | The owner paused it while the fault was diagnosed. The pause held nothing new, since the tickets were already held | The owner taking `paused` off |
| 00:12:10 to 00:18:59 (7 min) | #1011, and through it the Wave | Taking `stuck` off ran Resume, which logged that #1011's PR was merged, so nothing resumes and no fresh build starts. A merged ticket is closed only by a closer run after the merge, and nothing re-runs a closer run that failed | A closer run for the merge, or Resume closing a merged ticket. Moved by the main session re-running run 37859063869 (attempt 3). Filed as [#1276](https://github.com/collod873/claude-workflow/issues/1276) |

With a working closer, #1011 would have closed at about 23:24, and #1010 and #1009 would have been
brought up to date and merged in turn by about 23:40. The stalls cost the Wave about 47 minutes.

## Stage failures and their runs

| Stage | Run | Failed how | Run went red? |
| --- | --- | --- | --- |
| Closer, `Push to main` after #1011's merge, attempt 1 | [37859063869](https://github.com/collod873/Lumaria/actions/runs/37859063869) | Could not read when the merged PR's checks ended; exit 1 | Yes. Rerun by dispatch re-ran it |
| Closer, same run, attempt 2 | 37859063869 | The same, after also failing to branch-update #1010's PR | Yes. #1011 marked `stuck` |
| Closer, `After CI on ticket/1010` | 37859473042 | Branch update of #1010's PR refused (`update-branch` unknown) | No: logged, job green |
| Closer, `After CI on ticket/1009` | 37860242936 | Branch updates of both waiting PRs refused | No: logged, job green |

So a stage that exits red does turn its run red here, and Rerun by dispatch, then `stuck`, follow
as designed. A failure a stage logs and goes on from does not, and the closer's "will be tried
again" has no trigger of its own.

Two earlier claims need correcting. Lumaria's Machine runs had been red before. Eight runs ended
red before this Wave: three on 10-05 and three on 10-06, all hosted, and two on 10-08 on the PC.
Those two came from the runner itself: at 18:10 it refused its `job-started` hook as not a
script, and at 20:15 it was shut down mid-job. And the `stuck` label was created on 2026-10-06 at
21:13, though [#1229](https://github.com/collod873/claude-workflow/issues/1229) found it missing.
It had never been put on a ticket until #1011.

## What the reviewer and Checks let through

- **No reviewer ran.** For a foreign repo the closer requires only `check`
  (`REQUIRED_CHECKS`, `src/closer.ts`), and Lumaria's PRs carry no review job. All three PRs merged
  on Check alone: 2+3 lines, 245+27, and 9,156+63. Of the last, 7,577 lines are one generated schema
  snapshot, which leaves about 1,600 lines written by hand.
- **The one meter**, the consent-only quote meter in each PR body, would have refused nothing on
  all three.
- **Every Check was green the first time**, in the builder, in PR CI and in main CI. No CI run
  went red, so Checks sent nothing back. The builders' hooks refused nothing either: no-prose,
  credential scan, test-weaken and test-quality came back clean or not applicable. The watchdog
  logged 7 failed test runs and stopped 1, all inside builders' red-first test cycles.
- What the merged code does was not judged here. That needs a reading of the diffs, which this
  public doc does not quote.

## Open

- The hosted time of today's Lumaria Check, uncovered, is still unmeasured: the Wave ran wholly
  on the PC, and every ruling has to hold on hosted runners.
- Whether the 120 s capture wait comes from other jobs' `capture.py` on the shared PC is
  inferred, not traced.
- Wave 11 moved no sentence, so no wave check ran at either end of it. The last measured wave
  checks are S2's.
