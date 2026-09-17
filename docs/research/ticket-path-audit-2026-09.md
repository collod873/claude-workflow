# The single-ticket build path, audited against the charter

Researches: #663

Child of map #646; feeds the decision to cut in place or build a new core (#660). Written 2026-09-17
against trunk `a1dbf33`. Judged against [`docs/agents/charter.md`](../agents/charter.md), signed
2026-09-17. This file gives verdicts for the owner to rule on. It makes no rulings.

Paths are under `.Workflow/agent-workflows/` unless they start at the repo root.

## Summary in plain words

- **The build step mostly works.** Of 138 build runs since 09-02, 90 opened a pull request. A
  clean ticket takes about 24 minutes from its first lane label to merged. The best one took 11.
- **The biggest delay is a label you add by hand.** A filed ticket waits for `to-build`: a median
  of 6 hours in the sample, and never less than half an hour. Everything after that label takes
  minutes.
- **Finished work gets thrown away.** When two builds touch the same file, the second one is
  dropped instead of saved. That lost 13 finished builds. The fix is to save the work first and
  sort out the clash afterwards.
- **One check is testing the wrong code.** The "Verify" check on each pull request tests the
  main line, not the change. The only real test of the change is the merge step's own run.
- **After a merge, nothing checks that the ticket does what it said.** The charter says "done"
  means the ticket's checks pass on main. Nothing runs them there.
- **The builder explores as much as it is handed.** It reads about as many bytes on its own as
  its instructions hold, and it reopens about half the files it was already given. In one wave
  every build hunted for the same files, because no ticket named them.
- **Many of the builder's written rules have nothing checking them, and some are broken most
  runs.** "Don't reopen files you were given" was broken in 26 of 28 runs. "Don't run the whole
  test suite" was obeyed word for word and broken in spirit in 19 of 28.
- **Two safety rails have holes.** The second-try model is allowed to rewrite the tests it is
  judged by, and the test lock only watches one line of each test. The charter says nothing may
  weaken tests.
- **When a build gets stuck, most roads end with you.** Seven stopping points hand the problem
  to the owner. The charter says the owner never fixes a stuck run. The helper meant to catch
  these (the "mechanic") has never run once.
- **Some parts do nothing useful.** A recorder has posted 943 comments that nothing reads, split
  across two duplicate issues. A few leftovers from older designs do no work.
- **What would seed a small new core:** the ticket filing checker, the test lock, the brief
  builder, the build-then-repair-then-fresh-eyes steps, the merge step's test run, and
  close-ticket. The landing step, the mechanic, the Verify pull-request check and the recorder
  would not.
- **Verdicts:** 35 parts judged. 4 keep as is, 24 keep and fix, 7 cut.
- **Flag for the owner: the charter's goal says "very fast", but no rule covers speed.** Nothing
  measures or protects it. Either add a rule with an enforcer, or say speed is judgement.
- **The charter could not judge six things cleanly** (listed near the end): speed; who may fix a
  test that is itself wrong; safety rails that rarely fire; parts that already exist; copies of an
  enforced rule inside a prompt; and research tickets, whose only possible checks are the
  "stand-ins" the charter would refuse.

## Implement in depth

### How it fires

1. **Wake.** `dispatch-reconcile-caller.yml:5-7` runs the reconciler on `session-captured`,
   `graph-changed` and `run-ended` dispatches, on any issue label change, and on a push to main. One
   reconciler runs at a time, and a newer waiting run replaces an older one
   (`dispatch-reconcile.yml:24-25`).
2. **Filter.** `dispatch/reconcile.ts:893-899` stops unless the event is not an issue event, or is
   the owner adding `to-build` or removing `needs-human` / `by-hand`. It checks this after checkout
   and `npm install`, so 49 of 235 reconciler runs since 09-15 (21%) paid for a runner only to stop.
   126 more (54%) found nothing ready.
3. **Ready set.** `dispatch/ticket-state.ts:361-455` marks a ticket busy when a run with its name is
   unfinished in the last 100 runs, in review when an `implement/issue-N` PR is open, and buildable
   once `accept/issue-N` exists. `reconcile.ts:602-621` holds a ticket whose claimed files a live run
   holds. That hold has never triggered.
4. **Dispatch.** `reconcile.ts:695-744` climbs the strike ladder, sends `ticket-ready`
   (`shared/ready-set.ts:65-69`), labels `5-building` and drops `to-build`.
5. **Run.** `implement-caller.yml:6` calls the reusable `implement.yml`, which runs
   `implement/implement.ts <issue>`.
6. **Wrap-up, always.** `labels.cli.ts fail` requeues a red run (`implement.yml:92-95`), and a
   `run-ended` dispatch wakes the reconciler (`implement.yml:98-104`).

Timeliness is good. The median gap from `5-building` to run created is 1 s (61 runs). The median
wait for a runner is 4 s, with a worst case of 1.2 min over 123 runs. No run ever waited on the
concurrency lock. No workflow on the path has a `schedule:` trigger.

**Concurrency.** The group is `implement-${{ github.event.client_payload.issue }}`
(`implement.yml:20-22`), keyed per ticket as ADR-0108 says. `mechanic.yml:21-22` shares the key.
GitHub keeps one waiting run per group, so a third dispatch cancels the waiting second. A
`cancelled` run counts as dead (`shared/strikes.ts`, `DEAD_CONCLUSIONS`) and earns a strike. This
has not happened since 09-03, but nothing prevents it.

**Budget and timeout.** The lane budget is 80 minutes (`shared/lane-budget.ts`) and the job timeout
is 90 (`implement.yml:27`). The budget starts in `runImplement` (`implement.ts:183`) and only aborts
model sessions (`shared/stage.ts:384-407`). The gate runs (up to six: two per stage), the rebase and
the push are outside it. The median implement step takes 9.2 min, the 95th percentile 36 and the
maximum 44.9. Neither the budget abort nor the 90-minute wall has fired in any recorded run.

**Strike ladder.** `shared/strikes.ts:4` lists `implementer`, `fresh-eyes`, `mechanic` and
`decision`; `rungFor` picks one per strike count. `reconcile.ts:843-880` posts a strike for each dead
run and the decision at three. At one strike, `ticket-ready` carries `rung=fresh-eyes` and
`implement.ts:250-252` skips the first model. At two, `mechanic-wanted` is sent
(`reconcile.ts:733`).

- **Strikes are counted per ticket, across lanes.** An acceptance author that died once sends the
  ticket to implement at the fresh-eyes rung, and Opus is told "every earlier run of this ticket
  died before reaching" the gate (`implement.ts:302-313`). That happened on #533, #557, #577, #579,
  #584 and #587.
- **`strikesAsGateOutput` has its own strike regex** (`implement.ts:302`). Unlike the shared
  `strikesIn`, it does not reset on an owner decision, so fresh eyes can be handed strikes from
  before the owner ruled (lane census C8, confirmed).
- **The mechanic has never run.** Both `mechanic.yml` and `mechanic-caller.yml` have 0 runs,
  although the lane has been wired since 09-06. It starves by design: fresh eyes already runs inside
  every implement run whose gate stays red, and a red run still pushes and ends green. So strikes
  come only from crashes, timeouts or the fails rule.
- **A fails-rule refusal fires twice (from reading the code, not seen in a run).** Landing sends
  `mechanic-wanted` itself (`shared/implementation-landing.ts:290`), and implement also exits 1
  (`implement.ts:346`). The ticket is requeued and struck, which rings fresh eyes into the same
  concurrency group.

**Run history.** `implement-caller.yml` ran 138 times from 09-02 to 09-17. Classified from logs:

| Outcome | Runs |
|---|---|
| Opened a PR | 90 |
| Rebase conflict: run green, nothing pushed | 14 (#342, #533, #570, nine #538 children, and #629's run 35175347002 after its merge) |
| Nothing to build | 5 (#570 four times in 3 min, #521) |
| Ticket already closed | 1 |
| Crashed, mostly push failures before 09-05 | 11 |
| Refused its own push for editing its acceptance test | 1 (#490) |
| Cancelled, all on 09-02 | 15 |
| Unclear | 1 |

Since 09-06, 11 runs repeated a ticket: 4 did useful work and 7 were wasted.

### Every text the model receives

| Stage | Model | Text | Fixed bytes | Filled in at runtime |
|---|---|---|---|---|
| implementer | `claude-sonnet-5` (`implement.ts:49`) | `implement/implementer/prompt.md` | 7,183 | `{{BRIEF}}` |
| implementer-repair | the same session via `--resume` (`implement.ts:101-116`) | `implement/implementer/repair.md` | 1,288 | `{{GATE_OUTPUT}}` (tail) |
| implementer-fresh-eyes | `claude-opus-5` (`implement.ts:51`) | `implement/implementer/fresh-eyes.md` | 4,735 | `{{BRIEF}}`, `{{ATTEMPT}}`, `{{GATE_OUTPUT}}` |
| mechanic repair | mechanic | **the same `implementer/repair.md`** (`mechanic/mechanic.ts:30`) | 1,288 | `{{GATE_OUTPUT}}` |

Every stage runs `claude -p --dangerously-skip-permissions` (`shared/stage.ts:271-279`) with the
full Claude Code tool list, system prompt and skill listing. Measured over 28 runs, first-turn
input tokens ≈ 31.0k + 0.438 × brief bytes (r = 0.999). So about 31k tokens are paid before the
prompt says anything. The observation lenses already avoid this with `--tools ""` and
`--setting-sources ""` (`observations/auditor.ts:18-33`).

**The brief** (`implement/brief.ts:77-106`) holds, in this order:

1. the style rules (`shared/house-style.ts:3-10`);
2. the check-contract lead and every slot of `.claude/contract.json`, including `all`
   (`npm run check`), which the prompt forbids, and the `stop` slot's note about
   `~/.claude/settings.json`, which means nothing on a runner;
3. the ticket body and its comments (capped at 30 KB, oldest dropped first);
4. the `## Seams consumed` lines;
5. a module `CONTEXT.md`, found by walking up from the first claimed file. In every measured run
   this was the root `CONTEXT.md`, 16.5 KB;
6. the parsed `CODING_STANDARDS.md` entries;
7. every test file carrying `test.fails(… #N`;
8. the claimed files and cited ADRs and paths (150 KB together, 40 KB per file);
9. up to 40 "nearby" paths.

The prompt calls the nearby list "nearby tests and importers". It is really every source file whose
text contains a claimed file's basename (`brief.ts:204-217`). For `shared/gh.ts` the basename `gh`
matches 201 of 426 source files, and the list keeps the first 40 alphabetically.

Only the file snapshots and the comments are capped. The ticket body, `CONTEXT.md`, the standards
and the acceptance tests are not. In 25 of 28 runs the acceptance test was also a claimed file, so
it was inlined twice (median 6.8 KB extra, 32 KB on #623). The median brief was 78 KB: claimed
files 34 KB, acceptance tests 8.7 KB, root `CONTEXT.md` 16.5 KB, style, contract and standards
about 7 KB, nearby list 2 KB.

#### Every rule the texts state, and what enforces it

"None" means no gate, test or separate judge holds it; the rule rests on the model following prose.

| # | Rule, where | Enforcer | Observed |
|---|---|---|---|
| R1 | Decide only from the brief; nothing outside changes which files you claim (`prompt.md:3-9`) | None. Nothing compares the diff with `## Files claimed` | 19 sessions edited 78 files outside their claim, mostly fixture repairs named in summaries |
| R2 | Name every module read outside the brief in `outOfBriefReads` (`prompt.md:11-17,112-115`) | None. It is the model's own report | Close to measured counts, except #609: reported 0, measured 13 |
| R3 | Read the brief before `Read`; reopen a file only after changing it (`prompt.md:19-21`) | None | Broken in 26 of 28 first sessions: 85 of 180 inlined files reopened, 41 re-reads with no edit in between, 104 greps on inlined files (hunting line numbers, which the brief omits) |
| R4 | The coding standards govern what you write (`prompt.md:25`) | None in the lane. The review lane's filter drops every finding (`review/structural-refusal.ts:9-16`; rule census correction) | Not measurable from streams |
| R5 | A later ticket comment beats the body (`prompt.md:26-27`) | None | Judgement |
| R6 | The acceptance tests are the spec; make them pass, then turn them on (`prompt.md:29-35`, step 2) | Partly. The push gate runs them; `bin/close-ticket` refuses while a `test.fails` names `#N` (`:659-670`) | Held in every opened PR |
| R7 | The working tree is the answer; leave no scratch files (`prompt.md:37-43`) | None. `deriveAnswer` commits every path `git status` shows (`shared/implementation-landing.ts:35-58`) | Not counted |
| R8 | `git stash/checkout/reset/commit/push` and `gh` are refused (`prompt.md:45-49`) | `CHECKOUT_SESSION_DENIED_TOOLS` prefix rules (`shared/stage.ts:210-227`) | 6 denials in 28 runs; the model moved on each time. Other spellings (`git -C . commit`) were not tested |
| R9 | Never rewrite, rename, move or delete a `test.fails(` test (step 2; step 3) | Partly. `judgeFailsEdits` (`shared/fails-rule.ts:9-37`) only sees removed lines that start with `test.fails(`, runs after the push, and exempts any path in `declaredEdits` | #617's second run (35166024100) renamed an already-on test title and passed; #600 turned tests on with a whole-file `sed -i` |
| R10 | Name every file repaired outside the claim in the summary (step 3) | None | Mostly followed |
| R11 | Never edit `vitest.config.ts` or `.github/` (step 3; `repair.md`; `fresh-eyes.md`) | `touchesImmutableSet` in landing (`shared/implementation-landing.ts:271-274`), after the run is paid for; escalates to the owner | 0 attempts in 28 runs |
| R12 | Fix the fixture, never the assertion (step 3; `repair.md:4-5`) | None outside R9's one line | Not measured |
| R13 | Iterate with `bin/gauntlet stop` until green (step 4) | Counted (`shared/stream-json.ts:174`), not enforced | Every session ran it, 1 to 5 times |
| R14 | Do not run `npm run check` (step 4; `repair.md:12`; `fresh-eyes.md:57`; `CHECK_CONTRACT_LEAD`) | None. It is not in the deny list | Obeyed by the letter. But 19 of 28 first sessions ran `npm test` and 17 ran estate-wide lint, knip, clones or adrs. Runs past the 2-minute Bash limit went to the background; 11 sessions then tried `sleep` and were blocked, and #609 (35145839368) answered with "placeholder - waiting for background test results" |
| R15 | Write one summary paragraph naming repaired and deleted files (step 5) | Schema only: `summary` must be non-empty (`implementation-landing.ts:18-22`) | #609's placeholder passed |
| R16 | Before answering, name the file that satisfies each criterion (`prompt.md:96-100`) | None | Not visible in streams |
| R17 | Run `git status --short` once before answering (`prompt.md:102-103`) | None | Not counted |
| R18 | Leave `declaredEdits` as `[]` in rung one (`prompt.md:116-120`) | None, and the fails rule honours rung one's list | A rung-one model that declares a test file can rewrite it unrefused |
| R19 | Answer through `StructuredOutput` | `--json-schema` plus zod parse (`shared/stage.ts:282-302`) | Held |
| R20 | One repair round (`repair.md:3`) | Code: `implement.ts:256-272` | Held |
| R21 | Read the name of each red check before assuming (`repair.md:7-10`) | None | Repairs re-ran knip, clones and adrs in all 7 rounds, and `npm test` in 6 |
| R22 | Leave what is not yours and say so (`repair.md:13-15`) | None | Not measured |
| R23 | Read the checkout, not the diff you are handed (`fresh-eyes.md:13-18`) | None | No fresh-eyes session in the retained window |
| R24 | Fresh eyes may edit a `test.fails(` test "when the test itself is wrong" (`fresh-eyes.md:27-30`) | None judges "wrong". Declaring the path exempts it from the lock (`fails-rule.ts:22`) | No session in window |
| R25 | Declared paths must be written from the repo root (`fresh-eyes.md:72-74`) | Exact Set lookup (`fails-rule.ts:22`) | Both examples break it: `"shared/retry.test.ts"` (`fresh-eyes.md:77`, `prompt.md:121`), rule census C6 |
| R26 | Style rules: no prose; `*.proc.test.ts` naming; no reading tracked source; one fake gh; `reason(err)` (`shared/house-style.ts:3-10`) | Enforced: prose gate and `eslint.config.js:52-92` | A cache of those gates, which saves a red loop |
| R27 | "The push gate is the `all` slot, run once by the wire after you answer" (`CHECK_CONTRACT_LEAD`) | True in code (`implement.ts:189-203`, called after each stage) | Accurate |

Of 27 rules, 6 are fully enforced (R8, R11, R19, R20, R26, R27), 3 partly (R6, R9, R13), and 18 have
no enforcer. Of those 18, R3 and R14 are measurably broken most runs.

#### Graded as writing for agents

Graded against `.claude/skills/writing-for-agents/SKILL.md`, following
`.claude/skills/audit-doc/SKILL.md` by hand. Findings are ranked by how much run-to-run variance or
cost each causes.

1. **The prompt invites exploring.** `prompt.md:11-17` answers "Reading wider … the answer is yes"
   and says "nothing is held against you". That is a pointer toward exploration in the first
   screen. Measured exploration was 2.21 MB against 2.15 MB of briefs. The charter's line is the
   opposite: "An agent is handed what it needs, so it does not explore."
2. **Negation standing in for an enforcer.** "Do not run `npm run check`" is written four times
   (prompt step 4, `repair.md:12`, `fresh-eyes.md:57`, `CHECK_CONTRACT_LEAD`), and the brief then
   lists `npm run check` under the `all` slot. The model avoided that exact string and ran the same
   work as `npm test` plus estate-wide lint. The positive target ("your one check command is
   `bin/gauntlet stop`") plus a deny rule would hold it. The prose alone did not.
3. **Completion criteria that cannot be checked.** "Every criterion has a file, or you are not
   done" (`prompt.md:99-100`) is high demand but has no observable output. "Green on every one of
   them, turned on, or you are not done" (step 2) is the one clear, checkable bound, and it held.
4. **Text leaking across stages.** Rung one's prompt teaches the `declaredEdits` shape with a
   non-empty example (`prompt.md:116-122`) for a field it must leave empty. `repair.md:18-21`
   explains the fresh-eyes fence, and the mechanic is handed that same file. The acceptance
   author's prompt carries implement's line "The implementer turns it on by deleting `.fails`"
   (`acceptance/author/prompt.md:32-33`).
5. **Duplication.** The brief's contents are listed twice, in `prompt.md:3-8` and
   `fresh-eyes.md:4-9`. The immutable set is restated three times. The house rules exist twice:
   `acceptance/author/house-rules.md` and `shared/house-style.ts`. The check contract has two
   renderers (`acceptance/acceptance.ts:152`, `shared/check-contract.ts:42`).
6. **Stale lines (sediment).**
   - "nearby tests and importers" describes a substring match.
   - `gateRedNote` says "after one repair round" (`implementation-landing.ts:183`) although fresh
     eyes also ran.
   - `rebaseConflictNote` cites `fixer.yml`'s rebase step (`:139`), which moved into `fixer.ts`
     (census C4).
   - ADR-0157 rejects "a fresh repair agent", and fresh eyes landed the same day (`94dc832`).
   - `AUTHOR_CHECK_CONTRACT_LEAD` tells the author "you have no tools" (`house-style.ts:22`) while
     its prompt tells it to run `npx vitest`.
7. **Undefined house words.** "the wire", "fence" and "the landing" are used as leading words but
   never defined in the text that uses them. None recruits a pretrained meaning, so each costs a
   guess.
8. **No-op and exposition sentences.** "A test that still fails honestly is worth more than one you
   talked yourself past", "nothing is held against you", "a module that shows up there repeatedly is
   evidence the seam manifest is wrong", and "That costs less than running it yourself" explain
   rather than direct.
9. **Filled-in halves.** `{{ATTEMPT}}` is uncapped (agent-context). `{{GATE_OUTPUT}}` is tailed.
   `{{BRIEF}}` is only partly capped, as above. Brief files carry no line numbers, which is why the
   model greps for them.

What is right and should stay: step 2's `.fails` bound; the immutable-set and fails-rule lines match
real gates; the style rules are enforced and save a red loop; the summary is reused as the PR body,
so it has a real reader.

### What it actually reads and does

The findings come from stream artifacts for all 28 implement runs still retained (09-16 17:11
onward) and their 7 repair rounds. None reached fresh eyes. All 12 failed and 15 cancelled runs
had expired. The brief goes in on stdin and is not in the stream, so it was rebuilt with the repo's
own `assembleBrief` on each run's acceptance commit. The token fit above confirms the rebuild; the
claimed-file contents are approximate for 11 tickets whose acceptance commit was later rebased.

| run | # | stage | turns | $ | min | brief KB | 1st-turn tok | reads (distinct) | reopened inlined | out-of-brief measured / self-reported | edits (outside claim) | greps | full-suite runs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 35126613136 | 600 | impl | 24 | 0.76 | 2 | 84 | 68k | 5 (5) | 0 | 5 / 5 | 9 (0) | 3 | 0 |
| 35129042046 | 603 | impl | 74 | 2.25 | 10 | 69 | 59k | 21 (18) | 3 | 15 / 19 | 8 (0) | 19 | 1 |
| 35142382400 | 607 | impl | 62 | 2.36 | 12 | 62 | 58k | 18 (16) | 5 | 10 / 12 | 12 (0) | 11 | 1 |
| 〃 | | repair | 13 | 1.02 | 1.5 | – | 162k | 4 (3) | 1 | 2 / 2 | 1 | 1 | 0 |
| 35145839368 | 609 | impl | 89 | 4.64 | 18 | 93 | 72k | 21 (16) | 4 | 13 / **0** | 23 (3) | 16 | 1 |
| 〃 | | repair | 24 | 2.19 | 5.5 | – | 231k | 3 (2) | 0 | 2 / 15 | 7 (3) | 1 | 1 |
| 35145655253 | 620 | impl | 58 | 2.39 | 15 | 44 | 50k | 19 (18) | 1 | 16 / 15 | 7 (1) | 12 | 1 |
| 35146180674 | 621 | impl | 91 | 5.03 | 19 | 112 | 80k | 22 (16) | 5 | 11 / 14 | 23 (4) | 20 | 0 |
| 〃 | | repair | 31 | 2.76 | 6.5 | – | 245k | 8 (5) | 3 | 3 / 5 | 9 (3) | 4 | 1 |
| 35163068551 | 611 | impl | 61 | 4.75 | 21.5 | 141 | 92k | 21 (16) | 3 | 13 / 14 | 3 (0) | 16 | 2 |
| 35164450609 | 619 | impl | 13 | 0.40 | 1 | 65 | 60k | 2 (2) | 2 | 0 / 0 | 2 (1) | 3 | 0 |
| 35170021718 | 628 | impl | 138 | 7.91 | 34 | 48 | 52k | 42 (30) | 3 | 27 / 24 | 21 (8) | 44 | 3 |
| 35173142977 | 629 | impl | 132 | 5.31 | 21 | 55 | 56k | 22 (13) | 5 | 8 / 9 | 42 (6) | 33 | 2 |
| 35175347002 | 629 | impl | 48 | 1.24 | 6 | 51 | 54k | 10 (9) | 0 | 9 / 8 | 11 (6) | 15 | 1 |

Across all 35 sessions:

- **Spend.** $98.13 in total: $84.01 on first sessions and $14.12 on repairs. A typical first
  session ran 70 turns and cost $2.85.
- **Tool calls.** 1,301 Bash, 398 Edit, 273 Read and 36 Write. Grep and Glob were not available,
  so all 464 greps and 55 `find`/`ls` calls went through Bash. 237 of 510 read events were `cat`,
  `sed -n` or `head` in Bash.
- **Tokens.** The brief is about 27% of first-session cache-read tokens and the fixed harness
  prompt about 25%. The rest is context the model built by exploring. A repair resumes a session
  already carrying 89k–326k tokens, then still re-read 1–8 files.
- **Where the out-of-brief reads went.** `shared/tracker-memory.ts` (20), `tracker-gh.ts` (19),
  `tracker.ts` (17), `gh.ts` (14), `gh.fake.ts` (13) and `gh-paths.ts` (11). The #607–#629 wave
  migrated code onto the Tracker port, but 20 of 28 tickets had an empty `## Seams consumed`. So no
  brief carried the port, and every implementer went looking for it. This confirms
  `agent-context-2026-09.md`.
- **The author's reading never reaches the builder.** The acceptance author for the same tickets
  starts at about 39k tokens and reads 4–23 files. The implementer then reopened 1–15 of the same
  files: 13 of 15 on #618, 15 of 23 on #615, 13 of 15 on #621.
- **Building more than asked.** #628 and #629 ran 132–138 turns with 21–42 edits. #629's first run
  edited 6 files outside its claim. Its second run found most of the work already merged and still
  changed 6 more.
- **The sessions note miscounts.** `shared/stream-json.ts:52` keeps the last `num_turns` it sees. A
  background task that woke #620's session after it answered made the note say "implementer: 4
  turns" when the real count was 58.

### Its code and the shared helpers

The import chain is 42 files. Sizes as code / test lines: `implement/implement.ts` 393 / 617,
`brief.ts` 242 / 428, `out-of-brief.ts` 82 / 144, `shared/implementation-landing.ts` 338 / 370,
`shared/stage.ts` 416 / 507, `shared/strikes.ts` 179 / 118, `shared/run-gauntlet.ts` 70 / 98 plus a
69-line process test. knip passes clean, but `ignoreExportsUsedInFile` (`knip.config.ts:98`) hides
exports that are only used in-file or by tests (`strikesAsGateOutput`, `runRepair`,
`runFreshEyes`, `IMPLEMENTER_MODEL`).

- **`implement.ts`.** The step order (implementer, one repair, fresh eyes, land) is clear and
  deserves to stay.
  - `runImplementer`, `runRepair` and `runFreshEyes` (`:88-137`) are three near-identical wrappers.
  - The issue state is read with an unchecked cast (`:211`), and comments are fetched twice.
  - **`recordOutOfBrief` (`:295-297`) runs before landing with no error guard**, so a gh hiccup
    there throws away paid work.
  - `gateOnChanges` (`:189-203`) re-runs a red gate "in case of flake". That happened 5 times in the
    speed sample, came back red every time, and cost about 2m20s each.
- **`brief.ts`.** Pure, budgeted, with a real test surface. The problems are in what it picks: no
  port files, the acceptance test inlined twice, no line numbers, the root `CONTEXT.md` always, and
  a substring "nearby" list.
- **`out-of-brief.ts`.** A copy of the standing-issue pattern (census C16). It lists 200 issues of
  any state and filters for open ones client-side (`:56-58`), so once tracker #243 aged out of that
  window it opened #588 and restarted every count from 1. #243 has 540 comments and #588 has 403,
  and nothing in the repo reads either (only the writer parses the markers). Concurrent runs race
  the counts, and module keys are free text.
- **`shared/implementation-landing.ts`.** Shallow, doing six jobs in one place: note texts,
  commit, rebase, push, the fails rule, and opening the PR plus dispatching Verify.
  - `landAnswer` takes 8 positional arguments (`:240-249`). Its only production caller always
    passes `rebaseOntoTrunk: true, skipPushHook: true` (`:331`), so the false branches run only in
    tests.
  - It reads `process.env.GITHUB_REPOSITORY_OWNER` in four places instead of taking it as input.
  - **The files make a pointless round trip.** `deriveAnswer` reads every changed file off disk
    (`:43-49`), and `landAnswer` writes the same bytes back (`:250-255`). `ImplementerAnswer.files`
    is left over from before ADR-0157, when the model returned file contents.
  - `removeIfPresent`'s not-found branch can never fire, because `targetCheckout.removeFile` already
    uses `force: true`.
  - **Rebase runs after the gate and before the push** (`implement.ts:256`, then `:99`), so the
    green gate judged a tree that was never pushed. A conflict aborts and pushes nothing
    (`:74-86`), and implement reports the run as `failed: false`, so it ends green. That is how 13
    finished runs were lost.
  - After a rebase it pushes without force (`:100`). If `implement/issue-N` already exists and trunk
    moved, that push is not a fast-forward and crashes the run after the model is paid (from reading
    the code; not seen in a run).
  - `judgeFailsEdits` runs after the push (`:287`), and `declaredEdits` from any rung exempts a
    path.
  - Tests fake `rebase` by throwing (`implementation-landing.test.ts:128-142`), so no real rebase or
    abort is ever exercised.
- **`shared/stage.ts`.** Four jobs in one module: spawning `claude`, a checkpoint cache, the time
  budget, and writing strike comments. The budget race (`:384-407`) is sound.
  - **The checkpoint cache is dead weight for implement.** `implement.yml` never restores
    checkpoints (only `shape.yml` and `to-tickets.yml` do). Its key hashes `git rev-parse HEAD` with
    no working directory (`:133`), which is the machine checkout, not the target (census C23). Yet
    `implement.test.ts:402` tests a "checkpoint replay".
  - The timeout strike (`:360-382`) always uses the implement ladder's "Next:" line, so acceptance
    timeouts on #539 said "Next: the mechanic", which acceptance never runs.
  - It spawns `claude` with the full `process.env` instead of `childEnv` (`:30,38`), and swallows
    errors at `:193-194`, `:363-365` and `:380-381`.
- **`shared/strikes.ts`.** Mostly pure: the rungs, markers, bodies and `strikesIn`. `fetchLaneRuns`
  and `readFailedLog` turn every error into `null` or `""`.
- **Sound small pieces:** `shared/fails-rule.ts` (38 lines), `immutable-set.ts`, `changed-paths.ts`,
  `check-contract.ts`, `run-gauntlet.ts` and the `TargetCheckout` seam, which has one production
  adapter and fakes in tests. `gh.ts` and `git.ts` take raw argv, so tests pin exact argv sequences
  rather than behaviour.
- **Mechanic copies instead of calling.** Its gate retry (`mechanic.ts:148-157`, census C10), closed
  guard (`:182-186`, C11), strike regex (`:63,75-80`, C8), failed-log reader (`:247-253`) and deny
  list (`:32-57`, C12, which does not deny `Agent` or `Task`) are all its own copies, and it reuses
  implement's `repair.md` by path.

## Touch points

### In

**The ticket as filed** (`docs/agents/ticket-format.md`, `bin/file-issue`, `bin/ticket_shape.py`).
The body carries `## Acceptance criteria` items with `- check:` markers and `## Files claimed`.
`validate` (`ticket_shape.py:311`) refuses a missing heading, a glob, more claim lines than
`claimLimit`, or a check that reads the tracker (`:327-352`). An unmarked criterion, an unparseable
marker, a whole-repo check and "already true" are held unless `--ack` (`file-issue:500-521`).

- **Stand-in checks are not refused.** Nothing classifies a check as file-exists or grep. The
  "red today" test skips any command naming a claimed path (`ticket_shape.py:520-521`), which
  exempts most proxy greps. `intent-fidelity-2026-09.md` found that all 8 proxy-only tickets built
  partial or drifted.
- **The cap counts claim lines** (`:414-424`), not bytes, criteria or diff size, and its refusal text
  still says "Lane 04's author inlines every claimed file" (`ticket-shape.rules.json:27`), which
  `2cfdfdc` removed. The brief already caps by bytes. This confirms `ticket-shape-2026-09.md`.
- `~/bin/file-issue` and `~/bin/close-ticket` resolve into `~/.agents/workflow` at `3f7fab1`; both
  files are identical to the repo's copies.

**The `to-build` start step.** The owner adds `to-build`. `dispatch-reconcile-caller.yml` fires and
`doorOf` (`dispatch/ticket-state.ts:317-334`) sends `acceptance-wanted` when there is no
`accept/issue-N`, or `ticket-ready` when there is (`reconcile.ts:697-740`).

- `toBuildRefusal` needs only one marked criterion (`.some`, `:302`). Unmarked ones later close as
  `UNVERIFIED`.
- Spec children start on `## Parent PRD` alone and skip that refusal (`:416`).
- **This hand step is the largest wait on the path:** filed to `to-build` took a median of 6h11m
  over 10 tickets (29m to 26h33m). `run-outcomes-2026-09.md` measured a median of 2h02m on a wider
  set; both confirm it.

**The acceptance tests handed over.** Lane 04 commits tests to `accept/issue-N` with
`push --no-verify` (`acceptance/acceptance.ts:361-375`). `baseOnTicketBranch` checks that branch out
(`shared/implementation-landing.ts:105-118`), and the brief inlines the `test.fails` files.

- **The additive rule is enforced** by `additiveRefusal` (`acceptance.ts:201-231`): no removed
  lines, no deletions, inside the suite roots, at least one `test.fails` naming `#N`.
  `judgeAuthoredBatch` (`:311-337`) requires each test to be red today.
- **Coverage is not enforced.** The author prompt asks for "At least one test" and allows skipping
  criteria (`author/prompt.md:24-26`). Nothing checks that each behavioural criterion got a test.
  "No assertion is weakened" (`author/repair.md`) is prose only.
- **Building without tests is allowed.** `baseOnTicketBranch` treats any fetch error, auth
  included, as "no branch". It logs "its acceptance test is missing" and builds from trunk anyway
  (`:117`).
- **The lock covers only implement and mechanic.** The fixer pushes with `--force-with-lease` and
  no lock (`fixer/fixer.ts:91-102`). No gate anywhere (Verify, Integrate, husky, `bin/gauntlet`)
  refuses a push that removes test cases. The charter's "Partly: the builder only" is accurate, and
  the builder's part is weaker than it sounds (R9, R18, R24).

### Out

**Landing.** Covered in depth above.
`landUnderGate` → `landAnswer` writes the files, refuses an empty answer or the immutable set,
commits, rebases, pushes with `--no-verify`, runs the fails rule, opens the PR, and dispatches
`implementation-opened` with `{pr, changed_files, criteria}` (`:240-311`). A red gate still pushes
and escalates to the owner (`:329-336`).

**Verify** (`verify.yml`, `integrate/gate.ts`, `integrate/immutability.ts`).

- **It judges trunk, not the PR.** Confirmed on `a1dbf33`: "Checkout target"
  (`verify.yml:61-64`) passes no `ref`, so a `repository_dispatch` checks out the default branch.
  For #592, #644 and #630 the test run ran on trunk's head (for #592, `33c2565` instead of
  `47ee8e1`).
- Its immutability check reads the payload's self-reported `CHANGED_FILES`, not the PR diff.
- The `criteria` it is sent are never read, and integrate's re-drain sends `criteria: []`
  (`integrate.ts:396`, census C5).
- There is no model and no separate judge. The step costs about 2m50s per ticket plus about 45s of
  waiting.

**The merge lane's re-gate** (`integrate.yml`, `integrate/integrate.ts`).

1. Rebases onto main and force-pushes (`:193-205`).
2. Runs `bin/gauntlet push` on the rebased branch (`:336-338`). This is the only gate that judges
   the PR's own code, and it runs the acceptance tests once they are on.
3. Waits for a Verify verdict matched on `github.sha`, which is also trunk (`integrate.yml:34`).
4. Merges (`:354`) with `GH_TOKEN: github.token`, which raises no push event, so Verify never runs
   on trunk after a lane merge.
5. `ringTrunkCi` dispatches `ci.yml`, which this repo does not have (`:246-256`).
6. Runs `close-ticket`; a refusal leaves the merge in place (`:258-288`).

Integrate merges one PR at a time, and its queue cancels waiting runs: #590's integrate run
(35032088742) was cancelled and re-sent 65 s later. This confirms `merge-quality-2026-09.md`:
nothing checks trunk after a lane merge.

**`bin/close-ticket`.** Run by the merge lane (`runRealCloseTicket`, `integrate.ts:423`) or by a
session by hand, as `<issue> <base>..<head> <checkout>`.

- It refuses while a `test.fails` names `#N` (`:659-670`).
- It runs each marker with `shell=True` in `<checkout>` (`:430-431`), and any non-zero exit
  refuses.
- Unmarked criteria are recorded `UNVERIFIED` and still close, unless every criterion is unverified
  (`:538-550`).
- **Nothing ties `<checkout>` to main.** From the merge lane it is the rebased head before the
  merge, and from a session it can be the builder's own worktree. So "run by something that did not
  build it, on main" is not enforced.
- It never shows a check was red at base. It refused 15 times after lane 08 had already merged
  (`run-outcomes-2026-09.md`).

### Speed, filing to merged

These are 16 clean tickets from 09-13 to 09-17, each with one acceptance run, one implement run and
one PR merged by integrate. 10 came through the ticket door and 6 were spec children. Timings come
from issue timelines, job step timestamps and logs.

| Step | Median | Range |
|---|---|---|
| Filed → `to-build` (10 tickets) | **6h11m** | 29m – 26h33m |
| `to-build` → acceptance run created | 38 s | 26 – 47 s |
| Acceptance queue / setup | 3 s / 14 s | |
| Acceptance model session | **4m54s** | 1m23s – 15m50s |
| Acceptance after the model | 11 s (was 130–160 s before `8c80cf0`) | |
| Acceptance end → implement run created | 30 s | |
| Implement queue / setup (installs cached, 3–4 s each) | 3 s / 15 s | |
| Implement model sessions | **9m53s** | 1m27s – 28m49s |
| Implement full gate before push | **2m23s** | 1m36s – 12m11s |
| Rebase, push, open PR | 37 s | |
| PR opened → merged | **3m43s** | 2m45s – 7m08s |
| Merged → closed | 7 s | |
| **First lane label → merged** | **24m12s** | 10m07s – 52m05s |

- **Model time is about 60% of the path** once the label is on.
- **The whole suite runs at least three times per ticket** (implement gate, Verify, integrate), and
  up to seven times (#578). In 8 of 16 sessions the model also ran it itself.
- **Waiting on a blocker** held spec children for 8 min to 5h18m.
- **Setup is not a cost.** Dependencies restore from cache in 12–18 s.

**Prior art checked.** `acceptance-lane-wall-clock-2026-09.md`:

- **Acceptance push wasted about 3 minutes:** confirmed, and fixed by `8c80cf0`.
- **Vitest runs on half the cores:** still true.
- **The reconciler cancels its own queued runs:** still true (293 of 850 since 09-13), at no cost.
- **"18 s setup paid twice":** now 14–15 s, no longer material.
- **"Model is 3% of acceptance":** no longer true. It is now 80–95%, because the author takes many
  turns since `2cfdfdc`.

**The fastest realistic small ticket** (one criterion, 1–2 files). #582 is the best observed at
10m46s. The following changes get it to about **6m40s** after filing, and about 5m30s with a faster
test runner:

1. Apply `to-build` at filing when the session and owner agreed. Saves hours.
2. Merge without Verify's trunk re-run when integrate's rebased gate is green. Saves about 3m10s.
3. Run the acceptance author and the implementer in one job. Saves about 60 s of hops and setup.
4. Drop the red-gate re-run. Saves 2m20s on about a quarter of tickets.
5. Deny whole-suite commands inside the session. Saves about 2 min on half of tickets.
6. A faster test step (bigger runner or more workers). Maybe 60–80 s per gate run; not measured.

A median ticket would drop from about 24 to about 18 minutes. The rest is model time.

**The charter's goal is "ships it very fast", but no row of its table covers speed.** Nothing
measures filing-to-merged time, and nothing refuses a change that slows it.

## Lenses

One row per part, one column per lens. Each cell gives a short verdict and a pointer (§ = section
above; R = rule table row; V/T = verdict row below).

| Part | Caller | Shared | Context | Writing for agents | Context split | Speed |
|---|---|---|---|---|---|---|
| Reconciler dispatch, `ticket-ready` | Right events, 1 s to run; 21% of reconciler runs pay a runner then bail; a caller `if:` would skip them (§How it fires) | Strikes counted across lanes, so an author death misroutes to fresh eyes (§Strike ladder; V5) | n/a | n/a | n/a | 38 s hop per lane; fine |
| Caller + reusable workflow | One extra file per lane; needed only for other repos (V2) | Same split in every lane | n/a | n/a | n/a | none |
| Concurrency, budget, timeout | Per-ticket key right; a cancelled waiting run would strike (V3); budget skips gates and landing (V4) | `mechanic.yml` shares the key | n/a | n/a | n/a | 90-min wall never hit; p95 36 min |
| Strike ladder and mechanic | Mechanic 0 runs; fresh eyes inside the run starves it (V6) | Strike regex copied in implement and mechanic without decision reset (C8) | Fresh eyes handed pre-decision strikes | n/a | Mechanic reuses implement's `repair.md` | n/a |
| `prompt.md` | n/a | Contract and house rules also restated for the author | Invites exploring; 26/28 reopened inlined files (R3) | Negation for R14; unchecked R16; undefined "wire"/"fence"; no-op exposition (§Graded) | Carries fresh eyes' `declaredEdits` shape | 19/28 ran the full suite, about 2 min each |
| `repair.md` | n/a | Reused by mechanic by path | Resumed 89k–326k context still re-read 1–8 files | Restates immutable set, "no npm run check" | Explains fresh eyes' fence | Re-ran wide checks in 7/7 |
| `fresh-eyes.md` | Runs only when rung-one gate stays red (none in window) | n/a | `{{ATTEMPT}}` uncapped | Example breaks its own path rule (R25); brief list duplicated | Carries its own permission to rewrite tests (R24) | unmeasured |
| Brief (`brief.ts`) | n/a | Standards and style also in author prompt; two contract renderers | Median 78 KB; ≈31k + 0.438 tok/byte; explored 73 KB median beyond it; port files missing; test inlined twice | "nearby tests and importers" is a substring list | `all` slot and Stop-hook note leak in; author's reads not carried forward | Brief size tracks first-turn tokens only |
| Out-of-brief tracker | Fires one gh comment per read, per run | Standing-issue copy (C16) | Self-report, not a meter (#609: 0 vs 13) | n/a | n/a | Unguarded; can throw away a paid run |
| Tool fence, harness surface | n/a | Mechanic's copy omits `Agent`/`Task` (C12) | ~31k fixed tokens per session from full tool list | n/a | n/a | n/a |
| `stage.ts` checkpoint and timeout strike | Checkpoint never restored in `implement.yml` | Timeout strike says "mechanic" for acceptance | n/a | n/a | n/a | n/a |
| Landing (`implementation-landing.ts`) | Pre-push rebase discards green work (13 runs) | Rebase copied 4 times with 4 behaviours (C1); push flags differ (C6) | Files round-trip for nothing | Stale note texts | n/a | Gate before rebase judges an unpushed tree; red re-run 2m20s wasted |
| Ticket filing (`file-issue`) | n/a | Cap logic's reason cites removed inlining | n/a | n/a | n/a | Ticket label added hours late on #576, #584, #586 |
| `to-build` hand step | Human event; median wait 6h11m | n/a | n/a | n/a | n/a | Largest wait on the path |
| Acceptance handoff | Reconciler hop ~30 s | House rules written twice; contract rendered twice | Author reads 4–23 files; builder re-reads 13/15 | "you have no tools" contradicts "run npx vitest" | Author carries implement's `.fails` line; `CONTEXT.md` only to builder, parent PRD only to author | Author model 4m54s median |
| Verify | Fires on `implementation-opened`, checks out trunk | Duplicate of integrate's gate; `criteria` sent and ignored (C5) | n/a | n/a | n/a | 2m50s + 45 s per ticket for a trunk re-check |
| Integrate re-gate | Single queue cancels waiting runs; merge raises no trunk event | Rebase copy C1; gate runner copy C20 | n/a | n/a | n/a | PR→merge 3m43s median |
| `bin/close-ticket` | Runs after the merge, on the pre-merge head | Its checks never re-run on main | n/a | n/a | n/a | 7 s |

## Verdicts against the charter

The Charter column quotes the table row, or names the Layers or Lean-on section. "Seed" says whether
the part, as kept or fixed, belongs in a small new core.

### Implement lane

| # | Part | Verdict | What and why | Charter | Seed |
|---|---|---|---|---|---|
| V1 | Reconciler dispatch and `ticket-ready` ring | Keep and fix | Move the owner/label filter into the caller's job `if:` so 21% of runs stop paying a runner. Key strikes by lane so an author death does not send implement to fresh eyes | "A part is fired by a real event, never a timer" (holds); "The owner is never the one who fixes a stuck run" (misrouted strikes climb toward the owner decision) | Yes, as a smaller ready-set |
| V2 | Caller plus reusable workflow split | Keep as is | It costs one file per lane and exists for other repos. The charter cannot judge it cleanly; see below | "An added part is small, needs no upkeep…" applies to additions only | No |
| V3 | Per-ticket concurrency group | Keep and fix | Stop counting a cancelled waiting run as a strike | "The owner is never the one who fixes a stuck run" | Yes |
| V4 | 80-min budget and 90-min timeout | Keep as is | Never fired, but it bounds a runaway session. The charter's 30-day rule reads as "cut", which is wrong for a rail; see below | "A part with no useful work in 30 days is removed" (unclear for rails) | Yes |
| V5 | Strike counting (`strikesAsGateOutput`, mechanic's regex) | Keep and fix | Use the shared `strikesIn`, which resets on a decision; count per lane | "Each rule lives in one place" | Yes, the pure half of `strikes.ts` |
| V6 | Mechanic lane and rung | Cut | 0 runs since 09-06, starved by design, and a copy of implement's gate retry, closed guard, strike regex and deny list. What breaks: two-strike tickets reach the decision one rung sooner, and the fails-rule refusal needs a new target (V26 removes most causes) | "A part with no useful work in 30 days is removed" (due 10-06); "Each rule lives in one place" | No |
| V7 | Decision rung (three strikes to the owner) | Keep and fix | Its Option A asks the owner to "fix what the strikes name". Name a non-owner fixer, and ask the owner only scope or priority | "The owner is never the one who fixes a stuck run"; "The owner … is asked only about scope, priority and taste" | Yes, reworded |
| V8 | `implementer/prompt.md` | Keep and fix | Delete the "reading wider … yes" paragraph; state the positive check command; move R3/R14 into enforcers (deny whole-suite commands, meter reads); drop the rung-one `declaredEdits` text; fix "nearby"; cut exposition; define or drop "wire" and "fence". Roughly 40% shorter | "An agent is handed what it needs, so it does not explore"; the table preamble ("follows written instructions only most of the time … every rule names an enforcer") | Yes, shortened |
| V9 | `implementer/repair.md` | Keep and fix | Drop the fresh-eyes fence text; stop the mechanic reusing it; the same whole-suite deny applies | "Each rule lives in one place" | Yes |
| V10 | `implementer/fresh-eyes.md` | Keep and fix | Remove the licence to rewrite a `test.fails` test on the model's own say-so; route a claimed-wrong test to a separate judge. Fix the unrooted example path | "Tests exist before the build starts, and nothing may weaken them"; Lean on "Judging work it did not build, from a fresh context" (keeps the rung itself) | Yes |
| V11 | Brief builder (`brief.ts`) | Keep and fix | Put the port files a ticket consumes in the brief (require `## Seams consumed` when a claim imports a port); inline the acceptance test once; add line numbers; include a module `CONTEXT.md` only when one exists; build "nearby" from real imports; cap the whole brief; carry the author's read list forward | "An agent is handed what it needs, so it does not explore" (enforcer: "The brief's size cap, plus a meter on reads outside the brief") | Yes |
| V12 | Style rules in the brief | Keep as is | Every rule has a gate (prose gate, eslint); the copy saves a red loop | "Every rule on this page names an enforcer that exists" (met); "Each rule lives in one place" (unclear for a taught copy; see below) | Yes |
| V13 | `CODING_STANDARDS.md` entries in the brief | Keep and fix | No enforcer in the lane: review drops every finding. Give each entry a judge that publishes, or delete it from the brief | "A rule with no enforcer is marked NOT ENFORCED YET until one ships, or it is deleted" | No, until enforced |
| V14 | Check-contract section in the brief | Keep and fix | Render only the slots the builder may run; drop `all` and the Stop-hook note | "An agent is handed what it needs" | Yes |
| V15 | Out-of-brief self-report and tracker issues | Cut | 943 comments across two duplicate issues, no reader, not a measurement, and an unguarded throw before landing. What breaks: ADR-0042's count; replace it with a meter computed from the stream artifact, which is the charter's named enforcer | "An agent is handed what it needs…" (enforcer "a meter on reads outside the brief"); "A part with no useful work in 30 days is removed" | No |
| V16 | Sessions note comment on the ticket | Cut | Miscounts turns and has no reader; the stream artifact holds the same facts. Nothing breaks | "A part with no useful work in 30 days is removed" | No |
| V17 | Step order: implementer, one resumed repair, fresh eyes | Keep as is | Resume carries the why (ADR-0157); fresh eyes is a separate judge | Lean on "Writing code to a target it can run", "Picking work back up from what was saved", "Judging work it did not build, from a fresh context" | Yes |
| V18 | Re-running a red gate (`gateOnChanges`) | Cut | 5 re-runs, 0 flips, 2m20s each. What breaks: a true flake costs a repair round instead | "A part with no useful work in 30 days is removed… a gate counts when it refused something real" | No |
| V19 | Tool deny list | Keep and fix | Add `npm test`, `npm run check`, whole-suite `vitest` and estate-wide lint; share one list with every checkout lane | Table preamble: an instruction is not an enforcer; "Each rule lives in one place" | Yes |
| V20 | Full Claude Code surface per stage (~31k tokens) | Keep and fix | Narrow tools and setting sources as the lenses do; keep Read/Edit/Write/Bash and structured output | "An agent is handed what it needs, so it does not explore" | Yes |
| V21 | Checkpoint cache in implement | Cut | Never restored in `implement.yml`; wrong key. What breaks: a test of a replay that cannot happen | "A part with no useful work in 30 days is removed" | No |
| V22 | Timeout strike written from `stage.ts` | Keep and fix | Log a `… failed: timed out` line for the reconciler's strike instead of posting from a helper with the wrong ladder text | "Each rule lives in one place" | Yes, the abort only |
| V23 | `ImplementerAnswer.files` round trip | Cut | Reads files off disk and writes them back unchanged. What breaks: landing tests need reshaping | "An added part is small, needs no upkeep to stay true" | No |
| V24 | Pre-push rebase that discards on conflict | Keep and fix | Push the branch first, then rebase, or leave conflicts to integrate. Gate after rebase, not before. One shared rebase-and-land step for all four copies (C1) | "The owner is never the one who fixes a stuck run" (conflict goes to the owner); Lean on "Picking work back up from what was saved"; "Each rule lives in one place" | Yes, once rebuilt |
| V25 | Immutable-set refusal at landing | Keep and fix | Refuse the edit inside the session (deny `Edit`/`Write` on those paths) so nothing is paid for, and do not page the owner | "The owner is never the one who fixes a stuck run" | Yes |
| V26 | The `.fails` lock (`fails-rule.ts`) | Keep and fix | Compare whole test blocks, not one line; ignore `declaredEdits`; judge before the push; add a test-case count gate on every push route (fixer included) | "Tests exist before the build starts, and nothing may weaken them" (enforcer "the `.fails` lock, plus a gate on any push that removes test cases") | Yes |
| V27 | Red gate: push anyway and page the owner | Keep and fix | Keep the push (work is saved). Route to a non-owner fixer, which today would be the fixer on a Verify verdict that judges trunk (T6) | "The owner is never the one who fixes a stuck run" | Yes, the push |
| V28 | Nothing-to-build: page the owner | Keep and fix | Run the ticket's checks on main; if they pass, close through `close-ticket`, otherwise re-queue with a signature | "The owner is never the one who fixes a stuck run"; "Done means the ticket's checks pass on main" | Yes |

### Touch points

| # | Part | Verdict | What and why | Charter | Seed |
|---|---|---|---|---|---|
| T1 | Ticket format and `bin/file-issue` | Keep and fix | Refuse a ticket whose checks are all stand-ins (file exists, grep); replace the claim-line cap with a byte or criteria limit and fix its stale reason | "Checks test the behaviour meant, not a stand-in like a file or a text match" (enforcer "Filing refuses a ticket whose checks are all stand-ins") | Yes |
| T2 | The hand-applied `to-build` step | Keep and fix | Apply it at filing when the session and owner agreed (`file-issue --build`); require every criterion to be marked | Layers, One ticket: "the session files a ticket, and the machine builds it to merged"; the goal "very fast" (no rule) | Yes, folded into filing |
| T3 | Acceptance author handoff | Keep and fix | Require a test per behavioural criterion; fix "you have no tools"; remove implement's line from the author prompt; pass the author's reads into the brief | "Tests exist before the build starts…"; Lean on "Writing code to a target it can run" | Yes |
| T4 | Building when `accept/issue-N` is missing (`baseOnTicketBranch`) | Keep and fix | Refuse to build without the tests; tell a fetch error apart from an absent branch (C3) | "Tests exist before the build starts" | Yes |
| T5 | Landing's PR and Verify dispatch | Keep and fix | Open the PR from the saved branch (V24) and dispatch only what a reader uses; `criteria` is never read | "Each rule lives in one place" | Yes |
| T6 | Verify's PR verdict | Cut | It judges trunk, not the PR, reads self-reported changed files, and ignores criteria. Integrate's rebased gate is the real PR gate. What breaks: the fixer ring on a red PR verdict (already ringing on trunk results) and the PR immutability check, which should move into integrate against the real diff | "Done means the ticket's checks pass on main, run by something that did not build it"; "A part with no useful work in 30 days is removed" | No |
| T7 | Integrate's re-gate | Keep and fix | Keep the gauntlet on the rebased head. Run the ticket's `check:` markers before merging. Make the merge raise a trunk run (or run the checks on the merge SHA). Stop the single queue cancelling waiting runs | "Done means the ticket's checks pass on main… `bin/close-ticket`, re-run after every merge" (status "Partly: nothing re-runs checks after a lane merge") | Yes |
| T8 | `bin/close-ticket` | Keep and fix | Run on the merged main SHA, never a builder's worktree; refuse `UNVERIFIED` criteria on tickets; show each check was red at base | "Done means the ticket's checks pass on main, run by something that did not build it" | Yes |

### Count

35 parts: **4 keep as is** (V2, V4, V12, V17), **24 keep and fix** (V1, V3, V5, V7–V11, V13, V14,
V19, V20, V22, V24–V28, T1–T5, T7, T8), **7 cut** (V6, V15, V16, V18, V21, V23, T6).

### What would seed a small new core

The ticket shape validator with a stand-in refusal (T1); filing that starts the build (T2); the
acceptance author with its additive rule and coverage (T3, T4); the brief builder (V11); a short
implementer prompt with a real deny list (V8, V19, V20); the implementer → resumed repair → fresh
eyes order (V17); the `.fails` lock widened into a test-count gate (V26); one rebase-and-land step
that saves work first (V24); integrate's rebased gauntlet plus the ticket's checks (T7); and
`close-ticket` on main (T8).

These would not seed it: the mechanic, the out-of-brief tracker, the sessions note, Verify's PR
verdict, the checkpoint cache, the files round trip, the red-gate re-run, and the current landing
module as written.

### What the charter could not judge cleanly

1. **Speed.** The goal says "very fast", and no row covers it. The speed findings (the hand label,
   three to seven full-suite runs, Verify's trunk re-check) could only be tied to the goal line, not
   to a rule with an enforcer.
2. **A test that is itself wrong has no lawful fixer.** "Nothing may weaken them" plus "the owner is
   never the one who fixes a stuck run" leaves nobody allowed to correct a wrong acceptance test.
   Fresh eyes' licence (R24) exists for that case. V10 assumes a separate judge; the charter should
   say who that is.
3. **Rails that rarely fire.** "A part with no useful work in 30 days is removed… a gate counts when
   it refused something real" would remove the time budget (V4), the immutable-set refusal (0 hits
   in 28 runs) and the claim hold (never triggered). A rail's worth is in what it prevents, and the
   rule does not say whether that counts.
4. **Parts that already exist.** "Added only for a failure that happened" and "small … a built-in
   … was not enough" are written for additions. For the caller/reusable split (V2) the only test is
   the 30-day rule, and the Layers never say whether other repos are in scope.
5. **A taught copy of an enforced rule.** "Each rule lives in one place" read strictly forbids the
   style rules in the brief (V12), but the copy is a cache of a gate that saves a paid red loop. The
   charter does not say whether a prompt restating a gated rule is a second place.
6. **Research tickets.** This ticket's own checks are `test -f` and `grep`, the stand-ins the
   "Checks test the behaviour meant" row would refuse at filing. A ticket whose deliverable is a
   document has no other kind of check.

## Evidence already on main, confirmed on `a1dbf33`

No lane code has changed since these notes were written. Every commit after `606e2c5` touches docs
only, and `a1dbf33` adds the charter.

| Note | Claim | Status on trunk |
|---|---|---|
| `intent-fidelity-2026-09.md` | Builds drift even on clean runs; proxy-only criteria always drifted; dropped review findings named the defects | Confirmed in code: no proxy classifier, criteria skippable by the author, lock covers one line, review's `structural-refusal.ts:9-16` still drops every finding. Grades not re-derived |
| `ticket-shape-2026-09.md` | Small real-check tickets built clean; the file cap counts the wrong thing | Confirmed: cap counts claim lines, stale reason text, claimed-path exemption, `.some` door check |
| `merge-quality-2026-09.md` | 8 merged tickets failed their own criteria at close; nothing checks trunk after a lane merge | Confirmed: Actions-token merge, no `ci.yml`, close after merge, Verify on trunk |
| `run-outcomes-2026-09.md` | 12 green runs thrown away at the pre-push rebase | Confirmed, now 13 (#629, run 35175347002); code unchanged (`implementation-landing.ts:74-100`, `:331`) |
| `agent-context-2026-09.md` | Costliest runs were exploration; the port a migration consumes was not in the brief; inlined files re-read | Confirmed on all 28 retained runs; the tracker fork (#243 → #588) is still open |
| `rule-census-2026-09.md` | C4–C6 contradictions | C4 (reconciler holds only claimed files while runs repair unclaimed fixtures) and C5 (red saves work, conflict discards it) stand; C6 (fresh-eyes example path) stands at `fresh-eyes.md:77` and `prompt.md:121` |
| `lane-census-2026-09.md` | Rebase copied four times; strike parsing copied; Mechanic never ran | Confirmed: C1 at `implementation-landing.ts:74-86`, `fixer/fixer.ts:292-306`, `integrate/integrate.ts:193-206`, `shared/push-to-trunk.ts:17`; C8 at `implement.ts:302-313`, `mechanic.ts:63,75-80`; mechanic 0 runs |
| `claude-in-practice-2026-09.md` | Code checks held; prose rules did not | Matches this lane: the immutable set (0 attempts) and denied tools (6 denials, all respected) held, while R3 (26/28) and R14 (19/28 in spirit) broke |
| `claude-leverage-guidance-2026-09.md` | Claude edits tests, over-builds, follows prose probabilistically; separate judges and gates work | Matches: #617's title rename passed the lock, #628/#629 over-built, and fresh eyes is the one separate-judge rung, unmeasured in the window |
| `acceptance-lane-wall-clock-2026-09.md` | Wall clock of the acceptance lane | Partly outdated: push waste fixed by `8c80cf0`; the model is now 80–95% of the lane, not 3% |

## Not verified

- **Streams.** Only runs from 09-16 17:11 onward still had artifacts. No fresh-eyes session was in
  that window, so R23–R25 in practice are unmeasured. Read counts parse Bash commands heuristically.
- **Failure modes read from code only, never seen in a run:** the non-fast-forward push crash after
  a rebase (landing `:100`), the fails-rule double dispatch, and a cancelled waiting run earning a
  strike.
- **Deny-list bypasses** by other spellings (`git -C . commit`) were not tried.
- **Why the merged-PR guard** (`reconcile.ts:678`) did not stop repeat runs for #533, #629, #617 and
  #619.
- **Integrate's own test-run duration**: its log is silent. The speedup from a larger runner is
  unmeasured.
- **Whether a job that hits `timeout-minutes` ends `cancelled`.**
- **The ticket owner of 7 log-less cancelled runs on 09-02.**
