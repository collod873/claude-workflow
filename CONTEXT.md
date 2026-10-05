# Workflow

How Claude Code work gets filed, built, judged and closed. The domain here is *the machinery
itself*, not any project it ships.

## Language

**Failure**:
A way the machine broke, linked as an issue, PR or failed run. Every part names the one it stops.
_Avoid_: problem, antipattern

### The machine

**Machine**:
This repo: `src/` and `bin/`. There is one machine and this is it.
_Avoid_: core, new core, v2

**Caller file**:
The one workflow another repo carries to have its tickets built: its triggers and a call to
`tickets.yml` here, nothing else, so no part of the machine is copied into it. `.github/caller.yml`
is its text. The closer wakes a builder by dispatching the caller file by its own file name with
`ticket` and `reason`, which GitHub starts only from the caller's default branch, so the file lands
on main before any ticket there builds.
_Avoid_: shim, wrapper, vendored workflow

**Worker**:
A part of the machine whose worth is the work it does: a step, a script, a stage.
_Avoid_: job, component

**Guard**:
A part whose worth is the failure it stops, however rarely: a run time cap, a refusal, a hold.
It refuses out loud and never undoes the work.
_Avoid_: rail, safety net, guardrail

### Mechanisms

**Gate**:
Something that refuses an action at the moment it is attempted. Unlike a meter, it needs no
reader, only a trigger. A step the check runs is one; call it a step.
_Avoid_: validator, guardrail, lint

**Check**, **step**, **receipt**:
agent-hooks' words, used here exactly as there. A check is one run of `~/bin/check`, the one
runner; a step is one named entry in `.claude/contract.json`, which is all the machine knows of
any repo it builds, this one included; a receipt records that a step passed for exactly its
inputs, so no step runs twice for the same tree. The fast check runs mid-session, the full check
(`--full`) at push, in the builder and in the `check` job of `Check`, the PR workflow, which runs
the review and the meters beside it.
_Avoid_: gate (for a step), gauntlet, a repo-local check script, static check

**Meter**:
A rule that reports in the PR body what it would have refused, and refuses nothing. Every new rule
enters as one; run on 30 merged PRs, it becomes a gate or is deleted.
_Avoid_: soft gate, warning, advisory check

**Refusal**:
A gate that fires before a run spends model time, so it is free when it fires.
_Avoid_: precondition, validation, check

**Builder**:
The one agent that builds a ticket, and owns it from that build until it merges, one session across
every red run. It fixes the code, ticket or machine, splits the ticket, or closes it unbuilt; when it
stops, it marks `needs-human`.
_Avoid_: fixer, mechanic, fresh eyes, repair agent

### The work

**Spec**:
The whole statement of a piece of work, filed as an issue labelled `spec`. One spec, one issue;
a spec in a file or a conversation has not been published yet.
_Avoid_: PRD document, requirements doc, brief

**Slicer**:
The stage that turns a filed spec into tickets under it, one wave at a time. It
settles in the spec the names the wave's tickets share, and when a wave's last ticket closes, it
slices the next against the spec and what that wave found.
_Avoid_: splitter, decomposer, to-tickets, planner

**Wave**:
The tickets under one spec that are open at once and build side by side. The tickets in one wave
touch different parts, so none edits a file another edits. Only the current wave is tickets; the
rest is still the spec.
_Avoid_: batch, phase, sprint, round

**Wave note**:
The one comment the slicer posts on a spec for each wave it files, starting `## Wave` and its
number: the owner's words the wave's tickets quote, copied by code, what the wave before it did,
what comes next, and a `<!-- moves: ... -->` marker naming the sentences the wave should move. It
is the wave's readback.
_Avoid_: wave summary, status update, progress report

**Done check**:
The stage that tries each of a spec's "I'll know it works when I can ___" sentences on the running
system once nothing is left to slice, and closes the spec only when every one held. A first miss
gets the spec's one fix wave; a second marks the spec `needs-human`. A sentence it puts to the
owner waits for his reply on the spec, which runs it again. It may not give a sentence
`unexercised`; one it gives anyway ends the run red, posting and closing nothing.
_Avoid_: audit, acceptance test, verification

**Wave check**:
The done check at a wave's end, trying only the sentences that wave should have moved. It skips
the ones only the owner can try and closes nothing. A sentence that misses at a wave check and
again at the next wave check or at the end marks the spec `needs-human`. A sentence nothing on
main could have shown yet it gives `unexercised`, listed as **Not tried yet** with what would have
to happen for it to be seen; that is never a miss, and the next wave check tries it again.
_Avoid_: wave review, checkpoint, interim check

**Ticket**:
The unit the machine builds: an issue carrying `## Why` in the owner's words and, under
`## Done when`, sentences saying what done looks like. Filing one starts its build; its PR
merging closes it.
_Avoid_: issue, sub-issue, card, item

**Note**:
An issue labelled `note`: filed to be kept, never built, with a `## Why` saying why. A research
note, labelled `research` too, the machine answers and closes.
_Avoid_: idea, bug, backlog item, memo

**Stage**:
One agent process in a pipeline run, with no memory of other stages. Not an Actions job or step: a
stage is a context boundary and they are not. Each stage declares its part row, prompt caps and
quiet-output scenarios in its own part file, `src/<stage>.part.ts`, and its own stops in its own
code; every growth limit finds them by scanning, so no two stages share a list.
_Avoid_: phase, pass, step, job

**Stage opening**:
How a stage starts on its issue, in `src/stage.ts` beside the hire: it reads the issue once, ends red
at `unread` when it cannot, ends green in one line on `needs-human` with no label changed and no
model hired, then marks the stage's state, makes the log directory and hires. The slicer, the
researcher and the done check open through it.
_Avoid_: preamble, setup, bootstrap
