# Workflow

How Claude Code work gets filed, built, judged and closed, studied across the systems that have
tried to do it, and designed toward the one that finally does. The domain here is *the machinery
itself*, not any project it ships.

## Language

### The record

**Era**:
A complete workflow system that was, for a period, the primary way work got done. Ends when it is
replaced, not when it stops being edited.
_Avoid_: generation, version, phase, iteration

**Failure**:
A way a system broke that has now been observed in more than one era. A single occurrence is an
incident, not a failure.
_Avoid_: problem, issue, antipattern

### The charter

**Charter**:
The one-screen page, `docs/agents/charter.md`, that every part of the machine earns its place
against. Signed by the owner and changed only by the owner. Its rules are a table, each naming its
Enforcer.
_Avoid_: goal, vision, constraints, principles

**Enforcer**:
The gate, test or separate judge a Charter rule names as holding it. An instruction is never an
enforcer.
_Avoid_: rail, guardrail, reminder, policy

**Layer**:
One of the four parts the machine is described in: **One ticket**, **Big jobs**, **Many at once**,
**Look-back**. Which of them is built, and what each covers, is the Charter's to say.
_Avoid_: tier, level

**Core**:
The machine, `core/`. There is one machine and this is it. It holds the Charter from its first
commit, grows one Layer at a time, and is whole: nothing in it reaches outside.
_Avoid_: new core, v2

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

**Fail-open**:
The property of a gate that lets the action through when the gate itself errors. In an unattended
system this is not a degraded gate; it is not a gate.
_Avoid_: soft fail, non-blocking, best-effort

**Refusal**:
A gate that fires before a run spends model time. The distinction from Gate is cost: a refusal is
free when it fires, so it can be cheap and unapologetic where a late gate cannot.
_Avoid_: precondition, validation, check

**Stub**:
What a second repo carries in place of a lane: one trigger and one `uses:` at `@stable`, the shape
`core/stub-shape.test.ts` holds. Defined by what it lacks: a stub has no content, which is the whole
reason it cannot drift and the reason installing is a call rather than a copy.
_Avoid_: shim, wrapper, vendored copy

**Fixer**:
The one fresh agent that clears a stuck ticket in the Core, reading why the ticket exists
before the failure. It fixes the code or the ticket itself, or closes the ticket unbuilt; it never
hands back, and the owner is never asked.
_Avoid_: mechanic, fresh eyes, repair agent

**Stable machine**:
The tagged copy of the Core every ticket runs on and every pull request is judged by. `main`
is the candidate; a change to the machine becomes stable only after a sample ticket builds clean on
it.
_Avoid_: prod, release, pinned version

### The work

**Idea**:
The owner's own words about work that might be worth doing, filed as an issue and never edited
afterward. It is the only thing in the system a human originates, and it is recorded rather than
improved: the raw wording is what every later interpretation is checked against.
_Avoid_: request, feature, suggestion, ask

**Bug**:
A report of something that already broke. The distinction from an Idea is not size but tense: an
idea is an opinion about what would be better, a bug is a thing that happened.
_Avoid_: defect, issue, problem, regression

**Spec**:
The whole statement of a piece of work, published as a `PRD:` issue. One spec, one issue; a spec
that lives in a file or a conversation has not been published yet.
_Avoid_: PRD document, requirements doc, brief

**Ticket**:
The unit the machine builds: an issue carrying `## Why`, acceptance criteria and file claims.
Filing one starts its build; a note never starts one.
_Avoid_: issue, sub-issue, card, item

**Stage**:
One agent process in a pipeline run, with no memory of the ones before it. Named separately from
Actions' own words because a stage is a context boundary, and a job or a step is not.
_Avoid_: phase, pass, step, job
