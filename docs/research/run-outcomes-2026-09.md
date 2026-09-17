# Which work reached merged smoothly, which stalled, and why

Researches: collod873/claude-workflow#649

Window 2026-09-02 to 2026-09-16 (UTC; data pulled 2026-09-17 02:44Z, trunk `8587d4f`). Feeds the
**Runs** question of map #646, and **Lanes** where a lane is the cause. Facts and candidates, no rulings.

## Summary

- **Ticket door** (`ticket` label, 102 issues): lane 08 merged 51. 29 of those 51 ran clean (no
  `needs-human`, no strike, no failed acceptance run, no close refusal, one implementer answer, one
  PR), with a median
  of **23 minutes** from the first lane label to merge. The other 51 closed another way: 40 were
  built in a session with no PR (11 of them `by-hand` by rule), 8 were merged or rebuilt by the
  owner, #423 and #539 were superseded or replaced, and #538 is still open. The door has a hand step the map's description leaves out. `to-build`
  is applied separately from filing, and 29 of the 51 lane-merged tickets waited more than five
  minutes for it (median 2h02m, longest 26h34m on #576).
- **Spec door** (6 PRDs, 43 children): the slicer (lane 03) ran 11 times and finished green once
  (#434, on its second run). #491 and #538 had their children published by hand, and #392, #433 and
  #519 were built by hand. Of the 43 children, lane 08 merged 31 (21 clean), 9 were stranded and
  landed by hand in #634, and 3 closed in a session.
- **Top stop and dead-run classes** (full table below):
  - Owner sessions pushed **265 commits straight to main** (243 touching code), and 17 of those
    pushes turned Verify red on trunk.
  - `bin/close-ticket` refused **15 times** after lane 08 had already merged. The ticket stays open,
    so the lanes run again on merged work.
  - The acceptance author died **13 times**, and 4 tickets reached the three-strike
    stop.
  - The implement lane threw away **12 finished runs** on its pre-push rebase, 9 of them in #538's
    wave.
  - Lane 03 failed or refused a slice **10 times**, 6 of them for a path that was not rooted.
  - Acceptance was still red after its repair round **8 times**. Its landing conflicted with a
    sibling **7 times**, none of them after PR #454.
  - Most of these a machine could have resolved from one fact it already had: which files a live
    run holds, whether the ticket's PR has already merged, the repo tree to root a bare filename,
    or whether a check marker runs in this repo.
- **What smooth runs shared:**
  - A claim no live sibling was also editing.
  - Check markers that run in this repo (vitest, grep).
  - The ticket was fired by the session that wrote it, within minutes.
  - The fix for their failure class had already landed.
  - Neither concurrency nor claim size set clean runs apart. Eight siblings of #491 ran together
    clean, while the nine #538 casualties each claimed 3 to 8 files.

## How this was traced

- Issues created in the window (`gh issue list --search created:>=2026-09-02`, 197 issues). Each
  issue's full timeline came from `gh api repos/collod873/claude-workflow/issues/N/timeline`:
  labels with actor and time, lane comments, closes, cross-references.
- PRs created from 2026-09-01 (137) and their timelines.
- Actions runs fetched one day at a time (5,179 runs, `gh api .../actions/runs?created=2026-09-DD`).
  From 2026-09-06 onward, Acceptance and Implement runs carry `#N` in the run name. Before that
  date a run is tied to a ticket only through a lane comment that names it.
- `git log origin/main --first-parent --since=2026-09-02` (469 commits), and push-event runs on
  main for the push count.
- **Door**:
  - *Spec* = the issue body carries `## Parent PRD`, plus the PRDs themselves.
  - *Ticket* = the `ticket` label (applied by `file-issue ticket`, `bin/file-issue:11`).
  - *Walk home* = a `collod873/Lumaria:` title filed by the sweep.
- **Fired** is the first `to-build` label for the ticket door and publication for spec children.
  **Active** runs from the first lane label (`running`, `4-accepting`, `5-building`) to the first
  merge.
- **Owner stop** = a `needs-human` or `by-hand` label, a lane refusal no lane reads, or a hand
  action the timeline shows was needed to move the ticket.
- **Thrown-away run** = a lane run whose output did not land (conflict abort, strike, a run on work
  that had already merged, a nothing-to-build loop).
- Other entry points (the #397–#410 notes from `/drain`, the review lane's `spec/gap` findings,
  the counters' issues, the map's own children) are not traced per row. Where they explain a stop,
  they are counted in a class.

## What the smooth runs shared

**The clean set.**

| Door | Lane-merged | Clean | Active, clean (median, range) | Active, not clean (median) |
|---|---|---|---|---|
| Ticket | 51 | 29 | 23m (4m–51m) | 56m |
| Spec child | 31 | 21 | 36m (16m–2h57m) | 2h37m |

The fastest: #372 (5m after firing, PR #376), #390 (9m, PR #391), #367 (11m, PR #368), #421 (13m,
PR #422), #473 (13m, PR #475), #373 (14m, PR #377), #437 (17m, PR #447), #483 (17m, PR #486), #448,
#461 (19m each), #472 (21m), #479, #582 (23m each), #474, #555 (24m each), #532, #603 (25m each).

**What they had in common.**

1. **No live sibling was editing the same file, claimed or not.**
   - #471–#474 fired within 8 minutes of each other on 09-11 and all merged clean in 13–28m.
   - #497–#504, eight #491 children published together, each touched a different lane file
     (two claimed files apiece), and all eight were clean.
   - On 09-16, #624, #608 and #620 were building alongside the nine that died.
   - #624 claimed only `acceptance/acceptance.ts` and its test, yet its PR #631 also edited
     `shared/tracker.ts`, `tracker-gh.ts` and `tracker-memory.ts`. It merged first, at 20:34.
   - #608 (PR #632) and #620 (PR #633) touched `tracker.test.ts` and `gh.ts`.
   - The nine grew the same unclaimed tracker files (PR #634's body) and hit the conflict at their
     pre-push rebase after #631–#633 merged.
   - Being clean in that wave depended on merging first, not on a disjoint claim. The variable was
     edits outside the claim, not concurrency.
2. **Small, but size did not separate the groups.**
   - Clean ticket-door runs claimed a median of 4 files and changed 4. Runs that were not clean
     claimed 4.5 and changed 6.
   - Clean spec children claimed 4; spec children that were not clean claimed 3.
   - #607 claimed 8 files and merged clean in 38 minutes.
   - The one size failure was prompt size, not file count. #539 inlined 92 KiB of claimed files
     into the acceptance author, whose first pass took 17.3 of a 24-minute budget (owner comment
     on #539).
3. **Check markers that run on the runner.**
   - Clean runs used `npx vitest run`, `grep`/`test`, or `python3 .claude/hooks/test_*.py`
     (unittest) markers.
   - Every close refusal over a marker named one of these:
     - `python3 -m pytest` (#425, #579)
     - a workstation file under `$HOME` (#374)
     - a `hooks/test_*.py` glob (#402)
     - a grep that could not match its own criterion (#342)
     - no marker at all (#366, twice)
   - Acceptance also died on #441, whose check named a Python file the author's rules forbid it to
     write (owner comment on #441).
4. **Fired by the session that wrote them, straight away.**
   - 22 lane-merged tickets were fired within 5 minutes of filing, and 15 of them ran clean.
   - The ticket-door tickets with the longest filed-to-merged times lost their time before firing,
     not in the lanes:
     - #576 and #578: 26h waiting, then 30m and 1h05m in the lanes.
     - #582 and #583: 8h waiting, then 23m and 37m.
     - #584–#587: about 11h waiting each.
5. **The machine fix for their failure class had already landed.**
   - Acceptance landing conflicts (7) all fall on or before 09-10 22:57. None followed PR #454
     (merged 09-11 00:08).
   - Recover-lane give-ups (#371) and fixer crashes (#344, #345, #348, #351, #358) appear only
     between 09-02 and 09-04.
   - Nothing-to-build loops (#570, #521) stopped after `e16f162` (#574).
   - Each batch of clean runs came after the fix for the failure class the previous batch hit.

**What did not separate them.**

- **Time of day.** Clean runs were fired at every hour from 00 to 23 UTC.
- **Lane path.** Before 09-12 the path was `to-build › running`. From 09-13 on, every lane-merged
  ticket, clean or not, followed `to-build › 4-accepting › 5-building › 8-landing › 7-reviewing`.
  Review runs after the merge, so it never gates.
- **Clean does not mean fast.**
  - Four of #491's children were clean but each took 2h36m–2h57m. Integrate's `concurrency` group
    keeps one pending run, so five dispatches were cancelled (runs 34633753862, 34633769617,
    34633805863, 34633844800, 34633846882). PRs #509–#513 sat unmerged until a session re-sent
    each dispatch by hand (#516's body).
  - Spec children behind a blocker queue before they start. #628 and #629 waited 5h42m and 6h31m
    before their first lane label, then ran 47m and 34m.

## Stops and dead runs by cause

"Machine?" asks whether a machine could have resolved the stop without the owner, and what it would
have needed to know. **Yes** means the fact was already on hand to the machine. **Partly** means
one sub-case needed a decision or a filing-time check. **No** means a rule puts a human there.

| # | Class | Events (tickets) | Evidence | How it ended | Machine? What it needed |
|---|---|---|---|---|---|
| 1 | **Direct pushes to main that bypassed the pipeline** | 265 commits (193 distinct pushed heads); 243 touch code, 22 docs-only | `git log --first-parent --no-merges --committer=collod873`; by day 09-02: 44, 09-03: 61, 09-11: 28, 09-13: 25, 09-16: 17. 17 push-event Verify runs on main went red after a direct push (e.g. 33784996782, 33890957985, 34630928220) | Owner sessions. Examples answering a pipeline stop: `8587d4f` (#629's close refusal), `4598bea` (trunk red after #566), `a39e255` (lane 08 refused #545), `4a5e9f2`, `e5e2ae5`, `69cc62a` (lane 03 refused #538), `f4378e7` (restored 69 tests the acceptance author deleted), `e16f162` (#570's loop), `f41a15c` (#538's refused plan). Most of the rest built the machine itself | **Partly.** The subset that repairs a stop is the machine's own work routed around the doors. Classifying all 265 by trigger was not done (see Not verified) |
| 2 | **Owner merged a PR, or landed work outside lane 08** | 25 PRs merged by `collod873`: 4 were machine PRs (#328, #358, #545, #566), and lane 06/08 had refused the last 3 of them. #634 merged 68 files and closed 9 tickets with no Verify or Review run on its branch; Verify ran green on main after the merge (35161165733) | `mergedBy` on `gh pr list`; PR #634 timeline. Verify went red on main after the #566 merge (run 35006830758) and after #393 and #394 | Owner | **Partly.** #566: lane 08's re-run gauntlet was red because a generated `docs/adr/INDEX.md` was stale, which a regenerate fixes (`4598bea`). #545: see class 7 |
| 3 | **`bin/close-ticket` refused after lane 08 merged** | 15 (14 tickets) | "Lane 08 merged … could not close this ticket" on #342, #366×2, #374, #382, #402, #425, #463, #521, #533, #557, #579, #617, #619, #629 | **Marker unrunnable or wrong (7):** #342 (grep could never match), #366×2 (no markers), #374 (`$HOME` path), #402 (`hooks/test_*.py`), #425 and #579 (pytest); owner fixed the marker or closed by hand. **Work incomplete by its own check (8):** #382 and #557 (`test.fails` left), #463, #521, #533, #617, #619, #629; the machine re-ran and closed #557, #617, #619 and #521; the owner closed #382, #463 and #533, and #629 after pushing `8587d4f` | **Yes** for the incomplete-work half: the next implement run needs the failed criterion and "this ticket's PR already merged" (#617 and #619 show it working). **Partly** for markers: they have to be proven runnable at filing, not after merge. The refusal also triggers class 10 |
| 4 | **Acceptance author died or struck out** | 13 death notices on 7 tickets; three-strike stop on 4 (#539, #579, #585, #600) | #539: 34739391418 and 34760771669 timed out at `author-repair`, 34761961581 cancelled. #579: 34900758588, 34903545475, 34904983112 (the file returned with 2 test cases where 3 were on disk). #585: 35044941524, 35045442799, 35046003084 (a `reconcile.test.ts` returned with 1 of 75 cases). #600: 35105447742 and 35113330715 timed out, 35114787250 cancelled. #441×2: "author wrote no test file" (a Python check). Single strikes the ladder cleared: #493, #533, #544, #557, #577, #584, #587 | Ladder cleared the single strikes. Three-strike stops: #539 was split by hand into #541–#544; #585 and #600 were re-fired by the owner after fixes (`2cfdfdc` stops retyping shown files); #579's strikes were on work lane 08 had already merged, and the owner closed it | **Yes** for #579 (needed: the PR merged). **Yes** for the truncated-file deaths once the author stops returning whole files. **Partly** for #539: a claim whose inlined size exceeds the author budget should be sliced before firing. The eight-file ceiling (`5c544a7`) counts files, not bytes |
| 5 | **Implement pre-push rebase conflict: green work discarded** | 12 (12 tickets) | The nine #538 children: runs 35145650903 (#627), 35145839368 (#609), 35145897065 (#618), 35146103754 (#612), 35146177209 (#625), 35146180674 (#621), 35146291735 (#626), 35146362705 (#623), 35146445830 (#615), all concluding `success`. Plus #342 (33704125793), #570 (34882369455; `.gitignore`, `CLAUDE.md`, `README.md` against a shallow start, fixed by `7abef7b`), #533 (34738932250, which started after the PR merged) | #342: owner re-dispatched ("a race, not a defect"). #570: owner re-fired after `7abef7b`. #533: owner had already closed it. #538's nine: rebuilt from run transcripts into #634 | **Yes.** Acceptance tests survived on `accept/issue-N`, so a fresh implement run on new trunk was all it took. Knowing which files live runs hold (none claimed the tracker files) would have serialized the nine. #533 needed only "ticket closed / PR merged" |
| 6 | **Lane 03 refused or failed a slice** | 10 of 11 To-Tickets runs | Path not rooted: 34535319465 (#434), 34616814332 (#491), 34768264973, 34775900924, 34777528784, 35133339528 (#538). Claim over the 8 ceiling: 34765269899 (#538). Placeholder slice: 34534729757 (#433). Immutable claim: 34662511401 (#519). Cancelled: 34660564916 (#519) | #491 published by hand from the audited checkpoint, "unchanged except that slices 3–12's `shared/…` paths are now rooted" (owner comment). #538 published by hand on 09-16 19:29. #519 and #433 built by hand. #434 went green on a parallel second run | **Yes** for rooting (6): resolve a bare name against the repo tree. `f41a15c` now returns a refused plan to the writing session for one repair round. **Partly** for the ceiling (re-slice). **No** for the immutable claim (by rule) |
| 7 | **Lane 06/08 refused a PR** | 11 PRs, 17 comments | Fixer era, 09-02 to 09-03: PRs #344, #345, #348, #351, #352, #354, #358 ("the fixer itself failed", 20-minute step cap per owner comment on #349). "Lane 06 left no immutability verdict": #540, #545×3. Immutability failed: #525×2. Re-run gauntlet red after rebase: #566 | Owner merged #344, #345, #358, #525, #545, #566. Machine merged #348, #351 (after the owner removed a fixer marker), #354, #540 | **Yes** for "no verdict": a lookup bug that swallowed its own failure (`a39e255`, `65abf4f`). **Yes** for #566 (generated file). **No** for #525 (immutable set). Lane 08's text still says "nothing retries this on its own" (`integrate/integrate.ts:167`, `:224`) |
| 8 | **Acceptance batch red after its one repair round** | 8 (8 tickets) | #440, #442, #443, #444 (runs 34538913436, 34538914915, 34538911656, 34538912186): the author stubbed a `.claude/hooks/` file the roster check refuses. #423 (34524061046): the check named pytest. #494 (34626064001): lint red on the batch. #496 (34624438780): tests "already pass", vacuous or work done. #544 (34774340201) | #440–#444: owner "Waiting on #448 by design, not on a human judgement", then lifted by hand after #448 landed. #423 superseded by #434. #494 and #496 closed in a session. #544 cleared by the ladder | **Yes** for #440–#444: a blocker in flight named the cause, so wait on it. **Partly** for #423 and #496 (a marker or vacuity check at filing) |
| 9 | **Acceptance landing conflict with a sibling's just-landed test** | 7 (7 tickets) | #387, #388, #389 (34062525714, 34062525783, 34062525650); #423, #424, #425 (34517030775, 34517030074, 34517029691); #439 (34538910814) | Owner lifted #439 by hand; #424 and #425 re-fired; #387–#389 closed as duplicates after 2d15h | **Yes**, and done: PR #454 re-authors once. No event after 09-11 00:08 |
| 10 | **Lane runs on work that already merged or closed** | 6 tickets, 8 runs | #629: acceptance 35175054220 and implement 35175347002 after PR #651 merged. #579: acceptance 34903545475 and 34904983112 after PR #581. #533: implement 34738932250. #521: implement 34717395151 (nothing to build) plus a strike. #617 and #619: second acceptance+implement (these produced PRs #643 and #639) | Mostly the owner closing the ticket | **Yes**: reconcile needed "this ticket's PR merged, and close-ticket named criterion X", then run only if X is buildable |
| 11 | **Spec lane (lane 02) died** | 2 | 34417954793 (#392, cancelled), 35103742660 (#538: a ticket widened to a spec had no collector) | Owner: #392 built by hand, #538 re-routed | **Yes** for #538 (the collector, #600). **No** for #392 (cross-repo, by the owner's own comment) |
| 12 | **Spec check unrunnable** | 1 | #538 at 09-16 19:38: "its body carries 7 acceptance criteria, and this pass can only run one" | Still labelled `needs-human` | **Yes**, given a runner for more than one criterion |
| 13 | **Implementer answered nothing, rung again** | 2 tickets, 5 runs | #570: 34878888526, 34878990599, 34879084342, 34879187574 in 3 minutes, then the owner hand-applied `needs-human`. #521: 34717395151 | `e16f162` (#574) holds such a ticket | **Yes**, done |
| 14 | **Integrate's pending run cancelled, PRs stranded** | 5 PRs (#509–#513) | Runs 34633753862, 34633769617, 34633805863, 34633844800, 34633846882 cancelled within a second | Session re-sent each dispatch by hand; #516 fixed it in a session | **Yes**: find the next open `implement/issue-*` PR after each run (#516's design) |
| 15 | **Implement refused its own push** | 1 | #490, run 34705588650: "changed an acceptance test it is judged by" | Owner re-pushed the branch the next day (PR #523) | **Partly**: a repair round against the rule, rather than a stop |
| 16 | **Recover lane gave up / refused** (retired) | 2 | #371: 33910985030, 33911063376, 33911131001, 33911211031, each ended with no answer. #329: the answer wrote into the immutable set | Owner | Era over: the Recover lane no longer exists |
| 17 | **`by-hand` by rule** | 12 tickets | #471 (label later replaced by `to-build`), #480, #489, #520, #522, #534, #535, #537, #550, #558, #568, #575 | Session | **No** by rule (immutable set, workstation, cross-repo). Median filed-to-closed 1h47m |
| 18 | **Owner fire wait** (not a lane stop) | 29 of 51 lane-merged tickets waited >5m | Median 2h02m. #576 26h34m, #578 26h17m, #490 24h44m, #412 15h49m, #382 11h23m, #584/#585/#586 10h57m | Owner applies `to-build` | Not a machine question. The map's ticket door has no separate fire step |
| 19 | **Walk-home misfiles and duplicates** | 8 issues | #336–#340 misfiled, closed within 6 minutes. #387–#389 duplicates open 2d15h ("same machine SHA, same failing step", owner comment) | Owner | **Yes**: dedupe on machine SHA + failing step, and match the path to the machine checkout |
| 20 | **Review findings with no reader** (`spec/gap`) | 8 issues | #527, #528, #529, #548, #573, #591, #593, #594 | Owner closed all 8; route retired in `ae777b0` | Route retired |

**Why no watchdog saw class 5.** Re-checked on `8587d4f`:

- `implement/implement.ts:342` maps `rebase-conflict` to `failed: false`, so the run ends
  `success`. All nine #538 runs show `success`.
- `integrate/integrate.ts:466` sets a failing exit code only when the reason is not `conflict`.
- `watchdog/dead-lanes.ts:32` considers only `conclusion === "failure"`.

## Charting evidence, re-checked

| Claim at charting (#649 body) | On trunk `8587d4f` |
|---|---|
| 12 implement runs started at once for #538's children | Confirmed. Implement runs for #624, #608, #620, #627, #609, #618, #612, #625, #621, #626, #623 and #615 were created 20:14–20:25 UTC on 09-16, with #607 already merged at 20:08 |
| Nine runs died 20:36–20:58, pushed nothing, labelled `needs-human` | Confirmed from label events. Run conclusions are `success` |
| Pre-push rebase at `implementation-landing.ts:99` | Moved to `shared/implementation-landing.ts:74-86` (`rebaseOntoTrunk`). Implement passes `{ rebaseOntoTrunk: true, skipPushHook: true }` at `:331` |
| Ratify's narrow fix `alignImmutableSetWithTrunk` (ADR-0138) | `ratify/land.ts:104`, called at `ratify/run-ratify.ts:121` |
| Acceptance rerun commits onto the old branch (`acceptance.ts:360`) | Now `acceptance/acceptance.ts:361-365` (`commitAuthoredBatch`: "already on origin, so this batch is committed on top of it") |
| Lane 08: "Rebase it by hand; nothing retries this on its own" | `integrate/integrate.ts:224` (`blockOnConflict` at `:208`) |
| #634 merged 68 files by hand, no checks or reviews, closed nine tickets | Confirmed: 68 changed files, merged by `collod873` at 23:11 on 09-16, body `Closes` #609 #612 #615 #618 #621 #623 #625 #626 #627. No Verify or Review run on the branch; push-event Verify on the merge was green (35161165733) |
| Three shared files still built `gh api` argv | Fixed after charting, directly on main in `8587d4f`: walk-home, the lost-dispatch counter and lane 08's branch retirement. `deleteBranch` joined the port |
| 3 of about 36 Tracker operations had a contract case | `shared/tracker.ts:110-147` declares 36 operations. `shared/tracker.test.ts` has 5 tests, covering `workflowRuns`, `jobs`, `jobLog` and `deleteBranch` (4 operations). Duplicate operations not re-checked |

Side finding for the Upkeep question: `docs/agents/lane-map.md` reports Implement, Acceptance,
Fixer and Audit as "never fired" in this same window. The Actions API shows 138
`implement-caller.yml`, 195 `acceptance-caller.yml`, 150 `fixer-caller.yml` and 47
`audit-caller.yml` runs. For Implement and Acceptance the cause is confirmed: `tallyRuns` matches a
run's name exactly against the lane name (`shared/lane-map.ts:351-358`), and those runs are named
`Implement #N` and `Acceptance #N`. The cause for Fixer and Audit was not checked.

## Every traced piece of work

Times are UTC. **Claimed** is the number of `## Files claimed` bullets.

- **Runs** gives Acceptance and Implement runs named for the issue (`A`/`I`, counting dispatches
  only), then the PRs. "pre-name" means the runs predate `#N` run names and are attributed through
  comments only.
- **needs-human** counts that label's applications.
- **Path**:
  - *pipeline*: lane 08 merged it.
  - *session, no PR*: closed with a closing record and commits pushed to main.
  - *stranded → #634*: rebuilt by hand.

### Ticket door

| # | Path | Claimed | Filed→fired | Fired→merged/closed | Filed→merged/closed | Runs (acc/impl, PRs) | needs-human | Other stops | Thrown-away runs |
|---|---|---|---|---|---|---|---|---|---|
| #329 | session, no PR | 5 | 2h56m | 37m | 3h33m | 0 | 1 | – | – |
| #331 | session, no PR | 13 | – | – | 44h28m | 0 | 0 | – | – |
| #334 | owner PR, owner merged | 8 | – | – | 3h16m | pre-name, PR #345 | 1 | lane 06/08 refused×2 | – |
| #335 | session, no PR | 13 | – | – | 41m | 0 | 0 | – | – |
| #342 | pipeline | 7 | 48m | 5h17m | 6h06m | pre-name, PR #354 (+#352 closed) | 1 | impl timeout, impl rebase conflict, lane 06/08 refused×2, close-ticket refused | 1 impl cancelled at cap (33687023105), 1 impl conflict (33704125793), PR #352 |
| #343 | owner PR, owner merged | 3 | – | – | 31m | pre-name, PR #344 | 1 | lane 06/08 refused×2 | – |
| #346 | pipeline | 4 | 1m | 1h19m | 1h20m | pre-name, PR #348 | 1 | lane 06/08 refused | – |
| #347 | session, no PR | 4 | – | – | 38h13m | 0 | 0 | – | – |
| #349 | pipeline | 3 | – | – | 2h20m | pre-name, PR #351 | 1 | lane 06/08 refused | – |
| #350 | session, no PR | 3 | – | – | 42m | 0 | 0 | – | – |
| #353 | session, no PR | 2 | – | – | 35h08m | 0 | 0 | – | – |
| #356 | session, no PR | 4 | – | – | 12m | 0 | 0 | – | – |
| #357 | fixer gave up, owner merged | 8 | 0m | 1h20m | 1h20m | pre-name, PR #358 | 1 | lane 06/08 refused×2 | – |
| #360 | session, no PR | 20 | – | – | 1h57m | 0 | 0 | – | – |
| #361 | session, no PR | 2 | – | – | 20h00m | 0 | 0 | – | – |
| #364 | session, no PR | 3 | 1h34m | 2h01m | 3h36m | 0 | 0 | – | – |
| #367 | pipeline | 3 | 0m | 11m | 11m | pre-name, PR #368 | 0 | – | – |
| #371 | pipeline | 4 | 2m | 32m | 34m | pre-name, PR #375 | 1 | recover gave up | 4 impl with no answer (33910985030…33911211031) |
| #372 | pipeline | 4 | 1h21m | 5m | 1h26m | pre-name, PR #376 | 0 | – | – |
| #373 | pipeline | 1 | 1h30m | 14m | 1h44m | pre-name, PR #377 | 0 | – | – |
| #374 | pipeline | 6 | 3h01m | 2h49m | 5h50m | pre-name, PR #378 | 0 | close-ticket refused | – |
| #379 | session, no PR | 5 | – | – | 13h50m | 0 | 0 | – | – |
| #381 | session, no PR | 2 | – | – | 12h25m | 0 | 1 | – | – |
| #382 | pipeline | 7 | 11h23m | 36m | 11h58m | pre-name, PR #383 | 0 | close-ticket refused | – |
| #385 | session, no PR | 9 | – | – | 7d1h | 0 | 0 | – | – |
| #411 | session, no PR | 2 | – | – | 14h45m | 0A/0I | 0 | – | – |
| #412 | pipeline | 6 | 15h49m | 37m | 16h26m | 1A/1I, PR #426 | 0 | – | – |
| #417 | pipeline | 3 | 1h55m | 17m | 2h12m | 1A/1I, PR #419 | 0 | – | – |
| #418 | pipeline | 3 | 0m | 39m | 39m | 1A/1I, PR #420 | 0 | – | – |
| #421 | pipeline | 2 | 0m | 13m | 13m | 1A/1I, PR #422 | 0 | – | – |
| #423 | superseded by #434, closed by owner | 6 | 0m | 3h07m | 3h07m | 2A/0I | 2 | acc landing conflict, acc red after repair | 2 acc |
| #424 | pipeline | 3 | 0m | 1h35m | 1h35m | 2A/1I, PR #430 | 1 | acc landing conflict | 1 acc |
| #425 | pipeline | 8 | 0m | 1h38m | 1h39m | 2A/1I, PR #431 | 1 | acc landing conflict, close-ticket refused | 1 acc |
| #427 | session, no PR | 2 | – | – | 6m | 0 | 0 | – | – |
| #445 | session, no PR | 3 | – | – | 1h17m | 0 | 0 | – | – |
| #446 | session, no PR | 3 | – | – | 1h20m | 0 | 0 | – | – |
| #448 | pipeline | 4 | 0m | 19m | 19m | 1A/1I, PR #451 | 0 | – | – |
| #449 | session, no PR | 1 | – | – | 1h01m | 0 | 0 | – | – |
| #456 | session, no PR | 3 | – | – | 2h04m | 0 | 0 | – | – |
| #457 | session, no PR | 5 | – | – | 1h56m | 0 | 0 | – | – |
| #460 | pipeline | 3 | 23m | 1h22m | 1h45m | 1A/1I, PR #467 | 0 | – | – |
| #461 | pipeline | 2 | 0m | 19m | 19m | 1A/1I, PR #462 | 0 | – | – |
| #463 | pipeline | 5 | 0m | 16m | 17m | 1A/1I, PR #465 | 0 | close-ticket refused | – |
| #471 | pipeline | 3 | 0m | 28m | 29m | 1A/1I, PR #477 | 0 | by-hand label | – |
| #472 | pipeline | 4 | 0m | 21m | 21m | 1A/1I, PR #476 | 0 | – | – |
| #473 | pipeline | 5 | 0m | 13m | 13m | 1A/1I, PR #475 | 0 | – | – |
| #474 | pipeline | 3 | 0m | 24m | 24m | 1A/1I, PR #478 | 0 | – | – |
| #479 | pipeline | 5 | 0m | 23m | 23m | 1A/1I, PR #481 | 0 | – | – |
| #480 | by-hand label, session | 1 | – | – | 15m | 0 | 0 | by-hand label | – |
| #483 | pipeline | 4 | 0m | 17m | 17m | 1A/1I, PR #486 | 0 | – | – |
| #484 | pipeline | 6 | 0m | 40m | 40m | 1A/1I, PR #487 | 0 | – | – |
| #488 | owner PR, owner merged | 4 | – | – | 27h43m | 0, PR #525 | 1 | lane 06/08 refused×3 | – |
| #489 | by-hand label, session | 3 | – | – | 2h15m | 0 | 0 | by-hand label | – |
| #490 | owner re-pushed branch, lane 08 merged | 5 | 24h44m | 2h24m | 27h08m | 1A/1I, PR #523 | 1 | impl refused its own push (edited an acceptance test) | 1 impl (34705588650) |
| #507 | session, no PR | 1 | – | – | 18m | 0 | 0 | – | – |
| #516 | session, no PR | 3 | – | – | 1h27m | 0 | 0 | – | – |
| #517 | session, no PR | 2 | – | – | 1h40m | 0 | 0 | – | – |
| #518 | session, no PR | 4 | – | – | 1h34m | 0 | 0 | – | – |
| #520 | by-hand label, session | 6 | – | – | 1h47m | 0 | 0 | by-hand label | – |
| #521 | owner branch, lane 08 merged | 9 | – | – | 3h25m | 0A/1I, PR #531+#530 | 0 | close-ticket refused | 1 impl after close, nothing to build (34717395151) + strike 34717007435 |
| #522 | by-hand label, session | 9 | – | – | 5h01m | 0A/0I | 0 | by-hand label | – |
| #524 | pipeline | 4 | 0m | 35m | 35m | 1A/1I, PR #526 | 0 | – | – |
| #532 | pipeline | 4 | 23m | 25m | 48m | 1A/2I, PR #536 | 0 | – | – |
| #533 | pipeline | 7 | 23m | 1h37m | 2h00m | 1A/2I, PR #540 | 1 | impl rebase conflict (after owner closed it), lane 06/08 refused, close-ticket refused | 1 impl after merge (34738932250), 1 acc cancelled |
| #534 | by-hand label, session | 6 | – | – | 8m | 0A/0I | 0 | by-hand label | – |
| #535 | by-hand label, session | 14 | – | – | 18m | 0A/0I | 0 | by-hand label | – |
| #537 | by-hand label, session | 9 | – | – | 39m | 0 | 0 | by-hand label | – |
| #539 | replaced by #541–#544 | 9 | 1h18m | 9h20m | 10h38m | 3A/0I | 2 | acc author died×2, 3-strike stop | 3 acc |
| #541 | lane 08 refused, owner merged | 4 | 5m | 2h51m | 2h56m | 1A/1I, PR #545 | 2 | lane 06/08 refused×3 | – |
| #542 | pipeline | 2 | 5m | 3h19m | 3h24m | 1A/1I, PR #546 | 0 | – | – |
| #543 | pipeline | 2 | 5m | 3h50m | 3h55m | 1A/1I, PR #547 | 0 | – | – |
| #544 | pipeline | 2 | 5m | 4h33m | 4h38m | 2A/1I, PR #549 | 0 | acc red after repair | 1 acc |
| #550 | by-hand label, session | 7 | – | – | 5h20m | 0 | 0 | by-hand label | – |
| #551 | session, no PR | 6 | – | – | 1h28m | 0 | 0 | – | – |
| #552 | pipeline | 2 | 4h16m | 40m | 4h56m | 1A/1I, PR #562 | 0 | – | – |
| #553 | lane 08 refused, owner merged | 8 | 3h25m | 39h58m | 43h24m | 1A/1I, PR #566 | 1 | lane 06/08 refused | – |
| #554 | pipeline | 5 | 29m | 32m | 1h01m | 1A/1I, PR #560 | 0 | – | – |
| #555 | pipeline | 5 | 2h02m | 24m | 2h26m | 1A/1I, PR #561 | 0 | – | – |
| #556 | pipeline | 6 | 2h02m | 46m | 2h48m | 1A/1I, PR #563 | 0 | – | – |
| #557 | pipeline | 3 | 2h02m | 53m | 2h54m | 2A/2I, PR #565+#564 | 0 | close-ticket refused | 1 acc |
| #558 | by-hand label, session | 7 | – | – | 3h13m | 0 | 0 | by-hand label | – |
| #559 | pipeline | 7 | 3h10m | 41m | 3h52m | 1A/1I, PR #567 | 0 | – | – |
| #568 | by-hand label, session | 2 | 4m | 6m | 10m | 1A/0I | 0 | by-hand label | – |
| #570 | pipeline | 1 | 3m | 1h00m | 1h04m | 1A/6I, PR #572 | 2 | owner stopped a nothing-to-build loop; impl rebase conflict | 4 impl nothing to build (34878888526…34879187574), 1 impl conflict (34882369455) |
| #574 | session, no PR | 5 | – | – | 6h49m | 0 | 0 | – | – |
| #575 | by-hand label, session | 4 | – | – | 4h06m | 0A/0I | 0 | by-hand label | – |
| #576 | pipeline | 2 | 26h34m | 30m | 27h04m | 1A/1I, PR #590 | 0 | – | – |
| #577 | pipeline | 2 | 16m | 38m | 55m | 2A/1I, PR #580 | 0 | acc author died | 1 acc |
| #578 | pipeline | 2 | 26h17m | 1h05m | 27h22m | 1A/1I, PR #595 | 0 | – | – |
| #579 | pipeline | 3 | 1h29m | 32m | 2h00m | 4A/1I, PR #581 | 1 | acc author died×3, close-ticket refused, then 3-strike stop on merged work | 1 acc before merge, 2 acc after merge (34903545475, 34904983112) |
| #582 | pipeline | 4 | 8h07m | 23m | 8h30m | 1A/1I, PR #589 | 0 | – | – |
| #583 | pipeline | 3 | 8h06m | 37m | 8h42m | 1A/1I, PR #592 | 0 | – | – |
| #584 | pipeline | 4 | 10h57m | 29m | 11h26m | 2A/1I, PR #596 | 0 | acc author died | 1 acc |
| #585 | pipeline | 6 | 10h57m | 2h32m | 13h29m | 4A/1I, PR #597 | 1 | acc author died×2, 3-strike stop | 3 acc |
| #586 | pipeline | 4 | 10h57m | 2h48m | 13h44m | 1A/1I, PR #599 | 0 | – | – |
| #587 | pipeline | 7 | 10h46m | 2h44m | 13h30m | 2A/1I, PR #598 | 0 | – | 1 acc |
| #600 | pipeline | 6 | 7m | 3h22m | 3h29m | 4A/1I, PR #604 | 1 | acc author died×2, 3-strike stop | 3 acc |
| #601 | session, no PR | 5 | – | – | 17m | 0 | 0 | – | – |
| #602 | session, no PR | 5 | – | – | 17m | 0 | 0 | – | – |
| #603 | pipeline | 6 | 1h58m | 25m | 2h23m | 1A/1I, PR #605 | 0 | – | – |
| #606 | session, no PR | 5 | – | – | 6m | 0 | 0 | – | – |

### Spec door: children

| # | Path | Claimed | Filed→fired | Fired→merged/closed | Filed→merged/closed | Runs (acc/impl, PRs) | needs-human | Other stops | Thrown-away runs |
|---|---|---|---|---|---|---|---|---|---|
| #437 | pipeline | 6 | 0m | 17m | 17m | 1A/1I, PR #447 | 0 | – | – |
| #438 | pipeline | 4 | 0m | 31m | 31m | 1A/1I, PR #450 | 0 | – | – |
| #439 | pipeline | 3 | 0m | 1h05m | 1h05m | 2A/1I, PR #452 | 1 | acc landing conflict | 1 acc |
| #440 | pipeline | 3 | 0m | 4h11m | 4h11m | 2A/1I, PR #464 | 1 | acc red after repair | 1 acc |
| #441 | pipeline | 3 | 0m | 5h12m | 5h12m | 3A/1I, PR #468 | 2 | acc author died×2 | 2 acc |
| #442 | pipeline | 3 | 0m | 4h35m | 4h35m | 2A/1I, PR #466 | 1 | acc red after repair | 1 acc |
| #443 | pipeline | 3 | 0m | 5h35m | 5h35m | 2A/1I, PR #469 | 1 | acc red after repair | 1 acc |
| #444 | pipeline | 3 | 0m | 5h56m | 5h56m | 2A/1I, PR #470 | 1 | acc red after repair | 1 acc |
| #493 | pipeline | 2 | 0m | 51m | 51m | 2A/1I, PR #505 | 0 | – | 1 acc |
| #494 | session, no PR | 5 | 0m | 1h11m | 1h11m | 2A/0I | 1 | acc red after repair | 2 acc |
| #495 | session, no PR | 1 | 0m | 1h23m | 1h23m | 1A/0I | 0 | – | – |
| #496 | session, no PR | 1 | 0m | 1h03m | 1h03m | 1A/0I | 1 | acc red after repair | 1 acc |
| #497 | pipeline | 2 | 0m | 1h43m | 1h43m | 1A/1I, PR #508 | 0 | – | – |
| #498 | pipeline | 2 | 0m | 2h49m | 2h49m | 1A/1I, PR #511 | 0 | – | – |
| #499 | pipeline | 4 | 0m | 1h50m | 1h50m | 1A/1I, PR #515 | 0 | – | – |
| #500 | pipeline | 2 | 0m | 2h40m | 2h40m | 1A/1I, PR #510 | 0 | – | – |
| #501 | pipeline | 6 | 0m | 1h46m | 1h46m | 1A/1I, PR #514 | 0 | – | – |
| #502 | pipeline | 2 | 0m | 2h36m | 2h36m | 1A/1I, PR #509 | 0 | – | – |
| #503 | pipeline | 2 | 0m | 2h53m | 2h53m | 1A/1I, PR #512 | 0 | – | – |
| #504 | pipeline | 2 | 0m | 2h57m | 2h57m | 1A/1I, PR #513 | 0 | – | – |
| #607 | pipeline | 8 | 0m | 38m | 38m | 1A/1I, PR #630 | 0 | – | – |
| #608 | pipeline | 2 | 0m | 1h11m | 1h11m | 1A/1I, PR #632 | 0 | – | – |
| #609 | stranded → #634 by hand | 4 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #610 | pipeline | 7 | 0m | 4h02m | 4h02m | 1A/1I, PR #636 | 0 | – | – |
| #611 | pipeline | 8 | 0m | 4h53m | 4h53m | 1A/1I, PR #642 | 0 | – | – |
| #612 | stranded → #634 by hand | 5 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #613 | pipeline | 8 | 0m | 4h11m | 4h11m | 1A/1I, PR #637 | 0 | – | – |
| #614 | pipeline | 5 | 0m | 4h47m | 4h47m | 1A/1I, PR #641 | 0 | – | – |
| #615 | stranded → #634 by hand | 7 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #616 | pipeline | 6 | 0m | 3h58m | 3h58m | 1A/1I, PR #635 | 0 | – | – |
| #617 | pipeline | 7 | 0m | 4h40m | 4h40m | 2A/2I, PR #643+#640 | 0 | close-ticket refused | – |
| #618 | stranded → #634 by hand | 7 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #619 | pipeline | 4 | 0m | 4h18m | 4h18m | 2A/2I, PR #639+#638 | 0 | close-ticket refused | – |
| #620 | pipeline | 4 | 0m | 1h16m | 1h16m | 1A/1I, PR #633 | 0 | – | – |
| #621 | stranded → #634 by hand | 6 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #622 | pipeline | 5 | 0m | 5h42m | 5h42m | 1A/1I, PR #644 | 0 | – | – |
| #623 | stranded → #634 by hand | 8 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #624 | pipeline | 2 | 0m | 1h04m | 1h04m | 1A/1I, PR #631 | 0 | – | – |
| #625 | stranded → #634 by hand | 6 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #626 | stranded → #634 by hand | 4 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #627 | stranded → #634 by hand | 3 | 0m | 3h41m | 3h41m | 1A/1I | 1 | impl rebase conflict | 1 impl |
| #628 | pipeline | 3 | 0m | 6h30m | 6h30m | 1A/1I, PR #645 | 0 | – | – |
| #629 | pipeline, closed by owner push 8587d4f | 6 | 0m | 7h05m | 7h05m | 2A/2I, PR #651 | 0 | close-ticket refused | 1 acc + 1 impl started after merge (35175054220, 35175347002) |

### Spec door: PRDs

| # | Path | Claimed | Filed→fired | Fired→merged/closed | Filed→merged/closed | Runs (acc/impl, PRs) | needs-human | Other stops | Thrown-away runs |
|---|---|---|---|---|---|---|---|---|---|
| #538 | ticket door, widened to spec; children published by hand; still open | 16 | 11h40m | – | open 3d23h | 0 | 5 | claim over cap×2, spec lane died, slice-failed×5 | – |
| #392 | built by hand (cross-repo) | – | – | – | 15h08m | 0 | 0 | spec lane died | – |
| #433 | hand-built umbrella | – | – | – | 13h53m | 0A/0I | 0 | slice-failed | – |
| #434 | sliced by lane 03 (2nd try) | – | – | – | 14h09m | 0 | 0 | slice-failed | – |
| #491 | published by hand from checkpoint | – | – | – | 8h38m | 0A/0I | 0 | slice-failed | – |
| #519 | built by hand after slice-failed | – | – | – | 5h34m | 0 | 0 | slice-failed | – |

### Walk-home filings (another entry point, for contrast)

| # | Path | Claimed | Filed→fired | Fired→merged/closed | Filed→merged/closed | Runs (acc/impl, PRs) | needs-human | Other stops | Thrown-away runs |
|---|---|---|---|---|---|---|---|---|---|
| #336 | misfiled, closed by owner | 1 | 0m | 5m | 6m | 0 | 0 | – | – |
| #337 | misfiled, closed by owner | 1 | 0m | 6m | 6m | 0 | 0 | – | – |
| #338 | misfiled, closed by owner | 1 | 0m | 6m | 6m | 0 | 0 | – | – |
| #339 | misfiled, closed by owner | 1 | 0m | 6m | 6m | 0 | 0 | – | – |
| #340 | misfiled, closed by owner | 1 | 0m | 6m | 6m | 0 | 0 | – | – |
| #366 | pipeline | 1 | 0m | 2h29m | 2h29m | pre-name, PR #370+#369 | 0 | close-ticket refused×2 | – |
| #387 | duplicate, closed by owner | 1 | 0m | 2d15h | 2d15h | 1A/0I | 1 | acc landing conflict | 1 acc |
| #388 | duplicate, closed by owner | 1 | 0m | 2d15h | 2d15h | 1A/0I | 1 | acc landing conflict | 1 acc |
| #389 | duplicate, closed by owner | 1 | 0m | 2d15h | 2d15h | 1A/0I | 1 | acc landing conflict | 1 acc |
| #390 | pipeline | 1 | 0m | 9m | 9m | 1A/1I, PR #391 | 0 | – | – |


## Not verified

- Before 2026-09-06, Acceptance and Implement run names carry no issue number. Rows marked
  "pre-name" count stops from lane comments, not from runs, so runs that died without commenting
  are missing from those rows.
- The 265 direct commits were not each classified by what triggered them. The examples in class 1
  were read; the split between "repair of a stop" and "planned machine work" is not measured.
- A push count of 193 is the number of distinct main heads that started a push-event workflow run.
  A push whose run history was deleted, or that started no workflow, is not counted.
- Why #328 was merged by hand: five Integrate runs failed that morning (e.g. 33583627762) but none
  names its PR.
- Duplicate Tracker operations (the charting claim) and model cost per run were not re-checked.
- Run transcripts and session logs were not read. Causes come from lane comments, owner comments,
  commit messages and PR bodies.
- The window ends at the data pull (2026-09-17 02:44Z). #538 is still open, carrying `needs-human`.
