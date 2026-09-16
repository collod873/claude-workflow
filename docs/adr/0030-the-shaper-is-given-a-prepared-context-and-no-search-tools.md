---
status: constraint
date: 2026-08-26
reversal: Giving the shaper read, grep or search means emptying `SHAPER_DENIED_TOOLS` in `shape/shape.ts` and retiring the one-round re-sweep built to replace them, after which never free-roaming is a prompt line a model can talk itself past.
---

# The shaper is given a prepared context and no search tools

Lane 01's shaper runs with no read, grep, glob or search tool. Its whole context is the idea,
`CONTEXT.md`, `CODING_STANDARDS.md` and the sweep's reading list, where each item carries a reason
naming what it bears on. The list is bounded by relevance, not by a count.

A prohibition written in a prompt beside an unbounded input is decoration; an empty toolbelt makes
*never free-roams* a fact about what the stage can do.

The shaper cannot discover that its context is incomplete, so it may ask for one re-sweep naming
what it needs. A second request is an error, not a loop. What the re-sweep still cannot supply, the
shaper marks on the affected decision, pointing at the gap, and writes the sheet anyway.

**Rejected: capping the reading list at ~10 items.** Starving the inputs causes lane 01's named
failure: a confident sheet on a wrong premise.
