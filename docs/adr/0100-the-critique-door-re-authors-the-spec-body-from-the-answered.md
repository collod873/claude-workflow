---
status: constraint
date: 2026-08-29
supersedes: ADR-0085
reversal: Leaving the critic's resolutions in comments means teaching lane 03 and every other body reader to read the thread, while `affectedSlices` diffs a body that never carried the criteria its slices were cut from.
---

# Lane 02 re-authors the spec body from what the critic resolved before the gate applies sliceable

The critic resolves each ambiguity it finds instead of posting it, reading any
comments already on the issue first. When it resolves anything, or a sheet's mark has no filed
ruling, a reconciler stage rewrites the issue body, lists each resolution under `## Assumptions`, and
only then does the gate apply `sliceable`. A resolution needs no owner reply behind it. With nothing
resolved, no stage runs.

The body is the ledger. Lane 03 slices it and `affectedSlices` matches criteria against it verbatim,
so a ruling left in a comment is a criterion the body never contains. A rewrite returning fewer
acceptance criteria than it was handed is refused before anything is written.

The rewrite is not critiqued again; the gate stands on the pass already taken.

**Rejected: appending a `## Rulings` section with no model.** It cannot rewrite an argued-down
criterion, so the body carries both and contradicts itself.
