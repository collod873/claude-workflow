# What an agent reads to do its job, and where it gets lost

Research for #650 (map #646, the **Context** question). Written 2026-09-16 against trunk `8587d4f`.
Facts and candidates only; no rulings.

## Summary

- **A fixed cost is paid before any lane agent reads its prompt.** Across 18 review runs on
  2026-09-16/17 the reviewer's first turn held 25.9k–47.9k input tokens. The smallest diff in
  the set, 10.9 KB for PR #644, gave 30.2k. So roughly 24k tokens are the Claude Code system
  prompt, the tool definitions (the run's `init` event lists `Workflow`, `CronCreate`,
  `DesignSync`, `RemoteTrigger` and others) and the skill listing. Every lane stage pays it except
  the observation lenses. Those run with `--tools ""`, `--setting-sources ""` and
  `--disable-slash-commands` (`observations/auditor.ts:18-33`).
- **Owner sessions start at 28k–42k tokens** (first-turn usage in the 40 newest sessions). What
  loads before the first message, measured in session `51a01c73`:
  - the skill listing: 12.5 KB, 36 skills (43 in session `9e0cb2ab`), most of them not about this repo;
  - the system prompt: about 15 KB;
  - the agent listing: 3.0 KB;
  - both `CLAUDE.md` files: 3.8 KB together;
  - the deferred-tool list: 2.2 KB;
  - the session brief: 1.4 KB, capped at 30 lines (`.claude/hooks/session-brief.py:30`).

  Auto memory is off (`autoMemoryEnabled: false`), so no `MEMORY.md` loads.
- **Only one stage has a byte budget**: the implement brief (`implement/brief.ts:37-39`). Every
  other injected input is uncapped. The only other size check is the 128 KB argv limit
  (`shared/stage.ts:23`, `:294-299`). It throws, and only for stages that pass the prompt on argv
  (to-tickets, the shape sweep, the shape refuter). `LANE_BUDGETS` (`shared/lane-budget.ts`)
  counts minutes, not bytes.
- **The biggest measured costs are implement runs, and most of the cost is exploration, not the brief.**
  - #628 (run `35170021718`): 138 turns, 26.8M cache-read tokens, $7.91, 105 Bash calls.
  - #629 (run `35173142977`): 132 turns, 18.5M cache-read tokens, $5.31.

  Each started from a brief of about 50–60 KB. A third of that brief is the root `CONTEXT.md`,
  because no module `CONTEXT.md` exists.
- **Where agents get lost most:**
  1. Every Tracker-migration implementer read the Tracker port outside its brief. `tracker-gh.ts`,
     `tracker.ts`, `tracker-memory.ts` and `gh.fake.ts` have 16–19 out-of-brief reads each on #588.
  2. Stages rediscover each other's facts. For #628, the acceptance author, the implementer and
     the reviewer each opened `tracker-memory.ts`, `gh.fake.ts` and `stub-gh.fixture.ts` from
     scratch. The lane 03 slicer re-ran the seam sweep's `"api"` grep three times.
  3. The lane 03 slicer (run `35133339528`) lost track of which checkout it was working in, spent
     a subagent checking a stale checkpoint, and then died on a path that did not say where it
     starts.
- **Top candidates:**
  - byte budgets on the review diff, mechanic comments, fresh-eyes attempt and shape reading list;
  - a smaller tool and skill surface for lane stages, the way the lenses already do it;
  - name the port files a migration consumes in the ticket, so the brief carries them;
  - carry the seam sweep's call-site list forward instead of the bare manifest;
  - a "Where things are" block (the mechanic already has one) for to-tickets;
  - fix the out-of-brief tracker lookup that forked the counter from #243 to #588;
  - resolve the acceptance prompt's "you have no tools" line, which the author contradicts in
    practice.

## Method and sources

- Lane code and prompts at `8587d4f`.
- Stream artifacts (`claude-streams-*`, kept 14 days) from:
  - review runs `35130908751` through `35175002431` (18 runs);
  - acceptance runs `35169674070` and `35172769078`;
  - implement runs `35170021718` and `35173142977`;
  - to-tickets run `35133339528`.

  I parsed each with a small script for the first turn's `usage` (input + cache-creation +
  cache-read tokens), the `result` event (turns, cost) and every `tool_use`.
- Owner-session transcripts under `~/.claude/projects/-home-collin-Claude-Projects-Workflow/`.
  I extracted `attachment` entries and main-thread `tool_use` calls with `jq`/python.
- Issues #588, #243, #538, #628, #629, #132; PR diffs #530, #634, #644, #645, #651.

"First-turn tokens" include the fixed ~24k baseline above. Byte figures for inputs come from
the files and issues themselves. Where a size is an estimate from parts, the row says so.

## Lane stages: what each reads, its size on real work, its budget

Every stage fills `prompt.md` through `substitute` (`shared/stage.ts:409-416`, called at `:265`),
except the observation lenses, which never touch `stage.ts` (`observations/auditor.ts:32-33`).
The 27 Markdown prompt and reference files under `.Workflow/agent-workflows` total **12,792
words**. No test or gate meters them: the only size test in `.claude/` is `gate-size.test.ts`, which
caps gate lines, not prompts.

| Lane / stage | Model | Template | Injected inputs (source) | Size on real work | Budget / over-budget behaviour |
|---|---|---|---|---|---|
| 01 Shape: sweep | Haiku 4.5 | `shape/sweep/prompt.md` 4.5 KB | `IDEA`, `FOCUS`, `ISSUE_NUMBER` (`shape/shape.ts:131-132`) | no stream artifacts in retention (last model run `35141061203`, no artifact) | argv; throws over 128 KB |
| 01 Shape: shaper | Opus 5 | `shape/shaper/prompt.md` 6.5 KB | `CONTEXT_MD` 16.5 KB, `CODING_STANDARDS_MD` 5.2 KB, `READING_LIST` (full contents of every ref the sweep lists, `shape/prepared-context.ts:5-20`), `PRIOR_ART` (≤3, `shape/sheet.ts:5`), `IDEA`, `CHANGE_REQUEST`, `RESWEEP` (`shape/shape.ts:152-158`) | ≥ 22 KB fixed before the reading list; reading list unmeasured | **none**; stdin |
| 01 Shape: refuter | Sonnet 5 | `shape/refuter/prompt.md` 1.8 KB | `DECISIONS` (JSON), `RESTATEMENT` (`shape/shape.ts:171-172`) | unmeasured | argv; throws over 128 KB |
| 02 Spec: sweep | Haiku 4.5 | `spec/sweep/prompt.md` 1.7 KB | `OWNER_WORDS`, `DECISIONS`, `BOUNDARIES`, `OPEN_GUESSES` (`spec/sweep.ts:29-32`) | unmeasured (no artifacts) | none; stdin |
| 02 Spec: author | Opus 5 | `spec/author/prompt.md` 3.2 KB | the sweep's four + `RULINGS` (every durable ruling for a map's entries, in full, `spec/collectors/map.ts:68`) + `SPEC_FORMAT` 8.8 KB (`spec/spec.ts:91-96`) | ≥ 12 KB fixed; rulings unmeasured | **none**; stdin |
| 02 Spec: critic | Opus 5 | `spec/critic/prompt.md` 3.0 KB | `TITLE`, `BODY`, `ANSWERS` (`spec/critic.ts`) | spec body, e.g. #538's is 13.4 KB | none; stdin |
| 02 Spec: reconcile | Opus 5 | `spec/reconcile/prompt.md` 3.5 KB | `TITLE`, `BODY`, `RESOLUTIONS`, `SPEC_FORMAT` 8.8 KB (`spec/reconcile.ts:52-65`) | ≥ 22 KB with a #538-sized body | none; stdin |
| 03 To-Tickets: seam-sweep | default | `to-tickets/seam-sweep/prompt.md` 1.6 KB | `ISSUE_NUMBER`, `VOCABULARY` 2.7 KB (`to-tickets/to-tickets.ts:148`); the agent fetches the spec itself with `gh issue view` (`seam-sweep/prompt.md:14`) | run `35133339528`: first turn 36.6k tokens; 35 turns, $1.05, 22 Bash + 11 Read | argv; throws over 128 KB |
| 03 To-Tickets: slice | default | `to-tickets/slice/prompt.md` 7.0 KB | `ISSUE_NUMBER`, `VOCABULARY`, `TICKET_FORMAT` 7.7 KB, `SEAM_MANIFEST` (prior checkpoint), `TOP_LEVEL_ENTRIES` (`to-tickets.ts:152-162`); agent fetches the spec again (`slice/prompt.md:30`) and `cat`s four reference files (`:22-26`, 3.0 KB) | run `35133339528`: first turn 42.2k tokens; 26 turns, 63 Bash, 2 subagents, $3.37, 21.7 min; **ended in failure** | argv; throws over 128 KB |
| 03 To-Tickets: audit | default | `to-tickets/audit/prompt.md` 5.6 KB | `ISSUE_NUMBER`, `VOCABULARY`, `PLAN` (slice checkpoint, 33.5 KB for #538) (`to-tickets.ts:193-197`); agent fetches the spec a third time (`audit/prompt.md:22`). It gets no `TICKET_FORMAT`, `SEAM_MANIFEST` or `TOP_LEVEL_ENTRIES`, though it is judged by the same `checkSlicePlan` | ≥ 42 KB with #538 | argv; throws over 128 KB |
| 03 To-Tickets: repair | default | `to-tickets/repair/prompt.md` 0.8 KB | `REFUSAL` (resumes the stage session, `to-tickets.ts:69`) | small | argv |
| 04 Acceptance: author | Sonnet 5 | `acceptance/author/prompt.md` 3.6 KB | `ISSUE_BODY`, `PRD_BODY` (the whole parent spec), `CRITERIA`, `CLAIMED_FILES` (**paths only**), `TARGET_TESTS`, `CHECK_CONTRACT`, `HOUSE_RULES` 1.5 KB, `PRIOR_ATTEMPTS`, example paths (`acceptance/acceptance.ts:259-274`) | #628 run `35169674070`: first turn 38.7k tokens, 19 turns, $0.61. #629 run `35172769078`: 40.1k, 24 turns, $0.69. `PRD_BODY` for both = #538, 13.4 KB | **none**; stdin |
| 04 Acceptance: repair | Sonnet 5 | `acceptance/author/repair.md` 0.9 KB | `JUDGEMENT` | small | stdin |
| 05 Implement: implementer | Sonnet 5 | `implement/implementer/prompt.md` 7.2 KB | `BRIEF` (`implement/brief.ts:76-106`): style rules and check contract, ticket, comments, seam lines, **module `CONTEXT.md`** (always the root 16.5 KB, see below), standards section, failing test files, claimed-file contents, cited ADRs/files, ≤40 nearby paths | #628 run `35170021718`: first turn 52.0k tokens; brief ≈ 49 KB (estimate: 16.5 context + 5.2 standards + 14.3 claimed + 6.2 failing test + 1.5 ticket and comments + ~5 other). #629 run `35173142977`: 55.5k tokens; brief ≈ 59 KB (18.8 claimed + 9.1 failing tests + 4.6 ticket and comments + same fixed parts) | claimed + cited ≤ 150 KB total, ≤ 40 KB per file, comments ≤ 30 KB, oldest dropped (`brief.ts:37-39`, `:62-73`, `:176-185`). **Uncapped:** ticket body, `CONTEXT.md`, standards, failing test contents |
| 05 Implement: repair | Sonnet 5 | `implementer/repair.md` 1.3 KB | `GATE_OUTPUT` tail (`implement.ts:108`) | ≤ 12,000 chars | tail cap `shared/run-gauntlet.ts:35` |
| 05 Implement: fresh-eyes | Opus 5 | `implementer/fresh-eyes.md` 4.7 KB | `BRIEF` (same as above), `ATTEMPT` = prior summaries + raw `git diff` + untracked list (`implement.ts:276`, `shared/changed-paths.ts:23-28`), `GATE_OUTPUT` tail (`implement.ts:126`) | brief 50–60 KB + a diff: #530's diff is 195 KB, so ≈ 250–260 KB, or ≈ 440 KB near the brief's 150 KB file ceiling (charting estimate) | diff **uncapped**; gate tail 12 KB; stdin |
| 05 Mechanic | Opus 5 | `mechanic/prompt.md` 3.7 KB | ticket, **every comment** (`mechanic/mechanic.ts:103,114`), dead-run log tails, standards, "Where things are" (`:120-123`) | #132: 51 comments, 280 KB of comment text | comments **uncapped**; stdin. No mechanic run in the history |
| 05 Mechanic: repair | Opus 5 | `implementer/repair.md` | `GATE_OUTPUT` tail | ≤ 12 KB | tail cap |
| 07 Review: correctness reviewer | Opus 5 | `review/correctness-reviewer/prompt.md` 2.2 KB | `DIFF` = `git diff base...head` (`review/review.ts:148`) | 18 runs: first turn 25.9k–47.9k tokens, 9–36 turns, $0.64–$2.84. PR #645 (42.7 KB diff): 44.7k tokens. PR #644 (10.9 KB): 30.2k. PR #634's 224 KB diff had no review run in the window | **uncapped**; stdin |
| 07 Review: refuter (per finding) | Sonnet 5 | `review/refuter/prompt.md` 1.6 KB | `FINDING`, the **same `DIFF` again** (`review/refuter.ts:29-30`) | one diff per finding. No refuter stream in the 18 runs (no findings) | uncapped; stdin |
| 07 Fixer | Sonnet 5 | `fixer/prompt.md` 2.1 KB | failing test names and messages, prior attempt summaries (`fixer/fixer.ts:61-78`) | small; last run `34768343885` (09-13), artifacts gone | none; stdin |
| Ratify | Opus | `ratify/prompt.md` 6.7 KB | `STANDARDS`, `LENS`, `FINDING`, `SITES`, `BATCH` (`ratify/ratifier.ts:34-38`) | last run 09-12, artifacts gone | none; stdin |
| Audit: violation / proposed / grammar lenses | Sonnet | built in code (`observations/lenses/*.ts`) | standards + session-range diff + spine (`observations/auditor.ts:39-40`) | last run 09-09, artifacts gone | **no `stage.ts`, no cap**; but no tools, no settings, no slash commands (`auditor.ts:18-29`), so no ~24k baseline |

Lanes 04 Dispatch reconcile, 06 Verify and 08 Integrate are wire lanes: they run no model.

### Owner-session paths (the two doors)

| Path | What is read | Size on real work | Budget |
|---|---|---|---|
| Before the first message | `~/.claude/CLAUDE.md` (2.0 KB) and project `CLAUDE.md` (1.8 KB); skill listing (12.5 KB / 36 skills in `51a01c73`, 43 in `9e0cb2ab`, including `load-calc`, `gmaps-save`, `pdf-to-image`, `dataviz` at 1.4 KB alone); system prompt (≈15 KB, `prompt_snapshot`); agent listing (3.0 KB); deferred-tool names (2.2 KB); session brief via `SessionStart` → `dispatch.py` → `session-brief.py` (1.4–1.8 KB) | first-turn usage 28.0k–41.9k tokens across the 40 newest sessions (for example `51a01c73` 36.5k, `9e0cb2ab` 35.9k, `4af6f9ae` 28.0k) | brief capped at 30 lines (`session-brief.py:30`); nothing else capped. `CLAUDE.md` well under the documented 200-line target |
| Spec door: `/to-spec` | `to-spec/SKILL.md` 6.8 KB (hidden from the listing: `disable-model-invocation`). It says the tracker and label vocabulary "should have been provided … via this repo's `CLAUDE.md` under `## Agent skills`" (`SKILL.md:9`), but that section only points at `docs/agents/`. So the session also needs `issue-tracker.md` 11.0 KB, `pipeline-labels.md` 9.7 KB and `spec-format.md` 8.8 KB (`SKILL.md:44-46`) | ≈ 36 KB of docs if the session follows every pointer. Observed `/to-spec` sessions are older (latest `e1907add`, 2026-08-30). In `baa283dc` the session read only a `CONTEXT.md` heading grep and `head -60` of `ticket-format.md` before `file-issue spec` | none |
| Ticket door: "file that" | `docs/agents/ticket-format.md` 7.7 KB; `~/bin/file-issue --help` 5.9 KB; often `issue-tracker.md` 11.0 KB | `ca7a2c5c`: read `ticket-format.md` 3 times (calls 1, 20, 21) and `--help` once, and 3 of 4 filings came back with warnings (unparseable `check:` marker, claimed path not in tree). `b0e6a7c9` referenced `ticket-format.md` 11 times, `ab4481cf` and `801f09b6` 8 each. Over the 60 newest sessions, 47 main-thread `file-issue` filings, 1 hard refusal (`51a01c73`: a glob in `## Files claimed`) | none |

## Where agents got lost

Each case names the run or session, what happened, and the signpost that was missing.

| # | Where | What happened | Missing signpost |
|---|---|---|---|
| 1 | Out-of-brief counter #588 (2026-09-15 → 17, 395 comments, 196 distinct paths) | Top self-reported reads are the Tracker port: `shared/tracker-gh.ts` 19, `tracker.ts` 17, `tracker-memory.ts` 17, `gh.fake.ts` 16, `gh.ts` 15, `gh-paths.ts` 12, `tracker.test.ts` 11. By module, `.Workflow/agent-workflows/shared` has 205 of 395. #628's implementer alone reported 24 paths (comments 01:54–01:56Z), against a 871-byte ticket claiming 3 files | The tickets sliced from #538 claim only the files they edit. The port they migrate onto is neither claimed nor cited by path, so `gatherBriefContext` never inlines it (`implement/brief.ts:186-200`). Nothing names "the interface this slice consumes" |
| 2 | Counter #243 (2026-08-29 → 09-14, 540 comments, 330 paths) | Top: `.claude/contract.json` 10, `bin/gauntlet` 8, `.claude/hooks/_hook.py` 8, `implement/implement.ts` 8. By module: `shared` 135, `.claude/hooks` 97, `tests/acceptance` 47, `docs/adr` 33 | Check-contract and hook-harness mechanics are read over and over. The brief carries the contract table, but not how `bin/gauntlet` and the hook harness run |
| 3 | The counter itself forked | #243 stayed open, yet #588 was created and every read since lands there. `findTracker` lists only the newest 200 issues (`implement/out-of-brief.ts:54`); by #588 the repo had passed 200 issues since #243. Both bodies carry the same marker. Each record also re-reads every comment (`:61`), now 395 | The counter has no fixed address: it is found by scanning a window, not by number or label |
| 4 | Stage-to-stage rediscovery, #628 | Acceptance author (run `35169674070`) read `tracker.ts`, `tracker-memory.ts`, `gh.fake.ts`, `stub-gh.fixture.ts`, `gh.fake.test.ts`, `tracker-gh.ts`. Implementer (run `35170021718`) read `gh.fake.ts` twice, `tracker-memory.ts`, `stub-gh.fixture.ts`, `gh.fake.test.ts`, and ran `grep "\["api"'`, `grep "createFakeGh"`, `grep "subIssuesBy…"`. Reviewer (run `35172721267`) `cat`ed `tracker-memory.ts`, `gh.fake.ts`, `stub-gh.fixture.ts`, then `grep "createFakeGh"` again | No stage hands its map of the code to the next. Acceptance's reads reach implement only as a test file. Review gets only the diff |
| 5 | Implementer re-reads what the brief inlined, #629 run `35173142977` | Claimed files `gh-paths.ts`, `gh-paths.test.ts`, `gh-cli.stub.ts` and `audit-and-publish-cli.proc.test.ts` were inlined, then each was `Read` again before `Write`/`Edit` (`gh-paths.ts` 3 times). The prompt says "open a file a second time only when you changed it" (`implementer/prompt.md:18-20`). Claude Code docs say newer models can edit an unread file (https://code.claude.com/docs/en/tools-reference), so the re-reads are not forced by the tool | Unclear to the agent whether the inlined copy is current enough to edit from. The failing test files are also inlined twice, as claimed files and as tests to turn on (`brief.ts:97-100` and `:190-193`; the failing-test set only filters `nearby`, `:203-208`) |
| 6 | Implementer edits outside its claim, #629 | Edited 5 unclaimed files (`tracker-gh.ts`, `integrate-harness.fixture.ts`, `run-watchdog.test.ts`, `bypass.test.ts`, `walk-home.test.ts`), found by grepping for `PathMatcher` importers | The ticket named the files to delete matchers from, not their importers. The brief's `nearby` list only matches claimed basenames in file text (`brief.ts:210-213`) |
| 7 | To-tickets slice, run `35133339528` (#538) | Seam sweep and slice each opened with `gh issue view 538` (13.4 KB, fetched twice, a third time planned for audit). Slice re-ran `grep -rl '"api"'` 3 times after the sweep had run the same grep. It then briefed a subagent that "the actual working checkout is the parent of `target/` … NOT under `target/`" and read the lane's own checkout. It found a stale `checkpoints/audit-and-publish.json` from an earlier run (09-13) and spent a second subagent verifying it. The run died: `slice 7 … names "map-gh.fixture.ts", "sheet-gh.fixture.ts" without saying rooted where` | (a) The runner passes only `ISSUE_NUMBER` (`to-tickets.ts:148,155,196`), not the spec body. (b) The seam manifest carries seams, not the call-site list the sweep found. (c) No "Where things are" block: the mechanic has one (`mechanic/mechanic.ts:120-123`), to-tickets does not, and the slice prompt names its references with repo-relative paths (`slice/prompt.md:23-26`). (d) Nothing says a leftover checkpoint is not this run's. (e) The rooting rule is stated in full at `slice/prompt.md:41`, yet the agent built its plan with ad-hoc Python (`P = ".Workflow/agent-workflows/"` prefixing some paths) and left bare names in slice prose. `shared/render-body.ts:127` rejects those. The artifact holds only two stream files, which suggests the repair prompt (`repair/prompt.md:7`, which names this exact refusal) never ran; I did not confirm this from the log, because the API rate limit was hit. `output-contract.md` also points at a literal `{{TICKET_FORMAT}}`, which the agent sees unsubstituted when it `cat`s the file |
| 8 | Acceptance author told two things, run `35172769078` | The injected contract lead says "You cannot run them: you have no tools but the one you answer through" (`shared/house-style.ts:21-25`, rendered at `acceptance/author/prompt.md:57`). The same prompt says "Read whatever you need in the checkout. Run only your own test files" (`:44`). The author ran 12 Bash (including `npx vitest run`, `npx eslint`), 5 Read, 5 Edit, and `git log --all \| grep -iE "acceptance\|author"` looking for precedent | One stale sentence left over from the no-toolbelt era (ADR-0098, now superseded via ADR-0128 → ADR-0159) |
| 9 | Owner session, `51a01c73` ("Trace out why gh 538 to-spec didnt work") | Filing refused: `'## Files claimed' names …widened*, which is a glob rather than a path` | The rule is in `ticket-format.md` ("One file per line. A glob is r…", diffed in `83eb089b`). Sessions still write globs, because the door's pointer to the format doc is on demand and the session did not open it first |
| 10 | Owner session, `ca7a2c5c` (ticket door) | `ticket-format.md` read 3 times; 3 of 4 filings warned (a `check:` marker that doesn't parse; claimed paths "not found in the working tree" for files the ticket creates) | The format doc is re-read instead of the filer returning a worked example. A new-file claim has no sanctioned spelling at filing time |
| 11 | Owner sessions reading deleted docs | `feed0516` referenced `docs/agents/reconcile-lane-edges.md` 14 times; `465b1d60` referenced `review-lane-edges.md` 8 and `to-tickets-lane-edges.md` 7. None of the `*-lane-edges.md` files exist at `8587d4f`; #243 still counts `docs/agents/reconcile-lane-edges.md` | These sessions predate the deletion. At `8587d4f`, `lane-map.md` is the one lane pointer, and it shows **0 runs** for 04 Acceptance and 05 Implement (`docs/agents/lane-map.md` Lanes table), while `gh run list` shows 13 of each among the last 200 runs. I did not verify why the generated counts disagree |

## Navigation aids today

| Aid | Size | Loaded how | Notes |
|---|---|---|---|
| `CLAUDE.md` (project) | 1.8 KB, 231 words | always, owner sessions and every lane stage (cwd is the target checkout) | points to `docs/agents/`, `contract.json`, `lane-map.md` |
| `~/.claude/CLAUDE.md` | 2.0 KB | always, owner sessions | personal; tools list |
| `CONTEXT.md` | 16.5 KB, 2,631 words, 292 lines | on demand in sessions. Inlined into every implement brief (`implement/implement.ts:72-82` falls back to root) and every shaper prompt | the only `CONTEXT.md` in the tree: `moduleContextPath` looks for module files that do not exist |
| `docs/agents/*.md` (10 files) | 92.9 KB, 13,020 words total; `lane-map.md` 28.4 KB, `issue-tracker.md` 11.0, `enrolment.md` 10.7, `pipeline-labels.md` 9.7, `spec-format.md` 8.8, `ticket-format.md` 7.7, `clone-gate.md` 7.0, `venues.md` 5.4, `module-boundaries.md` 2.1, `domain.md` 2.0 | on demand. `ticket-format.md` injected into slice; `spec-format.md` into spec author and reconcile | `domain.md` still describes a single-context layout |
| `docs/adr/INDEX.md` | 27.5 KB, 217 lines | on demand | 201 ADR files, 259 KB total |
| `docs/agents/lane-map.md` | 28.4 KB | on demand; generated by `npm run lane-map` | run counts disagree with `gh run list` (case 11) |
| `.Workflow/agent-workflows/to-tickets/vocabulary.md` | 2.7 KB (entries below `---`) | injected into all three to-tickets stages | a lane-local glossary beside `CONTEXT.md` |
| `CODING_STANDARDS.md` | 5.2 KB | standards section injected into implement, mechanic, shaper, ratify, lenses | |

### Against first-party guidance

- **Smallest high-signal context.** Anthropic: "find the smallest possible set of high-signal
  tokens that maximize the likelihood of some desired outcome", and context suffers "context
  rot" as it grows
  (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
  - The 24k baseline per lane stage is tool definitions and skill metadata the stage never uses.
    No lane stream used `Workflow`, `Cron*`, `DesignSync` or `RemoteTrigger`.
  - The owner-session skill listing carries 36–43 skills, most unrelated to this repo.
- **Hybrid loading.** The same post describes Claude Code's hybrid: "CLAUDE.md files are naively
  dropped into context up front, while primitives like glob and grep allow it to navigate its
  environment and retrieve files just-in-time." The lanes do the opposite for large reference:
  - the root `CONTEXT.md` is pre-loaded into every brief;
  - the shape reading list is inlined in full;
  - the review diff is inlined whole, and the refuter gets it again per finding.

  Meanwhile the facts an agent does need (the port a migration consumes, the checkout layout)
  are left for it to find.
- **Subagent summaries.** The same post says subagents explore at length but return "a
  condensed, distilled summary of its work (often 1,000-2,000 tokens)". No lane stage hands such
  a summary to the next stage (cases 4 and 7).
- **Skills.** "At startup, only the metadata (name and description) from all Skills is
  pre-loaded"; keep SKILL.md under 500 lines; "Keep references one level deep"
  (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices). The slice
  prompt → `output-contract.md` → `{{TICKET_FORMAT}}` in `slice/prompt.md` is a two-hop reference
  that reads as a literal placeholder (case 7e).
- **CLAUDE.md.** Target "under 200 lines per CLAUDE.md file"; subdirectory `CLAUDE.md` files and
  path-scoped `.claude/rules/` "load on demand when Claude reads files in those directories"
  (https://code.claude.com/docs/en/memory). That is a first-party way to get per-module context
  without inlining the root glossary, and the repo uses neither.
- **Consistency.** "if two rules contradict each other, Claude may pick one arbitrarily" (same
  page). Case 8 is exactly that.
- **The repo's own `writing-for-agents` skill** names the same levers:
  - context load vs pointer wording;
  - progressive disclosure by branch;
  - a single source of truth, with the environment treated as a cache.

## Candidates

Facts-backed options for the Context ruling, not recommendations.

1. **Byte budgets on uncapped injections**, following the implement brief's pattern (drop
   oldest, or name what was left out):
   - review and refuter `DIFF`;
   - fresh-eyes `ATTEMPT`;
   - mechanic comments (#132: 280 KB);
   - shape `READING_LIST`;
   - spec `RULINGS`;
   - acceptance `PRD_BODY`;
   - to-tickets `PLAN`.
2. **A ratchet on prompt size**: a test that sums the 27 prompt files (12,792 words today) and
   fails on growth, like `gate-size.test.ts` does for gate lines.
3. **Shrink the per-stage baseline**: pass `--tools`/`--allowedTools` and
   `--disable-slash-commands`/`--setting-sources` to review, refuter, acceptance and to-tickets,
   as `auditor.ts:18-29` already does. Measure first-turn tokens before and after.
4. **Pass the spec body once**: lane 03 injects the body instead of three `gh issue view` calls,
   and gives audit the slicer's `TICKET_FORMAT` and `SEAM_MANIFEST`.
5. **Carry exploration forward**: the seam sweep emits its call-site list; the acceptance author
   emits the files it read; review gets the implementer's summary and declared reads.
6. **Name consumed interfaces in tickets**: a "Seams consumed" or cited path for the port a slice
   migrates onto, so the brief inlines it (case 1's top 7 paths).
7. **Module context instead of the root glossary**: module `CONTEXT.md` or path-scoped
   `.claude/rules/` files, so `moduleContextPath` stops falling back to 16.5 KB for every
   ticket.
8. **De-duplicate the implement brief**: drop failing-test files already inlined as claimed.
   Find out why inlined claimed files are still re-read before editing.
9. **"Where things are" for every checkout-bound stage**: target vs machine checkout, and whether
   a checkpoint belongs to this run (case 7).
10. **Fix the out-of-brief tracker address**: find it by label or number, not a 200-issue window
    (`out-of-brief.ts:54`), and fold #243 into #588. Record measured reads from the stream
    instead of the agent's self-report.
11. **Remove the "you have no tools" lead** from the acceptance contract (`house-style.ts:21-25`).
12. **Owner-session listing**: scope personal skills (`load-calc`, `gmaps-save`, `pdf-to-image`, …)
    out of this repo's sessions. Make `/to-spec`'s claim about `CLAUDE.md` true, or point it
    straight at the three docs.
13. **A repair round for unrooted prose paths**: check whether the slice plan's rooting refusal
    reaches `refusalOf` and the one repair round, or is thrown from `validate` first (case 7e).

## Charting evidence re-checked at `8587d4f`

- `substitute` at `shared/stage.ts:265` (definition `:409`); 128 KB argv check `:23`, `:294-299`:
  **confirmed**.
- Implement brief budgets `implement/brief.ts:37-39`: **confirmed**.
- Review diff at `review.ts:148`, uncapped; refuter re-sends the diff; mechanic every comment
  (#132 = 280,132 bytes of comments); lenses bypass `stage.ts` (`auditor.ts:33`): **confirmed**.
  #530's diff measures 194,530 bytes.
- 27 prompt files, about 12,800 words: **confirmed** (12,792).
- Lane 03 passes only an issue number (`to-tickets.ts:148,155,196`): **confirmed**. The prompts
  fetch the spec at `seam-sweep/prompt.md:14`, `slice/prompt.md:30`, `audit/prompt.md:22`.
- The implementer is not told which files other live runs hold (`dispatch/reconcile.ts:602-606`
  vs `brief.ts:76-106`): **confirmed**.
- "ADR-0098 says the acceptance author sees the contents of claimed files; the code passes only
  paths": **needs correction**. ADR-0098 is `status: superseded` (→ ADR-0128 → ADR-0159). The code
  does pass paths only (`acceptance.ts:267`), but the live contradiction is the "no tools"
  sentence (case 8).

## Could not verify

- The breakdown of the ~24k-token lane baseline between system prompt, tool definitions and
  skill listing: only totals are in the stream.
- Brief byte sizes for #628/#629 are estimates from their parts; the rendered brief is not
  uploaded.
- Shape, spec, fixer, ratify, mechanic and lens stages: no stream artifacts within the 14-day
  retention (or no runs), so no first-turn or turn counts.
- `/to-spec` sessions are all from 2026-08-22 → 08-30, before `spec-format.md` and several lanes
  changed.
- Why `lane-map.md` shows 0 Implement/Acceptance runs.
- Subagent (sidechain) transcripts in owner sessions were not analysed; only main threads.
