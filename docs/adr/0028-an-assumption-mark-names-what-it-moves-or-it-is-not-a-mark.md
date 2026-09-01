---
status: constraint
date: 2026-08-26
reversal: Narrowing the mark back to same-sheet decisions changes which rulings lane 01 files at accept, and the ADRs already committed to main under the wider definition cannot be unfiled; ADR-0029's routing fraction and the malformed-mark strip check were both calibrated against this definition, and CONTEXT.md's glossary entry was rewritten to match.
---

# An assumption mark names what it moves, or it is not a mark

The shaper marks a decision only if the mark names what moves when the answer flips — another decision on the same sheet, or a named artifact: an ADR, a lane's contract, a file. A mark with an empty target is malformed and stripped mechanically, so the check needs no judgement.

It binds because the mark is the first of ADR-0005's three tests, and so decides which rulings get filed at accept.

**Rejected:** the strict reading, where a mark means *changes other decisions on this sheet*. It comes apart on a real sheet — a storage choice beside four UI decisions moves nothing else and is still expensive to unwind, so no ADR is filed for exactly the decisions that needed one. Also rejected: a second glyph for ADR-worthiness, spending the sheet's scarce length on furniture.

**Accepted cost.** Marks get more common; that pressure lands on ADR-0029's routing threshold.
