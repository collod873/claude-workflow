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
A part whose worth is the failure it stops, not work it does: a run time cap, a refusal, a hold.
However rarely it fires, its worth is the same.
_Avoid_: rail, safety net, guardrail

### Mechanisms

**Gate**:
Something that refuses an action at the moment it is attempted. Unlike a meter, it needs no
reader, only a trigger.
_Avoid_: check, validator, guardrail, lint

**Meter**:
A rule that reports in the PR body what it would have refused, and refuses nothing. Every new rule
enters as one; after ten PRs of reports it becomes a gate or is deleted.
_Avoid_: soft gate, warning, advisory check

**Refusal**:
A gate that fires before a run spends model time, so it is free when it fires.
_Avoid_: precondition, validation, check

**Stub**:
What a second repo will carry in place of a lane: one trigger and one `uses:` at `@stable`. None
exists until a second repo enrols ([#674](https://github.com/collod873/claude-workflow/issues/674)).
_Avoid_: shim, wrapper, vendored copy

**Fixer**:
The agent that owns a red ticket until it merges, one session across red runs. It fixes the code,
the ticket or the machine, or closes the ticket unbuilt; when it stops, it marks it `needs-human`.
_Avoid_: mechanic, fresh eyes, repair agent

**Stable machine**:
The tagged copy of the machine tickets will run on once a second repo enrols; until then `main`
is the only copy ([#674](https://github.com/collod873/claude-workflow/issues/674)).
_Avoid_: prod, release, pinned version

### The work

**Spec**:
The whole statement of a piece of work, published as a `PRD:` issue. One spec, one issue; a spec
that lives in a file or a conversation has not been published yet.
_Avoid_: PRD document, requirements doc, brief

**Ticket**:
The unit the machine builds: an issue carrying `## Why`, acceptance criteria and file claims.
Filing one starts its build; a note never starts one.
_Avoid_: issue, sub-issue, card, item

**Note**:
An issue labelled `note`: filed to be kept, never built. It carries a `## Why` saying why it was
worth keeping, and the build skips it.
_Avoid_: idea, bug, backlog item, memo

**Stage**:
One agent process in a pipeline run, with no memory of other stages. Not an Actions job or step: a
stage is a context boundary and they are not.
_Avoid_: phase, pass, step, job
