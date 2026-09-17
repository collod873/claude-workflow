# Lane census: what each lane does, costs and delivers, and what lanes copy

Research for [#648](https://github.com/collod873/claude-workflow/issues/648), under map
[#646](https://github.com/collod873/claude-workflow/issues/646). Recorded 2026-09-16 against trunk
`8587d4f`. Run data is the Actions API for `collod873/claude-workflow`, runs created
2026-09-03T00:00Z to 2026-09-16T23:59Z (14 days). Facts and candidates only, no rulings.

## Summary

- **4,309 runs in 14 days, and most did nothing.** 775 were skipped by GitHub and 741 cancelled. Of
  the 2,793 that ran, 1,603 (57%) were no-ops, 1,175 did work, and 547 did work that a later lane or
  the owner used (47%; Enrol's 21 runs were not judged). Dispatch reconcile alone fired 1,787 times:
  702 were superseded in its queue and 673 of its logged runs wrote nothing a log shows.
- **Logged model spend was about $627** (Claude Code's client-side `total_cost_usd` estimate under
  the subscription token, not a bill): Implement $246, Acceptance $158, Review $112, To-Tickets $40,
  Ratify $37, Audit $22, Spec $6, Fixer $6. About $199 bought output nobody used: Review's $112 for
  zero correctness findings, $50 on 12 green Implement runs discarded at the rebase, $37 on 9 red
  To-Tickets runs.
- **Useful work sits in the build tail both doors share.** Integrate 90%, Implement 83%, Acceptance
  71% useful. Verify's 113 PR verdicts were read 99 times; its 178 push-to-main verdicts were read by
  no lane.
- **The spec door barely ran.** Five Spec critiques, eleven To-Tickets runs, one publish: nine
  To-Tickets runs died at the final audit after spending $36.88, and the owner filed #491's and
  #538's children by hand.
- **Eight lanes did no useful work in the window:** Shape (153 no-ops), Shape-accept (3 label
  removals on tickets), Lost-dispatch counter (96 no-ops), Run watchdog (36 no-ops), Decline on
  revert (7 no-ops), Bypass counter (195 no-ops, 1 issue closed not planned), Mechanic and Record
  ratifications (zero runs). Audit, Run watchdog and Walk home have not been woken since 2026-09-09,
  when `session-captured` stopped arriving.
- **Copied logic:** rebase-then-abort exists four times with four different conflict outcomes;
  strike parsing three times, two of which ignore an owner decision; "which PR did Verify judge" is
  read three ways; five places carry their own standing-issue writer. 23 items below.
- **Overlap:** one label edit starts five workflows; Back-stamp and Missing-trailer counter share one
  push door; Implement and Mechanic are one job with two prompts; the ratification loop is five
  lanes. 12 items below.
- **Built-in overlap:** Review's job is what Claude Code's Code Review and `/code-review` do; the
  Fixer's is partly what auto-fix does; no built-in covers Verify, Integrate or the reconciler.
- **The generated lane map's run counts are wrong:** `docs/agents/lane-map.md` says Implement,
  Acceptance, Fixer and Audit "never fired" (see [Method](#method)).

## Method

- **Runs:** `GET repos/collod873/claude-workflow/actions/runs?created=<range>` in six-hour slices, so
  no slice reached GitHub's 1,000-result cap for filtered run searches
  ([docs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository)).
  4,309 runs, all ids unique. Wall-clock is `updated_at - run_started_at` on runs that concluded
  success or failure.
- **Logs:** the full log of all 2,793 runs that concluded success or failure. Skipped and cancelled
  runs have none.
- **No-op / did work / useful:** a **no-op** ran and its log shows it evaluated its door or gate and
  changed nothing; **did work** changed something outside the runner (comment, label, issue, commit,
  push, PR, dispatch, merge) or spent a model; **useful** is did-work whose outcome a later lane or
  the owner used, with the test stated per lane. Useful-work rate = useful / did work.
- **Spend:** the sum of the `· done ... N turns, $X` lines every model call prints
  (`.Workflow/agent-workflows/shared/stream-json.ts:112-117`). These are client-side estimates
  ([headless](https://code.claude.com/docs/en/headless)).
- **Lines:** `wc -l` at `8587d4f`, code excluding `*.test.ts`, `*.fixture.ts`, `*.fake.ts`,
  `*.stub.ts`; lanes that share a directory are split by file. Every lane also runs on `shared/`
  (9,525 code / 10,684 test lines) and is wired in `shared/lane-wiring.ts` (1,383 lines).
- **Why the lane map disagrees:** `npm run lane-map` asks for `created=>=<since>`
  (`.Workflow/agent-workflows/shared/gh-paths.ts:135`), which GitHub caps at 1,000 runs, so it sees
  only the newest ~2.5 days; and `tallyRuns` matches on the run's `name`
  (`.Workflow/agent-workflows/shared/lane-map.ts:351-368`), which for Implement and Acceptance is
  the run-name `Implement #N` / `Acceptance #N` (`shared/lane-wiring.ts:570`, `:625`), so those runs
  are never counted.

## Lanes

One row per wired lane (`.Workflow/agent-workflows/shared/lane-wiring.ts:404-1237`), then the three
workflows that ran in the window but are no longer wired. **Door:** *spec* is `/to-spec` -> Spec ->
To-Tickets -> build; *ticket* is `file-issue ticket` -> reconcile -> build; *both* is the shared
build tail; *neither* serves only the other entry points or upkeep. **Runs:** fired, then skipped /
cancelled / red / green. **Wall:** median / p90 seconds over runs that went red or green. **Useful:**
the per-lane test is in [Lane notes](#lane-notes). A bare `:NNN` is a line of
`.Workflow/agent-workflows/shared/lane-wiring.ts`; other paths are under `.Workflow/agent-workflows/`.

| Lane | Wakes on (wiring line) | Produces | Door | Runs: fired (skip / cancel / red / green) | Wall med / p90 s | No-op | Did work | Useful (rate) | Logged $ | Code / test lines |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 Shape | `issues labeled`, `issue_comment created` (`:408`) | shaping sheet, `1-decide`, `needs-human`, `shape-refused` | neither | 334 (181 / 0 / 0 / 153) | 23 / 43 | 153 | 0 | 0 (n/a) | 0 | 724 / 1,099 |
| Shape-accept | `issues labeled` (`:438`) | `to-spec`, `sheet-accepted` ring, trunk commit | neither | 214 (100 / 0 / 0 / 114) | 18 / 28 | 111 | 3 | 0 (0%) | 0 | 328 / 598 |
| 02 Spec | `issues labeled` `prd` / `to-spec`, `sheet-accepted` (`:462`) | critiqued spec body, `sliceable`, `prd-sliceable` ring | spec | 215 (95 / 2 / 1 / 117) | 29 / 55 | 112 | 6 | 3 (50%) | 6.42 | 950 / 1,953 |
| 03 To-Tickets | `prd-sliceable` (`:503`) | sub-issues, `slice-failed` | spec | 11 (0 / 1 / 9 / 1) | 1,532 / 2,542 | 0 | 10 | 1 (10%) | 40.20 | 469 / 1,404 |
| 04 Acceptance | `issues edited` (refire), `acceptance-wanted` (author) (`:573`) | acceptance tests on the ticket branch, `queued`, `run-ended` ring | both | 179 (22 / 8 / 34 / 115) | 521 / 998 | 23 | 126 | 90 (71%) | 157.67 | 663 / 1,228 |
| 04 Dispatch reconcile | `session-captured`, `graph-changed`, `run-ended`, `issues labeled/unlabeled`, push to main, by hand (`:928`) | `acceptance-wanted`, `ticket-ready`, `mechanic-wanted`, `sheet-accepted` rings; lane labels; strikes; spec-check comment; rollup | both | 1,787 (49 / 702 / 5 / 1,031) | 32 / 53 | 673 | 358 | 132 (37%) | 0 | 1,423 / 2,165 |
| 05 Implement | `ticket-ready` (`:627`) | implementation PR, `implementation-opened` ring, `needs-human` | both | 113 (0 / 0 / 8 / 105) | 531 / 1,452 | 6 | 103 | 86 (83%) | 246.05 | 717 / 1,236 |
| 05 Mechanic | `mechanic-wanted` (`:657`) | same as Implement | both | 0 | n/a | 0 | 0 | n/a | 0 | 295 / 248 |
| 06 Verify | push to main (code paths), `implementation-opened` (`:687`) | pass/fail on a PR head or trunk commit, `fixer-needed` / `review-wanted` rings | both | 291 (0 / 0 / 27 / 264) | 152 / 234 | 0 | 291 | 99 (34%) | 0 | 165 / 114 |
| 07 Fixer | `fixer-needed`, by hand (`:776`) | fix commit on the PR branch, `needs-human` | both | 101 (90 / 1 / 2 / 8) | 39 / 842 | 5 | 5 | 2 (40%) | 5.92 | 418 / 582 |
| 07 Review | `review-wanted` (`:901`) | finding issues, `7-reviewing` | both | 169 (91 / 0 / 1 / 77) | 220 / 405 | 0 | 78 | 2 (3%) | 111.70 | 496 / 831 |
| 08 Integrate | `implementation-opened` (`:750`) | merge, ticket close, `graph-changed` / `ratifier-merged` rings, `needs-human` | both | 113 (0 / 9 / 12 / 92) | 217 / 348 | 0 | 102 | 92 (90%) | 0 | 502 / 924 |
| Audit (observation lenses) | `session-captured` (`:953`) | observation note on `refs/notes/observations`, `ratification-due` ring | neither | 36 (0 / 0 / 0 / 36) | 188 / 338 | 13 | 23 | 6 (26%) | 22.05 | 522 / 988 |
| Ratify | `ratification-due` (`:981`) | ratifier PR, `refs/ratifier/last` | neither | 25 (0 / 0 / 1 / 24) | 30 / 1,004 | 17 | 8 | 7 (88%) | 37.47 | 671 / 960 |
| Ratify on PRD close | `issues closed` (`:1025`) | `ratification-due` ring | neither | 87 (45 / 0 / 0 / 42) | 15 / 21 | 40 | 2 | 1 (50%) | 0 | 71 / 86 |
| Record ratifications | `ratifier-merged` (`:1047`) | `refs/notes/ratifications` | neither | 0 | n/a | 0 | 0 | n/a | 0 | 114 / 169 |
| Decline on revert | push to `CODING_STANDARDS.md`, `eslint.config.js` (`:1070`) | declined memory | neither | 7 (0 / 0 / 0 / 7) | 24 / 26 | 7 | 0 | 0 (n/a) | 0 | 140 / 152 |
| Run watchdog | `session-captured` (`:1093`) | dead-lane signal issue | neither | 36 (0 / 0 / 0 / 36) | 26 / 164 | 36 | 0 | 0 (n/a) | 0 | 427 / 671 |
| Bypass counter | Verify completed (`:1115`) | bypass proposal issue | neither | 196 (0 / 0 / 0 / 196) | 27 / 39 | 195 | 1 | 0 (0%) | 0 | 226 / 473 |
| Lost-dispatch counter | `issues labeled` (`:1138`) | lost-dispatch signal issue | spec | 214 (100 / 18 / 0 / 96) | 18 / 34 | 96 | 0 | 0 (n/a) | 0 | 193 / 206 |
| Missing-trailer counter | push to `docs/adr/**`, `docs/research/**` (`:1162`) | missing-trailer signal issue | neither | 53 (0 / 0 / 0 / 53) | 20 / 27 | 46 | 7 | 2 (29%) | 0 | 248 / 303 |
| Back-stamp | push to `docs/adr/**`, `docs/research/**` (`:1184`) | back-stamp commits on trunk | neither | 53 (0 / 0 / 0 / 53) | 19 / 29 | 36 | 17 | 16 (94%) | 0 | 205 / 431 |
| Enrol (machine only) | push to `*-caller.yml`, by hand (`:1205`) | caller stubs, labels, secrets in enrolled repos | neither | 21 (0 / 0 / 0 / 21) | 28 / 67 | 0 | 21 | not judged | 0 | 498 / 715 |
| Walk home (machine only) | `session-captured` (`:1222`) | issues for red runs in enrolled repos | neither | 36 (0 / 0 / 0 / 36) | 30 / 54 | 32 | 4 | 2 (50%) | 0 | 390 / 396 |
| *Recover* (deleted `d6b1ca1`, 09-06) | `workflow_run`, dispatch | re-dispatches, branches | both | 10 (0 / 0 / 0 / 10) | 28 / 490 | 2 | 8 | 4 (50%) | 0 | deleted |
| *Ratify release* (renamed `b1fd097`, 09-12) | `pull_request` closed, dispatch | `refs/notes/ratifications` | neither | 4 (2 / 0 / 0 / 2) | 14 / 14 | 0 | 2 | 2 (100%) | 0 | deleted |
| *probe-gauntlet-timing* (branch only) | push to `probe/gauntlet-timing` | gate timings in the log | neither | 4 (0 / 0 / 2 / 2) | 190 / 213 | n/a | n/a | read by the owner | 0 | never on trunk |
| **Total** | | | | **4,309 (775 / 741 / 102 / 2,691)** | | **1,603** | **1,175** | **547 (47%, Enrol excluded)** | **627.48** | |

Of the 2,793 runs that went red or green, 15 fit neither bucket: 5 reconcile crashes, 4 Implement
crashes before any work, 2 Integrate crashes, 4 probe runs.

## Lane notes

The useful test and the facts behind each row. Run ids are Actions run ids.

### Front of the pipeline

- **Every label edit wakes five lanes.** Before 2026-09-12 about 100 label edits woke Shape,
  Shape-accept, Spec, Lost-dispatch counter and reconcile and GitHub skipped all five; from 09-12,
  when the job conditions moved into TypeScript (`029a3e5`, `841a5f9`), 114 label edits started
  all five and each decided in code. The labels were `ticket` 47, `to-build` 42, `by-hand` 8,
  `fuzzy` 7, `parked` 3, other 7. No `idea` or `sliceable` label edit happened in the window.
- **Shape:** all 153 runs logged "neither labels an idea nor asks a change of one; nothing to shape"
  (34706909854, 34675891639). 39 of them were issue comments, closing records included.
- **Shape-accept:** 111 runs logged "`<label>` is not a verb the owner applied to a shaped idea"
  (34706908875). The 3 that did work parked tickets, not shaped ideas: #308 (35053394596), #410
  (35053393092), #600 (35116433660). Useful test: an accepted idea reached Spec. None did.
- **Spec:** 5 critiques ("critiqued #N: dispatched, body re-authored", 2 model calls each) on #433,
  #434, #491, #519, #538, plus one red run (35103742660, "issue #538 carries no Decisions so far
  entries"). Useful test: the spec went on to be sliced into built children: #434 (by To-Tickets),
  #491 and #538 (children filed by the owner by hand). $6.42 over 5 runs.
- **To-Tickets:** useful test: published children that were built. One run published: 34535347655
  (#434, 8 children, all merged, $3.32). Nine red runs refused at the last stage after the full
  model spend ($36.88): path not written from the repo root 6 (34535319465, 34616814332,
  34768264973, 34775900924, 34777528784, 35133339528), a claim that is not a path 1 (34534729757),
  a claim under `.github/` 1 (34662511401), claim over the 8-file ceiling 1 (34765269899); plus one
  run cancelled at the 30-minute job limit (34660564916). #538 alone took 5 runs and $23.59 and
  published nothing; the owner filed its 23 children (#607-#629) by hand. For #491 the owner filed
  the 12 slices from red run 34616814332 word for word as #493-#504.
- **Lost-dispatch counter:** 96 runs, all "skipped" because the label was not `sliceable`
  (34715840631); it filed nothing. 18 more were cancelled in its own queue.
- **Dispatch reconcile:** woken by `workflow_run` 1,054 (removed in `1ec5074`, 09-14), `issues` 273,
  `run-ended` 210, `graph-changed` 92, `push` 113, `session-captured` 36, by hand 9. Its 702
  cancelled runs (563 of them `workflow_run`) were pending runs superseded in the single
  `dispatch-reconcile` group (`shared/lane-wiring.ts:934`). Of 1,036 logged runs: 608 "clear:
  nothing became ready" with no write in the log (33709740926), 65 door no-ops (34706907795), 126
  dispatched, 209 that only rewrote a spec-check comment, 23 other writes, 5 crashes (09-14
  03:05-03:52Z, a `blocked_by` 404 inside `wireClaimCollisions` added by `964d248` that morning).
  Useful test: the dispatch started a lane (all 170 dispatches in 126 runs did: 59 to Implement, 111
  to Acceptance), or the owner acted on a strike decision or door refusal (6). The 209 spec-check
  rewrites were not used: #434's check ran `exit 1` 111 times in a row until the owner closed it,
  #491's 108 times, #538's was refused 45 times. The #579 three-strikes decision (34906413802) was
  posted 36 minutes after #579's PR had merged. Current code relabels `queued`/`waiting` without
  logging, so some of the 608 may hide relabels.

### Build tail

- **Acceptance:** useful test: the authored tests reached trunk and the ticket's implementation
  merged. The `refire` job never re-fired anything (21 runs not the owner's PRD edit, 34706917287;
  2 found nothing, 34651875283). The `author` job: 91 runs landed tests ($114.91); 34 red or
  refused ($42.59): land push lost the race to main 5 (34062525714), land gauntlet red 4
  (33895409486), gate red on the authored tests 7 (34524061046), author returned a file that
  already exists 5 (34892237773), no test file or missed criteria 4 (34538911212), 24-minute
  timeout 3 (34739391418), other 6. $12.75 went on tickets later closed not planned.
- **Implement:** useful test: the PR it opened merged. 86 runs ($181.89). **12 green runs were
  thrown away on a rebase conflict ($50.31)**, nine of them on 2026-09-16 20:17-20:25 (35145650903,
  35145839368, 35145897065, 35146103754, 35146177209, 35146180674, 35146291735, 35146362705,
  35146445830; $40.40), each conflicting on `shared/tracker-gh.ts` and neighbours as sibling PRs
  630-633 merged; the owner rebuilt all nine at 22:54Z by replaying their recorded edits (commits
  `54de5b1` to `cafb6db`). Also: pre-push gauntlet rejected 3 (33698753662), `test.fails` guard 1
  (34705588650), 4 crashes on #371 in 2 minutes (`EISDIR`, 33910985030), 6 no-ops ("already
  claimed" 5, stale dispatch 1). `bin/close-ticket` refused to close three merged tickets, which
  started a second Implement run each time (33908740551, 34797370371, 35164450609).
- **Verify:** 113 runs on `implementation-opened`, 178 on push to main. Useful test: a lane read
  the verdict. Integrate read 99 of the 113 PR verdicts (92 merges, 7 refusals); 9 had their
  Integrate run cancelled, 3 on PR 545 were unreadable because `gh` refused a log with terminal
  escapes, 2 had Integrate crash. **None of the 178 push-to-main verdicts was read by a lane**:
  Fixer and Review skip them ("not the fixer's/review's to read"), and only Bypass counter reads the
  19 red ones, for an issue the owner closed not planned. 41 runs logged "could not mark #N as
  6-verifying" (HTTP 403): the lane's token has no `issues` permission (`shared/lane-wiring.ts:690`).
  18 runs re-judged a PR already judged.
- **Integrate:** useful test: a merge. 92 merges (81 Implement PRs, 7 ratifier PRs, 4 owner PRs); 13
  merges left the ticket open because `bin/close-ticket` refused. Refusals: acceptance tests red 3,
  immutable set 2, Verify result unreadable 3 (PR 545), own gauntlet red after rebasing 2. Crashes:
  force-with-lease push rejected (33700314342), malformed PR url `/525` (34712442655). 9 cancelled
  in the single `integrate` group.
- **Fixer:** 90 of 101 runs were GitHub-skipped `workflow_run` wakes (to 2026-09-11); since the
  switch to dispatch it ran 10 times, none after 09-13. Useful test: it pushed and the PR merged: 2
  (33704698643 -> PR 351, 33709001401 -> PR 354). 3 escalations whose PRs merged by other routes
  (33700482337, 33761922798, 34712546740).
- **Review:** useful test: a finding issue the owner closed as completed. **The correctness reviewer
  produced zero candidates in all 77 finished runs**: every result line is
  `{"publishedIssues":[],"tally":{"reached":0,...}}` (34796649291, 35035398099), at $111.70. The
  only issues came from a spec-conformance check retired in `ae777b0` on 09-16: 8 `spec/gap` issues
  from 6 runs, 2 closed completed (#573, #593), the rest not planned. The same head was reviewed
  twice 3 times ($3.55). 34 closed issues still carry `7-reviewing`.

### Upkeep

- **`session-captured` stopped on 2026-09-09.** Audit, Run watchdog and Walk home each last ran at
  2026-09-09T13:52:56Z (34359945529, 34359945485, 34359945137); no `session-captured` dispatch
  appears after that. The local hook log `~/.claude/session-capture.log` ends at
  2026-09-10T01:30:57Z, its recent entries mostly `skipped publish-out-of-scope`
  (`.claude/hooks/session-capture-hook.mjs:170-173`); the SessionEnd hooks now run from the
  workstation clone `~/.agents/workflow` (`192ae7a`). Why capture stopped writing entries was not
  established.
- **Audit:** useful test: the Ratify run it rang opened a ratifier PR that merged: 6 of 23. 13 runs
  were `skipped (corpus-missing)`. **Every one of the 23 working runs rang `ratification-due`**,
  because Audit never fetches `refs/ratifier/last` and counts released findings from the start of
  history (263-384), while Ratify, which does fetch it, counted 0-18 and stopped "not due" 17 times.
  59% of Audit's log lines are read-time "dropped PROPOSED finding ... as stale" and matching
  `fatal: path ... does not exist` lines (21,063 and 4,976), re-checking the same 33 old findings.
- **Ratify:** 7 PRs (#355, #359, #362, #363, #380, #386, #485), all merged within 4 minutes. One red
  run (33936870312) pushed the bookmark without `workflows` permission after its PR merged.
  **Five of the seven merges were never recorded** in `refs/notes/ratifications` because they
  merged before `da12474` added the `ratifier-merged` ring.
- **Ratify on PRD close:** 40 of 42 runs "out of scope"; #434 rang a Ratify run that became PR #485;
  #519's found nothing.
- **Record ratifications and Mechanic: zero runs.** Nothing rang `ratifier-merged` after 09-11 (no
  ratifier PR opened). Reconcile logged `dispatched rung implementer` 45 times, `fresh-eyes` 6 and
  `mechanic` 0 (`dispatch/reconcile.ts:733`), and no Implement run hit the `fails-rule-refused`
  path that also rings the mechanic.
- **Decline on revert:** 7 runs, "declined 0" each; the 09-16 run found all 7 ratified standards
  still in the tree.
- **Back-stamp:** 17 stamp commits covering 23 ADRs; 22 stamps still stand at `8587d4f`; the owner
  undid ADR-0094's in `8912a7a`.
- **Missing-trailer counter:** opened and closed #428 (real: the owner fixed 9 notes in `4f05c5c`);
  opened #569 plus 3 comments, which were false positives fixed in the counter itself (`4a24bf2`).
- **Bypass counter:** 195 of 196 runs below threshold, already proposed, or declined for good. The
  one issue (#414) was a re-file caused by the counter reading only the newest issues, closed not
  planned.
- **Run watchdog:** 36 of 36 runs `swept (all-lanes-live): 0 dead, 0 written`.
- **Walk home:** 4 working runs filed 7 issues; 2 led to merged fixes (#366, #390); #387-#389 were
  duplicates of #390.
- **Enrol:** all 21 runs rewrote secrets in each enrolled repo; 20 pushed caller-stub commits (19 to
  Lumaria, 14 to app-starter). Useful per run was not judged.

## Copied logic

Paths are under `.Workflow/agent-workflows/` unless they start at the repo root. Line numbers are
trunk 8587d4f. "Differs" names the place the copies already behave differently.

### Rebase, push and landing

| # | Logic | Copies | Where they already differ | What sharing one copy has to settle |
|---|---|---|---|---|
| C1 | Rebase onto trunk, abort on conflict | `shared/implementation-landing.ts:74-86` (implement, mechanic, acceptance landing); `fixer/fixer.ts:292-306`; `integrate/integrate.ts:186-206`; `shared/push-to-trunk.ts:14-26` (shape-accept via `shape/accept.ts:179-185`, back-stamp via `watchdog/back-stamp-walk.ts:70-74`) | Conflict: landing aborts, throws `RebaseConflictError`, labels the **ticket** `needs-human` assigned to `GITHUB_REPOSITORY_OWNER`, pushes nothing, so the model's commit dies with the runner. Fixer aborts, labels the **PR** `needs-human` assigned to `SIGNAL_ASSIGNEE`, runs no model. Integrate aborts, labels the ticket only if the PR body names one, comments on the PR, merges nothing. push-to-trunk runs `rebase` at line 17 outside any try: **no abort**, checkout left mid-rebase. No-conflict failure: landing and fixer treat it as a conflict (fixer with an empty path list); integrate rethrows **without aborting** (`integrate.ts:200`). Success: landing pushes plain with `--no-verify`; integrate pushes `--force-with-lease` before its gauntlet (`integrate.ts:204`); fixer pushes nothing until the model changes files. | Abort or not; what a pathless failure is; push after rebase or not; force-with-lease or not; escalate on ticket or PR, and which assignee variable |
| C2 | Fetch-and-retry push loop | `shared/push-to-trunk.ts:14-26` (5 tries, backoff, retries only the push); `shared/notes-sync.ts:12-40` (2 tries, no backoff, retries only `[rejected]`) | Retry count, backoff, which errors retry | One retry policy |
| C3 | Start from the ticket's branch if it exists | `acceptance/acceptance.ts:357-375` (asks `ls-remote --heads`, then `checkout -B branch origin/branch`); `shared/implementation-landing.ts:105-118` (tries `fetch implement/issue-N`, then `accept/issue-N`, `checkout -B work FETCH_HEAD`) | Acceptance surfaces an `ls-remote` or network error as a failed *push* (`acceptance.ts:478-487`, ticket back to `queued`); landing treats any fetch error, auth included, as "branch absent" and silently starts from trunk | Branch naming, and whether a fetch error is "absent" or a failure |
| C4 | Stop-on-conflict copied by reasoning | Commit `4a143b9` wrote landing's rebase "for the same reason fixer's own rebase step stops"; `shared/implementation-landing.ts:139` still cites "`fixer.yml`'s own rebase step", which no longer exists (moved into `fixer/fixer.ts` by `c7a6c2d`) | The reason text points at a deleted file | n/a (a stale citation, not code) |
| C5 | Open a PR, then dispatch Verify (create-only) | `shared/implementation-landing.ts:201-215` (sends ticket criteria); `ratify/land.ts:129-158` (sends `[RATIFIER_CRITERION]`); `fixer/fixer.ts:162-172` `rejudge` (re-reads criteria); `integrate/integrate.ts:376-401` `drainNextPr` | Integrate sends `criteria: []` (`integrate.ts:396`), which encodes to no criteria field at all, so a PR re-judged after a drain carries no criteria | Who owns the criteria payload |
| C6 | Push flags | implement and acceptance plain `--no-verify`; fixer and integrate `--force-with-lease`; ratify plain (`ratify/run-ratify.ts:122`); push-to-trunk plain | As listed | One push helper |
| C7 | Committer identity step | `shared/lane-wiring.ts:212-216` `IDENTIFIES_COMMITTER` (11 jobs); `shared/lane-wiring.ts:218-226` `CONFIGURES_COMMITTER` (shape-accept 450, back-stamp 1195) | Only `set -euo pipefail` | None; two names for one step |

### Model invocation, ladders and repair

| # | Logic | Copies | Where they already differ |
|---|---|---|---|
| C8 | Strike-marker parsing | Canonical `shared/strikes.ts:11-13`, `strikesIn` 76-89 (resets on `DECISION_MARKER`), used by acceptance (`acceptance/acceptance.ts:71-80`); own regex in `implement/implement.ts:302-313`; own regex in `mechanic/mechanic.ts:63,75-80`; `mechanic/mechanic.ts:247-253` duplicates `shared/strikes.ts:173-179` | Implement and mechanic **do not reset on an owner decision**, so a fresh-eyes or mechanic run is handed strikes from before the owner ruled; acceptance does reset |
| C9 | Repair round (resume the model after a refusal) | `implement/implement.ts:260-271` (1 round, then fresh eyes 276-285); `mechanic/mechanic.ts:213-227` (1 round, reuses `implement/implementer/repair.md`); `acceptance/acceptance.ts:418-435` (up to 3); `to-tickets/to-tickets.ts:60-76` (1) | Still refused: implement and mechanic push anyway and add `needs-human` (`shared/implementation-landing.ts:313-338`); acceptance requeues and strikes (400-403); to-tickets throws |
| C10 | Push-gate retry (`gateOnChanges`) | `implement/implement.ts:189-203`; `mechanic/mechanic.ts:148-157` | Only implement logs green / flake / red-twice |
| C11 | Closed-ticket guard | `implement/implement.ts:211-217`; `mechanic/mechanic.ts:182-186` | Log wording only |
| C12 | Tool fence for a model working in the target checkout | `shared/stage.ts:210-237` `CHECKOUT_SESSION_DENIED_TOOLS` (denies all `gh`, Agent, Task); `mechanic/mechanic.ts:32-56` `MECHANIC_DENIED_TOOLS` | Mechanic allows read-only `gh` subcommands and **does not deny Agent or Task**. Fixer (`fixer/fixer.ts:80-87`) runs in the target with no deny list |
| C13 | Calling Claude and budgets | Most lanes: `shared/stage.ts:384-407` `runStageSessionWithinBudget`. Audit builds its own argv (`observations/auditor.ts:18-35`: model alias `sonnet`, no budget, no schema; its `--output-format text` is stripped by `shared/stage.ts:95-105`) and computes the same session diff twice (`auditor.ts:39`, `:59`). `spec/reconcile.ts:52` has no budget. Budgets started with no ticket write no timeout strike: `spec/spec.ts:101`, `spec/sweep.ts:37`, `spec/critic.ts:54`, `ratify/ratifier.ts:19`; `review/refuter.ts:48` starts a second 11-minute budget after `review/review.ts:116` inside a 15-minute job | Budget, strike writing, model id form (`ratify/ratifier.ts:15` alias `opus`, others full ids) |
| C14 | Retry ladders | Strike ladder: `shared/strikes.ts` + reconcile `climbLadder` (`dispatch/reconcile.ts:841-880`); `shared/stage.ts:360-382` writes its own timeout strike; `shared/labels.cli.ts:17-26` requeues laddered lanes. Separate: fixer counts `fix: attempt N` commits, 3 max (`fixer/fixer.ts:178-243`); acceptance's 3 repair rounds | Three independent counters for "try again" |

### Reading what Verify judged, and talking to GitHub

| # | Logic | Copies | Where they already differ |
|---|---|---|---|
| C15 | Which PR and ticket a Verify run judged | Writer `integrate/immutability.ts:21-26` logs `judging <pr> on <branch>`. Readers: fixer, 95 lines of bash (`shared/lane-wiring.ts:788-883`, polls 30 x 10 s, own jq job match, strips `implement/issue-`); integrate (`integrate/integrate.ts:107-157`, `findJobByName`, polls 40 x 15 s). Ticket from PR three ways: `Ticket: #N` in the body (`integrate/integrate.ts:60-73`), `implementationBranchTicket` (`shared/ready-set.ts:28-36`), the bash strip; `integrate/integrate.ts:287` hardcodes `implement/issue-` | Poll budgets; a ratifier PR never matches the fixer's strip and has no `Ticket:` line |
| C16 | Standing signal issue (find by marker, comment / open / close) | `watchdog/lost-dispatch-counter.ts:47-51,74-116`; `watchdog/missing-trailer-counter.ts:49-53,71-118`; `watchdog/run-watchdog.ts:61-81,138-234`; `dispatch/reconcile.ts:509-585`; `implement/out-of-brief.ts:53-82` | Issues read (open 100 vs all 200); close never / no reason / `completed` only on a full window; assignee none / optional / required. New issue numbers parsed with `Number(url.split("/").pop())` (NaN on bad output) at lost-dispatch-counter 112, missing-trailer-counter 115, run-watchdog 227, bypass-counter 123, walk-home 237/253/266, where `shared/issue-url.ts` throws |
| C17 | Proposal counter (proposed / declined / not grown / propose) | `watchdog/bypass-counter.ts:86-125` (raw `gh issue list`, no `--limit`, so gh's default 30); `review/counter.ts:121-161` (`tracker.signals()`, all states, 200) | How many past issues are seen; not-planned test spelled twice |
| C18 | Needs-human writes | Shared `shared/needs-human.ts:6-16`. Inline: `dispatch/reconcile.ts:473` add, 253 and 498 remove; `shape/shape.ts:185-187`; `slice-failed` added both in TS (`shared/report-lane-failure.ts:89`) and bash (`shared/lane-wiring.ts:340-357`) | Assignee from `GITHUB_REPOSITORY_OWNER`, `SIGNAL_ASSIGNEE` (fixer throws if unset, integrate passes undefined) or none. A to-tickets refusal gets `slice-failed` **and** `needs-human` (`handsOver`, `lane-wiring.ts:291-301`) |
| C19 | Sending a dispatch | TS: `shared/dispatch-request.ts:12-23` -> `shared/tracker-gh.ts:192-203` (every payload value a `-f` string); bash: `shared/lane-wiring.ts:56,303-338` (`--input -`, JSON numbers) | The same spec-author payload arrives with `issue` as `"123"` or `123` depending on route |
| C20 | Gauntlet runners | `integrate/gate.ts:18-22` (`npm run check` from the machine root); `integrate/integrate.ts:411-421` `runGauntlet("push")`; `shared/run-gauntlet.ts:52-70` `venueVerdict` (implement, mechanic, acceptance); fixer judges green by vitest JSON alone (`fixer/fixer.ts:245-265`) | Implement and mechanic gate **before** rebasing; integrate gates **after**; fixer never runs the gauntlet |
| C21 | Failure hand-off and entry | `shape/shape.ts:80-84` byte-identical to `shared/handoff-path.ts:10-14`; shape (338-345) and to-tickets (276-282) catch and write the failure, then `shared/entrypoint.ts` does it again; 35 files hand-roll the `pathToFileURL` main guard; target dir spelled `TARGET_WORKSPACE \|\| cwd` in most lanes and `?? GITHUB_WORKSPACE ?? cwd` in `observations/run-ratification.ts:104`, `ratify/run-revert-detector.ts:75`, `watchdog/back-stamp-walk.ts:87`, `watchdog/missing-trailer-counter.ts:122` | `??` treats an empty string as set |
| C22 | Notes-ref fetch | `observations/run-audit.ts:42-46` duplicates `shared/notes-sync.ts:25-29`; ratify and record lanes fetch in bash with `\|\| true` (`shared/lane-wiring.ts:993-998`, 1058, 1081) | Error handling |
| C23 | gh / git / claude outside the shared seams | `shared/stage.ts:133` `execFileSync("git", ["rev-parse","HEAD"])` with no cwd (hashes the machine checkout, not the target); `shared/stage.ts:38` spawns `claude` with the full `process.env`, not `childEnv`; `shared/lane-map.cli.ts:24` its own gh wrapper | Environment and working directory |

jscpd did not flag any of these: its `minTokens 50` / `threshold 0` setting misses copies that differ
by a few tokens.

## Overlapping jobs

Each row is a candidate: what could merge, share or go, and what would break. Run counts are the
window's Actions API data (see [Method](#method)). A bare `:NNN` is a line of
`.Workflow/agent-workflows/shared/lane-wiring.ts`; other paths are under `.Workflow/agent-workflows/`.

| # | Overlap | Evidence | Candidate | What would break |
|---|---|---|---|---|
| O1 | **One label edit starts five workflows.** Shape, Shape-accept, Spec, Lost-dispatch counter and Dispatch reconcile all open on `issues labeled` | Doors: `shared/lane-wiring.ts:408`, `:438`, `:462`, `:928`, `:1138`. Of the window's label events, 144 started exactly those five runs and 14 more started two of each (runs.jsonl grouped by `created_at`). Shape, Shape-accept, Spec and Lost-dispatch counter each ran 214 times on `issues`; before 2026-09-12 GitHub skipped all five; from 09-12 all five started on 114 label edits, and the only work any of Shape, Shape-accept, Spec and Lost-dispatch counter did on them was Shape-accept's 3 label removals | One label router: a single `issues` workflow that reads the label and sender once and dispatches the one lane that wants it | Each lane's own door test (`spec/doors.ts:32-37`, `shape/doors.ts`, `dispatch/reconcile.ts:893-899`) would move into the router; per-lane concurrency groups keyed on the issue would have to be kept at the dispatched lane |
| O2 | **Back-stamp and Missing-trailer counter share one push door** | Identical `paths` (`shared/lane-wiring.ts:1162`, `:1184`); 53 runs each, one pair per push SHA. Neither did anything on 29 of the 53 pairs; Back-stamp worked on 17, the counter on 7, never both on one push | One job with two steps, or one lane | Back-stamp writes to trunk (`contents: write`, `:1185`), the counter only reads (`:1163`); a merged job needs the wider permission |
| O3 | **Four lanes hang off `session-captured`, which stopped arriving on 2026-09-09** | Audit (`:953`), Run watchdog (`:1093`), Walk home (`:1222`) and one reconcile door (`:928`). All 36 Audit / Run watchdog / Walk home runs fell between 2026-09-03T01:12Z and 2026-09-09T13:52Z. The local hook's log (`~/.claude/session-capture.log`) has no entry after 2026-09-10T01:30Z, and on its last two days a `skipped publish-out-of-scope` line follows most captures (`.claude/hooks/session-capture-hook.mjs:170-173`), after the hooks moved to the workstation clone (`192ae7a`, 2026-09-09) | Re-home the three sweeps on a schedule or on a lane ending they already have a reason to follow; or delete the ones whose job another lane now does (O4, O5) | Anything that needs the session's commit range (Audit reads `client_payload.head`, `:961`) has no schedule-shaped equivalent |
| O4 | **Three watchers file standing "something is stuck" issues** | Run watchdog (dead lanes, `watchdog/run-watchdog.ts`), Walk home (red runs in enrolled repos, `watchdog/walk-home.ts`), Lost-dispatch counter (unsliced PRDs, `watchdog/lost-dispatch-counter.ts`), plus reconcile's own unreachable report (`dispatch/reconcile.ts:509-585`), all with their own copy of the signal-issue logic (C16). Run watchdog wrote nothing in 36 runs; Lost-dispatch counter filed nothing in 96; Walk home filed 7 issues in 4 of 36 runs | One watchdog lane with several sweeps sharing one signal-issue helper | Their triggers differ (session end, label, reconcile pass); a merged lane needs one trigger that sees all of them |
| O5 | **Implement and Mechanic are one job with two prompts** | Same concurrency group `implement-${issue}` (`:631`, `:661`), same eleven steps (`:636-648` vs `:666-678`), same landing (`shared/implementation-landing.ts`), copied gate retry, guard and strike parsing (C8, C10, C11). Mechanic has **zero runs** in the window (no `mechanic-caller.yml` run in runs.jsonl) | Mechanic becomes a rung inside Implement (a prompt and tool-fence switch), not a lane | The mechanic's wider tool fence (C12) and its failed-log reading would have to be parameters |
| O6 | **Three "try again on red" loops for one ticket** | Strike ladder implementer -> fresh-eyes -> mechanic -> decision (`shared/strikes.ts:4`, `dispatch/reconcile.ts:841-880`); Fixer's own 3-attempt counter on a red Verify (`fixer/fixer.ts:178-243`); acceptance's 3 repair rounds (`acceptance/acceptance.ts:418-435`). Mechanic ran 0 times; Fixer ran 10 times after its move to dispatch, useful twice | One ladder that also owns a red Verify on an open PR | The fixer resumes an existing PR branch; the ladder today restarts from the ticket |
| O7 | **Verify and Integrate both wake on `implementation-opened`, and Integrate then waits for Verify** | Both doors on the same dispatch (`:687`, `:750`); Integrate polls the Verify run's job log 40 x 15 s (`integrate/integrate.ts:107-157`) instead of being rung by it; Verify separately rings Review and Fixer (`integrate/signal.ts`). 9 Integrate runs were cancelled while their Verify ran; 3 could not read Verify's log (PR 545) | Verify rings Integrate on green, the way it rings Review and Fixer | Integrate's single `integrate` concurrency group (`:756`) serialises merges; it would still need that |
| O8 | **Review runs after Verify but does not gate the merge** | Review wakes on `review-wanted` from a green Verify (`:901`); Integrate merges on the same green without waiting for Review. Review found zero correctness candidates in 77 finished runs ($111.70) | Keep Review as a post-merge finder (today), or fold it into Integrate as a gate, or replace it with a built-in (see [Built-in overlap](#built-in-overlap)) | Folding it in as a gate would add its 15-minute job (`:910`) to every merge |
| O9 | **The ratification loop is five lanes** | Audit rings `ratification-due` -> Ratify opens a PR -> Integrate merges -> `ratifier-merged` -> Record ratifications; Ratify on PRD close is a second ringer; Decline on revert watches for owner reverts (`:950-1088`). Record ratifications has zero runs in the window; Ratify's last run was 2026-09-12. Every working Audit run rang Ratify, which stopped "not due" 17 of 25 times; 5 of 7 ratifier merges were never recorded | One ratify lane with a closing step, rung by PRD close alone | Audit's per-session observations would need another producer, or go |
| O10 | **Bypass counter runs on every Verify** | `workflow_run` on Verify completed (`:1115`), 196 runs. It did work once, filing #414, closed not planned | A step at the end of Verify, or a daily sweep | Verify's permissions would need `issues: write` |
| O11 | **Acceptance has two jobs with different doors** | `refire` on `issues edited` (`:579-593`) and `author` on `acceptance-wanted` (`:594-609`); both jobs ran in 85 of the 149 logged runs, each deciding in TypeScript whether its door applies (job conditions moved out of YAML in `029a3e5`, `841a5f9`). The refire job re-fired nothing in the window | Two lanes, or the refire folded into the reconciler's recompute | The refire reads the edit's before-body (`github.event.changes.body.from`, `:581`), which only an `issues edited` event carries |
| O12 | **Reconcile's queue is mostly superseded runs** | 702 of 1787 reconcile runs were cancelled: the single `dispatch-reconcile` concurrency group (`:934`) keeps one pending run and cancels the rest. It wakes on 5 event kinds (`:928`). Of 1,036 logged runs, 673 wrote nothing a log shows and 209 only rewrote a spec-check comment nobody acted on | A debounce: ring reconcile only from lanes that change the ready set, drop the push and label doors that recompute nothing | A missed wake leaves a ready ticket idle until the next one |

## Built-in overlap

Every documentation claim below was read on 2026-09-16 from the cited page. "Covers" means the
feature does the lane's job as documented; "partly" names what it lacks.

| Lane | Closest Claude Code feature | Covers? | What the docs say | Gap that keeps the lane |
|---|---|---|---|---|
| 07 Review | **Code Review** (managed GitHub App) | Covers the job | "analyzes your GitHub pull requests and posts findings as inline comments"; triggers "Once after PR creation", "After every push" or "Manual"; findings "don't approve or block your PR"; tunable with `REVIEW.md` ([code-review](https://code.claude.com/docs/en/code-review#how-reviews-work), [setup](https://code.claude.com/docs/en/code-review#set-up-code-review)) | Team and Enterprise plans only, research preview; "Each review averages $15-25", billed as usage credits ([pricing](https://code.claude.com/docs/en/code-review#pricing)). The lane files finding issues and a refuter pass (`review/review.ts:108-125`); Code Review posts PR comments |
| 07 Review | **`/code-review` in GitHub Actions** (`code-review` plugin, `--comment`) | Covers the job | The documented workflow "installs the `code-review` plugin and runs its skill when a pull request is opened, updated, reopened, or marked ready for review" ([github-actions](https://code.claude.com/docs/en/github-actions#run-a-skill)); `/code-review` reports "correctness bugs" ([code-review local](https://code.claude.com/docs/en/code-review#review-a-diff-locally)) | Runs on the subscription token like the lane; "Claude skips ... pull requests it judges not to need a review, such as automated or trivial ones" (same page), and every PR here is machine-authored |
| 07 Fixer | **Auto-fix pull requests** (cloud sessions) | Partly | "Claude can watch a pull request and automatically respond to CI failures and review comments ... pushes a fix if one is clear" ([auto-fix](https://code.claude.com/docs/en/claude-code-on-the-web#auto-fix-pull-requests)) | Turned on per PR from a session or `/autofix-pr`, not by a workflow; needs the Claude GitHub App; "auto-fix can't react to conflicts on its own" (same section) |
| 05 Implement, 05 Mechanic | **Claude Code GitHub Actions** (`anthropics/claude-code-action`, automation mode) | Partly | "Use it to turn issues into pull requests"; with a `prompt` input "Claude runs without waiting for a mention" ([github-actions](https://code.claude.com/docs/en/github-actions#interactive-and-automation-modes)) | "rejects a bot actor unless you list it in `allowed_bots`" (same page, "Who can trigger runs"): every Implement run here is started by the reconciler's bot dispatch. The action has no ticket brief, strike ladder, file claims or landing; those are the lane's own code |
| 01 Shape, 02 Spec | **claude-code-action `label_trigger`** | Partly (trigger only) | `label_trigger`: "The label name that triggers the action when applied to an issue" ([usage.md](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md)) | Replaces the door, not the lane's prompts, sheet rendering or critique rounds |
| Run watchdog, Walk home, Bypass / Lost-dispatch / Missing-trailer counters | **Routines** (scheduled) | Partly | Schedule, API or GitHub triggers; "The minimum interval is one hour"; runs "as full Claude Code cloud sessions" ([routines](https://code.claude.com/docs/en/routines#add-a-schedule-trigger)) | GitHub triggers cover only "Pull request" and "Release" events ([supported events](https://code.claude.com/docs/en/routines#supported-events)), so no `issues`, `push` or `repository_dispatch` door; a routine spends a model where these lanes are deterministic TypeScript; daily run cap ([usage and limits](https://code.claude.com/docs/en/routines#usage-and-limits)) |
| 03 To-Tickets, Audit, Ratify (fan-out model work) | **Dynamic workflows** | Partly | "A dynamic workflow is a JavaScript script that orchestrates many subagents ... a runtime executes it in the background while your session stays responsive" ([workflows](https://code.claude.com/docs/en/workflows)); in `claude -p` the Workflow tool goes through normal permission evaluation (same page) | A session feature, not a CI trigger; the lane would still need a runner to host `claude -p` |
| 02 Spec, 03 To-Tickets (session side) | **Subagents / agent teams** | No | Subagents run "in isolated context windows"; agent teams are "experimental" and need `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` ([agent-teams](https://code.claude.com/docs/en/agent-teams)) | Both live inside one session; neither is a pipeline stage |
| 04 Dispatch reconcile, file claims | **Worktree isolation** | No | "`--worktree` ... create an isolated worktree"; subagents can take `isolation: worktree` ([worktrees](https://code.claude.com/docs/en/worktrees)) | Isolates edits on one machine; does not schedule tickets by claimed files or stop two PRs conflicting on trunk |
| 08 Integrate | none | No | No first-party auto-merge or merge queue found in the docs index ([llms.txt](https://code.claude.com/docs/llms.txt)); Code Review's check "always completes with a neutral conclusion so it never blocks merging" ([check run output](https://code.claude.com/docs/en/code-review#check-run-output)) | n/a |
| 06 Verify, Shape-accept, Back-stamp, Enrol, Decline on revert, Record ratifications, Ratify on PRD close | none | No | These run no model; no Claude Code feature is a CI gate or a git writer | n/a |
| Audit (session capture) | **SessionEnd hook** | Already used | The lane is fed by a SessionEnd hook ([hooks](https://code.claude.com/docs/en/hooks)) | n/a |
| Model spend in every model lane | **`total_cost_usd`** in headless output | Already used | "the response payload includes `total_cost_usd` ... Both figures are client-side estimates" ([headless](https://code.claude.com/docs/en/headless)) | n/a |
p='/tmp/claude-1000/-home-collin-Claude-Projects-Workflow/995b24a0-5472-410d-80e8-e89edcddaf01/scratchpad/census/assembled.md'
s=open(p).read()
a="Each of the five callers ran 214 times on `issues`; "
assert a in s
s=s.replace(a,"Shape, Shape-accept, Spec and Lost-dispatch counter each ran 214 times on `issues`; ")
b="and its last dozens of entries are `skipped publish-out-of-scope`"
assert b in s
s=s.replace(b,"and on its last two days a `skipped publish-out-of-scope` line follows most captures")
s=s.rstrip()+'\n'+open('/dev/stdin').read()
open(p,'w').write(s)

## Candidates by measured volume

Not a ruling and not a priority: the candidates above, ordered by how many runs, dollars or owner
stops the window shows behind each. "Breaks" repeats the row it came from.

| Candidate | Kind | Volume in the window | From | Breaks |
|---|---|---|---|---|
| One shared rebase-and-land step with one conflict outcome | share | 12 green Implement runs discarded ($50.31), nine rebuilt by hand on 09-16; 5 Acceptance land pushes lost the race; 2 Integrate gauntlet-red-after-rebase; 1 Integrate force-with-lease crash | C1-C3, C6 | Four callers disagree on abort, push and escalation target |
| Debounce the reconciler to the events that change the ready set | merge doors | 1,787 runs: 702 cancelled, 673 wrote nothing, 209 rewrote an unused spec-check comment | O12 | A missed wake leaves a ready ticket idle |
| One label router for the five `issues labeled` lanes | merge doors | 1,129 `issues`-woken runs (Shape, Shape-accept, Spec, Lost-dispatch counter 214 each, reconcile 273); outside reconcile the only work was Shape-accept's 3 label removals | O1 | Door tests move; per-issue concurrency moves |
| Replace or delete Review | delete / built-in | 78 runs, $111.70, zero correctness candidates; 2 useful issues from a check since retired | O8, Built-in overlap | Code Review is Team/Enterprise only; `/code-review` in Actions skips automated PRs |
| Re-home or delete the `session-captured` lanes (Audit, Run watchdog, Walk home) | delete / re-trigger | Door closed since 09-09; Run watchdog 36/36 no-ops; Audit over-rang Ratify 17 times | O3, O4, O9 | Audit needs a session's commit range |
| Fold Mechanic into Implement as a rung | merge | 0 Mechanic runs; 295 code lines with copied gate, guard, strike parsing | O5, C8, C10-C12 | Tool fence and failed-log reading become parameters |
| Collapse the ratification loop | merge / delete | 5 lanes; 7 ratifier PRs in 14 days; Record ratifications 0 runs; 5 of 7 merges unrecorded; Decline on revert 7/7 no-ops | O9 | Audit's per-session observations lose their consumer |
| Delete or re-time Bypass counter | delete | 196 runs, 195 no-ops, 1 issue closed not planned | O10, C17 | Verify would need `issues: write` if folded in |
| One signal-issue helper for the watchers | share | 5 copies with different close and assignee rules; NaN issue numbers in 5 places | C16 | Callers' close semantics differ |
| Merge Back-stamp and Missing-trailer counter | merge | 53 paired runs, 29 where neither acted | O2 | Counter gains `contents: write` |
| One strike parser | share | 3 spellings, 2 ignore owner decisions | C8 | Implement and mechanic would start honouring decisions |
| Ring Integrate from Verify instead of polling | share | 9 Integrate runs cancelled, 3 unreadable Verify logs | O7, C15 | Integrate's merge serialisation stays |

## What this could not verify

- **Why session capture stopped writing.** The hook log ends 2026-09-10T01:30:57Z; the hooks moved to
  `~/.agents/workflow` the day before. The mechanism was not traced.
- **Model spend is an estimate**, summed from log lines, and misses runs whose model step logged no
  result line (six Acceptance runs on 09-11 have only their Land job's log). One To-Tickets run
  (34662511401) may count a repeated `$1.4339` line twice.
- **Useful is a lower bound where the log is silent.** Reconcile relabels without logging; Enrol's
  per-run value was not judged; Spec critiques on #433 and #519 may have been read without leaving a
  trace; review `spec/gap` issues were matched to runs by timestamp.
- **Lines of code are split by file** where lanes share a directory (integrate/, ratify/,
  observations/, watchdog/, shape/); shared modules are not attributed to any lane.
- **Built-in overlap is read, not run.** No routine, Code Review install or auto-fix session was
  tried; plan limits, bot-actor handling and costs are as the docs state on 2026-09-16.
- **The `claude-code-action` usage page** is on github.com, not code.claude.com; it is Anthropic's own
  repository.
