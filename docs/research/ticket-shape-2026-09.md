# What shape tickets have had, which shapes built clean, and what to vary on purpose

Researches: #662

Data pulled 2026-09-17 04:50Z, trunk `8dbcc44`. Feeds the ruling on what a ticket is (map #646).
This note gives facts and candidates. It makes no rulings. Outcome classes follow
[`run-outcomes-2026-09.md`](run-outcomes-2026-09.md) (#649), which this note extends back to
2026-08-21.

## Summary

- **The format was reshaped 57 times, mostly after something broke.** Across `collod873/agent-skills`
  and this repo, 25 changes were deliberate and 32 reactive. From 09-10 to 09-16, 19 of 25 were
  reactions to a named incident. Four rules were added and later reversed: globs in claims,
  collision edges, refusing immutable-set claims, and refusing over-limit claims. Nobody varied
  the shape to compare two versions. That matches the owner's "Some changes have happened to it
  but more like random over time" (2026-09-17).
- **361 buildable tickets were filed from 08-21 to 09-17**, meaning bodies with both
  `## Acceptance criteria` and `## Files claimed`. The median body is 2.4 KB with 4 criteria and
  3 claimed files. 125 went through the build lanes. 65 of those ran clean.
- **What went with clean runs:**
  - Small merged diffs: 41 of 58 PRs under 100 changed lines were clean, against 8 of 23 over 300.
  - A PR that stayed inside its claim: 39 of 53, against 26 of 63 that edited more files than
    claimed.
  - One or two criteria: 16 of 22, against 6 of 18 with seven or more.
  - Every criterion carrying a marker: only 1 of 7 tickets with an unmarked criterion ran clean.
  - Few claimed files: 23 of 30 with two or fewer, 0 of 7 above eight.
  - These buckets are small, and the failures they contain are mostly machine bugs of the week.
    None of these is a controlled comparison.
- **Size.** Claimed bytes did not separate clean from stopped runs:
  - #559 claimed 171 KB and #242 claimed 439 KB, and both ran clean.
  - #585 (6 files, 82 KB) and #600 (6 files, 49 KB) both reached the three-strike stop while
    under the eight-file limit.
  - The limit's stated reason is out of date. The acceptance author stopped inlining claimed
    files on 09-16 (`2cfdfdc`), and the implementer brief already caps by bytes
    (150 KB total, 40 KB per file).
- **No-ops:**
  - **Nothing to build.** 4 tickets hit it. Three of those runs came after the work had already
    merged or been discarded.
  - **Vacuous acceptance batch.** 1 ticket's tests already passed before any work (#496).
  - **Work already merged, obsolete or duplicate.** 7 tickets had a lane run after their work had
    merged or closed. 4 slices were obsolete on arrival, and 11 tickets were filed twice.
  - **Checks already green at filing.** Run against the tree at filing, 58 of 396 grep or
    file-exists checks already passed. Today's filing check skips 42 of those 58, because
    it exempts any command that names a claimed path.
- **Audit.** Findings that most change what an agent does:
  - "Red today" has an exemption that lets most green checks through, and lane 03's publisher
    doesn't run it at all.
  - The doc's only check-marker example is a whole-repo check its own rule holds.
  - Three places give three different reasons for the claim limit.
  - The spec sub-issue example doesn't match what lane 03 publishes.
  - The doc names no intent section, although 304 of 361 bodies carry `## What to build`.

## How this was traced

- **Issues.** `gh issue list --search created:>=2026-08-21 --state all` returned 477 issues (#1 to
  #662). The 361 whose body has both required headings are the tickets studied here. The others
  are wayfinder decisions, PRDs, questions and reports. Each ticket's timeline came from
  `gh api repos/collod873/claude-workflow/issues/N/timeline`. All 2,023 issue comments since
  08-21 came from `issues/comments?since=`.
- **PRs.** `gh pr list --state all` returned 179 PRs. A ticket's build PR is the head branch
  `implement/issue-N`. #634 is the hand-built rebuild of nine stranded tickets.
- **Parsing.** Criteria, check markers and claims were parsed with the live validator
  (`bin/ticket_shape.py`: `criteria_blocks`, `parse_check_marker`, `claimed_paths`), so a body
  counts the way `file-issue` and `close-ticket` count it today.
- **Marker kinds:**

  | Code | Kind | Examples |
  |---|---|---|
  | t | test file | vitest, `python3 …test_*.py` |
  | g | grep or exists | `grep`, `test -f`, `! grep`, `test 0 -eq "$(grep -c …)"` |
  | w | whole suite | `npm test`, `npm run lint`, `bin/gauntlet`, `bin/lint`, a `for f in hooks/test_*.py` loop |
  | o | other | `node -e`, `python3 -c`, `bin/hook-report` |
  | x | tracker or network | `gh`, `curl` |
  | n | no marker | – |

  **Stay** counts criteria whose claim text says "still", "unchanged", "stays" or "continues to",
  meaning something that is already true.
- **Claimed KB** is the byte size of each claimed path at the last trunk commit before the ticket
  was filed (`git rev-list -1 --before=<createdAt> origin/main`, `git cat-file -s`). A path absent
  there counts as **new**. That covers a file the ticket creates, a path in another repo, an
  unrooted name and a glob.
- **Grep green at filing.** Every g-kind check was run against a `git archive` of that same commit,
  with a 15-second timeout and `HOME` unset.
- **Outcome.** Tickets the #649 tables cover keep their #649 class. The same rules, derived from
  timelines and PRs, matched #649 on 137 of the 146 tickets both cover. The other 9 were resolved
  toward #649:
  - #471 has a `by-hand` stop.
  - #578's "edits outside the fence" comment is not a stop.
  - #537 is `by-hand`.
  - Six session closes stay session closes.

  Tickets outside #649's window were classed by those rules.

  | Class | Meaning |
  |---|---|
  | clean | lane 08 merged it, with no `needs-human`, strike, author death, red batch, close refusal, rebase conflict, nothing-to-build or recover comment, and one build PR |
  | stops | lane 08 merged it, with one or more of those |
  | owner-merged | a build PR the owner merged |
  | stranded | closed by #634 |
  | session | closed with no build PR, built or closed in a session |
  | by-hand | carried the `by-hand` label |
  | superseded | closed not planned, duplicate, obsolete or misfiled |
  | open | still open |

  Stop codes:

  | Code | Stop |
  |---|---|
  | nh | `needs-human` |
  | cr | close refused |
  | rc | rebase conflict |
  | st | strike |
  | ad | acceptance author died |
  | ar | acceptance batch red |
  | nb | nothing to build |
  | al | acceptance landing conflict |
  | rv | recover lane |
- **History.** Traced from `git log --follow` on each file here and in the local clone of
  `collod873/agent-skills` (`~/.agents/skills`, head `6a8136f`). `~/bin/file-issue` resolves to
  `~/.agents/workflow/bin/file-issue`, a second clone of this repo at `8587d4f`, not a separate
  source.
- **Audit.** Followed `.claude/skills/audit-doc/SKILL.md` steps 2–3 by hand, holding each line to
  the levers in `.claude/skills/writing-for-agents/SKILL.md`. Every rule was checked against the
  code that enforces it.

## History

**D** means the commit or its issue names a design choice or ADR. **R** means it names a failure,
a refusal or a ticket that went wrong. The repo column says CW for claude-workflow and AS for
agent-skills. Dates are 2026.

| # | Date | SHA(s) | Repo | File(s) | What changed | D/R | Trigger cited |
|---|---|---|---|---|---|---|---|
| 1 | 07-06 | a5f1597 | AS | to-issues/SKILL.md | Baseline: unblocked slices must touch disjoint files; `## Acceptance criteria` checkboxes, no claim section | D | drain parallel safety |
| 2 | 07-29 | 8c4015c | AS | triage/SKILL.md | Triage writes criteria plus `## Files claimed`, a blockedBy edge per collision, `None - no files` sentinel | D | ADR-0004, ADR-0007 |
| 3 | 07-29 | a69eb70 | AS | to-tickets/SKILL.md | to-tickets publishes the `## Files claimed` it already computed | D | ADR-0007 |
| 4 | 07-31 | 3408305 | AS | to-tickets, wayfinder templates | Criteria must be literal `- [ ]` items | R | #57: wayfinder tickets could not close through the gate |
| 5 | 07-31 | e48b4e7, d7fa714, e855d1d, 80afa33 | AS | ticket-format.md | One canonical doc that producers point at. Globs allowed, claims "biased coarse" | R | #56, #57: a template drifted from its parser; ADR-0017 |
| 6 | 08-16–08-28 | d6e6c1d, 29456f3, 347f956, 5b03c8e | AS | ticket-format.md | Drop links that are dead in consuming repos; name the close gate by file | R (mechanics) | dead downstream links |
| 7 | 08-20 | be5a684 | AS | ticket-format.md | "Ticket" means a build item, "decision" a wayfinder item | D | vocabulary |
| 8 | 08-20 | 45651f1 | AS | bin/file-issue, ticket_shape.py | `file-issue` created with four kinds behind one validator. Refuses a missing heading; warns on criteria with no evidence | D | shape had been enforced only at close |
| 9 | 08-20 | 31570b3, 6d5603c | AS | bin/file-issue | `ticketify` wires blockedBy edges; `question` appends its exit line | D | ADR-0007 |
| 10 | 08-20 | 08ee2e3, 8769899 | AS | ticket_shape.py | One grammar compiler shared with the close gate | R | filing and close disagreed on `path:line` evidence |
| 11 | 08-21 | 1fd72c4 | AS | ticket_shape.py | Warn on claimed paths that don't resolve | R | four tickets claimed `skills/drain/SKILL.md` |
| 12 | 08-26 | 78584d0 | AS | ticket_shape.py | Resolve claims against the repo being filed for | R | #149: the warning fired in every other repo |
| 13 | 08-26 | 9e9c726 | CW | ticket-format.md | Doc seeded into this repo | D | #34 |
| 14 | 08-27 | 26b4d90, 0996fb1 | AS | ticket_shape.py, ticket-format.md | Optional trailing `check:` marker parsed and documented | D | #166 |
| 15 | 08-27 | a498d26, 86a8b05 | AS+CW | ticket_shape.py, ticket-format.md | A migration ticket must assert its post-state (warning) | R | #134: #141/#142's scripts shipped and never ran; ADR-0076 |
| 16 | 08-28 | 9c0cab9, 6fe20fe | AS+CW | file-issue, ticket-format.md | /triage retired, and its appended-headings variant with it | D | 21 of 716 issues eligible; ADR-0032 |
| 17 | 08-28 | a137d55, ed51037, 1c41459, 1758c47 | CW | ticket_shape.py, ticket-format.md | Close gate and validator brought into this repo | D | #185, runner venue |
| 18 | 08-29 | e980b7b | AS | bin/file-issue | Spec kind gets one check of its own | R | #145: 26 slices green, product not working |
| 19 | 08-30 | a55436e | CW | ticket_shape.py | A spec is refused unless it has exactly one check-marked criterion | D | #239 |
| 20 | 08-31 | ac6fc40, d344fab | CW+AS | ticket_shape.py, ticket-format.md | Claimed paths must be rooted | R | #272: `checkpoints/` read two ways by two lanes; ADR-0118 |
| 21 | 08-31 | a6a788a | AS | file-issue / close-ticket | A body with no criteria no longer closes on `No diff.` unexamined | R | #283 |
| 22 | 08-31 | 24ab75b | CW | ticket_shape.py, ticket-format.md | Re-vendored from the seed | D (mechanics) | – |
| 23 | 09-01 | 82682a1 | CW | ticket-format.md, ticket-shape.ts | Slicer receives the format by `{{TICKET_FORMAT}}` injection; the TS port refuses a malformed plan | D | ADR-0082: a headless warning is no gate |
| 24 | 09-01 | 69914ed, e1afe61, 59244a7 | CW+AS | ticket_shape.py | A spec's criterion runs at filing and is refused if already green | R | #306; ADR-0130 |
| 25 | 09-03 | 2e1cfc0 … 3e82008 (6) | AS+CW | delimiters, sentinel | `check:` delimiter moves from em dash to hyphen; sentinel becomes `None, no files.` | D (mechanics) | punctuation sweep |
| 26 | 09-03 | 54ef555, e7834e0 | CW | ticket_shape.py | Comments and docstrings removed from the code | D (mechanics) | ADR-0151 |
| 27 | 09-04 | 1e6ee75 | CW | implement/brief.ts | Brief created: inlines claimed and cited files under a byte budget | D | runs spent their first minutes re-finding files |
| 28 | 09-04 | 823d099 | CW | brief.ts | Brief adds the coding standards and the ticket's comments | D | standards never reached lane 05 |
| 29 | 09-04 | 264c1dd | CW | brief.ts | Paths cited in prose become best-effort | R | a cited `bin/` directory crashed 4 implement runs |
| 30 | 09-04 | a3146dd, 1377804 | CW+AS | ticket_shape.py | Warn when a criterion can only be settled by reading config or Markdown | R | #360, #364 |
| 31 | 09-04 | 1764802, 22c5ca4 | AS | bin/file-issue | `--test <path>`: the filing session hands over its own failing tests | D | tests written from the issue text alone "fail often" |
| 32 | 09-09 | b3bef69, ddd2919, a308544 | CW+AS | all | Machinery moves into this repo; ADR citations remapped | D (mechanics) | #392 |
| 33 | 09-10 | aa0169e | CW | ticket_shape.py, ticket-format.md | A claim on the immutable set is refused at filing | D | #425 |
| 34 | 09-10 | 27f8b7b | CW | ticket_shape.py, file-issue | Workstation and cross-repo claims labelled `by-hand` | D | #438 (PRD #434) |
| 35 | 09-10 | 53c5004 | CW | ticket_shape.py | A check's first word must resolve (spec refuses, ticket warns) | D | #439 (PRD #434) |
| 36 | 09-11 | 45f15b7 | CW | ticket_shape.py, ticket-format.md | Immutable-set claim labelled `by-hand` instead of refused; reverses row 33 | R | a hand-only `.github/` fix was unfileable |
| 37 | 09-11 | bbbdf2c | CW | ticket_shape.py, ticket-format.md | A check must parse under `/bin/sh` | R | #483: #433's check could never go green |
| 38 | 09-11 | 2814170 | CW | ticket_shape.py | Only `.claude/settings*` counts as a workstation path | R | #473: a hook ticket was stood down |
| 39 | 09-12 | a602865 | CW | brief.ts | Brief opens with the style rules autofix can't apply | R | #490: style-only strikes |
| 40 | 09-13 | e015ae7 | CW | brief.ts | Brief names the check contract and venue | D | repeat reads measured over 53 runs |
| 41 | 09-13 | 9279b93 | CW | brief.ts, acceptance | Author shown the tests beside claimed files; returning a file it wasn't shown, or one that shrank, is refused | R | 4 runs deleted 69 tests (#556) |
| 42 | 09-13 | 5c544a7 | CW | ticket_shape.py, ticket-format.md | **`claimLimit` = 8 files** | R | #539: 92 KiB inlined, 3 author deaths |
| 43 | 09-13 | c81962d | CW | ticket-format.md, reconcile | Over-limit ticket sent to the slicer instead of refused | R | #538: the refusal had no repair path |
| 44 | 09-13 | 5a49cdd, fe9efdf, fa28509 | CW | rules.json, ticket_shape.py, ticket-format.md | `ticket-shape.rules.json` becomes the one source; TS warnings deleted | R | 16dbf0e misread the sentinel; #551; ADR-0184 |
| 45 | 09-14 | 190f5d7 | CW | rules.json | `notes.evidenceGrammar` cites ADR-0185 | D | #552 |
| 46 | 09-14 | 964d248 | CW | file-issue, ticket-format.md | Claim collisions wired as blocked-by edges at filing | R | #559: only `ticketify` checked disjointness |
| 47 | 09-14 | 9133b3f | CW | file-issue, ticket_shape.py | `-R` naming this same repo is no longer `by-hand` | R | #568 silently parked |
| 48 | 09-14 | 47b8e29 | CW | file-issue, ticket_shape.py, ticket-format.md | Warnings hold the filing unless `--ack "<why>"` | R | #570 filed carrying its own warning; #573 |
| 49 | 09-14 | b812751 | CW | rules.json, ticket_shape.py | Glob claims refused | R | #579; #538's eight-glob deadlock |
| 50 | 09-15 | 0124b47 | CW | ticket_shape.py | `rewrite` dropped from the migration vocabulary | R | #576: 9 of 13 fires were noise |
| 51 | 09-15 | 7b1c9e1 | CW | reconcile | Over-limit ticket labelled `to-spec` for lane 02; replaces row 43 | D | #578, ADR-0137 |
| 52 | 09-15 | 567b6b3 | CW | file-issue `--help` | Help says an unresolved claimed path is advisory | R | #583 |
| 53 | 09-16 | 241b4e8, 139513b | CW | ticket-format.md, file-issue, ticket_shape.py, rules.json | Collisions held by the live run; filing-time edges removed, reversing row 46 | R | #559's edges chained #600 behind #538; ADR-0199 |
| 54 | 09-16 | ae777b0, 29e6a7a, ef5bdee | CW | ticket-format.md, file-issue | Doc names `claimLimit` instead of a literal 8; a check runs exactly as written | R | #593, #587 |
| 55 | 09-16 | dd13169 | CW | file-issue, ticket_shape.py, rules.json | Filing holds an unmarked criterion, a whole-repo check and a check that already passes (**red today**); no-evidence and config-only warnings retired | R | #600 died twice at the acceptance author |
| 56 | 09-16 | 3c7354a | CW | ticket-format.md | Rewritten for the filer; red today stated; local-file variant dropped | R | drift after #579, #578, #600 |
| 57 | 09-16 | 2cfdfdc | CW | acceptance lane, ticket-format.md | Author edits the checkout and may only add lines; file inlining and byte budget dropped; the claim limit's reason moves to the implementer brief | R | #600 |

**Counts.**

| Period | Rows | Deliberate | Reactive |
|---|---|---|---|
| All | 57 | 25 (5 of them mechanics) | 32 |
| Through 09-09 (rows 1–32) | 32 | 20 | 12 |
| 09-10 to 09-16 (rows 33–57) | 25 | 6 | 19 |

**The biggest shape changes:**

- **Claims.** `## Files claimed` arrived on 07-29 and became a hard refusal with `file-issue` on
  08-20.
- **One source.** One canonical format doc replaced its restated copies on 07-31.
- **Check markers.** The `check:` marker went from optional (08-27) to held when missing (09-16).
- **Rooted paths** were required from 08-31.
- **The claim limit.** `claimLimit` = 8 arrived on 09-13. Three days later its original reason,
  the acceptance author inlining every claimed file, was removed. The limit stayed, with a new
  reason.
- **Globs** were refused from 09-14, after being allowed since 07-31.
- **`--ack`.** Warnings have held the filing unless acknowledged since 09-14.
- **Red today, narrow checks, no tracker reads** arrived on 09-16. A ticket's checks run at filing
  for the first time; a spec's had run since 09-01.

**Added and later removed or reversed:**

- **Globs in claims:** allowed 07-31, refused 09-14.
- **Collision edges:** added 07-29, 08-20 and 09-14, then removed 09-16.
- **Immutable-set claims:** refused 09-10, labelled `by-hand` from 09-11.
- **Over-limit claims:** refused, then sent to the slicer (09-13), then sent to `to-spec` (09-15).
- **Warnings:** no-evidence (08-20) and config-only (09-04), both retired 09-16.
- **Acceptance author file limits:** shown-file and shrink refusals and the byte budget, added
  09-13 and removed 09-16.
- **`rewrite`** dropped from the migration vocabulary on 09-15.

## Tickets in the wild

### Overview

| Outcome | Tickets | Median body | Median criteria | Median claimed | Median claimed KB |
|---|---|---|---|---|---|
| clean | 65 | 1.9 KB | 3 | 4 | 30 |
| stops | 38 | 2.1 KB | 3.5 | 4 | 30 |
| owner-merged | 13 | 3.8 KB | 6 | 8 | 60 |
| stranded (#634) | 9 | 1.4 KB | 5 | 6 | 44 |
| session | 174 | 2.6 KB | 4 | 3 | 12 |
| by-hand | 10 | 3.1 KB | 5 | 6.5 | 86 |
| superseded | 41 | 2.4 KB | 3 | 2 | 30 |
| open | 10 | 3.4 KB | 5 | 2 | 1 |
| owner PR | 1 | 3.7 KB | 3 | 6 | 67 |

- **Door.**
  - 160 are spec children, carrying `## Parent PRD` or `## Parent`.
  - 107 carry the `ticket` label from `file-issue ticket`.
  - 94 are neither. These are August hand filings and the walk-home sweep.
  - Most tickets never reached the lanes. 174 of 361 were built or closed in a session, including
    87 spec children.
- **Criteria and markers.** 1,576 criteria in all:

  | Marker kind | Criteria |
  |---|---|
  | No marker | 624 |
  | Test file | 416 |
  | Grep or exists | 396 |
  | Whole suite | 83 |
  | Other | 44 |
  | Tracker or network | 13 |

  In August, 134 of 180 tickets had at least one unmarked criterion; in September, 32 of 181 did.
  133 criteria across 112 tickets are stay-true claims.
- **Sections** (as `##` headings):

  | Section | Bodies | Format names it? |
  |---|---|---|
  | `What to build` | 304 | No |
  | `Parent PRD` | 138 | No (the doc's example uses `Parent`) |
  | `Seams consumed` | 84 | No |
  | `Blocked by` | 30 | Yes |
  | `Parent` | 9 | Yes |
  | `Problem` | 15 | No |
  | `What is wrong` | 7 | No |
  | `What happened` | 6 | No |
  | `Why` or `Why it matters` | 7 | No |
  | `Claim widened by hand` | 2 | No |
  | 85 headings used once | – | No |

  No ticket carries `## Warnings acknowledged`, since `--ack` arrived 09-14.
- **Size spread.**
  - **Body:** p90 5.4 KB, largest 25 KB (#13).
  - **Criteria:** up to 26.
  - **Claims:** up to 20 files. 26 tickets claimed more than eight files. All 26 were filed before
    the limit landed (`5c544a7`, 09-13 14:27Z); the last four (#535, #537, #538, #539) were filed
    that morning.

### Traits against clean runs

Covers the 125 tickets the build lanes touched (clean, stops, owner-merged and stranded). The
second column is the 72 of those filed from 09-11. That is after acceptance landing conflicts were
fixed (PR #454) and after the fixer and recover eras.

| Trait | Bucket | Clean, all 125 | Clean, from 09-11 |
|---|---|---|---|
| Claimed files | ≤2 | 23/30 | 14/18 |
| | 3–4 | 20/44 | 12/22 |
| | 5–6 | 15/24 | 11/19 |
| | 7–8 | 7/20 | 5/12 |
| | 9+ | 0/7 | 0/1 |
| Claimed KB at filing | ≤10 | 7/16 | 3/5 |
| | 11–30 | 27/43 | 21/31 |
| | 31–60 | 17/34 | 10/19 |
| | 61–90 | 7/16 | 2/7 |
| | >90 | 7/16 | 6/10 |
| Any claimed file >40 KB (implementer per-file cap) | yes | 9/13 | – |
| | no | 56/112 | – |
| Claimed paths absent at filing | 0 | 51/83 | 34/56 |
| | 1 | 8/20 | 4/9 |
| | 2–3 | 5/17 | 3/6 |
| | 4+ | 1/5 | 1/1 |
| Criteria | ≤2 | 16/22 | 8/9 |
| | 3–4 | 29/56 | 21/36 |
| | 5–6 | 14/29 | 10/18 |
| | 7+ | 6/18 | 3/9 |
| Body bytes | ≤1.5 KB | 22/34 | 15/24 |
| | 1.5–2.5 KB | 25/46 | 15/26 |
| | 2.5–4 KB | 12/30 | 8/17 |
| | >4 KB | 6/15 | 4/5 |
| Marker mix | test file + grep | 35/60 | – |
| | test file only | 11/26 | – |
| | has a whole-suite check | 9/19 | – |
| | has an unmarked criterion | 1/7 | – |
| | has an "other" check | 5/7 | – |
| | grep only | 2/4 | – |
| Stay-true criterion | present | 17/36 | – |
| | absent | 48/89 | – |
| Unnamed section, almost always `## Seams consumed` | present | 25/38 | 16/20 |
| | absent | 40/87 | 26/52 |
| Door | spec child | 33/61 | 19/32 |
| | ticket or other | 32/64 | 23/40 |
| Merged PR lines changed (116 with a merged PR) | ≤100 | 41/58 | – |
| | 101–300 | 16/35 | – |
| | 301–700 | 6/16 | – |
| | 700+ | 2/7 | – |
| Merged PR files minus claimed | ≤0 | 39/53 | – |
| | 1–2 | 15/35 | – |
| | 3–5 | 9/20 | – |
| | 6+ | 2/8 | – |

**Stops against traits:**

- **Acceptance author died (7 tickets, counting #539).** Five of the six that reached the lanes had
  test-file-only markers. Claimed bytes were 0, 15, 25, 31, 49, 81 and 94 KB. Claimed files were
  2 to 9.
- **Rebase conflict (13).** Eleven had test-file plus grep markers, almost all of them the #538
  wave.
- **Close refused (30 tickets, including session closes).** Criteria counts were spread from 1 to
  12. The #649 split still holds: unrunnable markers (pytest, `$HOME` paths, globs, no marker)
  against work left incomplete.

**Where the numbers are too small or tangled to tell:**

- **Marker mix.** Every bucket except "test file + grep" has 26 tickets or fewer.
- **Why sections.** Three lane tickets since 09-11 carried a why or problem section (#552, #559,
  #576). All three were clean.
- **Seams consumed.** The "unnamed section" gap comes from spec children of #491 and #538's
  siblings. It is a door effect, not a section effect.
- **Claimed files.** The 9+ bucket is six August or early-September tickets plus #521, all from
  before the limit.
- **Paths absent at filing.** The stranded nine created new files, which drags that trait down.
- **The #538 wave.** 9 stranded tickets from one wave sit in the from-09-11 column.
- **Machine bugs dominate the stops.** Most stops trace to machine bugs fixed later (#649's table).
  A trait that coincides with a bug week looks worse than it is.
- **Diff size is known only after the build.** It is the strongest pattern, but a filing-time rule
  can only estimate it.
- **No controlled comparison.** No ticket was filed twice in two shapes.

### Every ticket

Columns:

- **Door:** spec child, ticket label, or other.
- **Sections:** W = What to build, P = Parent PRD, p = Parent, S = Seams consumed, B = Blocked by,
  `+k` = k further sections the format doesn't name.
- **Markers:** counts of t/g/w/o/x/n.
- **Stay:** stay-true criteria.
- **Claimed (new):** paths, and how many were absent at filing.
- **Grep green at filing:** grep or exists checks that passed at filing, over those run.
- **PR files / lines:** for a merged build PR.
- **Outcome:** the class, with stop codes in brackets.

| # | Filed | Door | Body KB | Sections | Crit | Markers t/g/w/o/x/n | Stay | Claimed (new) | Claimed KB | Grep green at filing | PR files / lines | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #13 | 08-22 | spec child | 25.0 | PW+7 | 1 | 0/0/0/0/0/1 | 0 | 19 (19) | 0 | – | – | session |
| #14 | 08-22 | spec child | 5.4 | WS | 11 | 0/0/0/0/0/11 | 0 | 3 (3) | 0 | – | – | session |
| #15 | 08-22 | spec child | 4.9 | WS | 13 | 0/0/0/0/0/13 | 0 | 1 (1) | 0 | – | – | session |
| #16 | 08-22 | spec child | 3.0 | WS | 7 | 0/0/0/0/0/7 | 1 | 4 (4) | 0 | – | – | session |
| #17 | 08-22 | other | 6.0 | WS | 10 | 0/0/0/0/0/10 | 0 | 7 (7) | 0 | – | – | session |
| #18 | 08-22 | other | 6.2 | WS | 9 | 0/0/0/0/0/9 | 0 | 10 (10) | 0 | – | – | session |
| #19 | 08-22 | spec child | 4.8 | WS | 8 | 0/0/0/0/0/8 | 0 | 6 (6) | 0 | – | – | session |
| #20 | 08-22 | spec child | 6.0 | WS | 11 | 0/0/0/0/0/11 | 0 | 7 (7) | 0 | – | – | session |
| #26 | 08-23 | spec child | 3.7 | WS | 7 | 0/0/0/0/0/7 | 1 | 4 (1) | 19 | – | – | session |
| #27 | 08-23 | spec child | 6.1 | WS | 8 | 0/0/0/0/0/8 | 1 | 4 (0) | 28 | – | – | session |
| #28 | 08-23 | spec child | 3.7 | WS | 7 | 0/0/0/0/0/7 | 0 | 3 (2) | 14 | – | – | session |
| #29 | 08-23 | spec child | 4.9 | WS | 9 | 0/0/0/0/0/9 | 0 | 5 (3) | 55 | – | – | session |
| #30 | 08-23 | spec child | 2.8 | WS | 7 | 0/0/0/0/0/7 | 0 | 2 (2) | 0 | – | – | session |
| #31 | 08-23 | spec child | 2.5 | WS | 6 | 0/0/0/0/0/6 | 1 | 3 (1) | 15 | – | – | session |
| #32 | 08-23 | spec child | 2.7 | WS | 6 | 0/0/0/0/0/6 | 0 | 1 (1) | 0 | – | – | session |
| #40 | 08-24 | other | 2.9 | +3 | 3 | 0/0/0/0/0/3 | 0 | 2 (0) | 11 | – | – | session |
| #41 | 08-24 | other | 2.2 | +2 | 5 | 0/0/0/0/0/5 | 2 | 1 (1) | 0 | – | – | session (cr) |
| #42 | 08-24 | other | 2.4 | +1 | 5 | 0/0/0/0/0/5 | 0 | 2 (0) | 4 | – | – | session |
| #43 | 08-24 | spec child | 4.2 | PWS | 6 | 0/0/0/0/0/6 | 0 | 8 (8) | 0 | – | – | session |
| #44 | 08-24 | spec child | 2.9 | PWS | 3 | 0/0/0/0/0/3 | 0 | 5 (5) | 0 | – | – | session |
| #45 | 08-24 | spec child | 1.4 | PWS | 2 | 0/0/0/0/0/2 | 0 | 2 (2) | 0 | – | – | session |
| #46 | 08-24 | spec child | 1.2 | PWS | 1 | 0/0/0/0/0/1 | 0 | 4 (4) | 0 | – | – | session |
| #47 | 08-24 | spec child | 1.4 | PWS | 1 | 0/0/0/0/0/1 | 0 | 3 (3) | 0 | – | – | session |
| #48 | 08-24 | spec child | 1.0 | PW | 2 | 0/0/0/0/0/2 | 0 | 3 (3) | 0 | – | – | session |
| #49 | 08-24 | spec child | 1.9 | PWS | 2 | 0/0/0/0/0/2 | 0 | 6 (6) | 0 | – | – | session |
| #50 | 08-24 | spec child | 1.4 | PWS | 2 | 0/0/0/0/0/2 | 0 | 2 (2) | 0 | – | – | session |
| #51 | 08-24 | spec child | 1.4 | PWS | 2 | 0/0/0/0/0/2 | 0 | 4 (4) | 0 | – | – | session |
| #52 | 08-24 | spec child | 1.7 | PWS | 2 | 0/0/0/0/0/2 | 0 | 4 (4) | 0 | – | – | session |
| #55 | 08-26 | other | 3.8 | +2 | 7 | 0/0/0/0/0/7 | 1 | 1 (1) | 0 | – | – | session (cr) |
| #57 | 08-26 | other | 2.9 | +1 | 5 | 0/0/0/0/0/5 | 0 | 1 (0) | 1 | – | – | session |
| #58 | 08-26 | other | 3.4 | +2 | 7 | 0/0/0/0/0/7 | 0 | 2 (0) | 42 | – | – | session (cr) |
| #60 | 08-26 | other | 3.3 | – | 8 | 0/0/0/0/0/8 | 2 | 4 (0) | 22 | – | – | session |
| #61 | 08-26 | other | 2.9 | +2 | 5 | 0/0/0/0/0/5 | 0 | 2 (0) | 14 | – | – | session (cr) |
| #62 | 08-26 | other | 1.2 | – | 1 | 0/0/0/0/0/1 | 0 | 1 (1) | 0 | – | – | superseded (cr) |
| #64 | 08-26 | spec child | 1.1 | PW | 1 | 0/0/0/0/0/1 | 0 | 2 (2) | 0 | – | – | session |
| #65 | 08-26 | spec child | 1.1 | PW | 1 | 0/0/0/0/0/1 | 0 | 4 (4) | 0 | – | – | session |
| #66 | 08-26 | spec child | 0.8 | PW | 1 | 0/0/0/0/0/1 | 0 | 2 (2) | 0 | – | – | session |
| #67 | 08-26 | spec child | 1.9 | PWS | 1 | 0/0/0/0/0/1 | 1 | 3 (1) | 17 | – | – | session |
| #68 | 08-26 | spec child | 1.3 | PW | 1 | 0/0/0/0/0/1 | 0 | 2 (2) | 0 | – | – | session |
| #69 | 08-26 | spec child | 1.4 | PWS | 1 | 0/0/0/0/0/1 | 1 | 4 (2) | 9 | – | – | session |
| #70 | 08-26 | spec child | 0.8 | PW | 1 | 0/0/0/0/0/1 | 0 | 2 (0) | 6 | – | – | session |
| #71 | 08-26 | spec child | 2.2 | PWS | 2 | 0/0/0/0/0/2 | 0 | 3 (3) | 0 | – | – | session |
| #72 | 08-26 | spec child | 1.0 | PW | 2 | 0/0/0/0/0/2 | 0 | 3 (3) | 0 | – | – | session |
| #73 | 08-26 | spec child | 1.4 | PWS | 1 | 0/0/0/0/0/1 | 0 | 3 (3) | 0 | – | – | session |
| #74 | 08-26 | spec child | 1.0 | PW | 4 | 0/0/0/0/0/4 | 0 | 4 (1) | 118 | – | – | session |
| #75 | 08-26 | other | 5.5 | +2 | 13 | 0/0/0/0/0/13 | 1 | 5 (2) | 89 | – | – | session |
| #86 | 08-26 | other | 3.0 | +3 | 5 | 0/0/0/0/0/5 | 0 | 3 (1) | 2 | – | – | session (cr) |
| #87 | 08-26 | other | 0.9 | W | 3 | 0/0/0/0/0/3 | 0 | 2 (1) | 71 | – | – | session |
| #88 | 08-26 | other | 1.1 | W | 4 | 0/0/0/0/0/4 | 0 | 3 (1) | 71 | – | – | session |
| #89 | 08-26 | other | 3.4 | W | 14 | 0/0/0/0/0/14 | 0 | 4 (2) | 71 | – | – | superseded |
| #90 | 08-26 | other | 4.3 | W | 13 | 0/0/0/0/0/13 | 0 | 5 (3) | 71 | – | – | superseded |
| #91 | 08-26 | other | 2.8 | W | 8 | 0/0/0/0/0/8 | 0 | 4 (2) | 71 | – | – | superseded |
| #92 | 08-26 | other | 2.8 | W | 5 | 0/0/0/0/0/5 | 0 | 3 (1) | 71 | – | – | superseded |
| #93 | 08-26 | other | 1.2 | W | 3 | 0/0/0/0/0/3 | 0 | 3 (0) | 73 | – | – | superseded |
| #94 | 08-26 | other | 1.2 | W | 3 | 0/0/0/0/0/3 | 0 | 2 (1) | 71 | – | – | superseded |
| #95 | 08-26 | other | 1.3 | W | 3 | 0/0/0/0/0/3 | 0 | 1 (0) | 71 | – | – | superseded |
| #99 | 08-26 | other | 2.2 | W | 6 | 0/0/0/0/0/6 | 0 | 3 (2) | 62 | – | – | superseded |
| #101 | 08-26 | other | 2.6 | +3 | 5 | 0/0/0/0/0/5 | 0 | 1 (0) | 9 | – | – | session (cr) |
| #103 | 08-26 | other | 9.5 | +5 | 7 | 0/0/0/0/0/7 | 1 | 5 (0) | 66 | – | – | session |
| #104 | 08-26 | other | 3.9 | W+2 | 8 | 0/0/0/0/0/8 | 1 | 4 (0) | 6 | – | – | session |
| #105 | 08-21 | other | 1.4 | – | 3 | 0/0/0/0/0/3 | 0 | 2 (2) | 0 | – | – | superseded (cr) |
| #106 | 08-26 | other | 4.7 | +3 | 7 | 0/0/0/0/0/7 | 1 | 3 (1) | 71 | – | – | session |
| #107 | 08-26 | other | 3.6 | +4 | 5 | 0/0/0/0/0/5 | 1 | 4 (1) | 88 | – | – | session (cr) |
| #108 | 08-26 | other | 4.3 | +3 | 4 | 0/0/0/0/0/4 | 1 | 4 (1) | 10 | – | – | session |
| #109 | 08-26 | other | 3.3 | +3 | 3 | 0/0/0/0/0/3 | 0 | 2 (0) | 10 | – | – | session |
| #115 | 08-26 | other | 7.6 | W+4 | 9 | 0/0/0/0/0/9 | 1 | 3 (1) | 3 | – | – | session |
| #118 | 08-27 | spec child | 0.9 | PW | 3 | 0/0/0/0/0/3 | 1 | 2 (1) | 3 | – | – | session |
| #119 | 08-27 | spec child | 1.6 | PW | 5 | 0/0/0/0/0/5 | 0 | 3 (3) | 0 | – | – | session |
| #120 | 08-27 | spec child | 1.7 | PWS | 4 | 0/0/0/0/0/4 | 1 | 2 (0) | 15 | – | – | session |
| #121 | 08-27 | spec child | 1.7 | PWS | 3 | 0/0/0/0/0/3 | 0 | 5 (2) | 8 | – | – | session |
| #122 | 08-27 | spec child | 0.7 | PW | 2 | 0/0/0/0/0/2 | 0 | 2 (1) | 1 | – | – | session |
| #123 | 08-27 | spec child | 0.7 | PW | 2 | 0/0/0/0/0/2 | 0 | 2 (2) | 0 | – | – | session |
| #124 | 08-27 | spec child | 2.7 | PWS | 4 | 0/0/0/0/0/4 | 0 | 5 (5) | 0 | – | – | session |
| #125 | 08-27 | spec child | 2.4 | PWS | 3 | 0/0/0/0/0/3 | 0 | 4 (4) | 0 | – | – | session |
| #126 | 08-27 | spec child | 2.9 | PWS | 3 | 0/0/0/0/0/3 | 0 | 5 (5) | 0 | – | – | session |
| #127 | 08-27 | spec child | 2.7 | PWS | 3 | 0/0/0/0/0/3 | 0 | 4 (4) | 0 | – | – | session |
| #128 | 08-27 | spec child | 1.0 | PW | 3 | 0/0/0/0/0/3 | 0 | 2 (0) | 109 | – | – | session |
| #129 | 08-27 | other | 2.4 | +4 | 4 | 0/0/0/0/0/4 | 0 | 1 (0) | 27 | – | – | session (cr) |
| #130 | 08-27 | other | 3.1 | +4 | 4 | 0/0/0/0/0/4 | 0 | 4 (0) | 22 | – | – | session |
| #133 | 08-27 | other | 3.0 | +4 | 4 | 0/0/0/0/0/4 | 2 | 1 (0) | 8 | – | – | session (cr) |
| #135 | 08-27 | spec child | 2.7 | PWS | 3 | 0/0/0/0/0/3 | 1 | 6 (0) | 29 | – | – | session |
| #136 | 08-27 | spec child | 1.5 | PWS | 2 | 0/0/0/0/0/2 | 0 | 2 (0) | 14 | – | – | session |
| #137 | 08-27 | spec child | 1.1 | PW | 2 | 0/0/0/0/0/2 | 1 | 2 (0) | 44 | – | – | session |
| #138 | 08-27 | spec child | 2.4 | PWS | 2 | 0/0/0/0/0/2 | 1 | 2 (0) | 44 | – | – | session |
| #139 | 08-27 | spec child | 1.6 | PW | 3 | 0/0/0/0/0/3 | 0 | 2 (2) | 0 | – | – | session |
| #140 | 08-27 | spec child | 2.2 | PWS | 3 | 0/0/0/0/0/3 | 1 | 5 (3) | 27 | – | – | session |
| #141 | 08-27 | spec child | 1.3 | PW | 2 | 0/0/0/0/0/2 | 1 | 2 (2) | 0 | – | – | session |
| #142 | 08-27 | spec child | 1.3 | PW | 2 | 0/0/0/0/0/2 | 0 | 2 (2) | 0 | – | – | session |
| #144 | 08-27 | other | 3.0 | +1 | 5 | 0/0/0/0/0/5 | 0 | 3 (2) | 5 | – | – | session (cr) |
| #146 | 08-27 | other | 4.1 | W | 6 | 0/0/0/0/0/6 | 1 | 7 (0) | 58 | – | – | session |
| #147 | 08-27 | other | 6.6 | W | 6 | 0/0/0/0/0/6 | 1 | 14 (1) | 178 | – | – | session (cr) |
| #151 | 08-27 | other | 2.2 | W | 4 | 0/0/0/0/0/4 | 0 | 6 (0) | 54 | – | – | session |
| #152 | 08-27 | spec child | 1.2 | PW | 2 | 0/0/0/0/0/2 | 0 | 5 (3) | 20 | – | – | session |
| #153 | 08-27 | spec child | 1.1 | PW | 2 | 0/0/0/0/0/2 | 0 | 5 (2) | 22 | – | – | session |
| #154 | 08-27 | spec child | 1.1 | PW | 2 | 0/0/0/0/0/2 | 0 | 5 (5) | 0 | – | – | session |
| #155 | 08-27 | spec child | 0.9 | PW | 2 | 0/0/0/0/0/2 | 0 | 4 (4) | 0 | – | – | session |
| #156 | 08-27 | spec child | 1.4 | PW | 4 | 0/0/0/0/0/4 | 0 | 5 (5) | 0 | – | – | session |
| #157 | 08-27 | spec child | 1.7 | PWS | 2 | 0/0/0/0/0/2 | 1 | 6 (4) | 12 | – | – | session |
| #158 | 08-27 | spec child | 0.8 | PW | 2 | 0/0/0/0/0/2 | 1 | 2 (1) | 12 | – | – | session |
| #159 | 08-27 | spec child | 1.1 | PW | 3 | 0/0/0/0/0/3 | 1 | 3 (3) | 0 | – | – | session |
| #160 | 08-27 | spec child | 0.7 | PW | 2 | 0/0/0/0/0/2 | 0 | 2 (2) | 0 | – | – | superseded |
| #161 | 08-27 | spec child | 1.9 | PWS | 4 | 0/0/0/0/0/4 | 0 | 3 (2) | 3 | – | – | session |
| #162 | 08-27 | spec child | 1.9 | PWS | 4 | 0/0/0/0/0/4 | 0 | 5 (5) | 0 | – | – | session |
| #163 | 08-27 | spec child | 1.6 | PWS | 3 | 0/0/0/0/0/3 | 0 | 3 (2) | 3 | – | – | session |
| #164 | 08-27 | spec child | 1.7 | PWS | 3 | 0/0/0/0/0/3 | 0 | 4 (4) | 0 | – | – | session |
| #165 | 08-27 | spec child | 0.6 | PW | 2 | 0/0/0/0/0/2 | 0 | 2 (1) | 3 | – | – | session |
| #166 | 08-27 | spec child | 0.5 | PW | 2 | 0/0/0/0/0/2 | 0 | 1 (1) | 0 | – | – | superseded |
| #167 | 08-27 | spec child | 1.9 | PWS | 3 | 0/0/0/0/0/3 | 0 | 4 (4) | 0 | – | – | session |
| #168 | 08-27 | spec child | 1.1 | PW | 2 | 0/0/0/0/0/2 | 0 | 3 (3) | 0 | – | – | session |
| #169 | 08-27 | spec child | 1.1 | PW | 3 | 0/0/0/0/0/3 | 1 | 3 (3) | 0 | – | – | session |
| #170 | 08-27 | spec child | 1.2 | PW | 4 | 0/0/0/0/0/4 | 0 | 3 (3) | 0 | – | – | session |
| #171 | 08-27 | spec child | 0.5 | PW | 2 | 0/0/0/0/0/2 | 0 | 1 (1) | 0 | – | – | superseded |
| #172 | 08-27 | spec child | 0.9 | PW | 2 | 0/0/0/0/0/2 | 0 | 2 (2) | 0 | – | – | session |
| #173 | 08-27 | spec child | 1.1 | PW | 2 | 0/0/0/0/0/2 | 0 | 4 (4) | 0 | – | – | session |
| #174 | 08-27 | spec child | 1.6 | PWS | 3 | 0/0/0/0/0/3 | 0 | 2 (2) | 0 | – | – | session |
| #175 | 08-27 | spec child | 1.3 | PW | 4 | 0/0/0/0/0/4 | 0 | 5 (5) | 0 | – | – | session |
| #176 | 08-27 | spec child | 0.6 | PW | 1 | 0/0/0/0/0/1 | 0 | 3 (3) | 0 | – | – | session |
| #177 | 08-27 | spec child | 0.5 | PW | 2 | 0/0/0/0/0/2 | 0 | 1 (1) | 0 | – | – | superseded |
| #178 | 08-28 | other | 2.4 | +1 | 3 | 0/0/0/0/0/3 | 1 | 2 (0) | 10 | – | – | superseded |
| #179 | 08-28 | other | 15.0 | WB+7 | 11 | 0/0/0/0/0/11 | 0 | 10 (4) | 48 | – | – | session (cr) |
| #181 | 08-28 | other | 4.7 | W+2 | 5 | 3/1/1/0/0/0 | 1 | 2 (0) | 7 | 0/1 | – | session |
| #182 | 08-28 | other | 11.3 | WB+1 | 10 | 0/0/0/0/0/10 | 0 | 9 (1) | 36 | – | – | session (cr) |
| #184 | 08-28 | other | 13.0 | WB+3 | 13 | 0/10/1/0/0/2 | 1 | 6 (1) | 49 | 0/10 | – | session |
| #185 | 08-28 | other | 4.6 | +2 | 11 | 0/5/2/2/1/1 | 0 | 13 (4) | 41 | 0/5 | – | session |
| #186 | 08-28 | other | 2.9 | +1 | 4 | 0/0/0/1/0/3 | 0 | 5 (0) | 38 | – | – | session (cr) |
| #187 | 08-28 | other | 0.3 | – | 1 | 0/1/0/0/0/0 | 0 | 1 (1) | 0 | 1/1 | – | session |
| #188 | 08-28 | other | 4.5 | – | 7 | 0/3/1/1/2/0 | 0 | 12 (0) | 63 | 0/3 | – | session |
| #190 | 08-29 | spec child | 0.9 | PW | 3 | 0/0/0/0/0/3 | 0 | 2 (0) | 17 | – | 2 / 63 | superseded |
| #191 | 08-29 | spec child | 1.6 | PWS | 4 | 0/0/0/0/0/4 | 0 | 3 (0) | 29 | – | – | superseded |
| #192 | 08-29 | spec child | 1.3 | PWS | 2 | 0/0/0/0/0/2 | 0 | 4 (0) | 36 | – | – | superseded |
| #194 | 08-29 | other | 5.3 | W+2 | 7 | 6/0/1/0/0/0 | 1 | 5 (3) | 28 | – | – | session |
| #195 | 08-29 | other | 2.8 | W+1 | 4 | 2/1/1/0/0/0 | 1 | 3 (0) | 16 | 0/1 | – | session |
| #196 | 08-29 | other | 3.7 | W+2 | 5 | 4/0/1/0/0/0 | 1 | 2 (0) | 33 | – | – | session |
| #197 | 08-29 | other | 2.8 | W+1 | 4 | 3/0/1/0/0/0 | 0 | 3 (0) | 16 | – | – | session |
| #198 | 08-29 | other | 3.4 | – | 3 | 2/1/0/0/0/0 | 0 | 4 (0) | 40 | 0/1 | – | superseded |
| #199 | 08-29 | other | 2.9 | – | 3 | 1/1/0/0/1/0 | 0 | 2 (0) | 13 | 0/1 | – | superseded |
| #200 | 08-29 | other | 2.3 | – | 3 | 2/1/0/0/0/0 | 1 | 2 (0) | 33 | 0/1 | – | superseded |
| #201 | 08-29 | other | 2.7 | – | 4 | 0/3/0/0/1/0 | 0 | 4 (0) | 36 | 0/3 | – | session (nh) |
| #203 | 08-29 | spec child | 1.9 | PW | 8 | 0/0/0/0/0/8 | 0 | 6 (0) | 66 | – | 6 / 83 | clean |
| #204 | 08-29 | spec child | 1.9 | PWS | 6 | 0/0/0/0/0/6 | 1 | 7 (0) | 67 | – | – | superseded |
| #205 | 08-29 | spec child | 1.0 | PW | 2 | 0/0/0/0/0/2 | 1 | 4 (0) | 36 | – | – | superseded |
| #206 | 08-29 | spec child | 0.6 | PW | 1 | 0/0/0/0/0/1 | 0 | 2 (0) | 9 | – | – | superseded |
| #207 | 08-29 | spec child | 0.9 | PW | 3 | 0/0/0/0/0/3 | 0 | 4 (0) | 35 | – | – | superseded |
| #208 | 08-29 | spec child | 1.9 | PW | 7 | 1/6/0/0/0/0 | 0 | 4 (0) | 48 | 6/6 | – | superseded |
| #209 | 08-29 | spec child | 1.5 | PW | 6 | 4/1/1/0/0/0 | 0 | 5 (0) | 48 | 0/1 | – | session |
| #210 | 08-29 | spec child | 0.8 | PW | 2 | 2/0/0/0/0/0 | 0 | 2 (0) | 9 | – | 2 / 66 | clean |
| #212 | 08-29 | spec child | 1.0 | PWS | 1 | 1/0/0/0/0/0 | 1 | 2 (0) | 8 | – | – | session |
| #213 | 08-29 | spec child | 1.5 | PWS | 4 | 3/0/1/0/0/0 | 1 | 2 (0) | 28 | – | – | session |
| #215 | 08-29 | other | 4.6 | W+2 | 4 | 2/1/1/0/0/0 | 0 | 10 (1) | 66 | 0/1 | 10 / 476 | owner-merged |
| #218 | 08-29 | other | 4.2 | W+1 | 4 | 3/0/1/0/0/0 | 1 | 3 (1) | 27 | – | – | session |
| #219 | 08-29 | other | 6.5 | W+1 | 8 | 4/3/1/0/0/0 | 1 | 7 (0) | 38 | 2/3 | – | session |
| #220 | 08-29 | other | 3.9 | W+1 | 5 | 1/3/1/0/0/0 | 0 | 3 (0) | 40 | 1/3 | – | session |
| #221 | 08-29 | other | 4.3 | W+1 | 4 | 0/3/1/0/0/0 | 1 | 1 (0) | 8 | 0/3 | – | session |
| #222 | 08-29 | other | 5.5 | W+1 | 4 | 2/1/1/0/0/0 | 1 | 1 (0) | 17 | 0/1 | – | session |
| #223 | 08-29 | other | 5.6 | W+1 | 5 | 2/2/1/0/0/0 | 0 | 5 (0) | 24 | 0/2 | – | session |
| #224 | 08-29 | other | 3.7 | W+1 | 4 | 2/1/1/0/0/0 | 0 | 3 (0) | 15 | 1/1 | – | superseded |
| #227 | 08-29 | other | 2.8 | W+1 | 4 | 2/1/1/0/0/0 | 0 | 3 (0) | 33 | 0/1 | – | session |
| #234 | 08-29 | other | 2.6 | W+1 | 5 | 1/2/1/0/1/0 | 0 | 4 (1) | 59 | 0/2 | – | session |
| #237 | 08-29 | spec child | 2.1 | PWS | 3 | 3/0/0/0/0/0 | 0 | 4 (1) | 48 | – | 5 / 488 | stops (nb) |
| #238 | 08-29 | spec child | 2.0 | PWS | 3 | 3/0/0/0/0/0 | 0 | 2 (0) | 38 | – | 4 / 520 | clean |
| #239 | 08-29 | spec child | 0.8 | PW | 2 | 1/0/0/1/0/0 | 0 | 2 (1) | 23 | – | 2 / 67 | clean |
| #240 | 08-29 | spec child | 1.6 | PW+1 | 3 | 3/0/0/0/0/0 | 1 | 4 (0) | 38 | – | 4 / 39 | clean |
| #241 | 08-29 | spec child | 0.9 | PW | 1 | 1/0/0/0/0/0 | 0 | 4 (2) | 7 | – | 4 / 109 | clean |
| #242 | 08-29 | spec child | 1.0 | PW+1 | 2 | 1/1/0/0/0/0 | 0 | 2 (1) | 439 | 0/1 | 2 / 34 | clean |
| #251 | 08-30 | other | 4.4 | WB | 5 | 0/3/1/1/0/0 | 0 | 7 (1) | 73 | 1/3 | – | session |
| #253 | 08-30 | other | 3.0 | W+1 | 4 | 1/1/1/0/1/0 | 0 | 3 (1) | 26 | 0/1 | – | session |
| #261 | 08-30 | spec child | 1.9 | PWS | 7 | 3/4/0/0/0/0 | 2 | 5 (3) | 45 | 0/4 | 6 / 330 | clean |
| #262 | 08-30 | spec child | 2.1 | PWS | 7 | 6/1/0/0/0/0 | 1 | 8 (0) | 64 | 0/1 | 9 / 873 | clean |
| #263 | 08-30 | spec child | 1.8 | PWS | 6 | 5/1/0/0/0/0 | 1 | 7 (0) | 74 | 0/1 | 13 / 1061 | clean |
| #264 | 08-30 | spec child | 1.1 | PW | 5 | 0/5/0/0/0/0 | 0 | 2 (0) | 23 | 4/5 | 3 / 89 | clean |
| #270 | 08-30 | other | 3.8 | W+1 | 4 | 1/1/1/0/1/0 | 1 | 3 (0) | 32 | 0/1 | – | session |
| #272 | 08-30 | spec child | 2.0 | PW | 7 | 7/0/0/0/0/0 | 1 | 9 (3) | 68 | – | 11 / 1046 | stops (nb) |
| #273 | 08-30 | spec child | 2.1 | PWS | 3 | 3/0/0/0/0/0 | 1 | 2 (1) | 16 | – | 4 / 195 | stops (rv) |
| #274 | 08-30 | spec child | 1.7 | PWS | 2 | 2/0/0/0/0/0 | 1 | 11 (1) | 136 | – | 25 / 261 | stops (nh) |
| #275 | 08-30 | spec child | 1.5 | PW | 5 | 3/2/0/0/0/0 | 0 | 4 (2) | 25 | 0/2 | – | session (nh,rv) |
| #276 | 08-30 | spec child | 0.7 | PW | 3 | 1/1/0/1/0/0 | 2 | 2 (0) | 22 | 0/1 | 3 / 80 | clean |
| #286 | 08-31 | other | 2.8 | – | 5 | 5/0/0/0/0/0 | 2 | 3 (0) | 78 | – | – | session |
| #296 | 08-31 | other | 23.0 | +10 | 5 | 0/3/1/0/1/0 | 0 | 9 (1) | 36 | 0/3 | – | session |
| #299 | 08-31 | other | 2.9 | – | 2 | 1/0/0/0/0/1 | 1 | 2 (1) | 2 | – | – | session |
| #300 | 08-31 | other | 3.7 | – | 3 | 1/1/0/0/0/1 | 0 | 6 (1) | 67 | 0/1 | – | owner PR |
| #304 | 09-01 | ticket | 4.2 | W | 5 | 5/0/0/0/0/0 | 0 | 12 (2) | 72 | – | – | session |
| #305 | 09-01 | ticket | 4.1 | W | 5 | 1/1/2/1/0/0 | 0 | 13 (5) | 231 | 0/1 | 24 / 1688 | owner-merged |
| #306 | 09-01 | ticket | 3.8 | W | 5 | 4/1/0/0/0/0 | 0 | 9 (0) | 139 | 0/1 | – | session |
| #307 | 09-01 | ticket | 2.4 | W | 4 | 3/1/0/0/0/0 | 0 | 8 (2) | 212 | 0/1 | – | superseded |
| #308 | 09-01 | ticket | 3.3 | W | 3 | 0/3/0/0/0/0 | 0 | 2 (0) | 13 | 0/3 | – | open |
| #311 | 09-01 | spec child | 2.8 | pWB | 6 | 0/5/1/0/0/0 | 0 | 3 (1) | 10 | 1/5 | – | session |
| #312 | 09-01 | spec child | 3.2 | pWB | 6 | 0/5/1/0/0/0 | 0 | 3 (1) | 9 | 1/5 | – | session |
| #313 | 09-01 | spec child | 2.8 | pWB | 7 | 0/7/0/0/0/0 | 0 | 6 (3) | 10 | 3/7 | – | session |
| #314 | 09-01 | spec child | 3.8 | pWB | 13 | 0/13/0/0/0/0 | 0 | 12 (6) | 33 | 6/13 | 21 / 498 | owner-merged (nh) |
| #315 | 09-01 | spec child | 3.1 | pWB | 11 | 0/10/0/0/0/1 | 1 | 10 (5) | 59 | 5/10 | 20 / 450 | owner-merged |
| #316 | 09-01 | spec child | 2.0 | pWB | 5 | 0/4/0/0/0/1 | 0 | 2 (1) | 18 | 1/4 | 5 / 204 | owner-merged |
| #317 | 09-01 | spec child | 4.3 | pWB | 10 | 0/9/0/0/0/1 | 1 | 8 (4) | 36 | 5/9 | 12 / 472 | owner-merged |
| #326 | 09-01 | spec child | 6.0 | pWB | 10 | 4/4/1/0/0/1 | 1 | 5 (4) | 3 | 3/4 | – | session |
| #327 | 09-01 | spec child | 5.4 | pWB | 8 | 3/4/0/0/0/1 | 1 | 3 (3) | 0 | 2/4 | 5 / 769 | owner-merged (nh,rv) |
| #329 | 09-02 | ticket | 4.8 | WB | 12 | 5/6/1/0/0/0 | 2 | 5 (3) | 7 | 1/6 | – | session (nh,rv) |
| #331 | 09-02 | ticket | 8.9 | W | 9 | 4/5/0/0/0/0 | 0 | 13 (2) | 149 | 2/5 | – | session |
| #334 | 09-02 | ticket | 3.9 | – | 6 | 4/2/0/0/0/0 | 0 | 8 (1) | 218 | 1/2 | 7 / 423 | owner-merged (nh) |
| #335 | 09-02 | ticket | 5.9 | W | 9 | 3/6/0/0/0/0 | 0 | 13 (5) | 74 | 0/6 | – | session |
| #336 | 09-02 | other | 11.4 | W | 1 | 0/0/0/0/0/1 | 0 | 1 (1) | 0 | – | – | superseded |
| #337 | 09-02 | other | 11.4 | W | 1 | 0/0/0/0/0/1 | 0 | 1 (1) | 0 | – | – | superseded |
| #338 | 09-02 | other | 11.6 | W | 1 | 0/0/0/0/0/1 | 0 | 1 (1) | 0 | – | – | superseded |
| #339 | 09-02 | other | 10.3 | W | 1 | 0/0/0/0/0/1 | 0 | 1 (1) | 0 | – | – | superseded |
| #340 | 09-02 | other | 11.6 | W | 1 | 0/0/0/0/0/1 | 0 | 1 (1) | 0 | – | – | superseded |
| #342 | 09-02 | ticket | 5.0 | W | 6 | 2/4/0/0/0/0 | 2 | 7 (1) | 107 | 0/4 | 8 / 627 | stops (cr,nh,rc,rv) |
| #343 | 09-02 | ticket | 2.4 | W | 3 | 1/2/0/0/0/0 | 0 | 3 (0) | 55 | 0/2 | 3 / 50 | owner-merged (nh) |
| #346 | 09-02 | ticket | 5.3 | W | 5 | 4/1/0/0/0/0 | 2 | 4 (0) | 57 | 0/1 | 4 / 160 | stops (nh,rv) |
| #347 | 09-02 | ticket | 4.7 | W | 5 | 2/3/0/0/0/0 | 1 | 4 (2) | 15 | 0/3 | – | session |
| #349 | 09-02 | ticket | 2.7 | W | 3 | 2/1/0/0/0/0 | 0 | 3 (0) | 18 | 0/1 | 6 / 499 | stops (nh,rv) |
| #350 | 09-02 | ticket | 4.1 | W | 5 | 3/2/0/0/0/0 | 1 | 3 (0) | 109 | 0/2 | – | session |
| #353 | 09-03 | ticket | 3.2 | W | 3 | 2/1/0/0/0/0 | 1 | 2 (0) | 38 | 0/1 | – | session |
| #356 | 09-03 | ticket | 2.4 | W | 3 | 2/1/0/0/0/0 | 1 | 4 (0) | 46 | 0/1 | – | session |
| #357 | 09-03 | ticket | 5.0 | W | 7 | 1/4/1/1/0/0 | 0 | 8 (0) | 141 | 0/4 | 9 / 1539 | owner-merged (nh) |
| #360 | 09-03 | ticket | 13.0 | WB | 26 | 4/17/2/3/0/0 | 0 | 20 (5) | 151 | 0/17 | – | session |
| #361 | 09-03 | ticket | 2.4 | W | 2 | 0/0/2/0/0/0 | 1 | 2 (0) | 29 | – | – | session |
| #364 | 09-04 | ticket | 2.2 | WB | 5 | 1/0/0/1/0/3 | 0 | 3 (1) | 18 | – | – | session |
| #366 | 09-04 | other | 11.7 | W | 1 | 1/0/0/0/0/0 | 0 | 1 (0) | 2 | – | 4 / 49 | stops (cr) |
| #367 | 09-04 | ticket | 3.4 | WB | 5 | 1/3/0/1/0/0 | 1 | 3 (1) | 4 | 0/3 | 7 / 83 | clean |
| #371 | 09-04 | ticket | 3.3 | WB | 3 | 3/0/0/0/0/0 | 0 | 4 (0) | 59 | – | 4 / 29 | stops (nh,rv) |
| #372 | 09-04 | ticket | 2.5 | WB | 2 | 2/0/0/0/0/0 | 0 | 4 (0) | 46 | – | 2 / 20 | clean |
| #373 | 09-04 | ticket | 2.0 | WB | 3 | 1/1/1/0/0/0 | 0 | 1 (0) | 9 | 0/1 | 1 / 16 | clean |
| #374 | 09-04 | ticket | 3.0 | WB | 6 | 1/3/1/1/0/0 | 0 | 6 (2) | 26 | 0/3 | 8 / 190 | stops (cr) |
| #379 | 09-05 | ticket | 1.9 | WB | 4 | 2/1/1/0/0/0 | 1 | 5 (0) | 6 | 0/1 | – | session |
| #381 | 09-05 | ticket | 0.8 | – | 3 | 1/1/1/0/0/0 | 1 | 2 (0) | 4 | 0/1 | – | session (nh) |
| #382 | 09-05 | ticket | 3.3 | WB | 5 | 0/4/1/0/0/0 | 1 | 7 (0) | 39 | 0/4 | 6 / 122 | stops (cr) |
| #385 | 09-06 | ticket | 5.4 | +1 | 7 | 0/0/0/0/0/7 | 0 | 9 (0) | 65 | – | – | session |
| #387 | 09-06 | other | 11.8 | W | 1 | 1/0/0/0/0/0 | 0 | 1 (0) | 29 | – | – | superseded (al,nh) |
| #388 | 09-06 | other | 11.8 | W | 1 | 1/0/0/0/0/0 | 0 | 1 (0) | 29 | – | – | superseded (al,nh) |
| #389 | 09-06 | other | 11.8 | W | 1 | 1/0/0/0/0/0 | 0 | 1 (0) | 29 | – | – | superseded (al,nh) |
| #390 | 09-06 | other | 11.8 | W | 1 | 1/0/0/0/0/0 | 0 | 1 (0) | 29 | – | 3 / 15 | clean |
| #397 | 09-10 | other | 4.1 | +3 | 5 | 0/0/0/0/0/5 | 0 | 1 (1) | 0 | – | – | open |
| #399 | 09-10 | other | 6.2 | +3 | 4 | 0/3/1/0/0/0 | 0 | 1 (1) | 0 | 0/3 | – | open |
| #400 | 09-10 | other | 2.8 | WS | 6 | 1/0/1/0/0/4 | 2 | 2 (2) | 0 | – | – | open |
| #401 | 09-10 | other | 3.8 | +2 | 5 | 0/0/0/0/0/5 | 1 | 1 (1) | 0 | – | – | open |
| #402 | 09-10 | other | 2.5 | – | 4 | 0/0/1/0/0/3 | 0 | 4 (0) | 63 | – | 5 / 230 | stops (cr,nh) |
| #403 | 09-10 | other | 3.4 | W | 5 | 0/4/1/0/0/0 | 1 | 2 (1) | 16 | 2/4 | – | open |
| #404 | 09-10 | other | 3.0 | W | 5 | 1/1/1/1/0/1 | 0 | 2 (1) | 7 | 1/1 | – | open |
| #405 | 09-10 | other | 3.1 | W | 6 | 1/0/1/1/0/3 | 0 | 3 (3) | 0 | – | – | open |
| #406 | 09-10 | other | 3.5 | W | 6 | 0/1/2/1/0/2 | 1 | 2 (1) | 7 | 1/1 | – | superseded |
| #407 | 09-10 | other | 3.8 | W | 7 | 2/1/1/0/0/3 | 0 | 3 (2) | 8 | 1/1 | – | superseded |
| #410 | 09-10 | other | 3.0 | W+2 | 7 | 1/1/1/3/0/1 | 0 | 3 (2) | 1 | 0/1 | – | open |
| #411 | 09-10 | ticket | 2.5 | W | 3 | 3/0/0/0/0/0 | 1 | 2 (0) | 8 | – | – | session |
| #412 | 09-10 | ticket | 5.0 | +1 | 5 | 4/0/1/0/0/0 | 2 | 6 (0) | 54 | – | 9 / 352 | clean |
| #417 | 09-10 | ticket | 3.2 | W | 3 | 1/2/0/0/0/0 | 0 | 3 (0) | 25 | 1/2 | 7 / 63 | clean |
| #418 | 09-10 | ticket | 1.5 | – | 3 | 3/0/0/0/0/0 | 3 | 3 (0) | 62 | – | 7 / 122 | clean |
| #421 | 09-10 | ticket | 1.6 | – | 2 | 1/1/0/0/0/0 | 0 | 2 (0) | 16 | 0/1 | 3 / 46 | clean |
| #423 | 09-10 | ticket | 2.8 | W | 4 | 2/1/0/1/0/0 | 0 | 6 (2) | 42 | 0/1 | – | superseded (al,ar,nh) |
| #424 | 09-10 | ticket | 2.0 | W | 2 | 1/1/0/0/0/0 | 0 | 3 (0) | 20 | 0/1 | 5 / 64 | stops (al,nh) |
| #425 | 09-10 | ticket | 2.5 | W | 3 | 2/1/0/0/0/0 | 0 | 8 (2) | 86 | 0/1 | 9 / 175 | stops (al,cr,nh) |
| #427 | 09-10 | ticket | 4.5 | W | 7 | 0/6/0/1/0/0 | 2 | 2 (1) | 15 | 0/6 | – | session |
| #437 | 09-10 | spec child | 2.4 | PWS | 4 | 4/0/0/0/0/0 | 0 | 6 (1) | 53 | – | 6 / 68 | clean |
| #438 | 09-10 | spec child | 1.3 | PWS | 2 | 2/0/0/0/0/0 | 0 | 4 (0) | 83 | – | 6 / 164 | clean |
| #439 | 09-10 | spec child | 1.2 | PWS | 3 | 3/0/0/0/0/0 | 1 | 3 (0) | 29 | – | 5 / 98 | stops (al,nh) |
| #440 | 09-10 | spec child | 2.0 | PWS | 3 | 2/1/0/0/0/0 | 0 | 3 (2) | 0 | 0/1 | 5 / 209 | stops (ar,nh) |
| #441 | 09-10 | spec child | 1.8 | PWS | 4 | 4/0/0/0/0/0 | 0 | 3 (3) | 0 | – | 3 / 214 | stops (ad,nh,st) |
| #442 | 09-10 | spec child | 1.7 | PWS | 2 | 1/1/0/0/0/0 | 0 | 3 (2) | 0 | 0/1 | 4 / 214 | stops (ar,nh) |
| #443 | 09-10 | spec child | 1.3 | PWS | 3 | 3/0/0/0/0/0 | 0 | 3 (3) | 0 | – | 2 / 87 | stops (ar,nh) |
| #444 | 09-10 | spec child | 0.8 | PW | 2 | 2/0/0/0/0/0 | 0 | 3 (3) | 0 | – | 2 / 65 | stops (ar,nh) |
| #445 | 09-10 | spec child | 1.8 | W | 3 | 0/0/0/0/0/3 | 0 | 3 (0) | 73 | – | – | session |
| #446 | 09-10 | ticket | 1.4 | W | 3 | 0/0/0/0/0/3 | 0 | 3 (0) | 57 | – | – | session |
| #448 | 09-10 | ticket | 3.3 | W | 3 | 3/0/0/0/0/0 | 0 | 4 (0) | 43 | – | 4 / 38 | clean |
| #449 | 09-10 | ticket | 2.0 | W | 2 | 0/0/0/0/0/2 | 0 | 1 (0) | 23 | – | – | session |
| #456 | 09-10 | ticket | 3.6 | W | 3 | 0/0/0/0/0/3 | 0 | 3 (0) | 63 | – | – | session |
| #457 | 09-10 | ticket | 3.6 | W | 4 | 0/0/0/0/0/4 | 0 | 5 (0) | 87 | – | – | session |
| #460 | 09-11 | ticket | 2.3 | W | 3 | 1/2/0/0/0/0 | 0 | 3 (0) | 21 | 0/2 | 4 / 27 | clean |
| #461 | 09-11 | ticket | 1.9 | W | 2 | 1/1/0/0/0/0 | 1 | 2 (1) | 5 | 0/1 | 2 / 11 | clean |
| #463 | 09-11 | ticket | 2.6 | W | 3 | 1/2/0/0/0/0 | 0 | 5 (0) | 94 | 0/2 | 4 / 16 | stops (cr) |
| #471 | 09-11 | ticket | 2.9 | W | 3 | 1/1/0/1/0/0 | 1 | 3 (0) | 65 | 0/1 | 2 / 84 | stops |
| #472 | 09-11 | ticket | 2.6 | W | 3 | 1/2/0/0/0/0 | 1 | 4 (0) | 91 | 1/2 | 4 / 24 | clean |
| #473 | 09-11 | ticket | 2.6 | W | 3 | 2/1/0/0/0/0 | 0 | 5 (0) | 28 | 0/1 | 4 / 12 | clean |
| #474 | 09-11 | ticket | 2.6 | W | 3 | 1/2/0/0/0/0 | 0 | 3 (0) | 48 | 0/2 | 3 / 53 | clean |
| #479 | 09-11 | ticket | 2.7 | W | 3 | 2/0/0/1/0/0 | 2 | 5 (0) | 100 | – | 7 / 70 | clean |
| #480 | 09-11 | ticket | 1.4 | W | 2 | 1/1/0/0/0/0 | 1 | 1 (0) | 2 | 0/1 | – | by-hand |
| #483 | 09-11 | ticket | 2.2 | W | 3 | 2/1/0/0/0/0 | 0 | 4 (0) | 36 | 0/1 | 3 / 55 | clean |
| #484 | 09-11 | ticket | 3.2 | W | 4 | 3/1/0/0/0/0 | 1 | 6 (0) | 53 | 0/1 | 5 / 243 | clean |
| #488 | 09-11 | ticket | 1.9 | W | 3 | 1/2/0/0/0/0 | 0 | 4 (0) | 92 | 0/2 | 5 / 111 | owner-merged (nh) |
| #489 | 09-11 | ticket | 2.0 | W | 3 | 1/2/0/0/0/0 | 1 | 3 (0) | 66 | 0/2 | – | by-hand |
| #490 | 09-11 | ticket | 2.1 | W | 3 | 1/2/0/0/0/0 | 0 | 5 (0) | 29 | 0/2 | 29 / 129 | stops (nh) |
| #493 | 09-11 | spec child | 1.6 | PWS | 4 | 1/2/0/1/0/0 | 2 | 2 (0) | 22 | 0/2 | 3 / 78 | stops (st) |
| #494 | 09-11 | spec child | 2.0 | PWS | 5 | 2/2/0/1/0/0 | 2 | 5 (0) | 66 | 0/2 | – | session (ar,nh,st) |
| #495 | 09-11 | spec child | 1.1 | PWS | 2 | 1/1/0/0/0/0 | 1 | 1 (0) | 15 | 1/1 | – | session |
| #496 | 09-11 | spec child | 1.2 | PWS | 3 | 1/1/0/1/0/0 | 2 | 1 (0) | 5 | 0/1 | – | session (ar,nh) |
| #497 | 09-11 | spec child | 1.4 | PWS | 2 | 1/1/0/0/0/0 | 0 | 2 (0) | 18 | 0/1 | 2 / 27 | clean |
| #498 | 09-11 | spec child | 1.3 | PWS | 2 | 1/1/0/0/0/0 | 1 | 2 (0) | 20 | 0/1 | 2 / 45 | clean |
| #499 | 09-11 | spec child | 1.5 | PWS | 3 | 1/2/0/0/0/0 | 0 | 4 (0) | 29 | 0/2 | 4 / 77 | clean |
| #500 | 09-11 | spec child | 1.3 | PWS | 2 | 1/1/0/0/0/0 | 0 | 2 (0) | 14 | 0/1 | 2 / 12 | clean |
| #501 | 09-11 | spec child | 1.8 | PWS | 4 | 1/3/0/0/0/0 | 0 | 6 (0) | 41 | 0/3 | 6 / 28 | clean |
| #502 | 09-11 | spec child | 1.3 | PWS | 2 | 1/1/0/0/0/0 | 1 | 2 (0) | 31 | 0/1 | 2 / 25 | clean |
| #503 | 09-11 | spec child | 1.4 | PWS | 2 | 1/1/0/0/0/0 | 0 | 2 (0) | 43 | 0/1 | 2 / 43 | clean |
| #504 | 09-11 | spec child | 1.3 | PWS | 2 | 1/1/0/0/0/0 | 0 | 2 (0) | 22 | 0/1 | 2 / 26 | clean |
| #507 | 09-11 | ticket | 1.3 | W | 1 | 0/0/0/1/0/0 | 0 | 1 (0) | 1 | – | – | session |
| #516 | 09-11 | ticket | 2.2 | W+1 | 3 | 2/1/0/0/0/0 | 0 | 3 (0) | 55 | 0/1 | – | session |
| #517 | 09-11 | ticket | 1.4 | W+1 | 2 | 2/0/0/0/0/0 | 1 | 2 (0) | 33 | – | – | session |
| #518 | 09-11 | ticket | 1.7 | W+1 | 2 | 2/0/0/0/0/0 | 0 | 4 (0) | 58 | – | – | session |
| #520 | 09-12 | ticket | 2.5 | W+1 | 3 | 2/1/0/0/0/0 | 1 | 6 (1) | 96 | 0/1 | – | by-hand |
| #521 | 09-12 | ticket | 8.6 | W | 12 | 4/5/2/1/0/0 | 0 | 9 (2) | 74 | 0/5 | 63 / 2082 | stops (cr,nb,st) |
| #522 | 09-12 | ticket | 3.5 | W | 6 | 0/3/1/2/0/0 | 0 | 9 (1) | 61 | 0/3 | – | by-hand |
| #524 | 09-12 | ticket | 2.8 | W | 3 | 1/2/0/0/0/0 | 0 | 4 (0) | 57 | 1/2 | 4 / 82 | clean |
| #532 | 09-13 | ticket | 2.4 | WB | 5 | 4/0/1/0/0/0 | 0 | 4 (0) | 13 | – | 4 / 29 | clean |
| #533 | 09-13 | ticket | 3.1 | WB | 7 | 1/3/2/0/0/1 | 1 | 7 (0) | 36 | 0/3 | 10 / 208 | stops (cr,nh,rc,st) |
| #534 | 09-13 | ticket | 3.4 | WB | 5 | 1/2/1/0/1/0 | 0 | 6 (0) | 106 | 0/2 | – | by-hand |
| #535 | 09-13 | ticket | 3.7 | WB | 7 | 1/3/2/0/1/0 | 3 | 14 (2) | 205 | 1/3 | – | by-hand |
| #537 | 09-13 | ticket | 3.7 | W | 8 | 2/3/1/2/0/0 | 1 | 9 (3) | 115 | 0/3 | – | by-hand |
| #538 | 09-13 | ticket | 13.5 | W+1 | 7 | 1/4/2/0/0/0 | 0 | 16 (12) | 17 | 0/4 | – | open (nh) |
| #539 | 09-13 | ticket | 3.9 | W | 5 | 2/2/1/0/0/0 | 1 | 9 (2) | 94 | 0/2 | – | superseded (ad,nh,st) |
| #541 | 09-13 | ticket | 3.2 | W | 5 | 2/2/1/0/0/0 | 1 | 4 (2) | 14 | 0/2 | 4 / 56 | owner-merged (nh) |
| #542 | 09-13 | ticket | 1.4 | W | 3 | 1/1/1/0/0/0 | 0 | 2 (0) | 51 | 0/1 | 2 / 56 | clean |
| #543 | 09-13 | ticket | 1.3 | W | 3 | 1/1/1/0/0/0 | 0 | 2 (0) | 20 | 0/1 | 3 / 146 | clean |
| #544 | 09-13 | ticket | 1.9 | W | 4 | 1/2/1/0/0/0 | 0 | 2 (0) | 15 | 0/2 | 3 / 65 | stops (ar,st) |
| #550 | 09-13 | ticket | 3.5 | – | 5 | 3/1/1/0/0/0 | 0 | 7 (2) | 88 | 0/1 | – | by-hand |
| #551 | 09-13 | ticket | 3.6 | W | 5 | 1/0/2/1/0/1 | 0 | 6 (1) | 44 | – | – | session |
| #552 | 09-13 | ticket | 6.5 | +4 | 5 | 1/2/1/1/0/0 | 2 | 2 (1) | 17 | 0/2 | 6 / 33 | clean |
| #553 | 09-13 | ticket | 2.5 | – | 7 | 0/5/1/1/0/0 | 1 | 8 (0) | 91 | 0/5 | 11 / 223 | owner-merged (nh) |
| #554 | 09-13 | ticket | 1.4 | – | 5 | 3/1/1/0/0/0 | 0 | 5 (2) | 9 | 0/1 | 5 / 139 | clean |
| #555 | 09-13 | ticket | 2.1 | – | 5 | 2/1/1/1/0/0 | 1 | 5 (0) | 18 | 0/1 | 5 / 14 | clean |
| #556 | 09-13 | ticket | 2.5 | – | 6 | 2/2/1/1/0/0 | 1 | 6 (1) | 96 | 0/2 | 9 / 90 | clean |
| #557 | 09-13 | ticket | 1.9 | – | 6 | 2/2/1/1/0/0 | 1 | 3 (1) | 22 | 0/2 | 6 / 154 | stops (cr,st) |
| #558 | 09-13 | ticket | 2.7 | – | 6 | 2/1/1/2/0/0 | 0 | 7 (0) | 49 | 0/1 | – | by-hand |
| #559 | 09-13 | ticket | 6.1 | +3 | 8 | 5/1/1/0/1/0 | 0 | 7 (0) | 171 | 1/1 | 7 / 191 | clean |
| #568 | 09-14 | ticket | 0.9 | W | 2 | 2/0/0/0/0/0 | 0 | 2 (2) | 0 | – | – | superseded |
| #570 | 09-14 | ticket | 1.0 | W | 2 | 0/2/0/0/0/0 | 0 | 1 (0) | 16 | 0/2 | 2 / 48 | stops (nh,rc) |
| #573 | 09-14 | ticket | 2.1 | W | 4 | 0/1/0/0/0/3 | 0 | 1 (0) | 16 | 0/1 | – | session |
| #574 | 09-14 | ticket | 2.1 | W | 2 | 1/0/0/0/0/1 | 1 | 5 (0) | 105 | – | – | session |
| #575 | 09-14 | ticket | 2.1 | W | 3 | 0/2/1/0/0/0 | 1 | 4 (0) | 84 | 0/2 | – | by-hand |
| #576 | 09-14 | ticket | 9.4 | W+4 | 3 | 1/1/0/1/0/0 | 0 | 2 (0) | 30 | 0/1 | 3 / 105 | clean |
| #577 | 09-14 | ticket | 2.5 | – | 3 | 3/0/0/0/0/0 | 1 | 2 (0) | 25 | – | 3 / 49 | stops (ad,st) |
| #578 | 09-14 | ticket | 2.7 | – | 4 | 3/0/0/0/1/0 | 0 | 2 (0) | 71 | – | 6 / 203 | clean |
| #579 | 09-14 | ticket | 2.2 | – | 3 | 3/0/0/0/0/0 | 0 | 3 (0) | 31 | – | 8 / 187 | stops (ad,cr,nh,st) |
| #582 | 09-15 | ticket | 2.2 | W | 3 | 0/3/0/0/0/0 | 0 | 4 (0) | 25 | 0/3 | 5 / 50 | clean |
| #583 | 09-15 | ticket | 2.2 | W | 3 | 1/2/0/0/0/0 | 0 | 3 (1) | 12 | 0/2 | 4 / 83 | clean |
| #584 | 09-15 | ticket | 3.5 | – | 5 | 5/0/0/0/0/0 | 1 | 4 (1) | 15 | – | 4 / 96 | stops (ad,st) |
| #585 | 09-15 | ticket | 3.1 | – | 4 | 4/0/0/0/0/0 | 0 | 6 (1) | 81 | – | 7 / 80 | stops (ad,nh,st) |
| #586 | 09-15 | ticket | 2.8 | – | 3 | 3/0/0/0/0/0 | 0 | 4 (0) | 40 | – | 5 / 19 | clean |
| #587 | 09-15 | ticket | 3.8 | – | 5 | 5/0/0/0/0/0 | 1 | 7 (1) | 32 | – | 10 / 142 | stops (st) |
| #600 | 09-16 | ticket | 3.0 | WB | 4 | 3/1/0/0/0/0 | 0 | 6 (2) | 49 | 0/1 | 6 / 76 | stops (ad,nh,st) |
| #601 | 09-16 | ticket | 4.8 | W | 10 | 2/3/1/0/0/4 | 0 | 5 (1) | 110 | 0/3 | – | session |
| #602 | 09-16 | ticket | 2.9 | W | 8 | 2/3/1/1/0/1 | 1 | 5 (0) | 123 | 0/3 | – | session |
| #603 | 09-16 | ticket | 5.0 | WB | 7 | 3/4/0/0/0/0 | 0 | 6 (2) | 30 | 0/4 | 6 / 549 | clean |
| #606 | 09-16 | ticket | 3.1 | W | 6 | 5/1/0/0/0/0 | 0 | 5 (2) | 18 | 0/1 | – | session |
| #607 | 09-16 | spec child | 2.3 | PWS | 7 | 4/3/0/0/0/0 | 0 | 8 (4) | 24 | 0/3 | 7 / 254 | clean |
| #608 | 09-16 | spec child | 1.3 | PWS | 3 | 1/2/0/0/0/0 | 0 | 2 (2) | 0 | 0/2 | 2 / 368 | clean |
| #609 | 09-16 | spec child | 1.2 | PW | 4 | 2/2/0/0/0/0 | 0 | 4 (0) | 97 | 0/2 | – | stranded (nh,rc) |
| #610 | 09-16 | spec child | 1.9 | PWS | 5 | 4/1/0/0/0/0 | 0 | 7 (0) | 113 | 0/1 | 5 / 73 | clean |
| #611 | 09-16 | spec child | 1.9 | PWS | 5 | 3/2/0/0/0/0 | 0 | 8 (0) | 111 | 0/2 | 8 / 250 | clean |
| #612 | 09-16 | spec child | 1.2 | PW | 4 | 2/2/0/0/0/0 | 0 | 5 (0) | 9 | 0/2 | – | stranded (nh,rc) |
| #613 | 09-16 | spec child | 1.7 | PW | 6 | 5/1/0/0/0/0 | 0 | 8 (0) | 55 | 0/1 | 8 / 110 | clean |
| #614 | 09-16 | spec child | 1.3 | PW | 5 | 4/1/0/0/0/0 | 0 | 5 (0) | 29 | 0/1 | 5 / 160 | clean |
| #615 | 09-16 | spec child | 1.5 | PW | 5 | 3/2/0/0/0/0 | 0 | 7 (0) | 22 | 0/2 | – | stranded (nh,rc) |
| #616 | 09-16 | spec child | 1.2 | PW | 4 | 3/1/0/0/0/0 | 0 | 6 (0) | 22 | 0/1 | 6 / 120 | clean |
| #617 | 09-16 | spec child | 1.8 | PW | 7 | 4/3/0/0/0/0 | 0 | 7 (0) | 54 | 0/3 | 12 / 266 | stops (cr) |
| #618 | 09-16 | spec child | 1.4 | PW | 5 | 3/2/0/0/0/0 | 0 | 7 (0) | 44 | 0/2 | – | stranded (nh,rc) |
| #619 | 09-16 | spec child | 1.1 | PW | 4 | 2/2/0/0/0/0 | 0 | 4 (0) | 33 | 0/2 | 6 / 426 | stops (cr) |
| #620 | 09-16 | spec child | 1.7 | PWS | 4 | 2/2/0/0/0/0 | 0 | 4 (0) | 14 | 0/2 | 4 / 88 | clean |
| #621 | 09-16 | spec child | 2.2 | PWS | 7 | 3/4/0/0/0/0 | 0 | 6 (0) | 69 | 0/4 | – | stranded (nh,rc) |
| #622 | 09-16 | spec child | 1.2 | PW | 5 | 1/4/0/0/0/0 | 0 | 5 (0) | 11 | 0/4 | 10 / 156 | clean |
| #623 | 09-16 | spec child | 2.1 | PWS | 6 | 4/2/0/0/0/0 | 0 | 8 (0) | 66 | 0/2 | – | stranded (nh,rc) |
| #624 | 09-16 | spec child | 0.6 | PW | 2 | 1/1/0/0/0/0 | 0 | 2 (0) | 65 | 0/1 | 5 / 106 | clean |
| #625 | 09-16 | spec child | 1.2 | PW | 5 | 3/2/0/0/0/0 | 0 | 6 (0) | 38 | 0/2 | – | stranded (nh,rc) |
| #626 | 09-16 | spec child | 1.0 | PW | 3 | 1/2/0/0/0/0 | 0 | 4 (0) | 45 | 0/2 | – | stranded (nh,rc) |
| #627 | 09-16 | spec child | 1.4 | PWS | 3 | 1/2/0/0/0/0 | 0 | 3 (0) | 6 | 0/2 | – | stranded (nh,rc) |
| #628 | 09-16 | spec child | 0.9 | PW | 3 | 1/2/0/0/0/0 | 0 | 3 (0) | 12 | 0/2 | 11 / 536 | clean |
| #629 | 09-16 | spec child | 2.0 | PW | 8 | 3/5/0/0/0/0 | 0 | 6 (1) | 17 | 0/5 | 10 / 314 | stops (cr,nh,rc) |

## Size

**What the limit counts today.** `claimLimit` (8, in `ticket-shape.rules.json`) counts the lines
under `## Files claimed`, and nothing else.

- **At filing:** `file-issue` refuses a wider claim (`ticket_shape.py` `validate`), and so does
  lane 03's publisher.
- **At the door:** `reconcile.ts` relabels a wider ticket `to-spec`.
- **Uncounted:** bytes, criteria, lines changed, and files edited outside the claim.

**Why it counts files.** `5c544a7` (09-13) set the limit after #539:

- #539 claimed 9 files. The acceptance author inlined 92 KiB of them, and the first pass used
  17.3 of a 24-minute budget.
- The commit chose 8 because it sat above every success and below every failure in the tickets it
  looked at.

**What has changed since:**

- **The acceptance author no longer inlines files.** `2cfdfdc` (09-16) turned `CLAIMED_FILES`
  into a list of paths. The commit kept the limit and gave a new reason: "the implementer's brief
  still inlines claimed files".
- **The implementer brief already caps by bytes.** `implement/brief.ts:37-38` sets
  `INLINE_BUDGET_BYTES` to 150,000 and `INLINE_FILE_CAP_BYTES` to 40,000. A file over either cap is
  listed by path as "not inlined: over budget" (`brief.ts:172-181`).
- **One input is still uncapped.** Test files carrying `#N.` are inlined whole
  (`implement.ts` `findFailingTestFiles`).

**Where eight files misjudges, case by case:**

| Ticket | Claimed | KB at filing | Criteria | Outcome |
|---|---|---|---|---|
| #607 | 8 | 25 | 7 | clean in 38m, 254 changed lines |
| #539 | 9 | 94 | 5 | author died ×2, three-strike stop, split by hand |
| #585 | 6 | 82 | 4 | author died ×2, three-strike stop |
| #600 | 6 | 49 | 4 | author died ×2, three-strike stop |
| #579 | 3 | 31 | 3 | author died ×3 (two after merge) |
| #559 | 7 | 171 | 8 | clean |
| #242 | 2 (one a glob) | 439 | 2 | clean |
| #624 | 2 | 65 | 2 | clean, but its PR edited 3 unclaimed tracker files; the nine #538 casualties then conflicted on them |

- **Tickets that pass the limit.** #585, #600 and #579 were inside it and still struck out. #624
  was inside it and its unclaimed edits stranded nine siblings (#649 class 5).
- **Tickets it would stop.** Only #539 is a case where the file count and the failure line up,
  and its failure was about bytes.
- **Bytes on their own did not predict a stop either.** Clean runs claimed a median of 30 KB,
  and runs with stops also claimed 30 KB. 9 of 13 lane tickets with a claimed file over 40 KB ran
  clean.

**What else could be counted:**

| Measure | Known at filing? | What the data shows |
|---|---|---|
| Claimed files | yes | Clean share falls as count rises (23/30 at ≤2 down to 7/20 at 7–8), in both periods. The 9+ bucket is all pre-limit and pre-fix tickets |
| Bytes the consuming agent is actually handed | yes, per consumer | #539's failure was this. The implementer already enforces its own version. Nothing checks it at filing |
| Criteria | yes | 16/22 clean at ≤2 against 6/18 at 7+. Each criterion becomes at least one authored test, so criteria count drives the acceptance author's work |
| Lines changed | no, only after the build | The strongest pattern found: 41/58 clean at ≤100 lines against 8/23 above 300. Clean median 77 lines, stopped median 157 |
| Files edited outside the claim | no | 39/53 clean when the PR stayed inside the claim, against 26/63 when it didn't. The claim limit and the collision hold both see only claimed files |
| Claimed paths that don't exist yet | yes | 51/83 clean with none against 14/42 with one or more. Tangled with the #538 wave, whose tickets created files |

## No-ops

A no-op here is a ticket or lane run that built nothing because the work was already true,
already merged, obsolete, or filed twice.

| Kind | Count | Tickets | Why | What the ticket or its filing could have said |
|---|---|---|---|---|
| Implementer "found nothing to build" | 4 tickets | #237, #272, #521, #570 | #237: lane 05 discarded its implementer's work (fixed by `5f9eca9` the same day). #272 and #521: the implement run started after the closing record was posted (9 and 4 minutes later). #570: 3–4 runs answered with no change and the lane rang again (#649 class 13; `e16f162` now holds such a ticket). The loop followed a shallow-clone rebase conflict (`7abef7b`) | Mostly not the ticket's doing. A no-op check at dispatch ("PR merged, closing record posted") would have stopped #272 and #521 |
| Lane runs on work that had already merged or closed | 6 tickets, 8 runs (#649 class 10), plus #272 | #533, #579, #617, #619, #629, #521 | The reconciler did not know the ticket's PR had merged. A close refusal left the ticket open | Machine fact, not ticket text |
| Acceptance batch vacuous ("already pass" under `test.fails`) | 1 | #496 | Criteria 2 and 3 were stay-true claims ("the suite still passes", "the repo still typechecks"). Criterion 1 described a type-only migration no runtime test can tell apart. A session closed it 53 minutes later | Under today's rules (`dd13169`, 09-16), criterion 3 (`npm run typecheck`) is held as a whole-repo check. Criterion 2 is held only if its suite passes at filing: its test file is not the claimed path. Criterion 1 names the claimed file, so it is exempt |
| Obsolete on arrival | 4 | #160, #166, #171, #177 | Sliced from a PRD that edited `DESIGN.md`, which `a2643a2` had deleted hours before the slicing | A check that the ticket's claimed paths exist on trunk. They were edits, not creations. Today that is an advisory warning, and lane 03's publisher doesn't run it |
| Filed twice | 11 | #198–#200 (concurrent session), #204–#208 (#189 sliced twice), #387–#389 (walk-home: same SHA and failing step) | Two writers with no dedupe | A dedupe probe at filing: an open ticket with the same claim and title, or the same SHA and failing step |
| Superseded before building | 6 | #190–#192 (cut from #189's pre-critique body), #178, #406, #423 | Rewritten upstream after filing | – |
| Delivered by other tickets | 4 | #89, #90, #91, #99 (wayfinder moves) | The work landed through ADRs and their own tickets | – |
| Already done when split | 1 umbrella | #331 | Two of nine criteria were already met by `cc9e5e3` | A red-today run at filing |
| Grep or exists checks already green at filing | 58 of 396 checks, on 29 of 163 tickets | full list below | 18 of the 58 are absence checks (`! grep`, `test ! -e`) whose target never existed or was already gone. Five tickets, #313–#317, used `grep -A1 '"on":' <file>`, which exits 0 whenever the key exists, so it can never be red. #187 was the one ticket with every criterion green at filing | Today's `already_true_checks` runs these. But it skips any command naming a claimed path (`ticket_shape.py:515-521`), which exempts 42 of the 58. Lane 03's publisher runs no red-today check at all |

**Tickets whose green-at-filing check today's exemption would not skip** (the command names no
claimed path): #187, #208, #251, #264, #326, #327, #329, #331, #334, #417, #535.

**Stay-true criteria:**

- There are 133 across 112 tickets.
- Red today holds one only when its check passes at filing and the command names no claimed path.
- The format tells the author that "What must stay true… belongs to the tests that already hold
  it" (`ticket-format.md:34-35`).
- Nothing refuses the wording itself.

## Audit of the format

Covers:

- `docs/agents/ticket-format.md` (7.7 KB).
- `~/bin/file-issue --help` (about 5.9 KB, byte-identical to this tree's `bin/file-issue`).
- The ticket as the acceptance author receives it: `acceptance/author/prompt.md`, filled at
  `acceptance.ts:243-282` with `{{ISSUE_BODY}}` and numbered `{{CRITERIA}}`.
- The ticket as the implementer receives it: `implement/brief.ts` `assembleBrief`, placed at
  `{{BRIEF}}` in `implementer/prompt.md`.

The format doc is also a prompt. `to-tickets.ts:126-143` injects everything above `## Variants`,
plus the Spec sub-issue variant, into the slicer. `enrol/seeded-docs.ts` copies it into every
enrolled repo.

### The five findings that most change what an agent does

| # | Lever | Where | Finding | What enforces it | Evidence |
|---|---|---|---|---|---|
| 1 | Rule written as description; environment contradicts | `ticket-format.md:33-36` | "Red today" is stated as holding for every criterion, but the filing check skips any command that names a claimed path. The doc's own recommended check, "the test file proving this claim" (`:44`), usually names one. Lane 03's publisher runs no red-today check at all | **Session door:** `ticket_shape.py` `already_true_checks`. It exempts claimed and `--test` paths, and skips unresolvable, unparseable, tracker and `-R` other-repo commands. **Spec door:** nothing (`render-body.ts` `criterionProblem` checks only line shape, marker parse and tracker reads) | #624 criterion 2, "`acceptance.test.ts`'s suite passes", checked by `npx vitest run …acceptance.test.ts`, passes before any work. 42 of 58 historical green grep checks name a claimed path (No-ops) |
| 2 | Environment contradicts the doc | `ticket-format.md:41` vs `:49-51` | The only worked check-marker example is `` check: `bin/lint` ``. `.claude/contract.json` names `bin/lint` as a slot command, so it is the whole-repo check "Narrow" says `file-issue` holds | `ticket_shape.py` `whole_repo_commands` (exact match against contract commands) | `validate("ticket", …)` on the example returns the whole-repo warning |
| 3 | Stale reason (sediment) | `ticket-format.md:88-91`; `to-tickets/slice/prompt.md:44`; `ticket-shape.rules.json:27`; `reconcile.ts:150` | The claim limit's reason is told three ways. The doc and slicer prompt say the implementer brief inlines every file and "#539's nine files spent that whole budget". The refusal text and reconcile comment say lane 04's author inlines every file. Neither holds: #539 died in the acceptance author with 0 implement runs; since `2cfdfdc` that author inlines nothing; and the implementer brief caps by bytes | Count: `validate` and the lane 03 publisher. Bytes: `brief.ts` `snapshotWithBudget` (implementer only). Handed-over test files: nothing | #624's claimed `acceptance.test.ts` is 42,893 B on today's trunk, over the 40 KB cap, so the brief omits it |
| 4 | Pointer names the wrong enforcer | `ticket-format.md:46-48` | Says "`/drain` skips a ticket carrying an item without a marker". `/drain` is a skill, not the lane path. The live `to-build` door admits a ticket when at least one criterion has a marker. `close-ticket` then records the unmarked ones `UNVERIFIED` and closes on the rest | `dispatch/ticket-state.ts` `toBuildRefusal` (`.some`); `close-ticket:509` (UNVERIFIED), `:538-550` (refuses only when every item is unverified) | Door refusal text: "none of its acceptance criteria carry a `check:` marker" |
| 5 | Documented example drifts from what lanes emit and parse; no intent section | `ticket-format.md:111-135` | The doc's spec sub-issue carries `## Parent` and says the publisher adds `Part of #<parent>`. Lane 03 writes `## Parent PRD`, `## What to build`, criteria, `## Files claimed` with the em-dash sentinel `- None - no files.`, and `## Seams consumed`, and no `Part of` line. The acceptance lane finds the PRD only through `## Parent PRD` (`ticket-shape.ts` `parentPrdNumber`), so a body written from the example reaches the author as "(no parent PRD)". The doc names no intent or why section, yet 304 of 361 bodies carry `## What to build`, and both lanes receive the whole body word for word | Shape only: `shared/ticket-format-doc.proc.test.ts:58-63`. Nothing compares the example with `render-body.ts:154-166` | #607 and #624 headings; section tally in Tickets in the wild |

### Other findings, one line each

| Lever | Where | Finding | Enforcer |
|---|---|---|---|
| Environment contradicts | `ticket-format.md:52-54` | Doc says `gh`, `curl` and `wget` are refused. The regex matches only `gh api/issue/pr/run`, so `gh search issues foo` validates clean | `rules.json` `checkReadsTracker`; same regex in `render-body.ts` |
| Rule enforced on one door only | `ticket-format.md:74-77` (ADR-0118) | Rooted paths are refused only by lane 03's publisher. `file-issue` files a bare `gh.ts` with an advisory "not found" | `render-body.ts` `validatePathsAreRooted`; `file-issue`: nothing |
| Rule enforced on one door only | `ticket-format.md:49-51, 56-62, 64-70` | The narrow-check, `/bin/sh`-parse and migration rules run only in `file-issue`, never in lane 03's publisher | `ticket_shape.py` only |
| Promise with no reader | `ticket-format.md:14-16` | "Where the next reader meets them": no lane prompt tells the implementer or author what to do with `## Warnings acknowledged`. No ticket carries it yet | nothing |
| Disclosure | `ticket-format.md:35-36`; `file-issue --help` | `--test` (filing session writes the failing tests) gets a long paragraph in `--help` and only an exemption clause in the doc. It was used 7 times (#367, #371, #372, #584–#587). Acceptance ran anyway on #584 (2 runs), #585 (4, three-strike stop) and #587 (2) | `stageOf` in `dispatch/ticket-state.ts` looks only for an `accept/issue-N` branch |
| Sediment | `file-issue --help` | Most of `--help` is history (#300, #283, #573, #102, ADR-0005, ADR-0024), not filing steps | – |
| Help names other producers | `file-issue --help` | Names `/to-spec`, `/wayfinder`, `/standards-pass`; the doc names `/to-tickets`, `/wayfinder` and sessions | – |
| Help list incomplete | `file-issue --help` | The warning list omits "first word doesn't resolve" and "`/bin/sh` can't parse" | – |
| Help cites a missing path | `file-issue --help` | Cites `hooks/test_ticket_templates.py`; the file lives at `.claude/hooks/` | – |
| Undocumented hold | `ticket_shape.py` `_check_already_green` | A check running past 30 s at filing gives a blocking warning, so a slow vitest check needs `--ack`. The doc doesn't say so | `file-issue` `blocking_warnings` |
| Generated text, interpolated half | `brief.ts` `assembleBrief` | The ticket body goes in raw under `## Ticket`, so its own `##` headings sit level with the brief's sections, and the ticket's `## Files claimed` comes before the brief's `## Files claimed, as they stand`. Nothing caps body size. Comments are capped at 30 KB, oldest dropped first | nothing for body size |
| False in the worst case | `implementer/prompt.md:4-8` | "The current content of every file the ticket claims" is false for a claimed file over 40 KB, or once 150 KB is used; the file then shows only as a path | `brief.ts` budget |
| Claim model scope | `ticket-format.md:99-102` | Collisions are held on claimed files only. The implementer may edit outside its claim to repair (`implementer/prompt.md` step 3). 63 of 116 merged build PRs changed more files than they claimed | `reconcile.ts` `heldBy`; nothing for unclaimed edits |
| "Every example runs through the validator" | `ticket-format.md:106-107` | True for the three Variants blocks. The inline examples at `:41` and `:61` are not run, and the Wayfinder decision example is checked as kind `question`, not `ticket` | `ticket-format-doc.proc.test.ts:10-14`; `.claude/hooks/test_ticket_templates.py` |

### Already right, checked against the enforcer

- **Refusals.** A missing heading, a criteria heading with no items, a glob, a claim over
  `claimLimit`, or a tracker check refuses, and nothing is filed. `ticket_shape.py` `validate`
  refuses; `file-issue` returns 1 before calling `gh`.
- **Holds.**
  - An unmarked, unparseable or whole-repo check holds.
  - A claimed path with no near neighbour is advisory; one with a neighbour holds.
  - `--ack` appends the reason and the warnings.
- **Checks at close.** `close-ticket` runs checks with `shell=True` (`:431`) and records
  `UNVERIFIED: no check` (`:509`).
- **`by-hand` claims.** An immutable-set, workstation or cross-repo claim is labelled `by-hand`
  (`by_hand_classification`), and the door stands it down (`ticket-state.ts` `doorOf`).
- **Over-limit claims.** Relabelled `to-spec`, and lane 02 is dispatched (`doorOf` →
  `reconcile.ts` `sendToSpec`).
- **ADR-0199.** A claim overlapping a live run is skipped for that pass, with no `blockedBy` edge
  (`reconcile.ts` `heldBy`).
- **The immutable-set list** in the doc matches `immutable-set.json`.

### Constraints on any edit to the doc

- **Variant blocks.**
  - `shared/ticket-format-doc.proc.test.ts` splits on `## Variants` and `### `. Each variant label
    needs a known prefix and a markdown block that passes `validate()`.
  - `.claude/hooks/test_ticket_templates.py` runs the same blocks.
- **Slicer injection.** `to-tickets/ticket-format.test.ts` requires the injected core to contain
  `### Spec sub-issue`, `claimLimit` and `bash -c`, and not "Wayfinder decision".
- **Wording pins:**
  - #483.3: the doc contains `/bin/sh` and `bash -c`.
  - #425.3: it contains "immutable set".
  - #587.4: it does not contain `bin/lint path/to/file`.
  - #559.6: a paragraph about collisions mentions `reconcile`.
  - `implement.test.ts:116` pins `- None, no files.`
- **Enrolment.** `enrol/seeded-docs.ts` carries any edit into enrolled repos.

## Variations worth an experiment

Each is a candidate, not a recommendation. "Experiment" means a small `task` run through the ticket
door: a handful of real tickets filed with `file-issue ticket`, fired with `to-build`, and measured
with the same timeline and PR reads this note used.

### 1. An intent section in the owner's words

- **What it changes.** A `## Why` section quoting the owner's request as spoken, beside
  `## What to build`. Today the format names neither section. `What to build` appears on 304 of
  361 bodies anyway, written by the filer, and a why, problem or what-went-wrong section on 46. Both lanes
  already receive the body verbatim (`{{ISSUE_BODY}}`; `brief.ts` `## Ticket`), so no lane change
  is needed to deliver it.
- **Evidence so far.** Three lane tickets since 09-11 carried a why-style section (#552, #559,
  #576), and all three ran clean. Too few to tell.
- **Experiment.** File 6–10 small tickets in matched pairs, one with the owner's words quoted and
  one without. Measure:
  - Acceptance tests whose names or assertions trace to the intent rather than only to the
    criterion text.
  - Close-ticket first-try pass.
  - Merged PR files outside the claim.
  - The owner's own faithfulness verdict per PR, one line each.

### 2. A size limit on bytes, criteria or diff instead of file count

- **What it changes.** Replace or supplement `claimLimit`'s file count with one of:
  - bytes handed to the consuming agent (claimed files plus `#N.` test files, per consumer
    budget);
  - a criteria cap;
  - a declared expected diff size.
- **Evidence so far.** Size section. The count stops #539 only, and passes #585, #600 and #624's
  case.
- **Experiment.** Shadow mode first: for the next 20 filings, log what each candidate limit would
  have said (file count, claimed bytes, bytes over the 40 KB file cap, criteria count), then match
  against outcome. A live arm would lift the file count to 12 for 3–4 tickets that are small in
  bytes, and measure author deaths, implement time and conflict rate.

### 3. Test-first tickets: the filing session writes the failing tests

- **What it changes.** The filing session's tests become the acceptance tests, and the acceptance
  author run is skipped. `file-issue --test` already commits `test.fails("#N.i: …")` tests, but
  `stageOf` routes to `needs-test` unless an `accept/issue-N` branch exists. ADR-0191's one-writer
  rule keeps sessions off that branch, so the author runs anyway. This idea was raised
  2026-09-16 and not followed (`unfollowed-ideas-2026-09.md`, item 3).
- **Evidence so far.**
  - Seven hand-overs. On #584, #585 and #587 the author still ran 2, 4 and 2 times, and #585
    reached the three-strike stop.
  - The acceptance author died on 6 lane tickets, and acceptance was the slow stage in #649.
- **Experiment.** Five tickets filed with `--test`, and a door change on a branch that counts
  handed-over tests on trunk as `needs-build`. Measure:
  - Fired-to-merged time against the 23-minute clean median.
  - Author runs avoided.
  - Vacuous tests (green under `test.fails` at filing).
  - Close refusals.
  - Whether the implementer edited the handed-over tests (the lane refuses that; #490).

### 4. A no-op check at filing that covers claimed-path commands and duplicates

- **What it changes.** Red today would run every check, including those naming a claimed path, and
  report which were green. It would add a probe for an open ticket with overlapping claims and a
  similar title, and for claimed edit targets missing from trunk. It would run the same checks in
  lane 03's publisher.
- **Evidence so far.** No-ops section:
  - 42 of 58 green grep checks sit inside today's exemption.
  - 4 slices were obsolete on arrival.
  - 11 tickets were filed twice.
  - #496's batch was vacuous.
- **Experiment.** Log-only for the next 20 filings and slices:
  - Count checks green at filing that today's rule skips.
  - For each, check whether the merged diff changed what the check reads.
  - Count duplicate-probe hits the owner agrees are real.

  No filing is held during the experiment.

### 5. One or two criteria per ticket

- **What it changes.** The slicer and filers cut work to at most two criteria per ticket, chaining
  the rest.
- **Evidence so far.** 16/22 clean at ≤2 criteria against 6/18 at 7+. Criteria count also sets how
  many tests the author must write in one run.
- **Experiment.** Take one spec's children and publish half at ≤2 criteria each and half as
  usual. Measure the clean rate, total fired-to-merged wall time for the whole spec, and conflicts
  between siblings (more tickets means more chances to collide).

### 6. A declared "may also touch" list

- **What it changes.** An optional section naming files the work may edit beyond its claim
  (regenerated indexes, shared test doubles). The reconciler would hold it against live runs the
  way it holds a claim.
- **Evidence so far.** 63 of 116 merged build PRs changed more files than claimed. Those ran clean
  26/63 against 39/53. #624's three unclaimed tracker edits stranded nine siblings.
- **Experiment.** On the next spec wave of 6 or more children, ask the slicer to fill the section,
  and measure rebase conflicts and stranded runs against #538's wave.

## Not verified

- **No controlled comparison.** Every trait-to-outcome figure is a co-occurrence from 125 lane
  tickets, most of whose stops trace to machine bugs fixed within days. No experiment separated a
  ticket trait from the bug of the week.
- **Outcome classes before 09-02** use the same rules as #649 but were not hand-checked. Runs
  before 09-06 carry no issue number, so stops that left no comment are missed.
- **Stop detection is text matching on lane comments.** One false positive (#196, whose criteria
  quote "nothing to build") was found and removed. Others may remain.
- **Marker kinds** come from a regex over the command. A few commands (a `for` loop that runs
  tests, `sh -c` wrappers) could sit in a neighbouring kind.
- **Claimed KB** measures bytes at filing on trunk, not what a lane actually inlined at run time.
  Paths in other repos, unrooted names and globs count as 0 bytes and as new.
- **Grep checks green at filing** ran against `git archive` of trunk with `HOME` unset. Checks
  reading workstation files or other repos could read differently on the owner's machine. Test,
  whole-suite and other checks were not run at filing.
- **Stay-true** is a wording regex ("still", "unchanged", "stays", "continues to"), not a reading
  of each criterion.
- **Audit gaps.**
  - No rendered implementer or author brief from an actual run was read. #624's sizes are from
    today's trunk.
  - Whether any lane skips the acceptance author after a `--test` hand-over was checked by grep
    only.
- **History gaps.**
  - The slicer prompt history (`to-tickets/slice/prompt.md`, 18 commits) was not traced row by
    row.
  - How lane 05 rendered a ticket before `brief.ts` (09-04) was not checked.
  - Deliberate-or-reactive rests on commit messages and the opening of each cited issue.
- **Run transcripts and session logs were not read.** Causes come from lane comments, owner
  comments, commit messages and PR bodies.
