# What standing rules the owner set, 2026-10-03 to 2026-10-07

Researches: [#1227](https://github.com/collod873/claude-workflow/issues/1227)

Child of [#1226](https://github.com/collod873/claude-workflow/issues/1226). Recorded 2026-10-07.
Source is the owner's own typing in 54 sessions across Workflow, Lumaria and agent-hooks. The
baseline is [What the owner has asked for again and again](https://github.com/collod873/claude-workflow/issues/656)
(`git show 1a07695^:docs/research/owner-voice-2026-09.md`, called "the baseline" below, with its
themes numbered as there) and the Notes of [#646](https://github.com/collod873/claude-workflow/issues/646).
Facts and candidates for the owner to confirm, no rulings.

Quotes are verbatim, typos kept, apostrophes straightened. Session ids are the first eight hex characters; the full id is the
transcript name, `~/.claude/projects/<dir>/<sid8>*.jsonl`. Counts are owner messages, then distinct
sessions, inside the five-day window.

## Summary

- **The most repeated new rule is "prove it with a short test first".** Five times in five
  sessions the owner asked for quick runs under 10 seconds, 30 seconds or a minute to prove a
  problem before fixing it. Nothing in the baseline or #646 names that method.
- **Waits must be short and wake to check.** Four messages in three sessions reject long sleeps
  (a 30-minute `bin/land` wait, a 20-minute cap) in favour of a short wait that checks and waits
  again, and he calls it "a recurring problem that comes up across all of my repos".
- **Global first, one name per thing, and every fix covers repos that enrol later.** Shared tools
  and hooks are promoted to the global hooks repo, the repo copy is deleted in the same change, and
  each fix is asked to cover future enrolled repos (4 times in 4 sessions).
- **He is tired of repeating himself**: "the same conversation 10 times with fresh agents" (10-07),
  "im getting sick of saying how this system should operate" (10-07), "I dont understand whats
  getting relitigated" (10-07). That is why this ticket exists.
- **One real contradiction with a written rule:** #646 and `CONTEXT.md`'s **Meter** say every new
  rule enters as a meter, but on 10-06 the owner asked for gates or hooks "rather than limiting it to
  a hopeful prompt". The same evening he declined a test gate for `needs-human`. Which wins is his
  call.

## New rules

Not in the baseline or #646's Notes. Each is a candidate for the owner to confirm.

### N1. Prove a problem with short test runs before fixing it

Repeated 5 times, 5 sessions, 10-06 and 10-07.

| Date | Session | Owner |
|---|---|---|
| 2026-10-06 | 51b76857 | "do short quick tests under 10s each to iterate and prove the problems then implement the fixes" |
| 2026-10-06 | 4984c715 | "Run very fast quick iterations and tests to research or decide things? Like a large paremeter of like 10 second tests or something?" |
| 2026-10-07 | 48440900 | "Do we need quick parameter iteration tests on that first or just ship it" |
| 2026-10-07 | 95247cdf | "Try quick parameter iterations first under 1 min if possible" |
| 2026-10-07 | 549c5746 | "Quick diagnostic please, fast quick research and short tests under 30 seconds of paremeters to figure it out" |

Related: "You can do quick evals of real couple recent sessions for proof rather than just trusting
code." (2026-10-07, 49b12fef). Baseline theme 15 (evidence before deciding) is the parent; the
short-run method is new.

### N2. A wait is short and wakes to check, never a long sleep

Repeated 4 times, 3 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-06 | f0eed9f2 | "should we chang ethe bin land wait to like a few minutes wait? Id rather it do it shorter in case something wrong happens it wakes and checks then can just wait again if its still running fine?" |
| 2026-10-06 | f0eed9f2 | "The agent is just waiting for 30 minutes but something happened like an error or a stall or already merged at like 5 minutes, might that be possible?" |
| 2026-10-07 | 4d447201 | "Can you check every 5 minutes or so to make sure nothing stalls until all the work is done thats building? fix things if stalled." |
| 2026-10-07 | 95247cdf | "there is hardly ever any script that will run anywhere close to 20 minutes. Wouldn't it always be better to have more like a very short one where the agent wakes more ... Like maybe the 20 minute cap is still way too long ... This seems like a recurring problem that comes up across all of my repos and different types of work." |

### N3. Run long work in the background, and keep working while it runs

Stated once, 2026-10-07, 95247cdf: "when things are ran in the background, which I asked for
specifically, I think, in my terminal sessions, because it allows me to still send messages to the
agent ... the agent likes to just start a background task, end its turn, and sit there without
doing anything. Maybe... A very concise message prodding it to multitask". The same session
(2026-10-07) flags the machine's side: agents in GitHub Actions that "fire off things like
sub-agents themselves, or if they do any long tests ... they're waiting then that seems to be
problematic".

### N4. Tests catch problems for the builder early; they do not gate work later

Repeated 5 times, 3 sessions. The owner says he has said it before ("sick of saying").

| Date | Session | Owner |
|---|---|---|
| 2026-10-06 | 898b2ffc | "i thought we built in this whole system that would make bin check run within a few seconds? It would only check newly edited files?" |
| 2026-10-06 | df55ef83 | "now rerunning checks should take seconds and runa gainst receipts no?" |
| 2026-10-07 | 48440900 | "shouldnt there be a much better idea like just fix the test hook where it skips runs it already did?" |
| 2026-10-07 | 48440900 | "We have discussed this many times in many sessions in this repo and im getting sick of saying how this system should operate with this. I have already said how the tests should catch stuff soon for the builder himself, not gate work later." |
| 2026-10-07 | 48440900 | "I think the check gate is not supposed to run full length so many times" |

### N5. No issue sits open waiting on the owner

Repeated 3 times, 3 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-04 | a26a6553 | "Lets just close the issue and post a reminder as another issue? i dont really wanna build stuff just for the check in" |
| 2026-10-07 | be7b8916 | "I don't want GitHub issues sitting open waiting for something for me to do. Either figure out how to do it without me or close the issue." |
| 2026-10-07 | 549c5746 | "i just really dont want 1164 open anymore we either need to close it or prove it extremely quickly somehow." |

A sharper form of baseline theme 6 (owner out of the loop).

### N6. Shared tooling is global; promoting it deletes the repo copy; one name per thing

Repeated 7 times, 4 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-03 | 39d8443e | "We don't want a bunch of duplicates of the workflow ones though if those should just be global right?" |
| 2026-10-03 | 39d8443e | "Yes but making each global should include the workflow deletion I think not an extra step" |
| 2026-10-03 | 39d8443e | "I would just think it'd be nice if one gets improvements the others do. That's why I like global things" |
| 2026-10-04 | 210251dd | "I dont want confusing names i want everything pruned and simplified to be as simple as possible and unified yet also improved, work better, improve ai agent usage." |
| 2026-10-05 | ea21dc9a | "Ok i am currently making workflow-sync a global one." |
| 2026-10-05 | ea21dc9a | "ok i just made the 2 tools global now too." |
| 2026-10-06 | 898b2ffc | "this change shouldve been made yesterday in the hooks repo and shoul dbe applied to workflow and to lumaria" |

Baseline themes 8 (one source of truth) and 18 (reuse) are the parents; global-first is new.

### N7. Every fix covers repos that enrol later

Repeated 4 times, 4 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-05 | 4cb1cdd2 | "What is the simplest way to do this? Expecting other repos will need this eventually to?" |
| 2026-10-06 | 898b2ffc | "Is there a way we could enforce this with gates or hooks overall rather than limiting it to a hopeful prompt? Or when repos enrol to check for this issue ahead of time?" |
| 2026-10-06 | 51b76857 | "One more question, how do we prevent that on new repos that enrol?" |
| 2026-10-07 | e1139cc6 | "How do we keep these from driftng. How do we keep it from drifting in new repos when they get enrolled. How can we keep this system quite simple." |

### N8. Terminal and GitHub workflows run the same methods

Repeated 5 times, 5 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-04 | 210251dd | "Remembering that this needs to be able to run both in terminal and in github workflows." |
| 2026-10-05 | ea21dc9a | "Lumaria will need to file tickets, update them, close them, etc from both terminal and github workflows in ways that aligns with the workflow repo methods" |
| 2026-10-06 | f0eed9f2 | "We file tickets and fixes and PRs, both from in terminal live sessions by hand, and from the pipeline. How does each get filed and merged?" |
| 2026-10-06 | 898b2ffc | "Also what about doing stuff from terminal and using bin/land, or if i did a few individual tickets at once, are those not so much concerns?" |
| 2026-10-07 | e1139cc6 | "does this run the same way in the workflow repo itself? It doesnt get the claude.md and other same settings and resources?" |

### N9. No new paid runners and no spending cap

Repeated 3 times, 2 sessions (runners twice, spending cap once).

| Date | Session | Owner |
|---|---|---|
| 2026-10-05 | ea21dc9a | "Please no spending cap ever idk why that even came up or is on there." |
| 2026-10-07 | 95247cdf | "I am not going to run the machine from my PC, and I am not going to pay for any new types of runners. Those are lazy solutions. I want smart, ambitious solutions." |
| 2026-10-07 | 95247cdf | "I am not going to pay for more or different runner systems unless those would make a massive difference." |

The "not on my PC" half is restated (R5); the runner and spending-cap halves are new. See C3 for
the softening between the two 10-07 lines.

### N10. Continue from the raw session transcript, not a handoff

Repeated 7 times, 6 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-06 | 898b2ffc, df55ef83 | "whats the path to session capture transcript of this?" (same line in both) |
| 2026-10-06 | 4984c715 | "Read these 2 session transcripts." |
| 2026-10-07 | 4984c715 | "whats your transcript file path from session capture?" |
| 2026-10-07 | 48440900 | "Read this transcript" |
| 2026-10-07 | 95247cdf | "Maybe i should end this session and have a fresh agent read the session capture in order to continue." |
| 2026-10-07 | 8e9aae7c | "I didnt read that handoff but im not sure I should trust that previous agents writing bias for it. maybe you should read its pared down session capture transcript before I run wayfinder to be critical and lean more into my words." |

### N11. A session's context budget is about 130k tokens; split research out to stay under it

Repeated 2 times, 1 session, 2026-10-07, 95247cdf: "The quality of Claude will degrade around
130,000 tokens that seems like a safe number that is why I suggest breaking out research on its own"
and "I think your context this session is already toast you are at 245k tokens I dont think your
reasoning is there right now". Baseline theme 10 (thin context) is the parent; the number is new.

### N12. Run history counts only since the last change to what it measures

Repeated 2 times, 2 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-03 | 718d7f3b | "Do we need meters of things that we already have back history on? Or is back history irrelevant since the whole pipeline changes by the day" |
| 2026-10-07 | 95247cdf | "we can't look at one thing for the past 10 or 20 runs and average it out because we might have already changed it five runs ago and now there are recent runs with current information that needs to be realized for any history or back research that we do" |

Extends #646's "Research goes stale in days" from findings to run history.

### N13. A spec is built in waves that hand names and decisions forward, one spec at a time

Repeated 3 times, 2 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-06 | d40d81d9 | "I would assume the specs might collide though and should go 1 at a time cause they'll build on one another just assuming" |
| 2026-10-06 | d40d81d9 | "Does that show a gap in our machine we don't have a way to do specs in waves?" |
| 2026-10-06 | df55ef83 | "Theres no way to plan a spec that has 40 tickets all out ahead of time. They will hit tons of file conflicts, they will build the same things, they will build on assumptions. The waves are meant to build stuff that others are able to reuse and build on, which includes not only files but decisions. The wave checks are to make sure that things are getting built well and properly according to what I wanted. And also presents an opportunity to name files and decisions and things that the following waves need to know" |

#646's "Waves everywhere" covers build maps; this is the same idea applied inside a spec.

### N14. The owner pauses anything with one control and resumes it the same way

Repeated 3 times, 3 sessions. Now built as **Paused** in `CONTEXT.md`.

| Date | Session | Owner |
|---|---|---|
| 2026-10-06 | 898b2ffc | "can we please pause the current open spec as soon as the current ticket lands?" |
| 2026-10-06 | 4093d743 | "if anything is running and I want it to pause, how am I supposed to pause it, and how to resume it? For tickets, specs, PRs? figure it out thoroughly dont guess." |
| 2026-10-07 | 48440900 | "can we pause the 902 pr so the next wave doesnt fire but let 936 finish landing?" |

### N15. `needs-human` goes; a held label is a last resort; nothing closes unbuilt work

Repeated 4 times, 2 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-03 | 718d7f3b | "I honestly dont even know what needs-human is for we need a larger zoomed out executive call on that label it kinda just got thrown in." |
| 2026-10-06 | 4093d743 | "is needs-human even the right label? I thought we talked about deleting that label countless times. But it keeps getting brought back i think agents really like that label title or something." |
| 2026-10-06 | 4093d743 | "I dont think it should close something unbuilt I wont be able to find it. I think a label is the right move, but more like last resort right?" |
| 2026-10-06 | 4093d743 | "i don tthink we need a test to block needs-human i think if we jus thave the right system in place, it wont come back into existence by default." |

### N16. Don't touch work another session owns

Repeated 2 times, 2 sessions.

| Date | Session | Owner |
|---|---|---|
| 2026-10-05 | ea21dc9a | "Bro i already had the session fix it dont just start doing stuff from other sessions..." |
| 2026-10-06 | 898b2ffc | "Yeah i have done a few pauses and resume since then dont touch stuff just look" |

### N17. Answer with two better ideas and one divergent one

Repeated 4 times, 4 sessions. The form of baseline's "ambitious, top-percentile answers".

| Date | Session | Owner |
|---|---|---|
| 2026-10-04 | 210251dd | "Be very ambitious, give me the best possible plan, you can diverge, think new, improve old, give me your top 2 ideas then give me one that surpasses that." |
| 2026-10-05 | 4cb1cdd2 | "A few divergent ideas and a few better ideas." |
| 2026-10-06 | df55ef83 | "Give me 2 better ideas and one divergence" |
| 2026-10-06 | 898b2ffc | "Give me 2 better ideas and one divergence" |

### N18. Smaller ones, stated once or twice

| Rule | Date | Session | Owner |
|---|---|---|---|
| The orchestrating session runs the tests; its subagents do not | 2026-10-04 | 210251dd | "Can you have agents do this very fast in parallel they are not to run tests you are to orchestrate and run the tests" |
| app-starter is not maintained for now | 2026-10-04 | c73dd075 | "App-starter is junk. Its just a stale copy of Lumaria ... I dont want to maintain it until lumaria is actually in a better position to duplicate and use as a template." (also 10-03, 39d8443e: "don't file anything for app starter") |
| Do the work, then update the tickets | 2026-10-04 | 2c065fe2 | "no that sequence doesnt make sense. Do your work now. THen we will update issues after." |
| Walk through real scenarios before settling a plan | 2026-10-03 | 39d8443e | "Can you please think a better optimized plan for me and actually walkthrough user scenarios?" (again 10-06, df55ef83: "just trying to think through the different types of scenarios and see if this idea presents problems for them.") |
| A described goal is not a request for a spec | 2026-10-07 | 95247cdf | "I am not asking you to write a spec right now. This is just a thinking session." and "I already told you there's no spec in mind that I want to file." |
| Public logs are fine unless there is a real concern | 2026-10-07 | 95247cdf | "I think I am OK with a lot of the info from that living in logs or being public, but I just don't want to shoot myself in the foot, if there is a real concern to be considered" |

## Restated rules

Already in the baseline (theme number in brackets) or #646's Notes, said again in the window.
Counts are messages / sessions in the five days. R1 and R2 are keyword hits on simple/prune and fast/slow/speed, read for sense but not each judged; the rest were judged one by one.

| # | Rule | Repeated | Representative quote | Date | Session |
|---|---|---|---|---|---|
| R1 | Simpler, fewer moving parts, delete what is unused (baseline 2) | 27 / 17 | "I am open to drastic changes, to large deletions, to removing tests." | 2026-10-07 | 95247cdf |
| R2 | Fast and high quality together (baseline 5, 17) | 8 on quality, 37 on speed / 22 | "I need the timing on these runs to drop significantly like to 1/4 of what they are now, without losing any quality" | 2026-10-07 | 48440900 |
| R3 | Pipelines do only what is needed, at the right time, without workaround machinery (baseline 2, 16) | 3 / 3 | "We shouldn't need to build extra machinery and workarounds for things not running efficiently. All of the pipelines should run fast. It should do only what is necessary. And at the proper time, in order to prevent bad quality code. It shouldn't even get stuck." | 2026-10-07 | 95247cdf |
| R4 | Prune tests and checks that don't earn their time; no duplicate gates (baseline 2, "I hate flaky tests") | 6 / 4 | "should lumaria even hve husky prepush setup? isnt that just a redundant prepush in addition to your hook bin check??" | 2026-10-06 | bbdca04e |
| R5 | The machine runs hosted, never on the owner's PC (baseline 08-22 "Github hosted for everything") | 4 / 3 | "On my pc isnt an option." | 2026-10-06 | 898b2ffc |
| R6 | Stop guessing; find the facts yourself (baseline 11) | 7 / 7 | "Can you stop guessing and only stop to talk to me once you fully figure it out? ... Be more ambitious and thorough." | 2026-10-03 | 39d8443e |
| R7 | Be ambitious (baseline "ambitious, top-percentile answers") | 11 / 8 | "Do not be a yes man be ambitious like you really want to accomplish major change in the world" | 2026-10-07 | 95247cdf |
| R8 | Unbiased, critical, devil's advocate (baseline 13) | 9 / 7 | "be the devil's advocate to me stand firm on your own beliefs." | 2026-10-07 | 95247cdf |
| R9 | Nothing lost when a session ends; GitHub carries it (baseline 1) | 9 / 8 | "is github up to date on all this where I can end this session, no important info lost, no gh issues to close or update after?" | 2026-10-04 | c73dd075 |
| R10 | Stop relitigating; write it down so the owner stops repeating it (baseline 1, 8, "a fix that did not stick") | 5 / 3 | "it feels like I have had the same conversation 10 times with fresh agents. In this repo in the past two days." | 2026-10-07 | 95247cdf |
| R11 | Questions high level and plain; code taste is the agent's call (baseline 3; #646 "Asking the owner") | 1 / 1 | "Questions should be high level and easily understood by me. If its code taste, keep it to the general standards I ask for and figure out answers you can yourself. If its human opinion I can weigh in on things." | 2026-10-07 | 8e9aae7c |
| R12 | Stay on the question asked (baseline "didn't listen") | 3 / 3 | "Ok please stop mentioning that things are red. I just want the best rec you have for enrolment and how to do it." | 2026-10-05 | 4cb1cdd2 |
| R13 | Owner's view of the machine is GitHub, including the phone app (baseline 08-21 tracker ruling, 12) | 3 / 2 | "the whole point of the workflow machine is for me to be able to easily view the status of specs and tickets on the GitHub app and to use GitHub workflows so that my computer is not running the machine" | 2026-10-07 | 95247cdf |
| R14 | Design around how agents work, strengths and weaknesses (baseline 09-17 end goal) | 4 / 3 | "What if you think about how ai agents work and what makes them work faster and smarter" | 2026-10-06 | df55ef83 |
| R15 | Systemic, proven causes over one-off findings (baseline 15) | 4 / 2 | "Youre kinda just giving me weird little things and not overall systematic problems" | 2026-10-03 | 718d7f3b |
| R16 | Fix it once, at the cause (baseline "a fix that did not stick") | 2 / 2 | "why are we churning on this, what has been tried, what is the friction source? What is going to keep drifting? How do we fix this once and for all" | 2026-10-07 | 549c5746 |
| R17 | Workflow issues stay out of Lumaria's issue list (baseline 8) | 1 / 1 | "I would like workflow issues to not be drowned out in other repo issues." | 2026-10-05 | 4cb1cdd2 |

## Contradictions

| # | Older | Newer | Note |
|---|---|---|---|
| C1 | #646 Notes (owner, 2026-09-24): "Nothing enters as a gate, and no hook enters other than log-only." `CONTEXT.md` **Meter**: every new rule enters as one. | 2026-10-06, 898b2ffc: "Is there a way we could enforce this with gates or hooks overall rather than limiting it to a hopeful prompt?" | The same evening (4093d743) he declined a test gate for `needs-human`, which fits the meter rule. Open: whether a rule he names may skip the meter stage. |
| C2 | Baseline, 2026-08-27, 1c8e0e4c: "I'm not buying branch protection stop bringing that up ever." | 2026-10-05, d3736be9: "ok i got github pro."; 2026-10-07, 48440900: "im on the paid github plan now"; 2026-10-07, 95247cdf: "now I started paying for the pro member" | He now pays for GitHub. His words don't give the reason, so whether branch protection is back on the table is not settled. |
| C3 | 2026-10-07 13:46, 95247cdf: "I am not going to pay for any new types of runners. Those are lazy solutions." | 2026-10-07 14:31, 95247cdf: "I am not going to pay for more or different runner systems unless those would make a massive difference." | Softened within the hour. The standing form is probably the second: no new runners unless the difference is massive. |
| C4 | #646 Notes: the Old machine's lanes "stay switched off in Lumaria". | 2026-10-04, 81d974fb: "Can we take all the workflow stuff out of this repo? We dont use it anymore and we will be using the new workflow system soon" | The newer one supersedes. |
| C5 | 2026-10-07 00:48, 48440900: "why do we need to run more full tests when we have an entires day of runs of this?" | 2026-10-07 14:31, 95247cdf: "we can't look at one thing for the past 10 or 20 runs and average it out because we might have already changed it five runs ago" | Reconciled by N12: history counts once it postdates the last change. |
| C6 | 2026-10-06, 4093d743: "I dont think it should close something unbuilt I wont be able to find it." | 2026-10-07, be7b8916: "Either figure out how to do it without me or close the issue." | Different actors: the first is the machine closing a stuck build, the second is a ticket waiting on the owner. Both stand if that line holds. |
| C7 | 2026-10-06 and 2026-10-07: quick parameter tests before shipping (N1). | 2026-10-07 01:12, 48440900: "No thats a ridiculous way to do it ... We will understand good enough if we make an actual change to the system then just unpause the lumaria spec." | He rejected an extra long verification run, not short tests. Short tests yes, extra full runs no. |
| C8 | His earlier rule, quoted by him 2026-10-07, 549c5746: "Originally I asked that the workflow repo not use special callers because i didnt want to need to build extra things or have extra overhead to maintain" | Same message: "Does that prove itself true 100% from the code and evidence?" | He offers to reverse his own rule on evidence. Today's `CONTEXT.md` has both **Caller file** and **No caller, same file**. Open. |
| C9 | 2026-10-07, 95247cdf: background tasks are what he asked for in terminal sessions (N3). | Same session: agents in GitHub Actions that start background work or subagents and then wait "seems to be problematic". | Venue split rather than a reversal: background in terminal, short waits that check in the machine. |

## How the transcripts were read

**Scope.** Transcript directories under `~/.claude/projects/` for Workflow and its worktrees,
Lumaria and its worktrees, and agent-hooks (`~/.agents/hooks`, directory `-home-collin--agents-hooks`)
and its worktrees. Its lab and fixture run directories were left out as test fixtures. 59
transcripts were modified on or after 2026-10-02; records were kept by timestamp, 2026-10-03 to
2026-10-07 inclusive (UTC).

**Owner messages only.** A jq filter kept `type: user` records whose `message.content` is a string
and whose `origin.kind` is `human`. That drops tool results (array content), `isMeta` records,
task notifications, peer messages, compaction summaries and `/clear` stubs. One message with no
origin ("reply ok") was kept by hand. Slash commands kept their name and `<command-args>`, and a
message still starting with `<` after that (local command output, `<bash-input>`) was dropped. A
message typed and then echoed by its slash command was kept once. That left 376 messages in 54
sessions: 25 on 10-03, 90 on 10-04, 61 on 10-05, 121 on 10-06, 79 on 10-07; 241 Workflow, 96
agent-hooks, 39 Lumaria.

**Pasted text.** 26 messages carry `<pasted_content>`, almost all agent output the owner carried
between sessions. Pastes were cut to 400 characters for reading, and only the owner's framing lines
are quoted. Two messages read as prompts written by an agent and pasted in (2026-10-05 8e2be574,
2026-10-07 d12986d8) and are not quoted as owner rules.

**Read in full.** Every remaining message was read (about 78 KB). Counts were then checked by
case-insensitive pattern search over the messages with pastes removed, and each counted message was
read to confirm it states the rule; the counts are that judgement, not raw keyword hits.

**Baseline.** The baseline was read in full: summary, method, the 18 themes, "Stated once but
load-bearing", "Changes of mind" and "Frustrations". #646's Notes were read from the issue body.
`CONTEXT.md` was checked for terms the window's rules already became (**Paused**, **Meter**,
**Caller file**).

**Left out.** Lumaria product details, specs and code: the repo is public. Agent replies were not
read except where a short owner message needed its question. Sessions in other projects (Hookkit,
skills, personal) were outside the ticket's scope.
