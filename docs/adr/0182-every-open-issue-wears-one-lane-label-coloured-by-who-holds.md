---
status: constraint
date: 2026-09-12
reversal: Undoing this means re-teaching every lane its own label strings, restoring `running` and the permanent `to-build`, and giving up the phone's issue list as the dashboard; the catalogue, `markLane`, the reconciler's swap and rollup, and `npm run labels-doc` all come out together.
---

# Every open issue wears one lane label, coloured by who holds it

The owner reads the pipeline from the GitHub app's issue list, and `running` could not say
what is happening to an issue now: six lanes stamped it, no pull-request lane did, and a PRD
waiting on the owner looked like one being sliced. So every pipeline label lives in one
catalogue with a **family**, which is the colour: green for a lane on it now, numbered
by lane so the filter sorts in pipeline order; blue for waiting on the machine; red for waiting
on the owner; purple for the owner's verbs; grey for kind; amber for `ticket`. Green and blue
are exclusive: `markLane` swaps them in one edit, and a green label with no run behind it is
where a chain died. The reconciler swaps `to-build` for the lane label at dispatch.

**Rejected: a project-board status column.** A second view, and a second writer to keep true.
