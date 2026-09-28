# Workflow

How Claude Code work gets filed, built, judged and closed: the machine itself, not any project
it ships.

## Language

**Failure**:
A way the machine broke, linked as an issue, PR or run. Every part names the one it stops.
_Avoid_: problem, antipattern

### The machine

**Machine**:
This repo: `src/` and `bin/`; one.
_Avoid_: core, new core, v2

**Worker**:
A part of the machine whose worth is the work it does: a step, a script, a stage.
_Avoid_: job, component

**Guard**:
A part whose worth is the failure it stops, however rarely: a run time cap, a refusal, a hold.
It refuses out loud, never undoing the work.
_Avoid_: rail, safety net, guardrail

### Mechanisms

**Gate**:
Refuses an action the moment it is attempted; unlike a meter, it needs no reader, only a
trigger.
_Avoid_: check, validator, guardrail, lint

**Meter**:
Reports in the PR body what it would have refused, and refuses nothing. Every new rule enters
as one; after 30 merged PRs it becomes a gate or is deleted.
_Avoid_: soft gate, warning, advisory check

**Refusal**:
A gate that fires before a run spends model time, so it costs nothing.
_Avoid_: precondition, validation, check

**Fixer**:
The agent that owns a red ticket until it merges, one session across red runs, fixing the code,
ticket or machine, splitting it, or closing it unbuilt; it marks `needs-human` when it stops.
_Avoid_: mechanic, fresh eyes, repair agent

### The work

**Spec**:
The whole statement of a piece of work, filed as an issue labelled `spec`. One spec, one issue;
unpublished in a file or a conversation.
_Avoid_: PRD document, requirements doc, brief

**Cold read**:
Reads a filed spec, posts what it would build and where it had to choose, as one batch of
questions for the owner.
_Avoid_: critic, spec review, grill

**Ticket**:
The unit the machine builds: an issue carrying `## Why`, acceptance criteria and file claims.
Filing one starts its build.
_Avoid_: issue, sub-issue, card, item

**Note**:
An issue labelled `note`: filed to be kept, never built, with a `## Why` saying why. A `research`
note too, the machine answers and closes.
_Avoid_: idea, bug, backlog item, memo

**Stage**:
One agent process in a pipeline run, with no memory of other stages; not an Actions job or step,
which carry no context boundary.
_Avoid_: phase, pass, step, job
