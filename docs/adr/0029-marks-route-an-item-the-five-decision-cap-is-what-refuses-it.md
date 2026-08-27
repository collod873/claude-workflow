# Marks route an item; the five-decision cap is what refuses it

Recorded 2026-08-26.

Amends: [ADR-0007](0007-the-shaper-routes-every-item-so-the-short-path-is-not-defect.md), which set
the routing threshold at more than ~3 marks.

More than half a sheet's decisions carrying an assumption mark sends the item long. The shaper
refuses to shape — *"needs a live session"* — when the decision tree will not close under five
decisions, which is the sheet's own cap and not a new number. Two signals, two thresholds, each
falling out of the sheet's shape.

`DESIGN.md` §01 and §01a hung both outcomes on the same number: §01a said more than ~3 marks "sends
it long regardless," §01 said more than ~3 marks means the shaper "does not understand the idea well
enough" and should hand it back. At four marks the owner either gets a sheet routed long or gets no
sheet at all, and the design does not say which.

## Considered options

- **Keep one threshold and pick an outcome.** Rejected: the two outcomes answer different questions.
  A mark says *I guessed at something load-bearing*, which is an argument for spending a spec on the
  item, not for handing it back. Refusal says *I cannot state this as work*, which is a different
  failure and deserves its own trigger.
- **Keep the flat count of ~3 for routing.** Rejected: it breaks on short sheets. Two decisions with
  both marked is plainly an idea nobody understands, and a flat 3 waves it through. A fraction
  reproduces ~3 on a full five-decision sheet and behaves correctly below it.
- **A new number for refusal.** Rejected as unnecessary. The five-decision cap already exists, is
  already mechanically checkable, and a tree that will not close under it is the honest definition
  of *needs a live session*.

## Consequences

[ADR-0028](0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md) widened what a mark
may point at, so more items will be marked and more will route long. ADR-0007 is explicit that the
two misroutes are not symmetric: a wrong **short** route is visible, because lanes 06–07 still run,
and recoverable by re-shaping — while a wrong **long** route buys the overhead that killed era 4 and
leaves no trace anywhere, because nothing records ceremony an item did not need.

This threshold is therefore the only thing holding that line, and it is a guess until sheets exist to
count. **The number to watch is the share of items routed long**, and the first evidence arrives from
the sheets themselves.
