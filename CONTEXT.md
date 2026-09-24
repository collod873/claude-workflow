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
Something that refuses an action at the moment it is attempted. Distinct from anything that reports
afterward, because a gate needs no reader, only a trigger.
_Avoid_: check, validator, guardrail, lint

**Refusal**:
A gate that fires before a run spends model time. The distinction from Gate is cost: a refusal is
free when it fires, so it can be cheap and unapologetic where a late gate cannot.
_Avoid_: precondition, validation, check

**Stub**:
What a second repo will carry in place of a lane: one trigger and one `uses:` at `@stable`. None
exists until a second repo enrols ([#674](https://github.com/collod873/claude-workflow/issues/674)).
_Avoid_: shim, wrapper, vendored copy

**Fixer**:
The one fresh agent that clears a stuck ticket in the machine, reading why the ticket exists
before the failure. It fixes the code or the ticket itself, or closes the ticket unbuilt; it never
hands back, and the owner is never asked.
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
worth keeping, and the build skips it. Every other issue the owner opens is built as a ticket.
_Avoid_: idea, bug, backlog item, memo

**Stage**:
One agent process in a pipeline run, with no memory of the ones before it. Named separately from
Actions' own words because a stage is a context boundary, and a job or a step is not.
_Avoid_: phase, pass, step, job
