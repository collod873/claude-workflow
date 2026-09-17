# Did what got built match what the filing session and owner meant

Researches: #661

Child of map #646; feeds its **Charter** and the ruling on what a ticket is. Written 2026-09-17.
Merged diffs were read as they landed, and trunk facts were checked at `94cfe5e`. Facts and
candidates only, no rulings.

Session ids are the first eight characters of the full id, as in `unfollowed-ideas-2026-09.md`.
"Intent" means what the owner and the filing session agreed before filing. "Ticket" means the
issue body the build worked from. "Build" means everything that merged for the ticket: the
acceptance-test commit and the build PR or PRs.

## Summary

- **32 tickets were graded**: 16 from the ticket door and 16 spec children, half with clean runs
  and half without. In every one, the recommendation the owner accepted carried what the owner
  asked for (32 of 32 matched). Once the agreement existed, intent was lost later, in writing the
  ticket or in building it.
- **It depended on which door the work came in by.**

  | | Ticket hop lost something | Build hop lost something |
  |---|---|---|
  | Ticket door (a session wrote the body with the owner there) | 3 of 16 | 3 of 16 |
  | Spec children (the slicing step wrote the body from a spec) | 11 of 16 | 13 of 16 |

- **Where it was lost first.** 17 tickets lost something at some hop:
  - 14 lost it first in the ticket. In 3 of those (#442, #493, #586) the build did what the
    ticket asked and still missed what was meant.
  - 3 lost it only in the build.
- **Proxy criteria went with lossy builds.** Judges sorted each ticket's acceptance criteria into
  three kinds:
  - Proxy only (a file exists, an import is gone, a grep matches): 8 tickets, all 8 built partial
    or drifted.
  - A mix of proxy and real checks: 22 tickets, 8 built partial.
  - Only checks that test the intent itself: 2 tickets, both built as meant.
- **A clean run did not mean a faithful build.** 10 of the 16 clean runs lost something at the
  build hop, against 6 of the 16 runs that were not clean. The difference is mostly the #538
  tracker-port slices. They ran clean and then carried their old test machinery forward under new
  names.
- **The judges and the dropped Review findings named the same defects.** The judges never saw
  Review's findings. 8 sampled PRs had findings Review dropped (`merge-quality-2026-09.md`), and
  the judges graded all 8 builds partial or drifted. For 5 of them, a judge independently named
  the defect a finding describes: F2–F4, F7/F8, F13–F18, F19 and F6.

## How it was sampled and judged

**Population.** It came from the per-ticket tables in `run-outcomes-2026-09.md`, rows whose path
shows a lane 08 merge. That note's window starts 2026-09-02; no earlier lane-merged ticket was
added.

- **Ticket door:** 53 rows. That is the note's 51, plus #490 and #521, where lane 08 merged a
  branch the owner had pushed. #357, #541 and #553 are left out because the owner merged them.
- **Spec children:** 31 rows, from PRDs #434, #491 and #538.

**Finding the filing session.** Every `Bash` tool call containing `file-issue` or
`publish-issue-graph` was indexed across all 3,188 transcripts under `~/.claude/projects/`, and each
was joined to the issue URL its tool result returned.

- **Ticket door:** a filing session was found for 51 of 53. #474 was never found. #473 is named in
  session a883ff89, but no filing call's output carries its URL.
- **Spec children:** none has a filing call of its own. Each was traced to its PRD's filing session
  (f303d286 for #434, 22f17e89 for #491, 5b48c154 for #538), as the ticket directs.

**Sample.** The pool was more than 30, so 8 were drawn from each of four strata with Python
`random.seed(661)` then `random.sample`:

| Stratum | Pool | Drawn |
|---|---|---|
| Ticket door, clean | 30 | #373, #418, #461, #472, #483, #543, #586, #603 |
| Ticket door, not clean | 26 | #346, #425, #463, #532, #533, #544, #557, #579 |
| Spec child, clean | 21 | #438, #500, #607, #608, #614, #616, #624, #628 |
| Spec child, not clean | 10 | #440, #441, #442, #444, #493, #617, #619, #629 |

- **Clean** is derived from the source note's columns: no `needs-human`, no other stop, no
  thrown-away run, one implement run and one PR. The derivation gives 30 clean ticket-door rows
  where the note says 29; the extra row was not traced.
- #374, #382 and #474 were left out of the draw because their filing sessions had not yet been
  found.
- The ticket-door pools include #357, #541 and #553; none was drawn.
- #373's filing session later turned up under another project directory (0c547409). #374 and #382
  did as well, after the draw.

**Three isolated steps**, each a fresh subagent:

1. **Intent extraction.** 11 subagents, one per filing session or a small group of sessions.
   - Each read that session's conversation, condensed to the owner's messages, the owner's answers
     to multiple-choice questions, the session's prose and its filing commands. Body files and
     tool output were stripped.
   - The conversation was cut off at the filing time.
   - They were barred from `gh`, the ticket body and anything after filing. The one exception was
     #346: the owner had only said "take the next item", so the extractor read #331 and #225,
     where the agreement lived.
   - Each wrote the owner's words, the accepted recommendation, a 2–4 sentence intent, and an
     engagement level:
     - **explicit**: the owner chose this item.
     - **batch-approved**: the owner said yes to a list that held it.
     - **delegated**: the owner said only "go".
   - The three spec intents describe the whole agreed outcome.
2. **Build packets.**
   - **Ticket body:** the version in place when the build started. It came from the issue's
     `userContentEdits` history where the body had been edited, which applied to 9 tickets.
   - **Build diff:** the acceptance-test commit, where it landed on `main` before 09-14, followed by
     each build PR's diff.
3. **Judging.** 14 judge subagents, each given 1 to 3 tickets.
   - Each saw only the intent file, the ticket body and the build diff.
   - For helper checks, a judge could run `git show` and `git grep` against the commit the PR
     merged onto. No `gh`, no `git log`, no outcome labels, no other grades.
   - Each graded the three hops matched, partial or drifted, classed the criteria as intent,
     proxy or mixed, said whether the build did the ticket, and flagged vacuous or intent-missing
     tests, added scope and duplicated helpers.

**Spot checks by hand**, after all 32 grades were in:

| Ticket | Judge's claim | Checked against | Result |
|---|---|---|---|
| #461 | The marker search has no `--limit`, so only 30 results are read | `gh issue list --help`: "Maximum number of issues to fetch (default 30)"; PR #462 removes `--limit` with no replacement | Holds |
| #608 | The "recorded" payloads are invented literals labelled ADR-0106 | Build diff: `citation: "ADR-0106"` beside `"id": 501` and `https://github.com/owner/repo/actions/runs/501` | Holds |
| #614 | The new tracker is force-cast to the old gh type | Build diff: `const unreachableGh = trackerMemory() as unknown as GhExec` | Holds |
| #493 | No slice of #491 moved an `if:` into TypeScript | #491's own closing comment (09-12): "This PRD's twelve slices delivered the shared `WorkflowStep`/`WorkflowJob` types and the lane-budget wrapper in every lane; none of them touched an `if:`" | Holds |
| #629 | `gh-search.ts`, `gh.ts` and `ready-set.ts` still build api argv, so a criterion fails | `8587d4f`, the owner's repair after `close-ticket` refused #629, deletes lines from exactly those three production files (11 files changed in all) | Holds |
| #463, #533 | Intent built; the criteria are mostly greps | Their `close-ticket` refusals were greps for a leftover name (`hasStandingDecision`, `GreenGateCheck`), not missing behaviour | Consistent |
| #425 | Build matched | `45f15b7` later repaired #425's refusal. The cause was #434's by-hand label arriving afterwards, not #425 missing its ticket | Consistent |

## Every graded ticket

**Criteria** is the judge's read of the acceptance criteria. **Did ticket** says whether the build
did what the body asked, separately from the intent. The session is the one whose conversation
holds the intent. For spec children that is the PRD's session, shown with the PRD number.

| # | Door, run | Session | Owner engagement | Intent | Ticket | Criteria | Build | Did ticket | Flags |
|---|---|---|---|---|---|---|---|---|---|
| #373 | ticket, clean | 0c547409 | batch-approved | matched | matched | mixed | matched | yes | none |
| #418 | ticket, clean | dbf84524 | delegated | matched | matched | intent | matched | yes | none |
| #461 | ticket, clean | a883ff89 | delegated | matched | matched | mixed | **partial** | yes | intent-missing-test |
| #472 | ticket, clean | a883ff89 | delegated | matched | matched | mixed | matched | yes | none |
| #483 | ticket, clean | 79691710 | batch-approved | matched | matched | mixed | matched | yes | none |
| #543 | ticket, clean | acfe4b30 (split of #539, 5b48c154) | explicit | matched | matched | mixed | matched | yes | vacuous-test |
| #586 | ticket, clean | 0c62c7f3, then 4af6f9ae | batch-approved | matched | **partial** | mixed | **partial** | yes | scope-added |
| #603 | ticket, clean | ca7a2c5c | explicit | matched | **partial** | mixed | **partial** | partly | intent-missing-test |
| #346 | ticket, not clean | be6c5636 (split of #331) | delegated | matched | matched | mixed | matched | yes | duplicated-helper |
| #425 | ticket, not clean | 88fe3851 | batch-approved | matched | matched | mixed | matched | yes | none |
| #463 | ticket, not clean | a883ff89 | delegated | matched | matched | mixed | matched | yes | none |
| #532 | ticket, not clean | 9d65e750 | batch-approved | matched | matched | mixed | matched | yes | none |
| #533 | ticket, not clean | 9d65e750 | explicit | matched | matched | mixed | matched | yes | none |
| #544 | ticket, not clean | acfe4b30 (split of #539, 5b48c154) | explicit | matched | **partial** | mixed | matched | yes | vacuous-test, scope-added |
| #557 | ticket, not clean | 41f1947c | batch-approved | matched | matched | mixed | matched | yes | duplicated-helper |
| #579 | ticket, not clean | a2ec085f | explicit | matched | matched | mixed | matched | yes | none |
| #438 | spec #434, clean | f303d286 | explicit | matched | matched | mixed | **partial** | partly | intent-missing-test |
| #500 | spec #491, clean | 22f17e89 | explicit | matched | **partial** | mixed | **partial** | partly | intent-missing-test |
| #607 | spec #538, clean | 5b48c154 | batch-approved | matched | **partial** | mixed | **partial** | partly | intent-missing-test, duplicated-helper, scope-added |
| #608 | spec #538, clean | 5b48c154 | batch-approved | matched | **partial** | proxy | **drifted** | partly | vacuous-test, intent-missing-test, duplicated-helper |
| #614 | spec #538, clean | 5b48c154 | batch-approved | matched | **partial** | proxy | **drifted** | partly | intent-missing-test, duplicated-helper |
| #616 | spec #538, clean | 5b48c154 | batch-approved | matched | matched | mixed | matched | yes | none |
| #624 | spec #538, clean | 5b48c154 | batch-approved | matched | **partial** | proxy | **partial** | partly | vacuous-test, intent-missing-test, duplicated-helper |
| #628 | spec #538, clean | 5b48c154 | batch-approved | matched | **partial** | proxy | **partial** | partly | scope-added, intent-missing-test |
| #440 | spec #434, not clean | f303d286 | explicit | matched | matched | mixed | matched | yes | scope-added |
| #441 | spec #434, not clean | f303d286 | explicit | matched | matched | mixed | **partial** | partly | intent-missing-test, vacuous-test |
| #442 | spec #434, not clean | f303d286 | explicit | matched | **partial** | mixed | **partial** | yes | duplicated-helper, vacuous-test, intent-missing-test |
| #444 | spec #434, not clean | f303d286 | explicit | matched | matched | intent | matched | yes | none |
| #493 | spec #491, not clean | 22f17e89 | explicit | matched | **drifted** | proxy | **drifted** | yes | scope-added, intent-missing-test |
| #617 | spec #538, not clean | 5b48c154 | batch-approved | matched | **partial** | proxy | **drifted** | partly | intent-missing-test, scope-added, duplicated-helper |
| #619 | spec #538, not clean | 5b48c154 | batch-approved | matched | **partial** | proxy | **partial** | partly | intent-missing-test, scope-added, duplicated-helper |
| #629 | spec #538, not clean | 5b48c154 | batch-approved | matched | **partial** | proxy | **partial** | partly | intent-missing-test, scope-added |

**Totals.**

| Hop | Matched | Partial | Drifted |
|---|---|---|---|
| Intent | 32 | 0 | 0 |
| Ticket | 18 | 13 | 1 |
| Build | 16 | 12 | 4 |

- **Did the ticket:** yes for 20, partly for 12.
- **Flags:**
  - intent-missing-test: 15
  - duplicated-helper: 9
  - scope-added: 9
  - vacuous-test: 6
  - none: 11

## Where intent was lost

**Not at the agreement.** For all 32 tickets, the recommendation the owner accepted carried the
owner's words. Two limits apply:

- The intent hop was judged on an extractor's summary, not the raw conversation.
- In 5 ticket-door cases the owner had delegated, so there were few owner words to lose. Those
  are #346, #418, #461, #463 and #472.

**At the ticket, for spec children.** In 11 of 16 spec children the body lost part of the intent,
against 3 of 16 at the ticket door. By parent spec:

| Parent spec | Children graded | Ticket hop lost | Build hop lost |
|---|---|---|---|
| #434 (start brief, by-hand venue) | 5 | 1 | 3 |
| #491 (flatten workflows) | 2 | 2 | 2 |
| #538 (typed Tracker port) | 9 | 8 | 8 |

Three shapes recur:

1. **The slices did not add up to the spec.** #491's slices delivered shared types and a timeout
   wrapper, and none moved workflow logic into tested code, which was the point. The machine's own
   closing comment on #491 says so. Its acceptance check "exited 2 on a malformed `tar` invocation
   for its whole life", so nothing reported the gap until a session read it. The work was re-filed
   as #519.
2. **Migration criteria that moving code satisfies.** Seven #538 slices had proxy-only criteria
   (#608, #614, #617, #619, #624, #628, #629), such as "no longer imports the fixture", "file X
   deleted" or a grep for a name.
   - In #614, #617 and #619 the old decoding fakes were pasted inline into each test, which
     satisfies the check.
   - In #628 and #629 the decoding moved to new helpers or came back under new names.
   - In #608 a `citation: "ADR-0106"` field was added to invented payloads to satisfy a name grep.
   - The spec's aim, fakes that stop decoding command strings, is what these checks did not test.
3. **A slice carrying a sentence that does not fit its lane.** #500 asked the ratify lane to
   "strike its own ticket", but that lane has no ticket. It also never said the time budget covers
   the whole lane rather than one model call.

**At the ticket, for the ticket door.** In 3 of 16 cases, all written by the session that had the
conversation:

- #586 filed the build item without the agreed rule.
- #603 dropped the agreed "same command, same JSON, same table".
- #544 turned "only the shared module pushes to main" into a count of one text pattern.

**At the build, with a faithful ticket.** 3 cases:

- #461: a result cap came back at 30.
- #438: one of three triggers cannot fire.
- #441: "across enrolled repos" became the current repo only.

In each, the gap was in a case no test covered.

**Clean runs versus not clean.** At the build hop, 10 of 16 clean runs lost something, against 6
of 16 runs that were not clean. At the ticket door, the 8 runs that were not clean all built as
meant. Their stops came from criteria and markers, not from missing the intent:

- #463 and #533 were refused at close by greps for leftover names.
- #557 was refused over a leftover `test.fails` line.

**Engagement did not separate outcomes at the ticket door.** Build lost something in:

- 1 of 5 delegated tickets
- 1 of 6 batch-approved tickets
- 1 of 5 explicit tickets

## Drifted cases in plain words

Every ticket with a partial or drifted hop. "Wanted" is the agreed intent; "Built" is what merged.

**Drifted**

- **#493** (spec #491). *Wanted:* move the hidden if-logic in the workflow files into tested code,
  one workflow at a time, so wiring bugs are caught before they burn a runner. *Built:* two type
  definitions shared between test files, with no workflow changed. It also flipped a sibling
  ticket's acceptance tests to passing without doing that ticket's work.
- **#608** (spec #538). *Wanted:* the GitHub adapter proven against responses GitHub actually sent,
  gathered in one place. *Built:* a module that copies older JSON files that are still in use, and
  wraps a made-up run and job under an ADR label. The test still checks a fake that agrees with
  itself.
- **#614** (spec #538). *Wanted:* the slicing lane's tests talk to the tracker through the new
  typed interface instead of a fake that decodes command strings. *Built:* the shared helper file
  was deleted and its contents pasted into each test. The tests still use the old command-string
  fake, and the new interface is cast to the old type so the types line up.
- **#617** (spec #538). *Wanted:* the spec lane and its tests talk to the tracker through one typed
  interface. *Built:* one create and one read go through it. The command-decoding helpers moved into
  a test file, and several write paths still build raw commands. The one typed write path uses a
  method only the in-memory stand-in has.

**Partial**

- **#461**. *Wanted:* the counter finds the old "declined for good" issue however old it gets.
  *Built:* it searches for that issue by keyword but reads only the first 30 hits, so enough newer
  mentions would hide it again.
- **#586**. *Wanted:* a written rule for when one pipeline step hands a fact to the next rather than
  making it look again, plus the slicer being handed the repo's real top-level folders. *Built:*
  the slicer gets the real list, but the rule was never written down. A check that no stage names
  the domain vocabulary file was also switched off for the slicing stage.
- **#603**. *Wanted:* one place that checks and publishes the ticket graph, with the old command
  working exactly as before. *Built:* the one place exists and the old command forwards to it, but
  it takes a different input format and prints a different table. Nothing tests that the forwarding
  command runs.
- **#544**. *Wanted:* the ADR back-stamp job retries a lost push, and nothing but the shared helper
  pushes to main. *Built:* the retry works. The "only one pusher" check counted a text pattern, so an
  unrelated detector file had its pattern disguised to pass.
- **#438** (spec #434). *Wanted:* a ticket that touches the workstation, another repo or protected
  CI files is marked for a human to build. *Built:* workstation and other-repo tickets are marked.
  CI-file tickets are still refused outright instead of marked, and no test covers that case.
- **#441** (spec #434). *Wanted:* at session start, see every stuck ticket across all enrolled repos
  and why it was refused, plus other open sessions and the next hand-built ticket. *Built:* all of
  that, but only for the repo the session opened in, and the "reason" is whatever the last comment
  said.
- **#442** (spec #434). *Wanted:* when a session closes, save what was open so the next session can
  say what moved. *Built:* a save file is written, but the start-of-session brief looks for a
  different file with different fields, so nothing reads it.
- **#500** (spec #491). *Wanted:* the ratify lane stops itself before GitHub kills the runner and
  leaves a record of why. *Built:* each model call gets its own 85-minute limit, so a run with
  several stalled findings can still pass the runner's limit. A timeout is logged as "skipped", with
  no record on any issue.
- **#607** (spec #538). *Wanted:* production code and test fakes talk through one typed tracker
  interface, so the fakes stop decoding URLs. *Built:* the interface exists and one counter uses it
  inside, but that counter's tests still decode URLs as before.
- **#624** (spec #538). *Wanted:* the acceptance lane reads and writes the tracker only through the
  typed interface, with tests on the in-memory tracker. *Built:* one read moved over. If no tracker
  is passed, it silently falls back to an empty one that reports no children, and a test passes
  because of that fallback.
- **#628** (spec #538). *Wanted:* test doubles that use typed tracker operations instead of decoding
  command strings. *Built:* one double stopped decoding. The same decoding moved into a new helper
  that other tests now go through.
- **#619** (spec #538). *Wanted:* the shaping lane and its tests use the typed interface with no
  command-decoding fakes. *Built:* the reads moved, but the writes still use raw commands and the old
  fake was copied into the tests. The count of decision sheets quietly changed from a search to a
  scan of the latest 200 issues, with no test.
- **#629** (spec #538). *Wanted:* remove the code whose only job was letting test doubles decode
  production's commands, and leave one module owning those commands. *Built:* the unused pieces were
  removed, but the used ones were renamed and kept, and three other modules still built the commands
  themselves. The owner moved those three afterwards (`8587d4f`).

## Checked against outcomes, after grading

The judges never saw these outcomes. They were compared afterwards.

- **Dropped Review findings** (`merge-quality-2026-09.md`). 8 sampled PRs carry findings: #603, #607,
  #608, #614, #619, #624, #628 and #629. All 8 builds were graded partial or drifted. A judge named
  the same defect as a finding in 5:
  - #603: F4 (`--repo` ignored); the judge also named the changed table.
  - #608: F7 and F8 (hand-written payloads cited as recorded, second copy of fixtures).
  - #614: F19 (the tracker cast to a gh function).
  - #619: F13–F18 (only the 200 newest issues read).
  - #624: F6 (empty in-memory tracker fallback).
- **`close-ticket` refusals after merge.** Eight sampled tickets had one. The builds were graded:
  - #425 and #579: matched. Both refusals were over a `pytest` marker that does not run here.
  - #463, #533, #557: matched. The refusals were a leftover name in a grep and a leftover
    `test.fails` line.
  - #619 and #629: partial. For #629 the judge named the exact files the refusal's repair edited.
  - #617: drifted.
- **Named repairs.** #425 (`45f15b7`), #557 (PR #565: "the test was wrong") and #629 (`8587d4f`).
  #557's two PRs were judged together; #425's repair arose from later work.

## Candidates

Material for the map's rulings; none of these is a ruling.

- **A criterion kind that predicts loss.** Proxy-only criteria preceded a partial or drifted build
  8 times in 8. A filing-time or slice-time check could ask each criterion whether moving, renaming
  or inlining code would satisfy it without the behaviour changing.
- **Slicing is the lossy hop.** Spec children lost intent at the ticket 11 times in 16; tickets a
  session wrote with the owner present did so 3 times in 16. Two candidates:
  - The slicer carries the spec's goal sentence and aim-level criteria into each child.
  - A spec does not close on its children alone: its own check has to run and pass, which #491's
    never did.
- **Review already finds intent loss.** It found it in the #538 wave and dropped every finding (see
  the merge-quality note). The overlap with the independent judges suggests the review output is
  the existing signal to route.
- **Clean is not a quality signal.** A run with no stops says nothing about whether the build did
  what was meant; 10 of 16 clean runs lost something at the build.
- **Delegation did not predict loss at the ticket door.** Tickets written after "go" did about as
  well as ones the owner chose item by item. What differed was who wrote the body.
- **An owner-readable account.** The "Wanted / Built" pairs above were written by judges from diffs.
  Something like them, produced per merge, is one candidate answer to the owner not being able to
  judge backend tickets by reading them.

## Not verified

- **Sample size.** 32 of 84 eligible tickets. The four strata are equal in size but not in their
  share of the population, so the door and clean/not-clean rates are per-stratum figures, not
  population estimates.
- **Spec intents are spec-wide.** Each spec child was judged against its whole spec's intent.
  - A seam slice such as #493 is not expected to carry a whole spec, so its "drifted" ticket grade
    partly reflects the slice set rather than one body. The #491 closing comment backs the
    slice-set reading.
  - Six of the nine #538 children come from one spec and one wave, so that spec weighs heavily on
    the spec-door figures.
- **Who wrote the spec children's bodies** was taken from `run-outcomes-2026-09.md`: lane 03 for
  #434, published by hand from lane 03's checkpoint for #491 and #538. How much a session edited
  those bodies before publishing was not checked.
- **The intent hop rests on extraction.** The 32-of-32 "matched" rests on an extractor's summary.
  - An extractor that paraphrased the session's recommendation could hide a gap between the owner's
    words and that recommendation.
  - The raw conversations were not re-read for all 32; they were for #373 (after a wrong first
    extraction) and #346.
- **Judge grades are one model's reading each.** Seven claims were spot-checked by hand (table
  above). The other judgments, including every "matched", were not re-derived.
- **Body version.** Where a body was edited after the build started, the judge saw the earlier
  version. That applies to #425, #441, #444, #463 and #579.
- **Build scope.** Later commits that finished or repaired a ticket after merge were not in the
  build packet, except #557's second PR and #617's and #619's second PRs.
- **Missing filings.** #473 and #474's filing sessions were not found. Tickets filed before
  2026-09-02 were not considered.
- **Owner words.** Owner words are summarized here, not quoted, except for machinery text. The
  per-ticket intent files and grades are scratch files and are not in the repo.
