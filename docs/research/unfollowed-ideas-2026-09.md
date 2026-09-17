# Good ideas from workflow sessions that were never followed up

Researches: #657

Map #646, feeding the **Charter** and, through it, the five rulings. Written 2026-09-17. Fates were
checked against trunk `3c34748`. Facts and candidates only, no rulings.

Session ids below are the first eight characters of the full id. They match the Knowledge-Base
archive file names (`raw/sessions/<date>-<id8>.md`) and the raw transcripts
(`~/.claude/projects/<project>/<id8>*.jsonl`). "Owner" means the owner raised the idea; "Claude" means
a Claude session did, including Claude text the owner pasted in from another session without
taking it up.

## Summary

- **About 140 candidates came out of 1,369 sessions.** After merging duplicates across slices:
  - 28 numbered entries plus 30 smaller rows are still relevant and not carried anywhere. Several
    numbered entries group related ideas.
  - 14 are still relevant but already held on map #646 or in its research notes.
  - 36 were overtaken. Most ideas raised in these sessions were built within days.
  The ones below are what was left.
- **The most common way an idea got lost** was that it was offered at the end of a turn, or as one
  item in a list, and the owner's next message answered a different item. The next most common
  were: the instance was fixed by hand and the class was never filed; the machine the idea
  targeted was retired before anyone built it; and the idea was deferred behind a trigger or
  ticket that never came.
- **Highest leverage among the unheld ideas:**
  - Review findings fork on severity, so trivial ones get fixed in the branch (the ticket's seed
    example). Today no review finding gets fixed.
  - Tests a filing session already wrote skip the acceptance run.
  - Server-side required checks. Branch protection was declined on cost while the repo was
    private. The repo is now public and `main` is still unprotected.
  - Moving the watchdog sweeps off `session-captured`. Five workflow files still trigger on it.
  - A per-ticket clock.
  - A standing rule that a check counts only once it has failed on a known-bad case. Two live
    instances were confirmed for this note: a name-filtered `vitest -t` check exits 0 when no test
    matches, and the implementer's immutable set still leaves `package.json`, `bin/gauntlet`,
    `.husky/` and `.claude/contract.json` editable.
  - Brakes on how rules and mechanisms get added. Several different sessions proposed one, none
    was built, and #308 is open and untouched.
- **One of the ticket's two seed examples is misattributed.** Sandcastle's closed-spec gate
  (its ADR-0019) did ship in era 5. The fix that was specified and never shipped was era 2's
  PostToolUse patch for the ExitPlanMode-only plan gate. That fix is overtaken, since plan-file
  slicing is gone. The other seed (port "trivial findings self-fix") is confirmed and is the first
  entry below.
- **The corpus has a hole where era 5 should be.** No workflow-family session in the archive is
  dated June 2026, which is Sandcastle's whole life (Jun 8 to Jul 2). Era 5 ideas reach this note
  only through later sessions and the eras narrative.

## How the corpus was read

**Sources.**
- The Knowledge-Base archive gave 1,256 workflow-family sessions, from 2026-04-13 to 2026-09-09.
- The raw Workflow and agents-skills transcripts gave 113 more interactive sessions the archive
  lacks, up to 2026-09-17. Headless `sdk-cli` runs were excluded.
- Projects: Workflow (375), Lumaria (208), Crewops (182), General (130), Knowledge-Base (130),
  agents-skills (90), Claude-Cockpit (84), `~/.agents/skills` (80), General-Repo (54) and
  Planning-System (36). Planning-System is not on the ticket's list, but it is era 4's own repo, so
  it was included.
- By month: April 392, May 168, June 0, July 78, August 475, September 256.
- The eras narrative (`git show 26df9fa:artifacts/seven-workflow-eras.html`) was read in full.

**Extraction.** A script split every session into owner text and Claude text.
- **Archive format 2:** `**User**` and `**Assistant**` blocks.
- **Older format:** the `## User Prompts` list and `## Key Insights`. This format cuts each owner
  message at about 200 characters, so readers of the April and May slices read Claude's side of a
  session wherever an owner idea was cut off.
- **Raw transcripts:** text blocks on the main thread only, with sidechains dropped.
- **Machine text in the user slot** was moved to Claude's side: compaction summaries, task
  notifications, skill bodies and subagent reports.
- **Sizes:** 1.33 MB of owner text and 11.7 MB of Claude text. The owner figure is larger than the
  ticket's estimate because it includes material the owner pasted from other sessions.

**Readers.** Seven subagents each took one slice. Each read that slice's owner file **in full**
and **searched** its Claude file, reading 20 to 340 lines around the promising hits.

| Slice | Sessions | Owner text | Claude text | Claude side |
|---|---|---|---|---|
| Apr–May: General, Planning-System, Claude-Cockpit | 250 | 186 KB, read in full | 1.17 MB | 457 marker hits listed; ~35 sessions read closely |
| Apr–May: Knowledge-Base, Crewops | 310 | 245 KB, read in full | 1.60 MB | ~900 hits listed; ~150 read as snippets, ~35 read in context |
| Jul–Aug: agents-skills, `~/.agents/skills`, Lumaria, General-Repo | 383 | 230 KB, read in full | 3.73 MB | ~45 regions of 40–250 lines across ~30 sessions |
| Workflow, Aug 21–31 | 170 | 184 KB, read in full | 2.07 MB | ~40 regions of 20–340 lines |
| Workflow, Sep 1–9 | 108 | 139 KB, read in full | 1.45 MB | ~80 hits read in context, plus 14 closing reports whole |
| Sep: `~/.agents/skills`, Lumaria, General-Repo | 51 | 207 KB, read in full | 0.48 MB | whole Claude side of every workflow session read |
| Workflow, Sep 10–17 | 97 | 176 KB, read in full | 1.30 MB | ~110 of 502 hits in context, plus long stretches and all 09-16 sessions whole |

**Markers.** Claude's side was searched for `worth`, `we could`, `consider`, `follow-up`,
`out of scope`, `later`, `a better approach`, `not pursued`, `park`, `defer`, `next step`,
`recommend`, `would be better`, `should also`, `separately`, `not filed`, `future`, `TODO` and
`open question`. Readers added phrases that proved productive in their slice, such as `not filed`,
`worth a ticket`, `never built`, `nothing tracks` and `revisit`. On the owner side, `what if`,
`I want`, `we should`, `remind me` and `can we` were checked while reading.

**What was skipped.**
- Personal, household, vehicle, shopping and business sessions were read past, and nothing from
  them is used. About two thirds of General was this kind of material.
- Product work (CRM screens, design-system atoms, UI polish) was skipped unless it carried a
  workflow idea.
- The Claude side of this research run was skipped, and so was most of the Claude side of the
  session that drafted map #646, since its ideas are the map's own.

**Fate checks.** Each reader checked each candidate before keeping it:
- `gh issue list --state all --search` on claude-workflow and agent-skills, with two or three
  phrasings (plus sandcastle and Planning-System for their eras);
- `git log --all --grep`;
- the ADR bodies and `docs/adr/INDEX.md`;
- the code named in the idea.

I then re-checked twelve load-bearing fates on trunk `3c34748` myself (listed under **Not
verified**).

## Still relevant, ranked by likely leverage

Each entry gives the idea, who raised it, where, what happened to it, why it stalled, and why it
still matters. The ranking weighs how many runs or merges the idea touches today and whether it
removes an owner stop. It is a reader's estimate, not a measurement.

### High leverage

**1. Review findings fork on severity: trivial ones are fixed in the branch, behavioural ones keep the loop.**
- **Raised by:** Claude, in the eras narrative (63b657cd, agents-skills, 2026-08-21; the copy in
  this repo arrived via e7c7648e). It ports Sandcastle's `docs/adr/0024-review-severity-fork.md`.
  The owner asked the same question on 2026-05-12 (532ad023, Knowledge-Base): "Why do we defer
  items like that instead of fix?" Claude answered, "Deferral becomes a graveyard."
- **Response:** none on the port. The 05-12 instance was fixed by hand.
- **Fate:** no trace. The era 6 checker it targeted was deleted a week later (agent-skills #160).
  Today, Review files each finding as a `lane-07-finding` issue. The fixer lane wakes only on a red
  Verify. ADR-0196 limits machine repair to fixes that are uniquely determined, but sets no rule
  by finding size.
- **Why stalled:** a single line in an artifact, and its target was retired.
- **Still relevant:** yes. #652 (`docs/research/merge-quality-2026-09.md`) found that Review's
  26 findings were dropped by a filter, and that nearly all of them still stand on trunk.

**2. A follow-up with no home blocks the close.**
- **Raised by:** Claude (65c0d9c8, Knowledge-Base, 2026-04-23). It proposed that closing a plan be
  refused while its Follow-ups section names items that have no ticket.
- **Response:** the owner moved on. Two sessions later, one plan's follow-ups were copied into the
  backlog by hand.
- **Fate:** no trace. The only analogue today is wayfinder's out-of-scope disposition, which
  covers maps only.
- **Why stalled:** no option was chosen. The hand copy hid the gap.
- **Still relevant:** yes. Neither closing records nor PRs have a guard against homeless
  follow-ups. #652's dropped findings and this ticket's own premise are the same leak.

**3. Tests written by the filing session skip the acceptance run.**
- **Raised by:** the owner, sharpened by Claude (bc4dc71f, Workflow, 2026-09-16): "should [it]
  have skipped straight to implement?"
- **Response:** Claude offered two tickets. The owner took a different fix by hand.
- **Fate:** no trace. `bin/file-issue --test` commits the tests on the current branch. But
  `dispatch/ticket-state.ts` `stageOf` picks `needs-test` or `needs-build` only by whether an
  `accept/issue-N` branch exists (confirmed on trunk). So a ticket whose tests were handed over
  still pays for an acceptance run. ADR-0191's one-writer rule is what stops a session from
  pushing to that branch.
- **Why stalled:** the session pivoted to a stalled run's logging.
- **Still relevant:** yes. It sits on the ticket door, and acceptance was the slow stage in
  #649's data.

**4. A server-side pre-merge gate (required checks), now that it costs nothing.**
- **Raised by:** Claude. The eras narrative (e7c7648e, 2026-08-21) called restoring the gate the
  one unambiguous regression. On 2026-08-27 (d7d532bd, e56fe7bc) Claude said: "Branch protection
  is free on public repos. Half that ruling's basis dissolved."
- **Response:** declined on 08-26 while the repo was private (ADR-0071). After the repo went
  public, the point was only parked in #134's Out of Scope.
- **Fate:** rejected on a premise that no longer holds, and never re-ruled. #414 was closed on
  09-11 citing ADR-0071 unchanged. Confirmed on trunk: the repo is public, and `main` returns
  "Branch not protected". #653 found required checks and auto-merge available but unused.
- **Why stalled:** the ruling was framed as a cost call, and its counter was silenced.
- **Still relevant:** yes. #649 counts 265 direct pushes to main, and #652 traced 69 deleted tests
  to acceptance pushes to main. The Lanes ruling may still choose another shape.

**5. Watchdog sweeps fire when runs end, not when the owner ends a session.**
- **Raised by:** Claude (f15e55ef, Workflow, 2026-08-31, "rec D"). Earlier the owner asked for a
  daily sweep "that finds failures from like outages" (b8283522, 08-26). Separately, on 04-29
  (9da6d33d, Knowledge-Base), Claude found a capture hook had been silently dead for 17 days and
  asked for telemetry "on all firings".
- **Response:** Claude listed it as "not filed", and the red-run lane offered beside it was built
  instead. The owner's daily sweep was answered by ADR-0004 (a clock may not originate work).
- **Fate:** partly built. ADR-0177 and ADR-0179 moved some rings. Confirmed on trunk:
  `audit-caller.yml`, `dispatch-reconcile-caller.yml`, `dispatch-reconcile.yml`,
  `run-watchdog-caller.yml` and `walk-home.yml` still trigger on `session-captured`. The periodic
  "slow floor" variant (31ab1e12, 09-14) was deferred by the owner and is held in #653's notes.
- **Why stalled:** it was dropped from a build night.
- **Still relevant:** yes. #646 records that capture stopped on 09-09 and left Audit, Run watchdog
  and Walk home dead unseen. The map holds the evidence; this trigger move is one candidate fix.

**6. A per-ticket clock.**
- **Raised by:** Claude (e7c7648e, eras narrative, 2026-08-21): "Two timestamps — first agent
  action, merged … It's a few lines."
- **Response:** none.
- **Fate:** no trace. Filing-to-merged has been measured once, by hand, in #649.
- **Why stalled:** it was aimed at `/drain`, which was replaced the next week.
- **Still relevant:** yes. "Filing-to-merged gets faster" is one of #646's ruling criteria, and
  nothing records it per ticket.

**7. Machinery share as a standing number, and "a new mechanism retires one".**
- **Raised by:** Claude (e7c7648e, 08-21, "Watch F2"; d5ad36cd, 08-28/29): "26 sessions, and
  almost every one proposed a new gate, counter, or ADR."
- **Response:** folded into #226. When #226 closed, the idea was filed as #308.
- **Fate:** ticketed. #308 is OPEN with no activity. The number's only home was deleted in
  `c97bd8e`.
- **Why stalled:** ADR-0064 treats a number with no action as sizing only, and the rule half had
  no event to hang on.
- **Still relevant:** yes. It answers the Charter's "what keeps it from sprawling".

**8. A check counts only once it has failed on a known-bad case.**
- **Raised by:** Claude (b23753a6, Planning-System, 2026-04-15): "Until the gate refuses something
  real, 'the gate works' is unproven." The owner and Claude raised it again in 8666d3e7
  (2026-04-27) and 38560631 (2026-05-15), after a warn mode had logged nothing for days and a
  checker exited 0 while logging violations.
- **Response:** each case was fixed locally.
- **Fate:** partly built. ADR-0124 re-proves a lint rule against the pre-fix tree, and canary fires
  prove a lane starts. No standing known-bad case exists per gate. #533 found a review refusal that
  had never run, and #646 records Review's filter dropping every finding and Verify judging trunk.
- **Why stalled:** each fix stayed inside the tool that was hit.
- **Still relevant:** yes. Three concrete live instances follow as 8a to 8c.

**8a. Name-filtered check markers pass when no test matches.**
- **Raised by:** Claude (ab4481cf, Workflow, 2026-09-16).
- **Response:** folded into a proposal that Claude itself withdrew.
- **Fate:** no trace. Confirmed for this note: `npx vitest run <file> -t "<no such name>"` exits 0
  with every test skipped, and neither `vitest.config.ts` nor `package.json` sets a zero-match
  guard.
- **Still relevant:** yes. `close-ticket` trusts exit status.

**8b. An implementer can edit its own gate files.**
- **Raised by:** Claude (097dabea, Workflow, 2026-09-04).
- **Response:** not picked up.
- **Fate:** no trace. Confirmed on trunk: `shared/immutable-set.json` is still
  `["vitest.config.ts", ".github/"]`.
- **Still relevant:** yes. The implement lane judges the tree its model edited.

**8c. A guard against weakened tests.**
- **Raised by:** Claude drafted it; the owner ran it in an overnight agent team (0b096bef,
  Claude-Cockpit, 2026-04-14). The guard catches `.skip`/`.only`, `eslint-disable`, `@ts-ignore`
  and dropped tests. It caught a lint regression that night.
- **Response:** it lived only in that one prompt.
- **Fate:** no trace. `eslint.config.js` has no focused- or skipped-test rule (grep). Only the one
  lane behind #652's 69 deleted tests was fenced (`9279b93`).
- **Still relevant:** yes.

**9. A machine change needs a green canary proof before it can be pushed.**
- **Raised by:** the owner raised the need; Claude designed it (15485239, Workflow, 2026-09-03).
  The owner said "Prose doesnt work." Claude said: "the push venue refuses a `main` push that
  touches machine paths unless a canary green exists for that head SHA."
- **Response:** the owner chose to keep iterating on the canary itself.
- **Fate:** no trace in `bin/gauntlet`, `.husky/` or `docs/agents/venues.md`. Commit `7944826`
  (09-14) records "the acceptance overhaul shipped unproven".
- **Why stalled:** the "next ticket" was never filed.
- **Still relevant:** partly. Machine changes still land unproven, but the Lanes ruling may shrink
  what a canary has to prove.

**10. An audit's findings get a second agent's check, and every number carries its command.**
- **Raised by:** Claude (0c547409, `~/.agents/skills`, 2026-09-05), after hand-grading an
  `/audit-doc` run that had circular evidence and a ranking turned upside down: "Every numeric or
  field claim in a report carries the command that produced it … findings get an adversarial
  verify pass by a second agent before they reach you."
- **Response:** the thread moved to hook logs.
- **Fate:** no trace. `.claude/skills/audit-doc/SKILL.md` has no verify pass (grep).
- **Why stalled:** a bigger, measurable problem took the turn.
- **Still relevant:** yes. The owner still does this second pass by hand on research like #647
  to #658.

**11. Brakes on how rules and mechanisms get added.**
Several sessions proposed a brake of this kind; none was built:
- **Rule budget.** One incident goes in a log, a repeat earns a rule, and a new rule replaces or
  merges an existing one. Claude, c76d8db0, 2026-09-16. No trace. The map covers noticing
  contradictions, not admission.
- **A stricter ADR filing bar.** The proposed test was "hard to reverse, surprising, real
  trade-off", all three required. Claude, prompted by the owner, 95fb6b0d, 2026-09-16. Superseded
  ADRs had a median life of 2 days. The owner never picked an option, and `ADR-FORMAT.md` still
  asks only "Would reading the code answer this?"
- **Refuse a mechanism at intake unless it states its cost, trigger and upkeep.** Claude,
  93703a54, 2026-08-26: "a grep, not a model call." No trace. `DESIGN.md`, where it would have
  applied, was deleted the next day.
- **Codify a procedure only after a second real run matches it.** Claude, 46b14f35 and a0df3c45,
  Crewops, 2026-05-02. The same bar exists for standards and lint rules (ADR-0019, ADR-0124), but
  not for lanes, skills or mechanisms.
- **A zoom-out round in grilling.** Every few rounds, ask whether the design tree is simpler or
  bigger than at round 1, and whether it should exist at all. Claude, 270f9b97, 2026-08-28. The
  values file from that session was built; the round was not.
- **A map's replacement rate.** When a map opens as many tickets as it closes, build the
  most-decided slice. A meta ticket must also name its payback one level down. Claude, 1bed1949,
  agents-skills, 2026-07-29. Agent-skills #23 built the map budget but not this.
- **Why stalled:** each was one item in a longer answer, and in the most recent case the owner
  asked for "an even better idea" instead.
- **Still relevant:** yes. The Charter asks what keeps the machine from sprawling. #648 found eight
  lanes doing no useful work, and the ADR count is past 200.

### Medium leverage

**12. Prove a prompt or skill change by trials, not by the author grading the next run.**
- **Reversion or blind re-run of a skill edit:** Claude, 610d92d8, 2026-09-02: "No reversion test …
  I graded my own homework."
- **A fixed binary rubric over three trials before a model stage ships:** Claude with the owner,
  73356baf, Knowledge-Base, 2026-04-29. It caught two design bugs and one verdict that flipped
  between runs.
- **Measure verdict variance before trusting a model's judgment in bulk:** owner, 21fdeaeb and
  138f646b, May.
- **A skeptic armed with the values file, calibrated by replaying past owner decisions blind:**
  Claude, 270f9b97, 2026-08-28.
- **A second reviewer who reads the first one's findings and hunts what they missed, with misses
  tracked:** Claude, 138f646b, 2026-05-02. It was deferred on purpose "until you hit the ceiling".
- **Fate:** no trace for lane prompts or `.claude/skills`. The closest was a CLAUDE.md ablation in
  era 6.
- **Still relevant:** yes. Review, slicer and acceptance prompts change after every miss.

**13. Repeated failures and corrections become rules without the owner noticing them.**
- **Raised by:**
  - The owner, fe76522e, Planning-System, 2026-04-22: "Nothing has brought this up as a
    persisting issue." The owner backlogged it.
  - Claude's corrections-corpus idea, 957ee3fc, 2026-07-28, which the owner endorsed.
  - A "steer lens" that turns repeated behaviour corrections into standing orders, 93703a54,
    2026-08-26.
  - Counting tool errors that sessions silently work around (e0623433, General-Repo, 2026-07-28).
    82 sessions had hit one broken tool, and 2 had mentioned it.
  - "Talk mode produces zero file edits" (dcf2e2df, 2026-08-21). 61 of 393 question-only prompts
    ended in an edit.
- **Fate:** partly built. Capture (ADR-0018) and an Audit lane exist, but the lane map shows the
  Audit lane with 0 runs. The talk-mode rule is written in the owner's values file and has no guard
  or count. #656 and #658 (open) are researching the corrections by hand.
- **Still relevant:** partly. The research is under way, and the automatic path has never run.

**14. Measure a rule's usefulness where it fires: in sessions, not only in Verify history.**
- **Raised by:** Claude after owner pushback (df708aa4, Lumaria, 2026-09-04). A git sweep said 21
  rails never fired. A transcript sweep found 8 of them catching edits before commit.
- **Fate:** no trace. ADR-0003 still retires a lint rule when no Verify run ever failed naming it
  (confirmed).
- **Still relevant:** yes, for the Rules and Upkeep rulings.

**15. The warm spec door never validates the body it writes.**
- **Raised by:** Claude, twice (0e654a72, 2026-09-03; 4fe9b0d7, 2026-09-04), with no owner answer
  either time.
- **Fate:** no trace. Confirmed on trunk: in `spec/publish.ts`, `publishSpec` runs
  `validateSpecBody`, while `updateSpec` goes straight to `gh issue edit` or `setIssueBody`.
- **Still relevant:** yes. It sits on the spec door, and the change is small.

**16. A cancelled or parked run counts as a strike.**
- **Raised by:** Claude (83eb089b, Workflow, 2026-09-16): "worth its own ticket". The owner moved on.
- **Fate:** no ticket. Confirmed: `shared/strikes.ts` lists `cancelled` among
  `DEAD_CONCLUSIONS`. The rule census asks about it as an open question.
- **Still relevant:** yes. Parking is the owner's usual brake, and each park moves a ticket toward
  `needs-human`.

**17. One class test for hostile ticket bodies, and refusing a bad ticket at dispatch.**
- **Raised by:** Claude (7105ad2f, Workflow, 2026-09-05). The idea was one never-throwing path reader,
  one malformed body fed through every parser, and reconcile assembling the brief before it
  dispatches.
- **Response:** the owner asked for a quick hand fix.
- **Fate:** no trace. The same crash class was fixed again as an instance in `69cc62a` (09-13).
- **Still relevant:** yes. Both doors feed free prose to parsers.

**18. Deferrals carry the signal that revives them.**
- **Raised by:**
  - Claude, 1a40d0ae and 46b14f35, 2026-05-02: a deferral names its trigger.
  - Claude, b6809fcf, 2026-08-30: "A deferral written in a comment is not a trigger." Claude
    left it unfiled on purpose, pending #308's retire-one rule.
  - Claude, 85c6e613, 2026-04-22: an experiment gets a dated readout.
  - Claude, 0c547409 and d15598a7, 2026-09-05: a criterion that can only be read after close gets
    a scheduled read. The 09-11 read on agent-skills #204 was left to memory.
  - Claude, 4b91f060, 2026-09-04: #198's own proof was to watch the ADR filed-with-code ratio,
    and nobody watched it. The slice reader measured it for this note: about 86% since 09-05,
    against about 91% before. Filing fell from 153 ADRs in the two weeks before 09-04 to 46 after.
- **Fate:** no general rule. ADR-0031 covers probation only.
- **Still relevant:** partly. #646 plans experiment tickets and "held here as evidence" items, with
  no revival signal named.

**19. Implementer model A/B.**
- **Raised by:** Claude (d87bb50d, Workflow, 2026-09-04): once the structural fixes land, compare
  turns, time and cost on three tickets.
- **Fate:** no trace. Confirmed: `IMPLEMENTER_MODEL = "claude-sonnet-5"`.
- **Why stalled:** deferred behind the fixes, which did land.
- **Still relevant:** yes. #650 found the costliest runs were exploration, which is where turn
  count matters.

**20. Contract test for the `gh` fake, property tests on the pure parsers, and a one-time mutation audit.**
- **Raised by:** Claude (15485239, 2026-09-03).
- **Fate:** the contract part is partly in #538 (open). The property tests and the mutation audit
  have no trace.
- **Still relevant:** yes. No one has measured which of the suite's tests catch anything.

**21. ADR-0188 ("a lane may not ring another lane") is unenforced.**
- **Raised by:** Claude (3ba4c450, 2026-09-14): "this rule is honor-system."
- **Fate:** no test. `requestDispatch(` is still called from `shared/verify-dispatch.ts`,
  `integrate/signal.ts`, `spec/open-questions.ts`, `shared/ratification-dispatch.ts` and
  `shared/spec-author-dispatch.ts`. Lane census O7 proposes Verify ringing Integrate.
- **Still relevant:** yes, as a contradiction the Lanes ruling will meet.

**22. Story 6 of #434 was specified and never built.**
- **Raised by:** Claude, adopted by the owner (f303d286, 2026-09-10). The story: a gap a session
  finds must name a parent criterion, or it is not filed.
- **Fate:** none of #437 to #444 built it. #434 closed as completed on a single criterion that
  does not test it.
- **Still relevant:** partly. It is a worked example of a story that the slicer dropped and a
  grep-only criterion could not notice.

**23. An enrolled target pays the full gate twice.**
- **Raised by:** Claude (df708aa4, 2026-09-04; 53706791, 2026-09-05). Verify's gauntlet ran for
  332 s, then the target's `ci.yml` ran the same check for 456 s.
- **Fate:** no Workflow ticket. It was named in a Lumaria ticket as out of scope there.
- **Still relevant:** partly, depending on what the Lanes ruling does to Verify.

**24. Parallel agents skip shared registry files, and the orchestrator writes them one at a time afterwards.**
- **Raised by:** Claude (f4c22670, Crewops, 2026-05-03), after two agents clobbered one shared
  file.
- **Fate:** not a rule. ADR-0199 holds files by live run.
- **Still relevant:** yes. It is one concrete option for #646's open "claim cap vs shared hub
  file" contradiction.

**25. Sessions share one checkout.**
- **Raised by:** Claude (bdd19702, 2026-09-03): "Worktrees per session would end it." Related:
  the stop gate's "exposure" lasts the whole session, so deferral to a live sibling session almost
  never happens (d5be9096, 2026-09-04).
- **Fate:** ticketed only for drain workers (#399, open). `exposure()` is unchanged.
- **Still relevant:** partly. The owner still runs parallel sessions.

**26. Context trims the map does not name.**
- **Raised by:**
  - Claude, 7b8b4047, 2026-09-03: the repo's private vocabulary as a lookup cost.
  - Claude, 4b91f060, 2026-09-04: an ADR index grouped by area. The index is one flat table of
    111 constraints.
  - Claude, e5a7e4a1, 2026-05-12: cut skill listings from contexts that never use skills.
  - Claude, ccda894a, 2026-05-11: audit always-on lines by how often sessions cite them. ADR-0044's
    objection to read signals would have to be answered first.
  - Claude, 3f30b50b, 2026-08-21: check CONTEXT.md's "Avoid:" terms against code identifiers.
- **Fate:** no trace for each.
- **Still relevant:** yes, as inputs to the Context ruling.

**27. A blocker closed "not planned" strands its dependents.**
- **Raised by:** Claude (4af6f9ae, 2026-09-16), who deleted the edge by hand.
- **Fate:** confirmed on trunk. `dispatch/ticket-state.ts` returns `undelivered` for any close
  that is not `completed`.
- **Still relevant:** partly. Fewer edges exist since ADR-0199, but PRD batches still carry them.

**28. One explicit pipeline state record, and a yardstick for the machine.**
- **Raised by:** Claude (c76d8db0, 2026-09-16).
  - Keep ticket → stage in one record instead of rebuilding it from labels, markers and run
    titles. That record would retire most of `watchdog/`.
  - Measure the machine by owner interventions per merged ticket.
- **Response:** the owner said the session was not focusing on the problem.
- **Fate:** no trace.
- **Still relevant:** partly. The Charter needs a success measure, and the Runs and Lanes questions
  keep hitting lost state.

### Lower leverage (still relevant, small or narrow)

| Idea | Raised by, session, date | Fate |
|---|---|---|
| Walk-home dedupes by failure signature, not run id | Claude, fe6a4e26, 2026-09-09 | No trace; `markerKey(repository, runId)` |
| Enrol also wakes on label or secret changes | Claude, 8226bcba, 2026-09-04 | No trace |
| Two enrolled callers red on one machine SHA file a revert issue | Claude, 6bf64d30, 2026-09-01 | No trace |
| Four near-identical counters become one | Claude, 7b8b4047, 2026-09-03 | No ticket; Lanes material |
| Standing trackers found by marker, not in the newest 200 issues | Claude, a883ff89 (09-11), 3b79c59e (09-16) | Fixed once (#461); #243 and #588 now duplicate |
| Stable slice ids instead of array positions | Claude, 9bde85d8, 2026-08-27 | No trace; `dependsOn` is still numeric |
| Fold a linear chain of slices into one ticket | Claude, 812d7328, 2026-08-31 | #293 OPEN, untouched |
| One rule against tests writing to fixed shared paths | Claude, b6809fcf, 2026-08-30 | No trace; three instances fixed |
| Kill records, so rejected mechanisms are not re-proposed | Claude, 93703a54, 2026-08-26 | Partly superseded by INDEX.md and `Rejected:` lines |
| Archive the Sandcastle template repo | Claude, e7c7648e, 2026-08-21 | No trace; `archived: false` (confirmed) |
| #401 is an orphan: it describes `/drain`, which no longer exists | Claude, 5ec30054, 2026-08-28 | #401 OPEN |
| Rank deepening work by where fixes followed features, per file | Claude, 957ee3fc, 2026-07-28 | No trace; could feed #660's keep test |
| Absence detection by comparing sibling units' shapes | Claude, 6db8c40b, 2026-08-21 | agent-skills #124 closed not planned |
| "Exposed when:" on each prose standard, giving it a second exit | Claude, 6db8c40b, 2026-08-21 | Partly; the prose standards file has no exit |
| Measure whether a subagent's answer was used or redone | Claude, dcf2e2df, 2026-08-21 | No trace |
| Session close-out check: clean, pushed, recorded | Claude, dcf2e2df and 104261c8, 2026-08-21 | Partly (#442 snapshot); owner still asks by hand |
| Queued owner decisions expire and are re-read | Claude, 1312aac2, 2026-08-21 | Brief and governor ruled out; expiry has no trace |
| Owner taste checkpoints as graph blockers at high-leverage points | Owner, 59038394, 2026-08-20 | Done once; to-tickets now has no human wait |
| The measured-teardown sequence as a repeatable procedure | Owner and Claude, df708aa4, 2026-09-04 | Run twice by hand; no skill |
| Replay real commands against blocking hooks | Claude, 3064ddf4, 2026-04-15 | Partly; #405 OPEN |
| Machine-filed findings kept out of the owner's queue | Claude, 21fdeaeb, 2026-05-05 | Partly (#296) |
| Hooks that switch on only with a skill or subagent | Owner, ce8d3209, 2026-05-01 | No trace; see Not verified |
| Independent acceptance tests for by-hand tickets | Claude, 8ad723aa, 2026-09-02 | No trace |
| A general ring ledger | Claude, 31ab1e12 and 3ba4c450, 2026-09-14 | Superseded for implement only (ADR-0192) |
| One sweep for other repairers and closed sets that break ADR-0196/0197 | Claude, cf6b9393, 2026-09-16 | Deferred until #538 lands |
| Auto-close queued work whose fix already landed | Owner, fedc8d5e, 2026-04-28 | No ticket; near #646's "smart start" |
| When a correction exposes a wrong plan premise, sweep the slices already shipped from it | Owner, dd8b3d26, 2026-05-13 | No trace |
| Bulk staleness sweep of open tickets | Owner and Claude, 73356baf and e996a296, Apr–May | Built in Knowledge-Base only |
| One seam manifest that generates the lint config, a planner map and builder context | Owner and Claude, aa479ed1 and c94ca173, 2026-09-01 | Built in Lumaria (#864); here only dependency-cruiser |
| Capped, overwritten lane-local rationale instead of ADRs | Claude, owner endorsed, 4b91f060, 2026-09-04 | No trace |

## Still relevant but already held on map #646 or its research notes

These are listed so the rulings can see where each came from. They are not re-proposed.

| Idea | Raised by, session, date | Where it is held |
|---|---|---|
| Check whether a gate fits while the work is written, not at the last gate | Claude, 0e68dc70, 2026-04-15 | #646 / #647: "slicer is taught graph shapes the gates refuse"; partly built (ADR-0110, ADR-0130) |
| A word or token budget on what every stage reads | Claude, 812d7328, 2026-08-31 | #646 Context; #150 trimmed the corpus once |
| A cheap push-time step must not discard a finished run; resume from what a dead run left | Claude, b6809fcf and f15e55ef (08-30/31); owner, b7badf7b (08-27), 2405a741 (09-12) | #646 Runs (nine green runs lost 09-16); ADR-0114, ADR-0157 and #524 partly |
| One shared triage and rebase ladder instead of per-lane copies | Claude, 812d7328, 2026-08-31 | #646 Lanes; #648 (rebase-and-land copied four times) |
| Calibrate files claimed against files touched; the diff as the hold | Claude, 6851e32d (08-28), 2405a741 (09-12), c76d8db0 (09-16) | #646 Rules contradictions |
| Scouting wave, waves, smart start, cap on work in flight | Claude and owner, 6851e32d and 29935f9c (08-28/29), c76d8db0 (09-16) | #646 Runs, verbatim at the owner's request |
| `needs-human` only for a credential, a spend or a taste call | Claude at owner prompt, 2405a741, 2026-09-12 | #646 Runs; built door by door (#524, ADR-0192) |
| Slow floor: reconcile periodically as well as on events | Claude, 31ab1e12, 2026-09-14 | Deferred by owner; #653 note O12 |
| Integrate polls a Verify log GitHub won't serve yet | Claude, ae3ab731, 2026-09-13 | Lane census O7 |
| Module-level CONTEXT.md instead of the root glossary | Claude, 1643af3e, 2026-09-13 | #650 |
| Detect drift and contradiction between rules, specs and code | Claude, 85c6e613 (04-22), dd227e20 (09-01) | #646 Rules; #647 counted 26 by hand |
| Every doc an agent reads needs a generator, a gate or a grave | Claude, 95fb6b0d, 2026-09-16 | #646 Upkeep; ADR-0195 partly |
| Model lanes move off Actions to cloud routines | Claude, 6bf64d30, 2026-09-01 | #646 Lanes; #655 |
| Lanes as thin callers of the skills | Claude, 282526f5, 2026-08-29 | Superseded by #392 merge; the duplication question is in #646 Lanes |

## Overtaken

| Idea | Raised by, session, date | What overtook it |
|---|---|---|
| Era 2's PostToolUse fix for the ExitPlanMode-only plan gate (the ticket's "F3" seed) | Claude, eras narrative, e7c7648e, 2026-08-21 | Plan-file slicing is gone; the gate was deleted in August |
| Sandcastle's closed-spec gate | Era 5 | It shipped (sandcastle ADR-0019); successors ADR-0027 and ADR-0194 |
| Decide on capture formally | Claude, e7c7648e, 2026-08-21 | Built (ADR-0018, #36, #44, #134); its 09-09 stop is entry 5 |
| Coverage as a wiring detector | Claude, d5ad36cd, 2026-08-29 | #307 closed not planned (acceptance tests read code as text) |
| Registry codegen and edges computed from overlapping claims | Claude, 812d7328 and 9bde85d8, Aug | ADR-0199, #559, #602 |
| Pipeline simulator and a GitHub "estate fake" | Claude, be6c5636, 2026-09-03 | Lost to the canary in 2a8848cc's ranking; #538 |
| Container image for canary runners | Claude, 2a8848cc, 2026-09-03 | Canary moved to GitHub-hosted runners (47cc8c54) |
| Declared rather than discovered mirror status | Claude, 6455b251, 2026-09-03 | #392 deleted re-seed |
| Recover stops on a deterministic repeat failure | Claude, 7105ad2f, 2026-09-05 | The strike ladder and mechanic (#384) |
| Slowest test files named in a standing issue | Claude, 3984d7f8, 2026-09-02 | Owner ruled timing is no gate anywhere (#357) |
| Release lane opens empty PRs | Claude, 11ae0124, 2026-09-04 | Ratifier replaced the release PR (#296) |
| Sub-second turn-end check | Claude, 610d92d8, 2026-09-02 | #367: no Stop gauntlet registered |
| Cap and fence the gauntlet hook's echoed output | Claude, 610d92d8, 2026-09-02 | Built (`gauntlet-report.mjs`, #374/#382) |
| Put spec-format and the ADR renderer on re-seed's roster; one `domain.md` | Claude, 4b7a14a2 and 4b91f060, 2026-09-04 | #392 merge |
| agent-skills code breaks the no-prose rule | Claude, 0a91480d, 2026-09-04 | #392; `prose.ts` scans `.py` |
| Verify oversubscribes enrolled targets; timing baseline seeding | Claude, f7ac8456, 2026-09-02 | #343, #342, #349 |
| Slicer's ticket contract cut at the first `###` | Claude, 0e654a72, 2026-09-03 | Fixed in `to-tickets.ts` |
| Hook-contract rig per Claude Code version | Claude, 0c547409, 2026-09-05 | Mostly `hook-trace` plus driven scenarios |
| One-language bin tools with a compile step | Owner, priced by Claude, 1450f397, 2026-09-13 | ADR-0184 and #551–#559 |
| Acceptance author may answer "criterion not testable" | Claude, 344d49c9, 2026-09-14 | Filing-time criterion rules and `2cfdfdc` |
| Shared machinery as a pinned artifact | Claude, 126370c0, 2026-08-29 | agent-skills #195 → #392 merge |
| Prune docs no agent opens | Claude, 957ee3fc, 2026-07-28 | ADR-0044 (reads show loading, not influence) |
| Append-only registry files over-serialize graphs | Claude, 5ec30054, 2026-08-28 | ADR-0069, #601 |
| A "ceremony dial" for small work | Owner, 0161f723, 2026-04-19 | Partly superseded by the ticket door (#184); its hand `to-build` step is on #646 |
| Close on criteria met, not code shipped | Claude, 159b523f, 2026-04-23 | ADR-0169, #233, ADR-0106 |
| Numbers named by function, not literal | Owner and Claude, d636a6c8, 2026-04-23 | ADR-0066 and the literal-in-prose meter |
| Keep raw run output; set thresholds after a few cycles | Claude, e2efc403, 2026-05-06 | ADR-0064, ADR-0148, ADR-0173 |
| Keyword-harvesting "should/consider" into a backlog is noise | Owner and Claude, 8a9da0da, 2026-04-29 | Ticket door "file that", ADR-0009, ADR-0043 |
| Coverage lists derived from the tree | Owner, 8c86ec6c, 2026-05-01 | Generated lane map, #117, ADR-0086 |
| Walk-away loop: readiness, waves, stop conditions, run report | Owner and Claude, e046a4e6, 2026-05-20 | agent-skills #8, ADR-0130, ADR-0039, strike ladder; report rejected (ADR-0131) |
| Iteration cap on two-repo fix loops | Claude and owner, baaac033, 2026-05-20 | ADR-0097 one symlinked machine; strike ladders |
| Slices numbered out of build order | Owner, 3c0b9e4f, 2026-05-13 | GitHub blocked-by, ADR-0189, ADR-0182 |
| Frozen rubric and a separate grader | Claude, d6c95a47, 2026-04-22 | Acceptance author writes tests from the spec alone |
| Lint for dangling doc references | Claude, 133856cc, 2026-04-15 | `npm run drift` (orphan inverse is #410) |
| Ghost locks from dead headless runs | Claude, a2e5d6cd, 2026-04-14 | ADR-0190 |
| Retries mask flakes | Claude, 3e51cf02, 2026-04-16 | No retries; strike ladder |

## Not verified

- **What was re-checked.** These fates were re-checked on trunk `3c34748`:
  - the five `session-captured` triggers;
  - `DEAD_CONCLUSIONS`;
  - the immutable set;
  - `stageOf`;
  - the `undelivered` close rule;
  - `updateSpec` versus `publishSpec`;
  - `IMPLEMENTER_MODEL`;
  - the `requestDispatch(` senders;
  - `vitest -t` exiting 0 on no match;
  - no focused- or skipped-test lint rule;
  - repo visibility and `main` protection;
  - Sandcastle not archived;
  - ADR-0003's retirement rule;
  - `audit-doc` having no verify pass;
  - the open or closed state of #243, #293, #308, #399, #401, #405, #409, #414, #482, #538, #588,
    #656, #658 and #660.

  Every other fate is a slice reader's search result.
- **"No trace" means the listed searches found nothing.** It does not prove that no ticket,
  commit or ADR exists under other words.
- **Keyword search misses ideas phrased without the markers.** Claude's side was searched, not
  read. An idea stated plainly ("do X") in the middle of a long answer could be missed.
- **Early owner messages were cut off.** Archive-format-1 sessions (April–May) keep owner messages
  only to about 200 characters. Readers filled gaps from Claude's side, but an owner idea whose
  tail was cut and never echoed is invisible.
- **Two stretches are absent.** June 2026 (all of era 5) has no sessions in the archive, and
  nothing before 2026-04-13 exists. The raw transcripts for 09-10 to 09-17 exclude headless runs.
- **Which session wrote the eras narrative.** It is cited here as 63b657cd (agents-skills), which
  one reader traced, and e7c7648e (Workflow), which the other reader found. Both are dated
  2026-08-21. Which one authored it and which only carried it was not settled.
- **Figures quoted from sessions were not re-measured.** Examples: 5 to 24 minute acceptance runs,
  332 s and 456 s gate times, 61 of 393 prompts, 82 sessions, 8 of 21 rails, and the 2-day median
  life of superseded ADRs. The filed-with-code ratio (about 86% against about 91%) was computed by
  a slice reader and not repeated.
- **Hooks in skill or subagent frontmatter.** One reader noted that Claude Code's docs now describe
  hooks declared there. That was not re-checked.
- **Leverage rankings are judgement.** They were not measured against run data.
- **Privacy.** Three sessions in the corpus hold pasted secrets or other sensitive material. Nothing
  from them is quoted, and they are not named here.
