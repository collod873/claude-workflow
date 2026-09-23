# Workflow

How Claude Code work gets filed, built, judged and closed. The domain here is *the machinery
itself*, not any project it ships.

## Language

**Failure**:
A way the machine broke, linked as an issue, PR or failed run. Every part names the one it stops.
_Avoid_: problem, antipattern

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

**Machine**:
This repo: `src/` and `bin/`. There is one machine and this is it. It holds the Charter from its
first commit and grows one Layer at a time.
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
