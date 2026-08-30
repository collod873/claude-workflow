# Wave 0 may hold more than one slice, so validatePlan requires at least one unblocked root rather than exactly one

Recorded 2026-08-30.

Amends #240, which tightened `validatePlan` to demand exactly one unblocked root. That rule
contradicted the stage feeding it: `to-tickets/slice/prompt.md` defines wave 0 as *"the unblocked
root, every slice you draw with no `dependsOn`"* — plural by construction — and `dispatch-reconcile`
already computes a plural ready set. A spec whose work genuinely starts in several independent
places was refused *after* the model had been paid for the plan, and the only way to satisfy the
check was to invent an edge, which makes the graph lie about what blocks what. #236's own plan hit
this and lost a slice stage to it.

The empty case stays a refusal: no root means nothing can start, which is a cycle by another name.
`240-exactly-one-unblocked-root.test.ts` and the two-root half of `240-zero-root-keeps-its-message.test.ts`
are retired with this ruling, since they assert the behaviour it reverses.
