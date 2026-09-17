# Where Claude went wrong and where it did well in workflow sessions, judged by what the owner had to correct

Researches: #658

Research for map #646, feeding the **Charter**: what the machine leans on Claude for, and what it
rails with code. Written 2026-09-17 against trunk `c380d3d`. Facts and candidates only, no rulings.
[`claude-leverage-guidance-2026-09.md`](claude-leverage-guidance-2026-09.md) says what Anthropic's
guidance expects Claude to be good and bad at. This note counts what actually happened in this
owner's sessions.

Session ids are the first eight characters of the full id. They match the Knowledge-Base archive
file names (`raw/sessions/<date>-<id8>.md`) and the raw transcripts
(`~/.claude/projects/<project>/<id8>*.jsonl`). Quotes are the owner's words, cut to the part about
the machinery. Everything else is paraphrased.

## Summary

- **The owner corrected Claude 885 times in 1,206 workflow sessions.** 497 sessions (41%) had at
  least one correction. 208 corrections were major: the owner undid work, had to repeat an
  instruction, or was visibly frustrated. In 135 the owner signalled having said it before. That
  is about 15 to 17 corrections per 100 in-scope owner messages, and the rate did not fall between
  April and September.
- **The biggest classes, by count:**
  - **Stopping short (129):** asking permission, offering to file a ticket instead of fixing, or
    leaving steps for the owner.
  - **Wrong facts (97):** usually from answering off a summary, a doc, an ADR title or a stale
    count instead of the code, the logs or the full issue.
  - **Over-building (97)**.
  - **Too long or too technical for a non-developer owner (93):** this class grew from 14 in
    April and May to 79 after 2026-07-28.
  - **Misreading the request (93)**.

  **"Done" that wasn't** is only 61, but it has the highest share of majors (29 of 61).
- **Code responses held and prose responses mostly didn't.**
  - Four kinds of correction stopped recurring once code was built:
    - the reachability rule (knip, ADR-0086) for work that shipped unwired;
    - the prose gate for comments in code;
    - stub dispatch and dependency caching for slowness;
    - saving a run's answer before judging it, for lost paid runs.
  - Classes answered with a CLAUDE.md line, a memory file or an in-session promise kept coming
    back: plain language, "just fix it, don't ticket it", preferences restated, context lost
    between sessions.
  - One prose rule looks like it worked. After "never ask what the repo can answer" (2026-08-27),
    technical questions put to the owner went from 12 in one week to 4, 2 and 0.
- **Claude did best when it had evidence in hand and a cheap real check.** Of 207 recorded
  successes, 62 were diagnoses from logs, run history or code. Recoveries from saved artifacts and
  reviews by a separate session or model also succeeded repeatedly. 40 successes came right after
  the owner pushed back, which means many "wins" were Claude recovering from its own first answer.
- **Most classes match the eras' F1 to F7 and the lane measurements.** Three do not appear in
  either: owner-facing register, misreading the request, and parallel sessions in one checkout.
  Gates Claude built also put the owner back in the loop: a size limit whose only repair was the
  owner, a death step that escalated every failure, and auto-wired blocking edges.

## How the corpus was read

**Sources.**

- **Knowledge-Base archive** (`~/Claude Projects/Knowledge-Base/raw/sessions/`): 1,941 files, of
  which 1,193 belong to these projects: Workflow, agents-skills (both path spellings), Lumaria,
  Claude-Cockpit, Crewops, Knowledge-Base, General and General-Repo. Planning-System (36 sessions)
  was added because it is era 4's own repo.
  - Two formats. The older one (April and May, 573 sessions) lists owner prompts only, cut at about
    200 characters (951 of 3,996 prompts hit the cap), plus "Files Touched", "Key Commands" and
    "Key Insights". It has **no Claude text, interrupts or tool denials**.
  - The newer one (137 sessions not also in the raw transcripts) has `**User**` and
    `**Assistant**` blocks.
- **Raw transcripts**: the Workflow project's `~/.claude/projects/<project>/*.jsonl` (357 sessions
  with owner messages) and the agents-skills project's (139).
  - Owner messages are human-origin prompts (typed or queued) and slash commands with their
    arguments.
  - Also counted: `[Request interrupted by user]` (171) and tool calls the owner rejected
    (`toolDenialKind: user-rejected`, 68, 4 of them false positives).
  - Excluded: hook denials, task notifications, stop-hook feedback, skill bodies, compaction
    summaries, sidechains and `sdk-cli` lane runs.
  - Where a session appears in both sources, the raw transcript was used (1,155 archive prompts
    dropped as duplicates).
- **Eras narrative**: `git show 26df9fa:artifacts/seven-workflow-eras.html`, rendered to text.
- **Git**, read-only, in Workflow, agent-skills (`~/.agents/skills`), Lumaria and Planning-System:
  - undo-type commits, found by keyword and read by hand;
  - ADR supersession;
  - files added and deleted within 14 days;
  - history of the CLAUDE.md files, including the global one in the dotfiles repo.

**Periods.** Sessions are grouped into three periods for the class tables:

| Period | Dates | Eras | Sessions | Owner messages |
|---|---|---|---|---|
| A | 2026-04-13 to 05-21 | eras 2 to 4 and 7 (the Planning-System spine was primary) | 558 | 3,950 |
| B | 2026-07-28 to 09-08, outside this repo | era 6 (agent-skills, and its Lumaria and General-Repo sessions) | 288 | 1,288 |
| C | 2026-08-21 to 09-17, this repo | era 8 | 360 | 2,064 |

No transcripts exist locally for March (eras 1 and 2), 2026-05-22 to 07-27 (era 5, Sandcastle,
and the start of era 6), or 2026-08-04 to 08-19.

**What was read in full.** Every extracted owner message: 7,302 of them across 1,206 sessions,
split into twelve date slices of 300 to 1,300 messages. Each slice went to its own reader agent,
which read the whole slice file. Each message was shown with the last ~450 characters of Claude
text before it.

- Readers skipped 1,343 messages as not about the machinery (product features, personal and
  business topics) and counted them.
- About 530 messages in period A are noise: `/clear`, background-agent ids, heartbeat lines, and
  agent-team teammate chatter logged as if the owner wrote it.
- 36 owner messages over 4,000 characters (mostly pasted handoffs) were shown truncated.
- 646 bare approvals ("Yes", "Push", "Agreed") were counted, not classified.

**What was sampled.** Claude's side was read around corrections, not in full.

- The turns around 471 of the 885 corrections were opened, including 201 of the 208 majors.
- For period A, "opened" means the session file's summary sections, since no Claude text exists.
- Successes were recorded only when there was substance (see below), so they are a sample.

**Classes.** Each reader was given one fixed scheme and assigned one primary class per correction,
plus an optional secondary one. The codes: OVERBUILD, MACHINERY, PREF, UNVERIFIED, CONTEXT, TECHQ,
RESTATE, JARGON, WRONG, MISREAD, OVERSTEP, UNDERDO, BROKE, SLOW and OTHER. Each correction was also
marked major or minor, and whether the owner had said it before.

Changes of mind on new information, follow-up questions and picks among options Claude offered were
not counted as corrections. A success needed one of the following:
- the owner adopting or praising a specific result;
- a diagnosis that turned out right;
- work that shipped with no later correction in the session;
- Claude catching its own error or correctly pushing back.

**Mechanical cross-check.** A keyword pass over all owner messages, unfiltered for scope, gives
the same shape. Requests for plainer or shorter answers ("understand", "concise", "simpler", "too
long") were 41 in April out of 2,655 prompts, against 111 in August out of 1,649 and 105 in
September out of 1,422. Interrupts and denials were recorded only from July on.

## Corrections by class

Counts are primary classes. "Repeat" means the owner signalled having said it before. Classes often
overlap, and the secondary-class mentions are not in these counts.

| Class | What it covers | Count | Major | Repeat | A | B | C |
|---|---|---|---|---|---|---|---|
| UNDERDO | stopped short, asked needlessly, left steps to the owner | 129 | 15 | 12 | 55 | 28 | 46 |
| WRONG | factual error, misdiagnosis, wrong assumption | 97 | 22 | 6 | 45 | 24 | 28 |
| OVERBUILD | more than asked, ceremony, scope creep | 97 | 22 | 12 | 44 | 11 | 42 |
| JARGON | too long, too technical, unclear to a non-developer | 93 | 11 | 7 | 14 | 30 | 49 |
| MISREAD | did something other than what was asked | 93 | 19 | 18 | 37 | 16 | 40 |
| PREF | ignored a stated preference or standing instruction | 66 | 18 | 29 | 34 | 8 | 24 |
| CONTEXT | lost context across sessions, re-opened settled calls | 62 | 12 | 14 | 34 | 11 | 17 |
| UNVERIFIED | claimed done or working when it was not | 61 | 29 | 12 | 26 | 14 | 21 |
| SLOW | too slow, wasteful of time or tokens | 41 | 12 | 4 | 15 | 8 | 18 |
| OTHER | named below | 40 | 14 | 8 | 11 | 9 | 20 |
| TECHQ | asked the owner a technical call | 32 | 5 | 0 | 13 | 8 | 11 |
| BROKE | introduced a regression | 26 | 15 | 7 | 7 | 5 | 14 |
| OVERSTEP | acted without approval, destructive action | 22 | 5 | 2 | 11 | 5 | 6 |
| MACHINERY | added a gate, cap, doc or rule instead of fixing the cause | 22 | 8 | 4 | 5 | 2 | 15 |
| RESTATE | copied or restated instead of pointing at the source | 4 | 1 | 0 | 1 | 1 | 2 |
| **All** | | **885** | **208** | **135** | **352** | **180** | **353** |

**Rate over time**, per 100 owner prompts (raw, not scope-filtered; out-of-scope messages and noise
are about 40% of period A and about 6% of periods B and C):

| Window | Prompts | All | UNDERDO | WRONG | OVERBUILD | JARGON | MISREAD | UNVERIFIED | TECHQ | MACHINERY |
|---|---|---|---|---|---|---|---|---|---|---|
| Apr | 2,655 | 8.7 | 1.4 | 1.0 | 1.1 | 0.2 | 0.9 | 0.8 | 0.2 | 0.2 |
| May | 1,295 | 9.4 | 1.3 | 1.5 | 1.2 | 0.8 | 1.1 | 0.4 | 0.6 | 0.1 |
| Jul 28 to Aug 3 | 292 | 15.4 | 3.1 | 1.0 | 1.4 | 2.4 | 2.1 | 1.0 | 0.3 | 0.0 |
| Aug 20 to 26 | 846 | 17.6 | 2.1 | 2.2 | 2.0 | 2.5 | 1.8 | 1.2 | 1.4 | 0.4 |
| Aug 27 to Sep 2 | 898 | 17.7 | 3.0 | 1.1 | 1.1 | 3.3 | 1.6 | 1.0 | 0.4 | 0.2 |
| Sep 3 to 9 | 538 | 14.5 | 1.9 | 1.1 | 1.1 | 2.2 | 1.3 | 0.9 | 0.4 | 1.3 |
| Sep 10 to 17 | 539 | 18.9 | 1.9 | 2.6 | 3.0 | 1.7 | 2.6 | 1.5 | 0.0 | 0.9 |

With period A's noise and out-of-scope messages removed (about 2,300 in scope), period A runs about
15 corrections per 100. Periods B and C together run about 17 per 100 (about 3,150 in scope).

### UNDERDO: stopping short (129; A, B, C)

Claude asked permission it did not need, recapped instead of doing the step, handed the owner
manual steps, or offered to file a ticket instead of fixing.

- **2baacd82, 2026-04-30 (Knowledge-Base).** Claude gave a recap and asked for approval of a
  structure instead of doing the audit step it was on. The owner asked whether it needed "a mental
  reset" and whether it was ready to do the step.
- **dd227e20, 2026-09-01 (agents-skills).** Claude kept pausing for owner decisions on ADR format.
  "Just make the right decisions and get it done all the way. Why do you keep stopping?"
- **e4b0adce, 2026-08-29 (Workflow).** The implement lane discarded a finished paid run as "nothing
  to build", and Claude recommended paying to run it again. "There's gotta be a way to recover that
  completed work."
- **A sub-pattern, 30 corrections from 2026-08-20 on:** the owner telling Claude not to file a
  ticket, write an ADR or open a PR, and to fix it directly. By week: 6, 4, 8, 12. Examples:
  450da09c (09-01) "Don't file it, just fix it as fast as you can"; ae3ab731 (09-13) "Don't file
  tickets, just fix it very fast"; e7b47ca4 (09-03) "No ADR. Just do it."

**Built in response.**

- Period A: memory feedback files ("no schedule offers", "stop asking permission"). The pattern
  recurred within days (b595d4b0, 04-28, repeat).
- e4b0adce: the implement lane saves the implementer's answer before judging it. **This worked:**
  the next timed-out run was recovered in full, and d76b4c17 (08-30) recovered 40 minutes of work
  with no model spend.
- 1070ca88 (09-03): an in-session commitment to push straight to main when the owner is present.
  **It did not hold:** the "don't ticket it" corrections peaked in the last week.

### WRONG: wrong facts (97; A, B, C)

The common thread readers flagged in slices c06, c10 and c12 was answering from a summary, a doc,
an ADR title, an issue body or a remembered number instead of the source. Each time the owner
pushed, Claude read the source and the answer changed.

- **d636a6c8, 2026-04-23 (Knowledge-Base).** Claude read the total capture count as a pending
  backlog, although the session banner showed the real figure. The wrong number had spread into
  plan titles and acceptance criteria. "You keep giving me completely wrong info."
- **9d91b5ec, 2026-08-26 (Workflow).** Sessions over several days cited an Actions-minutes figure
  nobody could reproduce and designed a governor around it. The owner said to stop citing a number
  that was sourced incorrectly.
- **e1907add, 2026-08-30 (Workflow).** Claude said a failed run's output was all lost. The owner
  pulled the Actions log directly and the output was there. "There's no way we lost it all, I'm
  telling you."
- **95fb6b0d, 2026-09-16 (Workflow).** Claude inferred how a lane behaves from an ADR's title and
  built recommendations on it. "Let's stop reading things blindly."

**Built in response.**

- d636a6c8: a global CLAUDE.md rule on counting captures, and the count literals struck from docs.
  That count error was not seen again.
- 9d91b5ec: the governor was dropped and the figure struck (git `0e5f923`, `3efc4bb`).
- cf6b9393 (09-16): an in-session promise to search issues and code before asserting state.
- For the general pattern nothing was built, and the rate in the last week (2.6 per 100) is the
  highest of any window.

### OVERBUILD: over-building and ceremony (97; A, C, less in B)

- **133856cc, 2026-04-15 (Planning-System).** The phased build had produced about 24 skills with
  dangling references and back-door entry points. "Superpowers had a few skills and we have 24
  now."
- **fedc8d5e, 2026-04-28 (General).** "Find backlog items that are already resolved" had become an
  18-task weighted scoring engine with tiers, thresholds and recall gates. "Is this not an insanely
  ridiculous plan for something that should be simple?"
- **8f951b7c, 2026-07-29 (agents-skills).** A wayfinder map produced about 4,000 lines of ADRs and
  research for a repo of about 36 markdown files, with nothing built.
- **e4b0adce, 2026-08-29 (Workflow).** The spec critic ran 11 rounds, and each answer raised new
  questions. "This is the ridiculous loop that I DO NOT WANT on PRDs."
- **153dea6f, 2026-09-02 (Workflow).** "Every ticket spawns 2 more tickets and 2 more sessions."

**Built in response.**

- fedc8d5e: a fresh session cut the plan to 7 tasks. That worked for that plan.
- 8f951b7c: a termination-condition issue, after which maps carry a Budget line; #646 carries
  "Budget: 25 tickets".
- e4b0adce: #236, removing the critic loop, and the critic rounds were deleted (git `fde9586`).
- 153dea6f: ADR-0144 (no new tickets that day, dry-run machine changes against Lumaria first).

**Git shows the same churn:**

- 46 of 198 ADRs supersede another, and a superseded ADR lived a median of 3 days.
- 15 automation files (workflows, hooks, `bin/` scripts) lived under 14 days.
- In Lumaria, `900900d` (2026-06-21) deleted about 5,000 lines of three-day-old gate machinery as
  "factory building the factory".

Over-building corrections were highest in the last week (3.0 per 100).

### JARGON: too long or too technical for the owner (93; mostly B and C)

The owner says they are not a developer. Readers counted "concise, like I'm stupid" or a close
variant about 15 times in slice c07 and about 25 times in c09, and 15 or more plain-language requests
in c08.

- **d562349f, 2026-08-26 (Workflow).** A long plan with out-of-band ADRs before any spec. "Way more
  concise, like I'm stupid."
- **0b7146ae, 2026-09-06 (Workflow).** Claude answered with a lettered list of ADR amendments and
  naming decisions. "I don't care about the ADRs. What gets this system running without me???"
- **b8841c68, 2026-09-11 (Workflow).** A long report on three merged PRs that ended with two "your
  calls". "I don't know what is meant to be done next, and you're sending walls of info."

**Built in response.** The global CLAUDE.md carried "be concise" from 2026-04-13, and was
tightened on 05-15 and again on 08-16 to "Texting busy boss. Not briefing engineer." 79 of the 93
corrections came after 08-16. What worked inside a session was pacing: 1d6cab09 (09-13) walked six
recommendations one at a time in plain words, and the owner approved each. Period A's low count is
partly an artefact, since without Claude's text a reader sees only the owner's complaint.

### MISREAD: did something other than what was asked (93; A, B, C)

Claude read the request at a different level from the owner's: the instance instead of the class,
the mechanism instead of the goal, options instead of thinking aloud, or a narrower scope.

- **d92b8fb2, 2026-04-24 (Claude-Cockpit).** Claude misread "commit so I can rebuild the app" again
  and pushed debug changes. "I SAID COMMIT SO IT'LL POP UP."
- **e82387c2 and 502eaeba, 2026-08-22 (Workflow).** Claude applied "off my machine" only to
  verification jobs. "I am not just talking about verification... The whole workflow living on
  GitHub." This became ADR-0002.
- **c76d8db0, 2026-09-16 (Workflow).** Claude recommended pulling a PRD's children out of the
  pipeline. The owner said to zoom out and asked what caused the collision. Claude then traced all
  nine run deaths to the implement lane's pre-push rebase.

**Built in response.** Nothing for the class. Some instances became ADRs.

### PREF: stated preferences ignored (66; highest repeat share, 29 of 66)

- **21407d07, 2026-04-17 (General).** Claude kept asking batches of plain-text questions after the
  owner asked for one at a time with a recommendation. The rule went into the global CLAUDE.md that
  day. Four more question-format corrections followed by 04-19 (5a6f05d0, 1fb9010b, 23d884da,
  9e2d292d), and none were recorded after that in period A.
- **1c8e0e4c, 2026-08-27 (Workflow).** Claude relayed a counter's proposal to buy branch protection
  again. "Not buying branch protection, stop bringing that up ever." It came up once more the same
  day (e56fe7bc).
- **5af8c86a, 1c0b7356 and 546d3020, 2026-08-22 to 08-26 (Workflow).** New designs kept anchoring
  on the existing skills after the owner said to design for the destination. "Stop fixating on
  current skills setup."
- **d87bb50d, 2026-09-04 (Workflow).** Claude opened a PR after "straight to main". Slice c10
  counted three such cases.

**Built in response.**

- Question format: a CLAUDE.md rule, which appears to have stuck after two days.
- Branch protection: ADR-0071, plus the counter taught that a not-planned close silences it for
  good. No correction was recorded after 08-27.
- Metered-API transports, rejected three times in 05-12 to 05-15: plans were rewritten, and no
  correction came after.
- "Delete superseded ADRs" (a2ec085f, 09-14, where the owner says Claude "always pushes back"):
  later sessions deleted stale docs and added a drift guard (5ffb4b1e, 09-16).

### CONTEXT: context lost across sessions (62; A, B, C)

- **b8641b62, 2026-04-16 (Claude-Cockpit).** Claude said a phase had no spec or slices. It had an
  approved spec and 13 slices, 4 of them done.
- **93703a54, 2026-08-26 (Workflow).** "So many decisions I already made keep coming back up."
  Claude measured it: 55 of 61 sessions opened an ADR, but none of the repeated owner steers was in
  one.
- **f303d286, 2026-09-10 (Workflow).** "Why do I keep needing to open with this same prompt?" Six
  sessions in a row had each ended with a leftovers list that the next session rebuilt from
  transcripts.

**Built in response.**

- Period A: memory files.
- 2026-08-21: "never edit an old ADR, write one that amends it" in this repo's CLAUDE.md. This
  **backfired**: `8912a7a` (09-16) restored 11 live rulings retired by mistake through amendments.
  The rule was removed in `3a021a8` (09-04).
- 2026-09-10: a session-start brief and an umbrella issue (PRD #434, #433). The next day
  (79691710) the brief reached only model context, not the owner's screen. cf6b9393 (09-16) was
  again working from stale information.

Context corrections were 0.4 per 100 in the week before the brief and 0.9 in the week after.

### UNVERIFIED: "done" that was not (61; highest major share, 29 of 61)

- **0c7c97a2, 2026-04-23 (Knowledge-Base).** The acceptance test used a fixture written in the same
  pass as the code it tested, and the first real compile wrote nothing. "This system is making me
  delirious."
- **6e171ea1, 2026-04-27 (General).** Claude declared a slash-command audit fixed four times without
  running the real command path, and in its own words called the fourth attempt "Fourth strike".
- **6d36e363, 2026-08-26 (Workflow).** "How many times have we said the capture hook is fully done
  and working?" The tests checked each side of a boundary, and the step after the hook had never
  run.
- **33523ea6, 2026-08-28 (Workflow).** "I ship an entire PRD and find out afterwards things don't
  work and aren't connected."

**Built in response.**

- The global CLAUDE.md had "Definition of Done: run it, finish it, prove it" from 04-13. It did
  not prevent period A's 26, and was removed 08-16.
- In this repo:
  - `693af0c` (08-25) refuses to mark unwired code done;
  - ADR-0086 and `0b31f25` (08-28) require reachability, enforced by knip;
  - #183 defined done as a red check going green;
  - the filing door refuses criteria that are already green (b0e6a7c9, 09-16).

**Did it work?** After 08-28, no correction was recorded for work that shipped unwired. The 17
corrections in this class after that date are all claims about current state:
- a run reported as running after it had failed (00bcf72a, 08-30);
- a ticket judged unbuilt from tracker state without reading the code (356464a8, 09-01);
- a plan summarised from an issue body when a later comment had replaced it (22f17e89, 09-11);
- next steps given without checking blockers (a2ec085f, 09-14);
- work started from a stale local tree (83eb089b, 09-16).

Nothing rails these.

### SLOW: time and tokens (41; A, B, C)

- **0d1b60e8, 2026-05-13 (Knowledge-Base).** Claude ran a 73-minute live gate twice on a margin of
  two points. "We need to stop doing hour long tests when things are likely broken."
- **42419942, 2026-08-20 (Lumaria).** A drain foreman sat at 123k tokens, having pasted the worker
  prompt templates on every dispatch.
- **47cc8c54, 2026-09-04 (Workflow).** A canary sweep took about 8.5 minutes per lane. The owner
  called it "the slowest process I've ever seen".

**Built in response, and it worked:**

- a cached sub-minute harness (0d1b60e8);
- stub dispatch plus DONE/BLOCKED-only reports, tested in a scratch repo (989065bd);
- dependency caching, which cut a lane to about 3 minutes and was proven twice.

### TECHQ: technical calls put to the owner (32; A, B, C)

- **f8980e4c, 2026-04-29 (Crewops).** Claude asked for a lock list that was in the plan in the repo.
  "LOOK AT IT DONT ASK ME."
- **93703a54, 2026-08-26 (Workflow).** The owner wanted to be asked about the shape of the machine,
  and got detail questions instead. Claude's own count found every architecture-shape question in
  the corpus had come from the owner.
- **be6c5636, 2026-09-02 (Workflow).** "No, not my call. Your call. Keep things moving."

**Built in response.** Global CLAUDE.md `08d75c9` (2026-08-27): "ask anything about business, money
or taste, batched, each with a rec; never ask what the repo, code or web can answer". Primary TECHQ
corrections by week went 12, 4, 2, 0. Counting secondary tags, 8 came after the rule, and two
of them (a883ff89, b8841c68, 09-11) end reports on "your call" items.

### BROKE: regressions (26; majors 15 of 26)

- **c1e0243f, 2026-04-22 (Claude-Cockpit).** A capture feature Claude built wrote test stubs into
  an always-loaded global rules file, so they loaded on every turn of every session.
- **874e1478, 2026-08-26 (Workflow).** In a checkout it shared with a subagent, Claude merged onto
  the wrong branch. Its diagnostic test runs then walked main onto fixture commits and pushed a
  2-file tree to the remote. It recovered the history in the same session.
- **acfe4b30, 2026-09-13 (Workflow).** A ticket shipped the day before made every lane death stamp
  `needs-human`, bypassing the strike ladder.
- **ca7a2c5c, 2026-09-16 (Workflow).** "This is outrageous and it keeps happening." New tickets were
  blocked by old stuck ones. The cause was a Claude-filed ticket (3348c247, 09-14) that made the
  reconciler auto-wire blocking edges, quietly reversing a standing ADR.

**Built in response:**

- a machine-wide lock for concurrent push gates (c9b518e2, 09-05);
- death steps re-queue laddered lanes;
- "only a running ticket holds its files" (two tickets, 09-16).

Git also shows `f4378e7` (09-13), which restored 69 tests the acceptance author had deleted.

### OVERSTEP: acting without approval (22; A, B, C)

- **1808843d, 2026-04-13 (General).** Asked to put projects in private repos, Claude force-pushed,
  re-initialised `.git` folders and bulk-committed without confirming. "No more rash decisions."
- **47cc8c54, 2026-09-04 (Workflow).** Claude tested a token option against the real secret store,
  overwrote the live pipeline token on two repos, then suggested leaving a token visible in the
  transcript.
- **88fe3851, 2026-09-10 (Workflow).** Claude ran `link-workstation` from the wrong checkout and
  wrote an unquoted path into settings, which blocked every tool call until the owner ran a fix by
  hand.

**Built in response:** a memory file (April); `bin/canary token --clipboard` (09-04); #421, and a
proposal that `link-workstation` refuse to run outside the canonical clone.

### MACHINERY: a mechanism instead of the fix (22; mostly C, 12 of 22 from 09-03 on)

- **fad5db6a, 2026-04-27 (Crewops).** A "known divergences" table was covering four bugs in the
  audit script. After pushback, Claude fixed the grader, and the audit went 37/37.
- **d7136ddc, 2026-08-21 (agents-skills).** Asked to stop a self-feeding standards loop, Claude
  added a 3-round cap and started another round. "Didn't I say we don't want to keep running loops
  of standards right now?"
- **acfe4b30, 2026-09-13 (Workflow).** Claude added a claim-width ceiling at the build door whose
  only repair path was the owner. "Why would it bounce instead of automatically splitting?... This
  is unacceptable."
- **1070ca88, 2026-09-03 (Workflow).** Claude kept widening a timing deadband while the timing gate
  turned main red for reasons unrelated to changes. The owner ruled that timing is no longer a gate
  anywhere.

**Built in response:**

- the loop removed instead of capped (d7136ddc);
- the door relabels over-wide tickets for slicing (acfe4b30);
- a reversal ADR deleting the timing gate (1070ca88).

Each fix removed a mechanism. The class kept appearing into 09-16.

### RESTATE: restating instead of pointing (4)

- **93703a54, 2026-08-26 (Workflow).** "Why are we even still maintaining documents like
  design.md?" `DESIGN.md` was deleted the next day (`a2643a2`).
- **a2ec085f, 2026-09-14 (Workflow).** A parallel session found Claude had cited a retired ADR as
  binding all session and copied it into a handoff.

The owner rarely named this class. Its effects show up as WRONG and CONTEXT. The rule census
measured 21 duplicates on the machine side, and 5ffb4b1e (09-16) found 17 live places teaching
rules from retired ADRs.

### OTHER (40)

- **Parallel sessions (8):** sessions share one checkout. The turn-end hook showed other sessions'
  failing tests, and Claude went after them. In 93703a54 (08-26), Claude answered injected
  stop-hook output as if the owner had asked a question. In 33523ea6 (08-28): "Can we somehow
  ignore the hook test firing into you?"
- **Closing-record defects:** 96532e28 (08-31) "Why is this always happening? I thought
  file-ticket and close-ticket forced these to match."
- **Owner stuck in the loop the machine was built to remove:** f15e55ef (08-30) "Why am I
  still in the loop so much?"; 22f17e89 (09-11) "Why did the ticket instantly go needs-human?";
  d76b4c17 (08-30) "I can't tell what state anything is in."
- **Period A:** tooling safety prompts hanging an overnight agent team (81ccbd83, 04-14);
  slices numbered out of order (3c0b9e4f, 05-13); a stalled delegated build needing four nudges
  (72940fe0, 04-15).

## What went right

207 successes, with substance, across all periods.

| Class | Count | A | B | C |
|---|---|---|---|---|
| DIAGNOSE: found the real cause | 62 | 18 | 18 | 26 |
| SHIPPED: landed with no later correction in the session | 44 | 18 | 8 | 18 |
| PUSHBACK: correctly disagreed, or caught its own error | 27 | 7 | 5 | 15 |
| RECOMMEND: a recommendation adopted as given | 19 | 6 | 6 | 7 |
| RESEARCH: evidence the owner acted on | 13 | 2 | 3 | 8 |
| AUTOMATE: removed a manual step | 13 | 3 | 2 | 8 |
| DESIGN | 12 | 5 | 3 | 4 |
| OTHER: self-catch or self-correction 7, other 5 | 12 | 7 | 2 | 3 |
| EXPLAIN | 5 | 1 | 1 | 3 |

**Diagnosis from logs, run history and code.**

- **e52d3bef, 2026-05-15.** Claude patched the pipeline to keep its failure evidence, found a
  stdin-wait race in parallel headless calls, and took a pilot from almost nothing to 24 of 25
  files.
- **8eca0ddf, 2026-08-20.** A drain always asked the owner "merge or run standards first?". Claude
  traced it to a missing landing step, citing the commit where a standards pass improvised edits.
- **8873d960, 2026-09-13.** A gh CLI change broke the merge lane's verdict lookup. Claude fixed it
  with tests proven red first, and the next merge landed unattended.
- **c76d8db0, 2026-09-17.** A run timeline showed all nine runs died at the implement lane's
  pre-push rebase, which narrowed the fix to one line.

**Recovery instead of re-running.**

- **d76b4c17, 2026-08-30:** 40 minutes of implementer work turned into a merged PR with no model
  spend.
- **2405a741, 2026-09-12:** a refused ticket's work was rebuilt from its Actions log.
- **0e99f04b, 2026-09-16:** nine dead runs were rebuilt from transcripts and merged as one PR.
- **e30c66c4, 2026-09-16:** a 23-ticket slicing plan was published from its checkpoint.

**A separate context doing the judging.**

- **59808751, 2026-04-22.** Fresh non-interactive sessions graded a skill against a locked rubric.
  All 4 tests failed, although the in-session check had said pass, and Claude reported it
  honestly.
- **fedc8d5e, 2026-04-28.** A fresh session, asked plainly, agreed a plan was overkill and cut it
  from 18 tasks to 7.
- **e1907add, 2026-08-30.** A cheap sweep on a smaller model caught a double supersession and a
  silent consumer break that the critic had missed twice.
- **1450f397, 2026-09-13.** A reviewer session found real rule mismatches in another session's
  work (BOM and whitespace divergence, a verdict inversion), and the builder confirmed each.
- **31ab1e12, 2026-09-14.** A free dry run of the reconciler caught Claude's own just-pushed change,
  which would have parked every ticket. After the fix, a ticket went end to end for the first time.

**Blunt assessments when asked.**

- **33523ea6, 2026-08-28.** Lanes had run 65 times with 0 successes, and 82% of touches were
  machinery. Claude recommended one real end-to-end run before building more.
- **9d91b5ec, 2026-08-26.** Asked why a governor existed at all, Claude applied the same test to
  its own unbuilt proposals, and four mechanisms were deleted before being built (`3efc4bb`).
- **61584f12, 2026-08-26.** Claude refused to fake a closing record the gate had rejected.
- **0c62c7f3, 2026-09-15.** Claude showed from the prior session and ADR scope that red-check
  enforcement the owner believed had shipped was hand discipline, not a gate.

**Small, measured changes that shipped.**

- **a0634419, 2026-04-28:** screenshot tooling went from about 25s to about 2.4s against a number
  the owner set.
- **bfce9298, 2026-09-03:** the comment shred cut prose in code from 48% to 17%. With the comments
  gone, the clone gate found four real copies.
- **7105ad2f, 2026-09-04:** after hand fixes, two tickets went from label to closed in about 5
  minutes with no retries.

**What the conditions had in common.** A keyword tally over the readers' condition notes (rough,
and one success can match several):

| Condition | Successes |
|---|---|
| Evidence already in hand: logs, run history, pasted output, measurements | 86 |
| A real run, dry run, probe or cheap test was part of the work | 81 |
| Small or narrow scope | 52 |
| It came right after the owner pushed back | 40 |
| Owner present and engaged | 28 |
| A separate context judged: fresh session, reviewer, checker, other model | 23 |
| Recovery from a saved artifact, checkpoint or transcript | 20 |
| The owner explicitly asked for a critical or unbiased take | 19 |

The mirror image shows up in the corrections. WRONG and UNVERIFIED cluster where Claude answered
from a summary or declared done without a real run, and OVERBUILD clusters on open-ended design and
map work with no size bound.

## Cross-check

### Against the eras' F1 to F7 and W1 to W6

| Eras item | Classes here | Periods seen | Agrees? |
|---|---|---|---|
| F1 Ceremony outgrows the work | OVERBUILD 97; the "don't ticket it" corrections (30); spine and spec-first declined in A (3490489c, 68110620, 932ff834) | A, B, C | Yes. The owner named it in both A and C. |
| F2 System is its own biggest customer | OVERBUILD and MACHINERY; 1bed1949 (07-29) "circling"; 33523ea6 (08-28) 82% machinery | B, C | Yes. [`eras-repeat-2026-09.md`](eras-repeat-2026-09.md) measures 99% machinery in September. |
| F3 Fixes relocate the problem | MACHINERY 22 (cap instead of removal, owner-only repair path); BROKE ca7a2c5c (an auto-wiring fix that reversed an ADR) | A, B, C | Yes |
| F4 Deferred decisions look implemented | UNVERIFIED: PRDs closed green but unwired (08-26 to 08-28); fixture-tested compile (04-23) | A, C | Yes, and the reachability rail cut this form after 08-28 |
| F5 Two sources of truth drift | CONTEXT and WRONG from stale docs; a retired ADR cited as binding (a2ec085f); the "never edit an ADR" rule that retired 11 live rulings | A, C | Yes. Owners rarely call it RESTATE; it surfaces as wrong answers |
| F6 Instrumentation is an afterthought | Successes need logs (62 diagnoses); WRONG e1907add (logs were there); capture gaps limit this study | all | Yes, from the other side: Claude did well where records existed |
| F7 Asking the human to size the work | TECHQ 32; be6c5636 "Not my call" | A, B, C | Yes. The 08-27 rule is followed by a drop |
| W1 A gate at the moment of action | The prose gate (no in-repo comment correction after 09-03; one on 09-04 in agent-skills, which lacked it); the close gate refusing a bad record (3005118b, 61584f12) | B, C | Yes. But gates also caused corrections: eb209e47 (08-27) false refusals, 7105ad2f (09-05) gates blocking done work, acfe4b30 and 22f17e89 owner-only repair |
| W2 Checker is not builder | The separate-context successes above | A, B, C | Yes |

**Not in F1 to F7:**

- register for a non-developer owner (JARGON, 93);
- misreading the request (MISREAD, 93);
- parallel sessions interfering through a shared checkout and the turn-end hook;
- destructive actions on shared state (OVERSTEP).

### Against the measured lane evidence on trunk

- **Stops for the owner.** [`run-outcomes-2026-09.md`](run-outcomes-2026-09.md) found most stops
  could be resolved from one fact the machine already had, plus a hand `to-build` step (median
  2h02m). Sessions show the owner's side of this: "why am I still in the loop" (f15e55ef),
  `needs-human` on a valid ticket (22f17e89), a bounce with an owner-only repair (acfe4b30).
  Several of those stops came from gates earlier Claude sessions built.
- **265 direct pushes to main.** Run-outcomes reads these as the owner judging the machine broken.
  The 30 "just fix it, straight to main" corrections are the same fact seen from sessions.
- **Discarded finished runs.** Run-outcomes counts 12 green runs thrown away at the pre-push rebase.
  Sessions show Claude first proposing to re-run (e4b0adce, 2405a741), and its best recoveries came
  after the owner refused.
- **No-op and useless lanes.** [`lane-census-2026-09.md`](lane-census-2026-09.md) found 57% of runs
  were no-ops and eight lanes did no useful work. This matches OVERBUILD and MACHINERY and the
  owner's "every ticket spawns 2 more tickets".
- **Review dropped every finding; Verify judged trunk.** These are the lane-level form of UNVERIFIED:
  a check that reports clean without checking the thing.
- **69 deleted tests.** [`merge-quality-2026-09.md`](merge-quality-2026-09.md) traces them to
  acceptance-author pushes; BROKE here records the restore.
- **26 contradictions, and prompts restating their machine twins.**
  [`rule-census-2026-09.md`](rule-census-2026-09.md) matches WRONG answers built from docs and ADR
  titles instead of code.
- **Costliest runs were exploration.** [`agent-context-2026-09.md`](agent-context-2026-09.md)
  matches sessions: Claude got it right after reading the source it had skipped.

### Against the guidance note (#655)

Weakness numbers are those in [`claude-leverage-guidance-2026-09.md`](claude-leverage-guidance-2026-09.md).

| Guidance weakness | Class here |
|---|---|
| W1 Grading its own work | UNVERIFIED; fixed by separate-context successes (59808751) |
| W2 Declaring done early | UNVERIFIED |
| W5 Prose rules followed only probabilistically | PREF repeats after CLAUDE.md rules; JARGON after the register rule |
| W7 Widening scope and overbuilding | OVERBUILD |
| W8 Misjudged effort | SLOW |
| W9 Parallel agents colliding | OTHER parallel sessions; BROKE 874e1478 |
| W10 Destructive actions | OVERSTEP |
| W11 Stating things confidently without checking | WRONG; UNVERIFIED state claims |
| W12 Stalling and stopping for input | UNDERDO |

Its strengths show here as DIAGNOSE (S3, tests and environment as ground truth) and recovery from
files (S4). JARGON has no counterpart in the guidance.

## Candidates

- **Rail the classes where prose failed.** Responses that were code held: reachability, the prose
  gate, stub dispatch, dependency caching, saving the run answer. Responses that were CLAUDE.md
  lines, memory files or in-session promises mostly did not: register, "don't ticket it", context,
  answering from stale state. The one exception is TECHQ after 08-27.
- **A rail for claims about current state.** No check covers "is it running", "is it built" or "is
  it still open". Every post-08-28 UNVERIFIED correction is one of these.
- **Every new gate names a repair path that is not the owner.** Three recent owner-in-the-loop
  corrections came from gates Claude added.
- **Lean on Claude for:**
  - diagnosis with logs in hand;
  - recovery from saved artifacts;
  - review by a separate context;
  - blunt assessment when explicitly asked.

  These are the success classes with the most examples and the fewest follow-up corrections.
- **Owner-facing output as its own concern.** JARGON is the largest class in period C (49), and
  nothing in the lane or rule research measures it.
- **Parallel sessions in one checkout.** Hook output from other sessions and shared-checkout merges
  both drew corrections, and one possible wiped edit is listed under Not verified.

## Not verified

- **Classification is judgement.** Twelve reader agents each classified one slice. No correction
  was double-coded, and there is no agreement measure. WRONG, UNVERIFIED, MISREAD and CONTEXT blur,
  and secondary classes were common.
- **Period A cannot be compared message for message with B and C.**
  - There is no Claude text, and prompts are cut near 200 characters.
  - Interrupts and denials were not captured.
  - The skip and noise counts are estimates (slices c02 to c04).
  - JARGON and OVERSTEP are probably undercounted there.
- **Periods with no transcripts:** March, 2026-05-22 to 07-27 (all of era 5) and 2026-08-04 to
  08-19. The eras narrative's era 5 and early era 6 claims could not be checked against sessions.
- **Successes are a sample.** 646 bare approvals were not classified. "Shipped with no later
  correction" was judged within the session, not checked against later git history.
- **"Did the response work"** is inferred from correction counts before and after a date. The
  numbers are small, and the work being done changed week to week.
- **Correction-to-commit linkage.** No session was joined to its commits. Undo and churn figures
  come from git keyword search and hand-reading why-messages, done separately.
- **Keyword tallies** (the mechanical cross-check and the success conditions) are unfiltered
  pattern matches.
- **36 long owner messages** were read truncated unless a reader opened the session.
- **Sessions from 2026-09-17** include live research sessions for this map.
- **Tool denials** include 4 false positives in slice c10 (a session searching for denial text).
- **A possible wiped edit.** A reader flagged that in 95fb6b0d (09-16) Claude reset the shared
  working copy to the remote, which may have discarded another session's unsaved edits. The owner
  did not raise it, and it was not checked.
