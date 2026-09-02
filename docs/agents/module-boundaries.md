# Module boundaries

Generated from `.dependency-cruiser.cjs` and `.Workflow/agent-workflows/shared/boundaries-baseline.json` by
`shared/generate-boundaries-doc.ts` — edit those, not this file. `bin/gauntlet push` fails if
this file disagrees with a fresh regeneration.

Three rules, scoped to `.Workflow/agent-workflows` — the only tree with lanes to keep apart:

  1. no-lane-to-lane   — a lane may not deep-import another lane. `shared/` is every lane's
     only legal crossing, and today `shared/` is itself the door (95 files, no subdirectory
     doors yet — #226 says that split comes after this gate has run for a week, not before).
  2. shared-no-lane    — `shared/` may never import a lane. The one edge that ran backwards
     (`shared/rewrite-session-notes-schema.ts` → `observations/`) is fixed in this same
     ticket by moving the type it needed into `shared/`, not by baselining it.
  3. no-circular       — dependency-cruiser's own built-in cycle rule.

## Baseline

69 standing violation(s) as of 2026-09-02, excused by the
baseline so the gate fires on a new violation only, never on this debt:

Standing module-boundary debt at the day this gate landed (#305). The gate fails on anything added to this set, never on the set itself; entries leave as each edge is routed through shared/ or a published seam instead.

A ticket that pays down part of the baseline drops those entries with:

```
node .Workflow/agent-workflows/shared/boundaries-baseline.ts update <root>
```

## What this is not

Not a per-edge grant manifest. Every lane gets the same three rules — none gets a different
allowance than another (a repo-wide scan for lane-to-lane deep imports outside `shared/` and
against these rules found no edge treated differently by design, only by debt) — and `shared/`
has no subdirectory doors yet to enumerate grants against. That door split is #226's, filed once
this gate has run long enough to show what the doors should be.
