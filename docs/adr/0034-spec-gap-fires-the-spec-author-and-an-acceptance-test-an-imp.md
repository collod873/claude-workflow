---
status: constraint
date: 2026-08-26
reversal: Reversing "the spec wins by construction" hands ambiguity resolution back to implementers and reviewers, which means re-scoping lane 05's and lane 07's prompts, giving spec/gap a different reader than lane 02's spec author, and rebuilding the second escalation budget this ADR collapsed — a route ADR-0038 now also feeds.
---

# spec/gap fires the spec author, and an acceptance test an implementer cannot pass is an ordinary red

`spec/gap` fires lane 02's spec author to amend the spec; the merged amendment regenerates the affected acceptance tests and unblocks the slice. A label with no reader is a note, not an edge.

Where a spec and a test disagree and neither is obviously wrong, **the spec wins by construction**: the test was authored from the spec and nothing else, so the disagreement is a defect in the test or an ambiguity in the spec, and neither is the implementer's to settle.

**Rejected:** a second escalation for an implementer that cannot pass an acceptance test. That is an ordinary red — the fixer's trigger, three attempts, then `blocked`. One path written down twice, with no second budget.

**Accepted cost.** A `spec/gap` costs an Opus spec-author run plus an acceptance re-fire per affected slice.
