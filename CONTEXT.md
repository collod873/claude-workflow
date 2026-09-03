# Workflow

How Claude Code work gets specified, sliced, built, verified and closed, studied across the
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
A mechanism that was kept, ported, or independently re-derived across an era boundary, surviving
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
A candidate addition (a skill, a hook, a connector, an era) scored against the constraints. One
that fails a constraint is a different goal, not a smaller version of this one.
_Avoid_: idea, feature, request

**Grooming**:
Ongoing effort a mechanism needs to keep being true after it is built. The thing C4 bans: anything
requiring an active ritual dies by roughly month three regardless of quality.
_Avoid_: upkeep, maintenance, hygiene

**Owner point**:
A place the design requires the owner because the record shows automating it makes the result
measurably worse. The bar is evidence, not discomfort: a judgement agents have actually been
measured getting wrong, not one that merely feels like a human's. Named as a boundary rather than a
gap; it is not work waiting for a mechanism. `GOAL.md` §2 holds the surviving list, and reducing
their number is the whole project.
_Avoid_: human-in-the-loop, manual step, gap, checkpoint, where the human stays

### Mechanisms

**Gate**:
Something that refuses an action at the moment it is attempted. Distinct from anything that reports
afterward, because a gate needs no reader, only a trigger.
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
its read non-vacuous, never on a clock.
_Avoid_: audit, scan, monitor, watcher

**Refusal**:
A gate that fires before a run spends model time. The distinction from Gate is cost: a refusal is
free when it fires, so it can be cheap and unapologetic where a late gate cannot.
_Avoid_: precondition, guard, validation, check

**Venue**:
A place a gate can fire, defined by its latency budget and by what it can see from there: inside an
agent's turn, at turn end, on push, in Actions, overnight. Named separately from Gate because the
same logic is a different mechanism in a different venue: what a venue costs is not the check but
the repair it makes possible, and the earliest venue is always the cheapest repair.
_Avoid_: layer, stage, tier, level, hook point

**Binds**:
What one lane forces on the design of another: a venue's budget, a bypassability, a cap. The
sixth field of a shipped lane's contract, and the only one that is not about the lane's own
behaviour. It exists because a fact can be load-bearing on a lane that does not exist yet without
being that lane's trigger, refusal, cost or coverage, and a collapse that kept only those four
would delete it. See [ADR-0025](docs/adr/0025-design-md-carries-no-lane-status-a-shipped-lane-collapses-to.md).
_Avoid_: constraint (reserved for C1–C7), requirement, dependency, contract

**Gate bypass**:
A commit that reached `main` carrying a tree the gauntlet refuses. Defined by where the red *landed*,
not by how it got past: `--no-verify`, a clone that never ran `npm ci`, and a commit made outside a
session are one event, because they are indistinguishable from trunk's side and identical in
consequence. A red tree inside a session is **not** one: mid-task red is a legitimate state, and only
survival to trunk is harm. See
[ADR-0063](docs/adr/0063-a-gate-bypass-is-a-red-tree-reaching-main-counted-from-run-m.md).
_Avoid_: skipped gate, `--no-verify`, gate evasion, routing around

**Back-stamp**:
The pointer written onto a superseded record by the record that supersedes it, at the moment the
successor lands. A third kind of mechanism beside Gate and Lens, distinguished by its output: a gate
refuses, a lens files an issue, a back-stamp commits the repair. It needs no reader, because the
repaired record *is* the output. See
[ADR-0044](docs/adr/0044-an-unread-document-cannot-be-detected-so-the-backwards-quest.md).
_Avoid_: backlink, cross-reference, index, tombstone

**Ratifier**:
The stage that turns a finding which cleared the two-site gate into something the repository
enforces: a lint rule with every site it flags fixed in the same branch, a `CODING_STANDARDS.md`
entry, or a reasoned rejection. Named for the act rather than the artifact because the three
outcomes are one decision made in a forced order. Its output is a pull request that lands through
the same judged door every implementation pull request uses; **ratified means merged**, and the
owner declines by reverting. See
[ADR-0122](docs/adr/0122-findings-land-through-the-implementation-door-the-release-pr.md).
_Avoid_: release, publisher, standards author, approver

**Rule trial**:
Running a newly authored lint rule against the tree as it stood *before* the fixes that rule
justified, and requiring it to flag every site the finding carries. What makes it a trial rather
than a test is where the threshold comes from: the observed failure itself, not a number anyone
chose. A rule that misses one is demoted to a prose entry rather than landed. See
[ADR-0124](docs/adr/0124-a-lint-rule-is-ratified-only-by-reproducing-its-own-evidence.md).
_Avoid_: dry run, smoke test, rule validation, self-check

**Counter**:
A lens that spends no model. It names an event that happens on its own, a count at which it acts, the
issue it files at that count, and the action that issue proposes: four fields, and a thing missing
any of them is not one. Distinguished from Lens only by cost, and from a Sizing measurement by having
an action at all. See
[ADR-0064](docs/adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md).
_Avoid_: metric, signal, tracker, telemetry

**Sizing measurement**:
The query that would say a decision was wrong. It produces nothing and reaches nobody, so it is not a
mechanism: it lives as a line in the ADR that made the decision it sizes, and never as a counter
row, where a row is read as coverage of an evidence class. Named apart from Counter
because four of these were admitted as counters on the strength of being countable, and a table of
numbers nobody will query is C5 asserted rather than scored. See
[ADR-0064](docs/adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md).
_Avoid_: number to watch, metric, KPI, health check

**Immutable set**:
The files a pull request may never change: the test runner's config and `.github/`. Closed rather
than approximate: each entry is there because omitting it reopens the same hole one level up, where
the thing that judges becomes reachable from the thing being judged. It carries **no exemption**,
which is what leaves nothing for an identity to authenticate. An acceptance test is not in it: since
#360 it lives beside its subject, and what a pull request may do to one is a rule on the line
(`test.fails(` may lose its `.fails`, nothing else) rather than a path. See
[ADR-0053](docs/adr/0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md).
_Avoid_: protected paths, frozen files, locked directory, path filter

**Check contract**:
`.claude/contract.json`: the command slots naming what green means in one repo, generated by
probing it rather than written by hand, and executed by `bin/gauntlet` at every venue. Called a
contract rather than a config because it is the input a runner runs, not prose describing one. Its
`why` names a declaration site, never a measurement: a
measurement in it is a second, unwatched copy of a fact the runner already holds. See
[ADR-0056](docs/adr/0056-bin-gauntlet-runs-the-check-contract-instead-of-three-hardco.md).
_Avoid_: the contract (bare), manifest, config, gate definition

**Timing baseline**:
The measured wall time a venue's budget is derived from: per check, ratcheted one way, with a 25%
deadband in both directions. Named a baseline rather than a budget because a budget is declared and
this is not: it is what the last green run actually cost here, so an enrolled repository inherits
its own history instead of a figure written for someone else's suite. It also decides which venue a
test file runs at. See
[ADR-0140](docs/adr/0140-a-venue-s-budget-is-its-own-last-green-time-plus-a-margin-ne.md) and
[docs/agents/venues.md](docs/agents/venues.md).
_Avoid_: budget, timeout, SLA, performance target

**Stub**:
The six lines a second repo carries in place of a lane: a trigger and a `uses:` pointing at the
reusable workflow here. Defined by what it lacks: a stub has no content, which is the whole reason
it cannot drift and the reason installing is a call rather than a copy. See
[ADR-0055](docs/adr/0055-a-lane-ships-as-a-reusable-workflow-and-a-second-repo-carrie.md).
_Avoid_: shim, wrapper, caller, vendored copy

**Checkpoint**:
A stage's validated output, written under a name of its own and kept after the run, carrying the key that says which run it is still good for. A stage whose checkpoint is present and whose key still matches is skipped rather than re-run.
_Avoid_: cache, savepoint, handoff, artifact

### The pipeline

**Lane**:
A named group of edges a work item passes through in order, holding one kind of judgement: shaping,
specifying, slicing, building. Numbered because the order is real: a work item cannot skip one.
_Avoid_: stage, phase, step, pipeline segment

**Idea**:
The owner's own words about work that might be worth doing, filed as an issue and never edited
afterward. It is the only thing in the system a human originates, and it is recorded rather than
improved: the raw wording is what every later interpretation is checked against.
_Avoid_: request, feature, suggestion, ask

**Defect**:
A failure that already happened. The distinction from an Idea is not size but tense: an idea is an
opinion about what would be better, a defect is a report of something that broke. Only a defect may
take the short path around specifying and slicing.
_Avoid_: bug, issue, problem, regression

**Decision sheet**:
What shaping hands the owner: the idea restated as work, the prior art found, and each decision the
work needs with a recommended answer and the alternatives rejected. Its purpose is to be reacted to
rather than read: approving a bare idea asks the owner to originate an opinion, and the sheet is
what converts that into overriding two lines. Accepting it is what files the rulings on it.
_Avoid_: proposal, analysis, brief, summary, report

**Assumption mark**:
A flag on a decision, carrying the name of the thing that moves when the answer flips: another
decision on the same sheet, or an existing artifact: an ADR, a shipped lane's contract, a file. A
mark that names nothing is not a mark. Only load-bearing guesses are marked; a recommendation that
can be overridden in place without disturbing anything else is not one. The mark is also the first
test of whether a decision deserves an ADR, which is why it may point off the sheet: a decision that
moves nothing else on the page can still be expensive to unwind.
_Avoid_: caveat, note, uncertainty, open question

**Decided context**:
The normalised object every door into specifying produces: the owner's words verbatim, the decisions
with their reasons, the rulings already filed, the boundaries, and the guesses still open. It is what
makes three different doors one lane: they differ in where that context already lives, never in what
the spec author needs, so the difference is a collector rather than a second prompt.
_Avoid_: payload, handoff, input, brief

**Spec**:
The whole statement of a piece of work, published as a `PRD:` issue. One spec, one issue; a spec
that lives in a file or a conversation has not been published yet.
_Avoid_: PRD document, requirements doc, brief

**Open question**:
A numbered question in a spec, naming something specifying could not settle: intent it would
otherwise have invented, a ruling it was handed that is wrong or conflicts with another, or a guess
the sheet marked and no ruling ever recorded. It is the only form those three take, and the count of
unanswered ones is what holds work back: at zero the spec dispatches, and a non-zero count holds it
back the same way, with nothing routed to the owner about it
([ADR-0112](docs/adr/0112-a-non-zero-open-question-count-no-longer-waits-on-the-owner.md)). Distinct
from an **Assumption mark**, which lives on a sheet and is the shaper's own flag on its own
recommendation; a mark *becomes* one of these only when it crosses into a spec with no ruling behind
it.
_Avoid_: assumption mark, TODO, caveat, clarification

**Slice**:
One tracer-bullet vertical cut through every layer, demoable on its own and sized to a single agent
session. Vertical is the whole point: a horizontal cut through one layer is not a slice.
_Avoid_: task, chunk, story, unit

**Ticket**:
A published slice: a child issue carrying acceptance criteria, file claims and native blocked-by
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
