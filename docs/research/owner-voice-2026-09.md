# What the owner has asked for again and again, April to September 2026

Researches: #656

Child of map [#646](https://github.com/collod873/claude-workflow/issues/646); feeds its **Charter**.
Recorded 2026-09-17 against trunk `c5f15b1`. Source is the owner's own typing in 1,201 sessions
across the workflow-family projects, 2026-04-13 to 2026-09-17. Facts and candidates, no rulings.

Quotes are verbatim, typos kept, apostrophes straightened. Session ids are the first eight hex
characters. The full id is in the Knowledge-Base file name (`raw/sessions/<date>-<sid8>.md`) or the
transcript name (`~/.claude/projects/<dir>/<sid8>*.jsonl`).

## Summary

- **Five asks run through every era with a transcript:** ship faster, cut the ceremony, keep the
  owner out of the loop, talk to the owner in plain words, and never call work done without proof. Each
  was tagged in 160 to 220 of the 1,051 sessions that touch the machinery, in all three periods. The
  seven constraints in `CONTEXT.md` (C1 to C7) cover speed, ceremony and the owner's place in the
  loop. They touch plain talk only through C2 (never ask the owner what they can't answer) and say nothing
  about proof of done.
- **The quality ask is newer and quieter than the speed ask, but it is the owner's own end goal.** It
  shows up in 82 sessions: "spaghetti" in July, "I dont want it to be able to sprawl back out into
  spaghetti again" (09-03), and the 09-17 goal that opened this map. Speed shows up in 179, and the
  owner has always paired the two ("fast and high quality", 05-02; "really fast and good quality",
  09-17).
- **The owner's most repeated complaint is the machine breaking or going quiet, not the machine
  being wrong.** 300 frustrations were logged. The biggest groups are dead or broken machinery
  (about 66), Claude not reading or not listening (44), ceremony and sprawl (32), work called done
  that wasn't (28), and not being able to see what is running (27).
- **In September the owner often worked around their own pipeline.** 44 sessions from 09-03 to 09-17
  (about 1 in 12 of the Aug 21 to Sep 17 sessions) build a ticket by hand because "the whole
  pipeline isnt really ready still". This matches the 265 direct pushes counted in
  [run outcomes](run-outcomes-2026-09.md).
- **Several one-off rulings still shape the machine:** no auto-memory (05-21), GitHub as the
  tracker (08-21), hosted rather than on the owner's PC (08-22), the repo made public for free compute
  (08-27), no branch protection (08-27), the close gate refusing inside the agent's own turn
  (08-28), no prose in code (09-03), and no timing gate (09-03). The branch-protection veto sits
  across GitHub's native auto-merge, which needs required checks
  ([GitHub-native overlap](github-native-overlap-2026-09.md)).
- **The owner reversed course fastest on mechanisms Claude proposed and built:** the timing ratchet (one
  day), the standards chain after drains (one day), DESIGN.md (one day), scheduled upkeep (one
  day), GOAL.md (built 08-21, deleted 09-16). The owner's stances on where work runs, whether to reuse
  upstream, and how much to parallelise swung over months.

## How the corpus was read

**Sources.**

| Source | Sessions with owner text | Window |
|---|---|---|
| Knowledge-Base archive, `raw/sessions/*.md`, workflow-family projects | 839 | 2026-04-13 to 2026-09-10 |
| Raw transcripts in `~/.claude/projects/`, the Workflow and agents-skills directories, not already in the archive | 362 | 2026-08-21 to 2026-09-17 |

Projects kept: Workflow (352 sessions), Crewops (181), agents-skills and `~/.agents/skills` (145),
General (130), Knowledge-Base (128), Lumaria (115), Claude-Cockpit (84), Planning-System (36, the
era-4 spine repo; added beyond the ticket's list), General-Repo (30).

**Read in full: every owner message.** A script pulled the owner's text out of both sources. From the
archive it took `**User**` blocks, falling back to the `## User Prompts` list in the older format.
From the transcripts it took `type: user` text blocks, skipping tool results, `isMeta` records,
sidechains, local-command output, system reminders and task notifications. Slash commands kept
their arguments. Messages that were only a bare housekeeping command (`/clear`, `/model` and the
like) were dropped. Sessions run as `sdk-cli` (headless) were excluded, 16 in the Workflow
directory. A session in both sources was kept once, from whichever copy had more messages. That
left 6,588 messages (1.12 MB) in 12 chunks split by date. One subagent per chunk read its whole
chunk and returned themes, frustrations, positions and one-offs with session ids and dates. They
tagged themes against one shared list of 18 plus their own additions.

**Sampled: Claude's side.** Readers opened the source transcript around a message only when it was
terse or a reaction ("yes", "why is this so slow"), to learn what the owner was reacting to. Claude's
roughly 20 MB was not read. Two earlier distillations were checked afterwards against the findings,
not used as input: the deleted `GOAL.md` (`git show ef5bdee^:GOAL.md`, 7 constraints mined from
08-21 sessions) and a 25-value list in the owner's global config (`~/.claude/VALUES.md`, mined from
Jul 27 to Aug 27 messages, confirmed by the owner 08-27).

**Periods used for counts.**

| Period | Dates | Eras | Sessions with owner text | With machinery content |
|---|---|---|---|---|
| P1 | Apr 13 to May 21 | 2, 3, 4, 7 | 558 | 476 |
| P2 | Jul 18 to Aug 20 | 6 | 104 | 92 |
| P3 | Aug 21 to Sep 17 | 8, plus era-6 skills repo and Lumaria alongside | 539 | 483 |

**Gaps and limits.**

- **No transcripts from May 22 to Jul 17.** That covers all of era 5 (Sandcastle) and the start of
  era 6. Capture stopped 05-21, and the local transcripts begin 07-22. Era 5 appears here only through
  what the owner said about it later.
- **April and May prompts are cut at about 200 characters** by the old capture format. Long
  messages from that period are partial.
- **Pasted text was cut at 2,500 characters per message.** In every period much of the "owner" text
  is Claude output the owner carried from one session into another. Readers left relayed text out of the
  quotes and counted only the owner's own framing lines.
- **One extraction miss is known.** In `2026-05-20-c4c62e81.md` a pasted Markdown heading cut the
  prompt list short, so 8 prompts were missing. The reader recovered them from the file. No other
  archive file has that shape.
- **Counts are reader judgement, not keyword hits.** A session counts toward a theme when its
  reader judged the owner voiced it there. Some themes count one-liners ("main clean and synced?")
  as well as stated preferences, so compare counts within a theme across periods rather than
  between themes.

## Recurring themes

Counts are sessions, then the P1 / P2 / P3 split. "Honoured today" is checked against trunk and the
map's other research notes as of 2026-09-17.

| # | Theme | Sessions (P1/P2/P3) | Eras | Honoured today |
|---|---|---|---|---|
| 1 | Pick up where we left off, don't lose anything | 265 (157/9/98) | 2, 4, 6, 7, 8 | Partly |
| 2 | Less ceremony, fewer moving parts | 220 (96/16/108) | 2, 4, 6, 7, 8 | No |
| 3 | Talk plain, ask only what the owner can answer | 185 (69/14/102) | 2, 3, 4, 6, 7, 8 | Prose only |
| 4 | Trunk clean, in sync, green | 182 (53/18/111) | 2, 4, 6, 7, 8 | Partly |
| 5 | Speed, wall clock | 179 (67/10/102) | 4, 6, 7, 8 | Partly |
| 6 | Get the owner out of the loop | 173 (86/14/73) | 2, 4, 6, 7, 8 | Partly |
| 7 | Prove it before calling it done | 166 (97/12/57) | 2, 3, 4, 6, 7, 8 | Partly |
| 8 | One source of truth, no drift | 157 (75/14/68) | 2, 4, 6, 7, 8 | No |
| 9 | Owner decides scope and shape | 148 (62/23/63) | 2, 3, 4, 6, 7, 8 | Yes |
| 10 | Thin context, low cost | 145 (73/3/69) | 4, 6, 7, 8 | Partly |
| 11 | Find it yourself before asking | 141 (62/14/65) | 2, 3, 4, 6, 7, 8 | Prose only |
| 12 | See what is running and what is next | 129 (40/14/75) | 4, 6, 7, 8 | Partly |
| 13 | Unbiased, critical review | 126 (62/12/52) | 3, 4, 6, 7, 8 | Partly |
| 14 | Parallel work without collisions | 118 (50/8/60) | 2, 3, 4, 6, 7, 8 | Partly |
| 15 | Evidence before deciding | 103 (45/10/48) | 2, 3, 4, 6, 7, 8 | Yes, on this map |
| 16 | Enforce in code, not prose | 89 (32/12/45) | 2, 4, 6, 7, 8 | Partly |
| 17 | High-quality code, no spaghetti | 82 (31/12/39) | 3, 4, 6, 7, 8 | Partly |
| 18 | Reuse what exists before building | 76 (37/12/27) | 2, 3, 4, 6, 7, 8 | Changed, see below |

Smaller recurring themes the readers added: **the owner as courier**, carrying prompts and reports
between sessions and repos by hand (at least 40 tagged sessions in P1, and noted as the dominant
shape in every P3 chunk). **Ambitious, top-percentile answers** (26, P1 and P3). **Tracker hygiene**:
every recommendation tracked, stale tickets closed (18, P3). **Salvage a failed paid run instead of
re-running it** (9, P3). **ADR bloat** (11, P3). **No prose in code** (9, P3).

### 1. Pick up where we left off, don't lose anything

- 2026-04-19 1de83120: "give me a prompt that will start the next session, and end it will end the session where it gives me a prompt to start the one thereafter"
- 2026-05-21 d903af51: "if I closed this session now though would a new one understand all thats happening based on GH?"
- 2026-09-10 f303d286: "What is still left to close out this journey. And why do I keep needing to open with this same prompt?"
- 2026-09-17 3e76fc3a: "even Claude had some really good ideas here and there that I don't think got followed up on"

The P1 count is swollen by the copy-paste handoff prompt the owner asked for at the end of about 30
sessions. From May 21 continuity is meant to live in GitHub, not memory. **Honoured partly:**
`autoMemoryEnabled` is `false` in global settings and issues carry state. But 09-10 and 09-17 still
complain that multi-session goals stall and good ideas are lost. `session-captured` stopped on 09-09
(map #646, Lanes notes).

### 2. Less ceremony, fewer moving parts

- 2026-04-15 133856cc: "it feels like a mess to me and I dont understand how super powers had a few skills and we have 24 now..."
- 2026-05-20 c4c62e81: "My spine drives me a little nuts and I barely use it at this point."
- 2026-08-28 c8621079: "these are genuinely small things that running a to-spec on is huge for no reason"
- 2026-09-14 31ab1e12: "So the repo kinda self built all this needless complication basically and maybe we should just build something from scratch?"

**Not honoured at charting.** 4,309 lane runs in 14 days, 57% of the runs that ran were no-ops,
and eight lanes did no useful work ([lane census](lane-census-2026-09.md)). `docs/adr/` holds 199
ADRs and `.github/workflows/` 46 files. On the side of the ask: the small-ticket door (`to-build`)
exists, and GOAL.md plus 14 lane walkthroughs (about 66k words) were deleted 09-16 (`ef5bdee`).

### 3. Talk plain, ask only what the owner can answer

- 2026-04-17 21407d07: "im kinda astonished at how many times now you will ask me 10 questions at once"
- 2026-08-21 1966605f: "I dont even really know the answers anyway I cant determine what looks right im not a senior dev."
- 2026-09-11 b8841c68: "I dont know what is meant to be done next... and youre sending me walls of info"
- 2026-09-17 995b24a0: "Make sure I'm only really getting asked questions that are high level and confirming class or scope of things. I don't speak code"

**Prose only.** It sits in global `CLAUDE.md` ("Texting busy boss", "each with your rec") and in
map #646's Notes. Nothing enforces it, and the complaint is voiced in every period through 09-17.
The deleted GOAL.md's C2 covered only the "question the owner can't answer" half.

### 4. Trunk clean, in sync, green

- 2026-05-02 e3a077aa: "make sure nothing gets left dirty or no old dirty trees left hanging in this project from this sessino or others please"
- 2026-08-27 0b1d6646: "Get main all clean merged synced pushed pulled whatever you gotta do please"
- 2026-09-15 a2cf762d: "Why is main red? Lets make sure we are clean and in sync and nothing red"

Mostly end-of-session one-liners. **Honoured partly:** the pre-push gauntlet runs everywhere. But 17
of the 265 direct pushes turned Verify red on trunk, and the implement lane threw away 12 green
runs at its pre-push rebase ([run outcomes](run-outcomes-2026-09.md)).

### 5. Speed, wall clock

- 2026-04-23 3490489c: "I just want eeverything running like 10-50x faster. Even with this ridiculous ceremony I hop into the app and find problems on the work right away anyway."
- 2026-08-21 1966605f: "the target is always production speed. Wall clock time. I want to ship large repos like Lumaria fast."
- 2026-09-04 47cc8c54: "The reason I wanted the canaries was to run tests 100x faster and this is the slowest process ive ever seen"
- 2026-09-16 ab4481cf: "It shouldnt take this much to write a few tests that already have criteria. It should take a few minutes."

**Honoured partly.** Clean lane-merged tickets took a median 23 minutes from first lane label to
merge. But 29 of 51 waited more than five minutes on the hand `to-build` step (median 2h02m), and
the spec door's slicer finished green once in 11 runs ([run outcomes](run-outcomes-2026-09.md)).
Nothing gates on speed since timing stopped being a gate (09-03).

### 6. Get the owner out of the loop

- 2026-04-21 2ab48483: "I am going to walk away. You need to do all this without me."
- 2026-07-28 6738068b: "why am I ever needed to triage something"
- 2026-08-21 6db8c40b: "Do I even need to be in the loop at all or after it bounces through enough unbiased agents and checks things can just self resolve?"
- 2026-09-11 22f17e89: "Why did GH 402 instantly go to needs-human?? I am trying so hard to get out of the loop."

**Honoured partly.** Lanes run on GitHub without the owner. Still in the owner's hands: the `to-build` label, the
`needs-human` stops, and the children of #491 and #538, which the owner published by hand
([run outcomes](run-outcomes-2026-09.md)). Four limits recur: the owner still gates starts ("file that as a
ticket but don't fire off work on it", 09-13), they review after the fact on GitHub, they make the
architecture calls, and "bounded human, never none" (deleted GOAL.md C7).

### 7. Prove it before calling it done

- 2026-04-23 159b523f: "I am so confused on how we are keeping track of things. Everything says done, yet theres non verified work."
- 2026-07-28 e0623433: "how is claude running an entire day without catching any of these extremely major issues?"
- 2026-08-28 33523ea6: "I ship an entire PRD in the Workflow repo, and I find out afterwards that things dont work and arent connected."
- 2026-09-14 344d49c9: "so that we make sure when the ticket is closed we actually get a good result instead of just checking off the acceptance criteria"

Loudest in P1 (97 sessions), when checkboxes closed on shipped code rather than met criteria.
**Honoured partly:** `bin/close-ticket` runs each criterion's `check:` marker before closing. But the
repo ships an unregistered copy of the close gate that lets every `gh issue close` through
([rule census](rule-census-2026-09.md) M5), and whether a grep can verify a behaviour is an open
Rules question on #646.

### 8. One source of truth, no drift

- 2026-04-22 3b323a4d: "I thought my SPINE work was supposed to fix all that. But looks like a bunch of stale references still huh?"
- 2026-08-29 126370c0: "We keep trying to prevent this drift but whys it so difficult?"
- 2026-09-09 ae9aa1b8: "It keeps being a problem that we have this repo separate from the agent skills repo. Should we just merge them?"
- 2026-09-13 1450f397: "Im just very concerned with things drifting."

**Not honoured at charting:** 21 duplicate and 26 contradicting rules
([rule census](rule-census-2026-09.md)), and rebase-then-abort copied four times with four outcomes
([lane census](lane-census-2026-09.md)). On the side of the ask: agent-skills merged into Workflow
(09-09), and a drift gate for citations of retired ADRs and deleted files (09-16).

### 9. Owner decides scope and shape

- 2026-04-15 147139c9: "Wait until I sign off on what you are even suggesting."
- 2026-04-30 92eaf830: "On easy ones you can decide your rec, on bigger decisions I can decide."
- 2026-08-26 93703a54: "the things I actually wanted to weigh in on are more like the general architecture shape"
- 2026-09-12 2405a741: "Stop. We are not at a fully mutual understanding. We are 90% there."

**Honoured.** Grilling, wayfinder sign-off and the Charter gate on #646 all hold it. Two counter
signals: in grilling runs the owner mostly accepts the recommendation ("Your rec" across about 14 sessions
on 07-29), and they are indifferent to who writes an ADR (08-26 8f1e917d). What they guard is
destination and shape, not detail.

### 10. Thin context, low cost

- 2026-05-11 ccda894a: "Really everything that is auto loaded into context should be as lean as possible. And should suggest pointers for different types of work right?"
- 2026-08-27 270f9b97: "constantly im saying we should limit context into any 1 agent. That is an issue. that I frequently bring up"
- 2026-09-14 01cd603e: "Context injection is done to the highest limit in order to keep agent context low."

Cost in money is the one part that swings (see Changes of mind). Context size does not.
**Honoured partly:** project `CLAUDE.md` is 31 lines and global is 18. But each lane stage carries
about 24k tokens of fixed overhead, only the implement brief has a byte budget, and review injected
a 224 KB diff ([agent context](agent-context-2026-09.md)).

### 11. Find it yourself before asking

- 2026-04-27 6e60b2ae: "Bro stop guessing things, and actually figure it out. Why are you working so poorly right now? Why are you asking me to figure it out?"
- 2026-08-20 3b5e1ee8: "Look into the facts yourself first before asking me things"
- 2026-08-26 640bb39b: "First exhaust yourself in reading ADRs and open gh issues and wayfinder stuff"
- 2026-09-16 cf6b9393: "why were you going off of stale information from the start? Do you not know whats actually currently done?"

**Prose only:** global `CLAUDE.md` says "Never ask what the repo, code, or web can answer." The
complaint runs unchanged from April to 09-16.

### 12. See what is running and what is next

- 2026-04-14 736b532b: "I feel like you are constantly confused as to whether there are actively compiles running or not."
- 2026-08-30 d76b4c17: "I don't know what's fired what's waiting anything on GitHub mobile without digging through the actions page."
- 2026-09-12 663a3a54: "propose some better GitHub labels that make it obvious to me from a glance at my phone what is happening?"

Rises in P3, once work ran where the owner couldn't watch it. **Honoured partly:** pipeline-order labels and
a generated `docs/agents/lane-map.md`. But three lanes went dead with no one seeing it after
`session-captured` stopped (#646 Lanes notes), and 09-16 bc4dc71f says acceptance keeps no logs
while implement does.

### 13. Unbiased, critical review

- 2026-04-15 147139c9: "I dont trust the main sesh to grade its own decisions every time, heavy bias."
- 2026-05-02 138f646b: "if I had you run it, then judge it, then propose changes, then loop, you would be heavily biased."
- 2026-08-29 282526f5: "Assume the prior session's ideas are wrong until you've argued them."
- 2026-09-13 1450f397: "Be very critical. The work was done. You actually agree with how it did it?"

**Honoured partly:** a separate acceptance author and a Review lane (the eras page's W2). Review's
`path:line` filter dropped all the findings the model returned in 15 of 23 runs
([lane census](lane-census-2026-09.md), corrected 09-17).

### 14. Parallel work without collisions

- 2026-04-13 f8431d66: "im running multiple sessions at once and often running /clear and other things, so are we properly setup to handle that"
- 2026-08-26 874e1478: "Pause the subagent I have another session running and this is getting crazy with wrong overlaps."
- 2026-09-16 ca7a2c5c: "how hard to we want to push prevention like this, compared to just full sending it on all of them and letting landing do the hard work?"

**Honoured partly:** a live run holds a file (ADR-0199). But blocked-by edges held new tickets behind
the old ones they were meant to fix ("This is outrageous and it keeps happening", 09-16), and clean
runs were the ones with no live sibling on the same files ([run outcomes](run-outcomes-2026-09.md)).

### 15. Evidence before deciding

- 2026-04-14 88ce8de1: "Set clear definition of success, run small tests until you 100% pass"
- 2026-08-28 5ec30054: "Find every event in ONE real run by hand, with timestamps, before measuring anything at scale."
- 2026-09-03 e7b47ca4: "I think we need to stop theorizing and do things based on proof."
- 2026-09-17 995b24a0: "now that the repo is actually running we have evidence we have examples we can look into which runs actually work very well"

**Honoured on this map:** #646 runs research before its rulings. One counter signal is below under
Changes of mind (09-13).

### 16. Enforce in code, not prose

- 2026-04-13 e0dd7a65: "i dont want you to just manually fix this. The whole issue is we need systematic solutions."
- 2026-05-01 ce8d3209: "hooks seem like the pinnacle of development here"
- 2026-09-03 15485239: "Otherwise why and how would agents know to run it? Prose doesnt work."
- 2026-09-09 ae9aa1b8: "Is this the best idea easily sustainable not relying on like claude.md prose that doesnt get followed?"

**Honoured partly.** The direction is on trunk: rung placement (ADR-0193), hooks, the prose gate,
knip with no baseline. Many rules still live only in prose ([rule census](rule-census-2026-09.md)).

### 17. High-quality code, no spaghetti

- 2026-07-28 957ee3fc: "what about like spaghetti code being in repo somewhere or things just done poorly idk how to describe it since im not a real dev"
- 2026-09-03 15485239: "I want to get this cleaned up now, and I dont want it to be able to sprawl back out into spaghetti again."
- 2026-09-14 01cd603e: "Things are as simple as possible yet work. Our standards of code is upheld."
- 2026-09-17 3e76fc3a: "keep the system from falling apart or building itself to spaghetti etc which seems like what happened in this repo"

Always paired with speed: "quick cheap parallel subagents that still deliver top tier quality work
fast?" (04-28 eb4f6186). **Honoured partly:** the gauntlet holds knip, the clone gate and the prose
gate, and no merged change on any route was reverted ([merge quality](merge-quality-2026-09.md)).
The owner's own verdict on 09-17 is that the repo turned to spaghetti anyway.

### 18. Reuse what exists before building

- 2026-04-14 3155923d: "cant you also kinda just pull those agents from the super power project or why are you building from scratch?"
- 2026-05-20 c4c62e81: "Why would we build our own from scratch vs just use his?" (an upstream skills author)
- 2026-08-20 fee4f5c8: "Why did we create those instead of using code review ?"
- 2026-09-09 ae9aa1b8: (paraphrase) upstream updates rarely land and the local copies have drifted too far, so the owner would rather own the skills outright.

**Changed:** see Changes of mind. GitHub's own auto-merge is available and off, with no required
checks set up ([GitHub-native overlap](github-native-overlap-2026-09.md)).

## Stated once but load-bearing

| Date · session | Said | What it set, and what depended on it or broke it |
|---|---|---|
| 2026-04-13 92210e04 | (paraphrase) the permission-bypass hook must not auto-answer question popups or plan exits | Automation never answers the owner's decision points. `auto-approve-permissions.py` still ships in `.claude/hooks/`. It broke once first (d852f5d8, a popup answered itself). |
| 2026-04-23 159b523f | "Everything says done, yet theres non verified work." | Done means criteria met, not code shipped. It is the root of the close gate's criteria check (eras page W1 lineage). It recurred 04-28 and 08-26 ("How many times have we said the capture hook is fully done", 6d36e363). |
| 2026-04-28 57b238d8 | "we want a really thin claude.md, really thin rules, but they point at the bigger documents or files when needed? Then hooks to reinforce" | The context layout still in use: 31-line project `CLAUDE.md` that points elsewhere. |
| 2026-05-12 35bc1a6d | "I am not going to use anthropic API keys anywhere. I dont like that method." | Subscription auth only. Lanes run on the subscription token ([lane census](lane-census-2026-09.md)). Fixes that assumed paid credits were refused (05-15 e52d3bef). |
| 2026-05-14 dbc0ea7d | "Arent commits basically a change log?" | No changelog. Commit messages carry the why (project `CLAUDE.md`). |
| 2026-05-20 e046a4e6 | "I want to be able to spend my time making PRDs, making issues, then automa[te]" | First statement of the spec door. Sandcastle (era 5), then the GitHub lanes (era 8), followed. |
| 2026-05-21 b339ce46 | "We dont use memory. Dont do that." | `autoMemoryEnabled: false`. Continuity moves to GitHub. Restated 09-10 ("auto-memory is even worse its a nightmare"). |
| 2026-05-21 b339ce46 | "I dont like deferring things and I like to just try what we can assume is the best way first." | No phased or deferred plans. The same instinct shows in "Why do we defer items like that instead of fix?" (05-12) and "Wait why did you file a ticket instead of just fixing it ?" (09-04). |
| 2026-08-21 bf28ab41 | "let's lock in GitHub as always being the spec and issues tracker" | Tracker ruling for era 8. |
| 2026-08-22 502eaeba | "Github hosted for everything youre still not understanding I DONT WANT IT ON MY COMPUTER." | Hosted lanes. GOAL.md recorded this as an owner override of Claude's recommendation (ADR-0002). |
| 2026-08-27 f3d64361 | "The repo is just for me. Public is just to get the compute time free." | The repo went public. Session transcripts left it, and research here must stay free of personal text. |
| 2026-08-27 1c8e0e4c | "I'm not buying branch protection stop bringing that up ever." | Softened the same day to "ignore for now" (e56fe7bc). It still bears on the Lanes question: native auto-merge waits on required checks, and none exist. |
| 2026-08-28 d271813b | "Should we have the GH Actions workflow work the same way, where its instant feedback for the agent that is trying to close an issue" | Close refusal happens inside the agent's own turn in both venues (ADR-0088). The cost stated at the time: closes from web or phone go unjudged. |
| 2026-08-28 c8621079 | "these are genuinely small things that running a to-spec on is huge for no reason" | The small door (`to-build`), today's ticket door. Its hand label step is the 2h02m median wait in [run outcomes](run-outcomes-2026-09.md). |
| 2026-08-30 e1907add | "I think just decide and log it. I'll see it one way or another" | The spec critic stops asking and writes an assumptions log. Consistent with theme 3. |
| 2026-09-03 bfce9298 | "I think maybe we should just remove all prose from this whole repo in any code files or tests etc..." | ADR-0151 and `prose-gate.test.ts`, now in project `CLAUDE.md`. First voiced 09-04 as "only text or markdown type files have comments" (37dd1d47). |
| 2026-09-03 1070ca88 | "Decision: timing is no longer a gate, anywhere." | Removes the timing ratchet built the day before (ADR-0147 reversed). Speed now has no gate (theme 5). |
| 2026-09-12 2405a741 | "When the ceremony slows us down without actually potentially helping anything and you can just things fixed and to main please just get it done fast" | Standing permission to skip the pipeline for small fixes. Candidate cause of the 265 direct pushes. |
| 2026-09-13 1643af3e | "I want to start focusing on 1 lane at a time and optimizing each lane rather than going around in circles like this" | Lane-by-lane teardown, starting with the `to-build` door and acceptance. |
| 2026-09-14 01cd603e | "Things are as simple as possible yet work. Our standards of code is upheld. Context injection is done to the highest limit in order to keep agent context low." | The owner's definition of ambition. Restated 09-16 and 09-17. |
| 2026-09-17 3e76fc3a | "I want a system that leverages claudes strengths and weaknesses to take things that i want done and implement it very fast and very high quality code. Thats basically it." | The end goal behind map #646 and this ticket. |

## Changes of mind

| Topic | Earlier | Later |
|---|---|---|
| Cost in money | 04-13 89748d92: "I aint worried about credits. I just want results" | 04-15 557959e4: "absolutely eating through my weekly usage allowance faster than I imagined". Then back: 08-26 874e1478: "I think not worry about cost at all. If I start using the system and its burning costs i will notice." It swings on whether a usage limit is being hit. |
| Scheduled upkeep | 05-01 5d40fadf: "We usually just schedule crons or something I feel like for this type of thing" | 05-02 1a40d0ae: "I dont wanna schedule anything I would like to just do it in sessions". Stable since: 08-21 6db8c40b "I dont want a time based cadence", 08-28 7e870138 "i dont like that shape with weekly cron". |
| Auto-memory | 05-21 dd47ac94 (14:46): "Do other people turn memory off? It seems almost like a shot in the foot" | 05-21 b339ce46 (17:46): "We dont use memory. Dont do that." Stable. |
| Where the machine runs | 05-21 b339ce46: (paraphrase) free GitHub and the existing subscription only, local orchestration, no CI with an API key. Era 5 then ran on Actions and was retired 07-02, and era 6 ran locally. | 08-22 502eaeba: "Github hosted for everything". In September the owner works by hand in the terminal because "i would consider the pipeline broken right now" (09-03 15485239). That is behaviour, not a new stance. |
| Upstream skills | 04-22 86c6af89: mostly adopt superpowers. 05-21 b339ce46: "download most of those as is without making any customization" | 09-09 ae9aa1b8: (paraphrase) stop tracking upstream and own the skills. |
| Standards pass after drains | 08-20 2fcc72eb: "drain can merge to main then run the standard workflow" | 08-21 81a731fe: "just make the skill manual and not run at the end of drains" (agent-skills ADR-0029). |
| DESIGN.md | 08-26 35ac7538: "Update design.md and file gh issue" | 08-27 eca4b9a8: "I really really want to delete the design.md at this point. Its stale and keeps miss steering us." Deleted `a2643a2`. |
| GOAL.md | 08-21 e7b45395: "what would you say our supreme dream goal is?", which produced the charter | 09-16 5ffb4b1e: "I'd rather Just delete GOAL.md its stale as heck and we dont look at it anymore." Deleted `ef5bdee`; C1 to C7 survive in `CONTEXT.md`. |
| Timing as a gate | 09-02: accepted the timing ratchet (#335, relayed rulings 1b40f5bc, 07823d8b) | 09-03 1070ca88: "Decision: timing is no longer a gate, anywhere." |
| Human checkpoint before building | 04-15 147139c9: "Wait until I sign off on what you are even suggesting." 05-21 1df2894a: "DONT start wave 2 until I say you can" | 08-21 1966605f: "dont even need the human checkpoint. I will see the tickets in github before i /drain anyway". The gate moved from reviewing slices to starting work: 09-13 9cfa66c3 "file that as a ticket but don't fire off work on it". |
| Catch problems after, or design ahead | 08-26 9d91b5ec: "Then if its actually worth doing the two lenses finds it anyway." (cut the pre-merge warden) | 08-28 29935f9c: "Just launch them all unaware... Catch it all after?" (doubting it at 40 tickets of cleanup) |
| Parallelism | 04-22 52b4fe1d: "Can we try /build C E and F in true parallel?" | 08-21 1966605f: "im wondering if the parallelism is even helping anything at all". 08-29 00bcf72a: "i think parallel is the point". 09-16 ca7a2c5c: questions blocked-by edges altogether. Unsettled. |
| Subagents for judgement | 04-14 3155923d: "I think we just shouldnt trust agents for this I think a main session like yourself needs to read everything line for line" | 04-21 2ab48483: "Use subagents when you need unbiased info." From May on, cheap subagents do the work and the main session judges (05-14 02b20ca5). |
| Measure or decide | 09-05 c9b518e2: "Push and measure to see the change" | 09-13 1643af3e: "I dont think I need you to measure it I think you have enough context to make a big thorough smart decision". 09-17 995b24a0 then launched evidence-first research. |
| PRs | 08-26 a01853af: "why did we have so many other sessions forcing PR saying we need PR bla bla PR" | 09-12 2405a741: "The point of PRs is that they get merged to Maine or whatever automatically". 09-14 344d49c9: pipeline work belongs on a branch. Hand work stays "No PR. straight to main" (09-16). The split looks settled: lanes use PRs, hand work goes straight to main. |
| ADRs | 05-21 a0e09083: "What is the point of ADRs?" Then 08-21 14b643d1: set the repo up for ADRs from day one | 09-04 4b91f060: "Basically every small decision ever seems to get recorded". 09-16 95fb6b0d: "our ADRs right now seem too easy to reverse, because they constantly get amended or superseded. so its like what is even the point of them?" |
| Knowledge base | 04-13 d77f19c3: compile after every session "keeps things the richest" | 05-14 cb2a1ecc: "I am starting to hate the knowledge base system". 08-20 91c06ca6: "I dont use knowledge base anymore. I dont read it." |

## Frustrations with the machine

300 frustrations were logged across the 12 chunks, 17 to 33 per chunk. They were sorted by keyword
into kinds, so the counts are approximate, and one entry counts once.

| Kind | About | Months | Examples |
|---|---|---|---|
| Machinery broken, dead or misfiring | 66 | every month | Hooks not firing or failing on every edit (04-13, 08-28, 09-15). A label that doesn't start its run (08-30 d76b4c17 "the to-spec label is completely broken too"). A dead PRD run (09-16 0e99f04b). "i would consider the pipeline broken right now" (09-03). |
| Claude didn't read, didn't listen, guessed or drifted | 44 | every month | "LOOK AT IT DONT ASK ME LOOK AT REFACTOR" (04-29 f8980e4c). "Youre digging into lumaria stuff and im just trying to answer like our 3 tech questions..." (08-21 b4596a6f). "Hold up. Dont make more changes. We dont put comments in code anymore." (09-04 0a91480d). |
| Ceremony, overbuilt plans, sprawl, ADR bloat | 32 | Apr, May, Jul, Aug, Sep | "Is this not an insanely ridiculous plan for something that should be simple?" (04-28 fedc8d5e). "Is this just showing that this skill is extremely broken and taxing? This is INSANE!!!!" (07-29 8f951b7c). "Theres way too many for any agent to ever read..." (09-04, ADRs). |
| Called done when it wasn't; fake green | 28 | heaviest in Apr, again in Aug | "This system is making me delirious" (04-23 0c7c97a2). "How many times have we said the capture hook is fully done and working now???" (08-26). A stop-contract slot that checked nothing for 184 runs (08-28, relayed). |
| Can't see what is running, stuck or next | 27 | every month | "Did it freeze? Continue" (04-15). "It says shell running for 4 hours" (05-14). "are you sure its running?" (08-23). "Why do the blocked ones say running?" (09-11). |
| Too slow | 22 | every month | "This is taking extremely super duper long for just a few slices." (04-20). "We need to stop doing hour long tests when things are likely broken" (05-13). "It's a pain right now for real. Why does it take longer than implement?" (09-14, acceptance lane). |
| Pulled back into the loop; hand relays | 21 | every month, most in Sep | "I am actually getting tired of going back and forth between crewops and claude-ds." (05-21). "Why is this failed issue landing on my plate." (09-12). "Why do I need to find and fix the bounce ? This is unacceptable" (09-13). |
| Gates too strict, flaky or refusing done work | 17 | Aug, Sep | "The checker actually pisses me off it constantly messes things up just because the boxes werent checked properly" (08-27). "I'm getting tired of the strict gates stopping clearly done work from landing" (09-04). "I hate flaky tests I'd rather just get rid of them" (09-16). |
| Drift, duplicates, stale docs | 17 | Apr, Aug, Sep | "I thought my SPINE work was supposed to fix all that." (04-22). "Why is there divergence between ticket-shape.ts and bin/ticket_shape.py ??" (09-13). |
| Parallel work colliding; blocked-by edges | 12 | Apr, Jul, Aug, Sep | "Wait i closed out the first one but theyre still all blocked ?" (09-13). "This is outrageous and it keeps happening." (09-16). |
| Paid work lost; re-running whole runs | 7 | Apr, Jul, Aug | "Theres gotta be away to recover that comp[leted work" (08-29). "I do not want to repay for the full ticket again." (09-12). |
| Token or usage burn | 7 | Apr, May, Aug | "why are you at 123k token usage despite you not really doing any of the work ??" (08-20, /drain). |

Two patterns cut across the kinds:

- **A fix that did not stick.** "tell me why the HELL WE STILL HAVE THIS BIG OF A DIVERGENCE?????"
  (05-06). "I thought we put a fix in place for this." (09-16). "I feel like I have seen us go
  between -r and -R a hundred times now always back and forth" (09-14). This matches the eras
  page's F3, where fixes move the problem elsewhere.
- **The machine as its own biggest customer.** "Am i getting carried away with meta work within
  meta work?" (07-29). "Am I just chasing meta right now and should just finish pushing through?"
  (09-02). "despite me trying to be very hands on ... great ideas and great rails and systems but I
  think they're mixed in with a lot of crap" (09-17). This matches the eras page's F2.

## Candidates the record supports

These are facts about coverage, not rulings. The deleted GOAL.md constraints, still in `CONTEXT.md`
as C1 to C7, map like this: C1 and C4 onto themes 2 and 5, C7 onto 6 and 9, C5 onto 12, C3 onto
the scheduling position and C6 onto short sessions. C2 covers part of themes 3 and 11. Five things
recur that no constraint names:

- plain-language talk to a non-developer, beyond "no quiz" (theme 3)
- proof before done (theme 7)
- one source of truth (theme 8)
- thin context per agent (theme 10)
- code quality that holds up as automation grows (theme 17), which is half of the 09-17 end goal

`~/.claude/VALUES.md` covers themes 3, 5, 6 and 11 directly. It was mined only from Jul 27 to Aug 27
and has no April or May evidence.

## Not verified

- **Theme counts depend on 12 separate readers,** each judging whether the owner voiced a theme in a
  session. Nobody re-read a chunk to check agreement, so counts may be off by a margin that wasn't
  measured.
- **Quotes were extracted by the readers.** 34 were spot-checked word for word against the extracted
  owner text or the archive file, and all were found (curly apostrophes aside). The rest were not
  checked one by one.
- **The frustration kinds come from keyword sorting** of the readers' one-line category labels, not a
  hand classification. The "broken or dead machinery" group is the remainder after the other
  patterns matched.
- **Era 5 (Jun 8 to Jul 2) has no owner transcript,** so no theme can be confirmed or ruled out for
  it. Any statement here about era 5 is inferred from later sessions.
- **April and May quotes may be the start of a longer message** cut at about 200 characters, and a
  few may carry different meaning in full.
- **Sessions another agent launched with a hand-written prompt** (not `sdk-cli`) could not be told
  apart from owner sessions when they ran interactively. Readers flagged generated-looking prompts
  and left them out of quotes, but some may still be counted.
- **The "Honoured today" column comes from the map's other research notes** and a trunk check on
  2026-09-17 (settings, file counts, `CONTEXT.md`, git history). Lane behaviour moves daily.
  Re-check before acting.
- **The 09-16 claim that acceptance keeps no logs while implement does** comes from the owner's
  message, not from the lane code.
