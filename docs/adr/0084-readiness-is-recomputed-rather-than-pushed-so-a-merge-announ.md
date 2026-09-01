---
status: constraint
date: 2026-08-28
reversal: Reversing means rebuilding fan-out as edge-triggered promotion in lane 08 — a second lane reasoning about the graph, against ADR-0069 — plus durable readiness state that can drift, and re-accepting dependents parked forever behind blockers that closed without delivering; the branch-ref-as-claim that makes duplicate dispatch harmless would have to be replaced by a global lock.
---

# Readiness is recomputed rather than pushed, so a merge announces without interpreting and an unsatisfiable edge is a counter finding rather than a park

The ready set is recomputed, never pushed. A lane 09 reconciler derives it from durable state on session end and on lane 08's `graph-changed` doorbell, and dispatches `ticket-ready` for every published, unstarted slice in it.

`dispatchReadySlices` filtered on `dependsOn.length === 0` — the real predicate, every blocker delivered, folded into a constant true only at t=0, so nothing sent the second wave. An edge is satisfied when its blocker closed having delivered a merged pull request; open, `not planned`, and closed-with-nothing-merged all leave it unsatisfied. An unsatisfiable edge is one standing counter finding, never a park (ADR-0011). The branch ref is the claim, created first, so duplicate dispatch is free and no lock is needed.

**Rejected:** lane 08 promoting, edge-triggered and inheriting permanent parks; a stored counter that can drift; precomputed waves; a cron (ADR-0048).

**Accepted cost.** A hand-closed slice with no pull request reads as undelivered.
