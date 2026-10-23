---
status: constraint
date: 2026-10-23
reversal: A spec's slices would wait on waves again, and the slicer would carry names forward in a record kept in the spec rather than read them off the code.
---

# A spec is cut into slices at their last responsible moment and lands once from its integration branch

A spec runs on its own integration branch, driven by a scheduler in code. A fresh slicer cuts the
seams first, then each tracer-bullet slice at its last responsible moment, once everything it is
blocked by has merged, reading names and files off the branch as built. The scheduler hires a fresh
builder for each slice on the frontier, three at once; a builder is done when its branch
fast-forwards the integration branch. A slice too big for its builder goes back to the slicer as
what is left. Once no slice is left, the full check, review, `bin/land` and the done check each run
once over the whole branch, as ADR-0012 does for a ticket. Work is a spec when its slices add up to
one outcome the owner could try; anything else is a ticket.

**Rejected: an agent orchestrating the spec, or slicing it all up front.** The orchestrator's
context fills until it decides and monitors badly, and an up-front slice guesses at names that
later slices could read off the code.

Evidence: `docs/research/waves-today-2026-10.md`; `docs/research/spec-1086-2026-10.md`; the owner,
2026-10-22 and 2026-10-23 (#1455).
