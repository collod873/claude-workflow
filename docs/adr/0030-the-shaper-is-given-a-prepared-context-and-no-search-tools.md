# The shaper is given a prepared context and no search tools

Recorded 2026-08-26.

Status: superseded by ADR-0098

The shaper runs with no read, grep, glob or issue-search tool. Its entire context is the idea
verbatim, `CONTEXT.md`, `CODING_STANDARDS.md`, and the sweep's reading list — where every item
carries a one-line reason naming which part of the idea it bears on, and an item with no reason is
dropped. The list is bounded by relevance, not by a count.

`DESIGN.md` §01 said the shaper "never free-roams the codebase" and, in the same table, gave the
sweep the job of "building stage 2's reading list" with nothing bounding that list. A prohibition
written in a prompt beside an unbounded input is decoration.

## Considered options

- **Cap the reading list at ~10 items.** Rejected, and it is the wrong instrument in this specific
  lane. §01 names lane 01's failure as *a confident, coherent sheet resting on a wrong premise* —
  starving the shaper's inputs causes that failure rather than preventing it. A count cap also
  bounds the wrong thing: the scarce resource is the length of what the **owner** reads, and the
  whole chain is under a dollar.
- **Leave it as a prompt instruction and trust the model.** Rejected against the gate rule this repo
  already runs on: something that refuses at the moment the action is attempted needs no reader, and
  an instruction a model can talk itself past is not one.
- **A relevance bound, enforced by the toolbelt.** Chosen. With no search tools, *never free-roams*
  is a fact about what the stage can do rather than a line it was asked to honour.

## Consequences

The shaper can no longer discover that its context is incomplete, which walks this lane's named
failure in through the front door. That is handled rather than prevented: the shaper may emit **one**
re-sweep request naming what it needs and why, which re-runs the sweep with that gap as an explicit
target. If the second sweep still does not produce it, the shaper marks the affected decision —
pointing at the gap, per
[ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md) — and writes the
sheet anyway.

One cheap Haiku stage, capped at one round so it cannot loop, spent directly against the only
failure this lane has. The cap is the same instinct as §01's two-round limit on change requests,
pointed the other way.
