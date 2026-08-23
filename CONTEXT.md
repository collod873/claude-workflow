# Workflow

How Claude Code work gets specified, sliced, built, verified and closed — studied across the
systems that have tried to do it, and designed toward the one that finally does. The domain here
is *the machinery itself*, not any project it ships.

## Language

### The record

**Era**:
A complete workflow system that was, for a period, the primary way work got done. Ends when it is
replaced, not when it stops being edited.
_Avoid_: generation, version, phase, iteration

**Failure**:
A way a system broke that has now been observed in more than one era. Numbered F1–F7. A single
occurrence is an incident, not a failure.
_Avoid_: problem, issue, bug, antipattern

**Durable win**:
A mechanism that was kept, ported, or independently re-derived across an era boundary — surviving
the system that invented it. Numbered W1–W6.
_Avoid_: pattern, best practice, lesson, learning

**Evidence class**:
One kind of thing that can go wrong, in the taxonomy that asks what has a mechanism watching it.
A class is defined by where its evidence lives, not by how bad it is.
_Avoid_: failure mode, category, risk

### The charter

**Constraint**:
One of the seven testable properties (C1–C7) that any design either satisfies or does not. Derived
from what the owner does repeatedly, not from what a system was designed to do.
_Avoid_: requirement, principle, rule, guideline

**Proposal**:
A candidate addition — a skill, a hook, a connector, an era — scored against the constraints. One
that fails a constraint is a different goal, not a smaller version of this one.
_Avoid_: idea, feature, request

**Grooming**:
Ongoing effort a mechanism needs to keep being true after it is built. The thing C4 bans: anything
requiring an active ritual dies by roughly month three regardless of quality.
_Avoid_: upkeep, maintenance, hygiene

### Mechanisms

**Gate**:
Something that refuses an action at the moment it is attempted. Distinct from anything that reports
afterward, because a gate needs no reader — only a trigger.
_Avoid_: check, validator, guardrail, lint

**Fail-open**:
The property of a gate that lets the action through when the gate itself errors. In an unattended
system this is not a degraded gate; it is not a gate.
_Avoid_: soft fail, non-blocking, best-effort

**Edge**:
One transition between two states of a work item, named by the event that fires it. The unit the
design is drawn in: an edge with no event is not an edge, and a verb that lands on no edge does not
survive the map.
_Avoid_: transition, hop, link, arrow

**Connector**:
Whatever fires the next edge of the pipeline without a human keystroke. Named separately from the
work it starts, because the work already exists and the connector is what is missing.
_Avoid_: trigger, automation, orchestrator, glue

**Lens**:
A standing reader that files issues about a class of evidence nobody asked it to look at. Distinct
from a gate because it refuses nothing, and from a cadence because it fires on the event that makes
its read non-vacuous — never on a clock.
_Avoid_: audit, scan, monitor, watcher

**Refusal**:
A gate that fires before a run spends model time. The distinction from Gate is cost: a refusal is
free when it fires, so it can be cheap and unapologetic where a late gate cannot.
_Avoid_: precondition, guard, validation, check

### The pipeline

**Lane**:
A named group of edges a work item passes through in order, holding one kind of judgement — shaping,
specifying, slicing, building. Numbered because the order is real: a work item cannot skip one.
_Avoid_: stage, phase, step, pipeline segment

**Idea**:
The owner's own words about work that might be worth doing, filed as an issue and never edited
afterward. It is the only thing in the system a human originates, and it is recorded rather than
improved — the raw wording is what every later interpretation is checked against.
_Avoid_: request, feature, suggestion, ask

**Defect**:
A failure that already happened. The distinction from an Idea is not size but tense: an idea is an
opinion about what would be better, a defect is a report of something that broke. Only a defect may
take the short path around specifying and slicing.
_Avoid_: bug, issue, problem, regression

**Decision sheet**:
What shaping hands the owner: the idea restated as work, the prior art found, and each decision the
work needs with a recommended answer and the alternatives rejected. Its purpose is to be reacted to
rather than read — approving a bare idea asks the owner to originate an opinion, and the sheet is
what converts that into overriding two lines. Accepting it is what files the rulings on it.
_Avoid_: proposal, analysis, brief, summary, report

**Assumption mark**:
A flag on a decision whose answer changes *other* decisions on the same sheet. Only load-bearing
guesses are marked — a recommendation that can be overridden in place without disturbing anything
else is not one. The mark is also the first test of whether a decision deserves an ADR, because
*changes other decisions* and *hard to reverse* are the same property.
_Avoid_: caveat, note, uncertainty, open question

**Spec**:
The whole statement of a piece of work, published as a `PRD:` issue. One spec, one issue — a spec
that lives in a file or a conversation has not been published yet.
_Avoid_: PRD document, requirements doc, brief

**Slice**:
One tracer-bullet vertical cut through every layer, demoable on its own and sized to a single agent
session. Vertical is the whole point: a horizontal cut through one layer is not a slice.
_Avoid_: task, chunk, story, unit

**Ticket**:
A published slice — a child issue carrying acceptance criteria, file claims and native blocked-by
edges. A slice becomes a ticket at publish, not before, so a drafted breakdown holds no tickets.
_Avoid_: issue, sub-issue, card, item

**Seam manifest**:
The list of shared shapes a batch needs, one line each, naming what it is, where it lives or should
live, and what consumes it. The one-line bound is load-bearing: every line is injected into every
consuming ticket's body, and therefore into every worker's context.
_Avoid_: shared components, abstractions, helpers, utilities

**Stage**:
One agent process in a pipeline run, with no memory of the ones before it. Named separately from
Actions' own words because a stage is a context boundary, and a job or a step is not.
_Avoid_: phase, pass, step, job
