# The vocabulary this lane works in

**Everything below the rule is injected into all three to-tickets stage prompts as
`{{VOCABULARY}}`. Everything above it is for you, and never reaches a model**, including the
sentences on this page naming `CONTEXT.md`, which is the one file a stage must not be pointed at.

Six entries, copied verbatim from `CONTEXT.md`. They are the pipeline chain this lane sits in. A
**Lane** is made of **Stages**; a **Spec** is cut into **Slices** that publish as **Tickets**; a
**Seam manifest** crosses them. They are the only entries any of the three stages uses. The
other twenty-nine are the vocabulary for arguing about the machine's design: Era, Failure, Owner
point, Binds, Counter, Immutable set. None of them ever appears in a ticket.

The copy is pinned rather than trusted: `vocabulary.test.ts` asserts every entry below is
byte-for-byte the entry `CONTEXT.md` holds, so renaming a term there reddens the gauntlet here. The
test runs in the repo that owns that document; the injection runs anywhere. See
[ADR-0082](../../../docs/adr/0082-a-lane-carries-the-vocabulary-it-works-in-rather-than-readin.md).

---

**Lane**:
A named group of edges a work item passes through in order, holding one kind of judgement: shaping,
specifying, slicing, building. Numbered because the order is real: a work item cannot skip one.
_Avoid_: stage, phase, step, pipeline segment

**Spec**:
The whole statement of a piece of work, published as a `PRD:` issue. One spec, one issue; a spec
that lives in a file or a conversation has not been published yet.
_Avoid_: PRD document, requirements doc, brief

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
