---
status: constraint
date: 2026-09-02
reversal: every hand-written ticket goes back through four model stages to reach lane 06, or the scope rule loosens to shape and starts implementers on issues nobody meant to build
---

# Intent to build is asserted by a label, never inferred from a ticket's shape

`publishedSliceNumbers` gated lane 06 on a `## Parent PRD` heading nothing downstream reads —
`implement.ts` exports `parentPrdNumber` and never calls it. It stood for one thing: *an agent
wrote this deliberately as a slice*. A constant folded into a predicate, and it made the smallest
unit of work pay for the largest door: four model stages for a ticket the owner could already
write in full.

`startableNumbers` replaces it — a published slice **or** the `to-build` label.

A label, not a shape check: shape was never the missing term. #182, #181, #179 and #150 are all
ticket-shaped and none wanted an implementer. What is absent is *intent to build now*, which
cannot be read off a body. It has to be asserted, which is an owner point.

The saving is authoring-side only; claim, Immutability, acceptance, review and close gate are
untouched. Trimming the tail would be a bypass.
