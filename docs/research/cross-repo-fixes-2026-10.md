# How fixes crossed claude-workflow, Lumaria and agent-hooks, 2026-10-03 to 2026-10-08

Researches: [#1233](https://github.com/collod873/claude-workflow/issues/1233)

Child of [#1226](https://github.com/collod873/claude-workflow/issues/1226). Recorded 2026-10-08.
Facts for Ruling 4 (one fix is one session), no rulings.

Sources: the owner's interactive sessions in Workflow, Lumaria and agent-hooks
(`~/.claude/projects/<dir>/<sid8>*.jsonl`, 77 sessions started Oct 1 to 8, read with jq for owner
messages, pastes, cross-session messages and the first time a pasted text appears in its source
session), their captures in `Knowledge-Base/raw/sessions/`, and the commit, PR and issue history
of the three repos. Session ids are the first eight hex characters. Times are UTC, `MM-DD HH:MM`.
Lumaria is private: its PRs are linked, never quoted.

## Summary

- **14 fixes crossed two or more repos in six days.** Median 2 sessions per fix, at most 4. Two
  were done in one session; both were agent-hooks sessions.
- **The owner carried the message in 9 of 14** (a paste or a `/handoff` file). He pasted one
  session's output into another 14 times, opened the receiving session himself in every hand-off
  but one, and three times had to say which session should act. One fix used a cross-session
  message, the week's only one.
- **Hand-offs are fast when he is at the keyboard and stall when he is not.** A paste took 1 to 8
  minutes. The one hand-off the Machine started, a builder's fault filed as an issue, waited 7 h 53 min
  overnight for him to open an agent-hooks session.
- **Every fix landed in the repo that owns its cause, eventually.** One was first filed in the
  wrong repo, because the Machine's fault door ([#1143](https://github.com/collod873/claude-workflow/issues/1143))
  only opens into claude-workflow. One three-repo rollout from a single session left a hole in
  Lumaria's CI that ran 45 hours before another fix found it.
- **Who can cross is set by where the session runs, not by what the fix needs.** agent-hooks
  sessions run in the main checkout and landed in all three repos (fixes 1, 2, 5, 8). Workflow
  sessions run in worktrees behind a fence on git outside the worktree, read it as "cannot touch
  another repo", and hand off (fixes 5, 9, 13).

## The fixes

"Sessions" counts interactive sessions plus Machine runs that took part. "Hand-off" is from the
moment the text exists in its source session to the moment it reaches the next one. "Landed"
names where each piece merged; every row landed in the repo owning that piece's cause.

| # | Date | Fix | Repos | Sessions | Carrier | Hand-off | Landed |
|---|---|---|---|---|---|---|---|
| 1 | 10-04 | Tree-wide rules move into agent-hooks; Workflow's copies deleted | hooks, Workflow | 1 (`c73dd075`); a chain of 3 hooks sessions for context | none across repos; owner pasted `/handoff` text between hooks sessions | 3 min (14:17 to 14:20) | hooks e698403; Workflow [#1126](https://github.com/collod873/claude-workflow/pull/1126), [#1127](https://github.com/collod873/claude-workflow/pull/1127) by 14:58 |
| 2 | 10-04 | One runner: `~/bin/check` runs every repo's declared steps | hooks, Workflow, Lumaria | 3 (Lumaria `22fe3a9f`, Workflow `ca17bb30`, hooks `210251dd`) | owner paste x2 | 1 to 4 min (19:21 to 19:25) | hooks 973ccdd 19:57; Workflow [#1129](https://github.com/collod873/claude-workflow/pull/1129) 20:12; Lumaria ee7c6155 20:04, all by `210251dd` |
| 3 | 10-05 | Ticket tools reach Lumaria sessions: `file-issue`, `close-note`, `land` through `~/bin`; workflow-sync in every repo; ticket hooks scoped by caller file | Workflow, hooks, Lumaria | 4 (Workflow `4cb1cdd2`, `ea21dc9a`, `174508ad`; hooks `845f8334`) | owner paste x3; owner stopped `ea21dc9a` duplicating another session's work | 1 to 8 min | Workflow [#1131](https://github.com/collod873/claude-workflow/pull/1131), [#1132](https://github.com/collod873/claude-workflow/pull/1132); hooks 297a329, e995da6, 9d4adec |
| 4 | 10-05 to 06 | Pilot: the Machine builds a Lumaria ticket through its caller file | Workflow, Lumaria | 2 (`d3736be9`, `d40d81d9`) plus builder runs | Machine faults filed as claude-workflow tickets ([#1138](https://github.com/collod873/claude-workflow/issues/1138) to [#1159](https://github.com/collod873/claude-workflow/issues/1159)); owner pasted the summary into the next session | summary 1 h 49 min (00:10 to 01:59) | Workflow [#1139](https://github.com/collod873/claude-workflow/pull/1139), [#1144](https://github.com/collod873/claude-workflow/pull/1144), [#1145](https://github.com/collod873/claude-workflow/pull/1145), [#1148](https://github.com/collod873/claude-workflow/pull/1148), [#1154](https://github.com/collod873/claude-workflow/pull/1154) and others |
| 5 | 10-06 | Lumaria's required check could not go red, and builder receipts never matched in its CI | Lumaria, hooks, Workflow | 2 (Workflow `898b2ffc` found, hooks `51b76857` fixed) | owner paste; `898b2ffc` said "This session is locked to Workflow's worktree, so I can't commit to agent-hooks or Lumaria from here" | 6 min (17:16 to 17:22) | Lumaria [#923](https://github.com/collod873/Lumaria/pull/923) 17:42; hooks b20657a 17:42; Workflow [#1163](https://github.com/collod873/claude-workflow/pull/1163) 17:45, all by `51b76857` |
| 6 | 10-06 | A pre-push run in a worktree wrote into the real checkout | hooks, Lumaria | 1 (hooks `bbdca04e`) for the hooks side | none | none | hooks f8f4af8; Lumaria [#929](https://github.com/collod873/Lumaria/pull/929) (its session not confirmed) |
| 7 | 10-06 | `~/bin/check` prints each step's time in CI | hooks, for Lumaria | 2 (Workflow `4984c715`, hooks `61d5cab0`) | owner paste ("I could send that into a hooks session now") | 3 min (20:32 to 20:35) | hooks 97efa3b 20:39 |
| 8 | 10-07 | A catch-up reruns only the tests whose inputs changed | hooks, Lumaria | 2 (Workflow `48440900`, hooks `8d9240b7`) | owner paste out ("Gimme the prompt for the hooks repo ill copy and paste it") and back | under 1 min out (01:13); result pasted back 02:44 | hooks 6f83666 01:51; Lumaria [#944](https://github.com/collod873/Lumaria/pull/944) 02:50 by `8d9240b7` |
| 9 | 10-07 | Name each untraceable test and why | Lumaria found, claude-workflow filed, hooks owns | 3 (builder of [Lumaria#953](https://github.com/collod873/Lumaria/issues/953), Workflow `4d447201`, hooks `d12986d8`) | issue in the wrong repo ([#1207](https://github.com/collod873/claude-workflow/issues/1207)); the Machine refused to build it; `4d447201` was fenced from opening an agent-hooks tab, so the owner ran its `!` command | 7 h 53 min (03:30 filed to 11:23 session start), owner asleep | hooks c4d5304 11:27 |
| 10 | 10-07 | Wake a waiting agent only when its run looks wrong; stages run in the foreground | hooks, Workflow, for Lumaria builders | 3 (Workflow `95247cdf`, hooks `e1139cc6` as "hooks-50", a Lumaria builder) | cross-session message, after the owner said "I have an idle agent-hooks session open you can send it a prompt" | 1 min out (13:13 to 13:14), 2 min back (13:34 to 13:36) | hooks d59c411 13:34; Workflow [#1221](https://github.com/collod873/claude-workflow/pull/1221) 13:41 |
| 11 | 10-07 | Stages follow an enrolled repo's own rules (Lumaria builders ran without its CLAUDE.md) | Workflow, found from hooks | 2 (hooks `e1139cc6`, Workflow `49b12fef`) | `/handoff` file; owner typed its path into a new Workflow session | 5 min (15:40 to 15:45) | Workflow [#1242](https://github.com/collod873/claude-workflow/pull/1242) 16:37 |
| 12 | 10-07 | The watchdog watches builders' filtered test runs | hooks, for Lumaria builders | 2 (Workflow `49b12fef`, hooks `a0db0207`) | issue [agent-hooks#20](https://github.com/collod873/agent-hooks/issues/20) filed by the Workflow session; owner opened a hooks session on it | 3 min (17:01 to 17:04); fixed 5 h later | hooks 9f5ff67 21:58 |
| 13 | 10-07 | The probe, and the race that held Lumaria's caller file PR red | Workflow, Lumaria, idea from hooks | 3 (hooks `a0db0207`, Workflow `a20c8899`, Workflow `2d1d2dbe`) | note [#1251](https://github.com/collod873/claude-workflow/issues/1251); owner paste x3, including asking which session runs the probe | 1 to 3 min (18:54 to 18:57, 20:20 to 20:22, 20:23 to 20:24) | Workflow [#1253](https://github.com/collod873/claude-workflow/pull/1253) 18:46, [#1254](https://github.com/collod873/claude-workflow/pull/1254) 18:50; Lumaria [#983](https://github.com/collod873/Lumaria/pull/983) 20:14, [#982](https://github.com/collod873/Lumaria/pull/982) 20:21 |
| 14 | 10-07 to 08 | Lumaria test audit | hooks, Lumaria | 2 (hooks `a0db0207`, Lumaria `033c142a`) | brief file saved outside the session folder; owner pasted it | 14 min (20:28 to 20:42) | Lumaria [#986](https://github.com/collod873/Lumaria/pull/986), [#988](https://github.com/collod873/Lumaria/pull/988), [#989](https://github.com/collod873/Lumaria/pull/989) |

### Counts

- Sessions per fix: 1 (fixes 1, 6), 2 (4, 5, 7, 8, 11, 12, 14), 3 (2, 9, 10, 13), 4 (3). Median 2.
- Carrier, by fix: owner paste 8 (2, 3, 4, 5, 7, 8, 13, 14), issue 4 (4, 9, 12, 13), `/handoff`
  file 2 (11, 14), cross-session message 1 (10), none 2 (1, 6). The owner opened or chose the
  receiving session in every hand-off but fix 10's message.
- Hand-off delay with the owner present: 1 to 8 minutes, about 3 typical. Without him: 7 h 53 min
  (fix 9). A summary carried to a next session: 1 h 49 min (fix 4).
- Landed in the owning repo: 14 of 14. Filed in the wrong repo first: 1 (fix 9). A fix that broke
  another repo: 1 (fix 2's Lumaria CI change dropped `pipefail`; Workflow's own CI file kept it;
  fix 5 found it 45 h later).

## What the owner relayed or directed by hand

1. **Pasted one session's output into another**, 14 times: 10-04 19:20 and 19:25 (fix 2); 10-05
   14:33, 14:40, 14:56 (fix 3); 10-06 01:59 (fix 4), 17:22 (fix 5), 20:35 (fix 7); 10-07 01:13,
   01:24, 02:44 (fix 8), 18:57, 20:22, 20:24 (fix 13).
2. **Opened the receiving session himself**, every time: a fresh agent-hooks session for fix 8
   ("Ok i just pasted that into a fresh agent-hooks session"); the `!` Windows Terminal command a
   fenced Workflow session wrote for fix 9; a new Workflow session on a `/handoff` path for fix 11;
   a hooks session on issues 19 and 20 for fix 12; a Lumaria session on the audit brief for fix 14.
3. **Told a session another session exists or already did the work**: "I have an idle agent-hooks
   session open" (10-07 13:13); "Bro i already had the session fix it dont just start doing stuff
   from other sessions..." (10-05 14:44); "I actually did a bunch to this in another session"
   (10-04 16:28); "I already ran some work in the workflow repo that shouldve had a PR go in"
   (10-04 15:42); "Hooks repo is currently running off the prompt you gave me" (10-06 20:26).
4. **Decided which session acts**: "Is it or is you meant to run th eprobe though?" (10-07 20:22,
   both sessions claimed it); "ill paste into the workflow session whats left" and "just tell me
   what to paste where and when from here" (10-05 15:05, 15:06); "should we just finish off gh 898
   now too? in lumaria / Or do I need to run that prompt in a lumaria sesison first" (10-05).
5. **Lifted a fence a session assumed**: "You should have full access youre on my pc with that
   repo..." (10-07 19:24); `2d1d2dbe` then made a Lumaria worktree and fixed the race there.
6. **Made shared tools global himself**: "ok i just made the 2 tools global now too. workflow sync
   is global now" (10-05).
7. **Noticed Lumaria symptoms and carried them to Workflow**: spec #902 not slicing after he took
   `needs-human` off (10-06 17:49); "Is the lumaria spec thats running stuck?" (10-06); the full
   check running on every builder push (10-06 17:19); pausing Lumaria's open spec at GitHub's 90%
   minutes email (10-07 14:58).
8. **Lost track of a hand-off**: "what does htis mean i dont remember or understand this and is it
   still even true? Handed off to the agent-hooks session: the check-commit timeouts and the
   watchdog not covering builders' test runs." (10-07 16:52).

## Why the hand-offs happen

- **The fence decides who crosses.** Workflow sessions open in worktrees, and the worktree fence
  refuses git aimed outside the session's own worktree. Three Workflow sessions stopped at it and
  handed off (`898b2ffc` fix 5, `4d447201` fix 9, `2d1d2dbe` fix 13, the last until the owner
  said it had access). agent-hooks sessions run in the main checkout with no such fence and
  landed in all three repos in one session (fixes 1, 2, 5, 8). The single-session fixes are
  single-session because of where the session happened to start.
- **The Machine has one door, and it opens into claude-workflow.** A builder that finds a fault
  outside its repo files a ticket here ([#1143](https://github.com/collod873/claude-workflow/issues/1143),
  built on by [#1203](https://github.com/collod873/claude-workflow/issues/1203)). That fits a
  Machine fault. For an agent-hooks cause (fix 9) the ticket lands in the wrong repo, the Machine
  refuses to build it, and nothing starts an agent-hooks session.
- **agent-hooks has no Machine.** Every agent-hooks fix in the table was built by a session the
  owner opened by hand. An issue filed there (fix 12) waits for him.
- **Cross-session messages work but need a live peer the owner points at.** The one use (fix 10)
  round-tripped in under 25 minutes with no paste, but only because he said an idle session was
  open.
- **A rollout across repos skips the receiving repo's Gate.** Fix 2 changed Lumaria's CI from an
  agent-hooks session; Workflow's matching CI file had `pipefail` and Lumaria's new one did not,
  and nothing compared them.

## Open

- Which Lumaria builder the map's "a Lumaria builder patching its CI" (fix 10) refers to is not
  pinned; the Workflow session woke #968's builder by hand at about 13:50.
- The session that landed Lumaria #929 (fix 6) is not confirmed.
