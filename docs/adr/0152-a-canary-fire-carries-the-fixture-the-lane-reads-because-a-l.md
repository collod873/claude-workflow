---
status: constraint
date: 2026-09-03
amends: ADR-0146
reversal: Reversing it means deleting shared/canary-fixture.ts and the seeding in bin/canary, and
  accepting that every issue-driven lane is provable only as far as its first collector. Getting
  back means re-deriving, for each such lane, what a real upstream would have left on the issue,
  which is the work this file exists to record once.
---

# A canary fire carries the fixture the lane reads, because a lane that starts on an empty issue proves only that it started

ADR-0149 taught `bin/canary` to derive each lane's fire from its caller YAML. That stops at the
door: Spec's `sheet-accepted` dispatch woke the lane at the right ref on the right runner, then died
on `ISSUE_NUMBER must be a positive integer; got ""`. An issue-driven lane does not read the event,
it reads what an earlier lane left on an issue, and Spec's collector refuses anything but a decision
sheet and an accept payload (ADR-0058).

So a lane needing an issue declares its fixture in `shared/canary-fixture.ts`; `bin/canary` seeds it
and passes its number in the payload. A lane with no fixture fires as before. The fixture is written
against the collector: the suite runs the real `collectSheetContext` over it, so a new demand fails
in vitest, not four minutes into a run.

The fixture stands in for the upstream lane. A green says Spec works on a well-formed sheet, never
that Shape writes one; that chain is `bin/canary-graph`'s question.
