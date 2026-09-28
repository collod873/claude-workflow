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
reader, only a trigger.
_Avoid_: check, validator, guardrail, lint

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

**Cold read**:
The stage that reads a filed spec, says what it would build and where it had to choose, and posts
its guesses on the spec as one batch of questions for the owner.
_Avoid_: critic, spec review, grill

**Slicer**:
The stage that turns a spec the owner has answered into tickets under it, one wave at a time. It
settles in the spec the names the wave's tickets share, and when a wave's last ticket closes, it
slices the next against the spec and what that wave found.
_Avoid_: splitter, decomposer, to-tickets, planner

**Wave**:
The tickets under one spec that are open at once and build side by side. Only the current wave is
tickets; the rest is still the spec.
_Avoid_: batch, phase, sprint, round

**Done check**:
The stage that tries each of a spec's "I'll know it works when I can ___" sentences on the running
system once nothing is left to slice, and closes the spec only when every one held.
_Avoid_: audit, acceptance test, verification

**Ticket**:
The unit the machine builds: an issue carrying `## Why` in the owner's words and, under
`## Done when`, 1 to 3 sentences saying what done looks like. Filing one starts its build; its PR
merging closes it.
_Avoid_: issue, sub-issue, card, item

**Note**:
An issue labelled `note`: filed to be kept, never built, with a `## Why` saying why. A research
note, labelled `research` too, the machine answers and closes.
_Avoid_: idea, bug, backlog item, memo

**Stage**:
One agent process in a pipeline run, with no memory of other stages. Not an Actions job or step: a
stage is a context boundary and they are not.
_Avoid_: phase, pass, step, job
