# An assumption mark names what it moves, or it is not a mark

Recorded 2026-08-26.

The shaper marks a decision only if it can write, inside the mark, the thing that moves when the
answer flips — either another decision on the same sheet, or a named existing artifact: an ADR, a
shipped lane's contract, a file. A mark with an empty target is malformed and is stripped
mechanically, so the test needs no judgement at check time.

Extends [ADR-0005](0005-accepting-a-shaped-idea-is-what-files-its-adrs.md), which makes the mark the
first of the three ADR tests and therefore decides which rulings get written at accept.

## Considered options

- **The identity as `CONTEXT.md` stated it** — a mark means the answer changes *other decisions on
  the same sheet*, and *changes other decisions* is the same property as *hard to reverse*. Rejected:
  they come apart on a real sheet. Five decisions can carry one that moves nothing else on the page
  and is still expensive to unwind — a storage choice sitting beside four UI decisions. Under the
  strict reading that decision goes unmarked, so no ADR is filed at accept, and ADR-0005's whole
  point — the ruling arrives before the spec cites it — fails for exactly the decisions that most
  needed it.
- **Two marks, one load-bearing and one ADR-worthy.** Rejected on the sheet's budget. The scarce
  resource in lane 01 is the length of what the owner reads, and a second glyph spends it on
  furniture rather than on a decision.
- **One mark, widened to point at anything.** Chosen. The mark keeps doing double duty, the
  `> half marked` routing rule stays computable, and the lone irreversible decision is caught because
  it points at a file even when it points at nothing on the page.

## Consequences

Marks get more common, because the set of things a mark may point at is now much larger than the
four other decisions on the sheet. That pressure lands on the routing threshold, and
[ADR-0029](0029-marks-route-an-item-the-five-decision-cap-is-what-refuses-it.md) is where it is
absorbed.

`CONTEXT.md`'s **Assumption mark** entry asserted that *changes other decisions* and *hard to
reverse* are the same property. They are not, and the entry is corrected alongside this ruling.
