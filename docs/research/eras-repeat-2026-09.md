# Which recurring failures era 8 repeated, which durable wins it kept, and how its machinery grew

Researches: #654

Under map [#646](https://github.com/collod873/claude-workflow/issues/646), feeding its **Charter**
(the rules that keep the machine from sprawling). Recorded 2026-09-17 against trunk `a18261d`.
Facts and candidates only, no rulings. The baseline is the Seven Workflow Eras narrative of
2026-08-21 (`git show 26df9fa:artifacts/seven-workflow-eras.html`), which named F1–F7 and W1–W6.
Era 8 is this repository, `claude-workflow`, first commit `cc97c52` on 2026-08-21.

## Summary

- **Five of the seven failures came back in full, and two came back in part.** F2 (the machine is
  its own biggest customer), F3 (fixes move the problem), F4 (parked work looks finished), F5 (two
  sources of truth) and F6 (instruments die unseen) repeated with numbers at or above the
  era-5 and era-6 levels. F1 (ceremony) and F7 (asking the owner to size work) repeated in part:
  the design rules against both, but the runs show the cost anyway.
- **The machine became almost all of the work.** Commits across the machine repositories plus the
  one product repo it serves went from 40% machinery in July to 77% in August and 99% in September
  (to 09-17). Lumaria's last product-feature commits (accounting, navigation, components) are from
  2026-08-27; its later commits under product paths are test fixes and machinery refactors. The
  one Lumaria ticket the pipeline built end to end (#880, 09-10 to 09-11) changed hooks, not the
  product.
- **Era 8 rebuilt the orchestration layer era 6 had deleted, and era 5's signatures came back.**
  One label edit starts five workflows (era 5: "every label event woke every workflow"). Of 4,309
  runs in 14 days, 3,119 (72%) were skipped, cancelled or no-ops; era 5 was 1,365 of 2,120 (64%).
  Wall-clock run time averaged about 6.8 hours a day from 08-26 to 09-16, against era 5's 9.5
  machine-hours and era 6's 0.44. At least twelve ADRs rule on concurrency, claims, locks or merge
  order; era 5 needed six for its race surface.
- **Additions outran removals by about 20 to 1 in mechanisms and 2 to 1 in lines.** 28 lane
  workflows, 22 hooks, 24 `bin/` tools, 4 push-gate slots and 30 meter tests were added. 4 lane
  workflows and 1 tool were deleted, and 2 lanes were renamed into new jobs. 45 of 199 ADRs are
  superseded, 12 of them on the day they were written. The one week that shrank (week of 08-31) was
  an owner-decided cut (#360); three new push slots were added after it, and their code sits
  outside the size fence it installed.
- **Wins were kept in structure and weakened in operation.** W4 (decisions in the repo) and W6
  (autopsy while it stings) were kept and grew. W1 (gate at the action), W2 (checker is not
  builder), W3 (disjointness at authoring time) and W5 (owner owns vocabulary) are all present in
  code, and each has a measured hole: a close gate that stands down in its own repo, a reviewer
  whose filter dropped every finding, claims that don't bound edits, and an owner signature
  redefined as "did not revert".
- **What era 8 invented that worked best measured small and derived:** Back-stamp (94% useful),
  Integrate's re-run gauntlet before merge (90% useful, and it brings back the pre-merge gate era 6
  lost), and acceptance tests written by a separate model before implementation (71% useful). The
  inventions with no measured use are the ones that anticipate work: Shape, the Mechanic rung,
  Record ratifications, the counters and the canary.

## Sources and method

- **Eras baseline:** the vendored page at `26df9fa`, rendered to text. F and W wording below is
  that page's.
- **Prior research on trunk:** [`lane-census-2026-09.md`](lane-census-2026-09.md) (runs, spend,
  useful work, copied logic), [`run-outcomes-2026-09.md`](run-outcomes-2026-09.md) (per-ticket
  timelines and stops), [`rule-census-2026-09.md`](rule-census-2026-09.md) (240 mechanisms, 21
  duplicates, 26 contradictions, 21 misplacements), [`agent-context-2026-09.md`](agent-context-2026-09.md),
  [`github-native-overlap-2026-09.md`](github-native-overlap-2026-09.md),
  [`machinery-audit-2026-08-27.md`](machinery-audit-2026-08-27.md). Figures quoted from them are
  cited to them, not re-measured, unless marked.
- **Git:** `git log --no-merges --name-status -M` and `--numstat` over all 1,010 non-merge commits
  (1,278 with merges). A **lane** is a non-caller file in `.github/workflows/`; a **hook** is a
  non-test `.py`/`.mjs`/`.sh` in `.claude/hooks/` not starting with `_`; a **tool** is a non-test
  file in `bin/`; a **push-gate slot** is a key in `.claude/contract.json` listed for the push
  venue; a **meter** is a row of the rule census's "Meter tests" table, dated by
  `git log --diff-filter=A --follow`. Size snapshots are `git ls-tree` at the last first-parent
  commit of each date, counting lines of non-test code (`.ts .mts .mjs .py .sh .cjs`, excluding
  `docs/`) and test files separately.
- **ADRs:** the frontmatter (`status`, `date`, `supersedes`, `superseded_by`) of all 199 files in
  `docs/adr/`. "Lived N days" is the successor's date minus the ADR's date.
- **Runs:** every Actions run created 2026-08-21T00:00Z to 2026-09-17T12:00Z, fetched in six-hour
  slices (7,215 runs, none at the 1,000-result cap). Run-hours are `updated_at − run_started_at`
  for runs that ended success, failure or cancelled; that is wall clock per workflow run, not
  billed job minutes.
- **Machinery share:** blobless clones of `Lumaria`, `agent-skills` and `app-starter`, plus this
  repo. Every commit here, in `agent-skills` (the era-6 machine) and in `app-starter` (only caller
  stubs and seeded docs since 08-21) counts as machinery. A Lumaria commit counts as product when it
  touches `src/`, `playwright/`, `patches/`, `public/`, `supabase/` or `.design/`, otherwise as
  machinery. This is **not** era 6's measure, which was file touches inside `agent-skills` with an
  unstated split; the two are directional, not comparable.
- **Issues and PRs:** `gh issue list --state all` (474 issues) and `gh pr list --state merged`
  (168 PRs), plus bodies of the issues behind each lane's first commit.
- **Trigger classes** for added machinery come from the adding commit's message and the issue it
  names: *incident* (cites an observed failure: a run id, a count, a date), *plan* (a move from
  `DESIGN.md`'s build order or a PRD cut from it), *owner ruling* (the issue says the owner decided
  it). Session transcripts were not read, so who first proposed a plan item is unknown (see Not
  verified).

## Recurring failures, era 8

| # | Failure | Era-8 status | Evidence |
|---|---|---|---|
| F1 | Ceremony outgrows the work it wraps | **Partly repeated** | Charter C1 ("ship speed beats correctness ceremony") was written on day 1 (`8b82a41`). Against it: 4,309 runs in 14 days for 92 merges, about 47 workflow runs per merge (era 5: p50 8 agent runs per PR; not the same count, since this one includes upkeep lanes) (lane census). A lane-built ticket carries claimed files, check markers, an acceptance-author run, an implement run, Verify, Integrate and Review; the 29 clean ticket-door runs took a median 23 minutes active, but 29 of 51 waited over five minutes for the owner's `to-build` label (median 2h02m) (run outcomes). The spec door ran 11 slicing runs for one publish; #538 took five runs and $23.59 and the owner filed its 23 children by hand. 40 of 102 ticket-door tickets were built in a session with no PR. In the other direction, the owner-decided #360 (09-03) deleted 19,799 lines of gate bookkeeping in one commit (`91cd700`), and ADR-0148 dropped venue time budgets a day after they were built. |
| F2 | The system becomes its own biggest customer | **Repeated, at a higher level** | Machinery share of commits: July 40%, August 77%, September 99% (table under [Machinery share](#machinery-share-of-commits-over-time)); Lumaria product commits per week fell 147 → 39 → 8 → 0 → 0 from the week of 08-17. All 109 lane-merged implementation PRs changed the machine. Of 2,793 runs that executed, 1,603 (57%) were no-ops; counting GitHub-skipped and cancelled runs, 3,119 of 4,309 (72%) did nothing, against era 5's 1,365 of 2,120 (64%) (lane census). Dispatch reconcile alone fired 1,787 times. Every working Audit run rang Ratify, which then stopped "not due" 17 of 25 times. Walk home exists to route machine defects found in enrolled repos back to the machine. |
| F3 | Fixes relocate the problem instead of removing it | **Repeated** | 45 of 199 ADRs are superseded (median lifetime 3 days; 12 on the day written). Chains: ADR-0011 → 0032 → 0053 → 0186 → 0188/0191 (where acceptance tests live and who may push them, 08-23 to 09-14); ADR-0140 → 0142 → 0145/0147 → 0148 (venue time budgets, 09-02 to 09-03); ADR-0144 → 0146 → four successors (canary, 09-02 to 09-04); ADR-0114 → 0165 → 0177/0188 (recovering dead runs). The close gate moved from a turn hook to the tracker on 08-25 (`b5fd535`, 1,600 lines), grew a reconciler on 08-26, and moved back to the turn on 08-28 (`ed51037`, 2,951 lines deleted). The Recover lane (08-30) was replaced six days later by reconciler strikes and a Mechanic lane that has not run. The acceptance landing conflict was fixed by PR #454 (09-11) and the same rebase-and-abort, copied four times with four outcomes, then threw away nine green Implement runs on 09-16 (lane census C1). #360 deleted the `adrs` push check on 09-03 and `18d8be0` restored an `adrs` slot on 09-04 because nothing was red about a stale index. |
| F4 | Deferred decisions are left live and look implemented | **Repeated** | Mechanic and Record ratifications are wired lanes with zero runs in the 14-day window. The generated `docs/agents/lane-map.md` reports Implement, Acceptance, Fixer and Audit as "never fired" (1,000-run cap plus a name match). `immutable-set.test.ts` compares a file with its own import and cannot fail (rule census M21). Review's structural filter dropped all 26 findings the model returned in 15 of 23 retained runs while the lane ran green; Verify's 113 PR verdicts checked out trunk, not the PR (lane census, Corrections). A refused slicing run gets `needs-human` that nothing clears. `Rung` means the strike ladder in `CONTEXT.md` and the placement tier in ADR-0193 (map #646). The era-6 answer, "flag, don't defer", has a successor here: ADR-0194 sends an unclear spec to the owner on the PR with no routing label. |
| F5 | Two sources of truth, and they drift | **Repeated** | Rule census: 21 duplicate rules, 26 contradictions. The immutable set is spelled out in five prompts, three code messages and two docs; the rooting rule four times; the chain-shape ladder twice, disagreeing about a prefactor. `DESIGN.md` (1,230+ lines) was deleted on 08-27 because its section numbers no longer matched what live files cited (`a2643a2`); `GOAL.md` and fourteen lane walkthroughs, 66k words, were deleted on 09-16 because the #571 audit found them teaching retired rulings (`ef5bdee`). Hooks exist as the repo copy and the workstation clone `~/.agents/workflow`, and the close gate's global copy stands down to the repo copy (see W1). Era-8 answers to F5: generated docs held byte-identical by tests (ADR index, labels doc, venues doc, lane map), and the `drift` push slot (`8912a7a`, 09-16) refusing live prose that cites a retired ADR or a deleted path. |
| F6 | Instrumentation is an afterthought, then it's gone | **Repeated three times** | `session-captured` stopped arriving on 2026-09-09; Audit, Run watchdog and Walk home last ran 09-09T13:52Z, and `~/.claude/session-capture.log` ends 09-10T01:30Z although `session-capture.sh` is still in the roster's SessionEnd list. It surfaced in the lane census on 09-16, seven days later; the lane built to catch dead lanes (Run watchdog) was one of the three it took down. Earlier: `to-tickets.yml` was unparseable 08-22 to 08-24 and 13 zero-job runs went unread for two days (#41); 14 of 14 Audit runs skipped on a dispatch-name mismatch (#107, 08-26). A rebase-conflict Implement run ends `success`, and the watchdog reads only `failure`, so the nine lost runs on 09-16 showed green. Kept from era 6: per-run model spend is logged ($627 in 14 days, client-side estimate). Partly restored from era 5: runs carry `#N` in their names since 09-06, so a per-ticket clock can be computed, but nothing standing computes it. |
| F7 | Asking the human to size the work doesn't work | **Largely avoided in design, partly repeated in operation** | Charter C2 ("machine judgement with a reviewable checkpoint, never a human quiz") and ADR-0039 ("the governor does not ship") hold it. Sizing is done by machine: `file-issue` refuses a claim over eight files and labels `by-hand` by rule; lane 03 refuses a claim over the ceiling. The owner still sizes by hand when the machine refuses: #539 was split into #541–#544 by hand; #491's twelve slices and #538's 23 children were filed by the owner from refused plans. The Shape lane, which turns a raw idea into a decision sheet for the owner to react to, ran 153 times with no use. |

## Durable wins, era 8

| # | Win | Era-8 status | Evidence |
|---|---|---|---|
| W1 | A gate that errors at the moment of the action | **Kept and expanded; weakened in two places** | `checklist-reminder.py` and `post-edit-validate.py` are in `.claude/hooks/roster.json` today, imported from agent-skills on 09-09 (`b3bef69`). The roster registers 5 PreToolUse, 5 PostToolUse and 2 Stop hooks; `bin/gauntlet` runs one check contract at turn, stop and push; husky runs `npm run check` on every push. Integrate re-runs the gauntlet on the rebased branch and merges only on a completed green run (ADR-0054), which restores the pre-merge gate era 6 lost. Holes: the close gate lets a close through when the repo ships its own copy of the gate (`close-gate.py:397-400`); the global close-gate logs hold 111 rows with verdict `allow / repo-gate-owns-repo` for `collod873/claude-workflow` between 08-28 and 09-17. Branch protection was declined (ADR-0071), owner sessions pushed 265 commits straight to main from 09-02 to 09-16, and 17 of those pushes turned Verify red on trunk (run outcomes). |
| W2 | The thing that checks is never the thing that built | **Kept in structure, weakened in operation** | A separate model authors acceptance tests from the spec before the implementer runs; the implementer may only remove `.fails` from them, and one run was refused for editing one (#490). Verify, Integrate and Review are separate lanes; `bin/close-ticket` runs each criterion's `check:` marker itself. In operation: Review's filter published none of the 26 findings the reviewer returned; Verify's PR verdicts judged trunk; 7 of 15 close refusals after merge were markers that could not run on the runner (run outcomes). |
| W3 | Prevent conflicts at authoring time, not at merge time | **Kept, then loosened** | The slicer's seam sweep and the disjoint-files rule survive in `.claude/skills/to-tickets/SKILL.md` and `to-tickets/references/chain-shape.md`. `## Files claimed` is capped at eight entries. ADR-0110 (08-29) lets a run edit outside its claim to repair, and ADR-0199 (09-16) schedules by live runs' claims at dispatch. The nine #538 casualties on 09-16 grew the same unclaimed tracker files and conflicted at their pre-push rebase; clean runs shared "no live sibling editing the same file, claimed or not" (run outcomes). The spec door, where authoring-time disjointness is applied, published one plan in eleven runs. |
| W4 | Decisions live next to the code they govern | **Kept, and grew sharply** | 199 ADRs in 27 days (era 5: 27; era 6: 30), 111 constraint, 43 note, 45 superseded. Every ADR carries a mandatory `reversal:` line; bodies are capped at 150 words (`bin/adr_shape.py`); `INDEX.md` is generated and a push slot holds it; Back-stamp writes `superseded_by` pointers. By week: 12, 102, 51, 20, 14 ADRs (weeks of 08-17 to 09-14); 48 on 08-26 alone. |
| W5 | Agents own code; the human owns vocabulary | **Kept for `CONTEXT.md` and `CLAUDE.md`; redefined for standards** | Machine-authored commits touched `CONTEXT.md` twice, `CODING_STANDARDS.md` twice, `.claude/skills/` once and `CLAUDE.md` never; owner-session commits touched them 26, 9, 6 and 14 times. The immutable set keeps `vitest.config.ts` and `.github/` out of any PR. The change: ADR-0006 (08-23, "agents draft vocabulary and rulings; the owner signs them") was superseded by ADR-0123 (08-31, "the owner signs by not reverting"), and ADR-0122 lets the ratifier land `CODING_STANDARDS.md` entries through lane 08 with no human step. Decline on revert, the owner's lever, ran 7 times and recorded 0 declines. Era 5's ADR-0026 held auto-merge on `CODING_STANDARDS`. |
| W6 | Write the autopsy while it still stings | **Kept, and moved earlier** | 28 research notes in `docs/research/`, several measuring this era mid-flight: the unprompted machinery audit (08-27), #183 ("65 runs across six lanes, zero successes", 08-28), the #360 audit (09-03), and the lane, rule, run-outcome and context censuses (09-16 to 09-17). Map #646 is a reconstruction started while the era is still live, not after retirement. |

## How the machinery grew

### Size over time

| Date (end of day) | Commit | Lane workflows | Hooks | ADRs | Research notes | Non-test code files / lines | Test files / lines |
|---|---|---|---|---|---|---|---|
| 08-21 | `ab559f8` | 0 | 0 | 2 | 0 | 0 / 0 | 0 / 0 |
| 08-24 | `b1114ab` | 2 | 2 | 13 | 2 | 16 / 1,197 | 15 / 1,565 |
| 08-28 | `9bfd042` | 18 | 5 | 93 | 10 | 119 / 18,861 | 111 / 19,233 |
| 08-31 | `94b6ca9` | 22 | 5 | 126 | 10 | 140 / 24,823 | 211 / 34,787 |
| 09-04 | `bc256a3` | 24 | 6 | 159 | 11 | 158 / 17,269 | 183 / 25,153 |
| 09-07 | `e65ff20` | 24 | 6 | 165 | 11 | 164 / 18,722 | 190 / 25,926 |
| 09-11 | `84453b4` | 24 | 22 | 181 | 22 | 191 / 22,996 | 247 / 41,177 |
| 09-14 | `72d0041` | 24 | 22 | 192 | 23 | 210 / 25,206 | 275 / 46,019 |
| 09-17 | `a18261d` | 24 | 22 | 199 | 28 | 218 / 26,295 | 277 / 46,951 |

The 09-04 drop is #360's gate cut and the prose shred (`c7fa969`, `54ef555`: 18,000 lines of
comments out of the code, then a test holding comments at zero). The 09-11 jump in hooks and tests
is the agent-skills import (#392), a move rather than new machinery: `agent-skills` deleted 28,459
lines the same day (`ddd2919`, "Split the machine out").

### Lines added and removed, by week

Non-merge commits only. Code excludes tests; ADR lines are `docs/adr/`.

| Week of | Commits (lane-authored) | Code + / − | Tests + / − | Workflows + / − | ADRs + / − | Other docs + / − |
|---|---|---|---|---|---|---|
| 08-17 | 54 (0) | 1,559 / 215 | 1,869 / 319 | 339 / 49 | 710 / 0 | 2,729 / 215 |
| 08-24 | 320 (53) | 25,808 / 3,539 | 37,659 / 4,935 | 3,440 / 776 | 6,650 / 19 | 5,894 / 3,599 |
| 08-31 | 304 (102) | 19,723 / 22,739 | 29,157 / 35,920 | 3,134 / 3,556 | 3,308 / 7,794 | 9,548 / 2,429 |
| 09-07 | 188 (92) | 12,860 / 3,313 | 23,156 / 2,492 | 369 / 542 | 542 / 83 | 9,524 / 2,151 |
| 09-14 | 144 (84) | 3,484 / 2,678 | 6,504 / 5,820 | 151 / 69 | 591 / 216 | 3,211 / 7,378 |
| **Total** | **1,010 (331)** | **63,434 / 32,484** | **98,345 / 49,486** | **7,433 / 4,992** | **11,801 / 8,112** | **30,906 / 15,772** |

The week of 08-31 is the only week that removed more than it added, in code, tests, workflows and
ADRs. Its removals trace to the owner-decided #360 ("Decided by the owner on 2026-09-03 after a
measured audit"), the ratifier replacing the release-PR channel (#296, owner-ruled, 1,937 lines
deleted) and the ADR body cap.

### Additions and removals by kind

| Kind | Added | Removed | Renamed into a new job | On trunk now | Ratio added : removed |
|---|---|---|---|---|---|
| Lane workflows | 28 | 4 (`close-gate`, `close-gate-reconcile`, `close-gate-drill`, `release-on-prd-close`) | 2 (`recover` → `mechanic`, `ratify-release` → `record-ratifications`) | 24 | 7 : 1 |
| Hooks | 22 (11 new, 11 moved from agent-skills) | 0 | 0 | 22 | no removals |
| `bin/` tools | 24 (11 new, 13 moved) | 1 (`clone-gate`, replaced by the `clones` slot) | 0 | 23 | 24 : 1 |
| Push-gate slots | 4 (`clones` 09-03, `adrs` 09-04, `rules` 09-16, `drift` 09-16) | 0 at slot level (#360 deleted five bookkeeping checks inside `bin/gauntlet` before slots existed in this form) | 0 | 7 | no removals |
| Meter tests | 30 (1, 6, 11, 5, 7 by week from 08-17) | 0 | 0 | 30 | no removals |
| ADRs | 199 | 45 superseded | n/a | 154 live | 4.4 : 1 |
| **Mechanisms (lanes, hooks, tools, slots, meters)** | **108** | **5** | **2** | | **about 20 : 1** (84 : 5 counting moved files as not new) |

Lane additions stopped after 2026-09-02 (Walk home). Growth after that went into shared code,
tests, meters, ADRs and the agent-skills import.

### Every lane, and what triggered it

Useful rate is the lane census's (useful ÷ did work, 09-03 to 09-16).

| Lane | Added | Trigger | Cited cause (commit / issue) | Removed alongside | Later |
|---|---|---|---|---|---|
| To-Tickets | 08-22 `3be0730` | plan | PRD #13: "nothing in the system can start work" (GOAL.md §4) | nothing | 1 publish in 11 runs; 9 red after full spend |
| Verify | 08-23 `ff37c62` | plan | #32: make "the suite passed" observable; "telemetry, not a gate" | nothing | PR verdicts judged trunk (found 09-17) |
| Close gate (tracker side) | 08-25 `b5fd535` | incident + plan | Era-6 hook failed open unseen, 83 rows in each of two logs | two thirds of the hook's shell parsing | **Reversed** 08-28 (`ed51037`) |
| Release on PRD close | 08-25 `57a08dd` | plan | PRD #63 | nothing | **Deleted** 08-31 (#296) |
| Audit | 08-25 `414af0c` | plan | PRD #63 | nothing | Dead since 09-09 (capture); rang Ratify on every working run |
| Ratify release | 08-25 `301aad7` | plan | PRD #63 | nothing | **Renamed** Record ratifications 09-12; 0 runs |
| Close gate reconcile | 08-26 `018e11a` | incident | Actions outage; closes that land unjudged (#106) | nothing | **Deleted** 08-28 |
| Run watchdog | 08-26 `d2e970c` | incident | 13 zero-job runs unread for two days (#41) | nothing | 36/36 no-ops; dead since 09-09 |
| Shape, Shape-accept | 08-26 `6b0a006` | plan | `DESIGN.md` §7: the owner reacts to a sheet instead of originating | the blank-screen approve | 0 useful in window |
| Back-stamp | 08-26 `c2c0192` | plan (PRD #117) citing a measured gap | 0 of 43 ADRs carried a hand-written supersession line | nothing | 94% useful |
| Missing-trailer counter | 08-26 `1516fb8` | plan (PRD #117) citing a measured gap | trailer compliance 2 in 66 | nothing | 29% useful; one false-positive fix |
| Bypass counter | 08-26 `ba3ba14` | plan (PRD #117) | a red tree reaching main was invisible | nothing | 195 of 196 no-ops; 1 issue, closed not planned |
| Lost-dispatch counter | 08-26 `ead55ad` | plan (PRD #117) | a dispatch that never arrives leaves no run | nothing | 96 no-ops, filed nothing |
| Review | 08-27 `b5e1f02` | plan (PRD #145) | move 7a | nothing | filter dropped all findings |
| Spec | 08-27 `e639b4c` | plan (PRD #145) | move 6; shipped as a proof-of-life step | nothing | 5 critiques in window, 50% useful |
| Implement | 08-27 `8e04014` | plan (PRD #145) | move 5 | nothing | 83% useful; 12 green runs discarded |
| Integrate | 08-27 `b3988dc` | plan (PRD #145) | move 7 | nothing | 90% useful |
| Acceptance | 08-27 `c332636` | plan (PRD #145) | ADR-0033's re-entry trigger | nothing | 71% useful; `refire` job re-fired nothing |
| Dispatch reconcile | 08-28 `803ae91` | incident | a 26-slice plan started its roots and stopped (#179) | 45 lines | 1,787 runs, 702 cancelled; `workflow_run` door removed 09-14 (`1ec5074`) |
| Close gate drill | 08-28 `e9ee2ff` | proof run | prove a runner-side hook refuses before deleting the tracker gate (#185) | itself, by design | **Deleted** same day |
| Fixer | 08-29 `06e1937` | incident | red Verify and rebase conflict reached no lane (#234) | nothing | 2 useful of 101 fired; not run since 09-13 |
| Recover | 08-30 `939c789` | incident | run 33316096960 lost 40 minutes of work to a rejected push | nothing | **Replaced** 09-06 (`d6b1ca1`) by reconciler strikes and Mechanic; Mechanic 0 runs |
| Ratify, Ratify on PRD close, Decline on revert | 08-31 `c97bd8e` | owner ruling | #296: 18 release PRs in five days, a checklist that decided nothing | the release-PR channel, 1,937 lines | 7 ratifier PRs; 5 of 7 merges unrecorded; 0 declines |
| Enrol | 09-01 `b011355` | plan | #225/#326: no installer existed (#180 closed not planned) | nothing | 21 runs, stubs delivered to 2 repos |
| Walk home | 09-02 `7e64031` | plan | #329: route a machine defect from an enrolled repo home | nothing | 7 issues, 2 fixes, 5 misfiled, 3 duplicates; dead since 09-09 |

Tally of the 28 lane additions (counting the three 08-31 lanes and the two Shape lanes separately):
**plan 18**, **incident 5** (reconcile, fixer, recover, close-gate reconcile, run watchdog),
**incident + plan 1** (tracker close gate), **owner ruling 3** (ratify trio). One proof run was
deleted by design. Of the 24 lane workflows on trunk, 8 did no useful work in the census window.

### Hooks, gates and meters

| Mechanism | Added | Trigger | Removed alongside | Later |
|---|---|---|---|---|
| `gauntlet.sh`, `gauntlet-hook.mjs` (turn venue) | 08-23 `25266bd` | plan (ADR-0010, "earliest venue") | nothing | ADR-0010 superseded by ADR-0193 (09-15); still live |
| `session-capture.sh`, `session-capture-hook.mjs` | 08-25 `f7d8689` | plan: GOAL.md blocker 1, and the eras page's "decide on capture" | nothing | stopped writing 09-10T01:30Z; cause not traced |
| `close-gate.py` (repo copy) | 08-28 `a137d55` | reversal of the tracker gate (#185) | three tracker-side workflows, 2,951 lines | stands down to itself in this repo (W1) |
| `gauntlet-report.mjs`, `gate-size.test.ts` fence | 09-03 `6d34e9f`, `aebac49` | owner ruling (#360) | 19,799 + 3,216 lines of gate bookkeeping, `bin/clone-gate` | cap 1,157 lines unchanged since |
| 11 hooks and 13 tools moved from agent-skills | 09-09 `b3bef69` | plan (PRD #392, merge the two machines) | deleted from agent-skills (28,459 lines) | now the workstation's hook set |
| `dispatch.py`, `clone-guard.py`, `clone-refresh.py`, `bin/link-workstation` | 09-09 `192ae7a` | plan (PRD #392) | nothing | hooks run from `~/.agents/workflow` since; capture stopped the same day |
| `session-brief.py`, `session-end.py` | 09-11 `8dec413`, `16f70d2` | plan (PRD #434, lane-built) | nothing | live |
| Push slot `clones` (jscpd) | 09-03 | owner ruling (#360) | `bin/clone-gate` wrapper and baseline | live |
| Push slot `adrs` | 09-04 `18d8be0` | incident: stale `INDEX.md`, three hand repairs, nothing red after #360 | nothing | **re-adds** a check #360 deleted the day before |
| Push slot `rules` (`bin/lint`) | 09-16 `29e6a7a` | plan (lane-built #587) | 10 dead lint slugs | live |
| Push slot `drift` | 09-16 `8912a7a` | incident (#571: rulings retired by amendments, prose citing them) | 11 wrongly retired rulings reinstated | live |
| Meter tests (30) | 08-23 to 09-16 | mostly pinned to the ticket that built the thing they meter | 0 | 1 cannot fail (rule census M21) |

**The size fence and what it doesn't fence.** `gate-size.test.ts` caps the sum of 15 listed gate
files at 1,157 lines. The three slots added after it run code in files not on that list: `bin/lint`
117, `bin/adr-check` 224, `bin/adr_shape.py` 290, `shared/adr-index.ts` + `.cli.ts` 190,
`shared/prose-drift.ts` + `.cli.ts` 231, about 1,050 lines in all. `gateAdditions` refuses new
files in gate directories only in the Fixer and Mechanic lanes (`fixer/fixer.ts:204`,
`mechanic/mechanic.ts:231`), not in Implement or owner sessions.

### ADR churn

- 199 ADRs, 45 superseded. Lifetime of a superseded ADR: 0 days 12, 1 day 8, 2 days 2, 3 days 7,
  4–8 days 8, 15–23 days 8. Median 3 days.
- One ADR, 0146 (canary before landing), was superseded by four others within two days. ADR-0140
  (venue time budgets) was superseded by three within a day, ending at ADR-0148 "Timing is
  recorded, never judged".
- 43 ADRs are `note` status: measurements and records rather than rulings. `8912a7a` (09-16) found
  that `amends:` had been read as retirement, so notes that changed a detail had retired eleven
  whole rulings; they were reinstated.
- At least twelve ADRs rule on concurrency, claims, locks or merge order: 0039, 0040, 0069, 0080,
  0084, 0108, 0110, 0111, 0189, 0190, 0191, 0199.

### Machinery share of commits over time

Non-merge commits. "Lumaria machinery" is a Lumaria commit touching none of the product paths
listed in the method.

| Week of | claude-workflow, owner sessions | claude-workflow, lanes | agent-skills | app-starter | Lumaria machinery | Lumaria product | Machinery share |
|---|---|---|---|---|---|---|---|
| 07-06 | – | – | 6 | 0 | 51 | 136 | 30% |
| 07-13 | – | – | 0 | 0 | 3 | 15 | 17% |
| 07-20 | – | – | 1 | 0 | 16 | 19 | 47% |
| 07-27 | – | – | 57 | 0 | 24 | 24 | 77% |
| 08-10 | – | – | 6 | 3 | 22 | 10 | 76% |
| 08-17 | 54 | 0 | 102 | 1 | 51 | 147 | 59% |
| 08-24 | 267 | 53 | 77 | 0 | 28 | 39 | 92% |
| 08-31 | 201 | 103 | 73 | 0 | 17 | 8 | 98% |
| 09-07 | 96 | 92 | 10 | 14 | 24 | 0 | 100% |
| 09-14 | 60 | 84 | 0 | 2 | 2 | 0 | 100% |

No commits landed in any of the four repos in the week of 08-03. By month: July 40%, August 77%,
September (to 09-17) 99%. Lumaria alone, by commit: July 28%, August 35%, September 84%. The eight
Lumaria "product" commits in the week of 08-31 include four owner-session refactors on 09-04 that
stripped comments and hook plumbing out of `src/` rather than adding features. Era 6's page
measured 63% (July) and 82% (August) with a different split inside `agent-skills`.

**Runs, by week** (all workflows, this repo): 1,704 fired in the week of 08-24, 1,854 in 08-31,
2,337 in 09-07 and 1,297 in 09-14 to date. Run-hours per calendar day from 08-26 to 09-16 averaged
6.8, peaking at 21.1 on 09-16.

### Candidates the growth record raises

Not rulings. Each is a question a Charter clause could answer, with the fact behind it.

- **Removal is not a standing path.** Every net-shrink event was an owner-decided cut (#360, #296,
  `ef5bdee`) or a reversal after an incident; no lane, counter or meter removes anything. The
  counters built to propose changes (Bypass, Lost-dispatch, Missing-trailer) filed one used
  proposal in 14 days.
- **Lanes were added ahead of demand.** 18 of 28 lane additions came from the build-order plan. Of
  the 8 lanes with no useful work in the window, 5 are plan-born (Shape, Shape-accept, Bypass
  counter, Lost-dispatch counter, Record ratifications), 2 incident-born (Run watchdog, and Mechanic
  as Recover's successor) and 1 owner-ruled (Decline on revert). The 5 incident-born lanes include
  both the most-run (reconcile) and two since replaced or idle (Recover, Fixer).
- **A fence on a fixed file list was grown around within two weeks** (the `adrs`, `rules` and
  `drift` slots). A fence that counts a category rather than a list is the untested alternative.
- **Instrumentation shares a trigger with what it watches.** Run watchdog, Audit and Walk home all
  hang off `session-captured`, so one stopped hook silenced the watcher and the watched together.
- **Supersession speed.** 22 of 45 superseded ADRs lived two days or less, which is the F3 signature
  the eras page read in era 5's ADR-0014 and ADR-0020.

## What era 8 invented, and whether it worked

"Not on the eras page" means the 2026-08-21 page names nothing like it for eras 1–7.

| Invention | Not on the eras page because | Worked? (measured) |
|---|---|---|
| Acceptance tests authored from the spec by a separate model, landed as `test.fails` before implementation; the implementer may only remove `.fails` | Era 5 audited acceptance after the fact | **Mostly.** 71% of working Acceptance runs useful; 13 author deaths and 4 three-strike stops, several from returning truncated whole files |
| Integrate: rebase, re-run the gauntlet, merge only on a completed green run, one merge at a time, no model | Era 5 gated on CI on the PR; era 6 had no pre-merge gate | **Yes.** 92 merges, 90% useful. Holes: a pending run cancelled in its single concurrency group stranded PRs #509–#513; conflicts park the ticket |
| A reconciler that re-derives the ready set from durable state, with a strike ladder choosing the next rung | Era 5 pushed dispatch through a label state machine | **Partly.** All 170 dispatches it sent started a lane; 1,787 runs, 702 cancelled, 673 wrote nothing; the Mechanic rung has not run |
| Executable `check:` markers on every criterion, run by `bin/close-ticket` at close | Era 6's markers were repo-wide (`UPSTREAM.md`), not per ticket | **Partly.** 15 close refusals after merge; 7 were markers that could not run on the runner |
| File claims with a cap, scheduled against live runs (ADR-0199) | Era 5 and 6 drew disjointness at slicing only | **Too new to measure.** ADR-0199 is dated 09-16, the day nine runs were lost to edits outside claims |
| One check contract and one runner (`bin/gauntlet`) at turn, stop, push and CI (ADR-0056) | Era 6 hooks each ran their own checks | **Yes, where it runs.** 265 direct owner-session pushes still reached main, 17 red on trunk |
| Enrolment by repository topic, with six-line caller stubs pointing at reusable workflows | No era delivered its machine to another repo by a lane | **Mechanically yes** (21 runs, stubs in two repos); the enrolled repos have had no commits under product paths since 09-04 |
| Back-stamp: supersession pointers derived and committed by a lane | Era 6 wrote them by hand (0 of 43) | **Yes.** 94% useful, 22 of 23 stamps still standing |
| Counters: model-free lenses that file a proposal at a threshold (ADR-0064) | New term here | **Little measured use.** Across the three counters, 2 useful outcomes in 14 days, both from Missing-trailer (the owner fixed 9 notes after #428) |
| Rule trial: a lint rule lands only if it flags every site its finding carries (ADR-0124) | Era 6 ratified standards by verdict | **Partly.** In the census window 7 ratifier PRs merged, each within 4 minutes; the loop over-rang and 5 of the 7 merges went unrecorded |
| "Code carries no prose" held by a test (ADR-0151), and knip with no baseline | No earlier era banned comments | **Yes, as a size lever.** About 18,000 comment lines removed on 09-03; non-test code fell from 24,823 to 17,269 lines by 09-04 |
| Rung × venue placement grid (ADR-0193) and generated maps (lane map, labels doc, venues doc, ADR index) | Era 6's endpoint was test-held markers, not generated maps | **Partly.** The byte-identical docs hold; the lane map's run counts are wrong |
| Canary target repository for proving a machine change before landing (ADR-0146) | New | **Used for two days.** 93 commits to the canary repo on 09-03 and 09-04, one since |
| Walk home: route machine defects from enrolled repos to the machine's tracker | New | **Weakly.** 7 issues, 2 merged fixes, 5 misfiled, 3 duplicates |
| Shape: an idea becomes a capped decision sheet the owner reacts to | New | **Not used.** 153 no-op runs, 0 accepted sheets reached Spec |
| The owner signs by not reverting, and a revert writes declined memory (ADR-0123) | Era 5 held auto-merge on standards for the owner | **Untested.** Decline on revert ran 7 times and found 0 reverts |
| Hooks run from a dedicated workstation clone through one roster dispatcher | Era 6 symlinked hooks from one home | **Unknown.** Session capture stopped writing the day it landed; the link was not traced |

## Not verified

- **Who proposed each plan item.** Commits and issues are all under the owner's account, and
  session transcripts were not read. "Plan" means the addition traces to `DESIGN.md`'s build order
  or a PRD cut from it; whether a given move was the owner's ask or a Claude proposal the owner
  accepted is not established. Issues #296 and #360 say "ruled/decided by the owner"; no other
  addition carries that line.
- **Why session capture stopped.** The log ends 2026-09-10T01:30:57Z with `skipped
  publish-out-of-scope` lines; the hooks moved to the workstation clone on 09-09. Cause not traced
  (same gap as the lane census).
- **The 111 `repo-gate-owns-repo` close-gate rows** were counted from the global close-gate logs.
  Which copy of the gate wrote each row, and how many of those closes also went through
  `bin/close-ticket` (which checks criteria itself), was not checked.
- **Machinery share** counts commits, not effort. The product-path split for Lumaria is by
  directory. Other private repositories on the account were not counted, so any product work there
  is missing from the denominator.
- **Run-hours** are wall clock per workflow run: parallel jobs inside a run are counted once and
  queue time is excluded. Era 5's 9.5 machine-hours/day was measured differently; the comparison is
  directional. Runs whose history was deleted are not in the 7,215.
- **Era-5 and era-6 figures** are quoted from the 2026-08-21 page, not re-measured.
- **The meter list** is the rule census's table; meters it did not list, and meter tests deleted
  before 09-16, are not counted. Hook and tool counts rely on the filename rules in the method.
- **Useful rates and run counts per lane** are the lane census's window (09-03 to 09-16), not the
  whole era.
- **#652** (merge quality) was in flight and not read.
