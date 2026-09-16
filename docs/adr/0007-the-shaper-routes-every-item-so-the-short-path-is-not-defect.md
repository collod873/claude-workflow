---
status: constraint
date: 2026-08-23
reversal: Reserving the short route for defects means rewriting the shaper prompt's route rule and dropping `go-long`/`go-short` from `shared/labels.json` and `routeFor` in `shape/accept.ts`, and every small feature pays the long path's overhead again with nothing recording what it cost.
---

# The shaper routes every item, so the short path is not defects-only

The shaper ends every sheet with a route, `long` or `short`, for features as well as defects, and
the owner's `go-long` or `go-short` label on the accept overrides it. Short never skips the gauntlet
or review. Two signals bound it, each falling out of the sheet's shape: more than half the decisions
carrying an assumption mark forces long, and a tree that will not close under five decisions is
refused as needing a live session.

The two misroutes are not symmetric. A wrong short route is visible, because the gauntlet and review
still run, and recoverable by re-shaping. A wrong long route buys per-item overhead and leaves no
trace, because nothing records ceremony an item did not need.

**Rejected: short for defects only.** It makes the invisible misroute the policy for every feature.

**Rejected: the owner sizes each item.** A sizing quiz he cannot answer better than the shaper.
