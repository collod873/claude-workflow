# What merged work cost afterwards, by route

Researches: #652

Child of map #646; feeds its **Lanes** and **Runs** questions. Window: every first-parent change on
`main` from 2026-09-02 00:00Z to trunk `606e2c5` (2026-09-17 04:05Z), 474 changes. Data pulled
2026-09-17 04:20Z. Facts and candidates, no rulings.

## Summary

- **No change on any route was reverted.** Measured by what later work had to repair, the lane's
  merges do not come out worse than direct pushes. The two routes fail in different ways.
  - A later commit or PR named a defect in 7 of 102 lane merges (6.9%), 10 of 271 direct pushes
    (3.7%), 3 of 16 session PRs the owner merged, and 1 of 7 machine PRs the owner merged.
  - Per 1,000 changed code lines the order flips: lane merges 0.51, direct pushes 0.09. Direct
    pushes include very large deliberate deletions.
- **Verify never ran on trunk after a lane merge or a lane push.**
  - Lane 08 merges under the Actions token, and GitHub starts no push workflow for that token's
    events. 0 of 102 lane merges and 0 of 78 lane pushes have a push-event Verify run of their own.
  - So "Verify went red after a direct push" also means "Verify only ever ran after a direct push or
    an owner merge".
  - Of the 17 red runs on direct pushes, 13 were caused by the push itself and 4 were not (1 runner
    shutdown, 3 timing checks). None traced to an earlier lane merge.
- **The 69 deleted tests came from lane pushes, not lane merges.** The acceptance author committed
  straight to `main` for #533, #555, #556 and #559, and those commits deleted the cases `f4378e7`
  restored. Lane merges removed only 1 to 4 cases each, in 6 merges. The ones read were rewrites, ports or
  deletions the ticket asked for.
- **Review's 26 dropped findings describe 20 distinct problems.** None has been fixed on trunk.
  - The follow-up window is short: every finding is on a PR merged between 09-16 17:21Z and 09-17
    02:35Z, so trunk has had 1.5 to 11 hours to act.
  - 10 findings (8 distinct problems) claim a production behaviour defect. One premise was checked
    and holds: the probation counter reads the 200 newest issues, and the only issues
    carrying decision sheets are #96 and #143.
  - One flagged function was deleted 2 hours later, by `8587d4f`, for an unrelated reason.
  - Every finding-bearing review started between 6 minutes before and 11 seconds after its PR
    merged, so none could have held a merge.
- **Fast merges did not cost more afterwards.** Tickets lane 08 merged within 30 minutes of firing
  had a follow-on cost in 3 of 22 cases. The 31m–2h group had 8 of 31 and the over-2h group 4 of 31.
  The slow group is the least observed: 14 of its 31 merged under 72 hours before trunk.

## How this was measured

**Routes** (from `git log origin/main --first-parent`, author and committer, joined to `gh pr list`
`mergedBy` and `headRefName`):

| Route | Rule | Count |
|---|---|---|
| Lane merge | Merge commit authored by `github-actions[bot]` (lane 08, `gh pr merge --merge`, `integrate/integrate.ts:233`) | 102 (92 `implement/issue-*`, 10 `ratify/*`) |
| Owner-merged PR, machine branch | Merge commit authored by `collod873`, head `implement/*` or `rebuild/*` | 7 (#328, #344, #345, #525, #545, #566, #634) |
| Owner-merged PR, session branch | Merge commit authored by `collod873`, any other head | 16 (#393–#396, #413, #415, #416, #429, #432, #435, #436, #453–#455, #458, #459) |
| Direct push | Single-parent commit not committed by the Actions bot | 271 (269 `collod873`, 1 `claude-code[bot]`, 1 bot-authored commit the owner pushed) |
| Lane push (for contrast; not in the ticket's three) | Single-parent commit committed by `github-actions[bot]` | 78 (59 acceptance-test commits, 18 back-stamps, 1 `Implement #357`) |

**Follow-on measures**, per change:

- **Revert:** `This reverts commit <sha>` in any commit message on `main` in the window, matched to
  the change containing that commit.
- **Named repair:** a later commit or PR whose message says an earlier change was broken, found by
  reading all 70 first-parent commits whose subject starts `fix`/`Revert`/`Restore` or whose body
  says broke, stale, regress, typo, restore, revert, "went red" or similar, plus PR bodies. Each was
  attributed by hand to the change it names.
- **Same lines touched within 72h:** for each later change, `git blame --first-parent` on its
  parent over every line it modified or deleted (generated `docs/adr/INDEX.md`,
  `docs/agents/lane-map.md`, `docs/research/` and `package-lock.json` excluded). This counts
  ordinary iteration as well as repair, so it is context, not cost.
- **Verify red on trunk:** push-event runs of `verify-caller.yml` on `main` (220 runs), each
  matched to the change whose SHA it ran on. Failing step and test file come from
  `gh run view --log-failed`.
- **Tests deleted or skipped:** `git grep -c` of test declarations (`test(`, `it(`, `it.each(`,
  `def test_`) in every `*.test.*` and `test_*.py` file, before and after each change, plus
  `.skip`/`.todo`/`skipIf`/`unittest.skip` added. `test.fails(` is not counted as a declaration, so
  acceptance commits' own new cases are undercounted; their deletions use `f4378e7`'s figures.
- **Later ticket citing it as cause:** issue and PR bodies and comments created from 2026-09-01 (214
  issues, 148 PRs) naming the change's short SHA or PR number in a paragraph with a causal word,
  read by hand.

## Follow-on costs per route

| | Lane merge | Owner-merged PR, machine branch | Owner-merged PR, session branch | Direct push | Lane push |
|---|---|---|---|---|---|
| Changes | 102 | 7 | 16 | 271 | 78 |
| Touching code (not only docs/`*.md`) | 102 | 7 | 15 | 244 | 65 |
| Median code lines changed | 86 | 223 | 42 | 67 | 95 |
| Code lines changed, total | 13,791 | 4,557 | 18,005 | 110,704 | 12,082 |
| Merged ≥72h before trunk | 73 | 5 | 16 | 223 | 75 |
| Reverted | 0 | 0 | 0 | 0 | 0 |
| **Named by a later repair within 72h** | **7** (6.9%) | **1** (#566) | **3** (#393, #394, #429) | **10** (3.7%) | **8** (5 acceptance commits, 3 back-stamps) |
| Same, among changes merged ≥72h before trunk | 5 of 73 | 0 of 5 | 3 of 16 | 8 of 223 | 8 of 75 |
| Named repairs per 1,000 code lines | 0.51 | 0.22 | 0.17 | 0.09 | 0.66 |
| Lines touched again within 72h (any reason) | 72 (71%) | 6 | 12 | 195 (72%) | 65 |
| Push-event Verify on its own head | **0 of 102** | 7 of 7 | 15 of 16 | 188 of 271 | **0 of 78** |
| Red Verify runs on its own head | – (never ran) | 1 (#566) | 2 (#393, #394) | 17: 13 caused by the push, 4 not | – (never ran) |
| Red spells it started (previous run green) | – | 1, 3h54m to green | 1, 15m to green | 8: 5 code-caused, 3 not | – |
| `close-ticket` refused after merge: work incomplete by its own check | 8 tickets (#382, #463, #521, #533, #557, #617, #619, #629) | – | – | – | – |
| Test cases removed | 6 merges, 1–4 each; those read were rewrites, ports or asked-for deletions (#362 not read) | 2 merges (#566 −4, #634 −1) | 1 merge (#413 −2) | 26 pushes (below) | 69 cases in 4 acceptance commits, restored |
| `.skip` / `.todo` added | 0 | 0 | 0 | 0; 5 `it.skipIf(!existsSync(...))` in `d86d9ac`, `b8a97b8` | 0 |
| Later issue or PR citing it as cause | PR #565 cites #564 ("the test was wrong") | `4598bea` cites #566 | PR #394 cites #393; PR #395 cites #394; PR #432 cites #429 | #570 and #573 cite `bcece03` (a doc it left stale) | #361 cites `f584a48` (stale ADR index) |

**Why Verify never ran after a lane.** Lane 08 merges with `GH_TOKEN: ${{ github.token }}`
(`.github/workflows/integrate.yml:35`). GitHub's rule: "events triggered by the `GITHUB_TOKEN`,
with the exception of `workflow_dispatch` and `repository_dispatch`, will not create a new workflow
run" ([docs](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow)).
The repo already recorded this for Ratify release (`da12474`) and Lumaria's CI (`b9c4f81`). The
only checks on a lane merge's code are Integrate's gauntlet on the rebased branch
(`integrate/integrate.ts:336-338`) and Review after it. Verify's PR verdict judged trunk (see
`lane-census-2026-09.md`, Corrections).

**What guarded each route before it landed.**

- *Lane merge:* Integrate's gauntlet on the rebased branch.
- *Owner-merged machine PR:* #634 had no Verify or Review run on its branch. #344, #345, #525,
  #545 and #566 were merged after lane 06/08 refused (`run-outcomes-2026-09.md`, class 7); why #328
  was merged by hand is not recorded.
- *Direct push:* the local husky pre-push gauntlet. It silently did not run from a git worktree
  until `324d6e2` (09-11 18:22Z), "how #494's first cut reached main with a jscpd clone in it and
  every /drain worker push skipped npm run check".
- *Lane push:* for acceptance commits, the author's own judge ("whether the new tests are red and
  the gauntlet green", `f4378e7`).

### Red Verify on trunk, by spell

| Spell started at | Route | Runs red | Failing check | Cause | Back to green |
|---|---|---|---|---|---|
| `2fbfe2e` 09-02 16:59Z | direct push | 1 | runner shutdown signal (exit 143) | runner, not code | 33m, `7593e64` |
| `877b5b6` 09-03 10:57Z | direct push (3 lane merges also since last run) | 1 | `timing` | measurement: budget recorded on one runner, read on another (`30b3a8f`, `c84e6b7`) | 33m, `30b3a8f` |
| `ce8e729` 09-03 12:29Z | direct push | 3 (`ce8e729`, `c84e6b7`, `0344deb`) | `timing` ×2; `generate-corpus-fixture.test.ts` on `c84e6b7` | timing as above; corpus test from `c84e6b7` | 1h31m, `c208b8d` |
| `6d34e9f` 09-03 17:30Z | direct push | 7 (`6d34e9f` → `ca215c1`, #360 stages 2–5) | `.claude/hooks/gauntlet.proc.test.ts` (PATH shim) | the test asserted a fact about the tester's machine (`f4df79b`) | 1h15m, `f4df79b` |
| `64a7294` 09-04 11:52Z | direct push (1 back-stamp also since last run) | 1 | `vitest-json.test.ts` timed out (189s) | the push's own subject area; a flake not ruled out | 58m, `3a021a8` |
| `3a127ba` 09-04 15:41Z | direct push | 1 | `clones` (jscpd, threshold 0) | clone in the push | next run, `8040d3c` |
| `823d099` 09-04 15:43Z | direct push | 2 (`823d099`, `94dc832`) | `clones` | clone the worktree gates "never saw" (`85fd9ea`) | 23m, `85fd9ea` |
| `0b63879` 09-10 01:34Z | owner-merged PR #393 | 2 (#393, #394) | `python-suite.proc.test.ts` (`marked` missing, no pytest) | runner-only gaps (PR #394, #395) | 15m, #395 |
| `d9814ad` 09-11 18:01Z | direct push (#494) | 1 | `clones` | clone in the push (`324d6e2`) | 6m, `f5d31e0` |
| `69440d0` 09-15 18:20Z | owner-merged PR #566 | 1 | `adr-index.tooling.proc.test.ts` | stale ADR index banner | 3h54m, `40b724a` |

`4598bea` regenerated the index at 22:10Z but was docs-only, and `verify-caller.yml` ignored
`docs/**`, so no run judged it. `40b724a` ("Let Verify see docs/adr") turned the next run green at
22:14Z. The two `startup_failure` push runs (`e2e32bd`, `a8c3219`, 09-01) predate the window.

## Named repairs

Each row is a later commit or PR whose own message names an earlier change as broken. Lag is from
the broken change landing on `main` to the repair landing.

### Lane merges

| Broken change | What broke (repair's words, shortened) | Repair | Lag |
|---|---|---|---|
| PR #477 (#471), 09-11 11:19Z | `close-ticket --spec` lookups passed jq filters with no leading dot, so every lookup failed. "The test stub walked any dotted path … so it passed the typo" | `f572641` | 23m |
| PR #431 (#425), 09-10 20:31Z | The filing refusal ran first, so the by-hand branch #434 added was unreachable | `45f15b7` | 15h18m |
| PR #564 (#557), 09-14 01:52Z | "The code was already correct; the test was wrong" (acceptance test) | PR #565 | 10m |
| PR #560 (#554), 09-13 23:58Z | "Since #554 the turn venue has blocked every edit with an empty report" on the workstation (tsx not on PATH) | `72d0041` | 26h36m |
| PR #523 (#490), 09-12 18:38Z | `eslint --fix` "silently skipped on this workstation since #490" | `72d0041` | 55h56m |
| PR #580 (#577), 09-14 20:54Z | The plan gate still ran after the session ended, so its refusal reached no model | `f41a15c` | 46h09m |
| PR #651 (#629), 09-17 02:35Z | Three `gh api` callers were left outside the Tracker port, so `close-ticket` refused | `8587d4f` | 6m |

Candidates, not named by the repair:

- PR #476 (#472, which made a door refusal carry `needs-human`), then `821a049` 4h later. The door
  lifted `needs-human` and then declined to dispatch in the same pass.
- PR #523's acceptance fixture for #490.2 raced knip on a share of runs. Repaired by `4f8b75f`
  after 88h54m, outside the 72-hour window.

### Owner-merged PRs

| Broken change | What broke | Repair | Lag |
|---|---|---|---|
| PR #393 (session), 09-10 01:34Z | Runner lacked `lib/md-html`'s dependency and pytest, so Verify went red | PR #394 | 8m |
| PR #394 (session), 09-10 01:42Z | Installed md-html's own lockfile in the machine checkout; the target install never saw it | PR #395 | 7m |
| PR #429 (session), 09-10 20:00Z | Landing job's 10-minute cap cancelled a Lumaria acceptance landing | PR #432 | 36m |
| PR #566 (machine, #553), 09-15 18:20Z | Committed ADR index kept the old banner, so Verify went red | `4598bea`, `40b724a` | 3h50m, 3h54m |

No repair names #634 (68 files, no Verify or Review on its branch). Push-event Verify on its merge
was green (35161165733). It was on trunk for 4h54m before `606e2c5`.

### Direct pushes

| Broken change | What broke | Repair | Lag |
|---|---|---|---|
| `7e64031`, 09-02 15:12Z | walk-home's `gh api -R` died on the first real sweep | `2ed0d88` | 1h25m |
| `9b196ab` (#335), 09-02 19:27Z | A new required contract slot left Lumaria's Verify unable to parse its contract, "an estate-wide outage"; the timing budget turned runs red "on nothing their diffs had done" | `f65b6b0`, `30b3a8f`, `c84e6b7` | 39m, 16h03m, 17h14m |
| `e220052` (#360 stage 3), 09-03 18:02Z | Fixer and `close-ticket` read a job name that no longer existed, so the fixer loop was unreachable | `c58630f` | 31m |
| `6d34e9f`/`ce3b97b` (#360 stages 2, 4), 09-03 | Verify red on 7 pushes over the PATH shim test | `f4df79b` | 1h15m from first red |
| `d9814ad` (#494), 09-11 18:01Z | A jscpd clone reached main; the budget seam was wrong for #497–#504's tests; one 85-minute budget sat above most runners' caps | `f5d31e0`, `324d6e2`, `d7dc337`, `4b4f325` | 6m, 21m, 6h39m, 8h26m |
| `548e24e` (#522), 09-12 22:00Z | A dead lane escalated to `needs-human` before the strike ladder ran, then dropped the ticket from the recompute | `cfa9595`, `9e719fc` | 15h38m, 15h45m |
| `5c544a7`, 09-13 14:27Z | The eight-file ceiling refused with no repair path, and the slicer prompt still said there was no ceiling | `c81962d`, `e5e2ae5` | 51m, 1h52m |
| `5a49cdd`, 09-13 21:14Z | The shared rules table still meant different things to the two engines (BOM, regex flags, line terminators) | `fe9efdf`, `fa28509` | 24m, 56m |
| `5227816`, 09-14 18:37Z | Build lanes started from a shallow clone, so the pre-push rebase had no merge base (#570) | `7abef7b` | 16m |
| `47b8e29`, 09-14 19:43Z | Help text said every warning stops filing; one is advisory | `567b6b3` | 18h49m |

Outside 72h: the #360 `test.fails` rule misread a string fixture during #490's run, repaired by
`71c12ef` nine days later. `3c6f82e` says twelve hand-landed commits on 09-02 each broke an assumption
that Lumaria's Verify found one run at a time, and `4772f87` repairs two of them. They are not
attributed row by row.

### Lane pushes

| Broken change | What broke | Repair | Lag |
|---|---|---|---|
| Acceptance commits `232bec2` (#533), `15a8c82` (#555), `ba00ecb` (#556), `fdc214c` (#559) | Returned whole test files the ticket never claimed, rebuilt from memory: 69 cases deleted (`close-ticket.proc.test.ts` 36→1, `close-gate.proc.test.ts` 7→2, `gauntlet.proc.test.ts` 30→8, `structural-refusal.test.ts` 6→1, `file-issue.proc.test.ts` 3→1) | `f4378e7`, then `9279b93` refuses it | 23h45m, 2h08m, 1h53m, 43m |
| Acceptance commit `77171f9` (#557) | Test wrong | PR #565 | 36m |
| Back-stamp commits on 09-03 (`e4f2122`/`0b39cef`/`5dd725a`, `f584a48`) | Edited `docs/adr/` without regenerating the index | `fa0413d`, `0344deb`, `9a0859e` (by hand; #361 calls it "the third hand-repair of the same defect") | 52m for `f584a48`; the other two are not pinned to one commit |

### Tests removed by direct pushes

26 direct pushes lowered the case count in an existing test file. The large ones say so in their
own message:

- `91cd700`, #360 stage 1: −274 net, 105 test files removed with the gate bookkeeping.
- `e220052`, #360 stage 3: −219 net; tests folded behind one fake.
- `73b84ce`: −23, acceptance landing moved to the ticket branch.
- `d6b1ca1`: −28 across three files, 24 of them in `recover.test.ts`.
- `f7b83ab`: −16.
- `ae777b0`: −14, spec/gap retired.

Whether each deleted case guarded a rule that still stands was not checked.

## Dropped review findings

**Source.** All 23 `review-caller.yml` runs whose `claude-streams-review-*` artifacts were still
retained, 2026-09-16 17:21Z to 2026-09-17 02:35Z. No earlier run uploaded streams. The reviewer's
`result` event holds `structured_output.findings`. 15 runs returned 26 findings. The reviewer stage
cost $28.90 across the 23 runs.

**The filter.** `keepSurvivingFindings` (`review/review.ts:40`) keeps a finding only if one of its
`path:line` citations appears verbatim in the diff text (`review/structural-refusal.ts:9-16`). A
unified diff carries `+++ b/path` and `@@` hunk headers, never `path:line`, so every finding was
dropped and `tally.reached` logged 0.

**Timing.** Review wakes on the same green Verify that Integrate waits on. Its finding-bearing runs started from
6 minutes before to 11 seconds after their PR merged. A pre-rebase head was reviewed as well as the
merged one for PRs #632, #633, #638, #640 and #642.

**Matched to later fixes.** Checked on trunk `606e2c5` by reading the cited file at the cited
place, and by `git log` on the file after the merge. "Stands" means the code the finding describes
is unchanged.

| # | PR (ticket) | Where | Claim, shortened | Kind | On trunk | Later fix |
|---|---|---|---|---|---|---|
| F1 | #604 (#600) | `spec/spec.ts:217` | `SENT_TO_SPEC_MARKER` in any comment pins lane 02 to the widened path, which drops a body's `## Decisions so far` | behaviour | stands | none |
| F2 | #605 (#603) | `to-tickets/publish-issue-graph.cli.ts:57` | Claim-rooting repairs are discarded, so the published table never shows a rewritten claim | behaviour (report) | stands | none |
| F3 | #605 (#603) | `bin/publish-issue-graph:12` | Bare `npx tsx` with no `node_on_path` bootstrap; dies with no node on PATH, or fetches tsx from the registry outside the checkout | behaviour | stands | none |
| F4 | #605 (#603) | `publish-issue-graph.cli.ts:52` | `--repo` the Python script accepted is now silently ignored, so a graph can publish into the cwd's repository | behaviour | stands; no caller in the repo passes `--repo` | none |
| F5 | #630 (#607) | `shared/tracker-memory.ts:104` | `workflowRuns` ignores the workflow name, so memory-backed tests pass with the wrong workflow file | test double | stands | none |
| F6 | #631 (#624) | `acceptance/acceptance.ts:513` | Missing `tracker` defaults to an empty in-memory tracker, so re-fire silently finds no slices | behaviour (latent) | stands | none |
| F7 | #632 (#608) | `shared/tracker-payloads.ts:331` | Hand-written run/job literals are packaged and cited as recorded API payloads | test evidence | stands | none |
| F8 | #632 (#608) | `tracker-payloads.ts:201` | A hand-transcribed second copy of four JSON fixtures, with nothing tying the copies together | test evidence | stands | none |
| F9, F12 | #633 (#620) | `watchdog/slicing-history.fixture.ts:21` | The fake turns `conclusion: null` into `""`, so the in-flight null case is never exercised | test double | stands | none |
| F10 | #633 (#620) | `shared/gh.ts:22` | `Number.isInteger(Number(""))` is true, so empty stdout reads as zero sub-issues | behaviour | **code deleted** by `8587d4f` (09-17 02:41Z) when the count moved to `tracker.children().length`; the commit does not mention the finding | incidental removal |
| F11 | #632 (#608) | `tracker-payloads.ts:360` | `adr0106Payloads()` returns the shared module object, so one test's edit leaks into later calls | test hazard | stands | none |
| F13, F17 | #638 (#619) | `shape/probation.ts:18` | `countSilentSheets` walks `signals()`, the 200 newest issues, instead of searching for sheets, so it reads 0 here | behaviour | stands. Premise checked: `gh search issues 'decision-sheet:v1' --match comments` returns only #96 and #143, and the newest issue is #653 | none |
| F14, F16 | #638 (#619) | `probation.ts:31` | `highestProposedAt` reads the same window, so an aged-out proposal is filed again on every shape run | behaviour | stands | none |
| F15, F18 | #638 (#619) | `probation.ts:19` | One `gh issue view` per issue in the window, up to 200 calls per shape run | cost | stands | none |
| F19 | #641 (#614) | `to-tickets/to-tickets.test.ts:22`, `repair-round.test.ts:18` | `unreachableGh` is a tracker object cast to a function, so it no longer names a breach and duck-types past `typeof … === "function"` guards | test sentinel | stands | none |
| F20, F24 | #642 (#611) | `dispatch/reconcile.test.ts` (read-only graph guard) | Edge writes now go through `trackerMemory.addBlockedBy`, which records nothing, so the guard cannot fail (the reviewer reports verifying it by mutation) | vacuous test | stands (`dispatch-tracker.fixture.ts:264` injects `tracker.tracker`) | none |
| F21, F24 | #642 (#611) | `dispatch/to-build-door.test.ts` (no comment reads) | Comment reads no longer reach `gh`, so the guard cannot fail (also mutation-checked by the reviewer) | vacuous test | stands | none |
| F22, F23 | #642 (#611) | `dispatch/dispatch-tracker.fixture.ts:125` | `released` is never written, so four "deletes no ref" assertions cannot fail | vacuous test | stands (declared `:125`, returned `:255`, no push) | none |
| F25 | #645 (#628) | `shared/tracker-gh.ts:500` | The `sub_issues` branch has no `indexOf === -1` guard, so a `-f` call attaches child `NaN` and reports success | test fake | stands | none |
| F26 | #651 (#629) | `to-tickets/gh-cli.stub.d.ts:1` | A declaration for a deleted module keeps `./gh-cli.stub` type-checking for every importer | type hole | stands | none |

**Counts.** 26 findings, 20 distinct. By kind:

- Production behaviour: 10 findings, 8 distinct (F1, F2, F3, F4, F6, F10, F13/17, F14/16).
- Cost: 2 findings, 1 distinct (F15/18).
- Test doubles, evidence or sentinels that no longer guard what they name: 14 findings, 11 distinct.

None was matched to a later fix. One target was removed incidentally. The window from merge to
trunk was 1.5 to 11 hours, so "not fixed" is not evidence "not needed". The one production premise
checked (F13) holds today.

**Earlier review output, for contrast.** Before the streams existed, the lane's `spec/gap` route
produced 8 issues. The owner closed all 8, and 2 were closed as completed (#573, #593, from
`lane-census-2026-09.md`). `ae777b0` retired that route on 09-16 12:52Z.

## Fast merges against slow

Lane-merged tickets from `run-outcomes-2026-09.md`'s per-ticket tables (86 rows with a lane 08
merge; 84 have a fired→merged time), bucketed by that note's **Fired→merged** column.

A ticket counts as having a **follow-on cost** if any of these happened:

- `close-ticket` refused it after merge for incomplete work.
- A later commit or PR named a defect in its merge.
- Its acceptance commit deleted tests.

| Fired→merged | Tickets | Median | Merged ≥72h before trunk | Close refused, work incomplete | Named repair | Acceptance deleted tests | **Any follow-on cost** | Reviewed with retained streams | Of those, with dropped findings |
|---|---|---|---|---|---|---|---|---|---|
| ≤30m | 22 | 19m | 18 | 1 (#463) | 1 (#471) | 1 (#555) | **3 (14%)** | 1 | 1 (#603: 3) |
| 31m–2h | 31 | 51m | 22 | 3 (#382, #533, #557) | 4 (#425, #554, #557, #577) | 3 (#533, #556, #559) | **8 (26%)** | 4 | 4 (8 findings) |
| >2h | 31 | 4h02m | 17 | 3 (#617, #619, #629) | 2 (#490, #629) | 0 | **4 (13%)** | 11 | 6 (15 findings) |

The 17 fastest named in `run-outcomes-2026-09.md`:

- **Cost found:** #555, whose acceptance commit took `gauntlet.proc.test.ts` from 30 cases to 8
  (restored by `f4378e7`).
- **Dropped findings, no named cost:** #603 had 3 (F2–F4), and its merge replaced 3 Python test
  cases with a TypeScript suite.
- **Candidate only:** #472 (`821a049`, above).
- **Nothing found:** #372, #390, #367, #421, #473, #373, #437, #483, #448, #461, #479, #582, #474
  and #532.

**Why the slow group differs.** Its slowness mostly came from something other than the work:

- #497–#504 had cancelled Integrate runs and hand re-dispatch.
- #610–#629 queued behind blockers and the #538 wave.
- #440–#444 waited on #448.

That group also holds most of the 09-16/17 merges, which were observed for the shortest time and
are the only ones with retained Review streams.

## Candidates

For the map's rulings; none is a ruling.

- **Verify on trunk after a lane merge.** A lane merge is never judged on trunk by a push-event
  Verify. A red it caused would first show on the next owner push and be charged to that push.
  - Candidates: Integrate dispatches Verify after merging (as `b9c4f81` did for Lumaria's CI), or
    merges under a token that raises push events.
  - No red in the window traced to a lane merge.
- **Acceptance writes and pushes to main.** The route with the most tests deleted and the most hand
  repairs per change was lane pushes (acceptance commits and back-stamps). Since `73b84ce` (09-14),
  acceptance lands on the ticket branch; back-stamps still push to `main` (`bb9fd31`, 09-16).
- **Review's filter.** As shipped, Review drops everything. The dropped set includes production
  defects that still stand (F1, F3, F4, F13/F17, F14/F16).
  - Candidates: fix the `path:line`-in-diff test, publish without it, or run Review before
    Integrate merges.
  - Review currently starts at merge time, so as a gate it would add its run time (about 5 minutes
    in run 35175002431) to every merge.
- **Incomplete work passing Integrate.** 8 lane-merged tickets failed their own acceptance criteria
  at close, after merge. On this data that is the lane route's largest follow-on cost, and it grows
  with the ticket, not with speed.
- **Worktree push hook.** The hook was missing for direct pushes from worktrees until `324d6e2`.
  All 5 code-caused red spells on direct pushes fall before that commit. Whether those pushes came
  from worktrees was not checked.

## Not verified

- **Short observation.** 29 lane merges, 2 owner machine merges and 48 direct pushes were on trunk
  under 72 hours at `606e2c5`. Their follow-on counts are lower bounds. That includes all 11 PRs
  with dropped Review findings.
- **Unnamed repairs.** Named repairs are those a later message states. A defect fixed in a commit
  that does not say what it repairs is missed. The "same lines touched within 72h" column is
  over-inclusive and was not read commit by commit, except for the 70 repair-like commits.
- **Detection bias by route.** The owner's sessions write both the direct pushes and most repair
  messages, and may name their own recent pushes more readily than a lane's merge, or less.
- **Test deletions.** Whether each deleted case guarded a live rule was not checked, except where
  `f4378e7` says so. Counts exclude `test.fails(` declarations and do not follow moves between
  files.
- **Issue citations.** Only issues and PRs created from 2026-09-01 were searched. Comments on older
  issues are missed.
- **Dropped findings.** 20 of 26 are the reviewer's claims, not reproduced here; only F13's premise,
  F10's removal and each finding's "stands on trunk" were checked. Review runs before 09-16 17:21Z
  kept no streams, so their dropped findings are unrecoverable.
- **Owner-merged session PRs.** It was not checked whether #393–#459 had Verify or Review on their
  branches.
- **Verify causes.** Failing steps were read from logs. That the 13 code-caused reds came from the
  push itself rests on the failing test's subject and the repair message, not a bisect. `64a7294`'s
  timeout went green 58 minutes later on a commit that may not have touched it.
- **Changes not classified.** The owner's statement that direct pushes happened because the
  machine was judged broken was not checked per push; `run-outcomes-2026-09.md` did not classify
  them either.
